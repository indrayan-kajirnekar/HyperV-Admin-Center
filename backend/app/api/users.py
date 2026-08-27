from __future__ import annotations
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.audit_service import record_event
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1)
    password: str = Field(..., min_length=8)
    role: str = "read_only"


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=8)


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = ""


class PermissionAssign(BaseModel):
    resource_type: str  # folder | hypervisor
    resource_id: str
    role: str
    user_id: Optional[str] = None
    group_id: Optional[str] = None


def _user_out(u) -> dict:
    return {
        "id": u.id, "email": u.email, "full_name": u.full_name,
        "role": u.role, "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "groups": [{"id": g.id, "name": g.name} for g in (u.groups or [])],
    }


def _group_out(g) -> dict:
    return {
        "id": g.id, "name": g.name, "description": g.description,
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "member_count": len(g.members) if g.members else 0,
        "members": [{"id": m.id, "email": m.email, "full_name": m.full_name} for m in (g.members or [])],
    }


# ─── Users ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[dict])
async def list_users(
    skip: int = 0, limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    users = await user_service.list_users(db, skip=skip, limit=limit)
    return [_user_out(u) for u in users]


@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    existing = await user_service.get_user_by_email(db, body.email)
    if existing:
        raise HTTPException(409, "Email already registered")
    user = await user_service.create_user(db, body.email, body.full_name, body.password, body.role)
    await record_event(db, "user.create", "user", user.id, user.email,
                       current_user.id, current_user.email, status="success",
                       ip_address=request.client.host if request.client else None)
    return _user_out(user)


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    user = await user_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return _user_out(user)


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "cluster_admin") and current_user.id != user_id:
        raise HTTPException(403, "Insufficient permissions")
    user = await user_service.update_user(
        db, user_id,
        full_name=body.full_name, role=body.role,
        is_active=body.is_active, password=body.password,
    )
    if not user:
        raise HTTPException(404, "User not found")
    await record_event(db, "user.update", "user", user_id, user.email,
                       current_user.id, current_user.email, status="success",
                       ip_address=request.client.host if request.client else None)
    return _user_out(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role != "super_admin":
        raise HTTPException(403, "Only super_admin can delete users")
    ok = await user_service.delete_user(db, user_id)
    if not ok:
        raise HTTPException(404, "User not found")
    await record_event(db, "user.delete", "user", user_id, None,
                       current_user.id, current_user.email, status="success",
                       ip_address=request.client.host if request.client else None)


# ─── Groups ───────────────────────────────────────────────────────────────────

@router.get("/groups/all", response_model=List[dict])
async def list_groups(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    groups = await user_service.list_groups(db)
    return [_group_out(g) for g in groups]


@router.post("/groups", status_code=201)
async def create_group(
    body: GroupCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    group = await user_service.create_group(db, body.name, body.description or "")
    return _group_out(group)


@router.post("/{user_id}/groups/{group_id}", status_code=200)
async def add_to_group(
    user_id: str, group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    ok = await user_service.add_user_to_group(db, user_id, group_id)
    if not ok:
        raise HTTPException(404, "User or group not found")
    return {"added": True}


# ─── Permissions ──────────────────────────────────────────────────────────────

@router.post("/permissions", status_code=201)
async def assign_permission(
    body: PermissionAssign,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    perm = await user_service.assign_permission(
        db, body.resource_type, body.resource_id, body.role,
        user_id=body.user_id, group_id=body.group_id,
    )
    return {"id": perm.id, "role": perm.role, "resource_type": perm.resource_type}
