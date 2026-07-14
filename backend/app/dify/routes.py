import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from app.auth.routes import get_current_user, require_user
from app.dify.client import DifyError, fetch_app_parameters, stream_chat_message
from app.settings import DifySettings, get_settings

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessageRequest(BaseModel):
    query: str = Field(min_length=1)
    conversation_id: str = ""
    inputs: dict[str, object] = Field(default_factory=dict)


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


@router.get("/config")
def chat_config() -> dict[str, object]:
    settings = get_settings()
    return {
        "enabled": settings.dify.enabled and bool(settings.dify.api_key),
        "name": settings.dify.name,
    }


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

    return {
        "opening_statement": opening if isinstance(opening, str) else "",
        "suggested_questions": suggested if isinstance(suggested, list) else [],
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

    async def event_stream():
        try:
            async for chunk in stream_chat_message(
                dify,
                query=body.query,
                user=user_id,
                conversation_id=body.conversation_id,
                inputs=body.inputs,
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
