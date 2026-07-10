---
status: Proposed
date: 2026-07-09
scope: Add a Fabric semantic model data loader with delegated OAuth, RLS-preserving query execution, and safe query templates.
related:
  - docs/plans/2026-07-09-fabric-workspaces.md
---

# 2026-07-09 Fabric Semantic Models Plan

## Goal

Deliver a FabricSemanticModelDataLoader registered in _LOADER_SPECS that provides a hierarchy of Workspace -> Semantic Model -> queryable object or query template, while preserving delegated user permissions and row-level security.

This plan explicitly depends on docs/plans/2026-07-09-fabric-workspaces.md for the shared audience-aware token and session foundation, delegated OAuth scope plumbing, and token-free popup behavior.

Original request context: I also need access to fabric workspaces, lakehouse and semantic models. Create plans for each.

## Architecture

1. Foundation dependency
   - Reuse the shared delegated OAuth and session flow defined in docs/plans/2026-07-09-fabric-workspaces.md.
   - Reuse the token-free popup contract from the shared foundation, so popup callbacks never receive raw access tokens.
   - Reuse tenant-aware audience selection plumbing, then bind semantic model query calls to the Power BI audience.
   - Distinguish audience from scope explicitly:
     - Audience: `https://analysis.windows.net/powerbi/api/`
     - Delegated scope requested for semantic model reads: `https://analysis.windows.net/powerbi/api/Dataset.Read.All`

2. Loader registration and hierarchy
   - Register `FabricSemanticModelDataLoader` in `py-src/data_formulator/data_loader/__init__.py` via `_LOADER_SPECS`.
   - Loader browse hierarchy:
     - Level 1: Workspace
     - Level 2: Semantic Model
     - Level 3: Safe source contract target
   - Discovery path:
     - Use Fabric REST workspace and items discovery.
     - Filter to SemanticModel item type.
     - Do not claim or assume Fabric REST executes DAX.

3. Query execution strategy

   - JSON endpoint is exact and mandatory for first implementation slice:
     - `POST https://api.powerbi.com/v1.0/myorg/datasets/{datasetId}/executeQueries`
   - Early executable spike compares JSON with Arrow support, but Arrow cannot be implemented until the spike records the exact Arrow endpoint URL from official docs in this plan and tests.
   - Do not leave Arrow integration defined only by operation name (for example `executeDaxQueries`) without the exact URL.
   - Selection rule:
     - Prefer Arrow only if endpoint URL is documented, tenant and capacity checks pass, and integration tests confirm safe compatibility.
     - Otherwise ship JSON as first slice.

4. RLS and identity safety
   - Preserve delegated user identity end to end.
   - Never accept client-provided `impersonatedUserName`.
   - Respect documented constraint that service principals do not support RLS and SSO scenarios for execute queries.

5. Safe source object contract
   - `source_table` cannot carry arbitrary DAX or arbitrary table names.
   - Canonical source IDs are implementable and limited to:
     - Server-side configured query template IDs plus validated parameters
     - Generated table-preview query selected from verified metadata (workspace, dataset, table identifiers validated against discovered metadata)
   - Reject free-form DAX from all client payload fields.
   - Reject unknown template IDs, unknown parameters, and out-of-policy parameter values.

6. Metadata discovery decision gate
   - Add explicit gate because Fabric semantic model item APIs can expose item metadata but may not expose full table and measure schema for safe query generation.
   - Explicit safety rule:
     - Arbitrary semantic model table import is blocked until the metadata spike identifies an official schema surface and validates safe DAX generation for table preview queries.
   - Evaluate supported options during spike:
     - Power BI metadata path
     - XMLA metadata path
     - Arrow schema path only after exact endpoint and capability validation
   - Do not fabricate a schema endpoint.

## Tech Stack

### Backend

