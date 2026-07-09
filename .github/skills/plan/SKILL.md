---
name: plan
description: Use when the user wants a plan instead of execution, or before any non-trivial implementation (multi-file, architectural choice, > 15 min). Writes a concrete actionable markdown plan with bite-sized tasks (2-5 min each), exact file paths, complete code, and verification steps. Adapted from Hermes Agent / obra/superpowers.
lastReviewed: 2026-06-07
---

# Plan Mode

Use this skill when the user asks for a plan, says "design before building", types `/plan`, or when the work obviously spans multiple files / requires architectural choice / will take more than ~15 minutes.

## Core behavior

For this turn, you are planning only.

- Do not implement code
- Do not edit project files except the plan markdown file
- Do not run mutating terminal commands, commit, push, or perform external actions
- You may inspect the repo or other context with read-only commands when needed
- Your deliverable is a markdown plan saved under `docs/plans/`

## Output requirements

Write a markdown plan that is concrete and actionable.

Include, when relevant:

- Goal
- Current context / assumptions
- Proposed approach
- Step-by-step plan
- Files likely to change
- Tests / validation
- Risks, tradeoffs, and open questions

If the task is code-related, include exact file paths, likely test targets, and verification steps.

## Save location

Save the plan under the repo's `docs/plans/` directory:

- `docs/plans/YYYY-MM-DD-<slug>.md` for plans tied to a specific date
- `docs/plans/PLAN-<feature>.md` for living plans that get re-edited as the work progresses

If the repo has no `docs/` folder, create one. If the user names a different target path, use that exactly.

## Interaction style

- If the request is clear enough, write the plan directly
- If no explicit instruction accompanies `/plan`, infer the task from the current conversation context
- If it is genuinely underspecified, ask one brief clarifying question instead of guessing
- After saving the plan, reply briefly with what you planned and the saved path

---

# Writing the Plan Well

The rest of this skill is the craft of authoring a *good* implementation plan — the content that goes inside the markdown file above.

## Overview

Write comprehensive implementation plans assuming the implementer has zero context for the codebase and questionable taste. Document everything they need: which files to touch, complete code, testing commands, docs to check, how to verify. Give them bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume the implementer is a skilled developer but knows almost nothing about the toolset or problem domain. Assume they don't know good test design very well.

**Core principle:** A good plan makes implementation obvious. If someone has to guess, the plan is incomplete.

## When a Full Implementation Plan Helps

**Always use before:**

- Implementing multi-step features
- Breaking down complex requirements
- Delegating work to a worker subagent (see [agent-delegation](../../instructions/agent-delegation.instructions.md))

**Don't skip when:**

- Feature seems simple (assumptions cause bugs)
- You plan to implement it yourself (future you needs guidance)
- Working alone (documentation matters)

## Bite-Sized Task Granularity

**Each task = 2-5 minutes of focused work.**

Every step is one action:

- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

**Too big:**

```markdown
### Task 1: Build authentication system
[50 lines of code across 5 files]
```

**Right size:**

```markdown
### Task 1: Create User model with email field
[10 lines, 1 file]

### Task 2: Add password hash field to User
[8 lines, 1 file]

### Task 3: Create password hashing utility
[15 lines, 1 file]
```

## Plan Document Structure

### Header (Required)

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

### Task Structure

Each task follows this format:

````markdown
### Task N: [Descriptive Name]

**Objective:** What this task accomplishes (one sentence)

**Files:**

- Create: `exact/path/to/new_file.py`
- Modify: `exact/path/to/existing.py:45-67` (line numbers if known)
- Test: `tests/path/to/test_file.py`

**Step 1: Write failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

**Step 2: Run test to verify failure**

Run: `pytest tests/path/test.py::test_specific_behavior -v`
Expected: FAIL — "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test to verify pass**

