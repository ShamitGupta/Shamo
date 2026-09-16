"""The sample class the teacher dashboard is demonstrated on.

An empty roster demonstrates nothing, and the only real accounts in this
database belong to the founder. So this seeds six invented students with
plausible practice histories.

Two rules make that safe rather than reckless:

  * EVERY ROW IS MARKED. Each account's email carries DEMO_MARKER and its
    profile has is_sample = true, which the roster returns and the dashboard
    renders as a badge. Fabricated students shown to a grant reviewer must never
    read as real children -- that is a misrepresentation, not a rough edge.
  * TEARDOWN IS ONE COMMAND AND IT VERIFIES. Deletion is by marker, so an
    interrupted run is always recoverable, and it asserts zero remain rather
    than assuming the cascade fired.

Unlike sprint_fixtures.py, this cohort is DELIBERATELY LEFT IN PLACE after the
sprint -- the dashboard has to be showable on short notice. It is not permanent:
PENDING.md carries its removal as a named task, to be run before a real cohort
joins. Until then, every usage figure this project quotes must exclude it.

    python backend_v2/tests/demo_cohort.py create     # seed (idempotent)
    python backend_v2/tests/demo_cohort.py status
    python backend_v2/tests/demo_cohort.py teardown   # delete, and prove it

No model is called and no paid API is touched: attempts are written straight to
the table. Only real published questions are referenced, so every seeded row
resolves to a genuine topic through the same joins a real attempt would use.
"""

from __future__ import annotations

import os
import random
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent))

DEMO_MARKER = "shamo-demo-student"
OWNED_TABLES = ("shamo_attempts", "shamo_conversation_turns", "shamo_conversations")

# A class is not six identical students. Each profile names the topics they have
# been working on and roughly how they are scoring, so the roster shows a real
# spread -- someone struggling, someone strong, someone who has barely started --
# rather than six rows of the same number.
#
# `ratio` is the target mark ratio; actual marks are drawn around it, because a
# student who scores exactly 40% on every question looks synthetic at a glance.
COHORT = (
    {
        "slug": "aisha",
        "name": "Aisha R.",
        "grade": "A-levels",
        "topics": {"Calculus": 0.32, "Trigonometry": 0.45, "Series": 0.70},
        "attempts": 11,
    },
    {
        "slug": "ben",
        "name": "Ben O.",
        "grade": "A-levels",
        "topics": {"Vectors": 0.28, "Calculus": 0.55, "Coordinate Geometry": 0.62},
        "attempts": 9,
    },
    {
        "slug": "chen",
        "name": "Chen W.",
        "grade": "A-levels",
        "topics": {"Probability": 0.80, "Series": 0.76, "Calculus": 0.71},
        "attempts": 12,
    },
    {
        "slug": "dami",
        "name": "Dami A.",
        "grade": "IGCSE",
        "topics": {"Algebra": 0.38, "Trigonometry": 0.41},
        "attempts": 8,
    },
    {
        "slug": "elif",
        "name": "Elif K.",
        "grade": "IGCSE",
        "topics": {"Exponential and Logarithmic Functions": 0.52, "Algebra": 0.66},
        "attempts": 7,
    },
    {
        # Deliberately thin. A roster where everyone has enough evidence hides
        # the case a teacher most needs to recognise: a student who has barely
        # used it. Two attempts is below the weak-topic threshold, so this
        # student's weakest topic is correctly blank rather than invented.
        "slug": "farah",
        "name": "Farah S.",
        "grade": "IGCSE",
        "topics": {"Kinematics": 0.50},
        "attempts": 2,
    },
)

SAMPLE_WORKING = (
    "Differentiated to get dy/dx = 3x^2 - 4x, then set it to zero.",
    "Used the sine rule first, then rearranged for the angle.",
    "Expanded the bracket and collected like terms before substituting.",
    "Found the common ratio, then applied the sum to infinity formula.",
    "Resolved into components and used Pythagoras for the magnitude.",
    "Integrated between the limits but I think I mixed up the order.",
)

SAMPLE_MESSAGES = (
    "I'm stuck on the second part of this one.",
    "Can you check my working please?",
    "Why does the mark scheme use that substitution?",
)


def _load_env() -> None:
    from dotenv import load_dotenv

    load_dotenv(HERE.parent / ".env")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        load_dotenv(ROOT / "workflows" / "n8n" / "harness" / ".env")
    os.environ.setdefault("OPENAI_API_KEY", "not-needed-for-fixtures")


_load_env()


