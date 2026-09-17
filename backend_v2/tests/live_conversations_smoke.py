"""Check conversation and attempt persistence against the REAL database.

The offline tests use a fake repository, so they prove the endpoints' shape and
their refusal behaviour but say nothing about whether the queries actually work.
A wrong column name, a PostgREST filter spelled the wrong way, a constraint that
rejects what the code writes -- none of that would fail the suite. This closes
that gap for the tables added in shamo_v2_7.

    python backend_v2/tests/sprint_fixtures.py create
    python backend_v2/tests/live_conversations_smoke.py

Writes and then removes its own rows, against SYNTHETIC users only. It refuses
to run if the synthetic users are absent rather than touching a real account.
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
    os.environ.setdefault("OPENAI_API_KEY", "not-needed-for-retrieval")


def _use_system_trust_store() -> None:
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:  # pragma: no cover
        pass


_load_env()
_use_system_trust_store()

from app.config import get_settings  # noqa: E402
from app.repository import Repository  # noqa: E402
from sprint_fixtures import SYNTHETIC_EMAILS, _client, _find_synthetic_users  # noqa: E402

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {label}")
    else:
        failures.append(f"{label}{': ' + detail if detail else ''}")
        print(f"  FAIL  {label}{': ' + detail if detail else ''}")


QUESTION_A = {
    "qualification": "a_level",
    "syllabus_code": "9709",
    "year": 2025,
    "exam_session": "oct_nov",
    "paper_variant": "12",
    "question_number": 1,
}
QUESTION_B = {
    "qualification": "igcse",
    "syllabus_code": "0606",
    "year": 2025,
    "exam_session": "oct_nov",
    "paper_variant": "12",
    "question_number": 1,
}


def main() -> int:
    users = {u["email"]: u["id"] for u in _find_synthetic_users(_client())}
    missing = [e for e in SYNTHETIC_EMAILS if e not in users]
    if missing:
        print("Synthetic users are missing. Run: python backend_v2/tests/sprint_fixtures.py create")
        print(f"missing: {missing}")
        return 2

    user_a = users[SYNTHETIC_EMAILS[0]]
    user_b = users[SYNTHETIC_EMAILS[1]]
    repository = Repository(get_settings())

    print("conversation lifecycle")
    conversation = repository.create_conversation(user_a, "Live smoke thread")
    conversation_id = str(conversation["id"])
    check("create returns a row with an id", bool(conversation_id))
    check("title round-trips", conversation.get("title") == "Live smoke thread")
    check("turn_count starts at zero", conversation.get("turn_count") == 0)

    listed = repository.list_conversations(user_a)
    check("appears in the owner's list", any(str(c["id"]) == conversation_id for c in listed))

    print("turns, including a thread that spans two syllabuses")
    first = repository.append_turn(
        user_id=user_a,
        conversation_id=conversation_id,
        role="user",
        content="How do I start?",
        question=QUESTION_A,
    )
    second = repository.append_turn(
        user_id=user_a,
        conversation_id=conversation_id,
        role="assistant",
        content="Begin by differentiating.",
        modes=["explain"],
        question=QUESTION_A,
    )
    third = repository.append_turn(
        user_id=user_a,
        conversation_id=conversation_id,
        role="user",
        content="Stuck the same way on this one.",
        question=QUESTION_B,
    )
    check("sort_order increments", [first["sort_order"], second["sort_order"], third["sort_order"]] == [0, 1, 2])

    turns = repository.get_conversation_turns(user_a, conversation_id)
    check("all three turns read back", len(turns) == 3, f"got {len(turns)}")
    check("turns come back in order", [t["sort_order"] for t in turns] == [0, 1, 2])
    check("modes round-trip", turns[1].get("modes") == ["explain"])
    check(
        "each turn keeps its own question",
        turns[0]["syllabus_code"] == "9709" and turns[2]["syllabus_code"] == "0606",
        f'{turns[0]["syllabus_code"]} / {turns[2]["syllabus_code"]}',
    )

    refreshed = repository.get_conversation(user_a, conversation_id)
    check("turn_count was refreshed", refreshed.get("turn_count") == 3, str(refreshed.get("turn_count")))
    check(
        "last_question reflects the most recent turn",
        (refreshed.get("last_question") or {}).get("syllabus_code") == "0606",
        str(refreshed.get("last_question")),
    )

    print("isolation between two students")
    check("another user cannot read the thread", repository.get_conversation(user_b, conversation_id) is None)
    check("another user sees no turns", repository.get_conversation_turns(user_b, conversation_id) == [])
    check("another user cannot rename it", repository.rename_conversation(user_b, conversation_id, "hijacked") is None)
    check("another user cannot delete it", repository.delete_conversation(user_b, conversation_id) is False)
    check("the thread is untouched", repository.get_conversation(user_a, conversation_id) is not None)

    print("attempts")
    attempt = repository.record_attempt(
        user_id=user_a,
        question=QUESTION_A,
        attempt_text="dy/dx = 2x + 3",
        mode="check",
        conversation_turn_id=str(first["id"]),
    )
    check("an attempt with no outcome stores", attempt is not None)
    check("it is marked unavailable", (attempt or {}).get("outcome_source") == "unavailable")

    marked = repository.record_attempt(
        user_id=user_a,
        question=QUESTION_A,
        attempt_text="dy/dx = 2x + 3, so x = -1.5",
        mode="check",
        conversation_turn_id=str(third["id"]),
        outcome={
            "marks_earned": 2,
            "marks_available": 5,
            "earned_codes": ["M1", "A1"],
            "missed_codes": ["B1"],
            "model": "gpt-5.4-nano",
            "confidence": 0.8,
        },
    )
    check("an attempt with an outcome stores", marked is not None)
    check("marks round-trip", (marked or {}).get("marks_earned") == 2)
    check("earned codes round-trip", (marked or {}).get("earned_codes") == ["M1", "A1"])

    print("rename, delete, and what survives")
    renamed = repository.rename_conversation(user_a, conversation_id, "Renamed thread")
    check("rename works for the owner", (renamed or {}).get("title") == "Renamed thread")
    cleared = repository.rename_conversation(user_a, conversation_id, None)
    check("a thread can be returned to unnamed", (cleared or {}).get("title") is None)

    check("delete works for the owner", repository.delete_conversation(user_a, conversation_id) is True)
    check("a deleted thread is gone from the list", repository.get_conversation(user_a, conversation_id) is None)
    check("deleting twice is not an error", repository.delete_conversation(user_a, conversation_id) is False)

    # The decision that cannot be undone later: marks outlive the conversation.
    client = _client()
    surviving = (
        client.table("shamo_attempts")
        .select("id,conversation_turn_id,marks_earned")
        .eq("user_id", user_a)
        .execute()
    ).data or []
    check("both attempts survived the delete", len(surviving) == 2, f"got {len(surviving)}")
    check(
        "their turn links were nulled, not orphaned",
        all(row.get("conversation_turn_id") is None for row in surviving),
    )
    check("the marks themselves are intact", sorted(
        (row.get("marks_earned") or 0) for row in surviving
    ) == [0, 2])

    print("cleanup")
    client.table("shamo_attempts").delete().eq("user_id", user_a).execute()
    client.table("shamo_conversations").delete().eq("user_id", user_a).execute()
    left = (
        client.table("shamo_conversations").select("id", count="exact").eq("user_id", user_a).execute()
    ).count
    attempts_left = (
        client.table("shamo_attempts").select("id", count="exact").eq("user_id", user_a).execute()
    ).count
    check("no rows left behind", left == 0 and attempts_left == 0, f"{left} conversations, {attempts_left} attempts")

    print()
    if failures:
        print(f"{len(failures)} FAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("all live persistence checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
