"""Structured visual explanations.

Visuals are deliberately not streamed as prose. The model may propose a small
JSON spec, then this module validates it before the browser sees it. That keeps
Desmos/GeoGebra powerful enough to teach with sliders and constructions while
avoiding raw JavaScript, external URLs, or arbitrary saved calculator states.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .config import Settings
from .models import (
    ChatTurn,
    GeoGebraSpec,
    ManimSpec,
    QuestionRef,
    VisualArtifactKind,
    VisualArtifactOut,
    VisualValidationStatus,
    VisualizeResponse,
)
from .prompts import build_source_block
from .repository import QuestionContext
from .safe_math import UnsafeExpressionError, validate_expression

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


def _validate_manim(spec: ManimSpec) -> None:
    """The real safety boundary for Manim: every expression must be plain,
    bounded x-arithmetic before it is allowed anywhere near the renderer
    subprocess. models.ManimBoundedRegionParams already applied a coarse
    charset/length check; this is the one that actually matters, because it
    is the same node-whitelist walk the renderer itself uses to decide what
    it will evaluate. Both templates share this params shape (see
    ManimBoundedRegionParams), so one check covers both.
    """
    params = spec.region_sweep or spec.volume_of_revolution
    if params is None:
        return
    try:
        validate_expression(params.lower_expr)
        if params.upper_expr:
            validate_expression(params.upper_expr)
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
  interval (template "region_sweep"), or that same region spinning about the x-axis into a 3D
  solid (template "volume_of_revolution", for "find the volume when this region is rotated
  about the x-axis" questions). Use one of these two templates ONLY -- do not use
  manim_template_video for anything else, and prefer desmos_2d/geogebra whenever a static
  (non-animated) picture already teaches the idea, because Manim is slower to render.
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
- "template" must be exactly "region_sweep" or "volume_of_revolution".
- Use the matching key for whichever template you chose ("region_sweep" or
  "volume_of_revolution") -- never both, and never the other key.
- Both take the SAME parameters: lower_expr and optional upper_expr (plain arithmetic in x
  only -- digits, + - * / ^ ( ) and the functions sin/cos/tan/sqrt/exp/log/abs and the
  constants pi/e; NOTHING else, no other syntax of any kind), x_min, x_max, and optional
  lower_label/upper_label/region_color.
- If upper_expr is omitted, the region is between lower_expr and the x-axis (for
  volume_of_revolution this makes a solid disk shape rather than a hollow washer).
- Write "^" for powers (e.g. "x^2"), not "**", and write fractions as plain division (e.g.
  "0.5*x + 4/x"), never LaTeX \\frac.
- Use volume_of_revolution specifically when the question asks for a volume formed by rotating
  a region about the x-axis. Do not use it just because a region happens to be shaded -- that
  is region_sweep's job.

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
