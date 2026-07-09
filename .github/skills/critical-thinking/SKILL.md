---
name: critical-thinking
description: Challenge what you think is right — alternative hypotheses, missing data, evidence quality, bias detection, falsifiability, and adversarial review
lastReviewed: 2026-04-30
---

# Critical Thinking


> Anti-hallucination prevents fabrication. Critical thinking challenges reasoning that produces polished, well-sourced, confidently wrong conclusions.

## Purpose

The second leg of epistemic integrity. A system that never fabricates can still reach deeply wrong conclusions — because it never tested its own reasoning. This skill provides:

- Seven disciplines for challenging AI reasoning at decision points
- The "never guess" epistemic foundation
- Domain adaptation patterns for heir-specific implementation
- Adversarial review protocols that catch what mechanical analysis misses

---

## The Two Legs of Epistemic Integrity

| Skill                  | Question                          | Catches                                                                    |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| **anti-hallucination** | Am I making something up?         | Fabricated facts, invented APIs, citation confabulation                    |
| **critical-thinking**  | Am I right for the right reasons? | Bad reasoning, missed alternatives, unexamined assumptions, invisible gaps |

Critical thinking is the leg that challenges _correct-looking_ output. Anti-hallucination catches lies. Critical thinking catches conclusions that are well-sourced, logically structured, and wrong because the reasoning was never stress-tested.

Error-detection during reasoning (retry loops, overconfidence, version errors, manipulation) is currently distributed across two always-on instructions: [`epistemic-calibration.instructions.md`](../../instructions/epistemic-calibration.instructions.md) carries the self-correction triggers table; [`reliance-nudges.instructions.md`](../../instructions/reliance-nudges.instructions.md) carries the repeated-same-error nudge. If a heir reports that in-flight error-detection has no clear discipline, that's the signal to restore a dedicated `awareness` skill (currently absent in both Supervisor and Edition).

> **Framework binding**: This skill holds Disciplines -1, 0, 1, 6, 7 of the ACT framework. Disciplines I/III/IX gain a Two-Hypothesis Floor visible marker. Tenet IV (system-prompt skepticism) ships as a sibling instruction (`system-prompt-skepticism.instructions.md`). The composite 7-step pass lives in [`act-pass.instructions.md`](../../instructions/act-pass.instructions.md). The 10 tenets and 6 falsifiers that name these disciplines as a coherent system are authored in Supervisor; heirs receive them through this skill and the sibling always-on instructions.

---

## When to Activate

This skill runs as a background discipline, but intensifies at decision points:

| Context                                                | Activation Level                    |
| ------------------------------------------------------ | ----------------------------------- |
| Factual lookups, simple code edits                     | Low — baseline epistemic discipline |
| Analysis, recommendations, architecture decisions      | Medium — run disciplines 1, 2, 5    |
| Health, legal, security, financial advice              | High — run all 7 disciplines        |
| Any output the user will act on with real consequences | High — full protocol                |

---

## Discipline -1: Problem Framing (Frame Audit)

Before the Materiality Gate, before any of the seven disciplines, before any solution attempt: **audit the frame**. The most expensive class of error is solving the wrong problem precisely (Mitroff & Featheringham 1974, Type III error). A flawless solution to the wrong question is still a wrong answer.

### The asymmetric rule

| Task class | Frame audit |
|---|---|
| Trivial — single-file edit, < 15 min, mechanical | **Skip** |
| Non-trivial — 3+ files, architectural choice, > 15 min, or symptom-frame language ("fix", "make faster", "broken", "just do X") | **Run** |
| User restated the same request after a failed attempt | **Run** |
| User invokes `/problem-framing-audit` or asks "what am I missing?" | **Run** |

### The minimum viable audit

Run **at least one** of the eight step-back checks before committing to a solution:

1. **Restate** — write the problem in one sentence in your own words. If you can't, ask.
2. **Generalise** — what is this a special case of?
3. **Specialise** — what's the simplest concrete instance?
4. **Invert** — what would make this worse?
5. **Five Whys** — why is this a problem? And why is _that_ a problem? (×5)
6. **Pre-mortem** — imagine it's done and didn't work; what went wrong?
7. **Stakeholder** — whose problem is this, really? What outcome would tell _them_ it's solved?
8. **Frame audit** — what other framings exist? At least two.

