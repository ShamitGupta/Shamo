"""The properties that make this service different from the prototype.

Every test here is offline: the repository and the model client are both fakes,
so the suite is free and runs in under a second. What it checks is not "does the
tutor give good answers" -- that needs human evaluation -- but the structural
guarantees underneath, which are exactly the things that can silently rot.

The load-bearing one is `test_model_is_never_called_without_context`. The legacy
service retrieves, gets nothing, concatenates two empty strings, and hands them
to the model, which answers anyway. That is the defect this whole service exists
to make impossible, so it gets a test that fails loudly if the path ever
reappears.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Config validates at import, so the fakes need plausible values present first.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.models import ChatTurn, QuestionRef, TutorMode, VisualValidationStatus, VisualizeResponse  # noqa: E402
from app.prompts import (  # noqa: E402
    build_mark_attribution_checklist,
    build_source_block,
    build_system_prompt,
)
from app.repository import QuestionContext  # noqa: E402
from app.tutor import TutorService  # noqa: E402
from app.visualize import VisualizeService, validate_visual_payload  # noqa: E402

# A real published question, trimmed: 9709/51 Oct/Nov 2025 Q4. Chosen because it
# exercises the awkward cases -- a required diagram, a part whose mark rows carry
# guidance but no answer text, and a follow-through mark.
SAMPLE = QuestionContext(
    paper={
        "year": 2025,
        "exam_session": "oct_nov",
        "paper_variant": "51",
        "syllabus_code": "9709",
        "qualification": "a_level",
    },
    question={
        "id": "11111111-1111-1111-1111-111111111111",
        "question_number": 4,
        "total_marks": 5,
        "stem_markdown": "Bag A contains 8 red marbles and 3 blue marbles.",
        "root_mark_scheme": [],
        "parts": [
            {
                "label_path": ["a"],
                "marks": 3,
                "prompt_markdown": "Complete the tree diagram below.",
                "mark_scheme_items": [
                    {
                        "mark_code": "B1",
                        "content_markdown": "",
                        "guidance_markdown": "Bag B branches completed correctly.",
                        "is_alternative_method": False,
                        "is_final_answer": False,
                    }
                ],
            },
            {
                "label_path": ["b"],
                "marks": 2,
                "prompt_markdown": "Find the probability that all three are the same colour.",
                "mark_scheme_items": [
                    {
                        "mark_code": "M1",
                        "content_markdown": (
                            r"\frac{8}{11} \times \frac{4}{5} \times \frac{7}{10}"
                            r" + \frac{3}{11} \times \frac{1}{5} \times \frac{3}{10}"
                        ),
                        "guidance_markdown": "Both, FT their tree diagram probabilities.",
                        "is_alternative_method": False,
                        "is_final_answer": False,
                    },
                    {
                        "mark_code": "A1",
                        "content_markdown": r"\frac{1307}{3025}, 0.432",
                        "guidance_markdown": "0.4320661... to 3 or more SF.",
                        "is_alternative_method": False,
                        "is_final_answer": True,
                    },
                ],
            },
        ],
        "assets": [
            {
                "description": "Probability tree diagram for the three marble selections.",
                "required_to_solve": True,
                "storage_bucket": "past-paper-assets",
                "storage_path": "a_level/9709/2025/oct_nov/51/q4/page-6-image-1.jpg",
                "mathematical_details": {
                    "visible_labels": ["Bag A", "Bag B", "Red", "Blue"],
                    "relationships": ["Sequential selections from Bag A then Bag B."],
                },
            }
        ],
    },
    documents=[{"document_type": "question_paper", "page_count": 12}],
)


class FakeRepository:
    """Stands in for Supabase. Records what was asked for."""

    def __init__(self, context: QuestionContext | None = SAMPLE) -> None:
        self._context = context
        self.lookups: list[tuple] = []
        self.cached_visual: dict | None = None
        self.stored_visuals: list[dict] = []

    def list_papers(self):
        return [
            {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "paper_component": "5",
                "question_count": 7,
                "question_numbers": [1, 2, 3, 4, 5, 6, 7],
            }
        ]

    def get_question_context(self, year, exam_session, paper_variant, question_number):
        self.lookups.append((year, exam_session, paper_variant, question_number))
        return self._context

    def sign_asset(self, bucket, path):
        return f"https://signed.example/{bucket}/{path}?token=abc"

    def nearest_available(self, year, paper_variant):
        return "Paper 51 is published for: 2025."

    def get_visual_artifact(self, **kwargs):
        return self.cached_visual

    def store_visual_artifact(self, **kwargs):
        self.stored_visuals.append(kwargs)


class RecordingTutor:
    """Captures the prompt instead of calling a provider."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def stream(self, **kwargs):
        self.calls.append(kwargs)
        yield "ok"


