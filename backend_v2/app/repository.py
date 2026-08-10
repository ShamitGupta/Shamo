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
from dataclasses import dataclass
from typing import Any

from supabase import Client, create_client

from .config import Settings

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
        """
        try:
            response = (
                self._client.table("shamo_published_question_overview")
                .select("year,exam_session,paper_variant,question_number")
                .eq("qualification", self._settings.qualification)
                .eq("syllabus_code", self._settings.syllabus_code)
                .execute()
            )
        except Exception as error:  # noqa: BLE001 - surfaced as 503 upstream
            raise RetrievalError(f"Could not read the paper catalogue: {error}") from error

        grouped: dict[tuple[int, str, str], set[int]] = {}
        for row in response.data or []:
            key = (row["year"], row["exam_session"], str(row["paper_variant"]))
            grouped.setdefault(key, set()).add(int(row["question_number"]))

        papers = [
            {
                "year": year,
                "exam_session": session,
                "paper_variant": variant,
                # The first digit of the variant is the Cambridge component, and
                # it decides which papers are comparable. Derived here rather
                # than stored, because it is a property of the identifier.
                "paper_component": variant[0] if variant else "",
                "question_count": len(numbers),
                "question_numbers": sorted(numbers),
            }
            for (year, session, variant), numbers in grouped.items()
        ]
        papers.sort(key=lambda p: (-p["year"], p["exam_session"], p["paper_variant"]))
        return papers

    # -- exact question ----------------------------------------------------

    def get_question_context(
        self, year: int, exam_session: str, paper_variant: str, question_number: int
    ) -> QuestionContext | None:
        """Return the question, or None when it is not published.

        None is a real answer here, not an error. Distinguishing "we looked and
        it is not there" from "the lookup failed" matters, because the first
        should tell the student what we do have and the second should not
        pretend the corpus is missing something.
        """
        try:
            response = self._client.rpc(
                "shamo_get_question_context",
                {
                    "requested_qualification": self._settings.qualification,
                    "requested_syllabus_code": self._settings.syllabus_code,
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

    def nearest_available(self, year: int, paper_variant: str) -> str | None:
        """A helpful pointer when a lookup misses.

        Purely for the error message. It never changes what is taught.
        """
        try:
            papers = self.list_papers()
        except RetrievalError:
            return None
        same_variant = [p for p in papers if p["paper_variant"] == paper_variant]
        if same_variant:
            years = sorted({p["year"] for p in same_variant})
            return f"Paper {paper_variant} is published for: {', '.join(str(y) for y in years)}."
        if papers:
            variants = sorted({p["paper_variant"] for p in papers})
            return f"Published paper variants: {', '.join(variants)}."
        return None
