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

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                detail = (await response.aread()).decode("utf-8", errors="replace")
                raise DifyError(response.status_code, detail or "Dify request failed")

            async for chunk in response.aiter_bytes():
                yield chunk
