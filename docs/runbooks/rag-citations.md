# Citations: Myskin → RAGFlow → Dify → Spliffy

End-to-end guide for **source link chips** in Spliffy chat (similar to RAGFlow chat citation buttons).

**Ops runbook (infra, myskin sync, RAGFlow troubleshooting):** [infra-files `docs/ragflow-myskin/jbi-sv-01_ragflow-myskin-runbook.md`](../../../infra-files/docs/ragflow-myskin/jbi-sv-01_ragflow-myskin-runbook.md)

## Pipeline

```mermaid
flowchart LR
    MS[myskin crawl] -->|push + meta_fields| RF[RAGFlow dataset]
    RF -->|external KB retrieval| DF[Dify app]
    DF -->|SSE message_end.metadata.retriever_resources| SP[Spliffy UI]
```

| Layer | Responsibility |
|-------|----------------|
| **myskin** | Crawl docs; write `source_url` in frontmatter; push files to RAGFlow; set `meta_fields` via `PUT` |
| **RAGFlow** | Chunk + embed; attach `meta_fields` to retrieval references |
| **Dify** | External Knowledge API → RAGFlow; **Citation and Attribution** enabled |
| **Spliffy** | Parse `message_end.metadata.retriever_resources`; render `CitationSources` chips |

---

## 1. Myskin → RAGFlow metadata

### How it works

Push sync (`ragflow.enabled: true`):

1. `POST /api/v1/datasets/{id}/documents` — upload file bytes (filename keeps extension, e.g. `.md`)
2. `PUT /api/v1/datasets/{id}/documents/{doc_id}` — **`meta_fields` only** (no `name` rename)
3. Unchanged files still get step 2 on every sync (metadata refresh)

### `meta_fields` map

| Field | Purpose |
|-------|---------|
| `url` | Primary citation link (RAGFlow convention) |
| `source_url` | Original crawled page (`edu.gov.cz/…`) |
| `file_url` | myskin `GET /api/files/{id}` |
| `title` | Human-readable title (not RAGFlow document `name`) |
| `author`, `category`, `format`, `myskin_id` | Traceability |

### Manual sync

**POST only** — GET returns `405 Method Not Allowed`:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $MYSKIN_API_TOKEN" \
  "https://edu-gov-cz.myskin.catania-service.cz/api/ragflow/sync" | jq
```

Keep the Bearer token on **one line** (line breaks in the token cause 401).

### Myskin metadata troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Method Not Allowed` | GET instead of POST | `curl -X POST …` |
| `The extension of file can't be changed` | Old code sent `name: <title>` without `.md` | Upgrade myskin; redeploy; re-sync |
| HTTP 200 + warning in logs | RAGFlow JSON `code != 0` inside 200 response | Read warning message; usually `name` issue above |
| Empty metadata in RAGFlow UI | Sync before metadata support | `POST /api/ragflow/sync` after upgrade |
| `source_url` null in catalog | Missing frontmatter on crawled file | Re-crawl or fix writer |

Verify:

```bash
curl -sS -H "Authorization: Bearer $MYSKIN_API_TOKEN" \
  'https://edu-gov-cz.myskin.catania-service.cz/api/documents?limit=1' \
  | jq '.items[0] | {id, title, source_url, file_url}'
```

---

## 2. Dify ↔ RAGFlow

In Dify admin:

1. **Knowledge → External Knowledge API** — `http://<ragflow-host>:9380/api/v1/dify` (Dify appends `/retrieval`).
2. **Connect external knowledge** — RAGFlow dataset ID as External Knowledge ID.
3. **App → Features** — enable **Citation and Attribution** (`retriever_resource.enabled`).
4. Chatflow: **Knowledge Retrieval** node wired to that external KB.

Dify maps RAGFlow `meta_fields` → `retriever_resources[].doc_metadata` on `message_end`.

