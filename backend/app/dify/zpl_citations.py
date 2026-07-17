"""Build Dify-compatible retriever_resources from zpl-mcp get_law_excerpt responses."""

from __future__ import annotations

import json
import re
from typing import Any

_TOOL_RESPONSE_PREFIX = "tool response: "
_ZPL_TOOL_NAMES = frozenset({"get_law_excerpt"})
_ZPL_URL_RE = re.compile(
    r"https?://(?:www\.)?zakonyprolidi\.cz/cs/\d{4}-\d+[^\s\"'<>]*",
    re.IGNORECASE,
)
_MAX_SOURCES = 20
_MAX_CONTENT_LEN = 500


def normalize_zpl_tool_name(name: str) -> str:
    text = (name or "").strip()
    if not text:
        return ""
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    if text.endswith("get_law_excerpt") or text == "get_law_excerpt":
        return "get_law_excerpt"
    return text


def _truncate_content(content: str) -> str:
    if len(content) <= _MAX_CONTENT_LEN:
        return content
    return content[: _MAX_CONTENT_LEN - 3] + "..."


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


def _strip_tool_response_prefix(raw: str) -> str:
    text = raw.strip()
    if text.lower().startswith(_TOOL_RESPONSE_PREFIX):
        return text[len(_TOOL_RESPONSE_PREFIX) :].strip()
    return text


def tool_response_items_from_agent_log(event_data: Any) -> list[dict[str, Any]]:
    """
    Normalize agent_log payloads into tool-response dicts.

    Dify emits either:
    - ROUND logs with output.tool_responses: [{tool_call_name, tool_call_input, tool_response}, ...]
    - CALL logs with a single tool in output: {tool_call_name, tool_call_input, tool_response}
    """
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

    items: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        tool_responses = candidate.get("tool_responses")
        if isinstance(tool_responses, list):
            items.extend(item for item in tool_responses if isinstance(item, dict))
            continue
        # Single CALL tool shape
        name = candidate.get("tool_call_name") or candidate.get("tool_name")
        response = candidate.get("tool_response")
        if name and response is not None:
            items.append(candidate)

    return items


def parse_zpl_payload(tool_response: Any) -> dict[str, Any] | None:
    """Parse JSON from a get_law_excerpt tool response."""
    if tool_response is None:
        return None
    if isinstance(tool_response, dict):
        payload = tool_response
    elif isinstance(tool_response, str):
        if tool_response.strip().lower().startswith("tool invoke error"):
            return None
        payload = _parse_json_object(_strip_tool_response_prefix(tool_response))
        if payload is None:
            match = _ZPL_URL_RE.search(tool_response)
            if match:
                return {"ok": True, "url": match.group(0).rstrip(".,);]")}
            return None
    else:
        return None

    result = payload.get("result")
    if isinstance(result, dict) and (
        "url" in result or "ok" in result or "text" in result or "excerpt" in result
    ):
        payload = result
    elif isinstance(result, str):
        nested = _parse_json_object(result)
        if isinstance(nested, dict):
            payload = nested

    content = payload.get("content")
    if isinstance(content, str) and ("url" not in payload and "ok" not in payload):
        nested = _parse_json_object(content)
        if isinstance(nested, dict):
            payload = nested
    elif isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                nested = _parse_json_object(item["text"])
                if isinstance(nested, dict) and (
                    "url" in nested or "ok" in nested or "excerpt" in nested
                ):
                    payload = nested
                    break

    if not isinstance(payload, dict):
        return None
    if payload.get("ok") is False and not payload.get("url"):
        return None
    if not any(isinstance(payload.get(k), str) and payload[k].startswith("http") for k in ("url", "source_url", "link")):
        if isinstance(tool_response, str):
            match = _ZPL_URL_RE.search(tool_response)
            if match:
                payload = {**payload, "url": match.group(0).rstrip(".,);]")}
    return payload


def _format_paragraph_label(cislo: Any) -> str:
    text = str(cislo).strip()
    if not text:
        return ""
    # zpl often returns "§ 1" already — don't double the mark.
    text = re.sub(r"^§+\s*", "", text).strip()
    return f"§ {text}" if text else ""


def _title_from_payload(payload: dict[str, Any], args: dict[str, Any]) -> str:
    law_meta = payload.get("law_metadata") if isinstance(payload.get("law_metadata"), dict) else {}
    cislo = payload.get("cislo_paragrafu") or args.get("paragraph")
    nazev_para = payload.get("nazev_paragrafu")
    nazev_zakona = law_meta.get("nazev_zakona")
    cislo_zakona = law_meta.get("cislo_zakona")

    parts: list[str] = []
    if cislo_zakona:
        parts.append(str(cislo_zakona))
    elif nazev_zakona:
        parts.append(str(nazev_zakona))
    elif payload.get("html_title"):
        parts.append(str(payload["html_title"]))
    else:
        reference = args.get("reference")
        if isinstance(reference, str) and reference.strip():
            parts.append(reference.strip())

    para_label = _format_paragraph_label(cislo) if cislo is not None else ""
    if para_label:
        parts.append(para_label)
    if nazev_para and str(nazev_para) not in parts:
        parts.append(str(nazev_para))

    if parts:
        return " — ".join(parts)

    url = payload.get("url")
    return str(url) if url else "Zákony pro lidi"


