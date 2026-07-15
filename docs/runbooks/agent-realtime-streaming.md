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
| Thinking UI | `frontend/src/components/ThinkingPanel.tsx` | Cursor-style reasoning + tool activity |
| Workflow UI | `frontend/src/components/WorkflowProgress.tsx` | Node stepper for Chatflow apps |

## Dify SSE Events

Spliffy handles the following Dify streaming events. All others are received but ignored.

### Answer text (streamed into the assistant bubble)

| Event | Dify app type | Payload field |
|-------|---------------|---------------|
| `message` | Basic Chat | `answer` |
| `agent_message` | Agent | `answer` |
| `text_chunk` | Advanced Chat / Chatflow | `data.text` |

### Thinking / reasoning (shown in `ThinkingPanel`)

Different Dify app types emit thoughts through different events:

| Event | Dify source | Fields used | UI effect |
|-------|-------------|-------------|-----------|
| `agent_thought` | Agent apps | `thought`, `tool`, `tool_input`, `observation` | Reasoning lines + compact tool actions |
| `agent_log` | Agent nodes in Chatflow | `label`, `metadata.thought`, `metadata.action`, `data` | ReAct rounds, model thoughts, tool calls |
| `reasoning_chunk` | LLM nodes (`reasoning_format: separated`) | `data.reasoning` | Live streaming chain-of-thought prose |
| `node_finished` | LLM nodes | `data.outputs.reasoning_content` | Batch reasoning when node completes |

**Important:** If you see workflow nodes but no thoughts, your Chatflow likely emits `agent_log` or `reasoning_chunk` — not `agent_thought`. Spliffy handles all of these.

#### Dify configuration for visible thoughts

| What you want | Dify setup |
|---------------|------------|
| Agent tool/reasoning chain in Chatflow | Use an **Agent node** — emits `agent_log` automatically |
| LLM chain-of-thought streaming | Set LLM node **Reasoning format** to **Separated** — emits `reasoning_chunk` |
| Standalone Agent app thoughts | Use an **Agent** app — emits `agent_thought` |

### Workflow progress (Advanced Chat / Chatflow)

| Event | Fields used | UI effect |
|-------|-------------|-----------|
| `node_started` | `data.id`, `data.node_id`, `data.title`, `data.node_type` | Add/update node as **running** |
| `node_finished` | `data.status`, `data.elapsed_time` | Mark node **succeeded** / **failed** / **stopped** |

When thinking activity is present, workflow progress collapses to a compact summary so thoughts remain the focus.

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
  content: string              // final answer text
  reasoning: string            // accumulated reasoning_chunk / reasoning_content
  items: ThinkingItem[]        // agent_log + derived agent_thought entries
  steps: AgentStep[]             // raw agent_thought state
  workflowNodes: WorkflowNode[]
  streaming: boolean
}
```

Stream events are applied via `applyStreamEvent()` in `frontend/src/lib/streamState.ts`. This is a pure function called from the `onEvent` callback in `Chat.tsx`.

## UI Behaviour

### ThinkingPanel (Cursor-style)

The thinking UI is designed to feel like Cursor's inline reasoning display:

1. **Left accent bar** with a compact header ("Thinking" while live, "Thought" when done).
2. **Streaming prose** — `reasoning_chunk` text appears as muted narrative with a blinking cursor.
3. **Compact action lines** — tool calls shown as `→ Used {tool}` rather than raw JSON.
4. **Details on demand** — tool inputs hidden behind a small "Details" expander.
5. **Auto-expand while streaming**, collapsible when complete.
6. **Auto-scroll** — the thinking body scrolls as new content arrives.

### While streaming

1. **Typing dots** — shown only when there is no answer text and no thinking/workflow activity yet.
2. **ThinkingPanel** — primary focus for reasoning and tool activity.
3. **WorkflowProgress** — compact/collapsible when thinking is active; shows current running node.
4. **Answer bubble** — fills incrementally from `message`, `agent_message`, or `text_chunk`.

### After streaming completes

1. `streaming` flag set to `false` on stream end (or `message_end` / `workflow_finished`).
2. **ThinkingPanel** collapses to a "Thought · N steps" header (click to expand).
3. Answer text remains in the bubble.

## Configuration

Spliffy connects to a Dify **Chat App** via `backend/config.yaml`:

```yaml
dify:
  enabled: true
  name: Spliffy
  markdown: false
  base_url: http://127.0.0.1/v1
  api_key: ${DIFY_API_KEY}
