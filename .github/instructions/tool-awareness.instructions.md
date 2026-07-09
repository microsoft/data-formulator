---
description: "Platform awareness for VS Code tool system: deferred tools require tool_search, external ingest provides context in remote workspaces, skill SKILL.md descriptions surface in the slash picker"
applyTo: "**"
lastReviewed: 2026-07-07
---

# Tool Awareness

**Always-on rationale**: deferred-tool resolution and external-ingest awareness apply to any tool-using turn regardless of file context. The `search before calling` discipline must fire on every deferred-tool need; scoping by file pattern would silence the protection exactly when the agent needs an unfamiliar tool.

## Deferred Tools (VS Code 1.118+)

Many tools are **deferred** (lazy-loaded). They appear in `availableDeferredTools` but cannot be called directly. Load via `tool_search` first with a natural-language capability description.

### Rules

1. **Search before calling.** Calling a deferred tool without loading via `tool_search` fails silently.
2. **Search once per tool.** After load, the tool stays available for the session.
3. **Use broad queries.** One broad search beats multiple narrow ones.
4. **No results means unavailable.** Don't retry with synonyms.

For common deferred tool categories and search-query patterns, see [tool-awareness-categories.instructions.md](tool-awareness-categories.instructions.md) (scoped, loads on tool/MCP/GitHub work).

## External Ingest (VS Code 1.119+)

In remote or virtual-filesystem workspaces (GitHub.dev, VS Code Remote, Codespaces), the editor provides codebase context automatically. `semantic_search` and file operations work transparently — no agent action needed.

## VS Code 1.122–1.128 conveniences

