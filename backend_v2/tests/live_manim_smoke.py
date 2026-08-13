"""Real Manim render, real ffmpeg, real disk I/O. Not part of the offline
pytest suite -- same split this project already uses for the database
(live_smoke.py) and the model (evaluate_tutor.py): the fakes in
test_manim_renderer.py would happily pass a manim API that no longer exists
(a renamed plot() kwarg, a get_area() signature change on upgrade), so this
is the one that actually catches that. Takes several seconds; run it after
any change to manim_renderer.py, region_sweep.py, or the pinned manim version
in requirements.txt.

    python backend_v2/tests/live_manim_smoke.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.manim_renderer import ManimRenderError, render_to_mp4  # noqa: E402
from app.models import ManimRegionSweepParams, ManimSpec, ManimTemplate  # noqa: E402


def main() -> int:
    spec = ManimSpec(
        template=ManimTemplate.REGION_SWEEP,
        region_sweep=ManimRegionSweepParams(
            lower_expr="0.5*x + 4/x",
            x_min=1,
            x_max=8,
            lower_label="y = 0.5x + 4/x",
            region_color="#F5C453",
        ),
    )

    start = time.time()
    try:
        output_path = render_to_mp4(spec)
    except ManimRenderError as error:
        print(f"FAIL: render_to_mp4 raised: {error}")
        return 1

    elapsed = time.time() - start
    try:
        size = output_path.stat().st_size
        if size < 1000:
            print(f"FAIL: output mp4 is suspiciously small ({size} bytes)")
            return 1
        print(f"OK: rendered {size} bytes in {elapsed:.1f}s -> {output_path}")
        return 0
    finally:
        output_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
