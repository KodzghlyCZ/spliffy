"""Inject retriever_resources into Dify SSE when agent logs contain RAGFlow chunks."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from app.dify.ragflow_citations import (
    build_retriever_resources,
    extract_chunks_from_agent_log_event,
)
from app.settings import RagflowSettings


class RagflowCitationStreamEnricher:
    def __init__(self, ragflow: RagflowSettings | None):
        self._ragflow = ragflow if ragflow and ragflow.enabled else None
        self._buffer = ""
        self._chunks: list[dict[str, Any]] = []
        self._dataset_id = ""
        self._seen_document_ids: set[str] = set()

    def _enabled(self) -> bool:
        return self._ragflow is not None

    def _ingest_agent_log(self, event: dict[str, Any]) -> None:
        chunks, dataset_id = extract_chunks_from_agent_log_event(event)
        if not chunks:
            return
        if dataset_id and not self._dataset_id:
            self._dataset_id = dataset_id
        for chunk in chunks:
            document_id = str(chunk.get("document_id") or "")
            if document_id and document_id in self._seen_document_ids:
                continue
            if document_id:
                self._seen_document_ids.add(document_id)
            self._chunks.append(chunk)

    async def _resources_for_end_event(self) -> list[dict[str, Any]]:
        if not self._enabled() or not self._chunks:
            return []
        assert self._ragflow is not None
        return await build_retriever_resources(
            self._chunks,
            dataset_id=self._dataset_id or self._ragflow.default_dataset_id,
            api_url=self._ragflow.api_url,
            api_key=self._ragflow.api_key,
            dataset_name=self._ragflow.dataset_name,
        )

    def _merge_resources(
        self,
        event: dict[str, Any],
        resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not resources:
            return event

        metadata = event.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
            event = {**event, "metadata": metadata}

        existing = metadata.get("retriever_resources")
        if isinstance(existing, list) and existing:
            return event

        metadata["retriever_resources"] = resources
        return event

    async def _process_event_line(self, line: str) -> bytes | None:
        if not line.startswith("data:"):
            return None

        payload_text = line[5:].strip()
        if not payload_text:
            return None

        try:
            event = json.loads(payload_text)
        except json.JSONDecodeError:
            return None

        if not isinstance(event, dict):
            return None

        event_name = event.get("event")
        if event_name == "agent_log" and self._enabled():
            self._ingest_agent_log(event)

        if event_name in {"message_end", "workflow_finished"} and self._enabled():
            resources = await self._resources_for_end_event()
            if resources:
                event = self._merge_resources(event, resources)
                return f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()

        return None

    async def enrich(self, source: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
        if not self._enabled():
            async for chunk in source:
                yield chunk
            return

        async for chunk in source:
            self._buffer += chunk.decode("utf-8", errors="replace")
            while True:
                separator_index = self._buffer.find("\n\n")
                if separator_index == -1:
                    break

                block = self._buffer[:separator_index]
                self._buffer = self._buffer[separator_index + 2 :]

                replacement: bytes | None = None
                for line in block.split("\n"):
                    maybe_replacement = await self._process_event_line(line)
                    if maybe_replacement is not None:
                        replacement = maybe_replacement

                if replacement is not None:
                    yield replacement
                else:
                    yield f"{block}\n\n".encode()

        if self._buffer:
            yield self._buffer.encode()
