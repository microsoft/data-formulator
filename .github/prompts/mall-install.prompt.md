---
description: "Install a plugin from the Plugin Mall catalog at a user-pinned version — deferred to Phase 5b of PLAN-mall-automation v3"
lastReviewed: 2026-05-29
---

# /mall-install

**Status: deferred to Phase 5b.** Install logic depends on plugin shape (skill / agent / mcp / hook + single-file vs multi-file with `references/`); shipping it before validating shape-handling against real heir use would lock in the wrong abstractions.

Heirs should use `/mall-search <query>` (Phase 5a, live) to discover plugins, then `/mall-show <name>` (Phase 5a, live) to read full metadata + trust signals + the `source_url` and `available_refs` fields. To install from a heir today:

1. Get the plugin's `source_url` and the version you want from `/mall-show <name>` (or pick a tag from `available_refs.tags`).
2. Use the source_url's GitHub tree URL to fetch the plugin files manually (raw URLs or sparse-clone), placing them under your local `local/` namespace per [mall-installation.instructions.md](../instructions/mall-installation.instructions.md):
   - skill → `.github/skills/local/<name>/`
   - instruction → `.github/instructions/local/<name>.instructions.md`
   - prompt → `.github/prompts/local/<name>.prompt.md`
   - agent → `.github/agents/local/<name>.agent.md`
3. Record the install in a sibling `.install.json` so reinstalls and upgrades are deterministic:

   ```jsonc
   {
     "plugin": "<name>",
     "store": "<store>",
     "source_url": "<full tree URL at resolved SHA>",
     "installed_at": "<ISO timestamp>",
     "trust_score_at_install": <number>,
     "frontmatter_at_install": { ... }
   }
   ```

Phase 5b will automate this with a `mall-install.cjs` script + a fully-fledged `/mall-install <name>[@<version>]` prompt that handles all shapes uniformly.

## Why deferred

Per [PLAN-mall-automation v3](https://github.com/fabioc-aloha/Alex_ACT_Supervisor/blob/main/docs/plans/PLAN-mall-automation.md) Phase 5 design:

> Phase 5a (this commit) ships `/mall-search` + `/mall-show` so heirs can immediately use the catalog for discovery. Phase 5b will ship `/mall-install`, `/mall-upgrade`, `/mall-list` once we have heir feedback on which install workflows actually matter (single-file copy vs multi-file with references? per-shape rules? pinning strategy?).

The catalog is the load-bearing change. Heirs can install manually from `source_url` today; the automation lands next.

## Would Revise If

- A heir uses `/mall-install` 3+ times in a week with manual fallback (signal that Phase 5b is overdue — accelerate)
- Manual install workflow surfaces a shape we missed in Phase 3 normalization (e.g., a hook with a config file pattern) — Phase 5b's installer needs to handle it
