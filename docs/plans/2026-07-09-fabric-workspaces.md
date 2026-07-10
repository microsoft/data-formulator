---
status: Proposed
date: 2026-07-09
scope: Establish shared Microsoft Fabric workspace discovery and delegated auth foundations used by Fabric Lakehouse and Semantic Model plans.
severity: behaviour
falsification-deadline: 2026-09-30
related:
  - docs/dev-guides/3-data-loader-development.md
  - docs/dev-guides/4-authentication-oidc-tokenstore.md
  - docs/dev-guides/7-unified-error-handling.md
  - docs/dev-guides/2-log-sanitization.md
---

# 2026-07-09 Plan for Microsoft Fabric Workspaces

## Goal

Deliver Microsoft Fabric workspace and item discovery as shared catalog infrastructure, not as an ExternalDataLoader that treats arbitrary Fabric items as tabular data.

This plan establishes the common backend and frontend foundations consumed by the follow-up Lakehouse and Semantic Model plans.

Required outcomes:

- Workspace discovery uses Fabric REST `GET https://api.fabric.microsoft.com/v1/workspaces`.
- Item discovery uses Fabric REST `GET /v1/workspaces/{workspaceId}/items`.
- OAuth scope request URIs are `https://api.fabric.microsoft.com/Workspace.Read.All` and `https://api.fabric.microsoft.com/Item.Read.All`.
- UI text may show API permission display names `Workspace.Read.All` and `Item.Read.All`, but backend scope requests always use the full URI scopes.
- Pagination handles `continuationToken` and `continuationUri`.
- 429 handling is bounded and honors `Retry-After`.
- No raw token values and no raw upstream response bodies are logged.
- Discovery success is explicitly separate from data import readiness.

## Architecture

### 1. Boundary and ownership

- Fabric workspace and item discovery is a shared catalog capability under connector/discovery infrastructure.
- It is not implemented as a fake tabular ExternalDataLoader for all Fabric item types.
- Lakehouse import and Semantic Model consumption depend on this discovery layer and reuse its auth and REST client primitives.

### 2. Auth and token model

- Add audience-aware TokenStore APIs with explicit parameters (`identity`, `connector_id`, `audience` or `profile`) instead of exposing opaque serialized tuple keys in route or service contracts.
- Add gateway resource profiles keyed by audience, with Fabric profile using `https://api.fabric.microsoft.com`.
- Use server-side authorization code flow for delegated Fabric consent.
- Gateway state must bind identity, connector, audience, and origin.
- Gateway callback must enforce exact allowlisted origin.
- Popup completion must be token-free to frontend JavaScript.
- Do not persist refresh tokens unless full refresh lifecycle is implemented end to end.

### 3. Precondition fixes before Fabric token use

The following defects are blockers and must be fixed before any Fabric token is issued or consumed:

- TokenStore indexing mismatch: current behavior is loader-type keyed while DataConnector auth calls need connector instance IDs plus audience/profile.
- Delegated URL mutation bug: declared app-relative delegated URLs (for example `/api/auth/...`) currently risk connector prefix mutation and `label_key` stripping.
- Session scale gap: production session backend for multi-replica ACA must be decided and implemented as shared server-side storage (for example Redis-compatible), not instance-local fallback.
- Cookie security gap: `SESSION_COOKIE_SECURE` is not enforced.
- Secret entropy gap: infrastructure currently includes deterministic Flask secret behavior.
- Frontend postMessage gap: popup receiver lacks `event.origin` and `event.source` checks.

### 4. API and reliability behavior

- Fabric REST calls use strict audience profile and scope validation.
- Pagination loops are bounded and terminate on absent continuation signals.
- 429 retry uses bounded attempts with `Retry-After` parsing and upper cap.
- All errors map to unified error protocol with safe messages.
- Logs are sanitized with existing log sanitizer utilities, no secrets, no raw payload dumps.

## Tech Stack

Backend:

- Python Flask in `py-src/data_formulator/`
- Existing auth stack: OIDC provider, TokenStore, delegated gateway patterns
- Requests/http client used by current auth stack
- Unified error protocol (`AppError`, error handler helpers)
- Existing log sanitization utilities

