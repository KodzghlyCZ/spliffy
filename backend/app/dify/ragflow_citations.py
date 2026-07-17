"""Build Dify-compatible retriever_resources from RAGFlow agent tool responses."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

_TOOL_RESPONSE_PREFIX = "tool response: "
_RETRIEVAL_TOOL_NAMES = frozenset({"retrieval"})
_SOURCE_URL_RE = re.compile(r'^source_url:\s*["\']?([^"\'\s]+)', re.MULTILINE)
_EDU_JOB_URL_RE = re.compile(r"https://edu\.gov\.cz/job/[a-zA-Z0-9._/-]+")
_MAX_CHUNKS = 10
_MAX_CONTENT_LEN = 500


def _parse_json_object(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None
    try:
        payload = json.loads(text)
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start == -1:
        return None

    decoder = json.JSONDecoder()
    try:
        payload, _ = decoder.raw_decode(text, start)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def parse_ragflow_payload(tool_response: Any) -> dict[str, Any] | None:
    if tool_response is None:
        return None
    if isinstance(tool_response, dict):
        payload = tool_response
    elif isinstance(tool_response, str):
        text = tool_response.strip()
        if text.lower().startswith(_TOOL_RESPONSE_PREFIX):
            text = text[len(_TOOL_RESPONSE_PREFIX) :].strip()
        payload = _parse_json_object(text)
        if payload is None:
            return None
    else:
        return None

    result = payload.get("result")
    if isinstance(result, dict) and isinstance(result.get("chunks"), list):
        return result
    if isinstance(payload.get("chunks"), list):
        return payload
    return None


def _extract_url_from_content(content: str) -> str | None:
    if not content:
        return None
    match = _SOURCE_URL_RE.search(content)
    if match:
        return match.group(1).strip()
    match = _EDU_JOB_URL_RE.search(content)
    if match:
        return match.group(0).strip()
    return None


def _truncate_content(content: str) -> str:
    if len(content) <= _MAX_CONTENT_LEN:
        return content
    return content[: _MAX_CONTENT_LEN - 3] + "..."


def _tool_responses_from_agent_log(event_data: Any) -> list[dict[str, Any]]:
    if not isinstance(event_data, dict):
        return []

    candidates: list[Any] = []
    inner = event_data.get("data")
    if isinstance(inner, dict):
        candidates.append(inner)
        output = inner.get("output")
        if isinstance(output, dict):
            candidates.append(output)
    output = event_data.get("output")
    if isinstance(output, dict):
        candidates.append(output)

    for candidate in candidates:
        tool_responses = candidate.get("tool_responses")
        if isinstance(tool_responses, list):
            return [item for item in tool_responses if isinstance(item, dict)]
    return []


def extract_chunks_from_agent_log_event(event: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    data = event.get("data")
    if not isinstance(data, dict):
        return [], ""

    if data.get("status") not in (None, "success"):
        return [], ""

    all_chunks: list[dict[str, Any]] = []
    dataset_id = ""
    for tool_response_item in _tool_responses_from_agent_log(data):
        if tool_response_item.get("tool_call_name") not in _RETRIEVAL_TOOL_NAMES:
            continue

        raw_response = tool_response_item.get("tool_response")
        if raw_response is None:
            continue
        if isinstance(raw_response, str) and raw_response.strip().lower().startswith("tool invoke error"):
            continue

        tool_args = tool_response_item.get("tool_call_input") or {}
        if not isinstance(tool_args, dict):
            tool_args = {}

        payload = parse_ragflow_payload(raw_response)
        if not payload:
            continue

        chunks = payload.get("chunks") or []
        if not chunks:
            continue

        all_chunks.extend(chunk for chunk in chunks if isinstance(chunk, dict))
        if not dataset_id:
            dataset_id = str(
                tool_args.get("datasets_ids")
                or tool_args.get("dataset_id")
                or (chunks[0].get("dataset_id") if chunks else "")
                or ""
            )
    return all_chunks, dataset_id


async def fetch_ragflow_document_meta(
    *,
    api_url: str,
    api_key: str,
    dataset_id: str,
    document_id: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    if not api_url or not api_key or not dataset_id or not document_id:
        return {}

    base = api_url.rstrip("/")
    if not base.endswith("/api/v1"):
        base = f"{base}/api/v1"

    url = f"{base}/datasets/{dataset_id}/documents"
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {"id": document_id}

    try:
        if client is None:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as owned:
                response = await owned.get(url, headers=headers, params=params)
        else:
            response = await client.get(url, headers=headers, params=params)
    except httpx.HTTPError:
        return {}

    if response.status_code != 200:
        return {}

    try:
        payload = response.json()
    except ValueError:
        return {}

    docs = (payload.get("data") or {}).get("docs") if isinstance(payload, dict) else None
    if not isinstance(docs, list) or not docs or not isinstance(docs[0], dict):
        return {}

    doc = docs[0]
    meta_fields = doc.get("meta_fields") if isinstance(doc.get("meta_fields"), dict) else {}
    merged = dict(meta_fields)
    for key in ("name", "location", "type", "size", "token_count"):
        value = doc.get(key)
        if value not in (None, "") and key not in merged:
            merged[key] = value
    return merged


def _build_doc_metadata(
    chunk: dict[str, Any],
    *,
    dataset_id: str,
    ragflow_meta: dict[str, Any],
) -> dict[str, Any]:
    content = chunk.get("content") or ""
    document_keyword = chunk.get("document_keyword") or ""
    url = (
        ragflow_meta.get("url")
        or ragflow_meta.get("source_url")
        or ragflow_meta.get("file_url")
        or ragflow_meta.get("link")
        or _extract_url_from_content(content)
    )

    metadata: dict[str, Any] = {
        "dataset_id": chunk.get("dataset_id") or dataset_id,
        "document_id": chunk.get("document_id"),
        "document_keyword": document_keyword,
        "chunk_id": chunk.get("id"),
        "similarity": chunk.get("similarity"),
    }
    metadata.update({k: v for k, v in ragflow_meta.items() if v not in (None, "")})
    if url:
        metadata["url"] = url
        metadata["source_url"] = url
    return metadata


async def build_retriever_resources(
    chunks: list[dict[str, Any]],
    *,
    dataset_id: str,
    api_url: str = "",
    api_key: str = "",
    dataset_name: str = "RAGFlow",
) -> list[dict[str, Any]]:
    sorted_chunks = sorted(
        chunks,
        key=lambda chunk: float(chunk.get("similarity") or 0),
        reverse=True,
    )

    best_by_document: dict[str, dict[str, Any]] = {}
    for chunk in sorted_chunks:
        document_id = str(chunk.get("document_id") or chunk.get("id") or "")
        if not document_id:
            continue
        if document_id not in best_by_document:
            best_by_document[document_id] = chunk
        if len(best_by_document) >= _MAX_CHUNKS:
            break

    resources: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        for position, chunk in enumerate(best_by_document.values(), start=1):
            content = chunk.get("content") or ""
            document_id = str(chunk.get("document_id") or "")
            chunk_dataset_id = str(chunk.get("dataset_id") or dataset_id or "")
            document_name = chunk.get("document_keyword") or document_id
            similarity = chunk.get("similarity")
            score = float(similarity) if similarity is not None else None

            ragflow_meta = await fetch_ragflow_document_meta(
                api_url=api_url,
                api_key=api_key,
                dataset_id=chunk_dataset_id,
                document_id=document_id,
                client=client,
            )

            resources.append(
                {
                    "position": position,
                    "dataset_id": chunk_dataset_id,
                    "dataset_name": dataset_name,
                    "document_id": document_id,
                    "document_name": document_name,
                    "data_source_type": "external",
                    "segment_id": str(chunk.get("id") or ""),
                    "retriever_from": "ragflow_plugin",
                    "score": score,
                    "title": document_name,
                    "content": _truncate_content(content),
                    "doc_metadata": _build_doc_metadata(
                        chunk,
                        dataset_id=chunk_dataset_id,
                        ragflow_meta=ragflow_meta,
                    ),
                }
            )
    return resources
