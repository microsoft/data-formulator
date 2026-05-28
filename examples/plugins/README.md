# Data Formulator — Data Loader Plugins

Drop-in Python files that add new data-source connectors to Data
Formulator without modifying its source code. If the built-in
connectors don't cover your data source (an internal warehouse, a SaaS
API, a niche database), write a small plugin and DF will pick it up on
the next restart.

This folder contains **example plugins**. Treat them as templates: copy
one, rename it, and adapt the body.

---

## Quick start (3 steps)

1. **Find your plugin directory.** It lives under your Data Formulator
   home dir:

   ```
   $DATA_FORMULATOR_HOME/plugins/
   ```

   If `DATA_FORMULATOR_HOME` is not set, DF defaults to
   `~/.data_formulator/`, so the plugin dir is `~/.data_formulator/plugins/`.

   Power users can point somewhere else with `DF_PLUGIN_DIR`
   (highest precedence) — useful for sharing one plugin folder across
   multiple DF installs.

2. **Copy an example into it.** For instance:

   ```bash
   mkdir -p "${DATA_FORMULATOR_HOME:-$HOME/.data_formulator}/plugins"
   cp examples/plugins/sqlite_data_loader.py \
      "${DATA_FORMULATOR_HOME:-$HOME/.data_formulator}/plugins/"
   ```

3. **Restart Data Formulator.** The new connector appears in the UI
   automatically. No registry edits, no rebuilds.

To verify it loaded, check the startup log for a line like:

```
INFO ... Plugin loader 'sqlite' registered from sqlite_data_loader.py
INFO ... Plugin scan complete: 1 registered, 0 failed (dir=..., reason=WORKSPACE_BACKEND=local)
```

### Plugin directory resolution order

| Precedence | Source                                    | Default                       |
| ---------- | ----------------------------------------- | ----------------------------- |
| 1          | `DF_PLUGIN_DIR` env var (explicit override) | —                           |
| 2          | `$DATA_FORMULATOR_HOME/plugins`           | —                             |
| 3          | Fallback                                  | `~/.data_formulator/plugins/` |

---

## File-name contract

| Filename                          | Registry key   |
| --------------------------------- | -------------- |
| `sqlite_data_loader.py`           | `sqlite`       |
| `acme_warehouse_data_loader.py`   | `acme_warehouse` |
| `notion_data_loader.py`           | `notion`       |

Rules:

* The filename **must** end in `_data_loader.py`.
* The prefix becomes the registry key — keep it lowercase, no spaces.
* If the key matches a built-in (e.g. `mysql_data_loader.py`), the
  plugin **overrides** the built-in. Useful for hot-patching.

---

## What goes inside the file

Each plugin defines exactly one class that subclasses
[`ExternalDataLoader`](../../py-src/data_formulator/data_loader/external_data_loader.py).
The minimum surface area:

```python
from data_formulator.data_loader.external_data_loader import (
    ExternalDataLoader, MAX_IMPORT_ROWS,
)
import pyarrow as pa

class MyLoader(ExternalDataLoader):

    # Optional: human-friendly UI label.  Without this, the registry key
    # is title-cased (``"my_warehouse"`` → ``"My Warehouse"``).  Override
    # to fix awkward casing (``"SQLite"``, ``"BigQuery"``).
    DISPLAY_NAME = "My Warehouse"

    @staticmethod
    def list_params() -> list[dict]:
        """Declare connection-form fields. The UI auto-renders this."""
        return [
            {"name": "endpoint", "type": "string", "required": True,
             "tier": "connection", "description": "Server URL"},
            {"name": "token", "type": "string", "required": True,
             "tier": "auth", "sensitive": True, "description": "API token"},
        ]

    @staticmethod
    def auth_instructions() -> str:
        """Markdown help text shown next to the form."""
        return "Get your API token from https://example.com/settings/tokens"

    def __init__(self, params: dict):
        self.params = params
        # validate + open connection here

    def list_tables(self, table_filter: str | None = None) -> list[dict]:
        """Return catalog: [{name, metadata: {columns, row_count}}, ...]"""
        ...

    def fetch_data_as_arrow(self, source_table: str,
                            import_options: dict | None = None) -> pa.Table:
        """Read rows. Honour import_options['size'] up to MAX_IMPORT_ROWS."""
        ...
```

