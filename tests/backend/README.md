# Backend Tests

Organized by concern. All tests run with `uv run pytest tests/backend/`.

```
tests/backend/
  auth/          ← identity, providers, vault, session config
  routes/        ← Flask endpoint tests (tables, agents, sessions, credentials)
  data/          ← loaders, connectors, workspace, parquet, table names
                   includes test_workspace_path_safety.py (FINDING-4)
  agents/        ← AI agents, model registry, prompts
                   includes test_tool_path_safety.py (FINDING-2)
  security/      ← code signing, sanitization, URL allowlist, sandbox,
                   scratch_serve path safety (FINDING-1),
                   local_folder deployment restriction (FINDING-3),
                   startup safety checks (FINDING-5)
  fixtures/      ← shared test data (CSV, JSON, parquet)
```

Security audit test files (added per `design-docs/issues/002-arbitrary-file-read-audit.md`):

| File | FINDING | What it tests |
|------|---------|---------------|
| `security/test_scratch_serve.py` | #1 | `scratch_serve` path traversal, `send_file` usage |
| `agents/test_tool_path_safety.py` | #2 | Agent tool path confinement (`_tool_read_file`, etc.) |
| `security/test_local_folder_deployment.py` | #3 | `local_folder` disabled in multi-user mode |
| `data/test_workspace_path_safety.py` | #4 | `Workspace.__init__` sanitizes identity paths and uses `ConfinedDir` |
| `security/test_startup_safety.py` | #5 | Startup warning for unsafe sandbox config |

Docker-gated database tests live separately in `tests/database-dockers/` and are not auto-discovered by pytest.
