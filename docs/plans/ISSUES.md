# Data Formulator Audit and Change Log

This file tracks confirmed issues from the data connector and general stability
audit performed on 2026-07-09. Findings are ordered by severity and intended to
be independently actionable.

It also records changes made against the original upstream Data Formulator
codebase. Copilot and Agency brain assets are excluded from the change ledger
because they do not alter product runtime behavior.

Readiness requirements and objective evidence are maintained in
`docs/plans/2026-07-09-connector-implementation-requirements.md`.

## Implementation Tracker

Work in ascending order. A row may start only after its dependencies and exit
gate are complete. Rows marked parallel may proceed concurrently with each
other, but not before their shared prerequisite row.

| Order | Workstream | Issues | Depends on | Current state | Exit gate |
| --- | --- | --- | --- | --- | --- |
| 1 | Prevent Azure metadata loss | DF-011 | None | Resolved; focused and adjacent tests pass | Concurrent metadata updates cannot overwrite one another |
| 2 | Establish container safety and shared state | DF-012, DF-001 | DF-011 | Mitigated; request limits are bounded and production is capped at one replica | Request memory is bounded; shared state is required before scale-out |
| 3 | Secure connector query boundaries | DF-002 | DF-001 | Resolved; focused and adjacent loader tests pass | Request-controlled identifiers are validated or parameterized |
| 4 | Harden connector lifecycle and reconnect behavior | DF-003, DF-004, DF-024 | DF-001, DF-002 | Resolved and production-verified through `f960263` | Connections close predictably, transient failures preserve credentials, and no-auth connectors initialize on first use |
| 5 | Complete model transport resilience | DF-009, DF-025 | DF-012 | Resolved and production-verified through `f960263` | Bounded retries, finite request deadlines, safe stream interruption, and reproducible LiteLLM builds pass focused tests |
| 6 | Complete production hardening | DF-005 through DF-008, DF-013 through DF-015, DF-022 | DF-001 through DF-004 | Original hardening resolved; DF-022 session-cookie migration decision remains | Persistence, server runtime, timeouts, memory, cookies, logging, and OAuth state pass regression tests without deprecated session configuration |
| 7 | Decide enterprise direct-versus-MCP data architecture | DF-023 | Completed runtime hardening and connector requirements | Provisional hybrid decision recorded; source-paired spike remains | Direct and MCP paths are compared against one identity, data, provenance, reliability, and operations contract |
| 8A | Complete Azure SQL delegated Entra authentication | DF-016, DF-020, DF-021 | Implemented shared delegated-auth primitives | Source blockers deployed; Entra consent, durable sessions, and interactive popup gates remain | ODBC attributes cannot be injected, concurrent users retain independent OAuth state, and Entra token connections remain green |
| 8B | Extend delegated authentication to Fabric discovery | DF-017 | DF-023 and implemented Azure SQL auth foundation | Fabric scopes, discovery, and durable sessions remain | Per-user workspace/item discovery, audience-aware tokens, secure popup flow, and restart-durable sessions are verified |
| 8C | Complete Fabric discovery integration | DF-017 | Shared Fabric delegated-auth contract | Mocked discovery may proceed after DF-023; representative tenant evidence is required for release | Bounded delegated workspace/item discovery passes contract and real-service tests |
| 9A | Add Fabric Lakehouse imports | DF-018 | DF-017 | Blocked on DF-017 and data-plane spikes | Delta and supported file imports pass catalog, limit, and audience tests |
| 9B | Add Fabric Semantic Model queries | DF-019 | DF-017 | Blocked on DF-017 and metadata/query spikes | Delegated RLS-safe query results pass API, limit, and serialization tests |

Orders 9A and 9B are parallel. Update the tracker state and exit-gate evidence
whenever an issue is resolved, superseded, or split.

### Reassessment checkpoint (2026-07-09)

- Source fixes through order 6 are implemented; DF-001 was deployed through a
  narrow Container Apps update. The full subscription template was then
  reconciled with governed live state and deployed successfully.
- Consolidated issue-fix suite: 150 passed, 1 skipped.
- OAuth gateway/provider subset: 101 passed, 1 skipped.
- Full backend suite: 1,952 passed, 12 skipped, 1 xpassed; five failures and
  two setup errors are pre-existing Windows/stale-test issues (plugin fixture
  encoding, symlink privilege, and `sample_datasets` parameter assumptions).
- Connector implementation was paused until the readiness requirements were
  reassessed. Reassessment is now complete.
- Shared delegated-auth implementation may begin. Azure SQL token support and
  Fabric discovery clients may proceed in parallel after that contract is
  green; real-service release gates remain blocked on external prerequisites.
- Azure SQL staging readiness is verified for DNS, TCP 1433, ODBC Driver 18,
  TLS certificate validation, explicit-active-tenant SQL token acquisition,
  three independent connections, and 25 catalog entries through the
  implemented loader. Smoke tests must select the tenant explicitly because
  the local Azure CLI cache contains multiple tenant contexts.
- **Next action at this checkpoint**: complete production Entra consent and
  durable sessions, then verify the interactive popup/MFA flow.

### Review checkpoint (2026-07-13)

- A three-perspective maintainer review validated the intended Azure SQL
  delegated-auth architecture and rejected claims that an external Entra
  callback should carry the application's identity header. The initiating
  signed Flask session is the required callback binding.
- DF-020 was reproduced with a mocked ODBC connection: a user-controlled
  `connection_timeout` value appended a second
  `TrustServerCertificate=yes` attribute after the connector's enforced
  `TrustServerCertificate=no` attribute.
- DF-021 was reproduced with nine pending login starts: the process-global
  registry retained eight states while the initiating session retained nine,
  leaving the oldest session state impossible to complete.
- The affected backend suite passes with 127 tests and one existing unknown
  marker warning. The focused frontend suite passes with 7 tests; the
  production frontend build, touched-file ESLint, editor diagnostics, and
  `git diff --check` also pass. Those checks do not cover the two adversarial
  reproductions above.
- Live verification confirmed that the Entra application declares the Azure
  SQL delegated permission but has no `oauth2PermissionGrant`; tenant-wide
  admin consent remains an external release blocker.
- The ACT Edition installation passes heir-doctor. A transient untracked
  `.github-backup-*` directory and stale `HANDOFF.md` references remain
  repository-hygiene follow-ups RF-001 and RF-002.

### Remediation checkpoint (2026-07-13)

- DF-020 is resolved in source. Shared MSSQL connection construction now
  bounds numeric values, allowlists boolean options, rejects unrepresentable
  driver/control delimiters, and braces representable semicolon-bearing ODBC
  values. Azure SQL's Driver 18 and TLS policy remain authoritative.
- DF-021 is resolved in source. The eight-state limit is enforced per signed
  Flask session, global state records expire by TTL without cross-user count
  eviction, and matched session records are removed even if their process
  record is missing.
- DF-020 validation: 25 focused authentication tests and 90 focused-plus-
  adjacent MSSQL/connector/catalog tests pass.
- DF-021 validation: 19 focused gateway tests and 111 focused-plus-adjacent
  gateway/token-store/connector tests pass.
- Registered the existing `plugin` pytest marker used by
  `tests/backend/data/test_data_connector_framework.py`; the affected backend
  matrix now completes without warnings.
- Full backend validation now passes: 2,023 passed and 13 skipped. Portable
  fixes specify UTF-8 for generated plugin source, exempt explicit no-auth
  loaders from connection-parameter assertions, capability-skip symlink
  creation where the OS denies it, and register the existing `contract`
  marker. A stale Windows-1251 xfail now passes as a normal regression test.
- Full frontend validation now passes: 33 test files and 271 tests. Stale tests
  were aligned to a pure OIDC manager helper, unified `apiRequest`
  migration flow, partial Redux-module mocking, retryable `unknown` model
  status, and inline/table-tooltip source metadata contract. A repeated dynamic
  reducer import was moved out of `beforeEach` to eliminate full-suite timeout
  flakiness.
- Touched frontend ESLint, editor diagnostics, the production frontend build,
  and `git diff --check` pass. The build retains existing bundle-size and
  dynamic-import warnings only.
- Two independent post-implementation maintainer reviews found no remaining
  correctness or security blocker in the local remediation. The mutable OIDC
  singleton test seam raised during review was removed; production and tests
  now share a pure token-manager helper.
- The five remaining warnings all identify DF-022: Flask-Session 0.8 deprecates
  `SESSION_USE_SIGNER`, whose removal needs an explicit cookie migration.
- `.github-backup-*` is ignored. All 202 files in the existing recovery
  directory were verified as exact Git blobs before deletion; all active
  `HANDOFF.md` issue-ledger references resolve to `docs/plans/ISSUES.md`, and
  heir-doctor remains healthy on Edition v4.1.0.
- Source commit `ebada59` is deployed to healthy production revision
  `ca-dataformulator--0000010` on image `azd-deploy-1783998754`. Tenant-wide
  consent and restart-durable shared sessions remain open gates.
- The azd remote build produced digest
  `sha256:a216e301adda980429fb5dbb6296ee44a9fa7ecadbbb4992369f6d2b89438123`.
  Secret synchronization initially failed under the default role; after Owner
  PIM activation, a narrow image-only Container App update completed rollout
  without infrastructure provisioning.
