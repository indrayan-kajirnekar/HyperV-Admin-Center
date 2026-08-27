"""
Quota Service
Pre-flight quota checks happen synchronously before any hypervisor call.
Quota usage is computed from live cached VM data to stay fast.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Optional
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache_get
from app.models.folder import Folder

log = structlog.get_logger()


@dataclass
class QuotaUsage:
    folder_id: str
    used_storage_gb: float = 0.0
    used_memory_gb: float = 0.0
    used_cpu_pct: float = 0.0
    vm_count: int = 0

    # headroom
    avail_storage_gb: Optional[float] = None
    avail_memory_gb: Optional[float] = None
    avail_cpu_pct: Optional[float] = None


@dataclass
class QuotaViolation:
    field: str
    requested: float
    available: Optional[float]
    message: str


async def compute_folder_usage(folder_id: str) -> QuotaUsage:
    """Compute current resource consumption from cached VM data."""
    usage = QuotaUsage(folder_id=folder_id)
    # Cache key pattern: vms:<hypervisor_id>
    # We iterate all cached VM lists (coarse scan – acceptable for typical cluster sizes)
    import redis.asyncio as aioredis
    from app.core.cache import get_redis
    r = await get_redis()
    keys = await r.keys("vms:*")
    for key in keys:
        import orjson
        raw = await r.get(key)
        if not raw:
            continue
        vms = orjson.loads(raw)
        for vm in (vms if isinstance(vms, list) else [vms]):
            if vm.get("folder_id") == folder_id:
                usage.used_storage_gb += float(vm.get("DiskGB") or 0)
                usage.used_memory_gb += float(vm.get("MemoryAssignedGB") or 0)
                usage.used_cpu_pct += float(vm.get("CPUUsage") or 0)
                usage.vm_count += 1
    return usage


async def check_create_vm_quota(
    db: AsyncSession,
    folder_id: str,
    requested_disk_gb: float,
    requested_memory_gb: float,
    requested_cpu_pct: float = 0.0,
) -> List[QuotaViolation]:
    """
    Raises a list of QuotaViolation objects if the requested resources
    would breach any hard quota on the folder. Empty list = OK to proceed.
    """
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder: Optional[Folder] = result.scalar_one_or_none()
    if folder is None:
        return []  # No folder = no quota constraints

    violations: List[QuotaViolation] = []
    usage = await compute_folder_usage(folder_id)

    # Storage check
    if folder.quota_storage_gb is not None:
        avail = folder.quota_storage_gb - usage.used_storage_gb
        if requested_disk_gb > avail:
            violations.append(QuotaViolation(
                field="storage",
                requested=requested_disk_gb,
                available=max(avail, 0),
                message=f"Storage quota exceeded: requesting {requested_disk_gb:.1f} GB but only {max(avail,0):.1f} GB remaining in folder '{folder.name}'.",
            ))

    # Memory check
    if folder.quota_memory_gb is not None:
        avail = folder.quota_memory_gb - usage.used_memory_gb
        if requested_memory_gb > avail:
            violations.append(QuotaViolation(
                field="memory",
                requested=requested_memory_gb,
                available=max(avail, 0),
                message=f"Memory quota exceeded: requesting {requested_memory_gb:.1f} GB but only {max(avail,0):.1f} GB remaining in folder '{folder.name}'.",
            ))

    # CPU check
    if folder.quota_cpu_pct is not None and requested_cpu_pct > 0:
        avail = folder.quota_cpu_pct - usage.used_cpu_pct
        if requested_cpu_pct > avail:
            violations.append(QuotaViolation(
                field="cpu",
                requested=requested_cpu_pct,
                available=max(avail, 0),
                message=f"CPU quota exceeded: requesting {requested_cpu_pct:.1f}% but only {max(avail,0):.1f}% remaining in folder '{folder.name}'.",
            ))

    # VM count check
    if folder.quota_max_vms is not None:
        if usage.vm_count >= folder.quota_max_vms:
            violations.append(QuotaViolation(
                field="vm_count",
                requested=1,
                available=0,
                message=f"VM count quota reached: folder '{folder.name}' is at its limit of {folder.quota_max_vms} VMs.",
            ))

    if violations:
        log.warning("quota.violation", folder_id=folder_id, violations=[v.field for v in violations])

    return violations
