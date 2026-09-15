"""Run fixed Check transcripts through the REAL extractor and print what it recorded.

The offline tests prove the validation layer rejects what it should. They say
nothing about whether the model actually reads a tutor's reply correctly, which
is the part that decides whether a student's weak-topic ranking means anything.

This is meant to be READ, not just passed. The project has been burned before by
a suite that went green while the content underneath was wrong.

    python backend_v2/tests/live_attempt_outcome.py

Costs a few cents. Uses a real published question so the mark codes are real.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent))


def _load_env() -> None:
    from dotenv import load_dotenv

    load_dotenv(HERE.parent / ".env")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        load_dotenv(ROOT / "workflows" / "n8n" / "harness" / ".env")


def _use_system_trust_store() -> None:
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:  # pragma: no cover
        pass


_load_env()
_use_system_trust_store()

from app.attempt_outcome import AttemptOutcomeExtractor, collect_mark_codes  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.repository import Repository  # noqa: E402

ATTEMPT = "9x^2 - 36x + 8 = 9(x - 2)^2 + 8"

CASES = [
    (
        "clean partial credit",
        "You have the right start. Factoring out the 9 and completing the square "
        "inside the bracket is the correct method, so the M1 is earned. But you "
        "have not adjusted the constant: 9(x-2)^2 expands to 9x^2 - 36x + 36, so "
        "r must be 8 - 36 = -28, not 8. The A1 is NOT earned. Marks: 1 out of 2.",
        "should record M1 earned, A1 missed, 1 out of 2",
    ),
    (
        "lenient reply -- the extractor must report it, not re-mark it",
        "Your working is incomplete -- you never adjusted the constant term, so "
        "the completed-square form is not finished. M1: Yes, you used the correct "
        "method. A1: not earned. Marks: 1 out of 2.",
        "the tutor contradicted itself and still credited M1; the record must "
        "say what the TUTOR said, because the student saw that",
    ),
    (
        "reply naming a code this question does not have",
        "Good attempt. You earn SC1 for a special case here, and also the M1 for "
        "the method. The A1 is not earned. Marks: 1 out of 2.",
        "OBSERVED: records nothing at all. The model gives up on a reply naming an "
        "unknown code rather than dropping just that code -- safe, but one bad "
        "code costs the whole record",
    ),
    (
        "full marks",
        "That is completely correct: p = 9, q = -2 and r = -28. The M1 and the A1 "
        "are both earned. Marks: 2 out of 2.",
        "should record M1 and A1 earned, 2 out of 2",
    ),
    (
        "a hint, not an assessment",
        "Try completing the square. Factor out the 9 first and see what constant "
        "you need inside the bracket.",
        "assesses nothing, so there is nothing to record",
    ),
]


def main() -> int:
    settings = get_settings()
    repository = Repository(settings)
    context = repository.get_question_context(2025, "oct_nov", "12", 1)
    if context is None:
        print("Could not load 9709/12 Oct/Nov 2025 Q1; is it still published?")
        return 2

    codes = collect_mark_codes(context)
    print(f"question:    9709/12 Oct/Nov 2025 Q1  ({context.total_marks} marks)")
    print(f"mark codes:  {sorted(codes)}")
    print(f"model:       {settings.attempt_outcome_model}")
    print()

    extractor = AttemptOutcomeExtractor(settings)
    for name, transcript, expectation in CASES:
        outcome = extractor.extract(context=context, transcript=transcript, attempt=ATTEMPT)
        print(f"--- {name}")
        print(f"    expected: {expectation}")
        if outcome is None:
            print("    recorded: NOTHING (stored as outcome_source='unavailable')")
        else:
            print(
                f"    recorded: {outcome.marks_earned}/{outcome.marks_available} marks | "
                f"earned {outcome.earned_codes} | missed {outcome.missed_codes} | "
                f"confidence {outcome.confidence}"
            )
        print()

    print("Read these, do not just note that the script exited 0.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