**Known RAGFlow caveat:** on very large datasets, custom metadata may not propagate to Dify for all documents ([discussion #13626](https://github.com/orgs/infiniflow/discussions/13626)). Verify in RAGFlow UI first, then in Dify logs/SSE.

---

## 3. Spliffy implementation

### SSE event

Citations arrive on **`message_end`**, not a separate `retriever_resources` event:

```json
{
  "event": "message_end",
  "metadata": {
    "retriever_resources": [
      {
        "position": 1,
        "document_name": "job--zakladni-skola-….md",
        "content": "chunk text…",
        "score": 0.92,
        "doc_metadata": {
          "url": "https://edu.gov.cz/…",
          "source_url": "https://edu.gov.cz/…",
          "file_url": "https://edu-gov-cz.myskin.catania-service.cz/api/files/…",
          "title": "…"
        }
      }
    ]
  }
}
```

### Code map

| File | Role |
|------|------|
| `frontend/src/lib/chat.ts` | `DifyRetrieverResource`, `metadata` on `DifyStreamEvent` |
| `frontend/src/lib/streamState.ts` | `parseRetrieverResources()`, `Message.citations` |
| `frontend/src/components/CitationSources.tsx` | Numbered chips + external link icon |
| `backend/app/dify/routes.py` | Passes `citations_enabled`; wraps SSE with `StreamEnricher` |
| `backend/app/dify/stream_enricher.py` | Injects `retriever_resources` on `message_end` from agent_log chunks |
| `backend/app/dify/ragflow_citations.py` | Parses RAGFlow tool responses; fetches document `meta_fields` |
| `backend/app/dify/zpl_citations.py` | Parses `get_law_excerpt` tool JSON → citation resources |
| `backend/app/dify/tool_labels.py` | Localized friendly labels for agent tool names |
| `backend/app/settings.py` | `dify.show_sources`, optional `ragflow.*`, `tool_labels.*`, `ui_strings.*` |
| `frontend/src/lib/chat.ts` | Sends UI `locale` with chat requests |

### Config

```yaml
dify:
  show_sources: true
  markdown: true

# When Dify agent retrieval does not populate message_end.retriever_resources,
# enable RAGFlow lookup from document_id in agent_log tool responses:
ragflow:
  enabled: true
  api_url: http://10.0.1.133:9380
  api_key: ${RAGFLOW_API_KEY}
  default_dataset_id: "<ragflow-dataset-id>"
  dataset_name: edu-gov-cz

tool_labels:
  enabled: true
  default_locale: cs
  tools:
    get_law_excerpt:
      cs: "Ověřuji legislativu: {{reference}} § {{paragraph}}"
```

Spliffy shows chips when **both** `show_sources: true` and Dify `retriever_resource.enabled` are on. With `ragflow.enabled: true`, Spliffy can also synthesize citations from agent tool logs when Dify omits them.

### ZPL MCP (`get_law_excerpt`)

When the Dify agent calls **zpl-mcp** `get_law_excerpt`, Spliffy parses the tool response JSON and builds a `retriever_resources` entry from:

- **`url`** — zakonyprolidi.cz page URL, preferably with `#f…` § fragment (from zpl-adapter)
- **`excerpt`** — short text snippet (Dify-safe field name; not `text`)
- **`reference`**, **`paragraph`** — for chip titles / tool labels

ZPL and RAGFlow sources are merged on `message_end` (`merge_citation_resources` in `stream_enricher.py`). Configure the Dify agent to cite with in-text markdown links — see [§5 Inline citations](#5-inline-citations-intext-nurl).

### Tool labels

With `tool_labels.enabled: true`, Spliffy rewrites `agent_thought` / tool-call labels in the SSE stream before they reach the browser. Templates live under `tool_labels.tools.<tool_name>.<locale>` in `config.yaml`. Locale is resolved from the chat POST body (`locale`) or `Accept-Language`.

### UI strings (composer footer)

Per-instance footer text (e.g. AI disclaimer) via bind-mounted `ui_strings/` locale YAML — no image rebuild. See [ui-strings.md](./ui-strings.md).

### Link resolution order

1. `doc_metadata.url`
2. `doc_metadata.source_url`
3. `doc_metadata.file_url`

Chips without a URL are expandable to show the retrieved snippet.

---

## 4. Debugging checklist

| Symptom | Check |
|---------|-------|
| No chips in Spliffy | DevTools → Network → SSE → last `message_end` has `retriever_resources`? |
| Empty `retriever_resources` | Dify citations enabled; KB retrieval node actually ran |
| Chips without links | `doc_metadata.url` empty → RAGFlow metadata → myskin sync |
| `citations_enabled: false` | `GET /api/chat/parameters` — enable in Dify app |
| Metadata in RAGFlow, not Dify | External KB ID; RAGFlow version / pagination bug |
| Wrong URL | myskin frontmatter `source_url` on source file |
| Law chips missing / wrong link | zpl-mcp returns `excerpt` + `url` with `#f…`; agent must use tool URL in `[n](url)` |
| Raw tool names in UI | Enable `tool_labels.enabled`; check chat request `locale` |

### Quick tests

```bash
# Spliffy: citations gate
curl -sS https://sofie-dev.chat.catania-service.cz/api/chat/parameters | jq '.citations_enabled'

# Spliffy: sources config
curl -sS https://sofie-dev.chat.catania-service.cz/api/chat/config | jq '.show_sources, .ui_strings'
```

During chat: browser DevTools → `POST /api/chat/messages` → filter SSE for `message_end`.

---

## 5. Inline citations (`[n](url)`)

Spliffy renders in-text markdown links whose label is **only a number** as styled citation pills inside the assistant bubble. Footer chips remain the canonical source list.

**Important:** Spliffy does **not** trust tool-call order for numbering. It parses `[n](url)` from the answer text and **reorders `retriever_resources`** so chip `[1]` matches the model’s first in-text citation.

Paste into the Dify agent / LLM instructions:

```text
When you cite evidence, use markdown links whose label is only the citation number and whose URL is the exact URL from a tool result (including any #fragment for laws):

Podle školského zákona[1](https://www.zakonyprolidi.cz/cs/2004-561#f123) platí …

Rules:
- Number citations in the order you first use them: 1, 2, 3, …
- Label must be only the number (e.g. [1](https://…)), never the document title inside the brackets.
- Always copy the real URL returned by the tool — never invent or guess URLs.
- For zákonyprolidi.cz prefer the deep-link URL with #f… when the tool provides it.
- Reuse the same number if you cite the same URL again.
- Do not invent citation numbers that have no matching tool URL.
```

---

## Related runbooks

- [agent-realtime-streaming.md](./agent-realtime-streaming.md) — SSE events, thinking panel
- [infra RAGFlow ↔ myskin runbook](../../../infra-files/docs/ragflow-myskin/jbi-sv-01_ragflow-myskin-runbook.md) — push sync, hosts, REST connector override, timezone
- [zpl-mcp README](../../../zpl-mcp/README.md) — `get_law_excerpt`, Dify timeouts, `ZPL_MCP_BULK_TOOLS`
- [myskin instances README](../../../infra-files/servers/jbi-sv-00/myskin/instances/README.md) — deploy + first sync
