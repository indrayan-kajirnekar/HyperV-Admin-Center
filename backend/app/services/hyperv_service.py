"""
Hyper-V Service Layer
Communicates with remote Hyper-V hosts via WinRM/PowerShell remoting.
All calls are non-blocking (run_in_executor wraps sync pypsrp calls).
Results are cached in Redis and invalidated on mutations.
"""
from __future__ import annotations
import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.cache import cache_get, cache_set, cache_delete_pattern
from app.core.config import settings

log = structlog.get_logger()

# ─── PowerShell script templates ──────────────────────────────────────────────

_PS_GET_VMS = """
Get-VM | Select-Object -Property Name, Id, State, CPUUsage, MemoryAssigned,
    MemoryDemand, Uptime, Status, Version, Generation,
    @{N='DiskGB';E={[math]::Round(($_.HardDrives | Measure-Object -Property FileSize -Sum).Sum / 1GB, 2)}},
    @{N='HostName';E={$env:COMPUTERNAME}} |
    ConvertTo-Json -Depth 3
"""

_PS_GET_VM_DETAIL = """
param($vmName)
$vm = Get-VM -Name $vmName
$vm | Select-Object -Property Name, Id, State, CPUUsage, MemoryAssigned, MemoryDemand,
    Uptime, Status, Version, Generation, ProcessorCount, DynamicMemoryEnabled,
    MemoryMinimum, MemoryMaximum, MemoryStartup,
    @{N='DiskGB';E={[math]::Round(($_.HardDrives | Measure-Object -Property FileSize -Sum).Sum / 1GB, 2)}},
    @{N='NetworkAdapters';E={($_.NetworkAdapters | Select-Object Name, SwitchName, MacAddress | ConvertTo-Json)}},
    @{N='HostName';E={$env:COMPUTERNAME}} |
    ConvertTo-Json -Depth 5
"""

_PS_GET_CHECKPOINTS = """
param($vmName)
Get-VMSnapshot -VMName $vmName |
    Select-Object Id, Name, SnapshotType, CreationTime, ParentSnapshotId,
    @{N='SizeGB';E={[math]::Round($_.FileSize / 1GB, 3)}} |
    ConvertTo-Json -Depth 3
"""

_PS_VM_ACTION = """
param($vmName, $action)
switch ($action) {
    'start'   { Start-VM -Name $vmName }
    'stop'    { Stop-VM -Name $vmName -Force }
    'stop_graceful' { Stop-VM -Name $vmName }
    'restart' { Restart-VM -Name $vmName -Force }
    'suspend' { Suspend-VM -Name $vmName }
    'resume'  { Resume-VM -Name $vmName }
}
"""

_PS_CREATE_CHECKPOINT = """
param($vmName, $snapName)
Checkpoint-VM -Name $vmName -SnapshotName $snapName
"""

_PS_DELETE_CHECKPOINT = """
param($snapId)
Get-VMSnapshot | Where-Object { $_.Id -eq $snapId } | Remove-VMSnapshot
"""

_PS_REVERT_CHECKPOINT = """
param($snapId)
$snap = Get-VMSnapshot | Where-Object { $_.Id -eq $snapId }
Restore-VMSnapshot -VMSnapshot $snap -Confirm:$false
"""

_PS_DELETE_VM = """
param($vmName)
Stop-VM -Name $vmName -Force -ErrorAction SilentlyContinue
Remove-VM -Name $vmName -Force
"""

