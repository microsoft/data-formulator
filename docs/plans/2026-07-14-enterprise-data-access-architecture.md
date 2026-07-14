---
status: Proposed; source-paired spike required before implementation commitment
date: 2026-07-14
scope: Decide how Data Formulator should support enterprise Azure SQL, Microsoft Fabric, semantic model, and future data sources through direct adapters, MCP servers, or a hybrid.
falsification-deadline: 2026-09-30
related:
  - docs/plans/ISSUES.md
  - docs/plans/2026-07-09-connector-implementation-requirements.md
  - docs/plans/2026-07-09-azure-sql-entra-mfa.md
  - docs/plans/2026-07-09-fabric-workspaces.md
  - docs/plans/2026-07-09-fabric-lakehouse.md
  - docs/plans/2026-07-09-fabric-semantic-models.md
---

# Enterprise Data Access Architecture

## Confirmed Need

The adaptation owner has confirmed that Data Formulator must support
enterprise-grade access to Azure SQL, Microsoft Fabric workspaces and
Lakehouses, Power BI/Fabric semantic models, and future governed data systems.
This decision is needed before DF-017 through DF-019 commit to source-specific
runtime boundaries that would be expensive to replace later.

The required product outcome is governed enterprise data access, not MCP
adoption. Direct provider adapters, MCP servers, and a product-level MCP
connector facility are candidate implementation models.

“Enterprise-grade” means the path must provide:

- Least-privilege delegated or workload identity appropriate to the source.
- Identity, connector, tenant, and audience isolation.
- Stable source identity, schema, provenance, and refresh semantics.
- Bounded catalog, preview, query, import, and memory behavior.
- Pagination, cancellation, timeout, retry, and throttling contracts.
- Sanitized errors, logs, audit telemetry, and correlation.
- Governed server/tool registration and capability versioning.
- Automated contract tests plus representative real-service evidence.
- Preservation of Data Formulator's data-thread and workspace model.

The following are spike hypotheses, not confirmed requirements:

- Administrators must be able to onboard a source without redeploying Data
   Formulator.
- A runtime MCP facility reduces source-specific implementation enough to
   justify a second transport and operations surface.
- Discovery/actions and bulk tabular data should use the same integration path.
- The first release must support more identity modes or deployment topologies
   than the representative source requires.

## Current Architecture Facts

1. `ExternalDataLoader` is the canonical tabular source adapter. It returns
   Arrow, exposes catalog and metadata operations, and delegates bounded Parquet
   ingestion to the framework.
2. `DataConnector` owns identity-scoped lifecycle, credential injection,
   connector persistence, catalog/preview/import/refresh routes, and safe error
   translation.
3. Stable source identity is carried through catalog metadata and persisted
   workspace metadata so imported tables can be refreshed and traced.
4. No runtime MCP client, server, or tool integration exists under `py-src/`,
   `src/`, or `tests/` as of this assessment.
5. Agency and Fabric MCP capabilities currently support implementation-time
   discovery and contract probing. They are not imported by the product
   runtime.

These facts make an MCP-backed loader feasible, but they do not make arbitrary
MCP tools equivalent to an enterprise data connector.

## Options Considered

| Option | Strengths | Failure modes | Assessment |
| --- | --- | --- | --- |
| Direct adapters only | Best fit for Arrow, source-native paging/query semantics, bulk transfer, and current tests | Every source requires code and deployment; auth/retry/discovery can be duplicated; slower third-party extensibility | Viable, but too restrictive as the long-term extension strategy |
| MCP-first | One tool protocol, dynamic server adoption, useful for governed actions and polyglot integrations | MCP alone does not define Data Formulator schema, Arrow, snapshot, paging, refresh, provenance, or enterprise identity contracts; tool/server drift becomes runtime risk | Reject as the default until a constrained data profile proves parity |
| Hybrid, direct-first | Keeps the existing data plane and permits MCP where it adds real leverage; can support direct results or governed data handles | Requires a routing policy and two adapter implementations; poorly constrained MCP support could become a second connector framework | **Provisional recommendation** |

## Provisional Decision

Keep `ExternalDataLoader` and `DataConnector` as the product's canonical data
contract. Add MCP only as an adapter behind that contract, or as a discovery and
action plane that returns a governed handle consumed by a loader.

