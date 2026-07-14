# Meditation: Azure SQL Delegated Authentication

**Date**: 2026-07-10 \
**Session focus**: Separate Azure SQL connector, delegated Microsoft Entra authentication, governed deployment, and production validation \
**Outcome**: The connector is deployed and its OAuth preparation path is verified. Tenant-wide admin consent and restart-durable delegated sessions remain open gates.

## Accomplished

- Restored the generic `mssql` connector to SQL and Windows authentication only.
- Added a distinct `azure_sql` connector that reuses the MSSQL catalog/query data plane while requiring a database, delegated token, ODBC Driver 18, encryption, and certificate validation.
- Added connector-specific Microsoft Entra configuration so Azure SQL sign-in does not activate Data Formulator's global OIDC login provider.
- Added S256 PKCE, connector/audience isolation, token-free popup completion, atomic state consumption, and session binding.
- Fixed the hosted anonymous flow: an identity-bearing API request prepares the Microsoft authorization URL, then a synchronously opened popup navigates to it. The external callback relies on the initiating Flask session rather than an `X-Identity-Id` header that Microsoft cannot send.
- Prevented delegated access tokens from remaining in loader instance parameters.
- Created a governed Microsoft Entra application with the required ServiceTree reference, exact production callbacks, and only Azure SQL delegated `user_impersonation` permission.
- Replaced prohibited client-secret authentication with a federated credential that trusts the Container App user-assigned managed identity.
- Deployed production image `azure-sql-20260710-1049` to revision `ca-dataformulator--0000009`; the revision is healthy at 100% traffic and contains ODBC Driver 18.
- Verified production discovery, OAuth tenant/client/scope/callback/PKCE/state fields, and cleanup of disposable smoke connectors.
- Created `AZURE-SQL-ADMIN-CONSENT.md` as the administrator handoff.

## Patterns Extracted

### Provider-specific OAuth must remain provider-specific

A service connector that needs Microsoft Entra must not automatically reuse the application's active OIDC provider. In this case, doing so would have changed production-wide access control merely to enable Azure SQL sign-in. Connector-specific environment variables and gateway configuration preserve the product boundary.

### Hosted anonymous popups need a two-stage launch

A popup navigation cannot carry custom identity headers, and an external identity provider cannot return them. The reliable pattern is:

1. Use the normal authenticated/identity-bearing API client to prepare state and obtain an authorization URL.
2. Open a blank popup synchronously during the user click to avoid popup blockers.
3. Navigate that popup after preparation completes.
4. Bind callback state to the same server session and verify origin/source on completion.

Mocking `get_identity_id()` in route tests can hide this production failure. Tests must include the real anonymous-header boundary.

### Directory governance and Azure RBAC are separate authorities

Subscription Owner allowed Container App writes but did not grant Entra admin consent or directory-role visibility. App creation also required a valid `serviceManagementReference`. Resolve directory governance independently from subscription authorization; never infer one from the other.

### Secret policy can improve the architecture

Tenant policy rejected client-secret creation. The correct response was not to bypass policy, but to use workload identity federation: the app trusts the user-assigned managed identity, and the runtime exchanges an `api://AzureADTokenExchange/.default` assertion as the confidential client credential. This removed credential storage and rotation entirely.

### App registration, federation, and delegated consent are separate gates

A correctly registered application with a valid federated credential can still show **Need admin approval**. `user_impersonation` is user-consent-capable, but tenant consent policy can require a Cloud Application Administrator or Application Administrator to grant it tenant-wide. Verify `oauth2PermissionGrants`; do not treat declared `requiredResourceAccess` as granted consent.

### Deployment completion needs independent evidence

`azd deploy web` exited after a long packing phase without starting an ACR run. The deterministic fallback was an explicit `az acr build`, followed by a targeted Container App image update. Build, image activation, readiness, traffic, and public behavior are separate checks.

## Mistakes And Corrections

- Initially planned to configure global `OIDC_*` values for Azure SQL. Source tracing showed this would activate application-wide authentication, so the design moved to `AZURE_SQL_ENTRA_*` settings.
- Initially assumed the popup could navigate directly to the app login route. Production anonymous identity requires `X-Identity-Id`, which `window.open()` cannot provide; the flow was redesigned around API preparation.
- Initially planned a client secret. Tenant policy rejected it, prompting the secretless managed-identity federation design.
- An attempted in-container base64 probe printed encoded script text because Container Apps exec quoting transformed the command. No secret was exposed, but the probe was abandoned in favor of validated route behavior and documented manual MFA completion.
- A disposable smoke connector survived the first cleanup because the wrong DELETE route shape was used. The path-based route removed it, and final verification reported zero temporary connectors.

## Validation Evidence

- Focused backend regression suite: 125 passed.
- Focused frontend suite: 9 passed.
- TypeScript, Python compilation, Bicep template/parameter compilation, editor diagnostics, and `git diff --check`: clean for touched files.
- Production revision `ca-dataformulator--0000009`: healthy, one ready replica, 100% traffic.
- Production image: `azure-sql-20260710-1049`.
- Public `/api/data-loaders`: distinct credential-only `mssql` and delegated `azure_sql`.
- Live authorization preparation: Microsoft tenant endpoint, expected client ID, Azure SQL `.default` scope, exact callback, S256 PKCE, and state.
- Entra application: zero password credentials and one managed-identity federated credential.

## Open Questions

- An eligible Entra administrator must grant tenant-wide Azure SQL delegated consent.
- After consent, complete the production MFA and catalog smoke against the approved staging database.
- Delegated tokens remain restart-ephemeral; keep one replica until session/token state is durable and shared.
- Decide whether the governed Entra application and federated credential should eventually be managed by an approved directory-IaC system rather than operational setup.

## Durable References

- `AZURE-SQL-ADMIN-CONSENT.md`
- `HANDOFF.md`
- `docs/plans/ISSUES.md` (`DF-016`)
- `docs/plans/2026-07-09-azure-sql-entra-mfa.md`
- `docs/dev-guides/4-authentication-oidc-tokenstore.md`
- `/memories/repo/azd-deployment-gotchas.md`
- `/memories/repo/project-conventions.md`