- Python Flask backend under `py-src/data_formulator`
- Data loader interfaces under `py-src/data_formulator/data_loader`
- Shared Fabric clients under `py-src/data_formulator/integrations/fabric/`
- Existing connector routes in `py-src/data_formulator/data_connector.py` unless a future ADR justifies route extraction
- Existing delegated OAuth session system from the workspace foundation plan

### APIs

- Fabric REST for workspace and item discovery
- Power BI JSON execute queries endpoint for query execution
- Optional Power BI Arrow query endpoint after endpoint and capability checks

### Frontend

- TypeScript React picker flows under `src/views/`
- i18n through the existing react-i18next pipeline

### Testing

- Pytest with the backend marker for backend and integration tests
- Vitest for frontend picker behavior under view-level tests

## Official Constraints To Enforce

1. JSON executeQueries constraints
   - Tenant setting required
   - Dataset read plus build permission required
   - One DAX query and one result table per request
   - Max 100000 rows or 1000000 values
   - 15 MB max response body
   - 120 requests per minute per user
   - No pagination
   - Service principals do not support RLS and SSO scenarios
   - Handle API-level errors in response payload even when HTTP status is 200
   - Respect and surface `Retry-After` on throttling

2. Arrow executeDaxQueries constraints
   - Returns Arrow IPC
   - Premium or Fabric capacity only
   - Requires Dataset Execute Queries permission and XMLA tenant setting
   - No pagination
   - Supports row limit and query timeout
   - Stream with explicit byte and row caps; decode with `pyarrow.ipc` only after endpoint and capability validation

3. Runtime policy
   - JSON endpoint is the default first delivery slice unless Arrow checks pass.
   - Enforce both API and product limits:
     - API limits: 15 MB, 100000 rows, 1000000 values, 120 requests per minute per user, no pagination
     - Product limits: `MAX_IMPORT_ROWS` and loader-level byte and value safety caps

## TDD Implementation Tasks

1. Task 1, add failing backend tests for loader registration and hierarchy.
   Path: `tests/backend/data/test_fabric_semantic_model_loader_registry.py`.
   Covers: `_LOADER_SPECS` registration in `py-src/data_formulator/data_loader/__init__.py`, Workspace -> Semantic Model -> safe source contract browse shape, and rejection of arbitrary DAX in `source_table`.
   Command: `python -m pytest -m backend tests/backend/data/test_fabric_semantic_model_loader_registry.py -q`.

2. Task 2, add failing backend tests for Fabric discovery and SemanticModel filtering.
   Path: `tests/backend/data/test_fabric_semantic_model_discovery.py`.
   Covers: workspace and item enumeration, `SemanticModel` filtering, and explicit assertion that Fabric item APIs are discovery-only in this loader.
   Command: `python -m pytest -m backend tests/backend/data/test_fabric_semantic_model_discovery.py -q`.

3. Task 3, add failing backend auth tests for delegated identity and RLS safety.
   Path: `tests/backend/auth/test_fabric_semantic_model_identity_rls.py`.
   Covers: delegated identity preservation, strict rejection of client `impersonatedUserName`, and service-principal blocking for RLS-sensitive query paths.
   Command: `python -m pytest -m backend tests/backend/auth/test_fabric_semantic_model_identity_rls.py -q`.

4. Task 4, add failing backend integration tests for API selection spike.
   Path: `tests/backend/integration/test_fabric_semantic_model_api_selection_spike.py`.
   Covers: JSON default path, Arrow gated by endpoint documentation and capability checks, and fallback to JSON when Arrow checks fail.
   Required spike artifact: record exact Arrow endpoint URL from official docs in test fixtures and plan notes before Arrow implementation starts.
   Command: `python -m pytest -m backend tests/backend/integration/test_fabric_semantic_model_api_selection_spike.py -q`.

