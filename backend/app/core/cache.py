from __future__ import annotations
import orjson
from typing import Any, Optional
import redis.asyncio as aioredis
import structlog
from app.core.config import settings

log = structlog.get_logger()

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return _redis


async def cache_set(key: str, value: Any, ttl: int = settings.REDIS_TTL_SECONDS) -> None:
    r = await get_redis()
    try:
        await r.set(key, orjson.dumps(value).decode(), ex=ttl)
    except Exception as exc:
        log.warning("cache.set.error", key=key, error=str(exc))


async def cache_get(key: str) -> Optional[Any]:
    r = await get_redis()
    try:
        raw = await r.get(key)
        if raw is None:
            return None
        return orjson.loads(raw)
    except Exception as exc:
        log.warning("cache.get.error", key=key, error=str(exc))
        return None


async def cache_delete(key: str) -> None:
    r = await get_redis()
    try:
        await r.delete(key)
    except Exception as exc:
        log.warning("cache.delete.error", key=key, error=str(exc))


async def cache_delete_pattern(pattern: str) -> None:
    r = await get_redis()
    try:
        keys = await r.keys(pattern)
        if keys:
            await r.delete(*keys)
    except Exception as exc:
        log.warning("cache.delete_pattern.error", pattern=pattern, error=str(exc))


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
