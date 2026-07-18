from dataclasses import dataclass
import os
from pathlib import Path

from yayaya import get, init

from app.ui_strings_loader import load_chat_hints_from_dir, merge_chat_hints, resolve_ui_strings_dir

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"


def _as_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off", ""}:
            return False
    return bool(value)


@dataclass(frozen=True)
class OidcSettings:
    issuer_url: str
    client_id: str
    client_secret: str
    redirect_uri: str
    scopes: tuple[str, ...]


@dataclass(frozen=True)
class AuthSettings:
    enabled: bool
    post_login_redirect: str
    oidc: OidcSettings | None


@dataclass(frozen=True)
class DifySettings:
    enabled: bool
    base_url: str
    api_key: str
    name: str
    name_forms: dict[str, dict[str, str]]
    markdown: bool
    show_sources: bool

    def name_for(self, locale: str, form: str = "default") -> str:
        locale = resolve_locale(locale)
        for key in (locale, "en", "cs"):
            locale_forms = self.name_forms.get(key, {})
            value = locale_forms.get(form) or locale_forms.get("default")
            if isinstance(value, str) and value.strip():
                return value.strip()
        return self.name


@dataclass(frozen=True)
class RagflowSettings:
    enabled: bool
    api_url: str
    api_key: str
    default_dataset_id: str
    dataset_name: str


@dataclass(frozen=True)
class UiStringSettings:
    default_locale: str
    chat_hint: dict[str, str]

    def hint_for(self, locale: str) -> str | None:
        locale = resolve_locale(locale, default=self.default_locale)
        for key in (locale, self.default_locale, "en", "cs"):
            value = self.chat_hint.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None


@dataclass(frozen=True)
class ToolLabelSettings:
    enabled: bool
    default_locale: str
    tools: dict[str, dict[str, str]]
    default_templates: dict[str, str]

    def templates_for(self, locale: str) -> dict[str, str]:
        locale = (locale or self.default_locale).lower()
        fallback = self.default_locale
        result: dict[str, str] = {}
        for tool_name, locales in self.tools.items():
            if not isinstance(locales, dict):
                continue
            template = locales.get(locale) or locales.get(fallback) or locales.get("en") or locales.get("cs")
            if isinstance(template, str) and template.strip():
                result[tool_name] = template.strip()
        return result

    def default_for(self, locale: str) -> str:
        locale = (locale or self.default_locale).lower()
        return (
            self.default_templates.get(locale)
            or self.default_templates.get(self.default_locale)
            or self.default_templates.get("en")
            or "{{tool}}"
        )


@dataclass(frozen=True)
class Settings:
    cors_origins: tuple[str, ...]
    session_secret: str
    auth: AuthSettings
    dify: DifySettings
    ragflow: RagflowSettings | None
    tool_labels: ToolLabelSettings | None
    ui_strings: UiStringSettings | None


def _config_path() -> Path:
    return Path(os.environ.get("SPLIFFY_CONFIG", DEFAULT_CONFIG_PATH))


def _load_config() -> None:
    path = _config_path()
    if path.is_file():
        init(str(path))
    else:
        init([])


def _read_name_forms(base_name: str) -> dict[str, dict[str, str]]:
    raw = get("dify.name_forms", default={}) or {}
    forms: dict[str, dict[str, str]] = {}
    if isinstance(raw, dict):
        for locale, locale_forms in raw.items():
            if not isinstance(locale, str) or not isinstance(locale_forms, dict):
                continue
            cleaned: dict[str, str] = {}
            for form_key, value in locale_forms.items():
                if isinstance(form_key, str) and isinstance(value, str) and value.strip():
                    cleaned[form_key.lower()] = value.strip()
            if cleaned:
                forms[locale.lower()] = cleaned
    return forms


def _read_inline_chat_hints() -> dict[str, str]:
    raw_hint = get("ui_strings.chat.hint", default={}) or {}
    chat_hint: dict[str, str] = {}
    if isinstance(raw_hint, dict):
        for locale, value in raw_hint.items():
            if isinstance(locale, str) and isinstance(value, str) and value.strip():
                chat_hint[locale.lower()] = value.strip()
    return chat_hint


