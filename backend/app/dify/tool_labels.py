"""Map agent tool names to user-friendly localized action labels."""

from __future__ import annotations

import json
import re
from typing import Any

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")

# Preferred argument keys per placeholder / tool (first match wins).
_ARG_ALIASES: dict[str, tuple[str, ...]] = {
    "query": ("query", "question", "q", "search", "keyword", "keywords"),
    "passage": (
        "passage",
        "reference",
        "paragraph",
        "text",
        "excerpt",
        "law",
        "article",
        "section",
        "content",
    ),
    "question": ("question", "query", "q"),
    "reference": ("reference", "law", "act"),
    "paragraph": ("paragraph", "passage", "section", "article"),
}


def normalize_tool_name(name: str) -> str:
    text = (name or "").strip()
    if not text:
        return ""
    # Plugin tools sometimes arrive as "provider_toolname" or "toolname".
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    if text.endswith("get_law_excerpt"):
        return "get_law_excerpt"
    if text.endswith("retrieval") and text != "retrieval":
        return "retrieval"
    if "_" in text and text.count("_") >= 2:
        # e.g. witmeng_ragflow_api_retrieval → retrieval
        parts = text.split("_")
        if parts[-1]:
            return parts[-1]
    return text


def _first_string_arg(args: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return ""


def _fallback_string_arg(args: dict[str, Any]) -> str:
    for key, value in args.items():
        if key in {"datasets_ids", "dataset_id", "document_ids", "document_id"}:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def extract_tool_args(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"query": text}
        return parsed if isinstance(parsed, dict) else {"query": text}
    return {}


def format_tool_label(
    tool_name: str,
    args: dict[str, Any] | None,
    *,
    templates: dict[str, str],
    default_template: str = "{{tool}}",
) -> str:
    normalized = normalize_tool_name(tool_name)
    template = templates.get(normalized) or templates.get(tool_name) or default_template
    args = dict(args or {})

    # If reference already includes a §, don't also fill {{paragraph}} from a separate arg.
    reference = _first_string_arg(args, ("reference",))
    paragraph = _first_string_arg(args, ("paragraph",))
    if reference and "§" in reference and paragraph:
        args["paragraph"] = ""

    def replacer(match: re.Match[str]) -> str:
        key = match.group(1)
        if key == "tool":
            return normalized or tool_name
        aliases = _ARG_ALIASES.get(key, (key,))
        value = _first_string_arg(args, aliases)
        if not value and key in {"query", "passage", "question"}:
            value = _fallback_string_arg(args)
        # Optional display fields stay empty so templates can combine cleanly in config.
        if not value and key in {"reference", "paragraph", "passage"}:
            return ""
        return value or "…"

    label = _PLACEHOLDER_RE.sub(replacer, template).strip()
    # Clean combined templates like "…: {{reference}} § {{paragraph}}"
    label = re.sub(r"\s*§\s*$", "", label)
    label = re.sub(r"\s*§\s*§+", " §", label)
    label = re.sub(r":\s*$", "", label)
    label = re.sub(r"\s{2,}", " ", label).strip()
    if label.endswith(": …") or label.endswith(":…"):
        label = label.rsplit(":", 1)[0].strip()
    return label or normalized or tool_name


def labels_for_tool_calls(
    tool_calls: list[tuple[str, dict[str, Any]]],
    *,
    templates: dict[str, str],
    default_template: str = "{{tool}}",
) -> str:
    """One friendly label per call, joined with newlines."""
    lines: list[str] = []
    for tool_name, args in tool_calls:
        if not tool_name:
            continue
        lines.append(
            format_tool_label(
                tool_name,
                args,
                templates=templates,
                default_template=default_template,
            )
        )
    return "\n".join(lines)


def parse_agent_thought_tools(tool: Any, tool_input: Any) -> list[tuple[str, dict[str, Any]]]:
    """Expand agent_thought tool / tool_input into discrete (name, args) pairs."""
    args = extract_tool_args(tool_input)

    if isinstance(tool, list):
        calls: list[tuple[str, dict[str, Any]]] = []
        for item in tool:
            if isinstance(item, str) and item.strip():
                calls.append((item.strip(), args))
            elif isinstance(item, dict):
                name = str(item.get("name") or item.get("tool") or "").strip()
                item_args = item.get("arguments") or item.get("input") or args
                if not isinstance(item_args, dict):
                    item_args = extract_tool_args(item_args)
                if name:
                    calls.append((name, item_args))
        return calls

    if isinstance(tool, dict):
        # Dify sometimes sends {tool_name: args_json_or_dict, ...}
        calls = []
        for name, value in tool.items():
            if not isinstance(name, str) or not name.strip():
                continue
            if isinstance(value, dict):
                calls.append((name.strip(), value))
            else:
                calls.append((name.strip(), extract_tool_args(value)))
        if calls:
            return calls

    if isinstance(tool, str) and tool.strip():
        # Comma/semicolon separated tool names
        names = re.split(r"\s*[,;]\s*", tool.strip())
        if len(names) > 1:
            return [(name, args) for name in names if name]
        return [(tool.strip(), args)]

    return []


def tool_calls_from_agent_log_data(data: Any) -> list[tuple[str, dict[str, Any]]]:
    if not isinstance(data, dict):
        return []

    candidates: list[Any] = []
    inner = data.get("data")
    if isinstance(inner, dict):
        candidates.append(inner)
        output = inner.get("output")
        if isinstance(output, dict):
            candidates.append(output)
    output = data.get("output")
    if isinstance(output, dict):
        candidates.append(output)

    # Direct fields on log payload
    for key in ("tool_name", "tool_call_name", "action"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            args = extract_tool_args(
                data.get("tool_call_input") or data.get("tool_input") or data.get("action_input")
            )
            return [(value.strip(), args)]

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        tool_responses = candidate.get("tool_responses")
        if isinstance(tool_responses, list):
            calls: list[tuple[str, dict[str, Any]]] = []
            for item in tool_responses:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("tool_call_name") or item.get("tool_name") or "").strip()
                if not name:
                    continue
                raw_args = item.get("tool_call_input") or item.get("tool_input") or {}
                calls.append((name, extract_tool_args(raw_args)))
            if calls:
                return calls
        # Single CALL tool shape: output.tool_call_name + tool_call_input
        name = candidate.get("tool_call_name") or candidate.get("tool_name") or candidate.get("action")
        if isinstance(name, str) and name.strip():
            args = extract_tool_args(
                candidate.get("tool_call_input")
                or candidate.get("tool_input")
                or candidate.get("action_input")
            )
            return [(name.strip(), args)]
    return []
