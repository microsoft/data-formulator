# Audit Remediation Implementation Plan

**Status:** Local implementation, commit, and production deployment complete;
external consent and session gates remain pending.

**Goal:** Resolve the locally actionable findings from the 2026-07-13 audit
without weakening SQL authentication compatibility, OAuth replay protection,
or the current one-worker deployment contract.

**Architecture:** Harden ODBC connection construction at the shared MSSQL data
plane so SQL Server and Azure SQL receive one validated attribute set. Scope
Azure SQL pending OAuth capacity per initiating browser session while retaining
process-atomic single-use consumption. Complete non-destructive repository
hygiene separately and leave authority/cost-dependent Azure work behind explicit
gates.

**Tech Stack:** Python 3.11+, Flask, pyodbc, pytest, React/Vitest, Markdown,
Git, Azure Container Apps, Microsoft Entra ID.

---

## Scope And Constraints

Locally actionable in this implementation:

- DF-020: ODBC connection-string attribute injection.
- DF-021: cross-user Azure SQL pending-state eviction.
- RF-001: ignore future `.github-backup-*` directories and remove the verified
  redundant rollback directory.
- RF-002: repair stale issue-ledger paths in `HANDOFF.md`.
- Update `docs/plans/ISSUES.md` with test-backed resolution evidence.

Blocked or separately governed:

- Tenant-wide Azure SQL delegated consent requires an active eligible Entra
  administrator role. The current signed-in identity has no active direct or
  transitive directory role.
- Restart-durable shared sessions require an approved shared backend,
  infrastructure/cost decision, secret handling, migration behavior, and
  deployment validation. Do not silently add a paid cache resource.
- Do not commit, push, deploy, or change Azure resources unless explicitly
  requested.

## Completion Status

| Task | Status | Evidence |
| --- | --- | --- |
| 1. Pin DF-020 | Complete | Adversarial numeric, delimiter, driver, credential, and TLS-policy tests added |
| 2. Implement safe ODBC construction | Complete | 25 focused tests; 90 focused and adjacent tests pass |
| 3. Pin DF-021 | Complete | Cross-session, per-session capacity, cleanup, replay, and equal-time ordering tests added |
| 4. Isolate pending-state capacity | Complete | 19 focused tests; 111 focused and adjacent tests pass |
| 5. Complete repository hygiene | Complete | Backup ignored, proven recoverable, and deleted; handoff paths corrected; heir-doctor healthy |
| 6. Update audit ledger | Complete | DF-020, DF-021, RF-001, RF-002, and DF-022 statuses and evidence recorded |
| 7. Final validation and review | Complete | Backend 2,023 passed/13 skipped; frontend 271 passed; build, lint, diagnostics, diff check, and independent reviews pass |

The completed tasks are committed, pushed in `ebada59`, and deployed to
production revision `ca-dataformulator--0000010`. Entra consent, durable shared
sessions, and the DF-022 cookie migration remain outside this completed
implementation scope.

## Task 1: Pin DF-020 With Failing Tests

**Objective:** Prove that every request-controlled ODBC field either has a safe
representation or fails before `pyodbc.connect()`.

**Files:**

- Test: `tests/backend/data/test_mssql_auth.py`

### Step 1.1: Add Numeric-Field Rejection Cases

Add parameterized tests for `port` and `connection_timeout` values containing
semicolon-delimited attributes. Assert a `ValueError` is raised and
`pyodbc.connect()` is not called.

### Step 1.2: Add Connection-String Field Cases

Cover injection attempts through `server`, `database`, `driver`, `encrypt`,
`trust_server_certificate`, `user`, and `password`. Require fixed Azure SQL
Driver 18/TLS attributes to occur exactly once.

### Step 1.3: Preserve Representable Credentials

Add a regression test for a SQL password containing a semicolon. Assert the
password is represented as one ODBC value rather than rejected or interpreted
as another attribute. Add a rejection case for values containing a closing
brace if the selected ODBC representation cannot encode it safely.

