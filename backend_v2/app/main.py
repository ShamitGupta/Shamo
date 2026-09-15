"""Shamo tutor API.

Three endpoints, and the shape of them is the point:

  GET  /papers                 what is actually published
  GET  /papers/.../questions/N exact question context, or an explicit 404
  POST /chat                   grounded tutoring, streamed
  POST /visualize              grounded visual specs, validated and cached

A student can only ask about a question the catalogue offers, and the chat
endpoint re-retrieves that question server-side rather than trusting anything the
client sends. So the material the tutor reasons over is always the reviewed,
published material -- the client cannot substitute its own.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import manim_renderer
from .attempt_outcome import AttemptOutcomeExtractor
from .auth import AuthenticatedUser, AuthError, AuthService
from .config import Settings, get_settings
from .models import (
    AssistRequest,
    AssistResponse,
    AssetOut,
    ChatRequest,
    ChatTurn,
    ConversationDetailOut,
    ConversationOut,
    ConversationTurnOut,
    CreateConversationRequest,
    CurrentUserOut,
    ModeResponseOut,
    MultiModeRequest,
    MultiModeResponse,
    NotFoundOut,
    PaperSummary,
    PartOut,
    QuestionContextOut,
    QuestionRef,
    RenameConversationRequest,
    SimilarQuestionOut,
    SimilarQuestionsResponse,
    SimilarQuestionsStatus,
    SuggestedActionOut,
    TopicEvidenceOut,
    TopicWeaknessOut,
    TopicWeaknessResponse,
    TutorMode,
    VisualArtifactKind,
    VisualArtifactOut,
    VisualArtifactSummary,
    VisualValidationStatus,
    VisualizeRequest,
    VisualizeResponse,
)
from .repository import QuestionContext, Repository, RetrievalError
from .tutor import TutorService, TutorUnavailable
from .visualize import (
    VISUAL_PROMPT_VERSION,
    VISUAL_SPEC_VERSION,
    VisualizeService,
    VisualizeUnavailable,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_HINT_RE = re.compile(r"\b(stuck|hint|nudge|next step|where do i start|start)\b", re.IGNORECASE)
_EXPLAIN_RE = re.compile(
    r"\b(explain|solution|solve|walk me through|why|how do i|how should i|full method)\b",
    re.IGNORECASE,
)
_CHECK_RE = re.compile(
    r"\b(check|mark|my working|my work|is this right|did i get|correct|wrong|mistake)\b",
    re.IGNORECASE,
)
_VISUAL_RE = re.compile(
    r"\b(visuali[sz]e|graph|plot|draw|diagram|animate|animation|show me visually|show it visually)\b",
    re.IGNORECASE,
)
_VISUAL_FOLLOWUP_RE = re.compile(
    r"\b(that|this|the)\s+(visual|graph|plot|diagram|animation)\b|"
    r"\b(don't understand|do not understand|confused|explain|clarify|interpret)\b.*"
    r"\b(visual|graph|plot|diagram|animation)\b",
    re.IGNORECASE,
)
_WORKING_RE = re.compile(r"(=|\\frac|\d+\s*/\s*\d+|therefore|hence|so\s+.*=)")

app = FastAPI(
    title="Shamo Tutor API",
    version="0.1.0",
    description="Source-grounded tutoring over reviewed Cambridge past papers.",
)

_repository: Repository | None = None
_tutor: TutorService | None = None
_visualizer: VisualizeService | None = None
_auth_service: AuthService | None = None
_outcome_extractor: AttemptOutcomeExtractor | None = None


def get_repository(settings: Settings = Depends(get_settings)) -> Repository:
    global _repository
    if _repository is None:
        _repository = Repository(settings)
    return _repository


def get_tutor(settings: Settings = Depends(get_settings)) -> TutorService:
    global _tutor
    if _tutor is None:
        _tutor = TutorService(settings)
    return _tutor


def get_visualizer(settings: Settings = Depends(get_settings)) -> VisualizeService:
    global _visualizer
    if _visualizer is None:
        _visualizer = VisualizeService(settings)
    return _visualizer


def get_outcome_extractor(
    settings: Settings = Depends(get_settings),
) -> AttemptOutcomeExtractor:
    global _outcome_extractor
    if _outcome_extractor is None:
        _outcome_extractor = AttemptOutcomeExtractor(settings)
    return _outcome_extractor


def get_auth_service(settings: Settings = Depends(get_settings)) -> AuthService:
    global _auth_service
    if _auth_service is None:
        _auth_service = AuthService(settings)
    return _auth_service


def get_current_user(
    authorization: str | None = Header(default=None),
    auth_service: AuthService = Depends(get_auth_service),
) -> AuthenticatedUser:
    if not authorization:
        raise HTTPException(status_code=401, detail="Sign in to use the tutor.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Sign in to use the tutor.")

    try:
        return auth_service.get_user(token.strip())
    except AuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error


def require_verified_user(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    if not current_user.email_confirmed:
        raise HTTPException(
            status_code=403,
            detail="Please verify your email before using the tutor.",
        )
    return current_user


# Added at import, not on startup: Starlette builds its middleware stack when the
# app starts, so a later add_middleware raises. Settings validate loudly at
# import too, which means a missing credential fails immediately rather than on
# the first request.
#
# The origin list is explicit and has no wildcard default. The legacy service
# allows every origin with credentials disabled, which is survivable for an
# anonymous prototype and will not be once this one carries student data.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_credentials=True,
    # PATCH and DELETE are here for the conversation endpoints. A missing method
    # does not fail the offline tests -- TestClient does not enforce CORS -- it
    # fails only in a real browser, as a 400 on the preflight and an opaque
    # network error on the request itself.
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/me", response_model=CurrentUserOut)
def me(
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: Repository = Depends(get_repository),
) -> CurrentUserOut:
    try:
        profile = repository.get_profile(current_user.user_id)
        tier = repository.get_effective_tier(current_user.user_id)
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return CurrentUserOut(
        user_id=current_user.user_id,
        email=current_user.email,
        email_confirmed=current_user.email_confirmed,
        tier=tier,
        profile=profile,
    )


@app.get("/papers", response_model=list[PaperSummary])
def list_papers(repository: Repository = Depends(get_repository)) -> list[PaperSummary]:
    try:
        return [PaperSummary(**paper) for paper in repository.list_papers()]
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def _render_context(
    context: QuestionContext, repository: Repository
) -> tuple[QuestionContextOut, bool]:
    """Build the client payload and report whether every required diagram signed.

    The boolean matters downstream: the tutor is told when a required diagram
    could not be shown, so it can describe it rather than point at it.
    """
    assets: list[AssetOut] = []
    all_required_signed = True
    for asset in context.assets:
        url = None
        bucket = asset.get("storage_bucket")
        path = asset.get("storage_path")
        if bucket and path:
            url = repository.sign_asset(bucket, path)
        if asset.get("required_to_solve") and not url:
            all_required_signed = False
        assets.append(
            AssetOut(
                description=asset.get("description"),
                required_to_solve=bool(asset.get("required_to_solve")),
                url=url,
                url_expires_in_seconds=(
                    get_settings().asset_url_ttl_seconds if url else None
                ),
            )
        )

    parts = [
        PartOut(
            label="".join(f"({p})" for p in (part.get("label_path") or [])),
            marks=part.get("marks"),
            prompt_markdown=str(part.get("prompt_markdown") or ""),
            mark_scheme_items=part.get("mark_scheme_items") or [],
        )
        for part in context.parts
    ]

    payload = QuestionContextOut(
        year=context.paper.get("year"),
        exam_session=context.paper.get("exam_session"),
        paper_variant=str(context.paper.get("paper_variant")),
        question_number=context.question.get("question_number"),
        total_marks=context.total_marks,
        stem_markdown=str(context.question.get("stem_markdown") or ""),
        parts=parts,
        root_mark_scheme=context.question.get("root_mark_scheme") or [],
        assets=assets,
        source_documents=context.documents,
        qualification=context.paper.get("qualification") or "a_level",
        syllabus_code=context.paper.get("syllabus_code") or "9709",
        subject=context.paper.get("subject"),
    )
    return payload, all_required_signed


def _load_or_404(ref: QuestionRef, repository: Repository) -> QuestionContext:
    try:
        context = repository.get_question_context(
            ref.year,
            ref.exam_session,
            ref.paper_variant,
            ref.question_number,
            qualification=ref.qualification,
            syllabus_code=ref.syllabus_code,
        )
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    if context is None:
        # An explicit, informative miss. This is the branch the legacy service
        # does not have, and its absence is why that service can answer about a
        # paper it never found.
        raise HTTPException(
            status_code=404,
            detail=NotFoundOut(
                detail=(
                    f"{ref.syllabus_code}/{ref.paper_variant} {ref.exam_session} {ref.year} "
                    f"question {ref.question_number} is not in the published corpus, so there "
                    "is nothing to teach from. Pick a question from /papers."
                ),
                searched_for=ref,
                available_hint=repository.nearest_available(
                    ref.year,
                    ref.paper_variant,
                    qualification=ref.qualification,
                    syllabus_code=ref.syllabus_code,
                ),
            ).model_dump(),
        )
    return context


def route_assist_modes(message: str, history: list) -> tuple[list[TutorMode], str]:
    """Route a natural student turn to the smallest useful mode set."""

    text = message.strip()
    has_prior_visual = any(
        turn.role == "assistant" and bool(turn.visual_artifacts)
        for turn in history
    )

    if has_prior_visual and _VISUAL_FOLLOWUP_RE.search(text):
        return [TutorMode.VISUALIZE], "Explaining the visual"
    if _CHECK_RE.search(text) or (_WORKING_RE.search(text) and len(text) >= 18):
        return [TutorMode.CHECK], "Checking your working"
    if _VISUAL_RE.search(text):
        return [TutorMode.EXPLAIN, TutorMode.VISUALIZE], "Explaining with a visual"
    if _EXPLAIN_RE.search(text):
        return [TutorMode.EXPLAIN], "Explaining the method"
    if _HINT_RE.search(text):
        return [TutorMode.HINT], "Giving a hint"
    return [TutorMode.HINT], "Starting with a hint"


def _suggested_actions(modes: list[TutorMode]) -> list[SuggestedActionOut]:
    """Small next-step actions shown after a routed Tutor reply."""

    suggestions: list[SuggestedActionOut] = []
    if TutorMode.VISUALIZE not in modes:
        suggestions.append(
            SuggestedActionOut(
                label="Show me visually",
                kind="send",
                message="Show me this visually.",
                mode=None,
            )
        )
    if TutorMode.EXPLAIN not in modes:
        suggestions.append(
            SuggestedActionOut(
                label="Explain this step",
                kind="send",
                message="Explain this step fully.",
                mode=TutorMode.EXPLAIN,
            )
        )
    if TutorMode.HINT not in modes:
        suggestions.append(
            SuggestedActionOut(
                label="Give me a smaller hint",
                kind="send",
                message="Give me a smaller hint.",
                mode=TutorMode.HINT,
            )
        )
    suggestions.append(
        SuggestedActionOut(
            label="Check my working",
            kind="prefill",
            message="",
            mode=TutorMode.CHECK,
        )
    )
    return suggestions[:4]


@app.get(
    "/papers/{year}/{exam_session}/{paper_variant}/questions/{question_number}",
    response_model=QuestionContextOut,
)
def get_question(
    year: int,
    exam_session: str,
    paper_variant: str,
    question_number: int,
    # Query params, not path segments, and defaulted to the corpus's original
    # single syllabus: an old bookmark or client that never heard of IGCSE
    # still resolves to the 9709 paper it always meant.
    qualification: str = "a_level",
    syllabus_code: str = "9709",
    repository: Repository = Depends(get_repository),
) -> QuestionContextOut:
    ref = QuestionRef(
        year=year,
        exam_session=exam_session,
        paper_variant=paper_variant,
        question_number=question_number,
        qualification=qualification,
        syllabus_code=syllabus_code,
    )
    context = _load_or_404(ref, repository)
    payload, _ = _render_context(context, repository)
    return payload


def _build_similar_response(
    ref: QuestionRef, rows: list[dict[str, Any]]
) -> SimilarQuestionsResponse:
    """Turn the RPC's rows into the client payload.

    The RPC reports its status on every row, including the single sentinel row
    it emits when there is nothing to recommend, so the head row is always the
    place to read it from.
    """
    if not rows:
        return SimilarQuestionsResponse(
            source_reference=ref, status=SimilarQuestionsStatus.UNAVAILABLE
        )

    head = rows[0]
    matches = [
        SimilarQuestionOut(
            question_id=str(row["question_id"]),
            reference=QuestionRef(
                year=row["year"],
                exam_session=row["exam_session"],
                paper_variant=str(row["paper_variant"]),
                question_number=row["question_number"],
                qualification=row["qualification"],
                syllabus_code=row["syllabus_code"],
            ),
            subject=row.get("subject"),
            paper_component=str(row.get("paper_component") or ""),
            main_topic=row.get("main_topic"),
            shares_main_topic=bool(row.get("shares_main_topic")),
            total_marks=row.get("total_marks"),
            stem_snippet=str(row.get("stem_snippet") or ""),
            similarity=float(row["similarity"]),
            matched_on_part=bool(row.get("matched_on_part")),
        )
        for row in sorted(
            (candidate for candidate in rows if candidate.get("question_id")),
            key=lambda candidate: candidate.get("match_rank") or 0,
        )
    ]
    return SimilarQuestionsResponse(
        source_reference=ref,
        status=head.get("result_status") or SimilarQuestionsStatus.UNAVAILABLE,
        seed_main_topic=head.get("seed_main_topic"),
        seed_total_marks=head.get("seed_total_marks"),
        is_ready=bool(head.get("is_ready")),
        readiness_status=head.get("readiness_status"),
        same_component_paper_count=int(head.get("same_component_paper_count") or 0),
        same_component_cross_paper_question_count=int(
            head.get("same_component_cross_paper_question_count") or 0
        ),
        min_similarity=float(head.get("applied_min_similarity") or 0.60),
        matches=matches,
    )


@app.get(
    "/papers/{year}/{exam_session}/{paper_variant}/questions/{question_number}/similar",
    response_model=SimilarQuestionsResponse,
)
def get_similar_questions(
    year: int,
    exam_session: str,
    paper_variant: str,
    question_number: int,
    qualification: str = "a_level",
    syllabus_code: str = "9709",
    limit: int = 5,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
) -> SimilarQuestionsResponse:
    """Questions from other papers in the same component that resemble this one.

    Note the gate. Unlike the question endpoint directly above, which shares
    this path prefix and is deliberately public, this one REQUIRES a verified
    session -- the same gate as the tutor endpoints. Do not infer a route's
    auth posture here from its path or its method.

    The seed's UUID is resolved server-side from the reference, exactly as
    /chat and /visualize do, so the client never names the row the similarity
    search actually runs from.

    limit is forwarded unvalidated on purpose: the SQL clamps it into [1, 20]
    before it reaches the underlying matcher, which also closes an integer
    overflow in that matcher's candidate-pool arithmetic. Do not remove the
    clamp there on the assumption that this route bounds it.
    """
    _ = current_user
    ref = QuestionRef(
        year=year,
        exam_session=exam_session,
        paper_variant=paper_variant,
        question_number=question_number,
        qualification=qualification,
        syllabus_code=syllabus_code,
    )
    context = _load_or_404(ref, repository)
    if not context.question_id:
        # Degrade rather than fail. A published question with no id is a data
        # defect, not a missing question, so a 404 would say the wrong thing.
        logger.warning("Similar-question lookup skipped: question has no id")
        return SimilarQuestionsResponse(
            source_reference=ref, status=SimilarQuestionsStatus.UNAVAILABLE
        )

    try:
        rows = repository.get_similar_questions(
            context.question_id,
            qualification=ref.qualification,
            syllabus_code=ref.syllabus_code,
            limit=limit,
        )
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return _build_similar_response(ref, rows)


# -- conversations ----------------------------------------------------------
#
# Persistence is deliberately additive to the tutoring path. A request with no
# conversation_id behaves exactly as it did before this existed, which is what
# keeps evaluate_tutor.py and any older client working unchanged.


def _question_ref_from_row(row: dict[str, Any] | None) -> QuestionRef | None:
    """Rebuild a reference from stored columns, or None if it is not complete.

    A partial reference is treated as absent rather than guessed at. The table
    forbids storing one, so reaching the None branch means the row predates that
    constraint or came from somewhere unexpected -- either way, inventing the
    missing half would be worse than omitting it.
    """
    if not row:
        return None
    required = ("year", "exam_session", "paper_variant", "question_number")
    if any(row.get(field) in (None, "") for field in required):
        return None
    try:
        return QuestionRef(
            year=int(row["year"]),
            exam_session=str(row["exam_session"]),
            paper_variant=str(row["paper_variant"]),
            question_number=int(row["question_number"]),
            qualification=str(row.get("qualification") or "a_level"),
            syllabus_code=str(row.get("syllabus_code") or "9709"),
        )
    except (ValueError, TypeError):
        return None


def _conversation_out(row: dict[str, Any]) -> ConversationOut:
    return ConversationOut(
        id=str(row.get("id")),
        title=row.get("title"),
        created_at=str(row.get("created_at")) if row.get("created_at") else None,
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
        last_active_at=str(row.get("last_active_at")) if row.get("last_active_at") else None,
        turn_count=int(row.get("turn_count") or 0),
        last_question=_question_ref_from_row(row.get("last_question")),
    )


def _visual_summaries(raw: Any) -> list[VisualArtifactSummary]:
    """Stored visual summaries, skipping any that no longer validate.

    A summary shape can change between versions; one unreadable entry should
    cost that entry, not the whole conversation.
    """
    summaries: list[VisualArtifactSummary] = []
    for entry in raw or []:
        try:
            summaries.append(VisualArtifactSummary(**entry))
        except Exception:  # noqa: BLE001
            continue
    return summaries


def _turn_out(row: dict[str, Any]) -> ConversationTurnOut:
    modes: list[TutorMode] = []
    for value in row.get("modes") or []:
        try:
            modes.append(TutorMode(value))
        except ValueError:
            continue
    return ConversationTurnOut(
        id=str(row.get("id")),
        role=row.get("role") or "user",
        content=str(row.get("content") or ""),
        modes=modes,
        visual_artifacts=_visual_summaries(row.get("visual_artifacts")),
        question=_question_ref_from_row(row),
        sort_order=int(row.get("sort_order") or 0),
        created_at=str(row.get("created_at")) if row.get("created_at") else None,
    )


def _chat_turn(row: dict[str, Any]) -> ChatTurn:
    out = _turn_out(row)
    return ChatTurn(
        role=out.role,
        content=out.content,
        modes=out.modes or None,
        visual_artifacts=out.visual_artifacts or None,
        question=out.question,
    )


def _conversation_or_404(
    conversation_id: Any, user: AuthenticatedUser, repository: Repository
) -> dict[str, Any]:
    try:
        conversation = repository.get_conversation(user.user_id, str(conversation_id))
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conversation


def _resolve_history(
    *,
    request: Any,
    user: AuthenticatedUser,
    repository: Repository,
) -> tuple[list[ChatTurn], dict[str, Any] | None]:
    """Decide what the tutor is allowed to treat as this conversation's past.

    When the request names a conversation, history comes from the database and
    the client-supplied `history` is ignored entirely. That mirrors the rule
    already applied to question content: the server re-retrieves rather than
    trusting what the browser sends, so a client cannot invent a past in which
    the tutor already said something it did not say.

    With no conversation_id the client's own history is used, exactly as before
    -- that is what keeps older callers and the evaluation harness working.
    """
    conversation_id = getattr(request, "conversation_id", None)
    if conversation_id is None:
        return list(request.history), None

    conversation = _conversation_or_404(conversation_id, user, repository)
    try:
        rows = repository.get_conversation_turns(user.user_id, str(conversation_id))
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return [_chat_turn(row) for row in rows], conversation


def _save_turn(
    *,
    repository: Repository,
    user: AuthenticatedUser,
    conversation: dict[str, Any] | None,
    role: str,
    content: str,
    question: QuestionRef,
    modes: list[TutorMode] | None = None,
    visual_artifacts: list[VisualArtifactSummary] | None = None,
    question_id: str | None = None,
) -> str | None:
    """Append one turn, or do nothing when the request is not in a conversation.

    Never raises. A failure to save is logged and the student still gets their
    answer -- losing the transcript is bad, but failing the tutoring because the
    transcript could not be written would be worse.
    """
    if conversation is None:
        return None
    try:
        row = repository.append_turn(
            user_id=user.user_id,
            conversation_id=str(conversation["id"]),
            role=role,
            content=content,
            modes=[mode.value for mode in modes or []],
            visual_artifacts=(
                [summary.model_dump(mode="json") for summary in visual_artifacts]
                if visual_artifacts
                else None
            ),
            question=question.model_dump(mode="json"),
            question_id=question_id,
        )
        return str(row.get("id")) if row else None
    except Exception as error:  # noqa: BLE001
        logger.warning("Could not append a %s turn: %s", role, error)
        return None


def _record_attempt_if_any(
    *,
    repository: Repository,
    extractor: AttemptOutcomeExtractor | None,
    user: AuthenticatedUser,
    context: QuestionContext,
    question: QuestionRef,
    attempt: str | None,
    mode: TutorMode,
    turn_id: str | None,
    transcript: str | None = None,
) -> None:
    """Record a submitted attempt, with the marks the tutor attributed.

    Runs AFTER the reply exists, because the reply is the input: the outcome is
    a record of what the tutor told the student, not a second opinion on the
    mathematics. A missing or unusable outcome stores the attempt anyway with
    outcome_source "unavailable" -- the attempt itself is still evidence that
    the question was worked on.

    Wrapped because this is bookkeeping running after a student already has
    their answer. The stated guarantee is that failing to record an attempt
    never costs anyone their tutoring.
    """
    if not attempt or not attempt.strip():
        return

    outcome = None
    if extractor is not None and transcript and transcript.strip():
        try:
            result = extractor.extract(
                context=context,
                transcript=transcript,
                attempt=attempt,
            )
            outcome = result.model_dump(mode="json") if result else None
        except Exception as error:  # noqa: BLE001
            logger.warning("Outcome extraction failed for %s: %s", user.user_id, error)

    try:
        repository.record_attempt(
            user_id=user.user_id,
            question=question.model_dump(mode="json"),
            question_id=context.question_id,
            attempt_text=attempt,
            mode=mode.value,
            conversation_turn_id=turn_id,
            outcome=outcome,
        )
    except Exception as error:  # noqa: BLE001
        logger.warning("Could not record an attempt for %s: %s", user.user_id, error)


def _topic_row_to_out(row: dict[str, Any]) -> TopicWeaknessOut:
    examples: list[TopicEvidenceOut] = []
    for entry in row.get("example_questions") or []:
        reference = _question_ref_from_row(entry)
        if reference is None:
            continue
        examples.append(
            TopicEvidenceOut(
                reference=reference,
                marks_earned=entry.get("marks_earned"),
                marks_available=entry.get("marks_available"),
                attempted_at=str(entry.get("attempted_at")) if entry.get("attempted_at") else None,
            )
        )
    ratio = row.get("mark_ratio")
    return TopicWeaknessOut(
        main_topic=str(row.get("main_topic")),
        syllabus_codes=list(row.get("syllabus_codes") or []),
        attempts=int(row.get("attempts") or 0),
        scored_attempts=int(row.get("scored_attempts") or 0),
        marks_earned=int(row.get("marks_earned") or 0),
        marks_available=int(row.get("marks_available") or 0),
        mark_ratio=float(ratio) if ratio is not None else None,
        has_enough_evidence=bool(row.get("has_enough_evidence")),
        last_attempted_at=(
            str(row.get("last_attempted_at")) if row.get("last_attempted_at") else None
        ),
        examples=examples,
    )


@app.get("/me/weak-topics", response_model=TopicWeaknessResponse)
def weak_topics(
    min_attempts: int = 3,
    limit: int = 20,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
) -> TopicWeaknessResponse:
    """How this student is scoring by topic, weakest first, with the evidence.

    Topics without enough attempts to judge are returned separately rather than
    hidden: "we do not know yet" is a real answer, and dropping them silently
    would make a thin history look like a complete one.
    """
    min_attempts = max(1, min(min_attempts, 50))
    limit = max(1, min(limit, 100))
    try:
        rows = repository.get_topic_weakness(
            current_user.user_id, min_attempts=min_attempts, limit=limit
        )
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    topics = [_topic_row_to_out(row) for row in rows]
    return TopicWeaknessResponse(
        min_attempts=min_attempts,
        ranked=[t for t in topics if t.has_enough_evidence],
        needs_more_evidence=[t for t in topics if not t.has_enough_evidence],
    )


@app.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
) -> list[ConversationOut]:
    try:
        rows = repository.list_conversations(current_user.user_id)
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return [_conversation_out(row) for row in rows]


@app.post("/conversations", response_model=ConversationOut, status_code=201)
def create_conversation(
    request: CreateConversationRequest,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
) -> ConversationOut:
    try:
        row = repository.create_conversation(current_user.user_id, request.title)
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return _conversation_out(row)


@app.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
def get_conversation(
    conversation_id: str,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
) -> ConversationDetailOut:
    conversation = _conversation_or_404(conversation_id, current_user, repository)
    try:
        rows = repository.get_conversation_turns(current_user.user_id, conversation_id)
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return ConversationDetailOut(
        conversation=_conversation_out(conversation),
        turns=[_turn_out(row) for row in rows],
    )


@app.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: str,
    request: RenameConversationRequest,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
) -> ConversationOut:
    try:
        row = repository.rename_conversation(
            current_user.user_id, conversation_id, request.title
        )
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return _conversation_out(row)


@app.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: str,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
) -> None:
    try:
        deleted = repository.delete_conversation(current_user.user_id, conversation_id)
    except RetrievalError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found.")


def _summarize_artifacts(
    artifacts: list[VisualArtifactOut],
) -> list[VisualArtifactSummary]:
    """Compact records of what a turn rendered, for storage and later history.

    Deliberately drops the full spec and the signed video URL: the summary only
    needs to remind a later turn what already exists, and a stored signed URL
    would be expired by the time anyone read it back.
    """
    return [
        VisualArtifactSummary(
            artifact_kind=artifact.artifact_kind,
            title=artifact.title,
            purpose=artifact.purpose,
            part_label=artifact.part_label,
            manim_template=artifact.manim.template if artifact.manim else None,
        )
        for artifact in artifacts
    ]


def _persisting_stream(
    *,
    stream: Any,
    repository: Repository,
    user: AuthenticatedUser,
    conversation: dict[str, Any] | None,
    question: QuestionRef,
    mode: TutorMode,
    question_id: str | None,
    extractor: AttemptOutcomeExtractor | None = None,
    context: QuestionContext | None = None,
    attempt: str | None = None,
    turn_id: str | None = None,
) -> Any:
    """Yield the tutor's answer, then store what the student actually saw.

    A streamed answer only exists in full once the stream ends, so the assistant
    turn cannot be written up front. The finally clause also covers the student
    closing the tab mid-answer: whatever had already been sent is stored,
    because that is exactly what they saw. Storing nothing in that case would
    leave their question in the transcript with no reply beneath it.
    """
    chunks: list[str] = []
    try:
        for chunk in stream:
            chunks.append(chunk)
            yield chunk
    finally:
        text = "".join(chunks)
        if text.strip():
            _save_turn(
                repository=repository,
                user=user,
                conversation=conversation,
                role="assistant",
                content=text,
                question=question,
                modes=[mode],
                question_id=question_id,
            )
        # Recorded here rather than before the stream, because the reply is what
        # the outcome is read from. A student who closed the tab still gets the
        # attempt stored, with whatever the tutor had managed to say.
        if context is not None:
            _record_attempt_if_any(
                repository=repository,
                extractor=extractor,
                user=user,
                context=context,
                question=question,
                attempt=attempt,
                mode=mode,
                turn_id=turn_id,
                transcript=text,
            )


@app.post("/chat")
def chat(
    request: ChatRequest,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
    tutor: TutorService = Depends(get_tutor),
    extractor: AttemptOutcomeExtractor = Depends(get_outcome_extractor),
) -> StreamingResponse:
    if request.mode is TutorMode.VISUALIZE:
        raise HTTPException(status_code=400, detail="Use /visualize for Visualize mode.")

    history, conversation = _resolve_history(
        request=request, user=current_user, repository=repository
    )

    # Retrieved here, server-side, from the reference only. The client never
    # supplies question content, so it cannot put words in the tutor's source.
    context = _load_or_404(request.question, repository)
    _, assets_available = _render_context(context, repository)

    try:
        stream = tutor.stream(
            context=context,
            mode=request.mode,
            message=request.message,
            attempt=request.attempt,
            history=history,
            asset_urls_available=assets_available,
        )
    except TutorUnavailable as error:
        raise HTTPException(status_code=502, detail=f"Tutor unavailable: {error}") from error

    # Saved only after the tutor accepted the request, so a 502 does not leave a
    # student turn stranded with no possible reply.
    turn_id = _save_turn(
        repository=repository,
        user=current_user,
        conversation=conversation,
        role="user",
        content=request.message,
        question=request.question,
        question_id=context.question_id,
    )
    return StreamingResponse(
        _persisting_stream(
            stream=stream,
            repository=repository,
            user=current_user,
            conversation=conversation,
            question=request.question,
            mode=request.mode,
            question_id=context.question_id,
            extractor=extractor,
            context=context,
            attempt=request.attempt,
            turn_id=turn_id,
        ),
        media_type="text/plain; charset=utf-8",
    )


def _resign_cached_manim_artifacts(
    response: VisualizeResponse, repository: Repository
) -> VisualizeResponse:
    """A cached artifact's video_storage_path is durable; its video_url is not.

    The signed URL was only ever valid for the request that minted it, so a
    cache hit re-signs a fresh one from the durable path rather than ever
    returning whatever URL happened to be embedded in the stored spec. An
    artifact whose video no longer signs (e.g. the object was deleted) is
    dropped rather than shown broken; the same drop-and-maybe-fallback
    behaviour render failures use below.
    """
    if not any(a.artifact_kind == VisualArtifactKind.MANIM_TEMPLATE_VIDEO for a in response.artifacts):
        return response

    kept: list[VisualArtifactOut] = []
    for artifact in response.artifacts:
        if artifact.artifact_kind != VisualArtifactKind.MANIM_TEMPLATE_VIDEO:
            kept.append(artifact)
            continue
        signed_url = (
            repository.resign_visual_video(artifact.video_storage_path)
            if artifact.video_storage_path
            else None
        )
        if not signed_url:
            logger.info("Dropping cached manim artifact: could not re-sign its video")
            continue
        kept.append(
            artifact.model_copy(
                update={
                    "video_url": signed_url,
                    "video_url_expires_in_seconds": get_settings().asset_url_ttl_seconds,
                }
            )
        )

    return _with_resolved_artifacts(response, kept)


def _render_and_store_manim_artifacts(
    response: VisualizeResponse, repository: Repository, context: QuestionContext
) -> VisualizeResponse:
    """Render every fresh manim_template_video artifact and attach a durable path + signed URL.

    A render or upload failure drops just that artifact rather than failing
    the whole request: another artifact in the same response (or the
    fallback text) can still reach the student. validation_status flips to
    RENDER_FAILED only if nothing usable survives.
    """
    if not any(a.artifact_kind == VisualArtifactKind.MANIM_TEMPLATE_VIDEO for a in response.artifacts):
        return response

    question_id = context.question_id
    kept: list[VisualArtifactOut] = []
    for artifact in response.artifacts:
        if artifact.artifact_kind != VisualArtifactKind.MANIM_TEMPLATE_VIDEO or not artifact.manim:
            kept.append(artifact)
            continue
        if not question_id:
            logger.warning("Dropping manim artifact: question has no id to key the video on")
            continue

        output_path = None
        try:
            output_path = manim_renderer.render_to_mp4(artifact.manim)
            stored = repository.store_visual_video(
                question_id=question_id,
                manim_spec=artifact.manim.model_dump(mode="json"),
                video_path=output_path,
            )
        except manim_renderer.ManimRenderError as error:
            logger.warning("Manim render failed, dropping artifact: %s", error)
            stored = None
        finally:
            if output_path is not None:
                output_path.unlink(missing_ok=True)

        if not stored:
            continue
        storage_path, signed_url = stored
        kept.append(
            artifact.model_copy(
                update={
                    "video_storage_path": storage_path,
                    "video_url": signed_url,
                    "video_url_expires_in_seconds": get_settings().asset_url_ttl_seconds,
                }
            )
        )

    return _with_resolved_artifacts(response, kept)


def _with_resolved_artifacts(response: VisualizeResponse, kept: list[VisualArtifactOut]) -> VisualizeResponse:
    if len(kept) == len(response.artifacts):
        return response.model_copy(update={"artifacts": kept})
    status = (
        VisualValidationStatus.RENDER_FAILED
        if not kept
        else response.validation_status
    )
    return response.model_copy(update={"artifacts": kept, "validation_status": status})


def _create_visualize_response(
    *,
    request: VisualizeRequest,
    context: QuestionContext,
    repository: Repository,
    visualizer: VisualizeService,
    settings: Settings,
) -> VisualizeResponse:
    # The cache is keyed only on (question, exact message text, spec
    # version) -- it knows nothing about conversation history. Once a
    # response can legitimately depend on "what was already shown earlier in
    # THIS conversation" (see build_visual_system_prompt's prior-visuals
    # section), a cached reply built from one student's history could be
    # served to an unrelated conversation that types similar follow-up
    # phrasing for the same question. So caching only applies to a
    # question's first Visualize turn, when there is no history yet to make
    # the response conversation-specific.
    has_history = bool(request.history)

    if not has_history:
        cached = repository.get_visual_artifact(
            context=context,
            student_prompt=request.message,
            visual_spec_version=VISUAL_SPEC_VERSION,
        )
        if cached:
            response = VisualizeResponse.model_validate(cached)
            return _resign_cached_manim_artifacts(response, repository)

    response = visualizer.create(
        context=context,
        ref=request.question,
        message=request.message,
        history=request.history,
    )

    if response.validation_status == VisualValidationStatus.VALIDATED:
        # Render/upload before caching, not after: the cached spec_jsonb must
        # carry the durable video_storage_path, or every future cache hit
        # would find nothing to re-sign a URL from.
        response = _render_and_store_manim_artifacts(response, repository, context)
        if not has_history and response.validation_status == VisualValidationStatus.VALIDATED:
            repository.store_visual_artifact(
                context=context,
                student_prompt=request.message,
                response_payload=response.model_dump(mode="json"),
                generator_model=settings.tutor_model,
                prompt_version=VISUAL_PROMPT_VERSION,
            )

    return response


@app.post("/visualize", response_model=VisualizeResponse)
def visualize(
    request: VisualizeRequest,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
    visualizer: VisualizeService = Depends(get_visualizer),
    settings: Settings = Depends(get_settings),
) -> VisualizeResponse:
    history, conversation = _resolve_history(
        request=request, user=current_user, repository=repository
    )
    # Same grounding boundary as /chat: the client sends only the reference, and
    # the server retrieves the official question before any model call.
    context = _load_or_404(request.question, repository)

    try:
        response = _create_visualize_response(
            request=request.model_copy(update={"history": history}),
            context=context,
            repository=repository,
            visualizer=visualizer,
            settings=settings,
        )
    except VisualizeUnavailable as error:
        raise HTTPException(status_code=502, detail=f"Visualize unavailable: {error}") from error

    _save_turn(
        repository=repository,
        user=current_user,
        conversation=conversation,
        role="user",
        content=request.message,
        question=request.question,
        question_id=context.question_id,
    )
    _save_turn(
        repository=repository,
        user=current_user,
        conversation=conversation,
        role="assistant",
        content=response.message_markdown,
        question=request.question,
        modes=[TutorMode.VISUALIZE],
        visual_artifacts=_summarize_artifacts(response.artifacts),
        question_id=context.question_id,
    )
    return response


def _create_mode_responses(
    *,
    request: MultiModeRequest,
    context: QuestionContext,
    assets_available: bool,
    repository: Repository,
    tutor: TutorService,
    visualizer: VisualizeService,
    settings: Settings,
) -> list[ModeResponseOut]:
    responses: list[ModeResponseOut] = []
    for mode in request.modes:
        if mode is TutorMode.VISUALIZE:
            visual_request = VisualizeRequest(
                question=request.question,
                message=request.message,
                history=request.history,
            )
            try:
                visual_response = _create_visualize_response(
                    request=visual_request,
                    context=context,
                    repository=repository,
                    visualizer=visualizer,
                    settings=settings,
                )
                responses.append(
                    ModeResponseOut(
                        mode=mode,
                        message_markdown=visual_response.message_markdown,
                        artifacts=visual_response.artifacts,
                        fallback_markdown=visual_response.fallback_markdown,
                        validation_status=visual_response.validation_status,
                    )
                )
            except VisualizeUnavailable as error:
                responses.append(
                    ModeResponseOut(
                        mode=mode,
                        error=f"Visualize unavailable: {error}",
                    )
                )
            continue

        try:
            text = "".join(
                tutor.stream(
                    context=context,
                    mode=mode,
                    message=request.message,
                    attempt=request.attempt if mode is TutorMode.CHECK else None,
                    history=request.history,
                    asset_urls_available=assets_available,
                    selected_modes=request.modes,
                )
            )
            responses.append(ModeResponseOut(mode=mode, message_markdown=text))
        except TutorUnavailable as error:
            responses.append(
                ModeResponseOut(mode=mode, error=f"Tutor unavailable: {error}")
            )
    return responses


def _persist_multimode_turn(
    *,
    repository: Repository,
    extractor: AttemptOutcomeExtractor | None,
    user: AuthenticatedUser,
    conversation: dict[str, Any] | None,
    question: QuestionRef,
    message: str,
    attempt: str | None,
    responses: list[ModeResponseOut],
    context: QuestionContext,
) -> None:
    """Store one coordinated turn: the student's message, then each mode's reply.

    One assistant turn per mode rather than a merged one, because that is how
    the UI renders them and how ChatTurn.modes was designed to be read -- a
    merged turn would make a later Hint unable to tell which part of the reply
    came from Explain.
    """
    if conversation is None and not attempt:
        return
    turn_id = _save_turn(
        repository=repository,
        user=user,
        conversation=conversation,
        role="user",
        content=message,
        question=question,
        question_id=context.question_id,
    )
    for response in responses:
        if not response.message_markdown:
            continue
        _save_turn(
            repository=repository,
            user=user,
            conversation=conversation,
            role="assistant",
            content=response.message_markdown,
            question=question,
            modes=[response.mode],
            visual_artifacts=_summarize_artifacts(response.artifacts),
            question_id=context.question_id,
        )
    check_reply = next(
        (r.message_markdown for r in responses if r.mode is TutorMode.CHECK), None
    )
    if attempt and check_reply is not None:
        _record_attempt_if_any(
            repository=repository,
            extractor=extractor,
            user=user,
            context=context,
            question=question,
            attempt=attempt,
            mode=TutorMode.CHECK,
            turn_id=turn_id,
            transcript=check_reply,
        )


@app.post("/assist", response_model=AssistResponse)
def assist(
    request: AssistRequest,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
    tutor: TutorService = Depends(get_tutor),
    visualizer: VisualizeService = Depends(get_visualizer),
    settings: Settings = Depends(get_settings),
    extractor: AttemptOutcomeExtractor = Depends(get_outcome_extractor),
) -> AssistResponse:
    """Route one natural student turn to the most useful tutor mode(s)."""

    history, conversation = _resolve_history(
        request=request, user=current_user, repository=repository
    )
    modes, route_label = route_assist_modes(request.message, history)
    multimode_request = MultiModeRequest(
        question=request.question,
        modes=modes,
        message=request.message,
        attempt=request.message if TutorMode.CHECK in modes else None,
        history=history,
    )
    context = _load_or_404(request.question, repository)
    _, assets_available = _render_context(context, repository)
    responses = _create_mode_responses(
        request=multimode_request,
        context=context,
        assets_available=assets_available,
        repository=repository,
        tutor=tutor,
        visualizer=visualizer,
        settings=settings,
    )
    _persist_multimode_turn(
        repository=repository,
        extractor=extractor,
        user=current_user,
        conversation=conversation,
        question=request.question,
        message=request.message,
        attempt=multimode_request.attempt,
        responses=responses,
        context=context,
    )
    return AssistResponse(
        source_reference=request.question,
        routed_modes=modes,
        route_label=route_label,
        responses=responses,
        suggested_actions=_suggested_actions(modes),
    )


@app.post("/respond", response_model=MultiModeResponse)
def respond(
    request: MultiModeRequest,
    current_user: AuthenticatedUser = Depends(require_verified_user),
    repository: Repository = Depends(get_repository),
    tutor: TutorService = Depends(get_tutor),
    visualizer: VisualizeService = Depends(get_visualizer),
    settings: Settings = Depends(get_settings),
    extractor: AttemptOutcomeExtractor = Depends(get_outcome_extractor),
) -> MultiModeResponse:
    """Coordinate one student turn across the selected modes.

    The older UI fired one independent request per selected mode. That preserved
    each mode's rules, but it also let modes contradict each other because the
    text response did not know Visualize was handling the graph/animation. This
    endpoint keeps the per-mode handlers separate while sharing retrieval,
    selected-mode awareness, and one response envelope for the current turn.
    """

    history, conversation = _resolve_history(
        request=request, user=current_user, repository=repository
    )
    context = _load_or_404(request.question, repository)
    _, assets_available = _render_context(context, repository)
    responses = _create_mode_responses(
        request=request.model_copy(update={"history": history}),
        context=context,
        assets_available=assets_available,
        repository=repository,
        tutor=tutor,
        visualizer=visualizer,
        settings=settings,
    )
    _persist_multimode_turn(
        repository=repository,
        extractor=extractor,
        user=current_user,
        conversation=conversation,
        question=request.question,
        message=request.message,
        attempt=request.attempt,
        responses=responses,
        context=context,
    )

    return MultiModeResponse(source_reference=request.question, responses=responses)