The product must not expose arbitrary MCP servers directly to the browser or
Data Agent. An MCP integration must use an administrator-approved registry,
allowlisted capabilities, explicit authentication profiles, bounded result
contracts, and the existing connector/workspace security boundaries.

This is a provisional decision. A source-paired spike must test whether an MCP
path can satisfy the same functional and quality contract as a direct adapter.

## Agency Capability Refinement

Agency is an implementation-time MCP and workflow host, not an application
runtime dependency. Its profile boundaries are useful for discovering and
testing approved source capabilities, but Data Formulator must not invoke the
Agency CLI from a deployed request path or inherit its broad developer/workflow
permissions.

The current local inventory establishes these source-specific boundaries:

| Source | Agency evidence | Product integration decision |
| --- | --- | --- |
| Fabric / OneLake | `project-fabric*` profiles reference the Fabric skills plugin, but the profiles are templates and have not been exercised as data-plane servers | First MCP pilot candidate, gated on explicit plugin inspection, a named Fabric workspace/item fixture, and a source-paired direct/MCP contract test |
| Azure SQL | Agency's Azure MCP router exposes Azure SQL management operations for servers, databases, firewall rules, elastic pools, and Entra administrators; it exposes no table, schema, or query operation | Do not use the management-plane MCP as a data connector. Retain the direct `mssql` connector as the supported product path; evaluate a future approved SQL data-plane MCP only when it passes this plan's contract gates |
| Microsoft Graph | `m365-people-context` exposes Graph for narrow people/org context; `project-context` is intentionally broad and sensitive | Do not expose generic Graph through a data connector. Consider a separate, source-scoped connector only after its data domain, delegated permissions, and user-visible scope are defined |
| Kusto | `project-ops` includes an Agency Kusto MCP | Candidate for a separate governed analytical source, not a fallback transport for Fabric or Azure SQL |
| M365 files, mail, Teams, Planner, and SharePoint | Separate consent-sensitive Agency profiles exist | Not candidates for blanket runtime discovery. Any future connector must use an explicit source type, named scope, least-privilege delegated permissions, and separate review |

Agency's `include_mcps_from_workspace = false` setting is an appropriate
implementation-time isolation pattern. Mirror its intent in the product with an
administrator-owned server registry; do not discover or trust ambient MCP
servers at runtime.

### Agency-Guided Adoption Sequence

1. Run read-only Agency inventory commands with `--profile-only` to confirm
   effective server and tool names. Do not call tenant data tools during this
   inventory.
2. Inspect the Fabric plugin and each exposed tool before enabling a Fabric
   profile. Confirm whether tool calls are read-only, which identity and tenant
   scopes they use, and whether the server offers catalog, schema, bounded
   query, pagination, cancellation, and provenance operations.
3. Select one administrator-approved Fabric workspace item that is available
   through both a direct path and the candidate MCP server. Name a server
   operations owner and a security reviewer before accessing the item.
4. Implement the deterministic Data Formulator MCP profile mock and contract
   suite before a real server adapter. Validate capability version, server
   identity, pagination, row/byte/time limits, cancellation, error
   sanitization, provenance, and Arrow conversion or governed-handle behavior.
5. Run the source-paired Fabric spike. Approve a production MCP adapter only if
   it passes every decision gate in this plan.
6. Add future source adapters one at a time. Azure SQL, Graph, Kusto, and M365
   content require separate source contracts and must not be enabled by a broad
   "other sources" switch.

### Azure SQL Retirement Interaction

The delegated Azure SQL Microsoft Entra connector is being considered for
retirement because the tenant's MFA/consent flow is not viable. This does not
make Agency a replacement Azure SQL data transport: the available Azure SQL MCP
is management-plane only and has no table, schema, or query operation. Keep the
generic credential-based `mssql` connector independent of that retirement.
Revisit the SQL MCP option only when an approved data-plane server can meet the
same identity, schema, bounded transfer, query safety, provenance, refresh,
cancellation, and operational-ownership requirements as a direct connector.

## Proposed Runtime Shape

### Canonical Data Boundary

All tabular sources, direct or MCP-backed, must present the existing loader
capabilities:

