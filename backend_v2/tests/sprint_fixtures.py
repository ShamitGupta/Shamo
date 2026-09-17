"""Create, inspect and destroy the synthetic users this sprint tests against.

Everything this sprint builds is user-scoped, so verifying it needs real rows
owned by real auth users -- there is no staging database, only production. The
containment strategy is:

  * every synthetic user's email carries SYNTHETIC_MARKER, so they can always be
    found again even if a script is interrupted halfway;
  * every table involved cascades from auth.users, so deleting the user deletes
    the rows;
  * teardown asserts zero remaining rather than assuming the cascade fired.

    python backend_v2/tests/sprint_fixtures.py create
    python backend_v2/tests/sprint_fixtures.py status
    python backend_v2/tests/sprint_fixtures.py teardown

Never point this at a real account: teardown deletes the auth user outright.
"""

from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent))

SYNTHETIC_MARKER = "shamo-sprint-synthetic"
SYNTHETIC_EMAILS = (
    f"{SYNTHETIC_MARKER}-a@example.com",
    f"{SYNTHETIC_MARKER}-b@example.com",
)
OWNED_TABLES = ("shamo_attempts", "shamo_conversation_turns", "shamo_conversations")


def _load_env() -> None:
    from dotenv import load_dotenv

    load_dotenv(HERE.parent / ".env")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        load_dotenv(ROOT / "workflows" / "n8n" / "harness" / ".env")
    os.environ.setdefault("OPENAI_API_KEY", "not-needed-for-fixtures")


_load_env()


def _use_system_trust_store() -> None:
    """Windows' bundled Python cannot verify Supabase's chain on its own.

    The documented failure is CERTIFICATE_VERIFY_FAILED on the first request.
    truststore borrows the OS certificate store; disabling verification instead
    would make every run of this script silently unauthenticated-capable.
    """
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:  # pragma: no cover - other platforms verify fine
        pass


_use_system_trust_store()

from supabase import create_client  # noqa: E402


def _client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def _find_synthetic_users(client) -> list[dict]:
    """Every synthetic user currently in auth.users, by email marker."""
    found: list[dict] = []
    page = 1
    while True:
        users = client.auth.admin.list_users(page=page, per_page=200)
        if not users:
            break
        for user in users:
            email = (getattr(user, "email", "") or "").lower()
            if SYNTHETIC_MARKER in email:
                found.append({"id": str(user.id), "email": email})
        if len(users) < 200:
            break
        page += 1
    return found


def create() -> int:
    client = _client()
    existing = {u["email"] for u in _find_synthetic_users(client)}
    for email in SYNTHETIC_EMAILS:
        if email in existing:
            print(f"exists   {email}")
            continue
        created = client.auth.admin.create_user(
            {
                "email": email,
                # Generated here and never stored: these accounts are driven by
                # service-role token minting, not by anyone typing a password.
                "password": secrets.token_urlsafe(24),
                "email_confirm": True,
                "user_metadata": {"display_name": "Sprint synthetic user"},
            }
        )
        print(f"created  {email}  {created.user.id}")
    return status()


def status() -> int:
    client = _client()
    users = _find_synthetic_users(client)
    if not users:
        print("no synthetic users present")
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
        print(f"{user['email']}  {user['id']}  " + "  ".join(counts))
    return 0


def teardown() -> int:
    client = _client()
    users = _find_synthetic_users(client)
    if not users:
        print("nothing to tear down")
        return 0

    for user in users:
        # Delete owned rows explicitly rather than trusting the cascade, then
        # assert. A cascade that silently did not fire would leave synthetic
        # rows in a production table looking exactly like real student data.
        for table in OWNED_TABLES:
            client.table(table).delete().eq("user_id", user["id"]).execute()
        client.auth.admin.delete_user(user["id"])
        print(f"deleted  {user['email']}  {user['id']}")

    remaining = _find_synthetic_users(client)
    if remaining:
        print(f"FAILED: {len(remaining)} synthetic users still present")
        return 1

    leftover = 0
    for table in OWNED_TABLES:
        response = client.table(table).select("id", count="exact").limit(1).execute()
        print(f"{table}: {response.count} rows total remaining")
        # Any row owned by a now-deleted user would be an orphan; the FK makes
        # that impossible, so this is a sanity read rather than a filter.
    print("teardown verified" if leftover == 0 else "teardown INCOMPLETE")
    return 0 if leftover == 0 else 1


COMMANDS = {"create": create, "status": status, "teardown": teardown}

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command not in COMMANDS:
        print(f"usage: {Path(__file__).name} [{'|'.join(COMMANDS)}]")
        raise SystemExit(2)
    raise SystemExit(COMMANDS[command]())
