"""Request and response contracts.

Typed at the boundary so a malformed request fails with a clear 422 rather than
reaching the retrieval layer and producing an empty lookup that reads like a
missing paper.
"""

from __future__ import annotations

import math
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
    TANGENT_LINE = "tangent_line"
    COBWEB_DIAGRAM = "cobweb_diagram"
    COMPLEX_TRANSFORM = "complex_transform"
    KINEMATICS_MOTION = "kinematics_motion"
    FORCE_RESULTANT = "force_resultant"


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


class ManimTangentLineParams(BaseModel):
    """Bounded numeric parameters for sweeping a point (and its tangent line)
    along a curve, for differentiation/gradient questions.

    A separate shape from ManimBoundedRegionParams rather than a reuse of it:
    that one describes a region bounded by one or two curves over an
    interval, while this one describes a single curve plus one specific
    x-value the sweep must settle on (point_of_interest_x) -- a genuinely
    different question shape, not a cosmetic rename of the same fields.

    The tangent line's slope is never computed symbolically. safe_math's
    evaluator only computes f(x), and teaching it to also differentiate
    expressions would be new AST-whitelist surface for a template that does
    not need it -- the scene itself takes a central finite difference of the
    already-validated f(x) evaluator instead (see tangent_line.py).
    """

    expr: str = Field(min_length=1, max_length=80)
    x_min: float = Field(ge=-1000, le=1000)
    x_max: float = Field(ge=-1000, le=1000)
    point_of_interest_x: float = Field(ge=-1000, le=1000)
    curve_label: str | None = Field(default=None, max_length=60)
    curve_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    @field_validator("expr")
    @classmethod
    def _coarse_charset(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9A-Za-z\.\+\-\*/\^\(\)\s,]+", value):
            raise ValueError("expression contains characters outside plain arithmetic")
        return value

    @model_validator(mode="after")
    def _bounds(self) -> "ManimTangentLineParams":
        span = self.x_max - self.x_min
        if span < 1.0:
            raise ValueError("x_max must be meaningfully larger than x_min for a tangent-line sweep")
        margin = max(span * 0.08, 0.05)
        if not (self.x_min + margin <= self.point_of_interest_x <= self.x_max - margin):
            raise ValueError(
                "point_of_interest_x must sit inside x_min/x_max with room to spare for the sweep"
            )
        return self


class ManimCobwebDiagramParams(BaseModel):
    """Bounded numeric parameters for a cobweb (staircase) diagram: an
    iterative formula x_{n+1} = g(x_n) stepping between the curve y=g(x) and
    the line y=x, for "show that this iteration converges" / "use the
    iterative formula to find the root" numerical-methods questions.

    g_expr is deliberately named for the REARRANGED iteration formula, not
    the original equation f(x)=0 -- the scene only ever evaluates g, and
    naming the field g_expr keeps that distinction visible to whatever
    builds this spec, rather than risking the original f(x) being supplied
    by mistake.

    Like ManimTangentLineParams, the sequence is never analyzed
    symbolically: safe_math's evaluator only computes g(x), and the scene
    (and the validation check in visualize.py) simply iterate it forward a
    bounded number of times.
    """

    g_expr: str = Field(min_length=1, max_length=80)
    x0: float = Field(ge=-1000, le=1000)
    iterations: int = Field(ge=2, le=10)
    x_min: float = Field(ge=-1000, le=1000)
    x_max: float = Field(ge=-1000, le=1000)
    g_label: str | None = Field(default=None, max_length=60)
    curve_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    @field_validator("g_expr")
    @classmethod
    def _coarse_charset(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9A-Za-z\.\+\-\*/\^\(\)\s,]+", value):
            raise ValueError("expression contains characters outside plain arithmetic")
        return value

    @model_validator(mode="after")
    def _bounds(self) -> "ManimCobwebDiagramParams":
        span = self.x_max - self.x_min
        if span < 0.5:
            raise ValueError("x_max must be meaningfully larger than x_min for a cobweb diagram")
        margin = max(span * 0.08, 0.05)
        if not (self.x_min + margin <= self.x0 <= self.x_max - margin):
            raise ValueError("x0 must sit inside x_min/x_max with room to spare for the staircase")
        return self


