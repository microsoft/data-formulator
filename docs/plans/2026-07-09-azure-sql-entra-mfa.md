# Azure SQL Microsoft Entra MFA Implementation Plan

**Status:** Reassessed; loader and mocked auth implementation may begin after
the shared delegated-auth contract is green. The representative Azure SQL
target, network path, ODBC Driver 18, current-user SQL-audience token, and
token packing are verified. Explicit active-tenant token acquisition produced
three successful independent connections, and the implemented loader enumerated
the catalog. Code and integration review blockers are resolved: one trusted
proxy hop preserves the public callback/origin, token-mode vault persistence
excludes tokens, the gateway binds to delegated SQL connectors, and pending
state consumption is process-atomic under the one-worker deployment. Release
validation remains blocked on app permission/redirect evidence, the application
popup flow, and restart-durable delegated-token sessions.

**Goal:** Add hosted, per-user Microsoft Entra authentication for Azure SQL Database so Conditional Access can require MFA and Data Formulator can connect with the resulting delegated access token.

**Architecture:** Extend the existing SQL Server loader rather than creating a parallel Azure SQL loader. A dedicated backend OAuth popup flow obtains an Azure SQL-scoped token, stores it only in the identity-scoped `TokenStore` session, and posts a token-free success message to the opener; `DataConnector` then injects the token into `MSSQLDataLoader`, which passes it to `pyodbc` through `SQL_COPT_SS_ACCESS_TOKEN`. Existing SQL username/password and Windows trusted authentication remain unchanged.

**Tech Stack:** Flask, existing OIDC provider configuration, OAuth 2.0 authorization code flow, Microsoft ODBC Driver 18, `pyodbc`, React, TypeScript, react-i18next, pytest, Vitest.

---

## Scope And Acceptance Criteria

This plan implements hosted per-user authentication, not the Windows-only ODBC `ActiveDirectoryInteractive` dialog. MFA remains a Microsoft Entra Conditional Access policy decision; Data Formulator requests an interactive delegated Azure SQL token and must not claim to force MFA itself.

The feature is complete when:

- A user can choose **Sign in with Microsoft Entra** on an SQL Server connector.
- The popup requests `https://database.windows.net/.default` and supports Entra Conditional Access/MFA.
- The callback validates state, stores the access token under the connector instance ID, and sends no token to browser JavaScript.
- `MSSQLDataLoader` connects with `SQL_COPT_SS_ACCESS_TOKEN` and omits `UID`, `PWD`, `Trusted_Connection`, and `Authentication` from that connection string.
- Existing SQL authentication and Windows trusted authentication continue to build the same connection strings.
- Tokens, authorization codes, and raw ODBC connection strings are absent from logs, connector configuration, and the credential vault.
- Expired or missing delegated tokens require a new sign-in rather than silently falling back to SQL or Windows credentials.
- English and Chinese UI text and operator documentation describe prerequisites and limitations.

## Assumptions And Disconfirmers

- The deployment uses Microsoft Entra as its OIDC provider and backend/confidential-client mode for the hosted callback.
- The app registration has a Web redirect URI for the Azure SQL callback and delegated Azure SQL permission/consent.
- The Azure SQL logical server has a Microsoft Entra administrator, and each user or group has database permissions.
- The host has Microsoft ODBC Driver 18 for SQL Server.

Stop and revise the design if the Entra app cannot request an Azure SQL delegated scope, if the deployment must remain provider-agnostic, or if the user requirement is workload identity rather than per-user authorization. In those cases, use managed identity as a separate authentication mode instead of weakening this flow.

Implementation does not depend on Fabric workspace discovery. It does depend
on the shared connector-instance-plus-audience TokenStore contract, safe
app-relative delegated URLs, token-free popup success, and exact popup
origin/source validation from the Fabric workspace foundation.

## Verified Real-Service Fixture

