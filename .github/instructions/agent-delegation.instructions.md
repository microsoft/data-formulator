---
description: "Delegate mechanical work to worker subagents (workers in .github/agents/) so the parent session keeps capacity for ACT applied to the user's real problem"
applyTo: "**/*agent*,**/*delegate*,**/*subagent*,**/*author*,**/*diagram*,**/*convert*,**/*assembl*"
lastReviewed: 2026-05-01
---

# Agent Delegation

> **Worker Agents let `Alex_ACT_Edition` ACT.** Mechanical work belongs in worker subagents. Reasoning belongs in the parent.

## Why this rule exists

Edition's North Star is *disciplined reasoning*. When the parent session is consumed by mechanical work (rendering a mermaid block, lint-cleaning markdown, converting docx to md, sweeping for broken links), the parent's capacity for ACT is *diluted*. Worker subagents (loaded from `.github/agents/`) absorb that mechanical work into isolated context windows where the rules are knowable, the output can be validated against fixed criteria, and there's no business problem competing for attention.

This isn't a token-saving optimization. It's mission alignment: **delegate so Edition can be Edition**.

## When to delegate (mandatory check)

**Before authoring any markdown document, diagram, file conversion, or other mechanical artifact directly, the model must check whether a loaded worker SA matches the task.** If yes, delegate. If no, proceed in the parent.

Available worker SAs are listed in the model's agent set (visible to the runtime). Current pilot:

| Worker SA | Take this when the task is... |
| --- | --- |
| `markdown-author` | Authoring or substantively editing a markdown document (README, ADR, executive summary, prose-heavy `.md` artifact, frontmatter, tables, lists) |
| `illustrator` | Creating a single diagram (mermaid flowchart / sequence / state / class, SVG, ASCII art) |
| `document-assembler` | Stitching rendered diagrams into a draft markdown file that already contains 2 or more `<!-- ILLUSTRATOR: ... -->` placeholders. Dispatches the illustrator worker in parallel internally, replaces every placeholder, returns confirmation |

**The check is not "could the parent do this?" — the parent can always do it. The check is "is this mechanical work that a worker is designed to absorb?"** If yes, delegate.

## Delegation decision table

| Situation | Action |
| --- | --- |
| User asks for a substantive markdown doc (>~10 lines, prose-heavy) | Delegate to `markdown-author` |
| User asks for a diagram of any kind | Delegate to `illustrator` |
| User asks for a doc that includes **one** diagram | Delegate to `markdown-author` first; it returns a `<!-- ILLUSTRATOR: ... -->` placeholder; parent then delegates to `illustrator`; parent assembles the single block |
| User asks for a doc that includes **2 or more** diagrams | Delegate to `markdown-author` first (it writes the draft with N placeholders to a file); then delegate to `document-assembler` with the file path. The assembler dispatches all illustrators in parallel and stitches. Parent does not handle the placeholder-replacement step itself |
| User asks the parent to *think about* something (analysis, decision, ACT pass) | Stay in the parent. Reasoning work belongs here |
| User asks for a one-line markdown edit (typo fix, single-character change) | Stay in the parent. Below the SA's overhead threshold |
| User asks for a plan, architecture review, or trade-off analysis | Stay in the parent |
| User asks for code generation, refactoring, or debugging | Stay in the parent (no SA worker for this domain yet) |
| User explicitly tells the parent to do the work directly | Stay in the parent. User intent overrides the policy |

## What "delegate" means in practice

Use the `runSubagent` tool. Pass the agent name (`markdown-author` or `illustrator`) and a focused brief describing exactly what you need. The brief should include:

- The task in one sentence
- Any specific content requirements (headings, sections, tone)
- Any specific style requirements not covered by the SA's own skills
- For `illustrator`: the diagram type, the nodes/relationships to show, and any layout preferences

The SA returns a result. Surface that result to the user (with assembly if needed for orchestration).

## What NOT to do

- **Do not author a markdown document directly when `markdown-author` is loaded.** This is the most common failure mode. The parent's training favors direct action; this instruction overrides that default.
- **Do not draw a diagram directly when `illustrator` is loaded.** Same reason.
- **Do not delegate reasoning tasks.** ACT, frame audits, alternatives generation, severity checks belong in the parent. The worker SAs are for mechanical output, not judgment.
- **Do not invoke a worker SA via `/<name>` slash command.** Workers are `user-invocable: false` for a reason — the user shouldn't have to know they exist. The parent invokes them transparently via `runSubagent`.

## Self-check before authoring mechanical output

Before calling `create_file` on a `.md`, `multi_replace_string_in_file` on markdown, or rendering a mermaid block in a response, ask:

1. *Is this mechanical work?* (markdown lint, diagram rendering, file conversion)
2. *Is there a loaded worker SA that matches?*
3. If yes to both: **stop. Delegate to the SA instead.**

If the model finds itself doing mechanical work in the parent and there was a matching SA available, that's a violation of this instruction. Catch it on the next opportunity.

## Falsifiability

This instruction is wrong if, after 30 days of usage with worker SAs available, the parent still does mechanical work directly more than 25% of the time on tasks where a matching SA is loaded. That would mean either (a) the instruction language isn't strong enough, (b) `runSubagent` selection by description match is unreliable, or (c) the principle itself doesn't hold in practice.

If that fires, escalate to a same-cycle proposal and revise.