class ManimComplexTransformParams(BaseModel):
    """Bounded numeric parameters for animating a complex number being
    multiplied or divided by a second one, shown as a vector rotating by
    the factor's argument and scaling by its modulus -- for "find the
    product/quotient in exponential form" or "show why multiplying adds
    arguments" complex-number questions.

    Unlike every other Manim params model, this one has no expression
    string at all and so no involvement from safe_math whatsoever: there is
    nothing here for a student-facing formula to hide inside, only bounded
    numeric moduli/arguments, so ordinary Field bounds plus the one
    cross-field bound below (see _bounds) are the complete safety surface.
    Moduli and arguments are given directly as floats (radians for
    arguments), never as strings, since there is no arithmetic to parse.
    """

    start_modulus: float = Field(gt=0, le=50)
    start_argument: float = Field(ge=-12.6, le=12.6)
    factor_modulus: float = Field(gt=0, le=50)
    factor_argument: float = Field(ge=-12.6, le=12.6)
    operation: Literal["multiply", "divide"] = "multiply"
    start_label: str | None = Field(default=None, max_length=30)
    factor_label: str | None = Field(default=None, max_length=30)
    result_label: str | None = Field(default=None, max_length=30)
    vector_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    @model_validator(mode="after")
    def _bounds(self) -> "ManimComplexTransformParams":
        result_modulus = (
            self.start_modulus * self.factor_modulus
            if self.operation == "multiply"
            else self.start_modulus / self.factor_modulus
        )
        if not (0.05 <= result_modulus <= 50):
            raise ValueError(
                "the resulting modulus is out of a sane plotting range -- check start_modulus/factor_modulus"
            )
        return self


class ManimKinematicsParams(BaseModel):
    """Bounded numeric parameters for showing a particle's physical motion
    (a dot on a real number line) alongside its displacement/velocity-time
    graph, for 9709 Mechanics kinematics questions that give an explicit
    formula in one variable t.

    This is NOT 2D projectile motion -- 9709 Mechanics at this level is 1D
    straight-line motion described via s/v/a as functions of t, never a
    parametric (x(t), y(t)) trajectory, so a single expr in t is the whole
    shape needed.

    expr is evaluated with safe_math's variable name generalized to "t"
    (see safe_math.make_evaluator's var_name parameter) rather than "x" --
    the grammar itself is identical, only the free variable's name differs.

    quantity says what expr represents. When it is "v" (velocity), the
    scene must recover position by numerically integrating expr once (a
    one-time cumulative trapezoidal pass, the same "precompute once, not
    every frame" convention every sibling template already uses for its own
    axis-range sampling) -- s_at_t_min is the one integration constant that
    needs, matching the common "starts from a point O" phrasing. A third
    quantity, "a" (acceleration), is deliberately NOT supported in this
    version: it would need a second integration constant and a double
    integration, and no real corpus question needed acceleration as the
    PRIMARY given quantity for this kind of scene. Piecewise formulas (a
    different expr valid after some breakpoint) are also deliberately out of
    scope for the same reason every sibling template started with exactly
    one continuous expression before anything more elaborate.
    """

    expr: str = Field(min_length=1, max_length=80)
    quantity: Literal["s", "v"] = "s"
    t_min: float = Field(ge=0, le=1000)
    t_max: float = Field(ge=0, le=1000)
    time_of_interest_t: float = Field(ge=0, le=1000)
    s_at_t_min: float = Field(default=0.0, ge=-1000, le=1000)
    curve_label: str | None = Field(default=None, max_length=60)
    curve_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    @field_validator("expr")
    @classmethod
    def _coarse_charset(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9A-Za-z\.\+\-\*/\^\(\)\s,]+", value):
            raise ValueError("expression contains characters outside plain arithmetic")
        return value

    @model_validator(mode="after")
    def _bounds(self) -> "ManimKinematicsParams":
        span = self.t_max - self.t_min
        if span < 1.0:
            raise ValueError("t_max must be meaningfully larger than t_min for a kinematics sweep")
        margin = max(span * 0.08, 0.05)
        if not (self.t_min + margin <= self.time_of_interest_t <= self.t_max - margin):
            raise ValueError(
                "time_of_interest_t must sit inside t_min/t_max with room to spare for the sweep"
            )
        return self