```

Set `dify.markdown: true` to render assistant responses (and the opening statement) as Markdown. Disabled by default. Verify with `GET /chat/config` — the response must include `"markdown": true`. Settings are re-read on each request (no restart needed after editing the mounted config).

The Dify app type determines which events you will see:

| Dify app type | Expected events | Spliffy UI |
|---------------|-----------------|------------|
| Basic Chat | `message` | Answer text only |
| Agent | `agent_message`, `agent_thought` | Answer + ThinkingPanel |
| Advanced Chat / Chatflow (LLM) | `text_chunk`, `reasoning_chunk`, `node_*` | Answer + ThinkingPanel + WorkflowProgress |
| Advanced Chat / Chatflow (Agent node) | `agent_log`, `node_*` | Answer + ThinkingPanel + WorkflowProgress |

## Validation Checklist

Use this after deploy or when debugging missing realtime UI.

1. **Confirm Dify app type and node types** — Agent app vs Chatflow with Agent/LLM nodes.
2. **Check Dify node settings** — LLM nodes need `reasoning_format: separated` for `reasoning_chunk`.
3. **Send a message that triggers tools or reasoning**.
4. **Inspect raw SSE** in browser DevTools → Network → `POST /api/chat/messages`:
   - Response type should be `text/event-stream`.
   - Look for `reasoning_chunk`, `agent_log`, `agent_thought`, or `node_started` events.
5. **Verify Spliffy UI**:
   - "Thinking" panel appears with streaming prose and/or tool lines.
   - Workflow nodes appear in compact stepper (if Chatflow).
   - Answer streams into the bubble.
6. **Check proxy buffering** (production behind nginx/CDN):
   - Backend sends `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
   - If events arrive in DevTools but UI updates in one batch, suspect proxy buffering.

## Troubleshooting

### Workflow shows but no thoughts (most common)

**Symptom:** Workflow node stepper works, but no "Thinking" panel appears.

**Cause:** Chatflow apps do not emit `agent_thought`. Thoughts come from other events.

**Checks:**
1. Inspect SSE for `agent_log` events (Agent nodes) or `reasoning_chunk` (LLM nodes with separated reasoning).
2. For LLM nodes: set **Reasoning format → Separated** in the Dify workflow editor.
3. For Agent nodes: ensure the workflow uses an **Agent node** (not just an LLM node) — Agent nodes emit `agent_log` with `ROUND N` and thought metadata.
4. If only `node_finished` arrives with `outputs.reasoning_content`, thoughts appear when the node completes (not incrementally).

### Answer never appears (Agent app)

**Symptom:** ThinkingPanel shows activity but the answer bubble stays empty.

**Cause:** Dify Agent mode emits `agent_message`, not `message`. Spliffy handles both — if this still fails, check raw SSE for the event name Dify is actually sending.

### No thought/tool UI at all

**Symptom:** Only answer text appears; no ThinkingPanel.

**Checks:**
- Basic Chat apps do not emit thinking events.
- Inspect SSE — if no `agent_thought`, `agent_log`, or `reasoning_chunk` events arrive, the Dify app/nodes are not configured for reasoning output.
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
| Citations / RAG sources | `message_end.metadata.retriever_resources` | `CitationSources` component — see [`rag-citations.md`](./rag-citations.md) |
| File attachments | `message_file` | Render download links in assistant bubble |
| Paused workflows (human-in-the-loop) | `workflow_paused` | New endpoint + resume UI |
| Normalized event schema | Backend transform | Optional layer in `routes.py` if Dify schema drifts |

## Related Files

- `frontend/src/lib/chat.ts` — SSE transport + `DifyStreamEvent` types
- `frontend/src/lib/streamState.ts` — event reducer + message types
- `frontend/src/components/Chat.tsx` — stream handler wiring
- `frontend/src/components/ThinkingPanel.tsx` — Cursor-style thinking UI
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

Point `backend/config.yaml` at your Dify instance, send a message that triggers agent tools or LLM reasoning, and watch DevTools Network for SSE events alongside the UI.
