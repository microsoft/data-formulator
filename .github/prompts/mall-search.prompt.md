---
description: "Search the Plugin Mall trust-scored catalog by query; ranks Mall-curated entries (🏆) first, surfaces third-party alternatives with their trust signals"
lastReviewed: 2026-05-31
---

# /mall-search

Search the Plugin Mall's unified catalog across all 46 source stores. Ranks results by trust score with Mall-curated entries (🏆) at the top.

Per [PLAN-mall-automation v3 / ADR-008](https://github.com/fabioc-aloha/Alex_ACT_Supervisor/blob/main/docs/adrs/ADR-008-mall-self-curation.md), the Mall is a search index + trust scorer — it does not download plugins. Heirs install directly from upstream at user-pinned versions.

## Steps

1. **Get the query** from the user: a topic, technology, problem, capability, or plugin name.

2. **Fetch `catalog/index.json` from the Mall.** The Mall is a sibling repo (canonical clone name `Alex_Skill_Mall`). Try these paths in order, first hit wins:
   - **Sibling clone**: `../Alex_Skill_Mall/catalog/index.json`
   - **User-home clone**: `~/Alex_Skill_Mall/catalog/index.json` (resolves the `~` for the current OS)
   - **Windows default**: `C:/Development/Alex_Skill_Mall/catalog/index.json`
   - **GitHub raw (fallback)**: `https://raw.githubusercontent.com/fabioc-aloha/Alex_Skill_Mall/main/catalog/index.json` (~1.4 MB; cache for the session)
   - If none work: link the user to <https://github.com/fabioc-aloha/Alex_Skill_Mall/blob/main/README.md>, suggest `git clone https://github.com/fabioc-aloha/Alex_Skill_Mall.git ../Alex_Skill_Mall`, and stop.

3. **Match plugins** against the query. Each entry in `index.json` has: `name`, `store`, `shape`, `trust_score`, `version`, `description_short`, `source_url`, `provenance`, `adapted_from`.

   - Match case-insensitively against `name` and `description_short`
   - Boost exact-name matches to the top within each provenance tier
   - Filter by shape if the user named one (`/mall-search code-review skill`)

4. **Rank** the matches:
   - Primary sort: `trust_score` descending (Mall-curated entries with their +50 provenance bonus naturally sort to the top)
   - Secondary sort: name alphabetical

5. **Display** the top 10 results as a table:

   ```text
   Trust  Plugin                 Store                  Shape    Version  Description
   -----  --------------------   --------------------   ------   -------  ------------------
   🏆 94  code-review            plugin-mall            skill    -        Systematic code review for correctness, security, and growth
      90  code-review            awesome-copilot        skill    1.1.0    Systematic code review for correctness, security, and growth
      85  code-review            composio-awesome...    skill    0.3.0    Code-review pattern (alternative author)
   ```

   The 🏆 emoji marks first-party Mall-curated entries (`provenance: true`). These rank highest because their store earns the +50 provenance bonus — see `/mall-show <name>` for the signal breakdown.

6. **Surface next actions**:

   ```text
   To see full metadata + signals: /mall-show <name>
   To install:                     /mall-install <name>[@<version>] (Phase 5b — not yet shipped)
   To browse a store:              read catalog/stores/<store>.md in the Mall repo
   ```

## Tips

- A search returning multiple entries with the same name is normal — the catalog is **unified**, so name collisions across stores are surfaced explicitly. The Mall-curated entry (🏆) is the editorially-adapted version; third-party entries are the original or alternative author's version.
- When a Mall-curated entry has `adapted_from: <store>/<plugin>@<ref>`, the search result shows it. The original upstream is also in the catalog under that store name — heirs can choose the adapted version or the newer upstream.
- `/mall-search` is read-only; it never modifies anything.

## Boundaries

- Don't fabricate plugin entries that aren't in `catalog/index.json`. If the catalog isn't reachable, say so explicitly.
- Don't claim "verified" or "tested" for any plugin — surface only the trust signals the catalog publishes.
- Don't recommend a third-party plugin over a Mall-curated one just because it has more stars. Trust score already balances those signals; the published score is the recommendation.

## Would Revise If

By **2026-08-29** (90 days) or sooner:

- Heirs report the trust-ranked default ordering produces wrong-looking recommendations ≥2 times in a quarter (provenance bonus miscalibrated)
- Local-clone fallback consistently fails on heir workstations because they don't keep the Mall checked out (need to switch primary path to GitHub raw URL)
- Catalog grows past 5 MB and the GitHub raw fetch becomes too slow for interactive search (per ADR-008 falsifier 7)