The approved external staging target is reachable on TCP 1433. Microsoft ODBC
Driver 18.6.2.1 reaches the server using an in-memory token for the Azure SQL
resource audience, with encryption enabled and server-certificate trust
disabled. The token is current, audience-correct, tenant-aligned, and
MFA-authenticated. Three independent non-pooled connections succeeded, and the
implemented loader enumerated 25 catalog entries.

The Azure CLI cache contains more than one tenant context. Real-service smoke
tests must request the SQL token explicitly for the active tenant; an ambiguous
cached-token attempt produced SQLSTATE 28000 before explicit tenant selection
restored repeatable access. This proves target reachability, TLS, native-driver
support, token acquisition, token packing, and current-user authorization. It
does not prove the application registration, callback, consent, or popup flow.
No username, password, token, or connection string was persisted or printed.

## Code And Integration Review Gate

The merge-blocking review findings are resolved:

1. **Forwarded proxy correctness:** Flask trusts exactly one Container Apps
    ingress proxy hop for scheme, host, and client address. Login and token
    exchange use the same public HTTPS callback URI registered in Entra.
2. **Vault exclusion:** token-mode connect persists only non-sensitive
    connection params; access and refresh tokens remain session-only.
3. **Connector binding:** login requires delegated mode and the exact Azure SQL
    audience.
4. **Atomic state:** a process-local lock-backed registry permits one callback
    consumption under the enforced one-worker deployment.

Before production release, require:

- Delegated-token sessions survive ordinary process and revision replacement.
- The production Entra permission, callback URI, Driver 18 image, and
    Conditional Access popup flow are verified end to end.

Review evidence includes RED/GREEN tests for forwarded headers, token-vault
exclusion, connector binding, and concurrent state use, plus focused backend
and frontend suites, clean project TypeScript and touched-file lint, and
repeatable explicit-tenant staging catalog access.

## Task 1: Specify The Loader Token Contract With Failing Tests

**Objective:** Pin the ODBC connection behavior before changing production code.

**Files:**

- Create: `tests/backend/data/test_mssql_auth.py`
- Modify later: `py-src/data_formulator/data_loader/mssql_data_loader.py`

### Step 1: Write loader RED tests

Add `pytestmark = [pytest.mark.backend]` and a `TestMSSQLAuthentication` class. Patch `pyodbc.connect` and assert one behavior per test:

```python
import struct
from unittest.mock import patch

import pytest

pytestmark = [pytest.mark.backend]


class TestMSSQLAuthentication:
    def test_access_token_uses_odbc_token_attribute(self):
        from data_formulator.data_loader.mssql_data_loader import (
            SQL_COPT_SS_ACCESS_TOKEN,
            MSSQLDataLoader,
        )

        with patch("pyodbc.connect") as connect:
            MSSQLDataLoader({
                "server": "example.database.windows.net",
                "database": "analytics",
                "access_token": "token-value",
                "driver": "ODBC Driver 18 for SQL Server",
            })

        connection_string = connect.call_args.args[0]
        attributes = connect.call_args.kwargs["attrs_before"]
        assert "UID=" not in connection_string
        assert "PWD=" not in connection_string
        assert "Trusted_Connection=" not in connection_string
        assert SQL_COPT_SS_ACCESS_TOKEN in attributes

    def test_access_token_is_encoded_for_odbc(self):
        # Assert the value is a 4-byte native-length prefix followed by
        # the token encoded as UTF-16-LE, per the Microsoft ODBC contract.
        ...

    def test_sql_credentials_preserve_existing_connection_string(self):
        ...

    def test_empty_username_preserves_trusted_connection(self):
        ...
```

Add tests that `auth_config()` declares delegated authentication and that `delegated_login_config()` exposes the Azure SQL login endpoint without embedding credentials.

### Step 2: Verify loader RED

Run:

```powershell
python -m pytest tests/backend/data/test_mssql_auth.py -q
```

Expected: failures because token packing, the ODBC access-token constant, and delegated metadata do not exist.

