# Retire Azure SQL Microsoft Entra Connector Implementation Plan

**Goal:** Remove the unusable delegated Microsoft Entra Azure SQL connector while retaining the credential-based SQL Server connector.

**Architecture:** The `azure_sql` loader and its OAuth gateway are an isolated surface over the MSSQL ODBC data plane. Remove their registration, routes, configuration, tests, localization, and Container Apps inputs. Keep `MSSQLDataLoader` and all credential and Windows-authentication behavior. Do not delete the Entra app, permission grant, or managed-identity federation because their ownership and reuse have not been verified.

**Tech Stack:** Python, Flask, pytest, React, react-i18next, Bicep, Azure Container Apps, azd.

---

## Current Context

- `azure_sql` is separately registered beside `mssql`; `mssql` is credentials-only and does not use delegated OAuth.
- `/api/auth/azure-sql/*` supports only `azure_sql` and reads `AZURE_SQL_ENTRA_*` settings.
- Container Apps receives those three settings only for this feature.
- The production revision is recorded as carrying them. The read-only Azure Resource Graph query failed, so validate live state during preview and after deployment instead of assuming it.

## Scope And Non-Goals

In scope: remove feature discovery, OAuth routes, deployment settings, tests, localized text, icon metadata, and current operator documentation.

Out of scope: delete the Microsoft Entra application, delegated SQL permission, service principal, federated credential, or user-assigned managed identity. Those resources may be shared and need an identity-owner decision.

## Task 1: Specify The Retired Discovery Contract

**Objective:** Pin that generic SQL Server remains registered while delegated Azure SQL does not.

**Files:**

- Modify: `tests/backend/data/test_mssql_auth.py`

1. Remove `AzureSQLDataLoader` imports and tests, then replace the dual-loader assertion with:

```python
class TestSQLLoaderRegistry:
    def test_generic_sql_server_remains_registered_without_azure_sql_entra(self):
        assert DATA_LOADERS["mssql"] is MSSQLDataLoader
        assert "azure_sql" not in DATA_LOADERS
```

1. Run `python -m pytest tests/backend/data/test_mssql_auth.py -q`.

Expected: failure only because `azure_sql` remains registered. Capture this before changing implementation.

## Task 2: Remove The Delegated Backend Surface

**Objective:** Stop exposing the MFA-dependent loader and OAuth callback.

**Files:**

- Delete: `py-src/data_formulator/data_loader/azure_sql_data_loader.py`
- Delete: `py-src/data_formulator/auth/gateways/azure_sql_gateway.py`
- Delete: `tests/backend/auth/test_azure_sql_gateway.py`
- Modify: `py-src/data_formulator/data_loader/__init__.py`
- Modify: `py-src/data_formulator/app.py`

1. Delete the `azure_sql` tuple from `_LOADER_SPECS`.
1. Remove the Azure SQL gateway import and Blueprint registration.
1. Preserve the `mssql` loader, generic auth-token Blueprint, and global OIDC gateway.
1. Run `python -m pytest tests/backend/data/test_mssql_auth.py tests/backend/data/test_data_connector_framework.py -q`.

Expected: both tests pass, with `mssql` available and no `azure_sql` key.

## Task 3: Remove Client Metadata

**Objective:** Ensure a retired connector cannot appear from stale client data.

**Files:**

- Modify: `src/i18n/locales/en/loader.json`
- Modify: `src/i18n/locales/zh/loader.json`
- Modify: `src/icons.tsx`
- Modify if type-specific expectations exist: `src/views/UnifiedDataUploadDialog.tsx`
- Modify if type-specific expectations exist: `tests/frontend/unit/icons.test.tsx`
- Modify if type-specific expectations exist: `tests/frontend/unit/views/delegatedLoginMessage.test.ts`

1. Delete only `loader.azure_sql` from both locale files.
1. Remove the `azure_sql` icon mapping and any assertion that requires it.
1. Preserve generic delegated-login handling because other connectors can use it.
1. Run affected Vitest files, then `yarn test`.

## Task 4: Retire Container Apps Configuration Inputs

**Objective:** Stop supplying unused delegated-auth settings on the next deployment.

**Files:**

- Modify: `infra/main.bicep`
- Modify: `infra/modules/containerapp.bicep`
- Modify: `infra/main.bicepparam`
- Modify: `infra/README.md`

1. Remove `azureSqlEntraTenantId` and `azureSqlEntraClientId` parameters and module wiring.
1. Remove their conditional `AZURE_SQL_ENTRA_*` Container App environment-variable block.
1. Keep the user-assigned identity because ACR pulls and Azure OpenAI also use it.
1. Remove retired delegated-auth and OAuth callback instructions from `infra/README.md`.
1. Retain the Driver 18 note only if `mssql` still needs it after verifying the Dockerfile dependency path.
1. Compile both Bicep files with `az bicep build --file infra/main.bicep --stdout | Out-Null` and `az bicep build-params --file infra/main.bicepparam --stdout | Out-Null`.

## Task 5: Reconcile Documentation And Validate

**Objective:** Remove active claims while preserving historical implementation evidence.

**Files:**

- Modify: `docs/dev-guides/4-authentication-oidc-tokenstore.md`
- Modify: `docs/plans/2026-07-09-azure-sql-entra-mfa.md`
- Modify: `HANDOFF.md`

1. Remove the Azure SQL environment-variable section from the active authentication guide.
1. Add a concise retirement status note to the historical implementation plan; retain its dated evidence.
1. Replace the handoff's MFA/admin-consent blocker with the retirement decision and explicit retention of external Entra resources pending ownership review.
1. Search with `rg -n "azure_sql|AZURE_SQL_ENTRA|/api/auth/azure-sql" py-src src tests infra README.md docs`.

Expected: only intentionally retained historical evidence and the retirement note remain. Review every result.

1. Run `python -m pytest tests/backend/data/test_mssql_auth.py tests/backend/data/test_data_connector_framework.py -q`, `yarn test`, and `git diff --check`. Run editor diagnostics for every touched file and resolve all findings.

## Task 6: Preview And Deploy Separately

**Objective:** Apply source and IaC removal without deleting external identity resources or changing unrelated production properties.

1. Build and run the image locally when Docker is available. Verify `GET /api/data-loaders` excludes `azure_sql` and retains `mssql`.
1. Run `azd provision --preview` or the documented subscription `what-if` with the current production image. Inspect all `Modify` deltas, especially the Container App environment list, custom domain, image, traffic, replica cap, VNet, and policy-governed resources.
1. Present the preview and obtain explicit approval before production deployment.
1. After deployment, verify the custom domain and revision are healthy, the three `AZURE_SQL_ENTRA_*` settings are absent, and product discovery retains `mssql`.

## Risks And Rollback

- Saved user connectors of type `azure_sql` will not resolve after deployment. Announce the retirement; automatic migration is not possible because the replacement uses different credentials.
- Source removal intentionally leaves the Entra application and permissions in place. Delete those only after an identity-owner review confirms no reuse.
- Roll back by redeploying the immediately preceding image and IaC revision. Do not restore Entra permissions without authorization.

## Decision Gate

Tasks 1-5 require confirmation that source-level removal is desired. Task 6 requires separate production-deployment approval after review of the IaC preview. <!-- end -->
