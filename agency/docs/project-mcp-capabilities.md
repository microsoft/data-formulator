<!-- markdownlint-disable MD013 -->

# Project MCP Capabilities

## Purpose

This is the project-facing profile guide for Agency Integration Starter. It
keeps routine project work separate from sensitive M365 content, Service360/SFI
work, and write-capable remediation paths.

Use the broader catalog in [Agency MCP capabilities](agency-mcp-capabilities.md)
when copying the starter to a new project. Use this document when choosing which
profile and local agent should handle a specific task.

## Default Project Priorities

| Project need | Preferred profile | Why |
| --- | --- | --- |
| Normal TPM/project work, internal docs, work tracking, release signals | `project-ops` | Default profile for routine project operations without M365 or ServiceTree content |
| Internal/public documentation lookup only | `project-docs` | Limits the run to EngHub and Microsoft Learn |
| Meeting metadata, recap, notes, or transcript-derived outcome report | `meeting-note-taker` | Launches meeting-oriented M365 surfaces instead of all M365 MCPs |
| People/org context for named owners | `m365-people-context` | Narrow org/user context without mail, files, calendar, or Teams |
| ADO-backed project planning or work tracking | `project-ops` | Keeps ADO available with docs and project context |
| Planner task or plan review | `m365-planner-review` | Keeps Planner separate from broad M365 access |
| Mail or document review | `m365-mail-review` or `m365-doc-review` | Use only if the user explicitly names that source |
| Broad cross-surface M365 investigation | `project-context` | Break-glass only; launches broad M365 surface |
| ServiceTree-only identity, ownership, lifecycle, or subscription binding | `project-servicetree` | Dedicated single-domain route for ServiceTree work |
| Service360/SFI read-only KPI lookup | `project-s360-read` or `project-reports` | Optional route when the project owns Service360/SFI reporting |
| Azure/SFI remediation | `azure-remediate` or `service360-breeze` | Use only for concrete findings after approval |

## Profiles To Use First

| Profile | MCPs | Use in a project | Avoid |
| --- | --- | --- | --- |
| `project-ops` | `ado`, `enghub`, `msft-learn`, `mrc`, `kusto` | Project operating docs, ADO/project work tracking, engineering release signals | M365 content, transcripts, email, chat, files, ServiceTree lifecycle work |
| `project-docs` | `enghub`, `msft-learn` | Internal/public documentation lookup | Ownership, M365 content, remediation |
| `meeting-note-taker` | `calendar`, `teams`, `workiq`, `m365-copilot`, `m365-user` | Named meeting metadata and transcript-derived meeting outcome reports after approval | General research, mail review, file review, Planner work |
| `m365-people-context` | `graph`, `m365-user` | Named people/org lookups for owner mapping | Mail, calendar, Teams, files |
| `m365-mail-review` | `mail`, `m365-user` | Explicitly named thread or mailbox review | Meeting metadata or broad M365 discovery |
| `m365-doc-review` | `onedrive`, `sharepoint`, `word` | Explicitly named file, SharePoint site, or Word document review | Mail, meetings, Planner |
| `m365-planner-review` | `planner`, `m365-user` | Explicitly named Planner plan/task review | General status collection without a plan name |
| `project-context` | Broad M365 surface plus ADO | Break-glass when one task explicitly spans multiple M365 workloads | Default use; single-domain work |

## Optional Specialized Profiles

