---
status: Proposed
date: 2026-07-09
scope: Define readiness requirements and objective evidence for Azure SQL and Microsoft Fabric connector implementation.
falsification-deadline: 2026-09-30
related:
  - docs/plans/ISSUES.md
  - docs/plans/2026-07-09-azure-sql-entra-mfa.md
  - docs/plans/2026-07-09-fabric-workspaces.md
  - docs/plans/2026-07-09-fabric-lakehouse.md
  - docs/plans/2026-07-09-fabric-semantic-models.md
---

# Connector Implementation Requirements

## 1. Purpose and scope

This document defines readiness requirements for connector fixes plus Azure SQL and Microsoft Fabric connector delivery. It is the source of truth for readiness and acceptance criteria across prerequisites, security, dependencies, and validation evidence.

Implementation order and issue sequencing remain in `docs/plans/ISSUES.md`. This document does not replace that tracker.

## 2. Status legend

- **Verified available**: Confirmed by direct command or runtime evidence on
  2026-07-09.
- **Declared not installed**: Explicitly absent by command output or executable
  check.
- **Missing**: Required artifact or capability not yet present.
- **External verification required**: Depends on tenant resources, policy, or
  live assets not yet verified in this workspace.

## 3. Verified environment snapshot (2026-07-09)

### 3.1 Local runtime and tooling

| Area | Status | Evidence |
| --- | --- | --- |
| OS | Verified available | Windows environment |
| Python | Verified available | Python 3.12.10 on PATH |
| Python virtual environment | Declared not installed | No `.venv/` and no `venv/` detected |
| Python imports | Declared not installed | Imports currently false for `pyodbc`, `flask_session`, `cachelib`, `redis`, `deltalake`, `pyarrow`, `pytest` |
| Python CLI helpers | Declared not installed | `uv` and `pytest` commands are missing |
| Node.js | Verified available | Node 24.18.0 |
| Corepack | Verified available | Corepack 0.35.0 |
| Yarn runtime | Verified available | Direct `yarn` command missing, `corepack yarn` provides Yarn 1.22.22 |
| Frontend dependencies | Verified available | `node_modules/` exists |
| Frontend test and build binaries | Verified available | Vitest 4.1.1, `eslint`, and `vite` binaries exist |
| Docker | Declared not installed | `docker` missing on PATH |
| Azure CLI | Verified available | `az` 2.88.0 |
| Azure Developer CLI | Verified available | `azd` 1.27.0 |
| Azure CLI Bicep integration | Verified available | Azure CLI Bicep 0.44.1 available |
| Standalone Bicep binary | Declared not installed | Standalone `bicep` command absent, not required when Azure CLI Bicep integration is available |
| SQL Server ODBC driver | Declared not installed | No ODBC Driver 17 or 18 found |

### 3.2 Auth/session and cloud context

| Area | Status | Evidence |
| --- | --- | --- |
| Azure CLI authentication | Verified available | Azure CLI authenticated |
| azd environment | Verified available | `dataformulator` environment exists |
| Sensitive identifiers | In scope exclusion | Subscription IDs, tenant IDs, principal IDs, user emails, and similar identifiers are intentionally excluded from this document |

### 3.3 Production Container App and resource footprint

| Area | Status | Evidence |
| --- | --- | --- |
| Container App scale | Verified available | Minimum replicas 1, maximum replicas 3 |
| Current env var families | Verified available | Current app/OpenAI/App Insights names present |
| OIDC/Fabric/Power BI/Redis/Azure SQL env vars | Missing | Not present in current app environment set |
| Live resource inventory classes | Verified available | App, environment, registry, OpenAI, App Insights, managed identity, network, certificate, and storage classes are present |
| Redis in app resource group | Missing | Targeted check found no Redis resource |
| Azure SQL in app resource group | Missing | Targeted check found no Azure SQL resource |
| Key Vault in app resource group | Missing | Targeted check found no Key Vault resource |

### 3.4 Fabric and accelerator evidence

