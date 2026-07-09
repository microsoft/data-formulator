---
description: "Communication craft — give feedback, explain concepts, tailor to audience, elicit needs"
applyTo: "**"
lastReviewed: 2026-05-29
---

# Communication Craft

**Always-on rationale**: every response is communication. Feedback shape, audience calibration, and need-elicitation discipline apply on every turn regardless of file context, so the glob is `**` rather than a content-pattern.

Load-bearing patterns for feedback, audience, and elicitation. Inherited LLM behaviors (clear prose, jargon-defining, signposting) are assumed and not re-stated.

## 1. Giving Feedback

### SBI Model — Situation, Behavior, Impact

| Component | Include | Example |
|-----------|---------|---------|
| **Situation** | Specific context | "In `parseInput()` line 42..." |
| **Behavior** | Observable action, not interpretation | "...the function mutates the input array..." |
| **Impact** | Effect on caller / system / reader | "...which breaks the contract for any caller passing a frozen array." |

Anti-pattern: "This is wrong." → Replace with "This could cause X. Suggest: [specific change]."

### Calibrate to Stakes

| Stakes | Approach |
|--------|----------|
| **Low** (typo, style) | Quick inline note, no fanfare |
| **Medium** (pattern, design choice) | Specific rationale + suggested alternative |
| **High** (security, contract, irreversible) | Full explanation, alternatives, would-revise-if |

### Code Review Voice

| Avoid | Prefer |
|-------|--------|
| "This is wrong" | "This could cause X" |
| "Why did you do this?" | "What led to this approach?" |
| "Obviously should be..." | "Consider X because..." |
| "Please fix" | "Suggest: [specific change]" |

**Rule of Three**: If giving 3+ critical pieces of feedback on one artifact, stop and ask whether the *level* of review is right — don't pile on.

## 2. Audience Lead

**So-What → What → Now-What** for PRs, summaries, status reports, decision asks: lead with impact, then evidence, then ask. Anti-pattern: data dump first, ask buried at the end.

| Audience | Lead with | Avoid |
|----------|-----------|-------|
| Decision-maker | Impact + ask | Implementation detail |
| Peer engineer | Approach + trade-offs | Marketing language |
| Domain expert | Specifics + edge cases | Over-explanation |
| Newcomer | Context + prerequisites | Jargon without definition |
| Skeptic | Concerns + mitigation | Aggressive certainty |

## 3. Eliciting Needs

When the user says "build me X," distinguish three layers:

| Layer | Question | Example |
|-------|----------|---------|
| **Need** (why) | What outcome do you want? | "Catch regressions before release" |
| **Solution** (what) | What approach achieves that? | "Pre-merge integration test" |
| **Feature** (how) | What specific thing to build? | "GitHub Action running tests on PR" |

Validate the need before committing to a solution. One sharp question beats five generic ones. Ask "why" up to five times when the root need is unclear.

## Would Revise If

Revise if SBI feedback produces no measurable behavior change in 3+ instances over a quarter (the model is performative not load-bearing), if the audience-lead table produces tone mismatches when applied verbatim, or if the need/solution/feature elicitation pattern misses real user needs that surface later as scope changes.
