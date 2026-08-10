"""The model call.

Deliberately thin. All the judgement lives in prompts.py and all the facts come
from repository.py; this module only turns a context plus a message into a
stream of tokens.

The one rule it enforces itself: `stream` requires a QuestionContext. There is
no code path that reaches the provider without one, which is what stops the
failure the legacy service has -- a lookup that returns nothing, an empty string
passed to the model, and a fluent answer about a paper nobody has.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

from openai import OpenAI

from .config import Settings
from .models import ChatTurn, TutorMode
from .prompts import build_system_prompt, build_user_message
from .repository import QuestionContext

logger = logging.getLogger(__name__)


class TutorService:
    def __init__(self, settings: Settings, client: OpenAI | None = None) -> None:
        self._settings = settings
        self._client = client or OpenAI(api_key=settings.openai_api_key)

    def stream(
        self,
        *,
        context: QuestionContext,
        mode: TutorMode,
        message: str,
        attempt: str | None,
        history: list[ChatTurn],
        asset_urls_available: bool,
    ) -> Iterator[str]:
        if context is None:  # pragma: no cover - defended by the type, kept as a tripwire
            raise ValueError("Refusing to call the model without question context.")

        system_prompt = build_system_prompt(context, mode, asset_urls_available)

        # History is trimmed to the most recent turns. Older turns are about the
        # same question by construction -- the frontend starts a new thread when
        # the question changes -- so dropping them loses conversational texture,
        # not grounding.
        trimmed = history[-self._settings.max_history_messages :]
        messages = [{"role": "system", "content": system_prompt}]
        messages += [{"role": turn.role, "content": turn.content} for turn in trimmed]
        messages.append(
            {"role": "user", "content": build_user_message(message, attempt, mode)}
        )

        try:
            stream = self._client.chat.completions.create(
                model=self._settings.tutor_model,
                messages=messages,
                stream=True,
            )
        except Exception as error:  # noqa: BLE001
            logger.exception("Tutor call failed")
            # Surfaced to the student as a plain failure. Never fall back to an
            # ungrounded answer: silence is better than confident invention.
            raise TutorUnavailable(str(error)) from error

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content


class TutorUnavailable(RuntimeError):
    """The provider could not be reached or refused the request."""
