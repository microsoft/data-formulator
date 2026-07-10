---
status: Proposed
date: 2026-07-09
scope: Implement a production Fabric lakehouse loader with delegated per-user authorization, GUID-stable catalog hierarchy, and safe bounded data reads.
related:
  - docs/plans/2026-07-09-fabric-workspaces.md
  - docs/plans/2026-07-09-fabric-semantic-models.md
---

# 2026-07-09 Fabric Lakehouse Loader Implementation Plan

## Goal

Build a real `FabricLakehouseDataLoader` at `py-src/data_formulator/data_loader/fabric_lakehouse_data_loader.py` and register it in `_LOADER_SPECS` at `py-src/data_formulator/data_loader/__init__.py` so users can connect to Microsoft Fabric lakehouse data with delegated per-user authorization.

This plan is explicitly dependent on `docs/plans/2026-07-09-fabric-workspaces.md` as the shared token/session and workspace discovery foundation. This plan does not duplicate or bypass that foundation.

Original user request context: "I also need access to fabric workspaces, lakehouse and semantic models. Create plans for each".

First delivered slice:

- Managed Delta tables in lakehouses
- Files under `Files/` with CSV, TSV, Parquet, JSON, JSONL
- Safe rejection of unsupported formats
- Streaming/download size limits before parse
- `MAX_IMPORT_ROWS` enforcement after parse
- Safe cancellation and bounded timeouts for remote reads
- Stable GUID-plus-path source identifiers with strict parser validation

Out-of-scope but linked to original request context:

- Fabric workspace foundation in `docs/plans/2026-07-09-fabric-workspaces.md`
- Fabric semantic models in `docs/plans/2026-07-09-fabric-semantic-models.md`

## Architecture

### Dependency Contract With Workspace Foundation

Prerequisite from `docs/plans/2026-07-09-fabric-workspaces.md`:

- Fabric REST delegated token acquisition and session wiring
- Per-user auth context and source identity model
- Explicit token audience separation support

Lakehouse plan contract:

- Metadata-plane calls use delegated Fabric token from workspace foundation with the full requested Fabric scopes defined there.
- OneLake data-plane calls use delegated Storage audience token with scope `https://storage.azure.com/.default`.
- The loader must fail closed when the required audience token for a call is missing.
- OneLake Table API audience behavior is not established by current repo evidence, so token-routing for `onelake.table.fabric.microsoft.com` is a spike gate, not an assumption.
- Never treat managed identity as equivalent to delegated user access

### Catalog Hierarchy

Implement catalog tree as:

1. Workspace
2. Lakehouse
3. Area (`Tables` or `Files`)
4. Zero or more nested Namespace nodes
5. Table or File leaf

Rules:

- Use GUIDs for workspace and item identity in canonical source names
- Display names are UI metadata only, not source identity
- Dynamic nested directories under `Files/` and nested namespaces under `Tables/` do not map cleanly to fixed-depth hierarchy.
- Contract test and executable spike must decide whether catalog path representation uses variable-depth namespaces supported by the current frontend catalog tree.

Canonical source identifier contract:

- Field: `source_table`
- Format: `fabric_lakehouse://workspace/<workspace_guid>/lakehouse/<lakehouse_guid>/area/<tables|files>/path/<normalized_relative_path>`
- `workspace_guid` and `lakehouse_guid` must be canonical GUID strings.
- `normalized_relative_path` must be a normalized relative path rooted under the declared `area`, with no absolute URL, no scheme, no `..`, and no empty traversal segments.
- Parser must reject arbitrary URLs and traversal attempts.
- Parser tests are mandatory and live under `tests/backend/data/`.

Canonical data URI shape:

- `https://onelake.dfs.fabric.microsoft.com/<workspaceGUID>/<itemGUID>/<path>`

### Metadata and Data Planes

Metadata plane:

- Fabric REST for workspace and item metadata, including lakehouse item details
- OneLake Table APIs at `https://onelake.table.fabric.microsoft.com` for schema and table listing
- Do not introduce or claim a Fabric REST table-data endpoint

Data plane:

- OneLake DFS and Table-compatible APIs for actual data access
- Respect OneLake shortcut behavior based on resulting OneLake authorization outcomes
- Do not assert blanket shortcut permissions inheritance rules that bypass runtime authorization checks

### Data Access Spike Gate (Blocking)

Before locking dependencies, run a real delegated-tenant spike to choose one implementation:

- Option A: `deltalake` (delta-rs) with delegated bearer token against OneLake DFS + Delta log + Parquet
- Option B: direct DFS listing plus Parquet reads only

