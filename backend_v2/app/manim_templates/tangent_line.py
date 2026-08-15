"""TangentLineScene: sweeps a point (and its tangent line) along a curve,
demonstrating that the gradient changes continuously, before settling on the
specific x-value the source question is actually about.

Like region_sweep.py and volume_of_revolution.py, this file is fixed and
reviewed -- never generated at request time. Parameters are loaded from a
JSON file (path in SHAMO_MANIM_PARAMS_PATH, written by manim_renderer) and
the one arithmetic expression is walked against safe_math's ast whitelist
again here, even though visualize._validate_manim already did so, for the
same reason the other two templates do: a closure that outlives that check
is exactly the kind of thing that gets reused somewhere the check was
skipped.

The gradient is never computed symbolically. safe_math's evaluator only
computes f(x) -- teaching it to also differentiate expressions would be new,
security-relevant AST-whitelist surface for a template that does not need
it. Instead this file takes a central finite difference of the already-
validated f(x) evaluator, (f(x+h) - f(x-h)) / (2h) with a small fixed h. This
is accurate to well beyond the number of decimal places anything here
displays, and there is no requirement that the displayed gradient be exact
to more precision than a student would reach by hand -- reusing the one
evaluator this file already trusts is worth more than that extra precision
would be.

Colors and the no-MathTex/plain-Text rule are inherited unchanged from
region_sweep.py's own established reasoning (see that file's docstring) --
this scene evaluates and displays a numeric gradient with an ordinary Text
mobject rather than typeset notation, for the same reason: no system LaTeX
distribution is assumed to be present.

Design, in two acts, mirroring the "show the general method, then the
specific answer" shape both sibling templates already use (region_sweep's
Riemann-rectangle lead-in, volume_of_revolution's Act 1/Act 2 split):

  Act 1 -- the point and its tangent line sweep continuously across the
  usable domain (away from the exact endpoints, so the tangent line always
  has room to draw either side of the point), with a live "gradient = ..."
  readout, demonstrating that the gradient is a genuinely different number
  at different points on the curve.

  Act 2 -- the sweep then moves, in one direct motion, to the specific
  point_of_interest_x the source question is about, and holds there with a
  dashed guide and an "x = ..." label naming it -- the same guide/label
  convention region_sweep.py already uses for its own boundary x-values.

This is a plain 2D Scene, not a ThreeDScene: there is no camera move and the
always_redraw mobjects here (a Dot, a short Line, one line of Text) are cheap
enough per frame that volume_of_revolution.py's "freeze before dwell"
optimization (needed there because a full 3D Surface mesh is expensive to
recompute every frame) has no equivalent need here.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.manim_theme import ACCENT, BACKGROUND, GUIDE, INK, REGION_DEFAULT  # noqa: E402
from app.safe_math import make_evaluator  # noqa: E402

from manim import (  # noqa: E402
    DOWN,
    LEFT,
    UP,
    Axes,
    Create,
    DashedLine,
    Dot,
    FadeIn,
    Line,
    Scene,
    Text,
    VGroup,
    ValueTracker,
    always_redraw,
    config,
    linear,
)

try:
    import imageio_ffmpeg

    config.ffmpeg_executable = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # noqa: BLE001 - fall back to a system ffmpeg if one exists
    pass

# Central-difference step for the numerical derivative. Small relative to
# any realistic exam-question domain, and safe_math's evaluator has no
# sensitivity to a step this size introducing its own numerical noise for
# the plain polynomial/trig/exp/log expressions this template is scoped to.
DERIVATIVE_H = 1e-4

# The sweep in Act 1 stays this fraction of the x-span away from x_min/x_max
# on each side, so the tangent line (itself drawn this same fraction of the
# span wide, split evenly either side of the point) never has to draw past
# the edge of the plotted curve.
SWEEP_MARGIN_FRACTION = 0.12


def _load_params() -> dict:
    path = os.environ.get("SHAMO_MANIM_PARAMS_PATH")
    if not path:
        raise RuntimeError("SHAMO_MANIM_PARAMS_PATH is not set")
    return json.loads(Path(path).read_text(encoding="utf-8"))


class TangentLineScene(Scene):
    def construct(self) -> None:
        self.camera.background_color = BACKGROUND
        params = _load_params()
        x_min = float(params["x_min"])
        x_max = float(params["x_max"])
        point_x = float(params["point_of_interest_x"])
        fn = make_evaluator(params["expr"])
        curve_color = params.get("curve_color") or REGION_DEFAULT

        def slope(x: float) -> float:
            return (fn(x + DERIVATIVE_H) - fn(x - DERIVATIVE_H)) / (2 * DERIVATIVE_H)

        sample_count = 100
        y_values = [fn(x_min + (x_max - x_min) * i / sample_count) for i in range(sample_count + 1)]
        y_data_min, y_data_max = min(y_values), max(y_values)

        x_span = max(x_max - x_min, 1e-6)
        y_span = max(y_data_max - y_data_min, 1e-6)
        x_pad = max(x_span * 0.15, 0.3)
        y_pad = max(y_span * 0.25, 0.3)

        # Same origin-inclusive axis-padding convention as region_sweep.py:
        # the frame extends to the origin so the picture has a fixed
        # reference point, even though the curve itself is only ever drawn
        # over [x_min, x_max].
        axis_x_min = min(0.0, x_min) - x_pad * 0.3
        axis_x_max = x_max + x_pad
        axis_y_min = min(0.0, y_data_min - y_pad)
        axis_y_max = y_data_max + y_pad
        x_step = max((axis_x_max - axis_x_min) / 8, 0.1)
        y_step = max((axis_y_max - axis_y_min) / 8, 0.1)

        axes = Axes(
            x_range=[axis_x_min, axis_x_max, x_step],
            y_range=[axis_y_min, axis_y_max, y_step],
            tips=False,
        )
        curve = axes.plot(fn, x_range=[x_min, x_max], color=curve_color)

        origin_label = VGroup()
        if x_min > 1e-9 or y_data_min > 1e-9:
            origin_label.add(Text("0", font_size=18, color=GUIDE).next_to(axes.c2p(0, 0), DOWN + LEFT, buff=0.12))

        curve_label_text = params.get("curve_label")
        curve_label = VGroup()
        if curve_label_text:
            curve_label.add(Text(str(curve_label_text), font_size=24, color=curve_color).to_edge(UP))

        self.play(Create(axes), FadeIn(origin_label))
        self.play(Create(curve))
        if curve_label:
            self.play(FadeIn(curve_label))

        margin = x_span * SWEEP_MARGIN_FRACTION
        sweep_start = x_min + margin
        sweep_end = x_max - margin
        if sweep_end <= sweep_start:
            # A narrow domain with a large margin fraction could invert the
            # range; fall back to the full domain rather than produce an
            # animate.set_value that runs backwards.
            sweep_start, sweep_end = x_min, x_max

        half_width = max(x_span * SWEEP_MARGIN_FRACTION, x_span * 0.05)

        sweep_x = ValueTracker(sweep_start)

        def tangent_line_at(x0: float) -> Line:
            y0 = fn(x0)
            m = slope(x0)
            return Line(
                axes.c2p(x0 - half_width, y0 - m * half_width),
                axes.c2p(x0 + half_width, y0 + m * half_width),
                color=ACCENT,
                stroke_width=4,
            )

        tangent = always_redraw(lambda: tangent_line_at(sweep_x.get_value()))
        point = always_redraw(
            lambda: Dot(axes.c2p(sweep_x.get_value(), fn(sweep_x.get_value())), color=ACCENT, radius=0.08)
        )
        gradient_readout = always_redraw(
            lambda: Text(
                f"gradient = {slope(sweep_x.get_value()):.2f}",
                font_size=24,
                color=INK,
            ).to_edge(DOWN)
        )

        self.add(tangent, point, gradient_readout)
        self.wait(0.2)
        # Act 1: sweep continuously across the usable domain, showing the
        # gradient is a genuinely different number at different points.
        self.play(sweep_x.animate.set_value(sweep_end), run_time=2.4, rate_func=linear)
        self.wait(0.2)
        # Act 2: move directly to the specific point the question is about.
        self.play(sweep_x.animate.set_value(point_x), run_time=1.1)
        self.wait(0.3)

        point_guide = DashedLine(
            axes.c2p(point_x, 0),
            axes.c2p(point_x, fn(point_x)),
            color=GUIDE,
            stroke_width=2.0,
            dash_length=0.08,
        )
        # Anchored below whichever is lower, the x-axis or the curve point
        # itself -- not unconditionally the axis. A real render caught this:
        # when f(point_x) sits close to 0 (the point of interest is near a
        # root, a common real question shape), anchoring to the axis alone
        # put this label right on top of the dot and tangent line, which
        # were drawn at the curve's own (lower) height.
        label_anchor_y = min(0.0, fn(point_x))
        point_x_label = Text(f"x = {point_x:g}", font_size=20, color=INK).next_to(
            axes.c2p(point_x, label_anchor_y), DOWN, buff=0.2
        )
        self.play(Create(point_guide), FadeIn(point_x_label))
        self.wait(1.2)