| Area | Status | Evidence |
| --- | --- | --- |
| Fabric MCP workspace listing | Verified available | Fabric MCP can list accessible workspaces |
| Sampled workspace OneLake content | Missing | Three sampled workspaces had no OneLake items |
| Lakehouse/Semantic Model concrete test asset | External verification required | No concrete delegated test asset verified yet |
| WorkIQ | Verified available | WorkIQ available and lists agents |
| Agency installation | Verified available | Agency 2026.7.8.6 is installed |
| Agency Fabric profiles | Verified available | `agency config list` exposes `project-fabric`, `project-fabric-notebooks`, `project-fabric-review`, and `project-fabric-security` |
| Agency Fabric skills plugin | Verified available | Effective Agency configuration includes the Microsoft Fabric skills plugin |
| Unsupported Agency command | Not applicable | `agency profile list` is invalid syntax; use `agency config list` and `agency copilot --profile <name>` |

## 4. Development accelerators versus shipped runtime

| Capability | Valid use in this program | Not acceptable as runtime substitute |
| --- | --- | --- |
| Agency | Discovery, spike execution, draft generation, fixture prep, coding-agent scoped workflows | Runtime OAuth/session/token handling, connector clients, server loader contracts |
| Fabric MCP and Fabric IQ | Workspace and item discovery exploration, API familiarization, contract probing | Production delegated auth/session flow, backend token-store behavior, live runtime connector data path |
| WorkIQ | Agent/tool inventory and workflow assistance for implementation support | Replacement for runtime integration code, auth boundaries, or loader execution contracts |

Fabric IQ and WorkIQ runtime integration is out of scope unless separately designed, specified, and accepted.

## 5. Quality attributes

The connectors must be simple, robust and performant.

The following quality attributes are release-blocking for DF-016 through DF-019.

### 5.1 SIMPLE requirements

- **SIMPLE-001 (MUST):** Connector UX MUST use existing Add Connection, card, and catalog patterns. A separate bespoke navigation flow MUST NOT be added unless a usability test proves the generic UI is insufficient.
- **SIMPLE-002 (MUST):** Delegated mode MUST NOT require token copy/paste, raw connection-string assembly, or provider-specific secret handling by the user.
- **SIMPLE-003 (MUST):** The first connection path after connector selection MUST require at most three app actions: required target or scope selection, Sign in, and Connect. IdP and MFA screens and optional advanced settings are excluded from this count.
- **SIMPLE-004 (MUST):** Defaults MUST cover the common case. Advanced fields MUST be collapsed and optional. Only context-required fields MUST be shown. No invented generic select control is allowed when the existing form schema cannot support the need; a reusable control MAY be added only with tests.
- **SIMPLE-005 (MUST):** Error messages MUST name the failed stage and provide actionable recovery guidance without secrets and without raw upstream text.
- **SIMPLE-006 (MUST):** All delegated connectors MUST share one auth, token,
  and session foundation. Fabric connectors MUST also share Fabric REST,
  retry, and pagination client primitives. Duplicated OAuth, retry, or
  pagination implementations are not allowed.

### 5.2 ROBUST requirements

- **ROBUST-001 (MUST):** Every external call MUST have explicit connect timeout, read timeout, and total timeout, plus cancellation where supported. Timeout values MUST be centralized, configurable, and bounded by safe defaults.
- **ROBUST-002 (MUST):** Retries MUST apply only to transient classes (408, 429, selected 5xx, and network failures), use max three attempts by default, exponential backoff with jitter, and honor Retry-After with a configured cap. Retries MUST NOT apply to auth, permission, validation, DAX semantic, or SQL semantic errors.
- **ROBUST-003 (MUST):** Token handling MUST fail closed on missing token, wrong audience, or expired token. Credential mode fallback is not allowed.
- **ROBUST-004 (MUST):** Connect, import, and refresh flows MUST be atomic from the user perspective. No live loader, cache, or source metadata may be committed until validation succeeds. Failures MUST clean temporary resources and preserve the last known good state.
- **ROBUST-005 (MUST):** Identity, connector, and audience isolation plus multi-replica session continuity MUST be tested, including concurrent tabs, callback reorder and replay, token expiry, replica change, and cancellation.
- **ROBUST-006 (MUST):** Pagination MUST terminate deterministically, including continuation-cycle detection and page and item caps.
- **ROBUST-007 (MUST):** Errors MUST use the unified protocol, logs MUST be sanitized, request correlation MUST be present, and upstream response bodies MUST NOT be logged.
- **ROBUST-008 (MUST):** Each connector MUST include mocked unit and contract tests plus opt-in real-service smoke tests. Outage, throttling, partial response, and malformed payload scenarios MUST be covered.