Frontend:

- React + TypeScript under `src/`
- Existing connector/auth UI flows and popup messaging path
- Existing i18n resources (`en` and `zh`)

Infra/config:

- ACA deployment config and env templates under `infra/`, including `infra/modules/containerapp.bicep`
- Session backend configuration shared across replicas
- High-entropy secret generation and secure cookie policy defaults

## Sequential TDD Tasks

### Task 1: Lock current contract failures with tests first

Paths:

- `tests/backend/auth/test_token_store_connector_id_audience.py`
- `tests/backend/data_connector/test_delegated_relative_url_and_label_key.py`
- `tests/backend/security/test_session_security_config.py`
- `tests/frontend/unit/features/connectors/fabric/fabric-popup-security.test.tsx`

Work:

- Add failing tests that prove each blocker described in this plan.
- Ensure every new backend test module includes `pytestmark = [pytest.mark.backend]`.
- Include explicit failing assertions for:
  - token lookup with explicit connector instance ID plus audience/profile method arguments
  - delegated relative URL and `label_key` retention
  - required secure-cookie and shared-session config invariants
  - popup message rejection when origin/source are invalid

Commands:

```bash
python -m pytest tests/backend/auth/test_token_store_connector_id_audience.py -q
python -m pytest tests/backend/data_connector/test_delegated_relative_url_and_label_key.py -q
python -m pytest tests/backend/security/test_session_security_config.py -q
yarn test tests/frontend/unit/features/connectors/fabric/fabric-popup-security.test.tsx
```

### Task 2: Introduce audience-aware token key contract in TokenStore

Paths:

- `py-src/data_formulator/auth/token_store.py`
- `tests/backend/auth/test_token_store_connector_id_audience.py`

Work:

- Refactor TokenStore APIs so storage and lookup take explicit `identity`, `connector_id`, and `audience` or `profile` parameters.
- Keep backward-compatible read fallback for existing session/vault entries during migration.
- Ensure DataConnector auth injection uses connector instance ID and requested audience.
- Add safe migration behavior tests (including legacy TokenStore entry fallback) and negative tests for cross-audience token reuse.

Commands:

```bash
python -m pytest tests/backend/auth/test_token_store_connector_id_audience.py -q
python -m pytest tests/backend/auth/ -q
```

### Task 3: Fix delegated login URL handling and label_key preservation

Paths:

- `py-src/data_formulator/data_connector.py`
- `tests/backend/data_connector/test_delegated_relative_url_and_label_key.py`

Work:

- Correct delegated config URL resolution so declared app-relative URLs (for example `/api/auth/...`) are not connector-prefixed.
- If app-relative URLs are not allowed globally, require an explicit safe `route_kind` contract and validate it.
- Preserve and return `label_key` in delegated auth config payload.
- Add regression tests for absolute and relative delegated URLs.

Commands:

```bash
python -m pytest tests/backend/data_connector/test_delegated_relative_url_and_label_key.py -q
python -m pytest tests/backend/data_connector/ -q
```

### Task 4: Add shared Fabric auth gateway with strict state binding

Paths:

- `py-src/data_formulator/auth/gateways/fabric_auth.py`
- `py-src/data_formulator/auth/gateways/__init__.py`
- `py-src/data_formulator/app.py`
- `tests/backend/auth/test_fabric_auth_gateway.py`

Work:

- Implement server-side auth code flow endpoints for Fabric delegated consent.
- Define resource profile for Fabric audience `https://api.fabric.microsoft.com` with OAuth request scopes:
  - `https://api.fabric.microsoft.com/Workspace.Read.All`
  - `https://api.fabric.microsoft.com/Item.Read.All`
- Keep API permission display names (`Workspace.Read.All`, `Item.Read.All`) only for UI copy and audit logging labels.
- Bind state to identity, connector_id, audience, and allowed origin.
- Validate connector exists and is visible to the requesting identity before initiating delegated login.
- Enforce exact origin allowlist on callback and popup completion.
- Return token-free popup success payload and rely on server session token storage.
- Persist refresh token only if full refresh path is implemented in this task set. Otherwise do not store it.