## Task 2: Add Minimal ODBC Access-Token Support

**Objective:** Make the loader consume an injected token without changing catalog or query behavior.

**Files:**

- Modify: `py-src/data_formulator/data_loader/mssql_data_loader.py`

### Step 1: Implement minimum loader GREEN behavior

Introduce a small pure helper and keep secret material out of exceptions and logs:

```python
SQL_COPT_SS_ACCESS_TOKEN = 1256


def _encode_odbc_access_token(access_token: str) -> bytes:
    encoded = access_token.encode("utf-16-le")
    return struct.pack("=i", len(encoded)) + encoded
```

Read `access_token` from params. When present, call:

```python
pyodbc.connect(
    connection_string,
    attrs_before={
        SQL_COPT_SS_ACCESS_TOKEN: _encode_odbc_access_token(access_token),
    },
)
```

Do not add `UID`, `PWD`, `Trusted_Connection`, or `Authentication` in token mode. Preserve the existing branches byte-for-byte when no token is present.

Add:

```python
@staticmethod
def auth_config() -> dict:
    return {
        "mode": "delegated",
        "display_name": "Microsoft Entra",
        "login_url": "/api/auth/azure-sql/login",
        "supports_refresh": False,
    }

@staticmethod
def delegated_login_config() -> dict[str, str]:
    return {
        "login_url": "/api/auth/azure-sql/login",
        "label_key": "loader.mssql.entraSignIn",
    }
```

### Step 2: Verify loader GREEN

Run the focused test from Task 1. Then run existing MSSQL catalog tests:

```powershell
python -m pytest tests/backend/data/test_mssql_auth.py tests/backend/data/test_sync_catalog_cross_db.py -q
```

Expected: all selected tests pass.

## Task 3: Add The Azure SQL Delegated OAuth Gateway Test-First

**Objective:** Obtain and retain a SQL-scoped token without exposing it to the frontend.

**Files:**

- Create: `py-src/data_formulator/auth/gateways/azure_sql_gateway.py`
- Create: `tests/backend/auth/test_azure_sql_gateway.py`
- Modify: `py-src/data_formulator/app.py`

### Step 1: Write gateway RED route tests

Use a minimal Flask app with `register_error_handlers(app)`. Mock discovery/token HTTP calls and cover:

- Login requires an existing connector ID visible to the current identity.
- Login creates a cryptographically random state bound to connector ID and identity.
- Authorization URL uses the configured Entra authorize endpoint, callback URI, and `https://database.windows.net/.default` scope. The first slice does not request or retain refresh tokens.
- Callback rejects missing or mismatched state without calling the token endpoint.
- Callback exchanges the code with the configured client ID/client secret and exact callback URI.
- Callback stores the token under the connector instance ID in `TokenStore`.
- Callback HTML posts only `{type: "df-sso-auth", authenticated: true}` to the validated opener origin; it never includes access or refresh tokens.
- Token endpoint failures return a token-free error message and do not log response bodies.
- The route rejects non-Entra or incomplete OIDC configuration with a safe actionable error.

### Step 2: Verify gateway RED

```powershell
python -m pytest tests/backend/auth/test_azure_sql_gateway.py -q
```

Expected: import or route-registration failure because the gateway does not exist.

### Step 3: Implement the gateway

Use the configured OIDC provider’s resolved authorization and token endpoints. Keep a session record containing connector ID, identity, return origin, state, and creation time. Validate all fields and expire state after ten minutes.

At callback:

1. Pop and compare state with `secrets.compare_digest`.
2. Exchange the code server-side.
3. Store access/refresh token and expiry using `TokenStore.store_service_token(connector_id, ...)`.
4. Return a small static HTML page that calls `window.opener.postMessage` with a success flag and the exact validated origin.
5. Close the popup.

Register the blueprint unconditionally with the other token routes; configuration validation belongs at request time so app startup remains robust.