- Post-deployment verification confirms one healthy ready replica with zero
  restarts, 100% latest-revision traffic, the custom domain and one-replica cap,
  HTTP 200 on both endpoints and loader discovery, ODBC Driver 18, managed
  identity/Azure SQL environment keys, clean recent logs, and secure OAuth
  authorization preparation with disposable-connector cleanup.

### Full recreation checkpoint (2026-07-14)

- Published frontend source commit `11dfb1f` and built clean ACR image
  `recreate-11dfb1fd3d3c` with digest
  `sha256:a139f24ddb77ddd6056f12eb69a4a5420e397929f40532bad181a8bd38d45152`.
- Full `azd provision --preview` was rejected because it predicted unrelated
  changes to the Container Apps environment, OpenAI deployments, Application
  Insights, and the OpenAI private endpoint.
- Compiled and what-if validated an app-only Bicep recreation against existing
  environment, managed certificate, identity, ACR, OpenAI, monitoring, network,
  and Azure SQL Entra settings.
- Deleted only `ca-dataformulator` and recreated it as healthy revision
  `ca-dataformulator--7z7e3f1` at 100% traffic. The custom domain and generated
  endpoint return HTTP 200, ODBC Driver 18 and both SQL loader types are
  present, fresh state has zero user connectors/workspaces, startup logs are
  clean, and a browser reload has zero console messages or failed requests.
- Prior revisions were removed with the old app. The retained prior ACR image
  `azd-deploy-1783998754` is now the rollback artifact.

### Post-recreation deployment checkpoint (2026-07-14)

- Published source commit `f960263`, which resolves DF-024 and DF-025 in source.
- Full backend validation passes with 2,032 tests and 13 skips. The five
  warnings remain the known Flask-Session `use_signer` deprecation tracked by
  DF-022.
- ACR remote build produced image `azd-deploy-1784045589` with digest
  `sha256:34755ba63b62236cf2bb023a00c9b9cae6a89acf361fff5cef8041c17cbbf482`.
  The initial azd process stopped after publishing the artifact and before a
  management-plane update; image-only `azd deploy --from-package` completed the
  rollout without provisioning infrastructure.
- Production revision `ca-dataformulator--azd-1784046335` is healthy with one
  ready replica, zero restarts, and 100% traffic. The custom domain, managed
  certificate, user-assigned identity, managed environment, port 5567,
  one-replica cap, and Azure SQL environment settings are preserved.
- DF-024 smoke returned 16 Example Datasets catalog nodes. The container reports
  LiteLLM 1.91.1 and ODBC Driver 18. All three Azure OpenAI models are connected;
  non-streaming GPT-5.4 Mini and streaming tool-enabled completion passed. The
  streaming response emitted `text_delta,text_delta,done`, exact `STREAM_OK`,
  zero errors, and no tool invocation.
- Both endpoints and discovery APIs return HTTP 200. Browser reload has zero
  console messages, failed requests, or HTTP error responses. Disposable smoke
  workspaces were deleted. One malformed smoke fixture omitted the required
  workspace header and logged a pre-agent `ValueError`; the corrected request
  passed.
- The retained image `recreate-11dfb1fd3d3c` from `11dfb1f` is the immediate
  rollback artifact.

## Published Product Change Map

This is the complete commit-level map of product, test, dependency, deployment,
and audit-record changes on the adaptation branch since upstream baseline
`00d0f5e`. ACT Edition and other assistant-only assets are intentionally
excluded from this runtime changelog.

**Table 1:** *Published adaptation changes since the upstream baseline*

| Commit | Change | Detailed record |
| --- | --- | --- |
| `10040a3` | Correct Container Apps network declaration and publish workspace settings | OPS-001 |
| `4e185e9` | Regenerate the frontend dependency lock against the public registry | CHG-003 |
| `b50d922` | Harden production deployment, model compatibility, static assets, and model diagnostics | CHG-001, CHG-002, CHG-004, OPS-001 through OPS-004, DF-010 |
| `fcc6fc8` | Harden connector lifecycle, query boundaries, request limits, persistence, retries, runtime, timeouts, memory, cookies, logging, and OAuth state | DF-001 through DF-015 |
| `14625d4` | Reconcile governed Azure infrastructure state | DF-001 and OPS-001 through OPS-004 |
| `71b1b78` | Add delegated Microsoft Entra authentication for Azure SQL | DF-016 |
| `ebada59` | Resolve ODBC injection and cross-user OAuth-state capacity; complete test stabilization and repository hygiene | DF-020 through DF-022, RF-001, RF-002 |
| `e98ee0f` | Record production revision `0000010` and exclude local environments and archives from Docker build context | Remediation checkpoint and deployment record |
| `95465e1` | Record the enterprise data-access architecture and Chenglong adaptation meeting package | DF-023 and meeting preparation |
| `11dfb1f` | Reconcile stale persisted workspace state and remove startup console/preload noise | Full recreation checkpoint |
| `b71bfc2` | Record the full Container App recreation and image-based rollback state | Full recreation checkpoint and deployment record |
| `f960263` | Initialize no-auth connectors and bound Azure OpenAI model retries, streaming, and LiteLLM versions | DF-024 and DF-025 |

The map covers this branch's adaptation work, not the full historical changelog
of upstream Data Formulator before `00d0f5e`.

## Implemented Changes

The per-change verification notes below preserve what was known at each dated
checkpoint. The later remediation checkpoint and Validation Scope supersede
earlier statements that the full local test suites were unavailable.

### Source changes on 2026-07-09

#### CHG-001: Restore packaged demo assets and modern image MIME types

**Scope**: Original source and package configuration \
**Source status**: Included in this log's publication commit \
**Runtime status**: Deployed and browser-verified

- Replaced the shallow `dist` entries in `MANIFEST.in` with
  `recursive-include py-src/data_formulator/dist *`, so nested `dist/demos`
  assets are included in the installed Python package.
- Registered WebP and AVIF MIME types in `app.py`, `routes/agents.py`, and
  `routes/tables.py` for minimal container images with incomplete MIME maps.
- Added `tests/backend/test_static_mime_types.py` as regression coverage.
- Fixed demo thumbnails that were absent from the installed package and did
  not render in the deployed application.

Verification:

- Deployed demo thumbnails rendered successfully in browser testing.
- Python syntax and editor diagnostics passed.
- The regression test exists, but the full local `pytest` suite was unavailable
  because this environment lacks the project test dependencies.

#### CHG-002: Stabilize LLM probes, reasoning compatibility, and error classification

**Scope**: Original backend source \
**Source status**: Included in this log's publication commit \
**Runtime status**: Deployed and API-verified

- Increased `Client.ping()` output capacity from 3 to 64 tokens so reasoning
  models can complete connectivity probes.
- Added one retry without `reasoning_effort` when Azure reports unsupported
  values without naming the parameter.
- Updated `agent_config.py` to map GPT-5 Pro `none`, `minimal`, and `low` to
  `medium`, while preserving the separate GPT-5 Codex behavior.
- Tightened context-length patterns in `security/sanitize.py` and
  `error_handler.py` so `max_output_tokens` validation is not misclassified as
  prompt overflow.
- Updated the connectivity-probe log text in `routes/agents.py` to report the
  64-token budget.
- Retained generic Pro compatibility for externally configured endpoints even
  though the managed Pro deployment was later removed because of cost.

Verification:

- All managed production models passed connectivity checks.
- A full Pro request succeeded before the managed deployment was removed.
- Ten consecutive Mini requests succeeded after the capacity increase.
- Python syntax, editor diagnostics, and diff checks passed; full local
  `pytest` execution was unavailable.

#### CHG-003: Repair frontend dependency lock

**Scope**: Original dependency metadata \
**Source status**: Committed as `4e185e9` \
**Runtime status**: Included in successful ACR builds

- Regenerated `yarn.lock` against the public registry to match `package.json`.
- Fixed the stale lockfile that caused frozen Yarn builds to fail.

#### CHG-004: Add model and static-asset regression coverage

**Scope**: Original backend tests \
**Source status**: Included in this log's publication commit \
**Runtime status**: Not applicable (test-only)

- Added `tests/backend/test_static_mime_types.py` for WebP and AVIF MIME
  registration.
- Updated `tests/backend/agents/test_client_utils.py` for the 64-token probe.
- Updated `tests/backend/agents/test_client_image_strip.py` for retry without
  unsupported `reasoning_effort`.
- Added `tests/backend/agents/test_agent_config.py` for GPT-5 Pro reasoning
  normalization and preservation of Mini, Codex, and non-GPT behavior.
- Updated `tests/backend/security/test_global_model_security.py` so
  `max_output_tokens` validation cannot regress to a context-overflow error.

Verification:

- Python `compileall` and editor diagnostics passed.
- Full local `pytest` execution remains unavailable because required project
  dependencies are not installed in this Windows environment.

## Deployment and Operational Changes

These entries record live environment work related to the source changes. Not
all operational changes are encoded in the original upstream runtime files.

### Operational changes on 2026-07-09

#### OPS-001: Deploy governed Azure Container Apps environment

**Source status**: Infrastructure and follow-up Bicep included in branch history \
**Runtime status**: Live

- Added `azure.yaml` and infrastructure definitions for Azure Container Apps,
  Azure Container Registry, Azure OpenAI private access, managed identity, Log
  Analytics, Application Insights, VNet integration, private DNS, and an
  explicit RAI content-filter policy.
