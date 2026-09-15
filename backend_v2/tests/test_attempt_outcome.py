"""What the marking extractor may and may not record.

The extractor turns a Check reply into countable marks. Everything downstream --
weak topics, practice sets -- is computed from its output, and a student never
sees it, so a wrong record is worse than a missing one: it quietly distorts the
ranking with nothing to notice.

These tests therefore spend most of their effort on what must be REJECTED.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key")
os.environ.setdefault("OPENAI_API_KEY", "test-key")

from app.attempt_outcome import (  # noqa: E402
    build_outcome,
    collect_mark_codes,
    _expand_code,
    _marks_available,
)
from app.repository import QuestionContext  # noqa: E402

CONTEXT = QuestionContext(
    paper={
        "year": 2025,
        "exam_session": "oct_nov",
        "paper_variant": "12",
        "syllabus_code": "9709",
        "qualification": "a_level",
    },
    question={
        "id": "11111111-1111-1111-1111-111111111111",
        "question_number": 1,
        "total_marks": 5,
        "stem_markdown": "Express 9x^2 - 36x + 8 in the form p(x+q)^2 + r.",
        "root_mark_scheme": [],
        "parts": [
            {
                "label_path": ["a"],
                "marks": 2,
                "prompt_markdown": "Express in completed-square form.",
                "mark_scheme_items": [
                    {"mark_code": "B1", "content_markdown": "p = 9"},
                    {"mark_code": "B1", "content_markdown": "q = -2"},
                ],
            },
            {
                "label_path": ["b"],
                "marks": 3,
                "prompt_markdown": "Find the set of values of k.",
                "mark_scheme_items": [
                    {"mark_code": "M1", "content_markdown": "attempts discriminant"},
                    {"mark_code": "A1", "content_markdown": "k < -28"},
                    {"mark_code": "*B1", "content_markdown": "states the inequality"},
                ],
            },
        ],
    },
    documents=[],
)

KNOWN = collect_mark_codes(CONTEXT)


def test_known_codes_come_from_the_mark_scheme_itself():
    # The whitelist is built from retrieved source, not from anything a model
    # supplies -- that is what makes the filtering below trustworthy.
    assert KNOWN == {"B1", "M1", "A1"}


def test_a_leading_dependency_marker_does_not_create_a_separate_code():
    # "*B1" marks a dependency; it is still a B1. Treating it as its own code
    # would mean a tutor saying "B1" could never be matched against it.
    assert "*B1" not in KNOWN
    assert "B1" in KNOWN


def test_a_clean_reply_is_recorded():
    outcome = build_outcome(
        {
            "earned_codes": ["M1"],
            "missed_codes": ["A1"],
            "marks_earned": 1,
            "confidence": 0.9,
        },
        known_codes=KNOWN,
        marks_available=5,
        model="gpt-5.4-nano",
    )
    assert outcome is not None
    assert outcome.earned_codes == ["M1"]
    assert outcome.missed_codes == ["A1"]
    assert outcome.marks_earned == 1
    assert outcome.marks_available == 5
    assert outcome.confidence == 0.9


def test_a_fabricated_mark_code_is_discarded_not_stored():
    """The single most important behaviour in this module.

    A model reporting on a mark scheme is useful; a model free to invent
    entries in one is not. "SC2" is a plausible-looking Cambridge code that
    this question's mark scheme does not contain.
    """
    outcome = build_outcome(
        {
            "earned_codes": ["M1", "SC2", "B7"],
            "missed_codes": ["A1"],
            "marks_earned": 1,
            "confidence": 0.8,
        },
        known_codes=KNOWN,
        marks_available=5,
        model="m",
    )
    assert outcome is not None
    assert outcome.earned_codes == ["M1"]  # SC2 and B7 dropped entirely


def test_a_code_claimed_both_earned_and_missed_rejects_the_whole_outcome():
    # A contradiction means the reply was not read cleanly. Storing the half of
    # it that happens to parse would put a made-up number in the ranking.
    assert build_outcome(
        {
            "earned_codes": ["M1"],
            "missed_codes": ["M1"],
            "marks_earned": 1,
            "confidence": 0.9,
        },
        known_codes=KNOWN,
        marks_available=5,
        model="m",
    ) is None


def test_more_marks_than_the_question_carries_is_rejected():
    assert build_outcome(
        {"earned_codes": ["M1"], "missed_codes": [], "marks_earned": 9, "confidence": 1.0},
        known_codes=KNOWN,
        marks_available=5,
        model="m",
    ) is None


def test_a_missing_or_unusable_total_is_rejected():
    for payload in (
        {"earned_codes": ["M1"], "marks_earned": None},
        {"earned_codes": ["M1"], "marks_earned": "two"},
        {"earned_codes": ["M1"], "marks_earned": -1},
        {"earned_codes": ["M1"]},
    ):
        assert build_outcome(
            payload, known_codes=KNOWN, marks_available=5, model="m"
        ) is None


def test_no_marks_available_means_no_record():
    # Without a denominator a mark ratio is meaningless, and the ratio is the
    # whole basis of the weak-topic ranking.
    assert build_outcome(
        {"earned_codes": [], "marks_earned": 0},
        known_codes=KNOWN,
        marks_available=None,
        model="m",
    ) is None


def test_a_zero_score_is_a_real_record_not_a_rejection():
    """Scoring nothing is evidence, and arguably the most useful kind."""
    outcome = build_outcome(
        {"earned_codes": [], "missed_codes": ["M1", "A1"], "marks_earned": 0, "confidence": 0.95},
        known_codes=KNOWN,
        marks_available=5,
        model="m",
    )
    assert outcome is not None
    assert outcome.marks_earned == 0
    assert outcome.missed_codes == ["M1", "A1"]


def test_confidence_above_the_floor_is_clamped_and_kept():
    for raw, expected in ((1.7, 1.0), (0.9, 0.9), ("high", None), (None, None)):
        outcome = build_outcome(
            {"earned_codes": ["M1"], "marks_earned": 1, "confidence": raw},
            known_codes=KNOWN,
            marks_available=5,
            model="m",
        )
        # A missing or unreadable confidence is kept: the model never claimed to
        # be unsure, and every other validation still applied.
        assert outcome is not None
        assert outcome.confidence == expected


def test_low_confidence_is_rejected_outright():
    """A model saying it could not read the reply is telling us the number is
    unsupported. Storing it anyway would distort a ranking nobody ever sees.

    Observed live at confidence 0.08, where the extractor produced two "missed"
    codes the tutor had never mentioned.
    """
    for raw in (0.0, 0.08, 0.34, -2):
        assert build_outcome(
            {"earned_codes": ["M1"], "marks_earned": 1, "confidence": raw},
            known_codes=KNOWN,
            marks_available=5,
            model="m",
        ) is None


def test_marks_credited_with_no_surviving_code_are_rejected():
    """Observed live: a reply naming a code outside the scheme produced
    "1 mark earned" with an empty earned list -- a number with nothing behind it."""
    assert build_outcome(
        {"earned_codes": ["SC1"], "missed_codes": ["A1"], "marks_earned": 1, "confidence": 0.9},
        known_codes=KNOWN,
        marks_available=5,
        model="m",
    ) is None


def test_the_tutors_own_denominator_is_used_when_it_is_a_real_total():
    """A reply marking "1 out of 2" must not be recorded as 1 out of 5.

    The weak-topic ranking IS the mark ratio, so the denominator decides the
    figure: 1/5 instead of 1/2 understates the student by more than half.
    """
    outcome = build_outcome(
        {
            "earned_codes": ["M1"],
            "missed_codes": ["A1"],
            "marks_earned": 1,
            "marks_available": 2,
            "confidence": 0.9,
        },
        known_codes=KNOWN,
        marks_available=5,
        allowed_totals={2, 3, 5},
        model="m",
    )
    assert outcome is not None
    assert (outcome.marks_earned, outcome.marks_available) == (1, 2)


def test_an_invented_denominator_falls_back_to_the_real_total():
    outcome = build_outcome(
        {"earned_codes": ["M1"], "marks_earned": 1, "marks_available": 17, "confidence": 0.9},
        known_codes=KNOWN,
        marks_available=5,
        allowed_totals={2, 3, 5},
        model="m",
    )
    assert outcome is not None
    assert outcome.marks_available == 5


def test_codes_are_normalized_and_deduplicated():
    outcome = build_outcome(
        {"earned_codes": ["m1", " M1 ", "*M1"], "marks_earned": 1},
        known_codes=KNOWN,
        marks_available=5,
        model="m",
    )
    assert outcome is not None
    assert outcome.earned_codes == ["M1"]


def test_non_string_entries_do_not_crash_the_extractor():
    outcome = build_outcome(
        {"earned_codes": ["M1", 7, None, {"code": "A1"}], "marks_earned": 1},
        known_codes=KNOWN,
        marks_available=5,
        model="m",
    )
    assert outcome is not None
    assert outcome.earned_codes == ["M1"]


def test_marks_available_narrows_to_a_part_when_one_is_named():
    assert _marks_available(CONTEXT, "(a)") == 2
    assert _marks_available(CONTEXT, "b") == 3
    # No part named: the attempt was diagnosed against the whole question, so
    # the whole question's total is the honest denominator.
    assert _marks_available(CONTEXT, None) == 5
    # An unknown label must not silently become a wrong denominator.
    assert _marks_available(CONTEXT, "(z)") == 5


def test_a_question_with_no_mark_codes_yields_no_whitelist():
    """Then extraction is skipped entirely -- there is nothing to validate
    against, so any code the model returned would be unverifiable."""
    bare = QuestionContext(
        paper=CONTEXT.paper,
        question={**CONTEXT.question, "parts": [
            {"label_path": ["a"], "marks": 2, "prompt_markdown": "x", "mark_scheme_items": [
                {"mark_code": None, "content_markdown": "guidance only"},
            ]},
        ]},
        documents=[],
    )
    assert collect_mark_codes(bare) == set()


def test_plausible_denominators_covers_each_part_and_the_whole_question():
    from app.attempt_outcome import plausible_denominators

    assert plausible_denominators(CONTEXT) == {2, 3, 5}


# -- mark-code shapes that actually occur in this corpus ----------------------
#
# Every case below is a real mark_code value taken from shamo_mark_scheme_items,
# with its row count at the time of writing. An early version of this module
# accepted only the plain "A1" shape and silently dropped the rest, which made
# a whole question's outcomes unrecordable: the tutor correctly cited B2, the
# whitelist did not contain it, and the record was discarded as fabricated.


def test_real_corpus_code_formats_expand():
    cases = {
        "A1": {"A1"},                        # 2503 rows
        "DM1": {"DM1", "M1"},                # 388 -- cite either way round
        "*M1": {"M1"},                       # 272 -- dependency marker
        "M1*": {"M1"},                       # 56  -- marker on the other side
        "B1 FT": {"B1", "B1FT"},             # 128 -- spaced follow-through
        "B1FT": {"B1", "B1FT"},              # 2   -- unspaced, same meaning
        "B2,1,0": {"B2", "B1", "B0"},        # 28  -- banded: award 2, 1 or 0
        "A2,1,0": {"A2", "A1", "A0"},        # 1
        "B1 B1": {"B1"},                     # 18  -- two marks in one row
        "M1A1": {"M1", "A1"},                # 3   -- two different marks
        "*B1 FT": {"B1", "B1FT"},            # 12  -- marker AND suffix
    }
    for raw, expected in cases.items():
        assert _expand_code(raw) == expected, f"{raw!r} expanded to {_expand_code(raw)}"


def test_a_banded_code_lets_a_tutor_cite_either_band():
    """The bug that started this: 9709/12 Oct/Nov 2025 Q1(a) is "B2,1,0".

    A tutor marking it says "B2" for full credit or "B1" for partial. Both must
    be recognised, or every outcome on that question is thrown away.
    """
    context = QuestionContext(
        paper=CONTEXT.paper,
        question={
            **CONTEXT.question,
            "parts": [
                {
                    "label_path": ["a"],
                    "marks": 2,
                    "prompt_markdown": "Express in completed-square form.",
                    "mark_scheme_items": [{"mark_code": "B2,1,0", "content_markdown": "..."}],
                }
            ],
        },
        documents=[],
    )
    known = collect_mark_codes(context)
    assert {"B1", "B2"} <= known

    outcome = build_outcome(
        {"earned_codes": ["B1"], "missed_codes": ["B2"], "marks_earned": 1, "confidence": 0.9},
        known_codes=known,
        marks_available=2,
        model="m",
    )
    assert outcome is not None
    assert outcome.earned_codes == ["B1"]


def test_a_tutor_spelling_a_code_with_a_space_still_matches():
    known = _expand_code("B1 FT")
    outcome = build_outcome(
        {"earned_codes": ["B1 FT"], "marks_earned": 1, "confidence": 0.9},
        known_codes=known,
        marks_available=2,
        model="m",
    )
    assert outcome is not None
    assert outcome.earned_codes == ["B1FT"]
