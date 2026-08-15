"""Structured visual explanations.

Visuals are deliberately not streamed as prose. The model may propose a small
JSON spec, then this module validates it before the browser sees it. That keeps
Desmos/GeoGebra powerful enough to teach with sliders and constructions while
avoiding raw JavaScript, external URLs, or arbitrary saved calculator states.
"""

from __future__ import annotations

import json
import logging
import math
import re
from typing import Any, Callable

from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .config import Settings
from .models import (
    ChatTurn,
    GeoGebraSpec,
    ManimCobwebDiagramParams,
    ManimKinematicsParams,
    ManimSpec,
    ManimTangentLineParams,
    QuestionRef,
    VisualArtifactKind,
    VisualArtifactOut,
    VisualValidationStatus,
    VisualizeResponse,
)
from .prompts import build_source_block
from .repository import QuestionContext
from .safe_math import UnsafeExpressionError, make_evaluator, validate_expression

logger = logging.getLogger(__name__)

VISUAL_SPEC_VERSION = "visual-v1"
VISUAL_PROMPT_VERSION = "visualize-v1"

FORBIDDEN_TEXT = re.compile(
    r"(<\/?[A-Za-z]|javascript:|https?://|www\.|eval\s*\(|function\s*\(|=>|"
    r"\bimport\s+|\brequire\s*\(|document\.|window\.)",
    re.IGNORECASE,
)