### 5.3 PERF requirements

PERF budgets are provisional until Gate D establishes baselines. After Gate D baseline approval, PERF budgets are release-blocking.

- **PERF-001 (MUST):** Initial views MUST NOT perform eager whole-tenant or whole-catalog scans. Implement lazy paging and server-side filtering where the API supports it. List pages MUST NOT perform per-item metadata N+1 enrichment.
- **PERF-002 (MUST):** Representative-environment p95 targets, excluding user
  think-time and interactive IdP or MFA time, are: connector status and list
  first response <= 2 seconds, catalog page <= 3 seconds, preview up to 10,000
  rows <= 5 seconds. Measure both server-side and end-to-end. If source SLA
  makes a target impossible, record source timing, budget exception, and
  approved revised threshold before release. Silent waiver is not allowed.
- **PERF-003 (MUST):** The first catalog page MUST be bounded at <= 200 nodes unless the upstream API enforces a lower bound. Fetch subsequent pages on demand.
- **PERF-004 (MUST):** Data access MUST stream or batch. Enforce a byte cap before materialization and enforce `MAX_IMPORT_ROWS`. Avoid duplicate full in-memory copies. Include a peak-memory test with a connector-specific threshold selected at Gate D.
- **PERF-005 (MUST):** Cache only safe metadata with explicit TTL and invalidation. Delegated data MUST NOT be cached across identities. Client max-age, if used, MUST be separate, short, and private.
- **PERF-006 (MUST):** Instrument latency, upstream duration, retry count, pages, rows, bytes, cache outcome, and error class without logging source names, source IDs, or tokens. Establish p50 and p95 baselines at Gate D.
- **PERF-007 (MUST):** Regression gate: p95 latency and peak memory MUST NOT worsen by more than 20 percent against the approved baseline unless a review and exception are recorded.
- **PERF-008 (MUST):** Concurrency MUST be bounded. Unbounded fan-out is not allowed. Connector-specific concurrency limits MUST be selected and tested during the spike.

### 5.4 Quality evidence

Both evidence classes are required:

- Synthetic and mocked latency tests to prove client overhead and algorithmic bounds.
- Real-service Gate D tests to prove end-to-end budgets in representative environments.

Evidence artifacts must be recorded under the planned path `docs/plans/evidence/` (do not create this path in this change).

Record one JSON report and one Markdown report per connector:

- `docs/plans/evidence/df-016-azure-sql-quality-report.json`
- `docs/plans/evidence/df-016-azure-sql-quality-report.md`
- `docs/plans/evidence/df-017-fabric-workspaces-quality-report.json`
- `docs/plans/evidence/df-017-fabric-workspaces-quality-report.md`
- `docs/plans/evidence/df-018-fabric-lakehouse-quality-report.json`
- `docs/plans/evidence/df-018-fabric-lakehouse-quality-report.md`
- `docs/plans/evidence/df-019-fabric-semantic-models-quality-report.json`
- `docs/plans/evidence/df-019-fabric-semantic-models-quality-report.md`

Each report MUST include:

- Connector and gate identifier.
- Environment class only, without tenant or resource identifiers.
- Dataset and catalog scale characteristics.
- p50 and p95 latency metrics.
- Peak memory measurement.
- Retry and throttling counters.
- Pass or approved exception status with rationale.

## 6. Requirements

### 6.1 TOOL requirements

