# Session Handoff

**Last updated**: 2026-07-13

## Azure SQL Connector Deployment

- Production revision `ca-dataformulator--0000010` is healthy at 100% traffic.
- Image: `azd-deploy-1783998754` from source commit `ebada59`.
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
- DF-020 and DF-021 are deployed: ODBC connection values are hardened and the
  eight-state OAuth limit is isolated per signed browser session.
- Azure CLI is scoped to the Microsoft tenant, but the signed-in identity has
  no active direct or transitive Entra directory role and cannot grant consent.

## Current State

- Current local and `origin/main` baseline is `e98ee0f` on `main`.
- Runtime source commit `ebada59` is deployed; `e98ee0f` records that rollout
  and tightens Docker build-context exclusions.
- PR #376 is open and its CLA check passes.
- The stale `yarn.lock` fix is `4e185e9`.
- Preserve the unrelated, untracked paper archives in the workspace.
- `docs/plans/ISSUES.md`, titled Data Formulator Audit and Change Log, contains the validated audit findings and operations record.

## Last Verified Production State

- Resource group: `rg-data-formulator`
- Revision: `ca-dataformulator--0000010`
- Image: `azd-deploy-1783998754`
- Image digest: `sha256:a216e301adda980429fb5dbb6296ee44a9fa7ecadbbb4992369f6d2b89438123`
- Domain: `data.gcxteam.com`
- `gpt-5.4-mini`: connected, 260K TPM, default model
- `gpt-5.4-nano`: connected, 2.009M TPM
- `gpt-5.4`: connected, 260K TPM
- All three production models pass connectivity checks.
- The managed Pro deployment was deleted. Its quota use is 0 of 160.
- The cross-subscription custom domain and managed TLS certificate are healthy.
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
- Full backend suite: 2,023 passed and 13 skipped.
- Full frontend suite: 33 files and 271 tests passed.
- Five Flask-Session signer deprecation warnings remain and are tracked as
  DF-022; removing the setting without migration would invalidate active
  signed session cookies.
- Touched frontend ESLint and the production build pass. Existing bundle-size
  and dynamic-import build warnings remain.
- The obsolete `.github-backup-20260713-212145/` directory was deleted after
  all 202 files were proven recoverable as exact Git blobs; heir-doctor remains
  healthy.
- Revision `0000010` is healthy and provisioned with one ready replica, zero
  restarts, and 100% traffic. Revision `0000009` remains available at 0% for
  rollback.
- Both the generated FQDN and `data.gcxteam.com` return HTTP 200 for HEAD and
  GET. `/api/data-loaders` returns HTTP 200 and exposes distinct `mssql` and
  `azure_sql` types.
- The deployed container lists ODBC Driver 18, preserves the user-assigned
  managed identity and all three `AZURE_SQL_ENTRA_*` configuration keys, and
  recent logs contain no traceback, error, critical, or unhandled match.
- A disposable production connector verified the Microsoft tenant endpoint,
  exact public HTTPS callback, Azure SQL `.default` scope, S256 PKCE, state,
  and challenge; cleanup left no smoke connector behind.
- The first azd rollout attempt built the image but failed secret synchronization
  because the default role lacked `listSecrets`. Owner PIM was activated, then
  the already-built image was rolled out with a narrow Container App image
  update. No infrastructure provisioning ran.

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

For continued implementation, begin with Entra admin consent and the DF-022
session-cookie migration strategy. DF-020, DF-021, both full test suites,
independent maintainer reviews, and production revision `0000010` are green; do
not rewrite their tests merely to change implementation behavior.

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
