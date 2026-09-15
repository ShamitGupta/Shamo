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


class UserTier(str, Enum):
    FREE = "free"
    PREMIUM = "premium"
    SHAMO_STUDENT = "shamo_student"


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
    VECTOR_LINE_3D = "vector_line_3d"


class VisualValidationStatus(str, Enum):
    VALIDATED = "validated"
    RENDER_FAILED = "render_failed"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    # A validated response with deliberately zero artifacts, because the
    # model was explaining a visual already shown rather than failing to
    # produce one. Distinct from RENDER_FAILED so the frontend's fallback
    # note (meant for a genuine failure) doesn't fire for a successful reply.
    EXPLAINED = "explained"


class QuestionRef(BaseModel):
    year: int = Field(ge=2000, le=2100)
    exam_session: Literal["feb_march", "may_june", "oct_nov"]
    paper_variant: str = Field(min_length=1, max_length=4)
    question_number: int = Field(ge=1, le=99)
    # Defaulted rather than required: the corpus used to hold exactly one
    # syllabus, and every existing caller (older frontend builds, the offline
    # test fixtures, evaluate_tutor.py) omits these fields entirely. Once a
    # second syllabus (IGCSE 0606) was published, paper_variant stopped being
    # globally unique -- e.g. "2025 Oct/Nov paper 12" exists in both 9709 and
    # 0606 -- so these two fields are what actually disambiguates the lookup;
    # the default just preserves the pre-existing single-syllabus behaviour
    # for any caller that doesn't yet know to send them.
    qualification: str = Field(default="a_level", min_length=1, max_length=20)
    syllabus_code: str = Field(default="9709", min_length=1, max_length=20)

    @field_validator("paper_variant", "qualification", "syllabus_code")
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
    # Which mode(s) produced this turn, when known. Optional and backward
    # compatible -- older callers omitting it are treated as unknown
    # provenance, not as "same mode as now".
    modes: list[TutorMode] | None = Field(default=None)
    # Visuals this turn already rendered, when known. Lets a later Visualize
    # turn recognize "explain the one you already made" instead of treating
    # every call as a request for a brand new artifact.
    visual_artifacts: list["VisualArtifactSummary"] | None = Field(default=None)


class VisualizeRequest(BaseModel):
    question: QuestionRef
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)


class MultiModeRequest(BaseModel):
    """One coordinated student turn across one or more tutor modes."""

    question: QuestionRef
    modes: list[TutorMode] = Field(min_length=1, max_length=4)
    message: str = Field(min_length=1, max_length=4000)
    attempt: str | None = Field(default=None, max_length=8000)
    history: list[ChatTurn] = Field(default_factory=list)

    @field_validator("modes")
    @classmethod
    def _unique_modes(cls, value: list[TutorMode]) -> list[TutorMode]:
        if len(set(value)) != len(value):
            raise ValueError("modes must be unique")
        return value


class AssistRequest(BaseModel):
    """One natural student turn that Shamo routes to the right tutor mode(s)."""

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


