<!-- markdownlint-disable MD013 -->

# Project Agent Roster

## Purpose

This roster defines the default local project agents installed by Agency
Integration Starter after the granular Agency MCP profile split. It keeps the
starter focused on project operations, documentation, owner maps, ADO/Planner,
meeting notes, feedback, access checks, triage, and status reporting.

ServiceTree, Service360/SFI, and remediation work are profile capabilities, not
routine project-ops responsibilities. ServiceTree has a dedicated reusable agent
because it has a distinct evidence model and ownership blast radius. Add
project-specific S360 or remediation agents only when the target repo actually
owns those workflows.

## Roster

| Agent | Primary job | Parent MCP/profile route | Use when | Do not use for |
| --- | --- | --- | --- | --- |
| `project-meeting-note-taker` | Draft meeting outcome notes | `meeting-note-taker` output supplied by parent | Named project meetings, decisions, actions, risks | Mail, file review, unrelated Teams chats, raw transcript claims |
| `project-feedback-coordinator` | Synthesize stakeholder feedback into source-of-truth updates | `meeting-note-taker` output plus local repo docs | Feedback cycles, owner-map corrections, readiness before audience summaries | Producing audience summaries before feedback is incorporated |
| `project-owner-map-reviewer` | Check owner-map consistency | `m365-people-context` output supplied by parent | Named-owner accountability checks | Live ServiceTree/S360 ownership or subscription binding |
| `project-servicetree-planner` | Plan ServiceTree identity and ownership work | `project-servicetree` output supplied by parent | Service identity, ownership, lifecycle, or subscription-binding planning | Service360 KPI work, remediation, or live ServiceTree mutation |
| `project-ado-planner` | Align local plans to ADO/Planner shape | `project-ops` or `m365-planner-review` output supplied by parent | Work item, milestone, backlog, or plan/task mapping | Creating or updating live ADO/Planner items directly |
| `project-docs-researcher` | Ground answers in local docs plus EngHub/Learn summaries | `project-docs` or `project-ops` output supplied by parent | Agency, ADO, Planner, or Microsoft process doc questions | M365 content reads or remediation research |
| `project-status-reporter` | Produce project status and stakeholder rollups | Parent-supplied ADO/Planner/meeting summaries | Project progress reporting after source docs are current | Service360, ServiceTree, remediation, or pre-feedback summaries |
| `project-triager` | Convert repo evidence into next-action briefs | Parent-supplied evidence; usually local repo or `project-ops` | Ambiguous project issue needs focused next step | Live MCP calls, irreversible actions |
| `project-tool-access-manager` | Audit Agency/MCP/local tool readiness | Local config and docs only | Profile choice, auth state, verification commands | Running commands, authenticating, reading M365 content |
| `project-remediation-router` | Recommend the narrowest safe remediation path for a finding, without remediating | Parent-supplied evidence from `azure-remediate`, `service360-breeze`, or a docs/ownership profile | A finding needs a route decision (local fix, azure, plugin, owner-route, exception, close) before a write-capable profile/plugin loads | Performing the fix, calling MCPs/plugins directly, or approving writes |
| `project-document-comprehension-reviewer` | Adversarially check whether a document is understandable with no outside context | Local repo docs only; no MCP or memory context | Before sending, sharing, or using any document as stand-alone pre-read or source material | Grading visual polish, rewriting the document, or filling gaps from project knowledge |

## Not Default Local Agents

These responsibilities stay out of the starter's default local agent roster:

- Service360/SFI KPI reporting
- write-capable remediation or plugin execution

`project-remediation-router` recommends a route; it never calls MCPs/plugins or
performs the fix itself, so it stays in the default roster as a read-only gate
in front of `azure-remediate`/`service360-breeze`.

Use `project-s360-read`, `project-reports`, `project-safety`,
`azure-remediate`, or `service360-breeze` profiles only when a target project
explicitly owns that work. If a repo repeatedly needs one of those flows, add a
project-local agent with a narrow role and read-only tool allowlist — for
example, a solution/SLA rollup reporter or a subscription-finding triager
specialized from `project-status-reporter`/`project-triager`.

## Operating Rules

- Agents do not call MCPs directly. The parent supplies approved live-tool summaries.
- Prefer narrow profiles from [Project MCP capabilities](project-mcp-capabilities.md).
- Use `meeting-note-taker` for meeting work, not broad `project-context`.
- Use `project-servicetree` for ServiceTree work, not broad `project-ops`.
- Use `project-ops` for routine project operations and ADO-backed project context.
- Use `m365-planner-review` for explicitly named Planner plans/tasks.
- Use `project-context` only as break-glass when a task truly spans multiple M365 surfaces.
- Use `project-incidents` for incident investigation and on-call/DRI lookup, not `project-safety` (deployment/security posture) or `project-remediation-router` (route decision after a finding already exists).
- Do not create audience-specific summaries until feedback is incorporated into the source-of-truth docs.

## Falsifiability

Revisit by 2026-09-30. Revise this roster if two projects using the starter by
that date route to the wrong default local agent, if a removed ServiceTree/S360
or remediation local agent boundary proves wrong, or if the Agency profile model
changes.
