"""The refusal matrix for staff routes, and the privacy boundary behind them.

Every other endpoint in this service filters by the caller's own user id, so it
is safe by construction: there is no argument that could make it return someone
else's data. The `/staff` routes are the first exception in the codebase, and
they are safe for two reasons rather than one --

  1. `require_staff_user` stands in front of every one of them, resolving the
     role from the database on each request;
  2. the queries behind them never select a conversation's content or a thread's
     title.

Both are failure modes that a reviewer would not notice by reading the happy
path, and neither shows up in a manual click-through: a dashboard that works
perfectly for a teacher looks identical whether or not a student can also open
it. So they get tests that fail loudly instead.

The second is asserted against the SERIALIZED response body, not against the
Pydantic models. Reading the model definitions would only prove I wrote them
down correctly today; checking the bytes proves that nothing -- a new column, a
widened select, an extra field on a nested model -- has since let the excluded
material out.
"""

from __future__ import annotations

import json
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
from app.auth import AuthenticatedUser  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402
from app.models import UserRole  # noqa: E402
from app.repository import RetrievalError  # noqa: E402

from test_grounding import FakeAuthService  # noqa: E402

INVITE_CODE = "correct-horse-battery-staple"
STUDENT_ID = "student-1"

# Every staff route, listed once. A new route added without a line here is the
# exact mistake this file exists to catch, so the last test asserts the list is
# complete rather than trusting anyone to remember.
STAFF_ROUTES = (
    "/staff/class/overview",
    "/staff/students",
    f"/staff/students/{STUDENT_ID}",
    f"/staff/students/{STUDENT_ID}/weak-topics",
)


class FakeStaffRepository:
    """Answers the staff queries, and records what was asked of it."""

    def __init__(self, *, role: UserRole = UserRole.STUDENT, role_error: bool = False) -> None:
        self.role = role
        self.role_error = role_error
        self.role_lookups = 0
        self.granted: list[tuple[str, str]] = []
        # Which user id each mark-code lookup was scoped to. None means the
        # whole class, and a None arriving from /me would be a real leak.
        self.mark_code_scopes: list[str | None] = []
        self.roster = [
            {
                "user_id": STUDENT_ID,
                "display_name": "Ada L. (sample)",
                "email": "ada@example.com",
                "is_sample": True,
                "conversations": 2,
                "turns": 9,
                "attempts": 4,
                "scored_attempts": 3,
                "mark_ratio": 0.4,
                "weakest_topic": "Vectors",
                "last_active_at": "2026-09-15T10:00:00+00:00",
            }
        ]
        self.attempts = [
            {
                "qualification": "a_level",
                "syllabus_code": "9709",
                "year": 2025,
                "exam_session": "may_june",
                "paper_variant": "12",
                "question_number": 4,
                "part_label": "(a)",
                "attempt_text": "I integrated and got 12.",
                "marks_earned": 1,
                "marks_available": 3,
                "earned_codes": ["M1"],
                "missed_codes": ["A1"],
                "outcome_source": "extractor",
                "created_at": "2026-09-15T10:00:00+00:00",
            }
        ]

    def get_user_role(self, user_id):
        self.role_lookups += 1
        if self.role_error:
            raise RetrievalError("role table unreachable")
        return self.role

    def grant_staff_role(self, user_id, *, granted_by="invite_code"):
        self.granted.append((user_id, granted_by))
        self.role = UserRole.STAFF

    def get_student_roster(self, limit=200):
        return self.roster[:limit]

    def get_student_attempts(self, user_id, limit=100):
        return self.attempts[:limit] if user_id == STUDENT_ID else []

    def get_topic_weakness(self, user_id, *, min_attempts=3, limit=20):
        return [
            {
                "main_topic": "Vectors",
                "syllabus_codes": ["9709"],
                "attempts": 4,
                "scored_attempts": 3,
                "marks_earned": 4,
                "marks_available": 10,
                "mark_ratio": 0.4,
                "has_enough_evidence": True,
                "last_attempted_at": "2026-09-15T10:00:00+00:00",
                "example_questions": [],
            }
        ]

    def get_class_topic_summary(self, *, min_attempts=3, limit=20):
        return [
            {
                "main_topic": "Vectors",
                "students_attempting": 3,
                "students_with_evidence": 2,
                "students_struggling": 2,
                "attempts": 9,
                "scored_attempts": 8,
                "marks_earned": 10,
                "marks_available": 40,
                "class_mark_ratio": 0.25,
                "has_enough_evidence": True,
                "last_attempted_at": "2026-09-15T10:00:00+00:00",
            },
            {
                "main_topic": "Series",
                "students_attempting": 1,
                "students_with_evidence": 1,
                "students_struggling": 0,
                "attempts": 3,
                "scored_attempts": 3,
                "marks_earned": 9,
                "marks_available": 12,
                "class_mark_ratio": 0.75,
                "has_enough_evidence": False,
                "last_attempted_at": "2026-09-10T10:00:00+00:00",
            },
        ]

    def get_mark_code_profile(self, user_id=None):
        self.mark_code_scopes.append(user_id)
        return [
            {
                "code_class": "M",
                "earned": 18,
                "missed": 4,
                "total": 22,
                "earned_ratio": 0.8182,
                "students": 1 if user_id else 3,
            },
            {
                "code_class": "A",
                "earned": 5,
                "missed": 14,
                "total": 19,
                "earned_ratio": 0.2632,
                "students": 1 if user_id else 3,
            },
        ]

    def get_activity_by_week(self, user_id=None, *, weeks=8):
        return [
            {
                "week_start": "2026-09-07T00:00:00+00:00",
                "attempts": 0,
                "scored_attempts": 0,
                "students_active": 0,
            },
            {
                "week_start": "2026-09-14T00:00:00+00:00",
                "attempts": 4,
                "scored_attempts": 3,
                "students_active": 1 if user_id else 2,
            },
        ]

    # /me reads these two as well.
    def get_profile(self, user_id):
        return None

    def get_effective_tier(self, user_id):
        from app.models import UserTier

        return UserTier.FREE


