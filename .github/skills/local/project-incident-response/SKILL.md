---
name: project-incident-response
description: "Coordinates Incident Management (IcM) and DRI/on-call MCP access for a project. Use when investigating a live or recent incident, checking on-call/DRI status, or deciding whether an incident finding should become a remediation, exception, or documentation update."
lastReviewed: 2026-07-03
---

<!-- markdownlint-disable MD013 -->

# Project Incident Response

Use this skill when a project depends on the Incident Management (`icm`) or
`smart-dri` MCPs for incident investigation, on-call/DRI lookup, or incident
follow-up work.

## Route The Request

| Request | Default route |
| --- | --- |
| Live or historical incident lookup, discussion, severity, or ownership | `project-incidents` (`icm`) |
| On-call/DRI identification, rotation, or DRI productivity help | `project-incidents` (`smart-dri`) |
| Incident finding needs a remediation, exception, or owner-route decision | `project-remediation-router` for the route, then `azure-remediate` or `service360-breeze` only after the route is justified |
| Deployment/security posture context around the incident | `project-safety` |
| Post-incident status reporting or rollup | `project-status-reporter` with parent-supplied IcM summary |
| Change/rollout correlation for the incident window | `azure-remediate` (`change-ledger`) |

## Safety Rules

- Treat `icm` as write-capable: it can add discussion, change severity, or
  update incident state. Default to read-only investigation; only mutate an
  incident with explicit user request and named incident ID.
- Do not create or close incidents without explicit user approval naming the
  incident.
- Do not use `icm`/`smart-dri` as a substitute for `security-context`,
  `safefly`, or `change-ledger` investigative context; use those MCPs directly
  for posture, deployment, or change-history questions.
- Prefer `agency copilot --profile-only project-incidents` for narrow
  incident tasks so ambient workspace MCP sources are not loaded alongside it.
- Route the finding through `project-remediation-router` before escalating to
  a write-capable remediation profile or plugin.

## Verification

Run:

```powershell
agency copilot --profile-only project-incidents --prompt "List MCP servers and exit. Do not call tools."
agency copilot --mcp icm --prompt "Call only a non-mutating capability check such as listing your assigned or recent incidents. Do not update severity, state, or discussion."
agency copilot --mcp smart-dri --prompt "Call only a non-mutating capability check such as looking up current on-call/DRI status. Do not modify rotations or assignments."
```

Record successful checks in project docs so the next session does not have to
re-discover auth state.

## Would Revise If

Revisit by 2026-09-30. Revise or delete this skill if it fails to prevent an
unapproved incident mutation, or if two projects using the starter need a
substantially different incident-routing model.