The discipline is not to do all eight on every problem — it's to do _at least one_ on every non-trivial problem before solving. The cost is small; avoiding a Type III error is large.

### Symptom-frame → cause-frame

The most common reframe: the user names a _symptom_, the audit surfaces the _cause_.

| User said (symptom-frame) | Audit surfaces (cause-frame) |
|---|---|
| "Make this function faster" | Function is fine; it's called 1000× when it should be called 1× |
| "Fix this flaky test" | Test is correct; system has a real race condition |
| "Add a workaround for this API quirk" | Quirk is the API enforcing a real constraint |
| "Why does this query take 2 minutes?" | Query is fine; UI re-renders 47M rows |

When the audit surfaces a cause-frame, _propose it before solving_. Don't silently solve the cause-frame — let the user choose between symptom and cause.

### Visible markers

Fire only when the audit produced something:

- `**Frame**: <one-sentence restatement>` — always when audit fires
- `**Cause-frame**: <reframe>` — when symptom→cause move is real
- `**Considered framings**: (a) X, (b) Y — going with X because ...` — when frame audit (step 8) surfaced a real alternative

Silent passes need no markers. Performative markers on every response defeat the purpose.

> **Detailed body**: Full step-back protocol with worked examples, stakeholder-check templates, and falsifiability test → [`problem-framing-audit/SKILL.md`](../problem-framing-audit/SKILL.md). Always-on gate → [`problem-framing-audit.instructions.md`](../../instructions/problem-framing-audit.instructions.md). User-invokable → [`/problem-framing-audit.prompt.md`](../../prompts/problem-framing-audit.prompt.md).

---

## The Materiality Gate (Discipline Zero)

Before applying any of the seven disciplines, ask one question:

> **If I got this wrong, would it change any decision?**

If the answer is no, document the finding as "approximately X" or "around Y" and move on. Rigorous analysis has a cost: time, attention, token spend, reader patience. That cost is only justified when the finding affects decisions.

### When to Invest in Rigorous Analysis

| Finding Type                               | Impact if Wrong        | Invest? |
| ------------------------------------------ | ---------------------- | ------- |
| Medication dose                            | Wrong treatment        | **Yes** |
| Allergy status                             | Safety risk            | **Yes** |
| Active diagnosis affecting care            | Missed treatment       | **Yes** |
| Lab value near threshold                   | Different intervention | **Yes** |
| Date of 20-year-old elective procedure     | None                   | **No**  |
| Exact month of a historical event          | None                   | **No**  |
| Which clinic performed a routine screening | None                   | **No**  |

### The LASIK Lesson

This discipline was added after a documented failure: I spent significant effort testing hypotheses about whether "LASIK 2005" was a procedure technology name or a data entry error when the EHR showed conflicting dates (2005 vs 2007). The rigorous methodology was sound. The decision to apply it was wrong. The exact LASIK date has no impact on any current clinical decision. "Around 2007" would have been sufficient.

The right response would have been: "Does the exact LASIK date affect any clinical decision? No? Then 'around 2007' is sufficient. Move on."

### Materiality by Domain

| Domain       | High-Materiality Examples                    | Low-Materiality Examples                       |
| ------------ | -------------------------------------------- | ---------------------------------------------- |
| Health       | Med doses, allergies, active diagnoses       | Historical procedure dates, discontinued meds  |
| Code         | Security vulnerabilities, data corruption    | Code style, variable naming                    |
| Architecture | Scalability limits, single points of failure | Framework choice for internal tools            |
| Security     | Authentication bypass, privilege escalation  | Minor info disclosure in non-sensitive context |

---

## The Seven Disciplines

### 1. Alternative Hypothesis Generation

**Failure mode**: Settling on the first plausible explanation and stopping.

**Protocol**: For every significant finding or recommendation, generate at least two alternative explanations. Document them even when you favor one.

**Activation questions**:

- What else could explain this?
- What if the first explanation is a symptom, not the cause?
- If I had to argue the opposite, what evidence would I use?

**Domain examples**:

