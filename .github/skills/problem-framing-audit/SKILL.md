---
name: problem-framing-audit
description: Step-back protocol — restate, generalise, specialise, invert, ask why, pre-mortem, check stakeholders, and audit framings before solving
lastReviewed: 2026-04-30
---

# Problem Framing Audit (Discipline -1)


> Before you solve, audit the frame. A flawless solution to the wrong problem is still a wrong answer.

## Purpose

The first failure mode in critical thinking is solving the wrong problem precisely (Mitroff & Featheringham 1974, Type III error). Most "thinking harder" effort runs downstream of a frame that was never audited — the user's literal request, restated as my plan, treated as ground truth. This skill is the structural answer.

The frame audit runs **before** the materiality gate. Materiality asks "if I get this answer wrong, would it change anything?" Framing asks something prior: "am I even working on the right question?"

## When to Activate

| Trigger | Activation |
|---|---|
| Single-file edit, < 15 minutes of work, mechanical task | **Skip** — frame audit adds friction without payoff |
| Task uses the words "fix", "improve", "make faster", "speed up", "broken", "make it work" | **Always audit** — these phrases hide a symptom-frame |
| Task spans 3+ files, requires architectural choice, or estimates > 15 minutes | **Always audit** |
| User restates the same request after a failed attempt | **Always audit** — repeated failure is a signal the frame is wrong |
| User says "just" do X, or "simply" Y, or "all you have to do is" | **Always audit** — these phrases mark unexamined frames |
| User explicitly invokes `/problem-framing-audit` or asks "what am I missing?" | **Always audit** |

The rule is asymmetric on purpose: trivial tasks pass through; non-trivial tasks audit first.

## The Step-Back Protocol

Eight checks. The discipline is **not** to run all eight on every problem — it is to run *at least one* before committing to a solution. Pick the check most likely to surface a different framing for this specific request.

| # | Check | Activation question | Source |
|---|---|---|---|
| **1. Restate** | Can I write the problem in one sentence in my own words? | If I can't, I don't understand it yet. Ask. | Polya 1945 — *What is the unknown?* |
| **2. Generalise** | What is this a special case of? | Naming the general class often reveals existing solutions and prior art. | Polya 1945 |
| **3. Specialise** | What's the simplest concrete instance? | If the simplest case is already hard, the general case is the wrong target. | Polya 1945 |
| **4. Invert** | What would make this worse? What would I do if I wanted to fail? | Inversion exposes hidden constraints. | Munger / Jacobi |
| **5. Five Whys** | Why is this a problem? And why is *that* a problem? Repeat 5×. | Surfaces the cause-frame underneath the symptom-frame. | Toyota / Ohno |
| **6. Pre-mortem** | Imagine we're done and it didn't work — what went wrong? | Reduces overconfidence by ~30% in field studies. | Klein 2007 |
| **7. Stakeholder check** | Whose problem is this, really? What outcome would tell *them* it's solved? | "Make X faster" might be the wrong job if the user doesn't actually run X often. | Checkland 1981 (CATWOE) |
| **8. Frame audit** | What other framings exist? Have I considered at least two? | Russo & Schoemaker: < 10% of decision effort goes to framing; ≥ 80% of decisions are downstream of an unaudited frame. | Russo & Schoemaker 2002 |

## The Symptom → Cause Move

The most common type-III error: the user names a *symptom* and I optimise for it. The audit's job is to surface the *cause* underneath.

| Symptom-frame (what user said) | Cause-frame (what audit surfaces) | Right move |
|---|---|---|
| "Make this function faster" | Function is fine; it's called 1000× when it should be called 1× | Cache or batch the caller, not the function |
| "Fix this flaky test" | The test is correct; the system has a real race condition | Fix the race, not the test |
| "Make the build less noisy" | The warnings are real — system is leaking handles | Fix the leaks; the noise was the diagnostic |
| "Why does this query take 2 minutes?" | Query is fine; it returns 47M rows the UI then renders | Fix the contract, not the query |
| "Add a workaround for this API quirk" | The "quirk" is the API enforcing a real constraint | Honour the constraint, not work around it |
| "Make our skill load faster" | The skill is fine; it's loaded on every request when it should load once | Move the load gate, not the skill body |