### Step 4: Verify gateway GREEN

Run the focused gateway tests until green. Do not edit assertions merely to match implementation output; diagnose any mismatch as test, implementation, or specification before changing it.

## Task 4: Support Token-Free Delegated Success In The Frontend

**Objective:** Complete the connector after the backend has stored the token, without sending token material through JavaScript.

**Files:**

- Modify: `src/components/ComponentType.tsx`
- Modify: `src/views/UnifiedDataUploadDialog.tsx`
- Modify: `src/views/DBTableManager.tsx`
- Create: `tests/frontend/unit/views/delegatedLoginMessage.test.ts`

### Step 1: Write frontend RED message-parser tests

Extract an exported helper that accepts only messages with:

- `type === "df-sso-auth"`
- expected origin equal to `window.location.origin`
- either an access token for legacy delegated providers or `authenticated === true` for server-stored-token providers

Tests must reject wrong origins, malformed messages, and token-free messages without the explicit success flag.

### Step 2: Verify frontend RED

```powershell
yarn test tests/frontend/unit/views/delegatedLoginMessage.test.ts
```

Expected: failure because the helper does not exist.

### Step 3: Implement the frontend behavior

For token-free success, call `/api/connectors/connect` in ordinary credential mode with the connector ID and non-sensitive connection params. `DataConnector._inject_credentials()` will retrieve the connector-scoped token from `TokenStore` before creating the loader.

Retain the existing token-bearing Superset flow unchanged. Add the connector ID and return origin to the delegated login URL. Validate `event.origin` before accepting any popup message.

Extend delegated-login types with optional `label_key`, and render the translated key when present.

### Step 4: Verify frontend GREEN

Run the focused frontend test, then the frontend suite:

```powershell
yarn test tests/frontend/unit/views/delegatedLoginMessage.test.ts
yarn test
```

## Task 5: Add English And Chinese UI Text

**Objective:** Make the new sign-in action and failures understandable in both supported languages.

**Files:**

- Modify: `src/i18n/locales/en/loader.json`
- Modify: `src/i18n/locales/zh/loader.json`
- Modify only if shared messages are needed: `src/i18n/locales/en/errors.json`
- Modify only if shared messages are needed: `src/i18n/locales/zh/errors.json`

Add matching keys for:

- `loader.mssql.entraSignIn`
- Entra configuration unavailable
- Sign-in expired or canceled
- Azure SQL access denied

Do not hardcode new visible strings in TSX.

Validate both JSON files parse and contain identical new key paths.

## Task 6: Document Deployment And Azure Prerequisites

**Objective:** Explain what administrators must configure and avoid implying that the application itself enforces MFA.

**Files:**

- Modify: `docs/docs-cn/1-data-source-connections.md`
- Modify: `docs/dev-guides/4-authentication-oidc-tokenstore.md`
- Modify: `docs/dev-guides/3-data-loader-development.md`
- Modify: `README.md`

Document:

- Microsoft Entra Conditional Access controls whether MFA is required.
- The app registration needs the Azure SQL delegated scope and callback URI.
- Azure SQL needs an Entra administrator and database users/groups with least privilege.
- ODBC Driver 18 is required on the Data Formulator host.
- Access tokens are session-scoped and are not persisted in connector YAML or the credential vault.
- Disconnect clears the connector token.
- Managed identity is a separate future workload-auth mode, not a synonym for per-user MFA.

Also correct the stale plugin-override statements already identified in the two dev guides: current code rejects built-in key collisions.

## Task 7: Focused Security And Regression Validation

**Objective:** Prove the new auth path is isolated, secret-safe, and does not regress existing connectors.

Run:

```powershell
python -m pytest tests/backend/auth/test_azure_sql_gateway.py tests/backend/data/test_mssql_auth.py tests/backend/data/test_sync_catalog_cross_db.py -q
yarn test tests/frontend/unit/views/delegatedLoginMessage.test.ts
yarn lint
python -m pytest tests/backend/ -q
yarn test
git diff --check
```

