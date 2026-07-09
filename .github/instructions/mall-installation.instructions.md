---
description: "How heirs install plugins from the Alex ACT Plugin Mall into local/ paths so Edition upgrades don't clobber them"
applyTo: "**/.github/skills/local/**,**/.github/instructions/local/**,**/.github/scripts/local/**,**/.github/prompts/local/**,**/.mcp.json,**/mcp.json"
lastReviewed: 2026-05-31
---

# Mall Installation

The [Alex ACT Plugin Mall](https://github.com/fabioc-aloha/Alex_Skill_Mall) (canonical repo name `Alex_Skill_Mall`) is a curated catalog of optional plugins. Heirs pull what they need on demand.

## Plugin Structure

Each plugin in the Mall is a folder under `plugins/<category>/<name>/`:

| File | Purpose |
| --- | --- |
| `README.md` | Human-readable: what the plugin does, when to use it |
| `SKILL.md` | The skill artefact (if present per `shape`) |
| `*.instructions.md` | Optional instruction artefact (if present per `shape`) |
| `*.prompt.md` | Optional prompt artefact (if present per `shape`) |
| `*.agent.md` | Optional agent artefact (if present per `shape`) |
| `scripts/*.cjs` | Optional muscle / helper scripts |

Per-plugin `plugin.json` manifests were the source of truth pre-ADR-008. Today the catalog (`catalog/index.json` at the Mall root) is authoritative — read it via `/mall-show <name>` rather than fetching the per-plugin file. The catalog entry tells you everything the install needs.

The `shape` field is a 4-character code `ISPA` where each position indicates presence of an artefact kind:

| Position | Character | Meaning |
| --- | --- | --- |
| 1 (`I`) | `I` if present, `.` if absent | `.github/instructions/<name>.instructions.md` |
| 2 (`S`) | `S` if present, `.` if absent | `.github/skills/<name>/SKILL.md` |
| 3 (`P`) | `P` if present, `.` if absent | `.github/prompts/<name>.prompt.md` |
| 4 (`A`) | `A` if present, `.` if absent | `.github/agents/<name>.agent.md` |

Examples: `.S..` = skill-only, `ISP.` = instruction + skill + prompt, `ISPA` = full trifecta + agent, `..A.` = agent-only.

## Plugin Selection Protocol

### Step 1: Assess project needs

Read `copilot-instructions.local.md`, `README.md`, `package.json`, and directory structure. Identify the primary language, domain, and workflows.

### Step 2: Check what's already installed

- `.github/skills/local/` contains already-installed plugins
- `.github/skills/` contains Edition baseline (do not duplicate)

### Step 3: Search the catalog

Use `/mall-search <query>` for ranked discovery (Mall-curated entries first, third-party alternatives below with their trust signals). For direct access, fetch `catalog/index.json` (schema 3.0) from:

- **Sibling clone (preferred)**: `../Alex_Skill_Mall/catalog/index.json`
- **GitHub raw (fallback)**: `https://raw.githubusercontent.com/fabioc-aloha/Alex_Skill_Mall/main/catalog/index.json` (~1.4 MB; cache for the session)

If you want a local clone, use the canonical name so the helper scripts find it:

```bash
git clone https://github.com/fabioc-aloha/Alex_Skill_Mall.git ../Alex_Skill_Mall
```

The catalog ships ~3,200 plugins across 46 source stores. Each entry carries `{ name, store, shape, trust_score, version, description_short, source_url, provenance, adapted_from }`. Filter by:

- `store`: `plugin-mall` (first-party, 🏆), `awesome-copilot`, plus 44 other third-party stores
- `shape`: plugin complexity (see table below)
- `trust_score`: numeric 0-100 (Mall-curated entries earn a +50 provenance bonus, so they naturally sort to the top)
- `provenance`: `true` for Mall-curated, `false` for third-party

### Step 4: Apply the selection filter

| Question | If no, skip |
| --- | --- |
| Does the project actually do what this plugin covers? | Skip |
| Is this already covered by an Edition baseline artifact? | Skip |
| Would this plugin be used in the next 30 days? | Skip |
| Is the `token_cost` justified for this project? | Skip |

### Step 5: Read the plugin's README

Every plugin's `source_url` points at a GitHub tree URL pinned to a specific SHA. Read the README there before installing. It explains what the plugin does, what artifacts it ships, and any setup steps.

## Installation

### Discovery setup (one-time, runs automatically on init/upgrade)

VS Code Copilot's skill / prompt / agent discovery walks each registered root **one level only**, looking for `<root>/<name>/SKILL.md` (and equivalents). Instruction discovery recurses; the others do not. To make `.github/skills/local/<name>/SKILL.md` etc. discoverable, `local/` is registered as a SECOND root via the matching `chat.*FilesLocations` setting in the heir's `.vscode/settings.json`.

`bootstrap-heir.cjs` (on init) and `upgrade-self.cjs` (on upgrade) merge these three keys non-destructively from `.github/config/heir-workspace-settings-baseline.json`:

```jsonc
{
  "chat.agentSkillsLocations":  { ".github/skills":  true, ".github/skills/local":  true },
  "chat.promptFilesLocations":  { ".github/prompts": true, ".github/prompts/local": true },
  "chat.agentFilesLocations":   { ".github/agents":  true, ".github/agents/local":  true }
}
```

**Manual fallback** (for heirs on an older Edition that pre-dates the merger): copy the three keys above into `.vscode/settings.json` by hand, or run the Supervisor helper `scripts/apply-skill-discovery-settings.cjs --repo <heir-path>` from a sibling-cloned Supervisor checkout. Without these keys, every Mall plugin you install under `local/` will silently fail to load.

The name of each `local/<plugin>` directory MUST match the `name:` field in the plugin's `SKILL.md` frontmatter (one-level walk = name-is-discovery). Mall plugins ship with matching names; if you rename a plugin dir, rename the frontmatter too.

### Cardinal Rule: Use `local/` Subdirs

Edition's sync policy (inlined in `.github/scripts/_registry.cjs` as the `HEIR_OWNED` array) declares these as **heir-owned** (never overwritten on upgrade):

- `.github/skills/local/**`
- `.github/instructions/local/**`
- `.github/scripts/local/**`
- `.github/prompts/local/**`

Installing outside `local/` means `upgrade-self.cjs --apply` will **delete it**.

### Install a Plugin

1. **Resolve the source URL** from `/mall-search <name>` then `/mall-show <name>`. The `source_url` field is a GitHub tree URL pinned to the upstream SHA at the current `version`. Example:

   ```text
   https://github.com/fabioc-aloha/Alex_Skill_Mall/tree/<sha>/plugins/architecture-patterns/context-architect
   ```

2. **Copy each artifact to its `local/` path.** From a sibling Mall clone (preferred for bulk):

   ```bash
   # Clone Mall once with the canonical name (helper scripts expect this path).
   git clone https://github.com/fabioc-aloha/Alex_Skill_Mall.git ../Alex_Skill_Mall

   # Skill (one-file or multi-file plugins both ship a SKILL.md at the plugin root).
   mkdir -p .github/skills/local/<name>
   cp ../Alex_Skill_Mall/plugins/<category>/<name>/SKILL.md .github/skills/local/<name>/

   # Instruction / prompt / agent (only present if the plugin ships them; check the
   # plugin's source tree for *.instructions.md, *.prompt.md, *.agent.md siblings).
   mkdir -p .github/instructions/local .github/prompts/local .github/agents/local
   cp ../Alex_Skill_Mall/plugins/<category>/<name>/*.instructions.md .github/instructions/local/ 2>/dev/null || true
   cp ../Alex_Skill_Mall/plugins/<category>/<name>/*.prompt.md .github/prompts/local/ 2>/dev/null || true
   cp ../Alex_Skill_Mall/plugins/<category>/<name>/*.agent.md .github/agents/local/ 2>/dev/null || true

   # Optional muscle scripts.
   mkdir -p .github/scripts/local
   cp ../Alex_Skill_Mall/plugins/<category>/<name>/scripts/*.cjs .github/scripts/local/ 2>/dev/null || true
   ```

   Or fetch single files directly without cloning the whole Mall:

   ```bash
   # GitHub raw at a pinned SHA (substitute <sha> from the source_url).
   mkdir -p .github/skills/local/<name>
   curl -L "https://raw.githubusercontent.com/fabioc-aloha/Alex_Skill_Mall/<sha>/plugins/<category>/<name>/SKILL.md" \
     -o .github/skills/local/<name>/SKILL.md
   ```

3. **Record the install** in `.github/skills/local/<name>/.install.json` so `/mall-refresh` can detect upstream drift:

   ```jsonc
   {
     "plugin": "<name>",
     "store": "<store>",            // e.g. "plugin-mall" or "awesome-copilot"
     "source_url": "<full GitHub tree URL at resolved SHA>",
     "version_at_install": "<version from the catalog at install time>",
     "installed_at": "<ISO 8601 timestamp>",
     "trust_score_at_install": <integer 0-100 from catalog>,
     "frontmatter_at_install": { "description": "...", "lastReviewed": "..." }
   }
   ```

   The `store` field is required when the same plugin name appears in multiple stores (common — `code-review` ships from `plugin-mall`, `awesome-copilot`, and others). `/mall-refresh` uses `(store, name)` as the drift identity.

4. **Commit**:

   ```bash
   git add .github/skills/local .github/instructions/local .github/prompts/local .github/agents/local .github/scripts/local
   git commit -m "Install plugin: <name>@<version> from Mall store <store>"
   ```

## MCP Server Configs

When the Mall ships MCP configs, merge into the heir's `.mcp.json` at workspace root. MCP configs are not edition-owned, so Edition upgrades never touch them.

### Placement

Prefer workspace-root `.mcp.json` over `.vscode/mcp.json`. Both work in VS Code 1.118+, but workspace-root is the cross-editor standard (works in Claude Code, Cursor, and other MCP-aware editors without adaptation).

### Deduplication

When the same server name appears at both user-level and workspace-level, workspace-level wins. This means a Mall-installed MCP config in the project's `.mcp.json` overrides any user-global config with the same server name, which is the intended behavior for project-specific tool servers.

## Scaffolds

Scaffolds bootstrap new repos. They are not installed into existing projects. Use them via `cp -r` to start a new project.

## Falsifiability

- The `local/` path convention is wrong if Edition upgrades consistently clobber heir-installed plugins despite following this guide
- The installation procedure is stale if Mall folder structure changes (e.g., plugin.json schema evolves) and this guide does not reflect the new paths
- The knowledge-package vs plugin distinction adds no value if heirs report confusion about which to use, or install the wrong type >30% of the time
