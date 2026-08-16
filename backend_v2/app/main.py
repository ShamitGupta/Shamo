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

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import manim_renderer
from .config import Settings, get_settings
from .models import (
    AssetOut,
    ChatRequest,
    ModeResponseOut,
    MultiModeRequest,
    MultiModeResponse,
    NotFoundOut,
    PaperSummary,
    PartOut,
    QuestionContextOut,
    QuestionRef,
    TutorMode,
    VisualArtifactKind,
    VisualArtifactOut,
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

app = FastAPI(
    title="Shamo Tutor API",
    version="0.1.0",
    description="Source-grounded tutoring over reviewed Cambridge past papers.",
)

_repository: Repository | None = None
_tutor: TutorService | None = None
_visualizer: VisualizeService | None = None


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
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
    )
    return payload, all_required_signed


def _load_or_404(ref: QuestionRef, repository: Repository) -> QuestionContext:
    try:
        context = repository.get_question_context(
            ref.year, ref.exam_session, ref.paper_variant, ref.question_number
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
                    f"{ref.paper_variant} {ref.exam_session} {ref.year} question "
                    f"{ref.question_number} is not in the published corpus, so there is "
                    "nothing to teach from. Pick a question from /papers."
                ),
                searched_for=ref,
                available_hint=repository.nearest_available(ref.year, ref.paper_variant),
            ).model_dump(),
        )
    return context


@app.get(
    "/papers/{year}/{exam_session}/{paper_variant}/questions/{question_number}",
    response_model=QuestionContextOut,
)
def get_question(
    year: int,
    exam_session: str,
    paper_variant: str,
    question_number: int,
    repository: Repository = Depends(get_repository),
) -> QuestionContextOut:
    ref = QuestionRef(
        year=year,
        exam_session=exam_session,
        paper_variant=paper_variant,
        question_number=question_number,
    )
    context = _load_or_404(ref, repository)
    payload, _ = _render_context(context, repository)
    return payload


@app.post("/chat")
def chat(
    request: ChatRequest,
    repository: Repository = Depends(get_repository),
    tutor: TutorService = Depends(get_tutor),
) -> StreamingResponse:
    if request.mode is TutorMode.VISUALIZE:
        raise HTTPException(status_code=400, detail="Use /visualize for Visualize mode.")

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
            history=request.history,
            asset_urls_available=assets_available,
        )
    except TutorUnavailable as error:
        raise HTTPException(status_code=502, detail=f"Tutor unavailable: {error}") from error

    return StreamingResponse(stream, media_type="text/plain; charset=utf-8")


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
        if response.validation_status == VisualValidationStatus.VALIDATED:
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
    repository: Repository = Depends(get_repository),
    visualizer: VisualizeService = Depends(get_visualizer),
    settings: Settings = Depends(get_settings),
) -> VisualizeResponse:
    # Same grounding boundary as /chat: the client sends only the reference, and
    # the server retrieves the official question before any model call.
    context = _load_or_404(request.question, repository)

    try:
        return _create_visualize_response(
            request=request,
            context=context,
            repository=repository,
            visualizer=visualizer,
            settings=settings,
        )
    except VisualizeUnavailable as error:
        raise HTTPException(status_code=502, detail=f"Visualize unavailable: {error}") from error


@app.post("/respond", response_model=MultiModeResponse)
def respond(
    request: MultiModeRequest,
    repository: Repository = Depends(get_repository),
    tutor: TutorService = Depends(get_tutor),
    visualizer: VisualizeService = Depends(get_visualizer),
    settings: Settings = Depends(get_settings),
) -> MultiModeResponse:
    """Coordinate one student turn across the selected modes.

    The older UI fired one independent request per selected mode. That preserved
    each mode's rules, but it also let modes contradict each other because the
    text response did not know Visualize was handling the graph/animation. This
    endpoint keeps the per-mode handlers separate while sharing retrieval,
    selected-mode awareness, and one response envelope for the current turn.
    """

    context = _load_or_404(request.question, repository)
    _, assets_available = _render_context(context, repository)

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

    return MultiModeResponse(source_reference=request.question, responses=responses)
