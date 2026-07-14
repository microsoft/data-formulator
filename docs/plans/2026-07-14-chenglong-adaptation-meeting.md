# Data Formulator Adaptation Discussion

- **Meeting date:** 2026-07-14
- **Participants:** Fabio, Chenglong Wang
- **Purpose:** Review the adaptation branch, separate generally useful changes
  from environment-specific deployment work, and agree on the next product slice.

## Confirmed Need

Build enterprise-grade data access for Azure SQL, Microsoft Fabric workspaces
and Lakehouses, Power BI/Fabric semantic models, and future governed sources.
The architecture may use direct provider adapters, MCP servers, or a generic
MCP-backed connector facility, but must preserve Data Formulator's identity,
limits, provenance, refresh, workspace, and data-thread contracts.

The provisional recommendation is hybrid and direct-first: keep
`ExternalDataLoader` as the canonical tabular boundary and evaluate MCP behind
that boundary for governed discovery, actions, bounded results, or data handles.
The decision and spike are defined in the
[enterprise data access architecture](2026-07-14-enterprise-data-access-architecture.md).

## Questions For Chenglong

The paper establishes the core interaction principles, paper-era extension
points, historical future-work directions, and a paper-grounded minimum
validation slice. Those answers are recorded in the
[paper insights](2026-07-14-data-formulator-2-paper-insights.md#paper-grounded-qa).
The questions below require current maintainer or product context.

1. Which future-work directions from the paper remain priorities over the next
  year, which have been superseded, and where does this adaptation align or
  conflict with the current direction?
2. Which current modules are intended as stable extension points, and which are
  still experimental or likely to change substantially?
3. Should `ExternalDataLoader` remain the canonical tabular data boundary, with
  MCP as an optional adapter, or should upstream define a first-class runtime
  MCP connector facility? If MCP is accepted, should it own discovery/actions,
  bounded tabular data, governed data handles, or all three?
4. Where should token ownership, refresh, logout, revocation, and
  connector-plus-audience isolation live in the long-term architecture?
5. What session and persistence model does the project expect for hosted,
  multi-user, multi-worker deployments? Are there existing plans we should
  follow before selecting a shared backend?
6. Which hardening changes would be valuable upstream, and how would you prefer
  them divided into reviewable pull requests?
7. What backward-compatibility guarantees matter most for connector
  definitions, stored credentials, sessions, workspaces, and existing local
  deployments?
8. Should Azure Container Apps infrastructure live in the upstream repository
  as a supported deployment example, or remain separately governed adopter
  infrastructure?
9. For Fabric, is the preferred sequence workspace/item discovery, Lakehouse
  imports, then semantic-model queries, or does the product roadmap suggest a
  different first slice?
10. Are there known architectural constraints, active branches, unpublished
   experiments, or planned refactors that should change our current approach?
11. What test, documentation, maintenance, and ownership commitments would make
   these contributions acceptable for upstream support?

## Thirty-Second Status

The adaptation work on branch `main` is published through commit `e98ee0f`.
Runtime source commit `ebada59` is deployed on production revision
`ca-dataformulator--0000010`. Core application health is green; Azure SQL code
is complete but its end-to-end operational gate is not; horizontal scale is
intentionally blocked by local state. Backend validation passed 2,023 tests
with 13 skips, frontend validation passed 271 tests, and HTTP health was last
verified on 2026-07-13.

**Table 1:** *Readiness by independently releasable surface*

| Surface | Status | Evidence or gate |
| --- | --- | --- |
| Core application | Healthy in production | Revision `0000010`, one ready replica, zero restarts, both endpoints HTTP 200, clean recent logs |
| Azure SQL implementation | Source and mocked contracts complete | Delegated connector, secure popup, Driver 18 token path, ODBC hardening, and state isolation are tested and deployed |
| Azure SQL operations | Blocked before end-to-end release sign-off | Tenant admin consent, then interactive Microsoft sign-in/MFA and staging catalog access |
| Horizontal scale | Not ready by design | Sessions, delegated tokens, connector metadata, credentials, catalogs, and workspaces require approved shared stores |

## Use Cases To Capture First

The target sources and architecture decision are now explicit. The meeting
still needs to establish users, scale, deployment, and governance constraints.

| Question | Meeting notes |
| --- | --- |
| Primary users and jobs to be done | Pending |
| Required data sources and authentication modes | Azure SQL, Fabric workspaces/Lakehouses, semantic models, and future governed sources; delegated versus workload identity remains source-specific |
| Integration model | Compare direct adapters, approved MCP servers, and a governed MCP-backed connector facility through a source-paired spike |
| Expected data volume, concurrency, and latency | Pending |
| Deployment boundary, tenant, network, and compliance needs | Pending |
| Required durability, sharing, and collaboration behavior | Pending |
| Must remain upstream-compatible versus acceptable fork behavior | Pending |
| Success criteria for the first usable slice | Pending |

## Sources Of Truth

- [Data Formulator 2 paper insights](2026-07-14-data-formulator-2-paper-insights.md):
  research contribution, study evidence and limitations, current-code
  cross-check, and adaptation implications.
- [Audit and change log](ISSUES.md): canonical issue status, evidence,
  acceptance criteria, rejected findings, and commit-level product change map.
- [Session handoff](../../HANDOFF.md): current production state, rollback,
  validation, and immediate queue.
- [Audit remediation plan](2026-07-13-audit-remediation.md): completed DF-020,
  DF-021, DF-022 analysis, and repository-hygiene work.
- [Azure SQL implementation plan](2026-07-09-azure-sql-entra-mfa.md): delegated
  authentication architecture and test contract.
- [Admin-consent runbook](../../AZURE-SQL-ADMIN-CONSENT.md): exact external
  approval and production smoke-test procedure.
- [Connector readiness requirements](2026-07-09-connector-implementation-requirements.md):
  cross-connector security, test, dependency, and release gates.
- [Enterprise data access architecture](2026-07-14-enterprise-data-access-architecture.md):
  provisional hybrid decision, MCP profile boundary, workload routing, and
  source-paired spike.

## Adaptation Delta

The categories below distinguish contribution readiness from technical
generality. “Design-dependent” does not mean tenant-specific; it means the
change needs maintainer alignment before it should define an upstream contract.

**Table 2:** *How the published changes should be discussed*

| Classification | Commits | Changes | Discussion position |
| --- | --- | --- | --- |
| Upstream-ready candidates | `4e185e9`, `b50d922`, `fcc6fc8`, parts of `ebada59` | Dependency repair; query, lifecycle, persistence, retry, timeout, memory, runtime, cookie, logging, OAuth-state, test-portability, and ODBC safety fixes | Split into focused subsystem pull requests with compatibility tests; do not ask maintainers to review the bundled adaptation commits as one unit |
| Generic but design-dependent | `71b1b78`, auth/session parts of `ebada59` | Distinct delegated `azure_sql` connector, connector-plus-audience token ownership, secure popup, Driver 18 token path, shared-session requirements, DF-022 migration | Align with upstream connector/authentication abstractions, token lifecycle, logout/revocation behavior, and scale contract before contribution |
| Deployment example, maintainer decision | `10040a3`, `14625d4`, reusable parts of `b50d922` | Container Apps/ACR/OpenAI Bicep, Gunicorn/container defaults, managed identity wiring | Retain only portable example infrastructure that maintainers want to own; separate it from product-runtime review |
| Tenant-specific operations | Live configuration recorded through `e98ee0f` | Entra registration and consent, custom domain, target database, quota allocation, policy-owned networking, PIM-dependent rollout | Keep outside generic product behavior and document as adopter operations |
| Not product adaptation | `69a3c43`, `f687309` and Agency assets | ACT Edition, Copilot instructions, assistant tooling | Excluded from the runtime changelog and not required for product adoption |

The canonical commit-by-commit map is in the audit ledger. The comparison
baseline is upstream commit `00d0f5e`; the published adaptation tip is
`e98ee0f`.

## Open Issues

### Immediate Release Gates

**Table 3:** *Blockers, accountability, and closure evidence*

| Gate | Scope blocked | Owner | Closure evidence |
| --- | --- | --- | --- |
| DF-016 tenant consent | Azure SQL end-to-end sign-off | Fabio coordinates an eligible Entra administrator | `user_impersonation` grant exists with `AllPrincipals` consent |
| Interactive popup/MFA test | Azure SQL end-to-end sign-off | Fabio after consent | Production popup completes against `cpestaging.database.windows.net` / `CPE_Predictor` and returns accessible catalog entries |
| Shared session architecture | Restart durability and horizontal scale | Fabio drives the decision and records the implementation owner during the meeting | Approved backend and migration plan; revision-replacement and cross-worker tests pass before raising worker/replica limits |
| DF-022 cookie migration | Warning-free session upgrade | Fabio coordinates with the session implementation owner selected during the meeting | Selected transition test passes, deprecation warning is absent, and user impact is documented |
| PR #376 integration | Upstream merge | Fabio, with maintainer review | Current CI passes and changes after baseline `00d0f5e` are reconciled |

[microsoft/data-formulator PR #376](https://github.com/microsoft/data-formulator/pull/376)
is the active open pull request associated with this workspace. Its current
title combines the Cursor-to-Copilot port with Azure Container Apps deployment
infrastructure, while this adaptation branch now also contains product runtime
and Azure SQL changes. The meeting should decide whether one PR remains a
reviewable integration vehicle or whether the work must be split.

### Product Roadmap

1. **DF-017:** Fabric delegated workspace and item discovery.
2. **DF-018:** Fabric Lakehouse table/file imports after discovery and data-plane
   correctness spikes.
3. **DF-019:** Fabric semantic-model queries with delegated RLS and API-limit
   enforcement.

### Non-Blocking Observations

- The frontend build retains existing bundle-size and dynamic-import warnings.
- Horizontal scale remains out of scope until sessions, connector metadata,
  credentials, catalogs, and workspaces have approved shared stores.
- Revision `ca-dataformulator--0000009` remains available at zero traffic as
  the immediate rollback target.

## Decisions To Seek

**Table 4:** *Decision prompts with a proposed starting position*

| Decision and type | Options | Proposed starting position |
| --- | --- | --- |
| Contribution sequence, maintainer approval | Review bundled commits; split by subsystem; keep fork-only | Split generic hardening into dependency, connector safety/lifecycle, runtime resilience, and test-portability pull requests; preserve dependencies between them |
| Azure SQL direction, architecture co-design | Merge connector as designed; generalize auth first; keep adaptation-only | Validate the distinct `azure_sql` UX and connector-plus-audience token contract first; generalize only mechanics proven reusable by a second connector |
| Shared session backend, architecture co-design | Managed Redis; database-backed store; other approved shared store; remain single-instance | Agree on requirements and ownership before selecting a paid service; retain one worker and one replica until restart and cross-worker evidence is green |
| DF-022 behavior, product decision | One-time logout; bounded legacy-cookie transition | Use a documented one-time logout unless active-session continuity is a product requirement; otherwise implement one bounded transition with the shared backend |
| Fabric priority, roadmap advice | Discovery; Lakehouse import; semantic-model queries | Deliver DF-017 discovery first because both data-plane slices depend on its delegated auth and item identity contract |
| PR #376 scope, maintainer approval | Keep combined; split product, assistant, and deployment work; close and replace | Split review surfaces unless Chenglong explicitly prefers a combined integration PR; tenant-specific operations should not define the upstream product contract |
| Long-term ownership, maintainer approval | Upstream maintainers; adaptation owner; shared ownership | Assign an owner and required test/documentation support for each accepted contribution before merge |

## Proposed Meeting Outcome

Record these before closing the discussion. The table is a decision record,
not a second status tracker; implementation status changes belong in
[ISSUES.md](ISSUES.md).

| Decision | Outcome and rationale | Resulting action | Owner | Target date | Canonical update |
| --- | --- | --- | --- | --- | --- |
| Upstream contribution boundaries | Pending | Pending | Pending | Pending | PR plan and `ISSUES.md` |
| Azure SQL connector direction | Pending | Pending | Pending | Pending | DF-016 |
| Shared session backend | Pending | Pending | Pending | Pending | DF-001, DF-016, DF-017 |
| DF-022 migration behavior | Pending | Pending | Pending | Pending | DF-022 |
| Next Fabric slice | Pending | Pending | Pending | Pending | DF-017 through DF-019 |
| PR #376 scope | Pending | Pending | Pending | Pending | PR description and plan |
| Long-term ownership | Pending | Pending | Pending | Pending | Accepted contribution records |

After the meeting, preserve the rationale here once and apply resulting status
or scope changes only to the named canonical records.
