"""
Audit Service
Writes permanent audit records to the database and broadcasts real-time events.
Non-blocking: database writes are fire-and-forget via background tasks.
"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import broadcast
from app.models.audit import AuditLog

log = structlog.get_logger()


async def record_event(
    db: AsyncSession,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    resource_name: Optional[str] = None,
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    detail: Optional[Dict[str, Any]] = None,
    status: str = "success",
    ip_address: Optional[str] = None,
) -> AuditLog:
    entry = AuditLog(
        user_id=user_id,
        user_email=user_email,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_name=resource_name,
        detail=json.dumps(detail) if detail else None,
        status=status,
        ip_address=ip_address,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    await db.flush()

    # Real-time broadcast (non-blocking)
    event_payload = {
        "type": "audit",
        "id": entry.id,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "resource_name": resource_name,
        "user_email": user_email,
        "status": status,
        "detail": detail,
        "ts": entry.created_at.isoformat(),
    }
    await broadcast(event_payload)
    log.info("audit.recorded", action=action, resource=resource_type, id=resource_id)
    return entry


async def get_audit_logs(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    resource_type: Optional[str] = None,
    user_id: Optional[str] = None,
    status: Optional[str] = None,
):
    from sqlalchemy import select, desc
    q = select(AuditLog).order_by(desc(AuditLog.created_at)).offset(skip).limit(limit)
    if resource_type:
        q = q.where(AuditLog.resource_type == resource_type)
    if user_id:
        q = q.where(AuditLog.user_id == user_id)
    if status:
        q = q.where(AuditLog.status == status)
    result = await db.execute(q)
    return result.scalars().all()