Look at [`sqlite_data_loader.py`](sqlite_data_loader.py) for a runnable
implementation (~170 lines, stdlib only).

### `list_params()` field reference

| Key           | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `name`        | Parameter key passed into `__init__(params)`                     |
| `type`        | `"string"`, `"int"`, `"bool"`, `"password"`                      |
| `required`    | If `True`, DF rejects connections that omit it                   |
| `default`     | Pre-filled value in the form                                     |
| `sensitive`   | If `True`, value is redacted from logs / stored metadata         |
| `tier`        | `"auth"`, `"connection"`, or `"filter"` — groups fields visually |
| `description` | Help text shown under the field                                  |

---

## Security gate — please read

Plugins execute arbitrary Python in the server process. To prevent
accidental code execution in shared deployments, the plugin scanner is
**enabled only in single-user local mode**:

* `WORKSPACE_BACKEND` unset or `local` → scanner runs.
* `WORKSPACE_BACKEND` is anything else → scanner is skipped silently.
* To opt in for a hosted deployment, set `DF_ALLOW_PLUGINS=1`
  **and** make sure the plugin directory is writable only by trusted
  administrators.

---

## Debugging a plugin that won't load

The scanner reports every failure two ways:

1. **In the log**, with a full traceback:

   ```
   WARNING Failed to load plugin foo_data_loader.py: ... ModuleNotFoundError ...
   ```

2. **In `DISABLED_LOADERS`**, which the frontend surfaces as a greyed-out
   connector with the reason. Common reasons:

   | Message                                                | Fix |
   | ------------------------------------------------------ | --- |
   | `missing dependency 'X' (pip install X)`               | `uv pip install X` in DF's venv |
   | `no ExternalDataLoader subclass found`                 | Add a `class Foo(ExternalDataLoader)` to the file |
   | `could not create import spec`                         | File isn't valid Python or has wrong extension |
   | `<ExceptionType>: <message>`                           | Anything else raised during `import` — check the traceback |

The plugin scanner cleans `sys.modules` on failure, so simply restarting
DF after editing the file picks up the fix — no manual cleanup needed.

---

## Adding third-party dependencies

If your plugin needs a package that isn't already in DF's environment:

```bash
# from the data-formulator repo root
uv pip install <package>
```

The plugin file is loaded into the same Python process as DF, so
anything importable from DF's venv is importable from your plugin.

---

## For AI coding agents

When asked to **add a new data source** to a user's Data Formulator
install, prefer writing a plugin file over modifying DF's source tree:

1. Read [`sqlite_data_loader.py`](sqlite_data_loader.py) and the
   `ExternalDataLoader` ABC in
   `py-src/data_formulator/data_loader/external_data_loader.py` to
   understand the required methods.
2. Create a new file `<source>_data_loader.py` in this folder (or
   directly in `~/.data_formulator/plugins/`).
3. Subclass `ExternalDataLoader`. Implement at minimum:
   `list_params`, `auth_instructions`, `__init__`, `list_tables`,
   `fetch_data_as_arrow`.
4. Return data as a `pyarrow.Table` from `fetch_data_as_arrow` — do
   **not** convert to pandas in the hot path.
5. Quote identifiers when building SQL (see `_quote_ident` in the
   SQLite example) to avoid injection vulnerabilities.
6. Respect `import_options['size']` and cap at `MAX_IMPORT_ROWS`.
7. If the source has credentials, mark those params `sensitive: True`
   and `tier: "auth"` so DF redacts them from stored metadata.
8. Do not modify the user's data — open read-only connections where
   the source supports it.

After writing the file, verify it loads with:

```bash
DF_PLUGIN_DIR=<dir> uv run python -c \
  "from data_formulator import data_loader as dl; \
   print(dl.PLUGIN_LOADERS, dl.DISABLED_LOADERS)"
```
