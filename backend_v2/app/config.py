"""Configuration, read once at import and validated loudly.

Credentials live in the environment or in backend_v2/.env, never in the repo.
The service-role key is required because the normalized `shamo_*` tables have
RLS enabled with no anon or authenticated policies -- the browser genuinely
cannot read them, and that is deliberate. It follows that this key must never
reach the client, which is the reason this service exists at all rather than
the frontend talking to Supabase directly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


class ConfigError(RuntimeError):
    """Raised at startup when a required setting is missing."""


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigError(
            f"{name} is not set. Copy backend_v2/.env.example to backend_v2/.env "
            "and fill it in. Never commit that file."
        )
    return value


def _csv(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    openai_api_key: str

    # Qualification and syllabus are pinned rather than accepted from the
    # request. The corpus holds exactly one syllabus, and letting a caller vary
    # them would invite lookups for content that cannot exist.
    qualification: str = "a_level"
    syllabus_code: str = "9709"

    tutor_model: str = "gpt-5.4-mini"
    # Diagrams live in a private bucket. Links are signed per request and expire;
    # ten minutes is long enough to read a question and short enough that a
    # leaked URL is worthless.
    asset_url_ttl_seconds: int = 600
    max_history_messages: int = 12

    allowed_origins: list[str] = field(default_factory=list)

    @classmethod
    def load(cls) -> "Settings":
        return cls(
            supabase_url=_required("SUPABASE_URL"),
            supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
            openai_api_key=_required("OPENAI_API_KEY"),
            qualification=os.getenv("SHAMO_QUALIFICATION", "a_level"),
            syllabus_code=os.getenv("SHAMO_SYLLABUS_CODE", "9709"),
            tutor_model=os.getenv("SHAMO_TUTOR_MODEL", "gpt-5.4-mini"),
            asset_url_ttl_seconds=int(os.getenv("SHAMO_ASSET_URL_TTL", "600")),
            max_history_messages=int(os.getenv("SHAMO_MAX_HISTORY", "12")),
            # No wildcard default. The legacy service allows every origin, which
            # is fine for an unauthenticated prototype and will not be once this
            # one carries student data.
            allowed_origins=_csv(
                "SHAMO_ALLOWED_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ),
        )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings.load()
    return _settings
