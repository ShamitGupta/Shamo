"""Turn a finished Check reply into a marking record that can be counted.

Check mode produces prose. Prose cannot be aggregated, so nothing downstream --
weak topics, practice sets, any personalisation at all -- can be built on it.
This module reads the tutor's own finished reply and records which marks it said
the student earned and which it said they missed.

Two design choices are the whole point of this file.

**It reads the tutor rather than re-marking.** A second opinion on the
mathematics would be a second chance to be wrong, and the student never sees it.
The extractor's only job is to report what the tutor already told the student,
so the record and the feedback can never disagree.

**It cannot invent a mark code.** Every code it returns is checked against the
codes actually present in that question's retrieved mark scheme, and anything
else is discarded. This is the same discipline that made the mark-scheme parser
trustworthy: a model reporting on a table is useful, a model free to make up
table entries is not.

Failure is never fatal. The extractor runs after the student has their answer,
and a failure stores the attempt with no outcome rather than costing anyone
their tutoring.

Measured behaviour, 15 September 2026, against real replies for a real
published question (see tests/live_attempt_outcome.py, which prints its
results for reading):

  * a clean partial-credit reply, a full-marks reply, and a deliberately
    LENIENT reply were all recorded correctly, at confidence 0.86-0.95 -- and
    the lenient one was reported as the tutor stated it, which is the point:
    the record must match what the student was told, not a second opinion;
  * a reply that was only a hint recorded nothing, correctly;
  * a reply naming a mark code this question does not have records NOTHING at
    all, rather than dropping that one code and keeping the rest. The model
    returns confidence 0 and gives up. Two prompt revisions did not shift it.
    This is the safe direction and it only arises when the tutor itself names a
    non-existent code -- but it does mean one bad code costs the whole record,
    so do not read a missing outcome as proof the student was not assessed.

Re-measured 1 November 2026, after codes became counted rather than
de-duplicated: the unknown-code reply above now records M1 earned and A1
missed (confidence 0.55) instead of nothing. On 9709/13 Oct/Nov 2025 Q9, a
reply crediting M1, A1 and *M1 records all three (it used to store [M1, A1]),
and a reply that earned one A1 and missed later ones is kept rather than
rejected as a contradiction. Two runs each, identical results.
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from collections.abc import Mapping
from typing import Any

from openai import OpenAI

from .config import Settings
from .models import AttemptOutcome
from .repository import QuestionContext

logger = logging.getLogger(__name__)

# Real mark codes in this corpus, by frequency: A1, M1, B1, DM1, *M1, "B1 FT",
# B2, M2, "A1 FT", M1*, A2, "B2,1,0", B3, DB1, *DM1, B1*, "B1 B1", *B1, M3,
# "*B1 FT", "M1 FT", B1B1, "A1 A1", B4, "M2 FT", B5, M1A1, A3, "DB1 FT", DM1*,
# A1FT, A1A1, *A1, B1FT, M4, "B1 B1 B1", "A2,1,0", "B2 FT", M1M1, B1B1B1.
#
# Four shapes matter, and a first version of this file handled none of them:
#   "B2,1,0"  a BANDED code -- award 2, 1 or 0 marks
#   "B1 FT"   a follow-through suffix, sometimes spaced, sometimes not
#   "B1 B1"   two separate marks recorded in one row
#   "*M1"/"M1*"/"DM1"  dependency markers and dependent marks
#
# Getting this wrong is not cosmetic. The expanded set is the whitelist every
# code the model returns is filtered against, so a real code missing from it is
# silently discarded -- which made a whole question's outcomes unrecordable
# until a live end-to-end run exposed it.
_BANDED_PATTERN = re.compile(r"^([A-Z]{1,3})((?:\d+,)+\d+)$")
_ATOM_PATTERN = re.compile(r"([A-Z]{1,3})(\d+)\s*(FT|CAO|OE|WWW)?")


def _code_counts(raw: Any) -> Counter[str]:
    """Every atomic code a tutor might reasonably cite for one mark-scheme row,
    with how many marks of that code the row awards.

    Deliberately permissive. The job of this whitelist is to stop a FABRICATED
    code being stored, not to police how a tutor spells a real one -- and being
    too strict silently throws away correct records, which is the worse failure
    and the one that actually happened.

    Counts matter because codes repeat: "B1 B1" is two marks, and a scheme with
    three A1 rows can award A1 three times. A set here once collapsed those, so a
    reply crediting M1 and *M1 was stored as a single M1.
    """
    text = str(raw or "").upper().replace("*", " ").strip()
    if not text:
        return Counter()

    banded = _BANDED_PATTERN.match(text.replace(" ", ""))
    if banded:
        # One award of 2, 1 or 0 -- never several marks.
        letter, numbers = banded.group(1), banded.group(2)
        return Counter({f"{letter}{number}": 1 for number in numbers.split(",")})

    counts: Counter[str] = Counter()
    for letter, number, suffix in _ATOM_PATTERN.findall(text):
        base = f"{letter}{number}"
        counts[base] += 1
        if suffix:
            counts[f"{base}{suffix}"] += 1
        # A dependent mark may be cited either way round ("DM1" or "M1").
        if len(letter) > 1 and letter.startswith("D"):
            counts[f"{letter[1:]}{number}"] += 1
    return counts


def _expand_code(raw: Any) -> set[str]:
    """The spellings `_code_counts` accepts for one row, without the counts."""
    return set(_code_counts(raw))


def normalize_code(raw: str) -> str:
    """One comparable spelling for a code the model returned."""
    return str(raw or "").upper().replace("*", "").replace(" ", "").strip()

EXTRACTION_PROMPT = """You are recording what a mathematics tutor just told a student.