def _use_system_trust_store() -> None:
    """Windows' bundled Python cannot verify Supabase's chain on its own."""
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:  # pragma: no cover - other platforms verify fine
        pass


_use_system_trust_store()

from supabase import create_client  # noqa: E402


def _client():
    return create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )


def _email(slug: str) -> str:
    return f"{DEMO_MARKER}-{slug}@example.com"


def _find_demo_users(client) -> list[dict]:
    found: list[dict] = []
    page = 1
    while True:
        users = client.auth.admin.list_users(page=page, per_page=200)
        if not users:
            break
        for user in users:
            email = (getattr(user, "email", "") or "").lower()
            if DEMO_MARKER in email:
                found.append({"id": str(user.id), "email": email})
        if len(users) < 200:
            break
        page += 1
    return found


def _questions_by_topic(client, topics: set[str]) -> dict[str, list[dict]]:
    """Real published questions per topic, so seeded attempts resolve properly.

    An attempt pointing at an invented question would join to no metadata, the
    topic ranking would silently skip it, and the dashboard would show fewer
    attempts than the roster counted.
    """
    metadata = (
        client.table("shamo_question_metadata")
        .select("question_id,main_topic")
        .in_("main_topic", sorted(topics))
        .limit(2000)
        .execute()
    ).data or []

    topic_by_question = {row["question_id"]: row["main_topic"] for row in metadata}
    if not topic_by_question:
        raise SystemExit("No published questions found for the requested topics.")

    by_topic: dict[str, list[dict]] = {topic: [] for topic in topics}
    ids = list(topic_by_question)
    for start in range(0, len(ids), 200):
        chunk = ids[start : start + 200]
        rows = (
            client.table("shamo_published_question_overview")
            .select(
                "question_id,qualification,syllabus_code,year,exam_session,"
                "paper_variant,question_number,total_marks"
            )
            .in_("question_id", chunk)
            .execute()
        ).data or []
        for row in rows:
            marks = row.get("total_marks")
            if not marks or marks < 3 or marks > 12:
                continue
            by_topic[topic_by_question[row["question_id"]]].append(row)

    missing = [topic for topic, rows in by_topic.items() if not rows]
    if missing:
        raise SystemExit(f"No usable published questions for: {', '.join(missing)}")
    return by_topic


def _marks_for(rng: random.Random, total: int, ratio: float) -> tuple[int, int]:
    """Marks around a target ratio, never outside what the question is worth."""
    target = total * ratio
    jitter = rng.uniform(-0.18, 0.18) * total
    earned = int(round(max(0, min(total, target + jitter))))
    return earned, total


def _seed_attempts(client, user_id: str, profile: dict, by_topic: dict, rng: random.Random) -> int:
    now = datetime.now(timezone.utc)
    topics = list(profile["topics"])
    written = 0

    for index in range(profile["attempts"]):
        topic = topics[index % len(topics)]
        question = rng.choice(by_topic[topic])
        earned, available = _marks_for(rng, int(question["total_marks"]), profile["topics"][topic])
        # Spread backwards over about five weeks so "last active" and any future
        # recency weighting have something real to work with.
        created = now - timedelta(
            days=rng.randint(0, 34), hours=rng.randint(0, 23), minutes=rng.randint(0, 59)
        )
        client.table("shamo_attempts").insert(
            {
                "user_id": user_id,
                "question_id": question["question_id"],
                "qualification": question["qualification"],
                "syllabus_code": question["syllabus_code"],
                "year": question["year"],
                "exam_session": question["exam_session"],
                "paper_variant": question["paper_variant"],
                "question_number": question["question_number"],
                "part_label": rng.choice([None, "(a)", "(b)", "(b)(i)"]),
                "attempt_text": rng.choice(SAMPLE_WORKING),
                "mode": "check",
                "marks_earned": earned,
                "marks_available": available,
                "earned_codes": ["M1"] if earned else [],
                "missed_codes": ["A1"] if earned < available else [],
                "outcome_source": "extractor",
                "extractor_model": "demo-seed",
                "extractor_confidence": 0.9,
                "created_at": created.isoformat(),
            }
        ).execute()
        written += 1
    return written