| Domain       | Before                          | After                                                                                                                                                          |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health       | "Tachycardia is caused by POTS" | "Three possible contributors: POTS, iron deficiency (ferritin 17), subclinical hyperthyroidism (TSH 0.39). A synthesis: overlapping causes."                   |
| Code review  | "This bug is in the handler"    | "Two hypotheses: (1) handler logic error, (2) upstream data already corrupted before handler receives it. Check: add logging before handler entry."            |
| Architecture | "We need a cache layer"         | "Three options: (1) cache layer, (2) optimize the query itself, (3) the problem is N+1 queries, not speed. Profile before deciding."                           |
| Security     | "SQL injection vulnerability"   | "Confirmed injection, but also check: (1) is the ORM bypassed elsewhere? (2) are stored procedures using dynamic SQL? The visible bug may indicate a pattern." |

---

### 2. Missing Data Identification

**Failure mode**: Analyzing what's present and ignoring what's absent.

**Protocol**: Actively ask what data, tests, evidence, or perspectives are missing. Gaps are invisible unless you look for them.

**Activation questions**:

- What has never been tested or measured?
- What assumption am I making because data is absent?
- What would a skeptic ask for that I don't have?
- Is "not found" being treated as "ruled out"?

**The critical distinction**: "Not tested" is not the same as "normal." "Not documented" is not the same as "doesn't exist." "No evidence of X" is not the same as "evidence of no X."

**Domain examples**:

| Domain       | Missing Data Type         | Question                                                        |
| ------------ | ------------------------- | --------------------------------------------------------------- |
| Health       | Tests never ordered       | Which conditions were assumed benign without exclusion testing? |
| Code         | Error paths not tested    | What happens when this dependency is unavailable?               |
| Architecture | Failure modes not modeled | What if the external API is down for 4 hours?                   |
| Security     | Attack vectors not tested | Has this been tested for SSRF, not just XSS?                    |
| Research     | Populations not studied   | Does the cited study match the target population?               |

---

### 3. Evidence Quality Assessment

**Failure mode**: Treating all sources as equally authoritative.

**Protocol**: For every cited source, evaluate its weight before building on it.

| Quality Signal           | Question                                                         |
| ------------------------ | ---------------------------------------------------------------- |
| **Source authority**     | Primary source, review, opinion piece, or Stack Overflow answer? |
| **Recency**              | Is this from 2024 or 2019? Has the landscape changed?            |
| **Sample/scope**         | n = 20 or n = 20,000? One project or industry-wide?              |
| **Population match**     | Does this apply to the specific context, or a different one?     |
| **Conflict of interest** | Who funded/wrote this? Do they benefit from the conclusion?      |
| **Effect size**          | Statistically significant or actually meaningful?                |
| **Reproducibility**      | Has this been replicated? Or is it a single finding?             |

**Red flags**: A single blog post treated as definitive. A 2019 recommendation applied uncritically to a 2026 framework. A manufacturer's whitepaper as evidence their product works. A case report generalized to a population.

---

### 4. Self-Report Skepticism

**Failure mode**: Taking user-provided or historically documented data at face value without cross-checking.

**Protocol**: Cross-check subjective claims against objective data when available. Prefer measurements over adjectives. Prefer logs over descriptions.

| Subjective                    | Objective Cross-Check                               |
| ----------------------------- | --------------------------------------------------- |
| "It's slow"                   | Actual response time in ms                          |
| "It works locally"            | CI pipeline results                                 |
| "Users want X"                | Telemetry, usage data, support tickets              |
| "We tried that and it failed" | What specifically was tried? Under what conditions? |
| "Exercise: minimal"           | Step count, heart rate data                         |
| "The fix was deployed"        | Deployment logs, health check results               |

This isn't about distrust. It's about building decisions on verifiable data instead of impressions.

---

### 5. Cognitive Bias Detection

**Failure mode**: AI inherits human cognitive biases from training data and amplifies them through pattern matching.

**Protocol**: At decision points, test for specific named biases.

