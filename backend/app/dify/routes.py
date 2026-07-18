import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from app.auth.routes import get_current_user, require_user
from app.dify.client import DifyError, fetch_app_parameters, stream_chat_message
from app.dify.stream_enricher import StreamEnricher
from app.settings import DifySettings, get_settings, resolve_locale

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessageRequest(BaseModel):
    query: str = Field(min_length=1)
    conversation_id: str = ""
    inputs: dict[str, object] = Field(default_factory=dict)
    locale: str = ""


def _dify_settings() -> DifySettings:
    settings = get_settings()
    if not settings.dify.enabled or not settings.dify.api_key:
        raise HTTPException(status_code=503, detail="Chat is not configured")
    return settings.dify


def _dify_user_id(request: Request) -> str:
    settings = get_settings()
    if settings.auth.enabled:
        user = require_user(request)
        return str(user["sub"])

    anonymous_id = request.session.get("dify_user_id")
    if anonymous_id is None:
        anonymous_id = str(uuid.uuid4())
        request.session["dify_user_id"] = anonymous_id
    return str(anonymous_id)


def _request_locale(request: Request, body_locale: str = "") -> str:
    settings = get_settings()
    default = "cs"
    if settings.tool_labels is not None:
        default = settings.tool_labels.default_locale

    if body_locale.strip():
        return resolve_locale(body_locale, default=default)

    accept = request.headers.get("accept-language") or ""
    # Take the first language tag: "cs-CZ,cs;q=0.9,en;q=0.8" → cs-CZ
    primary = accept.split(",")[0].split(";")[0].strip() if accept else ""
    return resolve_locale(primary, default=default)


@router.get("/config")
def chat_config() -> dict[str, object]:
    settings = get_settings()
    payload: dict[str, object] = {
        "enabled": settings.dify.enabled and bool(settings.dify.api_key),
        "name": settings.dify.name,
        "names": settings.dify.name_forms,
        "markdown": settings.dify.markdown,
        "show_sources": settings.dify.show_sources,
    }
    if settings.ui_strings is not None:
        payload["ui_strings"] = {
            "chat": {
                "hint": settings.ui_strings.chat_hint,
            },
        }
    return payload


@router.get("/parameters")
async def chat_parameters(
    request: Request,
    dify: Annotated[DifySettings, Depends(_dify_settings)],
) -> dict[str, object]:
    settings = get_settings()
    if settings.auth.enabled and get_current_user(request) is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_id = _dify_user_id(request)

    try:
        data = await fetch_app_parameters(dify, user=user_id)
    except DifyError as exc:
        raise HTTPException(status_code=502, detail=exc.detail) from exc

    opening = data.get("opening_statement")
    suggested = data.get("suggested_questions")
    retriever = data.get("retriever_resource")
    citations_enabled = False
    if isinstance(retriever, dict):
        citations_enabled = bool(retriever.get("enabled"))

    return {
        "opening_statement": opening if isinstance(opening, str) else "",
        "suggested_questions": suggested if isinstance(suggested, list) else [],
        "citations_enabled": citations_enabled or settings.dify.show_sources,
    }


@router.post("/messages")
async def send_message(
    request: Request,
    body: ChatMessageRequest,
    dify: Annotated[DifySettings, Depends(_dify_settings)],
):
    settings = get_settings()
    if settings.auth.enabled and get_current_user(request) is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_id = _dify_user_id(request)
    locale = _request_locale(request, body.locale)
    enricher = StreamEnricher(
        ragflow=settings.ragflow,
        tool_labels=settings.tool_labels,
        locale=locale,
        collect_citations=settings.dify.show_sources,
    )

    async def event_stream():
        try:
            async for chunk in enricher.enrich(
                stream_chat_message(
                    dify,
                    query=body.query,
                    user=user_id,
                    conversation_id=body.conversation_id,
                    inputs=body.inputs,
                )
            ):
                yield chunk
        except DifyError as exc:
            payload = json.dumps({"event": "error", "message": exc.detail})
            yield f"data: {payload}\n\n".encode()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
