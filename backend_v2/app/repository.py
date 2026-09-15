"""The only module that talks to Supabase.

Everything the tutor knows comes through here, and nothing here calls a language
model. Keeping that boundary sharp is what makes "the tutor cannot answer
without source content" a structural property rather than a promise: the chat
layer is handed a context object or an explicit miss, and has no other way to
learn anything about a paper.

Reads go through `shamo_get_question_context`, the reviewed retrieval function,
rather than through table selects. It already assembles paper identity, stem,
parts, per-part mark rows, assets and source documents in one call, and it only
ever returns published content.
"""

from __future__ import annotations

import logging
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from supabase import Client, create_client

from .config import Settings
from .models import UserTier

logger = logging.getLogger(__name__)


class RetrievalError(RuntimeError):
    """The database could not be reached or returned something unusable."""


@dataclass(frozen=True)
class QuestionContext:
    """A published question and everything needed to teach it."""

    paper: dict[str, Any]
    question: dict[str, Any]
    documents: list[dict[str, Any]]

    @property
    def total_marks(self) -> int | None:
        return self.question.get("total_marks")

    @property
    def parts(self) -> list[dict[str, Any]]:
        return self.question.get("parts") or []

    @property
    def assets(self) -> list[dict[str, Any]]:
        return self.question.get("assets") or []

    def required_assets(self) -> list[dict[str, Any]]:
        return [a for a in self.assets if a.get("required_to_solve")]

    @property
    def question_id(self) -> str | None:
        value = self.question.get("id")
        return str(value) if value else None


