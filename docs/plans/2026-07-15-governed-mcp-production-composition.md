# Governed MCP Production Composition Plan

**Status:** Accepted for local implementation. Nothing in this plan is shipped
yet.

## Goal

Complete the locally testable approval expiry, delegated-token, startup, and
deployment-configuration paths without deploying resources or accessing tenant
content.

## Architecture

Keep approvals process-local with a fixed 15-minute TTL and require one gateway
replica. Acquire the gateway token only at request time through Microsoft Entra
OAuth 2.0 on-behalf-of (OBO), cache it only under the exact governed connector
and gateway audience, then compose the existing manifest-bound product client
during Data Formulator startup. Startup remains network-free, and all runtime
activation is configuration-gated and fail-closed.

## Locked Decisions

| Decision | Selected behavior | Notes |
| --- | --- | --- |
| Approval TTL | 15 minutes | Inject a monotonic clock and clean up expired entries without racing live confirmations |
| Expired, restarted, unknown, denied, consumed, other-subject IDs | Generic unavailable response | Do not reveal whether an operation ID existed or was already decided |
| Process-local state | Single replica and fail closed otherwise | Runtime configuration and IaC must reject a contradictory ownership mode |
| OBO exchange | Request-time Microsoft Entra OBO from signed-in user assertion | Use the caller assertion as input, not a pre-minted downstream token |
| Token cache | Exact connector plus gateway-audience lookup | No fallback to legacy tokens or audience guesses |
| Startup composition | Existing manifests and client only | No startup network calls, approval prompts, or runtime discovery |
| Infra default | `enableMcpGateway=false` | Disabled until the gated Bicep phase is explicitly approved |

## Files Likely To Change

| File | Reason |
| --- | --- |
| `py-src/data_formulator/mcp_gateway/approval.py` | TTL, cleanup, and generic-unavailable mapping |
| `py-src/data_formulator/mcp_gateway/service.py` | Coordinator expiry and restart behavior |
| `py-src/data_formulator/mcp_gateway/token_provider.py` | Request-time OBO exchange and exact-audience cache |
| `py-src/data_formulator/mcp_gateway/composition.py` | Fail-closed runtime composition |
| `py-src/data_formulator/mcp_gateway/bootstrap.py` | Startup composition and contradictory-config failures |
| `py-src/data_formulator/mcp_gateway/product_client.py` | Startup-owned fixed-operation client wiring |
| `py-src/data_formulator/app.py` | Production bootstrap composition and fail-closed startup checks |
| `tests/backend/mcp/test_gateway_approval.py` | TTL, expiry, race, and restart-fail-closed coverage |
| `tests/backend/mcp/test_gateway_service.py` | Coordinator expiry and restart behavior |
| `tests/backend/mcp/test_gateway_app.py` | Fresh-instance route behavior |
| `tests/backend/mcp/test_governed_gateway_token_provider.py` | OBO assertion modes and safe errors |
| `tests/backend/mcp/test_governed_mcp_composition.py` | Runtime configuration and dependency construction |
| `tests/backend/mcp/test_governed_mcp_bootstrap.py` | No startup network calls and contradictory-config failures |
| `tests/backend/mcp/test_governed_product_client.py` | Cache lookup and startup composition coverage |
| `tests/backend/test_app_governed_mcp_startup.py` | Production startup integration seam |
| `infra/main.bicep` and `infra/main.bicepparam` | Disabled-by-default configuration |
| `infra/modules/containerapp.bicep` | Public-app identity, endpoint, and manifest mounts |
| `infra/modules/mcp-gateway.bicep` | Gateway TTL and single-replica contract |
| `tests/backend/infrastructure/test_mcp_gateway_configuration.py` | Structural configuration contract |
| `infra/README.md` | Operator configuration and inactive defaults |

## Ordered TDD Tasks

1. Add TTL and cleanup tests.
   - Prove 15-minute expiry with an injected monotonic clock.
   - Prove success immediately before the deadline and generic unavailability
     at or after it.
   - Prove approve, deny, consume, and confirm-and-consume purge expired state.
   - Prove cleanup cannot race a live confirmation or denial.
   - Implement `ttl_seconds=900`, an injectable monotonic clock, and
     lock-protected purging in `approval.py` and `service.py`.

2. Add restart fail-closed tests.
   - Prove a fresh gate and coordinator cannot confirm a pre-restart operation.
   - Prove the route returns the same unavailable response as an unknown ID.
   - Prove restart never constructs or calls an upstream client.

