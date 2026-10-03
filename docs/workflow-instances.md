# Concrete Workflow Instances

The Workflows sidebar runs concrete YAML analysis instances using the analyst's
Python sandbox and workspace tools, without workflow-specific source adapters.
Saved instances support parameterized, interactive and scheduled execution.
Ordinary AnalystAgent conversations are unchanged.

## Scheduled Runs

Use **New schedule** beside **New workflow** in the Workflows sidebar, or select
an existing schedule to edit it. Choose a saved
workflow, a server-configured model connection, weekdays, local time, and an IANA
timezone. Browser-only model credentials cannot support unattended runs. Each
occurrence creates a separate session tagged **Scheduled**, with its schedule name
and intended execution time. Background runs do not change the open session.

Schedules execute in the local app while its backend is running. Hosted and
ephemeral deployments do not schedule runs; the Schedules views explain that
scheduling is only available locally. On a hosted deployment, administrators
publish workflows and example sessions instead: **Publish as example** on a
session adds it to everyone's Example sessions, and opening one imports a copy
into the viewer's own sessions, like the built-in demos.

The scheduler stores definitions and occurrence records in
`<data-dir>/scheduling/schedules.sqlite3`.

Retries apply only to classified transient model errors, at 30/60/120-second
backoff, with at most three retries and the same session/checkpoint. When all
workflow executor slots are busy, the occurrence is deferred one minute using the
same retry budget. Tool side
effects are not blindly replayed. A backend interruption marks active occurrences
**Needs attention** instead of automatically replaying uncertain work. Overlapping
ticks are recorded as skipped. Missed occurrences are skipped unless run-once
catch-up is enabled; no historical backlog is replayed.

Scheduled runs have a two-hour limit. At the limit the run is paused, the
occurrence is marked **Needs attention**, and later occurrences are no longer
blocked. Operations without cancellation support may still finish in the
background. A scheduled session stays read-only while its occurrence is running
or awaiting a retry, and follows the run live in local mode; it becomes editable
once the occurrence completes or needs attention.

Auto-approval is opt-in. It covers permitted local terminal requests and loading
proposals with a single option; sandbox and connector authorization still apply.
Questions, credentials, alternatives, and interrupted commands need attention.
Use the **Open latest run** control on a workflow or schedule card to visit its
latest available run.

## Try It

1. Start Data Formulator locally and select a working model.
2. Open Workflows and select an instance from Your workflows or Demos. Demos are
  served from bundled YAML without copying them into your library. Start with
  Monthly Household Cost Review for three progressively built visualizations
  using the Consumer Price Index example dataset.
3. Press Run. A session is created when none is open; otherwise choose New session
  or Current session. The agent reads the prompt and
  source guidance, then follows the instance's data and freshness requirements.
4. Follow the single execution prompt in the normal thread. Registered data,
   charts, workspace files, and reports appear directly in Data Formulator.
  The workflow node precedes its outputs. Select it to open step
  progress, checks, and logs in the canvas; completion appears after the outputs.

Required inputs must be accessible through the available tools. Naming a URL,
subscription, or provider in YAML does not fetch it or grant access. If inputs
are unavailable, the agent must request help rather than fabricate data.

Source lists can mix natural-language instructions and formal request specifications
(method, URL, parameters, and expected response format). Both are guidance for the
agent to carry out through existing discovery tools or approved terminal commands,
not a separate REST adapter. A formal spec does not bypass command approval or
other tool authorization requirements.

## Instance Format

The agent's [workflow planning skill](../py-src/data_formulator/workflows/workflow-skill.md)
teaches the schema, source selection, step and checker design, progress assessment,
and run-only adaptation. It is loaded into every workflow run and packaged with
the application; its YAML example is validated by the workflow parser in tests.

