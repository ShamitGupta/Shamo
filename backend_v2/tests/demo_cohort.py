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
    python backend_v2/tests/demo_cohort.py recode     # refresh mark codes in place
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
        "weakness": "accuracy",
    },
    {
        "slug": "ben",
        "name": "Ben O.",
        "grade": "A-levels",
        "topics": {"Vectors": 0.28, "Calculus": 0.55, "Coordinate Geometry": 0.62},
        "attempts": 9,
        "weakness": "method",
    },
    {
        "slug": "chen",
        "name": "Chen W.",
        "grade": "A-levels",
        "topics": {"Probability": 0.80, "Series": 0.76, "Calculus": 0.71},
        "attempts": 12,
        "weakness": "mixed",
    },
    {
        "slug": "dami",
        "name": "Dami A.",
        "grade": "IGCSE",
        "topics": {"Algebra": 0.38, "Trigonometry": 0.41},
        "attempts": 8,
        "weakness": "accuracy",
    },
    {
        "slug": "elif",
        "name": "Elif K.",
        "grade": "IGCSE",
        "topics": {"Exponential and Logarithmic Functions": 0.52, "Algebra": 0.66},
        "attempts": 7,
        "weakness": "mixed",
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
        "weakness": "method",
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


def _mark_codes_by_question(client, question_ids: set[str]) -> dict[str, list[str]]:
    """The REAL mark codes each question awards, in the order it awards them.

    The first version of this file wrote `["M1"]` earned and `["A1"]` missed on
    every single attempt. Harmless while nothing read them -- and then the
    method/accuracy panel shipped and the demo class showed a perfect 100%
    method / 0% accuracy split, which is not a finding about anything, it is the
    seeder talking. Sample data has to be plausible or it misleads the person
    being shown it, which is the same rule that makes every demo row wear a
    badge.
    """
    by_question: dict[str, list[str]] = {}
    ids = sorted(question_ids)
    for start in range(0, len(ids), 100):
        rows = (
            client.table("shamo_mark_scheme_items")
            .select("question_id,mark_code,sequence_number,is_alternative_method")
            .in_("question_id", ids[start : start + 100])
            .order("sequence_number")
            .limit(5000)
            .execute()
        ).data or []
        for row in rows:
            # Alternative-method rows are a second route to the SAME marks.
            # Counting them would let one question award its marks twice.
            if row.get("is_alternative_method"):
                continue
            atoms = _atomic_codes(row.get("mark_code") or "")
            if atoms:
                by_question.setdefault(row["question_id"], []).extend(atoms)
    return by_question


def _atomic_codes(raw: str) -> list[str]:
    """One entry per mark the row actually awards.

    normalize_code alone is not enough, and the difference is visible: a mark
    scheme prints "B1 B1" for a row worth two marks, and normalising it gives
    the single string "B1B1" -- a code shape the real pipeline never stores,
    because attempt_outcome.py expands a row into atoms before matching. Seeding
    it would have put a value in the demo data that cannot occur in real data,
    and undercounted that row by one mark in the split.

    Banded codes ("B2,1,0" -- award 2, 1 or 0) are ONE mark award, not three.
    The top value is taken, which is what the row is worth at best.
    """
    from app.attempt_outcome import _ATOM_PATTERN, _BANDED_PATTERN

    text = str(raw or "").upper().replace("*", " ").strip()
    if not text:
        return []

    banded = _BANDED_PATTERN.match(text.replace(" ", ""))
    if banded:
        letter, numbers = banded.group(1), banded.group(2)
        return [f"{letter}{max(int(n) for n in numbers.split(','))}"]

    # Suffixes (FT/CAO/OE/WWW) are dropped: they qualify how a mark is awarded,
    # not which mark it is, and the M/A/B class is all this file needs.
    return [f"{letter}{number}" for letter, number, _ in _ATOM_PATTERN.findall(text)]


# Which marks a student tends to drop. Real classes contain both kinds, and a
# cohort where everyone fails the same way would make the panel look like it
# only has one thing to say.
_EARN_ORDER = {
    # Knows the method, drops the arithmetic: earns M and B before A.
    "accuracy": {"M": 0, "B": 1, "A": 2},
    # Cannot get started, but accurate once they are: earns A and B before M.
    "method": {"A": 0, "B": 1, "M": 2},
}

# What fraction of a student's attempts follow their habit. The rest fall where
# they fall. Tuned by looking at the resulting per-student splits rather than
# picked: at 1.0 the cohort was caricature, at this it reads like a tendency.
_HABIT_STRENGTH = 0.6


def _split_codes(
    rng: random.Random,
    codes: list[str],
    earned_marks: int,
    total_marks: int,
    weakness: str,
) -> tuple[list[str], list[str]]:
    """Divide a question's real codes into earned and missed.

    The COUNT comes from the marks already drawn, so the codes and the score can
    never disagree; only WHICH codes are earned depends on the student's habit.
    """
    if not codes:
        return [], []

    keep = max(0, min(len(codes), round(len(codes) * earned_marks / max(total_marks, 1))))
    order = _EARN_ORDER.get(weakness)
    # The habit applies to SOME of a student's work, not all of it. Applying it
    # to every attempt produced a student earning 94% of their accuracy marks
    # and 4% of their method marks, which is not a student -- an A mark normally
    # depends on the M before it. A typical question carries only three or four
    # codes, so a per-code random term is not enough on its own to break the
    # lean: it has to be possible for a whole attempt to go the other way.
    if order is None or rng.random() > _HABIT_STRENGTH:
        ranked = list(codes)
        rng.shuffle(ranked)
    else:
        ranked = sorted(
            codes,
            key=lambda code: order.get(_code_class(code), 3) + rng.uniform(0, 1.4),
        )
    return sorted(ranked[:keep]), sorted(ranked[keep:])


def _code_class(code: str) -> str:
    """M, A or B -- the same rule shamo_get_mark_code_profile applies in SQL."""
    for character in code.upper():
        if character in "MAB":
            return character
    return "other"


def _seed_attempts(
    client,
    user_id: str,
    profile: dict,
    by_topic: dict,
    codes_by_question: dict,
    rng: random.Random,
) -> int:
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
        earned_codes, missed_codes = _split_codes(
            rng,
            codes_by_question.get(question["question_id"], []),
            earned,
            available,
            profile.get("weakness", "mixed"),
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
                "earned_codes": earned_codes,
                "missed_codes": missed_codes,
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
    codes_by_question = _mark_codes_by_question(
        client,
        {row["question_id"] for rows in by_topic.values() for row in rows},
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

        attempts = _seed_attempts(
            client, user_id, profile, by_topic, codes_by_question, rng
        )
        threads = _seed_conversations(client, user_id, profile, rng)
        print(f"created  {email}  {user_id}  attempts={attempts} threads={threads}")

    return status()


def recode() -> int:
    """Replace the mark codes on existing sample attempts with real ones.

    Exists because the first version of this seeder wrote the same two codes on
    every attempt, and six sample students hold almost every attempt in the
    database -- so the method/accuracy panel would have shown anyone being
    demoed a finding that was really just the seeder. Updating in place rather
    than re-seeding keeps the accounts, their ids and their histories intact.

    It will only touch rows belonging to an account carrying DEMO_MARKER, and it
    re-checks is_sample on each one before writing. Two guards for the same
    thing, because this is the one command here that writes to rows it did not
    create.
    """
    client = _client()
    rng = random.Random(20260916)
    users = _find_demo_users(client)
    if not users:
        print("no demo students present")
        return 0

    by_slug = {profile["slug"]: profile for profile in COHORT}
    updated = 0

    for user in users:
        marked = (
            client.table("shamo_profiles")
            .select("is_sample")
            .eq("user_id", user["id"])
            .limit(1)
            .execute()
        ).data
        if not marked or not marked[0]["is_sample"]:
            print(f"REFUSED  {user['email']} is not marked as sample data")
            return 1

        slug = user["email"].split("@")[0].replace(f"{DEMO_MARKER}-", "")
        weakness = by_slug.get(slug, {}).get("weakness", "mixed")

        attempts = (
            client.table("shamo_attempts")
            .select("id,question_id,marks_earned,marks_available")
            .eq("user_id", user["id"])
            .is_("deleted_at", "null")
            .limit(500)
            .execute()
        ).data or []

        codes_by_question = _mark_codes_by_question(
            client, {row["question_id"] for row in attempts if row.get("question_id")}
        )

        for attempt in attempts:
            earned_codes, missed_codes = _split_codes(
                rng,
                codes_by_question.get(attempt.get("question_id"), []),
                int(attempt.get("marks_earned") or 0),
                int(attempt.get("marks_available") or 1),
                weakness,
            )
            client.table("shamo_attempts").update(
                {"earned_codes": earned_codes, "missed_codes": missed_codes}
            ).eq("id", attempt["id"]).eq("user_id", user["id"]).execute()
            updated += 1

        print(f"recoded  {user['email']}  attempts={len(attempts)}  habit={weakness}")

    print(f"{updated} sample attempts recoded from the real mark schemes")
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

    # The mark codes have to be varied, or the method/accuracy panel shows a
    # pattern that belongs to this script rather than to any student. This check
    # exists because that is exactly what shipped once.
    seen: set[str] = set()
    for user in users:
        rows = (
            client.table("shamo_attempts")
            .select("earned_codes,missed_codes")
            .eq("user_id", user["id"])
            .is_("deleted_at", "null")
            .limit(500)
            .execute()
        ).data or []
        for row in rows:
            seen.update(row.get("earned_codes") or [])
            seen.update(row.get("missed_codes") or [])
    classes = {_code_class(code) for code in seen}
    print(f"distinct mark codes across sample attempts: {len(seen)} in classes {sorted(classes)}")
    if len(classes) < 2:
        print("FAILED: sample attempts carry too few kinds of mark code -- run `recode`")
        return 1
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


COMMANDS = {
    "create": create,
    "status": status,
    "recode": recode,
    "teardown": teardown,
}

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command not in COMMANDS:
        print(f"usage: {Path(__file__).name} [{'|'.join(COMMANDS)}]")
        raise SystemExit(2)
    raise SystemExit(COMMANDS[command]())