| ID | Requirement | Level |
| --- | --- | --- |
| TOOL-001 | A local Python virtual environment MUST be created and activated before backend development or test execution. | MUST |
| TOOL-002 | Project and development Python dependencies MUST be installed in that virtual environment from repository manifests. | MUST |
| TOOL-003 | Frontend dependency and script commands MUST use `corepack yarn` (Yarn 1.22.22). Direct `npm` usage MUST NOT be used in this repo. | MUST |
| TOOL-004 | Docker SHOULD be installed when container image build, local container validation, or image-based integration work is required. | SHOULD |
| TOOL-005 | Microsoft ODBC Driver 18 for SQL Server MUST be installed for Azure SQL delegated token connectivity. | MUST |

### 6.2 DEP requirements

| ID | Requirement | Level |
| --- | --- | --- |
| DEP-001 | Existing declarations for `pyodbc`, `pyarrow`, and `flask-session` in runtime manifests and `pytest` in development dependencies MUST remain present and version-compatible. | MUST |
| DEP-002 | Redis client and server-side session backend dependency additions MUST occur only after an explicit session-backend decision. | MUST |
| DEP-003 | `deltalake` MUST be added only if the Fabric Lakehouse spike records a winning path that requires it. | MUST |
| DEP-004 | `pyproject.toml`, `requirements.txt`, and lock artifacts MUST remain synchronized after dependency changes. | MUST |
| DEP-005 | Node package manager usage MUST remain Yarn-only; npm and pnpm MUST NOT be introduced. | MUST |

### 6.3 SEC requirements

| ID | Requirement | Level |
| --- | --- | --- |
| SEC-001 | Production session state MUST use a shared server-side session store compatible with multi-replica deployment. | MUST |
| SEC-002 | Production session handling MUST NOT fall back to cookie-only state for delegated auth flows. | MUST |
| SEC-003 | `SESSION_COOKIE_SECURE` MUST be true for production runtime. | MUST |
| SEC-004 | Flask/session secret material MUST come from high-entropy secure input or Key Vault sourced secret flow. | MUST |
| SEC-005 | OAuth state management MUST use strict, bounded, single-use state maps with explicit identity and connector binding. | MUST |
| SEC-006 | Popup callback handling MUST validate both message origin and source before accepting auth completion. | MUST |
| SEC-007 | Token isolation MUST enforce identity plus connector plus audience or profile keying in TokenStore paths. | MUST |
| SEC-008 | Tokens MUST NOT be logged, persisted in connector vault/config, or sent to browser storage unless explicitly approved by separate design. | MUST |

### 6.4 ID requirements

| ID | Requirement | Level |
| --- | --- | --- |
| ID-001 | A confidential Microsoft Entra app registration MUST exist for backend-mediated delegated flows. | MUST |
| ID-002 | Redirect URIs MUST exactly match deployed callback endpoints for each delegated connector flow. | MUST |
| ID-003 | Admin consent and least-privilege delegated permissions MUST be validated before integration testing. | MUST |
| ID-004 | Azure SQL delegated scope MUST be `https://database.windows.net/.default`; consent and resource setup assumptions MUST be explicitly verified. | MUST |
| ID-005 | Fabric scopes MUST include `https://api.fabric.microsoft.com/Workspace.Read.All` and `https://api.fabric.microsoft.com/Item.Read.All`. | MUST |
| ID-006 | OneLake Storage delegated scope MUST include `https://storage.azure.com/.default`. | MUST |
| ID-007 | Power BI delegated scope MUST include `https://analysis.windows.net/powerbi/api/Dataset.Read.All`. | MUST |
| ID-008 | Conditional Access MFA enforcement MUST be handled by Entra policy; connector auth design MUST preserve delegated interactive flow compatibility. | MUST |
| ID-009 | TokenStore keying MUST be audience-aware and bind identity plus connector plus audience or profile. | MUST |
| ID-010 | Managed identity MUST NOT be treated as equivalent to delegated user authorization for user-scoped data access flows. | MUST |

### 6.5 AZR requirements

