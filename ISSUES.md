# Data Formulator Audit and Change Log

This file tracks confirmed issues from the data connector and general stability
audit performed on 2026-07-09. Findings are ordered by severity and intended to
be independently actionable.

It also records changes made against the original upstream Data Formulator
codebase. Copilot and Agency brain assets are excluded from the change ledger
because they do not alter product runtime behavior.

## Implemented Changes

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
- Current live revision: `ca-dataformulator--0000004`.
- Current live image: `azd-deploy-1783629787`.

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
- Backend tests could not be executed locally because this Windows Python
  environment does not have the project dependencies or `pytest` installed.

## High Priority

### DF-001: Replica-local state conflicts with multi-replica scaling

**Status**: Open \
**Severity**: High \
**Area**: Deployment, sessions, connectors, workspaces

The Container App permits up to three replicas, but its stateful services use
the container's local filesystem and no persistent volume is configured.

Evidence:

- `infra/modules/containerapp.bicep` sets `maxReplicas: 3` without `volumes` or
  `volumeMounts`.
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

**Status**: Open \
**Severity**: High \
**Area**: Data loaders, query safety

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

**Status**: Open \
**Severity**: High \
**Area**: Connector lifecycle, database stability

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

**Status**: Open \
**Severity**: High \
**Area**: Credential lifecycle, resilience

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

**Status**: Mitigated; retry handling remains open \
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

Remaining remediation:

1. Add bounded retries with exponential backoff and jitter for 429 and retryable
   upstream 5xx responses.
2. Honor `Retry-After` and Azure rate-limit reset headers when present.
3. Avoid immediate modality fallback when the original failure is throttling.
4. Emit per-model request, token, throttle, retry, and latency metrics.

Acceptance criteria:

- A burst within allocated quota does not produce user-visible 429 failures.
- Throttled calls retry within a bounded budget and preserve the structured
  `LLM_RATE_LIMIT` error when retries are exhausted.
- Image fallback does not create a second immediate request after a 429.

### DF-011: Azure Blob metadata updates can lose concurrent changes

**Status**: Open \
**Severity**: High \
**Area**: Azure Blob workspaces, metadata concurrency

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

**Status**: Open \
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

**Status**: Open \
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

### DF-006: The production container runs Flask's development server

**Status**: Open \
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

### DF-007: Connector timeout behavior is inconsistent

**Status**: Open \
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

### DF-008: Row limits do not cap memory consumption

**Status**: Open \
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

**Status**: Open \
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

### DF-014: Streaming requests mutate a module-global logger level

**Status**: Open \
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

### DF-015: OAuth state supports only one pending login per provider

**Status**: Open \
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
- A random Flask secret is not a deployed issue because the Container App Bicep
  supplies the stable `flask-secret-key` secret.

## Suggested Order

1. Resolve DF-011 to prevent concurrent Azure metadata loss.
2. Resolve DF-012 and DF-001 together as container memory and deployment
   safety work.
3. Resolve DF-002 before expanding connector access to untrusted users.
4. Resolve DF-003 and DF-004 together as the connector lifecycle hardening
   pass.
5. Complete DF-009 transport-level retry handling.
6. Address DF-005 through DF-008 and DF-013 through DF-015 as medium-priority
   production hardening work.