- Hierarchical, paged catalog browsing and search.
- Stable source identifiers and best-effort source metadata.
- Bounded preview and import.
- Arrow-compatible data delivery before workspace ingestion.
- Refresh behavior tied to persisted source provenance.
- Shared authentication, error, timeout, retry, and observability contracts.

A direct provider adapter implements those operations against the provider SDK
or API. An MCP-backed adapter maps an approved server profile to the same
operations. Existing connector routes remain shared; provider-specific routes
require a separate architecture decision.

### Hosted Gateway Topology

The first runtime MCP slice is a dedicated, internal-only gateway service, not
an extension of the public Data Formulator Container App and not a server that
hosts every Agency capability. Data Formulator calls the gateway with its
identity and operation context; the gateway validates the approved profile,
enforces limits and approval policy, and invokes the configured upstream
service. The gateway exposes only the product operations `catalog`, `schema`,
`semantic_query`, `bounded_read`, and `health`.

The pilot topology has these boundaries:

- The public Data Formulator app remains the browser-facing surface.
- A separate internal Container App hosts the MCP gateway with a distinct
   managed identity, independent source permissions, and no public ingress. The
   gateway validates a Data Formulator Entra access token with a gateway-specific
   audience; managed identity alone does not enforce inbound caller identity.
- The gateway reaches only profile-allowlisted Foundry Toolbox, Fabric IQ,
   OneLake, and approved Work IQ endpoints. Agency, VS Code MCP proxies, and
   arbitrary remote server URLs are never present in the runtime path.
- The initial gateway profile is Fabric-only. Work IQ remains disabled until
   tenant policy and explicit read paths are approved; Azure SQL is excluded
   because the available MCP operations are management-plane only.
- A later private Foundry or private remote-MCP route requires a separate
   network decision covering an MCP subnet, DNS, ingress, egress, and identity.
   The current Container Apps environment does not define that topology.

This deployment boundary makes the gateway a small product service with a
finite capability surface. It must not become an ambient enterprise-resource
broker simply because Agency can discover more tools during development.

### Feasibility Confirmation: 2026-07-14

Current Microsoft documentation confirms that Azure Container Apps can host a
remote MCP server using HTTP GET/POST endpoints, with custom authentication and
stateless service design. Container Apps internal ingress makes the gateway
reachable from the public Data Formulator app when both apps share an
environment, without exposing the gateway to the public internet.

That confirms the internal Data Formulator-to-gateway pilot is technically
feasible in the existing Container Apps environment. It does **not** confirm
that Foundry Agent Service can consume that gateway privately: current Foundry
guidance requires Standard Agent Setup with private networking and a dedicated
MCP subnet delegated to `Microsoft.App/environments`. The current VNet defines
only an infrastructure subnet and a private-endpoint subnet, so a Foundry-to-
gateway private MCP route is a later network implementation, not part of the
first pilot.

The OneLake Delta table API currently supports read-only schema and table
metadata operations, including storage locations, but does not document bulk
table-row reads. The gateway may use it for catalog and schema. Bounded table
import requires a separate validated data path, such as a source-approved
OneLake DFS/Delta reader or Fabric SQL endpoint, with its own identity,
audience, regional, limit, and provenance tests.

### Data Formulator MCP Profile

MCP does not supply a standard Data Formulator table contract. If adopted, the
project must define a versioned product profile over MCP. The profile should
declare and test:

- Server identity, trust policy, profile version, and supported source type.
- Authentication owner, required audience, consent mode, and token forwarding
  prohibition or mechanism.
- Catalog hierarchy, paging, filtering, and search capabilities.
- Schema and source metadata response shapes.
- Preview, bounded read, and safe query-template capabilities.
- Row, byte, page, value, and execution-time limits.
- Continuation, cancellation, retry, and idempotency behavior.
- Stable source, snapshot/version, and query-template identifiers.
- Result provenance, warnings, and sanitized error classes.
- Capability drift and minimum-version behavior.

This profile is a Data Formulator product contract transported over MCP. It
must not be described as behavior provided by MCP itself.

### Result Paths

An approved MCP operation may return either:

1. A bounded tabular result that the adapter validates and converts to Arrow.
2. A short-lived governed data handle that a source-specific loader consumes
   through an approved bulk data path.