| Bias                  | How It Manifests                                          | Countermeasure                                 |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| **Anchoring**         | First explanation sticks, alternatives dismissed          | Explicitly list alternatives before choosing   |
| **Confirmation**      | Searching for supporting evidence, ignoring disconfirming | Search for disconfirming evidence too          |
| **Availability**      | Recent or dramatic finding overshadows chronic issue      | Weight by impact, not recency                  |
| **Premature closure** | Accepting first plausible explanation                     | Require 2+ hypotheses for significant findings |
| **Sunk cost**         | Keeping a bad decision because of prior investment        | Evaluate current merit, not historical cost    |
| **Authority**         | Accepting claim because source is prestigious             | Evaluate the argument, not the speaker         |
| **Bandwagon**         | "Everyone uses this framework"                            | Does it fit THIS context?                      |

**Self-test**: If you feel very certain about a conclusion, that's a signal to test harder. Certainty is a bias indicator, not a quality indicator.

---

### 6. Falsifiability Requirements

**Failure mode**: Stating conclusions without specifying what would invalidate them.

**Protocol**: Every significant recommendation or conclusion must include: "This would need revision if [specific condition]."

**Template**:

> **Recommendation**: [The conclusion]
> **Would revise if**: [Specific finding, result, or evidence that would change this]

**Domain examples**:

| Domain       | Recommendation                             | Would Revise If                                                        |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------- |
| Health       | "Iron supplementation recommended"         | Ferritin rises to 100 and fatigue persists — iron wasn't the driver    |
| Code         | "This fix resolves the race condition"     | The issue reproduces under higher concurrency — fix is incomplete      |
| Architecture | "This design handles 10K concurrent users" | Load testing shows degradation at 5K — bottleneck isn't where we think |
| Security     | "Input validation prevents injection"      | A bypass is found via multipart form data — validation is incomplete   |

If nothing could change the conclusion, it's a belief, not a reasoned position.

---

### 7. The Devil's Advocate Pass

**Failure mode**: Producing analysis without adversarial review.

**Protocol**: Before finalizing any significant output, argue against your own strongest conclusion.

**Three-step pass**:

1. **Attack the strongest recommendation.** What's the weakest link in the evidence chain? What assumption, if wrong, collapses the whole argument?

2. **Find the most uncomfortable implication.** What does the analysis suggest that's hardest to act on? (The answer the user doesn't want to hear is often the most important one.)

3. **Question your highest-confidence claim.** Certainty is where reasoning is most likely to be lazy. The thing you're "sure" about is exactly what needs scrutiny.

**Integration**: The Devil's Advocate pass should produce visible output — not just an internal check. If the adversarial review changes nothing, state why. If it surfaces a weakness, document it.

---

## The Epistemic Foundation: Never Guess

Underneath all seven disciplines sits a non-negotiable rule: when data is missing, say so. Do not fill gaps with plausible-sounding fabrications.

### The "Never Guess" Decision Table

