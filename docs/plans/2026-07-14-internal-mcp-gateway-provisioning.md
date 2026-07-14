---
status: Entra resource application created; tenant-wide consent and Azure provisioning blocked pending administrator approval
date: 2026-07-14
scope: Provision a dedicated Microsoft Entra application, managed identity, and internal Container Apps gateway for the Fabric-only MCP pilot after preview and explicit deployment approval.
falsification-deadline: 2026-09-30
related:
  - docs/plans/2026-07-14-governed-mcp-adapter-plan.md
  - docs/plans/2026-07-14-governed-mcp-adapter-tracker.md
  - docs/plans/2026-07-14-enterprise-data-access-architecture.md
---

# Internal MCP Gateway Provisioning Plan

**Goal:** Provision the least-privilege infrastructure and identity boundary required to host the Fabric-only internal MCP gateway without changing the public Data Formulator application or enabling live Fabric access prematurely.

**Architecture:** Deploy a separate internal Container App named `ca-dataformulator-mcp` in the existing Container Apps environment. Attach a new user-assigned managed identity named `id-dataformulator-mcp`. The public `ca-dataformulator` app calls the gateway over same-environment internal ingress using a token issued for the dedicated gateway application audience. The gateway has no public domain and no Agency runtime dependency.

**Status:** Read-only Azure discovery completed. All subscriptions were considered through Azure Resource Graph. The current resource group contains `ca-dataformulator` and `id-dataformulator` in `eastus2`; it does not contain a dedicated gateway app or gateway identity. The dedicated single-tenant Entra resource application, its `access_as_user` scope, and its tenant service principal have been created. The existing Data Formulator client requests the new scope. No tenant-wide grant, Azure resource, Fabric resource, or deployment configuration has changed.

---

## Target Resources

| Resource | Target | Purpose | Deployment gate |
| --- | --- | --- | --- |
| Container App | `ca-dataformulator-mcp` | Stateless FastMCP gateway with internal HTTP ingress only | Bicep preview and explicit deployment approval |
| User-assigned managed identity | `id-dataformulator-mcp` | Separate source permissions for the gateway | Identity/RBAC review |
| Entra application | `Data Formulator MCP Gateway` | Dedicated caller-token audience and resource-server metadata | App-registration operator approval |
| Public Data Formulator app | Existing `ca-dataformulator` | Obtains a token for the dedicated gateway audience | Application identity/consent review |
| Fabric profile | One non-sensitive data-agent or ontology fixture | Upstream MCP capability and direct/MCP comparison | Fabric owner and security approval |

## Provisioning Sequence

### Step 1: Confirm Identity Ownership

1. Name an operator who can create and expose an Entra application API.
1. Name the gateway operations owner and enterprise security reviewer.
1. Confirm the gateway is a Fabric-only pilot and not a general enterprise-resource broker.

**Exit evidence:** named owners and written approval to create one dedicated app registration and identity.

### Step 2: Create The Dedicated Entra Application

1. Create `Data Formulator MCP Gateway` as a resource-server application.
1. Expose the gateway API audience `api://data-formulator-mcp-gateway` with a least-privilege application scope for the Data Formulator caller.
1. Record the issuer URL, JWKS URL, application audience, and internal MCP resource URL in a deployment secret/configuration source. Do not commit client secrets or tokens.
1. Authorize only the public Data Formulator application to request the gateway scope.
1. Configure no browser redirect URI because the gateway is not an interactive client.

**Exit evidence:** app registration exists, API scope is exposed, caller consent is granted, and configuration values are stored outside Git.

**Current evidence:** The `Data Formulator MCP Gateway` application exposes `api://data-formulator-mcp-gateway` with the `access_as_user` delegated scope, and its tenant service principal exists. The existing Data Formulator client requests this scope. `az ad app permission admin-consent` returned `Authorization_RequestDenied`; an Entra administrator must grant consent before the public application can obtain a gateway token.

### Step 3: Add Infrastructure As Code

1. Add a dedicated identity module or extend the existing identity module to create `id-dataformulator-mcp`.
1. Add `infra/modules/mcp-gateway.bicep` with:
   - Existing Container Apps environment ID.
   - Internal HTTP ingress and no custom domain.
   - Gateway target port matching the gateway container.
   - Gateway identity only, distinct from `id-dataformulator`.
   - Required non-secret environment variable names only.
   - Log Analytics and Application Insights integration.
   - Minimum one replica for interactive MCP use unless a measured cold-start exception is approved.
1. Add the `mcp-gateway` service to `azure.yaml` and a separate gateway container build definition.
1. Keep the existing public `web` service and its traffic/custom-domain configuration unchanged.

**Exit evidence:** Bicep build succeeds and the resulting template shows one additive identity and one additive internal Container App.

### Step 4: Preview The Deployment

1. Build the gateway image locally when Docker is available; otherwise build through the approved remote build path.
1. Run `azd provision --preview` or an equivalent subscription what-if against the existing environment.
1. Inspect every `Modify` entry, not only the create/delete summary.
1. Stop if the preview changes the public app image, custom domain, traffic rule, replica cap, VNet metadata, Azure OpenAI, registry, or existing identity permissions.

**Exit evidence:** reviewed preview with only the approved gateway/identity/config additions.

### Step 5: Deploy And Verify The Internal Boundary

1. Obtain explicit deployment approval after preview review.
1. Deploy through the project IaC path.
1. Confirm the gateway FQDN contains the internal visibility segment and cannot be reached from outside the Container Apps environment.
1. Confirm the gateway FastMCP `/mcp` endpoint rejects unauthenticated requests and accepts a valid dedicated-audience caller token.
1. Confirm the public app can resolve and reach the internal gateway only through its configured internal URL.

**Exit evidence:** health check, authenticated MCP handshake, tool-list result, internal-only reachability result, and Application Insights correlation without token logging.

### Step 6: Select And Verify The Fabric Fixture

1. Obtain a Fabric owner-approved non-sensitive data-agent or ontology fixture and a corresponding direct comparison source.
1. Record the workspace/item identifiers only in the protected deployment configuration or approved evidence store, not in source-controlled plans.
1. Verify the profile-pinned Fabric MCP endpoint using the gateway's versioned capability check.
1. Verify the direct source path and capture a metadata-only baseline before any table or semantic query.

**Exit evidence:** same identity, source, snapshot, operations, and load profile are available for direct and MCP comparison.

## Explicit Non-Goals

- No private Foundry-to-gateway networking in this phase. That requires Standard Agent Setup and a dedicated delegated MCP subnet with private DNS and egress design.
- No Work IQ or broad Microsoft 365 resource access.
- No Azure SQL data-plane connector through the gateway.
- No direct OneLake table-row import through the metadata-only OneLake table API.
- No permission reuse from `id-dataformulator` without explicit role review.

## Rollback

1. Disable the gateway service in `azure.yaml` and redeploy the previous approved infrastructure state.
1. Revoke the gateway identity's source roles before deleting the identity.
1. Disable the dedicated gateway API scope or remove caller consent only after confirming no active revision needs it.
1. Do not alter the public Data Formulator app, existing identity, Fabric source data, or Entra application outside the gateway boundary during rollback.

## Decision Required Before Provisioning

Proceed only when an Entra administrator grants tenant-wide consent, a Fabric fixture owner is named, the preview is clean, and the user explicitly approves the deployment.
