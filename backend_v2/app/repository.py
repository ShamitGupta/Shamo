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
from .models import UserRole, UserTier

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

    # -- roles -------------------------------------------------------------

    def get_user_role(self, user_id: str) -> UserRole:
        """Which surface this account belongs to.

        Absence of a row means student, so a signup that failed halfway cannot
        leave a half-teacher. A read failure also answers student: refusing
        access when the role cannot be established is the safe direction, and
        this is the only question in the codebase whose wrong answer hands one
        user another's data.
        """
        try:
            response = (
                self._client.table("shamo_user_roles")
                .select("role")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read the account role: {error}") from error

        rows = response.data or []
        if rows and rows[0].get("role") == UserRole.STAFF.value:
            return UserRole.STAFF
        return UserRole.STUDENT

    def grant_staff_role(self, user_id: str, *, granted_by: str = "invite_code") -> None:
        """Promote one account to staff. Called only after the invite code matched."""
        try:
            (
                self._client.table("shamo_user_roles")
                .upsert(
                    {
                        "user_id": user_id,
                        "role": UserRole.STAFF.value,
                        "granted_by": granted_by,
                    },
                    on_conflict="user_id",
                )
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not grant the staff role: {error}") from error

    # -- what a staff account may read -------------------------------------
    #
    # These methods are the ONLY place in this file where one user reads
    # another's rows, and they are the reason the note below says "almost
    # every". Callers must be behind require_staff_user; nothing here re-checks
    # it, because a repository that authorizes as well as retrieves is a
    # repository with two places to get authorization wrong.
    #
    # get_mark_code_profile and get_activity_by_week are the two exceptions to
    # THAT: passed no id they answer about the class, which is staff-only, but
    # passed the caller's own id they answer about the caller, which is not.
    # /me/mark-codes uses the second form. The id a route passes is the
    # authorization decision, and it is made at the route.
    #
    # No method here selects shamo_conversation_turns.content or
    # shamo_conversations.title. That exclusion is a policy, not an oversight --
    # see the header of database/shamo_v2_11_staff_class_view_patch.sql.

    _STUDENT_ATTEMPT_COLUMNS = (
        "qualification,syllabus_code,year,exam_session,paper_variant,question_number,"
        "part_label,attempt_text,marks_earned,marks_available,earned_codes,missed_codes,"
        "outcome_source,created_at"
    )

    def get_student_roster(self, limit: int = 200) -> list[dict[str, Any]]:
        """Every student, with usage and scoring. School scoping does not exist yet."""
        try:
            response = self._client.rpc(
                "shamo_get_student_roster", {"p_limit": limit}
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read the class roster: {error}") from error
        return response.data or []

    def get_student_attempts(self, user_id: str, limit: int = 100) -> list[dict[str, Any]]:
        """One student's submitted work, newest first.

        attempt_text is included deliberately: work handed in for marking is
        what a teacher is entitled to see, and the marks alone would not let
        them tell a misconception from a slip.
        """
        try:
            response = (
                self._client.table("shamo_attempts")
                .select(self._STUDENT_ATTEMPT_COLUMNS)
                .eq("user_id", user_id)
                .is_("deleted_at", "null")
                .order("created_at", desc=True)
                .limit(max(1, min(limit, 500)))
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read the student's attempts: {error}") from error
        return response.data or []

    def get_class_topic_summary(
        self, *, min_attempts: int = 3, limit: int = 20
    ) -> list[dict[str, Any]]:
        """How the whole class is scoring, topic by topic, weakest first.

        The SQL calls shamo_get_topic_weakness once per student rather than
        re-aggregating the attempts, so "weak" keeps exactly one definition
        across the teacher's screen and the student's own. This is a thin call,
        not a second implementation.
        """
        try:
            response = self._client.rpc(
                "shamo_get_class_topic_summary",
                {"p_min_attempts": min_attempts, "p_limit": limit},
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read class performance: {error}") from error
        return response.data or []

    def get_mark_code_profile(self, user_id: str | None = None) -> list[dict[str, Any]]:
        """Marks earned and missed, split by what each mark is for.

        `None` means the whole class; a user id means that one student. Both
        callers exist: a teacher asks about their class and about one student,
        and a student asks about themselves through /me/mark-codes. Passing an
        id here is NOT an authorization decision -- the routes decide whose id
        may be passed.
        """
        try:
            response = self._client.rpc(
                "shamo_get_mark_code_profile", {"p_user_id": user_id}
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read the mark breakdown: {error}") from error
        return response.data or []

    def get_activity_by_week(
        self, user_id: str | None = None, *, weeks: int = 8
    ) -> list[dict[str, Any]]:
        """Attempts per week, for the class (None) or one student.

        Empty weeks come back as zero rows rather than being omitted, because
        noticing that someone stopped working is the whole point.
        """
        try:
            response = self._client.rpc(
                "shamo_get_activity_by_week",
                {"p_user_id": user_id, "p_weeks": weeks},
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read activity: {error}") from error
        return response.data or []

    # -- conversations and attempts ---------------------------------------
    #
    # Every method here takes user_id and filters on it. That filter IS the
    # access control: this client holds the service role key and so bypasses
    # RLS entirely, exactly as it does for published content. The own-row
    # policies on these tables are defence in depth for a future direct-access
    # path, not what protects a student's work today.
    #
    # The staff methods above are the single exception in this file, and they
    # are guarded at the route instead.

    _CONVERSATION_COLUMNS = (
        "id,title,created_at,updated_at,last_active_at,turn_count,last_question"
    )
    _TURN_COLUMNS = (
        "id,role,content,modes,visual_artifacts,sort_order,created_at,"
        "qualification,syllabus_code,year,exam_session,paper_variant,question_number"
    )

    def create_conversation(self, user_id: str, title: str | None = None) -> dict[str, Any]:
        try:
            response = (
                self._client.table("shamo_conversations")
                .insert({"user_id": user_id, "title": title})
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not start a conversation: {error}") from error

        rows = response.data or []
        if not rows:
            raise RetrievalError("Could not start a conversation: nothing was created.")
        return rows[0]

    def list_conversations(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        try:
            response = (
                self._client.table("shamo_conversations")
                .select(self._CONVERSATION_COLUMNS)
                .eq("user_id", user_id)
                .is_("deleted_at", "null")
                .order("last_active_at", desc=True)
                .limit(max(1, min(limit, 200)))
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not list conversations: {error}") from error
        return response.data or []

    def get_conversation(self, user_id: str, conversation_id: str) -> dict[str, Any] | None:
        """One conversation, or None when it is missing, deleted, or not theirs.

        The three cases are deliberately indistinguishable to the caller:
        telling a signed-in user that someone else's conversation exists is
        itself a small leak.
        """
        try:
            response = (
                self._client.table("shamo_conversations")
                .select(self._CONVERSATION_COLUMNS)
                .eq("id", conversation_id)
                .eq("user_id", user_id)
                .is_("deleted_at", "null")
                .limit(1)
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read the conversation: {error}") from error

        rows = response.data or []
        return rows[0] if rows else None

    def get_conversation_turns(
        self, user_id: str, conversation_id: str, limit: int = 200
    ) -> list[dict[str, Any]]:
        try:
            response = (
                self._client.table("shamo_conversation_turns")
                .select(self._TURN_COLUMNS)
                .eq("conversation_id", conversation_id)
                .eq("user_id", user_id)
                .order("sort_order")
                .limit(max(1, min(limit, 500)))
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read the conversation: {error}") from error
        return response.data or []

    def append_turn(
        self,
        *,
        user_id: str,
        conversation_id: str,
        role: str,
        content: str,
        modes: list[str] | None = None,
        visual_artifacts: list[dict[str, Any]] | None = None,
        question: dict[str, Any] | None = None,
        question_id: str | None = None,
    ) -> dict[str, Any]:
        """Add one message to a thread and refresh its display fields.

        sort_order is derived from the current maximum rather than held in a
        counter, so two turns racing for the same position collide on the
        table's unique constraint instead of silently overwriting each other.
        The retry below exists for exactly that collision.
        """
        payload: dict[str, Any] = {
            "conversation_id": conversation_id,
            "user_id": user_id,
            "role": role,
            "content": content,
            "modes": modes or [],
            "visual_artifacts": visual_artifacts,
            "question_id": question_id,
        }
        if question:
            payload.update(
                {
                    "qualification": question.get("qualification"),
                    "syllabus_code": question.get("syllabus_code"),
                    "year": question.get("year"),
                    "exam_session": question.get("exam_session"),
                    "paper_variant": question.get("paper_variant"),
                    "question_number": question.get("question_number"),
                }
            )

        last_error: Exception | None = None
        for _ in range(3):
            try:
                existing = (
                    self._client.table("shamo_conversation_turns")
                    .select("sort_order")
                    .eq("conversation_id", conversation_id)
                    .order("sort_order", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = existing.data or []
                payload["sort_order"] = (rows[0]["sort_order"] + 1) if rows else 0
                response = (
                    self._client.table("shamo_conversation_turns")
                    .insert(payload)
                    .execute()
                )
                created = (response.data or [None])[0]
                if created is None:
                    raise RetrievalError("the turn was not stored")
                self._touch_conversation(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    turn_count=payload["sort_order"] + 1,
                    question=question,
                )
                return created
            except Exception as error:  # noqa: BLE001
                last_error = error
        raise RetrievalError(f"Could not save the message: {last_error}")

    def _touch_conversation(
        self,
        *,
        user_id: str,
        conversation_id: str,
        turn_count: int,
        question: dict[str, Any] | None,
    ) -> None:
        """Refresh a thread's display fields after an append.

        Deliberately best-effort: these fields drive the thread list only, and
        the turn itself is already safely stored by the time this runs. Failing
        a student's request because a subtitle did not update is the wrong
        trade.
        """
        now = _now_iso()
        updates: dict[str, Any] = {
            "updated_at": now,
            "last_active_at": now,
            "turn_count": turn_count,
        }
        if question:
            updates["last_question"] = question
        try:
            (
                self._client.table("shamo_conversations")
                .update(updates)
                .eq("id", conversation_id)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("Could not refresh conversation %s: %s", conversation_id, error)

    def rename_conversation(
        self, user_id: str, conversation_id: str, title: str | None
    ) -> dict[str, Any] | None:
        try:
            response = (
                self._client.table("shamo_conversations")
                .update({"title": title, "updated_at": _now_iso()})
                .eq("id", conversation_id)
                .eq("user_id", user_id)
                .is_("deleted_at", "null")
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not rename the conversation: {error}") from error

        rows = response.data or []
        return rows[0] if rows else None

    def delete_conversation(self, user_id: str, conversation_id: str) -> bool:
        """Delete a thread and its messages for real. Marks survive.

        Deliberately a hard delete rather than a soft one. A student pressing
        delete means the conversation is gone, and keeping a hidden copy of
        their own written working after they asked for it to go is the wrong
        trade -- particularly for a school pilot involving minors. The turns
        cascade away with the thread.

        What survives is shamo_attempts: the marks earned, with their
        conversation_turn_id nulled by the foreign key. That is learning
        evidence rather than conversation, it is what every later weak-topic
        figure is computed from, and it is deleted through its own path rather
        than as a side effect of tidying up a chat.

        The deleted_at column stays in the schema for an operator-side archive
        action; the read filters honour it, nothing in the student path sets it.
        """
        try:
            response = (
                self._client.table("shamo_conversations")
                .delete()
                .eq("id", conversation_id)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not delete the conversation: {error}") from error
        return bool(response.data)

    def get_topic_weakness(
        self, user_id: str, *, min_attempts: int = 3, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Per-topic scoring for one student, weakest first.

        All the judgement (the evidence threshold, the ordering, which attempts
        count) lives in the SQL function so there is exactly one definition of
        it. This is a thin call, not a second implementation.
        """
        try:
            response = self._client.rpc(
                "shamo_get_topic_weakness",
                {
                    "p_user_id": user_id,
                    "p_min_attempts": min_attempts,
                    "p_limit": limit,
                },
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not read topic performance: {error}") from error
        return response.data or []

    def get_practice_set(
        self,
        user_id: str,
        *,
        main_topic: str,
        syllabus_code: str | None = None,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        """Unattempted questions on one topic, chosen for this student."""
        try:
            response = self._client.rpc(
                "shamo_get_practice_set",
                {
                    "p_user_id": user_id,
                    "p_main_topic": main_topic,
                    "p_syllabus_code": syllabus_code,
                    "p_limit": limit,
                },
            ).execute()
        except Exception as error:  # noqa: BLE001
            raise RetrievalError(f"Could not build a practice set: {error}") from error
        return response.data or []

    def record_attempt(
        self,
        *,
        user_id: str,
        question: dict[str, Any],
        attempt_text: str,
        mode: str,
        question_id: str | None = None,
        part_label: str | None = None,
        conversation_turn_id: str | None = None,
        outcome: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Store one submitted attempt, with its marking outcome when there is one.

        Returns None rather than raising when the write fails: an attempt record
        is bookkeeping, and losing it must never cost the student the tutoring
        they have already received.
        """
        payload: dict[str, Any] = {
            "user_id": user_id,
            "question_id": question_id,
            "qualification": question.get("qualification"),
            "syllabus_code": question.get("syllabus_code"),
            "year": question.get("year"),
            "exam_session": question.get("exam_session"),
            "paper_variant": question.get("paper_variant"),
            "question_number": question.get("question_number"),
            "part_label": part_label,
            "conversation_turn_id": conversation_turn_id,
            "attempt_text": attempt_text,
            "mode": mode,
            "outcome_source": "unavailable",
        }
        if outcome:
            payload.update(
                {
                    "outcome_source": "extractor",
                    "marks_earned": outcome.get("marks_earned"),
                    "marks_available": outcome.get("marks_available"),
                    "earned_codes": outcome.get("earned_codes") or [],
                    "missed_codes": outcome.get("missed_codes") or [],
                    "extractor_model": outcome.get("model"),
                    "extractor_confidence": outcome.get("confidence"),
                }
            )
        try:
            response = self._client.table("shamo_attempts").insert(payload).execute()
        except Exception as error:  # noqa: BLE001
            logger.warning("Could not record attempt for user %s: %s", user_id, error)
            return None
        return (response.data or [None])[0]

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


def _now_iso() -> str:
    """UTC timestamp in the form PostgREST accepts for a timestamptz column."""
    return datetime.now(timezone.utc).isoformat()


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
