"""ComplexTransformScene: a complex number's vector rotating and scaling as
it is multiplied or divided by a second complex number, landing on the
product/quotient -- the visual answer to "why does multiplying complex
numbers add their arguments and multiply their moduli".

Unlike every other template here, there is no expression string at all and
so no involvement from safe_math whatsoever: the model supplies only
bounded moduli/arguments (see models.ManimComplexTransformParams), already
fully checked by ordinary Pydantic Field bounds before this process is ever
started. This file has nothing left to re-validate for safety -- there is
no arithmetic string a student-facing formula could hide inside.

No MathTex/Tex is used here, for the same reason as every sibling template:
no LaTeX distribution is assumed present on the render host.

Axes are square with a SYMMETRIC [-R, R] range on both axes (R chosen from
the actual starting/resulting moduli) -- this is the one genuinely new
geometry risk this template introduces. A true rotation would render as a
visually-stretched sweep if the x-axis and y-axis were scaled differently,
the same class of correctness bug volume_of_revolution.py's own docstring
already had to reason through once for a circular cross-section. Because
the range is symmetric about 0 and the axes are never shifted, axes.c2p(0,0)
coincides with the scene's true ORIGIN, so every vector here is built
directly with axes.c2p(x, y) as its endpoint and ORIGIN as its (implicit)
start -- no separate origin-alignment work needed, unlike a template whose
axes are not centred on zero.

Design, in three parts:

  Act 1a/1b -- the starting vector z1 and the multiplier/divisor w are drawn
  as two SEPARATE vectors from the origin, each with its own argument arc
  and modulus/argument readout, and a caption naming what is about to
  happen ("multiplying by w rotates by arg(w) and scales by |w|") -- shown
  and dwelt on BEFORE any transformation starts, so w's role is explicit
  rather than an instant, unexplained jump.

  Act 2 -- a copy of z1 sweeps continuously toward the result. The modulus
  is interpolated GEOMETRICALLY (scale_k ** t), not linearly: this traces a
  true logarithmic/equiangular spiral, the actual curve you get in the
  limit of applying "1/N of the transformation" N times as N -> infinity --
  not an arbitrary-looking straight-line blend of magnitude and angle. A
  TracedPath makes the spiral visible, plus a live rotation-so-far angle
  and a live modulus/argument readout.

  Act 3 -- freeze on the exact result (swap the always_redraw mobjects for
  one-off static ones, the same "freeze before dwell" convention
  volume_of_revolution.py already uses), with a label naming the final
  modulus/argument.
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.manim_theme import ACCENT, BACKGROUND, GUIDE, INK, REGION_DEFAULT  # noqa: E402

from manim import (  # noqa: E402
    DOWN,
    LEFT,
    ORIGIN,
    RIGHT,
    UP,
    Angle,
    Axes,
    Create,
    FadeIn,
    FadeOut,
    Line,
    Scene,
    Text,
    TracedPath,
    ValueTracker,
    Vector,
    VGroup,
    always_redraw,
    config,
)

try:
    import imageio_ffmpeg

    config.ffmpeg_executable = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # noqa: BLE001 - fall back to a system ffmpeg if one exists
    pass

SWEEP_RUN_TIME = 2.0
ARC_RADIUS = 0.4


def _load_params() -> dict:
    path = os.environ.get("SHAMO_MANIM_PARAMS_PATH")
    if not path:
        raise RuntimeError("SHAMO_MANIM_PARAMS_PATH is not set")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _point(modulus: float, argument: float) -> tuple[float, float]:
    return modulus * math.cos(argument), modulus * math.sin(argument)


def _fmt(modulus: float, argument: float) -> str:
    return f"|z| = {modulus:.2f}, arg(z) = {argument:.2f} rad"


def _label_near_tip(text: str, color: str, vector_end, argument: float):
    # Offset ALONG the vector's own direction (continuing past the
    # arrowhead), not a fixed screen direction like UP -- two vectors with
    # different arguments then get labels that spread apart along their own
    # distinct rays. A real render with UP for both z1 and z2 showed their
    # labels and angle arcs crowding together when the two arguments were
    # close (pi/4 and pi/6): a fixed direction pulls both labels toward the
    # same screen region regardless of how different the two angles are.
    direction = np.array([math.cos(argument), math.sin(argument), 0.0])
    return Text(text, font_size=22, color=color).next_to(vector_end, direction, buff=0.15)


class ComplexTransformScene(Scene):
    def construct(self) -> None:
        self.camera.background_color = BACKGROUND
        params = _load_params()
        start_modulus = float(params["start_modulus"])
        start_argument = float(params["start_argument"])
        factor_modulus = float(params["factor_modulus"])
        factor_argument = float(params["factor_argument"])
        operation = params.get("operation", "multiply")
        vector_color = params.get("vector_color") or REGION_DEFAULT

        if operation == "divide":
            delta_theta = -factor_argument
            scale_k = 1.0 / factor_modulus
        else:
            delta_theta = factor_argument
            scale_k = factor_modulus

        result_modulus = start_modulus * scale_k
        result_argument = start_argument + delta_theta

        span_radius = max(start_modulus, result_modulus, factor_modulus) * 1.15
        step = max(span_radius / 5, 0.5)

        axes = Axes(
            x_range=[-span_radius, span_radius, step],
            y_range=[-span_radius, span_radius, step],
            x_length=6.0,
            y_length=6.0,
            tips=False,
        )
        re_label = Text("Re", font_size=20, color=GUIDE).next_to(axes.c2p(span_radius, 0), RIGHT, buff=0.1)
        im_label = Text("Im", font_size=20, color=GUIDE).next_to(axes.c2p(0, span_radius), UP, buff=0.1)
        self.play(Create(axes), FadeIn(re_label), FadeIn(im_label))

        # A geometric helper only -- never added to the scene -- so Angle
        # has a fixed "positive real axis" direction to measure every arc
        # against.
        positive_re_axis = Line(ORIGIN, axes.c2p(1, 0))

        start_point = axes.c2p(*_point(start_modulus, start_argument))
        start_vector = Vector(start_point, color=vector_color)
        start_arc = Angle(positive_re_axis, Line(ORIGIN, start_point), radius=ARC_RADIUS, color=GUIDE)
        # DOWN, not UP: a real render showed the axis's own "Im" label
        # (just above the y-axis) overlapping a readout placed at
        # .to_edge(UP) -- the axes only occupy the middle portion of the
        # frame, so its top tick sits close to where to_edge(UP) also
        # lands. DOWN matches the live/final readouts below and is never
        # simultaneously visible with the rule_caption that also uses it.
        start_readout = Text(_fmt(start_modulus, start_argument), font_size=20, color=INK).to_edge(DOWN)
        start_label_text = params.get("start_label")
        start_tip_label = VGroup()
        if start_label_text:
            start_tip_label.add(
                _label_near_tip(str(start_label_text), vector_color, start_vector.get_end(), start_argument)
            )

        self.play(Create(start_vector), Create(start_arc))
        self.play(FadeIn(start_readout), FadeIn(start_tip_label))
        self.wait(0.3)

        # The multiplier/divisor gets its OWN separate vector from the
        # origin, dwelt on before any transformation starts, so its role
        # (rotate by its argument, scale by its modulus) is explicit rather
        # than an unexplained instant jump.
        factor_point = axes.c2p(*_point(factor_modulus, factor_argument))
        factor_vector = Vector(factor_point, color=GUIDE)
        factor_arc = Angle(positive_re_axis, Line(ORIGIN, factor_point), radius=ARC_RADIUS * 1.4, color=GUIDE)
        factor_label_text = params.get("factor_label")
        factor_tip_label = VGroup()
        if factor_label_text:
            factor_tip_label.add(
                _label_near_tip(str(factor_label_text), GUIDE, factor_vector.get_end(), factor_argument)
            )
        verb = "dividing" if operation == "divide" else "multiplying"
        rule_caption = Text(
            f"{verb} by w rotates by arg(w) and scales by |w|", font_size=22, color=INK
        ).to_edge(DOWN)

        self.play(FadeOut(start_readout))
        self.play(Create(factor_vector), Create(factor_arc), FadeIn(factor_tip_label))
        self.play(FadeIn(rule_caption))
        self.wait(0.6)
        self.play(
            FadeOut(factor_vector), FadeOut(factor_arc), FadeOut(factor_tip_label), FadeOut(rule_caption)
        )

        # Act 2: sweep a copy of z1 toward the result. The modulus is
        # interpolated GEOMETRICALLY (scale_k ** t), tracing a true
        # logarithmic spiral -- not a linear blend of magnitude and angle.
        sweep_t = ValueTracker(0.0)

        def current_point() -> tuple[float, float]:
            t = sweep_t.get_value()
            modulus = start_modulus * (scale_k**t)
            argument = start_argument + t * delta_theta
            return _point(modulus, argument)

        moving_vector = always_redraw(lambda: Vector(axes.c2p(*current_point()), color=ACCENT))
        path = TracedPath(moving_vector.get_end, stroke_color=ACCENT, stroke_width=3, stroke_opacity=0.7)
        live_arc = always_redraw(
            lambda: Angle(
                Line(ORIGIN, start_point), Line(ORIGIN, axes.c2p(*current_point())), radius=ARC_RADIUS, color=GUIDE
            )
        )
        live_readout = always_redraw(
            lambda: Text(
                _fmt(*(lambda p=current_point(): (math.hypot(*p), math.atan2(p[1], p[0])))()),
                font_size=20,
                color=INK,
            ).to_edge(DOWN)
        )

        self.add(path, live_arc, moving_vector, live_readout)
        self.play(sweep_t.animate.set_value(1.0), run_time=SWEEP_RUN_TIME, rate_func=lambda t: t)
        self.wait(0.3)

        # Act 3: freeze on the exact result.
        self.remove(moving_vector, live_arc, live_readout)
        result_point = axes.c2p(*_point(result_modulus, result_argument))
        final_vector = Vector(result_point, color=ACCENT)
        final_arc = Angle(positive_re_axis, Line(ORIGIN, result_point), radius=ARC_RADIUS, color=GUIDE)
        final_readout = Text(_fmt(result_modulus, result_argument), font_size=20, color=INK).to_edge(DOWN)
        result_label_text = params.get("result_label")
        result_tip_label = VGroup()
        if result_label_text:
            result_tip_label.add(
                _label_near_tip(str(result_label_text), ACCENT, final_vector.get_end(), result_argument)
            )
        self.add(final_vector, final_arc)
        self.play(FadeIn(final_readout), FadeIn(result_tip_label))
        self.wait(1.0)