class RecordingVisualizer:
    """Captures visualize calls instead of calling a provider."""

    def __init__(self, response: VisualizeResponse | None = None) -> None:
        self.calls: list[dict] = []
        self.response = response

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response or sample_visual_response()


@pytest.fixture
def client_and_fakes():
    repository = FakeRepository()
    tutor = RecordingTutor()
    visualizer = RecordingVisualizer()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_tutor] = lambda: tutor
    main.app.dependency_overrides[main.get_visualizer] = lambda: visualizer
    with TestClient(main.app) as client:
        yield client, repository, tutor, visualizer
    main.app.dependency_overrides.clear()


def sample_visual_response() -> VisualizeResponse:
    return VisualizeResponse.model_validate(
        {
            "visual_spec_version": "visual-v1",
            "message_markdown": "Here is a graph that shows both probability cases.",
            "fallback_markdown": "Use the two same-colour branches from the tree.",
            "source_reference": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "validation_status": "validated",
            "artifacts": [
                {
                    "artifact_kind": "desmos_2d",
                    "title": "Same-colour branches",
                    "purpose": "Show the two terms that must both be included.",
                    "narration_markdown": "Move $p$ to compare the two branch products.",
                    "accessibility_text": "A graph with a slider p and one plotted line y=p.",
                    "desmos": {
                        "calculator": "graphing",
                        "viewport": {"left": 0, "right": 1, "bottom": 0, "top": 1},
                        "expressions": [
                            {
                                "id": "p",
                                "latex": "p=0.4",
                                "sliderBounds": {"min": "0", "max": "1", "step": "0.01"},
                            },
                            {"id": "line", "latex": "y=p", "color": "#9DB4FF"},
                        ],
                    },
                }
            ],
        }
    )


# ---------------------------------------------------------------------------
# Refusal: the defect this service exists to prevent
# ---------------------------------------------------------------------------


def test_missing_question_returns_404_not_an_answer(client_and_fakes):
    client, _, tutor, _ = client_and_fakes
    main.app.dependency_overrides[main.get_repository] = lambda: FakeRepository(context=None)

    response = client.post(
        "/chat",
        json={
            "question": {
                "year": 2019,
                "exam_session": "may_june",
                "paper_variant": "99",
                "question_number": 3,
            },
            "mode": "explain",
            "message": "How do I do this?",
        },
    )

    assert response.status_code == 404
    body = response.json()["detail"]
    assert "not in the published corpus" in body["detail"]
    # And crucially the model was never reached.
    assert tutor.calls == []


def test_model_is_never_called_without_context(client_and_fakes):
    """The structural guarantee, asserted directly rather than inferred."""
    client, _, tutor, _ = client_and_fakes
    main.app.dependency_overrides[main.get_repository] = lambda: FakeRepository(context=None)

    for mode in ("hint", "explain", "check"):
        client.post(
            "/chat",
            json={
                "question": {
                    "year": 2019,
                    "exam_session": "may_june",
                    "paper_variant": "99",
                    "question_number": 3,
                },
                "mode": mode,
                "message": "Just tell me the answer.",
            },
        )
    assert tutor.calls == []