_PS_CREATE_VM = r"""
param($name, $memoryGB, $cpuCount, $diskGB, $switchName, $generation, $isoPath, $nic2Switch, $nic3Switch, $vmBasePath)
$memBytes = [long]($memoryGB * 1GB)
$base = if ($vmBasePath) { $vmBasePath.TrimEnd('\') } else { 'C:\VMs' }
$vhdPath = "$base\$name\$name.vhdx"
New-Item -ItemType Directory -Path "$base\$name" -Force | Out-Null
$vm = New-VM -Name $name -MemoryStartupBytes $memBytes -Generation $generation `
      -NewVHDSizeBytes ([long]($diskGB * 1GB)) -NewVHDPath $vhdPath -SwitchName $switchName
Set-VMProcessor $vm -Count $cpuCount
# Attach ISO if provided
if ($isoPath) {
    if ($generation -eq 2) {
        Add-VMDvdDrive -VMName $name -Path $isoPath
        $dvd = Get-VMDvdDrive -VMName $name
        $hdd = Get-VMHardDiskDrive -VMName $name
        Set-VMFirmware -VMName $name -BootOrder $dvd, $hdd
    } else {
        Set-VMDvdDrive -VMName $name -Path $isoPath
    }
}
# Additional NICs
if ($nic2Switch) { Add-VMNetworkAdapter -VMName $name -SwitchName $nic2Switch }
if ($nic3Switch) { Add-VMNetworkAdapter -VMName $name -SwitchName $nic3Switch }
$vm | Select-Object Name, Id, State | ConvertTo-Json
"""


# ─── WinRM executor helper ────────────────────────────────────────────────────

def _run_ps_sync(
    hostname: str,
    script: str,
    parameters: dict | None = None,
    username: str | None = None,
    password: str | None = None,
) -> Any:
    """Synchronous PowerShell remoting call via pypsrp. Runs in a thread pool."""
    try:
        from pypsrp.powershell import PowerShell, RunspacePool
        from pypsrp.wsman import WSMan
    except ImportError:
        # Return mock data when pypsrp is not installed (dev / CI env)
        return _mock_ps_response(hostname, script, parameters)

    # Use per-host creds if provided, fall back to global env creds
    _user = username or settings.HYPERV_USERNAME
    _pass = password or settings.HYPERV_PASSWORD

    wsman = WSMan(
        hostname,
        username=_user,
        password=_pass,
        ssl=False,
        auth="negotiate",
        cert_validation=False,
    )
    with RunspacePool(wsman) as pool:
        ps = PowerShell(pool)
        if parameters:
            for k, v in parameters.items():
                ps.add_parameter(k, v)
        ps.add_script(script)
        output = ps.invoke()
        if ps.had_errors:
            raise RuntimeError(f"PowerShell error: {ps.streams.error}")
        raw = "".join(str(o) for o in output)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw


def _mock_ps_response(hostname: str, script: str, params: dict | None) -> Any:
    """Returns plausible mock data for development without a live Hyper-V host."""
    if "Get-VM" in script and "Snapshot" not in script and "Detail" not in script:
        return [
            {"Name": f"WebServer-{i:02d}", "Id": str(uuid.uuid4()), "State": "Running",
             "CPUUsage": 12 + i, "MemoryAssigned": (2 + i) * 1073741824,
             "DiskGB": 40.0 + i * 5, "HostName": hostname, "Uptime": f"{i}:00:00",
             "Status": "Operating normally", "Version": "9.0", "Generation": 2}
            for i in range(1, 8)
        ]
    if "Get-VMSnapshot" in script:
        return [
            {"Id": str(uuid.uuid4()), "Name": "Baseline", "SnapshotType": "Standard",
             "CreationTime": "2024-06-01T10:00:00", "ParentSnapshotId": None, "SizeGB": 1.2},
            {"Id": str(uuid.uuid4()), "Name": "Pre-patch", "SnapshotType": "Standard",
             "CreationTime": "2024-06-10T08:30:00", "ParentSnapshotId": None, "SizeGB": 2.1},
        ]
    return {}


async def _run_ps(
    hostname: str,
    script: str,
    parameters: dict | None = None,
    username: str | None = None,
    password: str | None = None,
) -> Any:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _run_ps_sync, hostname, script, parameters, username, password
    )


# ─── Public API ───────────────────────────────────────────────────────────────