Run: `pytest tests/path/test.py::test_specific_behavior -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## Writing Process

### Step 1: Understand Requirements

Read and understand:

- Feature requirements
- Design documents or user description
- Acceptance criteria
- Constraints

### Step 2: Explore the Codebase

Use the workspace's search and read tools to understand the project:

- Understand project structure — list/glob files under relevant directories
- Look at similar features — search for related patterns
- Check existing tests — find the test directory and conventions
- Read key files — open the main entry points

### Step 3: Design Approach

Decide:

- Architecture pattern
- File organization
- Dependencies needed
- Testing strategy

### Step 4: Write Tasks

Create tasks in order:

1. Setup/infrastructure
2. Core functionality (TDD for each)
3. Edge cases
4. Integration
5. Cleanup/documentation

### Step 5: Add Complete Details

For each task, include:

- **Exact file paths** (not "the config file" but `src/config/settings.py`)
- **Complete code examples** (not "add validation" but the actual code)
- **Exact commands** with expected output
- **Verification steps** that prove the task works

### Step 6: Review the Plan

Check:

- [ ] Tasks are sequential and logical
- [ ] Each task is bite-sized (2-5 min)
- [ ] File paths are exact
- [ ] Code examples are complete (copy-pasteable)
- [ ] Commands are exact with expected output
- [ ] No missing context
- [ ] DRY, YAGNI, TDD principles applied

## Principles

### DRY (Don't Repeat Yourself)

**Bad:** Copy-paste validation in 3 places
**Good:** Extract validation function, use everywhere

### YAGNI (You Aren't Gonna Need It)

**Bad:** Add "flexibility" for future requirements
**Good:** Implement only what's needed now

```python
# Bad — YAGNI violation
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
        self.preferences = {}  # Not needed yet!
        self.metadata = {}     # Not needed yet!

# Good — YAGNI
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
```

### TDD (Test-Driven Development)

Every task that produces code should include the full TDD cycle:

1. Write failing test
2. Run to verify failure
3. Write minimal code
4. Run to verify pass

See [test-driven-development](../test-driven-development/SKILL.md) for details.

### Frequent Commits

Commit after every task:

```bash
git add [files]
git commit -m "type: description"
```

## Common Mistakes

### Vague Tasks

**Bad:** "Add authentication"
**Good:** "Create User model with email and password_hash fields"

### Incomplete Code

**Bad:** "Step 1: Add validation function"
**Good:** "Step 1: Add validation function" followed by the complete function code

### Missing Verification

**Bad:** "Step 3: Test it works"
**Good:** "Step 3: Run `pytest tests/test_auth.py -v`, expected: 3 passed"

### Missing File Paths

**Bad:** "Create the model file"
**Good:** "Create: `src/models/user.py`"

## Execution Handoff

After saving the plan, offer the execution approach:

> "Plan complete and saved to `docs/plans/<slug>.md`. Ready to execute task by task — I'll work each task with TDD, run verification, and commit before moving to the next. Shall I proceed?"

## Remember

```text
Bite-sized tasks (2-5 min each)
Exact file paths
Complete code (copy-pasteable)
Exact commands with expected output
Verification steps
DRY, YAGNI, TDD
Frequent commits
```

**A good plan makes implementation obvious.**

## Related

- [test-driven-development](../test-driven-development/SKILL.md) — discipline each plan task should follow
- [spike](../spike/SKILL.md) — when you don't know enough yet to plan; spike first, then plan
- [problem-framing-audit](../problem-framing-audit/SKILL.md) — frame audit BEFORE drafting the plan
- [agent-delegation](../../instructions/agent-delegation.instructions.md) — for plans that fan out across worker subagents

## Would Revise If

- **Event-based**: zero observed invocations across the fleet within 90 days; OR no markdown plan files produced under any heir's `docs/plans/` by 2026-09-07. Either signal indicates the skill is decorative — sunset.
- **Date-based**: 2026-09-07 (90 days from adoption). If by then `plan` is invoked but heirs report that the bite-sized-task granularity (2-5 min) consistently mismatches their work shape, revise the granularity rule.
- **Counter-evidence**: if heir feedback shows plans get written but never executed (write-only artifacts), the Execution Handoff section is failing — tighten the handoff prompt or sunset.

## Attribution

Adapted from [Hermes Agent](https://github.com/NousResearch/hermes-agent) (Nous Research, MIT), which itself adapted the writing-craft sections from [obra/superpowers](https://github.com/obra/superpowers). Both upstream sources MIT-licensed.
