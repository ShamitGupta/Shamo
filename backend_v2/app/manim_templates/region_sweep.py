"""RegionSweepScene: the one Manim template Shamo currently supports.

This file is a fixed, reviewed scene -- never generated at request time. It
reads bounded numeric parameters from a JSON file (path in the
SHAMO_MANIM_PARAMS_PATH environment variable, written by manim_renderer
before this process is started) and animates the region between two curves
sweeping into view left-to-right, not fading in all at once -- a first
version used FadeIn on the whole region, which technically "filled in" but
was not a sweep at all; a real reviewer watching the actual rendered frames
caught the mismatch between that and what the narration text (and the
student's own request) promised.

Every expression it evaluates was already walked against an ast whitelist by
safe_math before this subprocess was ever launched -- see
visualize._validate_manim -- and it is walked again here, because a closure
that outlives that check is exactly the kind of thing that gets reused
somewhere the check was skipped.

No MathTex/Tex is used here on purpose: manimpango ships Pango/Cairo as
prebuilt wheels so plain Text works with no system install, but MathTex
needs an actual LaTeX distribution this project does not assume is present.
Typeset maths stays in narration_markdown, rendered by the existing KaTeX
pipeline in the frontend. This rules out Axes.get_x_axis().add_numbers() --
confirmed live, not assumed: NumberLine's default DecimalNumber builds each
digit via MathTex internally, so add_numbers() shells out to a `latex`
binary that does not exist here and the whole render fails. Bound labels are
therefore built as plain Text ("x = 1") placed directly under the axis at
the two x-values that matter, not as axis tick numbers.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# manim runs this file directly (`python -m manim render region_sweep.py ...`),
# so it has no package context for a relative import. Put backend_v2/ on the
# path so `app.safe_math` resolves the same way it does inside the API process.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.safe_math import make_evaluator  # noqa: E402

from manim import (  # noqa: E402
    DOWN,
    LEFT,
    UP,
    Axes,
    Create,
    DashedLine,
    FadeIn,
    GRAY,
    Scene,
    Text,
    VGroup,
    ValueTracker,
    WHITE,
    always_redraw,
    config,
    linear,
)

try:
    import imageio_ffmpeg

    config.ffmpeg_executable = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # noqa: BLE001 - fall back to a system ffmpeg if one exists
    pass


def _load_params() -> dict:
    path = os.environ.get("SHAMO_MANIM_PARAMS_PATH")
    if not path:
        raise RuntimeError("SHAMO_MANIM_PARAMS_PATH is not set")
    return json.loads(Path(path).read_text(encoding="utf-8"))


class RegionSweepScene(Scene):
    def construct(self) -> None:
        params = _load_params()
        x_min = float(params["x_min"])
        x_max = float(params["x_max"])
        lower_fn = make_evaluator(params["lower_expr"])
        upper_expr = params.get("upper_expr")
        upper_fn = make_evaluator(upper_expr) if upper_expr else (lambda _x: 0.0)
        region_color = params.get("region_color") or "#F5C453"

        sample_count = 100
        y_values = []
        for i in range(sample_count + 1):
            x = x_min + (x_max - x_min) * i / sample_count
            y_values.append(lower_fn(x))
            y_values.append(upper_fn(x))
        y_data_min, y_data_max = min(y_values), max(y_values)

        x_span = max(x_max - x_min, 1e-6)
        y_span = max(y_data_max - y_data_min, 1e-6)
        x_pad = max(x_span * 0.12, 0.3)
        y_pad = max(y_span * 0.2, 0.3)

        # The axis frame deliberately extends past [x_min, x_max] to the
        # origin, on explicit reviewer feedback: the first version made the
        # axis EXACTLY the interval, with no origin and no sense of where on
        # the graph the region actually sits -- disorienting rather than
        # clarifying. [x_min, x_max] stays the dominant part of the picture
        # because the added padding is small relative to the interval width;
        # the curve and the shaded region are still only ever drawn over
        # [x_min, x_max] itself -- only the surrounding axis frame is wider.
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
        lower_graph = axes.plot(lower_fn, x_range=[x_min, x_max], color=WHITE)
        upper_graph = axes.plot(upper_fn, x_range=[x_min, x_max], color=region_color)

        # Plain Text, not axis tick numbers: this is the fix for the biggest
        # gap a real reviewer caught -- without this, a student cannot see
        # where the shaded region actually starts and stops, which is the
        # whole point of "the region between x=1 and x=8." Now that the axis
        # extends beyond the interval, these labels matter even more --
        # the boundaries are no longer just "the edges of the picture."
        bound_labels = VGroup(
            *(
                Text(f"x = {value:g}", font_size=20, color=WHITE).next_to(
                    axes.c2p(value, 0), DOWN, buff=0.2
                )
                for value in (x_min, x_max)
            )
        )
        # Faint dashed guides from the x-axis up to whichever curve is on
        # top at each boundary, so the labelled boundary reads as "this
        # vertical line is where the region starts/stops" rather than a
        # label floating near the axis with nothing tying it to the curve.
        boundary_guides = VGroup(
            *(
                DashedLine(
                    axes.c2p(value, 0),
                    axes.c2p(value, max(lower_fn(value), upper_fn(value))),
                    color=GRAY,
                    stroke_width=1.5,
                    dash_length=0.08,
                )
                for value in (x_min, x_max)
            )
        )
        origin_label = VGroup()
        if x_min > 1e-9 or y_data_min > 1e-9:
            origin_label.add(Text("0", font_size=18, color=GRAY).next_to(axes.c2p(0, 0), DOWN + LEFT, buff=0.12))

        self.play(Create(axes), FadeIn(origin_label))
        self.play(Create(lower_graph), Create(upper_graph))
        self.play(Create(boundary_guides), FadeIn(bound_labels))

        labels = VGroup()
        lower_label = params.get("lower_label")
        upper_label = params.get("upper_label")
        if lower_label:
            labels.add(Text(str(lower_label), font_size=24, color=WHITE).to_edge(DOWN))
        if upper_label:
            labels.add(Text(str(upper_label), font_size=24, color=region_color).to_edge(UP))
        if labels:
            self.play(FadeIn(labels))

        # The actual sweep: sweep_x grows from x_min to x_max and the region
        # is redrawn on every frame to cover only [x_min, sweep_x], so the
        # shading visibly advances left-to-right rather than appearing all at
        # once. This is what "sweeping out" and "filling in" (both already
        # promised in narration_markdown) are supposed to look like.
        sweep_x = ValueTracker(x_min)
        region = always_redraw(
            lambda: axes.get_area(
                lower_graph,
                x_range=[x_min, sweep_x.get_value()],
                bounded_graph=upper_graph,
                color=region_color,
                opacity=0.55,
            )
            if sweep_x.get_value() > x_min
            else axes.get_area(
                lower_graph,
                x_range=[x_min, x_min + 1e-6],
                bounded_graph=upper_graph,
                color=region_color,
                opacity=0.55,
            )
        )
        self.add(region)
        self.play(sweep_x.animate.set_value(x_max), run_time=2.5, rate_func=linear)
        self.wait(1)