Gate criteria:

- Works with delegated user token, no account key fallback
- Correctly reads managed Delta snapshots from transaction log state, not just individual Parquet files
- Works on real managed Delta tables in target tenant
- Honors row limits and predictable performance
- Clear error handling for auth expiry and throttling
- Records exact dependency names and API calls used by the selected path

Decision rule:

- If Option B cannot produce correct arbitrary Delta snapshot semantics, it is rejected for managed Delta table reads.
- Direct Parquet-only reading is not acceptable as the sole Delta strategy.

No implementation branch proceeds past this gate without recorded spike outcome.

### OneLake Table API Token Routing Spike Gate (Blocking)

Before finalizing metadata client token routing:

- Execute a spike that tests OneLake Table API calls with available delegated tokens.
- Record which audience token succeeds for `onelake.table.fabric.microsoft.com` in the target tenant.
- Keep implementation audience selection behind this verified result.
- Do not assume one shared token across Fabric metadata, OneLake Table API, and DFS data APIs without this evidence.

### Security and Reliability Constraints

- Per-user delegated authorization only
- No arbitrary path traversal; build paths from GUID roots and validated relative segments
- Enforce response streaming/download size limits before parse
- Enforce `MAX_IMPORT_ROWS` after parse
- Add safe cancellation support and bounded per-request timeouts for metadata/data operations
- Push down filters only where semantics are verified safe
- Handle pagination and `Retry-After` for metadata/data listing calls
- Include regional and private endpoint configuration knobs (no hardcoded single-region assumptions)

## Tech Stack

Backend Python:

- Existing loader framework: `py-src/data_formulator/data_loader/external_data_loader.py`
- Loader registry: `py-src/data_formulator/data_loader/__init__.py`
- New built-in loader file: `py-src/data_formulator/data_loader/fabric_lakehouse_data_loader.py`
- Connector/runtime integration: `py-src/data_formulator/data_connector.py`
- Error model: `py-src/data_formulator/errors.py`, `py-src/data_formulator/error_handler.py`
- Row serialization helpers: `py-src/data_formulator/datalake/parquet_utils.py`

Fabric and OneLake integrations:

- Fabric REST metadata endpoints
- OneLake DFS endpoint: `onelake.dfs.fabric.microsoft.com`
- OneLake Table API endpoint: `onelake.table.fabric.microsoft.com`
- Storage audience token for OneLake data operations

Dependencies to evaluate/lock after spike:

- `deltalake` (only if Option A wins)
- Existing `pyarrow` for file-format reads/parsing path

Frontend i18n:

- Locale aggregation entrypoints:
  - `src/i18n/locales/en/index.ts`
  - `src/i18n/locales/zh/index.ts`
- New translation keys should be added in:
  - `src/i18n/locales/en/loader.json`
  - `src/i18n/locales/zh/loader.json`
  - `src/i18n/locales/en/errors.json`
  - `src/i18n/locales/zh/errors.json`

Frontend integration expectation for this slice:

- Reuse existing generic loader UI/flow to consume loader params and catalog response first.
- Do not introduce a custom frontend component unless a concrete gap is demonstrated by contract tests or manual validation.

## TDD Implementation Tasks

### Task 0: Contract Gate and Design Pin

Paths:

- `docs/plans/2026-07-09-fabric-lakehouse.md`
- `docs/plans/2026-07-09-fabric-workspaces.md`

Work:

- Confirm workspace-foundation dependency contract is available and accepted
- Record explicit fail-closed dual-token rule and delegated-only rule
- Freeze first-slice scope (managed Delta tables plus listed file formats)

Command:

```bash
python -m pytest tests/backend/auth/test_token_store.py -q
```

Done when:

- Auth baseline remains green before loader work starts

### Task 1: Add Failing Spike Tests for Data Access Choice

Paths:

- `tests/backend/data/test_fabric_lakehouse_spike_gate.py`

Work:

- Add env-gated spike tests that run only when delegated tenant secrets are present
- Define acceptance checks for Option A (`deltalake`) and Option B (DFS/Parquet)
- Add OneLake Table API token-routing probe assertions and record evidence
- Keep tests skipped by default in CI if env is absent

Marker:

- `@pytest.mark.backend`