You are NOT marking the attempt yourself. Do not form your own opinion about
whether the working is right. Read the tutor's reply and report only what the
tutor stated.

Return JSON with exactly these keys:
  "earned_codes":    mark codes the tutor said the student DID earn
  "missed_codes":    mark codes the tutor said the student did NOT earn
  "marks_earned":    integer, how many marks the tutor credited
  "marks_available": integer, the total the tutor marked OUT OF
  "confidence":      0.0-1.0, how clearly the reply stated this

Rules:
- List a code once for EACH mark it stands for. If the tutor credited A1 twice,
  "earned_codes" contains "A1" twice; the mark scheme list below shows how many
  times each code can be awarded. Never list one mark twice under two spellings.
- Use only mark codes that appear in the mark scheme shown below, spelled
  exactly as they appear there. Never substitute a similar-looking code from
  that list for one the tutor actually said -- reporting "M1" when the tutor
  said "B1" is a fabrication, not a correction.
- If the tutor names a code that is NOT in the list, ignore that one code and
  carry on reporting the rest of the reply normally. An unrecognised code is
  not a reason to give up on the whole reply, and not a reason to lower your
  confidence: judge confidence only on how clearly the tutor stated what the
  student earned.
- "marks_available" is what the tutor marked out of. If the tutor wrote
  "1 out of 2", that is 2 -- not the whole question's total. If the tutor gave
  no total, use the whole question total supplied below.
- A code goes in "missed_codes" when the tutor said it was not earned, including
  when the tutor explained why the condition was unmet.
- If the tutor was ambiguous about a mark, leave that code out of BOTH lists
  rather than guessing, and lower the confidence.
- "marks_earned" must equal the total marks the tutor actually credited. If the
  tutor gave no clear total, sum the numeric values of the earned codes.
- If the reply does not assess the attempt at all, return empty lists,
  marks_earned 0, and confidence 0.
