---
name: deep-review
description: Adversarial code review with three parallel perspectives — Advocate, Skeptic, Architect — that create productive tension. Use for high-stakes PRs, architectural changes, or when single-pass review would miss issues. Surfaces findings through disagreement, not consensus.
lastReviewed: 2026-04-30
---

# Deep Review

Perform thorough code review using three perspectives with opposing mindsets. Their disagreement surfaces issues; their agreement signals confidence.

## When to Use

- Architectural changes, multi-file refactors, or security-sensitive code
- PRs that are too important for single-pass review
- When you suspect confirmation bias in a standard review
- High-stakes merges where the cost of a missed issue is high

## When NOT to Use

- Routine single-file edits (use standard `code-review` skill)
- Documentation-only PRs
- Formatting/linting changes

---

## The Three Perspectives

| Agent | Mindset | Question | Owns |
| ----- | ------- | -------- | ---- |
| **Advocate** | "Why is this correct?" | Trust boundaries, design rationale, false-positive defense | Correctness defense |
| **Skeptic** | "How can I break this?" | Bugs, edge cases, code smells that indicate bugs | Correctness attack |
| **Architect** | "Is this the right direction?" | System impact, scope, structural smells, tech debt | Direction |

---

## Workflow

### Phase 1: Gather Context

1. **Identify the changes** — PR diff, local changes, or specific files
2. **Collect context** — related files, tests, recent history of changed modules
3. **Note observations** — anything unusual before analysis begins

### Phase 2: Parallel Analysis

Run all three perspectives independently. Each sees the same context but asks different questions.

#### Advocate Analysis

- What problem does this solve?
- What design decisions are intentional (not accidental)?
- Where are the trust boundaries correctly placed?
- What would break if we rejected this PR?
- Defend against false-positive concerns raised by Skeptic

#### Skeptic Analysis

- What inputs could break this? (null, empty, overflow, concurrent, malicious)
- What error paths are unhandled?
- What assumptions are undocumented?
- What would a fuzzer find?
- What code smells indicate deeper bugs? (naming lies, magic numbers, commented-out code)
- What works in tests but would fail in production?

#### Architect Analysis

- Does this fit the existing architecture or fight it?
- What's the blast radius if this fails?
- Does this increase or decrease coupling?
- Is there scope creep disguised as "while I'm here"?
- What precedent does this set for future changes?
- Is there tech debt being introduced? Is it intentional and documented?

### Phase 3: Synthesis

#### 3.1 Agreement Analysis

What do multiple perspectives agree on? → High-confidence findings.

#### 3.2 Conflict Resolution

When perspectives disagree, apply these rules:

| Conflict | Resolution |
| -------- | ---------- |
| Skeptic finds bug, Advocate defends | Does Advocate cite `file:line` that refutes? If not, Skeptic wins |
| Advocate says intentional, Skeptic says bug | If Skeptic shows reproducible path → it's a bug regardless of intent |
| Architect says blocking, Skeptic disagrees on priority | Skeptic's priority on correctness issues; Architect's on direction |
| No evidence either way | Mark as "Disputed" for human decision |

**Core rule: Evidence beats assertion.** A `file:line` citation wins over "probably."

#### 3.3 Final Output

```markdown
## Deep Review: <title>

### Summary
<1-2 sentence overview of the change and verdict>

### Perspectives

**Advocate** (Design Rationale)
<key defenses and intentional design decisions>

**Skeptic** (Risk Analysis)
<bugs found, edge cases, concerns with evidence>

**Architect** (Architectural Impact)
<patterns, debt, direction, system-level concerns>

### Consolidated Findings

| # | Issue | Priority | Advocate | Skeptic | Architect |
|---|-------|----------|----------|---------|-----------|
| 1 | <issue> | Critical/High/Medium/Low | <view> | <view> | <view> |

### Disputed (if any)
<issues where perspectives disagree and human must decide>

### Recommendations
<prioritized actions>

### Follow-up Items
<non-blocking concerns worth tracking>
```

---

## Priority Classification

| Priority | Criteria | Action |
| -------- | -------- | ------ |
| **Critical** | Data loss, security vulnerability, crash in production path | Block merge |
| **High** | Incorrect behavior under realistic conditions | Block merge |
| **Medium** | Code smell, missing test, unclear naming, minor debt | Request fix or accept with note |
| **Low** | Style, nitpick, suggestion for future | Comment only |

---

## Example

**PR**: Add rate limiting middleware to API gateway

**Advocate**: "Rate limiting prevents resource exhaustion. The sliding window approach handles burst traffic better than fixed windows. The 429 response includes Retry-After header per RFC 6585."

**Skeptic**: "The window reset logic at `middleware/rate-limit.ts:47` uses `Date.now()` but the TTL in Redis uses seconds — off by 1000x. Under load, the counter will never expire. Also: no test covers the window boundary."

**Architect**: "Rate limiting belongs at this layer (before auth, after TLS). But the config is hardcoded — should use env vars for per-deployment tuning. This sets precedent that all middleware reads config from constants."

**Synthesis**: Skeptic's timing bug is Critical (blocks merge). Architect's config concern is Medium (fix in follow-up). Advocate's design rationale is sound.

---

## Integration with ACT

- **Tenet II** (Disconfirmation): The Skeptic's entire job is disconfirmation
- **Tenet III** (Multiple Hypotheses): Three perspectives prevent anchoring on first interpretation
- **Tenet VIII** (Adversarial Self-Probe): The review structure IS adversarial by design
- **Materiality Gate**: Use Deep Review for high-stakes; standard `code-review` for routine

## Would Revise If

Revise if the three-perspective (Advocate / Skeptic / Architect) review repeatedly converges to consensus that misses real defects later found in production, or if reviewer time-cost exceeds 2× standard `code-review` without producing distinct findings in 3+ consecutive uses.
