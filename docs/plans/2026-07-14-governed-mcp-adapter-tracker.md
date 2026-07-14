---
status: Proposed
date: 2026-07-14
scope: Track delivery, evidence, dependencies, and decision gates for the governed MCP adapter implementation.
falsification-deadline: 2026-09-30
related:
  - docs/plans/2026-07-14-governed-mcp-adapter-plan.md
  - docs/plans/2026-07-14-enterprise-data-access-architecture.md
  - docs/plans/2026-07-14-internal-mcp-gateway-provisioning.md
---

# Governed MCP Adapter Tracker

Tracks the implementation plan and its architecture constraints:

- [Governed MCP Adapter Implementation Plan](2026-07-14-governed-mcp-adapter-plan.md)
- [Enterprise Data Access Architecture](2026-07-14-enterprise-data-access-architecture.md)

## Summary Dashboard

| Area | Status | Owner | Approval or evidence needed |
| --- | --- | --- | --- |
| Product MCP profile | Complete | Unassigned | Profile contract and local MCP SDK compatibility spike complete |
| Internal gateway, transport, and policy gate | In progress | Unassigned | Health, registry, late-result barrier, dedicated caller auth, approval gate, tool capability-drift validation, production factory, container packaging, and disabled-by-default IaC wiring complete; upstream transport tests require a configured fixture |
| Governed loader | Not started | Unassigned | Loader lifecycle and provenance tests |
| Fabric IQ pilot | Not started | Unassigned | Preview, cost, residency, and fixture approval |
| OneLake metadata and import pilot | Not started | Unassigned | Source-paired fixture and separate data-path validation |
| Work IQ context adapter | Not started | Unassigned | Read-path and tenant-policy approval |
| Internal gateway and Foundry setup | Not started | Unassigned | Gateway deployment, server operations, and security approval |
| Validation and decision | Not started | Unassigned | Direct/MCP comparison report and decision record |

## Work Packages

| ID | Work package | Status | Owner | Depends on | Completion evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Define product MCP profile | Complete | Unassigned | None | Immutable profile, tool policy, capability manifest, source reference, RED/GREEN tests, and local SDK compatibility record complete |
| 2 | Add internal gateway, transport, and policy gate | In progress | Unassigned | 1 | Stateless health-only gateway, startup profile registry, late-result barrier, validated gateway-audience caller authorization, single-use approval flow, exact upstream tool validation, fail-closed production factory, and disabled-by-default packaging/IaC wiring complete; upstream transport tests require a configured fixture |
| 3 | Create MCP-governed loader | Not started | Unassigned | 1, 2 | `mcp_governed` loader, Arrow validation, lifecycle and provenance tests |
| 4 | Add Fabric IQ semantic discovery pilot | Not started | Unassigned | 1, 2, 3, Fabric approvals | Approved Fabric profile, async behavior, provenance, i18n and regression tests |
| 5 | Add OneLake metadata and bounded table-import pilot | Not started | Unassigned | 1, 2, 3, source-paired Fabric fixture | Metadata discovery plus bounded Arrow import through a validated DFS/Delta, SQL, or governed-handle path |
| 6 | Add read-only Work IQ context adapter | Not started | Unassigned | 1, 2, Work IQ approval | Explicit scope flow, read-only manifest, ephemeral attributed context, regression tests |
| 7 | Deploy internal gateway and configure Foundry without Agency runtime coupling | Not started | Unassigned | Named Foundry owner, security review, gateway topology decision | Internal Container App, distinct identity, versioned endpoints, approved connections, capability report, no Agency runtime path |
| 8 | Validate and decide | Not started | Unassigned | 1 through 7, approved live fixture | Contract suite, opt-in smoke test, quality report, recorded architecture decision |

## Dependencies

| Dependency | Required before | Status | Evidence |
| --- | --- | --- | --- |
| Named Foundry project owner | 4, 7, 8 | Open | Owner can create dedicated Toolbox and project connections |
| Named Fabric workspace owner and non-sensitive fixture | 2, 4, 5, 8 | Open | Same source available through direct and MCP paths; read-only discovery found no OneLake items in `My workspace` |
| Named enterprise security reviewer | Live MCP testing, 7, 8 | Open | Endpoint, identity, token, logging, residency, and tool-output review |
| Entra tenant-wide gateway scope consent | 2, 7, 8 | Blocked | Gateway resource application, delegated scope, service principal, and public-client permission declaration exist; `Authorization_RequestDenied` requires an Entra administrator to grant consent |
| Named Work IQ administrator and approved read paths | 6 | Open | Tenant enablement and scoped path approval |
| Named MCP operations owner | 7, 8 | Open | Versioning, drift, incident, and retirement responsibility |
| Internal gateway topology decision | 2, 7, 8 | In progress | Pilot-only scope and dedicated gateway application selected; feature-gated azd/Bicep wiring and provisioning plan exist; Azure discovery found no gateway app or gateway identity; preview/deployment approval remains |
| MCP client compatibility spike | 2 | Complete | Official MCP Python SDK `mcp 1.28.1`: local stateless handshake, tool listing/call, headers, timeout wiring, host validation, and client cancellation verified in `tests/backend/mcp/test_sdk_compatibility.py` |
| Source-paired direct/MCP baseline and bulk-read path | 5, 8 | Open | Same identity, asset, snapshot, operation set, load profile, and documented DFS/Delta, SQL, or governed-handle transport |

## Completion Evidence

