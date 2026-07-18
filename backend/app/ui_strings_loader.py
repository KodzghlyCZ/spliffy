from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def resolve_ui_strings_dir(config_path: Path, configured_path: object) -> Path | None:
    if isinstance(configured_path, str) and configured_path.strip():
        path = Path(configured_path.strip())
    else:
        path = Path("ui_strings")

    if not path.is_absolute():
        path = config_path.resolve().parent / path

    return path if path.is_dir() else None


def _nested_string(data: object, *keys: str) -> str | None:
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    if isinstance(current, str) and current.strip():
        return current.strip()
    return None


def _load_locale_file(path: Path) -> dict[str, Any] | None:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return None
    return raw if isinstance(raw, dict) else None


def load_chat_hints_from_dir(directory: Path) -> dict[str, str]:
    chat_hint: dict[str, str] = {}
    for path in sorted(directory.glob("*.yaml")) + sorted(directory.glob("*.yml")):
        locale = path.stem.lower()
        if not locale or locale.startswith("_"):
            continue

        data = _load_locale_file(path)
        if data is None:
            continue

        hint = _nested_string(data, "chat", "hint")
        if hint:
            chat_hint[locale] = hint

    return chat_hint


def merge_chat_hints(*sources: dict[str, str]) -> dict[str, str]:
    merged: dict[str, str] = {}
    for source in sources:
        for locale, value in source.items():
            if isinstance(locale, str) and isinstance(value, str) and value.strip():
                merged[locale.lower()] = value.strip()
    return merged