```yaml
version: 1
name: Weekly Sales Review
overview: Compare weekly sales with targets using the reporting guide.
prompt: >-
  Find the latest complete week's sales and targets. Read the reporting guide
  for definitions and exclusions, compare performance, and explain material
  differences with supporting data. Report missing inputs explicitly.
source:
  - name: Sales and targets
    connector: Sales warehouse
    tables: [sales, targets]
    freshness: Latest complete week
    instructions: Look for these tables in the workspace; request help if unavailable.
  - name: Reporting guide
    path: files/reporting-guide.pdf
    purpose: Definitions, exclusions, and interpretation of targets
deliverables:
  - Registered comparison data and a workspace CSV.
  - A native sales chart and a verified report embedding that chart.
steps:
  - id: analyze
    instructions: Inspect the specified inputs, apply the reporting guide, compare sales with targets, publish comparisons with create_data and create_file, and create a chart with visualize.
    checkers:
      - id: coverage
        condition: Sales and targets cover the same complete week, totals reconcile, and the reporting guide's exclusions are applied.
        when: after
        on_fail: analyze
    next: report
  - id: report
    instructions: Write the report with the returned chart ID embedded as a chart:// image and review its claims against existing evidence and published data.
    checkers: []
```

Files live in the user's `workflows/` directory, separately from old knowledge
files. Simple `.yaml` filenames are supported. Step and checker IDs must be
unique, and transition references must exist. Cycles and empty checkers are valid.
The editor validates before saving. There is no placeholder substitution.
Use the trash action beside a saved workflow to delete its YAML file after
confirming the filename. Past runs and generated artifacts are preserved.
Deleting a workflow node in a session does not delete its saved YAML instance.

Bundled demos use a read-only `demo/` namespace. Run them directly or customize a
separately named user copy. A user workflow with the same base filename remains
distinct; save and delete operations cannot modify the server demo. The
household-cost demo uses historical sample prices, not a live CPI feed. Unchanged
inputs reproduce the same review; refreshed compatible inputs advance its as-of
month. The first sample import needs access to its public dataset file but no
provider credentials.

`overview` is the short library description. `prompt` is optional nonempty text
describing the overall task, what to find, and how to use the inputs. `source`
is optional nonempty text, a mapping, or a list of text/mapping entries. It can
identify data and documents through workspace IDs, connector names, paths, URLs,
search criteria, date ranges, purposes, and acquisition instructions. These fields
are agent guidance, not an adapter configuration or permission to bypass tool
restrictions. Do not put credentials in YAML.
Prefer descriptive source text in new instances. For example, the bundled stock
review describes Yahoo Finance, the MSFT/SPY symbols, the requested time window,
and acquisition constraints in prose. Structured mappings remain supported as
guidance; fields such as `kind` do not select a built-in handler.

The full instance, including prompt and source entries, is saved in the run
snapshot and supplied to the agent unchanged. Existing provider-specific source
mappings remain readable as guidance; they no longer invoke automatic fetchers.

## Execution and Verification

WorkflowAgent owns a separate loop and workflow-specific instructions while reusing
the analyst's tool registry, discovery handlers, model streaming, and sandbox
computation machinery. It does not inherit the analyst's stop-on-prose or short
action-budget policy. A plain-text answer cannot finish a run.
The model acquires data, executes analysis, records checks, moves between named
steps, writes the report, and explicitly reports delivery.

The native `create_data`, `update_data`, `create_file`, `edit_file`, and
`visualize` tools reuse the analyst's workspace and visualization handlers.
Reports use the normal report view and can embed native charts by ID. Outputs
are registered under one initial execution turn; replaying a checkpoint does
not duplicate them. A recovery reply is a new user turn only when text is supplied.
Existing saved instances are not rewritten automatically; edit their deliverables
and instructions to request native publication if they previously requested only
scratch downloads.

Python scripts are read-only in the sandbox. They return generated files via an
`outputs` mapping, for example `outputs = {'comparison.csv': dataframe}`. The host
saves DataFrames as CSV/Parquet and strings as Markdown/text/JSON, confined to the
run directory. The final report filename is reserved. Each script has a
fresh namespace and can reread saved files. These scratch outputs are internal
intermediates. User-facing deliverables must use the native publication tools.

Checks reference actual tool observation IDs. Changed or deleted evidence inputs
invalidate dependent checks; unrelated new outputs, navigation, and acknowledgments
preserve them. Evidence currently fingerprints all workspace tables, files, and scratch
files present at observation time, so unrelated edits can also invalidate checks.
User decisions require reassessment of affected conclusions, not automatic repetition
of completed work. Delivery reviews published outputs against existing evidence, with
current passing checks and a supporting explanation for every declared deliverable.
There is no blanket requirement for a new post-publication script: investigate only
gaps, inconsistencies, or changed inputs or requirements, while honoring any explicit
independent validation required by the workflow. These are structural
guards: check outcomes and analytical correctness remain agent-reported, not
independently guaranteed by the runtime.

