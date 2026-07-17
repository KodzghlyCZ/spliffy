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

UI copy uses [i18next](https://www.i18next.com/) (`react-i18next`). Locale files live in `frontend/src/i18n/locales/` (currently `en`, `cs`). The header language toggle stores the choice in `localStorage` (`spliffy-lang`); otherwise the browser language is used.

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
export DIFY_API_KEY=your-dify-app-api-key
export RAGFLOW_API_KEY=your-ragflow-api-key   # optional, for agent-log citation enrichment
```

## Dify chat

Spliffy proxies the Dify **Chat App** API so the API key stays on the server. Enable it in `config.yaml`:

```yaml
dify:
  enabled: true
  name: My Assistant          # shown in the welcome screen and message labels
  markdown: false             # set true to render assistant replies as Markdown
  base_url: https://dify.example.com/v1   # self-hosted: include /v1
  api_key: ${DIFY_API_KEY}
```

After changing `markdown`, confirm `GET /chat/config` returns `"markdown": true`. You can also set `SPLIFFY_MARKDOWN=true` in the container environment as an override.

Create a **Chat App** in Dify, copy its API key from **API Access**, and set `DIFY_API_KEY` in the runtime `.env`. The backend streams responses from `POST /v1/chat-messages` to the browser via `POST /chat/messages`.

When auth is enabled, logged-in users are passed to Dify as `user` (Keycloak `sub`). Auth must be disabled or the user must be logged in to chat.

**Docker:** Spliffy runs in its own container. `localhost` inside that container is not Dify on the host. Either join the Dify compose network and use `http://api:5001/v1`, or reach Dify via `http://host.docker.internal:<published-port>/v1`.

| Endpoint | Description |
|----------|-------------|
| `GET /chat/config` | Whether Dify chat is configured, the chatbot display name, and Markdown rendering |
| `GET /chat/parameters` | Opening message and suggested questions from the Dify app |
| `POST /chat/messages` | Send a message (SSE stream) |

For **Agent** and **Advanced Chat (Chatflow)** apps, Spliffy renders agent thoughts, tool calls, and workflow node progress in realtime as Dify streams SSE events. See [docs/runbooks/agent-realtime-streaming.md](docs/runbooks/agent-realtime-streaming.md) for architecture, event reference, validation, and troubleshooting.

For **RAG citation source chips** (myskin → RAGFlow → Dify → Spliffy), see [docs/runbooks/rag-citations.md](docs/runbooks/rag-citations.md).

### Citation enrichment (RAGFlow + ZPL MCP)

When Dify agent apps omit `retriever_resources` on `message_end` (common with RAGFlow plugin retrieval), Spliffy can synthesize citation chips from **`agent_log`** tool responses:

| Source | Trigger | URL resolution |
|--------|---------|----------------|
| **RAGFlow** | `document_id` in retrieval tool JSON | RAGFlow API `meta_fields` (`url`, `source_url`, …) |
| **zpl-mcp** | successful `get_law_excerpt` JSON | `url` field (zakonyprolidi.cz, including `#f…` § deep links) |

Enable in `config.yaml`:

```yaml
dify:
  show_sources: true

ragflow:
  enabled: true
  api_url: http://10.0.1.133:9380
  api_key: ${RAGFLOW_API_KEY}
  default_dataset_id: "<dataset-id>"
  dataset_name: edu-gov-cz
```

Set `RAGFLOW_API_KEY` in runtime `.env`. RAGFlow and ZPL sources are merged and deduplicated in the footer chip list.

### Tool labels (agent UX)

Rewrite raw Dify tool names in the SSE stream into localized status lines (e.g. “Hledám v dokumentech: …”). Locale comes from the chat request (`locale` field / `Accept-Language`), defaulting to `tool_labels.default_locale`.

```yaml
tool_labels:
  enabled: true
  default_locale: cs
  default:
    cs: "Používám {{tool}}"
    en: "Using {{tool}}"
  tools:
    retrieval:
      cs: "Hledám v dokumentech: {{query}}"
      en: "Searching documents: {{query}}"
    get_law_excerpt:
      cs: "Ověřuji legislativu: {{reference}} § {{paragraph}}"
      en: "Evaluating law: {{reference}} § {{paragraph}}"
```

Placeholders depend on the tool (`{{query}}`, `{{reference}}`, `{{paragraph}}`, …). See `backend/app/dify/tool_labels.py`.

### UI locale + in-text citations

The frontend sends the selected UI language (`spliffy-lang` in `localStorage`) with each chat request. Assistant answers can embed markdown links `[1](https://…)`; Spliffy styles them as pills and **reorders footer chips** to match the model’s numbering (see runbook prompt in [rag-citations.md](docs/runbooks/rag-citations.md)).

### Production deploy (Catania)

All of the above ships in the **Spliffy GitLab image** — no compose bind-mount overrides for app code. After merging changes here: CI builds `registry.gitlab.catania-service.cz/catania_dev/spliffy`, then on the host `docker compose pull && docker compose up -d` from `infra-files/servers/jbi-sv-00/spliffy/instances/<name>/`.

## Docker

The image is a multi-stage build: Node builds the frontend, Python slim runs the API and serves static files from a single container (~180 MB).

```bash
docker build -t spliffy .
docker run --rm -p 8000:8000 \
  -e SESSION_SECRET=change-me \
  -v "$(pwd)/backend/config.yaml:/app/config.yaml:ro" \
  spliffy
```

Mount your production `config.yaml` at runtime — do not bake secrets into the image.

In production, set `auth.oidc.redirect_uri` to your public app URL (e.g. `https://spliffy.example.com/auth/callback`).

## GitLab CI

`.gitlab-ci.yml` builds and pushes to the GitLab Container Registry on every push to the default branch:

- `$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA`
- `$CI_REGISTRY_IMAGE:latest`

Enable **Container Registry** on the GitLab project. The job uses Docker-in-Docker and the built-in `CI_REGISTRY_*` credentials — no extra secrets required.