def _client(repository: FakeStaffRepository, *, invite_code: str | None = INVITE_CODE):
    settings = get_settings()
    patched = Settings(
        supabase_url=settings.supabase_url,
        supabase_service_role_key=settings.supabase_service_role_key,
        openai_api_key=settings.openai_api_key,
        teacher_invite_code=invite_code,
        allowed_origins=settings.allowed_origins,
    )
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_auth_service] = lambda: FakeAuthService()
    main.app.dependency_overrides[main.get_settings] = lambda: patched
    client = TestClient(main.app, headers={"Authorization": "Bearer valid-token"})
    return client


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    main.app.dependency_overrides.clear()


# -- the gate ---------------------------------------------------------------


@pytest.mark.parametrize("route", STAFF_ROUTES)
def test_student_token_is_refused_on_every_staff_route(route):
    """The load-bearing test. A signed-in student is not a teacher."""
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    with _client(repository) as client:
        response = client.get(route)

    assert response.status_code == 403
    # The refusal must not confirm the student exists, or the roster leaks one
    # bit at a time through a 403/404 difference.
    assert "ada" not in response.text.lower()


@pytest.mark.parametrize("route", STAFF_ROUTES)
def test_anonymous_request_is_refused_on_every_staff_route(route):
    repository = FakeStaffRepository(role=UserRole.STAFF)
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    with TestClient(main.app) as client:
        response = client.get(route)
    assert response.status_code == 401


@pytest.mark.parametrize("route", STAFF_ROUTES)
def test_unreadable_role_refuses_rather_than_passing(route):
    """When the role cannot be established, the answer is no."""
    repository = FakeStaffRepository(role=UserRole.STAFF, role_error=True)
    with _client(repository) as client:
        response = client.get(route)
    assert response.status_code == 503


def test_role_is_resolved_on_every_request_not_cached():
    """A revoked role has to stop working now, not at the next token refresh."""
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        client.get("/staff/students")
        client.get("/staff/students")
    assert repository.role_lookups >= 2


