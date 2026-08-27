"""
Servers (Hypervisors) API
Dedicated router for full Hyper-V server management:
  - Credential-verify before registering
  - Register / edit / delete hypervisor records
  - Toggle online/offline status
  - Assign to folders
  - Test connectivity (ping via WinRM)
  - ISO browsing from host file system
  - File upload staging to host
  - Eject CD/DVD from running VM
  - Console session token (for WebSocket noVNC proxy)
  - View per-server VM summary from cache
"""
from __future__ import annotations
import asyncio
import secrets
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.cache import cache_get, cache_set
from app.models.folder import Hypervisor, Folder
from app.services.audit_service import record_event
from app.services.hyperv_service import _run_ps
from sqlalchemy import select as sa_select

router = APIRouter(prefix="/servers", tags=["servers"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CredentialVerifyRequest(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=255)
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)

class ServerCreate(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=255,
                          description="FQDN or IP address of the Hyper-V host")
    display_name: Optional[str] = Field(None, max_length=255)
    folder_id: Optional[str] = None
    total_cpu_cores: Optional[int] = Field(None, ge=1)
    total_memory_gb: Optional[float] = Field(None, ge=0)
    total_storage_gb: Optional[float] = Field(None, ge=0)
    # Per-server credential override (stored encrypted in production)
    winrm_username: Optional[str] = None
    winrm_password: Optional[str] = None


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

    # Exclude credential fields — they are not stored in the Hypervisor model
    h = Hypervisor(**body.model_dump(exclude={"winrm_username", "winrm_password"}))
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


# ─── PowerShell helpers for ISO / upload / eject ─────────────────────────────

_PS_LIST_ISOS = r"""
param($path)
$root = if ($path) { $path } else { 'C:\ISOs' }
if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root | Out-Null }
Get-ChildItem -Path $root -Filter *.iso -ErrorAction SilentlyContinue |
    Select-Object Name, FullName,
        @{N='SizeMB';E={[math]::Round($_.Length / 1MB, 1)}},
        LastWriteTime |
    ConvertTo-Json -Depth 2
"""

_PS_EJECT_DVD = r"""
param($vmName)
Get-VMDvdDrive -VMName $vmName | Set-VMDvdDrive -Path $null
"""

_PS_VERIFY_CREDS = r"""
$cpu   = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
$ram   = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 0)
$disks = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } |
         Select-Object @{N='Drive';E={"$($_.Name):"}},
                       @{N='FreeGB';E={[math]::Round($_.Free / 1GB, 1)}},
                       @{N='TotalGB';E={[math]::Round(($_.Used + $_.Free) / 1GB, 1)}}
[PSCustomObject]@{
    ComputerName = $env:COMPUTERNAME
    CpuCores     = [int]$cpu
    RamGB        = [int]$ram
    Disks        = @($disks)
} | ConvertTo-Json -Depth 3
"""

_PS_LIST_DRIVES = r"""
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } |
    Select-Object @{N='Drive';E={"$($_.Name):"}},
                  @{N='FreeGB';E={[math]::Round($_.Free / 1GB, 1)}},
                  @{N='TotalGB';E={[math]::Round(($_.Used + $_.Free) / 1GB, 1)}} |
    ConvertTo-Json -Depth 2
"""

_PS_UPLOAD_FILE = r"""
param($destPath, $b64Content)
$bytes = [Convert]::FromBase64String($b64Content)
[IO.File]::WriteAllBytes($destPath, $bytes)
"""

_PS_LIST_VM_GROUPS = r"""
$groups = Get-VMGroup -ErrorAction SilentlyContinue
if (-not $groups) { Write-Output '[]'; return }
$groups | Select-Object Name,
    @{N='Id';   E={$_.Id.ToString()}},
    @{N='Type'; E={$_.GroupType.ToString()}},
    @{N='VMCount'; E={@($_.VMMembers).Count}} |
    ConvertTo-Json -Depth 2
"""


# ─── Credential Verify ────────────────────────────────────────────────────────

@router.post("/verify-credentials", status_code=200)
async def verify_credentials(
    body: CredentialVerifyRequest,
    current_user=Depends(get_current_user),
):
    """
    Test WinRM connectivity with the supplied credentials before registering.
    Returns the remote hostname on success, raises 422 on failure.
    """
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")

    def _probe():
        try:
            from pypsrp.powershell import PowerShell, RunspacePool
            from pypsrp.wsman import WSMan
            import json as _json
            wsman = WSMan(
                body.hostname, username=body.username, password=body.password,
                ssl=False, auth="negotiate", cert_validation=False,
                connection_timeout=8,
            )
            with RunspacePool(wsman) as pool:
                ps = PowerShell(pool)
                ps.add_script(_PS_VERIFY_CREDS)
                output = ps.invoke()
                raw = "".join(str(o) for o in output).strip()
                try:
                    return _json.loads(raw)
                except Exception:
                    return {"ComputerName": raw, "CpuCores": None, "RamGB": None, "Disks": []}
        except ImportError:
            # pypsrp not installed — return mock data for dev
            return {
                "ComputerName": body.hostname,
                "CpuCores": 8, "RamGB": 32,
                "Disks": [
                    {"Drive": "C:", "FreeGB": 200.0, "TotalGB": 500.0},
                    {"Drive": "D:", "FreeGB": 900.0, "TotalGB": 2000.0},
                ],
            }
        except Exception as exc:
            raise RuntimeError(str(exc))

    loop = asyncio.get_event_loop()
    try:
        info = await loop.run_in_executor(None, _probe)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot connect to '{body.hostname}': {exc}",
        )

    # Sum all disk TotalGB for total_storage_gb
    disks = info.get("Disks") or []
    if isinstance(disks, dict):
        disks = [disks]
    total_storage = round(sum(d.get("TotalGB", 0) for d in disks), 0)

    return {
        "ok": True,
        "remote_hostname": info.get("ComputerName", body.hostname),
        "cpu_cores": info.get("CpuCores"),
        "ram_gb": info.get("RamGB"),
        "total_storage_gb": total_storage or None,
        "disks": disks,
    }