### Step 1.4: Run DF-020 RED Validation

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/backend/data/test_mssql_auth.py -q
```

Expected: the new adversarial cases fail against direct string interpolation;
existing benign authentication cases remain green.

## Task 2: Implement Safe ODBC Construction

**Objective:** Make DF-020 tests pass in the shared MSSQL data plane with the
smallest compatible implementation.

**Files:**

- Modify: `py-src/data_formulator/data_loader/mssql_data_loader.py`
- Verify: `py-src/data_formulator/data_loader/azure_sql_data_loader.py`
- Test: `tests/backend/data/test_mssql_auth.py`

### Step 2.1: Add Pure Validation Helpers

Add focused helpers for:

- bounded integer parsing for port and connection timeout;
- `yes`/`no` option validation for generic MSSQL encryption controls;
- safe ODBC value formatting that keeps semicolons inside one value and rejects
  unrepresentable control or closing-brace characters;
- driver-name validation before inserting a brace-delimited driver value.

Helpers must not log rejected values because credentials and connection details
may be sensitive.

### Step 2.2: Build One Unambiguous Connection String

Use the helpers for every request-controlled field. Keep Azure SQL's Driver 18,
`Encrypt=yes`, and `TrustServerCertificate=no` overrides authoritative and
present exactly once. Token mode must not add `UID`, `PWD`,
`Trusted_Connection`, or `Authentication`.

### Step 2.3: Preserve Existing Modes

Confirm ordinary SQL credentials and Windows trusted authentication retain the
same behavior. Keep access-token packing in `attrs_before` unchanged and do not
retain the token on the loader.

### Step 2.4: Run DF-020 GREEN Validation

Run the focused test until all cases pass, then run adjacent MSSQL catalog and
connector tests:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/backend/data/test_mssql_auth.py tests/backend/data/test_data_connector_framework.py tests/backend/data/test_sync_catalog_cross_db.py -q
```

## Task 3: Pin DF-021 With Failing Tests

**Objective:** Prove that bounded OAuth state in one browser session cannot
evict another browser's valid login.

**Files:**

- Test: `tests/backend/auth/test_azure_sql_gateway.py`

### Step 3.1: Add Independent-Session Capacity Coverage

Create more than eight Flask test clients. Start one Azure SQL login per client
and assert every resulting callback state remains consumable by its initiating
client.

### Step 3.2: Add Per-Session Bound Coverage

Start nine logins in one client. Assert only that client's oldest pending state
is evicted or rejected according to the established eight-state contract while
another client's state remains unaffected.

### Step 3.3: Retain Replay And Mismatch Coverage

Keep existing thread-race, replay, wrong-session, TTL, connector binding, and
token-free response assertions. Add cleanup assertions so failed states do not
remain indefinitely in the session map.

### Step 3.4: Run DF-021 RED Validation

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/backend/auth/test_azure_sql_gateway.py -q
```

Expected: the cross-session capacity case fails because `_PENDING_STATES` is
currently capped process-wide.

## Task 4: Isolate Pending-State Capacity Per Session

**Objective:** Make DF-021 tests pass while preserving atomic single-use state
under one Gunicorn worker and four threads.

**Files:**

- Modify: `py-src/data_formulator/auth/gateways/azure_sql_gateway.py`
- Test: `tests/backend/auth/test_azure_sql_gateway.py`

### Step 4.1: Move The State Bound To The Signed Session

Apply the existing eight-entry cap and ten-minute TTL to the initiating signed
Flask session map. Evicting one session's oldest state must remove only that
state's matching process record.

### Step 4.2: Retain Global Records By TTL, Not User Count

Keep globally unique random state keys in the process-atomic registry. Remove
expired records by TTL, but do not evict another browser's valid state merely
because the total process count exceeds eight.

### Step 4.3: Preserve Atomic Consumption

Keep comparison and mutation under `_STATE_LOCK`. Require both the initiating
signed session record and matching process record. A callback may consume a
state at most once.

### Step 4.4: Run DF-021 GREEN Validation

Run focused gateway tests, then adjacent token-store and app/auth integration
tests:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/backend/auth/test_azure_sql_gateway.py tests/backend/auth/test_token_store.py tests/backend/data/test_data_connector_framework.py -q
```

## Task 5: Complete Repository Hygiene

**Objective:** Resolve stale guidance and prevent transient Edition backups
from entering future reviews, then remove rollback data only after proving that
every file is recoverable.

**Files:**

- Modify: `.gitignore`
- Modify: `HANDOFF.md`
- Verify: `.github-backup-20260713-212145/`

### Step 5.1: Ignore Future Backups

Add `.github-backup-*` to `.gitignore`. Confirm the existing backup disappears
from ordinary `git status` output while it is being evaluated.

### Step 5.2: Repair Handoff Paths

