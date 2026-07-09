<!-- markdownlint-disable MD013 -->

# Agency MCP Capabilities

## Purpose

This document is the capability catalog for Agency Integration Starter. It has
two halves:

1. The **Agency MCP surface** configured in [agency.toml](../../agency.toml), so
   project agents can be scoped to the narrowest viable profile instead of
   defaulting to broad tool access.
2. A **Foundry Capability Catalog (On-Need)** inventorying Microsoft Foundry
   product capabilities a project can pull when it actually needs them, rather
   than adopting the whole surface up front.

Together they let a project treat this file as a menu: find the capability, note
its runtime and status, then adopt it through the
[plugin adoption checklist](plugin-adoption-checklist.md) discipline. The
`project-capability-adoption` and `project-foundry-operations` skills route this
process.

For project-facing routing guidance, see [Project MCP capabilities](project-mcp-capabilities.md).

## Source And Evidence Note

This document is based on:

- [.mcp.json](../../.mcp.json): workspace MCP server registrations for repo-discoverable servers.
- [agency.toml](../../agency.toml): Agency profile-to-MCP assignments and plugin wiring.
- [agency/README.md](../README.md): intended profile roles and consent boundaries.
- [tooling-guide.md](tooling-guide.md): default profile selection guidance.
- [m365-transcript-access.md](m365-transcript-access.md): meeting and transcript boundary guidance.

Evidence standard used here:

- `configured`: directly present in [.mcp.json](../../.mcp.json) or [agency.toml](../../agency.toml).
- `inferred`: cautious role description based on profile naming and starter docs, not on direct tool execution.

## Governing Principle

Use the narrowest profile that fits the task. `project-context` is break-glass only.

Why:

- Narrow profiles reduce accidental exposure to unrelated M365 or project data.
- Narrow profiles make agent behavior easier to predict and refine.
- Repo guidance treats transcript, mail, files, and broad M365 access as explicit-consent surfaces.
- Narrow profiles perform better. Loading many MCP servers into one session adds
  real startup and per-turn latency; the more servers a profile launches, the
  slower and less responsive the session gets regardless of whether the task
  ever calls most of them. This is not just a theoretical risk-reduction
  argument — sister repos that split broad profiles into single-purpose ones
  specifically to fix poor session performance confirm this in practice.

Operational rule:

- Start with `project-ops` for ordinary project work.
- Use `project-servicetree` for ServiceTree work rather than loading ServiceTree
  through routine project operations.
- Switch to a task-specific M365 profile for meeting, people, mail, document, or Planner work.
- Use `project-context` only when one task explicitly needs multiple M365 surfaces in one run.
- Use `azure-remediate` only when a remediation target or finding is already explicit.
- Use `service360-breeze` only for Service360 or SFI KPI work.
- Use `project-connect-tracker` only for the weekly Microsoft Connect goal-tracking workflow.
- Use `project-ado-spec` only to generate a Requirement/Implementation Spec doc from a named ADO work item.
- Use `project-incidents` only for incident investigation or on-call/DRI lookup, not as a substitute for `project-safety`.

## Profile To MCP Map