| Release | Capability | What it changes for me |
|---|---|---|
| 1.122 | `/models` slash command | Opens the model picker from chat input. Useful when the user asks to switch models mid-task without leaving chat. |
| 1.122 | BYOK air-gapped | Bring Your Own Key models work without GitHub authentication. Heirs in regulated/enterprise contexts can run Copilot Chat fully offline; the BYOK token counter (introduced 1.120) keeps working. |
| 1.122 | Local agent host default-on (Insiders only) | Watchpoint: when this reaches Stable, deferred-tool resolution may shift. No action until first observed behavior change. |
| 1.123 | Session sync + `/chronicle` | Chat sessions auto-sync to the GitHub account (gated by `chat.sessionSync.enabled`, org-managed). The `/chronicle` slash command queries that history. The brain's own `chronicle` skill is local-only; the platform feature is an adjacent capability, not a replacement. |
| 1.123 | Sandbox network-retry | When a local-agent terminal command needs an unallowed domain, VS Code auto-retries inside the sandbox with unrestricted network before falling back to unsandboxed (`chat.agent.sandbox.retryWithAllowNetworkRequests`). Reduces spurious failures on `git fetch` / `npm install`. |
| 1.124 | Autopilot enabled by default | Autopilot Preview is now on by default; `chat.permissions.default` controls the per-workspace level. ACT's heir-workspace baseline pins `default` as the deliberate opt-out — see `heir-workspace-settings-baseline.json`. |
| 1.124 | Advanced Autopilot (opt-in) | `chat.autopilot.advanced.enabled` uses a utility model to judge when a task is truly done. Capped at 3 iterations. Off by default; opt-in only. |
| 1.124 | Enterprise Copilot plugin policies | `chat.plugins.enabledPlugins` / `chat.plugins.extraMarketplaces` / `chat.plugins.strictMarketplaces` let org admins allowlist plugin IDs and marketplaces. Heirs in regulated orgs may see Mall installs silently blocked or marketplaces tagged as policy-managed; surface a clear message rather than retrying when an install refuses. |
| 1.125 | `extensions.autoUpdate` simplified to `on` / `off` | Old values (`true` / `false` / `onlyEnabledExtensions` / `delayed`) migrate automatically. Edition `welcome-baseline.json` pins the canonical `on` shape from this release forward; pre-1.125 heirs that have the old value still work via migration. |
| 1.125 | `extensions.autoUpdateDelay` configurable | The 2-hour supply-chain delay introduced in 1.123 is now a configurable hour count. Edition does not pin a value — heirs ride the platform default — but the setting exists if a heir or org wants tighter / looser update windows. |
| 1.125 | Forwarded-port URL rewriting for agents | When an agent in a remote workspace requests a port that has been forwarded, VS Code rewrites the URL and notifies the agent of the change. Reduces spurious browser-tool failures in Codespaces / Remote-SSH heir setups. No action needed; surface in fetch/browser diagnostics if a heir reports a port mismatch. |
| 1.125 | Native MDM delivery for managed Copilot settings | On Windows/macOS, org admins can deliver Copilot settings via MDM channels in addition to the account-based enterprise file. Settings delivered via MDM appear as policy-enforced and cannot be overridden locally — heirs in MDM-managed orgs may see baseline `welcome-baseline.json` keys ignored if the MDM policy disagrees. |
| 1.126 | Edit mode deprecated → Agent mode | `chat.editMode.hidden` also removed. Reinforces welcome-baseline `chat.agent.enabled: true` pin — user policy and platform default converged. Heirs with agent mode policy-disabled still see legacy Edit mode. |
| 1.127 | macOS/Linux terminal sandboxing | Agent-invoked terminal commands run with network blocked + FS restricted; agent only prompts on elevation. Substantially reduces approval prompts on non-Windows heirs. Toggle in Permissions dropdown. Windows unaffected — Backtick Hazard + Output Capture rules still apply. |
| 1.127 | `/troubleshoot` on agent host sessions | Adjacent to the brain's `ACT: Diagnose Fetch` pattern — platform-side diagnostic for agent behavior questions (custom instructions ignored, slow responses); not a replacement for our fetch diagnostics. |
| 1.127 | Browser tools GA (`workbench.browser.enableChatTools`) | Agent can open pages, screenshot, click through to validate its own work. Org-managed setting. Enterprise policies `BrowserChatTools` + `ChatAgentNetworkFilter` (agent domain allow/deny lists) may block Mall/GitHub fetches for regulated heirs — surface a clear message rather than retrying when a fetch refuses. |
| 1.127 | File-based managed Copilot settings | Extends 1.125 MDM channel: `managed-settings.json` at `%ProgramFiles%\GitHubCopilot\` (Win) / `/Library/Application Support/GitHubCopilot/` (mac) / `/etc/github-copilot/` (Linux). Same policy-lockout semantics as the MDM row — baseline keys may be ignored in policy-managed environments. |
| 1.127 | Built-in Ollama provider deprecated | Official Ollama VS Code extension replaces it. Heirs using BYOK Ollama should install the extension and remove the built-in provider. No brain action; documents why `welcome-baseline.json` doesn't pin an Ollama provider. |
| 1.128 | BYOK Claude via own Anthropic key | Heirs can run the Claude agent through their own Anthropic API credentials instead of consuming GitHub Copilot quota. Relevant to the Model Compatibility credit-economy discussion in Edition README. No baseline setting; user-opt-in via Claude harness auth. |
| 1.128 | Custom endpoint model options for BYOK | Enables BYOK against strict-schema providers (Moonshot, Kimi, etc.) that reject non-standard params. `temperature` and provider-specific options now configurable. Unblocks heirs who reported provider-rejection errors before this. |
| 1.128 | Claude agent → integrated browser DOM/tools | Feature parity with the Copilot agent's browser tools GA (1.127). Same `BrowserChatTools` + `ChatAgentNetworkFilter` enterprise policies apply. |

## Skill Picker Surfacing (VS Code 1.118+)

In 1.118+, `.github/skills/<name>/SKILL.md` files with a non-empty `description` in their frontmatter ALSO surface in the chat slash-command picker (alongside `.github/prompts/*.prompt.md`). Controlled by the experimental setting `github.copilot.chat.skillTool.enabled` (default on).

### Consequence for the brain

When a prompt and a skill share a base name (`/meditate` prompt + `meditation` skill), the picker shows both. This is not a brain defect — the verb-prompt / noun-skill pairing is intentional (prompts are workflow entry points, skills are knowledge bodies). The picker noise is a side effect of the platform surface postdating the brain's design.

### Lever, not stripping

If picker noise is the problem, the lever is the user-level setting:

```jsonc
// settings.json (user scope)
"github.copilot.chat.skillTool.enabled": false
```

**Never strip the SKILL.md `description` to declutter the picker.** The `description` field has three consumers and the picker is the least important of them:

1. **Agent skill discovery (primary)** — every session loads SKILL.md descriptions into the `<skills>` block; this is how the parent agent decides whether to invoke the skill
2. **Brain QA enforcement** — where a brain-qa script exists (Supervisor ships one as `scripts/brain-qa.cjs`), it hard-fails on missing/empty description
3. **Chat picker tooltip** — the surface visible to humans

Stripping (1) and (2) to fix (3) is a Type III error (right cost, wrong problem). The setting is the right scope.

## Would Revise If

Revise if VS Code changes the deferred-tool mechanism (e.g. `tool_search` semantics change, deferred tools become directly callable, or external-ingest changes scope in remote workspaces), or if the "search before calling" rule produces no observed failures over a quarter (the rule is no longer load-bearing because the platform changed).

**Skill picker section falsifier**: revise by 2026-08-24 (90 days) or sooner if any of the following fires: (a) VS Code renames or removes `github.copilot.chat.skillTool.enabled`; (b) setting the flag to `false` does not reduce skill-name entries in the slash picker; (c) the brain restructures SKILL.md frontmatter such that `description` ceases to be the agent-discovery signal. First observed contradiction wins.