- Added the `azd-service-name` tag in
  `infra/modules/containerapp.bicep` so `azd` maps the `web` service to
  the Container App.
- Current live revision: `ca-dataformulator--azd-1784046335`.
- Current live image: `azd-deploy-1784045589`.

#### OPS-002: Configure managed model comparison set

**Source status**: Bicep included in this log's publication commit \
**Runtime status**: Live and verified

- Configured GPT-5.4 Mini as the default with 260K TPM, GPT-5.4 Nano with
  2.009M TPM, and GPT-5.4 with 260K TPM.
- Removed GPT-5.4 Pro from the application and Azure because of its high usage
  price, returning its allocated quota to zero.
- Updated `infra/modules/openai.bicep` to declare the three-model set,
  serialize child deployments, emit comma-separated `AZURE_MODELS`, and retain
  the explicit RAI policy on every deployment.
- Verified that all three remaining models connect successfully.

#### OPS-003: Register production custom domain

**Source status**: Live configuration only \
**Runtime status**: Live

- Registered `data.gcxteam.com` with CNAME and ownership TXT records.
- Bound a managed SNI certificate and verified HTTP 200 with valid TLS.
- Kept the cross-subscription DNS configuration outside the generic Bicep.

#### OPS-004: Restore public ingress after CloudGov NSG enforcement

**Source status**: Live configuration only \
**Runtime status**: Live

- Diagnosed a policy-created network security group that initially blocked the
  application.
- Restored inbound HTTPS reachability with explicit NSG rules.

Statuses above describe the state on 2026-07-09. Update them when changes are
committed, redeployed, superseded, or rolled back.

## Validation Scope

- Reviewed the connector lifecycle, built-in data loaders, credential vault,
  session storage, workspace storage, Container Apps deployment, and related
  backend tests.
- Reviewed request-boundary memory amplification, OAuth state handling,
  streaming logger behavior, and Azure Blob metadata concurrency.
- Reconciled independent Advocate, Skeptic, and Architect review perspectives
  against the current source.
- Ran dependency-free Python syntax compilation across the connector, loader,
  and authentication modules.
- Confirmed no VS Code diagnostics in the audited connector, authentication,
  and Container Apps files.
- Created an isolated `.venv` and installed the project plus pytest.
- Final backend validation passes with 2,032 tests and 13 skips; final frontend
  validation passes with 35 files and 277 tests. The Windows fixture,
  capability-skip, marker, and stale frontend-contract failures found during
  intermediate runs were resolved before deployment.

## High Priority

### DF-001: Replica-local state conflicts with multi-replica scaling

**Status**: Resolved; source and narrow live deployment verified \
**Severity**: High \
**Area**: Deployment, sessions, connectors, workspaces

Progress evidence (2026-07-09):

- Added a deployment regression test requiring one replica while sessions,
  connectors, credentials, catalogs, and workspaces remain instance-local.
- Confirmed RED against the prior `maxReplicas: 3` declaration.
- Updated the Bicep source to cap the Container App at one replica.
- Subscription-scoped what-if confirms the intended `maxReplicas: 3 -> 1`,
  but initially predicted unsafe unrelated drift, including removal of VNet
  NSG and flow-log configuration.
- Applied `az containerapp update --max-replicas 1`, creating revision
  `ca-dataformulator--0000005` without changing the deployed image.
- Revision `0000005` is healthy and provisioned with one replica. The generated
  FQDN and `data.gcxteam.com` both return HTTP 200; the custom-domain binding and
  latest-revision traffic rule remain intact.
- Reconciled the production Bicep parameters with the custom domain, managed
  certificate, policy tags, subnet NSGs, registry defaults, and model upgrade
  policy. Production now references the policy-governed VNet instead of issuing
  a VNet update that would remove policy-owned flow-log metadata.
- Full subscription deployment
  `data-formulator-drift-reconciliation-20260709` succeeded. Post-deployment
  verification confirmed the image, one-replica cap, domain, traffic, both NSG
  associations, flow-log metadata, model capacities, RAI policy bindings, and
  both HTTPS endpoints remain healthy.

The Container App previously permitted up to three replicas, but its stateful
services use the container's local filesystem and no persistent volume is
configured.

Evidence:

- The prior live configuration allowed `maxReplicas: 3` without `volumes` or
  `volumeMounts`; source and live configuration now cap it at one replica.
- `py-src/data_formulator/app.py` stores server-side sessions in a local
  `FileSystemCache` under `DATA_FORMULATOR_HOME`.
- User connector definitions, the encrypted credential vault, catalog caches,
  and local workspaces are also stored beneath `DATA_FORMULATOR_HOME`.

Impact:

- Requests routed to different replicas can observe different sessions,
  connectors, credentials, catalogs, and workspaces.
- Replica replacement or restart can remove user state.
- Autoscaling can create intermittent failures that appear user-specific.

Recommended remediation:

1. Set `maxReplicas: 1` until all required state is shared.
2. Use Azure Blob workspace storage for durable workspace data.
3. Move sessions to a distributed cache and credentials to a shared vault.
4. Add a multi-replica integration test that alternates requests across
   replicas.

Acceptance criteria:

- Either the deployment is explicitly single-replica, or every required state
  store is shared and survives replica replacement.
- A user can connect, create a workspace, and continue from another replica.

### DF-002: Request-controlled identifiers are interpolated into queries

**Status**: Resolved; focused and adjacent loader tests pass \
**Severity**: High \
**Area**: Data loaders, query safety

Progress evidence (2026-07-09):

- Added cross-loader source-table and sort-column safety tests for MySQL,
  SQL Server, Kusto, and BigQuery.
- Confirmed unsafe source identifiers reach query construction in all four
  loaders; MySQL sort columns already use the shared escaping helper.
- Added shared dotted SQL, SQL Server bracket, and Kusto entity identifier
  validation helpers and routed source/sort identifiers through them before
  upstream schema or query calls.
- Focused safety suite passes: 8 tests.
- Adjacent loader suite: 48 tests pass; two unrelated existing failures assert
  that the intentional no-auth `sample_datasets` loader must declare required
  connection parameters.

Several loaders construct native queries using `source_table` or sort-column
values received from connector API request bodies without consistently applying
dialect-safe identifier validation and quoting.

Confirmed locations:

- `py-src/data_formulator/data_loader/mysql_data_loader.py`: dotted table names
  are interpolated directly into `FROM`.
- `py-src/data_formulator/data_loader/mssql_data_loader.py`: schema, table, and
  sort columns are wrapped in brackets without escaping embedded brackets.
- `py-src/data_formulator/data_loader/kusto_data_loader.py`: table and sort
  identifiers are interpolated into KQL.
- `py-src/data_formulator/data_loader/bigquery_data_loader.py`: table and sort
  identifiers are wrapped in backticks without escaping embedded backticks.

Impact:

- Crafted requests can alter query structure, cause unauthorized data access,
  or produce destructive behavior where the driver accepts it.
- At minimum, malformed identifiers create avoidable query failures and noisy
  error paths.

Recommended remediation:

1. Add centralized identifier helpers for MySQL, SQL Server, Kusto, BigQuery,
   and Athena dialects.
2. Resolve requested tables against catalog-issued stable source identifiers
   where practical.
3. Validate and quote every table, schema, database, and sort identifier.
4. Add adversarial tests for delimiters, comments, control characters, and
   statement separators.

Acceptance criteria:

- Every identifier entering a generated query is validated or escaped by a
  dialect-specific helper.
- Injection-oriented tests prove that malicious identifiers cannot change the
  generated query structure.

### DF-003: Cached loader connections lack a complete lifecycle contract

**Status**: Resolved; lifecycle and vault regression suites pass \
**Severity**: High \
**Area**: Connector lifecycle, database stability

Progress evidence (2026-07-09):

- Added an idempotent base `close()` contract and connector-owned loader
  replacement/removal helpers.
- Added cleanup for persistent MySQL, PostgreSQL, SQL Server, BigQuery, and
  Kusto resources.
- Replacement, disconnect, failed validation, status failure, delete, and
  connector-creation rollback paths close loaders through one owner.
- Focused lifecycle tests pass: 3 tests.
- Connector framework, vault, and lifecycle regression suites pass: 76 tests.

`DataConnector` caches one live loader per identity. Disconnect, delete, failed
connection tests, and replacement paths remove loaders from dictionaries but do
not close resources. The base loader interface has no `close()` contract.

PostgreSQL, MySQL, and SQL Server loaders hold persistent connections. MySQL
serializes access with a lock, but PostgreSQL and SQL Server can share their
single connection across simultaneous requests without equivalent locking.

Impact:

- Connections remain open until garbage collection or process termination.
- Repeated connect/disconnect cycles can exhaust source connection limits.
- Concurrent requests can cause cursor, protocol, or transaction-state errors.

Recommended remediation:

1. Add an idempotent `close()` method to `ExternalDataLoader`.
2. Implement it for all loaders that own clients, connections, credentials, or
   other disposable resources.
3. Centralize loader removal/replacement in a helper that closes the old loader.
4. Add locking or use a thread-safe connection pool for SQL loaders.
5. Add concurrent preview/import tests against each SQL loader.

Acceptance criteria:

- Every loader removal or replacement closes its owned resources exactly once.
- Concurrent requests against one connector do not share a non-thread-safe
  connection without synchronization.
- Repeated connect/disconnect tests show no connection growth.

### DF-004: Auto-reconnect deletes credentials on transient failures

**Status**: Resolved; credential preservation and lifecycle suites pass \
**Severity**: High \
**Area**: Credential lifecycle, resilience

Progress evidence (2026-07-09):

- Added regression coverage for false health checks and temporary connection
  exceptions during vault auto-reconnect.
- Confirmed both paths currently delete the stored credential entry.
- Automatic reconnect now preserves vault credentials for false health checks
  and exceptions; explicit disconnect/delete remains the deletion boundary.
- Failed temporary loaders are closed before returning.
- Reconnect, lifecycle, vault, and framework suites pass: 78 tests.

`DataConnector._try_auto_reconnect()` deletes the stored vault entry whenever
`test_connection()` returns false or raises. The failure is not first classified
as permanent authentication rejection versus retryable network, DNS, timeout,
throttling, or service-unavailable failure.

Impact:

- A temporary outage permanently removes valid stored credentials.
- Users must manually reconnect after otherwise recoverable incidents.
- Multiple workers can disagree about connection state after one transient
  failure deletes shared credentials.

Recommended remediation:

1. Classify reconnect failures before mutating the vault.
2. Retain credentials for timeout, network, throttling, and service failures.
3. Delete credentials only on explicit disconnect or confidently identified
   invalid/revoked credentials.
4. Return an actionable structured error and emit reconnect telemetry.

Acceptance criteria:

- Retryable reconnect failures preserve credentials.
- Invalid credentials follow a documented policy and produce a clear response.
- Tests cover transient failure, invalid credentials, and successful retry.

### DF-009: Default LLM deployment exhausts rate limits without retry

**Status**: Resolved; bounded transport retry and compatibility suites pass \
**Severity**: High \
**Area**: Azure OpenAI, LLM client resilience

Production Container Apps telemetry recorded repeated Azure OpenAI 429 responses
for the default `gpt-5.4-mini` deployment. The deployment was initially limited
to 5 requests and 5,000 tokens per minute despite 1,000 capacity units being
available to the subscription.

The client has no transport-level exponential backoff for throttling. In one
observed path, an image request was rate-limited and the immediate text-only
fallback was rate-limited again, multiplying pressure during an incident.

Immediate mitigation applied on 2026-07-09:

- Synchronized `infra/modules/openai.bicep` with the governed live allocations:
  Mini 260, GPT-5.4 260, and Nano 2,009 capacity units.
- Azure reports 260 requests and 260,000 tokens per minute for Mini and
  GPT-5.4, and 2,009 requests and 2,009,000 tokens per minute for Nano.
- Ten-request bursts completed without throttling. GPT-5.4 Pro was removed
  from the managed comparison set because its usage cost was too high.

Remediation implemented:

1. Add bounded retries with exponential backoff and jitter for 429 and retryable
   upstream 5xx responses.
2. Honor `Retry-After` and Azure rate-limit reset headers when present.
3. Avoid immediate modality fallback when the original failure is throttling.
4. Emit per-model request, token, throttle, retry, and latency metrics.

Implementation evidence (2026-07-09):

- Added one centralized completion retry policy used by ordinary and
  tool-enabled calls.
- Retries 408, 429, retryable 5xx, connection, and timeout failures with three
  total attempts, exponential backoff with jitter, and capped `Retry-After`.
- Auth/validation and other non-transient HTTP failures are not retried.
- Throttling retries preserve image payloads and do not trigger modality
  fallback.
- Focused retry tests pass: 10 tests; client compatibility suite passes:
  74 tests.

Acceptance criteria:

- A burst within allocated quota does not produce user-visible 429 failures.
- Throttled calls retry within a bounded budget and preserve the structured
  `LLM_RATE_LIMIT` error when retries are exhausted.
- Image fallback does not create a second immediate request after a 429.

### DF-025: LiteLLM calls lack finite end-to-end retry and stream boundaries

**Status**: Resolved and production-verified in revision `ca-dataformulator--azd-1784046335` \
**Severity**: High \
**Area**: Azure OpenAI, LiteLLM client resilience

The shared model client used LiteLLM's 600-second default timeout while adding
three application-level transport attempts. A stalled Azure OpenAI request
could therefore occupy a server thread for approximately 30 minutes. Streaming
errors raised while consuming the iterator were outside the retry wrapper, so
a transient failure before the first chunk received no retry.

The dependency contract was also not reproducible: `uv.lock` resolved LiteLLM
1.83.14, the local runtime used 1.91.1, and Docker installed an unconstrained
version from `pyproject.toml` at build time.

Remediation implemented:

1. Apply a 90-second default timeout to ordinary, tool-enabled, and streaming
   model calls.
2. Bound all transport retries and compatibility fallbacks for one logical
   completion to a shared 120-second deadline.
3. Retry streaming transport failures only before the first emitted chunk.
   After output begins, propagate the exception to the existing route-level
   NDJSON error boundary rather than replaying partial output.
4. Allow image and unsupported-reasoning fallbacks to compose once each within
   the same deadline.
5. Pin LiteLLM 1.91.1 in `pyproject.toml`, `requirements.txt`, and `uv.lock` so
   local, CI, and Docker builds use the reviewed contract.

Implementation evidence (2026-07-14):

- Focused model client, image fallback, reasoning, and registry suites pass:
  90 tests.
- Regressions cover the default timeout, total retry deadline, pre-first-chunk
  retry, no replay after the first chunk, and combined compatibility fallback.
- `uv lock --check` resolves successfully with LiteLLM 1.91.1.
- Full backend suite passes: 2,032 tests passed and 13 skipped; the five
  warnings are the existing Flask-Session `use_signer` deprecation.
- Production runs LiteLLM 1.91.1. All three Azure models pass connectivity
  probes; GPT-5.4 Mini passes non-streaming and streaming tool-enabled requests.
  The streaming request completed with exact `STREAM_OK`, no error events, and
  no tool execution.

Acceptance criteria:

- No model call uses LiteLLM's 600-second default timeout.
- One logical completion cannot exceed the 120-second retry budget through
  application-level retries.
- A transient stream failure before the first chunk retries; a failure after a
  chunk never replays emitted content.
- Rebuilding the container installs the same LiteLLM version exercised by the
  focused tests.
- Production Azure OpenAI smoke tests pass for non-streaming, streaming, and
  tool-enabled calls after deployment.

### DF-011: Azure Blob metadata updates can lose concurrent changes

**Status**: Resolved; focused and adjacent tests pass \
**Severity**: High \
**Area**: Azure Blob workspaces, metadata concurrency

Progress evidence (2026-07-09):

- Added a regression test with two independent `AzureBlobWorkspace` instances.
- Confirmed the pre-fix lost update: only one of two table entries survived.
- Added bounded ETag compare-and-swap retry in the Blob metadata update path;
  conflicts reload the latest metadata and reapply the updater.
- Focused concurrency test passes with two separate workspace instances.
- Adjacent workspace regression suite passes: 37 tests.

`workspace_factory.get_workspace()` opens a workspace per request, and
`AzureBlobWorkspaceManager.open_workspace()` returns a new
`AzureBlobWorkspace`. Each workspace object creates its own `threading.Lock()`.

`AzureBlobWorkspace._atomic_update_metadata()` locks only that object, then
downloads `workspace.yaml`, modifies it, and overwrites the blob. Two requests
for the same workspace therefore use different locks and can both read the same
metadata version before writing independent changes.

Impact:

- The last writer can remove metadata for a table added by the other request.
- The dropped table's Parquet blob remains, leaving orphaned data that the
  workspace can no longer discover.

Recommended remediation:

1. Use Azure Blob ETag optimistic concurrency with `If-Match` and bounded
   retries, or use a shared distributed lock per workspace.
2. On an ETag conflict, reload the latest metadata and reapply the update.
3. Test two independent workspace objects concurrently adding distinct tables.

Acceptance criteria:

- Concurrent metadata updates cannot silently overwrite each other.
- Both tables remain in `workspace.yaml` after concurrent additions.
- The concurrency test uses separate `AzureBlobWorkspace` instances.

### DF-012: Request limits permit memory amplification beyond container safety

**Status**: Resolved; request boundaries enforced and regression suites pass \
**Severity**: High \
**Area**: Request handling, memory safety

`app.py` permits request bodies up to 500 MB, while the Container App has 2 GiB
of memory. Routes decode bodies with `request.get_json()`, ephemeral mode sends
the complete `_workspace_tables` collection on every request, and attached
images are base64 strings.

`construct_scratch_workspace()` creates pandas DataFrames, and
`write_parquet()` creates Arrow and compressed serialization buffers. A valid
near-limit request can therefore exist simultaneously as raw bytes, decoded
JSON and Python objects, pandas data, Arrow data, and output buffers.

Progress evidence (2026-07-09):

- Added pre-route JSON wire-size enforcement and decoded aggregate limits for
  `_workspace_tables` and inline base64 images.
- Reduced the configurable global default from 500 MiB to 100 MiB; added
  25 MiB JSON, 20 MiB ephemeral-table, and 10 MiB decoded-image defaults.
- Focused request-limit tests pass: 4 tests.
- Added proof that rejected ephemeral payloads never reach route
  materialization.