| Profile | Configured MCPs And Plugins | Intended use |
| --- | --- | --- |
| `project-ops` | `ado`, `enghub`, `msft-learn`, `mrc`, `kusto` | Default project operations, docs, work tracking, release or engineering signals |
| `project-docs` | `enghub`, `msft-learn` | Internal and public documentation lookup only |
| `meeting-note-taker` | `calendar`, `teams`, `workiq`, `m365-copilot`, `m365-user` | Named meeting lookup, meeting context, transcript or recap workflow after approval |
| `m365-people-context` | `graph`, `m365-user` | Narrow people and org context |
| `m365-mail-review` | `mail`, `m365-user` | Mailbox or thread review for explicitly named scope |
| `m365-doc-review` | `onedrive`, `sharepoint`, `word` | Review of explicitly named files, libraries, or sites |
| `m365-planner-review` | `planner`, `m365-user` | Planner plans, buckets, goals, and tasks |
| `project-context` | `graph`, `workiq`, `teams`, `mail`, `calendar`, `onedrive`, `sharepoint`, `m365-user`, `m365-copilot`, `planner`, `word`, `ado` | Broad cross-surface M365 break-glass profile |
| `project-servicetree` | `service-tree` | Service ownership lookup only |
| `project-s360-read` | `s360-breeze`, `service-tree` | Read-oriented S360 and ownership context |
| `project-safety` | `security-context`, `safefly`, `change-ledger`, `domain-lens`, `dvdr`, `mrc` | Safety and security context with broader investigative surface than `azure-remediate` |
| `project-reports` | `s360-breeze`, `service-tree` | Reporting with S360 and ownership context |
| `azure-remediate` | `enghub`, `security-context`, `safefly`, `change-ledger`, `service-tree` | Azure or SFI posture remediation once the finding is explicit; route concrete CVE/dependency findings to `project-safety` (`dvdr`) instead |
| `service360-breeze` | `enghub`, `s360-breeze`, `service-tree`, `security-context`, `safefly`, `change-ledger`; plugin `s360-breeze-toolkit` | Service360 and SFI KPI workflows |
| `project-connect-tracker` | `mail`, `calendar`, `teams`, `ado`, `workiq`; plugin `connect-tracker` | Weekly Microsoft Connect goal tracking from M365/ADO signals |
| `project-ado-spec` | `ado`; plugins `requirement-spec-agent`, `implementation-spec-agent` | Generate Requirement/Implementation Spec docs from an ADO work item, delivered via PR |
| `project-incidents` | `icm`, `smart-dri` | Incident investigation and on-call/DRI lookup |
| `project-fabric` | Plugin `skills-for-fabric` (public Copilot CLI bundle; includes a `fabriciq` Power BI Q&A skill — **not** the Fabric IQ ontology product; see [whats-new.md](whats-new.md) 2026-07-08) | General Fabric admin/app-dev/data-engineering/migration work — template, not yet exercised |
| `project-fabric-notebooks` | Plugins `skills-for-fabric`, `dq-coworker`, `raw-2-enrich` | Generate DQ or data-enrichment PySpark notebooks for Fabric — template, not yet exercised |
| `project-fabric-review` | Plugins `tompo-fabriclineage`, `semantic-model-disambiguation`, `semantic-model-fda-creator` | Power BI/Fabric lineage, semantic model review, FDA config — template, not yet exercised |
| `project-fabric-security` | Plugin `MaskIQ` | PII/PHI detection and de-identification in source data — template, not yet exercised |

## Capability Catalog

The table stays conservative. It describes the primary role each MCP appears to
serve in this starter, when to use it, when to avoid it, and the main write or
content risk.

