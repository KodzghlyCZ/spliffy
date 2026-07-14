# Runbook: Agent & Workflow Realtime Streaming

This runbook documents how Spliffy surfaces Dify agent actions, thought process, and workflow progress in the chat UI in realtime.

## Overview

Spliffy is a thin chat shell (React + FastAPI) that proxies Dify's Chat App API. It does **not** run agents or workflows itself — Dify executes them and emits Server-Sent Events (SSE). Spliffy forwards those events to the browser and renders them as they arrive.

```
Browser  →  Spliffy backend (FastAPI)  →  Dify API
   ↑              SSE passthrough              POST /v1/chat-messages
   └──────────── text/event-stream ────────────┘
```

**Key design choice:** the backend is a transparent proxy. Event parsing and UI rendering happen in the frontend. This keeps Spliffy aligned with Dify's native event schema and avoids backend coupling to Dify version details.

## Architecture

| Layer | Path | Responsibility |
|-------|------|----------------|
| Dify proxy route | `backend/app/dify/routes.py` | Auth, user ID, SSE response with anti-buffering headers |
| Dify HTTP client | `backend/app/dify/client.py` | `POST /chat-messages` with `response_mode: "streaming"` |
| SSE client | `frontend/src/lib/chat.ts` | Fetch stream reader + SSE chunk parser |
| Stream state | `frontend/src/lib/streamState.ts` | Event → message state reducer |
| Chat UI | `frontend/src/components/Chat.tsx` | Message list, composer, stream handler |
| Agent UI | `frontend/src/components/AgentSteps.tsx` | Thought + tool call timeline |
| Workflow UI | `frontend/src/components/WorkflowProgress.tsx` | Node stepper for Chatflow apps |

## Dify SSE Events

Spliffy handles the following Dify streaming events. All others are received but ignored.

### Answer text (streamed into the assistant bubble)

| Event | Dify app type | Payload field |
|-------|---------------|---------------|
| `message` | Basic Chat | `answer` |
| `agent_message` | Agent | `answer` |
| `text_chunk` | Advanced Chat / Chatflow | `data.text` |

### Agent progress

| Event | Fields used | UI effect |
|-------|-------------|-----------|
| `agent_thought` | `id`, `position`, `thought`, `tool`, `tool_input`, `observation` | Upsert step in `AgentSteps` timeline |

Steps are keyed by `id` and sorted by `position`. Dify sends multiple `agent_thought` events for the same step as reasoning and tool results arrive; Spliffy merges them in place.

### Workflow progress (Advanced Chat / Chatflow)

| Event | Fields used | UI effect |
|-------|-------------|-----------|
| `node_started` | `data.id`, `data.node_id`, `data.title`, `data.node_type` | Add/update node as **running** |
| `node_finished` | `data.status`, `data.elapsed_time` | Mark node **succeeded** / **failed** / **stopped** |

### Lifecycle

| Event | UI effect |
|-------|-----------|
| `message_end` | Mark assistant message as no longer streaming; finalize open steps |
| `workflow_finished` | Same as above for workflow runs |
| `error` (Spliffy-generated) | Show error banner |

### Ignored (for now)

- `ping` — keepalive
- `message_file` — file attachments from tools
- `workflow_started` — no separate UI (nodes appear via `node_started`)
- `retriever_resources` — citations (future: `message_end.metadata`)

## Frontend Data Model

```typescript
type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string           // final answer text
  steps: AgentStep[]        // from agent_thought
  workflowNodes: WorkflowNode[]
  streaming: boolean
}
```

Stream events are applied via `applyStreamEvent()` in `frontend/src/lib/streamState.ts`. This is a pure function called from the `onEvent` callback in `Chat.tsx`.

## UI Behaviour

### While streaming

1. **Typing dots** — shown only when there is no answer text and no agent/workflow activity yet.
2. **AgentSteps** — expanded automatically; shows reasoning, tool inputs, and results as they arrive.
3. **WorkflowProgress** — lists nodes with live status as `node_started` / `node_finished` events arrive.
4. **Answer bubble** — fills incrementally from `message`, `agent_message`, or `text_chunk`.

### After streaming completes

1. `streaming` flag set to `false` on stream end (or `message_end` / `workflow_finished`).
2. **AgentSteps** collapses to a toggleable "Thought process" panel.
3. Answer text remains in the bubble.

## Configuration

Spliffy connects to a Dify **Chat App** via `backend/config.yaml`:

