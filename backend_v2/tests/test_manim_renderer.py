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

VALID_SPEC = ManimSpec(
    template=ManimTemplate.REGION_SWEEP,
    region_sweep=ManimBoundedRegionParams(lower_expr="x", x_min=1, x_max=5),
)

VALID_VOLUME_SPEC = ManimSpec(
    template=ManimTemplate.VOLUME_OF_REVOLUTION,
    volume_of_revolution=ManimBoundedRegionParams(lower_expr="x", x_min=1, x_max=5),
)

VALID_TANGENT_LINE_SPEC = ManimSpec(
    template=ManimTemplate.TANGENT_LINE,
    tangent_line=ManimTangentLineParams(expr="x^2", x_min=-2, x_max=5, point_of_interest_x=2),
)

VALID_COBWEB_SPEC = ManimSpec(
    template=ManimTemplate.COBWEB_DIAGRAM,
    cobweb_diagram=ManimCobwebDiagramParams(
        g_expr="sqrt(4/(5-2*x))", x0=1.2, iterations=6, x_min=0.5, x_max=2.0
    ),
)

VALID_COMPLEX_TRANSFORM_SPEC = ManimSpec(
    template=ManimTemplate.COMPLEX_TRANSFORM,
    complex_transform=ManimComplexTransformParams(
        start_modulus=3, start_argument=0.7853981634, factor_modulus=1.5, factor_argument=0.5235987756
    ),
)

VALID_KINEMATICS_SPEC = ManimSpec(
    template=ManimTemplate.KINEMATICS_MOTION,
    kinematics_motion=ManimKinematicsParams(
        expr="3*t^1.5 - 6*t", quantity="s", t_min=0, t_max=6, time_of_interest_t=4
    ),
)

VALID_FORCE_RESULTANT_SPEC = ManimSpec(
    template=ManimTemplate.FORCE_RESULTANT,
    force_resultant=ManimForceResultantParams(
        magnitudes=[45, 28, 72, 35], angles_degrees=[90, 35, -50, 240], resultant_label="R"
    ),
)


def _fake_completed_process(returncode: int, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout="", stderr=stderr)


def _fake_run_factory(scene_dirname: str):
    """A fake subprocess.run standing in for BOTH real calls render_to_mp4
    makes: the manim render itself (identified by --media_dir) and the
    faststart remux that now follows it (identified by -movflags). The
    remux fake copies bytes through unchanged, matching what a real lossless
    -c copy remux does, so existing "read_bytes() == b'fake-mp4-bytes'"
    assertions keep meaning what they said before this second call existed.
    Returns (fake_run, seen_commands) -- seen_commands[0] is always the
    manim call, since it always happens first.
    """

    seen_commands: list[list[str]] = []

    def fake_run(command, *args, **kwargs):
        seen_commands.append(command)
        if "-movflags" in command:
            src = Path(command[command.index("-i") + 1])
            dest = Path(command[-1])
            dest.write_bytes(src.read_bytes())
            return _fake_completed_process(0)
        media_dir = Path(command[command.index("--media_dir") + 1])
        scene_class = command[-1]
        output_dir = media_dir / "videos" / scene_dirname / "720p30"
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / f"{scene_class}.mp4").write_bytes(b"fake-mp4-bytes")
        return _fake_completed_process(0)

    return fake_run, seen_commands


def test_successful_render_copies_mp4_out_of_the_temp_dir(monkeypatch, tmp_path):
    fake_run, _ = _fake_run_factory("region_sweep")
    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_SPEC)
    try:
        assert output_path.exists()
        assert output_path.read_bytes() == b"fake-mp4-bytes"
    finally:
        output_path.unlink(missing_ok=True)