Command:

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_spike_gate.py -q
```

Done when:

- Tests fail or skip in a controlled way before implementation
- Gate criteria are encoded as assertions, not prose

### Task 2: Add Failing Unit Tests for Catalog and Source Identity

Paths:

- `tests/backend/data/test_fabric_lakehouse_loader.py`

Work:

- Define hierarchy assertions: Workspace -> Lakehouse -> Area -> Namespace* -> Leaf
- Add variable-depth namespace tests for nested paths
- Assert `source_table` follows canonical format and is GUID-stable and rename-tolerant
- Add parser validation tests that reject URL-form identifiers and traversal
- Assert OneLake URI construction uses GUID segments
- Assert unsupported format rejection is explicit and safe

Marker:

- `@pytest.mark.backend`

Command:

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_loader.py -q
```

Done when:

- Tests fail on missing loader implementation

### Task 3: Implement Loader Skeleton and Token Separation

Paths:

- `py-src/data_formulator/data_loader/fabric_lakehouse_data_loader.py`
- `py-src/data_formulator/data_loader/__init__.py`

Work:

- Implement `FabricLakehouseDataLoader` with required `ExternalDataLoader` methods
- Add registry entry in `_LOADER_SPECS`
- Enforce audience-specific token requirement with fail-closed behavior:
  - Fabric token for metadata calls using workspace-foundation scope contract
  - Storage audience token for OneLake DFS data calls (`https://storage.azure.com/.default`)
  - OneLake Table API token routing selected by spike evidence
- Preserve per-user authorization context from connector/token store

Command:

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_loader.py -q
```

Done when:

- Loader imports and basic catalog tests pass

### Task 4: Implement Metadata Discovery and Pagination/Throttle Handling

Paths:

- `py-src/data_formulator/data_loader/fabric_lakehouse_data_loader.py`
- `tests/backend/data/test_fabric_lakehouse_loader.py`

Work:

- Implement workspace, item, lakehouse metadata retrieval via Fabric REST
- Implement table/schema listing via OneLake Table APIs using spike-validated token audience mapping
- Implement paginated traversal with continuation handling
- Honor `Retry-After` for throttled responses with bounded retries

Command:

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_loader.py -q
```

Done when:

- Pagination and throttling tests pass deterministically

### Task 5: Implement Data Reads for First Slice

Paths:

- `py-src/data_formulator/data_loader/fabric_lakehouse_data_loader.py`
- `tests/backend/data/test_fabric_lakehouse_loader.py`

Work:

- Implement managed Delta table reads using spike-selected path
- Implement file reads for CSV, TSV, Parquet, JSON, JSONL under `Files/`
- Reject unsupported formats with safe structured errors
- Enforce pre-parse streaming/download size limits
- Enforce post-parse row cap using `MAX_IMPORT_ROWS`
- Enforce bounded timeout and cancellation behavior for long-running reads
- Apply filter pushdown only where the selected data path guarantees safe semantics

Command:

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_loader.py -q
```

Done when:

- Data read tests pass for all supported first-slice formats

### Task 6: Integrate Serialization and Error Contracts

Paths:

- `py-src/data_formulator/data_loader/fabric_lakehouse_data_loader.py`
- `py-src/data_formulator/datalake/parquet_utils.py`
- `tests/backend/data/test_fabric_lakehouse_loader.py`

Work:

- Ensure all DataFrame rows emitted to APIs use central serialization helpers
- Ensure error paths use `AppError` and do not leak raw exception text
- Add explicit tests for token-missing fail-closed behavior and safe error bodies
- Add tests for `source_table` parser validation and normalized-path enforcement

Marker:

- `@pytest.mark.backend`

Command:

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_loader.py -q
```

Done when:

- Serialization and error-safety tests pass

### Task 7: Add Optional Integration Tests (Env-Gated)

Paths:

- `tests/backend/data/test_fabric_lakehouse_integration.py`

Work:

- Add integration tests requiring delegated tenant env vars and tokens
- Verify real workspace and lakehouse traversal
- Verify at least one managed Delta table and one supported file path read
- Verify OneLake Table API token routing selected by the spike
- Verify cancellation and timeout behavior with bounded retries

Suggested marker/env gate:

- `@pytest.mark.integration`
- `@pytest.mark.backend`
- `FABRIC_INTEGRATION_TEST=1`
- `FABRIC_TEST_WORKSPACE_ID=<guid>`
- `FABRIC_TEST_LAKEHOUSE_ID=<guid>`

