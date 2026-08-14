"""Real Manim render, real ffmpeg, real disk I/O. Not part of the offline
pytest suite -- same split this project already uses for the database
(live_smoke.py) and the model (evaluate_tutor.py): the fakes in
test_manim_renderer.py would happily pass a manim API that no longer exists
(a renamed plot() kwarg, a get_area()/Surface signature change on upgrade),
so this is the one that actually catches that. Takes tens of seconds; run it
after any change to manim_renderer.py, either template file, or the pinned
manim version in requirements.txt.

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
from app.models import ManimBoundedRegionParams, ManimSpec, ManimTemplate  # noqa: E402

CASES = {
    "region_sweep": ManimSpec(
        template=ManimTemplate.REGION_SWEEP,
        region_sweep=ManimBoundedRegionParams(
            lower_expr="0.5*x + 4/x",
            x_min=1,
            x_max=8,
            lower_label="y = 0.5x + 4/x",
            region_color="#F5C453",
        ),
    ),
    "volume_of_revolution (washer, two curves)": ManimSpec(
        template=ManimTemplate.VOLUME_OF_REVOLUTION,
        volume_of_revolution=ManimBoundedRegionParams(
            lower_expr="0.5*x + 4/x",
            upper_expr="4.5",
            x_min=1,
            x_max=8,
            lower_label="y = 0.5x + 4/x",
            upper_label="y = 4.5",
            region_color="#F5C453",
        ),
    ),
    "volume_of_revolution (solid disk, one curve)": ManimSpec(
        template=ManimTemplate.VOLUME_OF_REVOLUTION,
        volume_of_revolution=ManimBoundedRegionParams(
            lower_expr="4*sqrt(x)-x",
            x_min=4,
            x_max=16,
            lower_label="y = 4sqrt(x) - x",
            region_color="#9DB4FF",
        ),
    ),
}


def main() -> int:
    failures = 0
    for name, spec in CASES.items():
        start = time.time()
        try:
            output_path = render_to_mp4(spec)
        except ManimRenderError as error:
            print(f"FAIL [{name}]: render_to_mp4 raised: {error}")
            failures += 1
            continue

        elapsed = time.time() - start
        try:
            size = output_path.stat().st_size
            if size < 1000:
                print(f"FAIL [{name}]: output mp4 is suspiciously small ({size} bytes)")
                failures += 1
                continue
            print(f"OK [{name}]: rendered {size} bytes in {elapsed:.1f}s -> {output_path}")
        finally:
            output_path.unlink(missing_ok=True)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