Large datasets should not be serialized repeatedly through generic JSON tool
responses. The spike must measure memory copies, bytes transferred, latency,
and cancellation behavior before approving an MCP data plane.

### Identity And Security

- The backend owns OAuth, delegated-token, workload-identity, and secret
  resolution. Tokens must not pass through browser JavaScript or model prompts.
- MCP endpoint configuration is administrator-owned and confined to allowlisted
  schemes, hosts, transports, and server identities.
- Tool descriptions and outputs are untrusted input. They must not alter system
  prompts, bypass source/query policy, or select unapproved tools dynamically.
- The adapter must fail closed on server/profile mismatch, capability drift,
  audience mismatch, expired credentials, oversized results, and unsupported
  continuation behavior.
- The first release treats upstream cancellation as best-effort. On caller
   cancellation, the gateway stops waiting and marks the operation terminal;
   late upstream results are discarded before they can mutate connector,
   catalog, workspace, or provenance state. End-to-end upstream task
   cancellation requires a later, separately validated MCP task design.
- Every call must be correlated to identity, connector, operation, and server
  profile without logging tokens, source identifiers, queries, or result data.

## Workload Routing

| Workload | Preferred first path | MCP role to evaluate |
| --- | --- | --- |
| Azure SQL catalog, preview, and import | Existing direct `azure_sql` loader and ODBC token path | Optional adapter only when an approved enterprise MCP server demonstrates equivalent schema, paging, query safety, and bulk-result behavior |
| Fabric workspace and item discovery | Shared Fabric discovery service behind connector UX | Strong MCP candidate for governed discovery if identity, paging, and capability contracts are complete |
| Fabric Lakehouse tables/files | Direct or governed-handle data path into the loader/Arrow pipeline | MCP may discover assets or issue a governed handle; approve direct tabular transfer only after memory and throughput evidence |
| Semantic model query templates | Delegated, RLS-preserving bounded query service | Strong MCP candidate for allowlisted actions/templates; results must still satisfy value, byte, schema, provenance, and error contracts |
| Future third-party enterprise systems | Direct plugin when no approved MCP server exists | MCP-backed adapter when the vendor provides a stable, governable profile that passes the contract suite |

## Source-Paired Spike

### Phase 0: Select A Valid Pair

Before implementation, identify one source for which all of these are true:

- Data Formulator can access the same tenant, identity, catalog scope, source
   object, dataset snapshot, and operations through both a direct API/SDK path
   and a real administrator-approved MCP server.
- Both paths can exercise catalog listing, schema, bounded preview, bounded
   import or query, cancellation, errors, and provenance.
- The server owner permits representative performance and failure testing.

Azure SQL may be used only if an approved MCP server exposes the required
operations. Fabric or a semantic model may be used instead if both direct and
MCP paths are available for the same asset and workload. If no source satisfies
this pairing, runtime MCP cannot be approved; continue direct implementation
and use deterministic mocks only to refine the proposed profile.

### Spike A: Direct Baseline

For the Phase 0 source, record the direct path's catalog, schema, preview,
bounded import/query, auth, restart, latency, bytes, memory, cancellation,
provenance, refresh, and error evidence using existing quality requirements.

### Spike B: MCP Contract Development

Use a deterministic mock implementing the proposed profile to exercise paging,
identity isolation, throttling, cancellation, capability drift, malformed tool
descriptions/results, oversized results, and sanitized errors. Mock results may
develop and test the adapter contract but cannot support runtime approval.

### Spike C: Real MCP Comparison

Run the same Phase 0 source, identity, asset, snapshot, and operations through
the real approved MCP server. Exercise schema, preview, bounded import/query,
Arrow conversion or governed-handle consumption, continuation, cancellation,
source identity, workspace provenance, refresh, restart, and failure behavior.
The direct and MCP measurements must use the same test data and load profile.

### Decision Evidence

Compare direct and MCP paths using the same report shape:

- Functional contract coverage.
- Authentication and isolation guarantees.
- Catalog and schema fidelity.
- Rows, values, bytes, pages, and peak memory.
- p50/p95 latency and upstream duration.
- Retry, cancellation, and partial-failure behavior.
- Provenance and refresh correctness.
- Operational ownership, deployment, and capability-version burden.

