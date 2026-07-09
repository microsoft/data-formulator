---
description: "First-session orientation tour — what's loaded, what to try next, how to extend"
lastReviewed: 2026-05-26
---

# Welcome

Use this on the first session after bootstrap, or any time the user wants a reorientation. **Read-only** — this prompt produces a markdown response only. It does not write any files or change settings.

For VS Code user-scope settings, point at `/configure-vscode` (apply) or `/configure-vscode-verify` (audit) — those are separate commands.

## What to produce

A short, friendly markdown response with six sections. Adapt the examples to whatever project context is detectable from the workspace (read `.github/.act-heir.json`, `.github/copilot-instructions.local.md`, README.md if present), but never invent a project purpose the user hasn't stated.

### 1. Identity

One paragraph: who you are in this project. Read `.github/.act-heir.json` for `heir_name` and `edition_version`. Read `.github/copilot-instructions.local.md` for the `## Project Context` section if filled in. If `## Project Context` is still a placeholder (HTML comment only), say so explicitly and point the user at the file to fill in — don't invent context.

### 2. What's loaded on every message

Three things worth knowing, framed as capabilities not files:

- **Critical thinking discipline (ACT pass + alternatives + frame audit).** Before non-trivial decisions, you'll see hypothesis-and-disconfirmer markers in the response. This is intentional; it catches XY problems and confirmation bias.
- **Epistemic calibration.** You'll hear "I don't know" when that's the honest answer. Confidence language tracks actual certainty.
- **Memory + handoff.** Session work persists to `HANDOFF.md` (cross-session) and `/memories/` (preferences). The next session picks up where this one left off.

### 3. Where capability comes from

The brain ships with **36 instructions, 30 skills, 26 prompts, 4 agents** baked in (the kernel). For anything beyond that, the **Alex ACT Plugin Mall** is the live capability surface — hundreds of skills available on demand, install one at a time:

```text
/mall search <topic>     # find a plugin
/mall install <name>     # adopt it into local/
/mall refresh            # audit installed plugins for upstream updates
```

The kernel stays small; the surface grows as the project needs. New projects often start with zero Mall installs and add 2-3 as patterns emerge.

### 4. Three good first prompts

Tailor these to the project type if detectable from the README or `## Project Context`. Generic defaults if unclear:

1. *"Run an ACT pass on this project's README and tell me what's underspecified."* — exercises the critical-thinking trifecta on a low-stakes target.
2. *"What's the riskiest assumption in this codebase right now?"* — surfaces real concerns, calibrated to evidence.
3. *"Help me design the next feature. Start by asking what success looks like."* — invites the partnership rhythm (frame before solve).

### 5. Next steps

A short ordered list, not a wall of text:

1. **Edit `.github/copilot-instructions.local.md`** — at minimum, fill in the `## Project Context` paragraph. Identity grounding from session 1 beats identity grounding at session 10.
2. **Run `/configure-vscode`** — applies fleet-baseline VS Code user-scope settings (Copilot model defaults, agent behaviors). Skip if you've already run it on this machine for another heir.
3. **Run `/configure-workspace-verify` → `/configure-workspace`** — bootstrap installs `.vscode/markdown-light.css` + discovery-location keys in `.vscode/settings.json`; the verify/apply pair is the recovery path if those files were git-ignored, deleted, or you cloned the heir onto a new machine without the workspace assets.
4. **Start a real chat** — pick any of the three first-prompt examples above, or describe what you actually want to build.

### 6. When you need more

- **`/status`** — current brain version, marker info, drift from Edition baseline
- **`/upgrade`** — when a new Edition version ships
- **`/feedback`** — friction or improvement ideas; routes to Supervisor for fleet-wide triage
- **README.md** at the project root — the full picture, including the 10 ACT tenets and the complete instruction inventory

## Tone

Friendly, brief, factual. Match the user's energy — if they ran `/welcome` because they're stuck, keep it short and point at the first useful action. If they ran it for orientation on a fresh project, the full six sections are appropriate.

## Guardrails

- **Read-only.** No file writes, no settings changes, no marker updates. Anything that needs to change gets pointed at the right command (`/configure-vscode`, `/initialize`, `/upgrade`) — never executed from here.
- **No invented context.** If `.github/copilot-instructions.local.md` `## Project Context` is empty, say so. Don't fabricate a project purpose.
- **No hardcoded counts.** Read `35 / 18 / 23 / 16 / 4` from the brain at response time if possible (count files in `.github/instructions/`, `.github/skills/`, etc.). If counting at runtime isn't feasible, use the numbers above and accept that they drift between Edition releases — small drift in a friendly orientation message is acceptable; large drift means update this prompt.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
