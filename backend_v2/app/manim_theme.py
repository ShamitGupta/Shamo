"""Shared color tokens for the Manim scene templates.

Both region_sweep.py and volume_of_revolution.py import these instead of
manim's named colors (WHITE/GRAY/BLACK) so the rendered video shares a
palette with the rest of the tutor app rather than reading as a generic
Manim tutorial bolted onto the product. Values are taken directly from
frontend/src/ChatSection/VisualArtifactCard.module.css, the card the video
actually renders inside.

Imported the same way both scene files already import app.safe_math -- an
absolute import through the app package, via the sys.path.insert shim each
scene file sets up before manim runs it directly as a script.
"""

from __future__ import annotations

BACKGROUND = "#0F1117"
"""Matches .VisualShell's background -- the scene's own canvas color."""

INK = "#E7EBF2"
"""Matches the card's primary text color. Primary curve, axis-of-rotation
line, and bound/lower labels -- anything that is a fixed part of the
picture rather than the one thing actively being taught."""

GUIDE = "#AEB8C7"
"""Matches the card's secondary/caption text color. Dashed guides, the
origin label, and small annotation captions."""

ACCENT = "#9DB4FF"
"""The app's one existing "active/primary" accent. The single rotating
highlight in volume_of_revolution.py -- the one element the whole scene
exists to draw the eye to."""

ACCENT_SHADE = "#7182B8"
"""A darker tone of ACCENT, same hue. Used only as the second entry in a
Surface's checkerboard_colors, so alternating faces read as a roundness/
shading cue instead of one flat, lightless color."""

REGION_DEFAULT = "#F5C453"
"""Unchanged fallback for the student-facing region_color parameter. Kept
because it is already visually distinct from ACCENT (warm vs. cool) and
from BACKGROUND, and does not collide with any app UI token."""