Raw acquisition and intermediate artifacts live under session scratch
`workflow-<run-id>/`; published data and files use normal workspace storage, and
chart/report/turn state uses normal session persistence. Private checkpoints
live under `_workflow_runs/` and include the original instance and active plan, model
trajectory, transition history, evidence, and cumulative budgets. Editing the
instance affects future runs only. Resume continues the same run; a fresh run
uses the latest saved instance and its specified data requirements.

Terminal proposals use the analyst's exact-command approval mechanism. Review the
command in the automatic approval popup, then approve it once or reject it. Approved commands
run through the shared scratch-confined runner; their results become evidence and
the same workflow continues. Expired proposals can be rejected before requesting a
new command. A pending proposal is never execution evidence. Network and shell
access remain forbidden in analysis Python; approved terminal execution is separate.

Connected sources can be discovered with the shared workspace tools. A single grounded
import with `user_review_needed: false` executes automatically, publishes its actual
results, and continues the run. Ambiguous options and material substitutions require
the shared review panel and data-preview canvas; submitting the selected plan loads
its tables and resumes the workflow. Multiple options always require review. New connections use the existing connector
form and require user confirmation. Targeted analyst form-editing tools are not
offered in workflows. Missing data alone should lead to discovery before requesting
manual uploads. Provider-specific source handlers are not used.

Pause immediately shows Stopping until the executor confirms its checkpoint is
paused. Model turns stop waiting for the provider, close an available stream on a
best-effort basis, and retain partial text and unfinished tool arguments as inert
context. Unfinished tool calls are never dispatched; late model responses cannot
advance a paused run. A provider request still opening may finish in the background,
but its returned stream is closed and discarded without executing its response.
Terminal commands receive SIGINT followed by forced termination if needed, retaining
captured output. Local Python workers receive an interrupt and are discarded after
shutdown; captured stdout is retained when the worker can return it. Interrupted
results cannot serve as evidence for a passed check or verified completion.
Pause does not roll back files, writes, or other completed side effects. Connector,
database, and other operations without cancellation support still finish their
current blocking operation before the workflow can pause. Resume continues from
retained context rather than automatically replaying the interrupted operation.

Questions appear in the shared
question panel above the workflow chat input; answers are recorded in the thread
and continue the same workflow. A main-chat reply also answers the pending
question instead of becoming steering. Approvals, imports, and connection forms
retain their explicit controls. Other interruptions use the shared Interrupted
panel with Retry. Command approvals remain separate exact-command dialogs, not
plain-text authorization. Per-run locks prevent duplicate execution and detect
orphaned running checkpoints after a backend restart. Recovery preserves their
outputs and trajectory and marks them paused for review and resumption.

Manual and scheduled runs execute in backend-owned workers. Refreshing the page,
closing the tab, switching sessions, or losing the update stream only detaches
the viewer; it does not pause execution. A bounded update queue prevents a slow
viewer from blocking the worker. Each backend process accepts up to eight active
workflow executions; additional starts are rejected until capacity is available.
Execution still requires the backend process to remain running.

Opening a session polls the checkpoints of its running workflow nodes and restores
outputs created while the viewer was away, without starting a new execution or
changing the current view's focus. Connection
failures display **Reconnecting to workflow...** while retaining the last known
execution status; they do not prove that the executor stopped. Explicit Pause,
required input, execution failure, or backend shutdown can interrupt a run.
Deleting a workflow node pauses it when active; its checkpoint remains available
for explicit reopening through Recent runs or Open latest run. In `--dev` mode the
backend auto-reloads on source edits, which stops active runs; resume them from
their checkpoints.
There is no fixed model-round or total execution-time cap. Runs continue until
verified completion, a blocker or approval requiring input, user pause, or an error.
Existing provider/tool timeouts remain in force. Without a total budget backstop,
a stalled run may continue consuming model usage until paused. Both analyst and workflow
agents add a soft `[Automatic message]` progress reminder after every 16 model-response
rounds, counting inspection, actions, and self-directed text continuations together.
Parallel tool calls count as one round; provider retries do not add rounds. The reminder
asks the agent to take stock and, if blocked, ask the user or request help; it never
restricts tools or stops the run. The count resets on new user input (each analyst
request or workflow steering message) and whenever a workflow moves to a different step.
Failed workflow model requests are retried up to four times with exponential backoff
unless the error cannot be fixed by retrying (authentication, context length, missing
model, content filtering, or access denial).
While a workflow runs, the chat input uses a subtly accented border and routes instructions
exclusively to that workflow, even when a different artifact is selected. Messages
are queued persistently, visibly acknowledged as queued and then received, and injected
before the next model call. They do not interrupt the current call or automatically
pause or resume the run. The agent can revisit steps or adapt the plan in response. Pending
questions and approvals still require their own responses. Running uses the shared
ShimmerText component; only the active step shows a spinner, even after its checks
pass. The workflow node uses two slowly counter-rotating gears, static when not running
or when reduced motion is requested. Normal chat styling and routing
return after workflow mode ends.

