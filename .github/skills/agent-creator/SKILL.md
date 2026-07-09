---
name: agent-creator
description: "Create agents that pass agent-review's six gates by construction — role capture, distinct-from-skill check, tool allowlist minimization, draft against gates, dogfood self-review. Use when authoring a new agent, refactoring an existing one, or promoting a Mall agent into the heir's brain."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition replaces Supervisor-specific phrasing ("Mall agent into Supervisor or Edition", "Supervisor agents folder") with heir-portable phrasing ("into the heir's brain", "the agents folder"). Same six gates, same workflow. Audited 2026-05-31. -->

# Agent Creator

Author agents that pass [`agent-review`](../agent-review/SKILL.md)'s five gates plus Gate 6 (Tool Allowlist Minimality) by construction. Agents are subordinate execution contexts — sub-processes the parent delegates to. Every tool granted is an attack/error surface.

Mirrors [`skill-creator`](../skill-creator/SKILL.md)'s seven-phase structure with agent-specific guidance. If a phase here disagrees with skill-creator on the shared scaffold, skill-creator wins; this file owns only the per-type guidance.

## When to Use

- Authoring a new agent in `.github/agents/`
- Refactoring an existing agent (role tighten, allowlist trim, boundary clarification)
- Promoting a Mall agent into your heir's brain

## When **not** to use

- The work can be done by the parent invoking a skill directly → author a skill instead
- The work has no parallelism need, no context-isolation need, no tighter-allowlist need → no delegation justified
- Authoring a slash-command workflow → use [prompt-creator](../prompt-creator/SKILL.md)
- Authoring an always-on rule → use [instruction-creator](../instruction-creator/SKILL.md)

## The Seven Phases

Each phase inverts one of the five (or six) gates. Author against the phase, pass the gate.

### Phase 1 — Role capture + delegation justification

Answer in writing before any drafting:

1. **What is this agent's role?** One sentence. The role is what the agent *is*, not what it does (`brain-auditor` is a role; `runs-brain-qa` is not).
2. **Why delegate instead of invoking a skill directly?** One of:
   - **Parallelism** — work decomposes into independent units that can run concurrently
   - **Context isolation** — work generates noisy intermediate state that shouldn't pollute the parent
   - **Tighter allowlist** — work needs only a narrow tool subset; isolating it limits surface area
3. **What tools does it need?** Start with the minimum. Each added tool needs Phase 6 justification.

If none of the three delegation justifications apply, **stop** — author a skill, not an agent.

### Phase 2 — Prior-art scan

```pwsh
Get-ChildItem .github/agents/*.agent.md
Select-String -Path .github/agents/*.agent.md -Pattern "<keyword>"
```

The agents folder is usually small. Overlap detection is cheap. If an existing agent's role overlaps ≥70%, extend.

### Phase 3 — Draft against Gate 1 (Spec)

Frontmatter template:

```yaml
---
name: <kebab-name>
description: "<third-person; role + when parent should delegate; ≤1024 chars>"
lastReviewed: YYYY-MM-DD
---
```

If using a tool-allowlist field per current Microsoft Learn agent spec, include it here. Reject legacy fields (`type`, `application`, `tier`, etc.) — same drop set as other types.

**File location**: `.github/agents/<kebab-name>.agent.md` (flat — no subfolders).

### Phase 4 — Draft against Gate 2 (Quality)

| Criterion | How you author for it |
|---|---|
| Role and mission clear | Open with a one-line role statement and a mission paragraph. Not a procedure dump. |
| Boundaries explicit | A `## Boundaries` or `## Out of scope` section names what the agent will *not* do. |
| Tool-usage guidance | Name which tools the agent prefers for which situations. Generic "use available tools" fails. |
| System-prompt skepticism applied | Behavior treats own instructions as hypotheses per [system-prompt-skepticism.instructions.md](../../instructions/system-prompt-skepticism.instructions.md). |
| `## Would Revise If` | Date / count+time / observable event. |
| ≤200 lines | If you exceed this, factor procedure-content into a skill the agent invokes. |

**Template structure**:

