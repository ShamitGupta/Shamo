"""Manim's safety boundary lives at validate_visual_payload, same as GeoGebra's
does. These tests exercise that boundary directly with hand-built payloads --
no model call, no render -- because the render step is expensive and these
properties should hold regardless of whether the render ever runs.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.models import QuestionRef  # noqa: E402
from app.visualize import validate_visual_payload  # noqa: E402

REF = QuestionRef(year=2025, exam_session="oct_nov", paper_variant="51", question_number=4)


def _payload(manim: dict, **overrides) -> dict:
    base = {
        "visual_spec_version": "visual-v1",
        "message_markdown": "Watch the region sweep out.",
        "fallback_markdown": "Could not build the animation.",
        "artifacts": [
            {
                "artifact_kind": "manim_template_video",
                "title": "Region sweep",
                "purpose": "Animate the region under the curve.",
                "narration_markdown": "Watch the shaded region fill in.",
                "accessibility_text": "An animation of a region filling in under a curve.",
                "manim": manim,
            }
        ],
    }
    base.update(overrides)
    return base


VALID_REGION_SWEEP = {
    "template": "region_sweep",
    "region_sweep": {
        "lower_expr": "0.5*x + 4/x",
        "x_min": 1,
        "x_max": 8,
        "lower_label": "y = 0.5x + 4/x",
    },
}


def test_valid_region_sweep_is_accepted():
    response = validate_visual_payload(_payload(VALID_REGION_SWEEP), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.region_sweep.lower_expr == "0.5*x + 4/x"


def test_model_cannot_set_video_url_or_storage_path():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["video_storage_path"] = "generated/somewhere-else.mp4"
    payload["artifacts"][0]["video_url"] = "https://example.com/video.mp4"
    response = validate_visual_payload(payload, REF)
    artifact = response.artifacts[0]
    assert artifact.video_storage_path is None
    assert artifact.video_url is None


@pytest.mark.parametrize(
    "bad_expr",
    [
        "__import__('os').system('echo pwned')",
        "open('secret.txt').read()",
        "x.__class__",
    ],
)
def test_code_execution_attempt_in_expression_is_rejected(bad_expr):
    manim = {
        "template": "region_sweep",
        "region_sweep": {"lower_expr": bad_expr, "x_min": 1, "x_max": 8},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_mismatched_kind_and_spec_is_rejected():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["artifact_kind"] = "desmos_2d"
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_manim_artifact_cannot_also_carry_desmos_spec():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["desmos"] = {
        "calculator": "graphing",
        "expressions": [{"id": "a", "latex": "y=x"}],
    }
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_x_max_not_greater_than_x_min_is_rejected():
    manim = {
        "template": "region_sweep",
        "region_sweep": {"lower_expr": "x", "x_min": 5, "x_max": 5},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


VALID_VOLUME_OF_REVOLUTION = {
    "template": "volume_of_revolution",
    "volume_of_revolution": {
        "lower_expr": "0.5*x + 4/x",
        "upper_expr": "4.5",
        "x_min": 1,
        "x_max": 8,
        "lower_label": "y = 0.5x + 4/x",
        "upper_label": "y = 4.5",
    },
}


def test_valid_volume_of_revolution_is_accepted():
    response = validate_visual_payload(_payload(VALID_VOLUME_OF_REVOLUTION), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.volume_of_revolution.upper_expr == "4.5"


def test_volume_of_revolution_without_upper_expr_is_accepted():
    # The disk case: rotating the region between one curve and the x-axis.
    manim = {
        "template": "volume_of_revolution",
        "volume_of_revolution": {"lower_expr": "4*sqrt(x)-x", "x_min": 4, "x_max": 16},
    }
    response = validate_visual_payload(_payload(manim), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.volume_of_revolution.upper_expr is None


def test_volume_of_revolution_cannot_also_carry_region_sweep_params():
    payload = _payload(VALID_VOLUME_OF_REVOLUTION)
    payload["artifacts"][0]["manim"]["region_sweep"] = VALID_REGION_SWEEP["region_sweep"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_region_sweep_template_cannot_carry_volume_of_revolution_params():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["manim"]["volume_of_revolution"] = VALID_VOLUME_OF_REVOLUTION["volume_of_revolution"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_code_execution_attempt_in_volume_of_revolution_expression_is_rejected():
    manim = {
        "template": "volume_of_revolution",
        "volume_of_revolution": {"lower_expr": "__import__('os').system('echo pwned')", "x_min": 1, "x_max": 8},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)
