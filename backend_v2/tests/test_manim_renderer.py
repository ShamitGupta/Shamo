"""manim_renderer's branching logic, tested without ever invoking real manim.

A real render takes several seconds and needs manim/ffmpeg installed, so it
does not belong in the free offline suite -- that coverage lives in
live_manim_smoke.py, the same split this project already uses for the
database (live_smoke.py) and the model (evaluate_tutor.py). What belongs here
is everything this module decides on its own: which template maps to which
scene file, how a nonzero exit code or a timeout is turned into
ManimRenderError, and that the located mp4 is copied out before the temp
directory it lived in is cleaned up.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app import manim_renderer  # noqa: E402
from app.models import ManimRegionSweepParams, ManimSpec, ManimTemplate  # noqa: E402

VALID_SPEC = ManimSpec(
    template=ManimTemplate.REGION_SWEEP,
    region_sweep=ManimRegionSweepParams(lower_expr="x", x_min=1, x_max=5),
)


def _fake_completed_process(returncode: int, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout="", stderr=stderr)


def test_successful_render_copies_mp4_out_of_the_temp_dir(monkeypatch, tmp_path):
    def fake_run(command, cwd, env, capture_output, text, timeout, check):
        # Mimic manim: by the time it "succeeds", the mp4 exists under --media_dir.
        media_dir = Path(command[command.index("--media_dir") + 1])
        scene_class = command[-1]
        output_dir = media_dir / "videos" / "region_sweep" / "480p15"
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / f"{scene_class}.mp4").write_bytes(b"fake-mp4-bytes")
        return _fake_completed_process(0)

    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_SPEC)
    try:
        assert output_path.exists()
        assert output_path.read_bytes() == b"fake-mp4-bytes"
    finally:
        output_path.unlink(missing_ok=True)


def test_partial_movie_files_are_never_mistaken_for_the_final_output(monkeypatch):
    def fake_run(command, cwd, env, capture_output, text, timeout, check):
        media_dir = Path(command[command.index("--media_dir") + 1])
        scene_class = command[-1]
        # A stray partial_movie_files/*.mp4 that happens to share the scene's
        # class name in its path must not be picked up as the final render.
        partial_dir = media_dir / "videos" / "region_sweep" / "480p15" / "partial_movie_files" / scene_class
        partial_dir.mkdir(parents=True, exist_ok=True)
        (partial_dir / f"{scene_class}.mp4").write_bytes(b"partial")
        return _fake_completed_process(0)

    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    with pytest.raises(manim_renderer.ManimRenderError, match="no output file"):
        manim_renderer.render_to_mp4(VALID_SPEC)


def test_nonzero_exit_code_raises_manim_render_error(monkeypatch):
    monkeypatch.setattr(
        manim_renderer.subprocess, "run", lambda *a, **k: _fake_completed_process(1, "boom")
    )
    with pytest.raises(manim_renderer.ManimRenderError):
        manim_renderer.render_to_mp4(VALID_SPEC)


def test_timeout_raises_manim_render_error(monkeypatch):
    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="manim", timeout=60)

    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)
    with pytest.raises(manim_renderer.ManimRenderError, match="exceeded"):
        manim_renderer.render_to_mp4(VALID_SPEC)


def test_subprocess_is_never_invoked_for_a_nonexistent_scene_file(monkeypatch):
    calls = []
    monkeypatch.setattr(manim_renderer.subprocess, "run", lambda *a, **k: calls.append(1))
    monkeypatch.setitem(
        manim_renderer._SCENE_BY_TEMPLATE, "region_sweep", ("does_not_exist.py", "RegionSweepScene")
    )
    with pytest.raises(manim_renderer.ManimRenderError, match="missing"):
        manim_renderer.render_to_mp4(VALID_SPEC)
    assert calls == []
