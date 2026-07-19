"""Enrich Dify SSE: RAGFlow/ZPL citations + friendly tool labels."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from app.dify.ragflow_citations import (
    build_retriever_resources,
    extract_chunks_from_agent_log_event,
)
from app.dify.thought_rewrite import ThoughtStreamRewriter
from app.dify.zpl_citations import (
    extract_zpl_resources_from_agent_log_event,
    extract_zpl_resources_from_agent_thought,
    merge_citation_resources,
)
from app.settings import RagflowSettings, ToolLabelSettings


class StreamEnricher:
    def __init__(
        self,
        *,
        ragflow: RagflowSettings | None = None,
        tool_labels: ToolLabelSettings | None = None,
        locale: str = "cs",
        collect_citations: bool = True,
    ):
        self._ragflow = ragflow if ragflow and ragflow.enabled else None
        self._collect_citations = collect_citations
        self._thought_rewriter = ThoughtStreamRewriter(tool_labels, (locale or "cs").lower())
        self._buffer = ""
        self._chunks: list[dict[str, Any]] = []
        self._dataset_id = ""
        self._seen_document_ids: set[str] = set()
        self._zpl_resources: list[dict[str, Any]] = []
        self._seen_zpl_keys: set[str] = set()

    def _active(self) -> bool:
        return (
            self._ragflow is not None
            or self._thought_rewriter._tool_labels is not None
            or self._collect_citations
        )

    def _remember_zpl_resources(self, resources: list[dict[str, Any]]) -> None:
        for resource in resources:
            document_id = str(resource.get("document_id") or "")
            meta = resource.get("doc_metadata") if isinstance(resource.get("doc_metadata"), dict) else {}
            key = document_id or str(meta.get("url") or "")
            if not key or key in self._seen_zpl_keys:
                continue
            self._seen_zpl_keys.add(key)
            self._zpl_resources.append(resource)

    def _ingest_agent_log(self, event: dict[str, Any]) -> None:
        if self._collect_citations:
            self._remember_zpl_resources(extract_zpl_resources_from_agent_log_event(event))

        if self._ragflow is None:
            return
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

    def _ingest_agent_thought(self, event: dict[str, Any]) -> None:
        if not self._collect_citations:
            return
        self._remember_zpl_resources(extract_zpl_resources_from_agent_thought(event))

    async def _resources_for_end_event(self) -> list[dict[str, Any]]:
        ragflow_resources: list[dict[str, Any]] = []
        if self._ragflow is not None and self._chunks:
            try:
                ragflow_resources = await build_retriever_resources(
                    self._chunks,
                    dataset_id=self._dataset_id or self._ragflow.default_dataset_id,
                    api_url=self._ragflow.api_url,
                    api_key=self._ragflow.api_key,
                    dataset_name=self._ragflow.dataset_name,
                )
            except Exception:
                # Don't drop ZPL citations if RAGFlow enrichment fails.
                ragflow_resources = []

        # ZPL first so law URLs aren't crowded out by RAGFlow's top-N docs.
        return merge_citation_resources(self._zpl_resources, ragflow_resources)

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
            # Our ZPL/RAGFlow list first so law URLs keep slots when Dify already sent docs.
            metadata["retriever_resources"] = merge_citation_resources(resources, list(existing))
            return event

        metadata["retriever_resources"] = resources
        return event

    async def _process_event(self, event: dict[str, Any]) -> dict[str, Any] | None:
        """Return rewritten event, or None to keep the original block bytes."""
        event_name = event.get("event")
        changed = False

        if event_name == "agent_log":
            self._ingest_agent_log(event)
            rewritten = self._thought_rewriter.rewrite_agent_log(event)
            if rewritten is not event:
                event = rewritten
                changed = True

        if event_name == "agent_thought":
            self._ingest_agent_thought(event)
            rewritten = self._thought_rewriter.rewrite_agent_thought(event)
            if rewritten is not event:
                event = rewritten
                changed = True

        if event_name in {"message_end", "workflow_finished"} and self._collect_citations:
            resources = await self._resources_for_end_event()
            if resources:
                event = self._merge_resources(event, resources)
                changed = True

        return event if changed else None

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

        rewritten = await self._process_event(event)
        if rewritten is None:
            return None
        return f"data: {json.dumps(rewritten, ensure_ascii=False)}\n\n".encode()

    async def enrich(self, source: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
        if not self._active():
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
