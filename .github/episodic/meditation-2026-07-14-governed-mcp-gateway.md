# Meditation: Governed MCP Gateway Foundation

**Date**: 2026-07-14
**Focus**: Establish the local product, identity, and infrastructure foundation for a Fabric-only internal MCP gateway.

## Accomplished

- Defined immutable gateway profiles, capability manifests, source references,
  tool policies, result limits, and safe error types.
- Added the official MCP Python SDK and verified a local stateless FastMCP
  handshake, tool discovery/call, header/timeout wiring, host validation, and
  caller-side cancellation behavior.
- Built the health-only gateway, startup profile registry, dedicated-caller JWT
  verifier, FastMCP token adapter, single-use scope-bound approvals, terminal
  late-result barrier, and exact upstream tool-drift validator.
- Added a separate gateway container image and feature-gated internal Container
  Apps IaC. The root Bicep and parameter file compile while
  `enableMcpGateway=false`; no Azure infrastructure was deployed.
- Created the dedicated single-tenant gateway Entra resource application,
  exposed its delegated `access_as_user` scope, created its tenant service
  principal, and added that scope to the existing Data Formulator client's
  required permissions.

## Evidence

- Local MCP gateway and connector regression suite: 124 passed.
- Bicep root template, parameters, and gateway module compile without
  diagnostics.
- The dedicated gateway app, scope, and service principal exist. The existing
  Data Formulator client declares the gateway scope.
- No tenant-wide OAuth grant exists. The attempted consent operation returned
  an administrator-only authorization denial.
- Read-only Fabric discovery confirmed access exists, but the checked personal
  workspace contains no OneLake items and cannot be the pilot fixture.

## Patterns Extracted

- The existing repository rule remains correct: declared Entra required access,
  service principal creation, and granted delegated consent are separate gates.
  The gateway exercise confirmed that a new resource application can require a
  tenant service principal before consent can even be evaluated.
- Treat MCP cancellation as caller cancellation plus a terminal late-result
  barrier unless an upstream server proves task cancellation. The local SDK
  test showed client task cancellation does not interrupt an in-flight FastMCP
  tool by itself.
- A dedicated internal gateway is a finite product boundary, not an Agency
  proxy. Profile-pinned tool identity, explicit approvals, and source-specific
  result paths keep it from becoming a broad enterprise-resource broker.

## Open Questions

- An Entra administrator must grant tenant-wide consent for the existing Data
  Formulator client to request the gateway scope.
- A Fabric owner must provide a non-sensitive data-agent or ontology fixture
  with a same-source direct comparison path.
- The gateway must remain disabled until those prerequisites, an infrastructure
  preview, and explicit deployment approval are complete.
