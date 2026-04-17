# Backend Tests

Organized by concern. All tests run with `uv run pytest tests/backend/`.

```
tests/backend/
  auth/          ← identity, providers, vault, session config
  routes/        ← Flask endpoint tests (tables, agents, sessions, credentials)
  data/          ← loaders, connectors, workspace, parquet, table names
  agents/        ← AI agents, model registry, prompts
  security/      ← code signing, sanitization, URL allowlist, sandbox
  fixtures/      ← shared test data (CSV, JSON, parquet)
```

Docker-gated database tests live separately in `tests/database-dockers/` and are not auto-discovered by pytest.
