"""KinematicsMotionScene: a particle's displacement/velocity-time graph shown
in sync with a dot moving along a REAL vertical number line representing its
actual physical position on its track -- the graph is not just an abstract
curve, it is a literal record of where the particle physically is at each
instant, and the graph's slope at a point is literally how fast the dot on
the line is moving at that instant.

Like every sibling template, this file is fixed and reviewed -- never
generated at request time -- and re-validates its own expression via
safe_math even though visualize._validate_manim already did. The one
difference from every sibling template: the free variable is "t", not "x"
(see safe_math.make_evaluator's var_name parameter, added specifically for
this template) -- the grammar itself is identical.

No MathTex/Tex is used here, for the same reason as every sibling template:
no LaTeX distribution is assumed present on the render host.

quantity says what expr represents:
  - quantity="s": expr IS position. The physical line reuses the graph's
    OWN y-axis scale exactly (same NumberLine range, same length, vertically
    centre-aligned) -- so the two dots' heights are IDENTICALLY the same
    value, not merely similar, which is the strongest version of the whole
    pedagogical point. A live "velocity" readout comes from a central finite
    difference of expr, the exact technique tangent_line.py already
    establishes for a derivative.
  - quantity="v": expr IS velocity. The graph still plots expr directly
    (a v(t) graph), but the physical line needs POSITION, which is a
    genuinely different quantity -- recovering it needs a one-time
    cumulative trapezoidal integration of expr over a dense sample grid
    (built once in construct(), the same "precompute once" convention every
    sibling template already uses for its own axis-range sampling), seeded
    by s_at_t_min. Because the two dots then represent different physical
    quantities, they get INDEPENDENT vertical scales and an explicit caption
    saying so, rather than an unexplained visual mismatch -- this project's
    own history is full of exactly that kind of unexplained-mismatch bug
    reading as broken. The live readout for this case is "acceleration",
    the central difference of expr itself.

Design, in two acts, mirroring the sibling templates: Act 1 sweeps both
dots together across the usable domain with a live rate readout; Act 2
settles at time_of_interest_t with a guide and label, reusing tangent_line's
already-fixed "anchor the label below whichever is lower, the axis or the
curve" rule verbatim -- a general labelling fix, not gradient-specific.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.manim_theme import ACCENT, BACKGROUND, GUIDE, INK, REGION_DEFAULT  # noqa: E402
from app.safe_math import make_evaluator  # noqa: E402

from manim import (  # noqa: E402
    DOWN,
    LEFT,
    PI,
    RIGHT,
    UP,
    Axes,
    Create,
    DashedLine,
    Dot,
    FadeIn,
    NumberLine,
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

DERIVATIVE_H = 1e-4
SWEEP_MARGIN_FRACTION = 0.12
INTEGRATION_SAMPLE_COUNT = 400


def _load_params() -> dict:
    path = os.environ.get("SHAMO_MANIM_PARAMS_PATH")
    if not path:
        raise RuntimeError("SHAMO_MANIM_PARAMS_PATH is not set")
    return json.loads(Path(path).read_text(encoding="utf-8"))


class KinematicsMotionScene(Scene):
    def construct(self) -> None:
        self.camera.background_color = BACKGROUND
        params = _load_params()
        t_min = float(params["t_min"])
        t_max = float(params["t_max"])
        time_of_interest = float(params["time_of_interest_t"])
        quantity = params.get("quantity", "s")
        s_at_t_min = float(params.get("s_at_t_min", 0.0))
        fn = make_evaluator(params["expr"], var_name="t")
        curve_color = params.get("curve_color") or REGION_DEFAULT

        def rate(t: float) -> float:
            return (fn(t + DERIVATIVE_H) - fn(t - DERIVATIVE_H)) / (2 * DERIVATIVE_H)

        sample_count = 100
        t_samples = [t_min + (t_max - t_min) * i / sample_count for i in range(sample_count + 1)]
        y_values = [fn(t) for t in t_samples]
        y_data_min, y_data_max = min(y_values), max(y_values)

        # quantity="v": recover position via a one-time cumulative
        # trapezoidal integration over a dense grid, then a linear-
        # interpolation lookup -- this is the only place this file departs
        # from re-evaluating fn directly, and it introduces no new
        # AST-whitelist surface: it is a numeric post-process of values fn
        # already produced, the same reasoning tangent_line.py gives for its
        # own central-difference derivative.
        if quantity == "v":
            grid_t = np.linspace(t_min, t_max, INTEGRATION_SAMPLE_COUNT)
            grid_v = np.array([fn(t) for t in grid_t])
            grid_s = s_at_t_min + np.concatenate(
                ([0.0], np.cumsum((grid_v[:-1] + grid_v[1:]) / 2 * np.diff(grid_t)))
            )

            def s_of_t(t: float) -> float:
                return float(np.interp(t, grid_t, grid_s))

            pos_min, pos_max = float(grid_s.min()), float(grid_s.max())
        else:
            s_of_t = fn
            pos_min, pos_max = y_data_min, y_data_max

        t_span = max(t_max - t_min, 1e-6)
        y_span = max(y_data_max - y_data_min, 1e-6)
        t_pad = max(t_span * 0.15, 0.3)
        y_pad = max(y_span * 0.25, 0.3)

        axis_t_min = min(0.0, t_min) - t_pad * 0.3
        axis_t_max = t_max + t_pad
        axis_y_min = min(0.0, y_data_min - y_pad)
        axis_y_max = y_data_max + y_pad
        t_step = max((axis_t_max - axis_t_min) / 8, 0.1)
        y_step = max((axis_y_max - axis_y_min) / 8, 0.1)

        axes = Axes(
            x_range=[axis_t_min, axis_t_max, t_step],
            y_range=[axis_y_min, axis_y_max, y_step],
            x_length=7.0,
            y_length=5.5,
            tips=False,
        ).to_edge(LEFT, buff=0.6)
        curve = axes.plot(fn, x_range=[t_min, t_max], color=curve_color)

        y_unit = "m" if quantity == "s" else "m/s"
        # Positioned so neither label can ever sit on the graph<->physical-line
        # connector's path: that dashed line is bound to stay within the axes'
        # own [axis_y_min, axis_y_max] box (it links a graph point to a line
        # point, both derived from fn's range), so keeping each label fully
        # outside that box vertically -- below the whole axes for x, above the
        # whole axes for y -- guarantees no crossing regardless of where the
        # sweep settles. A naive same-row placement was tried first and a real
        # render showed the connector cutting straight through "t (s)"
        # whenever the settled value landed near zero, which is a common
        # kinematics case (e.g. "when does the particle return to O").
        x_axis_label = Text("t (s)", font_size=20, color=INK)
        x_axis_label.next_to(axes, DOWN, buff=0.15).align_to(axes.x_axis.get_end(), RIGHT)
        # Offset UP from the y-axis's own top, not LEFT of it -- the y-axis
        # sits close to the frame's left edge already, and a LEFT offset
        # clipped the leading character off a longer unit string (confirmed
        # live: "v (m/s)" rendered as "(m/s)").
        y_axis_label = Text(f"{quantity} ({y_unit})", font_size=20, color=INK)
        y_axis_label.next_to(axes.y_axis.get_end(), UP, buff=0.15)
        axis_labels = VGroup(x_axis_label, y_axis_label)

        origin_label = VGroup()
        if axis_t_min < -1e-9 or axis_y_min < -1e-9:
            origin_label.add(Text("0", font_size=16, color=GUIDE).next_to(axes.c2p(0, 0), DOWN + LEFT, buff=0.1))

        curve_label_text = params.get("curve_label")
        curve_label = VGroup()
        if curve_label_text:
            curve_label.add(Text(str(curve_label_text), font_size=22, color=curve_color).to_edge(UP))

        # The physical line's own vertical scale: identical range/length to
        # the graph's y-axis when quantity="s" (so the two dots' heights are
        # exactly the same value), or its own independent range built from
        # the integrated position data when quantity="v" (a genuinely
        # different quantity from the graph's y-axis).
        if quantity == "v":
            pos_span = max(pos_max - pos_min, 1e-6)
            pos_pad = max(pos_span * 0.25, 0.3)
            line_min, line_max = pos_min - pos_pad, pos_max + pos_pad
        else:
            line_min, line_max = axis_y_min, axis_y_max
        line_step = max((line_max - line_min) / 8, 0.1)

        # A plain NumberLine is horizontal by default; rotate it vertical,
        # then align its centre with the graph axes' own centre height so
        # only the horizontal offset differs. When quantity="s" this range
        # is identical to the graph's own y-axis, so the two dots' heights
        # land on exactly the same pixel for the same value.
        physical_line = NumberLine(
            x_range=[line_min, line_max, line_step],
            length=axes.y_length,
            color=INK,
        ).rotate(PI / 2)
        physical_line.next_to(axes, RIGHT, buff=1.6)
        physical_line.set_y(axes.get_center()[1])

        track_label = Text("particle's position on its track", font_size=18, color=GUIDE).next_to(
            physical_line, UP, buff=0.2
        )
        quantity_note = VGroup()
        if quantity == "v":
            quantity_note.add(
                Text(
                    "(found by accumulating velocity over time)", font_size=14, color=GUIDE
                ).next_to(track_label, DOWN, buff=0.08)
            )

        # Mark O, the track's own origin (s=0), whenever it actually falls
        # inside the physical line's range -- the same "only show it if it's
        # really there" gate the graph's own origin_label already uses.
        track_origin = VGroup()
        if line_min - 1e-9 <= 0 <= line_max + 1e-9:
            origin_point = physical_line.n2p(0)
            track_origin.add(
                Dot(origin_point, color=GUIDE, radius=0.05),
                Text("O", font_size=18, color=GUIDE).next_to(origin_point, RIGHT, buff=0.15),
            )

        self.play(Create(axes), FadeIn(origin_label), FadeIn(axis_labels))
        self.play(Create(curve))
        if curve_label:
            self.play(FadeIn(curve_label))
        self.play(Create(physical_line), FadeIn(track_label), FadeIn(quantity_note), FadeIn(track_origin))

        margin = t_span * SWEEP_MARGIN_FRACTION
        sweep_start = t_min + margin
        sweep_end = t_max - margin
        if sweep_end <= sweep_start:
            sweep_start, sweep_end = t_min, t_max

        sweep_t = ValueTracker(sweep_start)

        graph_dot = always_redraw(
            lambda: Dot(axes.c2p(sweep_t.get_value(), fn(sweep_t.get_value())), color=ACCENT, radius=0.07)
        )
        line_dot = always_redraw(
            lambda: Dot(physical_line.n2p(s_of_t(sweep_t.get_value())), color=ACCENT, radius=0.07)
        )

        connector = VGroup()
        if quantity == "s":
            # Same quantity, same y-pixel by construction: a direct
            # horizontal dashed connector is meaningful here.
            connector.add(
                always_redraw(
                    lambda: DashedLine(
                        axes.c2p(sweep_t.get_value(), fn(sweep_t.get_value())),
                        physical_line.n2p(s_of_t(sweep_t.get_value())),
                        color=GUIDE,
                        stroke_width=1.5,
                        dash_length=0.06,
                    )
                )
            )
        else:
            # Different quantities: no direct dot-to-dot line (it would
            # imply a false equivalence). A drop-line to the time axis plus
            # a shared "t = ..." readout ties the same instant together
            # instead.
            connector.add(
                always_redraw(
                    lambda: DashedLine(
                        axes.c2p(sweep_t.get_value(), 0),
                        axes.c2p(sweep_t.get_value(), fn(sweep_t.get_value())),
                        color=GUIDE,
                        stroke_width=1.5,
                        dash_length=0.06,
                    )
                )
            )

        rate_word = "acceleration" if quantity == "v" else "velocity"
        rate_unit = "m/s^2" if quantity == "v" else "m/s"
        readout = always_redraw(
            lambda: Text(
                f"{rate_word} = {rate(sweep_t.get_value()):.2f} {rate_unit}", font_size=22, color=INK
            ).to_edge(DOWN)
        )

        self.add(connector, graph_dot, line_dot, readout)
        self.wait(0.2)
        self.play(sweep_t.animate.set_value(sweep_end), run_time=2.4, rate_func=linear)
        self.wait(0.2)
        self.play(sweep_t.animate.set_value(time_of_interest), run_time=1.1)
        self.wait(0.3)

        label_anchor_y = min(0.0, fn(time_of_interest))
        point_guide = DashedLine(
            axes.c2p(time_of_interest, 0),
            axes.c2p(time_of_interest, fn(time_of_interest)),
            color=GUIDE,
            stroke_width=2.0,
            dash_length=0.08,
        )
        t_label = Text(f"t = {time_of_interest:g}", font_size=18, color=INK).next_to(
            axes.c2p(time_of_interest, label_anchor_y), DOWN, buff=0.2
        )
        self.play(Create(point_guide), FadeIn(t_label))
        self.wait(1.2)
