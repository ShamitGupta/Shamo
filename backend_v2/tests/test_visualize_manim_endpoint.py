"""End-to-end /visualize behaviour for manim_template_video, through the real
FastAPI route with fakes standing in for Supabase, the model, and the actual
render subprocess. This is what proves render-before-cache ordering, URL
re-signing on a cache hit, and graceful degradation on render failure --
none of which the lower-level unit tests (test_visualize_manim.py,
test_manim_renderer.py) individually exercise, because each of those only
sees one layer at a time.
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

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.manim_renderer import ManimRenderError  # noqa: E402
from app.repository import QuestionContext  # noqa: E402
from app.visualize import VisualizeResponse  # noqa: E402

SAMPLE_CONTEXT = QuestionContext(
    paper={"year": 2025, "exam_session": "oct_nov", "paper_variant": "13", "syllabus_code": "9709", "qualification": "a_level"},
    question={
        "id": "22222222-2222-2222-2222-222222222222",
        "question_number": 9,
        "total_marks": 6,
        "stem_markdown": "Find the area between the curve and the line.",
        "root_mark_scheme": [],
        "parts": [],
        "assets": [],
    },
    documents=[],
)

MANIM_RESPONSE_PAYLOAD = {
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
            "manim": {
                "template": "region_sweep",
                "region_sweep": {"lower_expr": "x", "x_min": 1, "x_max": 5},
            },
        }
    ],
    "source_reference": {"year": 2025, "exam_session": "oct_nov", "paper_variant": "13", "question_number": 9},
    "validation_status": "validated",
}


class FakeRepository:
    def __init__(self, context: QuestionContext | None = SAMPLE_CONTEXT) -> None:
        self._context = context
        self.cached_visual: dict | None = None
        self.stored_visuals: list[dict] = []
        self.stored_videos: list[dict] = []
        self.resign_calls: list[str] = []
        self.upload_should_fail = False

    def list_papers(self):
        return []

    def get_question_context(self, year, exam_session, paper_variant, question_number):
        return self._context

    def sign_asset(self, bucket, path):
        return f"https://signed.example/{bucket}/{path}"

    def nearest_available(self, year, paper_variant):
        return None

    def get_visual_artifact(self, **kwargs):
        return self.cached_visual

    def store_visual_artifact(self, **kwargs):
        self.stored_visuals.append(kwargs)

    def store_visual_video(self, *, question_id, manim_spec, video_path):
        self.stored_videos.append({"question_id": question_id, "manim_spec": manim_spec})
        if self.upload_should_fail:
            return None
        return (f"visualize/{question_id}/fake-hash.mp4", "https://signed.example/fresh-video")

    def resign_visual_video(self, storage_path):
        self.resign_calls.append(storage_path)
        return f"https://signed.example/resigned/{storage_path}"


class RecordingVisualizer:
    def __init__(self, response: VisualizeResponse) -> None:
        self.response = response
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


@pytest.fixture
def repository():
    return FakeRepository()


@pytest.fixture
def client(repository):
    response = VisualizeResponse.model_validate(MANIM_RESPONSE_PAYLOAD)
    visualizer = RecordingVisualizer(response)
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_visualizer] = lambda: visualizer
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()


def _visualize_request_body() -> dict:
    return {
        "question": {"year": 2025, "exam_session": "oct_nov", "paper_variant": "13", "question_number": 9},
        "message": "What area do I get if I integrate just this curve?",
        "history": [],
    }


def test_fresh_response_renders_uploads_and_attaches_signed_url(client, repository, monkeypatch):
    fake_output = Path("does-not-need-to-exist-because-we-stub-store.mp4")
    monkeypatch.setattr(main.manim_renderer, "render_to_mp4", lambda spec: fake_output)
    monkeypatch.setattr(Path, "unlink", lambda self, missing_ok=False: None)

    response = client.post("/visualize", json=_visualize_request_body())

    assert response.status_code == 200
    body = response.json()
    artifact = body["artifacts"][0]
    assert artifact["video_url"] == "https://signed.example/fresh-video"
    assert artifact["video_storage_path"].endswith("fake-hash.mp4")
    assert body["validation_status"] == "validated"

    # The durable path must be what gets cached, not just returned to the client.
    assert repository.stored_visuals, "expected the response to be cached"
    cached_payload = repository.stored_visuals[0]["response_payload"]
    assert cached_payload["artifacts"][0]["video_storage_path"].endswith("fake-hash.mp4")


def test_render_failure_drops_artifact_and_flips_status_to_render_failed(client, repository, monkeypatch):
    def raise_render_error(spec):
        raise ManimRenderError("boom")

    monkeypatch.setattr(main.manim_renderer, "render_to_mp4", raise_render_error)

    response = client.post("/visualize", json=_visualize_request_body())

    assert response.status_code == 200
    body = response.json()
    assert body["artifacts"] == []
    assert body["validation_status"] == "render_failed"
    # A failed render must never be cached as though it succeeded.
    assert repository.stored_visuals == []


def test_upload_failure_also_drops_the_artifact(client, repository, monkeypatch):
    fake_output = Path("does-not-need-to-exist-because-we-stub-store.mp4")
    monkeypatch.setattr(main.manim_renderer, "render_to_mp4", lambda spec: fake_output)
    monkeypatch.setattr(Path, "unlink", lambda self, missing_ok=False: None)
    repository.upload_should_fail = True

    response = client.post("/visualize", json=_visualize_request_body())

    assert response.status_code == 200
    body = response.json()
    assert body["artifacts"] == []
    assert body["validation_status"] == "render_failed"


def test_cache_hit_resigns_a_fresh_url_instead_of_trusting_the_cached_one(client, repository):
    cached = dict(MANIM_RESPONSE_PAYLOAD)
    cached["artifacts"] = [
        {
            **MANIM_RESPONSE_PAYLOAD["artifacts"][0],
            "video_storage_path": "visualize/some-question/already-rendered.mp4",
            "video_url": "https://stale.example/should-not-be-returned",
        }
    ]
    repository.cached_visual = cached

    response = client.post("/visualize", json=_visualize_request_body())

    assert response.status_code == 200
    body = response.json()
    artifact = body["artifacts"][0]
    assert artifact["video_url"] == "https://signed.example/resigned/visualize/some-question/already-rendered.mp4"
    assert artifact["video_url"] != "https://stale.example/should-not-be-returned"
    assert repository.resign_calls == ["visualize/some-question/already-rendered.mp4"]


def test_cache_hit_with_unresolvable_video_drops_artifact(client, repository):
    cached = dict(MANIM_RESPONSE_PAYLOAD)
    cached["artifacts"] = [
        {**MANIM_RESPONSE_PAYLOAD["artifacts"][0], "video_storage_path": "visualize/gone/missing.mp4"}
    ]
    repository.cached_visual = cached

    def resign_fails(storage_path):
        return None

    repository.resign_visual_video = resign_fails

    response = client.post("/visualize", json=_visualize_request_body())

    assert response.status_code == 200
    body = response.json()
    assert body["artifacts"] == []
    assert body["validation_status"] == "render_failed"