### Predeclared Pass Thresholds

The MCP path must satisfy all existing connector MUST requirements and all of
these comparison thresholds:

- Contract correctness: 100 percent of shared identity, auth, catalog, schema,
   limits, cancellation, error, provenance, refresh, and restart tests pass.
- First connector/status response p95 is at most 2 seconds.
- Catalog page p95 is at most 3 seconds for at most 200 nodes.
- Preview p95 is at most 5 seconds for at most 10,000 rows.
- Preview and import stay within the existing 32 MiB and 256 MiB Arrow budgets,
   respectively, with no unbounded JSON materialization.
- MCP p95 latency and peak memory are no more than 20 percent worse than the
   same direct operation unless an exception is approved before the run.
- Cancellation stops client work and prevents late workspace commits; no
   partial connector, catalog, or table state remains.
- Capability drift: additive optional fields are tolerated; missing required
   capabilities, incompatible profile versions, changed tool identity, or
   changed auth/audience declarations fail closed before data access.
- Operational benefit: MCP must either onboard the paired source without a
   Data Formulator runtime deployment or enable a required source/workload for
   which the direct path is documented as infeasible. Code consolidation alone
   is not sufficient approval evidence.

Performance measurements exclude interactive identity-provider time and use
the representative environment and report format required by the connector
implementation requirements.

## Ownership And Decision Process

| Responsibility | Accountable owner | Completion evidence |
| --- | --- | --- |
| Business outcome and adaptation priority | Fabio | Confirmed need and selected first enterprise workflow recorded in the meeting outcome |
| Phase 0 pair, spike execution, and evidence package | Fabio | Reproducible direct/MCP reports using the same source, identity, asset, snapshot, operations, and load profile |
| Upstream product-boundary review | Chenglong | Recorded response on loader boundary, runtime MCP scope, and upstream acceptability |
| Security review | Fabio obtains and records an enterprise security reviewer before any live MCP test | Endpoint trust, identity, token handling, tool-output trust, logging, and threat review approved |
| MCP server operations | Named server owner required before Phase 0 selection | Registration, versioning, upgrade, drift, incident, and retirement responsibilities documented |
| Final adaptation decision | Fabio, informed by Chenglong and the security/server owners | Decision and rationale recorded in this plan and DF-023; downstream plans updated |

No live MCP server may be tested until the security reviewer and server
operations owner are named. No final architecture decision may use mock-only
evidence.

## Decision Gates

Approve an MCP-backed runtime facility only if all of these are true:

1. Phase 0 identifies a real approved MCP server and an identical direct/MCP
   source, identity, asset, snapshot, operation set, and load profile.
2. The MCP adapter passes 100 percent of the shared contract suite and every
   predeclared absolute and direct-comparison threshold.
3. Large-result transfer remains within existing Arrow budgets without
   unbounded JSON materialization, or uses an approved governed-handle path.
4. The security reviewer and server operations owner approve the endpoint,
   identity, profile-version, upgrade, drift, incident, and retirement model.
5. The MCP path demonstrably enables no-redeployment onboarding for the paired
   source or a required workload whose direct path is documented as infeasible.

If these gates fail, continue with direct adapters and retain MCP for
implementation-time discovery or narrowly governed actions.

## Questions For Chenglong

1. Should `ExternalDataLoader` remain the canonical tabular data boundary?
2. Does upstream want a product runtime MCP facility, or should MCP remain an
   implementation/development tool?
3. If runtime MCP is acceptable, should its first scope be discovery/actions,
   bounded tabular data, governed data handles, or all three?
4. Which identity modes and deployment topologies must the first enterprise
   slice support?
5. Is source-by-source plugin deployment acceptable, or is administrator-driven
   onboarding without a product deployment a core requirement?
6. Which representative Fabric and semantic-model assets can be used for the
   source-paired spike?

## Would Revise If

Replace the provisional hybrid recommendation if a real approved MCP server
demonstrates complete parity with direct loaders for identity, catalog, schema,
bounded Arrow-compatible results, cancellation, provenance, refresh, restart,
latency, and memory. Narrow or reject runtime MCP if no representative server
passes those gates by 2026-09-30.
