# HyperVision — Hyper-V Admin Center

A full-stack web application for centrally managing multiple Microsoft Hyper-V hosts.
Monitor virtual machines, manage folders, control users, and stream live events — all from one browser tab.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start (Docker Compose)](#quick-start-docker-compose)
- [Local Development Setup](#local-development-setup)
  - [Backend](#backend-python--fastapi)
  - [Frontend](#frontend-react--vite)
- [Environment Variables](#environment-variables)
- [Features](#features)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Default Credentials](#default-credentials)
- [Port Reference](#port-reference)

---

## Architecture Overview

```
Browser (React SPA)
      │  :5173 (Docker Nginx / Vite dev server)
      ▼
  Nginx (frontend container)
      │  reverse-proxies /api/* and /api/v1/ws/* → api:8000
      ▼
  FastAPI (backend container)  :8000 (internal) / :8001 (host)
      │
      ├── PostgreSQL  :5432 (internal) / :5433 (host)   — persistent store
      └── Redis       :6379                              — VM cache + WS pub/sub
```

The frontend is a React + TypeScript SPA served by Nginx in production and by the Vite dev server in development.
The backend is a FastAPI application with async SQLAlchemy, background polling of Hyper-V hosts via WinRM/PowerShell remoting, and WebSocket push for live VM status and VM console streaming.

---

## Tech Stack

| Layer      | Technology                                                          |
|------------|---------------------------------------------------------------------|
| Frontend   | React 18, TypeScript, Vite, TailwindCSS, TanStack Query, Zustand   |
| Backend    | Python 3.12, FastAPI, SQLAlchemy (async), Alembic                  |
| Database   | PostgreSQL 16                                                       |
| Cache      | Redis 7                                                             |
| Hyper-V    | WinRM / PowerShell Remoting (`pypsrp`)                             |
| Auth       | JWT (HS256, configurable expiry)                                    |
| Container  | Docker + Docker Compose v2                                          |

---

## Prerequisites

### Linux Server (running the app)

- [Docker](https://docs.docker.com/engine/install/) Engine ≥ 24 + Compose v2
- Ports **5173**, **8001**, **6379** open inbound (5433 optional for DBA tooling)
- For local dev without Docker:
  - Python 3.12+
  - Node.js 20+ with npm
  - A running PostgreSQL 16 instance
  - A running Redis 7 instance

### Hyper-V Windows Server (each host you want to manage)

WinRM must be enabled and accessible from the Linux server.
Run the following in **PowerShell as Administrator** on every Hyper-V host:

**1. Enable PowerShell Remoting**
```powershell
Enable-PSRemoting -Force
```

**2. Allow Basic auth + unencrypted transport (HTTP / internal network)**
```powershell
winrm set winrm/config/service '@{AllowUnencrypted="true"}'
winrm set winrm/config/service/auth '@{Basic="true"}'
```

**3. Ensure WinRM is listening on port 5985**
```powershell
winrm set winrm/config/listener?Address=*+Transport=HTTP '@{Port="5985"}'
```

**4. Open the firewall for port 5985**
```powershell
New-NetFirewallRule -DisplayName "WinRM HTTP" `
  -Direction Inbound -Protocol TCP -LocalPort 5985 -Action Allow
```

**5. Add the service account to Hyper-V Administrators**
```powershell
Add-LocalGroupMember -Group "Hyper-V Administrators" -Member "svc-hypervision"
```

**6. Verify WinRM is ready**
```powershell
# Should return ProductVendor / ProductVersion info
Test-WSMan localhost

# Should show 0.0.0.0:5985 LISTENING
netstat -an | findstr 5985
```

**7. Verify from the Linux server**
```bash
# Should return an XML response — not a timeout or refused
curl -s http://<hyper-v-ip>:5985/wsman
```

> **Security note:** HTTP on port 5985 is acceptable on isolated internal networks.
> For production use HTTPS (port 5986) with a valid certificate.

---

## Quick Start (Docker Compose)

```bash
# 1. Clone the repository
git clone <repo-url>
cd HyperVisorsApp

# 2. (Optional) Create a backend environment override
cp backend/.env.example backend/.env
#    Edit backend/.env and set:
#      APP_SECRET_KEY  — python -c "import secrets; print(secrets.token_hex(32))"
#      HYPERV_USERNAME — WinRM service account  (DOMAIN\\username)
#      HYPERV_PASSWORD — WinRM service account password

# 3. Start all services
docker compose up --build -d

# 4. Open the app
#    Frontend  → http://<server-ip>:5173
#    API Docs  → http://<server-ip>:8001/api/docs
```

The app will work without a `.env` file — all defaults are inlined in `docker-compose.yml`.

To tear everything down (keeps postgres data volume):
```bash
docker compose down
```

To also remove the database volume:
```bash
docker compose down -v
```

---

## Local Development Setup

### Backend (Python / FastAPI)

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Copy and configure env
cp .env.example .env

# Apply database migrations
alembic upgrade head

# Run the development server (single worker for dev)
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.  
Interactive docs (Swagger UI): `http://localhost:8000/api/docs`

### Frontend (React / Vite)

```bash
cd frontend

# Install dependencies
npm install

# Start the Vite dev server
npm run dev
```

The app will be served at `http://localhost:5173`.  
The Vite dev server automatically proxies `/api/*` requests to `http://localhost:8000`.

Other useful frontend scripts:

| Command              | Description                          |
|----------------------|--------------------------------------|
| `npm run build`      | Production build to `dist/`          |
| `npm run preview`    | Preview production build locally     |
| `npm run lint`       | ESLint with strict no-warning policy |
| `npm run type-check` | TypeScript type checking (no emit)   |

---

## Environment Variables

Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` and fill in the values.
All variables have sensible defaults in `docker-compose.yml` — the file is optional for a quick start.

| Variable                  | Default                              | Description                                      |
|---------------------------|--------------------------------------|--------------------------------------------------|
| `APP_NAME`                | `HyperVision`                        | Application display name                         |
| `APP_ENV`                 | `production`                         | Environment tag (`development` / `production`)   |
| `APP_SECRET_KEY`          | *(required — change before deploy)*  | 256-bit random key for JWT signing               |
| `APP_DEBUG`               | `false`                              | Enable debug logging                             |
| `APP_PORT`                | `8000`                               | Backend listening port (internal)                |
| `DATABASE_URL`            | `postgresql+asyncpg://...`           | Async PostgreSQL connection string               |
| `REDIS_URL`               | `redis://localhost:6379/0`           | Redis connection URL                             |
| `REDIS_TTL_SECONDS`       | `30`                                 | VM data cache TTL                                |
| `REDIS_VM_POLL_INTERVAL`  | `15`                                 | Background poll interval (seconds)               |
| `JWT_ALGORITHM`           | `HS256`                              | JWT signing algorithm                            |
| `JWT_EXPIRE_MINUTES`      | `480`                                | Token lifetime (8 hours)                         |
| `HYPERV_HOSTS`            | *(comma-separated FQDNs/IPs)*        | Hyper-V hosts to poll at startup                 |
| `HYPERV_USERNAME`         | `DOMAIN\\svc-hypervision`            | WinRM service account                            |
| `HYPERV_PASSWORD`         | *(required)*                         | WinRM service account password                   |
| `CORS_ORIGINS`            | `http://localhost:5173`              | Comma-separated allowed CORS origins             |
| `BOOTSTRAP_ADMIN_EMAIL`   | `admin@corp.local`                   | Super-admin email seeded on first startup        |
| `BOOTSTRAP_ADMIN_PASSWORD`| `ChangeMe@123`                       | Super-admin initial password — change immediately|
| `BOOTSTRAP_ADMIN_NAME`    | `Admin`                              | Super-admin display name                         |

---

## Features

### Virtual Machines

| Feature | Description |
|---------|-------------|
| **VM List** | Virtualised table (TanStack Virtual) — handles 1000+ rows without lag |
| **Power control** | Start, Stop (graceful / force), Restart, Suspend, Resume |
| **Create VM** | Wizard with: name, CPU, RAM, disk, generation, virtual switch |
| **Multi-NIC** | Up to 3 network adapters on a single VM, each on a different vSwitch |
| **ISO attach** | Browse and attach an ISO from the host file system at VM creation |
| **VM storage path** | Choose which drive (C:, D:, …) to store the VM's VHDX on |
| **Eject CD/DVD** | Unmount the ISO from a running VM with one click |
| **Delete VM** | Stops and removes VM + VHDX (with confirmation) |
| **Checkpoints** | Create, revert, delete snapshots via slide-in panel |
| **Console viewer** | In-browser screenshot stream of the VM screen via WinRM (~1 fps, read-only) |
| **Optimistic UI** | State badge updates instantly; background WS confirmation |

### Server (Hypervisor) Management

| Feature | Description |
|---------|-------------|
| **2-step registration** | Step 1: verify WinRM credentials live; Step 2: confirm auto-filled capacity |
| **Hardware auto-fill** | CPU cores, RAM GB, and total storage auto-populated from host on verify |
| **Drive listing** | Live list of filesystem drives (C:, D:, …) with free/total space |
| **ISO browser** | Browse `.iso` files under `C:\ISOs` (or any path) on the Hyper-V host |
| **File upload** | Upload ISOs from the browser to the Hyper-V host via WinRM Base64 transfer |
| **Toggle online/offline** | Quick flag to exclude a host from VM polling without deleting it |
| **Edit / Delete** | Update hostname, display name, folder, capacity figures |

### Folders & Storage Quotas

| Feature | Description |
|---------|-------------|
| **Folders tab** | Organise hypervisors into logical folders; assign servers |
| **Storage Quotas tab** | Set per-folder limits: max VMs, max disk GB, max RAM GB |
| **Pre-flight check** | VM creation blocked with clear message if a quota would be exceeded |

### Users & Access Control

| Feature | Description |
|---------|-------------|
| **User CRUD** | Create, edit, delete users with email and role |
| **Roles** | `super_admin`, `cluster_admin`, `viewer` |
| **Groups** | Logical user groups for permission delegation |
| **Permissions** | Assign per-folder access permissions to groups |
| **Change password** | Users can change their own password via the top-right avatar menu |

### Audit Log

Full timestamped audit trail: every login, VM action, server registration, user change, quota block, and credential verify is recorded and queryable via the Audit page with date-range and action-type filters.

### Real-time Events

A persistent WebSocket (`/api/v1/ws/events`) pushes `vm_list_updated`, `hypervisor_status`, and audit events to all connected browsers. The poller runs in the background every `REDIS_VM_POLL_INTERVAL` seconds.

### VM Console (Screenshot Stream)

The **Console** button on any running VM opens an in-browser screenshot viewer:

1. Frontend calls `POST /api/v1/servers/{id}/vms/{name}/console-token` — receives a 60-second one-time token.
2. Frontend opens a WebSocket to `/api/v1/ws/console/{token}`.
3. Backend validates the token from Redis, then polls the Hyper-V host via WinRM, capturing a JPEG screenshot ~every second using `System.Drawing` + Hyper-V WMI.
4. Each frame is sent as `{ type: "frame", data: "<base64-jpeg>" }`.
5. The modal renders a live `<img>` tag updated at each frame.

> **Note:** This is a **read-only** view. For full interactive keyboard/mouse console, use `VMConnect.exe` on the Hyper-V host directly, or configure an Enhanced Session / RDP session.

---

## API Reference

Full interactive docs are generated automatically by FastAPI:

| Interface  | URL                                     |
|------------|-----------------------------------------|
| Swagger UI | `http://<host>:8001/api/docs`           |
| ReDoc      | `http://<host>:8001/api/redoc`          |
| OpenAPI    | `http://<host>:8001/api/openapi.json`   |

### Endpoint Groups (`/api/v1/...`)

| Group     | Path prefix             | Key endpoints                                              |
|-----------|-------------------------|------------------------------------------------------------|
| Auth      | `/auth`                 | `POST /login`, `POST /change-password`                     |
| VMs       | `/vms`                  | List, create, delete, action, checkpoints                  |
| Servers   | `/servers`              | Register, verify-credentials, drives, ISOs, upload, eject-cd, console-token |
| Folders   | `/folders`              | CRUD, quota management, hypervisor assignment              |
| Users     | `/users`                | User CRUD, groups, permissions                             |
| Audit     | `/audit`                | Paginated audit log with filters                           |
| WebSocket | `/ws/events`            | Real-time VM status push (subscribe)                       |
| WebSocket | `/ws/console/{token}`   | VM screenshot stream (one-shot, token-authenticated)       |
| Health    | `/health`               | Liveness probe                                             |

---

## Project Structure

```
HyperVisorsApp/
├── docker-compose.yml          # Orchestrates all services
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example            # Copy to .env and fill in secrets
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   │       └── 0001_initial.py # Idempotent migration (safe to re-run)
│   └── app/
│       ├── main.py             # FastAPI app factory + lifespan
│       ├── api/
│       │   ├── auth.py         # Login, token, change-password
│       │   ├── vms.py          # VM list, actions, checkpoints
│       │   ├── servers.py      # Hypervisor CRUD + ISO/drive/upload/eject/console-token
│       │   ├── folders.py      # Folder + quota management
│       │   ├── users.py        # User + group + permission management
│       │   ├── audit.py        # Audit log query
│       │   └── websocket.py    # /ws/events + /ws/console/{token}
│       ├── core/
│       │   ├── config.py       # Pydantic settings
│       │   ├── database.py     # Async SQLAlchemy engine + session
│       │   ├── security.py     # JWT encode/decode, password hashing
│       │   ├── cache.py        # Redis helpers (get/set/delete/pattern)
│       │   └── events.py       # WebSocket broadcast bus
│       ├── models/             # SQLAlchemy ORM models
│       └── services/
│           ├── hyperv_service.py  # All WinRM/PowerShell calls
│           ├── poller.py          # Background VM polling
│           ├── quota_service.py   # Pre-flight quota checks
│           ├── audit_service.py   # Audit record helper
│           └── user_service.py    # User CRUD helpers
└── frontend/
    ├── Dockerfile
    ├── nginx.conf              # Production Nginx config (SPA + API proxy)
    ├── vite.config.ts          # Vite dev server + proxy config
    ├── package.json
    └── src/
        ├── App.tsx             # Routes (React Router)
        ├── pages/
        │   ├── LoginPage.tsx
        │   ├── VMsPage.tsx         # VM table + actions
        │   ├── ServersPage.tsx     # 2-step server registration + management
        │   ├── FoldersPage.tsx     # Folders tab + Storage Quotas tab
        │   ├── UsersPage.tsx       # Users, Groups, Permissions tabs
        │   └── AuditPage.tsx       # Audit log viewer
        ├── components/
        │   ├── vms/
        │   │   ├── CreateVMModal.tsx   # ISO picker, multi-NIC, drive selector
        │   │   ├── CheckpointPanel.tsx # Snapshot slide-in panel
        │   │   └── ConsoleModal.tsx    # WS screenshot-stream console viewer
        │   ├── auth/
        │   │   └── ChangePasswordModal.tsx
        │   ├── layout/
        │   │   └── AppShell.tsx    # Navigation sidebar + header
        │   └── shared/
        │       └── PageHeader.tsx
        ├── stores/             # Zustand (auth, theme, event bus)
        ├── hooks/
        │   └── useWebSocket.ts # Live event subscription hook
        └── lib/
            └── api.ts          # Axios client + typed API surface
```

---

## Default Credentials

On first startup the application bootstraps a super-admin account:

| Field    | Default (docker-compose)   |
|----------|----------------------------|
| Email    | `admin@corp.local`         |
| Password | `ChangeMe@123`             |

> **Change these immediately.** Edit `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in `backend/.env` (or in `docker-compose.yml`) before deploying to any shared environment.

---

## Port Reference

### Application (Linux server — host ports)

| Service         | Host Port | Container Port | Notes                           |
|-----------------|-----------|----------------|---------------------------------|
| Frontend (UI)   | **5173**  | 80             | Nginx in Docker; Vite in dev    |
| Backend (API)   | **8001**  | 8000           | FastAPI / uvicorn               |
| PostgreSQL      | **5433**  | 5432           | Exposed for local DB tooling    |
| Redis           | **6379**  | 6379           | Exposed for local inspection    |

### Hyper-V Windows Hosts (required inbound)

| Service  | Port | Notes                                       |
|----------|------|---------------------------------------------|
| WinRM    | 5985 | HTTP — required for VM polling and console  |
| WinRM    | 5986 | HTTPS — recommended for production          |

---

## Troubleshooting

### App won't start — Docker build fails

```bash
docker compose logs --tail=50 api
docker compose logs --tail=50 ui
```

Common causes:
- `npm install` fails — check Node.js version in frontend `Dockerfile`
- Alembic migration fails — check `DATABASE_URL` and that PostgreSQL is healthy
- `pypsrp` import error — ensure Python 3.10+ and the package is in `requirements.txt`

### WinRM connection refused

```bash
# From the Linux server:
curl -v http://<hyper-v-ip>:5985/wsman
```

If this times out, WinRM is not listening. Re-run the WinRM setup steps on the Windows host.

### VM list is empty after registering a server

The background poller runs every `REDIS_VM_POLL_INTERVAL` seconds. Wait up to 30 seconds and refresh.
If still empty, check `docker compose logs api` for WinRM errors.

### Console shows "Console unavailable"

- Ensure the VM is in **Running** state
- Ensure `System.Drawing` is available on the Hyper-V host (it is on Server 2016+)
- Check that the WinRM service account has **Hyper-V Administrator** rights
- The console token is valid for 60 seconds — click **Reconnect** if it expired

### Quota violations on VM create

Storage Quotas can be managed on the **Folders → Storage Quotas** tab. The pre-flight check uses cached data — if you recently freed space, wait for the next poll cycle or clear the Redis cache.
