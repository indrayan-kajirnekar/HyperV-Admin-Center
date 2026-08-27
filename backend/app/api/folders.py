from __future__ import annotations
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.folder import Folder, Hypervisor
from app.services.audit_service import record_event
from app.services.quota_service import compute_folder_usage

router = APIRouter(prefix="/folders", tags=["folders"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    parent_id: Optional[str] = None
    description: Optional[str] = None
    quota_storage_gb: Optional[float] = None
    quota_memory_gb: Optional[float] = None
    quota_cpu_pct: Optional[float] = None
    quota_max_vms: Optional[int] = None
    soft_quota_storage_gb: Optional[float] = None
    soft_quota_memory_gb: Optional[float] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    quota_storage_gb: Optional[float] = None
    quota_memory_gb: Optional[float] = None
    quota_cpu_pct: Optional[float] = None
    quota_max_vms: Optional[int] = None
    soft_quota_storage_gb: Optional[float] = None
    soft_quota_memory_gb: Optional[float] = None


class HypervisorCreate(BaseModel):
    hostname: str
    display_name: Optional[str] = None
    folder_id: Optional[str] = None


class HypervisorUpdate(BaseModel):
    display_name: Optional[str] = None
    folder_id: Optional[str] = None
    is_online: Optional[bool] = None


# ─── Folder CRUD ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[dict])
async def list_folders(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(Folder))
    folders = result.scalars().all()
    return [_folder_dict(f) for f in folders]


@router.post("", status_code=201)
async def create_folder(
    body: FolderCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    folder = Folder(**body.model_dump())
    db.add(folder)
    await db.flush()
    await record_event(db, "folder.create", "folder", folder.id, folder.name,
                       current_user.id, current_user.email, status="success",
                       ip_address=request.client.host if request.client else None)
    return _folder_dict(folder)


@router.get("/{folder_id}")
async def get_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    folder = await _get_or_404(db, folder_id)
    usage = await compute_folder_usage(folder_id)
    d = _folder_dict(folder)
    d["usage"] = {
        "storage_gb": round(usage.used_storage_gb, 2),
        "memory_gb": round(usage.used_memory_gb, 2),
        "cpu_pct": round(usage.used_cpu_pct, 2),
        "vm_count": usage.vm_count,
    }
    return d


@router.patch("/{folder_id}")
async def update_folder(
    folder_id: str,
    body: FolderUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    folder = await _get_or_404(db, folder_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(folder, k, v)
    await db.flush()
    await record_event(db, "folder.update", "folder", folder_id, folder.name,
                       current_user.id, current_user.email, status="success",
                       ip_address=request.client.host if request.client else None)
    return _folder_dict(folder)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    folder = await _get_or_404(db, folder_id)
    await db.delete(folder)
    await record_event(db, "folder.delete", "folder", folder_id, folder.name,
                       current_user.id, current_user.email, status="success",
                       ip_address=request.client.host if request.client else None)


# ─── Hypervisors ──────────────────────────────────────────────────────────────

@router.get("/hypervisors/all", response_model=List[dict])
async def list_hypervisors(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(Hypervisor))
    return [_hyp_dict(h) for h in result.scalars().all()]


@router.post("/hypervisors", status_code=201)
async def create_hypervisor(
    body: HypervisorCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    h = Hypervisor(**body.model_dump())
    db.add(h)
    await db.flush()
    await record_event(db, "hypervisor.register", "hypervisor", h.id, h.hostname,
                       current_user.id, current_user.email, status="success",
                       ip_address=request.client.host if request.client else None)
    return _hyp_dict(h)


@router.patch("/hypervisors/{hypervisor_id}")
async def update_hypervisor(
    hypervisor_id: str,
    body: HypervisorUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(Hypervisor).where(Hypervisor.id == hypervisor_id))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Hypervisor not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(h, k, v)
    await db.flush()
    return _hyp_dict(h)


@router.delete("/hypervisors/{hypervisor_id}", status_code=204)
async def delete_hypervisor(
    hypervisor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(Hypervisor).where(Hypervisor.id == hypervisor_id))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Hypervisor not found")
    await db.delete(h)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_or_404(db: AsyncSession, folder_id: str) -> Folder:
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def _folder_dict(f: Folder) -> dict:
    return {
        "id": f.id, "name": f.name, "parent_id": f.parent_id,
        "description": f.description,
        "quota_storage_gb": f.quota_storage_gb, "quota_memory_gb": f.quota_memory_gb,
        "quota_cpu_pct": f.quota_cpu_pct, "quota_max_vms": f.quota_max_vms,
        "soft_quota_storage_gb": f.soft_quota_storage_gb,
        "soft_quota_memory_gb": f.soft_quota_memory_gb,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


def _hyp_dict(h: Hypervisor) -> dict:
    return {
        "id": h.id, "hostname": h.hostname, "display_name": h.display_name,
        "folder_id": h.folder_id, "is_online": h.is_online,
        "total_cpu_cores": h.total_cpu_cores, "total_memory_gb": h.total_memory_gb,
        "total_storage_gb": h.total_storage_gb,
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "last_seen_at": h.last_seen_at.isoformat() if h.last_seen_at else None,
    }
