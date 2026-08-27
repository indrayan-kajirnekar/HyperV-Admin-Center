"""
Background Poller
Runs on a configurable interval, refreshes VM state for all registered hypervisors,
updates Redis cache, and broadcasts change events to all connected WebSocket clients.
This keeps the cache hot so the UI always gets sub-second responses.
"""
from __future__ import annotations
import asyncio
from typing import Dict, List
import structlog
from sqlalchemy import select

from app.core.cache import cache_set
from app.core.config import settings
from app.core.events import broadcast
from app.models.folder import Hypervisor
from app.services.hyperv_service import _run_ps, _PS_GET_VMS

log = structlog.get_logger()

_poller_task: asyncio.Task | None = None


async def start_background_poller(db_factory) -> None:
    global _poller_task
    _poller_task = asyncio.create_task(_poll_loop(db_factory), name="vm-poller")
    log.info("poller.started", interval=settings.REDIS_VM_POLL_INTERVAL)


async def stop_background_poller() -> None:
    global _poller_task
    if _poller_task:
        _poller_task.cancel()
        try:
            await _poller_task
        except asyncio.CancelledError:
            pass
        _poller_task = None
    log.info("poller.stopped")


async def _poll_loop(db_factory) -> None:
    while True:
        try:
            await _poll_all_hosts(db_factory)
        except Exception as exc:
            log.error("poller.error", error=str(exc))
        await asyncio.sleep(settings.REDIS_VM_POLL_INTERVAL)


async def _poll_all_hosts(db_factory) -> None:
    async with db_factory() as db:
        result = await db.execute(select(Hypervisor).where(Hypervisor.is_online == True))
        hypervisors = result.scalars().all()

    tasks = [_poll_host(h) for h in hypervisors]
    await asyncio.gather(*tasks, return_exceptions=True)


async def _poll_host(hypervisor: Hypervisor) -> None:
    try:
        raw = await _run_ps(
            hypervisor.hostname, _PS_GET_VMS,
            username=hypervisor.winrm_username or None,
            password=hypervisor.winrm_password or None,
        )
        vms: List[Dict] = raw if isinstance(raw, list) else ([raw] if raw else [])

        # Tag with hypervisor context
        for vm in vms:
            vm["hypervisor_id"] = hypervisor.id
            vm["hypervisor_hostname"] = hypervisor.hostname
            vm["folder_id"] = hypervisor.folder_id
            if "MemoryAssigned" in vm:
                vm["MemoryAssignedGB"] = round(vm["MemoryAssigned"] / 1073741824, 2)

        cache_key = f"vms:{hypervisor.id}"
        await cache_set(cache_key, vms, ttl=settings.REDIS_TTL_SECONDS + 5)

        # Broadcast a lightweight update event (not full VM data, just signal)
        await broadcast({
            "type": "vm_list_updated",
            "hypervisor_id": hypervisor.id,
            "hypervisor_hostname": hypervisor.hostname,
            "vm_count": len(vms),
        })
        log.debug("poller.host.ok", host=hypervisor.hostname, vms=len(vms))

    except Exception as exc:
        log.warning("poller.host.error", host=hypervisor.hostname, error=str(exc))
        await broadcast({
            "type": "hypervisor_status",
            "hypervisor_id": hypervisor.id,
            "hypervisor_hostname": hypervisor.hostname,
            "status": "offline",
            "error": str(exc),
        })