```yaml
dify:
  enabled: true
  name: Spliffy
  base_url: http://127.0.0.1/v1
  api_key: ${DIFY_API_KEY}
```

The Dify app type determines which events you will see:

| Dify app type | Expected events | Spliffy UI |
|---------------|-----------------|------------|
| Basic Chat | `message` | Answer text only |
| Agent | `agent_message`, `agent_thought` | Answer + AgentSteps |
| Advanced Chat / Chatflow | `text_chunk`, `node_started`, `node_finished` | Answer + WorkflowProgress |

Use a Dify **Agent** app to see thought/tool UI. Use an **Advanced Chat** (Chatflow) app to see workflow node progress.

## Validation Checklist

Use this after deploy or when debugging missing realtime UI.

1. **Confirm Dify app type** — Agent vs Chatflow determines event shape.
2. **Send a message that triggers tools** (Agent) or multiple workflow nodes (Chatflow).
3. **Inspect raw SSE** in browser DevTools → Network → `POST /api/chat/messages`:
   - Response type should be `text/event-stream`.
   - Look for `agent_thought`, `agent_message`, or `node_started` events.
4. **Verify Spliffy UI**:
   - Agent: "Thinking…" panel appears before/during answer.
   - Chatflow: node list appears with running → done transitions.
   - Answer streams into the bubble.
5. **Check proxy buffering** (production behind nginx/CDN):
   - Backend sends `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
   - If events arrive in DevTools but UI updates in one batch, suspect proxy buffering.

## Troubleshooting

### Answer never appears (Agent app)

**Symptom:** AgentSteps show activity but the answer bubble stays empty.

**Cause:** Dify Agent mode emits `agent_message`, not `message`. Spliffy handles both — if this still fails, check raw SSE for the event name Dify is actually sending.

### No thought/tool UI

**Symptom:** Only answer text appears; no AgentSteps panel.

**Checks:**
- Dify app must be **Agent** type (basic Chat apps do not emit `agent_thought`).
- Inspect SSE for `agent_thought` events — if absent, the agent may not be using tools/reasoning.
- If events are present in Network tab but not in UI, check browser console for JSON parse errors.

### No workflow node UI

**Symptom:** Chatflow app runs but no node list.

**Checks:**
- App must be **Advanced Chat** (Chatflow), not a basic Agent or Chat app.
- Inspect SSE for `node_started` / `node_finished`.
- Verify `data.id` and `data.title` are present in events.

### Events arrive late (batch update)

**Symptom:** UI jumps from empty to complete instead of streaming.

**Checks:**
- Reverse proxy buffering (nginx: `proxy_buffering off` for the SSE route).
- Confirm `X-Accel-Buffering: no` header reaches the client.
- Docker/load balancer may buffer — test direct to Spliffy backend.

### SSE connection errors

**Symptom:** Chat fails immediately or mid-stream.

**Checks:**
- Dify `base_url` and `api_key` in `config.yaml`.
- Dify service reachable from Spliffy backend.
- Auth: if Keycloak is enabled, user must be logged in.

## Production SSE Headers

`backend/app/dify/routes.py` sets:

```python
headers={
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}
```

If deploying behind nginx, also configure the upstream location:

```nginx
location /api/chat/messages {
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

## Extending Further

Priority extensions not yet implemented:

| Feature | Dify source | Suggested approach |
|---------|-------------|-------------------|
| Citations / RAG sources | `message_end.metadata.retriever_resources` | New `RetrieverCitations` component |
| File attachments | `message_file` | Render download links in assistant bubble |
| Paused workflows (human-in-the-loop) | `workflow_paused` | New endpoint + resume UI |
| Normalized event schema | Backend transform | Optional layer in `routes.py` if Dify schema drifts |

## Related Files

- `frontend/src/lib/chat.ts` — SSE transport + `DifyStreamEvent` types
- `frontend/src/lib/streamState.ts` — event reducer + message types
- `frontend/src/components/Chat.tsx` — stream handler wiring
- `frontend/src/components/AgentSteps.tsx` — agent thought/tool UI
- `frontend/src/components/WorkflowProgress.tsx` — workflow node UI
- `frontend/src/i18n/locales/en.json` / `cs.json` — UI strings
- `backend/app/dify/routes.py` — SSE endpoint
- `backend/app/dify/client.py` — Dify streaming client

## Local Development

```bash
# Backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev
```

Point `backend/config.yaml` at your Dify instance, send a message that triggers agent tools, and watch DevTools Network for SSE events alongside the UI.
