from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.audit_service import get_audit_logs

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_audit_logs(
    skip: int = 0,
    limit: int = Query(100, le=500),
    resource_type: Optional[str] = None,
    user_id: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    logs = await get_audit_logs(db, skip=skip, limit=limit,
                                resource_type=resource_type,
                                user_id=user_id, status=status)
    return [
        {
            "id": log.id, "user_id": log.user_id, "user_email": log.user_email,
            "action": log.action, "resource_type": log.resource_type,
            "resource_id": log.resource_id, "resource_name": log.resource_name,
            "detail": log.detail, "status": log.status, "ip_address": log.ip_address,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]