def test_staff_token_is_allowed():
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        response = client.get("/staff/students")

    assert response.status_code == 200
    body = response.json()
    assert body[0]["user_id"] == STUDENT_ID
    assert body[0]["is_sample"] is True


def test_unknown_student_is_a_404_not_an_empty_profile():
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        response = client.get("/staff/students/nobody-here")
    assert response.status_code == 404


# -- the privacy boundary ---------------------------------------------------


@pytest.mark.parametrize("route", STAFF_ROUTES)
def test_no_staff_response_carries_conversation_content(route):
    """Checked against the serialized body, not the model definitions.

    A field added to a nested model, or a widened select in the repository,
    would slip past a test that only inspected the classes.
    """
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        response = client.get(route)

    assert response.status_code == 200
    body = json.loads(response.text)

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                assert key not in {"content", "title"}, f"{route} leaked '{key}'"
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(body)


def test_attempt_text_is_present_because_submitted_work_is_shareable():
    """The counterpart to the test above: the boundary is a line, not a wall.

    If this ever starts failing, someone has widened the exclusion instead of
    narrowing it, and teachers have quietly lost the thing they asked for.
    """
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        response = client.get(f"/staff/students/{STUDENT_ID}")

    attempt = response.json()["attempts"][0]
    assert attempt["attempt_text"] == "I integrated and got 12."
    assert attempt["earned_codes"] == ["M1"]


def test_staff_and_student_see_the_same_ranking():
    """One definition of "weak", not two."""
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        staff_view = client.get(f"/staff/students/{STUDENT_ID}/weak-topics").json()
        repository.role = UserRole.STUDENT
        own_view = client.get("/me/weak-topics").json()

    assert staff_view["ranked"] == own_view["ranked"]


# -- claiming the role ------------------------------------------------------


def test_correct_invite_code_grants_staff():
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    with _client(repository) as client:
        response = client.post("/me/claim-staff-role", json={"invite_code": INVITE_CODE})

    assert response.status_code == 200
    assert response.json()["role"] == "staff"
    assert repository.granted == [("user-1", "invite_code")]


def test_wrong_invite_code_writes_nothing():
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    with _client(repository) as client:
        response = client.post("/me/claim-staff-role", json={"invite_code": "guess"})

    assert response.status_code == 403
    assert repository.granted == []


def test_unconfigured_invite_code_refuses_everyone():
    """An unconfigured deployment hands out no access rather than all of it."""
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    with _client(repository, invite_code=None) as client:
        for attempt in ("", "anything", "None"):
            response = client.post("/me/claim-staff-role", json={"invite_code": attempt or "x"})
            assert response.status_code == 403
    assert repository.granted == []


def test_me_reports_the_role_so_the_browser_can_route_on_it():
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        assert client.get("/me").json()["role"] == "staff"

    repository.role = UserRole.STUDENT
    with _client(repository) as client:
        assert client.get("/me").json()["role"] == "student"


# -- class insights ---------------------------------------------------------


def test_my_mark_codes_is_scoped_to_the_caller_and_never_the_class():
    """The one route that can ask about everyone, asked about one person.

    `get_mark_code_profile(None)` returns the whole class. /me must never reach
    that form, and the check is on the ARGUMENT rather than on the response,
    because the fake returns plausible-looking rows either way -- which is
    exactly how this would ship unnoticed.
    """
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    with _client(repository) as client:
        response = client.get("/me/mark-codes")

    assert response.status_code == 200
    assert repository.mark_code_scopes == ["user-1"]
    assert None not in repository.mark_code_scopes


def test_a_student_can_read_their_own_mark_split():
    """No staff role required. A student is entitled to know this about
    themselves, and a teacher knowing it while they do not would be worse."""
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    with _client(repository) as client:
        body = client.get("/me/mark-codes").json()

    assert [group["code_class"] for group in body["groups"]] == ["M", "A"]
    assert body["groups"][0]["earned"] == 18