class ManimVectorLine3DParams(BaseModel):
    """Bounded numeric parameters for one or two lines in 3D, each given as a
    point and a direction (r = point + t*direction), for 9709 Paper 3 vector
    questions ("find a vector equation for l", "find the position vector of
    the point of intersection", "show that the lines are skew").

    Like ManimComplexTransformParams and ManimForceResultantParams, there is
    no expression string here at all and so no involvement from safe_math
    whatsoever -- only bounded coordinate/direction numbers, so ordinary
    Field bounds plus the cross-field checks below (see _bounds) are the
    complete safety surface. This is if anything the LOWEST-risk template of
    the seven: no arithmetic grammar is evaluated at all, only fixed linear
    algebra (a parametric line, a least-squares line-intersection solve, a
    perpendicular-projection formula) applied to plain numbers.

    With two lines, the scene works out their REAL relationship from the
    given points/directions -- intersecting (and where) or skew -- rather
    than trusting a model-supplied claim about it, the same "recompute,
    never trust the model's own arithmetic" discipline every sibling
    template already applies. The two lines' directions must not be
    (near-)parallel: that is a materially different, less interesting
    question shape than anything found in the source corpus for this
    template, so it is rejected here rather than given a rendering branch
    nothing exercises.

    external_point is the OTHER supported shape: a single named point plus
    exactly one line, for "find the position vector of the foot of the
    perpendicular from A to l" (and the closely related "find the position
    vector of the reflection of A in l") questions. It is mutually exclusive
    with a second line, because no question in the source corpus pairs
    "two lines" with "a foot of perpendicular from an external point" in the
    same part.

    Deliberately deferred (not this template's job, and documented here
    rather than silently missing): the angle-at-a-vertex-of-a-shape variant
    ("angle ABC" / "angle between the diagonals of OABC"), which needs three
    named points rather than a point+direction pair -- a materially
    different input shape, not a trivial extension of this one.
    """

    points: list[list[float]] = Field(min_length=1, max_length=2)
    directions: list[list[float]] = Field(min_length=1, max_length=2)
    t_min: float = -4.0
    t_max: float = 4.0
    external_point: list[float] | None = None
    labels: list[str] | None = None
    line_colors: list[str] | None = None
    external_point_label: str | None = Field(default=None, max_length=30)
    external_point_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    @model_validator(mode="after")
    def _bounds(self) -> "ManimVectorLine3DParams":
        if len(self.points) != len(self.directions):
            raise ValueError("points and directions must have the same length")
        if self.labels is not None and len(self.labels) != len(self.points):
            raise ValueError("labels must match the number of lines")
        if self.line_colors is not None and len(self.line_colors) != len(self.points):
            raise ValueError("line_colors must match the number of lines")
        for coord_lists, field_name in ((self.points, "points"), (self.directions, "directions")):
            for vector in coord_lists:
                if len(vector) != 3:
                    raise ValueError(f"each entry in {field_name} must have exactly 3 components")
                if any(abs(component) > 30 for component in vector):
                    raise ValueError(f"{field_name} components must stay within [-30, 30]")
        for direction in self.directions:
            magnitude = math.sqrt(sum(component**2 for component in direction))
            if magnitude < 1e-6:
                raise ValueError("a direction vector must not be zero")
        if self.t_max - self.t_min < 1.0:
            raise ValueError("t_max - t_min must be at least 1.0 so the swept line is visible")
        if self.t_max - self.t_min > 20.0:
            raise ValueError("t_max - t_min must not exceed 20")
        if self.external_point is not None:
            if len(self.points) != 1:
                raise ValueError("external_point is only supported alongside exactly one line")
            if len(self.external_point) != 3:
                raise ValueError("external_point must have exactly 3 components")
            if any(abs(component) > 30 for component in self.external_point):
                raise ValueError("external_point components must stay within [-30, 30]")
        if len(self.points) == 2:
            d1, d2 = self.directions
            cross = (
                d1[1] * d2[2] - d1[2] * d2[1],
                d1[2] * d2[0] - d1[0] * d2[2],
                d1[0] * d2[1] - d1[1] * d2[0],
            )
            cross_norm = math.sqrt(sum(component**2 for component in cross))
            mag1 = math.sqrt(sum(component**2 for component in d1))
            mag2 = math.sqrt(sum(component**2 for component in d2))
            if cross_norm < 1e-6 * mag1 * mag2:
                raise ValueError(
                    "the two lines' directions are (near-)parallel -- this template is for two "
                    "genuinely different directions (intersecting or skew), not parallel lines"
                )
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
    vector_line_3d: ManimVectorLine3DParams | None = None

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


class VisualArtifactSummary(BaseModel):
    """A compact, human-readable record of a visual already shown this
    conversation -- carried on a history `ChatTurn`, not the API boundary.

    Deliberately excludes the full desmos/geogebra/manim spec and any video
    URL: this only needs to remind the model what it already made, not hand
    back an executable spec to copy or a stale signed link.
    """

    artifact_kind: VisualArtifactKind
    title: str = Field(max_length=120)
    purpose: str = Field(max_length=240)
    part_label: str | None = Field(default=None, max_length=40)
    manim_template: ManimTemplate | None = None


class VisualTeachingStep(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    explanation_markdown: str = Field(min_length=1, max_length=500)


class VisualArtifactOut(BaseModel):
    artifact_kind: VisualArtifactKind
    title: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1, max_length=240)
    narration_markdown: str = Field(min_length=1, max_length=1200)
    accessibility_text: str = Field(min_length=1, max_length=1200)
    teaching_steps: list[VisualTeachingStep] = Field(default_factory=list, max_length=5)
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


class ModeResponseOut(BaseModel):
    mode: TutorMode
    message_markdown: str | None = None
    artifacts: list[VisualArtifactOut] = Field(default_factory=list, max_length=2)
    fallback_markdown: str | None = None
    validation_status: VisualValidationStatus | None = None
    error: str | None = None


