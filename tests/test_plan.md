# Test Plan

This document captures the testing strategy for Data Formulator. It is meant to
be a living document — update it as coverage grows and priorities shift.

---

## Current State

### Directory layout

All tests live under the repo-level `tests/` directory (previously some lived
in `py-src/tests/` — those have been consolidated here).

```
tests/
  conftest.py                          # adds py-src to sys.path, --run-slow option
  test_plan.md                         # ← this file
  backend/                             # included in default pytest (no Docker needed)
    agents/                            # analyst skills, agents, model registry, workflows
    auth/                              # identity, auth providers, vault, token store
    data/                              # connectors, catalog, workspace, parquet, table names
    data_loader/                       # individual loader tests (mocked connections)
    data_operations/                   # structured data operations
    errors/                            # AppError, error handler, API error contract
    knowledge/                         # knowledge store
    routes/                            # Flask endpoint tests
    security/                          # sandbox, code signing, sanitization, URL allowlist, path safety
    benchmarks/                        # performance benchmarks (manual, not collected)
    fixtures/                          # shared Excel/CSV fixtures
  database-dockers/                    # data loader integration tests (requires Docker, run separately)
    mysql/ postgres/ mongodb/          # each with docker-compose.yml, setup files, test module
    bigquery/ cosmosdb/ superset/
    docker-compose.test.yml            # optional unified compose entry point
    test-dbs.ps1                       # PowerShell helper: start/stop/test services
  eval/                                # manual LLM evaluation harnesses (intent_routing)
  frontend/
    setup.ts                           # jest-dom matchers
    unit/                              # vitest tests for src/
```

See `tests/backend/README.md` for per-directory details.

### Running tests

```bash
# Backend (default pytest paths; no Docker needed, fast)
pytest
pytest tests/backend --run-slow        # include tests marked slow

# Frontend
npm test

# Data loader integrations (requires Docker; see tests/database-dockers/README.md)
.\tests\database-dockers\test-dbs.ps1 start core   # PowerShell
.\tests\database-dockers\test-dbs.ps1 test mysql
.\tests\database-dockers\test-dbs.ps1 stop core

# macOS / Linux: per-service compose
cd tests/database-dockers/mysql && docker compose up -d --build --wait
```

### What exists today

| Layer | Location | Runner |
|-------|----------|--------|
| Backend (unit, route, contract, security) | `tests/backend/` | pytest |
| Backend benchmarks | `tests/backend/benchmarks/` | manual |
| Data loader integrations | `tests/database-dockers/` | pytest (manual, requires Docker) |
| Frontend unit | `tests/frontend/unit/` | vitest |

`tests/backend/` runs by default with `pytest` (see `pytest.ini`) — no Docker
required. `tests/database-dockers/` is excluded from
default runs and requires the test services to be started first.

### Key gaps

- **Session routes** — save / load / export / import untested
- **Agent pipelines** — no isolated tests for any agent class
- **Data loaders** — S3, Azure Blob, Kusto, Athena, MSSQL not covered
- **Workspace factory** — backend selection logic untested
- **Frontend components** — almost no component or hook tests
- **Frontend state** — only 1 Redux selector test
- **Vega-Lite assembly** — `create_vl_plots` untested
- **Semantic types** — type resolution and classification untested

---

## Proposed Test Categories

### P0 — Security & correctness (add first)

These protect against regressions that could leak secrets, execute tampered
code, or corrupt user data.

#### 1. Code signing (`code_signing.py`) ✅ covered

Tests in `tests/backend/security/test_code_signing.py`:
sign/verify round-trip, tampered code/signature rejection, empty inputs,
whitespace sensitivity, Unicode, `sign_result()` helper.

#### 2. Auth & identity (`auth.py`) ✅ covered

Tests in `tests/backend/auth/test_auth.py`:
Azure principal → `user:` prefix, browser → `browser:` prefix, client
cannot spoof `user:` namespace, Azure takes priority, missing headers,
malformed values rejected, validation edge cases.

#### 3. Error sanitization (`sanitize.py`) ✅ covered

Tests in `tests/backend/security/test_sanitize.py`:
API key redaction, path stripping (Unix/Windows/tmp), stack trace removal,
HTML escaping, truncation, edge cases (empty, Unicode).

#### 4. Sandbox confinement (`sandbox/`) ✅ covered

Tests in `tests/backend/security/test_sandbox_security.py`:
file write blocked (open, csv), process exec blocked (os.system, popen,
execvp, spawnlp, kill, sys.modules bypass, putenv), Docker workspace
read-only mount.

#### 4b. URL allowlist (`url_allowlist.py`) ✅ covered