- Focused request-limit, unified 413, and image-bearing route tests pass:
  60 tests.
- Combined prior-fix regression set passes: 43 tests.
- Broader security/error/route validation is otherwise green; four unrelated
  plugin fixture tests fail on Windows because a CP1252 dash is written then
  imported as UTF-8.

Impact:

- A request within the configured limit can terminate the container with an
  OOM during buffering or materialization, before the application can return a
  structured error. Requests above the raw limit still receive Flask's `413`
  when the process remains healthy enough to handle them.
- This is distinct from DF-008: DF-008 concerns imported table memory, while
  DF-012 concerns amplification at the HTTP request boundary.

Recommended remediation:

1. Set lower endpoint-specific request byte limits.
2. Reject requests using both `Content-Length` and decoded aggregate size.
3. Use direct uploads or streaming instead of embedding large tables and
   images in JSON.
4. Cap aggregate image and inline-table bytes independently.
5. Add memory tests for near-limit JSON, base64 images, and ephemeral tables.

Acceptance criteria:

- Oversized requests fail with a structured `413` before materialization can
  exhaust container memory.
- Each affected endpoint has a documented raw and decoded byte budget.
- Memory tests remain within the deployed container allocation.

## Medium Priority

### DF-005: Connector persistence failures are hidden from callers

**Status**: Resolved; atomic persistence and rollback tests pass \
**Severity**: Medium \
**Area**: Connector configuration durability

`create_connector()` expects `_persist_user_connector()` to raise so it can add
`persist_warning` to the response. The persistence helper catches its own write
exception and returns normally, making that warning path unreachable.

The connector remains in the process-local registry even when no configuration
was written. It then disappears after restart. The JSON file is also written
directly rather than through a temporary file and atomic replacement.

Recommended remediation:

1. Let persistence failures propagate to the route.
2. Roll back the registry entry or return a structured error.
3. Write to a temporary file, flush it, and atomically replace the destination.
4. Add disk-full, permission-denied, interrupted-write, and restart tests.

Acceptance criteria:

- The API never reports a durable connector when persistence failed.
- Interrupted writes cannot leave a truncated connector specification.

Implementation evidence (2026-07-09):

- Connector specs write to a temporary file, flush and fsync, then atomically
  replace the destination.
- Persistence failures propagate, remove temporary files, preserve the last
  valid specification, and roll back the process registry entry.
- The API returns a structured `STORAGE_FULL` error instead of a misleading
  creation response.
- Focused persistence and creation suites pass: 16 tests, 1 skipped.

### DF-006: The production container runs Flask's development server

**Status**: Resolved and included in healthy production revision `ca-dataformulator--0000010` \
**Severity**: Medium \
**Area**: Runtime stability

The Docker entrypoint invokes the application CLI, which ends in `app.run()`.
This is Flask's development server, not a production WSGI server.

Impact:

- Limited worker lifecycle and graceful shutdown behavior.
- No explicit request timeout or worker-restart policy.
- Long connector operations can reduce availability for unrelated requests.

Recommended remediation:

1. Run Gunicorn on Linux or another production WSGI server.
2. Configure explicit worker/thread counts, request timeouts, graceful shutdown,
   and access/error logging.
3. Keep `app.run()` only for local development.

Acceptance criteria:

- The production container starts through a supported production WSGI server.
- Health probes, graceful termination, and stuck-request recovery are tested.

Implementation evidence (2026-07-09):

- Added Gunicorn as a runtime dependency and switched the Linux container
  entrypoint from Flask's development server.
- Configured one worker and four threads while state remains process-local,
  with explicit 120-second request and 30-second graceful timeouts.
- Infrastructure source guards pass: 2 tests; package metadata installs
  successfully.
- The azd remote build succeeded and the resulting image is healthy in
  production revision `0000010`; local Docker remained unavailable on this
  host.

### DF-007: Connector timeout behavior is inconsistent

**Status**: Resolved; finite timeout contracts and loader regressions pass \
**Severity**: Medium \
**Area**: External integrations, availability

Some connectors define connection or request timeouts, while others rely on
long SDK defaults or provide no statement/query timeout. MongoDB, Kusto, and
several cloud SDK paths can occupy a request thread for an extended period when
the upstream source is unavailable or slow.

Recommended remediation:

1. Define connector-wide defaults for connect, metadata, preview, import, and
   query timeouts.
2. Allow loader-specific overrides with bounded values.
3. Cancel upstream operations where the SDK supports cancellation.
4. Classify timeout errors as retryable and measure timeout frequency.

Acceptance criteria:

- Every network operation has a documented finite timeout.
- Slow-source tests fail within the configured bound and return a structured,
  retryable error.

Implementation evidence (2026-07-09):

- Added shared 15-second connect, 60-second request, and 120-second query
  timeout defaults.
- Applied finite MongoDB server/connect/socket, Cosmos connection, Kusto
  server, and BigQuery metadata/query timeouts.
- Focused timeout tests pass: 4 tests; adjacent loader regressions pass:
  30 tests.

### DF-008: Row limits do not cap memory consumption

**Status**: Resolved; shared Arrow byte budgets and regressions pass \
**Severity**: Medium \
**Area**: Import stability, memory use

The two-million-row hard cap is applied consistently, but row count alone does
not bound memory. Wide schemas and large text or binary values can exceed the
2 GiB container memory limit far below that row count. Several paths fully
materialize Arrow tables, and preview converts the result to pandas.

Recommended remediation:

1. Add byte-based and batch-based limits in addition to row limits.
2. Stream source batches directly to Parquet where supported.
3. Keep previews small and avoid full Arrow-to-pandas materialization.
4. Add wide-row and large-value memory regression tests.

Acceptance criteria:

- Imports operate within a documented memory budget.
- Oversized sources fail cleanly before container OOM termination.
- Preview memory use is bounded independently of import limits.

Implementation evidence (2026-07-09):

- Added a 256 MiB hard Arrow import/refresh budget and 32 MiB preview budget,
  enforced before Parquet writes or pandas conversion.
- Per-import `max_bytes` may lower but cannot raise the hard import cap.
- Wide-value rejection confirms workspace writes are not reached.
- Ingest, preview, metadata, connector, and row-limit suites pass: 103 tests.

### DF-010: Model connectivity probe and classifier report false failures

**Status**: Resolved and verified in production \
**Severity**: Medium \
**Area**: Model selection, diagnostics

`Client.ping()` requested only three output tokens. Azure `gpt-5.4-pro`
requires `max_output_tokens` to be at least 16, so the model selector marked a
healthy deployment disconnected.

The LLM error classifier then matched the parameter name `max_output_tokens`
with an overbroad `max...tokens` context-length pattern and reported “Input too
long” for a tiny prompt. The full model test surfaced only a generic invalid
request, hiding the actionable minimum-value error.

After fixing the token minimum, production logs exposed a second compatibility
problem: Azure `gpt-5.4-pro` rejects `reasoning_effort` values `none`,
`minimal`, and `low`; its supported values begin at `medium`. The shared agent
configuration previously treated Pro like Codex and mapped light tiers to
`none`.

Remediation implemented:

- Context-length matching no longer treats parameter names such as
  `max_output_tokens` as prompt overflow.
- Connectivity probes reserve 64 output tokens so reasoning does not consume
  the entire minimum response budget.
- GPT-5 Pro light reasoning tiers normalize to `medium`; Codex retains its
  separate `none` behavior.
- Unsupported reasoning-value responses trigger the existing one-time retry
  without the parameter even when Azure omits the parameter name.
- Regression tests cover both behaviors.

Acceptance criteria:

- All provisioned models pass the built-in connectivity check when the Azure
  deployment is healthy.
- Invalid output-token limits classify as invalid requests, not context
  overflow.
- GPT-5 Pro requests never send unsupported light reasoning tiers.
- Focused client and classifier regression tests pass in CI.

### DF-013: Production session cookies do not require secure transport

**Status**: Resolved; secure cookie configuration tests pass \
**Severity**: Medium \
**Area**: Security, authentication, session cookies

`app.py` configures session cookies as `HttpOnly` with `SameSite=Lax`, but does
not set `SESSION_COOKIE_SECURE`. The authentication development guide requires
this setting in production, and the Container App configuration does not
provide an equivalent override.

Impact:

- A browser may send the signed session cookie over HTTP if a non-TLS route,
  proxy, or deployment misconfiguration becomes reachable.
- The server-side session contains SSO and service tokens.

Recommended remediation:

1. Default `SESSION_COOKIE_SECURE` to true in production.
2. Require an explicit override for local HTTP development.
3. Add proxy and TLS configuration tests for secure-cookie behavior.

Acceptance criteria:

- Production responses set session cookies with the `Secure` attribute.
- Local HTTP development requires an explicit documented override.
- Tests verify the effective cookie attributes in production and development.

Implementation evidence (2026-07-09):

- Production defaults session cookies to `Secure`; local HTTP requires
  `DEV_MODE=true` and an explicit `SESSION_COOKIE_SECURE=false` override.
- Session configuration and route regression suite passes: 12 tests.

### DF-014: Streaming requests mutate a module-global logger level

**Status**: Resolved; streaming logger isolation tests pass \
**Severity**: Medium \
**Area**: Agent streaming, logging, concurrency

