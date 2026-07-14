# Session Handoff

**Last updated**: 2026-07-14

## Governed MCP Gateway

- The local gateway foundation is implemented and validated: profile contract,
  stateless FastMCP health surface, profile registry, dedicated-caller JWT
  verifier, FastMCP token adapter, approval gate, late-result barrier, exact
  upstream tool-drift check, gateway image, and feature-gated internal gateway
  IaC.
- Local MCP gateway plus connector framework validation: 124 tests passed.
  Root Bicep and parameters compile with `enableMcpGateway=false`; no gateway
  Container App, identity, or other Azure resource has been deployed.
- A dedicated single-tenant gateway Entra resource application, delegated
  `access_as_user` scope, and tenant service principal exist. The existing Data
  Formulator client requests that scope.
- Current blocker: tenant-wide consent for the gateway scope requires an Entra
  administrator. The current identity can create app resources but received an
  administrator-only authorization denial when it attempted consent.
- Fabric access exists, but the checked personal workspace has no OneLake
  items. A Fabric owner must nominate a non-sensitive data-agent or ontology
  fixture and a matching direct comparison source.
- Resume from `docs/plans/2026-07-14-governed-mcp-adapter-tracker.md` and
  `docs/plans/2026-07-14-internal-mcp-gateway-provisioning.md`. Do not enable
  the gateway or run an infrastructure preview until consent and fixture-owner
  prerequisites are satisfied.

## Azure SQL Connector Deployment

- Production revision `ca-dataformulator--azd-1784046335` is healthy at 100%
  traffic.
- Image: `azd-deploy-1784045589` from runtime source commit `f960263`.
- Public discovery exposes distinct `mssql` (credentials) and `azure_sql`
  (delegated Microsoft Entra) connector types.
- Entra application `Data Formulator GCX DEV` is configured with the production
  callback, Azure SQL delegated permission, and secretless managed-identity
  federation to `id-dataformulator`.
- Live OAuth preparation verified the Microsoft tenant, client ID, Azure SQL
  `.default` scope, exact callback, S256 PKCE, and state. The disposable
  connector was deleted afterward.
- Remaining: complete interactive consent/MFA against
  `cpestaging.database.windows.net` / `CPE_Predictor`, then address
  restart-ephemeral delegated-token sessions.
- Current blocker: Microsoft Entra shows **Need admin approval** because tenant
  user-consent policy blocks this new app. No permission grant exists yet. A
  Cloud Application Administrator or Application Administrator must grant
  tenant-wide consent once for Azure SQL `user_impersonation` on app client ID
  `7cced1c1-4eb6-4adb-a149-9874baab45b0`.
- DF-020, DF-021, DF-024, and DF-025 are deployed: ODBC connection values are
  hardened, the eight-state OAuth limit is isolated per signed browser session,
  Example Datasets initializes on first use, and Azure OpenAI calls have bounded
  timeout/retry/stream behavior on LiteLLM 1.91.1.
- Azure CLI is scoped to the Microsoft tenant, but the signed-in identity has
  no active direct or transitive Entra directory role and cannot grant consent.

## Current State

- The deployed runtime source baseline is `f960263` on `main`. Later Agency and
  documentation commits do not change the product image.
- `f960263` resolves the built-in no-auth connector lifecycle defect (DF-024)
  and bounds Azure OpenAI/LiteLLM timeouts, retries, streaming, and dependency
  versions (DF-025); both are production-verified.
- `11dfb1f` adds stale browser-workspace reconciliation and removes startup
  console/preload noise; `95465e1` records the meeting and architecture package.
- PR #376 is open and its CLA check passes.
- The stale `yarn.lock` fix is `4e185e9`.
- `docs/plans/ISSUES.md`, titled Data Formulator Audit and Change Log, contains the validated audit findings and operations record.

## Last Verified Production State

- Resource group: `rg-data-formulator`
- Revision: `ca-dataformulator--azd-1784046335`
- Image: `azd-deploy-1784045589`
- Image digest: `sha256:34755ba63b62236cf2bb023a00c9b9cae6a89acf361fff5cef8041c17cbbf482`
- Domain: `data.gcxteam.com`
- `gpt-5.4-mini`: connected, 260K TPM, default model
- `gpt-5.4-nano`: connected, 2.009M TPM
- `gpt-5.4`: connected, 260K TPM
- All three production models pass connectivity checks.
- The managed Pro deployment was deleted. Its quota use is 0 of 160.
- The cross-subscription custom domain and managed TLS certificate are healthy.
- The immediate rollback image is `recreate-11dfb1fd3d3c` from `11dfb1f`.
- Live state was verified directly; it does not imply that every committed Bicep declaration has been applied as a full deployment.

## Initial Publication Scope

The 2026-07-09 publication included these pre-existing working-tree changes:

- `.vscode/settings.json` (unrelated user change; preserve)
- `MANIFEST.in`
- `infra/modules/containerapp.bicep`
- `infra/modules/openai.bicep`
- `py-src/data_formulator/agent_config.py`
- `py-src/data_formulator/agents/client_utils.py`
- `py-src/data_formulator/app.py`
- `py-src/data_formulator/error_handler.py`
- `py-src/data_formulator/routes/agents.py`
- `py-src/data_formulator/routes/tables.py`
- `py-src/data_formulator/security/sanitize.py`
- `tests/backend/agents/test_client_image_strip.py`
- `tests/backend/agents/test_client_utils.py`
- `tests/backend/security/test_global_model_security.py`

