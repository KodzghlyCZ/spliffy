"""Build citation chips from inline [n](url) markdown and subagent tool text."""

from __future__ import annotations

import re
from typing import Any

_INLINE_CITE_RE = re.compile(r"\[(\d+)\]\((https?://[^)\s]+)\)")
_BARE_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:zakonyprolidi\.cz|edu\.gov\.cz|csicr\.cz|edu-gov-cz\.myskin\.catania-service\.cz)[^\s\]\)\"'<>]*",
    re.I,
)
_URL_FIELD_RE = re.compile(
    r"(?:url|source_url|Citation URL)\s*:\s*<?(https?://[^\s>\]]+)>?",
    re.I,
)

_SUBAGENT_TOOL_NAMES = frozenset(
    {
        "sofie_sub_laws",
        "sofie_sub_zpl",
        "sofie_sub_meta_inspekce",
        "sofie_sub_meta_rvp",
        "sofie_sub_meta_stiznosti",
        "sofie_sub_meta_csi",
        "sofie_sub_auditor",
    }
)


def _title_from_url(url: str) -> str:
    low = url.lower()
    if "zakonyprolidi.cz" in low:
        return "Zákony pro lidi"
    if "edu.gov.cz" in low or "edu-gov-cz" in low:
        return "edu.gov.cz"
    if "csicr.cz" in low:
        return "ČŠI"
    return url.split("/")[2] if "://" in url else url


def resource_from_url(url: str, *, position: int = 1, content: str = "") -> dict[str, Any]:
    title = _title_from_url(url)
    return {
        "position": position,
        "dataset_id": "",
        "dataset_name": "inline",
        "document_id": f"inline:{url}",
        "document_name": title,
        "data_source_type": "external",
        "segment_id": "",
        "retriever_from": "answer_markdown",
        "score": None,
        "title": title,
        "content": (content or "")[:500],
        "doc_metadata": {"url": url, "source_url": url},
    }


def extract_urls_from_text(text: str) -> list[str]:
    if not text:
        return []
    seen: set[str] = set()
    ordered: list[str] = []
    for match in _INLINE_CITE_RE.finditer(text):
        url = match.group(2).rstrip(".,);]")
        if url not in seen:
            seen.add(url)
            ordered.append(url)
    for match in _URL_FIELD_RE.finditer(text):
        url = match.group(1).rstrip(".,);]")
        if url not in seen:
            seen.add(url)
            ordered.append(url)
    for match in _BARE_URL_RE.finditer(text):
        url = match.group(0).rstrip(".,);]")
        if url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


def resources_from_answer_markdown(answer: str) -> list[dict[str, Any]]:
    """Prefer numbering from [n](url) so Spliffy chips match inline pills."""
    if not answer:
        return []
    by_n: dict[int, str] = {}
    for match in _INLINE_CITE_RE.finditer(answer):
        n = int(match.group(1))
        url = match.group(2).rstrip(".,);]")
        by_n.setdefault(n, url)
    if by_n:
        return [
            resource_from_url(url, position=n, content=f"[{n}]")
            for n, url in sorted(by_n.items())
        ]
    return [
        resource_from_url(url, position=i)
        for i, url in enumerate(extract_urls_from_text(answer), start=1)
    ]


def resources_from_subagent_tool_response(
    tool_name: str,
    tool_response: Any,
) -> list[dict[str, Any]]:
    if tool_name not in _SUBAGENT_TOOL_NAMES:
        return []
    if tool_response is None:
        return []
    text = tool_response if isinstance(tool_response, str) else str(tool_response)
    if text.strip().lower().startswith("tool invoke error"):
        return []
    return [
        {
            **resource_from_url(url, position=i),
            "retriever_from": f"subagent:{tool_name}",
            "document_id": f"subagent:{tool_name}:{url}",
        }
        for i, url in enumerate(extract_urls_from_text(text), start=1)
    ]
