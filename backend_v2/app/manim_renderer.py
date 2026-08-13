"""Isolated, template-only Manim rendering.

The model never supplies Manim code, only bounded numeric parameters for one
of a small, fixed set of scene templates living in manim_templates/ -- those
files are reviewed and shipped with this service, never generated at request
time. Rendering itself runs in a separate subprocess with a hard wall-clock
timeout, so a pathological parameter set (e.g. an expression that is safe but
numerically extreme) can only waste one bounded render slot; it cannot hang
or crash the API process, and it has no more filesystem/network reach than
any other subprocess this machine already runs.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .models import ManimSpec

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "manim_templates"

# -ql (480p15) renders in a few seconds for a scene this simple, which is what
# makes a synchronous request/response cycle viable at all. -qm/-qh are for
# reviewed, offline content only and are not wired up here.
RENDER_QUALITY_FLAG = "-ql"
RENDER_TIMEOUT_SECONDS = 60

_SCENE_BY_TEMPLATE: dict[str, tuple[str, str]] = {
    "region_sweep": ("region_sweep.py", "RegionSweepScene"),
}


class ManimRenderError(RuntimeError):
    """Rendering failed, timed out, or produced no output.

    The caller should treat this the same as a rejected spec: fall back to
    text, never surface a raw subprocess error to a student.
    """


def render_to_mp4(spec: ManimSpec) -> Path:
    """Render spec and return a path to the resulting mp4.

    The returned file lives outside any temp directory this function created,
    so it survives after this call returns. The caller owns it and must
    delete it once it has been uploaded (or on any failure path).
    """

    try:
        scene_file, scene_class = _SCENE_BY_TEMPLATE[spec.template.value]
    except KeyError as error:
        raise ManimRenderError(f"unknown Manim template: {spec.template.value}") from error

    scene_path = TEMPLATES_DIR / scene_file
    if not scene_path.exists():
        raise ManimRenderError(f"template scene file is missing: {scene_file}")

    params = spec.region_sweep.model_dump() if spec.region_sweep else {}

    with tempfile.TemporaryDirectory(prefix="shamo-manim-") as tmp:
        tmp_path = Path(tmp)
        params_path = tmp_path / "params.json"
        params_path.write_text(json.dumps(params), encoding="utf-8")
        media_dir = tmp_path / "media"

        env = dict(os.environ)
        env["SHAMO_MANIM_PARAMS_PATH"] = str(params_path)

        command = [
            sys.executable,
            "-m",
            "manim",
            "render",
            RENDER_QUALITY_FLAG,
            "--media_dir",
            str(media_dir),
            "--disable_caching",
            str(scene_path),
            scene_class,
        ]
        try:
            result = subprocess.run(
                command,
                cwd=TEMPLATES_DIR,
                env=env,
                capture_output=True,
                text=True,
                timeout=RENDER_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise ManimRenderError(f"render exceeded {RENDER_TIMEOUT_SECONDS}s") from error

        if result.returncode != 0:
            logger.warning("Manim render failed (rc=%s): %s", result.returncode, result.stderr[-2000:])
            raise ManimRenderError("the render process failed")

        rendered = [
            path
            for path in media_dir.rglob(f"{scene_class}.mp4")
            if "partial_movie_files" not in path.parts
        ]
        if not rendered:
            raise ManimRenderError("render succeeded but produced no output file")

        output_fd, output_name = tempfile.mkstemp(suffix=".mp4", prefix="shamo-manim-out-")
        os.close(output_fd)
        output_path = Path(output_name)
        shutil.copyfile(rendered[0], output_path)
        return output_path