def test_faststart_remux_failure_falls_back_to_the_unmuxed_file(monkeypatch):
    def fake_run(command, *args, **kwargs):
        if "-movflags" in command:
            return _fake_completed_process(1, "remux boom")
        media_dir = Path(command[command.index("--media_dir") + 1])
        scene_class = command[-1]
        output_dir = media_dir / "videos" / "region_sweep" / "720p30"
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / f"{scene_class}.mp4").write_bytes(b"fake-mp4-bytes")
        return _fake_completed_process(0)

    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_SPEC)
    try:
        # A failed remux must not lose an otherwise-successful render: the
        # original (pre-remux) bytes are still returned.
        assert output_path.read_bytes() == b"fake-mp4-bytes"
    finally:
        output_path.unlink(missing_ok=True)


def test_partial_movie_files_are_never_mistaken_for_the_final_output(monkeypatch):
    def fake_run(command, cwd, env, capture_output, text, timeout, check):
        media_dir = Path(command[command.index("--media_dir") + 1])
        scene_class = command[-1]
        # A stray partial_movie_files/*.mp4 that happens to share the scene's
        # class name in its path must not be picked up as the final render.
        partial_dir = media_dir / "videos" / "region_sweep" / "720p30" / "partial_movie_files" / scene_class
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


def test_volume_of_revolution_resolves_to_its_own_scene_file(monkeypatch):
    fake_run, seen_commands = _fake_run_factory("volume_of_revolution")
    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_VOLUME_SPEC)
    try:
        assert output_path.read_bytes() == b"fake-mp4-bytes"
        assert any("volume_of_revolution.py" in str(part) for part in seen_commands[0])
        assert seen_commands[0][-1] == "VolumeOfRevolutionScene"
    finally:
        output_path.unlink(missing_ok=True)


def test_tangent_line_resolves_to_its_own_scene_file(monkeypatch):
    fake_run, seen_commands = _fake_run_factory("tangent_line")
    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_TANGENT_LINE_SPEC)
    try:
        assert output_path.read_bytes() == b"fake-mp4-bytes"
        assert any("tangent_line.py" in str(part) for part in seen_commands[0])
        assert seen_commands[0][-1] == "TangentLineScene"
    finally:
        output_path.unlink(missing_ok=True)


def test_cobweb_diagram_resolves_to_its_own_scene_file(monkeypatch):
    fake_run, seen_commands = _fake_run_factory("cobweb_diagram")
    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_COBWEB_SPEC)
    try:
        assert output_path.read_bytes() == b"fake-mp4-bytes"
        assert any("cobweb_diagram.py" in str(part) for part in seen_commands[0])
        assert seen_commands[0][-1] == "CobwebDiagramScene"
    finally:
        output_path.unlink(missing_ok=True)


def test_complex_transform_resolves_to_its_own_scene_file(monkeypatch):
    fake_run, seen_commands = _fake_run_factory("complex_transform")
    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_COMPLEX_TRANSFORM_SPEC)
    try:
        assert output_path.read_bytes() == b"fake-mp4-bytes"
        assert any("complex_transform.py" in str(part) for part in seen_commands[0])
        assert seen_commands[0][-1] == "ComplexTransformScene"
    finally:
        output_path.unlink(missing_ok=True)


def test_kinematics_motion_resolves_to_its_own_scene_file(monkeypatch):
    fake_run, seen_commands = _fake_run_factory("kinematics_motion")
    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_KINEMATICS_SPEC)
    try:
        assert output_path.read_bytes() == b"fake-mp4-bytes"
        assert any("kinematics_motion.py" in str(part) for part in seen_commands[0])
        assert seen_commands[0][-1] == "KinematicsMotionScene"
    finally:
        output_path.unlink(missing_ok=True)


def test_force_resultant_resolves_to_its_own_scene_file(monkeypatch):
    fake_run, seen_commands = _fake_run_factory("force_resultant")
    monkeypatch.setattr(manim_renderer.subprocess, "run", fake_run)

    output_path = manim_renderer.render_to_mp4(VALID_FORCE_RESULTANT_SPEC)
    try:
        assert output_path.read_bytes() == b"fake-mp4-bytes"
        assert any("force_resultant.py" in str(part) for part in seen_commands[0])
        assert seen_commands[0][-1] == "ForceResultantScene"
    finally:
        output_path.unlink(missing_ok=True)