| ID | Requirement | Level |
| --- | --- | --- |
| AZR-001 | A shared Redis-compatible session resource or formally approved equivalent MUST be provisioned for production multi-replica session integrity. | MUST |
| AZR-002 | A Key Vault or approved high-entropy secret source MUST provide runtime session secret material. | MUST |
| AZR-003 | Runtime container image MUST include ODBC support required for token-based Azure SQL connections. | MUST |
| AZR-004 | Azure SQL target MAY be external to app resource group, but if required it MUST have Entra admin configured and contained users or groups provisioned. | SHOULD |
| AZR-005 | Network controls MUST validate firewall or private endpoint requirements for SQL and Fabric access paths. | MUST |
| AZR-006 | App Insights telemetry MUST remain sanitized and exclude credentials, tokens, and sensitive payloads. | MUST |
| AZR-007 | Current app resource group lacks Redis, Azure SQL, and Key Vault; this MUST be treated as an active readiness gap. | MUST |

### 6.6 FAB requirements

| ID | Requirement | Level |
| --- | --- | --- |
| FAB-001 | Test users MUST have explicit Fabric workspace membership for target workspaces. | MUST |
| FAB-002 | Delegated OneLake permissions MUST be validated for required file and table access paths. | MUST |
| FAB-003 | Power BI dataset permissions MUST include Read plus Build for query execution scenarios. | MUST |
| FAB-004 | Tenant setting for Execute Queries MUST be enabled where required by semantic model runtime path. | MUST |
| FAB-005 | Arrow query path use MUST satisfy capacity and XMLA requirements before enablement. | MUST |
| FAB-006 | Service principal authentication MUST NOT be treated as equivalent to delegated RLS behavior. | MUST |
| FAB-007 | Data residency and private endpoint expectations MUST be validated for tenant and network policy alignment. | MUST |

### 6.7 TEST requirements

| ID | Requirement | Level |
| --- | --- | --- |
| TEST-001 | A representative Azure SQL test database MUST exist for delegated auth and query validation. | MUST |
| TEST-002 | A Fabric workspace with a managed Delta Lakehouse and representative Files assets MUST exist for integration testing. | MUST |
| TEST-003 | Files test assets MUST include CSV, TSV, Parquet, JSON, and JSONL coverage. | MUST |
| TEST-004 | A Semantic Model test asset MUST include both safe non-RLS and RLS scenarios, with Build permission in test principal context. | MUST |
| TEST-005 | Throttling and error fixtures MUST exist for retry, timeout, pagination, and unified error-path validation. | MUST |
| TEST-006 | Production-sensitive data MUST NOT be used in connector integration fixtures. | MUST |
| TEST-007 | Three sampled empty workspaces are not sufficient as representative validation assets. | MUST |

### 6.8 APP requirements

| ID | Requirement | Level |
| --- | --- | --- |
| APP-001 | Workspace and item discovery MUST be implemented in shared runtime infrastructure, not fake generic loaders. | MUST |
| APP-002 | Connector loaders MUST be registered through the loader registry with stable source identifier contracts and strict parser validation. | MUST |
| APP-003 | Runtime read limits MUST enforce both row and byte safety boundaries where applicable. | MUST |
| APP-004 | Unified backend errors and frontend error consumption paths MUST conform to existing unified error protocol. | MUST |
| APP-005 | Frontend user-visible text MUST use i18n resources and include required locale entries in `src/` locale files. | MUST |
| APP-006 | Backend and frontend automated tests MUST cover happy path, boundary, security, and regression paths for each connector slice. | MUST |

## 7. Connector-specific readiness gates (DF-016 through DF-019)

### DF-016: Azure SQL delegated Entra authentication

- **Prerequisites**: TOOL-001, TOOL-002, TOOL-005, SEC-001, SEC-003,
  SEC-005, SEC-007, ID-001, ID-004, AZR-001, AZR-002, TEST-001, APP-002,
  SIMPLE-001 through SIMPLE-006, ROBUST-001 through ROBUST-008,
  PERF-001, PERF-002, PERF-004, PERF-006, PERF-007, PERF-008.
- **Go condition**: A delegated token is acquired and injected through the ODBC
  token path while SQL and Windows authentication regressions remain green.
  The shared delegated-auth/session foundation may be reused, but Fabric API
  discovery semantics are not required.

