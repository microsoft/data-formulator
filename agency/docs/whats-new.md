<!-- markdownlint-disable MD013 -->

# What's New

## Purpose

Changelog for Agency Integration Starter. Track what changed and why, so
projects that already merged the starter know what to re-pull.

## 2026-07-13 — Hardened install preflight and made verification enforceable

- The installer now validates all required starter files and target JSON before
  writing anything. Invalid `.mcp.json` or applicable
  `.vscode/extensions.json` files fail fast instead of leaving a partial
  installation.
- Existing `[mcps]` tables that omit `include_mcps_from_workspace` now receive
  the starter's required `false` value. Ignored, untracked VS Code extension
  files remain outside the installer's scope.
- Verification now exits nonzero for missing or outdated dependencies, missing
  extensions, failed native commands, invalid/missing snapshots, and recorded
  version drift. Verification-only mode no longer invokes the Agency VS Code
  updater, and PATH refresh preserves process-local entries.
- Added Pester regression coverage for dry-run safety, idempotency, merge
  behavior, preflight failures, ignored files, and verifier exit status. A
  Windows GitHub Actions workflow runs the suite for pushes and pull requests.
- Refreshed the starter's `agency/VERSION.json` after verifying Agency
  `2026.7.9.1`, Azure CLI `2.88.0`, and the remaining recorded toolchain.

## 2026-07-08 — Added an all-up root README, refreshed the project-facing README

Split the two README audiences cleanly:

- New root [README.md](../../README.md) — the all-up maintainer overview of the
  starter repo (layout, core concepts, the 5 skills, the 11 agents, install
  flow, and maintenance rules). It is **intentionally not copied into target
  projects**: it's not in the installer's additive list, and
  [Install-AgencyStarter.ps1](../../Install-AgencyStarter.ps1) now carries an
  explicit comment saying so, alongside the existing `VERSION.json` exclusion.
  The project-facing README stays [agency/README.md](../README.md).
- Refreshed [agency/README.md](../README.md): the "What This Gives You" section
  now names the full routing-skill set and the two-half capability catalog
  (Agency MCP surface + Foundry), and Related Docs now links the capability
  catalog and this changelog.

Deliberately kept the root README free of inbound links from `agency/README.md`
so no link breaks once the project-facing README is merged into a target repo
that has no root README.

## 2026-07-08 — Harmony pass across all skills and agents

Reviewed all 5 local skills and 11 local agents for consistency after adding
the capability catalog and adoption skills. Overall they were already aligned
(uniform frontmatter, every agent read-only with the parent supplying live-tool
summaries, roster matching the files). Closed two real gaps:

- The hub skill `project-agency-operations` routed to `project-incident-response`,
  `project-capability-adoption`, and `project-foundry-operations` but not
  `project-fabric-operations`. Added a Microsoft Fabric routing row so the hub
  points to every specialized skill.
- The [agency/README.md](../README.md) "Tooling Map" brain diagram showed only
  two skills. Added an "Adoption Skills" subgraph with `project-fabric-operations`,
  `project-capability-adoption`, and `project-foundry-operations`, and extended
  the `brain` class list to match. Diagram re-validated.

No agent or skill contents needed behavioral changes — the review confirmed the
read-only/parent-supplied-evidence model, the narrow-profile routing, and the
Foundry runtime-distinction caveats are consistent across the set.

## 2026-07-08 — Turned the capabilities doc into a two-half catalog + added adoption skills

Made [agency-mcp-capabilities.md](agency-mcp-capabilities.md) a proper on-need
catalog with two halves: the existing **Agency MCP surface** (profiles +
capability table) and a new **Foundry Capability Catalog (On-Need)** inventorying
Microsoft Foundry product capabilities from the June 2026 release scan. The
Foundry half is organized into IQ family (Fabric IQ / Work IQ / Foundry IQ),
Foundry Agent Service & Toolboxes (Toolboxes, Tool Search, Routines, publish-to-
Teams GA, autopilot agents, Agent Optimizer, Memory, observability), Models
(Claude GA, MAI), and Runtime/Speech/SDKs. Each row carries status (GA/preview),
a "Pull when" trigger, and a risk/caveat. Every entry is explicitly flagged as a
**different runtime** than the Agency-CLI profiles and not wired into any
`agency.toml` profile — awareness/adoption guidance, not activation.

Added two local skills to route the adoption process:

