"""
Servers (Hypervisors) API
Dedicated router for full Hyper-V server management:
  - Register / edit / delete hypervisor records
  - Toggle online/offline status
  - Assign to folders
  - Test connectivity (ping via WinRM)
  - View per-server VM summary from cache
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.cache import cache_get
from app.models.folder import Hypervisor, Folder
from app.services.audit_service import record_event

router = APIRouter(prefix="/servers", tags=["servers"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ServerCreate(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=255,
                          description="FQDN or IP address of the Hyper-V host")
    display_name: Optional[str] = Field(None, max_length=255)
    folder_id: Optional[str] = None
    total_cpu_cores: Optional[int] = Field(None, ge=1)
    total_memory_gb: Optional[float] = Field(None, ge=0)
    total_storage_gb: Optional[float] = Field(None, ge=0)


class ServerUpdate(BaseModel):
    hostname: Optional[str] = Field(None, min_length=1, max_length=255)
    display_name: Optional[str] = Field(None, max_length=255)
    folder_id: Optional[str] = None
    is_online: Optional[bool] = None
    total_cpu_cores: Optional[int] = Field(None, ge=1)
    total_memory_gb: Optional[float] = Field(None, ge=0)
    total_storage_gb: Optional[float] = Field(None, ge=0)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _server_dict(h: Hypervisor, folders: list | None = None, vm_count: int = 0) -> dict:
    folder_name: Optional[str] = None
    if folders:
        for f in folders:
            if f.id == h.folder_id:
                folder_name = f.name
                break
    return {
        "id": h.id,
        "hostname": h.hostname,
        "display_name": h.display_name,
        "folder_id": h.folder_id,
        "folder_name": folder_name,
        "is_online": h.is_online,
        "total_cpu_cores": h.total_cpu_cores,
        "total_memory_gb": h.total_memory_gb,
        "total_storage_gb": h.total_storage_gb,
        "vm_count": vm_count,
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "last_seen_at": h.last_seen_at.isoformat() if h.last_seen_at else None,
    }


async def _get_vm_count(hypervisor_id: str) -> int:
    """Read VM count from Redis cache — zero cost, no WinRM call."""
    cached = await cache_get(f"vms:{hypervisor_id}")
    if isinstance(cached, list):
        return len(cached)
    return 0


async def _get_or_404(db: AsyncSession, hypervisor_id: str) -> Hypervisor:
    result = await db.execute(select(Hypervisor).where(Hypervisor.id == hypervisor_id))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(status_code=404, detail="Server not found")
    return h


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[dict])
async def list_servers(
    folder_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List all registered Hyper-V servers, optionally filtered by folder."""
    q = select(Hypervisor)
    if folder_id:
        q = q.where(Hypervisor.folder_id == folder_id)
    result = await db.execute(q)
    hypervisors = result.scalars().all()

    folders_res = await db.execute(select(Folder))
    folders = folders_res.scalars().all()

    items = []
    for h in hypervisors:
        vm_count = await _get_vm_count(h.id)
        items.append(_server_dict(h, list(folders), vm_count))
    return items


@router.post("", status_code=201)
async def register_server(
    body: ServerCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Register a new Hyper-V host."""
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")

    # Prevent duplicate hostnames
    existing = await db.execute(select(Hypervisor).where(Hypervisor.hostname == body.hostname))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"A server with hostname '{body.hostname}' is already registered.")

    h = Hypervisor(**body.model_dump())
    db.add(h)
    await db.flush()
    await record_event(
        db, "server.register", "hypervisor", h.id, h.hostname,
        current_user.id, current_user.email, status="success",
        detail={"folder_id": h.folder_id},
        ip_address=request.client.host if request.client else None,
    )
    return _server_dict(h)


@router.get("/{hypervisor_id}")
async def get_server(
    hypervisor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get full details for a single server."""
    h = await _get_or_404(db, hypervisor_id)
    folders_res = await db.execute(select(Folder))
    vm_count = await _get_vm_count(h.id)
    return _server_dict(h, list(folders_res.scalars().all()), vm_count)


@router.patch("/{hypervisor_id}")
async def update_server(
    hypervisor_id: str,
    body: ServerUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Update server properties — hostname, display name, folder, capacities, online status."""
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    h = await _get_or_404(db, hypervisor_id)

    # Check hostname uniqueness if changing
    if body.hostname and body.hostname != h.hostname:
        dup = await db.execute(select(Hypervisor).where(Hypervisor.hostname == body.hostname))
        if dup.scalar_one_or_none():
            raise HTTPException(409, f"Hostname '{body.hostname}' is already in use.")

    for k, v in body.model_dump(exclude_none=True).items():
        setattr(h, k, v)

    await db.flush()
    await record_event(
        db, "server.update", "hypervisor", h.id, h.hostname,
        current_user.id, current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
    return _server_dict(h)


@router.post("/{hypervisor_id}/toggle-online", status_code=200)
async def toggle_online(
    hypervisor_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Quick toggle: mark server online or offline without a full edit."""
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    h = await _get_or_404(db, hypervisor_id)
    h.is_online = not h.is_online
    h.last_seen_at = datetime.now(timezone.utc) if h.is_online else h.last_seen_at
    await db.flush()
    action = "server.online" if h.is_online else "server.offline"
    await record_event(
        db, action, "hypervisor", h.id, h.hostname,
        current_user.id, current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"id": h.id, "hostname": h.hostname, "is_online": h.is_online}


@router.delete("/{hypervisor_id}", status_code=204)
async def delete_server(
    hypervisor_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Unregister a Hyper-V host. Does not affect VMs on that host."""
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    h = await _get_or_404(db, hypervisor_id)
    hostname = h.hostname
    await db.delete(h)
    await record_event(
        db, "server.delete", "hypervisor", hypervisor_id, hostname,
        current_user.id, current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