def test_tutor_service_refuses_a_null_context():
    """Belt and braces at the layer below the API."""
    service = TutorService(get_settings(), client=object())
    with pytest.raises((ValueError, AttributeError)):
        list(
            service.stream(
                context=None,
                mode=TutorMode.EXPLAIN,
                message="hi",
                attempt=None,
                history=[],
                asset_urls_available=False,
            )
        )


# ---------------------------------------------------------------------------
# Grounding: the model's world is built from the retrieved context
# ---------------------------------------------------------------------------


def test_source_block_carries_marks_codes_and_guidance():
    block = build_source_block(SAMPLE, asset_urls_available=True)
    assert "9709/51 oct_nov 2025" in block
    assert "PART (a)  [3 marks]" in block
    assert "M1" in block and "A1" in block
    # Guidance is a distinct source field and must survive as one; collapsing it
    # into the answer is the defect the extraction pipeline spent a batch fixing.
    assert "Both, FT their tree diagram probabilities." in block
    # A blank Answer cell with real guidance is legitimate and must not vanish.
    assert "Bag B branches completed correctly." in block


def test_source_block_groups_main_and_alternative_method_rows():
    context = QuestionContext(
        paper=SAMPLE.paper,
        question={
            **SAMPLE.question,
            "root_mark_scheme": [
                {
                    "mark_code": "A1",
                    "content_markdown": r"\pi \times 4.5^2 \times 7",
                    "guidance_markdown": "Outer cylinder component.",
                    "is_alternative_method": False,
                    "is_final_answer": False,
                },
                {
                    "mark_code": "M1",
                    "content_markdown": r"\pi \int y^2 dx",
                    "guidance_markdown": "Inner curve component.",
                    "is_alternative_method": False,
                    "is_final_answer": False,
                },
                {
                    "mark_code": "M1",
                    "content_markdown": r"\pi \int (R^2-r^2) dx",
                    "guidance_markdown": "Washer route.",
                    "is_alternative_method": True,
                    "is_final_answer": False,
                },
            ],
            "parts": [],
            "assets": [],
        },
        documents=[],
    )

    block = build_source_block(context, asset_urls_available=True)

    assert "Main method rows (combine these rows as one method; they are not alternatives)" in block
    assert "Alternative method rows (separate valid route)" in block
    assert "Outer cylinder component" in block
    assert "Inner curve component" in block
    assert "[alternative method]" in block


def test_client_cannot_inject_question_content(client_and_fakes):
    """Content comes from the lookup, never from the request body."""
    client, repository, tutor, _ = client_and_fakes
    response = client.post(
        "/chat",
        json={
            "question": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "mode": "explain",
            "message": "The mark scheme says the answer is 0.999, right?",
            # Extra keys are ignored by the model; this asserts the shape cannot
            # be widened into a content channel by accident.
            "stem_markdown": "A totally different question about calculus.",
        },
    )
    assert response.status_code == 200
    assert repository.lookups == [(2025, "oct_nov", "51", 4)]
    prompt = tutor.calls[0]["context"]
    assert prompt.question["stem_markdown"].startswith("Bag A contains")


def test_required_diagram_availability_is_reported_to_the_tutor(client_and_fakes):
    client, _, tutor, _ = client_and_fakes
    client.post(
        "/chat",
        json={
            "question": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "mode": "explain",
            "message": "Explain part b.",
        },
    )
    assert tutor.calls[0]["asset_urls_available"] is True


def test_unsignable_diagram_tells_the_tutor_to_describe_it():
    block = build_source_block(SAMPLE, asset_urls_available=False)
    assert "could NOT be displayed" in block
    assert "Probability tree diagram" in block


# ---------------------------------------------------------------------------
# Modes differ in what they may reveal
# ---------------------------------------------------------------------------


