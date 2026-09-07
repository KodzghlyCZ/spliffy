"""Rewrite Dify agent SSE events for Spliffy thinking UI."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from app.dify.tool_labels import (
    labels_for_tool_calls,
    parse_agent_thought_tools,
    tool_calls_from_agent_log_data,
)
from app.settings import ToolLabelSettings

_ANSWER_FIELD_KEYS = ("thought", "action", "observation", "output", "text", "tool_name")
_OBSERVATION_PREVIEW_CHARS = 600


def _truncate(text: str, n: int = _OBSERVATION_PREVIEW_CHARS) -> str:
    value = (text or "").strip()
    if len(value) <= n:
        return value
    if n <= 1:
        return "…"
    cut = value[: n - 1].rstrip()
    space = cut.rfind(" ")
    if space >= n // 2:
        cut = cut[:space].rstrip()
    return cut + "…"


def _pop_fields(target: dict[str, Any], *keys: str) -> None:
    for key in keys:
        target.pop(key, None)


def _strip_answer_fields(target: dict[str, Any]) -> None:
    _pop_fields(target, *_ANSWER_FIELD_KEYS)


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value)


def _tool_response_texts(source: Any) -> list[str]:
    texts: list[str] = []
    if not isinstance(source, dict):
        return texts

    candidates: list[Any] = [source]
    inner = source.get("data")
    if isinstance(inner, dict):
        candidates.append(inner)
        output = inner.get("output")
        if isinstance(output, dict):
            candidates.append(output)
    output = source.get("output")
    if isinstance(output, dict):
        candidates.append(output)

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        tool_responses = candidate.get("tool_responses")
        if not isinstance(tool_responses, list):
            continue
        for item in tool_responses:
            if not isinstance(item, dict):
                continue
            response = item.get("tool_response")
            text = _as_text(response).strip()
            if text:
                texts.append(text)
    return texts


def _extract_observation_preview(*sources: Any) -> str:
    """Prefer observation/output text; fall back to tool_responses[].tool_response."""
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in ("observation", "output"):
            raw = source.get(key)
            if isinstance(raw, dict):
                nested = _tool_response_texts(raw)
                if nested:
                    return _truncate("\n\n".join(nested))
                continue
            text = _as_text(raw).strip()
            if text:
                return _truncate(text)

    collected: list[str] = []
    for source in sources:
        collected.extend(_tool_response_texts(source))
    if collected:
        return _truncate("\n\n".join(collected))
    return ""


def _is_final_answer_prose(text: str) -> bool:
    trimmed = (text or "").strip()
    if len(trimmed) < 200:
        return False
    if trimmed.startswith("**") or trimmed.startswith("#"):
        return True
    if trimmed[:40].lstrip().startswith(("1.", "1)")) and "**" in trimmed[:120]:
        return True
    paragraphs = [p for p in trimmed.split("\n\n") if p.strip()]
    if len(paragraphs) >= 2 and len(trimmed) > 400:
        return True
    return len(trimmed) > 600


def strip_final_agent_log_round(data: dict[str, Any]) -> None:
    """Remove final-answer prose from an agent_log ROUND payload."""
    metadata = data.get("metadata")
    if isinstance(metadata, dict):
        _strip_answer_fields(metadata)

    inner = data.get("data")
    if isinstance(inner, dict):
        _strip_answer_fields(inner)

    _strip_answer_fields(data)


def apply_friendly_tool_label(data: dict[str, Any], friendly: str) -> None:
    """Replace tool-call metadata with a friendly status label; keep a short observation preview."""
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        data["metadata"] = metadata

    inner = data.get("data") if isinstance(data.get("data"), dict) else None
    preview = _extract_observation_preview(metadata, inner or {}, data)

    metadata["thought"] = friendly
    _pop_fields(metadata, "action", "output")
    if preview:
        metadata["observation"] = preview
    else:
        metadata.pop("observation", None)

    if isinstance(inner, dict):
        inner = dict(inner)
        inner["thought"] = friendly
        _pop_fields(inner, "action", "tool_name", "output")
        if preview:
            inner["observation"] = preview
        else:
            inner.pop("observation", None)
        data["data"] = inner

    _pop_fields(data, "action", "tool_name", "output")
    data["thought"] = friendly
    if preview:
        data["observation"] = preview
    else:
        data.pop("observation", None)


class ThoughtStreamRewriter:
    """Maps raw Dify agent events to Spliffy-friendly thinking SSE."""

    def __init__(self, tool_labels: ToolLabelSettings | None, locale: str) -> None:
        self._tool_labels = tool_labels if tool_labels and tool_labels.enabled else None
        self._locale = locale if locale in {"cs", "en"} else "cs"

    def _templates(self) -> dict[str, str]:
        assert self._tool_labels is not None
        return self._tool_labels.templates_for(self._locale)

    def _default_template(self) -> str:
        assert self._tool_labels is not None
        return self._tool_labels.default_for(self._locale)

    def friendly_label(self, tool_calls: list[tuple[str, dict[str, Any]]]) -> str:
        if not tool_calls or self._tool_labels is None:
            return ""
        return labels_for_tool_calls(
            tool_calls,
            templates=self._templates(),
            default_template=self._default_template(),
        )

    def rewrite_agent_log(self, event: dict[str, Any]) -> dict[str, Any]:
        data = event.get("data")
        if not isinstance(data, dict):
            return event

        label = str(data.get("label") or "")
        tool_calls = tool_calls_from_agent_log_data(data)

        if "round" in label.lower() and not tool_calls:
            event = deepcopy(event)
            strip_final_agent_log_round(event["data"])
            return event

        if self._tool_labels is None or not tool_calls:
            return event

        friendly = self.friendly_label(tool_calls)
        if not friendly:
            return event

        event = deepcopy(event)
        apply_friendly_tool_label(event["data"], friendly)
        return event

    def rewrite_agent_thought(self, event: dict[str, Any]) -> dict[str, Any]:
        tool = event.get("tool")

        if tool and self._tool_labels is not None:
            tool_calls = parse_agent_thought_tools(tool, event.get("tool_input"))
            if tool_calls:
                label = self.friendly_label(tool_calls)
                if label:
                    preview = _extract_observation_preview(event)
                    return {
                        **event,
                        "thought": label,
                        "tool": "",
                        "tool_input": "",
                        "observation": preview,
                    }

        if not tool:
            thought = _as_text(event.get("thought")).strip()
            observation = _as_text(event.get("observation")).strip()
            if _is_final_answer_prose(thought) or _is_final_answer_prose(observation):
                return {**event, "thought": "", "observation": ""}
            return {
                **event,
                "thought": thought,
                "observation": _truncate(observation) if observation else "",
            }

        return event
