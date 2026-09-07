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
_TEXT_KEYS = (
    "text",
    "content",
    "markdown",
    "observation",
    "output",
    "result",
    "answer",
    "message",
    "response",
    "tool_response",
)
_TOOL_RESPONSE_PREFIX = "tool response: "


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
            dumped = json.dumps(value, ensure_ascii=False, indent=2)
            return f"```json\n{dumped}\n```"
        except Exception:
            return str(value)
    return str(value)


def _parse_json_value(text: str) -> Any:
    stripped = text.strip()
    if not stripped or stripped[0] not in "{[":
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    try:
        payload, _ = json.JSONDecoder().raw_decode(stripped)
    except json.JSONDecodeError:
        return None
    return payload


def _strip_outer_rules(text: str) -> str:
    lines = text.strip().splitlines()
    if lines and set(lines[0].strip()) <= {"-"} and len(lines[0].strip()) >= 3:
        lines = lines[1:]
    if lines and set(lines[-1].strip()) <= {"-"} and len(lines[-1].strip()) >= 3:
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _normalize_observation_text(text: str) -> str:
    value = text.strip()
    if value.lower().startswith(_TOOL_RESPONSE_PREFIX):
        value = value[len(_TOOL_RESPONSE_PREFIX) :].strip()
    if "\\n" in value and value.count("\n") <= 1:
        value = value.replace("\\n", "\n").replace("\\t", "\t")
    return _strip_outer_rules(value)


def _unwrap_observation(value: Any, depth: int = 0) -> str:
    """Pull markdown/text out of Dify JSON wrappers like {\"text\": \"## ...\"}."""
    if depth > 6 or value is None:
        return ""

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return ""
        parsed = _parse_json_value(text)
        if isinstance(parsed, (dict, list)):
            inner = _unwrap_observation(parsed, depth + 1)
            if inner:
                return inner
        return _normalize_observation_text(text)

    if isinstance(value, list):
        parts = [_unwrap_observation(item, depth + 1) for item in value]
        return "\n\n".join(part for part in parts if part)

    if isinstance(value, dict):
        tool_responses = value.get("tool_responses")
        if isinstance(tool_responses, list):
            parts = [
                _unwrap_observation(
                    item.get("tool_response") if isinstance(item, dict) else item,
                    depth + 1,
                )
                for item in tool_responses
            ]
            joined = "\n\n".join(part for part in parts if part)
            if joined:
                return joined

        for key in _TEXT_KEYS:
            if key not in value:
                continue
            inner = _unwrap_observation(value.get(key), depth + 1)
            if inner:
                return inner

        nested = value.get("data")
        if isinstance(nested, dict):
            inner = _unwrap_observation(nested, depth + 1)
            if inner:
                return inner
        return ""

    return _normalize_observation_text(str(value))


def _extract_observation(*sources: Any) -> str:
    """Prefer observation/output text; fall back to nested tool_response payloads."""
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in ("observation", "output", "text"):
            text = _unwrap_observation(source.get(key))
            if text:
                return text
        text = _unwrap_observation(source)
        if text:
            return text
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
    """Replace tool-call metadata with a friendly status label; keep the full observation."""
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        data["metadata"] = metadata

    inner = data.get("data") if isinstance(data.get("data"), dict) else None
    preview = _extract_observation(metadata, inner or {}, data)

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
                    preview = _extract_observation(event)
                    return {
                        **event,
                        "thought": label,
                        "tool": "",
                        "tool_input": "",
                        "observation": preview,
                    }

        if not tool:
            thought = _as_text(event.get("thought")).strip()
            observation = _unwrap_observation(event.get("observation"))
            if _is_final_answer_prose(thought) or _is_final_answer_prose(observation):
                return {**event, "thought": "", "observation": ""}
            return {
                **event,
                "thought": thought,
                "observation": observation,
            }

        return event