def _seed_conversations(client, user_id: str, profile: dict, rng: random.Random) -> int:
    """A couple of threads, so the usage columns are not all zero.

    The content here is throwaway because no teacher can read it -- the roster
    counts threads and turns and never selects their text.
    """
    now = datetime.now(timezone.utc)
    threads = 1 if profile["attempts"] < 4 else 2
    for index in range(threads):
        last_active = now - timedelta(days=rng.randint(0, 10))
        conversation = (
            client.table("shamo_conversations")
            .insert(
                {
                    "user_id": user_id,
                    "title": f"{list(profile['topics'])[index % len(profile['topics'])]} practice",
                    "last_active_at": last_active.isoformat(),
                }
            )
            .execute()
        ).data[0]

        for turn_index in range(4):
            client.table("shamo_conversation_turns").insert(
                {
                    "conversation_id": conversation["id"],
                    "user_id": user_id,
                    "role": "user" if turn_index % 2 == 0 else "assistant",
                    "content": rng.choice(SAMPLE_MESSAGES)
                    if turn_index % 2 == 0
                    else "Start by identifying which rule applies here.",
                    "modes": [] if turn_index % 2 == 0 else ["hint"],
                    "sort_order": turn_index,
                }
            ).execute()
    return threads


def create() -> int:
    client = _client()
    rng = random.Random(20260916)  # Reproducible: the same demo every time.

    existing = {user["email"] for user in _find_demo_users(client)}
    by_topic = _questions_by_topic(
        client, {topic for profile in COHORT for topic in profile["topics"]}
    )

    for profile in COHORT:
        email = _email(profile["slug"])
        if email in existing:
            print(f"exists   {email}")
            continue

        created = client.auth.admin.create_user(
            {
                "email": email,
                "password": secrets.token_urlsafe(24),
                "email_confirm": True,
                "user_metadata": {
                    "display_name": profile["name"],
                    "grade": profile["grade"],
                },
            }
        )
        user_id = str(created.user.id)

        # The signup trigger creates the profile row; mark it as sample. This
        # column is not writable from the browser (v2.10), so only this script
        # and the backend can set it.
        client.table("shamo_profiles").update({"is_sample": True}).eq(
            "user_id", user_id
        ).execute()

        attempts = _seed_attempts(client, user_id, profile, by_topic, rng)
        threads = _seed_conversations(client, user_id, profile, rng)
        print(f"created  {email}  {user_id}  attempts={attempts} threads={threads}")

    return status()


def status() -> int:
    client = _client()
    users = _find_demo_users(client)
    if not users:
        print("no demo students present")
        return 0

    for user in users:
        counts = []
        for table in OWNED_TABLES:
            response = (
                client.table(table)
                .select("id", count="exact")
                .eq("user_id", user["id"])
                .limit(1)
                .execute()
            )
            counts.append(f"{table.replace('shamo_', '')}={response.count}")
        profile = (
            client.table("shamo_profiles")
            .select("display_name,is_sample")
            .eq("user_id", user["id"])
            .limit(1)
            .execute()
        ).data
        marked = profile[0]["is_sample"] if profile else None
        flag = "MARKED" if marked else "*** NOT MARKED ***"
        print(f"{user['email']}  {flag}  " + "  ".join(counts))

    unmarked = [
        user
        for user in users
        if not (
            client.table("shamo_profiles")
            .select("is_sample")
            .eq("user_id", user["id"])
            .limit(1)
            .execute()
        ).data[0]["is_sample"]
    ]
    if unmarked:
        print(f"FAILED: {len(unmarked)} demo students are not marked as sample data")
        return 1
    print(f"{len(users)} demo students, all marked as sample data")
    return 0


def teardown() -> int:
    client = _client()
    users = _find_demo_users(client)
    if not users:
        print("nothing to tear down")
        return 0

    for user in users:
        # Explicit deletes before the cascade, then an assertion. A cascade that
        # silently did not fire would leave invented rows in a production table
        # looking exactly like real student data.
        for table in OWNED_TABLES:
            client.table(table).delete().eq("user_id", user["id"]).execute()
        client.auth.admin.delete_user(user["id"])
        print(f"deleted  {user['email']}  {user['id']}")

    remaining = _find_demo_users(client)
    if remaining:
        print(f"FAILED: {len(remaining)} demo students still present")
        return 1

    still_marked = (
        client.table("shamo_profiles")
        .select("user_id", count="exact")
        .eq("is_sample", True)
        .limit(1)
        .execute()
    ).count
    print(f"profiles still marked is_sample: {still_marked}")
    if still_marked:
        print("teardown INCOMPLETE: a sample-marked profile survives")
        return 1
    print("teardown verified")
    return 0


COMMANDS = {"create": create, "status": status, "teardown": teardown}

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command not in COMMANDS:
        print(f"usage: {Path(__file__).name} [{'|'.join(COMMANDS)}]")
        raise SystemExit(2)
    raise SystemExit(COMMANDS[command]())