Tests in `tests/backend/security/test_url_allowlist.py`:
open mode (env unset, all URLs allowed), enforce mode (matching patterns
pass, unlisted/private IPs rejected), empty api_base always allowed,
case insensitivity, glob edge cases, pattern loading.

#### 4c. `scratch_serve` path safety ✅ covered

Tests in `tests/backend/security/test_scratch_serve.py`:
path traversal and missing files return HTTP 200 with `status: "error"` per the
unified error protocol, normal file → 200, and `send_file` usage is verified
instead of `send_from_directory` (FINDING-1 from issue-002).

#### 4d. Agent tool path confinement ✅ covered

Tests in `tests/backend/agents/test_analyst_workspace_files.py`:
agent workspace file tools (`create_file`, `edit_file`, scratch file listing) reject
traversal and absolute paths, normal workspace paths work (FINDING-2 from issue-002).

#### 4e. `local_folder` deployment restriction ✅ covered

Tests in `tests/backend/security/test_local_folder_deployment.py`:
multi-user mode disables `local_folder` connector, local mode keeps it,
`create_connector` rejects disabled types (FINDING-3 from issue-002).

#### 4f. Workspace path safety ✅ covered

Tests in `tests/backend/data/test_workspace_path_safety.py`:
`Workspace.__init__` sanitizes traversal-shaped identities, rejects root-equivalent
workspace paths, and delegates legacy root checks to `ConfinedDir` instead of
using `str.startswith` (FINDING-4 from issue-002).

#### 4g. Startup safety checks ✅ covered

Tests in `tests/backend/security/test_startup_safety.py`:
multi-user + no sandbox → `logger.critical` warning, safe configs → no warning
(FINDING-5 from issue-002).

#### 5. Session sensitive-field stripping (`datalake/workspace_manager.py`)

- `_strip_sensitive()` removes model credentials, identity, API keys
- round-trip: save → load preserves data but strips secrets

### P1 — Core data pipeline (add next)

#### 6. Workspace operations (`datalake/workspace.py`)

- `save_table()` → `load_table()` round-trip preserves data
- `list_tables()` reflects creates and deletes
- `get_table_metadata()` returns correct schema
- concurrent metadata updates use file locking (atomic writes)
- temp file cleanup on workspace close
- workspace isolation between users

#### 7. File manager (`datalake/file_manager.py`)

