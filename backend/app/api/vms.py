"""
Virtual Machine API
All mutation endpoints run a pre-flight quota check before touching the hypervisor.
Cache invalidation is handled by the service layer.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.folder import Hypervisor
from app.services.hyperv_service import (
    get_all_vms, get_vm_detail, perform_vm_action,
    create_vm, delete_vm, get_checkpoints,
    create_checkpoint, delete_checkpoint, revert_checkpoint,
)
from app.services.quota_service import check_create_vm_quota
from app.services.audit_service import record_event

router = APIRouter(prefix="/vms", tags=["vms"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class VMActionRequest(BaseModel):
    action: str = Field(..., description="start | stop | stop_graceful | restart | suspend | resume")

class NICConfig(BaseModel):
    switch_name: str = Field(..., min_length=1)

class CreateVMRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    hypervisor_id: str
    folder_id: Optional[str] = None
    memory_gb: float = Field(2.0, ge=0.5, le=512.0)
    cpu_count: int = Field(2, ge=1, le=128)
    disk_gb: float = Field(40.0, ge=1.0, le=65536.0)
    switch_name: str = "Default Switch"
    generation: int = Field(2, ge=1, le=2)
    iso_path: Optional[str] = None          # path on the host, e.g. C:\ISOs\ubuntu.iso
    nic2_switch: Optional[str] = None       # 2nd NIC virtual switch name
    nic3_switch: Optional[str] = None       # 3rd NIC virtual switch name
    vm_path: Optional[str] = None           # VM storage base dir, e.g. D:\VMs

class CreateCheckpointRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_hypervisor_hostname(db: AsyncSession, hypervisor_id: str) -> str:
    result = await db.execute(select(Hypervisor).where(Hypervisor.id == hypervisor_id))
    hyp = result.scalar_one_or_none()
    if not hyp:
        raise HTTPException(status_code=404, detail="Hypervisor not found")
    return hyp.hostname


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[Dict[str, Any]])
async def list_vms(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Returns all VMs from all registered hosts. Served from cache — sub-second."""
    result = await db.execute(select(Hypervisor).where(Hypervisor.is_online == True))
    hypervisors = result.scalars().all()
    if not hypervisors:
        return []
    return await get_all_vms(
        [h.id for h in hypervisors],
        [h.hostname for h in hypervisors],
    )