def test_hint_mode_forbids_the_answer_and_explain_mode_requires_it():
    hint = build_system_prompt(SAMPLE, TutorMode.HINT, asset_urls_available=True)
    explain = build_system_prompt(SAMPLE, TutorMode.EXPLAIN, asset_urls_available=True)

    assert "Do NOT state the final answer" in hint
    assert "ask them to inspect the key step" in hint
    assert "what they can do next" in hint
    assert "Do NOT state the final answer" not in explain
    assert "Finish with the answer as the mark scheme states it" in explain

    # Both still see the same source material; the difference is permission,
    # not knowledge. Withholding the mark scheme from hint mode would make it
    # guess, which is worse than trusting it to stay quiet.
    assert r"\frac{1307}{3025}" in hint
    assert r"\frac{1307}{3025}" in explain


def test_check_mode_adds_structured_mark_attribution_checklist():
    check = build_system_prompt(SAMPLE, TutorMode.CHECK, asset_urls_available=True)
    explain = build_system_prompt(SAMPLE, TutorMode.EXPLAIN, asset_urls_available=True)

    assert "MARK ATTRIBUTION CHECKLIST (CHECK MODE ONLY)" in check
    assert "Both required" in check
    assert "One matching item is not enough" in check
    assert "Compare against the whole Answer line" in check
    assert "Follow-through allowed only after the required method evidence is present" in check
    assert "MARK ATTRIBUTION CHECKLIST (CHECK MODE ONLY)" not in explain


def test_multi_mode_prompt_tells_explain_that_visualize_is_handling_animation():
    prompt = build_system_prompt(
        SAMPLE,
        TutorMode.EXPLAIN,
        asset_urls_available=True,
        selected_modes=[TutorMode.EXPLAIN, TutorMode.VISUALIZE],
    )

    assert "COORDINATED MULTI-MODE TURN" in prompt
    assert "You are writing ONLY the explain response" in prompt
    assert "Visualize is handling any graph, construction, or animation request" in prompt
    assert "Do not say you cannot make a graph or animation" in prompt
    assert "Write as a companion to that visual" in prompt
    assert "avoid offering to help them picture it later" in prompt


def test_explain_prompt_guards_volume_of_revolution_region_choice():
    prompt = build_system_prompt(SAMPLE, TutorMode.EXPLAIN, asset_urls_available=True)

    assert "Do not turn separate mark rows from the same method into separate options" in prompt
    assert "For volumes of revolution, first identify the actual shaded region and axis" in prompt
    assert "Use \\(V = \\pi \\int y^2 dx\\) only when the rotated region is between a curve" in prompt
    assert "washer difference \\(V = \\pi \\int (R^2-r^2) dx\\)" in prompt


def test_mark_attribution_checklist_repeats_each_mark_condition():
    checklist = build_mark_attribution_checklist(SAMPLE)

    assert "Part (b) -- M1" in checklist
    assert "Guidance condition: Both, FT their tree diagram probabilities." in checklist
    assert "Required answer/evidence:" in checklist
    assert r"\frac{3}{11}" in checklist


def test_check_mode_receives_the_student_attempt(client_and_fakes):
    client, _, tutor, _ = client_and_fakes
    client.post(
        "/chat",
        json={
            "question": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "mode": "check",
            "message": "Did I get this right?",
            "attempt": "P = 8/11 * 4/5 * 7/10 = 0.407",
        },
    )
    call = tutor.calls[0]
    assert call["mode"] is TutorMode.CHECK
    assert call["attempt"] == "P = 8/11 * 4/5 * 7/10 = 0.407"


# ---------------------------------------------------------------------------
# Catalogue: a student can only pick something that exists
# ---------------------------------------------------------------------------


def test_catalogue_lists_only_published_papers(client_and_fakes):
    client, _, _, _ = client_and_fakes
    response = client.get("/papers")
    assert response.status_code == 200
    papers = response.json()
    assert papers[0]["paper_variant"] == "51"
    assert papers[0]["question_numbers"] == [1, 2, 3, 4, 5, 6, 7]
    assert papers[0]["paper_component"] == "5"


def test_question_endpoint_signs_private_diagrams(client_and_fakes):
    client, _, _, _ = client_and_fakes
    response = client.get("/papers/2025/oct_nov/51/questions/4")
    assert response.status_code == 200
    body = response.json()
    assert body["total_marks"] == 5
    assert body["parts"][0]["label"] == "(a)"
    asset = body["assets"][0]
    assert asset["required_to_solve"] is True
    assert asset["url"].startswith("https://signed.example/")
    assert asset["url_expires_in_seconds"] == 600