Then use editor diagnostics on every touched file and review the uncommitted diff for:

- No access token, refresh token, authorization code, client secret, or full ODBC connection string in logs or error responses.
- OAuth state is single-use, time-bounded, identity-bound, and compared safely.
- Popup messages validate origin and contain no token in the new path.
- Connector IDs are resolved through identity-aware helpers rather than direct registry indexing.
- SQL queries remain parameterized or identifier-validated as before.
- Existing SQL and Windows authentication tests remain green.
- No token is written to `connectors.yaml` or the credential vault.
- Documentation and English/Chinese keys agree with runtime behavior.

## Quality Attribute Gates

This plan is gated by shared release-blocking requirements in
`docs/plans/2026-07-09-connector-implementation-requirements.md`:

- SIMPLE-001 through SIMPLE-006
- ROBUST-001 through ROBUST-008
- PERF-001 through PERF-008

Azure SQL specific quality criteria (excluding user think-time and interactive
IdP or MFA time):

- Connection completion time excluding interactive IdP or MFA screens MUST be
    <= 5 seconds p95 in a representative environment.
- Query preview up to 10,000 rows MUST be <= 5 seconds p95 in a representative
    environment.
- ODBC connect timeout MUST be explicit and centrally configurable.
- Login and auth-related SQL errors MUST NOT be retried.
- Transient SQL retries MUST be bounded and used only when the operation is
    idempotent.
- Existing SQL authentication and Windows trusted authentication UX MUST remain
    available with no extra connector type introduced.

## Definition of Done

This plan is done when all existing scope and validation criteria in this
document are satisfied, plus all quality criteria are satisfied:

- Shared quality gates SIMPLE-001 through SIMPLE-006,
    ROBUST-001 through ROBUST-008, and PERF-001 through PERF-008 are satisfied
    per `docs/plans/2026-07-09-connector-implementation-requirements.md`.
- Azure SQL specific quality criteria in this plan are satisfied.
- The DF-016 quality evidence reports pass with no unapproved exceptions:
    `docs/plans/evidence/df-016-azure-sql-quality-report.json` and
    `docs/plans/evidence/df-016-azure-sql-quality-report.md`.

## Risks And Tradeoffs

- **Consent and tenant policy:** Azure SQL delegated permission may require administrator consent. Return a safe actionable message rather than raw Entra errors.
- **Token lifetime:** This first slice is session-scoped. If refresh is required, add it through the existing `TokenStore` refresh contract using resolved provider endpoints; do not persist refresh tokens by default.
- **Provider coupling:** The gateway is intentionally Azure SQL/Microsoft Entra-specific. Reject incompatible providers instead of pretending generic OIDC tokens are valid for Azure SQL.
- **Connection pooling:** A live `pyodbc` connection can outlive its access token. Reconnection after token expiry must request a current token; existing open connections do not need mid-connection token replacement.
- **Fallback safety:** Never fall back from a selected delegated path to a blank-password trusted connection. Missing token must fail closed and ask the user to sign in again.
- **Hosted popup behavior:** The popup is browser-based OAuth, not an ODBC UI on the Container App host, so it remains viable on Linux Azure Container Apps.

## References

- Microsoft Learn: [Using Microsoft Entra ID with the ODBC Driver](https://learn.microsoft.com/sql/connect/odbc/using-azure-active-directory?view=sql-server-ver17)
- Microsoft Learn: [Microsoft Entra service principals with Azure SQL](https://learn.microsoft.com/azure/azure-sql/database/authentication-aad-service-principal?view=azuresql)
- Repository auth guide: `docs/dev-guides/4-authentication-oidc-tokenstore.md`
- Repository connector guide: `docs/dev-guides/5-data-connector-api.md`
- Existing delegated implementation: `py-src/data_formulator/data_loader/superset_data_loader.py`
