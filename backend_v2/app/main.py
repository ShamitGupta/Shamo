"""Shamo tutor API.

Three endpoints, and the shape of them is the point:

  GET  /papers                 what is actually published
  GET  /papers/.../questions/N exact question context, or an explicit 404
  POST /chat                   grounded tutoring, streamed

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

from .config import Settings, get_settings
from .models import (
    AssetOut,
    ChatRequest,
    NotFoundOut,
    PaperSummary,
    PartOut,
    QuestionContextOut,
    QuestionRef,
)
from .repository import QuestionContext, Repository, RetrievalError
from .tutor import TutorService, TutorUnavailable

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Shamo Tutor API",
    version="0.1.0",
    description="Source-grounded tutoring over reviewed Cambridge past papers.",
)

_repository: Repository | None = None
_tutor: TutorService | None = None


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