3. Add OBO provider tests.
   - Reuse an existing exact connector-and-audience token without exchange.
   - On a cache miss, obtain the current user assertion from TokenStore and send
     the required `jwt-bearer`, `requested_token_use=on_behalf_of`, and
     `{audience}/access_as_user` fields.
   - Cover client-secret and managed-identity assertion modes.
   - Reject missing assertions, incomplete or contradictory configuration,
     timeouts, non-success responses, malformed JSON, and missing access tokens
     without logging credentials, tokens, response bodies, or query strings.
   - Store only the access token and expiry under the exact connector and
     audience; do not store a refresh token.

4. Add startup composition tests.
   - No manifests must be a network-free no-op.
   - Partial manifests, missing endpoint/audience/OBO configuration, profile
     endpoint or audience drift, and any approval-state mode other than
     `process-local-single-replica` must fail before registration.
   - Build the token provider, SDK transport, and product client, then call the
     existing profile-before-source bootstrap.
   - Invoke composition once from normal connector startup. Contradictory
     `DISABLE_DATA_CONNECTORS=true` plus governed manifests must fail.

5. Add disabled-by-default infrastructure tests.
   - Prove both public app and gateway remain one replica.
   - Supply `MCP_GATEWAY_APPROVAL_TTL_SECONDS=900` and
     `MCP_GATEWAY_APPROVAL_STATE_MODE=process-local-single-replica`.
   - Mount profile and source manifests as secret-volume files under
     `/mnt/governed-mcp/`.
   - Derive the internal endpoint without a circular module dependency.
   - Pass the web app managed-identity client ID for OBO; do not add a client
     secret to source control.
   - Preserve `enableMcpGateway=false` and require complete parameters when
     enabled.

6. Run full regression and record evidence.
   - Run focused MCP, auth, governed-loader, connector, and infrastructure
     suites, then the full MCP suite.
   - Compile changed Python files and build Bicep entry points.
   - Review exact audience isolation, token-safe errors, startup network
     isolation, generic expiry/restart behavior, admin-only loader registration,
     inactive infrastructure, and replica caps.
   - Update trackers only with measured evidence.

## Validation Commands

```powershell
.\.venv\Scripts\python.exe -m pytest tests\backend\mcp -q

.\.venv\Scripts\python.exe -m pytest tests\backend\auth\test_token_store.py tests\backend\auth\test_token_store_connector_id_audience.py -q

.\.venv\Scripts\python.exe -m pytest tests\backend\data\test_mcp_governed_data_loader.py tests\backend\data\test_data_connector_framework.py tests\backend\data\test_all_loader_verification.py -q

.\.venv\Scripts\python.exe -m pytest tests\backend\infrastructure -q

git diff --check
```

Build `infra/main.bicep` and `infra/main.bicepparam` with the repository's
existing Bicep tooling. Do not provision, preview, deploy, or access tenant
content in this implementation.

## Risks And Falsifiers

| Risk | Falsifier | Response |
| --- | --- | --- |
| TTL cleanup races with confirm or deny | A concurrent test shows double consume or a leaked pending record | Keep cleanup and transition checks under one lock, then release before any upstream call |
| Startup performs a hidden network call | A boot test or trace shows a tenant, Fabric, or gateway request during startup | Push all network access behind explicit request paths and fail closed on contradictions |
| OBO accepts a bad user assertion | A malformed or mismatched assertion yields a token or leaks detail | Return a safe error and never fall back to a guessed identity |
| Disabled-by-default infra is accidentally enabled | A build or structural test shows `enableMcpGateway=true` or more than one replica | Keep the default disabled until approval exists |
| Multi-replica deployment loses approvals | A restart or replica switch drops an approval or token mapping | Keep process-local state single-replica until a shared-state design is approved |

## Explicit Non-Goals

- No gateway deployment in this plan.
- No tenant-wide consent in this plan.
- No Fabric call or source-paired fixture execution in this plan.
- No bulk Arrow path in this plan.
- No direct-versus-MCP comparison in this plan.
- No Azure SQL changes in this plan.
- No startup network calls in this plan.

## External Gates That Stay Open

The offline TDD sequence above may proceed without these gates. They must be
closed before the corresponding tenant, infrastructure, or live-validation
step.

- Tenant-wide Entra consent for the dedicated gateway scope.
- Named MCP operations owner, Fabric fixture owner, and enterprise security
  reviewer.
- Approved source-paired Fabric fixture.
- Infrastructure preview and deployment authorization.
- Live upstream validation and direct-versus-MCP comparison.
- Approved bounded Arrow or governed-handle data path.