5. Task 5, add failing backend tests for JSON `executeQueries` parsing and limits.
   Path: `tests/backend/data/test_powerbi_execute_queries_json.py`.
   Covers:
   - exact endpoint `POST https://api.powerbi.com/v1.0/myorg/datasets/{datasetId}/executeQueries`
   - one query and one result table expectations
   - 100000 row and 1000000 value boundaries
   - 15 MB body cap handling
   - 120 requests per minute per user behavior
   - `Retry-After` handling on throttling
   - no pagination assumptions
   - response-level error handling on HTTP 200 payload errors
   - sanitized error mapping and audience enforcement for `https://analysis.windows.net/powerbi/api/`
   Command: `python -m pytest -m backend tests/backend/data/test_powerbi_execute_queries_json.py -q`.

6. Task 6, implement backend loader and integration clients to satisfy failing tests.
   Paths:
   - `py-src/data_formulator/data_loader/fabric_semantic_model_data_loader.py`
   - `py-src/data_formulator/data_loader/__init__.py`
   - `py-src/data_formulator/integrations/fabric/` (shared Fabric and Power BI clients)
   - `py-src/data_formulator/data_connector.py` (route wiring, if needed)
   Covers: Fabric discovery with `SemanticModel` filtering, JSON query execution first slice, source contract validation, delegated identity only, and sanitized limits-aware error handling.
   Command: `python -m pytest -m backend tests/backend/data tests/backend/auth tests/backend/integration -q`.

7. Task 7, add failing backend integration tests for Arrow path normalization and safety gate.
   Path: `tests/backend/integration/test_powerbi_execute_dax_queries_arrow.py`.
   Covers: endpoint/capability-gated enablement, streamed byte and row caps, `pyarrow.ipc` decode path, timeout handling, no pagination assumptions, and parity checks against JSON normalization.
   Command: `python -m pytest -m backend tests/backend/integration/test_powerbi_execute_dax_queries_arrow.py -q`.

8. Task 8, add failing frontend view tests first.
   Path: `tests/frontend/unit/views/fabric-semantic-models-picker.test.tsx`.
   Covers: Workspace -> Semantic Model -> template/table-preview selection flow, disabled free-form DAX input, and backend limit/error state rendering.
   Command: `yarn test tests/frontend/unit/views/fabric-semantic-models-picker.test.tsx`.

9. Task 9, implement frontend view and exact i18n keys.
   Paths:
   - `src/views/FabricSemanticModelsPicker.tsx`
   - `src/i18n/locales/en/loader.json`
   - `src/i18n/locales/zh/loader.json`
   - `src/i18n/locales/en/errors.json`
   - `src/i18n/locales/zh/errors.json`
   Covers: safe-source selection UI only, delegated session dependency from shared foundation, and i18n-only user-visible text.
   Command: `yarn test tests/frontend/unit/views/fabric-semantic-models-picker.test.tsx`.

10. Task 10, add metadata gate tests and enforce import block until safe metadata is proven.
    Path: `tests/backend/integration/test_fabric_semantic_model_metadata_gate.py`.
    Covers: metadata source selection without fabricated endpoints, enforced block on arbitrary semantic model table import when official schema surface is unavailable, and safe generated preview-query path only after validation.
    Command: `python -m pytest -m backend tests/backend/integration/test_fabric_semantic_model_metadata_gate.py -q`.

11. Task 11, static registration and contract verification checks.
    Checks and commands:
    - registration entry exists in loader registry:
      - `rg "FabricSemanticModelDataLoader" py-src/data_formulator/data_loader/__init__.py`
    - canonical loader file exists and exports loader class:
      - `rg "class FabricSemanticModelDataLoader" py-src/data_formulator/data_loader/fabric_semantic_model_data_loader.py`
    - route integration remains in connector route module:
      - `rg "fabric|semantic" py-src/data_formulator/data_connector.py`
    - no accidental route/module invention in this slice:
      - `rg "data_loader_routes|services/fabric_semantic_model" py-src/data_formulator`

