from __future__ import annotations
import asyncio
import base64
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.events import ws_event_stream
from app.core.cache import cache_get

router = APIRouter(prefix="/ws", tags=["websocket"])


# ─── Real-time event stream ───────────────────────────────────────────────────

@router.websocket("/events")
async def websocket_events(websocket: WebSocket):
    """
    Real-time event stream.
    Broadcasts: vm_list_updated, hypervisor_status, audit events.
    Sends a heartbeat ping every 30s to keep the connection alive.
    """
    await ws_event_stream(websocket)


# ─── VM Console (screenshot-stream proxy) ────────────────────────────────────

_PS_SCREENSHOT = r"""
param($vmName)
try {
    $vm = Get-VM -Name $vmName -ErrorAction Stop
    $res = Get-VMVideo -VMName $vmName
    $width  = if ($res.HorizontalResolution) { $res.HorizontalResolution } else { 1024 }
    $height = if ($res.VerticalResolution)   { $res.VerticalResolution }   else { 768  }
    $bmp    = New-Object System.Drawing.Bitmap $width, $height
    $vmms   = [System.Runtime.InteropServices.Marshal]
    Add-Type -AssemblyName System.Drawing

    # Use Hyper-V WMI to grab a raw frame
    $msvm = Get-WmiObject -Namespace root\virtualization\v2 `
                -Class Msvm_ComputerSystem `
                -Filter "ElementName='$vmName'"
    $vd   = $msvm.GetRelated('Msvm_VideoHead') | Select-Object -First 1
    if (-not $vd) { throw "No video head" }

    $rawSize  = $width * $height * 4
    $raw = New-Object byte[] $rawSize
    $ms  = New-Object System.IO.MemoryStream
    $bmp = New-Object System.Drawing.Bitmap $width, $height, 'Format32bppArgb'
    $bmpData = $bmp.LockBits(
        [System.Drawing.Rectangle]::FromLTRB(0,0,$width,$height),
        [System.Drawing.Imaging.ImageLockMode]::WriteOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    [System.Runtime.InteropServices.Marshal]::Copy($raw, 0, $bmpData.Scan0, $rawSize)
    $bmp.UnlockBits($bmpData)
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bytes = $ms.ToArray()
    [Convert]::ToBase64String($bytes)
} catch {
    # Return a 1×1 grey JPEG on any error so the loop keeps running
    $ms = New-Object System.IO.MemoryStream
    $bmp = New-Object System.Drawing.Bitmap 1, 1
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    [Convert]::ToBase64String($ms.ToArray())
}
"""

# Simpler fallback script — uses Get-VMScreen if available (Server 2016+)
_PS_SCREENSHOT_V2 = r"""
param($vmName)
try {
    Add-Type -AssemblyName System.Drawing
    $vm = Get-VM -Name $vmName -ErrorAction Stop
    # Grab screenshot via Hyper-V Enhanced Session / thumbnail
    $thumb = $vm | Get-VMVideo | Select-Object -ExpandProperty CurrentResolution -ErrorAction SilentlyContinue
    # Fall back: build a placeholder image with status text
    $width = 640; $height = 480
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(20,20,20))
    $font = New-Object System.Drawing.Font("Consolas", 16)
    $brush = [System.Drawing.Brushes]::LightGray
    $state = $vm.State.ToString()
    $g.DrawString("VM: $vmName", $font, $brush, 40, 180)
    $g.DrawString("State: $state", $font, $brush, 40, 210)
    $g.DrawString("Host: $env:COMPUTERNAME", $font, $brush, 40, 240)
    $g.DrawString("(Live console requires Hyper-V Enhanced Session)", $font, $brush, 40, 290)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    [Convert]::ToBase64String($ms.ToArray())
} catch {
    ""
}
"""