async def get_all_vms(hypervisor_ids: List[str], hosts: List[str]) -> List[Dict]:
    """
    Fetch VM lists from all hosts concurrently, with per-host caching.
    Returns merged list; never blocks the event loop.
    """
    tasks = [_get_vms_from_host(hid, host) for hid, host in zip(hypervisor_ids, hosts)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    merged: List[Dict] = []
    for r in results:
        if isinstance(r, Exception):
            log.warning("hyperv.get_vms.error", error=str(r))
            continue
        merged.extend(r if isinstance(r, list) else [r])
    return merged


async def _get_vms_from_host(hypervisor_id: str, hostname: str) -> List[Dict]:
    cache_key = f"vms:{hypervisor_id}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached
    raw = await _run_ps(hostname, _PS_GET_VMS)
    vms = raw if isinstance(raw, list) else ([raw] if raw else [])
    # Normalize and tag with hypervisor context
    for vm in vms:
        vm["hypervisor_id"] = hypervisor_id
        vm["hypervisor_hostname"] = hostname
        # Convert bytes to GB
        if "MemoryAssigned" in vm:
            vm["MemoryAssignedGB"] = round(vm["MemoryAssigned"] / 1073741824, 2)
    await cache_set(cache_key, vms, ttl=settings.REDIS_TTL_SECONDS)
    return vms


async def get_vm_detail(hostname: str, vm_name: str) -> Dict:
    cache_key = f"vm_detail:{hostname}:{vm_name}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached
    raw = await _run_ps(hostname, _PS_GET_VM_DETAIL, {"vmName": vm_name})
    await cache_set(cache_key, raw, ttl=15)
    return raw


async def perform_vm_action(hostname: str, vm_name: str, action: str) -> bool:
    await _run_ps(hostname, _PS_VM_ACTION, {"vmName": vm_name, "action": action})
    # Invalidate cache for this host
    await cache_delete_pattern(f"vms:*")
    await cache_delete_pattern(f"vm_detail:{hostname}:{vm_name}")
    return True


async def create_vm(
    hostname: str,
    name: str,
    memory_gb: float,
    cpu_count: int,
    disk_gb: float,
    switch_name: str,
    generation: int = 2,
    iso_path: Optional[str] = None,
    nic2_switch: Optional[str] = None,
    nic3_switch: Optional[str] = None,
    vm_path: Optional[str] = None,
) -> Dict:
    result = await _run_ps(
        hostname, _PS_CREATE_VM,
        {
            "name": name, "memoryGB": memory_gb, "cpuCount": cpu_count,
            "diskGB": disk_gb, "switchName": switch_name, "generation": generation,
            "isoPath": iso_path or "", "nic2Switch": nic2_switch or "",
            "nic3Switch": nic3_switch or "", "vmBasePath": vm_path or "",
        },
    )
    await cache_delete_pattern("vms:*")
    return result if isinstance(result, dict) else {}


async def delete_vm(hostname: str, vm_name: str) -> bool:
    await _run_ps(hostname, _PS_DELETE_VM, {"vmName": vm_name})
    await cache_delete_pattern("vms:*")
    await cache_delete_pattern(f"vm_detail:{hostname}:{vm_name}")
    return True


async def get_checkpoints(hostname: str, vm_name: str) -> List[Dict]:
    cache_key = f"checkpoints:{hostname}:{vm_name}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached
    raw = await _run_ps(hostname, _PS_GET_CHECKPOINTS, {"vmName": vm_name})
    items = raw if isinstance(raw, list) else ([raw] if raw else [])
    await cache_set(cache_key, items, ttl=30)
    return items


async def create_checkpoint(hostname: str, vm_name: str, snap_name: str) -> bool:
    await _run_ps(hostname, _PS_CREATE_CHECKPOINT, {"vmName": vm_name, "snapName": snap_name})
    await cache_delete_pattern(f"checkpoints:{hostname}:{vm_name}")
    return True


async def delete_checkpoint(hostname: str, snap_id: str, vm_name: str) -> bool:
    await _run_ps(hostname, _PS_DELETE_CHECKPOINT, {"snapId": snap_id})
    await cache_delete_pattern(f"checkpoints:{hostname}:{vm_name}")
    return True


async def revert_checkpoint(hostname: str, snap_id: str, vm_name: str) -> bool:
    await _run_ps(hostname, _PS_REVERT_CHECKPOINT, {"snapId": snap_id})
    await cache_delete_pattern(f"checkpoints:{hostname}:{vm_name}")
    await cache_delete_pattern(f"vms:*")
    return True