class Repository:
    def __init__(self, settings: Settings, client: Client | None = None) -> None:
        self._settings = settings
        self._client = client or create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    # -- catalogue ---------------------------------------------------------

    def list_papers(self) -> list[dict[str, Any]]:
        """Every published paper, with the question numbers it actually holds.

        The selector is built from this rather than from a hardcoded year range.
        The legacy frontend offers years up to 2024 whether or not anything is
        behind them, so a student can pick a paper that does not exist and get a
        confident answer about nothing. Offering only what is published removes
        that failure before it can happen.

        Returns papers across every published qualification/syllabus, each
        tagged with which one it belongs to, rather than filtering to one --
        the corpus now holds both 9709 (a_level) and 0606 (igcse), and the
        frontend groups by subject itself. Grouping below keys on
        (qualification, syllabus_code, year, exam_session, paper_variant),
        not just the last three: paper_variant alone is not globally unique
        across syllabuses (e.g. "2025 Oct/Nov paper 12" exists in both), so
        dropping the syllabus fields from the key would silently merge two
        different papers' question numbers into one entry.
        """
        try:
            response = (
                self._client.table("shamo_published_question_overview")
                .select("qualification,syllabus_code,subject,year,exam_session,paper_variant,question_number")
                .execute()
            )
        except Exception as error:  # noqa: BLE001 - surfaced as 503 upstream
            raise RetrievalError(f"Could not read the paper catalogue: {error}") from error

        grouped: dict[tuple[str, str, int, str, str], dict[str, Any]] = {}
        for row in response.data or []:
            key = (
                row["qualification"],
                row["syllabus_code"],
                row["year"],
                row["exam_session"],
                str(row["paper_variant"]),
            )
            entry = grouped.setdefault(key, {"subject": row.get("subject"), "numbers": set()})
            entry["numbers"].add(int(row["question_number"]))

        papers = [
            {
                "qualification": qualification,
                "syllabus_code": syllabus_code,
                "subject": entry["subject"],
                "year": year,
                "exam_session": session,
                "paper_variant": variant,
                # The first digit of the variant is the Cambridge component, and
                # it decides which papers are comparable. Derived here rather
                # than stored, because it is a property of the identifier.
                "paper_component": variant[0] if variant else "",
                "question_count": len(entry["numbers"]),
                "question_numbers": sorted(entry["numbers"]),
            }
            for (qualification, syllabus_code, year, session, variant), entry in grouped.items()
        ]
        papers.sort(
            key=lambda p: (
                p["qualification"],
                p["syllabus_code"],
                -p["year"],
                p["exam_session"],
                p["paper_variant"],
            )
        )
        return papers

    # -- exact question ----------------------------------------------------

    def get_question_context(
        self,
        year: int,
        exam_session: str,
        paper_variant: str,
        question_number: int,
        *,
        qualification: str = "a_level",
        syllabus_code: str = "9709",
    ) -> QuestionContext | None:
        """Return the question, or None when it is not published.

        None is a real answer here, not an error. Distinguishing "we looked and
        it is not there" from "the lookup failed" matters, because the first
        should tell the student what we do have and the second should not
        pretend the corpus is missing something.

        qualification/syllabus_code default to the corpus's original single
        syllabus (9709) so callers that predate multi-syllabus support keep
        their existing behaviour unchanged.
        """
        try:
            response = self._client.rpc(
                "shamo_get_question_context",
                {
                    "requested_qualification": qualification,
                    "requested_syllabus_code": syllabus_code,
                    "requested_year": year,
                    "requested_exam_session": exam_session,
                    "requested_paper_variant": paper_variant,
                    "requested_question_number": question_number,
                },
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Question lookup failed: {error}") from error

        payload = response.data
        if not payload or not isinstance(payload, dict):
            return None
        question = payload.get("question")
        if not question:
            return None
        # A question with neither stem nor parts carries nothing teachable. The
        # publication checks make this close to impossible, so treating it as a
        # miss is a backstop rather than an expected path.
        if not str(question.get("stem_markdown") or "").strip() and not question.get("parts"):
            logger.warning(
                "Question %s/%s/%s Q%s published with no text",
                year,
                exam_session,
                paper_variant,
                question_number,
            )
            return None

        return QuestionContext(
            paper=payload.get("paper") or {},
            question=question,
            documents=payload.get("documents") or [],
        )

    # -- similar questions -------------------------------------------------

    def get_similar_questions(
        self,
        seed_question_id: str,
        *,
        qualification: str = "a_level",
        syllabus_code: str = "9709",
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        """Rows from shamo_match_similar_questions_for_question, verbatim.

        The function always returns at least one row. When there is nothing to
        recommend it returns a single row whose question_id is null and whose
        result_status says why -- "this component is not ready", "nothing was
        close enough", and "that seed is not published" are three different
        answers and the caller has to be able to tell them apart. So an empty
        recommendation is an ordinary result here, never an exception; only an
        unreachable database is.

        min_similarity is deliberately NOT sent. The 0.60 floor is a measured
        product decision and it lives in the reviewed SQL default, in one
        place, so it cannot drift per caller.
        """
        try:
            response = self._client.rpc(
                "shamo_match_similar_questions_for_question",
                {
                    "requested_seed_question_id": seed_question_id,
                    "requested_limit": limit,
                    "requested_qualification": qualification,
                    "requested_syllabus_code": syllabus_code,
                },
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Similar-question lookup failed: {error}") from error

        rows = response.data
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    # -- private assets ----------------------------------------------------

    def sign_asset(self, bucket: str, path: str) -> str | None:
        """A short-lived link to a diagram in the private bucket.

        Returns None rather than raising: a missing diagram should degrade the
        answer, not fail the request. The tutor is told separately when a
        required diagram could not be shown, so it can say so instead of
        describing a picture the student cannot see.
        """
        try:
            signed = self._client.storage.from_(bucket).create_signed_url(
                path, self._settings.asset_url_ttl_seconds
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("Could not sign asset %s/%s: %s", bucket, path, error)
            return None
        if isinstance(signed, dict):
            return signed.get("signedURL") or signed.get("signedUrl")
        return None

    # -- visual artifact cache --------------------------------------------

    def get_visual_artifact(
        self,
        *,
        context: QuestionContext,
        student_prompt: str,
        visual_spec_version: str,
    ) -> dict[str, Any] | None:
        """Return a previously validated visual spec for this exact prompt.

        The table is additive and may not exist yet in a local database. Cache
        failure should never block tutoring, so read errors are logged and
        treated as a miss.
        """

        question_id = context.question_id
        if not question_id:
            return None

        try:
            response = (
                self._client.table("shamo_visual_artifacts")
                .select(
                    "artifact_kind,visual_spec_version,spec_jsonb,"
                    "message_markdown,fallback_markdown,accessibility_text,"
                    "validation_status"
                )
                .eq("question_id", question_id)
                .eq("student_prompt_hash", _hash_text(student_prompt))
                .eq("visual_spec_version", visual_spec_version)
                .eq("validation_status", "validated")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            logger.info("Visual artifact cache read skipped: %s", error)
            return None

        rows = response.data or []
        if not rows:
            return None
        spec = rows[0].get("spec_jsonb")
        return spec if isinstance(spec, dict) else None

    def store_visual_artifact(
        self,
        *,
        context: QuestionContext,
        student_prompt: str,
        response_payload: dict[str, Any],
        generator_model: str,
        prompt_version: str,
    ) -> None:
        """Store a validated visual spec for reuse.

        This is best-effort: a missing migration, missing question UUID in the
        RPC payload, or transient database error should not fail the student's
        current visualization.
        """

        question_id = context.question_id
        artifacts = response_payload.get("artifacts") or []
        if not question_id or not artifacts:
            return

        first_kind = str(artifacts[0].get("artifact_kind") or "none")
        accessibility_text = "\n\n".join(
            str(artifact.get("accessibility_text") or "").strip()
            for artifact in artifacts
            if str(artifact.get("accessibility_text") or "").strip()
        )
        try:
            self._client.table("shamo_visual_artifacts").insert(
                {
                    "question_id": question_id,
                    "artifact_kind": first_kind,
                    "visual_spec_version": response_payload.get("visual_spec_version"),
                    "student_prompt_hash": _hash_text(student_prompt),
                    "spec_hash": _hash_json(response_payload),
                    "spec_jsonb": response_payload,
                    "message_markdown": response_payload.get("message_markdown"),
                    "fallback_markdown": response_payload.get("fallback_markdown"),
                    "accessibility_text": accessibility_text,
                    "generator_model": generator_model,
                    "prompt_version": prompt_version,
                    "validation_status": response_payload.get("validation_status"),
                }
            ).execute()
        except Exception as error:  # noqa: BLE001
            logger.info("Visual artifact cache write skipped: %s", error)

    # -- generated video (Manim) --------------------------------------------

    def store_visual_video(
        self, *, question_id: str, manim_spec: dict[str, Any], video_path: Path
    ) -> tuple[str, str] | None:
        """Upload a rendered Manim clip and return (storage_path, signed_url).

        storage_path is content-addressed by the manim spec (not by prompt or
        question), so two students asking for the same animation reuse the
        same object instead of rendering and storing it twice. Best-effort
        like sign_asset: a failed upload should degrade the response to a
        text fallback, never raise past the caller.
        """
        bucket = self._settings.generated_media_bucket
        spec_hash = _hash_json(manim_spec)
        storage_path = f"visualize/{question_id}/{spec_hash}.mp4"

        try:
            data = video_path.read_bytes()
            self._client.storage.from_(bucket).upload(
                storage_path, data, {"content-type": "video/mp4", "upsert": "true"}
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("Could not upload generated video %s/%s: %s", bucket, storage_path, error)
            return None

        signed_url = self.sign_asset(bucket, storage_path)
        if not signed_url:
            return None
        return storage_path, signed_url

    def resign_visual_video(self, storage_path: str) -> str | None:
        """Re-sign an already-uploaded generated video from a cached artifact."""
        return self.sign_asset(self._settings.generated_media_bucket, storage_path)

    # -- authenticated user state -----------------------------------------

    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        try:
            response = (
                self._client.table("shamo_profiles")
                .select("user_id,display_name,grade,created_at,updated_at")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read the user profile: {error}") from error

        rows = response.data or []
        return rows[0] if rows else None

    def get_effective_tier(self, user_id: str) -> UserTier:
        """Resolve trusted Shamo product access for a signed-in user.

        Free is not stored. It is the fallback for any authenticated account.
        Entitlements are privileged server-side rows: Shamo Student is manually
        granted by Admin, and Premium is reserved for Stripe-created rows.
        """
        try:
            response = (
                self._client.table("shamo_user_entitlements")
                .select("entitlement_type,status,starts_at,ends_at")
                .eq("user_id", user_id)
                .eq("status", "active")
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read user entitlements: {error}") from error

        active_types = {
            row.get("entitlement_type")
            for row in (response.data or [])
            if _entitlement_is_current(row)
        }
        if UserTier.SHAMO_STUDENT.value in active_types:
            return UserTier.SHAMO_STUDENT
        if UserTier.PREMIUM.value in active_types:
            return UserTier.PREMIUM
        return UserTier.FREE

    def nearest_available(
        self,
        year: int,
        paper_variant: str,
        *,
        qualification: str = "a_level",
        syllabus_code: str = "9709",
    ) -> str | None:
        """A helpful pointer when a lookup misses.

        Purely for the error message. It never changes what is taught. Scoped
        to the requested qualification/syllabus, so a miss on an IGCSE variant
        never suggests an A-level paper that merely happens to share the same
        variant number.
        """
        try:
            papers = self.list_papers()
        except RetrievalError:
            return None
        in_syllabus = [
            p
            for p in papers
            if p["qualification"] == qualification and p["syllabus_code"] == syllabus_code
        ]
        same_variant = [p for p in in_syllabus if p["paper_variant"] == paper_variant]
        if same_variant:
            years = sorted({p["year"] for p in same_variant})
            return f"Paper {paper_variant} is published for: {', '.join(str(y) for y in years)}."
        if in_syllabus:
            variants = sorted({p["paper_variant"] for p in in_syllabus})
            return f"Published paper variants: {', '.join(variants)}."
        return None


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()


def _hash_json(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _entitlement_is_current(row: dict[str, Any]) -> bool:
    if row.get("status") != "active":
        return False

    now = datetime.now(timezone.utc)
    starts_at = _parse_timestamptz(row.get("starts_at"))
    ends_at = _parse_timestamptz(row.get("ends_at"))
    if starts_at and starts_at > now:
        return False
    if ends_at and ends_at <= now:
        return False
    return True


def _parse_timestamptz(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
