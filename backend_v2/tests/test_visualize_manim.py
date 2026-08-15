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


VALID_TANGENT_LINE = {
    "template": "tangent_line",
    "tangent_line": {
        "expr": "x^2 - 3*x + 1",
        "x_min": -2,
        "x_max": 5,
        "point_of_interest_x": 2,
        "curve_label": "y = x^2 - 3x + 1",
    },
}


def test_valid_tangent_line_is_accepted():
    response = validate_visual_payload(_payload(VALID_TANGENT_LINE), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.tangent_line.point_of_interest_x == 2


def test_tangent_line_point_too_close_to_domain_edge_is_rejected():
    manim = {
        "template": "tangent_line",
        "tangent_line": {"expr": "x^2", "x_min": 0, "x_max": 5, "point_of_interest_x": 0.01},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_tangent_line_point_outside_domain_is_rejected():
    manim = {
        "template": "tangent_line",
        "tangent_line": {"expr": "x^2", "x_min": 0, "x_max": 5, "point_of_interest_x": 9},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_tangent_line_narrow_domain_is_rejected():
    manim = {
        "template": "tangent_line",
        "tangent_line": {"expr": "x", "x_min": 1, "x_max": 1.5, "point_of_interest_x": 1.2},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_tangent_line_cannot_also_carry_region_sweep_params():
    payload = _payload(VALID_TANGENT_LINE)
    payload["artifacts"][0]["manim"]["region_sweep"] = VALID_REGION_SWEEP["region_sweep"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_region_sweep_template_cannot_carry_tangent_line_params():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["manim"]["tangent_line"] = VALID_TANGENT_LINE["tangent_line"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_code_execution_attempt_in_tangent_line_expression_is_rejected():
    manim = {
        "template": "tangent_line",
        "tangent_line": {
            "expr": "__import__('os').system('echo pwned')",
            "x_min": -2,
            "x_max": 5,
            "point_of_interest_x": 2,
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_tangent_line_domain_spanning_a_singularity_is_rejected():
    # The exact shape of a real live failure: y = 2x + 12/x^2 is completely
    # AST-safe, but a domain spanning x = 0 crashed the render subprocess
    # outright with ZeroDivisionError. This must be caught before a render
    # is ever attempted.
    manim = {
        "template": "tangent_line",
        "tangent_line": {"expr": "2*x + 12/x^2", "x_min": -6, "x_max": 2, "point_of_interest_x": -2},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_tangent_line_domain_kept_to_one_side_of_a_singularity_is_accepted():
    # Same expression, but the domain the fixed prompt now asks for: both
    # endpoints on the same side of x = 0 as the point of interest.
    manim = {
        "template": "tangent_line",
        "tangent_line": {"expr": "2*x + 12/x^2", "x_min": -6, "x_max": -0.5, "point_of_interest_x": -2},
    }
    response = validate_visual_payload(_payload(manim), REF)
    assert response.validation_status.value == "validated"


def test_fractional_power_going_negative_is_rejected_not_an_uncaught_typeerror():
    # Python's ** silently returns a complex number for a negative float
    # base with a non-integer exponent, and float() of that raises
    # TypeError -- a real, reachable failure for any fractional-power
    # expression over a domain that goes negative. _check_defined_over_domain
    # must catch this as a clean ValueError-driven rejection, not let a raw
    # TypeError escape validate_visual_payload uncaught (which would surface
    # as a 502 instead of the intended graceful text fallback).
    manim = {
        "template": "tangent_line",
        "tangent_line": {"expr": "x^1.5", "x_min": -2, "x_max": 5, "point_of_interest_x": 2},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_region_sweep_domain_spanning_a_singularity_is_rejected():
    manim = {
        "template": "region_sweep",
        "region_sweep": {"lower_expr": "4/x", "x_min": -3, "x_max": 3},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_region_sweep_domain_with_negative_sqrt_is_rejected():
    manim = {
        "template": "region_sweep",
        "region_sweep": {"lower_expr": "sqrt(x)", "x_min": -2, "x_max": 5},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


VALID_COBWEB_DIAGRAM = {
    "template": "cobweb_diagram",
    "cobweb_diagram": {
        "g_expr": "sqrt(4/(5-2*x))",
        "x0": 1.2,
        "iterations": 6,
        "x_min": 0.5,
        "x_max": 2.0,
        "g_label": "g(x) = sqrt(4/(5-2x))",
    },
}


def test_valid_cobweb_diagram_is_accepted():
    response = validate_visual_payload(_payload(VALID_COBWEB_DIAGRAM), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.cobweb_diagram.iterations == 6


def test_code_execution_attempt_in_cobweb_expression_is_rejected():
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {
            "g_expr": "__import__('os').system('echo pwned')",
            "x0": 1.2,
            "iterations": 4,
            "x_min": 0.5,
            "x_max": 2.0,
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_cobweb_x0_too_close_to_domain_edge_is_rejected():
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {"g_expr": "sqrt(x)", "x0": 0.01, "iterations": 4, "x_min": 0, "x_max": 5},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_cobweb_x0_outside_domain_is_rejected():
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {"g_expr": "sqrt(x)", "x0": 9, "iterations": 4, "x_min": 0, "x_max": 5},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_cobweb_domain_too_narrow_is_rejected():
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {"g_expr": "x", "x0": 1.2, "iterations": 2, "x_min": 1, "x_max": 1.3},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


@pytest.mark.parametrize("iterations", [1, 11])
def test_cobweb_iterations_out_of_bounds_is_rejected(iterations):
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {"g_expr": "sqrt(x)", "x0": 2, "iterations": iterations, "x_min": 0.5, "x_max": 5},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_cobweb_iteration_leaves_stated_domain_is_rejected():
    # A rearrangement that genuinely diverges from the exact same source
    # equation the worked example uses (2x^3-5x^2+4=0): verified numerically
    # that x0=1.2 reaches ~3.1 by the 9th iterate and ~19 by the 10th, well
    # outside a domain sized for the converging rearrangement.
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {
            "g_expr": "2*x^3-5*x^2+x+4",
            "x0": 1.2,
            "iterations": 10,
            "x_min": 0.9,
            "x_max": 2.2,
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_cobweb_iteration_undefined_partway_is_rejected():
    # g(2.0) = sqrt(0.5) is fine; g(sqrt(0.5)) = sqrt(0.7071-1.5) is a math
    # domain error. The FIRST iterate is defined; only a later one fails --
    # this is the ValueError branch, distinct from the leaves-domain branch.
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {"g_expr": "sqrt(x-1.5)", "x0": 2.0, "iterations": 3, "x_min": 0, "x_max": 3},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_cobweb_diagram_domain_spanning_a_singularity_in_the_curve_itself_is_rejected():
    # _check_defined_over_domain must still fire independently of the new
    # iterate check: a domain that spans a pole in g even though the
    # discrete iterates themselves never land near it.
    manim = {
        "template": "cobweb_diagram",
        "cobweb_diagram": {"g_expr": "4/x", "x0": 1.5, "iterations": 2, "x_min": -1, "x_max": 3},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_cobweb_diagram_cannot_also_carry_region_sweep_params():
    payload = _payload(VALID_COBWEB_DIAGRAM)
    payload["artifacts"][0]["manim"]["region_sweep"] = VALID_REGION_SWEEP["region_sweep"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_region_sweep_template_cannot_carry_cobweb_diagram_params():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["manim"]["cobweb_diagram"] = VALID_COBWEB_DIAGRAM["cobweb_diagram"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_tangent_line_template_cannot_carry_cobweb_diagram_params():
    payload = _payload(VALID_TANGENT_LINE)
    payload["artifacts"][0]["manim"]["cobweb_diagram"] = VALID_COBWEB_DIAGRAM["cobweb_diagram"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_volume_of_revolution_template_cannot_carry_cobweb_diagram_params():
    payload = _payload(VALID_VOLUME_OF_REVOLUTION)
    payload["artifacts"][0]["manim"]["cobweb_diagram"] = VALID_COBWEB_DIAGRAM["cobweb_diagram"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


VALID_COMPLEX_TRANSFORM = {
    "template": "complex_transform",
    "complex_transform": {
        "start_modulus": 3,
        "start_argument": 0.7853981634,
        "factor_modulus": 1.5,
        "factor_argument": 0.5235987756,
        "operation": "multiply",
        "start_label": "z1",
        "factor_label": "z2",
        "result_label": "z1 z2",
    },
}


def test_valid_complex_transform_multiply_is_accepted():
    response = validate_visual_payload(_payload(VALID_COMPLEX_TRANSFORM), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.complex_transform.operation == "multiply"


def test_valid_complex_transform_divide_is_accepted():
    manim = {
        "template": "complex_transform",
        "complex_transform": {
            "start_modulus": 3,
            "start_argument": 0.7853981634,
            "factor_modulus": 1.5,
            "factor_argument": 0.5235987756,
            "operation": "divide",
        },
    }
    response = validate_visual_payload(_payload(manim), REF)
    assert response.validation_status.value == "validated"


def test_complex_transform_resulting_modulus_out_of_bounds_is_rejected():
    manim = {
        "template": "complex_transform",
        "complex_transform": {
            "start_modulus": 40,
            "start_argument": 0,
            "factor_modulus": 40,
            "factor_argument": 0,
            "operation": "multiply",
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_complex_transform_divide_by_near_zero_modulus_is_rejected():
    manim = {
        "template": "complex_transform",
        "complex_transform": {
            "start_modulus": 3,
            "start_argument": 0,
            "factor_modulus": 0.01,
            "factor_argument": 0,
            "operation": "divide",
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_complex_transform_zero_modulus_is_rejected():
    manim = {
        "template": "complex_transform",
        "complex_transform": {
            "start_modulus": 0,
            "start_argument": 0,
            "factor_modulus": 1.5,
            "factor_argument": 0,
            "operation": "multiply",
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_complex_transform_cannot_also_carry_region_sweep_params():
    payload = _payload(VALID_COMPLEX_TRANSFORM)
    payload["artifacts"][0]["manim"]["region_sweep"] = VALID_REGION_SWEEP["region_sweep"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_region_sweep_template_cannot_carry_complex_transform_params():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["manim"]["complex_transform"] = VALID_COMPLEX_TRANSFORM["complex_transform"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_tangent_line_template_cannot_carry_complex_transform_params():
    payload = _payload(VALID_TANGENT_LINE)
    payload["artifacts"][0]["manim"]["complex_transform"] = VALID_COMPLEX_TRANSFORM["complex_transform"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_volume_of_revolution_template_cannot_carry_complex_transform_params():
    payload = _payload(VALID_VOLUME_OF_REVOLUTION)
    payload["artifacts"][0]["manim"]["complex_transform"] = VALID_COMPLEX_TRANSFORM["complex_transform"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_cobweb_diagram_template_cannot_carry_complex_transform_params():
    payload = _payload(VALID_COBWEB_DIAGRAM)
    payload["artifacts"][0]["manim"]["complex_transform"] = VALID_COMPLEX_TRANSFORM["complex_transform"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


VALID_KINEMATICS_S = {
    "template": "kinematics_motion",
    "kinematics_motion": {
        "expr": "3*t^1.5 - 6*t",
        "quantity": "s",
        "t_min": 0,
        "t_max": 6,
        "time_of_interest_t": 4,
        "curve_label": "s = 3t^1.5 - 6t",
    },
}


def test_valid_kinematics_s_is_accepted():
    response = validate_visual_payload(_payload(VALID_KINEMATICS_S), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.kinematics_motion.quantity == "s"


def test_valid_kinematics_v_is_accepted():
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {
            "expr": "(2*t+1)^1.5 - 2*t^2",
            "quantity": "v",
            "t_min": 0,
            "t_max": 3,
            "time_of_interest_t": 1.5,
            "s_at_t_min": 0,
        },
    }
    response = validate_visual_payload(_payload(manim), REF)
    assert response.validation_status.value == "validated"


def test_kinematics_expr_referencing_x_instead_of_t_is_rejected():
    # The single most important test here: proves var_name="t" is actually
    # wired through end-to-end from _validate_manim, not just present in
    # safe_math's API.
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {"expr": "3*x^1.5 - 6*x", "t_min": 0, "t_max": 6, "time_of_interest_t": 4},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_kinematics_negative_t_min_is_rejected():
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {"expr": "t^2", "t_min": -2, "t_max": 5, "time_of_interest_t": 2},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_kinematics_time_of_interest_too_close_to_edge_is_rejected():
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {"expr": "t^2", "t_min": 0, "t_max": 6, "time_of_interest_t": 0.01},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_kinematics_time_of_interest_outside_domain_is_rejected():
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {"expr": "t^2", "t_min": 0, "t_max": 6, "time_of_interest_t": 9},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_kinematics_narrow_domain_is_rejected():
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {"expr": "t", "t_min": 1, "t_max": 1.5, "time_of_interest_t": 1.2},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_kinematics_domain_spanning_a_singularity_is_rejected():
    # A coefficient large enough that the nearest sample either side of the
    # pole clears the pole-indicator magnitude threshold with this domain's
    # sample spacing (matching the same lesson _MANIM_POLE_INDICATOR_MAGNITUDE
    # was built around: too small a coefficient can leave BOTH the exact hit
    # and every near-miss under threshold, same as the earlier "1/x"-shaped
    # false negative that motivated the sign-flip check in the first place).
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {"expr": "10/(t-3)", "t_min": 0, "t_max": 6, "time_of_interest_t": 1},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_kinematics_code_execution_attempt_is_rejected():
    manim = {
        "template": "kinematics_motion",
        "kinematics_motion": {
            "expr": "__import__('os').system('echo pwned')",
            "t_min": 0,
            "t_max": 6,
            "time_of_interest_t": 3,
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_kinematics_cannot_also_carry_region_sweep_params():
    payload = _payload(VALID_KINEMATICS_S)
    payload["artifacts"][0]["manim"]["region_sweep"] = VALID_REGION_SWEEP["region_sweep"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_region_sweep_template_cannot_carry_kinematics_params():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["manim"]["kinematics_motion"] = VALID_KINEMATICS_S["kinematics_motion"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_tangent_line_template_cannot_carry_kinematics_params():
    payload = _payload(VALID_TANGENT_LINE)
    payload["artifacts"][0]["manim"]["kinematics_motion"] = VALID_KINEMATICS_S["kinematics_motion"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_volume_of_revolution_template_cannot_carry_kinematics_params():
    payload = _payload(VALID_VOLUME_OF_REVOLUTION)
    payload["artifacts"][0]["manim"]["kinematics_motion"] = VALID_KINEMATICS_S["kinematics_motion"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_cobweb_diagram_template_cannot_carry_kinematics_params():
    payload = _payload(VALID_COBWEB_DIAGRAM)
    payload["artifacts"][0]["manim"]["kinematics_motion"] = VALID_KINEMATICS_S["kinematics_motion"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_complex_transform_template_cannot_carry_kinematics_params():
    payload = _payload(VALID_COMPLEX_TRANSFORM)
    payload["artifacts"][0]["manim"]["kinematics_motion"] = VALID_KINEMATICS_S["kinematics_motion"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


# Real worked example: 9709/41 Oct/Nov 2025 Q3 -- four coplanar forces
# (45N, 28N, 72N, 35N) act at a point; resultant is 57.2N at 25.3 degrees
# below the positive x-direction. Angles here are derived from the mark
# scheme's own resolved-components equations (e.g. "+28cos35" horizontally
# and "+28sin35" vertically means the 28N force sits at +35 degrees).
VALID_FORCE_RESULTANT = {
    "template": "force_resultant",
    "force_resultant": {
        "magnitudes": [45, 28, 72, 35],
        "angles_degrees": [90, 35, -50, 240],
        "resultant_label": "R",
    },
}


def test_valid_force_resultant_is_accepted():
    response = validate_visual_payload(_payload(VALID_FORCE_RESULTANT), REF)
    assert response.validation_status.value == "validated"
    assert response.artifacts[0].manim.force_resultant.magnitudes == [45, 28, 72, 35]


def test_force_resultant_length_mismatch_is_rejected():
    manim = {
        "template": "force_resultant",
        "force_resultant": {"magnitudes": [10, 20, 30], "angles_degrees": [0, 90]},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_magnitude_out_of_bounds_is_rejected():
    manim = {
        "template": "force_resultant",
        "force_resultant": {"magnitudes": [10, 600], "angles_degrees": [0, 90]},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_zero_magnitude_is_rejected():
    manim = {
        "template": "force_resultant",
        "force_resultant": {"magnitudes": [10, 0], "angles_degrees": [0, 90]},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_angle_out_of_bounds_is_rejected():
    manim = {
        "template": "force_resultant",
        "force_resultant": {"magnitudes": [10, 20], "angles_degrees": [0, 720]},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_near_equilibrium_is_rejected():
    # Two equal, opposite forces sum to (near) zero -- there is no meaningful
    # resultant direction for this template to animate toward. This is a
    # different question shape ("show the system is in equilibrium") that
    # this template deliberately does not serve.
    manim = {
        "template": "force_resultant",
        "force_resultant": {"magnitudes": [10, 10], "angles_degrees": [0, 180]},
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_magnitude_too_large_is_rejected():
    manim = {
        "template": "force_resultant",
        "force_resultant": {
            "magnitudes": [500, 500, 500, 500, 500],
            "angles_degrees": [0, 0, 0, 0, 0],
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_too_few_forces_is_rejected():
    manim = {"template": "force_resultant", "force_resultant": {"magnitudes": [10], "angles_degrees": [0]}}
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_too_many_forces_is_rejected():
    manim = {
        "template": "force_resultant",
        "force_resultant": {
            "magnitudes": [10, 10, 10, 10, 10, 10, 10],
            "angles_degrees": [0, 30, 60, 90, 120, 150, 180],
        },
    }
    with pytest.raises(Exception):
        validate_visual_payload(_payload(manim), REF)


def test_force_resultant_cannot_also_carry_region_sweep_params():
    payload = _payload(VALID_FORCE_RESULTANT)
    payload["artifacts"][0]["manim"]["region_sweep"] = VALID_REGION_SWEEP["region_sweep"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_region_sweep_template_cannot_carry_force_resultant_params():
    payload = _payload(VALID_REGION_SWEEP)
    payload["artifacts"][0]["manim"]["force_resultant"] = VALID_FORCE_RESULTANT["force_resultant"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_tangent_line_template_cannot_carry_force_resultant_params():
    payload = _payload(VALID_TANGENT_LINE)
    payload["artifacts"][0]["manim"]["force_resultant"] = VALID_FORCE_RESULTANT["force_resultant"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_volume_of_revolution_template_cannot_carry_force_resultant_params():
    payload = _payload(VALID_VOLUME_OF_REVOLUTION)
    payload["artifacts"][0]["manim"]["force_resultant"] = VALID_FORCE_RESULTANT["force_resultant"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_cobweb_diagram_template_cannot_carry_force_resultant_params():
    payload = _payload(VALID_COBWEB_DIAGRAM)
    payload["artifacts"][0]["manim"]["force_resultant"] = VALID_FORCE_RESULTANT["force_resultant"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_complex_transform_template_cannot_carry_force_resultant_params():
    payload = _payload(VALID_COMPLEX_TRANSFORM)
    payload["artifacts"][0]["manim"]["force_resultant"] = VALID_FORCE_RESULTANT["force_resultant"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)


def test_kinematics_template_cannot_carry_force_resultant_params():
    payload = _payload(VALID_KINEMATICS_S)
    payload["artifacts"][0]["manim"]["force_resultant"] = VALID_FORCE_RESULTANT["force_resultant"]
    with pytest.raises(Exception):
        validate_visual_payload(payload, REF)