def test_malformed_reference_is_rejected_before_retrieval(client_and_fakes):
    client, repository, tutor, _ = client_and_fakes
    response = client.post(
        "/chat",
        json={
            "question": {
                "year": 2025,
                "exam_session": "summer",  # not a Cambridge session
                "paper_variant": "51",
                "question_number": 4,
            },
            "mode": "explain",
            "message": "Explain this.",
        },
    )
    assert response.status_code == 422
    assert repository.lookups == []
    assert tutor.calls == []


# ---------------------------------------------------------------------------
# Visualize: structured visuals are grounded and validated
# ---------------------------------------------------------------------------


def test_chat_endpoint_rejects_visualize_mode(client_and_fakes):
    client, repository, tutor, visualizer = client_and_fakes
    response = client.post(
        "/chat",
        json={
            "question": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "mode": "visualize",
            "message": "Show me a graph.",
        },
    )

    assert response.status_code == 400
    assert repository.lookups == []
    assert tutor.calls == []
    assert visualizer.calls == []


def test_visualize_missing_question_returns_404_without_model_call(client_and_fakes):
    client, _, _, visualizer = client_and_fakes
    main.app.dependency_overrides[main.get_repository] = lambda: FakeRepository(context=None)

    response = client.post(
        "/visualize",
        json={
            "question": {
                "year": 2019,
                "exam_session": "may_june",
                "paper_variant": "99",
                "question_number": 3,
            },
            "message": "Visualize this.",
        },
    )

    assert response.status_code == 404
    assert visualizer.calls == []


def test_visualize_cache_hit_returns_without_model_call(client_and_fakes):
    client, repository, _, visualizer = client_and_fakes
    repository.cached_visual = sample_visual_response().model_dump(mode="json")

    response = client.post(
        "/visualize",
        json={
            "question": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "message": "Visualize the same-colour cases.",
        },
    )

    assert response.status_code == 200
    assert response.json()["validation_status"] == VisualValidationStatus.VALIDATED
    assert visualizer.calls == []
    assert repository.stored_visuals == []


def test_visualize_stores_validated_specs(client_and_fakes):
    client, repository, _, visualizer = client_and_fakes
    response = client.post(
        "/visualize",
        json={
            "question": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "message": "Visualize the same-colour cases.",
        },
    )

    assert response.status_code == 200
    assert visualizer.calls[0]["context"] is SAMPLE
    assert len(repository.stored_visuals) == 1
    assert repository.stored_visuals[0]["response_payload"]["artifacts"][0]["artifact_kind"] == "desmos_2d"


def test_respond_coordinates_text_and_visualize_with_one_lookup(client_and_fakes):
    client, repository, tutor, visualizer = client_and_fakes

    response = client.post(
        "/respond",
        json={
            "question": {
                "year": 2025,
                "exam_session": "oct_nov",
                "paper_variant": "51",
                "question_number": 4,
            },
            "modes": ["explain", "visualize"],
            "message": "Animate this and explain what is happening.",
            "history": [],
        },
    )

    assert response.status_code == 200
    assert repository.lookups == [(2025, "oct_nov", "51", 4)]
    assert len(tutor.calls) == 1
    assert tutor.calls[0]["mode"] is TutorMode.EXPLAIN
    assert tutor.calls[0]["selected_modes"] == [TutorMode.EXPLAIN, TutorMode.VISUALIZE]
    assert len(visualizer.calls) == 1

    body = response.json()
    assert [item["mode"] for item in body["responses"]] == ["explain", "visualize"]
    assert body["responses"][0]["message_markdown"] == "ok"
    assert body["responses"][1]["validation_status"] == "validated"
    assert body["responses"][1]["artifacts"][0]["artifact_kind"] == "desmos_2d"


