from __future__ import annotations
import asyncio
from typing import Set
from fastapi import WebSocket
import structlog

log = structlog.get_logger()

# Central event broadcaster for real-time WebSocket push
_subscribers: Set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


async def broadcast(event: dict) -> None:
    dead: list = []
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers.discard(q)


async def ws_event_stream(websocket: WebSocket) -> None:
    """Pumps events from the broadcast bus into a WebSocket connection."""
    await websocket.accept()
    q = subscribe()
    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=30.0)
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                # heartbeat ping
                await websocket.send_json({"type": "ping"})
    except Exception as exc:
        log.info("ws.client.disconnected", reason=str(exc))
    finally:
        unsubscribe(q)
        try:
            await websocket.close()
        except Exception:
            pass