In each row, the symptom-frame produces a working but pointless solution. The cause-frame produces the right one.

## Output Markers

When the frame audit fires and produces a different framing than the user's literal request, the response **must** make the move visible:

| Marker | When to use |
|---|---|
| `**Frame**: Restated as ...` | Always when audit fires — confirms my understanding |
| `**Cause-frame**: ...` (when the symptom-frame is being replaced) | When step 5 (Five Whys) or step 7 (Stakeholder) surfaces a different problem |
| `**Considered framings**: (a) X, (b) Y — going with X because ...` | When step 8 surfaces a real alternative |
| `**Pre-mortem**: If this fails, the most likely cause is ...` | When step 6 surfaces a non-obvious failure mode worth flagging |

Markers are not boilerplate — they fire only when the audit produces something. A silent audit that produced no reframe needs no marker; just proceed.

## Anti-Patterns

| Anti-pattern | Why it fails | Correction |
|---|---|---|
| Run all 8 checks on every task | Friction kills the discipline; users stop bringing real work | Pick the one or two checks most likely to fire for this task |
| Restate the user's request word-for-word as the "frame" | That's not a restatement, that's parroting | Use *your own words* — that's the test |
| Run audit, surface a different frame, then solve the user's literal frame anyway | Discipline becomes theatre | If audit surfaces a different frame, *propose it* before solving — let the user choose |
| Skip audit because "it's obvious" | "Obvious" is exactly when frames are most often wrong | If you feel certain, run the audit anyway — that certainty is the signal |
| Ask 8 clarifying questions back-to-back | Audit becomes interrogation | One sharp question is better than 8 generic ones; pick the highest-leverage check |

## Falsifiability Test (per PLAN-CT Lane C)

Track the next 20 non-trivial sessions in which this skill activates. In what percentage did the audit surface a framing different from the user's literal request?

- **Target**: ≥ 20% (Russo & Schoemaker's data suggests cause-frames differ from symptom-frames ~30–40% of the time; 20% is a conservative pass)
- **If 0%**: the audit is decorative. Either the activation rule is too narrow or the audit is rubber-stamping. Retire or rebuild.
- **If 100%**: the audit is over-firing. The activation rule is too broad. Tighten triggers.

## Integration

| Surface | How frame-audit attaches |
|---|---|
| `critical-thinking/SKILL.md` | Inserted as **Discipline -1** before the Materiality Gate; this skill is its detailed body |
| `critical-thinking.instructions.md` | Adds the L1 always-on line: *"Before solving non-trivially, restate the problem in one sentence; if user's framing differs from yours, flag it before proceeding."* |
| `deep-thinking.instructions.md` | The audit is a recommended first step on any deep-thinking session |
| `planner` agent | Frame audit runs before plan decomposition |
| `act-pass` skill | Step 1 of the 7-step pass *is* the frame audit |
| `/problem-framing-audit` prompt | User-invokable trigger to force this skill on a stuck problem |

## Background Reading

- ACT/CRITICAL-THINKING-FAILURE-MODES.md §1 — the master failure mode and the step-back protocol
- ACT/PLAN-critical-thinking-improvement.md Lane C — design rationale and falsifiability
- Russo, J. E., & Schoemaker, P. J. H. (2002). *Winning Decisions*. Doubleday.
- Mitroff, I. I., & Featheringham, T. R. (1974). On systemic problem solving and the error of the third kind. *Behavioral Science*, 19(6).
- Polya, G. (1945). *How to Solve It*. Princeton University Press.
- Klein, G. (2007). Performing a project pre-mortem. *Harvard Business Review*.
- Checkland, P. (1981). *Systems Thinking, Systems Practice*. Wiley.
