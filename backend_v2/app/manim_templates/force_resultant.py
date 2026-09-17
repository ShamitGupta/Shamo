"""ForceResultantScene: several coplanar force vectors, given as
magnitude/direction pairs all acting at one point, RESOLVED into horizontal
and vertical components which are then summed along each axis and combined
into the resultant -- the visual answer to "why is the resultant this
particular magnitude and direction", for 9709 Mechanics statics questions
("find the magnitude and direction of the resultant force").

This mirrors the actual taught method, not just a geometric shortcut: every
one of Cambridge's own mark schemes for this question shape resolves
horizontally and vertically as two SEPARATE equations (e.g. "Horizontally:
X = 28cos35 + 72cos50 - 35cos60") before combining the two totals via
Pythagoras and inverse-tan. An earlier version of this scene animated a
tip-to-tail polygon of the ORIGINAL angled forces instead -- geometrically
valid, but a different method from the one a student is actually taught and
graded on, and it gave no way to show the angle each force makes with the
horizontal. This version fixes both: it resolves first, and it draws that
angle explicitly.

Like complex_transform.py, there is no expression string at all and so no
involvement from safe_math whatsoever: the model supplies only bounded
magnitudes/angles (see models.ManimForceResultantParams), already fully
checked by ordinary Pydantic Field bounds plus a non-degenerate-resultant
model_validator before this process is ever started.

No MathTex/Tex is used here, for the same reason as every sibling template:
no LaTeX distribution is assumed present on the render host.

Axes are square with a SYMMETRIC [-R, R] range on both, R chosen from every
configuration this scene actually shows: each force's own "as given" tip,
AND every partial sum along the horizontal chain, AND every partial sum
along the vertical chain -- the same "must fit every configuration, not just
the final one" reasoning complex_transform.py and volume_of_revolution.py
both already had to apply once. Because the range is symmetric about 0 and
the axes are never shifted, axes.c2p(0,0) coincides with the scene's true
ORIGIN, so every vector is built directly with axes.c2p(x, y) as its
endpoint.

Design, in four acts:

  Act 1 -- every force drawn from the shared point O exactly as the source
  diagram presents it, each labelled with its own magnitude, AND each with
  an angle arc to whichever horizontal direction (positive or negative x)
  is nearest to it. That reference choice is not cosmetic: Cambridge always
  states a force's angle relative to the horizontal (e.g. "60 degrees to
  the line BC" measured against whichever side reads naturally), never as a
  raw standard-position angle, and picking the nearer horizontal keeps
  every arc here comfortably non-reflex (<=90 degrees) regardless of which
  quadrant a force actually points into -- a reflex angle would need
  Manim's Angle class handled quite differently and is never what a real
  diagram shows.

  Act 2 -- horizontal resolution AND summation together. A coloured copy of
  each force's vector slides -- rotating and rescaling in one continuous
  motion, the same Transform idiom complex_transform.py already
  established for "z1 sweeping toward the result" -- directly from its
  original angled position into its correct place in a running horizontal
  total: the first component starts at the true origin, and each one after
  it starts exactly where the previous one's horizontal component ended.
  The running total IS this chain's final tip; no separate reveal step is
  needed once the slide finishes.

  Act 3 -- the same thing for the vertical components, using fresh copies
  of the original vectors (the horizontal copies are still busy being the
  horizontal chain).

  Act 4 -- the two totals are combined the way Cambridge's own working
  does: a copy of the vertical total is shifted (translated only, already
  vertical) to start where the horizontal total ends, forming a right-angle
  corner. The resultant is the diagonal from the true origin to that
  corner -- the literal hypotenuse of the right triangle the two resolved
  totals just built, not merely a stated final answer.
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
    ORIGIN,
    RIGHT,
    UP,
    Angle,
    Arrow,
    Axes,
    Create,
    FadeIn,
    FadeOut,
    Line,
    Scene,
    Text,
    Transform,
    Vector,
    config,
)

try:
    import imageio_ffmpeg

    config.ffmpeg_executable = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # noqa: BLE001 - fall back to a system ffmpeg if one exists
    pass

# Local to this template, not added to manim_theme.py: horizontal/vertical
# component colouring is a new semantic role no existing shared token
# covers (the theme file's tokens are all either structural -- INK/GUIDE --
# or a single "active highlight" -- ACCENT). Red/green is the conventional
# x/y-component colour pairing in most textbook and software vector
# diagrams, and both are clearly distinct from REGION_DEFAULT's gold and
# ACCENT's blue already used elsewhere in this scene.
HORIZONTAL_DEFAULT = "#E5566D"
VERTICAL_DEFAULT = "#4CAF8C"

ARC_BASE_RADIUS = 0.4
ARC_RADIUS_STEP = 0.22


def _load_params() -> dict:
    path = os.environ.get("SHAMO_MANIM_PARAMS_PATH")
    if not path:
        raise RuntimeError("SHAMO_MANIM_PARAMS_PATH is not set")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _label_past_end(text: str, color: str, start, end):
    # Offset PAST the segment's own end, continuing in the segment's own
    # direction -- the same idiom complex_transform.py's _label_near_tip
    # already established. Only used in Act 1 here (the origin fan), where
    # nothing else starts at any of these tips -- see _label_beside_midpoint
    # for why a chain needs a different rule.
    #
    # buff=0.3, not a smaller value: Vector's default arrowhead is 0.35
    # units long, and a real render at a smaller buff showed a straight-up
    # vector's label still grazing its own arrowhead -- next_to's alignment
    # is not purely axial for a Text bounding box, so the buff needs real
    # clearance past the arrowhead's length, not just past the mathematical
    # end point.
    start = np.asarray(start, dtype=float)
    end = np.asarray(end, dtype=float)
    direction = end - start
    length = float(np.linalg.norm(direction))
    if length < 1e-6:
        unit = np.array([0.0, 1.0, 0.0])
    else:
        unit = direction / length
    return Text(text, font_size=18, color=color).next_to(end, unit, buff=0.3)


class ForceResultantScene(Scene):
    def construct(self) -> None:
        self.camera.background_color = BACKGROUND
        params = _load_params()
        magnitudes = [float(m) for m in params["magnitudes"]]
        # Normalize to (-180, 180] regardless of how the model expressed an
        # equivalent direction (e.g. -300 instead of 60 for the same ray) --
        # both the "nearest horizontal axis" reference below and the angle
        # arc's bisector assume a small-magnitude representative.
        angles = [((float(a) + 180.0) % 360.0) - 180.0 for a in params["angles_degrees"]]
        vector_color = params.get("vector_color") or REGION_DEFAULT
        resultant_color = params.get("resultant_color") or ACCENT
        horizontal_color = params.get("horizontal_color") or HORIZONTAL_DEFAULT
        vertical_color = params.get("vertical_color") or VERTICAL_DEFAULT
        resultant_label_text = params.get("resultant_label") or "R"

        radians_list = [math.radians(a) for a in angles]
        fx = [m * math.cos(r) for m, r in zip(magnitudes, radians_list)]
        fy = [m * math.sin(r) for m, r in zip(magnitudes, radians_list)]
        individual_tips = list(zip(fx, fy))

        cum_fx = [0.0]
        running = 0.0
        for value in fx:
            running += value
            cum_fx.append(running)
        cum_fy = [0.0]
        running = 0.0
        for value in fy:
            running += value
            cum_fy.append(running)
        sum_fx, sum_fy = cum_fx[-1], cum_fy[-1]

        all_x = [p[0] for p in individual_tips] + cum_fx
        all_y = [p[1] for p in individual_tips] + cum_fy
        max_extent = max(max(abs(v) for v in all_x), max(abs(v) for v in all_y))
        span_radius = max(max_extent * 1.25, 1.0)
        step = max(span_radius / 5, 0.5)

        axes = Axes(
            x_range=[-span_radius, span_radius, step],
            y_range=[-span_radius, span_radius, step],
            x_length=6.0,
            y_length=6.0,
            tips=False,
        )
        x_axis_label = Text("x", font_size=20, color=GUIDE).next_to(
            axes.c2p(span_radius, 0), UP + RIGHT, buff=0.15
        )
        y_axis_label = Text("y", font_size=20, color=GUIDE).next_to(axes.c2p(0, span_radius), UP, buff=0.1)
        self.play(Create(axes), FadeIn(x_axis_label), FadeIn(y_axis_label))

        # Act 1: every force drawn from the shared point O, each labelled
        # with its magnitude and the acute angle it makes with whichever
        # horizontal direction is nearest to it.
        pos_x_ref = Line(ORIGIN, axes.c2p(1, 0))
        neg_x_ref = Line(ORIGIN, axes.c2p(-1, 0))

        origin_vectors = [Vector(axes.c2p(*tip), color=vector_color) for tip in individual_tips]
        origin_labels = [
            _label_past_end(f"{m:g} N", vector_color, ORIGIN, axes.c2p(*tip))
            for m, tip in zip(magnitudes, individual_tips)
        ]

        angle_arcs = []
        angle_labels = []
        for i, (tip, r, a) in enumerate(zip(individual_tips, radians_list, angles)):
            on_positive_side = math.cos(r) >= 0
            reference_line = pos_x_ref if on_positive_side else neg_x_ref
            # atan2(0, 1) == 0 and atan2(0, -1) == +pi exactly (confirmed
            # live) -- this is manim's own internal angle for each reference
            # line, needed below to locate the arc it actually drew, not the
            # naive average of the two raw angle numbers (see the bisector
            # comment further down for why that naive version was wrong).
            reference_raw_rad = 0.0 if on_positive_side else math.pi
            acute_deg = math.degrees(math.atan2(abs(math.sin(r)), abs(math.cos(r))))
            radius = ARC_BASE_RADIUS + i * ARC_RADIUS_STEP
            force_line = Line(ORIGIN, axes.c2p(*tip))
            # Angle does NOT default to the shorter of the two possible
            # arcs between two lines -- it always sweeps counterclockwise
            # from line1 to line2 and only takes the "long way" based on a
            # raw numeric comparison of their underlying atan2 angles, which
            # does not line up with which arc is actually small once either
            # angle sits near the +/-180 boundary. A real render showed this
            # produce a ~310 degree reflex arc for a force at -50 degrees
            # against the positive x-axis, while other forces in the SAME
            # render came out correct -- confirming this is configuration-
            # dependent, not something safe to hand-derive once and assume.
            # Trying one arc and checking its resulting angle_value against
            # the acute angle already computed independently (via atan2 of
            # absolute components, which is always correct) sidesteps
            # needing to replicate Angle's internal branching at all.
            arc = Angle(reference_line, force_line, radius=radius, color=GUIDE)
            if abs(abs(math.degrees(arc.angle_value)) - acute_deg) > 1.0:
                arc = Angle(reference_line, force_line, radius=radius, color=GUIDE, other_angle=True)
            # The bisector of the arc ACTUALLY drawn, not a naive average of
            # the two raw angle numbers -- a real render showed the naive
            # average place a label nowhere near its own arc (180 and the
            # normalized -120 average to 30, which points at the completely
            # unrelated 45N/28N region, not the 60-degree arc's real
            # location down past the negative x-axis). arc.angle_value is
            # the signed sweep actually used (accounting for the other_angle
            # flip above), so the reference's own raw angle plus half of it
            # lands exactly in the middle of whichever arc was really drawn.
            bisector = reference_raw_rad + arc.angle_value / 2
            label_point = (radius + 0.28) * np.array([math.cos(bisector), math.sin(bisector), 0.0])
            angle_arcs.append(arc)
            angle_labels.append(Text(f"{acute_deg:.0f}°", font_size=15, color=GUIDE).move_to(label_point))

        caption_fan = Text(
            "forces at a point, each at an angle to the horizontal", font_size=22, color=INK
        ).to_edge(DOWN)
        self.play(*[Create(v) for v in origin_vectors], *[FadeIn(l) for l in origin_labels])
        self.play(*[Create(a) for a in angle_arcs], *[FadeIn(l) for l in angle_labels])
        self.play(FadeIn(caption_fan))
        self.wait(0.8)
        self.play(FadeOut(caption_fan))

        # Act 2: resolve each force into its horizontal component, then sum
        # them. Each coloured copy slides directly from its original angled
        # position into ITS OWN component vector from the true origin,
        # simultaneously -- NOT chained tip-to-tail along the axis. A real
        # render of an earlier tip-to-tail version showed why: when some
        # components are positive and others negative (the ordinary case --
        # this worked example has both), a later segment has to double back
        # over ground an earlier one already covered, and two arrowheads
        # pointing opposite ways along the same line reads as a contradiction,
        # not a running total. Summing is instead shown as a clean merge: the
        # N individual components fade out together as ONE combined total
        # fades in, which is unambiguous regardless of how many signs flip.
        caption_h = Text(
            "resolving and adding the horizontal components", font_size=22, color=INK
        ).to_edge(DOWN)
        self.play(FadeIn(caption_h))

        horizontal_vectors = [v.copy().set_color(horizontal_color) for v in origin_vectors]
        self.add(*horizontal_vectors)
        h_targets = [Vector(axes.c2p(value, 0), color=horizontal_color) for value in fx]
        self.play(*[Transform(v, t) for v, t in zip(horizontal_vectors, h_targets)], run_time=1.6)
        self.wait(0.4)

        horizontal_total = Vector(axes.c2p(sum_fx, 0), color=horizontal_color)
        sum_fx_label = Text(f"ΣFx = {sum_fx:.2f} N", font_size=20, color=horizontal_color).next_to(
            axes.c2p(sum_fx, 0), DOWN, buff=0.25
        )
        self.play(*[FadeOut(v) for v in horizontal_vectors], FadeIn(horizontal_total))
        self.play(FadeIn(sum_fx_label))
        self.wait(0.4)
        self.play(FadeOut(caption_h))

        # Act 3: the same thing for the vertical components, using fresh
        # copies -- the horizontal copies are already spoken for above.
        caption_v = Text(
            "resolving and adding the vertical components", font_size=22, color=INK
        ).to_edge(DOWN)
        self.play(FadeIn(caption_v))

        vertical_vectors = [v.copy().set_color(vertical_color) for v in origin_vectors]
        self.add(*vertical_vectors)
        v_targets = [Vector(axes.c2p(0, value), color=vertical_color) for value in fy]
        self.play(*[Transform(v, t) for v, t in zip(vertical_vectors, v_targets)], run_time=1.6)
        self.wait(0.4)

        vertical_total = Vector(axes.c2p(0, sum_fy), color=vertical_color)
        sum_fy_label = Text(f"ΣFy = {sum_fy:.2f} N", font_size=20, color=vertical_color).next_to(
            axes.c2p(0, sum_fy), RIGHT, buff=0.25
        )
        self.play(*[FadeOut(v) for v in vertical_vectors], FadeIn(vertical_total))
        self.play(FadeIn(sum_fy_label))
        self.wait(0.4)
        self.play(FadeOut(caption_v))

        # Declutter before the final combination: the fan, its labels, the
        # angle arcs, AND the two ΣFx/ΣFy readouts have all done their job.
        # The readouts specifically: the final right-angle construction
        # brings the two totals' own tips close together (their legs are
        # far shorter than the original forces that produced them), and a
        # real render showed "R"/"ΣFy" crowd together once that happens --
        # the two coloured total vectors already encode the same values
        # geometrically, so the text is safe to clear rather than reposition.
        self.play(
            *[FadeOut(v) for v in origin_vectors],
            *[FadeOut(l) for l in origin_labels],
            *[FadeOut(a) for a in angle_arcs],
            *[FadeOut(l) for l in angle_labels],
            FadeOut(sum_fx_label),
            FadeOut(sum_fy_label),
        )

        # Act 4: combine the two totals exactly the way Cambridge's own
        # working does -- shift the vertical total (translation only, it is
        # already vertical) to start where the horizontal total ends,
        # forming a right-angle corner, then the resultant is the diagonal
        # from the true origin to that corner.
        caption_combine = Text("combining the two totals", font_size=22, color=INK).to_edge(DOWN)
        self.play(FadeIn(caption_combine))
        shifted_vertical = Arrow(
            axes.c2p(sum_fx, 0), axes.c2p(sum_fx, sum_fy), color=vertical_color, buff=0
        )
        self.play(Transform(vertical_total, shifted_vertical), run_time=1.2)
        self.wait(0.3)
        self.play(FadeOut(caption_combine))

        resultant_point = axes.c2p(sum_fx, sum_fy)
        resultant_vector = Vector(resultant_point, color=resultant_color)
        resultant_tip_label = _label_past_end(
            str(resultant_label_text), resultant_color, ORIGIN, resultant_point
        )
        self.play(Create(resultant_vector), FadeIn(resultant_tip_label))

        magnitude = math.hypot(sum_fx, sum_fy)
        angle_deg = math.degrees(math.atan2(sum_fy, sum_fx))
        readout = Text(
            f"R = {magnitude:.2f} N at {angle_deg:.1f}° from +x",
            font_size=20,
            color=INK,
        ).to_edge(DOWN)
        self.play(FadeIn(readout))
        self.wait(1.2)