class ManimForceResultantParams(BaseModel):
    """Bounded numeric parameters for animating several coplanar force
    vectors -- given as magnitude/direction pairs, all acting at one point --
    resolved into horizontal/vertical components which are then summed along
    each axis and combined into the resultant, for "find the magnitude and
    direction of the resultant force" statics questions. This mirrors the
    actual method Cambridge's own mark schemes use (resolve horizontally,
    resolve vertically, then Pythagoras/inverse-tan), rather than a
    geometric tip-to-tail polygon of the original angled forces.

    Like ManimComplexTransformParams, there is no expression string here and
    so no involvement from safe_math at all: magnitudes and angles are given
    directly as floats (angles_degrees using the ordinary mathematical
    convention -- degrees measured anticlockwise from the positive
    x-direction), never as strings. Translating whatever direction
    convention the source diagram actually uses (a bearing, an angle from a
    named force, etc.) into this convention is expected to happen before
    this params object is built, not inside the scene.

    The one cross-field check that matters is that the forces are not
    already in (near) equilibrium: this template exists to show a genuine
    resultant forming, and a near-zero resultant has no meaningful direction
    to animate toward. An "in equilibrium, find the missing force" question
    is a different shape and does not belong to this template.
    """

    magnitudes: list[float] = Field(min_length=2, max_length=6)
    angles_degrees: list[float] = Field(min_length=2, max_length=6)
    resultant_label: str | None = Field(default=None, max_length=30)
    vector_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    resultant_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    horizontal_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    vertical_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    @model_validator(mode="after")
    def _bounds(self) -> "ManimForceResultantParams":
        if len(self.magnitudes) != len(self.angles_degrees):
            raise ValueError("magnitudes and angles_degrees must be the same length")
        if any(not (0 < m <= 500) for m in self.magnitudes):
            raise ValueError("each force magnitude must be a sane positive value in (0, 500]")
        if any(not (-360 <= a <= 360) for a in self.angles_degrees):
            raise ValueError("each angle must be within [-360, 360] degrees")
        x = sum(m * math.cos(math.radians(a)) for m, a in zip(self.magnitudes, self.angles_degrees))
        y = sum(m * math.sin(math.radians(a)) for m, a in zip(self.magnitudes, self.angles_degrees))
        resultant_magnitude = math.hypot(x, y)
        if resultant_magnitude < 0.5:
            raise ValueError(
                "the forces are too close to equilibrium to draw a meaningful resultant -- "
                "this template is for a genuine non-zero resultant, not an equilibrium question"
            )
        if resultant_magnitude > 2000:
            raise ValueError("the resultant magnitude is out of a sane plotting range")
        return self


class ManimSpec(BaseModel):
    template: ManimTemplate
    region_sweep: ManimBoundedRegionParams | None = None
    volume_of_revolution: ManimBoundedRegionParams | None = None
    tangent_line: ManimTangentLineParams | None = None
    cobweb_diagram: ManimCobwebDiagramParams | None = None
    complex_transform: ManimComplexTransformParams | None = None
    kinematics_motion: ManimKinematicsParams | None = None
    force_resultant: ManimForceResultantParams | None = None

    @model_validator(mode="after")
    def _matches_template(self) -> "ManimSpec":
        # Every ManimTemplate member must have a same-named field on this
        # model (region_sweep, volume_of_revolution, ...). Derived from the
        # enum itself rather than a hand-maintained "these are the other
        # fields" tuple per template: that shape needs updating in every
        # existing entry each time a template is added, and a forgotten
        # update would silently let two templates' params coexist on one
        # spec. Deriving "the others" from ManimTemplate's own members
        # removes the chance of that omission for this template and any
        # future one.
        fields = {member: getattr(self, member.value) for member in ManimTemplate}
        own = fields[self.template]
        others = [value for member, value in fields.items() if member != self.template]
        if own is None or any(value is not None for value in others):
            raise ValueError(f"{self.template.value} template requires only {self.template.value} params")
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