- `project-capability-adoption` — general on-need pull workflow: name the
  problem, find it in the catalog, confirm status, prefer the narrowest read-only
  path, run the plugin checklist, record the decision (including *declined*
  decisions, since the additive-merge installer can't tell "never adopted" from
  "deliberately declined").
- `project-foundry-operations` — Foundry-specific routing (mirrors
  `project-fabric-operations`): a request→capability table, an adoption order
  (observability first, Tool Search when a toolbox grows, Routines, then
  Optimizer/post-training last), and safety rules for identity-bearing autopilot
  agents, live ontology writes, preview/no-SLA status, and data egress.

Kept everything in sync to avoid the additive-merge drift this repo guards
against: registered both skills in
[Install-AgencyStarter.ps1](../../Install-AgencyStarter.ps1)'s additive file
list, added both to [agency/README.md](../README.md)'s Local Skill And Agents
table, and cross-referenced them from the `project-agency-operations` skill's
routing table. Extended the capabilities doc's Falsifiability check to cover the
Foundry half (revise on each monthly Foundry "What's New" or when a preview item
reaches GA).

## 2026-07-08 — Scanned Fabric IQ + Microsoft Foundry (June 2026) releases for adoption

Checked recent Microsoft releases against this starter, triggered by "adopt
Fabric IQ." Two threads: the Fabric IQ product line and the June 2026 Foundry
drop ([What's New in Microsoft Foundry, June 2026](https://devblogs.microsoft.com/foundry/whats-new-in-microsoft-foundry-june-2026/)).

**Fabric IQ naming collision fixed.** [agency-mcp-capabilities.md](agency-mcp-capabilities.md)
described `project-fabric` as bundling "the `FabricIQ` MCP." That conflated two
different things:

- `fabriciq` in `microsoft/skills-for-fabric` is a **Power BI Q&A skill** (queries
  reports/dashboards through a "FabricIQ MCP endpoint"), added in skills-for-fabric
  v0.3.2.
- **Fabric IQ** (the Microsoft product, preview since Ignite Nov 2025) is a
  semantic/ontology layer over OneLake — a Fabric *workload*, not an MCP. Its
  actual CLI support arrived later as two skills in skills-for-fabric v0.3.5
  (2026-06-25): `fabriciq-ontology-authoring-cli` and
  `fabriciq-ontology-consumption-cli` (create/evolve ontology items; consume
  them for agent grounding; mandatory Preview & Confirm gate before any write).

Corrected the capabilities doc to distinguish them.

**`skills-for-fabric` has drifted since the 2026-07-03 template notes.** Now at
v0.3.6 (2026-07-02) and distributed as **GitHub Copilot CLI plugin bundles**
(`/plugin marketplace add microsoft/skills-for-fabric` → `fabric-skills`,
`fabric-authoring`, `fabric-consumption`, `fabric-operations`,
`powerbi-authoring`) — a different install path than the Agency-CLI
`github:microsoft/skills-for-fabric:.` wiring the `project-fabric*` templates
assume. New since our notes: the two Fabric IQ ontology skills above,
`mlv-operations-cli` (Materialized Lake View scheduling), four `powerbi-report-*`
skills, and `semantic-model-authoring`/`-consumption` (renamed from
`powerbi-*-cli`). Left the templates as-is (still unexercised) but flagged the
install-mechanism change; re-validate before the Fabric-heavy project relies on
them.

**Foundry June 2026 — relevance triage.** Most items target Foundry Agent
Service / hosted agents, a different runtime than this starter's Agency-CLI MCP
profiles, so they're awareness rather than immediate adoption:

- **Validates our own thesis:** *Tool Search* in Toolboxes (preview) is
  Foundry's native answer to the exact problem this starter's narrow-profiles
  rule exists for — at 200+ tools, sending every schema per turn burns tokens
  and raises wrong-tool-selection odds. It reinforces the
  [agency-mcp-capabilities.md](agency-mcp-capabilities.md) Governing Principle;
  the Foundry mechanism (describe intent → discover tools, with pin/auto-pin) is
  the pattern to watch if profiles ever move onto a Toolbox runtime.
- **IQ-family alignment:** Toolboxes now expose **Work IQ** and **Fabric IQ** as
  tools. This starter already wires the `workiq` MCP and has `project-fabric*`
  templates, so the IQ family (Fabric IQ / Work IQ / Foundry IQ) is the coherent
  target to keep tracking.
- **Awareness only (no `agency.toml` change today):** Routines (scheduled/
  triggered agent runs), Foundry autopilot agents + M365/Teams publishing GA
  (agents with their own Entra Agent ID), Agent Optimizer (private preview),
  procedural memory + TTL controls, Claude GA in Foundry.
- **Not applicable:** Foundry Local on Azure Local, Voice Live API, SDK
  changelogs.

No profiles activated and no plugins installed — everything here is preview-stage
and/or on a different runtime. Recorded so the next Fabric/agent-distribution
project starts from the corrected picture.

## 2026-07-03 — Harmonized sister-repo agents/skills, found an installer gotcha

Auditing skills/agents across `msft-career` and Service360 found a real
regression: `msft-career`'s own `project-agent-roster.md` documented
`project-servicetree-planner` and `project-remediation-router` as
**deliberately removed** (those responsibilities belong in the Service360
sister repo) — but the earlier `Install-AgencyStarter.ps1 -Apply` run silently
restored both, because the installer only checks whether a file already
exists, not whether it was intentionally deleted. Also re-added a generic
`project-feedback-coordinator` that duplicated msft-career's existing
FTE-specific one.

Fixed in `msft-career`: removed all three files again, fixed
`project-incident-response`'s dangling references to the now-absent
`project-remediation-router` (routes to the Service360 sister repo instead,
matching this repo's existing pattern), and extended the roster's "Removed
From This Repo" section to cover the feedback-coordinator decision too so a
future merge doesn't silently undo it again.

Documented the general gotcha in [tooling-guide.md](tooling-guide.md)'s
Operating Rules: this additive-merge installer can't distinguish "never
installed" from "deliberately removed," so any project that intentionally
drops a starter agent/skill should record that decision in its own
`project-agent-roster.md`, the way `msft-career` now does.

Service360 checked clean — no equivalent regression (it has no roster doc to
violate, and its `service360-fabric-operations` skill's references to the
starter's `project-fabric-operations` are legitimate attribution links, not
naming mistakes).

## 2026-07-03 — Verified the Fabric template live, added Jupyter/Python extensions

Actually exercised `project-fabric-review` against a real Power BI/Fabric
workspace (read-only). Confirmed: the profile's 3 plugins load correctly, and
`semantic-model-disambiguation`'s bundled `PowerBI Modeling MCP` comes online
with 20 tool groups (connection/database/model/table/column/measure/
relationship/DAX-query operations, etc.). Also confirmed `tompo-fabriclineage`'s
skill loads but its own lineage tools do **not** appear in the session — this
verifies the skill's caveat that it needs the separate manual `tompo-mcp` setup
and isn't usable through `agency.toml` wiring alone.

Since the Fabric profiles generate PySpark notebooks, added
`ms-toolsai.jupyter` and `ms-python.python` to the recommended VS Code
extensions (`.vscode/extensions.json`, `verify-tooling.ps1`) for editing/running
the generated notebooks. Installed and verified via
`verify-tooling.ps1 -Install -UpdateVersionFile`.

Follow-up: retried the connection using the workspace's **display name**
(`Fishbowl_CMP`) instead of the GUID from the portal URL, which fixed the
initial "workspace not found" error. Full read-only analysis succeeded:
2 semantic models found (`Pipeline Health Dashboard` — 2 tables, 0
relationships, 26 measures, DirectLake; `API Monitoring Dashboard with Risk
analysis` — 9 tables, 4 relationships, 29 measures, Import mode). Confirms
`project-fabric-review` works end-to-end for real semantic-model review.
Updated the skill's MCP Wiring Notes with this confirmed connection pattern
(workspace GUID from a portal URL does not work as a connection identifier;
use the display name).

## 2026-07-03 — Added a Microsoft Fabric profile template

Curated Fabric-related MCPs, skills, and plugins for an upcoming Fabric-heavy
project: reviews, security checks, and notebook creation. Agency's own MCP
catalog has nothing Fabric-specific; the real foundation is the public
[`microsoft/skills-for-fabric`](https://github.com/microsoft/skills-for-fabric)
repo (Fabric agents, 30 skills, and the `FabricIQ` MCP), plus several curated
marketplace plugins. Added as a template, not activated by default, since it
has not been exercised against a real Fabric workspace yet:

- `project-fabric` \u2014 general work via `skills-for-fabric` alone.
- `project-fabric-notebooks` \u2014 `skills-for-fabric` + `dq-coworker` (DQ-check
  PySpark notebooks) + `raw-2-enrich` (data-enrichment notebooks).
- `project-fabric-review` \u2014 `tompo-fabriclineage` (read-only lineage/impact
  analysis), `semantic-model-disambiguation` (live-model fixes, review first),
  `semantic-model-fda-creator` (FDA config generation).
- `project-fabric-security` \u2014 `MaskIQ` (PII/PHI detection, local files only,
  no MCP).

Kept as 4 narrow profiles rather than one bundle, per today's own
performance-narrowing lesson. Added the `project-fabric-operations` skill
documenting routing, MCP wiring caveats, and safety rules (`tompo-fabriclineage`
needs a separate manual `tompo-mcp` setup outside `agency.toml`;
`semantic-model-disambiguation` writes to the live model).

**Caught and fixed while testing**: the plugin spec `github:owner/repo` without
a trailing `:path` does not mean "whole repo at owner/repo" \u2014 Agency CLI
instead treats the whole string as a path *within the current ambient git
repo* and silently resolves to the wrong plugin (`agency config list` showed
`github:fabioc-aloha/Agency-Integration-Starter:microsoft/skills-for-fabric`
instead of the intended public repo). Fixed by using `github:microsoft/skills-for-fabric:.`
(explicit `.` for repo-root path) \u2014 verified this resolves correctly.

None of these plugins carry a governance/certification block; run the
[plugin adoption checklist](plugin-adoption-checklist.md) before relying on
any of them for real work, and update the skill's caveats once the new
project actually exercises this template.

## 2026-07-03 — Narrowed profiles using battle-tested sister-repo evidence

The Service360 sister repo split a broad profile into single-purpose ones
specifically to fix poor session performance — narrow profiles aren't just a
risk/consent argument, loading fewer MCP servers measurably reduces session
latency. Compared this starter's profiles against Service360's validated
equivalents and narrowed two that carried MCPs their sister-repo counterparts
had already dropped:

- `azure-remediate`: removed `msft-learn` (public docs rarely needed
  mid-remediation; `enghub` already covers internal TSGs) and `dvdr` (CVE/
  dependency-specific — `project-safety` already carries `dvdr` for that,
  matching Service360's `s360-safety`). Now 5 MCPs (`enghub`,
  `security-context`, `safefly`, `change-ledger`, `service-tree`), down from 7.
  Route concrete CVE/dependency findings to `project-safety` instead.
- `service360-breeze`: removed `msft-learn` for the same reason. Now 6 MCPs
  (`enghub`, `s360-breeze`, `service-tree`, `security-context`, `safefly`,
  `change-ledger`) + the `s360-breeze-toolkit` plugin, matching Service360's
  own `s360-remediate` profile almost exactly (minus their S360-specific
  `s360-breeze` inclusion, which this starter already has).
- `project-safety` needed no change — it already matches Service360's
  `s360-safety` MCP set exactly (6 MCPs).
- Added an explicit "performance" rationale to [agency-mcp-capabilities.md](agency-mcp-capabilities.md)'s
  Governing Principle, alongside the existing risk/consent reasons.

Next: consider auditing the sister repos themselves for the reverse gap (they
are missing `project-connect-tracker`/`project-ado-spec`/`project-incidents`
equivalents and the full `agency/docs/` catalog) as a separate follow-up.

## 2026-07-03 — Documented Windows as a requirement

Confirmed this starter is Windows-only today, not just "the scripts happen to
be .ps1": `verify-tooling.ps1`'s `-Install` path uses `winget` (no macOS/Linux
equivalent) and reads Machine/User-scoped environment variables (throws
`PlatformNotSupportedException` on non-Windows .NET). Agency CLI's own
macOS/Linux availability is also unconfirmed. Added a "Requirements" section
to the top of [agency/README.md](../README.md) stating this plainly rather than
silently letting a macOS/Linux user hit a confusing crash mid-install.

## 2026-07-03 — Refreshed the top-level README

The harmonization pass covered docs/agents/skills but missed
[agency/README.md](../README.md)'s own Mermaid "Tooling Map" diagram and "What
This Gives You" bullet — both were stale relative to everything added this
session. Updated:

- Diagram: added `project-connect-tracker`, `project-ado-spec`, and
  `project-incidents` to the Profiles subgraph; `IcM and SmartDRI` to the MCPs
  subgraph; `connect-tracker` and `requirement-spec-agent`/
  `implementation-spec-agent` to the Plugins subgraph (marked adopted, vs. the
  still-candidate `deployment-safety`/`codeql-fix`/`security-vulnerability-autofix`);
  and `project-remediation-router`, `project-document-comprehension-reviewer`,
  and the `project-incident-response` skill to the Local Project Brain subgraph.
- "What This Gives You" bullet now mentions Connect goal tracking, ADO spec
  generation, and incident/on-call lookup.
- Added a `project-incidents` example to the Quick Start CLI block.

Confirmed [setup-github-emu-agency.md](setup-github-emu-agency.md) and
[m365-transcript-access.md](m365-transcript-access.md) needed no changes — both
use illustrative profile examples rather than an exhaustive list.

## 2026-07-03 — Expanded recommended VS Code extensions

Reviewed [.vscode/extensions.json](../../.vscode/extensions.json) against what
this starter's own tooling actually depends on. Added four extensions and kept
[verify-tooling.ps1](../scripts/verify-tooling.ps1)'s check/install list and
[agency/README.md](../README.md) in sync so all three don't drift apart:

- `ms-vscode.powershell` — the installer and verification scripts are 100% PowerShell.
- `tamasfe.even-better-toml` — `agency.toml` is the most frequently edited file in this repo.
- `davidanson.vscode-markdownlint` — every doc carries an inline `<!-- markdownlint-disable MD013 -->` directive.
- `github.vscode-pull-request-github` — `gh` is a required tool, and the ADO spec-agent plugins and marketplace workflows are PR-centric.

Verified all four IDs by running `verify-tooling.ps1 -Install -UpdateVersionFile`;
all installed successfully and are now reflected in `agency/VERSION.json`.

## 2026-07-03 — Harmonization pass across agents, MCPs, and skills

Audited every profile in [agency.toml](../../agency.toml) against
[Install-AgencyStarter.ps1](../../Install-AgencyStarter.ps1)'s additive file
list, [agency/README.md](../README.md), and all docs/skills for drift. Found
and fixed: `agency/README.md`'s profile and local-artifact tables were missing
everything added this session; `tooling-guide.md` had the same gap;
`project-agency-operations`'s routing table was missing two profiles;
`project-triager` and `project-remediation-router` had overlapping scope with
no cross-reference; `project-ado-planner` and `project-ado-spec` had no
boundary distinguishing read-only alignment from write-capable spec
generation; and `whats-new.md` itself was missing from the installer's
additive file list. All fixed; `agency.toml` re-verified to still parse.

## 2026-07-03 — Added incident management profile and skill

Reviewed Agency's native built-in MCP catalog (`agency mcp --help`), not just
the curated plugin marketplace, and found `icm` (Incident Management) and
`smart-dri` (on-call/DRI assistant) unwired in every profile. Added:

- `project-incidents` profile (`icm`, `smart-dri`) in [agency.toml](../../agency.toml).
- `project-incident-response` skill documenting routing, safety rules (treat
  `icm` as write-capable — discussion/severity/state changes require an
  explicit named incident), and read-only verification commands.
- Capability catalog entries for `icm`/`smart-dri` in
  [agency-mcp-capabilities.md](agency-mcp-capabilities.md) and
  [project-mcp-capabilities.md](project-mcp-capabilities.md), and a routing row
  in the `project-agency-operations` skill.

Other unwired native MCPs reviewed but not added: `atlas` (description
identical to `graph` — likely a rebrand/successor, flagged for confirmation
rather than treated as additive), `ecs`, `engage`, `es-chat`, `fluent`,
`cloudbuild`, `perf-pas`, `watson`, `top` (all too niche or product-specific
for a generic starter), and `logger` (a plugin-support telemetry hook, not a
standalone capability).

## 2026-07-03 — Adopted ADO spec-generation plugins

Screened the curated marketplace for Azure DevOps integration agents/plugins.
Adopted `requirement-spec-agent` and `implementation-spec-agent`, scoped to a
new `project-ado-spec` profile (`ado` MCP only). Each generates a
Requirement/Implementation Spec markdown doc from a named ADO work item and
delivers it via branch + PR with a work-item comment — docs-only writes,
reviewed before merge. Neither plugin's manifest carries a governance/
certification block (uncertified); re-check before pipeline/autopilot use. See
[plugin-adoption-checklist.md](plugin-adoption-checklist.md).

Reviewed but not adopted from the same scan: `review-swarm` and `code-review`
(both `certification: review`, overlapping ADO PR-review coverage — worth a
closer look if a project needs automated PR review specifically) and
`pr-impact-advisory` (needs `kusto` and `bluebird`; this starter deliberately
keeps `bluebird` disabled in every profile). `mirs-tag-adoption-agent` is a
narrow internal tag-compliance tool, not general ADO integration — skipped.

## 2026-07-03 — Generalized from sister-repo customizations

Reviewed profile/agent/skill customizations made downstream in the `Service360`
and `msft-career` sister repos to find patterns worth pulling back into the
starter.

### Adopted

- Added `project-remediation-router` agent (generalized from Service360's
  `service360-remediation-router`): recommends the narrowest safe next path for
  a finding (`local`, `azure`, `plugin`, `owner-route`, `exception`, `close`, or
  `needs more evidence`) before a write-capable profile/plugin loads. Read-only;
  never calls MCPs/plugins itself.
- Added `project-document-comprehension-reviewer` agent (adopted as-is from
  msft-career; it was already generic): adversarially checks whether a document
  is understandable with no outside context before it is shared.
- Added a "Verify Access Safely" section to the `project-agency-operations`
  skill (generalized from Service360's per-MCP smoke-test pattern): harmless
  read-only capability checks (`agency copilot --mcp <name> --prompt "..."`) to
  confirm auth/wiring before relying on a tool.
- Adopted the `connect-tracker` plugin from the curated marketplace, scoped to
  a new `project-connect-tracker` profile (see below and
  [plugin-adoption-checklist.md](plugin-adoption-checklist.md)).

### Reviewed, not adopted

- `service360-solution-reporter` and `service360-subscription-triager`: useful
  patterns, but tied to Service360/SFI-specific report shapes (solution/SLA
  rollups) and vocabulary. Left documented as optional specializations of
  `project-status-reporter`/`project-triager` for projects that explicitly own
  that work, rather than added to the default roster.
- `project-fte-feedback-coordinator` (msft-career): fully project-specific
  (named individuals, FY27 Capgemini plan, fixed dates) — confirms the
  existing generic `project-feedback-coordinator` is the right default; nothing
  to generalize back.
- msft-career's `project-ops` profile merges `service-tree = true` directly
  into the routine profile instead of using the dedicated
  `project-servicetree` profile. This contradicts the starter's narrow-profile
  governing principle (see [agency-mcp-capabilities.md](agency-mcp-capabilities.md))
  and was flagged, not adopted.

## Documentation Check Status

- Repo is up to date with `origin/main` (checked 2026-07-03; no unpulled commits).
- Docs in [agency/docs](.) are internally consistent with [agency.toml](../../agency.toml)
  and the current local agent/skill roster — no stale profile or version
  references found.
- Tooling snapshot in `agency/VERSION.json` was refreshed 2026-07-03
  (Agency CLI updated `2026.6.30.10` → `2026.7.2.3`; all other tools and
  extensions already current).

## 2026-07-01 — Starter scaffold and first hardening pass

### Agency profiles

- Split the single broad Agency profile into narrow, task-specific profiles
  (`project-ops`, `project-docs`, `project-servicetree`, `project-s360-read`,
  `project-safety`, `project-reports`, and per-M365-surface profiles), with
  `project-context` reserved as a break-glass profile. See
  [agency-mcp-capabilities.md](agency-mcp-capabilities.md) and
  [project-mcp-capabilities.md](project-mcp-capabilities.md).

### Local agents and skill

- Added a specialized roster of local project agents (ADO/Planner planning,
  ServiceTree planning, owner-map review, meeting notes, feedback
  coordination, status reporting, triage, tool-access auditing). See
  [project-agent-roster.md](project-agent-roster.md).
- Added the `project-agency-operations` skill to keep tool access, plugin
  adoption, and project triage repeatable.

### Setup and tooling

- Hardened fresh-machine setup: installs missing Agency tooling dependencies,
  requires Node 24+, deep-merges MCP config during starter install, and
  includes the installer itself in starter installs.
- Added `agency/VERSION.json` to track installed tool and extension
  versions for drift detection (`agency/scripts/verify-tooling.ps1`).

### Documentation and positioning

- Positioned the starter as an optional ACT Edition add-on rather than a
  replacement for project docs (see [README.md](../README.md) positioning table).
- Moved starter docs, scripts, and the Agency guide under the `agency/` folder.
- Added the EMU and Agency setup guide ([setup-github-emu-agency.md](setup-github-emu-agency.md))
  and M365 transcript access boundary guidance ([m365-transcript-access.md](m365-transcript-access.md)).
