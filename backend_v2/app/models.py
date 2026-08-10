"""Request and response contracts.

Typed at the boundary so a malformed request fails with a clear 422 rather than
reaching the retrieval layer and producing an empty lookup that reads like a
missing paper.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

EXAM_SESSIONS = ("feb_march", "may_june", "oct_nov")


class TutorMode(str, Enum):
    """What kind of help the student asked for.

    These are separate modes rather than prompt phrasing because they have
    genuinely different rules about what may be revealed. HINT must not give
    the answer away; that is a property worth being able to test.
    """

    HINT = "hint"
    EXPLAIN = "explain"
    CHECK = "check"


class QuestionRef(BaseModel):
    year: int = Field(ge=2000, le=2100)
    exam_session: Literal["feb_march", "may_june", "oct_nov"]
    paper_variant: str = Field(min_length=1, max_length=4)
    question_number: int = Field(ge=1, le=99)

    @field_validator("paper_variant")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class ChatRequest(BaseModel):
    question: QuestionRef
    mode: TutorMode = TutorMode.EXPLAIN
    message: str = Field(min_length=1, max_length=4000)
    # The student's own working, when they have some. Only meaningful in CHECK
    # mode, and the tutor is told to diagnose it rather than replace it.
    attempt: str | None = Field(default=None, max_length=8000)
    history: list["ChatTurn"] = Field(default_factory=list)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class PaperSummary(BaseModel):
    year: int
    exam_session: str
    paper_variant: str
    paper_component: str
    question_count: int
    question_numbers: list[int]


class AssetOut(BaseModel):
    description: str | None
    required_to_solve: bool
    # A short-lived signed link. The bucket is private, so an unsigned path is
    # useless to the client and a permanent link would be a leak.
    url: str | None
    url_expires_in_seconds: int | None


class PartOut(BaseModel):
    label: str
    marks: int | None
    prompt_markdown: str
    mark_scheme_items: list[dict[str, Any]]


class QuestionContextOut(BaseModel):
    year: int
    exam_session: str
    paper_variant: str
    question_number: int
    total_marks: int | None
    stem_markdown: str
    parts: list[PartOut]
    root_mark_scheme: list[dict[str, Any]]
    assets: list[AssetOut]
    source_documents: list[dict[str, Any]]


class NotFoundOut(BaseModel):
    """The deliberate shape of a miss.

    The legacy service returns an empty string when nothing matches and lets the
    model answer anyway. Naming the miss explicitly, with what was searched for,
    is what makes refusal possible instead of invention.
    """

    detail: str
    searched_for: QuestionRef
    available_hint: str | None = None


ChatRequest.model_rebuild()
