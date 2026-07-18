# Per-instance UI strings (`ui_strings/`)

Override frontend copy (composer footer, future strings) **per Spliffy instance** without rebuilding the Docker image.

**Ops:** instance layout and compose mount — [infra-files `spliffy/instances/README.md`](../../../infra-files/servers/jbi-sv-00/spliffy/instances/README.md)  
**Live example:** [`sofie-dev`](../../../infra-files/servers/jbi-sv-00/spliffy/instances/sofie-dev/) — AI disclaimer under the input

---

## Why not bundled i18n JSON?

The React app ships with static locale files (`frontend/src/i18n/locales/*.json`) baked in at **`npm run build`**. Changing them requires a new GitLab image for **all** instances.

Per-instance strings live in git next to `config.yaml`, are loaded at **runtime** by the FastAPI backend, and are exposed to the browser via `GET /chat/config`.

---

## Layout

```text
instances/<name>/
  config.yaml
  ui_strings/
    cs.yaml
    en.yaml
    README.md
  docker-compose.yml   # optional bind-mount → /app/ui_strings
```

**One YAML file per locale.** The filename stem is the locale code (`cs`, `en`, `de`, …). Copy an existing file to add a language:

```bash
cp ui_strings/en.yaml ui_strings/de.yaml
# edit de.yaml
```

Example `ui_strings/cs.yaml`:

```yaml
chat:
  hint: "Toto je AI asistent. Může dělat chyby — ověřte důležité informace."
```

---

## Config

In `config.yaml`:

```yaml
ui_strings:
  default_locale: cs
  path: /app/ui_strings   # in Docker; or relative path next to config.yaml locally
```

| Key | Purpose |
|-----|---------|
| `default_locale` | Fallback when the UI language has no file |
| `path` | Directory with locale YAML files (default: `ui_strings` relative to config file) |

**Inline override (optional):** `ui_strings.chat.hint` in `config.yaml` merges on top of file values for the same locale.

When `ui_strings` is omitted or empty, the bundled i18n default is used (`chat.hint` → “Enter to send · Shift+Enter for a new line”).

---

## Docker mount

Production instances bind-mount the directory read-only. Example from `sofie-dev/docker-compose.yml`:

```yaml
services:
  app:
    volumes:
      - type: bind
        source: ./ui_strings
        target: /app/ui_strings
        read_only: true
```

Set `ui_strings.path: /app/ui_strings` in `config.yaml`. Recreate the container after adding the mount:

```bash
docker compose up -d --force-recreate
```

The Spliffy **image** must include the backend loader (`ui_strings_loader.py`) — pull a recent tag after merging to `spliffy` main.

---

## API and frontend

**Backend:** `backend/app/ui_strings_loader.py` reads locale files; `GET /chat/config` returns:

```json
{
  "ui_strings": {
    "chat": {
      "hint": { "cs": "…", "en": "…" }
    }
  }
}
```

**Frontend:** `Chat.tsx` prefers `config.ui_strings.chat.hint[locale]`, falls back to `t('chat.hint')`. Locale resolution matches `name_forms`: active language → `en` → `cs`.

---

## Deploy checklist (new instance)

1. Copy `instances/sofie-dev/ui_strings/` as a template.
2. Translate `chat.hint` in each locale file.
3. Add `ui_strings` block to `config.yaml` and compose volume mount.
4. Ensure Spliffy image includes ui_strings support (`docker compose pull && up -d --force-recreate`).

No image rebuild needed when only editing locale YAML files.

---

## Code map

| File | Role |
|------|------|
| `backend/app/ui_strings_loader.py` | Load `*.yaml` per locale from configured directory |
| `backend/app/settings.py` | `_read_ui_strings()`, merge inline + files |
| `backend/app/dify/routes.py` | Expose `ui_strings` on `/chat/config` |
| `frontend/src/components/Chat.tsx` | Render config hint with i18n fallback |
| `backend/ui_strings/README.md` | Template + copy-for-new-language instructions |

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Still shows default “Enter to send…” | Spliffy image predates ui_strings feature — pull newer image |
| Config hint ignored | `ui_strings.path` wrong inside container; verify mount at `/app/ui_strings` |
| Wrong language | UI toggle (`spliffy-lang`); missing locale file falls back to `en` / `cs` |
| Edit has no effect | Config/locale files are bind-mounted — no rebuild, but **recreate** container if mount was added |