def _url_from_payload(payload: dict[str, Any]) -> str | None:
    section_meta = payload.get("section_metadata")
    if isinstance(section_meta, dict):
        for key in ("url", "source_url", "link"):
            value = section_meta.get(key)
            if isinstance(value, str) and value.startswith("http"):
                return value.strip()

    for key in ("url", "source_url", "link"):
        value = payload.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return value.strip()

    text = payload.get("excerpt")
    if not isinstance(text, str):
        text = payload.get("text")
    if isinstance(text, str):
        match = _ZPL_URL_RE.search(text)
        if match:
            return match.group(0).rstrip(".,);]")
    return None


def _resource_from_payload(
    payload: dict[str, Any],
    *,
    args: dict[str, Any],
    position: int,
) -> dict[str, Any] | None:
    url = _url_from_payload(payload)
    if not url:
        return None

    title = _title_from_payload(payload, args)
    content = payload.get("excerpt") if isinstance(payload.get("excerpt"), str) else ""
    if not content and isinstance(payload.get("text"), str):
        content = payload["text"]
    paragraph = payload.get("cislo_paragrafu") or args.get("paragraph") or ""
    section_meta = payload.get("section_metadata") if isinstance(payload.get("section_metadata"), dict) else {}
    anchor_id = payload.get("anchor_id") or section_meta.get("anchor_id") or ""
    document_id = f"zpl:{url}|{paragraph}"

    return {
        "position": position,
        "dataset_id": "zpl-mcp",
        "dataset_name": "Zákony pro lidi",
        "document_id": document_id,
        "document_name": title,
        "data_source_type": "external",
        "segment_id": str(paragraph or anchor_id or ""),
        "retriever_from": "zpl_mcp",
        "score": None,
        "title": title,
        "content": _truncate_content(content) if content else "",
        "doc_metadata": {
            "url": url,
            "source_url": url,
            "anchor_id": anchor_id or None,
            "reference": args.get("reference"),
            "paragraph": paragraph,
            "html_title": payload.get("html_title"),
            "law_metadata": payload.get("law_metadata"),
            "cislo_paragrafu": payload.get("cislo_paragrafu"),
            "nazev_paragrafu": payload.get("nazev_paragrafu"),
        },
    }


def extract_zpl_resources_from_agent_log_event(event: dict[str, Any]) -> list[dict[str, Any]]:
    data = event.get("data")
    if not isinstance(data, dict):
        return []
    status = data.get("status")
    if isinstance(status, str) and status.lower() in {"error", "failed", "failure", "running", "start"}:
        return []

    resources: list[dict[str, Any]] = []
    for tool_response_item in tool_response_items_from_agent_log(data):
        tool_name = normalize_zpl_tool_name(str(tool_response_item.get("tool_call_name") or ""))
        if tool_name not in _ZPL_TOOL_NAMES:
            continue

        payload = parse_zpl_payload(tool_response_item.get("tool_response"))
        if not payload:
            continue

        tool_args = tool_response_item.get("tool_call_input") or {}
        if not isinstance(tool_args, dict):
            tool_args = {}

        resource = _resource_from_payload(payload, args=tool_args, position=len(resources) + 1)
        if resource:
            resources.append(resource)

    return resources


def extract_zpl_resources_from_agent_thought(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Fallback when observation carries the get_law_excerpt JSON."""
    tool = event.get("tool")
    tool_name = ""
    if isinstance(tool, str):
        tool_name = normalize_zpl_tool_name(tool)
    elif isinstance(tool, list) and tool:
        tool_name = normalize_zpl_tool_name(str(tool[0]))

    observation = event.get("observation")
    payload = parse_zpl_payload(observation)
    if not payload:
        return []

    if tool_name not in _ZPL_TOOL_NAMES and not _url_from_payload(payload):
        return []

    args = event.get("tool_input")
    if isinstance(args, str):
        try:
            parsed = json.loads(args)
            args = parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            args = {"reference": args}
    if not isinstance(args, dict):
        args = {}

    resource = _resource_from_payload(payload, args=args, position=1)
    return [resource] if resource else []


def merge_citation_resources(
    *groups: list[dict[str, Any]],
    max_sources: int = _MAX_SOURCES,
) -> list[dict[str, Any]]:
    """Dedupe by document_id (keeps distinct §§), fall back to URL, renumber positions."""
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for group in groups:
        for resource in group:
            if not isinstance(resource, dict):
                continue
            meta = resource.get("doc_metadata") if isinstance(resource.get("doc_metadata"), dict) else {}
            document_id = str(resource.get("document_id") or "")
            url = str(meta.get("url") or meta.get("source_url") or "")
            # Prefer document_id so multiple paragraphs of the same law stay distinct.
            key = document_id or url
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(dict(resource))
            if len(merged) >= max_sources:
                break
        if len(merged) >= max_sources:
            break

    for index, resource in enumerate(merged, start=1):
        resource["position"] = index
    return merged
