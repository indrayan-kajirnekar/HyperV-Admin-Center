# HyperVision — Hyper-V Admin Center

A full-stack web application for centrally managing multiple Microsoft Hyper-V hosts. Monitor virtual machines, manage folders, control users, and stream live events — all from one browser tab.

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
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Default Credentials](#default-credentials)
- [Port Reference](#port-reference)

---

## Architecture Overview

```
Browser (React SPA)
      │  :5173 (dev Vite) / :5173 (Docker Nginx)
      ▼
  Nginx (frontend container)
      │  reverse-proxies /api/* → api:8000
      ▼
  FastAPI (backend container) :8000
      │
      ├── PostgreSQL :5432   (persistent store)
      └── Redis      :6379   (cache + pub/sub)
```

The frontend is a React + TypeScript SPA served by Nginx in production and by the Vite dev server in development mode. The backend is a FastAPI application with async SQLAlchemy, background polling of Hyper-V hosts via WinRM/PowerShell remoting, and WebSocket push for live VM status updates.

---

## Tech Stack

| Layer      | Technology                                           |
|------------|------------------------------------------------------|
| Frontend   | React 18, TypeScript, Vite, TailwindCSS, TanStack Query, Zustand |
| Backend    | Python 3.12, FastAPI, SQLAlchemy (async), Alembic    |
| Database   | PostgreSQL 16                                        |
| Cache      | Redis 7                                              |
| Hyper-V    | WinRM / PowerShell Remoting (`pypsrp`, `aiowmi`)     |
| Auth       | JWT (HS256, configurable expiry)                     |
| Container  | Docker + Docker Compose                              |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker Engine ≥ 24 + Compose v2)
- For local dev without Docker:
  - Python 3.12+
  - Node.js 20+ with npm / pnpm
  - A running PostgreSQL 16 instance
  - A running Redis 7 instance

---

## Quick Start (Docker Compose)

```bash
# 1. Clone the repository
git clone <repo-url>
cd HyperVisorsApp

# 2. Create backend environment file
cp backend/.env.example backend/.env
#    Open backend/.env and set at minimum:
#      APP_SECRET_KEY  — generate with: python -c "import secrets; print(secrets.token_hex(32))"
#      HYPERV_HOSTS    — comma-separated Hyper-V host FQDNs/IPs
#      HYPERV_USERNAME — WinRM service-account  (DOMAIN\\username)
#      HYPERV_PASSWORD — WinRM service-account password

# 3. Start all services
docker compose up --build -d

# 4. Open the app
#    Frontend  → http://localhost:5173
#    API Docs  → http://localhost:8000/api/docs
```

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
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure env
cp .env.example .env

# Apply database migrations
alembic upgrade head

# Run the development server
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

| Variable                  | Default                              | Description                                      |
|---------------------------|--------------------------------------|--------------------------------------------------|
| `APP_NAME`                | `HyperVision`                        | Application display name                         |
| `APP_ENV`                 | `production`                         | Environment tag (`development` / `production`)   |
| `APP_SECRET_KEY`          | *(required)*                         | 256-bit random key for JWT signing               |
| `APP_DEBUG`               | `false`                              | Enable debug logging                             |
| `APP_PORT`                | `8000`                               | Backend listening port                           |
| `DATABASE_URL`            | `postgresql+asyncpg://...`           | Async PostgreSQL connection string               |
| `REDIS_URL`               | `redis://localhost:6379/0`           | Redis connection URL                             |
| `REDIS_TTL_SECONDS`       | `30`                                 | VM data cache TTL                                |
| `REDIS_VM_POLL_INTERVAL`  | `15`                                 | Background poll interval (seconds)               |
| `JWT_ALGORITHM`           | `HS256`                              | JWT signing algorithm                            |
| `JWT_EXPIRE_MINUTES`      | `480`                                | Token lifetime (8 hours)                         |
| `HYPERV_HOSTS`            | *(comma-separated FQDNs)*            | Hyper-V hosts to manage                          |
| `HYPERV_USERNAME`         | `DOMAIN\\svc-hypervision`            | WinRM service account                            |
| `HYPERV_PASSWORD`         | *(required)*                         | WinRM service account password                   |
| `CORS_ORIGINS`            | `http://localhost:5173`              | Comma-separated allowed CORS origins             |
| `BOOTSTRAP_ADMIN_EMAIL`   | `indrayan@corp.local`                | Super-admin email seeded on first startup        |
| `BOOTSTRAP_ADMIN_PASSWORD`| *(required)*                         | Super-admin initial password                     |
| `BOOTSTRAP_ADMIN_NAME`    | `Indrayan`                           | Super-admin display name                         |

---

## API Reference

Full interactive docs are generated automatically by FastAPI:

| Interface  | URL                              |
|------------|----------------------------------|
| Swagger UI | `http://localhost:8000/api/docs` |
| ReDoc      | `http://localhost:8000/api/redoc`|
| OpenAPI    | `http://localhost:8000/api/openapi.json` |

### Endpoint Groups (`/api/v1/...`)

| Group       | Path prefix             | Description                              |
|-------------|-------------------------|------------------------------------------|
| Auth        | `/api/v1/auth`          | Login, token refresh, password change    |
| VMs         | `/api/v1/vms`           | List, start, stop, checkpoint VMs        |
| Servers     | `/api/v1/servers`       | Register / manage Hyper-V hosts          |
| Folders     | `/api/v1/folders`       | Organise VMs into logical folders        |
| Users       | `/api/v1/users`         | User CRUD and role management            |
| Audit       | `/api/v1/audit`         | Audit log query                          |
| WebSocket   | `/api/v1/ws`            | Real-time VM status push                 |
| Health      | `/health`               | Liveness probe                           |

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
│   │   └── versions/           # Database migration scripts
│   └── app/
│       ├── main.py             # FastAPI app factory + lifespan
│       ├── api/                # Route handlers (auth, vms, servers, …)
│       ├── core/               # Config, database, security, cache, events
│       ├── models/             # SQLAlchemy ORM models
│       └── services/           # Business logic (hyperv, poller, audit, …)
└── frontend/
    ├── Dockerfile
    ├── nginx.conf              # Production Nginx config (SPA + proxy)
    ├── vite.config.ts          # Vite + dev-proxy config
    ├── package.json
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── pages/              # LoginPage, VMsPage, ServersPage, …
        ├── components/         # Shared UI + feature components
        ├── stores/             # Zustand global state (auth, theme, events)
        ├── hooks/              # Custom React hooks (useWebSocket, …)
        └── lib/                # Axios API client
```

---

## Default Credentials

On first startup the application bootstraps a super-admin account using the values in `.env`:

| Field    | Value (from `.env.example`) |
|----------|-----------------------------|
| Email    | `indrayan@corp.local`        |
| Password | `Indrayan@123pswd`           |

> **Change these immediately** in `backend/.env` before deploying to any shared or production environment.

---

## Port Reference

| Service         | Host Port | Container Port | Notes                          |
|-----------------|-----------|----------------|--------------------------------|
| Frontend (UI)   | **5173**  | 80             | Nginx in Docker; Vite in dev   |
| Backend (API)   | 8000      | 8000           | FastAPI / uvicorn              |
| PostgreSQL      | 5432      | 5432           | Exposed for local DB tooling   |
| Redis           | 6379      | 6379           | Exposed for local inspection   |