"""


class AttemptOutcomeExtractor:
    """Reads a finished Check reply and records the marks it attributed."""

    def __init__(self, settings: Settings, client: OpenAI | None = None) -> None:
        self._settings = settings
        self._client = client or OpenAI(api_key=settings.openai_api_key)

    def extract(
        self,
        *,
        context: QuestionContext,
        transcript: str,
        attempt: str,
        part_label: str | None = None,
    ) -> AttemptOutcome | None:
        """Return the outcome, or None when one cannot be trusted.

        None is a normal result, not an error: it stores the attempt with
        outcome_source "unavailable", which every later aggregate skips. A wrong
        number would be worse than a missing one -- it would quietly distort a
        student's weak-topic ranking with no way to tell.
        """
        known_codes = collect_mark_code_counts(context)
        if not known_codes:
            # Nothing to validate against. A question whose mark scheme carries
            # no codes at all cannot produce a trustworthy record.
            logger.info("No mark codes in context; skipping outcome extraction.")
            return None
        if not transcript.strip() or not attempt.strip():
            return None

        # Every total the tutor could legitimately have marked out of: any
        # single part, or the whole question. The model picks one; anything
        # else means the reply was misread.
        allowed_totals = plausible_denominators(context)
        default_total = _marks_available(context, part_label)

        try:
            response = self._client.chat.completions.create(
                model=self._settings.attempt_outcome_model,
                messages=[
                    {"role": "system", "content": EXTRACTION_PROMPT},
                    {
                        "role": "user",
                        "content": (
                            f"MARK SCHEME CODES FOR THIS QUESTION (code x times it can be awarded)\n"
                            f"{', '.join(f'{code} x{count}' for code, count in sorted(known_codes.items()))}\n\n"
                            f"WHOLE QUESTION TOTAL: {default_total}\n\n"
                            f"THE STUDENT'S ATTEMPT\n{attempt}\n\n"
                            f"THE TUTOR'S REPLY\n{transcript}"
                        ),
                    },
                ],
                response_format={"type": "json_object"},
            )
            payload = json.loads(response.choices[0].message.content or "{}")
        except Exception as error:  # noqa: BLE001
            logger.warning("Attempt outcome extraction failed: %s", error)
            return None

        return build_outcome(
            payload,
            known_codes=known_codes,
            marks_available=default_total,
            allowed_totals=allowed_totals,
            model=self._settings.attempt_outcome_model,
        )


def collect_mark_code_counts(context: QuestionContext) -> Counter[str]:
    """Every mark code this question's mark scheme contains, and how many times
    a single attempt could be awarded it.

    This is the whitelist the model's answer is filtered against, so it is built
    from the retrieved source rather than from anything the model supplies.

    Alternative-method rows restate the main method's codes for a different
    route, and a student follows one route, not both. So the main and the
    alternative rows are counted separately and the larger count wins, rather
    than adding them -- which would let one attempt claim both routes' marks.
    """
    rows: list[dict[str, Any]] = list(context.question.get("root_mark_scheme") or [])
    for part in context.parts:
        rows.extend(part.get("mark_scheme_items") or [])
    main: Counter[str] = Counter()
    alternative: Counter[str] = Counter()
    for row in rows:
        row = row or {}
        target = alternative if row.get("is_alternative_method") else main
        target.update(_code_counts(row.get("mark_code")))
    return main | alternative


def collect_mark_codes(context: QuestionContext) -> set[str]:
    """Every mark code this question's mark scheme contains, ignoring counts."""
    return set(collect_mark_code_counts(context))


def plausible_denominators(context: QuestionContext) -> set[int]:
    """Totals a tutor could honestly have marked out of for this question.

    A reply says "1 out of 2" when it is marking one part, and the weak-topic
    ranking is a mark RATIO -- so recording that as 1 out of the whole
    question's 5 would understate the student by more than half. Constraining
    the denominator to a real part total (or the whole question) keeps the model
    from inventing one.
    """
    totals: set[int] = set()
    for part in context.parts:
        marks = part.get("marks")
        if marks:
            totals.add(int(marks))
    if context.total_marks:
        totals.add(int(context.total_marks))
    return totals