`data_agent_streaming()` calls `logger.setLevel(logging.INFO)` before creating
its generator. The generator ends by setting the logger to `WARNING`, rather
than restoring its prior level, and the reset is not protected by `finally`.

Impact:

- Concurrent requests share the logger and can change each other's logging.
- The first completed stream permanently forces that module logger to
  `WARNING`, suppressing later informational diagnostics.
- A client disconnect can skip the reset and leave the logger at `INFO`.

Recommended remediation:

1. Remove request-scoped mutation of the module-global logger level.
2. Use the configured logger level with a request-scoped adapter or filter.
3. If temporary mutation is unavoidable, restore the exact prior level in
   `finally`.
4. Add concurrent-stream and client-disconnect tests.

Acceptance criteria:

- A streaming request does not change the logger level observed by another
  request.
- Normal completion and disconnect preserve the exact prior logger level.
- Tests cover overlapping streams and interrupted generators.

Implementation evidence (2026-07-09):

- Removed request-scoped mutation of the process-global agent route logger.
- Static isolation and streaming route regressions pass in the 12-test session
  and route suite.

### DF-015: OAuth state supports only one pending login per provider

**Status**: Resolved; bounded state maps and provider contracts pass \
**Severity**: Medium \
**Area**: Authentication, OAuth state management

`oidc_gateway.oidc_login()` writes one `session['_oauth_state']` value, and its
callback pops and compares that value. The GitHub gateway uses the equivalent
single `session['_github_oauth_state']` slot.

Impact:

- Two same-provider login attempts in separate tabs overwrite the first state.
- The first callback fails with `invalid_state`.
- Because callbacks pop the slot, callback order can also invalidate the second
  login attempt.

Recommended remediation:

1. Store a bounded set or map of hashed pending states with timestamps.
2. Consume only the matching state during callback processing.
3. Expire old entries and cap the number of pending states per provider.
4. Test two login starts followed by callbacks in both possible orders.

Acceptance criteria:

- Two same-provider login attempts can complete independently in either order.
- Each state is single-use, timestamped, bounded, and removed only on match.
- Expired, unknown, and replayed states return `invalid_state`.

Implementation evidence (2026-07-09):

- Added provider-specific pending state maps capped at eight entries with a
  ten-minute TTL and constant-time state comparison.
- OIDC and GitHub callbacks consume only the matching state; a one-release
  legacy single-slot callback fallback preserves active sessions during
  migration.
- OAuth gateway and provider contract suites pass: 111 tests, 1 skipped.

## Review Findings

### DF-020: MSSQL connection-string values permit ODBC attribute injection

**Status**: Resolved and deployed in revision `ca-dataformulator--0000010` \
**Severity**: High \
**Area**: SQL Server, Azure SQL, connection security

`MSSQLDataLoader` interpolates request-controlled `server`, `database`, `port`,
`user`, `password`, and `connection_timeout` values directly into an ODBC
connection string. ODBC uses semicolons as attribute separators and permits
duplicate or conflicting keywords with driver-specific position or precedence
rules.

Evidence:

- A mocked `AzureSQLDataLoader` connection with
  `connection_timeout="30;TrustServerCertificate=yes"` reached
  `pyodbc.connect()` with both `TrustServerCertificate=no` and a later
  `TrustServerCertificate=yes` attribute.
- The later attribute bypasses the Azure SQL connector's intended certificate
  validation boundary before any network connection is attempted.
- Existing authentication tests verify benign caller attempts to set
  `trust_server_certificate="yes"`, but do not exercise delimiters embedded in
  another connection-string field.

Impact:

- A crafted connector request can add or conflict with ODBC attributes that
  the product does not expose, including transport and authentication options.
- Azure SQL's enforced Driver 18 encryption and certificate-validation policy
  is not actually immutable at the request boundary.
- Generic SQL Server credentials containing semicolons or braces can also be
  parsed ambiguously or fail unexpectedly.

Recommended remediation:

1. Centralize ODBC connection-string construction in a helper that safely
   represents every value using driver-supported escaping or rejects values
   that cannot be represented without introducing attributes.
2. Parse and bound `port` and `connection_timeout` as integers before building
   the connection string; do not accept arbitrary strings for numeric fields.
3. Restrict Azure SQL `server` to a valid logical-server hostname and ensure
   fixed Driver 18, encryption, certificate, and token-mode attributes occur
   exactly once.
4. Add adversarial tests for semicolons, braces, duplicate keywords,
   `Authentication`, `Trusted_Connection`, `UID`, `PWD`, `Encrypt`, and
   `TrustServerCertificate` across every user-controlled field.
5. Preserve existing SQL authentication, Windows authentication, Azure SQL
   token packing, and passwords that can be safely represented.

Acceptance criteria:

- No request-controlled field can create a second ODBC attribute.
- Azure SQL token mode always reaches `pyodbc.connect()` with Driver 18,
  encryption enabled, certificate validation enabled, and no connection-string
  authentication keyword.
- Invalid numeric fields return a safe structured validation error before
  `pyodbc.connect()` is called.
- Adversarial and existing MSSQL/Azure SQL authentication suites pass.

Implementation evidence (2026-07-13):

- Added pure bounded-integer, `yes`/`no`, ODBC-value, and driver validators in
  the shared MSSQL data plane without logging rejected values.
- Semicolon-bearing database, user, and password values are enclosed as one
  ODBC value; closing braces and control characters fail before driver access.
- Port accepts 1 through 65535; connection timeout accepts 1 through 300.
- Focused authentication suite: 25 passed. Focused plus adjacent connector and
  cross-database catalog suites: 90 passed.

### DF-021: Azure SQL pending-state limit is global across users

**Status**: Resolved and deployed in revision `ca-dataformulator--0000010` \
**Severity**: High \
**Area**: Azure SQL OAuth, concurrency, availability

The Azure SQL gateway stores pending OAuth records in a process-global
`_PENDING_STATES` dictionary capped at eight entries. The matching Flask
session map is per browser, but the global eviction policy is shared by every
user. The ninth login start can therefore evict another user's still-valid
state.

Evidence:

- Nine login starts produced eight process-global records and nine records in
  the initiating session; the oldest state remained in the session but was
  absent from the global registry.
- `_consume_state()` requires the state to exist in both stores, so the oldest
  callback fails even though its signed session record is present and within
  the ten-minute TTL.
- Current tests prove single-use consumption across two threads but do not
  cover the cap across independent sessions or more than eight active states.

Impact:

- Normal concurrency above eight pending logins causes intermittent popup
  failures across otherwise unrelated users.
- Repeated login starts can deliberately deny completion to other users while
  leaving stale, unconsumable records in their server-side sessions.
- The one-worker and one-replica deployment guarantees atomic access to the
  dictionary, but does not limit the application to eight concurrent users.

Recommended remediation:

1. Apply the bounded eight-state policy per provider and per browser session,
   matching the existing OIDC/GitHub pending-state contract.
2. Keep process-atomic single-use consumption under the current one-worker
   deployment without using a cross-user global capacity limit.
3. Remove expired and globally missing state records from the session so
   failed or evicted attempts cannot accumulate indefinitely.
4. Move pending-state atomicity to the approved shared session backend before
   enabling multiple workers or replicas.
5. Add cross-session tests where more than eight users start logins, callbacks
   complete in mixed order, and replay remains rejected.

Acceptance criteria:

- A ninth login in another browser session does not invalidate any of the
  first eight sessions.
- Each browser's state set remains bounded, timestamped, single-use, and
  removable independently of other users.
- Expired, unknown, and replayed states fail safely without token exchange or
  stale session growth.
- Concurrent callback tests pass under the enforced one-worker deployment,
  and the deployment remains single-replica until state is shared.

Implementation evidence (2026-07-13):

- Removed the process-wide eight-record count eviction while retaining global
  TTL cleanup and lock-backed single-use consumption.
- Added the eight-record cap and TTL cleanup to each initiating signed Flask
  session. Session eviction removes only that session's matching process
  record.
- Added a lock-allocated creation sequence so equal wall-clock timestamps still
  evict the first-started state after session serialization reorders keys.
- A matched session state is removed even when its process record is already
  absent, preventing stale unconsumable records.
- Tests cover nine independent browser sessions, nine starts in one session,
  missing-process cleanup, wrong-session rejection, replay, and concurrent
  consumption. Focused suite: 19 passed. Focused plus adjacent auth/connector
  suites: 111 passed.

### DF-022: Deprecated Flask-Session signer requires a cookie migration

**Status**: Planned; migration decision pending \
**Severity**: Medium \
**Area**: Sessions, authentication, deployment

Production sets `SESSION_USE_SIGNER=True` for the server-side Flask-Session
cookie. Flask-Session 0.8 emits a deprecation warning for this option and marks
the signer implementation for removal. The supported default uses a random
32-byte URL-safe session ID without the legacy signature suffix.

Evidence:

- Full backend validation passes 2,032 tests and skips 13, but five app-reload
  tests emit the same Flask-Session `use_signer` deprecation warning.
- The installed package signs the random session ID as `sid.signature` when the
  option is enabled and treats the cookie as a raw SID when it is disabled.
- Removing the setting without migration makes existing signed cookies miss
  their stored session records and creates new sessions.

Impact:

- A future Flask-Session release can remove the option and force an unplanned
  session reset or compatibility failure.
