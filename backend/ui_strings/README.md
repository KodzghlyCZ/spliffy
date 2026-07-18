# UI strings (per instance)

One YAML file per locale. The filename (without extension) is the locale code, e.g. `cs.yaml`, `en.yaml`.

Copy an existing file to add a language:

```bash
cp en.yaml de.yaml
# edit de.yaml
```

Example `cs.yaml`:

```yaml
chat:
  hint: "Toto je AI asistent. Může dělat chyby — ověřte důležité informace."
```

Point `config.yaml` at this directory (default: `ui_strings` next to the config file):

```yaml
ui_strings:
  default_locale: cs
  path: ui_strings
```

When omitted, bundled frontend i18n defaults are used. Inline `ui_strings.chat.hint` in `config.yaml` still works and overrides file values for the same locale.
