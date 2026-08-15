"""CobwebDiagramScene: a staircase (cobweb) diagram for an iterative formula
x_{n+1} = g(x_n), stepping between the curve y=g(x) and the reference line
y=x, converging (or, if the source deliberately shows a bad rearrangement,
visibly failing to converge) toward the fixed point where they cross.

Like the other three templates, this file is fixed and reviewed -- never
generated at request time. Parameters are loaded from a JSON file (path in
SHAMO_MANIM_PARAMS_PATH, written by manim_renderer) and g_expr is walked
against safe_math's ast whitelist again here (via make_evaluator), even
though visualize._validate_manim already validated it and additionally
proved the discrete iterate sequence stays inside x_min/x_max -- that
business-level check happens once, before rendering; re-validating the
expression's SAFETY here follows the same "a closure that outlives the
check is exactly the kind of thing that gets reused somewhere the check was
skipped" reasoning region_sweep.py/tangent_line.py already give.

No MathTex/Tex is used here, for the same reason as every sibling template:
no LaTeX distribution is assumed present on the render host.

Axes are deliberately SQUARE (equal x_length/y_length, one shared numeric
range used for both x_range and y_range) -- this is the one genuinely new
geometry risk this template introduces. If the x-axis and y-axis were scaled
differently (as Axes does by default when their ranges differ), the line
y=x would not visually read as a 45-degree diagonal, which actively
misrepresents the one fact ("the sequence converges where g(x) crosses x")
this whole diagram exists to teach -- the same class of correctness bug
volume_of_revolution.py's own docstring already had to reason through once
for a circular cross-section. The shared range is computed from the ACTUAL
data (x_min/x_max, x0, every iterate, and g's own sampled value range over
[x_min, x_max]), not just x_min/x_max alone, so a curve whose values swing
outside the x-domain still fits inside the square frame.

Design, in two acts, mirroring the "general method, then the specific
answer" shape the sibling templates already use:

  Act 1 -- one full step (evaluate g(x0), then read across to y=x) is shown
  slowly, captioned, so the MECHANISM is explicit before the pace picks up.

  Act 2 -- the remaining steps run quickly as a single Succession, the
  staircase visibly narrowing (or wandering, for a deliberately divergent
  case) toward wherever g(x) and y=x actually cross, ending on a held,
  labelled final value.

y=x gets its own explicit reveal beat (a Create plus a "y = x" label placed
near the line's own end, not a global screen edge) before the staircase
begins, so its role as the comparison line is unmissable rather than an
unexplained second line already sitting on screen.
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
    RIGHT,
    UP,
    Axes,
    Create,
    Dot,
    DashedLine,
    FadeIn,
    FadeOut,
    Scene,
    Succession,
    Text,
    TracedPath,
    VGroup,
    config,
)

try:
    import imageio_ffmpeg

    config.ffmpeg_executable = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # noqa: BLE001 - fall back to a system ffmpeg if one exists
    pass

# Padding fraction/floor mirror visualize._check_cobweb_iteration_is_plottable's
# own pad, so the axis frame this scene builds is at least as generous as the
# domain the validation step already proved the whole iterate sequence fits
# inside.
DOMAIN_PAD_FRACTION = 0.15
MIN_PAD = 0.3

# One slow step in Act 1, then this many remaining steps run quickly in Act 2.
ACT1_STEP_RUN_TIME = 0.8
ACT2_STEP_RUN_TIME = 0.3


def _load_params() -> dict:
    path = os.environ.get("SHAMO_MANIM_PARAMS_PATH")
    if not path:
        raise RuntimeError("SHAMO_MANIM_PARAMS_PATH is not set")
    return json.loads(Path(path).read_text(encoding="utf-8"))


class CobwebDiagramScene(Scene):
    def construct(self) -> None:
        self.camera.background_color = BACKGROUND
        params = _load_params()
        x_min = float(params["x_min"])
        x_max = float(params["x_max"])
        x0 = float(params["x0"])
        iterations = int(params["iterations"])
        fn = make_evaluator(params["g_expr"])
        curve_color = params.get("curve_color") or REGION_DEFAULT

        xs = [x0]
        for _ in range(iterations):
            xs.append(fn(xs[-1]))

        sample_count = 100
        g_values = [fn(x_min + (x_max - x_min) * i / sample_count) for i in range(sample_count + 1)]

        data_min = min([x_min, x0, *xs, *g_values])
        data_max = max([x_max, x0, *xs, *g_values])
        span = max(data_max - data_min, 1e-6)
        pad = max(span * DOMAIN_PAD_FRACTION, MIN_PAD)
        plot_min = data_min - pad
        plot_max = data_max + pad
        plot_span = plot_max - plot_min
        step = max(plot_span / 8, 0.1)

        # Square: same range, same length, on both axes -- this is what makes
        # y=x genuinely read as a 45-degree diagonal.
        axes = Axes(
            x_range=[plot_min, plot_max, step],
            y_range=[plot_min, plot_max, step],
            x_length=6.0,
            y_length=6.0,
            tips=False,
        )
        g_curve = axes.plot(fn, x_range=[x_min, x_max], color=curve_color)
        diagonal = axes.plot(lambda v: v, x_range=[plot_min, plot_max], color=GUIDE, stroke_width=2.0)

        origin_label = VGroup()
        if plot_min < -1e-9 or plot_min > 1e-9:
            origin_label.add(Text("0", font_size=18, color=GUIDE).next_to(axes.c2p(0, 0), DOWN + LEFT, buff=0.12))

        g_label_text = params.get("g_label")
        g_label = VGroup()
        if g_label_text:
            g_label.add(Text(str(g_label_text), font_size=24, color=curve_color).to_edge(UP))

        self.play(Create(axes), FadeIn(origin_label))
        self.play(Create(g_curve))
        if g_label:
            self.play(FadeIn(g_label))

        # y=x gets its own explicit reveal, labelled near its own end (not a
        # global screen edge) so it never collides with g_label at the top.
        diagonal_label = Text("y = x", font_size=22, color=GUIDE).next_to(
            axes.c2p(plot_max, plot_max), UP + LEFT, buff=0.12
        )
        self.play(Create(diagonal), FadeIn(diagonal_label))

        x0_guide = DashedLine(
            axes.c2p(x0, 0), axes.c2p(x0, x0), color=GUIDE, stroke_width=1.5, dash_length=0.06
        )
        x0_label = Text(f"x0 = {x0:g}", font_size=18, color=INK).next_to(axes.c2p(x0, 0), DOWN, buff=0.2)
        self.play(Create(x0_guide), FadeIn(x0_label))

        # corners[0] = (x0, 0); then alternating vertical-to-curve /
        # horizontal-to-diagonal points, one pair per iteration.
        corners = [axes.c2p(x0, 0)]
        for i in range(iterations):
            corners.append(axes.c2p(xs[i], fn(xs[i])))
            corners.append(axes.c2p(xs[i + 1], xs[i + 1]))

        dot = Dot(corners[0], color=ACCENT, radius=0.07)
        path = TracedPath(dot.get_center, stroke_color=ACCENT, stroke_width=3, stroke_opacity=0.85)
        self.add(path, dot)

        # Act 1: one full step, slow and captioned, so the mechanism reads
        # clearly before the pace picks up in Act 2. The x0 label is hidden
        # for this beat and restored afterward: a real render showed it
        # overlapping the caption at .to_edge(DOWN) -- the same class of
        # screen-edge-vs-near-axis-label collision region_sweep.py's own
        # Riemann-rectangle caption already had to solve the same way.
        self.play(FadeOut(x0_label), run_time=0.3)
        step1_caption = Text("evaluate g(x0)", font_size=22, color=INK).to_edge(DOWN)
        self.play(FadeIn(step1_caption))
        self.play(dot.animate.move_to(corners[1]), run_time=ACT1_STEP_RUN_TIME)
        step2_caption = Text("read across to y = x", font_size=22, color=INK).to_edge(DOWN)
        self.play(FadeOut(step1_caption), FadeIn(step2_caption), run_time=0.4)
        self.play(dot.animate.move_to(corners[2]), run_time=ACT1_STEP_RUN_TIME)
        self.play(FadeOut(step2_caption), run_time=0.4)
        self.play(FadeIn(x0_label), run_time=0.3)

        # Act 2: the remaining steps, run quickly as one Succession.
        remaining = corners[3:]
        if remaining:
            self.play(
                Succession(*(dot.animate.move_to(corner) for corner in remaining)),
                run_time=ACT2_STEP_RUN_TIME * len(remaining),
            )

        final_x = xs[-1]
        self.play(dot.animate.set_color(ACCENT).scale(1.3))
        final_label = Text(f"x ≈ {final_x:.2f}", font_size=22, color=INK).next_to(dot, RIGHT, buff=0.25)
        self.play(FadeIn(final_label))
        self.wait(1.0)