- encoding detection for UTF-8, UTF-16, Shift-JIS, GB2312
- BOM handling
- large file upload (near MAX_CONTENT_LENGTH boundary)
- file type validation (reject unsupported formats)
- (some coverage already exists — extend, don't duplicate)

#### 8. Metadata persistence (`datalake/workspace_metadata.py`)

- YAML save / load round-trip
- cross-platform file locking
- concurrent writers don't corrupt metadata
- schema migration: old metadata format still loads

#### 9. Table routes — end-to-end (`routes/tables.py`)

- `/create-table` with JSON, CSV, Parquet payloads
- `/parse-file` with Excel, CSV, TSV files
- `/delete-table` cleans up Parquet + metadata
- `/sample-table` returns correct row count and schema
- DuckDB sampling for large files
- `/open-workspace` initializes workspace correctly
- (some coverage exists — check and extend)

#### 10. Model registry (`model_registry.py`)

- env-var scanning for each provider (OpenAI, Azure, Anthropic, Gemini, Ollama)
- `list_public()` never exposes API keys
- custom model endpoint configuration
- missing / malformed env vars → graceful degradation
- (some coverage exists — check and extend)

### P2 — Agent layer (mock LLM calls)

#### 11. Agent utilities

- `agent_utils.py`: JSON extraction from LLM responses, data summary generation
- `agent_utils_sql.py`: DuckDB view creation, quoted identifiers for Unicode
- `agent_language.py`: English / Chinese prompt instruction building
- `agent_diagnostics.py`: diagnostics payload builder captures correct fields
- (some coverage exists for diagnostics and SQL utils)

#### 12. Individual agents (mock `Client` / LiteLLM)

- `AnalystAgent` (`analyst/agent.py`) — tool loop terminates correctly, produces charts/tables
- `WorkflowAgent` (`workflows/agent.py`) — workflow runs on top of the analyst loop
- `DataLoadAgent` — infers semantic types and suggests table names from raw data
- `CodeExplanationAgent` — produces explanation from code input
- `ChartRestyleAgent`, `SortDataAgent`, `StarterQuestionsAgent`, `WorkflowDistillAgent`

Focus on: prompt assembly, response parsing, error recovery, repair loops.

#### 13. Semantic types (`agents/semantic_types.py`)

- type classification: temporal, categorical, measure sets are disjoint
- type resolution from sample data (dates, currencies, percentages)
- consistency with `type-registry.ts` in the `flint-chart` package

### P3 — Visualization & workflows

#### 14. Vega-Lite chart assembly (`workflows/create_vl_plots.py`)

- field type coercion (quantitative, nominal, temporal, ordinal)
- encoding shelf assembly from semantic fields
- bar, line, scatter, area chart generation
- multi-layer charts
- invalid encoding combinations → graceful error

#### 15. Chart semantics (`workflows/chart_semantics.py`)

- encoding channel validation
- specification completeness checks

### P4 — Data loader integrations

#### 16. Data loader framework ✅ partially covered

Integration tests with Dockerized services exist for MySQL, MongoDB,
PostgreSQL, BigQuery, Cosmos DB, and Superset (in `tests/database-dockers/`).
A standalone MySQL-to-datalake round-trip test also exists
(`tests/database-dockers/mysql/test_mysql_datalake.py`). Mocked loader tests
live in `tests/backend/data_loader/` and `tests/backend/data/`. Still needed:

- `ExternalDataLoader` interface contract test (shared across all loaders)
- Remaining loaders (require mocked connections or emulators):
  - MSSQL: SQL query → DataFrame
  - S3: file listing, download, Athena integration
  - Azure Blob: container listing, file download
  - Kusto: KQL query → DataFrame
  - Athena: query execution, result fetching
- Connection error handling for each loader
- Credential validation

### P5 — Frontend unit tests

#### 17. Data utilities (`src/data/`)

- type coercion functions (extend existing `coerceDate.test.ts`)
- Excel cell resolution (extend existing)
- data transformation helpers

#### 18. Redux state (`src/app/`)

- all exported selectors (extend existing `dfSelectors.test.ts`)
- reducer logic for table CRUD, model selection, session state
- state persistence (redux-persist integration)

#### 19. View utilities & components

- `ViewUtils.tsx` helper functions
- `ChartRenderService.tsx` — Vega-Embed rendering
- `ModelSelectionDialog` — model filtering and selection
- `DataView` — table rendering with filtering/sorting
- `EncodingBox` — encoding shelf interactions
- `ChatDialog` — message handling

#### 20. Internationalization (`src/i18n/`)

- all i18n keys have translations in both English and Chinese
- no missing keys in either locale

### P6 — End-to-end workflows (optional / future)

#### 21. Full pipeline tests

- upload CSV → create table → derive data → generate chart → export
- session save → reload → resume workflow
- multi-table join → visualization

These would likely use Playwright or Cypress and are out of scope initially.

---

## Test Infrastructure

### Fixtures to build

- **`app_client`** — Flask test client with in-memory workspace (exists in some integration tests, should be standardized)
- **`tmp_workspace`** — temporary workspace directory, cleaned up after test
- **`mock_llm_client`** — patched `Client` that returns canned LLM responses
- **`sample_dataframes`** — standard DataFrames for table operations (small, wide, Unicode columns, empty)
- **`sample_files`** — CSV/Excel/Parquet fixture files (some exist in `tests/backend/fixtures/`)

### Markers

| Marker | Meaning |
|--------|---------|
| `@pytest.mark.backend` | Backend test (already configured) |
| `@pytest.mark.slow` | Takes a second or more; skipped unless `--run-slow` (already configured) |
| `@pytest.mark.live` | Hits a real external service; skipped without credentials (already configured) |
| `@pytest.mark.requires_docker` | Needs Docker daemon running |
| `@pytest.mark.requires_llm` | Needs real LLM API key (skip in CI by default) |

### CI considerations

- P0–P2 tests should run on every PR (< 2 min target)
- P4 data loader tests need mock services or are skipped in CI
- P6 e2e tests run on merge to main only
- Frontend tests run via `npm test` in CI

---

## How to prioritize

1. Start with **P0** — these guard against security issues and data corruption
2. Move to **P1** — these catch breakages in daily development workflows
3. **P2** covers the AI agent layer — use mocks, not real LLM calls
4. **P3–P5** fill remaining coverage gaps
5. **P6** is aspirational — add when the team has bandwidth

---

## Open questions

- [ ] Should sandbox tests use Docker in CI, or only test `LocalSandbox`?
- [ ] Do we want snapshot tests for Vega-Lite spec output?
- [ ] Should agent tests pin specific mock LLM responses, or use property-based testing?
- [ ] Is there a need for load/stress testing on the streaming endpoints?
- [ ] Should frontend component tests use shallow rendering or full mount?
- [ ] Do we need contract tests for the frontend ↔ backend API boundary (OpenAPI schema)?