Commands:

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_integration.py -q -m integration
```

```bash
python -m pytest tests/backend/data -q
```

Done when:

- Integration suite is opt-in and stable against a real delegated test tenant

### Task 8: Dependencies, i18n, and Registry Completeness

Paths:

- `pyproject.toml`
- `requirements.txt`
- `src/i18n/locales/en/loader.json`
- `src/i18n/locales/zh/loader.json`
- `src/i18n/locales/en/errors.json`
- `src/i18n/locales/zh/errors.json`

Work:

- Add dependency only for spike-selected implementation path
- Add user-visible connector/auth/error strings via i18n keys in en/zh
- Confirm registry entry visibility and install hints are accurate
- Keep frontend integration on existing generic loader/categorized catalog flow first
- Add a custom frontend component only if a tested gap is shown

Commands:

```bash
yarn test
```

```bash
python -m pytest tests/backend/data -q
```

Done when:

- Frontend and backend tests stay green with new keys and dependency set

### Task 9: Docs and Operational Readiness

Paths:

- `docs/dev-guides/3-data-loader-development.md`
- `docs/dev-guides/4-authentication-oidc-tokenstore.md`
- `docs/dev-guides/13-unified-row-limits.md`
- `docs/dev-guides/15-dataframe-serialization.md`
- `docs/plans/2026-07-09-fabric-lakehouse.md`

Work:

- Document delegated-token separation and fail-closed behavior
- Document OneLake endpoint/audience requirements and non-goals
- Document that OneLake Table API audience mapping is an evidence-driven contract from spike output
- Document supported formats, pagination, and throttling behavior
- Document shortcut behavior as authorization-result driven, not unconditional inheritance

Command:

```bash
python -m pytest tests/backend/data -q

## Validation Commands (Full Pass)

Run these before implementation sign-off:

```bash
python -m pytest tests/backend/data -q -m backend
```

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_loader.py -q -m backend
```

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_spike_gate.py -q -m backend
```

```bash
python -m pytest tests/backend/data/test_fabric_lakehouse_integration.py -q -m "integration and backend"
```

```bash
python -m pytest tests/backend/data_connector -q
```

```bash
python -m pytest tests/backend/auth -q
```

```bash
python -m pytest tests/backend/routes -q
```

```bash
yarn test
```

```bash
python -m ruff check py-src tests
```

```bash
yarn lint
```

```bash
python -m pytest -q
```

Done when:

- Documentation matches implementation and test behavior

## Non-Goals for This Slice

- Semantic model data-plane implementation
- Full pushdown query planner across all formats
- Non-delegated identity modes as a substitute for user-delegated access
- Any Fabric REST table-data endpoint assumption
- Hardcoding OneLake Table API audience routing without spike evidence

## Quality Attribute Gates

This plan is gated by shared release-blocking requirements in
`docs/plans/2026-07-09-connector-implementation-requirements.md`:

- SIMPLE-001 through SIMPLE-006
- ROBUST-001 through ROBUST-008
- PERF-001 through PERF-008

Fabric lakehouse specific quality criteria (excluding user think-time and
interactive IdP or MFA time):

- Catalog page response MUST be <= 3 seconds p95 in a representative
  environment.
- Preview up to 10,000 rows MUST be <= 5 seconds p95 where source behavior
  permits.
- Streaming download byte caps MUST be enforced before parse.
- Delta snapshot correctness MUST take precedence over speed.
- Duplicate full Arrow or pandas in-memory copies are not allowed.
- Read concurrency MUST be bounded.
- The performance spike MUST compare candidate data paths and record memory
  and throughput outcomes.

## Definition of Done

This plan is done when all scoped implementation tasks and validation commands
in this document are completed, plus all quality criteria are satisfied:

- Shared quality gates SIMPLE-001 through SIMPLE-006,
  ROBUST-001 through ROBUST-008, and PERF-001 through PERF-008 are satisfied
  per `docs/plans/2026-07-09-connector-implementation-requirements.md`.
- Lakehouse specific quality criteria in this plan are satisfied.
- The DF-018 quality evidence reports pass with no unapproved exceptions:
  `docs/plans/evidence/df-018-fabric-lakehouse-quality-report.json` and
  `docs/plans/evidence/df-018-fabric-lakehouse-quality-report.md`.

## References

- [OneLake access API](https://learn.microsoft.com/fabric/onelake/onelake-access-api)
- [OneLake Table API overview](https://learn.microsoft.com/rest/api/fabric/articles/onelakecatalog/overview#explore-tables-within-an-item)
- [OneLake overview](https://learn.microsoft.com/fabric/onelake/onelake-overview)
- [Fabric lakehouse item metadata](https://learn.microsoft.com/rest/api/fabric/lakehouse/items/get-lakehouse)