GEOGEBRA_COMMAND_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9_]*)\s*(?:\(|=)")
GEOGEBRA_SAFE_ASSIGNMENT_RHS = re.compile(
    r"^(?:"
    r"-?\d+(?:\.\d+)?"
    r"|"
    r"\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?"
    r"(?:\s*,\s*-?\d+(?:\.\d+)?)?\s*\)"
    r")$"
)
GEOGEBRA_ALLOWED_COMMANDS = {
    "Angle",
    "Circle",
    "Cone",
    "Curve",
    "Cylinder",
    "Dilate",
    "Function",
    "Intersect",
    "Line",
    "Locus",
    "ParallelLine",
    "PerpendicularLine",
    "Plane",
    "Point",
    "Polygon",
    "Ray",
    "Reflect",
    "Rotate",
    "Segment",
    "SetColor",
    "SetLineThickness",
    "SetPointSize",
    "ShowLabel",
    "Slider",
    "Sphere",
    "Surface",
    "Translate",
    "Vector",
}
GEOGEBRA_ALLOWED_ASSIGNMENT_CONSTRUCTORS = {
    "Angle",
    "Circle",
    "Cone",
    "Curve",
    "Cylinder",
    "Function",
    "Intersect",
    "Line",
    "Locus",
    "Plane",
    "Point",
    "Polygon",
    "Ray",
    "Segment",
    "Slider",
    "Sphere",
    "Surface",
    "Vector",
}


def _reject_forbidden_text(value: str, field_name: str) -> str:
    if FORBIDDEN_TEXT.search(value):
        raise ValueError(f"{field_name} contains executable text or an external URL")
    return value


class GeneratedVisualResponse(BaseModel):
    """The model-produced shape, before source reference/status are attached."""

    visual_spec_version: str = VISUAL_SPEC_VERSION
    message_markdown: str = Field(min_length=1, max_length=3000)
    artifacts: list[VisualArtifactOut] = Field(default_factory=list, max_length=2)
    fallback_markdown: str = Field(min_length=1, max_length=1600)

    @field_validator("visual_spec_version")
    @classmethod
    def _version_matches(cls, value: str) -> str:
        if value != VISUAL_SPEC_VERSION:
            raise ValueError("unsupported visual spec version")
        return value

    @field_validator("message_markdown", "fallback_markdown")
    @classmethod
    def _plain_markdown(cls, value: str) -> str:
        return _reject_forbidden_text(value, "markdown")

    @model_validator(mode="after")
    def _has_real_visual_or_clear_fallback(self) -> "GeneratedVisualResponse":
        usable = [a for a in self.artifacts if a.artifact_kind != VisualArtifactKind.NONE]
        if not usable and not self.fallback_markdown.strip():
            raise ValueError("visual response needs a fallback")
        return self


def validate_visual_payload(payload: dict[str, Any], ref: QuestionRef) -> VisualizeResponse:
    """Validate a model payload and attach the server-owned source reference."""

    generated = GeneratedVisualResponse.model_validate(payload)
    artifacts: list[VisualArtifactOut] = []
    for artifact in generated.artifacts:
        _validate_artifact_text(artifact)
        if artifact.geogebra:
            _validate_geogebra(artifact.geogebra)
        if artifact.manim:
            _validate_manim(artifact.manim)
        # The model's opinion of these two fields is discarded unconditionally,
        # not merely distrusted: they are set later by the render pipeline
        # from a durable Storage path, never by generated JSON.
        artifact = artifact.model_copy(
            update={"video_storage_path": None, "video_url": None, "video_url_expires_in_seconds": None}
        )
        artifacts.append(artifact)

    usable = [a for a in artifacts if a.artifact_kind != VisualArtifactKind.NONE]
    return VisualizeResponse(
        visual_spec_version=VISUAL_SPEC_VERSION,
        message_markdown=generated.message_markdown,
        artifacts=usable,
        fallback_markdown=generated.fallback_markdown,
        source_reference=ref,
        validation_status=(
            VisualValidationStatus.VALIDATED
            if usable
            else VisualValidationStatus.RENDER_FAILED
        ),
    )


def fallback_response(ref: QuestionRef, reason: str) -> VisualizeResponse:
    detail = reason.strip() or "the generated visual did not match the safe visual contract"
    fallback = (
        "I could not build a trusted interactive visual for this turn, so I am "
        f"staying with a text explanation instead. Reason: {detail}."
    )
    return VisualizeResponse(
        message_markdown=fallback,
        artifacts=[],
        fallback_markdown=fallback,
        source_reference=ref,
        validation_status=VisualValidationStatus.RENDER_FAILED,
    )


def _validate_artifact_text(artifact: VisualArtifactOut) -> None:
    for field_name in ("title", "purpose", "narration_markdown", "accessibility_text"):
        _reject_forbidden_text(str(getattr(artifact, field_name)), field_name)
    if artifact.desmos:
        for expression in artifact.desmos.expressions:
            _reject_forbidden_text(expression.latex, "desmos expression")
            if expression.label:
                _reject_forbidden_text(expression.label, "desmos label")


def _validate_geogebra(spec: GeoGebraSpec) -> None:
    for command in spec.commands:
        if any(token in command for token in (";", "\n", "\r", "<", ">")):
            raise ValueError("GeoGebra command contains disallowed punctuation")
        _reject_forbidden_text(command, "geogebra command")
        stripped = command.strip()
        match = GEOGEBRA_COMMAND_PATTERN.match(stripped)
        if not match:
            raise ValueError(f"GeoGebra command is not in the allowed shape: {command}")
        command_name = match.group(1)
        if "=" in stripped:
            rhs = stripped.split("=", 1)[1].strip()
            constructor = re.match(r"^([A-Za-z][A-Za-z0-9_]*)\s*\(", rhs)
            if GEOGEBRA_SAFE_ASSIGNMENT_RHS.match(rhs):
                continue
            if not constructor or constructor.group(1) not in GEOGEBRA_ALLOWED_ASSIGNMENT_CONSTRUCTORS:
                raise ValueError("GeoGebra assignment must use a whitelisted constructor")
        elif command_name not in GEOGEBRA_ALLOWED_COMMANDS:
            raise ValueError(f"GeoGebra command is not whitelisted: {command_name}")


# A static AST-safety walk (safe_math.validate_expression) only says an
# expression's SHAPE is safe -- it says nothing about whether the expression
# is actually defined across the specific [x_min, x_max] a request supplies.
# Confirmed live: "y = 2x + 12/x^2" is a completely ordinary AST-safe
# expression, and the model chose a domain that spanned x = 0 -- which
# crashed the render subprocess outright with ZeroDivisionError partway
# through Manim's own plotting, because Axes.plot has no way to handle a
# genuine mathematical discontinuity inside its own x_range. The render path
# already drops a failed artifact and falls back to text (see main.py), so
# this was never unsafe -- but it wastes a real render attempt and produces
# text instead of the animation the student actually asked for, on a
# perfectly ordinary question.
#
# Sampling for an exact exception (ZeroDivisionError/ValueError/OverflowError)
# or a single huge/non-finite value is not enough on its own: a first version
# at 60 samples and a flat 1e6 magnitude cutoff MISSED the exact live failure
# this exists for. 60 evenly-spaced samples across [x_min=-6, x_max=2] never
# landed closer than ~0.02 to the x=0 singularity in "12/x^2", so the closest
# sampled value (~30,000) passed comfortably under a 1e6 cutoff -- only the
# RENDER's own, differently-spaced 100-sample grid happened to land exactly
# on zero. A denser grid alone does not fix this in general: a rational
# function's pole can sit arbitrarily close to a sample point without ever
# being sampled AT a "large enough" value to trip a flat magnitude cutoff.
#
# The reliable signal is not one huge sample, it is a SIGN FLIP between two
# ADJACENT samples that are BOTH already large in magnitude -- a genuine pole
# means the function runs to +infinity approaching from one side and
# -infinity from the other, which an ordinary continuous zero-crossing (e.g.
# sin(x) passing through zero) never does: there, the values near the
# crossing are small, not large. Both checks are kept: the flat magnitude/
# non-finite check catches a single-sided blow-up or an outright exception,
# and the sign-flip check catches a pole sitting between two samples that
# individually don't look extreme enough to trip the flat cutoff alone.
_MANIM_DOMAIN_SAMPLE_COUNT = 200
_MANIM_MAX_SAMPLE_MAGNITUDE = 1e4
_MANIM_POLE_INDICATOR_MAGNITUDE = 100


def _check_defined_over_domain(fn: Callable[[float], float], x_min: float, x_max: float, label: str) -> None:
    previous_x: float | None = None
    previous_y: float | None = None
    for i in range(_MANIM_DOMAIN_SAMPLE_COUNT):
        x = x_min + (x_max - x_min) * i / (_MANIM_DOMAIN_SAMPLE_COUNT - 1)
        try:
            y = fn(x)
        except (ZeroDivisionError, ValueError, OverflowError, TypeError) as error:
            # TypeError is included deliberately, not defensively: Python's **
            # silently returns a complex number for a negative float base
            # with a non-integer exponent (confirmed live), and float() of
            # that raises TypeError -- a real, reachable failure mode for
            # any fractional-power expression (e.g. "x^1.5") over a domain
            # that goes negative, without it ever being a ZeroDivisionError
            # or a math-domain ValueError.
            raise ValueError(f"{label} is undefined at x={x:g} within its stated domain") from error
        if not math.isfinite(y) or abs(y) > _MANIM_MAX_SAMPLE_MAGNITUDE:
            raise ValueError(f"{label} is not well-behaved at x={x:g} within its stated domain")
        if (
            previous_y is not None
            and abs(previous_y) > _MANIM_POLE_INDICATOR_MAGNITUDE
            and abs(y) > _MANIM_POLE_INDICATOR_MAGNITUDE
            and (previous_y > 0) != (y > 0)
        ):
            raise ValueError(
                f"{label} appears to have a singularity between x={previous_x:g} and x={x:g}"
            )
        previous_x, previous_y = x, y


# A cobweb diagram has a failure mode _check_defined_over_domain cannot see:
# the DISCRETE iterate sequence x0, g(x0), g(g(x0)), ... can wander outside
# the stated axis box, or hit an undefined value, even when g itself has no
# singularity anywhere in that box (the continuous curve plots fine; the
# specific sequence of points does not stay inside it). This is a genuinely
# different property from a pole in the curve -- it is only observable by
# actually running the iteration -- so it needs its own check rather than a
# reuse of _check_defined_over_domain.
_COBWEB_DOMAIN_PAD_FRACTION = 0.15
_COBWEB_MIN_PAD = 0.3


def _check_cobweb_iteration_is_plottable(
    fn: Callable[[float], float], x0: float, iterations: int, x_min: float, x_max: float
) -> None:
    pad = max((x_max - x_min) * _COBWEB_DOMAIN_PAD_FRACTION, _COBWEB_MIN_PAD)
    lo, hi = x_min - pad, x_max + pad
    x = x0
    for step in range(iterations):
        try:
            y = fn(x)
        except (ZeroDivisionError, ValueError, OverflowError, TypeError) as error:
            raise ValueError(f"g_expr is undefined evaluating iterate {step}") from error
        if not math.isfinite(y) or not (lo <= y <= hi):
            raise ValueError(
                f"the iteration leaves the stated x_min/x_max domain at step {step} "
                f"(g produced {y:g}); choose a wider domain or fewer iterations"
            )
        x = y


def _validate_manim(spec: ManimSpec) -> None:
    """The real safety boundary for Manim: every expression must be plain,
    bounded arithmetic before it is allowed anywhere near the renderer
    subprocess. models.ManimBoundedRegionParams/ManimTangentLineParams/
    ManimCobwebDiagramParams/ManimKinematicsParams already applied a coarse
    charset/length check; this is the one that actually matters, because it
    is the same node-whitelist walk the renderer itself uses to decide what
    it will evaluate. It also numerically samples the expression across its
    stated domain (see _check_defined_over_domain) -- a check that is not
    about safety, but about not wasting a render attempt on a domain that
    was never going to plot.

    ManimComplexTransformParams and ManimForceResultantParams are deliberately
    absent from the isinstance branches below -- not an oversight. Neither
    carries an expression string, so there is nothing for safe_math to walk;
    every invariant either needs (bounded moduli/arguments and a bounded
    resulting modulus for one, bounded magnitudes/angles and a bounded
    non-degenerate resultant for the other) is already enforced by their own
    Pydantic Field bounds and model_validator. They are the lowest-risk
    templates for exactly that reason -- `params` below never resolves to
    either one, since they are not included in the OR-chain, so this function
    is a no-op for both by construction, not by an empty branch.
    """
    params = (
        spec.region_sweep
        or spec.volume_of_revolution
        or spec.tangent_line
        or spec.cobweb_diagram
        or spec.kinematics_motion
    )
    if params is None:
        return
    try:
        if isinstance(params, ManimTangentLineParams):
            validate_expression(params.expr)
            fn = make_evaluator(params.expr)
            _check_defined_over_domain(fn, params.x_min, params.x_max, "expr")
        elif isinstance(params, ManimCobwebDiagramParams):
            validate_expression(params.g_expr)
            fn = make_evaluator(params.g_expr)
            _check_defined_over_domain(fn, params.x_min, params.x_max, "g_expr")
            _check_cobweb_iteration_is_plottable(
                fn, params.x0, params.iterations, params.x_min, params.x_max
            )
        elif isinstance(params, ManimKinematicsParams):
            # var_name="t": the same grammar as every other template, just a
            # different free-variable name (see safe_math.make_evaluator).
            validate_expression(params.expr, var_name="t")
            fn = make_evaluator(params.expr, var_name="t")
            _check_defined_over_domain(fn, params.t_min, params.t_max, "expr")
        else:
            validate_expression(params.lower_expr)
            lower_fn = make_evaluator(params.lower_expr)
            _check_defined_over_domain(lower_fn, params.x_min, params.x_max, "lower_expr")
            if params.upper_expr:
                validate_expression(params.upper_expr)
                upper_fn = make_evaluator(params.upper_expr)
                _check_defined_over_domain(upper_fn, params.x_min, params.x_max, "upper_expr")
    except UnsafeExpressionError as error:
        raise ValueError(f"manim expression rejected: {error}") from error


def _extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return json.loads(stripped)


def _part_summaries(context: QuestionContext) -> str:
    lines = []
    for part in context.parts:
        label = "".join(f"({p})" for p in (part.get("label_path") or []))
        prompt = str(part.get("prompt_markdown") or "").strip()
        if prompt:
            lines.append(f"- {label or '(whole question)'}: {prompt[:500]}")
    return "\n".join(lines) or "- No separate parts."


def build_visual_system_prompt(context: QuestionContext) -> str:
    return f"""You create safe, source-grounded interactive math visuals for Shamo.

Return ONLY one JSON object matching visual_spec_version "{VISUAL_SPEC_VERSION}".
Do not include markdown fences.

Allowed artifact kinds:
- desmos_2d for functions, inequalities, intersections, transformations, sliders, numerical methods, distributions.
- desmos_3d for simple 3D graphing.
- geogebra_graphing for graph constructions better handled by GeoGebra.
- geogebra_geometry for geometry, loci, vectors, Argand constructions.
- geogebra_3d for 3D constructions.
- manim_template_video for an ANIMATED sweep of the region between two curves/lines over an
  interval (template "region_sweep"), that same region spinning about the x-axis into a 3D
  solid (template "volume_of_revolution", for "find the volume when this region is rotated
  about the x-axis" questions), a point sweeping along a curve with its tangent line and
  live gradient value (template "tangent_line", for differentiation/gradient/tangent-line
  questions), a cobweb (staircase) diagram showing an iterative formula x_{{n+1}} = g(x_n)
  stepping between y=g(x) and y=x (template "cobweb_diagram", for "show that this iterative
  formula converges" / "use the iteration to find the root" numerical-methods questions), or a
  complex number's vector rotating and scaling as it is multiplied/divided by a second complex
  number, in modulus-argument form (template "complex_transform", for "find the product/quotient
  in exponential form" or "show why multiplying adds arguments" complex-number questions -- NOT
  for a locus/shaded-region question, see the Argand-locus rules below), or a particle's
  displacement/velocity-time graph shown in sync with a dot moving along a real number line
  representing its actual physical position on its track, with a live velocity or acceleration
  readout (template "kinematics_motion", for 9709 Mechanics kinematics questions that give an
  explicit s(t) or v(t) formula in one variable t -- this is NOT 2D projectile motion, 9709
  Mechanics at this level never uses a parametric (x(t),y(t)) trajectory), or several coplanar
  force vectors acting at one point resolved into horizontal/vertical components that are summed
  and combined into their resultant (template "force_resultant", for "find the magnitude and
  direction of the resultant force" statics questions). Use one of these seven templates ONLY --
  do not use manim_template_video for
  anything else, and prefer desmos_2d/geogebra whenever a static (non-animated) picture already
  teaches the idea, because Manim is slower to render.
- none when no trustworthy visual is appropriate.

Rules:
- Use only the SOURCE MATERIAL below.
- Do not reveal a full mark-by-mark solution; Visualize is concept-first.
- Prefer one artifact. Use at most two.
- Every visual must have title, purpose, narration_markdown, accessibility_text.
- Desmos specs may contain only expressions, optional sliderBounds/domain, colors, labels, and a bounded viewport.
- GeoGebra specs may contain only short English evalCommand strings from ordinary geometry/graphing commands.
- GeoGebra specs must put appName inside the geogebra object, and may use at most 18 commands even though the hard cap is 24.
- For GeoGebra points, prefer simple coordinate assignments such as "A=(0,0)" followed by whitelisted commands such as "Segment(A,B)".
- No JavaScript, HTML, URLs, uploads, arbitrary saved calculator state, or executable code.
- If the source is not enough to make a trustworthy visual, return artifacts: [] and explain the fallback.

The manim object (only for manim_template_video):
- "template" must be exactly "region_sweep", "volume_of_revolution", "tangent_line",
  "cobweb_diagram", "complex_transform", "kinematics_motion", or "force_resultant".
- Use the matching key for whichever template you chose -- never more than one of
  region_sweep/volume_of_revolution/tangent_line/cobweb_diagram/complex_transform/
  kinematics_motion/force_resultant in the same manim object.
- region_sweep and volume_of_revolution take the SAME parameters: lower_expr and optional
  upper_expr (plain arithmetic in x only -- digits, + - * / ^ ( ) and the functions
  sin/cos/tan/sqrt/exp/log/abs and the constants pi/e; NOTHING else, no other syntax of any
  kind), x_min, x_max, and optional lower_label/upper_label/region_color.
- If upper_expr is omitted, the region is between lower_expr and the x-axis (for
  volume_of_revolution this makes a solid disk shape rather than a hollow washer).
- Use volume_of_revolution specifically when the question asks for a volume formed by rotating
  a region about the x-axis. Do not use it just because a region happens to be shaded -- that
  is region_sweep's job.
- tangent_line takes: expr (the same plain x-arithmetic grammar as above), x_min, x_max,
  point_of_interest_x (the specific x-value the question is actually about -- e.g. "find the
  gradient of the curve at the point where x = 2" means point_of_interest_x = 2), and optional
  curve_label/curve_color. point_of_interest_x must sit clearly inside [x_min, x_max], not at
  or right next to either end, so the sweep has room either side of it.
- Use tangent_line for "find the gradient at this point" / "find the equation of the tangent"
  questions. Do not use it for a general "sketch/plot this curve" question with no specific
  point -- that is better served by desmos_2d.
- cobweb_diagram takes: g_expr (the plain x-arithmetic REARRANGED iteration formula, i.e. the g
  in x_{{n+1}} = g(x_n) -- NOT the original f(x) = 0 the question started from), x0 (the
  starting value), iterations (how many steps to animate, 2-10; prefer 5-6 unless the question
  asks for more decimal places of precision), x_min/x_max (an axis domain that contains x0 AND
  every value the iteration will actually produce, with room to spare -- see the singularity
  rule below), and optional g_label/curve_color.
- Use cobweb_diagram for "iterative formula", "converges to the root", "x_{{n+1}} = ..." style
  numerical-methods questions. Do not use it for a plain "solve f(x)=0" question with no stated
  iteration -- that has nothing to animate.
- complex_transform takes NO expression at all -- only plain numbers: start_modulus/
  start_argument (the STARTING complex number's modulus and argument in RADIANS as a plain
  decimal, e.g. z1 = 3e^((1/4)pi*i) means start_modulus=3, start_argument=0.7853981634 --
  NEVER write the argument as a string like "pi/4"), factor_modulus/factor_argument (the complex
  number z1 is being multiplied or divided by, e.g. z2 = 1.5e^((1/6)pi*i) means
  factor_modulus=1.5, factor_argument=0.5235987756), operation ("multiply" or "divide"), and
  optional start_label/factor_label/result_label/vector_color.
- Use complex_transform whenever a question gives complex numbers in modulus-argument or
  exponential form and asks about their product or quotient -- it shows WHY multiplying rotates
  by the argument and scales by the modulus, not just the final numeric answer. Do not use it
  for a locus/shaded-region question (see the Argand-locus rules further below) -- that is a
  static shape, not a rotation, and has nothing to do with this template.
- kinematics_motion takes: expr (plain arithmetic in t only -- same grammar as x elsewhere, but
  the variable must be written as "t", e.g. "3*t^1.5 - 6*t"; NEVER "x"), quantity ("s" if expr is
  displacement, "v" if expr is velocity -- default "s"), t_min (almost always 0 -- fractional
  powers of t such as t^1.5 are undefined for negative t, so t_min should essentially never be
  negative), t_max, time_of_interest_t (the specific time the question asks about, with the same
  "clearly inside t_min/t_max, not at either edge" margin rule as tangent_line's
  point_of_interest_x), optional s_at_t_min (only meaningful when quantity is "v" -- the
  particle's starting position, default 0, matching "starts from a point O" phrasing), and
  optional curve_label/curve_color.
- Use kinematics_motion for a 9709 Mechanics question giving an explicit s(t) or v(t) formula and
  asking about the particle's motion/velocity/acceleration at a specific time. This is 1D
  straight-line motion only -- do NOT use it for a 2D projectile/trajectory question, which has
  no template here and should fall back to a static desmos_2d picture or text.
- force_resultant takes NO expression at all -- only plain numbers: magnitudes (a list of 2-6
  positive force sizes in newtons, e.g. [45, 28, 72, 35]) and angles_degrees (the matching list of
  directions, SAME LENGTH and SAME ORDER as magnitudes, in ordinary mathematical degrees measured
  anticlockwise from the positive x-direction -- NOT a compass bearing, and NOT radians). Translate
  whatever the source diagram actually shows (an angle marked above/below a horizontal, a bearing,
  an angle between two named forces) into this convention yourself before writing the spec: e.g. a
  force drawn "50 degrees below the horizontal, pointing right" is angles_degrees = -50; a force
  drawn "60 degrees below the leftward horizontal" is angles_degrees = 180+60 = 240. Also optional:
  resultant_label/vector_color/resultant_color/horizontal_color/vertical_color.
- Use force_resultant for "find the magnitude and direction of the resultant force" questions
  where several coplanar forces act at one point -- it shows WHY the resultant is what it is by
  resolving each force into horizontal and vertical components (shown in two different colours),
  summing each set of components along its own axis, then combining the two totals into the
  resultant -- the same resolve-then-combine method the mark scheme itself uses, not just the
  final numeric answer. Do NOT use it for an "the system is in equilibrium, find the missing
  force/value" question -- there the resultant is by definition zero, which this template will
  reject, and the question has nothing meaningful to animate toward; a static
  desmos_2d/geogebra_geometry diagram or text is the right fallback there.
- Write "^" for powers (e.g. "x^2"), not "**", and write fractions as plain division (e.g.
  "0.5*x + 4/x"), never LaTeX \\frac.
- Choose x_min and x_max so the expression is DEFINED AND FINITE across the WHOLE domain
  between them, not just at the two endpoints. If the expression divides by x, or by any
  expression in x that can reach zero (e.g. "12/x^2", "4/x"), or takes sqrt/log of something
  that can go non-positive, keep the ENTIRE domain on ONE side of that problem value -- never
  let x_min and x_max sit on opposite sides of it. For example, for "2*x + 12/x^2" with the
  point of interest at x=-2, use a domain such as x_min=-6, x_max=-0.5 (both negative, away
  from the x=0 singularity) -- NOT x_min=-6, x_max=2, which would cross x=0 and fail to render.

Shading a bounded region in Desmos:
- Whenever the artifact's purpose involves an area, a region between curves/lines, or the
  interval used for an area/volume calculation, SHOW the region filled in, not just its two
  boundary curves. Prose describing the region is not a substitute for shading it.
- Desmos shades a region automatically when the expression itself is an inequality. To fill
  the area between a lower boundary lo(x) and an upper boundary hi(x) over an interval
  [a, b], add ONE expression shaped like:
  "lo(x) \\le y \\le hi(x) \\left\\{{a \\le x \\le b\\right\\}}"
  e.g. "\\frac{{1}}{{2}}x+\\frac{{4}}{{x}} \\le y \\le 4.5 \\left\\{{1 \\le x \\le 8\\right\\}}"
  shades exactly the region between that curve and that line for 1 <= x <= 8.
- Keep the plain boundary curves/lines as separate expressions too (so their equations are
  still labelled and visible); the inequality expression is an ADDITIONAL expression that
  shades the enclosed region, not a replacement for the boundary curves.
- If the region is bounded only above or below by a fixed line, use "y \\le hi(x)" or
  "y \\ge lo(x)" the same way, still with the "\\left\\{{...\\right\\}}" domain restriction so
  the shading does not spill outside the interval the question actually uses.

Normal-distribution probability questions:
- A normal-distribution probability question ("find P(a < X < b)" for X ~ N(mean, sd^2), or a
  one-sided version) does NOT need manim_template_video or a new template -- it is already just
  a region_sweep request. The normal probability density function is plain x-arithmetic
  (division, sqrt, exp, pi -- all already allowed), so write it out with the ACTUAL numeric
  mean and standard deviation substituted in as literals (never as symbols like "mu"/"sigma",
  since the expression grammar only knows the single variable x): for mean m and standard
  deviation s, the formula is "(1/(s*sqrt(2*pi))) * exp(-((x-m)^2)/(2*s^2))".
- Use this as region_sweep's lower_expr (no upper_expr -- the region is between the curve and
  the x-axis), with x_min/x_max set to the probability's bounds (for a one-sided probability
  such as P(X < a), use a few standard deviations below/above the mean as the other bound, e.g.
  mean - 4*sd, so the shaded region has a real left/right edge to sweep from).
- Example: "the weights are normally distributed with mean 155 g and standard deviation 6 g...
  how many bars weigh between 148 g and 160 g" becomes lower_expr =
  "(1/(6*sqrt(2*pi)))*exp(-((x-155)^2)/(2*6^2))", x_min=148, x_max=160.

Shading a complex-number locus (Argand diagram):
- A locus/region question about complex numbers z (e.g. "shade the region where |z-(3+i)|<=2
  and Re z<=2") is a STATIC shape, not a process -- nothing accumulates or rotates, so NEVER
  propose manim_template_video for this. Use desmos_2d (preferred) or geogebra_geometry.
- Substitute z = x + iy first, then translate each condition into an ordinary (x, y) condition:
  Re z (<=, >=, <, >) k becomes x (<=, >=, <, >) k; Im z ... k becomes y ... k.
  |z - (a+bi)| <= r becomes (x-a)^2 + (y-b)^2 \\le r^2 (a filled disk); with "=" instead of an
  inequality, it is just the boundary circle (x-a)^2+(y-b)^2=r^2, not filled.
  |z-(a+bi)| = |z-(c+di)| (equidistant from two fixed points) becomes the ordinary straight-line
  equation for their perpendicular bisector in x, y.
- When two conditions are combined with "and", shade their INTERSECTION as ONE Desmos expression
  using the SAME domain-restriction curly-brace syntax already used for an x-interval above,
  except the restriction clause is now the second inequality itself: for "Re z<=2 and
  |z-(3+i)|<=2", write "(x-3)^2+(y-1)^2 \\le 4 \\left\\{{x \\le 2\\right\\}}" -- this shades
  exactly their intersection, not two overlapping fills the student has to subtract visually.
  Keep the plain boundary circle/line as separate (unshaded) expressions too.
- If the condition instead involves arg(z - (a+bi)) (an angular/sector condition, e.g.
  "pi/4 <= arg(z-1-2i) <= 3pi/4"), there is no clean closed-form Cartesian inequality for it
  (it runs into the same branch-cut problem as atan2) -- use geogebra_geometry instead: place
  the vertex A=(a,b), then use the whitelisted Angle command with three points to construct the
  filled angular sector directly, combined with Circle(A, r) for any modulus condition in the
  same question.

JSON shape:
{{
  "visual_spec_version": "{VISUAL_SPEC_VERSION}",
  "message_markdown": "short student-facing explanation",
  "fallback_markdown": "text to show if the visual cannot render",
  "artifacts": [
    {{
      "artifact_kind": "desmos_2d",
      "title": "What changes as a moves?",
      "purpose": "Show how the parameter changes the curve.",
      "narration_markdown": "Drag $a$ and watch the turning point move.",
      "accessibility_text": "A coordinate graph with a slider a controlling the curve.",
      "part_label": "(a)",
      "desmos": {{
        "calculator": "graphing",
        "degreeMode": false,
        "viewport": {{"left": -5, "right": 5, "bottom": -5, "top": 5}},
        "expressions": [
          {{"id": "a", "latex": "a=1", "sliderBounds": {{"min": "-3", "max": "3", "step": "0.1"}}}},
          {{"id": "curve", "latex": "y=a x^2", "color": "#9DB4FF"}}
        ]
      }}
    }},
    {{
      "artifact_kind": "geogebra_geometry",
      "title": "Short construction",
      "purpose": "Show the key geometric relationship.",
      "narration_markdown": "Drag the labelled point and watch the related segment update.",
      "accessibility_text": "A GeoGebra construction with labelled points and a segment.",
      "geogebra": {{
        "appName": "geometry",
        "commands": ["A=(0,0)", "B=(3,0)", "Segment(A,B)", "ShowLabel(A,true)", "ShowLabel(B,true)"]
      }}
    }},
    {{
      "artifact_kind": "manim_template_video",
      "title": "Sweeping out the area under one curve",
      "purpose": "Animate only the region under the yellow curve filling in.",
      "narration_markdown": "Watch the shaded region sweep out as it fills between $x=1$ and $x=8$.",
      "accessibility_text": "An animation showing the region under a curve between x=1 and x=8 filling in with colour.",
      "manim": {{
        "template": "region_sweep",
        "region_sweep": {{
          "lower_expr": "0.5*x + 4/x",
          "x_min": 1,
          "x_max": 8,
          "lower_label": "y = 0.5x + 4/x",
          "region_color": "#F5C453"
        }}
      }}
    }},
    {{
      "artifact_kind": "manim_template_video",
      "title": "Rotating the region about the x-axis",
      "purpose": "Show the shaded region spinning into the 3D solid whose volume the question asks for.",
      "narration_markdown": "Watch the region between the curve and the line sweep through a full turn about the $x$-axis, forming the solid.",
      "accessibility_text": "An animation of a region between a curve and a line rotating about the x-axis to form a 3D solid.",
      "manim": {{
        "template": "volume_of_revolution",
        "volume_of_revolution": {{
          "lower_expr": "0.5*x + 4/x",
          "upper_expr": "4.5",
          "x_min": 1,
          "x_max": 8,
          "lower_label": "y = 0.5x + 4/x",
          "upper_label": "y = 4.5",
          "region_color": "#F5C453"
        }}
      }}
    }},
    {{
      "artifact_kind": "manim_template_video",
      "title": "Gradient along the curve",
      "purpose": "Show the tangent line and gradient value at the point the question asks about.",
      "narration_markdown": "Watch the tangent line pivot as the point moves, then settle at $x = 2$ to read off the gradient.",
      "accessibility_text": "An animation of a point sweeping along a curve with its tangent line and a live gradient readout, settling at x = 2.",
      "manim": {{
        "template": "tangent_line",
        "tangent_line": {{
          "expr": "x^2 - 3*x + 1",
          "x_min": -2,
          "x_max": 5,
          "point_of_interest_x": 2,
          "curve_label": "y = x^2 - 3x + 1"
        }}
      }}
    }},
    {{
      "artifact_kind": "manim_template_video",
      "title": "Cobweb diagram for the iteration",
      "purpose": "Show the staircase converging to the root using x_{{n+1}} = sqrt(4/(5-2x_n)) from x0 = 1.2.",
      "narration_markdown": "Watch the staircase step between $y=g(x)$ and $y=x$, settling near $x=1.28$.",
      "accessibility_text": "A cobweb diagram showing an iterative sequence converging to the intersection of y=g(x) and y=x.",
      "manim": {{
        "template": "cobweb_diagram",
        "cobweb_diagram": {{
          "g_expr": "sqrt(4/(5-2*x))",
          "x0": 1.2,
          "iterations": 6,
          "x_min": 0.5,
          "x_max": 2.0,
          "g_label": "g(x) = sqrt(4/(5-2x))"
        }}
      }}
    }},
    {{
      "artifact_kind": "manim_template_video",
      "title": "Multiplying two complex numbers",
      "purpose": "Show z1 rotating and scaling as it is multiplied by z2, landing on the product.",
      "narration_markdown": "Watch $z_1$ rotate by $\\\\arg(z_2)$ and scale by $|z_2|$ as it is multiplied by $z_2$.",
      "accessibility_text": "An animation of a complex number's vector rotating and scaling as it is multiplied by a second complex number, landing on their product.",
      "manim": {{
        "template": "complex_transform",
        "complex_transform": {{
          "start_modulus": 3,
          "start_argument": 0.7853981634,
          "factor_modulus": 1.5,
          "factor_argument": 0.5235987756,
          "operation": "multiply",
          "start_label": "z1",
          "factor_label": "z2",
          "result_label": "z1 z2"
        }}
      }}
    }},
    {{
      "artifact_kind": "manim_template_video",
      "title": "Position and motion in sync",
      "purpose": "Show the particle's actual position on its track moving in step with its displacement-time graph.",
      "narration_markdown": "Watch the dot on the track move exactly as fast as the graph's height changes -- the slope of the graph IS the particle's velocity.",
      "accessibility_text": "An animation of a displacement-time graph next to a real number line, both showing a dot moving in sync, with a live velocity readout.",
      "manim": {{
        "template": "kinematics_motion",
        "kinematics_motion": {{
          "expr": "3*t^1.5 - 6*t",
          "quantity": "s",
          "t_min": 0,
          "t_max": 6,
          "time_of_interest_t": 4,
          "curve_label": "s = 3t^1.5 - 6t"
        }}
      }}
    }},
    {{
      "artifact_kind": "manim_template_video",
      "title": "Adding the forces tip-to-tail",
      "purpose": "Show why joining the four forces tip-to-tail gives this particular resultant.",
      "narration_markdown": "Watch each force join on to the last, tip-to-tail -- the resultant is the single vector that closes the chain, straight back to the start.",
      "accessibility_text": "An animation of four force vectors joined tip-to-tail, with the resultant vector drawn from the start to the final tip.",
      "manim": {{
        "template": "force_resultant",
        "force_resultant": {{
          "magnitudes": [45, 28, 72, 35],
          "angles_degrees": [90, 35, -50, 240],
          "resultant_label": "R"
        }}
      }}
    }}
  ]
}}

SOURCE MATERIAL
===============
{build_source_block(context, asset_urls_available=True)}

PART SUMMARY
============
{_part_summaries(context)}
"""


class VisualizeService:
    def __init__(self, settings: Settings, client: OpenAI | None = None) -> None:
        self._settings = settings
        self._client = client or OpenAI(api_key=settings.openai_api_key)

    def create(
        self,
        *,
        context: QuestionContext,
        ref: QuestionRef,
        message: str,
        history: list[ChatTurn],
    ) -> VisualizeResponse:
        if context is None:  # pragma: no cover - defended by the API path
            raise ValueError("Refusing to visualize without question context.")

        trimmed = history[-self._settings.max_history_messages :]
        messages = [{"role": "system", "content": build_visual_system_prompt(context)}]
        messages += [{"role": turn.role, "content": turn.content} for turn in trimmed]
        messages.append({"role": "user", "content": message})

        try:
            response = self._client.chat.completions.create(
                model=self._settings.tutor_model,
                messages=messages,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content or ""
            payload = _extract_json_object(content)
            return validate_visual_payload(payload, ref)
        except (ValidationError, ValueError, json.JSONDecodeError) as error:
            logger.info("Visual spec rejected: %s", error)
            return fallback_response(
                ref,
                "the generated visual did not match Shamo's safe visual contract",
            )
        except Exception as error:  # noqa: BLE001
            logger.exception("Visualize call failed")
            raise VisualizeUnavailable(str(error)) from error


class VisualizeUnavailable(RuntimeError):
    """The provider could not be reached or refused the request."""