12. Task 12, run full verification commands.
    Commands:
    - `python -m pytest -m backend tests/backend/data tests/backend/auth tests/backend/integration -q`
    - `yarn test tests/frontend/unit/views/fabric-semantic-models-picker.test.tsx`
    - `python -m pytest -m backend tests/backend -q`
    - `yarn test`

## Quality Attribute Gates

This plan is gated by shared release-blocking requirements in
`docs/plans/2026-07-09-connector-implementation-requirements.md`:

- SIMPLE-001 through SIMPLE-006
- ROBUST-001 through ROBUST-008
- PERF-001 through PERF-008

Fabric semantic model specific quality criteria (excluding user think-time and
interactive IdP or MFA time):

- Semantic model page response MUST be <= 3 seconds p95 in a representative
   environment.
- Query preview up to 10,000 rows MUST be <= 5 seconds p95 where Power BI API
   behavior permits.
- JSON response body limits and row or value limits (15 MB, 100,000 rows,
   1,000,000 values) MUST be enforced.
- Arrow handling, when enabled, MUST stream and enforce byte and row bounds
   before decode.
- DAX semantic failures MUST NOT be automatically retried.
- Power BI request budget of 120 requests per minute per user MUST be
   respected.
- Safe templates MUST keep UX simple.
- Arbitrary free-form DAX input boxes are not allowed.

## Definition of Done

1. `FabricSemanticModelDataLoader` is implemented in `py-src/data_formulator/data_loader/fabric_semantic_model_data_loader.py` and registered in `_LOADER_SPECS` in `py-src/data_formulator/data_loader/__init__.py`.
2. Hierarchy is Workspace -> Semantic Model -> safe source target (template ID plus validated parameters, or metadata-validated table preview query).
3. Delegated identity and RLS behavior are preserved, and client `impersonatedUserName` is always rejected.
4. Audience and scope are handled correctly for Power BI query calls:
   - Audience: `https://analysis.windows.net/powerbi/api/`
   - Scope: `https://analysis.windows.net/powerbi/api/Dataset.Read.All`
5. JSON `executeQueries` path is production-ready with exact endpoint usage, payload-level error handling on HTTP 200, 15 MB cap, 100000/1000000 limits, 120 per minute per user handling, `Retry-After`, and no pagination assumptions.
6. Arbitrary semantic model table import remains blocked until metadata spike confirms an official schema surface and safe DAX generation.
7. Arrow path is only enabled after exact endpoint URL is documented from official docs, capability checks pass, and streamed bytes and rows are capped before `pyarrow.ipc` decode.
8. Backend and frontend tests are green, including i18n coverage in exact loader and error locale files.
9. Shared quality gates SIMPLE-001 through SIMPLE-006,
   ROBUST-001 through ROBUST-008, and PERF-001 through PERF-008 are satisfied
   per `docs/plans/2026-07-09-connector-implementation-requirements.md`.
10. The DF-019 quality evidence reports pass with no unapproved exceptions:
   `docs/plans/evidence/df-019-fabric-semantic-models-quality-report.json`
   and `docs/plans/evidence/df-019-fabric-semantic-models-quality-report.md`.

## References

- [https://learn.microsoft.com/rest/api/fabric/semanticmodel/items/get-semantic-model](https://learn.microsoft.com/rest/api/fabric/semanticmodel/items/get-semantic-model)
- [https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries](https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries)
- [https://learn.microsoft.com/power-bi/developer/execute-dax-queries-arrow/overview](https://learn.microsoft.com/power-bi/developer/execute-dax-queries-arrow/overview)
- [https://learn.microsoft.com/fabric/enterprise/powerbi/service-premium-connect-tools#security](https://learn.microsoft.com/fabric/enterprise/powerbi/service-premium-connect-tools#security)
- [https://learn.microsoft.com/fabric/security/service-admin-row-level-security](https://learn.microsoft.com/fabric/security/service-admin-row-level-security)