Commands:

```bash
python -m pytest tests/backend/auth/test_fabric_auth_gateway.py -q
python -m pytest tests/backend/auth/ -q
```

### Task 5: Add shared Fabric REST client for discovery only

Paths:

- `py-src/data_formulator/integrations/fabric/fabric_client.py`
- `py-src/data_formulator/integrations/fabric/__init__.py`
- `tests/backend/data/test_fabric_client.py`

Work:

- Implement workspace listing method using `GET https://api.fabric.microsoft.com/v1/workspaces`.
- Implement item listing method using `GET /v1/workspaces/{workspaceId}/items`.
- Implement continuation pagination handling for `continuationToken` and `continuationUri`.
- Implement bounded 429 retry with `Retry-After` support and max-attempt cap.
- Ensure request and error logs use sanitization utilities and never include bearer token or raw response body.

Commands:

```bash
python -m pytest tests/backend/data/test_fabric_client.py -q
python -m pytest tests/backend/data/ -q
```

### Task 6: Expose discovery endpoints in connector/catalog surface

Paths:

- `py-src/data_formulator/data_connector.py`
- `tests/backend/routes/test_fabric_workspace_discovery_routes.py`

Work:

- Add connector-facing endpoints for:
  - list Fabric workspaces
  - list Fabric items for selected workspace
- Enforce discovery-only semantics in this plan.
- Return normalized metadata usable by follow-up Lakehouse and Semantic Model plans.
- Map errors through unified error handler helpers and do not leak raw upstream payloads.

Commands:

```bash
python -m pytest tests/backend/routes/test_fabric_workspace_discovery_routes.py -q
python -m pytest tests/backend/routes/ -q
```

### Task 7: Harden production session and secret prerequisites for ACA

Paths:

- `py-src/data_formulator/app.py`
- `infra/modules/containerapp.bicep`
- `pyproject.toml`
- `tests/backend/security/test_session_security_config.py`

Work:

- Run a backend decision/spike for a Redis-compatible server-side session backend for multi-replica ACA, then implement the selected dependency and config path.
- Enforce `SESSION_COOKIE_SECURE=True` for production profile.
- Replace deterministic secret behavior with high-entropy secret configuration path.
- Add tests and deployment checks that fail fast when insecure config is detected.
- Add tests that prohibit production fallback to local or in-memory instance-local session storage.

Commands:

```bash
python -m pytest tests/backend/security/test_session_security_config.py -q
python -m pytest tests/backend/security/ -q
```

### Task 8: Frontend workspace and item picker with popup hardening

Paths:

- `src/features/connectors/fabric/FabricWorkspacePicker.tsx`
- `src/features/connectors/fabric/fabricApi.ts`
- `src/features/connectors/fabric/useFabricAuthPopup.ts`
- `src/i18n/locales/en/loader.json`
- `src/i18n/locales/zh/loader.json`
- `src/i18n/locales/en/common.json` and `src/i18n/locales/en/errors.json` as needed
- `src/i18n/locales/zh/common.json` and `src/i18n/locales/zh/errors.json` as needed
- `tests/frontend/unit/features/connectors/fabric/fabric-workspace-picker.test.tsx`
- `tests/frontend/unit/features/connectors/fabric/fabric-popup-security.test.tsx`

Work:

- Add workspace picker and item picker UI for discovery only.
- Implement popup listener checks for exact `event.origin` and expected `event.source`.
- Handle token-free popup success completion via backend status refresh.
- Add all new user-visible text through i18n keys in both English and Chinese.

Commands:

```bash
yarn test tests/frontend/unit/features/connectors/fabric/fabric-popup-security.test.tsx
yarn test tests/frontend/unit/features/connectors/fabric/fabric-workspace-picker.test.tsx
yarn test
```

### Task 9: Document discovery contract and downstream dependencies

Paths:

- `docs/dev-guides/3-data-loader-development.md`
- `docs/dev-guides/4-authentication-oidc-tokenstore.md`
- `docs/dev-guides/7-unified-error-handling.md`
- `docs/dev-guides/2-log-sanitization.md`
- `docs/plans/2026-07-09-fabric-workspaces.md`