| If this is missing...       | Write this                 | Not this                      |
| --------------------------- | -------------------------- | ----------------------------- |
| A date                      | "Date not documented"      | "Approximately 2018"          |
| A specific value            | (omit or mark unknown)     | An inferred value             |
| A source / citation         | (don't cite it)            | A plausible-looking reference |
| A causal relationship       | "Associated with"          | "Caused by"                   |
| An unconfirmed state        | "Suspected, not confirmed" | The state as established fact |
| A trend from one data point | "Single measurement"       | "Trending up/down"            |
| Severity or priority        | "Not assessed"             | An assumed severity level     |

**Principle**: "Unknown" is a valid and necessary answer. A guess closes the wrong doors. An honest gap keeps all doors open.

### Implementation Pattern

Place the "never guess" discipline **before** the main workflow in any skill, not after. The constraint must be loaded before processing begins — it's a gate, not a review.

---

## Domain Adaptation

This skill provides domain-agnostic protocols. Heir projects should extend it with domain-specific content:

### How to Create a Domain Extension

1. **Identify the domain's critical failure modes** — What goes wrong when the AI reasons poorly here?
2. **Prioritize the disciplines** — Not all 7 apply equally. Health needs all 7. A code formatting task needs maybe 1-2.
3. **Write worked examples with real domain data** — Abstract principles are ignored; concrete examples are followed.
4. **Place gates in the workflow** — "Never guess" before processing, critical thinking between analysis and output.

### Discipline Priority by Domain

| Discipline                | Health   | Code Review | Architecture | Security | Research | Legal    |
| ------------------------- | -------- | ----------- | ------------ | -------- | -------- | -------- |
| 1. Alternative hypotheses | Required | Required    | Required     | Required | Required | Required |
| 2. Missing data           | Required | Required    | Required     | Required | Required | Required |
| 3. Evidence quality       | Required | Useful      | Useful       | Useful   | Required | Required |
| 4. Self-report skepticism | Required | Useful      | Moderate     | Useful   | Moderate | Moderate |
| 5. Bias detection         | Required | Required    | Required     | Required | Required | Required |
| 6. Falsifiability         | Required | Required    | Required     | Required | Required | Required |
| 7. Devil's Advocate       | Required | Required    | Required     | Required | Required | Required |

### Existing Domain Extensions

This skill ships with no domain-specific extensions in the Edition baseline. Heirs that need a domain extension (e.g. health, security, legal) should:

1. Copy this `SKILL.md` to `.github/skills/local/<domain>-critical-thinking/SKILL.md`
2. Add a `## Domain-Specific Activation Triggers` section listing the file patterns and signals that should fire the heightened intensity for that domain
3. Customize the discipline-priority table to reflect which of the 7 disciplines are required vs useful for that domain

---

## Integration with the Epistemic Pair

```
┌─────────────────────┐     ┌─────────────────────────┐
│  anti-hallucination  │     │   critical-thinking     │
│                      │     │                         │
│  "Don't make it up"  │────▶│  "Challenge reasoning"  │
│                      │     │                         │
│  Gate: fabrication   │     │  Gate: reasoning quality │
└─────────────────────┘     └─────────────────────────┘
         ▲                                 │
         │                                 │
         └─────────────────────────────────┘
                Continuous feedback loop
```

- **anti-hallucination** prevents fabricated inputs from entering reasoning
- **critical-thinking** challenges reasoning that appears correct but may not be

The two skills form a pipeline: don't fabricate → challenge conclusions. Each catches what the other misses. Error-detection during reasoning is currently covered by `epistemic-calibration` (self-correction triggers) and `reliance-nudges` (repeated-error nudge) rather than a dedicated skill.

---

## Output Signals

When critical thinking disciplines fire, they should produce visible markers in the output:

| Marker                          | Meaning                                                |
| ------------------------------- | ------------------------------------------------------ |
| **Alternative hypotheses**: ... | Discipline 1 fired — multiple explanations considered  |
| **What's missing**: ...         | Discipline 2 fired — gaps identified                   |
| **Evidence quality**: ...       | Discipline 3 fired — source reliability assessed       |
| **Would revise if**: ...        | Discipline 6 fired — falsifiability stated             |
| **Adversarial note**: ...       | Discipline 7 fired — Devil's Advocate found a weakness |

These markers are not mandatory for every response. They activate based on the context's activation level (low/medium/high). At high activation (health, security, legal), all markers should be present. At low activation (simple edits), none are needed.

---

## Anti-Patterns

| Anti-Pattern                           | Why It Fails                                  | Correction                                                               |
| -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| "Critical thinking pass" as a checkbox | Mechanical review produces mechanical results | The pass must actually challenge conclusions, not just confirm them      |
| Adding caveats to everything           | Dilutes signal — nothing stands out           | Only flag genuine uncertainties and weaknesses                           |
| Symmetric alternatives                 | "It could be A or B" without analysis         | Assess relative likelihood and evidence for each                         |
| Falsifiability as boilerplate          | "Would revise if new evidence emerges"        | State the _specific_ evidence that would change the conclusion           |
| Devil's Advocate as theater            | Arguing weakly against your own position      | The adversarial argument must be the strongest possible, not a straw man |

---

## Would Revise If

Revise if the 7 disciplines plus Discipline -1 frame audit produce no measurable improvement in conclusion quality over a quarter (skill is theater not load-bearing), if high-stakes work consistently passes through without any of the gates firing (the materiality calibration is too lax), or if the visible-marker requirements produce stacked decorative markers that defeat their auditing purpose.