def test_the_mark_headline_names_the_pattern_without_diagnosing_it():
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    with _client(repository) as client:
        headline = client.get("/me/mark-codes").json()["headline"]

    # 82% of method marks earned against 26% of accuracy marks.
    assert "82%" in headline and "26%" in headline
    # Hedged on purpose: the M/A distinction is Cambridge's and exact, the
    # reading of it is not.
    assert "usually" in headline


def test_the_mark_headline_stays_silent_on_thin_evidence():
    """Below the minimum there is no honest comparison to make, so none is made."""
    repository = FakeStaffRepository(role=UserRole.STUDENT)
    repository.get_mark_code_profile = lambda user_id=None: [
        {"code_class": "M", "earned": 2, "missed": 0, "total": 2,
         "earned_ratio": 1.0, "students": 1},
        {"code_class": "A", "earned": 0, "missed": 2, "total": 2,
         "earned_ratio": 0.0, "students": 1},
    ]
    with _client(repository) as client:
        body = client.get("/me/mark-codes").json()

    assert body["headline"] is None
    # The counts are still shown. Silence is about the interpretation, not the
    # evidence -- hiding the rows would tell the student less, not more.
    assert len(body["groups"]) == 2


def test_class_overview_separates_topics_it_cannot_yet_judge():
    """One student struggling is a conversation, not a lesson plan."""
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        body = client.get("/staff/class/overview").json()

    assert [t["main_topic"] for t in body["topics"]] == ["Vectors"]
    assert [t["main_topic"] for t in body["needs_more_evidence"]] == ["Series"]
    # The headcount rides with the ratio everywhere, so a share can never be
    # rendered without the number of students behind it.
    vectors = body["topics"][0]
    assert vectors["students_struggling"] == 2
    assert vectors["students_with_evidence"] == 2
    assert vectors["class_mark_ratio"] == 0.25


def test_class_overview_keeps_empty_weeks():
    """A gap has to draw as a zero bar. Omitting it hides the thing being looked for."""
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        activity = client.get("/staff/class/overview").json()["activity"]

    assert [week["attempts"] for week in activity] == [0, 4]


def test_a_student_page_carries_the_same_two_views_as_the_class():
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        body = client.get(f"/staff/students/{STUDENT_ID}").json()

    assert body["mark_codes"]["groups"][0]["code_class"] == "M"
    assert len(body["activity"]) == 2
    # Scoped to the student, not to the class -- the last lookup was by id.
    assert repository.mark_code_scopes[-1] == STUDENT_ID


def test_the_student_page_needs_one_request_not_two():
    """The ranking rides on the detail response.

    Two parallel requests from one page is the shape that trips this service's
    shared Supabase client -- reproduced live as intermittent 401s and 503s
    against /me alone. The standalone route still exists and still agrees.
    """
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        detail = client.get(f"/staff/students/{STUDENT_ID}").json()
        standalone = client.get(f"/staff/students/{STUDENT_ID}/weak-topics").json()

    assert detail["topics"] is not None
    assert detail["topics"] == standalone


def test_staff_and_student_see_the_same_mark_split():
    """Same reading of the same rows, whoever is looking."""
    repository = FakeStaffRepository(role=UserRole.STAFF)
    with _client(repository) as client:
        staff_view = client.get(f"/staff/students/{STUDENT_ID}").json()["mark_codes"]
        repository.role = UserRole.STUDENT
        own_view = client.get("/me/mark-codes").json()

    assert staff_view == own_view


# -- the list above must stay complete --------------------------------------


def test_every_staff_route_is_covered_by_this_file():
    """A staff route added without a test here is the mistake to catch.

    Matching on the path prefix rather than on the dependency, because a route
    that FORGOT require_staff_user is precisely the one that must not slip
    through -- checking for the gate would exempt it.
    """
    registered = {
        route.path
        for route in main.app.routes
        if getattr(route, "path", "").startswith("/staff")
    }
    covered = {
        "/staff/class/overview",
        "/staff/students",
        "/staff/students/{user_id}",
        "/staff/students/{user_id}/weak-topics",
    }
    assert registered == covered, (
        "A /staff route was added or removed. Add it to STAFF_ROUTES above so "
        "the refusal and privacy tests cover it too."
    )