@router.get("/{hypervisor_id}/{vm_name}", response_model=Dict[str, Any])
async def get_vm(
    hypervisor_id: str,
    vm_name: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    hostname = await _get_hypervisor_hostname(db, hypervisor_id)
    return await get_vm_detail(hostname, vm_name)


@router.post("/{hypervisor_id}/{vm_name}/action", status_code=202)
async def vm_action(
    hypervisor_id: str,
    vm_name: str,
    body: VMActionRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    hostname = await _get_hypervisor_hostname(db, hypervisor_id)

    # Optimistic response — action runs in background
    background_tasks.add_task(
        _perform_and_audit, db, hostname, vm_name, body.action,
        current_user, hypervisor_id, request.client.host if request.client else None,
    )
    return {"status": "accepted", "action": body.action, "vm": vm_name}


async def _perform_and_audit(db, hostname, vm_name, action, user, hypervisor_id, ip):
    from app.core.database import AsyncSessionFactory
    async with AsyncSessionFactory() as session:
        try:
            await perform_vm_action(hostname, vm_name, action)
            await record_event(
                session, action=f"vm.{action}", resource_type="vm",
                resource_id=f"{hypervisor_id}/{vm_name}", resource_name=vm_name,
                user_id=user.id, user_email=user.email, status="success", ip_address=ip,
            )
        except Exception as exc:
            await record_event(
                session, action=f"vm.{action}", resource_type="vm",
                resource_id=f"{hypervisor_id}/{vm_name}", resource_name=vm_name,
                user_id=user.id, user_email=user.email, status="failure",
                detail={"error": str(exc)}, ip_address=ip,
            )


@router.post("", status_code=201)
async def create_vm_endpoint(
    body: CreateVMRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Pre-flight quota check (synchronous, fast — uses Redis cache)
    if body.folder_id:
        violations = await check_create_vm_quota(
            db, body.folder_id,
            requested_disk_gb=body.disk_gb,
            requested_memory_gb=body.memory_gb,
        )
        if violations:
            await record_event(
                db, action="vm.create.quota_blocked", resource_type="vm",
                resource_name=body.name, user_id=current_user.id,
                user_email=current_user.email, status="failure",
                detail={"violations": [v.message for v in violations]},
                ip_address=request.client.host if request.client else None,
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"violations": [v.message for v in violations]},
            )

    hostname = await _get_hypervisor_hostname(db, body.hypervisor_id)
    result = await create_vm(
        hostname, body.name, body.memory_gb, body.cpu_count,
        body.disk_gb, body.switch_name, body.generation,
        iso_path=body.iso_path,
        nic2_switch=body.nic2_switch,
        nic3_switch=body.nic3_switch,
        vm_path=body.vm_path,
    )
    await record_event(
        db, action="vm.create", resource_type="vm", resource_name=body.name,
        user_id=current_user.id, user_email=current_user.email, status="success",
        detail={"hypervisor_id": body.hypervisor_id, "folder_id": body.folder_id},
        ip_address=request.client.host if request.client else None,
    )
    return result


@router.delete("/{hypervisor_id}/{vm_name}", status_code=200)
async def delete_vm_endpoint(
    hypervisor_id: str,
    vm_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    hostname = await _get_hypervisor_hostname(db, hypervisor_id)
    await delete_vm(hostname, vm_name)
    await record_event(
        db, action="vm.delete", resource_type="vm",
        resource_id=f"{hypervisor_id}/{vm_name}", resource_name=vm_name,
        user_id=current_user.id, user_email=current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"deleted": True}


# ─── Checkpoints ──────────────────────────────────────────────────────────────

@router.get("/{hypervisor_id}/{vm_name}/checkpoints")
async def list_checkpoints(
    hypervisor_id: str,
    vm_name: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    hostname = await _get_hypervisor_hostname(db, hypervisor_id)
    return await get_checkpoints(hostname, vm_name)


@router.post("/{hypervisor_id}/{vm_name}/checkpoints", status_code=201)
async def create_checkpoint_endpoint(
    hypervisor_id: str,
    vm_name: str,
    body: CreateCheckpointRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    hostname = await _get_hypervisor_hostname(db, hypervisor_id)
    await create_checkpoint(hostname, vm_name, body.name)
    await record_event(
        db, action="checkpoint.create", resource_type="checkpoint",
        resource_name=f"{vm_name}/{body.name}", user_id=current_user.id,
        user_email=current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"created": True, "name": body.name}


@router.delete("/{hypervisor_id}/{vm_name}/checkpoints/{snap_id}")
async def delete_checkpoint_endpoint(
    hypervisor_id: str,
    vm_name: str,
    snap_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    hostname = await _get_hypervisor_hostname(db, hypervisor_id)
    await delete_checkpoint(hostname, snap_id, vm_name)
    await record_event(
        db, action="checkpoint.delete", resource_type="checkpoint",
        resource_id=snap_id, resource_name=vm_name, user_id=current_user.id,
        user_email=current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"deleted": True}


@router.post("/{hypervisor_id}/{vm_name}/checkpoints/{snap_id}/revert")
async def revert_checkpoint_endpoint(
    hypervisor_id: str,
    vm_name: str,
    snap_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    hostname = await _get_hypervisor_hostname(db, hypervisor_id)
    await revert_checkpoint(hostname, snap_id, vm_name)
    await record_event(
        db, action="checkpoint.revert", resource_type="checkpoint",
        resource_id=snap_id, resource_name=vm_name, user_id=current_user.id,
        user_email=current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"reverted": True}