| MCP | Primary capability | Use when | Avoid when | Write or content risk |
| --- | --- | --- | --- | --- |
| `enghub` | Internal EngineeringHub documentation lookup | You need Microsoft internal engineering docs, TSGs, or service-scoped docs | Repo-local docs already answer the question | Low write risk; internal-doc content can still be sensitive |
| `msft-learn` | Public Microsoft Learn documentation lookup | You need public Microsoft product, Azure, or platform reference docs | You need tenant or project-specific data | Low content risk; public read-oriented surface |
| `service-tree` | Service ownership and hierarchy lookup | You need service, org, division, ownership, subscription, or metadata mapping | You need code, mail, meeting, or document content | Medium content risk; org metadata may be sensitive |
| `mrc` | Microsoft Release Communications lookup | You need Azure update or M365 roadmap announcement context | You need ownership, code, or private M365 content | Low to medium content risk; release signals can affect planning |
| `kusto` | Azure Data Explorer query and schema surface | You need KQL queries, schema inspection, diagnostics, or telemetry data | You do not have a concrete cluster/database/query target | High content risk; query results can expose broad operational data |
| `ado` | Azure DevOps project surface | You need work items, repos, pull requests, pipelines, boards, or wikis | Docs or ownership lookup is sufficient | Medium to high write risk if mutation tools are used |
| `calendar` | Outlook and Teams calendar surface | You need a named meeting, meeting time, attendance, or transcript/recap availability | The task is not about a named meeting or calendar window | Medium content risk; calendar metadata is personal work data |
| `teams` | Teams messaging and collaboration surface | A named meeting or Teams context explicitly requires it | Meeting metadata is enough from `calendar` | High content risk if chat, channel, file, or message content is read |
| `workiq` | Broad M365 data access and meeting-context helper | A meeting workflow or repo doc explicitly calls for WorkIQ context | A narrower profile can answer the request | High content risk; broad work-context surface |
| `m365-copilot` | M365 synthesis/search surface | A named meeting or M365 task needs recap or cross-workload synthesis | A single-source MCP can answer without synthesis | High content risk; may traverse or summarize sensitive work data |
| `m365-user` | Entra/user profile and org-chart helper | A task needs user details, manager, direct reports, or multi-user lookup | The task does not need people/org context | Medium content risk; user metadata is sensitive |
| `graph` | Raw Microsoft Graph query surface | You need Graph property discovery or a narrow Graph-backed people/org query | A domain-specific MCP is available | Medium to high content risk depending on query and scopes |
| `mail` | Outlook mailbox surface | The mailbox, sender, thread, or message scope is explicitly named | The task is general research or meeting-only | High content and write risk; can read, draft, send, forward, and modify mail |
| `onedrive` | Personal OneDrive file/folder surface | A file or folder is explicitly named | General browsing is not required | High content and write risk; file content and sharing can be sensitive |
| `sharepoint` | SharePoint site, list, library, and file surface | A site, list, library, or document scope is explicitly named | Repo-local docs are enough | High content and write risk; sites/lists/files can contain sensitive data |
| `word` | Word document content/comment surface | A named Word document needs review, creation, or comments | File metadata is enough | High content and write risk; document content and comments can be sensitive |
| `planner` | Planner plan, goal, and task surface | A plan, goal, or task scope is explicitly named | General status gathering does not require Planner | Medium content and write risk; task data can be sensitive |
| `security-context` | Security posture lookup | A known finding, service, or security question needs posture context | You are only trying to discover whether anything exists | High sensitivity; may expose vulnerabilities, exposures, RBAC, secrets, TLS, attack paths, or assessments |
| `safefly` | SafeFly change and lease request surface | A concrete change, lease, deployment, or approval workflow is in scope | The task is exploratory or not tied to deployment safety | High write/policy risk if change or lease actions are used |
| `change-ledger` | Deployment and change-history correlation surface | You need builds, rollouts, incidents, NFZ schedules, payloads, locations, or service change history | You only need current ownership or docs | Medium content risk; operational history can be sensitive |
| `dvdr` | DVD-R vulnerability remediation surface | A concrete CVE, image, dependency, or remediation finding is in scope | You are still searching for whether there is a finding | High write risk if automated fix or PR creation tools are used |
| `s360-breeze` | Service360 KPI and action-item surface | You need Service360 or SFI KPI context, exceptions, action items, or remediation status | Ordinary project ops can use `project-ops` | Medium content and possible write risk around KPI/action-item state |
| `s360-breeze-toolkit` | Profile-scoped plugin for Service360/SFI workflows | A Service360 workflow explicitly needs plugin agents/skills | MCP-only reporting is sufficient | Unknown to high write risk; inspect plugin behavior before remediation use |
| `domain-lens` | Investigative domain context | A safety/profile task specifically needs domain-lens context | Any task that can use `service-tree`, `security-context`, or docs directly | Unknown sensitivity; treat as investigative/security-adjacent |
| `icm` | Incident Management lookup, discussion, and state | You need to investigate a live or recent incident, its discussion, severity, or ownership | You only need deployment/change history or security posture context | High write risk; can add discussion, change severity, or update incident state |
| `smart-dri` | On-call/DRI lookup and productivity assistance | You need current on-call/DRI identification or rotation context | The task does not involve incident ownership or on-call handoff | Medium risk; may expose on-call schedule/identity data and could support rotation actions |
| `bluebird` | Explicitly disabled in shown starter profiles | Only if a future profile enables it and documents its purpose | Current starter usage | Unknown; treat as unavailable in this baseline |