| Evidence item | Required for | Status |
| --- | --- | --- |
| Deterministic profile and contract test suite | 1, 2, 8 | Complete: MCP profile, SDK compatibility, gateway, registry, operation, caller-auth, approval, and capability-drift suites are green; local MCP plus connector regression run: 124 passed |
| Sanitized error, logging, cancellation, and limit tests | 2, 3, 5, 6 | In progress: client cancellation, late-result barrier, safe caller-auth logging, approval scope, capability drift, and production auth-factory tests complete; remaining gateway transport cases require a configured fixture |
| Loader lifecycle, identity isolation, refresh, and provenance tests | 3 | Not started |
| Fabric IQ preview, cost, residency, and source-paired fixture record | 4 | Not started |
| OneLake metadata plus separate bounded-read, Arrow, audience, and region evidence | 5 | Not started |
| Work IQ read-only scope and no-persistence regression evidence | 6 | Not started |
| Gateway package and feature-gated IaC validation | 2, 7 | Complete: separate Dockerfile, azd service, identity/ACR role wiring, internal gateway module, root Bicep, and parameters compile with `enableMcpGateway=false` |
| Toolbox capability report and approved promotion model | 7 | Not started |
| Direct versus MCP quality report | 8 | Not started |
| Final decision recorded in architecture and issue tracking | 8 | Not started |

## Risks And Blockers

| Risk or blocker | Impact | Mitigation or decision needed | Status |
| --- | --- | --- | --- |
| No approved source-paired Fabric fixture | Runtime MCP cannot be validated | Continue direct adapters and keep MCP limited to deterministic contract work | Open |
| Gateway scope lacks tenant-wide consent | Public Data Formulator application cannot obtain a gateway token | Entra administrator must grant consent for the existing client to request `access_as_user` from the gateway resource application | Blocked |
| Read-only Fabric discovery found no OneLake items in `My workspace` | Default personal workspace cannot serve as the fixture | Fabric owner must nominate a non-sensitive workspace item and direct comparison source | Open |
| Missing security or operations owner | No live MCP testing or promotion | Name reviewers before accessing tenant content | Open |
| Fabric IQ preview changes or does not meet compliance needs | Fabric IQ pilot cannot ship | Keep semantic discovery optional; retain OneLake/direct data path | Open |
| Work IQ requires broader consent or paths than justified | Work IQ adapter must not ship | Narrow to approved read paths or defer the lane | Open |
| MCP result transport causes unbounded JSON or budget failures | Bulk data path is unsafe | Use a governed handle or direct OneLake path | Open |
| Capability drift or server identity mismatch | Incorrect or unsafe upstream behavior | Fail closed through pinned profile validation | Open |
| Gateway becomes a broad enterprise-resource broker | Excessive permissions and data exposure | Expose only fixed product operations and source-specific profiles; add new lanes through separate approval | Open |
| Current network lacks a private-MCP topology | Private Foundry or remote MCP cannot be enabled safely | Keep pilot gateway internal to Container Apps; create a separate subnet/DNS/egress design before private upstream adoption | Open |
| OneLake table API is metadata-only | Table import cannot use the table API response directly | Select and validate a separate DFS/Delta, SQL, or governed-handle data path | Open |
| MCP client cancellation does not interrupt an in-flight tool | Late upstream result could race with user cancellation | Mark cancellation terminal and discard late results before any connector, catalog, workspace, or provenance mutation | Mitigated in first-release contract |

## Decision Gates

1. Start live testing only after the security reviewer, MCP operations owner, and source-paired fixture are named.

1. Deploy the first gateway only as an internal, Fabric-only pilot with a distinct managed identity. Expanding it into a reusable platform service requires a separate network and operations decision.

1. Approve a runtime MCP adapter only if the approved profile passes all shared contract tests, including identity isolation, limits, cancellation, error sanitization, provenance, refresh, restart, and capability drift.

1. Approve bulk data transfer only if it stays within existing Arrow budgets without unbounded JSON materialization, or uses an approved governed data handle.

1. Approve Fabric IQ production enablement only after preview acceptance, cost review, data-residency review, and a successful source-paired fixture run.

1. Approve Work IQ only for explicitly approved read paths. Mutation tools, broad discovery, default context injection, and persisted Microsoft 365 content remain out of scope.

1. Choose MCP over a direct path only when the direct/MCP comparison shows a documented operational benefit and MCP p95 latency and peak memory are no more than 20 percent worse than the direct baseline, unless an exception is approved before the run.

1. Reject or narrow runtime MCP by 2026-09-30 if no representative server passes the architecture decision gates.

## Update Protocol

1. Update the relevant work-package row when implementation starts, completes, blocks, or changes scope.

1. Record the actual owner only after that person accepts the responsibility. Keep `Unassigned` until then.

1. Link each completed work package to its tests, evidence artifact, and decision record. Do not mark a package complete from code changes alone.

1. Record a blocker when an approval, fixture, upstream behavior, or threshold prevents progress. Include the next decision required to clear it.

1. Reassess the dependency table before starting tasks 4 through 8 and before any live tenant call.

1. Update the architecture document when a decision gate passes, fails, or changes the provisional hybrid recommendation.

## Immediate Next Actions

1. Have an Entra administrator grant tenant-wide consent for the existing Data Formulator client to request the dedicated gateway `access_as_user` scope.

1. Name the Foundry project owner, Fabric fixture owner, enterprise security reviewer, Work IQ administrator, and MCP operations owner.

1. Select one non-sensitive Fabric source that can be accessed through both a direct path and an approved MCP path using the same identity and snapshot. `My workspace` was checked read-only and contains no OneLake items.

1. Review the internal gateway provisioning plan, then authorize only a preview after the Entra app-registration operator and Fabric fixture owner are named.

1. Use the nominated fixture to implement the remaining fake/upstream transport tests, then validate the profile-pinned `tools/list` contract before any live query.

1. Record the approved initial Fabric, OneLake, and Work IQ scope, or explicitly defer any lane without required approval.
