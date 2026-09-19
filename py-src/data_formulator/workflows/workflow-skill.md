# Workflow Planning Skill

Use this skill to author, inspect, execute, and adapt a concrete analysis plan.
The YAML describes the work; tool results establish what actually happened.
A step being visited, a successful tool call, and a verified deliverable are
different things. Never substitute one for another.

## Plan Organization

A workflow is a YAML mapping with these fields:

| Field | Meaning |
| --- | --- |
| `version` | Required; use `1`. |
| `name` | Required, nonempty human-readable workflow name. |
| `overview` | Required, nonempty library summary, not execution history. |
| `prompt` | Optional, nonempty overall task, scope, and analytical intent. |
| `source` | Optional guidance: nonempty text, a mapping, or a list of either. |
| `deliverables` | Required, nonempty list of concrete output descriptions. |
| `steps` | Required ordered list of 1-30 named steps. |

Each authored step needs a unique `id`, a human-facing `description`, and nonempty
`instructions`. Write `description` as one or two plain-language sentences about
what this stage accomplishes and why it matters to the reader. Keep tool names,
execution procedures, and verification details in `instructions` and `checkers`,
not in the description. Older workflows without descriptions remain valid.
Prefer stable IDs
such as `gather`, `analyze`, and `report` over IDs containing a date or status.
Optional `next` identifies an existing step. Optional `checkers` is a list of:

- `id`: nonempty, unique across the entire plan.
- `condition`: an observable acceptance criterion, not "looks good".
- `when`: `before`, `during`, or `after`; omission means `after`.
- `on_fail`: optional existing step ID to revisit when the check fails.

Quote dates and other values YAML might interpret as non-JSON types. Do not put
credentials in a plan. Keep the document within 48,000 characters. Do not invent
new executable YAML fields, adapters, schedules, or template substitution syntax.
Source descriptions, including formal API specifications, remain guidance for
tools; they are not an execution engine or additional authorization.

## Author a Useful Plan

1. Establish the requested subjects, measures, time range, freshness, granularity,
   output format, and important exclusions. Distinguish requirements from defaults.
2. Inspect existing workspace inputs and connected metadata before inventing a
   source. Describe what must be found if its exact location is not yet known.
3. Define inspectable deliverables first: native tables, charts, files, or reports.
4. Group work into a few meaningful stages. State the inputs, computation or
   decision, expected outputs, and acceptance conditions for each stage.
5. Place checks where they detect failures early. Include final independent
   verification after the last published output, not only before writing a report.
6. Give failures an actionable recovery route. A failed check is information to
   repair from, not a reason to silently weaken its condition.
7. Validate IDs, transitions, coverage of every deliverable, and the YAML schema.

Example of a concrete, workspace-based analysis:

```yaml
version: 1
name: Monthly Sales Review
overview: Compare monthly sales by region and verify the published review.
prompt: Summarize regional sales for January through June 2026 in reporting currency.
source:
  - Find the connected sales table with transaction date, region, and sales amount.
  - Use workspace documentation to confirm currency and treatment of returns.
deliverables:
  - A native table of monthly net sales by region.
  - A line chart comparing regions.
  - A Markdown review documenting findings, coverage, and limitations.
steps:
  - id: gather
    description: Collect the sales data needed for a reliable regional comparison.
    instructions: Inspect metadata and load the requested sales subset, reusing suitable workspace data.
    next: analyze
    checkers:
      - id: coverage
        condition: Data covers "2026-01-01" through "2026-06-30" and the currency and returns convention are known.
        when: after
        on_fail: gather
  - id: analyze
    description: Compare monthly sales across regions and identify the main differences.
    instructions: Aggregate net sales by month and region, publish the table and line chart, and reconcile totals.
    next: report
    checkers:
      - id: totals
        condition: Monthly regional totals reconcile to the source subset under the documented returns convention.
        on_fail: analyze
  - id: report
    description: Summarize the findings and confirm that the review agrees with the data.
    instructions: Publish the review, then independently verify its numerical claims against the final outputs.
    checkers:
      - id: final_review
        condition: Final table, chart, and report agree; all required outputs and limitations are present.
        on_fail: report
```

## Execute and Assess Progress

Read the entire current plan before acting. Inspect recorded evidence and existing
artifacts; do not repeat a completed import or approved command merely because a
run resumed. Call `move_to_step` before working in another named step, including
an earlier step. Explain why the transition is necessary.

Use `propose_data_operation` with `user_review_needed: false` for a single,
grounded recommendation that meets the request. Use review for ambiguous options
or material substitutions. Historical monthly data is not a substitute for fresh
daily data; a different benchmark is not interchangeable without user agreement.
The review UI and its preview do not themselves execute a load.

Use actual returned evidence IDs for checks. Keep failed and inconclusive results
honest. Navigation and unrelated new outputs do not invalidate passing step checks.
Do not repeat them merely because the output revision increased. The current plan's
`current_checks` lists retained results. Changed or deleted evidence inputs, resolved
user decisions, and plan changes can require fresh checks. Evidence conservatively
tracks all workspace tables, files, and scratch files present when it was recorded;
scripts do not yet expose precise read dependencies. Legacy evidence without input
fingerprints remains tied to its original output revision.

Final-output verification is separate from step checks. Delivery still requires
current checks, evidence for every deliverable, and a successful independent
verification script after the final outputs. Neither prose nor `write_report`
completes a workflow.

## Adapt the Active Run

User steering and discovered context can make the execution plan obsolete. First
assess whether an existing step can handle the change. Use `move_to_step` for a
revisit; use `adapt_plan` when steps, dependencies, or acceptance criteria must
change. Do not merely acknowledge a new instruction and keep following the old plan.

`adapt_plan` accepts a reason, the complete replacement `steps` array using the
same structure as YAML, and `step_id` naming a step in that revised plan. The tool
requires the same human-facing descriptions when authoring revised steps. The tool
revises only the active run. It does not save or overwrite the library YAML, and
does not silently change the original deliverables or grant new authorization.

After adaptation, the runtime requires `review_plan` before substantive work.
Read retained evidence with the inspection tools when needed. Submit every step
exactly once with its `id`, `status` (`pending` or `completed`), `explanation`, and
`evidence_ids`, plus the `step_id` to execute next. For every step, distinguish work that is still pending
from work supported by reusable evidence. Explain carry-forward decisions and cite
the actual earlier evidence. An old step's matching ID, visited marker, or checkmark
does not prove the new step is complete. Reassess changed criteria even when IDs
are reused. Pick the first step that needs work only after this assessment.

Keep earlier plans, progress, checks, transitions, tool evidence, and outputs as
history. Do not relabel old calls as actions performed under the new plan. The
latest accepted plan controls subsequent work, while prior results remain available
for inspection and explicit reuse. Never remove a checker just to evade failure.

When context cannot satisfy the task, explain the specific mismatch and ask the
user before a material compromise. Terminal approvals, connection confirmation,
sandbox restrictions, and source access rules remain in force after adaptation.