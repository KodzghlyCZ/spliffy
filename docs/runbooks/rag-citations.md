# Citations: Myskin → RAGFlow → Dify → Spliffy

End-to-end guide for source links in Spliffy chat (RAGFlow-style citation chips).

## Pipeline

```mermaid
flowchart LR
    MS[myskin crawl] -->|push + meta_fields| RF[RAGFlow dataset]
    RF -->|external KB retrieval| DF[Dify app]
    DF -->|SSE message_end.metadata.retriever_resources| SP[Spliffy UI]
```

| Layer | Responsibility |
|-------|----------------|
| **myskin** | Crawl docs; write `source_url` in frontmatter; push files to RAGFlow with `meta_fields` (`url`, `source_url`, `file_url`, `title`, …) |
| **RAGFlow** | Chunk + embed; attach `meta_fields` to retrieval references |
| **Dify** | External Knowledge API → RAGFlow; **Citation and Attribution** enabled |
| **Spliffy** | Parse `message_end.metadata.retriever_resources`; render `CitationSources` chips |

## 1. Myskin → RAGFlow metadata

Push sync (`ragflow.enabled: true`) uploads file bytes only unless metadata is set separately.

**Fix (myskin ≥ current):** after each upload, myskin calls:

`PUT /api/v1/datasets/{dataset_id}/documents/{document_id}`

with `meta_fields`:

| Field | Purpose |
|-------|---------|
| `url` | Primary citation link (RAGFlow chat convention) |
| `source_url` | Original crawled page URL |
| `file_url` | myskin `GET /api/files/{id}` download URL |
| `title`, `author`, `category`, `myskin_id` | Display / traceability |

**Re-sync existing docs** (metadata was missing on prior uploads):

```bash
curl -X POST "https://edu-gov-cz.myskin.catania-service.cz/api/ragflow/sync" \
  -H "Authorization: Bearer $MYSKIN_API_TOKEN"
```

To force re-upload, delete `ragflow_sync.db` entries or touch files — sync compares SHA-256.

**Verify in RAGFlow:** Dataset → document → Metadata should show `url` / `source_url`.

## 2. Dify ↔ RAGFlow

In Dify admin:

1. **Knowledge → External Knowledge API** — endpoint `http://<ragflow-host>:9380/api/v1/dify` (Dify appends `/retrieval`).
2. **Connect external knowledge** — use RAGFlow dataset ID as External Knowledge ID.
3. **App → Features** — enable **Citation and Attribution** (`retriever_resource.enabled`).
4. Chatflow: add **Knowledge Retrieval** node (or Agent with KB tools) wired to that external KB.

Dify passes RAGFlow `meta_fields` through as `doc_metadata` on each `retriever_resources` entry when retrieval runs.

**Known RAGFlow caveat:** custom metadata may be missing for very large datasets (pagination cap ~128 docs in some versions). If `doc_metadata` is empty in Dify logs, check RAGFlow `/api/v1/document/infos` for the doc id.

## 3. Spliffy citations UI

Spliffy reads citations from the **same SSE event** Dify already sends:

```json
{
  "event": "message_end",
  "metadata": {
    "retriever_resources": [
      {
        "position": 1,
        "document_name": "…",
        "content": "chunk text…",
        "score": 0.92,
        "doc_metadata": {
          "url": "https://edu.gov.cz/…",
          "source_url": "https://edu.gov.cz/…",
          "file_url": "https://edu-gov-cz.myskin.catania-service.cz/api/files/…"
        }
      }
    ]
  }
}
```

Config (`config.yaml`):

```yaml
dify:
  show_sources: true   # Spliffy renders chips when Dify citations are enabled
```

Spliffy also reads `GET /chat/parameters` → `citations_enabled` from Dify `retriever_resource.enabled`.

**UI:** numbered chips below the answer bubble; linked chips open `doc_metadata.url` (fallback: `source_url`, `file_url`).

## 4. Debugging checklist

| Symptom | Check |
|---------|-------|
| No chips in Spliffy | DevTools → SSE → `message_end` has `retriever_resources`? |
| Empty `retriever_resources` | Dify app has citations enabled + KB retrieval actually ran |
| Chips without links | `doc_metadata.url` empty → re-run myskin RAGFlow sync |
| Wrong link | myskin frontmatter `source_url` on crawled files |
| Metadata in RAGFlow UI but not Dify | RAGFlow→Dify external KB config; RAGFlow version / pagination bug |

### Quick tests

```bash
# myskin catalog exposes source_url
curl -sS -H "Authorization: Bearer $TOKEN" \
  'https://edu-gov-cz.myskin.catania-service.cz/api/documents?limit=1' | jq '.items[0].source_url'

# Spliffy parameters
curl -sS https://test.chat.catania-service.cz/api/chat/parameters | jq '.citations_enabled'
```

During a chat, watch browser Network → `POST /api/chat/messages` → last `message_end` event.

## 5. Inline citations (future)

RAGFlow chat can place `[1]` markers inside generated text. Dify typically does **not** rewrite the answer with inline markers — it attaches sources in `message_end` only. Spliffy currently shows **footer chips** (like many external chat UIs). Inline `[n]` parsing would require matching marker positions in `answer` text to `retriever_resources.position`.

---

See also: [`agent-realtime-streaming.md`](./agent-realtime-streaming.md) (SSE events), [`infra-files/docs/ragflow-myskin/`](../../../infra-files/docs/ragflow-myskin/) (myskin↔RAGFlow ops).
