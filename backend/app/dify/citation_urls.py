"""Normalize citation URLs so chips and in-text links actually resolve."""

from __future__ import annotations

import re
from urllib.parse import urlparse

_ZPL_PATH = re.compile(r"^/cs/(\d{4})-(\d{1,5})(?:/(.*))?$", re.I)
_ZPL_ZNENI = re.compile(r"^zneni-\d{8}$", re.I)
_ZPL_FRAGMENT = re.compile(r"^f\d+$", re.I)
_PLACEHOLDER = re.compile(r"###|\{[a-z0-9_]+\}|%s|%d|\bn/n\b", re.I)


def sanitize_citation_url(url: str | None) -> str | None:
    """Return a clickable URL, or None if it cannot be made valid.

    Zakonyprolidi junk like ``/cs/2004-561/n/n###`` or ``/cs/2005-48/n-`` is
    rewritten to the law page ``/cs/YEAR-NUMBER``, keeping only real ``#f…``
    paragraph fragments.
    """
    if not isinstance(url, str):
        return None
    value = url.strip().rstrip(".,);]")
    if not value:
        return None

    try:
        parsed = urlparse(value)
    except ValueError:
        return None

    if parsed.scheme not in {"http", "https"}:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if not host:
        return None

    if host == "zakonyprolidi.cz":
        return _sanitize_zpl(parsed)

    if _PLACEHOLDER.search(value):
        return None
    return value


def _sanitize_zpl(parsed) -> str | None:
    match = _ZPL_PATH.match(parsed.path or "")
    if not match:
        return None

    year, number, rest = match.group(1), match.group(2), match.group(3) or ""
    first_segment = rest.split("/", 1)[0]
    extra = f"/{first_segment}" if _ZPL_ZNENI.match(first_segment) else ""

    fragment = (parsed.fragment or "").lstrip("#")
    suffix = f"#{fragment}" if _ZPL_FRAGMENT.match(fragment) else ""
    return f"https://www.zakonyprolidi.cz/cs/{year}-{number}{extra}{suffix}"
