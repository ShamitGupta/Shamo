"""Request and response contracts.

Typed at the boundary so a malformed request fails with a clear 422 rather than
reaching the retrieval layer and producing an empty lookup that reads like a
missing paper.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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
    VISUALIZE = "visualize"


class VisualArtifactKind(str, Enum):
    DESMOS_2D = "desmos_2d"
    DESMOS_3D = "desmos_3d"
    GEOGEBRA_GRAPHING = "geogebra_graphing"
    GEOGEBRA_GEOMETRY = "geogebra_geometry"
    GEOGEBRA_3D = "geogebra_3d"
    MANIM_TEMPLATE_VIDEO = "manim_template_video"
    NONE = "none"


class ManimTemplate(str, Enum):
    """The fixed set of Manim scenes Shamo can render.

    Deliberately an enum, not a free-text field: the model selects one of a
    small number of scene FILES that already exist in manim_templates/ and
    supplies only bounded numeric parameters for it. It never supplies a
    scene, code, or anything the renderer would execute as Python beyond
    what these templates already contain.
    """

    REGION_SWEEP = "region_sweep"
    VOLUME_OF_REVOLUTION = "volume_of_revolution"


class VisualValidationStatus(str, Enum):
    VALIDATED = "validated"
    RENDER_FAILED = "render_failed"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"


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


class VisualizeRequest(BaseModel):
    question: QuestionRef
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)


class SliderBounds(BaseModel):
    min: str = Field(min_length=1, max_length=50)
    max: str = Field(min_length=1, max_length=50)
    step: str | None = Field(default=None, max_length=50)


class DesmosViewport(BaseModel):
    left: float
    right: float
    bottom: float
    top: float

    @model_validator(mode="after")
    def _valid_bounds(self) -> "DesmosViewport":
        if self.right <= self.left or self.top <= self.bottom:
            raise ValueError("viewport bounds must increase")
        if max(abs(self.left), abs(self.right), abs(self.bottom), abs(self.top)) > 100000:
            raise ValueError("viewport bounds are too large")
        return self


class DesmosExpression(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
    latex: str = Field(min_length=1, max_length=600)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    hidden: bool = False
    secret: bool = False
    points: bool | None = None
    lines: bool | None = None
    fill: bool | None = None
    fillOpacity: float | None = Field(default=None, ge=0, le=1)
    sliderBounds: SliderBounds | None = None
    domain: SliderBounds | None = None
    label: str | None = Field(default=None, max_length=120)
    showLabel: bool | None = None
    lineStyle: Literal["SOLID", "DASHED", "DOTTED"] | None = None
    pointStyle: Literal["POINT", "OPEN", "CROSS"] | None = None
    required: bool = True


class DesmosSpec(BaseModel):
    calculator: Literal["graphing", "3d"] = "graphing"
    viewport: DesmosViewport | None = None
    degreeMode: bool = False
    expressions: list[DesmosExpression] = Field(min_length=1, max_length=12)


class GeoGebraSlider(BaseModel):
    name: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
    value: float
    min: float | None = None
    max: float | None = None
    step: float | None = Field(default=None, gt=0)


class GeoGebraSpec(BaseModel):
    appName: Literal["graphing", "geometry", "3d"]
    commands: list[str] = Field(min_length=1, max_length=24)
    sliders: list[GeoGebraSlider] = Field(default_factory=list, max_length=8)
    visibleObjects: list[str] = Field(default_factory=list, max_length=24)


class ManimBoundedRegionParams(BaseModel):
    """Bounded numeric parameters describing a region between one or two
    curves over an x-interval -- shared by both region_sweep (animates the
    flat region filling in) and volume_of_revolution (additionally spins
    that same region about the x-axis into a solid). The two templates
    render the region identically in their shared first act; only what
    happens to it afterward differs, so one params shape covers both rather
    than duplicating an identical model under two names.

    Expressions are checked structurally here (length, a coarse charset) and
    then walked node-by-node against a whitelist by safe_math before any
    render happens (see visualize._validate_manim). Both checks exist: this
    one keeps a malformed spec from ever reaching the renderer subprocess at
    all, and safe_math is the one that actually matters for safety.
    """

    lower_expr: str = Field(min_length=1, max_length=80)
    upper_expr: str | None = Field(default=None, max_length=80)
    x_min: float = Field(ge=-1000, le=1000)
    x_max: float = Field(ge=-1000, le=1000)
    lower_label: str | None = Field(default=None, max_length=60)
    upper_label: str | None = Field(default=None, max_length=60)
    region_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    @field_validator("lower_expr", "upper_expr")
    @classmethod
    def _coarse_charset(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[0-9A-Za-z\.\+\-\*/\^\(\)\s,]+", value):
            raise ValueError("expression contains characters outside plain arithmetic")
        return value

    @model_validator(mode="after")
    def _bounds(self) -> "ManimBoundedRegionParams":
        if self.x_max - self.x_min < 0.1:
            raise ValueError("x_max must be meaningfully larger than x_min")
        return self


class ManimSpec(BaseModel):
    template: ManimTemplate
    region_sweep: ManimBoundedRegionParams | None = None
    volume_of_revolution: ManimBoundedRegionParams | None = None

    @model_validator(mode="after")
    def _matches_template(self) -> "ManimSpec":
        if self.template == ManimTemplate.REGION_SWEEP:
            if self.region_sweep is None or self.volume_of_revolution is not None:
                raise ValueError("region_sweep template requires only region_sweep params")
        elif self.template == ManimTemplate.VOLUME_OF_REVOLUTION:
            if self.volume_of_revolution is None or self.region_sweep is not None:
                raise ValueError("volume_of_revolution template requires only volume_of_revolution params")
        return self


class VisualArtifactOut(BaseModel):
    artifact_kind: VisualArtifactKind
    title: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1, max_length=240)
    narration_markdown: str = Field(min_length=1, max_length=1200)
    accessibility_text: str = Field(min_length=1, max_length=1200)
    part_label: str | None = Field(default=None, max_length=40)
    desmos: DesmosSpec | None = None
    geogebra: GeoGebraSpec | None = None
    manim: ManimSpec | None = None
    # Set server-side only, never by the model. video_storage_path is the
    # durable Storage object key and is what gets cached; video_url is a
    # short-lived signed link re-resolved from it on every request, the same
    # split AssetOut already uses for question diagrams.
    video_storage_path: str | None = None
    video_url: str | None = None
    video_url_expires_in_seconds: int | None = None
    validation_notes: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def _matching_spec(self) -> "VisualArtifactOut":
        other_specs_present = any(
            spec is not None for spec in (self.desmos, self.geogebra, self.manim)
        )
        if self.artifact_kind in {VisualArtifactKind.DESMOS_2D, VisualArtifactKind.DESMOS_3D}:
            if self.desmos is None or self.geogebra is not None or self.manim is not None:
                raise ValueError("Desmos artifacts require only a Desmos spec")
            if self.artifact_kind == VisualArtifactKind.DESMOS_2D and self.desmos.calculator != "graphing":
                raise ValueError("desmos_2d must use the graphing calculator")
            if self.artifact_kind == VisualArtifactKind.DESMOS_3D and self.desmos.calculator != "3d":
                raise ValueError("desmos_3d must use the 3d calculator")
        elif self.artifact_kind in {
            VisualArtifactKind.GEOGEBRA_GRAPHING,
            VisualArtifactKind.GEOGEBRA_GEOMETRY,
            VisualArtifactKind.GEOGEBRA_3D,
        }:
            if self.geogebra is None or self.desmos is not None or self.manim is not None:
                raise ValueError("GeoGebra artifacts require only a GeoGebra spec")
            expected_app = {
                VisualArtifactKind.GEOGEBRA_GRAPHING: "graphing",
                VisualArtifactKind.GEOGEBRA_GEOMETRY: "geometry",
                VisualArtifactKind.GEOGEBRA_3D: "3d",
            }[self.artifact_kind]
            if self.geogebra.appName != expected_app:
                raise ValueError(f"{self.artifact_kind.value} must use {expected_app}")
        elif self.artifact_kind == VisualArtifactKind.MANIM_TEMPLATE_VIDEO:
            if self.manim is None or self.desmos is not None or self.geogebra is not None:
                raise ValueError("Manim artifacts require only a Manim spec")
        elif other_specs_present:
            raise ValueError("none artifacts cannot carry a tool spec")

        if self.artifact_kind != VisualArtifactKind.MANIM_TEMPLATE_VIDEO and (
            self.video_storage_path is not None or self.video_url is not None
        ):
            raise ValueError("only manim_template_video artifacts carry a video reference")
        return self


class VisualizeResponse(BaseModel):
    visual_spec_version: Literal["visual-v1"] = "visual-v1"
    message_markdown: str = Field(min_length=1, max_length=3000)
    artifacts: list[VisualArtifactOut] = Field(default_factory=list, max_length=2)
    fallback_markdown: str = Field(min_length=1, max_length=1600)
    source_reference: QuestionRef
    validation_status: VisualValidationStatus


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
