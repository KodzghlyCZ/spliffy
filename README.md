# Spliffy

React frontend + FastAPI backend.

## Project structure

```
spliffy/
├── backend/     # FastAPI API
└── frontend/    # React (Vite + TypeScript)
```

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

Configuration is loaded from `backend/config.yaml` via [yayaya](https://pypi.org/project/yayaya/). Override the path with `SPLIFFY_CONFIG`. Environment placeholders like `${OIDC_CLIENT_SECRET}` are expanded at load time.

Copy `config.yaml.example` to `config.yaml` and set `auth.enabled: true` to turn on Keycloak OIDC login.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173

The Vite dev server proxies `/api/*` to the FastAPI backend on port 8000.

## Authentication (optional)

Auth is disabled by default. When enabled, the backend runs a standard OIDC authorization-code flow against Keycloak and stores the session in a signed cookie.

| Endpoint | Description |
|----------|-------------|
| `GET /auth/config` | Whether auth is enabled (+ login URL) |
| `GET /auth/login` | Redirect to Keycloak |
| `GET /auth/callback` | OIDC callback (configure in Keycloak) |
| `GET /auth/me` | Current user or 401 |
| `POST /auth/logout` | Clear session |

During local development, set `redirect_uri` to `http://localhost:5173/api/auth/callback` so the session cookie is issued on the frontend origin (via the Vite proxy).

### Keycloak client setup

1. Create a client with **Standard flow** enabled.
2. Set **Valid redirect URIs** to your `redirect_uri` value.
3. Set **Web origins** to your frontend origin (e.g. `http://localhost:5173`).
4. Export the client secret into `OIDC_CLIENT_SECRET`.

### Environment variables

```bash
export SESSION_SECRET=your-random-secret
export OIDC_CLIENT_SECRET=your-keycloak-client-secret
```
