---
name: project-foundry-operations
description: "Coordinates on-need adoption of Microsoft Foundry capabilities (IQ family, Toolboxes, Tool Search, Routines, autopilot agents, Agent Optimizer, Memory, Claude, SDKs) for a project building on Foundry Agent Service. Use when evaluating or adopting a Foundry hosted-agent capability."
lastReviewed: 2026-07-08
---

<!-- markdownlint-disable MD013 -->

# Project Foundry Operations

Use this skill when a project builds on **Microsoft Foundry** — hosted agents,
Foundry Agent Service, Toolboxes, or the IQ context family — and needs to pull
the right capability on need.

**Runtime note:** Foundry capabilities are **not** Agency MCP profiles. They run
on Microsoft Foundry / Foundry Agent Service, a different runtime than the
Agency-CLI profiles in [agency.toml](../../../../agency.toml). Nothing here is
wired into a starter profile. This skill routes adoption; it does not
enable a tool in an Agency session. The catalogued inventory lives in the
**Foundry Capability Catalog (On-Need)** section of
[agency-mcp-capabilities.md](../../../../agency/docs/agency-mcp-capabilities.md).

**Status note (2026-07-08):** most Foundry agent capabilities are preview.
Preview labels move fast — confirm current status against Microsoft's docs
before a project depends on any of them. Source:
[What's New in Microsoft Foundry, June 2026](https://devblogs.microsoft.com/foundry/whats-new-in-microsoft-foundry-june-2026/).

## Route The Request

| Request | Default route | Status |
| --- | --- | --- |
| Ground an agent in Fabric analytics / business ontology | **Fabric IQ** (pairs with `project-fabric*` templates and the `fabriciq-ontology-*` skills) | Preview |
| Give an agent M365 collaboration-signal context | **Work IQ** (same consent boundaries as the `workiq` MCP) | Family |
| Permission-aware enterprise retrieval across mixed sources | **Foundry IQ** | Preview |
| Governed, versioned runtime tool access for a hosted agent | **Toolboxes** | Preview |
| A toolbox has grown past a handful of tools and is burning tokens / picking wrong tools | **Tool Search** (describe intent → discover; pin/auto-pin critical tools) | Preview |
| Scheduled / triggered / on-demand agent runs | **Routines** (`azure-ai-projects>=2.2.0`) | Preview |
| Publish an agent into Teams / M365 Copilot without per-surface rebuilds | **Publish to M365 Copilot & Teams** | GA |
| An ongoing shared-space responsibility (group-chat task tracking, follow-ups) | **Autopilot agents** (start from the Workstream Manager sample) | Public preview |
| Systematically tune a production hosted agent | **Agent Optimizer** (needs `azd ai agent init` scaffolding) | Private preview |
| Make an agent reapply an org procedure consistently, or control retention | **Memory** (procedural memory + TTL) | Preview |
| Know whether a production agent is still behaving correctly | **Cross-framework observability / Agent ROI** (wire tracing first) | Available |
| Use Claude as an agent reasoning core on Azure identity/billing | **Claude in Foundry** (Messages API, prompt caching, extended thinking) | GA |

## Adoption Order

Wire the low-risk foundations before the write-capable or identity-bearing
pieces:

1. **Observability first.** OpenTelemetry tracing is framework-agnostic and is
   the prerequisite for evaluation, Agent Optimizer, and ROI. Start here.
2. **Tool Search when a toolbox grows.** At 200+ tools, sending every schema per
   turn burns input tokens and raises wrong-tool-selection odds — this is the
   same problem this starter's narrow-profile
   [Governing Principle](../../../../agency/docs/agency-mcp-capabilities.md)
   exists for, solved natively.
3. **Routines** only once you have an agent that must run on a schedule/trigger.
4. **Optimizer / post-training** last — after tracing and an eval suite exist.

## Safety Rules

- **Autopilot agents get a real identity** — their own Entra Agent ID,
  productivity license, mailbox, calendar, OneDrive, and Teams presence. Treat
  adoption like provisioning a user account: it is governance-sensitive, not a
  tool toggle.
- **Fabric IQ ontology writes are consequential.** Use the
  `fabriciq-ontology-*` skills' mandatory Preview & Confirm gate before any
  ontology write, and do not confuse the Fabric IQ product with the `fabriciq`
  Power BI Q&A skill in `skills-for-fabric`.
- **Preview means no SLA.** Do not put a preview capability on a critical path
  without a fallback and an explicit owner decision.
- **Data-egress awareness.** Connecting agents to Fabric IQ / Foundry IQ may
  send data outside the Azure compliance boundary per the applicable service
  terms; confirm boundaries before wiring production data.
- **Memory retention.** Review TTL for anything touching personal or
  time-sensitive data. Note the current `MemoryStoreDefaultOptions` constructor
  sets unspecified fields to `False` rather than documented defaults.
- Run the
  [plugin adoption checklist](../../../../agency/docs/plugin-adoption-checklist.md)
  discipline even though these are product capabilities, not Agency plugins.

## Would Revise If

Revisit by 2026-09-30, or sooner when the next monthly Foundry "What's New"
ships. Update the status column as preview items reach GA, and revise the
adoption order if a project actually exercises this path and finds a better
sequence. Delete the runtime-distinction caveats only once Foundry capabilities
are reachable from an Agency profile (they are not today).