def _read_ui_strings() -> UiStringSettings | None:
    default_locale = str(get("ui_strings.default_locale", default="cs")).lower() or "cs"

    file_hints: dict[str, str] = {}
    ui_strings_dir = resolve_ui_strings_dir(_config_path(), get("ui_strings.path", default=""))
    if ui_strings_dir is not None:
        file_hints = load_chat_hints_from_dir(ui_strings_dir)

    chat_hint = merge_chat_hints(file_hints, _read_inline_chat_hints())
    if not chat_hint:
        return None

    return UiStringSettings(
        default_locale=default_locale,
        chat_hint=chat_hint,
    )


def _read_tool_labels() -> ToolLabelSettings | None:
    enabled = _as_bool(get("tool_labels.enabled", default=False))
    if not enabled:
        return None

    raw_tools = get("tool_labels.tools", default={}) or {}
    tools: dict[str, dict[str, str]] = {}
    if isinstance(raw_tools, dict):
        for name, locales in raw_tools.items():
            if not isinstance(name, str) or not isinstance(locales, dict):
                continue
            cleaned: dict[str, str] = {}
            for locale, template in locales.items():
                if isinstance(locale, str) and isinstance(template, str) and template.strip():
                    cleaned[locale.lower()] = template.strip()
            if cleaned:
                tools[name] = cleaned

    default_templates = {
        "cs": str(get("tool_labels.default.cs", default="Používám {{tool}}")),
        "en": str(get("tool_labels.default.en", default="Using {{tool}}")),
    }

    return ToolLabelSettings(
        enabled=True,
        default_locale=str(get("tool_labels.default_locale", default="cs")).lower() or "cs",
        tools=tools,
        default_templates=default_templates,
    )


def _read_settings() -> Settings:
    cors_origins = get("server.cors_origins", default=["http://localhost:5173"])
    session_secret = get("server.session_secret", default="change-me-in-production")

    auth_enabled = _as_bool(get("auth.enabled", default=False))
    post_login_redirect = get(
        "auth.post_login_redirect",
        default="http://localhost:5173",
    )

    oidc: OidcSettings | None = None
    if auth_enabled:
        oidc = OidcSettings(
            issuer_url=get("auth.oidc.issuer_url", required=True),
            client_id=get("auth.oidc.client_id", required=True),
            client_secret=get("auth.oidc.client_secret", required=True),
            redirect_uri=get("auth.oidc.redirect_uri", required=True),
            scopes=tuple(get("auth.oidc.scopes", default=["openid", "profile", "email"])),
        )

    dify_enabled = _as_bool(get("dify.enabled", default=False))
    dify_base_url = str(get("dify.base_url", default="http://127.0.0.1/v1")).rstrip("/")
    dify_api_key = str(get("dify.api_key", default=""))
    dify_name = str(get("dify.name", default="Spliffy"))
    dify_markdown = _as_bool(get("dify.markdown", default=False))
    dify_show_sources = _as_bool(get("dify.show_sources", default=True))
    if _as_bool(os.environ.get("SPLIFFY_MARKDOWN")):
        dify_markdown = True

    ragflow: RagflowSettings | None = None
    ragflow_enabled = _as_bool(get("ragflow.enabled", default=False))
    if ragflow_enabled:
        ragflow = RagflowSettings(
            enabled=True,
            api_url=str(get("ragflow.api_url", default="")).rstrip("/"),
            api_key=str(get("ragflow.api_key", default="")),
            default_dataset_id=str(get("ragflow.default_dataset_id", default="")),
            dataset_name=str(get("ragflow.dataset_name", default="RAGFlow")),
        )

    return Settings(
        cors_origins=tuple(cors_origins),
        session_secret=session_secret,
        auth=AuthSettings(
            enabled=auth_enabled,
            post_login_redirect=post_login_redirect,
            oidc=oidc,
        ),
        dify=DifySettings(
            enabled=dify_enabled,
            base_url=dify_base_url,
            api_key=dify_api_key,
            name=dify_name,
            name_forms=_read_name_forms(dify_name),
            markdown=dify_markdown,
            show_sources=dify_show_sources,
        ),
        ragflow=ragflow,
        tool_labels=_read_tool_labels(),
        ui_strings=_read_ui_strings(),
    )


def get_settings() -> Settings:
    _load_config()
    return _read_settings()


def resolve_locale(value: object, *, default: str = "cs") -> str:
    if isinstance(value, str) and value.strip():
        normalized = value.strip().lower().replace("_", "-")
        if normalized.startswith("cs"):
            return "cs"
        if normalized.startswith("en"):
            return "en"
    return default if default in {"cs", "en"} else "cs"
