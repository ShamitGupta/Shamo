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
from app.models import (  # noqa: E402
    ManimBoundedRegionParams,
    ManimCobwebDiagramParams,
    ManimComplexTransformParams,
    ManimForceResultantParams,
    ManimKinematicsParams,
    ManimSpec,
    ManimTangentLineParams,
    ManimTemplate,
)

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
    "tangent_line": ManimSpec(
        template=ManimTemplate.TANGENT_LINE,
        tangent_line=ManimTangentLineParams(
            expr="x^2 - 3*x + 1",
            x_min=-2,
            x_max=5,
            point_of_interest_x=2,
            curve_label="y = x^2 - 3x + 1",
        ),
    ),
    "cobweb_diagram": ManimSpec(
        template=ManimTemplate.COBWEB_DIAGRAM,
        cobweb_diagram=ManimCobwebDiagramParams(
            g_expr="sqrt(4/(5-2*x))",
            x0=1.2,
            iterations=6,
            x_min=0.5,
            x_max=2.0,
            g_label="g(x) = sqrt(4/(5-2x))",
        ),
    ),
    "complex_transform (multiply)": ManimSpec(
        template=ManimTemplate.COMPLEX_TRANSFORM,
        complex_transform=ManimComplexTransformParams(
            start_modulus=3,
            start_argument=0.7853981634,
            factor_modulus=1.5,
            factor_argument=0.5235987756,
            operation="multiply",
            start_label="z1",
            factor_label="z2",
            result_label="z1 z2",
        ),
    ),
    "complex_transform (divide)": ManimSpec(
        template=ManimTemplate.COMPLEX_TRANSFORM,
        complex_transform=ManimComplexTransformParams(
            start_modulus=3,
            start_argument=0.7853981634,
            factor_modulus=1.5,
            factor_argument=0.5235987756,
            operation="divide",
            start_label="z1",
            factor_label="z2",
            result_label="z1 / z2",
        ),
    ),
    "kinematics_motion (s given)": ManimSpec(
        template=ManimTemplate.KINEMATICS_MOTION,
        kinematics_motion=ManimKinematicsParams(
            expr="3*t^1.5 - 6*t",
            quantity="s",
            t_min=0,
            t_max=6,
            time_of_interest_t=4,
            curve_label="s = 3t^1.5 - 6t",
        ),
    ),
    "kinematics_motion (v given)": ManimSpec(
        template=ManimTemplate.KINEMATICS_MOTION,
        kinematics_motion=ManimKinematicsParams(
            expr="(2*t+1)^1.5 - 2*t^2",
            quantity="v",
            t_min=0,
            t_max=3,
            time_of_interest_t=1.5,
            s_at_t_min=0,
            curve_label="v = (2t+1)^1.5 - 2t^2",
        ),
    ),
    "force_resultant": ManimSpec(
        template=ManimTemplate.FORCE_RESULTANT,
        force_resultant=ManimForceResultantParams(
            magnitudes=[45, 28, 72, 35],
            angles_degrees=[90, 35, -50, 240],
            resultant_label="R",
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