def _marks_available(context: QuestionContext, part_label: str | None) -> int | None:
    """Marks the attempt was being judged against.

    A part label narrows it to that part; without one the whole question's total
    is the honest denominator, since the student's working was diagnosed against
    the whole question.
    """
    if part_label:
        wanted = part_label.strip().strip("()").lower()
        for part in context.parts:
            label = "".join(str(p) for p in (part.get("label_path") or [])).lower()
            if label == wanted and part.get("marks"):
                return int(part["marks"])
    total = context.total_marks
    return int(total) if total else None


# Below this, the model is telling us it could not read the reply cleanly.
# Recording an unsupported number would silently distort a student's ranking,
# and nobody would ever see it to question it.
MIN_CONFIDENCE = 0.35


def build_outcome(
    payload: dict[str, Any],
    *,
    known_codes: Mapping[str, int] | set[str],
    marks_available: int | None,
    model: str,
    allowed_totals: set[int] | None = None,
) -> AttemptOutcome | None:
    """Validate a raw extractor payload into a storable outcome.

    Separate from the model call so it can be tested against fixed payloads,
    including the ones that must be REJECTED.

    `known_codes` maps each code to how many times it can be awarded. A plain
    set means each code can be awarded once.
    """
    if isinstance(known_codes, Mapping):
        limits: Mapping[str, int] = known_codes
    else:
        limits = {code: 1 for code in known_codes}

    earned = _clean_codes(payload.get("earned_codes"), limits)
    missed = _clean_codes(payload.get("missed_codes"), limits)

    # A mark cannot be both earned and missed. A code appearing in both lists is
    # fine when the scheme awards it more than once (the first A1 earned, a later
    # A1 missed); claiming more of a code than the scheme holds is the
    # contradiction, and it means the reply was not read cleanly. A half-right
    # record is worse than none.
    claimed = Counter(earned) + Counter(missed)
    if any(count > limits[code] for code, count in claimed.items()):
        logger.info("Outcome rejected: more of a code claimed than the scheme awards.")
        return None

    try:
        marks_earned = int(payload.get("marks_earned"))
    except (TypeError, ValueError):
        return None
    if marks_earned < 0:
        return None

    # Prefer the total the tutor actually marked out of, when it is a real one.
    reported_total = payload.get("marks_available")
    try:
        reported_total = int(reported_total)
    except (TypeError, ValueError):
        reported_total = None
    if reported_total and (not allowed_totals or reported_total in allowed_totals):
        marks_available = reported_total

    if marks_available is None or marks_available <= 0:
        return None
    if marks_earned > marks_available:
        # Crediting more marks than the question carries is a clear
        # misreading; the database would reject it anyway.
        logger.info(
            "Outcome rejected: %s marks credited out of %s available.",
            marks_earned,
            marks_available,
        )
        return None

    # Marks credited with no surviving code behind them are unsupported: either
    # the tutor named codes this scheme does not contain, or the reply was not
    # really an assessment. Either way the number cannot be trusted.
    if marks_earned > 0 and not earned:
        logger.info("Outcome rejected: %s marks credited with no valid code.", marks_earned)
        return None

    confidence = payload.get("confidence")
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = None
    if confidence is not None:
        confidence = max(0.0, min(1.0, confidence))
        if confidence < MIN_CONFIDENCE:
            logger.info("Outcome rejected: confidence %.2f below floor.", confidence)
            return None

    return AttemptOutcome(
        marks_earned=marks_earned,
        marks_available=marks_available,
        earned_codes=earned,
        missed_codes=missed,
        confidence=confidence,
        model=model,
    )


def _clean_codes(raw: Any, limits: Mapping[str, int]) -> list[str]:
    """Keep only codes the mark scheme actually contains, in a stable order,
    and no more of each than the scheme can award.

    This is the line that stops a fabricated mark code from ever being stored.
    The cap is what stops one mark spelled two ways ("M1", "*M1") counting
    twice, without collapsing two genuinely separate M1 marks into one.
    """
    if not isinstance(raw, list):
        return []
    kept: list[str] = []
    for entry in raw:
        if not isinstance(entry, str):
            continue
        cleaned = normalize_code(entry)
        if kept.count(cleaned) < limits.get(cleaned, 0):
            kept.append(cleaned)
    return kept