Replace current root `ISSUES.md` references in `HANDOFF.md` with
`docs/plans/ISSUES.md`. Preserve dated historical evidence outside the active
handoff unless it is also operational guidance.

### Step 5.3: Verify The Active Edition

Run:

```powershell
node .github/skills/greeting-checkin/scripts/heir-doctor.cjs
```

Expected: healthy Edition v4.1.0.

### Step 5.4: Remove The Verified Redundant Backup

Confirm every backup file exists as an exact Git blob or current relocated
file, remove only `.github-backup-20260713-212145/`, then rerun heir-doctor and
verify the working tree remains clean.

## Task 6: Update The Audit Ledger

**Objective:** Make the issue tracker reflect demonstrated code and hygiene
outcomes without overstating external readiness.

**Files:**

- Modify: `docs/plans/ISSUES.md`

### Step 6.1: Update DF-020 And DF-021

Mark each resolved only after its focused and adjacent tests pass. Record the
implemented boundary and exact validation evidence.

### Step 6.2: Update RF-001 And RF-002

Mark RF-002 resolved after all active handoff paths exist. Mark RF-001 resolved
only after the backup is ignored, proven recoverable, deleted, and followed by
a healthy heir-doctor check.

### Step 6.3: Preserve External Gates

Keep tenant-wide Entra consent and restart-durable shared sessions open. Record
that the CLI is correctly scoped to the Microsoft tenant but the app has no
delegated grant and the signed-in identity has no active directory role.

## Task 7: Final Validation And Maintainer Review

**Objective:** Verify behavior, lint, build, and diff scope before reporting
completion.

### Step 7.1: Run Affected Backend Tests

```powershell
.\.venv\Scripts\python.exe -m pytest tests/backend/auth/test_token_store.py tests/backend/auth/test_azure_sql_gateway.py tests/backend/data/test_data_connector_framework.py tests/backend/data/test_mssql_auth.py tests/backend/infrastructure/test_containerapp_state_safety.py -q
```

### Step 7.2: Run Frontend Regression And Build Checks

```powershell
corepack yarn test tests/frontend/unit/views/delegatedLoginMessage.test.ts
corepack yarn build
```

### Step 7.3: Run Lint And Diagnostics

Run editor diagnostics for every touched file, touched frontend ESLint if any
frontend file changed, Markdown diagnostics, and:

```powershell
git diff --check
```

### Step 7.4: Review The Uncommitted Diff

Confirm responsibility boundaries, no token/connection-string logging, no
unexpected generated assets, no Azure-context mutation, and no unrelated user
changes reverted. Report remaining risks and tests not run.

## Risks And Would-Revise Conditions

- If the modern Microsoft ODBC Driver 18 cannot safely represent semicolons in
  brace-delimited values through pyodbc, reject those values explicitly rather
  than relying on ambiguous parsing.
- If tests show existing supported SQL passwords contain closing braces, use a
  verified driver-supported escaping mechanism before rejecting them.
- If session-local bounding cannot preserve atomic replay protection across the
  current four threads, use a dedicated atomic state-store abstraction rather
  than weakening the dual-store check.
- If product requirements demand multiple workers or replicas now, stop the
  process-local fix and select a shared atomic backend first.
- If tenant consent or durable-session infrastructure becomes available during
  implementation, verify it separately; do not fold live Azure mutations into
  the local code-remediation change.

## Implementation Outcome

- DF-020 and DF-021 are resolved in local source with focused RED/GREEN
  coverage and deterministic equal-timestamp OAuth eviction ordering.
- Repository hygiene is complete. All 202 backup files were verified as exact
  Git blobs before the ignored rollback directory was deleted; heir-doctor
  remains healthy.
- Full backend validation passes with 2,023 tests and 13 capability/feature
  skips. Five Flask-Session signer deprecation warnings are tracked as DF-022.
- Full frontend validation passes with 33 files and 271 tests. Production build,
  touched frontend ESLint, editor diagnostics, and diff hygiene pass.
- OIDC access-token refresh logic is tested through the production-used pure
  `getAccessTokenFromManager()` helper; no mutable test-only singleton exports
  appear in production assets.
- Production revision `ca-dataformulator--0000010` is healthy at 100% traffic on
  image `azd-deploy-1783998754`; endpoints, loader discovery, Driver 18,
  managed identity configuration, OAuth preparation, and logs are verified.
- Tenant-wide Entra consent and restart-durable shared sessions remain outside
  this remediation.
