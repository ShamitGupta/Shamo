"""Graded cases: does the tutor teach the right thing?

The pytest suite checks structure -- refusal, grounding, mode permissions. None
of that catches a tutor that retrieves the correct question and then explains it
wrongly, which is the failure that actually reaches a student. This does.

Every case here is a REAL failure observed while testing, not an invented one.
Each names the question, what went wrong, and an automatic check that would have
caught it. Cases are added when a failure is found, never speculatively.

Costs a few cents per run and needs OPENAI_API_KEY, so it is not part of
`pytest`. Run it after any change to prompts.py.

    python backend_v2/tests/evaluate_tutor.py
    python backend_v2/tests/evaluate_tutor.py --case rate-of-change
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent))


def _load_env() -> None:
    from dotenv import load_dotenv

    load_dotenv(HERE.parent / ".env")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        load_dotenv(ROOT / "workflows" / "n8n" / "harness" / ".env")


_load_env()

from app.config import get_settings  # noqa: E402
from app.models import TutorMode  # noqa: E402
from app.repository import Repository  # noqa: E402
from app.tutor import TutorService  # noqa: E402


@dataclass
class Judgement:
    """A yes/no question about the answer, decided by a model rather than a regex.

    Regex assertions lost this arms race in a way worth recording. The lenient-M1
    bug was first written as `must_not_match = "earns the M1"`. The tutor then
    produced "**M1**: Yes - you are using the correct idea", which awards exactly
    the same mark and passed cleanly. Two rounds of widening the pattern later it
    was still possible to phrase the same error a new way.

    Regex is right for things with a fixed form -- a value, a fraction, a mark
    code. It is the wrong tool for "did this response, however phrased, tell the
    student they earned a mark". So that question gets asked directly.
    """

    question: str
    expect: bool
    why: str = ""


@dataclass
class Case:
    slug: str
    year: int
    exam_session: str
    paper_variant: str
    question_number: int
    mode: TutorMode
    message: str
    attempt: str | None = None
    # Substrings or regexes that MUST appear for the answer to be right.
    must_match: list[str] = field(default_factory=list)
    # Patterns that must NOT appear. This is where the observed bugs live.
    must_not_match: list[str] = field(default_factory=list)
    judgements: list[Judgement] = field(default_factory=list)
    why: str = ""


CASES: list[Case] = [
    Case(
        slug="rate-of-change",
        year=2024,
        exam_session="may_june",
        paper_variant="12",
        question_number=10,
        mode=TutorMode.EXPLAIN,
        message="Explain part (a) step by step.",
        # The printed scheme reads `-9 = ±5 × dt/dx`, giving dt/dx = 9/5 and so
        # dx/dt = 5/9. The tutor copied the numbers but wrote dx/dt in place of
        # dt/dx -- reciprocals, so its working produced 9/5. It then noticed the
        # clash with the printed 5/9 and, rather than finding its error, wrote
        # "we must follow the scheme's stated result exactly" and asserted 5/9.
        #
        # Right final answer, wrong method, and the correct last line hides it.
        # Assert the INVARIANT -- correct maths -- not a particular route.
        #
        # Two earlier versions of these assertions were wrong, both by demanding
        # more than correctness requires:
        #   1. banned "9/5" outright, but dt/dx = 9/5 is a correct intermediate;
        #   2. required the scheme's dt/dx notation, but dy/dt = dy/dx x dx/dt
        #      reaching -5 = -9 x dx/dt is equally valid and arguably clearer.
        # Both failed correct answers. A test that fires on good output is worse
        # than no test, because it teaches you to ignore it.
        must_match=[
            r"5\s*/?\s*9|\\frac\{5\}\{9\}",   # the printed answer
            r"x\s*=\s*[-−]\s*2",              # the B1
        ],
        must_not_match=[
            # The false equation itself: -9 paired with dx/dt. Whichever route
            # is taken, -9 belongs with dt/dx and -5 belongs with dx/dt.
            r"(?is)[-−]\s*9\s*=[^=]{0,60}?\\frac\{dx\}\{dt\}",
            r"(?is)[-−]\s*9\s*=[^=]{0,40}?dx/dt",
            # The inverted final answer stated as a result.
            r"(?is)\\frac\{dx\}\{dt\}\s*(&|=|\}|\s){0,12}\\frac\{9\}\{5\}",
            r"(?i)dx/dt\s*=\s*9\s*/\s*5",
            # Deferring to the printed answer instead of fixing its own working.
            #
            # Narrow on purpose. An earlier version banned any "we use the mark
            # scheme", which caught the entirely reasonable "we use the mark
            # scheme's form for dy/dx". What is being detected is deference in
            # the face of a CONTRADICTION -- the model announcing a clash and
            # then choosing the printed value over its own arithmetic.
            r"(?i)must\s+follow\s+the\s+(scheme|mark\s+scheme)",
            r"(?i)stick\s+with\s+the\s+(scheme|mark\s+scheme)",
            r"(?i)but\s+the\s+mark\s+scheme('s)?\s+(final\s+)?answer\s+is",
            r"(?i)the\s+scheme('s)?\s+(stated\s+)?result\s+exactly",
        ],
        why="Swapped dt/dx for dx/dt, then deferred to the printed answer instead of rechecking.",
    ),
    Case(
        slug="lenient-m1",
        year=2025,
        exam_session="oct_nov",
        paper_variant="51",
        question_number=4,
        mode=TutorMode.CHECK,
        message="Did I get part (b) right?",
        attempt="P(all same) = 8/11 x 4/5 x 7/10 = 224/550 = 0.407",
        # The M1 guidance reads "Both, FT their tree diagram probabilities".
        # Both terms are required, so an attempt with only P(RRR) does not earn
        # it. The tutor awarded it anyway.
        must_match=[r"(?i)BBB|blue.*blue.*blue|second (case|term)"],
        judgements=[
            Judgement(
                question=(
                    "Does the response tell the student that their working earns, "
                    "or would earn, the M1 mark? Answer YES if it credits them with "
                    "the M1 in any wording, including 'M1: Yes', 'M1 only', or "
                    "'you get the M1'. Answer NO if it states they do not earn it."
                ),
                expect=False,
                why=(
                    "The M1 guidance reads 'Both, FT their tree diagram probabilities'. "
                    "The attempt has only P(RRR), so the mark is not earned."
                ),
            )
        ],
        why="Awarded an M1 the printed guidance requires both terms for.",
    ),
    Case(
        slug="hint-withholds-answer",
        year=2025,
        exam_session="oct_nov",
        paper_variant="51",
        question_number=4,
        mode=TutorMode.HINT,
        message="I'm stuck on part (b), give me a hint.",
        must_match=[r"(?i)RRR|BBB|same colour"],
        must_not_match=[r"1307", r"0\.432", r"\\frac\{1307\}\{3025\}"],
        why="Hint mode must not leak the final answer.",
    ),
]


def ask_judge(answer: str, judgement: Judgement, settings) -> bool | None:
    """Put one narrow factual question to a model. Returns its yes/no, or None.

    Kept deliberately dumb: it never sees the mark scheme and is never asked
    whether the tutoring was GOOD, only whether the response says a specific
    thing. Asking a model to grade quality would just replace one unaccountable
    judgement with another.
    """
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        "You are checking one factual property of a tutoring response. "
        "Answer with exactly one word: YES or NO.\n\n"
        f"QUESTION: {judgement.question}\n\n"
        f"RESPONSE TO CHECK:\n{answer}"
    )
    try:
        result = client.chat.completions.create(
            model=settings.tutor_model,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as error:  # noqa: BLE001
        print(f"      judge unavailable: {error}")
        return None
    verdict = (result.choices[0].message.content or "").strip().upper()
    if verdict.startswith("YES"):
        return True
    if verdict.startswith("NO"):
        return False
    print(f"      judge gave an unusable answer: {verdict[:60]!r}")
    return None


def run_case(case: Case, repository: Repository, tutor: TutorService) -> tuple[bool, list[str], str]:
    context = repository.get_question_context(
        case.year, case.exam_session, case.paper_variant, case.question_number
    )
    if context is None:
        return False, [f"question not published: {case.paper_variant} {case.year}"], ""

    answer = "".join(
        tutor.stream(
            context=context,
            mode=case.mode,
            message=case.message,
            attempt=case.attempt,
            history=[],
            asset_urls_available=True,
        )
    )

    problems: list[str] = []
    for pattern in case.must_match:
        if not re.search(pattern, answer):
            problems.append(f"missing expected: {pattern}")
    for pattern in case.must_not_match:
        found = re.search(pattern, answer)
        if found:
            problems.append(f"contains forbidden: {pattern}  -> {found.group(0)!r}")
    for judgement in case.judgements:
        verdict = ask_judge(answer, judgement, get_settings())
        if verdict is None:
            problems.append(f"judge could not decide: {judgement.question[:60]}...")
        elif verdict != judgement.expect:
            problems.append(
                f"judge says {'YES' if verdict else 'NO'}, expected "
                f"{'YES' if judgement.expect else 'NO'}: {judgement.why}"
            )
    return not problems, problems, answer


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", help="run one case by slug")
    parser.add_argument("--show", action="store_true", help="print the full answer")
    args = parser.parse_args()

    settings = get_settings()
    repository = Repository(settings)
    tutor = TutorService(settings)

    cases = [c for c in CASES if not args.case or c.slug == args.case]
    if not cases:
        print(f"No case named {args.case!r}. Known: {', '.join(c.slug for c in CASES)}")
        return 1

    failures = 0
    for case in cases:
        print(f"\n=== {case.slug} ===")
        print(f"  9709/{case.paper_variant} {case.exam_session} {case.year} "
              f"Q{case.question_number}, mode={case.mode.value}")
        print(f"  regression: {case.why}")
        passed, problems, answer = run_case(case, repository, tutor)
        print(f"  {'PASS' if passed else 'FAIL'}")
        for problem in problems:
            print(f"      {problem}")
        if args.show or not passed:
            print("  --- answer ---")
            for line in answer.splitlines():
                print(f"  | {line}")
        if not passed:
            failures += 1

    print()
    if failures:
        print(f"FAIL -- {failures} of {len(cases)} case(s) regressed.\n")
        return 1
    print(f"PASS -- {len(cases)} case(s).\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
