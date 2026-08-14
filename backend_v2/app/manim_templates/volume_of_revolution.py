"""VolumeOfRevolutionScene: the second Manim template Shamo supports.

Same safety shape as region_sweep.py -- a fixed, reviewed scene, never
generated at request time, reading bounded numeric parameters from a JSON
file at SHAMO_MANIM_PARAMS_PATH and re-validating every expression through
safe_math before evaluating it. See region_sweep.py's module docstring for
the full rationale; it is not repeated here.

One continuous scene, not two acts with a fade between them: the flat 2D
picture (axes, both boundary curves, the shaded region) is built once and
never removed. A highlighted copy of the region is then swept through a full
360-degree revolution about the x-axis while the camera tilts, so the static
picture stays on screen as a fixed reference and the viewer watches only the
highlighted copy actually spin -- on explicit operator request, after an
earlier version faded the flat picture out before the 3D solid appeared.

The revolution is built directly from `axes`' own coordinate map
(`axes.c2p`), not a separately normalized 3D space, specifically so the
swept solid starts out exactly aligned with the flat drawing above it rather
than replacing it. An earlier version (still visible in git history) built
the solid in its own bounding-box-normalized space with no relationship to
the flat picture's coordinates at all, which was the right call at the time
because the flat picture was about to be faded out anyway. Reusing
`axes.c2p` naively would draw an ellipse instead of a circle: Axes generally
scales x and y by different amounts to fit the frame, so a raw
`axes.c2p(u, r)` for the y-offset plus an unscaled `r*sin(v)` for depth
would scale y and z inconsistently. The fix is `y_scale` below -- the axes'
own pixels-per-unit-y factor, applied to BOTH the y-offset and the z-offset,
so a circular cross-section is actually circular on screen. x keeps its own
(possibly different) axis scale, which only stretches the solid along its
own axis and is not a shape defect.

Two more things caught by reasoning through the design before ever
rendering it, both about `always_redraw`: (1) it replaces a mobject's
points from its function's raw output every frame, so any external
`.scale()`/`.move_to()` would be silently wiped out the next frame -- there
is none here, since `revolve_point` already returns final scene coordinates
directly from `axes.c2p`. (2) the camera tilt and the sweep run
concurrently via `move_camera(..., added_anims=[...])` rather than
sequentially -- an earlier version ran them back to back and measured out
as 1.3-1.5s of plain black screen with nothing yet added to the scene,
caught only by extracting and reading real rendered frames, not by reading
the code.

Handles two cases with one code path: a single boundary curve rotated
about the x-axis (upper_expr absent -> a solid disk) or the region between
two curves rotated about the x-axis (upper_expr present -> a hollow washer,
built as an outer surface plus an inner surface rendered in the background
colour to punch the hole -- an approximation, not a true 3D boolean
subtraction, judged good enough for a teaching animation at this quality
level).

A fourth surface, `leading_face`, was added on explicit user feedback after
watching a real render: the outer/inner surfaces above are TUBE WALLS --
they show the accumulated trail of the sweep, but nothing in the original
version ever showed the actual bounded 2D cross-section (the region between
the two curves) as a filled shape while it rotated. For a question whose
outer boundary happens to be a straight line, that made the highlighted
solid read as "a line, revolved" rather than "the shaded region, revolved"
-- correct geometry, wrong story. `leading_face` is a filled slice spanning
from the inner curve to the outer curve, positioned at whatever angle the
sweep has currently reached; at the start it sits exactly on top of
`flat_region`, so the viewer watches that same crescent shape visibly carry
itself around the axis, with the tube surfaces filling in behind it.

A design-lead review (14 August, later) found the render itself accurate
but visually and conceptually thin: a flat 8x8 mesh with no shading cue, a
fake pure-BLACK hole, three unrelated colors, and -- the substantive gap --
a scene that only ever shows the FINISHED solid appearing, never why the
disc/washer method (V = integral of pi*[R(x)^2 - r(x)^2] dx) works in the
first place. Colors now come from app.manim_theme (matching the card the
video plays inside) rather than manim's named WHITE/GRAY/BLACK; `BLACK` in
particular is replaced by `BACKGROUND` for the fake hole, because a literal
BLACK circle would now visibly mismatch the new non-pure-black scene
background instead of hiding in it. SURFACE_RESOLUTION goes from (8, 8) to
(16, 24) -- more subdivisions around the circumference than along the
length, since `checkerboard_colors` now alternates between two real colors
(ACCENT/ACCENT_SHADE, not two copies of the same one) and circumference
density is what makes that banding read as roundness rather than a few
giant flat facets; Manim's Cairo renderer has no lighting/shading model at
all for Surface, so alternating-face banding at high-enough density is the
only roundness cue actually available without switching to the (unrequested)
OpenGL renderer.

The conceptual fix is a new Act 1.5, inserted between the flat picture and
the continuous sweep: one representative radius segment (R(x), and r(x) for
a washer) at the interval's midpoint is drawn, spun through a full turn to
trace the circle it sweeps out, thickened into one thin disc/washer slice
with an explicit dx callout, then joined by four more such slices at evenly
spaced x-values to suggest the stack a Riemann-style sum of thin solids
approximates before the continuous sweep (Act 2) takes over and shows the
limit of that process. This only works correctly if the camera has ALREADY
tilted into its oblique 3D view before Act 1.5 starts -- an earlier draft
tried to spin the radius in the still-flat, un-tilted camera "to trace a
true circle on screen", which is wrong: a circle revolved about the x-axis
lies in the y-z plane, and a camera looking straight down the z-axis (the
untilted view) sees that plane edge-on, so the circle degenerates to a
vertical line rather than tracing anything. The fix is to move the existing
camera tilt earlier, to right before Act 1.5, reusing this file's own
established convention (see the washer notes above) that a circle viewed at
an oblique tilt correctly reads as an ellipse in perspective -- not a sign
of wrong geometry. Because the flat picture is never removed, tilting the
camera here is always safe (there is already plenty on screen to look at),
so this move needs no `added_anims` concurrency trick; that trick remains
necessary, and is kept, for Act 2's own camera move (see below).

Act 2's sweep is also followed by a "freeze before dwell" step: once
`sweep_angle` finishes its run to 2*PI, the `always_redraw` surfaces are
swapped for one-off static `Surface` objects built from the same lambdas
evaluated once, before any further camera move. This directly answers the
file's own earlier finding that an ambient orbit cost roughly 25s because
`always_redraw` was recomputing the full Python-side mesh (calling
`revolve_point`/`lower_fn`/`upper_fn`/`cos`/`sin` for every vertex) on every
displayed frame even once the shape had stopped changing -- freezing removes
that recompute tax for the reveal orbit and final hold that follow, leaving
only ordinary re-rasterization cost for camera movement over an unchanging
mesh, not an extra multiplier stacked on top of it.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.manim_theme import ACCENT, ACCENT_SHADE, BACKGROUND, GUIDE, INK, REGION_DEFAULT  # noqa: E402
from app.safe_math import make_evaluator  # noqa: E402

import numpy as np  # noqa: E402
from manim import (  # noqa: E402
    DEGREES,
    DOWN,
    LEFT,
    PI,
    RIGHT,
    Axes,
    Create,
    DashedLine,
    FadeIn,
    FadeOut,
    Line,
    Surface,
    Text,
    ThreeDScene,
    TracedPath,
    VGroup,
    ValueTracker,
    always_redraw,
    config,
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


# `always_redraw` rebuilds a fresh Surface every frame. Raised from the
# original (8, 8) -- more subdivisions around the circumference (v) than
# along the length (u), since checkerboard_colors now alternates two real
# colors (ACCENT/ACCENT_SHADE) and circumference density is what makes that
# banding read as roundness rather than a few flat facets (see module
# docstring). A first pass at (16, 24) measured a live washer render at
# 57.3s against a 60s hard timeout -- too close for comfort even on the
# machine it was tuned on. Cut to (12, 16) brought that to ~33-37s here,
# but a real student render on different (slower) hardware still hit the
# 60s cap outright -- found live, in production use, not in testing. Cut
# again to (10, 14): still enough subdivisions for the checkerboard
# banding to read as roundness (confirmed by re-extracting real frames),
# while leaving more headroom on slower machines. SWEEP_RUN_TIME, the
# reveal-orbit run_time and the final wait (see construct()) were all
# trimmed at the same time, since Act 2's sweep is where the mesh cost is
# actually paid every frame -- fewer frames there matters more than
# shaving the (already cheap, frozen) orbit/hold that follows it.
SURFACE_RESOLUTION = (10, 14)
SWEEP_RUN_TIME = 1.5

# The one thing genuinely rotating -- it needs to read as visually
# different from the fixed background it spins around and from the
# region's own default fill, not as a continuation of either. ACCENT is
# the app's own "active/primary" token (app.manim_theme); ACCENT_SHADE is
# only ever the second entry in a checkerboard_colors pair.
TINY_SLICE_HALF_WIDTH_FRACTION = 0.015
SLICE_STACK_COUNT = 5


class VolumeOfRevolutionScene(ThreeDScene):
    def construct(self) -> None:
        self.camera.background_color = BACKGROUND
        params = _load_params()
        x_min = float(params["x_min"])
        x_max = float(params["x_max"])
        lower_fn = make_evaluator(params["lower_expr"])
        upper_expr = params.get("upper_expr")
        upper_fn = make_evaluator(upper_expr) if upper_expr else (lambda _x: 0.0)
        region_color = params.get("region_color") or REGION_DEFAULT
        is_washer = upper_expr is not None

        # ---- the flat picture: axes, both curves, the shaded region.
        # Never removed -- it stays on screen for the whole scene as a
        # fixed reference frame while the camera later tilts around it. ----
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
        lower_graph = axes.plot(lower_fn, x_range=[x_min, x_max], color=INK)
        upper_graph = axes.plot(upper_fn, x_range=[x_min, x_max], color=region_color)
        bound_labels = VGroup(
            *(
                Text(f"x = {value:g}", font_size=20, color=INK).next_to(
                    axes.c2p(value, 0), DOWN, buff=0.2
                )
                for value in (x_min, x_max)
            )
        )
        # Stroke width bumped from 1.5 to 2.0 for legibility at 720p.
        boundary_guides = VGroup(
            *(
                DashedLine(
                    axes.c2p(value, 0),
                    axes.c2p(value, max(lower_fn(value), upper_fn(value))),
                    color=GUIDE,
                    stroke_width=2.0,
                    dash_length=0.08,
                )
                for value in (x_min, x_max)
            )
        )
        origin_label = VGroup()
        if x_min > 1e-9 or y_data_min > 1e-9:
            origin_label.add(Text("0", font_size=18, color=GUIDE).next_to(axes.c2p(0, 0), DOWN + LEFT, buff=0.12))

        flat_region = axes.get_area(
            lower_graph, x_range=[x_min, x_max], bounded_graph=upper_graph, color=region_color, opacity=0.55
        )

        self.play(Create(axes), FadeIn(origin_label))
        self.play(Create(lower_graph), Create(upper_graph))
        self.play(Create(boundary_guides), FadeIn(bound_labels))
        self.play(FadeIn(flat_region), run_time=0.8)
        self.wait(0.4)

        # ---- shared geometry helpers. Used by both Act 1.5 (the disc/
        # washer method demo) and Act 2 (the continuous sweep) below, so
        # both are built from the exact same math and can never disagree
        # about what "the radius at x" or "a point on the revolved surface"
        # means. ----
        def outer_r(x: float) -> float:
            lo, hi = abs(lower_fn(x)), abs(upper_fn(x))
            return max(lo, hi)

        def inner_r(x: float) -> float:
            if not is_washer:
                return 0.0
            lo, hi = abs(lower_fn(x)), abs(upper_fn(x))
            return min(lo, hi)

        # pixels-per-unit-y for this axes -- see module docstring for why
        # this must scale BOTH the y-offset and the z-offset below.
        origin_point = axes.c2p(0, 0)
        y_unit_point = axes.c2p(0, 1)
        y_scale = float(y_unit_point[1] - origin_point[1])

        def revolve_point(u: float, v: float, radius_fn) -> np.ndarray:
            base = axes.c2p(u, 0)
            offset = radius_fn(u) * y_scale
            return np.array([base[0], base[1] + offset * np.cos(v), base[2] + offset * np.sin(v)])

        def cross_section_point(u: float, t: float, angle: float) -> np.ndarray:
            """A point on the flat 2D cross-section (inner_r(u) to outer_r(u))
            at a fixed angle -- this is what `leading_face` sweeps around, and
            it is deliberately the SAME shape as flat_region above, just
            evaluated at `angle` instead of angle 0."""
            base = axes.c2p(u, 0)
            r = inner_r(u) + t * (outer_r(u) - inner_r(u))
            offset = r * y_scale
            return np.array([base[0], base[1] + offset * np.cos(angle), base[2] + offset * np.sin(angle)])

        def disc_slice(x_center: float) -> Surface:
            """A flat, STATIC annular disc (never always_redraw -- it never
            changes once drawn) at a single x position: the true bounded
            cross-section (inner_r to outer_r, all the way around), reusing
            cross_section_point -- the same math leading_face already uses
            for the full sweep below, just with BOTH its radial fraction
            (t) and its angle swept as free Surface parameters instead of
            one of them held fixed.

            An earlier version built this from revolve_point (fixed radius,
            swept over a tiny x-range) instead -- that is the TUBE-WALL
            math the full sweep's outer_surface uses, so it rendered as a
            thin RING/hoop, not a filled disc. Caught only by extracting
            and reading real frames, not by reasoning about the code (the
            same lesson this file's own docstring already recorded once
            for a different bug)."""
            return Surface(
                lambda t, angle: cross_section_point(x_center, t, angle),
                u_range=[0, 1],
                v_range=[0, 2 * PI],
                resolution=(2, 24),
                fill_opacity=0.85,
                checkerboard_colors=[ACCENT, ACCENT_SHADE],
                stroke_width=0.5,
            )

        # Aligning to axes.c2p (above) fixes the solid's position relative
        # to the flat picture; it does not fix where the CAMERA looks.
        # move_camera's phi/theta orbit is centered on scene ORIGIN
        # (0, 0, 0) by default -- but Axes lays itself out with its own
        # bounding box centered near the origin, which generally puts the
        # x-axis line itself (y=0, our axis of revolution) well below
        # scene-origin whenever the y_range does not straddle zero (here
        # axis_y_min is 0, so the whole axes box, and the x-axis with it,
        # sits low in the frame). Measured live: without correcting for
        # this, the solid rendered off-center and clipped hard at the frame
        # edges once tilted, no matter how far the camera zoomed out --
        # zooming out shrinks an off-center object, it does not re-center
        # it. Fixed by pointing the camera's frame_center at a point ON the
        # rotation axis instead of at scene-origin.
        #
        # Size still needs its own fix, orthogonal to centering: the flat
        # 2D picture only ever needed to fit the frame's width and height,
        # but the finished solid also extends a full radius into z (depth)
        # on top of that -- a dimension the flat picture never used. The
        # camera is zoomed out to fit the FINISHED solid's real bounding
        # box, probed over the full sweep (v in [0, 2*pi]), not the
        # near-zero starting angle -- same reasoning as the old scene_point
        # normalization this replaced.
        #
        # solid_span is the bounding box's DIAGONAL, not its largest single
        # axis extent. A rectangular box centered on its own centroid has
        # every corner at exactly half that diagonal from the center, so
        # the object is fully contained in a sphere of that diameter --
        # which fits inside the frame no matter how the camera later
        # orbits around this same center. The largest-axis version was
        # only ever safe for the ORIGINAL fixed viewing angle; the reveal
        # orbit added below rotates the camera further around this same
        # focus point, and for a long, thin washer (length >> radius) that
        # extra rotation swung enough of the tube into the vertical to
        # clip the top/bottom of the frame -- found by reading a real
        # rendered frame at the end of the orbit, not by reasoning about
        # the math; the disk case (roughly as long as it is wide) never
        # showed the bug, which is exactly why an angle-dependent size
        # check would have been easy to miss.
        camera_focus = axes.c2p((x_min + x_max) / 2.0, 0)
        probe_u = np.linspace(x_min, x_max, 10)
        probe_v = np.linspace(0, 2 * np.pi, 16)
        probe_points = np.array([revolve_point(u, v, outer_r) for u in probe_u for v in probe_v])
        bbox_extent = probe_points.max(axis=0) - probe_points.min(axis=0)
        solid_span = float(np.linalg.norm(bbox_extent))
        camera_zoom = 1.0
        if solid_span > 1e-6:
            camera_zoom = max(0.35, min(1.15, (config.frame_height * 0.85) / solid_span))

        # ---- axis-of-rotation emphasis. Introduced right when it becomes
        # relevant -- right before the camera tilts and the revolution
        # sequence begins -- rather than front-loaded before there is any
        # reason to care which line is special. ----
        rotation_axis_line = Line(axes.c2p(x_min, 0), axes.c2p(x_max, 0), color=INK, stroke_width=3.5)
        axis_label = Text("axis of rotation", font_size=16, color=GUIDE).next_to(
            rotation_axis_line, DOWN, buff=0.35
        )
        self.play(Create(rotation_axis_line), FadeIn(axis_label), run_time=0.5)

        # The camera tilts to its final 3D vantage point HERE, before Act
        # 1.5, not concurrently with the full sweep as in an earlier
        # version -- see module docstring. The flat picture is already
        # fully on screen, so this move is always safe (there is plenty to
        # look at throughout it); no added_anims concurrency trick is
        # needed for it. That trick is still used, and still needed, for
        # Act 2's own camera-free sweep below -- there is nothing left to
        # concurrently animate here since the sweep hasn't started yet.
        self.move_camera(
            phi=65 * DEGREES,
            theta=-50 * DEGREES,
            zoom=camera_zoom,
            frame_center=camera_focus,
            run_time=1.3,
        )

        # ---- Act 1.5: the disc/washer method itself. One representative
        # slice at the interval's midpoint -- built from a radius segment
        # spun through a full turn -- joined by four more such slices to
        # suggest the sum of thin solids that the continuous sweep (Act 2)
        # is the limit of. Everything here reuses revolve_point/
        # cross_section_point directly rather than new trig, so it is
        # provably consistent with Act 2 and with flat_region above. ----
        # Interior points only -- never x_min/x_max themselves. Some
        # regions (this one included: the two boundary curves meet exactly
        # at both endpoints) pinch to zero width right at the interval's
        # edges, and a slice sampled exactly there is a degenerate,
        # zero-area ring rather than a representative thin disc. Found by
        # reading a real rendered frame: one slice rendered as a lone thin
        # circle outline with no visible fill.
        slice_xs = np.linspace(x_min, x_max, SLICE_STACK_COUNT + 2)[1:-1]
        rep_index = SLICE_STACK_COUNT // 2
        x_rep = float(slice_xs[rep_index])
        dx_half = max(x_span * TINY_SLICE_HALF_WIDTH_FRACTION, 1e-4)

        outer_radius_top = revolve_point(x_rep, 0.0, outer_r)
        outer_radius_label = Text("R(x)", font_size=20, color=ACCENT).next_to(outer_radius_top, RIGHT, buff=0.15)
        radius_labels = [outer_radius_label]

        spin_angle = ValueTracker(1e-4)
        spinning_outer = always_redraw(
            lambda: Line(
                axes.c2p(x_rep, 0), revolve_point(x_rep, spin_angle.get_value(), outer_r), color=ACCENT, stroke_width=6
            )
        )
        radius_lines = [spinning_outer]
        traces = [TracedPath(spinning_outer.get_end, stroke_color=ACCENT, stroke_opacity=0.5, stroke_width=3)]

        if is_washer:
            inner_radius_top = revolve_point(x_rep, 0.0, inner_r)
            inner_radius_label = Text("r(x)", font_size=20, color=ACCENT).next_to(
                inner_radius_top, RIGHT, buff=0.15
            ).shift(DOWN * 0.3)
            radius_labels.append(inner_radius_label)
            spinning_inner = always_redraw(
                lambda: Line(
                    axes.c2p(x_rep, 0), revolve_point(x_rep, spin_angle.get_value(), inner_r), color=ACCENT, stroke_width=6
                )
            )
            radius_lines.append(spinning_inner)
            traces.append(TracedPath(spinning_inner.get_end, stroke_color=ACCENT, stroke_opacity=0.5, stroke_width=3))

        self.play(*(FadeIn(m) for m in [*radius_lines, *radius_labels]), run_time=0.6)
        for trace in traces:
            self.add(trace)
        self.play(spin_angle.animate.set_value(2 * PI), run_time=1.6)

        # Thicken the traced circle/ellipse into one representative thin
        # disc/washer slice, with an explicit dx callout tying it back to
        # the flat picture -- these guides sit on the flat x-axis, exactly
        # like boundary_guides above, just tighter.
        dx_guides = VGroup(
            *(
                DashedLine(
                    axes.c2p(v, 0),
                    axes.c2p(v, max(lower_fn(v), upper_fn(v))),
                    color=GUIDE,
                    stroke_width=1.5,
                    dash_length=0.05,
                )
                for v in (x_rep - dx_half, x_rep + dx_half)
            )
        )
        dx_label = Text("dx", font_size=16, color=GUIDE).next_to(axes.c2p(x_rep, 0), DOWN, buff=0.15)
        slice_caption = Text(
            "a thin washer of thickness dx" if is_washer else "a thin disc of thickness dx",
            font_size=18,
            color=INK,
        ).next_to(dx_label, DOWN, buff=0.2)

        slices = [disc_slice(x) for x in slice_xs]

        fade_out_group = VGroup(*radius_lines, *radius_labels, *traces)
        self.play(
            FadeOut(fade_out_group),
            FadeIn(slices[rep_index]),
            Create(dx_guides),
            FadeIn(dx_label),
            FadeIn(slice_caption),
            run_time=0.5,
        )

        # The remaining four slices, evenly spaced across the interval --
        # this is the "stack" that suggests a sum of thin solids, the
        # volume analogue of a Riemann sum, before Act 2 shows the limit
        # of that process as a continuous sweep.
        for i, x in enumerate(slice_xs):
            if i == rep_index:
                continue
            self.play(FadeIn(slices[i]), run_time=0.15)

        self.wait(0.4)
        self.play(
            *(FadeOut(s) for s in slices),
            FadeOut(dx_guides),
            FadeOut(dx_label),
            FadeOut(slice_caption),
            run_time=0.4,
        )

        # ---- Act 2: the continuous sweep -- the limit of the slice-stack
        # above, taken as the slice count grows and their width shrinks. ----
        sweep_angle = ValueTracker(1e-4)

        outer_surface = always_redraw(
            lambda: Surface(
                lambda u, v: revolve_point(u, v, outer_r),
                u_range=[x_min, x_max],
                v_range=[0, sweep_angle.get_value()],
                resolution=SURFACE_RESOLUTION,
                fill_opacity=0.65,
                checkerboard_colors=[ACCENT, ACCENT_SHADE],
                stroke_width=0.5,
            )
        )
        solid = VGroup(outer_surface)
        if is_washer:
            inner_surface = always_redraw(
                lambda: Surface(
                    lambda u, v: revolve_point(u, v, inner_r),
                    u_range=[x_min, x_max],
                    v_range=[0, sweep_angle.get_value()],
                    resolution=SURFACE_RESOLUTION,
                    fill_opacity=1.0,
                    checkerboard_colors=[BACKGROUND, BACKGROUND],
                    stroke_width=0,
                )
            )
            solid.add(inner_surface)

        # The piece that actually answers "where did this come from": the
        # true 2D cross-section (inner curve to outer curve, exactly the
        # shape of flat_region above), redrawn at whatever angle the sweep
        # has currently reached. At sweep_angle ~ 0 this sits exactly on top
        # of flat_region; as the sweep grows it visibly carries that same
        # shape around the axis ahead of the tube walls built above.
        leading_face = always_redraw(
            lambda: Surface(
                lambda u, t: cross_section_point(u, t, sweep_angle.get_value()),
                u_range=[x_min, x_max],
                v_range=[0, 1],
                resolution=(SURFACE_RESOLUTION[0], 2),
                fill_opacity=0.9,
                checkerboard_colors=[ACCENT, ACCENT_SHADE],
                stroke_width=1.0,
            )
        )
        solid.add(leading_face)

        # Kept short on purpose: the full curve/line equations are already
        # shown above the video by the surrounding app UI (narration_markdown,
        # rendered with real KaTeX there) -- this caption only needs to name
        # the axis of revolution and the bounds.
        caption = Text(
            f"the shaded region rotated about the x-axis, x = {x_min:g} to x = {x_max:g}",
            font_size=18,
            color=INK,
        )
        caption.to_corner(DOWN + LEFT)
        self.add_fixed_in_frame_mobjects(caption)

        # The camera is ALREADY at its final vantage point (tilted before
        # Act 1.5, above), so this is just the sweep growing in place --
        # no further camera move, and so no added_anims concurrency trick
        # either; that trick's job (avoiding a dead frame while the camera
        # moves) was already done once, above, and doing it twice would
        # just be a second redundant camera move.
        self.add(solid)
        self.play(sweep_angle.animate.set_value(2 * PI), run_time=SWEEP_RUN_TIME)

        # Freeze before dwell: swap the always_redraw surfaces for one-off
        # static copies evaluated once at the finished angle, BEFORE any
        # further camera move. See module docstring -- an earlier ambient
        # orbit cost ~25s specifically because always_redraw was
        # recomputing the full mesh every displayed frame even once the
        # shape had stopped changing. leading_face is not carried into the
        # frozen solid: at a full 2*pi sweep, outer_surface/inner_surface
        # already form the complete, seamless solid on their own.
        frozen_solid = VGroup(
            Surface(
                lambda u, v: revolve_point(u, v, outer_r),
                u_range=[x_min, x_max],
                v_range=[0, 2 * PI],
                resolution=SURFACE_RESOLUTION,
                fill_opacity=0.65,
                checkerboard_colors=[ACCENT, ACCENT_SHADE],
                stroke_width=0.5,
            )
        )
        if is_washer:
            frozen_solid.add(
                Surface(
                    lambda u, v: revolve_point(u, v, inner_r),
                    u_range=[x_min, x_max],
                    v_range=[0, 2 * PI],
                    resolution=SURFACE_RESOLUTION,
                    fill_opacity=1.0,
                    checkerboard_colors=[BACKGROUND, BACKGROUND],
                    stroke_width=0,
                )
            )
        self.remove(solid)
        self.add(frozen_solid)

        # A short reveal orbit on the now-frozen (and therefore cheap)
        # solid, then a real hold -- long enough to actually look at it,
        # which the earlier version's 0.6s cut short. Trimmed from
        # 1.8s/1.0s after a real student render hit the 60s render
        # timeout on slower hardware -- this phase is cheap per frame
        # (frozen, not always_redraw), so shortening it buys less margin
        # than the mesh/SWEEP_RUN_TIME cuts above, but every bit counts
        # when the goal is real headroom under 60s, not just a passing
        # measurement on one machine.
        self.move_camera(theta=-85 * DEGREES, run_time=1.3)
        self.wait(0.7)
