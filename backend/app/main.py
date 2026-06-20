from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.auth import router as auth_router
from app.auth.oidc import configure_oauth
from app.settings import get_settings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_oauth()
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="Spliffy API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        same_site="lax",
        https_only=False,
    )

    app.include_router(auth_router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
