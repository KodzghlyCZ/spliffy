from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path

from yayaya import get, init

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"


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
class Settings:
    cors_origins: tuple[str, ...]
    session_secret: str
    auth: AuthSettings


def _config_path() -> Path:
    return Path(os.environ.get("SPLIFFY_CONFIG", DEFAULT_CONFIG_PATH))


def _load_config() -> None:
    path = _config_path()
    if path.is_file():
        init(str(path))
    else:
        init([])


def _read_settings() -> Settings:
    cors_origins = get("server.cors_origins", default=["http://localhost:5173"])
    session_secret = get("server.session_secret", default="change-me-in-production")

    auth_enabled = bool(get("auth.enabled", default=False))
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

    return Settings(
        cors_origins=tuple(cors_origins),
        session_secret=session_secret,
        auth=AuthSettings(
            enabled=auth_enabled,
            post_login_redirect=post_login_redirect,
            oidc=oidc,
        ),
    )


@lru_cache
def get_settings() -> Settings:
    _load_config()
    return _read_settings()