The same publication added:

- `docs/plans/ISSUES.md`
- `tests/backend/agents/test_agent_config.py`
- `tests/backend/test_static_mime_types.py`
- `.github/episodic/INDEX.md`
- `.github/episodic/meditation-2026-07-09-azure-production-hardening.md`
- `HANDOFF.md`

## Validation Completed

- Bicep compilation completed with zero diagnostics.
- Python `compileall` completed successfully.
- Editor diagnostics are clean for the reviewed changes.
- `git diff --check` passed.
- Markdown lint passed.
- Browser and API checks confirmed demo assets, the custom domain, and all three production models.
- Audit remediation matrix: 143 backend tests passed without warnings.
- Delegated popup frontend suite: 7 tests passed.
- Production frontend build completed successfully with existing bundle-size
  and dynamic-import warnings only.
- Full backend suite: 2,032 passed and 13 skipped.
- Full frontend suite: 35 files and 277 tests passed.
- Five Flask-Session signer deprecation warnings remain and are tracked as
  DF-022; removing the setting without migration would invalidate active
  signed session cookies.
- Touched frontend ESLint and the production build pass. Existing bundle-size
  and dynamic-import build warnings remain.
- The obsolete `.github-backup-20260713-212145/` directory was deleted after
  all 202 files were proven recoverable as exact Git blobs; heir-doctor remains
  healthy.
- The Container App was fully deleted and recreated from app-only Bicep.
  Revision `7z7e3f1` is healthy with one ready replica and 100% traffic.
  Prior revisions were removed by deletion; rollback requires recreating the
  app with the retained prior ACR image `azd-deploy-1783998754`.
- Both the generated FQDN and `data.gcxteam.com` return HTTP 200 for HEAD and
  GET. `/api/data-loaders` returns HTTP 200 and exposes distinct `mssql` and
  `azure_sql` types.
- The deployed container lists ODBC Driver 18, preserves the user-assigned
  managed identity and all three `AZURE_SQL_ENTRA_*` configuration keys, and
  recent logs contain no traceback, error, critical, or unhandled match.
- A disposable production connector verified the Microsoft tenant endpoint,
  exact public HTTPS callback, Azure SQL `.default` scope, S256 PKCE, state,
  and challenge; cleanup left no smoke connector behind.
- The 2026-07-14 reset prebuilt a clean image from commit `11dfb1f`, deleted
  only `ca-dataformulator`, and recreated it against the existing environment,
  certificate, identity, ACR, OpenAI, monitoring, and network resources. The
  custom and generated endpoints return HTTP 200; fresh sessions contain no
  user connectors or workspaces; production browser reload has zero console
  messages and zero failed requests.
- The subsequent code-only rollout deployed `f960263` as revision
  `azd-1784046335` on image `azd-deploy-1784045589`. One ready replica has zero
  restarts and 100% traffic; the domain, managed identity, environment, port,
  one-replica cap, and Azure SQL settings remain unchanged.
- DF-024 production smoke returned 16 Example Datasets catalog nodes. The
  deployed container reports LiteLLM 1.91.1 and ODBC Driver 18. All three Azure
  models are connected; non-streaming GPT-5.4 Mini and streaming tool-enabled
  requests succeeded, with the latter producing `STREAM_OK` and no error/tool
  events. Disposable smoke workspaces were removed.
- Browser reload on the new revision has zero console messages, failed
  requests, or HTTP error responses. Startup logs are clean. One malformed
  smoke fixture omitted `X-Workspace-Id` and logged a pre-agent `ValueError`;
  the corrected workspace-bound request passed.

## Pending Queue

1. Obtain tenant-wide Azure SQL delegated admin consent from an eligible Entra
  administrator and complete the interactive popup/MFA smoke test.
2. Select and implement an approved restart-durable shared session backend;
  keep one worker and one replica until that state is shared, and coordinate
  the DF-022 signer-cookie migration with that work.
3. Monitor PR #376 checks against the full backend and frontend results.

## Resume Point

Read these files before changing code:

- `HANDOFF.md`
- `docs/plans/2026-07-14-chenglong-adaptation-meeting.md`
- `docs/plans/ISSUES.md`
- `docs/plans/2026-07-13-audit-remediation.md`
- `/memories/repo/azd-deployment-gotchas.md`
- `docs/dev-guides/9-workspace-storage-architecture.md`

For continued implementation, resume Entra admin consent and the DF-022
session-cookie migration strategy. DF-020, DF-021, DF-024, DF-025, both full
test suites, independent maintainer reviews, and production revision
`azd-1784046335` are green; do not rewrite their tests merely to change
implementation behavior.

Before merging PR #376, confirm its current CI checks and reconcile any
upstream changes added after baseline `00d0f5e`.

## Safety Notes

- Do not run `azd provision` by itself. It can reset the Container App image to a placeholder.
- Use `azd deploy web` for code-only releases.
- After every deployment, verify the live image and revision.
- Preserve `raiPolicyName` on Azure OpenAI model writes.
- Run a what-if operation before applying live infrastructure changes.
- Preserve the healthy custom domain and managed TLS binding.
- Preserve the unrelated `.vscode/settings.json` user change.
- Active Owner PIM is required for Container App writes.
- Do not recreate the Pro deployment without explicit cost approval.
- Keep the generic Pro compatibility code and tests unless a source-level review proves they are no longer valid.