# ─── ISO Browse ───────────────────────────────────────────────────────────────

@router.get("/{hypervisor_id}/isos")
async def list_isos(
    hypervisor_id: str,
    path: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List .iso files available on the Hyper-V host (default: C:\\ISOs)."""
    h = await _get_or_404(db, hypervisor_id)
    if not h.is_online:
        raise HTTPException(409, "Server is marked offline")
    result = await _run_ps(h.hostname, _PS_LIST_ISOS, {"path": path or ""})
    if isinstance(result, dict):
        result = [result]
    elif not isinstance(result, list):
        result = []
    return result


# ─── Drives (list volumes on registered host) ────────────────────────────────

@router.get("/{hypervisor_id}/drives")
async def list_drives(
    hypervisor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List filesystem drives (C:, D:, …) and their free/total space on the Hyper-V host."""
    h = await _get_or_404(db, hypervisor_id)
    if not h.is_online:
        raise HTTPException(409, "Server is marked offline")
    result = await _run_ps(h.hostname, _PS_LIST_DRIVES)
    if isinstance(result, dict):
        result = [result]
    elif not isinstance(result, list):
        result = []
    return result


# ─── File Upload (stage onto host) ────────────────────────────────────────────

@router.post("/{hypervisor_id}/upload")
async def upload_file(
    hypervisor_id: str,
    dest_path: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Upload a file (e.g. ISO) to the Hyper-V host at dest_path.
    Transferred as Base64 over WinRM — suitable for ISOs up to ~200 MB.
    """
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")
    h = await _get_or_404(db, hypervisor_id)
    if not h.is_online:
        raise HTTPException(409, "Server is marked offline")

    import base64
    raw = await file.read()
    b64 = base64.b64encode(raw).decode()
    await _run_ps(h.hostname, _PS_UPLOAD_FILE, {"destPath": dest_path, "b64Content": b64})
    return {"uploaded": True, "dest_path": dest_path, "size_bytes": len(raw)}


# ─── Eject CD/DVD ─────────────────────────────────────────────────────────────

@router.post("/{hypervisor_id}/vms/{vm_name}/eject-cd")
async def eject_cd(
    hypervisor_id: str,
    vm_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Unmount/eject the DVD drive ISO from a running VM."""
    h = await _get_or_404(db, hypervisor_id)
    await _run_ps(h.hostname, _PS_EJECT_DVD, {"vmName": vm_name})
    await record_event(
        db, "vm.eject_cd", "vm", f"{hypervisor_id}/{vm_name}", vm_name,
        current_user.id, current_user.email, status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"ejected": True, "vm": vm_name}


# ─── Console Token (for WebSocket proxy) ─────────────────────────────────────

@router.post("/{hypervisor_id}/vms/{vm_name}/console-token")
async def get_console_token(
    hypervisor_id: str,
    vm_name: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Issue a short-lived (60s) token that the frontend WebSocket console can use
    to identify which VM/host the session is for, without exposing credentials.
    """
    h = await _get_or_404(db, hypervisor_id)
    token = secrets.token_urlsafe(32)
    session_data = {
        "hypervisor_id": hypervisor_id,
        "hostname": h.hostname,
        "vm_name": vm_name,
        "user_id": current_user.id,
    }
    await cache_set(f"console_token:{token}", session_data, ttl=60)
    return {"token": token, "ws_url": f"/api/v1/ws/console/{token}"}


# ─── VM Groups (fetch from Hyper-V host) ─────────────────────────────────────

@router.get("/{hypervisor_id}/vm-groups")
async def list_vm_groups(
    hypervisor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Fetch VM Groups defined on the Hyper-V host via Get-VMGroup.
    Returns list of { Name, Id, Type, VMCount }.
    """
    h = await _get_or_404(db, hypervisor_id)
    if not h.is_online:
        raise HTTPException(409, "Server is marked offline")
    result = await _run_ps(h.hostname, _PS_LIST_VM_GROUPS)
    if isinstance(result, dict):
        result = [result]
    elif not isinstance(result, list):
        result = []
    return result


@router.post("/{hypervisor_id}/sync-folders", status_code=200)
async def sync_folders_from_host(
    hypervisor_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Pull VM Groups from the Hyper-V host and upsert them as Folders in the DB.
    - New groups  → new Folder rows created
    - Existing folders (matched by name) → left unchanged
    - The hypervisor is assigned to each synced folder automatically
    Returns { created: [...], existing: [...] }
    """
    if current_user.role not in ("super_admin", "cluster_admin"):
        raise HTTPException(403, "Insufficient permissions")

    h = await _get_or_404(db, hypervisor_id)
    if not h.is_online:
        raise HTTPException(409, "Server is marked offline")

    # 1. Fetch VM groups from host
    raw = await _run_ps(h.hostname, _PS_LIST_VM_GROUPS)
    if isinstance(raw, dict):
        raw = [raw]
    elif not isinstance(raw, list):
        raw = []

    if not raw:
        return {"created": [], "existing": [], "message": "No VM Groups found on host. Create VM Groups in Hyper-V Manager first."}

    # 2. Load all existing folders by name for fast lookup
    existing_res = await db.execute(sa_select(Folder))
    existing_folders = {f.name: f for f in existing_res.scalars().all()}

    created = []
    existing_names = []

    for group in raw:
        name = group.get("Name", "").strip()
        if not name:
            continue

        if name in existing_folders:
            # Already exists — just ensure this hypervisor is assigned to it
            folder = existing_folders[name]
            existing_names.append(name)
        else:
            # Create new folder
            folder = Folder(
                name=name,
                description=f"Synced from Hyper-V VM Group on {h.hostname}",
            )
            db.add(folder)
            await db.flush()   # get the folder.id
            existing_folders[name] = folder
            created.append(name)

        # Assign this hypervisor to the folder if not already assigned
        if h.folder_id != folder.id:
            h.folder_id = folder.id

    await record_event(
        db, "folder.sync", "hypervisor", h.id, h.hostname,
        current_user.id, current_user.email, status="success",
        detail={"created": created, "existing": existing_names},
        ip_address=request.client.host if request.client else None,
    )

    return {
        "created": created,
        "existing": existing_names,
        "message": f"Sync complete. {len(created)} new folder(s) created, {len(existing_names)} already existed.",
    }
