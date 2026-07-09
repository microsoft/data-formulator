<!-- markdownlint-disable MD013 -->

# Plugin Adoption Checklist

Use this checklist before installing or invoking a Microsoft internal Agency
plugin in a project.

## Checklist

- Identify the active problem the plugin solves.
- Inspect the plugin README.
- List included agents and skills.
- Check whether it can edit files, draft PRs, call external services, or write
  to operational systems.
- Prefer read-only usage first.
- Install through a profile rather than globally when possible.
- Record the adoption decision in project docs.

## Useful Commands

```powershell
gh api repos/agency-microsoft/.github-private/contents/plugins/<plugin> --jq '.[].name'
gh api repos/agency-microsoft/.github-private/contents/plugins/<plugin>/agents --jq '.[].name'
gh api repos/agency-microsoft/.github-private/contents/plugins/<plugin>/skills --jq '.[].name'
agency plugin install github:agency-microsoft/.github-private:plugins/<plugin>
agency plugin uninstall github:agency-microsoft/.github-private:plugins/<plugin> --force
```

Known issue: `agency plugin uninstall` can fail with "Failed to remove plugin
entry from global config" even when the plugin is listed in
`agency plugin list` (seen on Agency 2026.7.2.3). If it fails twice, do not
keep retrying — edit `<global agency data dir>/agency.toml`'s `[plugins]`
`default` array directly instead, then confirm with `agency plugin list`.
Prefer the profile-scoped `agency.toml` pattern below over global
`agency plugin install` in the first place, so this global-config path rarely
needs touching.

## Candidate Plugins

| Plugin | Typical use |
| --- | --- |
| `s360-breeze-toolkit` | Service360 and SFI KPI remediation |
| `deployment-safety` | Deployment and release safety review |
| `codeql-fix` | CodeQL finding remediation |
| `security-vulnerability-autofix` | Dependency and vulnerability remediation |
| `engsys-standards` | Engineering-system standards checks |
| `microsoft/skills-for-fabric` (public repo, not curated marketplace) | Fabric agents/skills/MCP foundation — templated in `project-fabric`, not yet exercised |
| `dq-coworker` | DQ-check PySpark notebook generation for Fabric/Databricks/Synapse/local Spark — templated in `project-fabric-notebooks` |
| `raw-2-enrich` | Data-enrichment notebook generation for Fabric Lakehouse/CSV — templated in `project-fabric-notebooks` |
| `tompo-fabriclineage` | Power BI/Fabric lineage and impact analysis, read-only — templated in `project-fabric-review`; needs manual `tompo-mcp` setup outside `agency.toml` |
| `semantic-model-disambiguation` | Semantic model column-ambiguity review and live fix — templated in `project-fabric-review` |
| `semantic-model-fda-creator` | Fabric Data Agent config generation — templated in `project-fabric-review` |
| `MaskIQ` | PII/PHI detection and de-identification — templated in `project-fabric-security` |

## Adopted Plugins

| Plugin | Profile | Adopted | Notes |
| --- | --- | --- | --- |
| `connect-tracker` | `project-connect-tracker` | 2026-07-03 | Weekly Microsoft Connect goal tracking from mail/calendar/Teams/ADO/workiq signals. Read-only against M365/ADO; only writes to a local `memory/Knowledgebase/Connect/` log after explicit review-step approval. Manifest reports `certification: draft` — re-check before relying on it for a real review cycle. Scoped to its own profile (not global) per this checklist's install-through-a-profile guidance. |
| `requirement-spec-agent` + `implementation-spec-agent` | `project-ado-spec` | 2026-07-03 | Generate Requirement/Implementation Spec markdown from a named ADO work item. Needs only the `ado` MCP (already wired into `project-ops`). Write-capable: each creates a branch + PR (docs-only changes) and comments on the source work item — review the PR before merge. Manifests carry no governance/certification block (uncertified); re-check before pipeline/autopilot use. Scoped to their own profile, not global. |
