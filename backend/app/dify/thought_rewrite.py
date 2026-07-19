"""Rewrite Dify agent SSE events for Spliffy thinking UI."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.dify.tool_labels import (
    labels_for_tool_calls,
    parse_agent_thought_tools,
    tool_calls_from_agent_log_data,
)
from app.settings import ToolLabelSettings

_ANSWER_FIELD_KEYS = ("thought", "action", "observation", "output", "text", "tool_name")


def _pop_fields(target: dict[str, Any], *keys: str) -> None:
    for key in keys:
        target.pop(key, None)


def _strip_answer_fields(target: dict[str, Any]) -> None:
    _pop_fields(target, *_ANSWER_FIELD_KEYS)


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
    """Replace tool-call metadata with a friendly status label; drop raw observations."""
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        data["metadata"] = metadata
    metadata["thought"] = friendly
    _pop_fields(metadata, "action", "observation", "output")

    inner = data.get("data")
    if isinstance(inner, dict):
        inner = dict(inner)
        inner["thought"] = friendly
        _pop_fields(inner, "action", "tool_name", "observation", "output")
        data["data"] = inner

    _pop_fields(data, "action", "tool_name", "observation", "output")
    if "thought" not in data:
        data["thought"] = friendly


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
                    return {
                        **event,
                        "thought": label,
                        "tool": "",
                        "tool_input": "",
                        "observation": "",
                    }

        if not tool:
            return {**event, "thought": "", "observation": ""}

        return event
