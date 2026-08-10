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

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Config validates at import, so the fakes need plausible values present first.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.models import ChatTurn, TutorMode  # noqa: E402
from app.prompts import build_source_block, build_system_prompt  # noqa: E402
from app.repository import QuestionContext  # noqa: E402
from app.tutor import TutorService  # noqa: E402

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
                        "content_markdown": r"\frac{8}{11} \times \frac{4}{5}",
                        "guidance_markdown": "FT their tree diagram probabilities.",
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


class RecordingTutor:
    """Captures the prompt instead of calling a provider."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def stream(self, **kwargs):
        self.calls.append(kwargs)
        yield "ok"


@pytest.fixture
def client_and_fakes():
    repository = FakeRepository()
    tutor = RecordingTutor()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_tutor] = lambda: tutor
    with TestClient(main.app) as client:
        yield client, repository, tutor
    main.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Refusal: the defect this service exists to prevent
# ---------------------------------------------------------------------------


def test_missing_question_returns_404_not_an_answer(client_and_fakes):
    client, _, tutor = client_and_fakes
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
    client, _, tutor = client_and_fakes
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
    assert "FT their tree diagram probabilities." in block
    # A blank Answer cell with real guidance is legitimate and must not vanish.
    assert "Bag B branches completed correctly." in block


def test_client_cannot_inject_question_content(client_and_fakes):
    """Content comes from the lookup, never from the request body."""
    client, repository, tutor = client_and_fakes
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
    client, _, tutor = client_and_fakes
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
    assert "Do NOT state the final answer" not in explain
    assert "Finish with the answer as the mark scheme states it" in explain

    # Both still see the same source material; the difference is permission,
    # not knowledge. Withholding the mark scheme from hint mode would make it
    # guess, which is worse than trusting it to stay quiet.
    assert r"\frac{1307}{3025}" in hint
    assert r"\frac{1307}{3025}" in explain


def test_check_mode_receives_the_student_attempt(client_and_fakes):
    client, _, tutor = client_and_fakes
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
    client, _, _ = client_and_fakes
    response = client.get("/papers")
    assert response.status_code == 200
    papers = response.json()
    assert papers[0]["paper_variant"] == "51"
    assert papers[0]["question_numbers"] == [1, 2, 3, 4, 5, 6, 7]
    assert papers[0]["paper_component"] == "5"


def test_question_endpoint_signs_private_diagrams(client_and_fakes):
    client, _, _ = client_and_fakes
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
    client, repository, tutor = client_and_fakes
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