class SuggestedActionOut(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    kind: Literal["send", "prefill"] = "send"
    message: str | None = Field(default=None, max_length=4000)
    mode: TutorMode | None = None


class MultiModeResponse(BaseModel):
    source_reference: QuestionRef
    responses: list[ModeResponseOut]


class AssistResponse(BaseModel):
    source_reference: QuestionRef
    routed_modes: list[TutorMode]
    route_label: str
    responses: list[ModeResponseOut]
    suggested_actions: list[SuggestedActionOut] = Field(default_factory=list)


class ProfileOut(BaseModel):
    user_id: str
    display_name: str | None = None
    grade: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CurrentUserOut(BaseModel):
    user_id: str
    email: str | None = None
    email_confirmed: bool
    tier: UserTier
    profile: ProfileOut | None = None


class PaperSummary(BaseModel):
    year: int
    exam_session: str
    paper_variant: str
    paper_component: str
    question_count: int
    question_numbers: list[int]
    # Defaulted for the same reason as QuestionRef above: existing fakes/tests
    # build this from a plain dict that predates multi-syllabus support.
    qualification: str = "a_level"
    syllabus_code: str = "9709"
    subject: str | None = None


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
    # Echoed back so the frontend can label the question correctly instead of
    # assuming the corpus's original single syllabus (9709).
    qualification: str = "a_level"
    syllabus_code: str = "9709"
    subject: str | None = None


class SimilarQuestionsStatus(str, Enum):
    """Why a similarity request returned what it returned.

    Zero matches has four different meanings and a student-facing UI has to
    tell them apart: "that question is not published", "this component has too
    few papers to compare against yet", "the seed has no embedding", and "we
    looked and nothing was close enough". Only the last is a normal outcome,
    and on the current corpus it is the common one -- roughly one question in
    ten has no match above the quality floor.

    These values mirror the SQL function's result_status exactly. Adding one
    there without adding it here raises a validation error on every affected
    response, which is deliberate: the contract stays in sync.
    """

    OK = "ok"
    SEED_NOT_PUBLISHED = "seed_not_published_or_not_found"
    SEED_EMBEDDING_MISSING = "seed_embedding_missing"
    NOT_ENOUGH_SAME_COMPONENT_PAPERS = "not_enough_same_component_papers"
    NOT_ENOUGH_CROSS_PAPER_QUESTIONS = "not_enough_cross_paper_questions"
    NO_MATCHES_ABOVE_THRESHOLD = "no_matches_above_threshold"
    READINESS_UNAVAILABLE = "readiness_unavailable"
    # Set by the API, not the database: the RPC returned nothing at all, or the
    # published question carries no id to search from.
    UNAVAILABLE = "unavailable"


class SimilarQuestionOut(BaseModel):
    """One recommended question, with the evidence for recommending it.

    The explanation is entirely metadata the corpus already stores and has
    reviewed -- the shared topic, the marks, the paper it came from. No model
    writes a rationale here, so a recommendation cannot be justified with an
    invented reason.
    """

    question_id: str = Field(min_length=1, max_length=64)
    # A ready-made reference the client can send straight to /chat or
    # /visualize, rather than reassembling one from loose fields. That
    # reassembly is exactly where an IGCSE variant gets mistaken for the 9709
    # variant of the same number -- 2025 Oct/Nov paper 12 exists in both.
    reference: QuestionRef
    subject: str | None = Field(default=None, max_length=120)
    paper_component: str = Field(default="", max_length=1)
    main_topic: str | None = Field(default=None, max_length=120)
    shares_main_topic: bool = False
    total_marks: int | None = None
    # Plain-text preview. The SQL truncates at 240 characters and can cut a
    # LaTeX token in half, so this is not safe to render as mathematics.
    stem_snippet: str = Field(default="", max_length=240)
    similarity: float
    # True when the closest-matching search row was a PART of the question
    # rather than the whole thing. Measured at ~40% of matches, because the
    # similarity floor is applied per row before collapsing to one row per
    # question. The card still links to the whole question; this is surfaced
    # so the effect stays measurable rather than invisible.
    matched_on_part: bool = False


class SimilarQuestionsResponse(BaseModel):
    source_reference: QuestionRef
    status: SimilarQuestionsStatus
    seed_main_topic: str | None = Field(default=None, max_length=120)
    seed_total_marks: int | None = None
    is_ready: bool = False
    readiness_status: str | None = Field(default=None, max_length=60)
    same_component_paper_count: int = 0
    same_component_cross_paper_question_count: int = 0
    min_similarity: float = 0.60
    matches: list[SimilarQuestionOut] = Field(default_factory=list)


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
AssistRequest.model_rebuild()