- A direct configuration removal causes a one-time logout and loss of
  session-only delegated service tokens for active browsers.
- The current restart-ephemeral local session backend already needs replacement
  before multi-worker or multi-replica operation, so the migration should align
  with that session-lifecycle decision.

Recommended remediation:

1. Decide whether to support a bounded legacy signed-cookie transition or
   schedule an explicit one-time logout during a release window.
2. Add tests for the selected transition, including legacy signed cookies,
   unsigned random session IDs, secure cookie flags, and session fixation
   protection.
3. Remove `SESSION_USE_SIGNER` only after the transition behavior and user
   impact are approved and documented.
4. Coordinate the change with the approved restart-durable shared session
   backend rather than migrating cookies twice.

Acceptance criteria:

- Flask-Session initializes without signer deprecation warnings.
- Existing browser sessions either migrate as designed or are invalidated in a
  documented release window.
- Session IDs remain high-entropy, opaque, regenerated at authentication
  boundaries where required, and protected by `Secure`, `HttpOnly`, and
  `SameSite` cookie settings.
- Delegated-token behavior across the migration is covered by automated tests.

## Repository Review Follow-ups

### RF-001: Transient ACT Edition backup was inside the working tree

**Status**: Resolved \
**Severity**: Medium \
**Area**: Repository hygiene, diagnostics

At review time, the untracked `.github-backup-20260713-212145/` directory
contained 202 files and approximately 1.23 MB of transient Edition rollback
data. It contributed many Markdown diagnostics even though heir-doctor reported
the active Edition installation as healthy.

Recommended remediation:

1. Confirm no rollback is required, then remove the backup with explicit
   approval because deletion is destructive.
2. Add `.github-backup-*` to `.gitignore` so future Edition upgrades cannot
   accidentally enter commits or editor diagnostics.
3. Verify heir-doctor remains healthy and `git status` no longer lists the
   backup before staging changes.

Acceptance criteria:

- No `.github-backup-*` path is tracked or shown as untracked.
- Future backup directories are ignored by Git.
- The active Edition installation still passes heir-doctor.

Implementation evidence (2026-07-13):

- Added `.github-backup-*/` to `.gitignore`; `git check-ignore` identifies the
  rule and ordinary `git status` no longer reports the backup.
- Verified all 202 backup files, totaling 1,231,674 bytes, already exist as
  exact blobs in Git history; no unique content depended on the directory.
- Removed only `.github-backup-20260713-212145/`; `Test-Path` returns false and
  the tracked working tree remains unaffected.
- Heir-doctor reports a healthy Edition v4.1.0 installation.

### RF-002: HANDOFF references a nonexistent root issue ledger

**Status**: Resolved \
**Severity**: Low \
**Area**: Documentation, session continuity

At review time, `HANDOFF.md` repeatedly directed readers to root `ISSUES.md`,
but the canonical ledger is `docs/plans/ISSUES.md`. The stale path could
misroute a resumed session or make the audit appear missing.

Recommended remediation:

1. Replace every root `ISSUES.md` reference in `HANDOFF.md` with
   `docs/plans/ISSUES.md`.
2. Search repository documentation for other stale root references and update
   current operational guidance while preserving dated historical records.
3. Verify all handoff resume points resolve to existing files.

Acceptance criteria:

- `HANDOFF.md` contains no reference to a nonexistent root `ISSUES.md`.
- Every current resume-point path exists and opens the intended artifact.

Implementation evidence (2026-07-13):

- Updated all four active handoff references to `docs/plans/ISSUES.md`.
- Repository search confirms every remaining `ISSUES.md` match in the handoff
  is the canonical path.

## Planned Connector Work

### DF-024: No-auth connectors report connected without an initialized loader

**Status**: Resolved and production-verified in revision `ca-dataformulator--azd-1784046335` \
**Severity**: Medium \
**Area**: Connector lifecycle, built-in sample datasets

The connector list and status contracts report `auth_mode="none"` connectors as
always connected, but catalog and data routes previously required a cached
per-identity loader that no route initialized. On the recreated production app,
expanding Example Datasets therefore returned the generic `CONNECTOR_ERROR`
message "Data connector error."

Evidence:

- Production request `20c2ed34-740f-4408-99ed-9136e0391724` failed in
  `connector_get_catalog_tree()` because `_require_loader()` raised
  `ValueError("Not connected. Please connect first.")`.
- Commit `abec152` intentionally introduced the always-connected no-auth
  contract but did not add the corresponding loader initialization path.
- `_require_loader()` now lazily constructs no-auth loaders from their default
  parameters and caches them for the resolved identity.
- The no-auth status route now uses the same initializer instead of calling the
  loader constructor without its required `params` argument.
- Connector framework validation: 60 tests passed, including catalog and
  parameterized status regressions for no-auth loaders.
- Production catalog smoke for `sample_datasets` returned success with 16 tree
  nodes and the expected `dataset,table` hierarchy.

Acceptance criteria:

- Expanding Example Datasets on a clean deployment returns its catalog without
  a prior connect action.
- No-auth status, catalog, preview, import, and refresh routes use the same
  cached loader lifecycle.
- A no-auth loader with pinned/default public configuration receives those
  parameters during lazy initialization.
- Production browser validation shows no `data-source-sidebar` connector error
  after deployment.

### DF-023: Enterprise data access lacks a settled direct-versus-MCP architecture

**Status**: Proposed; source-paired decision spike required \
**Severity**: Medium \
**Area**: Connector platform, MCP, enterprise data access

The confirmed adaptation need includes enterprise-grade Azure SQL, Microsoft
Fabric, semantic model, and future governed-source access. The shipped runtime
currently has a mature `ExternalDataLoader` and `DataConnector` contract but no
MCP client, server, or tool integration under `py-src/`, `src/`, or `tests/`.

Existing Agency and Fabric MCP capabilities are implementation accelerators.
They are not product runtime components and do not currently satisfy Data
Formulator's Arrow, workspace, source identity, refresh, auth, limits, or
provenance contracts.

Impact:

- Continuing source-by-source without an architecture decision can duplicate
  authentication, discovery, retry, and paging logic and make future enterprise
  onboarding deployment-bound.
- Adopting arbitrary MCP servers as connectors can create a parallel framework
  without bounded tabular results, stable provenance, refresh semantics,
  enterprise identity isolation, or operational ownership.
- Choosing either extreme prematurely can constrain Fabric and semantic-model
  delivery before representative data-plane evidence exists.

Provisional recommendation:

1. Keep `ExternalDataLoader` and `DataConnector` as the canonical product data
   boundary.
2. Use direct adapters for source-native bulk data paths and strict query
   semantics.
3. Evaluate a versioned, administrator-approved Data Formulator MCP profile for
   discovery, governed actions, bounded tabular results, or governed data
   handles.
4. Compare direct and MCP paths through a source-paired spike before committing
   to a generic runtime MCP facility.

Acceptance criteria:

- The architecture decision records direct-only, MCP-first, and hybrid
  trade-offs and names the selected boundary.
- A deterministic mock and at least one representative approved MCP server, if
  available, exercise catalog, schema, auth, limits, cancellation, errors,
  provenance, and refresh behavior.
- Direct and MCP paths are compared using common latency, memory, data-volume,
  reliability, and operational-ownership evidence.
- An MCP facility is approved only if it passes the existing connector quality
  contract and removes meaningful provider-specific work or enables otherwise
  impractical sources.
- The decision does not expose arbitrary servers or tool output directly to the
  browser, model prompt, or workspace.

Decision and spike plan:

- `docs/plans/2026-07-14-enterprise-data-access-architecture.md`

### DF-016: Azure SQL connector lacks delegated Microsoft Entra MFA

**Status**: DF-020/DF-021 deployed; consent/MFA and session durability gates remain \
**Severity**: Medium \
**Area**: Azure SQL connector, shared MSSQL data plane, authentication

The generic `mssql` connector supports SQL username/password and
`Trusted_Connection`. A distinct `azure_sql` connector owns delegated
Microsoft Entra authentication while subclassing the MSSQL implementation for
catalog, query, and ODBC token mechanics through `SQL_COPT_SS_ACCESS_TOKEN`.

Evidence:

- Tokens are isolated by connector instance plus audience with legacy fallback
  disabled after migration begins.
- Azure SQL login and callback routes bind connector, identity, origin, and
  single-use state, then store tokens server-side and emit token-free popup
  completion.
- The frontend validates exact popup origin and source while retaining the
  legacy Superset token flow.
- ODBC token packing is covered and the shared MSSQL data plane reaches the
  approved staging server through `AzureSQLDataLoader`. Explicit active-tenant
  token acquisition produced three independent successful connections and 25
  catalog entries.
- The Dockerfile installs Microsoft ODBC Driver 18 for the production runtime.
- Production revision `ca-dataformulator--azd-1784046335` runs image
  `azd-deploy-1784045589` at 100% traffic with one healthy replica and ODBC
  Driver 18. Public discovery exposes credential-only `mssql` and delegated
  `azure_sql` as distinct connector types.
- The dedicated `Data Formulator GCX DEV` Entra application has the exact
  production callback, Azure SQL delegated `user_impersonation` scope, and a
  federated credential trusting the Container App user-assigned managed
  identity. No client secret is stored.
- A disposable production connector prepared an authorization request with the
  Microsoft tenant endpoint, exact production callback, Azure SQL `.default`
  scope, S256 PKCE, and single-use state, then was deleted.