| Profile | Use only when | Default risk |
| --- | --- | --- |
| `project-servicetree` | ServiceTree lifecycle, identity, ownership, or subscription association work is in scope | Ownership changes can affect service accountability |
| `project-s360-read` | The target project owns Service360/SFI KPI or action-item lookup | Can pull projects toward Service360 work they do not own |
| `project-safety` | The task is explicitly about deployment/security posture review, or a concrete CVE/dependency finding needs `dvdr` | May load security and release surfaces unnecessarily |
| `project-reports` | The target project owns solution-owner or owner/SLA rollups | Often Service360-flavored; do not use for generic project status |
| `azure-remediate` | A concrete Azure/SFI posture finding needs remediation planning (not CVE/dependency-specific — route those to `project-safety`) | Can lead to write-capable flows; parent keeps approval gate |
| `service360-breeze` | A project actively manages Service360/SFI KPIs | Optional plugin surface; inspect before installing persistently |
| `project-connect-tracker` | Weekly Microsoft Connect goal tracking against mail/calendar/Teams/ADO signals | Optional plugin surface (`connect-tracker`, draft certification); review-gated writes only to a local log |
| `project-ado-spec` | The task is generating a Requirement or Implementation Spec doc from a named ADO work item | Optional plugin surface (`requirement-spec-agent`, `implementation-spec-agent`, uncertified); creates a branch + PR and comments on the work item — review before merge |
| `project-incidents` | Incident investigation or on-call/DRI lookup is in scope | `icm` is write-capable (discussion, severity, state); default to read-only investigation |
| `project-fabric` | The project depends on Microsoft Fabric and needs general admin/app-dev/data-engineering/migration work | Template curated from `microsoft/skills-for-fabric`; not yet exercised against a real workspace — verify before relying on it |
| `project-fabric-notebooks` | The task is generating a DQ or data-enrichment PySpark notebook for Fabric/Databricks/Synapse/local Spark | Template (`dq-coworker`, `raw-2-enrich`); verify before relying on it |
| `project-fabric-review` | The task is Power BI/Fabric lineage, semantic model review, or FDA config generation | Template (`tompo-fabriclineage` read-only; `semantic-model-disambiguation` writes to the live model — review first) |
| `project-fabric-security` | The task is PII/PHI detection or de-identification in Fabric-adjacent source data | Template (`MaskIQ`, local file processing, no MCP) |

## Agent Refinement Targets

The active local agent roster lives in [project-agent-roster.md](project-agent-roster.md).

| Agent concept | Profile | Tool boundary |
| --- | --- | --- |
| Meeting note taker | `meeting-note-taker` | Named meeting only; no mail, files, or unrelated Teams chats |
| Feedback collector | `meeting-note-taker` plus repo files | Meeting metadata and local feedback templates; transcript/recap only after approval |
| Owner-map reviewer | `m365-people-context` | People/org context only; live service ownership belongs to parent MCP calls |
| ServiceTree planner | `project-servicetree` | ServiceTree identity, lifecycle, ownership, and subscription binding only |
| Source-of-truth editor support | Local repo tools, optionally `project-docs` | Prefer repo docs; use EngHub/Learn only for external reference checks |
| ADO/project planner | `project-ops` | Use only when ADO org/project/work item scope is named |
| Planner coordinator | `m365-planner-review` | Use only when plan or task scope is named |
| Remediation router | `azure-remediate` or `service360-breeze` output supplied by parent | Recommends a route only; never calls MCPs/plugins or performs the fix |
| Document comprehension reviewer | Local repo docs only | Reads only the named candidate document; no MCP or memory context |

## Current Recommendation

For a new project, refine specialized agents around these defaults:

1. `project-ops` for routine project operations.
1. `meeting-note-taker` for meeting outcome reports.
1. `project-ops` or `m365-planner-review` for ADO/Planner-backed project work when the target is named.
1. `project-docs` for documentation lookup.
1. Route ServiceTree work to `project-servicetree`; route Service360/SFI and remediation work to optional profiles unless the project explicitly owns those responsibilities.
1. Route incident investigation to `project-incidents`, ADO spec generation to `project-ado-spec`, and Connect goal tracking to `project-connect-tracker` — all optional plugin-backed profiles, only when the project explicitly owns that workflow.

## Falsifiability

Revisit by 2026-09-30. Revise this guide if two projects using the starter by
that date need `project-context` as their default path, if narrow M365 profiles
fail to reduce over-broad MCP launches, or if ServiceTree/S360/remediation
profiles turn out to need a different default boundary for generic projects.
