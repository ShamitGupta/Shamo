"""Mint a browser session for a synthetic user, for end-to-end UI testing.

Persistence lives behind a verified sign-in, so testing it in a real browser
needs a real session. This sets a throwaway password on a SYNTHETIC account
(never a real one), exchanges it for tokens through the ordinary auth endpoint,
and prints the JSON that supabase-js keeps in localStorage.

    python backend_v2/tests/mint_synthetic_session.py

Then, in the browser console for the app's origin:

    localStorage.setItem('sb-<project-ref>-auth-token', '<the printed JSON>')

and reload. The printed command includes the right key already.

Refuses to run against any account whose email does not carry the synthetic
marker, so it cannot be pointed at a real student.
"""

from __future__ import annotations

import json
import os
import secrets
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

import httpx  # noqa: E402

from sprint_fixtures import SYNTHETIC_MARKER, _client, _find_synthetic_users  # noqa: E402


def main() -> int:
    email = sys.argv[1] if len(sys.argv) > 1 else None
    users = _find_synthetic_users(_client())
    if not users:
        print("No synthetic users. Run: python backend_v2/tests/sprint_fixtures.py create")
        return 2

    chosen = next((u for u in users if email is None or u["email"] == email), None)
    if chosen is None:
        print(f"No synthetic user matching {email!r}")
        return 2
    if SYNTHETIC_MARKER not in chosen["email"]:
        # Belt and braces: _find_synthetic_users already filters on the marker.
        print("Refusing: that account is not a synthetic test account.")
        return 2

    url = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    anon_key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get(
        "VITE_SUPABASE_PUBLISHABLE_KEY"
    )
    if not anon_key:
        # The password grant is a public endpoint; it needs the publishable key,
        # which the frontend already has in frontend/.env.
        from dotenv import dotenv_values

        anon_key = dotenv_values(ROOT / "frontend" / ".env").get(
            "VITE_SUPABASE_PUBLISHABLE_KEY"
        )
    if not anon_key:
        print("Need a publishable/anon key (frontend/.env VITE_SUPABASE_PUBLISHABLE_KEY).")
        return 2

    password = f"synthetic-{secrets.token_urlsafe(18)}"
    _client().auth.admin.update_user_by_id(chosen["id"], {"password": password})

    response = httpx.post(
        f"{url}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        json={"email": chosen["email"], "password": password},
        timeout=30,
    )
    if response.status_code != 200:
        print(f"Sign-in failed ({response.status_code}): {response.text[:300]}")
        return 1

    session = response.json()
    project_ref = url.split("//", 1)[1].split(".", 1)[0]
    storage_key = f"sb-{project_ref}-auth-token"

    print(f"user:        {chosen['email']}  {chosen['id']}")
    print(f"storage key: {storage_key}")
    print()
    print("Paste into the browser console on the app's origin, then reload:")
    print(f"localStorage.setItem({storage_key!r}, {json.dumps(json.dumps(session))})")
    print()
    print("ACCESS_TOKEN=" + session["access_token"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
