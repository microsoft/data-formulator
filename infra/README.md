# Azure Infrastructure Deployment

The subscription-scoped Bicep template supports fresh environments and the
governed production environment. Production-specific values live in
`main.bicepparam`; reusable resource definitions remain in `main.bicep` and
`modules/`.

## Production Ownership Boundaries

- The production VNet is governed by subscription policy. Set
  `useExistingVirtualNetwork = true` so deployment references its subnets
  without issuing a VNet PUT that could remove policy-owned flow-log metadata.
- Preserve policy-injected subnet NSG IDs through the two subnet NSG parameters.
- Preserve the production Container App custom domain and managed certificate
  through the corresponding parameters.
- Always deploy the current application image. `azd` supplies
  `SERVICE_WEB_IMAGE_NAME`; direct Azure CLI deployments must pass
  `containerImage` explicitly.
- The runtime image installs Microsoft ODBC Driver 18 from Microsoft's signed
  Debian repository. This is required for Azure SQL delegated access-token
  connections; `unixodbc-dev` alone is insufficient.
- Azure SQL delegated authentication uses the connector-specific
  `AZURE_SQL_ENTRA_TENANT_ID`, `AZURE_SQL_ENTRA_CLIENT_ID`, and existing
  user-assigned managed identity. The application registration trusts that
  identity through a federated credential, so production stores no client
  secret. These settings must not set the
  global `AUTH_PROVIDER` or `OIDC_*` variables unless application-wide login is
  also intentionally being enabled.
- OAuth deployments behind Container Apps ingress must produce the public HTTPS
  callback and origin. Configure an exact trusted proxy boundary or a validated
  public OAuth base URL; never trust arbitrary forwarded headers.
- The internal MCP gateway is present as a separate azd service and Bicep
  module, but `enableMcpGateway` defaults to `false`. Do not enable it until a
  dedicated Entra gateway application supplies the issuer, audience, JWKS, and
  resource-server URL values; then run a reviewed `azd provision --preview`
  before any deployment. The gateway has its own user-assigned identity and
  internal ingress, and must not reuse the public application's source roles.

## Required Preflight

Compile both files before deployment:

```powershell
az bicep build --file infra/main.bicep --stdout | Out-Null
az bicep build-params --file infra/main.bicepparam --stdout | Out-Null
```

Run a full subscription what-if with the current image:

```powershell
az deployment sub what-if `
  --location eastus2 `
  --template-file infra/main.bicep `
  --parameters infra/main.bicepparam `
  containerImage="$env:SERVICE_WEB_IMAGE_NAME" `
  --result-format FullResourcePayloads
```

Do not deploy if what-if removes or changes the Container App image, custom
domain, traffic rule, replica cap, subnet NSG associations, VNet flow-log
metadata, model capacities, or RAI policy bindings. ARM may still report
response-only fields and symbolic references as modifications; inspect their
before/after values rather than relying only on the resource-level change type.

For the MCP gateway pilot, also require `enableMcpGateway=true` and a
`SERVICE_MCP_GATEWAY_IMAGE_NAME` value in the azd environment. Review the
gateway identity, internal Container App, ACR pull role assignment, and only
the intended gateway configuration additions. Stop if the preview changes any
protected public-app property listed above.

## Post-Deployment Verification

Confirm the Container App has one healthy replica, the generated FQDN and custom
domain return HTTP 200, and the protected properties named above remain intact.
For Azure SQL releases, also verify `ODBC Driver 18 for SQL Server` is listed
inside the deployed container before running the delegated connection smoke
test.
Verify the login redirect and token exchange both use the registered public
HTTPS callback URI, and that a forwarded-header integration test rejects
untrusted hosts while accepting the deployment's exact public origin.
