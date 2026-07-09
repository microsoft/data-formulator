---
name: project-fabric-operations
description: "Coordinates Microsoft Fabric MCP access, agents, skills, and curated marketplace plugins for a Fabric-heavy project. Use when setting up or auditing Fabric profiles, notebook-generation plugins, semantic-model review, or Fabric data-security checks."
lastReviewed: 2026-07-03
---

<!-- markdownlint-disable MD013 -->

# Project Fabric Operations

Use this skill when a project depends on Microsoft Fabric: Lakehouse/Warehouse
data engineering, Spark notebooks, Power BI semantic models and reports, or
Fabric-native data quality/security work.

This is a template curated from the public
[`microsoft/skills-for-fabric`](https://github.com/microsoft/skills-for-fabric)
repo and the curated marketplace.

**Confirmed 2026-07-03**: `project-fabric-review` was exercised live against a real
Fabric workspace. `semantic-model-disambiguation`'s bundled `powerbi-modeling-mcp`
connected successfully and returned table/relationship/measure counts for both
semantic models in the workspace, read-only. `tompo-fabriclineage`'s skill
loaded but its lineage tools did not appear in the session (confirms it needs
the separate manual `tompo-mcp` setup noted below). `project-fabric`,
`project-fabric-notebooks`, and `project-fabric-security` are still unverified
— update this note once each is actually exercised.

## Route The Request

| Request                                                                          | Default route                                                                                                                             |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| General Fabric admin/app-dev/data-engineering/migration orchestration            | `project-fabric` (`skills-for-fabric`: `FabricAdmin`, `FabricAppDev`, `FabricDataEngineer`, `FabricMigrationEngineer`, `FabricIQ` agents) |
| Generate a Data Quality PySpark notebook (Fabric/Databricks/Synapse/local Spark) | `project-fabric-notebooks` (`dq-coworker`)                                                                                                |
| Generate a data-enrichment notebook from a Fabric Lakehouse or CSV source        | `project-fabric-notebooks` (`raw-2-enrich`)                                                                                               |
| Power BI/Fabric lineage or impact analysis ("what breaks if I rename X")         | `project-fabric-review` (`tompo-fabriclineage`) — read-only                                                                               |
| Semantic model column-ambiguity review and fix                                   | `project-fabric-review` (`semantic-model-disambiguation`) — write-capable, review before applying                                         |
| Fabric Data Agent (FDA) configuration generation                                 | `project-fabric-review` (`semantic-model-fda-creator`) — generates instructions/config artifacts, not a full auto-deploy                  |
| PII/PHI detection and de-identification in source data                           | `project-fabric-security` (`MaskIQ`)                                                                                                      |

## Why Four Narrow Profiles, Not One

Bundling every Fabric plugin into a single profile would repeat the exact
mistake this starter's own narrow-profile principle exists to prevent (see
[agency-mcp-capabilities.md](../../../../agency/docs/agency-mcp-capabilities.md)'s
Governing Principle) — more MCP servers loaded per session than the task
needs. Splitting by job (general work, notebook generation, review, security)
keeps each session narrow.

## MCP Wiring Notes (confirmed 2026-07-03 unless marked otherwise)

- `project-fabric-review`: `semantic-model-disambiguation` bundles
  `@microsoft/powerbi-modeling-mcp` (npx-launched) — **confirmed working**.
  Connect using the workspace's **display name, not its GUID/URL ID**
  (`ConnectFabric` with `WorkspaceName`/`SemanticModelName`, or `Connect` with
  an XMLA connection string like
  `Data Source=powerbi://api.fabric.microsoft.com/v1.0/myorg/<WorkspaceName>`).
  Connecting with the GUID from a `msit.powerbi.com/groups/<guid>` URL fails
  with "workspace not found" every time — get the display name from the
  Power BI portal first. `semantic-model-fda-creator` applies changes "via
  MCP" without its own `.mcp.json` — likely expects the same
  `powerbi-modeling-mcp` (unverified). `tompo-fabriclineage` does **not** wire
  through `agency.toml` at all — it requires a separately installed
  `tompo-mcp` pip package plus a manual `mcp.json` entry and `az login`, per
  its own skill prerequisites. Confirmed: its skill loads but its lineage
  tools do not appear in a `project-fabric-review` session without that
  separate setup.
- `project-fabric` / `project-fabric-notebooks`: `skills-for-fabric` bundles
  the `FabricIQ` MCP (`https://api.fabric.microsoft.com/v1/mcp/fabricaihub/integrations/m365`) —
  unverified. `dq-coworker` and `raw-2-enrich` do not appear to bundle their
  own MCP — they generate code/notebooks and likely lean on `skills-for-fabric`
  for live workspace access when needed — unverified.
- `project-fabric-security`: `MaskIQ` works directly on local files (CSV) —
  no MCP required.

## Safety Rules

- `tompo-fabriclineage` is explicitly read-only by design (metadata only,
  never modifies models/reports/sensitivity labels). Treat that as the
  default assumption for lineage/impact-analysis work.
- `semantic-model-disambiguation` applies fixes to the **live** semantic
  model. Review every proposed fix before it is applied.
- None of these marketplace plugins carry a governance/certification block
  (unlike, e.g., `pr-impact-advisory`). Run the
  [plugin adoption checklist](../../../../agency/docs/plugin-adoption-checklist.md)
  before relying on any of them for real work.
- Prefer `agency copilot --profile-only <profile>` so a Fabric session does
  not also load unrelated M365/ADO/Service360 MCPs.

## Would Revise If

Revisit once this template is actually activated in a real Fabric project.
Revise the MCP wiring notes above with confirmed behavior, and delete this
caveat once verified.
