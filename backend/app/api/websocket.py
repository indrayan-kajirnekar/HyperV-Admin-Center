from __future__ import annotations
from fastapi import APIRouter, WebSocket, Depends
from app.core.events import ws_event_stream
from app.core.security import get_current_user

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/events")
async def websocket_events(websocket: WebSocket):
    """
    Real-time event stream.
    Broadcasts: vm_list_updated, hypervisor_status, audit events.
    Sends a heartbeat ping every 30s to keep the connection alive.
    """
    await ws_event_stream(websocket)
