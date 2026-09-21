# Workflow Planning Skill

Use this skill to author, inspect, execute, and adapt a concrete analysis plan.
The YAML describes the work; tool results establish what actually happened.
A step being visited, a successful tool call, and a verified deliverable are
different things. Never substitute one for another.

## Plan Organization

The definition is validated against the workflow contract; tool schemas describe
the structures to author. YAML is its storage representation, not a template engine.
Parameters describe inputs that can vary between runs; confirmed setup values
override defaults and must be used consistently in calculations, checks, and labels.
Interpret parameter values together with freeform setup instructions as information
from the user. Convert formats internally for tools and record the resolved scope;
clarify material ambiguity, not the formatting of an understandable answer.
Keep fixed requirements in the definition and execution progress in the run.
Source descriptions remain guidance for tools, not executable adapters or additional
authorization. Never put credentials in a definition.

## Author a Useful Plan

1. Establish the requested subjects, measures, time range, freshness, granularity,
   output format, and important exclusions. Distinguish requirements from defaults.
2. Inspect existing workspace inputs and connected metadata before inventing a
   source. Describe what must be found if its exact location is not yet known.
3. Define inspectable deliverables first: native tables, charts, files, or reports.
4. Group work by analytical goals or questions, not mechanical phases such as
  loading all data followed by creating all charts. Each phase publishes inspectable
  artifacts that answer its analytical question and checks their correctness; coverage notes or tables may suffice for
  nonvisual work. Reuse valid data, computations, and outputs on resume, and honor
  explicit reuse requests.
5. Place checks where they detect failures early. Include final independent
   verification after the last published output, not only before writing a report.
6. Give failures an actionable recovery route. A failed check is information to
   repair from, not a reason to silently weaken its condition.
7. Check that every deliverable has a producing step and meaningful verification.

Example of a concrete, workspace-based analysis:

```yaml
version: 1
name: Monthly Sales Review
overview: Compare monthly sales by region and verify the published review.
parameters:
  - name: reporting_period
    label: Reporting period
    type: text
    required: true
    default: January through June 2026
prompt: Summarize regional sales for the selected reporting period in reporting currency.
source:
  - Find the connected sales table with transaction date, region, and sales amount.
  - Use workspace documentation to confirm currency and treatment of returns.
deliverables:
  - A native table of monthly net sales by region.
  - A line chart comparing regions.
  - A table and bar chart of each region's contribution to the change in sales.
  - A Markdown review documenting findings, coverage, and limitations.
steps:
  - id: regional_trends
    description: Compare monthly sales across regions to identify divergent trends.
    instructions: Inspect metadata, load or reuse the requested sales subset, confirm currency and returns conventions, aggregate monthly net sales by region, and publish the supporting table and a new line chart for this run with a brief interpretation of regional trends.
    next: growth_drivers
    checkers:
      - id: coverage
        condition: Data covers the selected reporting period and the currency and returns convention are known.
        when: after
        on_fail: regional_trends
      - id: totals
        condition: The published monthly table and chart agree and reconcile to the source subset under the documented returns convention.
        on_fail: regional_trends
  - id: growth_drivers
    description: Identify which regions account for the change in sales over the reporting period.
    instructions: Reuse the monthly regional sales table, compute each region's absolute change from the first to last month of the selected period, and publish a contribution table and a new diverging bar chart for this run with a brief interpretation. Flag missing endpoint data rather than treating it as zero.
    next: synthesize_findings
    checkers:
      - id: contribution_totals
        condition: The published contribution table and chart agree, contributions sum to the overall first-to-last-month change for the selected period, and missing endpoints are identified.
        on_fail: growth_drivers
  - id: synthesize_findings
    description: Summarize the findings and confirm that the review agrees with the data.
    instructions: Publish the review, then independently verify its numerical claims against the final outputs.
    checkers:
      - id: final_review
        condition: Final tables, charts, and report agree; all required outputs and limitations are present.
        on_fail: synthesize_findings
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