def test_respond_missing_question_returns_404_without_any_model_call(client_and_fakes):
    client, _, tutor, visualizer = client_and_fakes
    main.app.dependency_overrides[main.get_repository] = lambda: FakeRepository(context=None)

    response = client.post(
        "/respond",
        json={
            "question": {
                "year": 2019,
                "exam_session": "may_june",
                "paper_variant": "99",
                "question_number": 3,
            },
            "modes": ["explain", "visualize"],
            "message": "Animate this and explain it.",
        },
    )

    assert response.status_code == 404
    assert tutor.calls == []
    assert visualizer.calls == []


def test_visual_spec_rejects_raw_javascript():
    payload = sample_visual_response().model_dump(mode="json")
    payload["artifacts"][0]["desmos"]["expressions"][1]["latex"] = "y=x; window.alert(1)"

    with pytest.raises(ValueError):
        validate_visual_payload(
            payload,
            ref=payload["source_reference"],
        )


def test_visual_spec_rejects_unlisted_geogebra_commands():
    payload = sample_visual_response().model_dump(mode="json")
    payload["artifacts"][0] = {
        "artifact_kind": "geogebra_geometry",
        "title": "Unsafe construction",
        "purpose": "Demonstrate command validation.",
        "narration_markdown": "This should not pass.",
        "accessibility_text": "No visual should be shown.",
        "geogebra": {
            "appName": "geometry",
            "commands": ["ExecuteScript(alert(1))"],
        },
    }

    with pytest.raises(ValueError):
        validate_visual_payload(
            payload,
            ref=payload["source_reference"],
        )


def test_visual_spec_rejects_unlisted_geogebra_assignment_constructor():
    payload = sample_visual_response().model_dump(mode="json")
    payload["artifacts"][0] = {
        "artifact_kind": "geogebra_geometry",
        "title": "Unsafe assignment",
        "purpose": "Demonstrate assignment validation.",
        "narration_markdown": "This should not pass.",
        "accessibility_text": "No visual should be shown.",
        "geogebra": {
            "appName": "geometry",
            "commands": ["bad = ExecuteScript(alert(1))"],
        },
    }

    with pytest.raises(ValueError):
        validate_visual_payload(
            payload,
            ref=payload["source_reference"],
        )


def test_visual_spec_accepts_safe_geogebra_coordinate_assignments():
    payload = sample_visual_response().model_dump(mode="json")
    payload["artifacts"][0] = {
        "artifact_kind": "geogebra_geometry",
        "title": "Safe construction",
        "purpose": "Show a segment between two labelled points.",
        "narration_markdown": "The construction marks two fixed points and joins them.",
        "accessibility_text": "Two labelled points A and B joined by a segment.",
        "geogebra": {
            "appName": "geometry",
            "commands": ["A=(0,0)", "B=(3,0)", "Segment(A,B)", "ShowLabel(A,true)"],
        },
    }

    response = validate_visual_payload(
        payload,
        ref=QuestionRef.model_validate(payload["source_reference"]),
    )

    assert response.validation_status == VisualValidationStatus.VALIDATED
    assert response.artifacts[0].artifact_kind == "geogebra_geometry"


def test_visualize_service_hides_raw_validation_errors_from_students():
    class InvalidVisualClient:
        def __init__(self):
            self.chat = SimpleNamespace(completions=self)

        def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=(
                                '{"visual_spec_version":"visual-v1",'
                                '"message_markdown":"Here is a visual.",'
                                '"fallback_markdown":"Use the text fallback.",'
                                '"artifacts":[{"artifact_kind":"desmos_2d","title":"Broken"}]}'
                            )
                        )
                    )
                ]
            )

    service = VisualizeService(get_settings(), client=InvalidVisualClient())
    response = service.create(
        context=SAMPLE,
        ref=QuestionRef(year=2025, exam_session="oct_nov", paper_variant="51", question_number=4),
        message="Visualize it.",
        history=[],
    )

    assert response.validation_status == VisualValidationStatus.RENDER_FAILED
    assert "pydantic.dev" not in response.fallback_markdown
    assert "Field required" not in response.fallback_markdown
