---
name: project-agency-operations
description: "Coordinates generic project Agency CLI, MCP authorization, M365 consent boundaries, Azure tooling, and Microsoft internal plugin adoption. Use when setting up or auditing Agency profiles, MCP servers, WorkIQ/M365 access, or curated plugins for a project."
lastReviewed: 2026-07-01
---

<!-- markdownlint-disable MD013 -->

# Project Agency Operations

Use this skill when a project depends on Agency CLI, MCP servers, Microsoft 365
context, Azure tooling, or curated marketplace plugins.

## Route The Request

| Request | Default route |
| --- | --- |
| Docs, release signals, Azure safety, ADO, or routine project work | `project-ops` |
| Documentation or TSG lookup only | `project-docs` |
| ServiceTree lifecycle, ownership, identity, or subscription binding | `project-servicetree` with `project-servicetree-planner` |
| Meeting metadata, transcripts, or notes | `meeting-note-taker` with explicit named-meeting consent |
| People/org context | `m365-people-context` with explicit scope |
| Mail review | `m365-mail-review` with explicit thread or mailbox scope |
| File or document review | `m365-doc-review` with explicit file/site scope |
| Planner task review | `m365-planner-review` with explicit plan/task scope |
| Cross-surface M365 work | `project-context` break-glass profile with explicit consent |
| S360/SFI read-only KPI or action-item lookup | `project-s360-read` |
| Solution-owner reports or posture rollups | `project-reports` |
| Azure or SFI remediation | `azure-remediate` |
| Service360 KPI work | `service360-breeze` |
| Weekly Microsoft Connect goal tracking | `project-connect-tracker` |
| Requirement/Implementation Spec generation from an ADO work item | `project-ado-spec` |
| Incident investigation, on-call/DRI lookup | `project-incidents`; see the `project-incident-response` skill |
| Microsoft Fabric work (Lakehouse, notebooks, semantic models, data security) | `project-fabric*` templates; see the `project-fabric-operations` skill |
| Pull one capability on need from the catalog | `project-capability-adoption` skill + [agency-mcp-capabilities.md](../../../../agency/docs/agency-mcp-capabilities.md) |
| Adopt a Microsoft Foundry capability (IQ family, Toolboxes, Tool Search, Routines, autopilot agents, Claude) | `project-foundry-operations` skill — different runtime than Agency profiles |
| Plugin adoption | Run the plugin checklist before install |

## Safety Rules

- Do not read M365 content without a specific request naming the source.
- Do not invoke write-capable remediation plugins without approval.
- Prefer repo profiles to global plugin installs.
- Prefer specialized M365 profiles to `project-context`; do not launch every
  M365 MCP for a single-domain task.
- Keep workspace MCP config focused on tools that are safe for routine project
  operations.
- Prefer `agency copilot --profile-only <profile>` for narrow tasks. It ignores
  ambient workspace MCP sources, including repo `.mcp.json`, and prevents Agency
  from loading every configured MCP server.
- Escalate profiles in this order: `project-docs`, `project-servicetree`, or a
  narrow M365 profile -> `project-ops` -> `project-context` or remediation profiles.

## Verification

Run:

```powershell
./agency/scripts/verify-tooling.ps1
agency copilot --profile-only project-ops --prompt "List MCP servers and exit. Do not call tools."
agency copilot --profile-only meeting-note-taker --prompt "List meeting MCP servers and exit. Do not read content."
```

## Verify Access Safely

Before relying on a specific MCP, run a harmless read-only capability check
instead of assuming auth or wiring is correct:

```powershell
agency copilot --mcp enghub --prompt "Search Engineering Hub for the top result only. Do not edit files."
agency copilot --mcp workiq --prompt "Call only a non-content capability check such as list_agents. Do not read mailbox, calendar, Teams, documents, files, or people data."
```

Record successful checks in project docs so the next session does not have to
re-discover auth state. If a check prompts for auth, complete it in a native
terminal or browser when the embedded terminal hides the flow.

## Would Revise If

Revisit by 2026-09-15. Rewrite or delete this skill if it fails to prevent an
unapproved M365 content read, or if two projects using the starter need a
substantially different routing model.
