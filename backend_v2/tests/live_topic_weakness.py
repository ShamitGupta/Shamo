"""Seed known attempts for a synthetic student, then check the ranking is right.

The ranking is arithmetic over stored rows, so it can be verified exactly: this
seeds attempts whose per-topic totals are decided here, computes the expected
order independently, and compares. If the two ever disagree, one of them is
wrong and both are worth reading.

What this DOES prove: the aggregation, the ordering, the evidence threshold,
the handling of unscored attempts, and per-user isolation.

What it does NOT prove: that mark ratio is the right definition of "weak" for a
real student. That is a teaching judgement and needs real attempt data, not
seeded numbers. Do not let a green run here be mistaken for that.

    python backend_v2/tests/sprint_fixtures.py create
    python backend_v2/tests/live_topic_weakness.py

Seeds and removes its own rows, against SYNTHETIC users only.
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
    os.environ.setdefault("OPENAI_API_KEY", "not-needed")


def _use_system_trust_store() -> None:
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:  # pragma: no cover
        pass


_load_env()
_use_system_trust_store()

from sprint_fixtures import SYNTHETIC_EMAILS, _client, _find_synthetic_users  # noqa: E402

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {label}")
    else:
        failures.append(f"{label}{': ' + detail if detail else ''}")
        print(f"  FAIL  {label}{': ' + detail if detail else ''}")


# topic -> (marks_earned, marks_available) per attempt. Chosen so the expected
# order is unambiguous and the threshold case is decisive.
PLAN = {
    # Weakest with enough evidence. Must come first.
    "Calculus": [(1, 5), (0, 5), (2, 5), (1, 5), (1, 5)],          # 5/25  = 0.20
    "Trigonometry": [(3, 5), (4, 5), (2, 5), (3, 5)],              # 12/20 = 0.60
    "Series": [(5, 6), (5, 6), (5, 6)],                            # 15/18 = 0.833
    # A single disastrous attempt. Ratio 0.0 -- the WORST possible -- but one
    # question is not a weakness, so it must NOT outrank Calculus.
    "Complex Numbers": [(0, 5)],
    # Attempted but never scored: real engagement, no performance signal.
    "Kinematics": [None, None],
}
MIN_ATTEMPTS = 3


def main() -> int:
    client = _client()
    users = {u["email"]: u["id"] for u in _find_synthetic_users(client)}
    if SYNTHETIC_EMAILS[0] not in users:
        print("Run: python backend_v2/tests/sprint_fixtures.py create")
        return 2
    student = users[SYNTHETIC_EMAILS[0]]
    other = users.get(SYNTHETIC_EMAILS[1])

    # Real published questions, so main_topic resolves through real metadata.
    print("seeding")
    rows: list[dict] = []
    for topic, attempts in PLAN.items():
        found = client.rpc(
            "shamo_get_topic_weakness", {"p_user_id": student}
        )  # touch the function early so a signature error surfaces here
        del found
        picked = (
            client.table("shamo_question_metadata")
            .select("question_id")
            .eq("main_topic", topic)
            .limit(len(attempts))
            .execute()
        ).data or []
        if len(picked) < len(attempts):
            print(f"  not enough {topic} questions ({len(picked)})")
            return 2
        for question_row, marks in zip(picked, attempts):
            question_id = question_row["question_id"]
            identity = (
                client.table("shamo_questions")
                .select("question_number, paper_id")
                .eq("id", question_id)
                .single()
                .execute()
            ).data
            paper = (
                client.table("shamo_papers")
                .select("qualification, syllabus_code, year, exam_session, paper_variant")
                .eq("id", identity["paper_id"])
                .single()
                .execute()
            ).data
            row = {
                "user_id": student,
                "question_id": question_id,
                "question_number": identity["question_number"],
                "attempt_text": f"seeded attempt for {topic}",
                "mode": "check",
                **paper,
            }
            if marks is None:
                row["outcome_source"] = "unavailable"
            else:
                earned, available = marks
                row.update(
                    {
                        "outcome_source": "extractor",
                        "marks_earned": earned,
                        "marks_available": available,
                        "extractor_model": "seeded",
                    }
                )
            rows.append(row)
    client.table("shamo_attempts").insert(rows).execute()
    print(f"  seeded {len(rows)} attempts across {len(PLAN)} topics")

    print("ranking")
    result = client.rpc(
        "shamo_get_topic_weakness",
        {"p_user_id": student, "p_min_attempts": MIN_ATTEMPTS},
    ).execute()
    ranked = result.data or []
    by_topic = {row["main_topic"]: row for row in ranked}

    for row in ranked:
        ratio = row["mark_ratio"]
        ratio_text = f"{float(ratio):.3f}" if ratio is not None else "  --  "
        print(
            f"    {row['main_topic']:<20} ratio {ratio_text}  "
            f"{row['marks_earned']}/{row['marks_available']} marks  "
            f"{row['scored_attempts']}/{row['attempts']} scored  "
            f"evidence={row['has_enough_evidence']}  "
            f"{','.join(row['syllabus_codes'])}"
        )

    # -- independently computed expectations --------------------------------
    expected_ratio = {}
    for topic, attempts in PLAN.items():
        scored = [m for m in attempts if m is not None]
        if not scored:
            expected_ratio[topic] = None
            continue
        earned = sum(m[0] for m in scored)
        available = sum(m[1] for m in scored)
        expected_ratio[topic] = round(earned / available, 4)

    for topic, expected in expected_ratio.items():
        row = by_topic.get(topic)
        if row is None:
            check(f"{topic} present", False, "missing from the ranking")
            continue
        actual = float(row["mark_ratio"]) if row["mark_ratio"] is not None else None
        check(
            f"{topic} ratio is {expected}",
            (actual is None and expected is None) or (actual == expected),
            f"got {actual}",
        )

    # The check that was missing the first time this ran. Trigonometry appeared
    # TWICE -- once per syllabus -- and the lookup above silently kept only the
    # last row, so the ratio assertions passed on a fragment of the evidence.
    topic_names = [r["main_topic"] for r in ranked]
    check(
        "each topic appears exactly once",
        len(topic_names) == len(set(topic_names)),
        f"duplicates in {topic_names}",
    )
    check(
        "a topic spanning two syllabuses stays one topic",
        sorted(by_topic["Trigonometry"]["syllabus_codes"]) in (["9709"], ["0606", "9709"]),
        str(by_topic["Trigonometry"]["syllabus_codes"]),
    )

    with_evidence = [r["main_topic"] for r in ranked if r["has_enough_evidence"]]
    check(
        "weakest well-evidenced topic ranks first",
        with_evidence[:1] == ["Calculus"],
        f"got {with_evidence[:1]}",
    )
    check(
        "well-evidenced topics are ordered weakest first",
        with_evidence == ["Calculus", "Trigonometry", "Series"],
        f"got {with_evidence}",
    )
    check(
        "a single 0/5 attempt does NOT rank as the weakest topic",
        by_topic["Complex Numbers"]["has_enough_evidence"] is False
        and ranked[0]["main_topic"] != "Complex Numbers",
        f"first row is {ranked[0]['main_topic']}",
    )
    check(
        "unscored attempts count as engagement but carry no ratio",
        by_topic["Kinematics"]["attempts"] == 2
        and by_topic["Kinematics"]["scored_attempts"] == 0
        and by_topic["Kinematics"]["mark_ratio"] is None,
        str(by_topic["Kinematics"]),
    )
    check(
        "every row carries its evidence",
        all(
            r["example_questions"] and len(r["example_questions"]) <= 5
            for r in ranked
        ),
    )
    check(
        "the ratio is never the only thing returned",
        all(
            r["attempts"] and r["last_attempted_at"] and r["marks_available"] is not None
            for r in ranked
        ),
    )

    if other:
        other_rows = client.rpc(
            "shamo_get_topic_weakness", {"p_user_id": other}
        ).execute().data or []
        check("another student sees none of it", other_rows == [], f"got {len(other_rows)} rows")

    print("cleanup")
    client.table("shamo_attempts").delete().eq("user_id", student).execute()
    left = (
        client.table("shamo_attempts")
        .select("id", count="exact")
        .eq("user_id", student)
        .execute()
    ).count
    check("seeded rows removed", left == 0, f"{left} left")

    print()
    if failures:
        print(f"{len(failures)} FAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("topic weakness verified against independently computed expectations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
