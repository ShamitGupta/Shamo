"""Supabase session verification for protected tutor endpoints."""

from __future__ import annotations

from dataclasses import dataclass

from supabase import Client, create_client

from .config import Settings


class AuthError(RuntimeError):
    """The request did not carry a valid Supabase user session."""


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    email: str | None
    email_confirmed: bool


class AuthService:
    def __init__(self, settings: Settings, client: Client | None = None) -> None:
        self._client = client or create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    def get_user(self, access_token: str) -> AuthenticatedUser:
        try:
            response = self._client.auth.get_user(access_token)
        except Exception as error:  # noqa: BLE001 - exposed as a 401 upstream
            raise AuthError("Invalid or expired session.") from error

        user = getattr(response, "user", None)
        if user is None:
            raise AuthError("Invalid or expired session.")

        user_id = str(getattr(user, "id", "") or "")
        if not user_id:
            raise AuthError("Invalid or expired session.")

        email = getattr(user, "email", None)
        email_confirmed = bool(
            getattr(user, "email_confirmed_at", None)
            or getattr(user, "confirmed_at", None)
        )
        return AuthenticatedUser(
            user_id=user_id,
            email=str(email) if email else None,
            email_confirmed=email_confirmed,
        )