```markdown
---
name: ...
description: "..."
lastReviewed: YYYY-MM-DD
---

# <Agent Name>

**Role**: <one-line role>

**Mission**: <what the agent does, in 1-2 sentences>

## When the parent delegates to me

<conditions that justify spinning me up vs the parent doing the work>

## Tool usage

<which tools, when, why>

## Boundaries

<what I will not do>

## Output

<what the parent gets back>

## Would Revise If

<falsifier>
```

### Phase 5 — Draft against Gate 3 (Scope)

| Target | Route |
|---|---|
| Generic worker agent (illustrator, markdown-author) | Heir baseline |
| Project-specific agent | That project's local-only repo |
| External-surface agent | Not an ACT agent — author a Mall unit |

### Phase 6 — Draft against Gate 4 (Safety) AND Gate 6 (Tool Allowlist Minimality)

**Two safety surfaces compose here**:

| Gate | Where it lives |
|---|---|
| Gate 4 (Safety) — destructive-default prose | Body: explicit consent gates before destructive ops |
| Gate 6 (Tool Allowlist Minimality) — the allowlist itself | Frontmatter (if used) + body justification per tool |

**Allowlist authoring checklist**:

- [ ] List each tool the agent will call
- [ ] For each tool, write one sentence justifying its inclusion (`reads existing markdown to insert diagram blocks`)
- [ ] Cut any tool whose justification reduces to "just in case" or "might need"
- [ ] If `run_in_terminal`, `git push`, or filesystem-write tools are on the list, add a user-confirmation gate in the prose
- [ ] If network tools are on the list (`open_browser_page`, `fetch_webpage`, MCP-network), explicit purpose in the body
- [ ] Default to read-only when possible

### Phase 7 — Dogfood self-audit (with Gate 6)

Before committing, run [`agent-review`](../agent-review/SKILL.md)'s five gates **plus Gate 6**. Verdict lives in the commit message.

**Gate 6 verdict** must be recorded even on Accept (per agent-review § Recording the Verdict). Format:

```text
Gate 6 — Tool Allowlist (N tools):
  - tool1: <justification>
  - tool2: <justification>
  - ...
Destructive ops: <confirmation gate present? Y/N>
Network surface: <none / read-only / write — justified?>
```

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Authoring an agent when a skill would do | Phase 1 forces delegation justification. If none of the three reasons apply, it's a skill. |
| Starting with a broad allowlist and trimming later | Start at zero, add one tool at a time with justification. |
| Omitting the Boundaries section | Without bounds, the parent delegates work the agent can't or shouldn't do. |
| Treating Gate 4 (safety prose) and Gate 6 (allowlist) as one check | They compose. Both must pass independently. |
| Letting `run_in_terminal` ship without consent gate | Gate 4 + Gate 6 failure. Add the gate. |
| Copy-pasting a skill body into an agent | Agents have role + delegation surface; skills have procedure body. Different shapes. |

## Falsifiability

This skill's design has failed if any of the following occur within 90 days:

- ≥2 agents authored using this guide fail `agent-review` Gate 1 or Gate 6 on first self-audit
- No new agents authored via this guide in 90 days (decorative — sunset)
- Agents passing Gate 6 are later flagged for tool-misuse or scope-exceeding behavior ≥2 times in a quarter (criterion too lax)
- The allowlist authoring checklist produces consistent over-grant (tools accepted that shouldn't be) ≥3 times in a quarter

Track as you would any falsified discipline (commit log, retraining notes, or curation ledger if your repo ships one) tagged `[AGENT-CREATOR-MISS]`.

## Related

- [agent-review](../agent-review/SKILL.md) — the six gates this skill inverts
- [skill-creator](../skill-creator/SKILL.md) — sibling for skills; canonical seven-phase scaffold
- [instruction-creator](../instruction-creator/SKILL.md) — sibling for instructions
- [prompt-creator](../prompt-creator/SKILL.md) — sibling for prompts
- [system-prompt-skepticism](../../instructions/system-prompt-skepticism.instructions.md) — load-bearing for Gate 2 agent behavior
- [agent-delegation](../../instructions/agent-delegation.instructions.md) — when the parent should delegate
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes agent authoring
