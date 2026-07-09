---
name: project-capability-adoption
description: "Guides on-need adoption of an Agency MCP or Microsoft Foundry capability from the starter's capability catalog. Use when a project asks 'can we use X', 'should we adopt X', or needs to pull a specific tool/profile/Foundry capability without loading the whole surface."
lastReviewed: 2026-07-08
---

<!-- markdownlint-disable MD013 -->

# Project Capability Adoption

Use this skill when a project wants to pull a single capability on need —
an Agency MCP, an Agency profile, a curated plugin, or a Microsoft Foundry
capability — instead of adopting the whole tool surface up front.

The source of truth is the catalog in
[agency-mcp-capabilities.md](../../../../agency/docs/agency-mcp-capabilities.md):

- **Agency MCP surface** — the Profile-to-MCP map and Capability Catalog (MCPs
  configured in [agency.toml](../../../../agency.toml)).
- **Foundry Capability Catalog (On-Need)** — Microsoft Foundry product
  capabilities (IQ family, Toolboxes, Tool Search, Routines, autopilot agents,
  Agent Optimizer, Memory, Claude, SDKs). These run on a **different runtime**
  than Agency profiles and are awareness/adoption guidance, not wired into any
  starter profile.

## Route The Request

| Request | Default route |
| --- | --- |
| "Which profile/MCP do I use for task X?" | [agency-mcp-capabilities.md](../../../../agency/docs/agency-mcp-capabilities.md) Profile-to-MCP map; prefer the narrowest matching profile |
| "Can we adopt Fabric work / semantic models / notebooks?" | `project-fabric-operations` skill + the `project-fabric*` templates |
| "Can we adopt a Foundry capability (Toolboxes, Tool Search, Routines, autopilot agents, IQ family, Claude)?" | `project-foundry-operations` skill + the Foundry Capability Catalog |
| "Should we install this curated plugin?" | [plugin-adoption-checklist.md](../../../../agency/docs/plugin-adoption-checklist.md) |
| "Is this GA or preview?" | Check the status column in the catalog, then re-confirm against Microsoft's current docs — preview labels move fast |

## On-Need Adoption Steps

1. **Name the active problem.** Do not adopt a capability speculatively. If no
   current task needs it, record it as a candidate and stop.
2. **Find it in the catalog.** Locate the row in
   [agency-mcp-capabilities.md](../../../../agency/docs/agency-mcp-capabilities.md).
   Note its runtime (Agency MCP profile vs. Foundry), status, and the "Pull
   when" / "Use when" trigger.
3. **Confirm status.** For anything marked preview, re-check Microsoft's current
   docs before relying on it. Preview items ship without an SLA and can change.
4. **Prefer the narrowest, read-only path first.** For Agency work, use
   `agency copilot --profile-only <profile>`. For Foundry work, prefer
   observability/read paths before write-capable or identity-bearing ones
   (autopilot agents, live ontology writes).
5. **Run the plugin adoption checklist** where a plugin is involved
   ([plugin-adoption-checklist.md](../../../../agency/docs/plugin-adoption-checklist.md)):
   inspect the README, list agents/skills, check write/PR/external-call
   behavior, install through a profile not globally.
6. **Record the decision** in the project's own docs (and, if this starter is
   being evolved, in [whats-new.md](../../../../agency/docs/whats-new.md)). The
   additive-merge installer cannot distinguish "never adopted" from
   "deliberately declined," so a declined capability must be recorded to survive
   a future merge.

## Safety Rules

- Foundry capabilities are a **different runtime** than Agency profiles. Do not
  imply a Foundry capability is available through `agency.toml` — it is not.
- Preview status is not a green light. Confirm current status and data-handling
  terms before a project depends on a preview capability.
- Identity-bearing capabilities (Foundry autopilot agents get their own Entra
  Agent ID, mailbox, calendar, and Teams presence) are governance-sensitive.
  Treat their adoption like provisioning a new user account, not enabling a
  tool.
- Live-write capabilities (Fabric IQ ontology authoring, semantic-model fixes,
  remediation plugins) require review-before-apply. Prefer their Preview &
  Confirm gates.
- Keep sessions narrow. Adopting one capability is not a reason to load an
  unrelated profile or toolbox alongside it.

## Would Revise If

Revisit by 2026-09-30. Revise or delete this skill if the catalog structure in
[agency-mcp-capabilities.md](../../../../agency/docs/agency-mcp-capabilities.md)
changes, or if two projects using the starter adopt a capability without going
through the catalog because the routing here was unclear.