### DF-017: Fabric workspace and item discovery

- **Prerequisites**: TOOL-001, TOOL-002, SEC-001 through SEC-007, ID-001,
  ID-005, AZR-001, AZR-002, FAB-001, APP-001, APP-004, SIMPLE-001 through
  SIMPLE-006, ROBUST-001 through ROBUST-008, PERF-001, PERF-002, PERF-003,
  PERF-005, PERF-006, PERF-007, PERF-008.
- **Go condition**: Per-user delegated authentication and workspace-item
  discovery operate with bounded pagination/retry and token-safe popup/session
  behavior.

### DF-018: Fabric Lakehouse imports

- **Prerequisites**: DF-017 complete, ID-006, FAB-002, TEST-002, TEST-003,
  TEST-005, APP-002, APP-003, SIMPLE-001 through SIMPLE-006,
  ROBUST-001 through ROBUST-008, PERF-001 through PERF-008.
- **Go condition**: Managed Delta and approved file formats import through
  validated OneLake data paths with enforced limits and unified errors.

### DF-019: Fabric Semantic Model query imports

- **Prerequisites**: DF-017 complete, ID-007, FAB-003 through FAB-006,
  TEST-004, TEST-005, APP-002, APP-003, APP-004, SIMPLE-001 through
  SIMPLE-006, ROBUST-001 through ROBUST-008, PERF-001 through PERF-008.
- **Go condition**: Delegated semantic query execution operates with RLS
  safety preserved and result limits plus throttle handling validated.

Correction versus tracker shorthand: extractable delegated-auth and session foundations from DF-017 may be shared broadly, but Azure SQL readiness does not depend on Fabric API discovery behavior.

## 8. Phase gates aligned to tracker

| Gate | Scope | Objective evidence (no secrets) |
| --- | --- | --- |
| Gate A | Local development baseline | Confirm venv creation, dependency install, `corepack yarn --version`, backend/frontend test tool availability, `Get-OdbcDriver` presence checks |
| Gate B | Security and session baseline | Confirm shared session backend configured, secure cookie enabled, high-entropy secret source configured, popup origin/source checks and OAuth state map tests passing |
| Gate C | Entra and resource consent baseline | Confirm delegated app registration setup, callback URI alignment, required scopes consented, and runtime resource classes provisioned where required |
| Gate D | Quality baseline and scenario validation | Establish connector p50 and p95 latency baselines and connector-specific peak-memory and concurrency thresholds in representative environments; validate first-connection usability path and failure scenarios (timeouts, throttling, cancellation, callback replay and reorder, token expiry); record provisional PERF budgets and any approved exceptions with evidence links |
| Gate E | Release budget enforcement | Enforce approved release budgets and regression policy: p95 latency and peak memory must not regress by more than 20 percent without recorded review and exception; confirm quality evidence reports are complete and linked to tracker transitions |

## 9. Safe verification commands (PowerShell)

Use these commands for evidence collection. Do not print secrets or principal identifiers in reports.

```powershell
# Python runtime and virtual environment checks
python --version
Get-ChildItem -Name .venv, venv -ErrorAction SilentlyContinue

# Python import availability in current interpreter
python -c "import importlib.util as u;mods=['pyodbc','flask_session','cachelib','redis','deltalake','pyarrow','pytest'];print({m: bool(u.find_spec(m)) for m in mods})"

# Command presence checks
Get-Command uv, pytest, docker -ErrorAction SilentlyContinue | Select-Object Name, Source

# Node, Corepack, Yarn via Corepack
node --version
corepack --version
corepack yarn --version

# Frontend tool binary checks from local node_modules
Get-ChildItem node_modules/.bin | Where-Object { $_.Name -in @('vitest','eslint','vite') } | Select-Object Name

# ODBC driver availability
Get-OdbcDriver | Where-Object { $_.Name -match 'ODBC Driver (17|18) for SQL Server' } | Select-Object Name, Platform

# Azure CLI and azd tool versions
az version
azd version
az bicep version
Get-Command bicep -ErrorAction SilentlyContinue | Select-Object Name, Source

# Azure auth state and azd environment existence, avoid account identifiers
az account show --query state -o tsv
azd env list

# Resource-type-only checks, avoid identifiers in output artifacts
az resource list --query "[].type" -o tsv
az resource list --resource-group <app-resource-group> --query "[].type" -o tsv

# Container app scale and env var name checks only
az containerapp show --name <container-app-name> --resource-group <app-resource-group> --query "template.scale" -o json
az containerapp show --name <container-app-name> --resource-group <app-resource-group> --query "template.containers[0].env[].name" -o tsv

# Agency readiness commands, syntax-safe
agency --help
agency config list
agency plugin list
```

