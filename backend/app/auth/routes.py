from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import RedirectResponse

from app.auth.oidc import oauth
from app.settings import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_enabled() -> bool:
    return get_settings().auth.enabled


@router.get("/config")
def auth_config() -> dict[str, Any]:
    settings = get_settings()
    payload: dict[str, Any] = {"enabled": settings.auth.enabled}
    if settings.auth.enabled:
        payload["login_url"] = "/auth/login"
    return payload


@router.get("/login")
async def login(request: Request):
    if not _auth_enabled():
        raise HTTPException(status_code=404, detail="Authentication is disabled")

    oidc = get_settings().auth.oidc
    assert oidc is not None
    return await oauth.keycloak.authorize_redirect(request, oidc.redirect_uri)


@router.get("/callback")
async def callback(request: Request):
    if not _auth_enabled():
        raise HTTPException(status_code=404, detail="Authentication is disabled")

    token = await oauth.keycloak.authorize_access_token(request)
    userinfo = token.get("userinfo")
    if userinfo is None:
        userinfo = await oauth.keycloak.userinfo(token=token)

    request.session["user"] = {
        "sub": userinfo.get("sub"),
        "email": userinfo.get("email"),
        "name": userinfo.get("name") or userinfo.get("preferred_username"),
        "preferred_username": userinfo.get("preferred_username"),
    }

    return RedirectResponse(url=get_settings().auth.post_login_redirect)


@router.get("/me")
def me(request: Request) -> dict[str, Any]:
    if not _auth_enabled():
        return {"authenticated": False, "user": None}

    user = request.session.get("user")
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    return {"authenticated": True, "user": user}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


def get_current_user(request: Request) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.auth.enabled:
        return None
    return request.session.get("user")


def require_user(request: Request) -> dict[str, Any]:
    user = get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


CurrentUser = Annotated[dict[str, Any] | None, Depends(get_current_user)]
RequiredUser = Annotated[dict[str, Any], Depends(require_user)]