## Foundry Capability Catalog (On-Need)

Microsoft Foundry capabilities are catalogued here so a project can pull the
right one when it needs it. These are **external product capabilities**, not MCP
servers configured in this starter's [agency.toml](../../agency.toml), and they
run on a **different runtime** — Microsoft Foundry / Foundry Agent Service
(hosted agents, Toolboxes) — not the Agency-CLI profiles above. Treat everything
here as awareness-and-adoption guidance; nothing in these tables is wired into a
starter profile today.

Evidence standard:

- `external`: documented from Microsoft sources ([What's New in Microsoft Foundry, June 2026](https://devblogs.microsoft.com/foundry/whats-new-in-microsoft-foundry-june-2026/) and Microsoft Learn), not exercised from this starter.
- Status uses Microsoft's own labels (GA / public preview / private preview) as of 2026-07-08. Preview labels move fast — re-confirm before relying on any preview item.

### IQ Family (Shared Business And Work Context)

The three "IQ" layers give agents different slices of organizational context.
This starter already wires the `workiq` MCP (Work IQ family) and templates
`project-fabric*` (Fabric IQ territory), so the IQ family is the coherent thing
to track first.

| Capability | What it provides | Status | Pull when | Risk / caveat |
| --- | --- | --- | --- | --- |
| Fabric IQ | Semantic/ontology layer over OneLake (entity types, relationships, data bindings) so agents reason in business language | Preview (Ignite Nov 2025) | A project needs agents grounded in Fabric analytics/ontology; pairs with `project-fabric*` and the `fabriciq-ontology-*` skills | Preview; ontology writes are consequential — use the Preview & Confirm gate. Data may egress per Foundry terms |
| Work IQ | M365 collaboration-signal context (documents, meetings, chats, workflows) | Family (see `workiq` MCP above) | A meeting/collaboration workflow needs cross-M365 context | High content risk; same consent boundaries as `workiq` |
| Foundry IQ | Managed, permission-aware knowledge layer over Azure/SharePoint/OneLake/web | Preview (Build 2026) | An agent needs enterprise retrieval across mixed structured/unstructured sources | Preview; permission-aware but review data-source scoping |

### Foundry Agent Service And Toolboxes

| Capability | What it provides | Status | Pull when | Risk / caveat |
| --- | --- | --- | --- | --- |
| Toolboxes | Runtime layer where hosted agents discover/access/use tools; can expose Skills, Work IQ, Fabric IQ, Browser Automation | Preview | Building a hosted Foundry agent that needs governed, versioned tool access | Preview; MCP endpoint is versioned — pin the version |
| Tool Search | Intent-based tool discovery inside a Toolbox; pin/auto-pin critical tools | Preview | A toolbox grows past a handful of tools (200+ = token bloat, wrong-tool picks) | Preview. Foundry's native answer to this doc's own narrow-profile Governing Principle |
| Routines | Scheduled / triggered / on-demand agent run control | Preview | You need reliable scheduled or event-triggered agent runs instead of a custom scheduler | Preview; `azure-ai-projects>=2.2.0` |
| Publish to M365 Copilot & Teams | One governed pipeline to publish an agent into M365 Copilot and Teams; goal→execution→checkpoints model | GA (Jun 10 2026) | A team wants to consume an agent inside Teams/M365 without per-surface rebuilds | Governed publishing; review org-wide distribution scope |
| Autopilot agents | Agents with their own Entra Agent ID + productivity license (email/calendar/OneDrive/Teams), for shared spaces | Public preview | An ongoing shared-space responsibility (task tracking, follow-ups) rather than 1:1 chat | Preview; a full identity with its own mailbox/calendar — governance-sensitive. Start from the Workstream Manager sample |
| Agent Optimizer | Closed-loop evaluate→generate→rank→deploy tuning for hosted agents | Private preview (public ~Jul 2026) | A production hosted agent needs systematic prompt/skill/model tuning | Preview; requires `azd ai agent init`-scaffolded agents |
| Memory (procedural + TTL) | Procedural memory, management UX, time-to-live retention controls | Preview | An agent must reapply an org procedure consistently, or you need retention controls | Review TTL for personal/time-sensitive data; constructor defaults unset fields to `False` |
| Cross-framework observability / Agent ROI | Framework-agnostic OpenTelemetry tracing + evaluation + ROI | Available | Before optimizing any production agent — wire tracing first | Low risk; the prerequisite for Agent Optimizer |

### Models

| Capability | What it provides | Status | Pull when | Risk / caveat |
| --- | --- | --- | --- | --- |
| Claude in Foundry | Anthropic Claude on Azure (Messages API, prompt caching, extended thinking, tool streaming); usable as an agent reasoning core | GA (Jun 2026) | Migrating Claude workloads onto Azure identity/billing/governance, or wanting Claude as a reasoning core | Data zones (Global/US), zero-data-retention option; billed in Claude Consumption Units |
| MAI models | MAI-Thinking-1, MAI-Image-2.5, MAI-Voice-2, MAI-Transcribe-1.5 | Build 2026 | A first-party reasoning/image/voice/transcription model fits the task | Check per-model availability |

### Runtime, Speech, And SDKs

| Capability | What it provides | Status | Pull when | Risk / caveat |
| --- | --- | --- | --- | --- |
| Foundry Local on Azure Local | Multi-node Kubernetes, air-gapped operation, vLLM runtime, GPU auto-tuning, model caching | Jun 2026 updates | A regulated/air-gapped/sovereign on-prem deployment | Sovereign-cloud variant; YAML schema not broadly live-tested |
| Voice Live API `2026-06-01-preview` | `azure-realtime-native` voice type, client-side echo cancellation reference | Preview | A real-time voice agent on custom audio hardware | Preview feature flags required |
| Foundry SDKs | `azure-ai-projects` — Python/JS-TS 2.2.0, Java 2.1.0 (GA), .NET 2.1.0-beta.4; Hosted Agents/Toolboxes converging off `.beta` | Mixed GA/preview | Programmatic use of hosted agents, Toolboxes, Routines, Memory | Some preview clients need `allow_preview=True` |

**On-need adoption path:** identify the capability, confirm its current status
(preview labels move fast), then apply the
[plugin adoption checklist](plugin-adoption-checklist.md) discipline — problem
first, read the docs, prefer read-only, record the decision — even though these
are product capabilities rather than Agency plugins. The
`project-capability-adoption` and `project-foundry-operations` skills route this.

## Agent Refinement Guidance

- Meeting note taker agents should use `meeting-note-taker` only.
- People researchers should use `m365-people-context`.
- Mail reviewers should use `m365-mail-review`.
- Document reviewers should use `m365-doc-review`.
- Planner coordinators should use `m365-planner-review`.
- Service owner reporters should use `project-servicetree`.
- S360 reporters should use `project-s360-read` or `service360-breeze`.
- Safety or remediation agents should use `project-safety` or `azure-remediate`, and only after the finding is explicit.
- Route remediation findings through `project-remediation-router` first so a write-capable profile/plugin is only loaded once the route is justified.
- Cross-surface M365 investigators may use `project-context`, but only when the user asks for a task that truly spans multiple M365 workloads.

## Recommended Default

For project agent refinement, use this order of preference:

1. Task-specific narrow profile.
1. `project-ops` for ordinary project operations.
1. `project-servicetree`, `project-docs`, `project-s360-read`, or `project-safety` for focused read-oriented project tasks.
1. `azure-remediate` for explicit findings.
1. `service360-breeze` for S360 KPI work.
1. `project-connect-tracker`, `project-ado-spec`, or `project-incidents` only when the project explicitly owns that workflow.
1. `project-context` only as break-glass when one task truly needs multiple M365 surfaces at once.

## Falsifiability

Revisit by 2026-09-30. Revise this catalog if two projects using the starter by
that date route to `project-context` because the narrow profile map is wrong, or
if Agency profile composition changes without this catalog catching the drift.
For the Foundry half, revise when the next monthly Foundry "What's New" ships or
when a preview capability listed here reaches GA (update its status), and delete
the runtime-distinction caveats only once Foundry capabilities become reachable
from an Agency profile (they are not today).
