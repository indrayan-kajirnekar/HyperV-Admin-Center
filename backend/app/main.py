from __future__ import annotations
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import init_db, AsyncSessionFactory
from app.core.cache import get_redis, close_redis
from app.services.poller import start_background_poller, stop_background_poller
from app.services.user_service import get_user_by_email, create_user

from app.api import auth, vms, folders, users, audit, websocket, servers

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────
    log.info("app.starting", name=settings.APP_NAME)
    await init_db()
    await get_redis()  # warm connection pool

    # Bootstrap super-admin if database is empty
    async with AsyncSessionFactory() as db:
        existing = await get_user_by_email(db, settings.BOOTSTRAP_ADMIN_EMAIL)
        if not existing:
            await create_user(
                db, settings.BOOTSTRAP_ADMIN_EMAIL,
                settings.BOOTSTRAP_ADMIN_NAME, settings.BOOTSTRAP_ADMIN_PASSWORD,
                role="super_admin",
            )
            await db.commit()
            log.info("app.bootstrap.admin_created", email=settings.BOOTSTRAP_ADMIN_EMAIL)

    # Start background VM poller
    await start_background_poller(AsyncSessionFactory)

    log.info("app.ready")
    yield

    # ── Shutdown ─────────────────────────────────────────────
    await stop_background_poller()
    await close_redis()
    log.info("app.shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )

    # ── Middleware ────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # ── Routers ───────────────────────────────────────────────
    prefix = "/api/v1"
    app.include_router(auth.router, prefix=prefix)
    app.include_router(vms.router, prefix=prefix)
    app.include_router(folders.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(audit.router, prefix=prefix)
    app.include_router(websocket.router, prefix=prefix)
    app.include_router(servers.router, prefix=prefix)

    @app.get("/health", tags=["health"])
    async def health():
        return {"status": "ok", "app": settings.APP_NAME}

    return app


app = create_app()
