from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.settings import DifySettings


class DifyError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


async def stream_chat_message(
    settings: DifySettings,
    *,
    query: str,
    user: str,
    conversation_id: str = "",
    inputs: dict[str, Any] | None = None,
) -> AsyncIterator[bytes]:
    payload = {
        "inputs": inputs or {},
        "query": query,
        "response_mode": "streaming",
        "conversation_id": conversation_id,
        "user": user,
    }
    url = f"{settings.base_url}/chat-messages"
    headers = {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    detail = (await response.aread()).decode("utf-8", errors="replace")
                    raise DifyError(response.status_code, detail or "Dify request failed")

                async for chunk in response.aiter_bytes():
                    yield chunk
    except DifyError:
        raise
    except httpx.HTTPError as exc:
        raise DifyError(
            0,
            f"Cannot reach Dify at {url} ({exc.__class__.__name__}). "
            "From inside Docker, use the Dify service URL (e.g. http://api:5001/v1), not localhost.",
        ) from exc


async def fetch_app_parameters(settings: DifySettings, *, user: str) -> dict[str, Any]:
    url = f"{settings.base_url}/parameters"
    headers = {"Authorization": f"Bearer {settings.api_key}"}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = await client.get(url, headers=headers, params={"user": user})
            if response.status_code != 200:
                detail = response.text
                raise DifyError(response.status_code, detail or "Dify request failed")
            return response.json()
    except DifyError:
        raise
    except httpx.HTTPError as exc:
        raise DifyError(
            0,
            f"Cannot reach Dify at {url} ({exc.__class__.__name__}). "
            "From inside Docker, use the Dify service URL (e.g. http://api:5001/v1), not localhost.",
        ) from exc
