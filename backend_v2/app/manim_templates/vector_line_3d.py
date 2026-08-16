"""VectorLine3DScene: lines in 3D space, for 9709 Paper 3 vector questions.

Same safety shape as every sibling template -- a fixed, reviewed scene, never
generated at request time, reading bounded numeric parameters from a JSON
file at SHAMO_MANIM_PARAMS_PATH. See region_sweep.py's module docstring for
the full rationale; it is not repeated here.

Unlike every sibling template, there is no expression to evaluate at all --
not even the no-expression-but-still-arithmetic shape of complex_transform.py
or force_resultant.py. Everything here is fixed linear algebra over plain
numbers: a parametric line r = point + t*direction, a least-squares solve for
where two lines come closest to meeting, and a perpendicular-projection
formula for the foot of a perpendicular. See models.ManimVectorLine3DParams
for the full safety/scope rationale.

Two lines' real relationship -- intersecting or skew -- is worked out HERE,
from the actual given points/directions, rather than trusted from any
model-supplied claim: the same "recompute, never trust the model's own
arithmetic" discipline every sibling template already applies (tangent_line's
domain check, cobweb_diagram's iteration check, force_resultant's resultant
magnitude, ...). A least-squares solve of `t*d1 - s*d2 = p2-p1` gives the two
lines' closest points regardless of whether they truly meet; if the gap
between those two points is (near) zero the lines intersect there, otherwise
that same gap IS the visual proof they are skew -- the shortest segment
connecting two lines that never meet.

Design, by input shape:

  ONE line, no external_point -- shows the position vector (dashed, from the
  origin), the direction vector, and the line itself sweeping out from
  t_min to t_max. This is the whole of "find a vector equation for l".

  TWO lines -- each line gets the same one-line treatment in turn, then a
  second act reveals their real relationship: either the point they
  genuinely meet at, or, if they do not, the closest-approach segment
  between them (skew), plus the acute angle between their directions via
  the scalar product, shown as two direction arrows brought to a shared
  point (the origin) rather than an in-scene angle arc -- Manim's Angle
  class expects two coplanar Line mobjects and was not built with a
  genuinely skew pair of 3D lines in mind, so reusing it here without
  dedicated verification would risk the same class of near-boundary bug
  already found and fixed once for force_resultant's (2D) angle arcs.
  Showing the two directions brought to a shared point, plus a plain
  numeric readout, sidesteps that risk entirely while remaining honest
  about exactly what is being claimed.

  ONE line PLUS external_point -- shows the foot of the perpendicular
  dropped from that point onto the line, with a small right-angle corner
  marker built from two short segments in the exact 2D plane spanned by the
  line's direction and the connecting segment (a real right angle in 3D,
  not a 2D approximation of one). Covers "find the foot of the perpendicular
  from A to l"; a reflection question (2*foot - A) is left to the narration
  text, since the animation's job is showing the foot itself.

Axes are ThreeDAxes with the SAME numeric span and the SAME x_length/
y_length/z_length on all three axes -- not merely square in x/y like the 2D
templates, but genuinely cubic. This is not cosmetic: an angle computed via
the scalar product and then shown on screen would be visibly WRONG if one
axis were scaled differently from another, the exact 3D analogue of why
force_resultant.py and complex_transform.py both insist on symmetric square
2D axes. The bounding box used to size that cubic range always includes the
true origin (0, 0, 0), since these questions are fundamentally about a
position vector relative to O -- but the origin is not forced to be the
visual CENTER of the frame, the same "include it, don't necessarily centre
on it" convention volume_of_revolution.py already established for its own
2D axis padding. The camera zoom needed to fill the frame turned out to be
essentially independent of the actual data (confirmed with a standalone
smoke render before writing this file): since every axes box is normalized
to the same fixed x_length/y_length/z_length regardless of what numeric span
it represents, a single fixed zoom fills the frame consistently across any
real question's numbers, unlike volume_of_revolution's camera_zoom (which
has to be computed per-render because that scene's solid is NOT normalized
to a fixed size against its axes).
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.manim_theme import ACCENT, BACKGROUND, GUIDE, INK, REGION_DEFAULT  # noqa: E402

import numpy as np  # noqa: E402
from manim import (  # noqa: E402
    DEGREES,
    DOWN,
    LEFT,
    RIGHT,
    UP,
    Create,
    DashedLine,
    Dot,
    FadeIn,
    FadeOut,
    Line,
    Text,
    ThreeDAxes,
    ThreeDScene,
    TracedPath,
    ValueTracker,
    VGroup,
    always_redraw,
    config,
    there_and_back,
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


def _sub(a: tuple, b: tuple) -> tuple:
    return tuple(a[i] - b[i] for i in range(3))


def _add(a: tuple, b: tuple) -> tuple:
    return tuple(a[i] + b[i] for i in range(3))


def _scale(v: tuple, s: float) -> tuple:
    return tuple(component * s for component in v)


def _dot(a: tuple, b: tuple) -> float:
    return sum(a[i] * b[i] for i in range(3))


def _norm(v: tuple) -> float:
    return math.sqrt(_dot(v, v))


def _normalize(v: tuple) -> tuple:
    magnitude = _norm(v)
    return _scale(v, 1.0 / magnitude) if magnitude > 1e-9 else v


def _direction_indicator(start: np.ndarray, end: np.ndarray, color: str) -> VGroup:
    """A cheap stand-in for a 3D arrow: a plain Line plus a small flat Dot at
    the tip. Manim's real Arrow3D (cone + cylinder mesh) measured at ~52
    submobjects per instance in a standalone timing check before this file
    was written -- rendering several of them (one per line's direction, plus
    two more for the angle-between-directions beat) pushed a single frame's
    render time past 1 second each, which would have blown well past the 60s
    render cap on a real question. A Line is one of the cheapest mobjects
    Manim has; this keeps the same "here is the direction" visual cue at a
    small fraction of the cost. Every point marker in this scene uses the
    same flat Dot rather than Dot3D for the same reason -- Dot3D is a real
    sphere mesh (64 submobjects at its default resolution, confirmed via a
    real render), which is a heavy cost to pay for what is visually a tiny
    marker, and is paid every single frame for the ONE dot that moves via
    always_redraw during a sweep. A flat Dot loses only the sphere's shading,
    not its position -- .move_to a 3D coordinate places it correctly."""

    return VGroup(Line(start, end, color=color, stroke_width=5), Dot(end, color=color, radius=0.05))


# A single fixed cubic axes size regardless of the real question's numbers --
# see module docstring for why this makes camera zoom a fixed constant
# rather than something computed per-render. Confirmed against a standalone
# smoke render before this file was written: the default camera framing left
# the axes far too small in frame, and a plain zoom fixed it without needing
# any per-render size computation.
AXIS_LENGTH = 6.5
CAMERA_ZOOM = 1.7
CAMERA_PHI = 70 * DEGREES
CAMERA_THETA = -50 * DEGREES
SWEEP_RUN_TIME = 1.2
DIRECTION_ARROW_FRACTION = 0.35
CAPTION_LINE_HEIGHT = 0.38

EXTERNAL_POINT_DEFAULT = "#E5566D"
"""A new semantic role -- a named point being projected onto a line -- not
reused from any existing app.manim_theme token (those carry other, already-
documented roles: ACCENT is "the one active highlight", GUIDE is dashed
guides/annotations, INK is fixed/primary content, REGION_DEFAULT is a
region's fill). Also reused below as the SECOND line's default colour,
alongside ACCENT for the first -- REGION_DEFAULT was previously only used as
a region-fill colour, but this template has no region to shade, and it is
already the app's established second general-purpose highlight tone."""


class VectorLine3DScene(ThreeDScene):
    def construct(self) -> None:
        self.camera.background_color = BACKGROUND
        params = _load_params()
        points = [tuple(float(c) for c in p) for p in params["points"]]
        directions = [tuple(float(c) for c in d) for d in params["directions"]]
        t_min = float(params.get("t_min", -4.0))
        t_max = float(params.get("t_max", 4.0))
        raw_external_point = params.get("external_point")
        external_point = tuple(float(c) for c in raw_external_point) if raw_external_point else None
        n_lines = len(points)
        labels = params.get("labels") or (["l1", "l2"] if n_lines == 2 else ["l"])
        default_colors = [ACCENT, REGION_DEFAULT]
        line_colors = params.get("line_colors") or default_colors[:n_lines]
        external_point_label = params.get("external_point_label") or "A"
        external_point_color = params.get("external_point_color") or EXTERNAL_POINT_DEFAULT

        def endpoint(i: int, t: float) -> tuple:
            return _add(points[i], _scale(directions[i], t))

        # Each line's OWN displayed sweep range -- starts as the shared
        # t_min/t_max, but may be widened per-line below so the swept
        # segment actually reaches a point this scene needs to highlight.
        line_ranges = [[t_min, t_max] for _ in range(n_lines)]

        # ---- work out the real geometry BEFORE drawing anything: whether
        # two lines genuinely intersect or are skew, worked out from the
        # numbers themselves via a least-squares solve over ALL real t, s --
        # an unconstrained, global property of the two infinite lines, not
        # something a display window can change. ----
        relationship: str | None = None
        intersection_point: tuple | None = None
        closest_points: tuple[tuple, tuple] | None = None
        angle_between_deg: float | None = None
        if n_lines == 2:
            p1, p2 = points
            d1, d2 = directions
            a_matrix = np.array([[d1[0], -d2[0]], [d1[1], -d2[1]], [d1[2], -d2[2]]])
            b_vector = np.array([p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]])
            solution, *_rest = np.linalg.lstsq(a_matrix, b_vector, rcond=None)
            t_sol, s_sol = float(solution[0]), float(solution[1])
            point_on_1 = endpoint(0, t_sol)
            point_on_2 = endpoint(1, s_sol)
            gap = _norm(_sub(point_on_1, point_on_2))
            scale_ref = max(1.0, _norm(d1), _norm(d2))
            if gap < 1e-3 * scale_ref:
                relationship = "intersect"
                intersection_point = _scale(_add(point_on_1, point_on_2), 0.5)
                # The true intersection can sit outside the caller's own
                # t_min/t_max (confirmed live: a first version left the
                # highlighted "meet" point stranded off-frame, with the
                # drawn segments never actually reaching it, because the
                # axes were sized around it while the SWEPT lines were not).
                # Widen just the affected line's own displayed range so its
                # segment genuinely reaches the point being highlighted.
                for line_index, param_value in ((0, t_sol), (1, s_sol)):
                    lo, hi = line_ranges[line_index]
                    if param_value < lo:
                        line_ranges[line_index][0] = param_value - 0.5
                    elif param_value > hi:
                        line_ranges[line_index][1] = param_value + 0.5
            else:
                relationship = "skew"
                # The TRUE closest approach between two infinite skew lines
                # can sit arbitrarily far from either given point (confirmed
                # live with the exact worked example below this scene ships
                # with: t=12, s=-21 against a t_min/t_max of only -4/4) --
                # sizing the axes around that true point away the visible
                # segments to a sliver in the middle of a mostly-empty frame.
                # The closest approach WITHIN the segment actually shown is
                # the pedagogically relevant claim anyway ("even here, where
                # you can see both lines, they never touch"), so t/s are
                # clamped to the displayed range rather than left at their
                # true unconstrained values.
                t_clamped = min(max(t_sol, t_min), t_max)
                s_clamped = min(max(s_sol, t_min), t_max)
                closest_points = (endpoint(0, t_clamped), endpoint(1, s_clamped))
            mag1, mag2 = _norm(d1), _norm(d2)
            cos_theta = max(-1.0, min(1.0, abs(_dot(d1, d2)) / (mag1 * mag2)))
            angle_between_deg = math.degrees(math.acos(cos_theta))

        foot_point: tuple | None = None
        if external_point is not None:
            p0, d0 = points[0], directions[0]
            t_foot = _dot(_sub(external_point, p0), d0) / _dot(d0, d0)
            foot_point = endpoint(0, t_foot)

        # ---- now gather every point the scene will actually show, using
        # each line's own (possibly widened) displayed range, and size the
        # (cubic) axes to fit them. Same numeric span AND the same
        # x_length/y_length/z_length on every axis -- see module docstring. ----
        all_points: list[tuple] = [(0.0, 0.0, 0.0)]
        for i in range(n_lines):
            all_points.append(points[i])
            all_points.append(endpoint(i, line_ranges[i][0]))
            all_points.append(endpoint(i, line_ranges[i][1]))
        if intersection_point is not None:
            all_points.append(intersection_point)
        if closest_points is not None:
            all_points.extend(closest_points)
        if external_point is not None:
            all_points.append(external_point)
            all_points.append(foot_point)

        arr = np.array(all_points, dtype=float)
        centers = (arr.min(axis=0) + arr.max(axis=0)) / 2.0
        half_span = max(float((arr.max(axis=0) - arr.min(axis=0)).max()) / 2.0, 1.0) * 1.3
        step = max(half_span / 3.0, 0.5)
        axes = ThreeDAxes(
            x_range=[centers[0] - half_span, centers[0] + half_span, step],
            y_range=[centers[1] - half_span, centers[1] + half_span, step],
            z_range=[centers[2] - half_span, centers[2] + half_span, step],
            x_length=AXIS_LENGTH,
            y_length=AXIS_LENGTH,
            z_length=AXIS_LENGTH,
            tips=False,
        )

        def c2p(point: tuple) -> np.ndarray:
            return axes.c2p(*point)

        self.set_camera_orientation(phi=CAMERA_PHI, theta=CAMERA_THETA, zoom=CAMERA_ZOOM)

        # Axis end labels sit on the axes' OWN zero-crossing lines (the
        # actual drawn x/y/z axis lines, at the other two coordinates = 0),
        # not at the data bounding box's centre -- those are different
        # points whenever the real data does not straddle the origin.
        axis_end_labels = VGroup(
            Text("x", font_size=20, color=GUIDE).next_to(
                c2p((centers[0] + half_span, 0.0, 0.0)), RIGHT, buff=0.15
            ),
            Text("y", font_size=20, color=GUIDE).next_to(
                c2p((0.0, centers[1] + half_span, 0.0)), UP, buff=0.15
            ),
            Text("z", font_size=20, color=GUIDE).next_to(
                c2p((0.0, 0.0, centers[2] + half_span)), UP, buff=0.15
            ),
        )
        # No "O" text label at the origin: a plain "O" is rotationally
        # symmetric, so under this camera's fixed tilt it degenerates into a
        # small oval indistinguishable from a second dot -- confirmed by two
        # real renders and a zoomed crop, at two different sizes. An
        # asymmetric label (e.g. "l2" elsewhere in this scene) keeps a
        # distinctive silhouette even skewed; "O" does not, at any size.
        # Every position vector is a dashed line drawn FROM this exact dot,
        # which already conveys "this is the reference point" without
        # needing separately-legible text.
        origin_dot = Dot(c2p((0.0, 0.0, 0.0)), color=GUIDE, radius=0.055)
        self.play(Create(axes), FadeIn(axis_end_labels), FadeIn(origin_dot))

        caption_count = 0

        def add_caption_line(text: str) -> None:
            nonlocal caption_count
            caption = Text(text, font_size=18, color=INK)
            caption.to_corner(DOWN + LEFT).shift(UP * CAPTION_LINE_HEIGHT * caption_count)
            self.add_fixed_in_frame_mobjects(caption)
            self.play(FadeIn(caption), run_time=0.4)
            caption_count += 1

        # ---- Act 1: each line in turn -- position vector, direction, then
        # the parametric sweep across the line's own displayed range. ----
        for i in range(n_lines):
            color = line_colors[i]
            label = labels[i]
            point = points[i]
            direction = directions[i]
            direction_hat = _normalize(direction)
            arrow_len = half_span * DIRECTION_ARROW_FRACTION
            line_t_min, line_t_max = line_ranges[i]

            position_vector = DashedLine(
                c2p((0.0, 0.0, 0.0)), c2p(point), color=GUIDE, stroke_width=2.0, dash_length=0.08
            )
            point_dot = Dot(c2p(point), color=color, radius=0.07)
            direction_arrow = _direction_indicator(
                c2p(point), c2p(_add(point, _scale(direction_hat, arrow_len))), color
            )
            point_label = Text(label, font_size=20, color=color).next_to(c2p(point), DOWN, buff=0.15)

            self.play(
                Create(position_vector), FadeIn(point_dot), FadeIn(direction_arrow), FadeIn(point_label),
                run_time=0.6,
            )

            t_tracker = ValueTracker(line_t_min)

            def _current_point(tt=t_tracker, ii=i) -> np.ndarray:
                return c2p(endpoint(ii, tt.get_value()))

            moving_dot = always_redraw(lambda cp=_current_point, cc=color: Dot(cp(), color=cc, radius=0.06))
            trace = TracedPath(_current_point, stroke_color=color, stroke_width=4)
            self.add(trace, moving_dot)
            self.play(FadeOut(direction_arrow), t_tracker.animate.set_value(line_t_max), run_time=SWEEP_RUN_TIME)

            eq_text = (
                f"{label}: r = ({point[0]:g}, {point[1]:g}, {point[2]:g}) + "
                f"t({direction[0]:g}, {direction[1]:g}, {direction[2]:g})"
            )
            add_caption_line(eq_text)

            # Declutter before moving on: the traced line IS the answer this
            # part is drawn to show, so the scaffolding that built it
            # (position vector, point dot/label, moving dot) is no longer
            # needed -- and, measured directly, removing it here rather than
            # carrying it for the rest of the scene meaningfully cuts every
            # later frame's render cost, since every currently-visible
            # mobject is re-projected through the 3D camera on every frame,
            # not just the ones actually changing in a given self.play call.
            self.play(
                FadeOut(moving_dot), FadeOut(position_vector), FadeOut(point_dot), FadeOut(point_label),
                run_time=0.3,
            )

        # ---- Act 2 (two lines only): their real relationship, then the
        # angle between their directions. ----
        if n_lines == 2:
            if relationship == "intersect":
                marker = Dot(c2p(intersection_point), color=INK, radius=0.09)
                marker_label = Text("meet", font_size=20, color=INK).next_to(
                    c2p(intersection_point), UP, buff=0.15
                )
                self.play(FadeIn(marker), FadeIn(marker_label), run_time=0.4)
                self.play(marker.animate.scale(1.4), rate_func=there_and_back, run_time=0.4)
                add_caption_line(
                    f"{labels[0]} and {labels[1]} meet at "
                    f"({intersection_point[0]:.2f}, {intersection_point[1]:.2f}, {intersection_point[2]:.2f})"
                )
            else:
                point_a, point_b = closest_points
                gap_segment = DashedLine(
                    c2p(point_a), c2p(point_b), color=INK, stroke_width=3.0, dash_length=0.06
                )
                dot_a = Dot(c2p(point_a), color=INK, radius=0.06)
                dot_b = Dot(c2p(point_b), color=INK, radius=0.06)
                gap_value = _norm(_sub(point_a, point_b))
                self.play(Create(gap_segment), FadeIn(dot_a), FadeIn(dot_b), run_time=0.6)
                add_caption_line(
                    f"{labels[0]} and {labels[1]} never meet -- gap of "
                    f"{gap_value:.2f} units between the segments shown (skew)"
                )
            self.wait(0.15)

            d1_hat = _normalize(directions[0])
            d2_hat = _normalize(directions[1])
            angle_len = half_span * DIRECTION_ARROW_FRACTION
            origin = (0.0, 0.0, 0.0)
            angle_arrow_1 = _direction_indicator(c2p(origin), c2p(_scale(d1_hat, angle_len)), line_colors[0])
            angle_arrow_2 = _direction_indicator(c2p(origin), c2p(_scale(d2_hat, angle_len)), line_colors[1])
            self.play(FadeIn(angle_arrow_1), FadeIn(angle_arrow_2), run_time=0.6)
            add_caption_line(
                f"angle between {labels[0]} and {labels[1]} directions = {angle_between_deg:.1f} deg"
            )
            self.wait(0.25)

        # ---- Act 3 (external_point only): the foot of the perpendicular. ----
        if external_point is not None:
            ext_dot = Dot(c2p(external_point), color=external_point_color, radius=0.07)
            ext_label = Text(external_point_label, font_size=20, color=external_point_color).next_to(
                c2p(external_point), DOWN, buff=0.15
            )
            self.play(FadeIn(ext_dot), FadeIn(ext_label), run_time=0.4)

            foot_dot = Dot(c2p(foot_point), color=line_colors[0], radius=0.07)
            foot_label = Text("foot", font_size=18, color=line_colors[0]).next_to(
                c2p(foot_point), UP, buff=0.15
            )
            connector = DashedLine(
                c2p(external_point), c2p(foot_point), color=GUIDE, stroke_width=2.0, dash_length=0.07
            )
            self.play(Create(connector), FadeIn(foot_dot), FadeIn(foot_label), run_time=0.6)

            # A small right-angle corner marker, built in the exact 2D plane
            # spanned by the line's own direction and the connecting
            # segment -- a real right angle in 3D, not a 2D approximation.
            dir_hat = _normalize(directions[0])
            perp_hat = _normalize(_sub(external_point, foot_point))
            corner = half_span * 0.12
            corner_a = _add(foot_point, _scale(dir_hat, corner))
            corner_b = _add(corner_a, _scale(perp_hat, corner))
            corner_c = _add(foot_point, _scale(perp_hat, corner))
            right_angle_marker = VGroup(
                Line(c2p(corner_a), c2p(corner_b), color=GUIDE, stroke_width=2.0),
                Line(c2p(corner_b), c2p(corner_c), color=GUIDE, stroke_width=2.0),
            )
            self.play(Create(right_angle_marker), run_time=0.3)
            add_caption_line(
                f"foot of perpendicular: ({foot_point[0]:.2f}, {foot_point[1]:.2f}, {foot_point[2]:.2f})"
            )
            self.wait(0.2)

        # This phase is the most expensive per frame in the whole scene,
        # measured directly: by now everything the scene has built is still
        # on screen, and a MOVING camera forces every one of those mobjects
        # to be reprojected fresh each frame, unlike a static hold. Kept
        # short for exactly that reason -- a small reveal, not a long orbit.
        self.move_camera(theta=CAMERA_THETA - 25 * DEGREES, run_time=0.5)
        self.wait(0.2)
