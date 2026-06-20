from authlib.integrations.starlette_client import OAuth

from app.settings import OidcSettings, get_settings

oauth = OAuth()


def configure_oauth() -> None:
    settings = get_settings()
    if not settings.auth.enabled or settings.auth.oidc is None:
        return

    oidc = settings.auth.oidc
    _register_provider(oidc)


def _register_provider(oidc: OidcSettings) -> None:
    issuer = oidc.issuer_url.rstrip("/")
    oauth.register(
        name="keycloak",
        server_metadata_url=f"{issuer}/.well-known/openid-configuration",
        client_id=oidc.client_id,
        client_secret=oidc.client_secret,
        client_kwargs={"scope": " ".join(oidc.scopes)},
    )