Command safety rules:

- Use `corepack yarn` instead of direct `yarn`.
- Do not use `agency profile list` as readiness evidence.
- Verify a profile with `agency copilot --profile <name>` only when the task
  requires that profile; profile activation can fetch plugins.
- Do not echo tokens, secrets, or secret-bearing azd values.
- When inspecting azd environment values, filter to non-sensitive key names only.

## 10. Current gap summary

| Category | Status | Notes |
| --- | --- | --- |
| Blockers | Active | Missing Python venv/dependencies, missing ODBC Driver 18, missing shared session resource, missing Key Vault or equivalent secret source, missing representative Fabric and SQL test assets |
| Partial | Active | Azure CLI and azd readiness present; Node/Corepack/Yarn runtime path present; Fabric MCP listing available; WorkIQ and Agency available for accelerator workflows |
| Ready | Limited | Baseline local OS and Node toolchain are sufficient to start prerequisite remediation and evidence capture |

## 11. Definition of ready

Readiness is achieved only when all MUST requirements in this document are verified with objective evidence, evidence is recorded in repository planning artifacts, and `docs/plans/ISSUES.md` tracker states and gates are updated to reflect verified completion.

## 12. References

Repository references:

- `docs/plans/ISSUES.md`
- `docs/plans/2026-07-09-azure-sql-entra-mfa.md`
- `docs/plans/2026-07-09-fabric-workspaces.md`
- `docs/plans/2026-07-09-fabric-lakehouse.md`
- `docs/plans/2026-07-09-fabric-semantic-models.md`
- `pyproject.toml`
- `requirements.txt`
- `Dockerfile`
- `infra/modules/containerapp.bicep`
- `py-src/data_formulator/app.py`
- `py-src/data_formulator/auth/token_store.py`
- `py-src/data_formulator/data_connector.py`
- `py-src/data_formulator/data_loader/`
- `src/`
- `tests/backend/`
- `tests/frontend/unit/`
- `src/i18n/locales/en/loader.json`

Official Microsoft references already used in plan set:

- [Using Microsoft Entra ID with the ODBC Driver](https://learn.microsoft.com/sql/connect/odbc/using-azure-active-directory?view=sql-server-ver17)
- [Microsoft Entra service principals with Azure SQL](https://learn.microsoft.com/azure/azure-sql/database/authentication-aad-service-principal?view=azuresql)
- [Fabric REST, List Workspaces](https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces)
- [Fabric REST, List Items](https://learn.microsoft.com/rest/api/fabric/core/items/list-items)
- [Fabric API scopes](https://learn.microsoft.com/rest/api/fabric/articles/scopes)
- [OneLake Catalog overview](https://learn.microsoft.com/rest/api/fabric/articles/onelakecatalog/overview)
- [Power BI datasets executeQueries](https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries)
- [Power BI execute DAX queries with Arrow](https://learn.microsoft.com/power-bi/developer/execute-dax-queries-arrow/overview)

## 13. Would revise if

Revise this requirements specification if any of the following occurs by 2026-09-30, whichever triggers first:

1. Three or more MUST requirements are marked complete in tracker state but fail reproducible verification commands.
2. A connector implementation merges while one or more listed MUST prerequisites remain unverified.
3. The upstream plans or runtime architecture change connector scope boundaries and this document no longer maps one-to-one to DF-016 through DF-019 gates.