Work:

- Document that Fabric workspace and item discovery is shared infrastructure and not generic tabular import.
- Record the audience-aware token key contract.
- Record the Fabric audience profile and delegated scope policy.
- Record security prerequisites required before enabling Fabric auth in production.

Commands:

```bash
python -m pytest tests/backend/ -q
yarn test
```

## Quality Attribute Gates

This plan is gated by shared release-blocking requirements in
`docs/plans/2026-07-09-connector-implementation-requirements.md`:

- SIMPLE-001 through SIMPLE-006
- ROBUST-001 through ROBUST-008
- PERF-001 through PERF-008

Fabric workspace discovery specific quality criteria (excluding user
think-time and interactive IdP or MFA time):

- First workspace page response MUST be <= 2 seconds p95 in a representative
  environment.
- Item page response MUST be <= 3 seconds p95 in a representative environment.
- First catalog page MUST be bounded to <= 200 nodes unless the upstream API
  enforces a lower limit.
- Continuation-cycle detection and page caps MUST terminate pagination
  deterministically.
- Discovery MUST use one shared Fabric client implementation.
- Discovery MUST NOT perform eager all-item metadata enrichment.

## Acceptance Criteria

Discovery foundation is accepted when all items are true:

- User can complete delegated consent for Fabric with least-privilege scopes and no token leakage to frontend.
- Backend can list workspaces and workspace items using Fabric REST with bounded pagination and retry behavior.
- Connector and auth contracts are fixed for connector-instance identity plus audience keying.
- Production profile enforces shared server-side session backend, secure cookie, high-entropy secret, and no instance-local session fallback.
- Frontend popup flow validates origin and source.
- Logs and error responses are sanitized.
- Shared quality gates SIMPLE-001 through SIMPLE-006,
  ROBUST-001 through ROBUST-008, and PERF-001 through PERF-008 are satisfied
  per `docs/plans/2026-07-09-connector-implementation-requirements.md`.
- The DF-017 quality evidence reports pass with no unapproved exceptions:
  `docs/plans/evidence/df-017-fabric-workspaces-quality-report.json` and
  `docs/plans/evidence/df-017-fabric-workspaces-quality-report.md`.

Non-goal for this plan:

- Importing Lakehouse tables or Semantic Model datasets into workspace storage.

Discovery success does not imply import support. Import is owned by the Lakehouse and Semantic Model plans.

## Dependencies for Follow-up Plans

This plan produces reusable dependencies consumed by both follow-up plans:

- Shared Fabric REST client and retry/pagination behavior.
- Shared delegated auth gateway and audience profile registry.
- Audience-aware TokenStore key contract for connector instances.
- Workspace and item picker UX primitives.

Lakehouse plan dependency expectations:

- Reuse workspace and item discovery to select Lakehouse/OneLake catalog targets.
- Reuse delegated Fabric token acquisition and audience profile.

Semantic Model plan dependency expectations:

- Reuse workspace and item discovery to filter Semantic Model items.
- Reuse delegated Fabric token acquisition and audience profile.

## Falsifiers

This plan is falsified if any of the following occurs:

- Workspace discovery is implemented through a generic ExternalDataLoader that treats arbitrary items as tabular import targets.
- Fabric token lookup still depends on loader type and cannot disambiguate connector instance plus audience.
- Delegated flow still accepts popup messages without strict origin and source checks.
- Production deployment on ACA 2 to 3 replicas cannot maintain stable delegated session state.
- Logs include any bearer token, refresh token, or unsanitized upstream response payload.
- 429 handling retries without bound or ignores `Retry-After`.

## Microsoft Learn References

- [List Workspaces](https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces)
- [List Items](https://learn.microsoft.com/rest/api/fabric/core/items/list-items)
- [Fabric Scopes](https://learn.microsoft.com/rest/api/fabric/articles/scopes)
- [OneLake Catalog Overview](https://learn.microsoft.com/rest/api/fabric/articles/onelakecatalog/overview)