The current step and activity appear immediately above the chat input, replacing
that status with the question or interruption panel when attention is needed.
Status is not overlaid on the workflow canvas. Steering messages and question
replies appear after the outputs present when they were sent and before later
outputs, preserving their place in the run's history.

### Plan Adaptation

`adapt_plan` replaces the active run's complete step list with a reason and a chosen
step. It preserves the saved YAML and original deliverables. Each adaptation archives
the previous steps, progress, checks, and visited state; evidence and transitions stay
associated with their original plan revision. The canvas places earlier plans before
the current steps, so reused IDs do not mix their histories.

After adaptation, substantive tools are gated until `review_plan` assesses every new
step exactly once. Inspection tools remain available. Completed assessments require
successful substantive evidence and an explanation; pending steps may have no evidence.
Earlier evidence remains reusable when its inputs are unchanged, but must be assessed
against the revised requirements before recording a check result.
The agent chooses the next step after assessment; the UI distinguishes progress
assessments from checker results. Plan adaptation clears check statuses, not the underlying
evidence; checks can be reassessed without repeating applicable computations. Final
delivery still reviews the published outputs and supporting evidence. Assessment quality is agent-reported,
not independently guaranteed. No adaptation bypasses authorization or tool restrictions.

Each explicit resume gets a fresh execution window; cumulative calls and time remain
in the checkpoint. Repeated transitions without new tool evidence pause the run.
Closing the browser is not an unattended-execution mode.
Collapsing the workflow sidebar does not stop execution. Switching sessions
aborts its browser stream; reopening a running status reads the backend checkpoint.

## Validation

```sh
uv run pytest tests/backend/agents/test_workflow_agent.py -q
npx vitest run tests/frontend/unit/views/WorkflowPanel.test.tsx tests/frontend/unit/views/SimpleChartRecBox.test.tsx
npx eslint src/views/WorkflowPanel.tsx src/views/DataSourceSidebar.tsx
```

Automated tests use isolated fixtures. Runtime data choices follow the instance;
there is no automatic live acquisition or silent fallback to previous-run files.

### Historical Adapter Pilots

Before removal of the workflow-specific adapters, local validation on
2026-09-17 UTC used the selected Azure-hosted model and real source access.
These results do not validate acquisition through the current shared tools:

- Yahoo: MSFT/SPY review completed in 16 model calls with 122 source rows. All
  four delivered returns were independently recomputed from the downloaded raw
  adjusted prices and matched to floating-point precision.
- Native-output Yahoo follow-up: completed in 25 calls with registered comparison
  data, a workspace CSV, a native line chart, and a report embedding that chart.
  The thread retained one initial execution prompt and a trailing status entry.
- Azure: two-account review completed in 19 model calls with 434 daily rows and
  31 observed metric series. All 62 comparison windows were independently
  reconciled, including totals, descriptive averages, null counts, daily ranges,
  and changes. Definitions without observations were disclosed as unavailable.
- Azure Pause/Resume preserved the run ID, source file hash, and acquisition
  timestamp. The resumed run recorded the gather, analyze, and report transitions
  and delivered its CSV and Markdown report.

The workflow regression suite also covers session isolation, duplicate-run
locks, escaped checkpoint/artifact paths, and removed or changed deliverables.
These pilot results validate those runs, not future model-generated analyses.