- Interactive production sign-in reaches Microsoft Entra but is blocked by the
  tenant's user-consent policy with **Need admin approval**. The requested Azure
  SQL `user_impersonation` scope is user-consent-capable, but this tenant only
  permits selected low-risk/unverified-app grants. No delegated grant currently
  exists for `Data Formulator GCX DEV`; a Cloud Application Administrator or
  Application Administrator must grant tenant-wide consent once.
- Earlier code and integration review blockers remain resolved:
  - one trusted proxy hop produces and validates the public HTTPS callback and
    browser origin;
  - token-mode vault persistence receives only non-sensitive connection params;
  - the SQL gateway rejects connectors without the `azure_sql` profile and
    delegated SQL audience;
  - a lock-backed process-local state registry makes callback consumption
    atomic under the enforced one-worker deployment.
- The 2026-07-13 review found and production now resolves two additional
  blockers: DF-020 prevented ODBC attribute injection through
  request-controlled connection-string values, and DF-021 moved the
  eight-state OAuth cap from global process capacity to each browser session.
- Delegated sessions remain restart-ephemeral and are still a production gate.
- Planned design work is tracked in
  `docs/plans/2026-07-09-azure-sql-entra-mfa.md`.
- MFA enforcement is performed by Microsoft Entra Conditional Access at token
  issuance time, not by Data Formulator.

Impact:

- Production still requires one interactive popup smoke test to establish user
  consent/MFA and end-to-end callback token exchange. Delegated-token sessions
  also remain restart-ephemeral.

Recommended remediation:

1. Have a Cloud Application Administrator or Application Administrator grant
  tenant-wide admin consent to the Azure SQL delegated permission for
  `Data Formulator GCX DEV` (`7cced1c1-4eb6-4adb-a149-9874baab45b0`). Then
  complete the production MFA popup against the approved staging database and
  verify catalog access through the deployed connector.
2. Replace restart-ephemeral delegated-token sessions with approved durable
  storage; retain the one-replica cap until a shared backend is available.

Acceptance criteria:

- Delegated user tokens are requested with the
  `https://database.windows.net/` audience.
- The ODBC connection path passes the token through
  `SQL_COPT_SS_ACCESS_TOKEN`.
- No browser-side storage or credential-vault persistence exposes delegated
  tokens.
- Existing SQL authentication and Windows authentication regression tests pass.
- Focused implementation evidence: 118 backend tests, 5 popup security tests,
  clean project TypeScript, and 64 app/auth integration tests.
- Forwarded HTTPS/host requests produce the registered public callback URI and
  accept only the exact public browser origin.
- Token-mode connection never sends access or refresh tokens to the credential
  vault, regardless of the client `persist` value.
- Azure SQL login rejects visible connectors whose loader does not declare the
  `azure_sql` profile and delegated SQL audience.
- Generic `mssql` discovery remains credential-only and exposes no Entra popup.
- Concurrent callback attempts can consume a state value at most once.
- Request-controlled connection values cannot introduce a second ODBC
  attribute or override Azure SQL transport/authentication policy.
- More than eight simultaneous users can complete independent login flows
  without cross-session eviction.
- Review-blocker regression tests pass for forwarded proxy handling,
  token-vault exclusion, SQL connector binding, and concurrent state use.

### DF-017: Fabric workspace and item discovery are not available

**Status**: Planned \
**Severity**: Medium \
**Area**: Fabric, connector discovery, authentication

Fabric workspace and item discovery are not yet available. This is shared
discovery and authentication infrastructure work, not a placeholder generic
tabular loader.

Planned implementation work is tracked in
`docs/plans/2026-07-09-fabric-workspaces.md`.

Impact:

- Users cannot enumerate accessible Fabric workspaces and items through a
  delegated per-user path.
- Downstream Fabric connectors cannot rely on a shared discovery surface.

Recommended remediation:

1. Implement Fabric REST delegated scopes and audience-aware token routing for
   discovery APIs.
2. Enforce strict popup `state`, `origin`, and `source` validation for auth
   callback handling.
3. Add a shared multi-replica session backend with a high-entropy Flask secret
   and secure cookie policy.
4. Implement continuation-token pagination and bounded `Retry-After` handling.

Acceptance criteria:

- The connector can list only workspaces and items available to the delegated
  user.
- Discovery does not claim import support where import paths are not yet
  implemented.
- Popup authentication flow does not expose tokens to browser storage.
- API and auth errors are returned through sanitized structured responses.

### DF-018: Fabric Lakehouse tables and files cannot be imported

**Status**: Planned; blocked by DF-017 and data-plane spike \
**Severity**: Medium \
**Area**: Fabric Lakehouse, OneLake, data loaders

Fabric Lakehouse import is not yet implemented for either Delta tables or file
objects. This work is blocked by DF-017 discovery/auth foundations and a
data-plane correctness spike.

Planned implementation work is tracked in
`docs/plans/2026-07-09-fabric-lakehouse.md`.

Impact:

- Users can neither browse Lakehouse data-plane assets nor import supported
  table/file data to workspaces.
- Lakehouse source identity and import safety guarantees are currently absent.

Recommended remediation:

1. Implement dual-token handling: Fabric metadata token and Storage-audience
   OneLake token with fail-closed audience checks.
2. Use GUID-based source identifiers for workspace, item, and table/file
   references.
3. Complete a Delta snapshot correctness spike comparing `delta-rs` against DFS
   and Delta log semantics.
4. Define first supported file formats, enforce confined paths, and apply byte
   and row limits.
5. Validate regional and private-endpoint behavior for OneLake access paths.

Acceptance criteria:

- A `FabricLakehouseDataLoader` is registered through the connector system.
- Catalog browsing works for supported Lakehouse tables and files.
- Delta and first-slice supported file imports succeed.
- Import enforcement applies `MAX_IMPORT_ROWS` plus a documented byte cap.
- Token audience checks fail closed.
- Automated tests cover discovery, import, limits, and error handling.

### DF-019: Fabric semantic models cannot be queried or imported

**Status**: Planned; blocked by DF-017 and metadata/API-selection spikes \
**Severity**: Medium \
**Area**: Fabric semantic models, Power BI APIs, RLS

Fabric semantic model querying and import are not yet implemented. Delivery is
blocked by DF-017 shared discovery/auth work and metadata/API-selection spikes.

Planned implementation work is tracked in
`docs/plans/2026-07-09-fabric-semantic-models.md`.

Impact:

- Users cannot query semantic models through delegated permissions.
- Data Formulator cannot import safe semantic-model result slices into
  workspaces.

Recommended remediation:

1. Use Fabric discovery plus delegated Power BI `Dataset.Read.All` token flow
   with strict audience and permission checks.
2. Implement JSON `executeQueries` as the first query path, with Arrow support
   gated behind explicit validation.
3. Preserve existing RLS semantics and avoid service-principal equivalence for
   delegated user flows.
4. Disallow arbitrary DAX and `impersonatedUserName`; provide safe server query
   templates.
5. Enforce documented API limits and throttling controls.

Acceptance criteria:

- A semantic-model loader is registered and integrated with discovery.
- Query results can be safely materialized to Arrow and Parquet through the
  approved path.
- RLS is preserved for delegated user queries.
- Limits enforce 15 MB response size, 100K rows per query, 1M values per query,
  and 120 queries per minute.
- Errors are sanitized and returned through the unified error format.

## Confirmed Strengths

- User connector registry keys and credential-vault records are identity scoped.
- Credential values are encrypted at rest by the local vault.
- Backend sessions use server-side cache storage when dependencies are present.
- Source-filter operators are allowlisted and filter values are escaped.
- Plugins are disabled by default outside local mode and cannot silently
  override built-in loaders.
- Connector API errors generally use the unified structured error protocol.
- Catalog pagination and import row counts have explicit upper bounds.

## Rejected Findings

The audit investigated and rejected these claims after checking the current
implementation:

- Service tokens are not normally placed in readable client-side Flask cookies;
  the configured session backend is server-side `cachelib`.
- Missing loader methods are caught through `ExternalDataLoader` abstract
  methods.
- Inline source-filter values are not raw SQL; operators are allowlisted and
  values are escaped.
- SQLite credential writes are committed by the connection context manager and
  use SQLite journaling; the stronger problem is replica-local storage, not a
  missing explicit `commit()` call.
- Workspace traversal is prevented because both local and Azure workspace
  managers sanitize workspace identifiers before constructing paths.
- Runtime model-registry reload is not required for Container Apps environment
  updates because each update creates a new revision and process.
- The `CachedAzureBlobWorkspace` executor concern is not on the current manager
  path because `AzureBlobWorkspaceManager` returns `AzureBlobWorkspace`.
- Rejecting an Entra callback solely because it lacks `X-Identity-Id` would
  break the intended hosted flow. External identity providers cannot return
  application identity headers; the signed initiating Flask session is the
  callback binding.
- Process-local OAuth state is atomic under the enforced one-worker deployment;
  the confirmed defect is the cross-user capacity limit in DF-021, not missing
  thread synchronization.
- Azure SQL refresh-token support is intentionally outside the first slice.
  Expired or claims-challenged access requires explicit reauthentication; the
  unresolved durability requirement is tracked in DF-016 and DF-017.
