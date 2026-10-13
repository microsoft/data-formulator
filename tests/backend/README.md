# Backend Tests

Organized by concern. All tests run with `uv run pytest tests/backend/`
(tests marked `slow` are skipped unless `--run-slow` is passed).

```
tests/backend/
  auth/            ← identity, auth providers (OIDC, GitHub, EasyAuth, Azure CLI), vault, token store, session config
  routes/          ← Flask endpoint tests (tables, sessions, credentials, knowledge, workspace files, data loaders)
  data/            ← connectors, catalog cache/sync, plugin scanner, workspace, parquet, table names
                     includes test_workspace_path_safety.py (FINDING-4)
  data_loader/     ← individual loaders (ClickHouse, Cube, Databricks, Kusto, MSSQL, Power BI, S3, Azure Blob), probe, SQL escaping
  data_operations/ ← structured data operation models, executor, repository
  agents/          ← analyst skills, agents, model registry, prompts, sessions, workflows
                     includes test_analyst_workspace_files.py (workspace file tool path checks, FINDING-2)
  errors/          ← AppError, global error handler, API error protocol contract
  knowledge/       ← knowledge store
  security/        ← code signing, sanitization, URL allowlist, sandbox, configuration,
                     scratch_serve path safety (FINDING-1),
                     local_folder deployment restriction (FINDING-3),
                     startup safety checks (FINDING-5)
  benchmarks/      ← manual benchmarks (sandbox, workspace); not collected by pytest
  fixtures/        ← shared test data (Excel/CSV files)
  test_*.py        ← desktop packaging, crash report, startup spinner, model endpoints, text edit
```

Security audit test files (added per `design-docs/issues/002-arbitrary-file-read-audit.md`):

| File | FINDING | What it tests |
|------|---------|---------------|
| `security/test_scratch_serve.py` | #1 | `scratch_serve` path traversal, `send_file` usage |
| `agents/test_analyst_workspace_files.py` | #2 | Agent workspace file tools (`create_file`, `edit_file`, scratch listing) reject traversal / absolute paths |
| `security/test_local_folder_deployment.py` | #3 | `local_folder` disabled in multi-user mode |
| `data/test_workspace_path_safety.py` | #4 | `Workspace.__init__` sanitizes identity paths and uses `ConfinedDir` |
| `security/test_startup_safety.py` | #5 | Startup warning for unsafe sandbox config |

Docker-gated database tests live separately in `tests/database-dockers/` and are not auto-discovered by pytest.
