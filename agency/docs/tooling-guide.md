<!-- markdownlint-disable MD013 -->

# Tooling Guide

Use this guide to decide which profile and tools to activate for a generic
project.

## Default Flow

1. Start with `project-ops` for docs, release signals, Kusto, and Azure DevOps
   work items.
2. Switch to the narrowest M365 profile that matches the named source:
   `meeting-note-taker`, `m365-people-context`, `m365-mail-review`,
   `m365-doc-review`, or `m365-planner-review`.
3. Use `project-context` only as a broad break-glass profile when a task
   explicitly needs multiple M365 surfaces in one run.
4. Use `project-servicetree` and `project-servicetree-planner` for ServiceTree
   identity, ownership, lifecycle, or subscription-binding work.
5. Use `project-s360-read` or `project-reports` when a project owns those
   Service360 workflows.
6. Switch to `azure-remediate` or `service360-breeze` only for concrete
   remediation or Service360 KPI work.
7. Use `project-connect-tracker`, `project-ado-spec`, or `project-incidents`
   only for their specific optional, plugin-backed workflows (Connect goal
   tracking, ADO spec generation, incident/on-call lookup) when the project
   explicitly owns them.

## Merge Into A Project

From this starter repo, preview the merge:

```powershell
./Install-AgencyStarter.ps1 -TargetPath C:/Development/<project>
```

Apply the merge:

```powershell
./Install-AgencyStarter.ps1 -TargetPath C:/Development/<project> -Apply
```

Review the target repo's `git status` before committing.

The installer deep-merges `.mcp.json`, so existing MCP servers stay in place and
missing starter servers are added under the `servers` object. Agency supplies the
built-in MCP binaries/proxies; the JSON config is what makes a project discover
and launch them. Before applying any writes, the installer validates its source
manifest and the target JSON files it will merge. Invalid JSON fails the whole
operation before additive files are copied.

## Safe Verification

Run setup first if `agency`, `gh`, or Microsoft EMU auth is missing:

- [Setup GitHub EMU and Agency](setup-github-emu-agency.md)

```powershell
./agency/scripts/verify-tooling.ps1 -Install
./agency/scripts/verify-tooling.ps1
./agency/scripts/verify-tooling.ps1 -UpdateVersionFile
agency copilot --profile-only project-servicetree --prompt "List available MCP servers and exit. Do not call tools."
agency copilot --profile-only project-ops --prompt "List available project MCP servers and exit. Do not call tools."
agency copilot --profile-only meeting-note-taker --prompt "List available meeting MCP servers and exit. Do not read content."
agency copilot --profile-only project-context --prompt "List available M365 MCP servers and exit. Do not read content."
```

The no-flag verifier is read-only and returns a nonzero exit code for missing or
outdated dependencies, missing extensions, failed auth/config commands, or
drift from local `agency/VERSION.json`. After reviewing an intentional tool
change, rerun with `-UpdateVersionFile` to record the new baseline.

## Tool Selection

For server-by-server capability definitions and agent-scoping guidance, see
[Agency MCP capabilities](agency-mcp-capabilities.md). For project-local agent
routing, use [Project agent roster](project-agent-roster.md) and
[Project MCP capabilities](project-mcp-capabilities.md).

| Need | Tool |
| --- | --- |
| Internal engineering docs | EngHub MCP or `project-docs` profile |
| Microsoft public docs | Microsoft Learn MCP or `project-docs` profile |
| Service ownership | ServiceTree MCP through `project-servicetree` |
| Azure DevOps work items and project tracking | ADO MCP through `project-ops` |
| Azure security posture | `project-safety` or `azure-remediate` profile |
| Deployment safety | `project-safety` or `azure-remediate` profile |
| CVE or dependency remediation | DVD-R, curated security plugins |
| M365 meeting metadata, Teams meeting notes, transcripts, or recap checks | `meeting-note-taker` profile |
| M365 people/org context | `m365-people-context` profile |
| Mail review | `m365-mail-review` profile |
| OneDrive, SharePoint, or Word document review | `m365-doc-review` profile |
| Planner task review | `m365-planner-review` profile |
| Cross-surface M365 investigation | `project-context` break-glass profile |
| Service360 KPI metadata | `project-s360-read` or `service360-breeze` profile |
| Solution-owner reports | `project-reports` profile |
| Weekly Microsoft Connect goal tracking | `project-connect-tracker` profile |
| Requirement/Implementation Spec generation from an ADO work item | `project-ado-spec` profile |
| Incident investigation, on-call/DRI lookup | `project-incidents` profile |

## Local Brain Artifacts

| Artifact | Delegate when |
| --- | --- |
| `project-agency-operations` skill | The task is about Agency setup, MCP profile choice, M365 consent boundaries, Azure tooling, or plugin adoption |
| `project-tool-access-manager` agent | The parent needs a read-only access-state summary or exact verification commands |
| `project-docs-researcher` agent | The parent needs local docs plus parent-supplied EngHub/Learn summaries checked without broad M365 access |
| `project-meeting-note-taker` agent | The parent needs a meeting outcome note from repo context plus approved meeting summaries |
| `project-feedback-coordinator` agent | The parent needs stakeholder feedback synthesized before source-of-truth edits or audience summaries |
| `project-owner-map-reviewer` agent | The parent needs named owner/accountability consistency checked from repo evidence and approved people context |
| `project-servicetree-planner` agent | The parent needs ServiceTree identity, ownership, lifecycle, or subscription-binding planning |
| `project-ado-planner` agent | The parent needs ADO or Planner-backed project work shaped from local plans and approved live summaries |
| `project-status-reporter` agent | The parent needs project status or stakeholder rollups from local docs plus approved live summaries |
| `project-triager` agent | The parent has repo evidence plus MCP/tool summaries and needs a concise next-action recommendation |
| `project-remediation-router` agent | The parent has a remediation finding and needs the narrowest safe next path before a write-capable profile/plugin loads |
| `project-document-comprehension-reviewer` agent | The parent needs a no-context adversarial read of a stand-alone document before it is shared |
| `project-incident-response` skill | The task is about incident investigation or on-call/DRI lookup through `project-incidents` |

## Operating Rules

- Keep M365 tools out of normal ops sessions.
- Keep ServiceTree out of routine `project-ops`; use the dedicated
   `project-servicetree` profile and ServiceTree planner agent.
- Use `--profile-only` by default so ambient workspace MCP config does not load
   every server into narrow tasks.
- Prefer narrow M365 profiles over `project-context` so a meeting task does not
   also launch mail, files, Planner, Word, and raw Graph surfaces.
- Ask for explicit approval before reading transcript, email, chat, file, or
  document content.
- Inspect curated plugins before installing them persistently.
- Prefer project profiles over always-on global plugins.
- Refresh local `agency/VERSION.json` after installing or upgrading tools.
- `Install-AgencyStarter.ps1` only checks whether a file already exists, not
  whether a project deliberately deleted it. Re-running the installer on a
  project that intentionally removed a starter agent/skill (because that
  responsibility belongs in a sister repo, or was superseded by a local
  specialization) will silently re-add it, since a missing file looks
  identical to a never-installed one. If your project has deliberately
  removed any starter agent/skill, document it in your own
  `project-agent-roster.md` (a "Removed From This Repo" section, naming the
  files and why) so it's easy to spot and re-delete after the next merge —
  see `msft-career`'s roster for the pattern.