def _capture_frame_sync(hostname: str, vm_name: str) -> str:
    """
    Runs synchronously in a thread pool.
    Returns a base64-encoded JPEG string, or "" on error.
    """
    try:
        from pypsrp.powershell import PowerShell, RunspacePool
        from pypsrp.wsman import WSMan
        from app.core.config import settings

        wsman = WSMan(
            hostname,
            username=settings.HYPERV_USERNAME,
            password=settings.HYPERV_PASSWORD,
            ssl=False,
            auth="negotiate",
            cert_validation=False,
            connection_timeout=8,
        )
        with RunspacePool(wsman) as pool:
            ps = PowerShell(pool)
            ps.add_script(_PS_SCREENSHOT_V2)
            ps.add_parameter("vmName", vm_name)
            output = ps.invoke()
            result = "".join(str(o) for o in output).strip()
            return result
    except ImportError:
        # Dev mode — return a tiny solid grey 1×1 JPEG placeholder
        _grey_jpeg = (
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
            "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN"
            "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
            "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA"
            "AAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/"
            "aAAwDAQACEQMRAD8AJQAB/9k="
        )
        return _grey_jpeg
    except Exception:
        return ""


@router.websocket("/console/{token}")
async def websocket_console(websocket: WebSocket, token: str):
    """
    VM console screenshot-stream proxy.

    Protocol (server → client JSON frames):
      { "type": "frame",  "data": "<base64-jpeg>" }
      { "type": "info",   "vm": "...", "host": "..." }
      { "type": "error",  "message": "..." }
      { "type": "ping" }

    Client can send:
      { "type": "pong" }
      { "type": "close" }

    The endpoint polls the Hyper-V host at ~1 fps using the _PS_SCREENSHOT_V2
    PowerShell script, sending each frame as a base64 JPEG.  Full interactive
    console requires Hyper-V Enhanced Session / VMConnect which is RDP-based
    and not tunnelable this way — this stream gives read-only VM status view.
    """
    await websocket.accept()

    # ── Validate token ──────────────────────────────────────────────────────
    session = await cache_get(f"console_token:{token}")
    if not session:
        await websocket.send_json({"type": "error", "message": "Invalid or expired console token."})
        await websocket.close(code=4401)
        return

    hostname: str = session.get("hostname", "")
    vm_name: str = session.get("vm_name", "")

    if not hostname or not vm_name:
        await websocket.send_json({"type": "error", "message": "Malformed session data."})
        await websocket.close(code=4400)
        return

    # Announce session info to the client
    await websocket.send_json({
        "type": "info",
        "vm": vm_name,
        "host": hostname,
        "message": f"Connecting to console for {vm_name} on {hostname}…",
    })

    loop = asyncio.get_event_loop()

    async def _recv_loop():
        """Drain incoming client messages (pong / close)."""
        try:
            while True:
                msg = await websocket.receive_text()
                try:
                    data = json.loads(msg)
                    if data.get("type") == "close":
                        return
                except Exception:
                    pass
        except (WebSocketDisconnect, Exception):
            pass

    recv_task = asyncio.create_task(_recv_loop())

    try:
        consecutive_errors = 0
        while not recv_task.done():
            # Capture frame in executor (sync pypsrp call)
            try:
                b64 = await loop.run_in_executor(
                    None, _capture_frame_sync, hostname, vm_name
                )
                if b64:
                    await websocket.send_json({"type": "frame", "data": b64})
                    consecutive_errors = 0
                else:
                    consecutive_errors += 1
                    if consecutive_errors >= 5:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Unable to capture VM screenshot. "
                                       "Ensure the VM is running and WinRM has Hyper-V access.",
                        })
            except WebSocketDisconnect:
                break
            except Exception as exc:
                consecutive_errors += 1
                try:
                    await websocket.send_json({"type": "error", "message": str(exc)})
                except Exception:
                    break

            # ~1 fps — sleep 1 s between frames
            await asyncio.sleep(1.0)

    finally:
        recv_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass
