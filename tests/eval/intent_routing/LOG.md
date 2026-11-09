# Intent routing — iteration log

Each entry: failure classes (evidence), changes, and before/after numbers. Grades
are after manual review (`overrides.json` in each run). Runs live in
`experiment_data/intent_eval/runs/<name>/`.

## Baseline (`baseline`, all 56 cases × 3 models, 1 repeat)

| Model | Pass (auto) | Pass (reviewed) | CHAT_ONLY | WRONG_PATH | ERROR (infra) |
|---|---|---|---|---|---|
| gpt-6.1-sol | 52/56 | 55/56 (98%) | 0 | 0 | 1 |
| gpt-5.6-terra | 44/56 | 52/56 (93%) | 2 | 2 | 0 |
| gpt-6-luna | 47/56 | 50/56 (89%) | 1 | 3 | 2 |

ERRORs are Azure token-rate limits (retries exhausted) and one stalled stream; not
routing failures.

**Case errors found in review (fixed in the cases, not the agent).** Models that
checked the context were right:
- `edit_chart_style` / `edit_chart_encoding` / `edit_chart_terse`: the chart
  already had the requested property (diverging scheme, color by ticker, sorted
  descending). The agent read the chart file and said so.
- `delete_file`: the "old" dashboard exists only as a stale file node; the file is
  gone. Agents listed files and said so.
- `load_full_reference`: the loaded table already is the full source table.
- `session_find`: opening the sessions panel with the match is better than a text
  answer; `report_terse`: pointing to an existing report covering every chart is fine.

**Product bug found:** a `contains` filter on a DATE column compiled to
`"date" ILIKE '%2014%'`, which DuckDB rejects, so loading Seattle weather for a
year failed and the agent fell back to probing. Fixed: DuckDB `ILIKE` casts to
VARCHAR (`probe_utils._compile_where`, test in `test_probe.py`).

**Failure classes:**

- **A. Announces, then stops** (CHAT_ONLY). terra `connect_bucket` (“I’ll open an
  Amazon S3 connection form…”, no form), terra `workflow_new` in the smoke run (“I’ll
  set up a Monday workflow…”), luna `note_remember` (“Understood. I’ll exclude…”, no
  note). The meta skill and configure skill already state this rule explicitly
  (“A statement of intended work is not completion”, “call `propose_connection` in
  the same turn”). No missing context; treated as model compliance noise for now and
  measured with repeats before any change.
- **B. Web acquisition before connected sources** (WRONG_PATH). terra and luna
  `load_into_analysis` and luna `load_beyond_loaded` proposed terminal downloads
  (stooq, yfinance, pandas_datareader) although the connected folder has
  `stocks.csv` / `aapl_stock.csv`. Two causes:
  1. The connected_data route table said routes are “alternatives, not a required
     sequence”, so nothing asked the agent to look at connected sources first, and
     the index names sources only by id.
  2. `find_data` takes a regex; luna searched the phrase “Apple stock price
     historical”, got zero results, and concluded the data was unavailable.
- Single occurrences, not fixed: terra `delete_named` rewrote the report instead
  of deleting the charts; luna `delete_file` wrote a new app.

## Iteration 1

Changes:
- `connected_data` skill: “Unless the user named where the data comes from,
  search connected sources for the subject (`find_data`) before another route.”
  This replaces the “alternatives, not a required sequence” sentence, so the
  prompt size is unchanged.
- `find_data`: a plain phrase with no whole match is searched word by word, best
  matches first, with a note saying so (tool description updated; test added).
- Case corrections above.

Results (`iter1`, dev set 39 cases × 3 models; reviewed):

| Model | Baseline dev pass | Iteration 1 dev pass |
|---|---|---|
| gpt-6.1-sol | 38/39 | 39/39 |
| gpt-5.6-terra | 36/39 (case-corrected) | 37/39 |
| gpt-6-luna | 35/39 (case-corrected) | 38/39 |

- Class B fixed: all six “data the session does not have” runs (`load_into_analysis`,
  `load_beyond_loaded`) now search connected sources and load; luna's phrase query
  (“Apple stock historical prices”) now resolves through the word fallback. terra
  once answered `load_beyond_loaded` from the loaded table alone (“does not include
  Apple data before 2010”) without searching.
- luna `delete_named` asked whether to update the report that embeds both charts:
  a genuine dependency, graded ACCEPTABLE.

**Repeat measurement (`repeatA`, 3 repeats, terra + luna, 8 setup/notes cases):**
- Class A (announce, then stop) after loading `configure`: terra 2/22 runs
  (`connect_explicit`, `workflow_new`), luna 0/24. Low-rate model noise; guidance
  already explicit. Not changed.
- **C. “Remember X” acknowledged, not saved** (`note_remember`): luna 5/5 runs
  failed (“Understood. I’ll exclude…”), terra 1/3. Stable across two models. Cause:
  the workspace skill presents notes as a place for plans and decisions but never
  says they are the agent's only memory across threads, so an acknowledgement looks
  sufficient.

## Iteration 2

Changes:
- workspace skill, notes paragraph: notes “are your only memory across threads, so
  record what a later turn needs to know, including any rule or preference the user
  asks you to keep (acknowledging it does not save it)” (+~110 characters).
- Held-out probe added for the same class with a different session and wording
  (`note_standing_rule`: “Going forward, leave META out of every comparison.”).

Results (`iter2` dev + `iter2-notes`, 3 repeats of `note_remember`):

| Model | Iteration 1 dev | Iteration 2 dev | `note_remember` repeats |
|---|---|---|---|
| gpt-6.1-sol | 39/39 | 39/39 | 3/3 |
| gpt-5.6-terra | 37/39 | 36/39 | 3/3 (was 1/3 before) |
| gpt-6-luna | 38/39 | 36/39 | 0/3 (unchanged) |

- The notes fix worked for terra and did not move luna (“Noted: I’ll leave out…”).
  Not tuned further for luna.
- Remaining failures are almost all **class A** across both weaker models and
  several intents: terra `connect_implicit` (“I’ll open a MySQL connection form…”),
  terra `workflow_new` (“I’ll set up a Monday workflow…”), luna `load_into_analysis`
  (found and described `stocks.csv`, then “I’ll use it to compare…”), luna
  `note_remember`. Dev-set differences between iterations 1 and 2 are within this
  noise (different cases fail on different runs).

**Is class A mechanical?** Newer models label each Responses API message
`phase: commentary` (a preamble before tool calls) or `final_answer`, and the loop
treats any text-only response as final. A diagnostic run logged every response's
output items (`phase-probe`, terra + luna, 16 runs, 81 responses): every text-only
response that ended a run was `final_answer`; commentary messages always came with
a function call. So class A is the model's own choice, not a cut-off preamble.
(Side observation: the LiteLLM chat bridge does not resend `phase` on assistant
messages, which the API docs say can degrade performance; not pursued here.)

## Iteration 3

Change (meta skill; replaces the existing sentence, +~40 characters): “Nothing runs
after your final text, so a statement of intended work is not completion: instead
of ending with what you will do (load data, open a form, save a note), do it now.”
The old sentence gave only “I’ll load it / I’ll analyze it” and no reason; the
failures came from setup forms and notes, and the models evidently expected another
turn.

Results (`iter3` dev, `iter3-classA` 2 repeats of 6 class-A cases):

| Model | Iteration 2 dev | Iteration 3 dev (reviewed) | Class-A repeats |
|---|---|---|---|
| gpt-6.1-sol | 39/39 | 37/39 (2 rate-limit ERRORs) | 11/12 (1 ERROR) |
| gpt-5.6-terra | 36/39 | 36/39 | 11/12 |
| gpt-6-luna | 36/39 | 36/39 | 11/12 |

- Outside workflows, class A dropped: terra connect 4/4 (was 5/6), note 2/2 (was
  1/2); luna `note_remember` 1/2 (was 0/5). Kept.
- terra's remaining misses concentrate on workflow proposals: “I’ll create a
  reusable workflow that…”, “To set this up accurately, I need the price coverage
  and timing.” The configure skill told the agent to “briefly state what changed”
  before publishing a workflow without saying where, and `propose_workflow` has a
  required `summary` for exactly that.
- `delete_named`: deleting charts embedded in a report is refused until the report
  changes, so asking is a correct response (case gains `ask` as acceptable; a fixture
  fact). terra twice rewrote the report unasked (WRONG_PATH).
- New grading convention: a legitimate blocker or choice asked in plain text instead
  of `ask_user` is ACCEPTABLE, tagged `TEXT_QUESTION` in the reason, and counted
  separately in the final analysis.

## Iteration 4

Change (configure skill, no net growth): “…state what changed in the proposal's
`summary`” instead of “briefly state what changed”.

Results (`iter4-workflow`, 4 workflow cases × 3 repeats):

| Model | Pass | Notes |
|---|---|---|
| gpt-6.1-sol | 12/12 | asks via `ask_user` when the gas data is historical or monthly cadence is unsupported |
| gpt-5.6-terra | 10/12 | 2 class A (“I’m preparing a reusable workflow…”, “I’ll set up a Monday workflow…”); 3 TEXT_QUESTION on monthly cadence |
| gpt-6-luna | 12/12 | |

terra's announce-then-stop on workflows stays around 2 in 6 runs (about 3 in 10
before), so no measurable effect. The wording is kept because it is more precise
and free. Iteration stops here for class A: it is concentrated in one model and one
flow, and further prompt text would be tuning to it.

## Final evaluation (`final`, all 57 cases × 3 models, 1 repeat)

| Model | Pass | Ideal | CHAT_ONLY | WRONG_PATH | OVER_ACTION | UNNEEDED_ASK | ERROR (infra) |
|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 57/57 (100%) | 52 | 0 | 0 | 0 | 0 | 0 |
| gpt-5.6-terra | 55/57 (96%) | 53 | 2 | 0 | 0 | 0 | 0 |
| gpt-6-luna | 52/57 (91%); 52/55 without infra errors | 46 | 1 | 0 | 0 | 2 | 2 |

Dev / held-out pass, excluding infra errors (baseline uses the corrected cases and
manual review):

| Model | Baseline dev | Final dev | Baseline held-out | Final held-out |
|---|---|---|---|---|
| gpt-6.1-sol | 39/39 | 39/39 | 16/16 | 18/18 |
| gpt-5.6-terra | 36/39 | 37/39 | 16/17 | 18/18 |
| gpt-6-luna | 35/38 | 35/38 | 15/16 | 17/17 |

Single-repeat totals move within run-to-run noise. The targeted classes, pooled over
all runs before and after their fix, are the stronger evidence:

| Class | Model | Before | After |
|---|---|---|---|
| B: data the session does not have | sol | 2/2 | 9/9 |
| | terra | 0/2 | 8/12 (`load_into_analysis` 8/8, `load_beyond_loaded` 0/4) |
| | luna | 0/2 | 9/12 |
| C: “remember X” | sol | 2/2 | 8/8 |
| | terra | 4/5 | 10/10 |
| | luna | 0/5 | 3/10 (all 3 in the final run) |
| A: workflow proposals | sol | 6/6 | 14/14 |
| | terra | 10/13 | 9/14 (no effect) |
| | luna | 13/14 | 14/14 |

## Analysis

**What the agent routes well (all models).** Analysis vs. answering, apps,
reports, connecting sources, deleting, discovery, conceptual questions, session
management, and editing charts. Every model read the session context closely: in
the baseline, all “wrong” edits and deletes were correct refusals because the chart
already had the requested property or the file no longer existed. No run
over-acted on a conversational request. Loads targeted sensible tables and all
succeeded once the date-filter bug was fixed.

**Flags in the final run.**
- CHAT_ONLY:
  - terra `workflow_new`: “I’ll set the workflow to default to … and calculate …”, ends.
  - terra `load_beyond_loaded`: “This dataset has no Apple history before 2010”,
    without searching the connected folder that has it.
  - luna `load_explicit`: “I’ll load both…”, ends.
- UNNEEDED_ASK, both luna: “calendar or meteorological seasons?” and “A to Z or
  Z to A?”.
- No WRONG_PATH in the final run. Earlier wrong paths, all fixed or not recurring:
  terminal downloads instead of the connected folder (class B), and rewriting a
  report or writing an app instead of deleting.

**Remaining issues and suggested next steps** (not fixed, to avoid tuning to one
model or to the held-out set):
1. **terra announces a workflow instead of proposing it** (about 2–3 in 10 workflow
   runs, only after loading `configure`). Phase logging shows these are deliberate
   `final_answer` messages. Prompt rewording had no effect; if it matters, a
   structural check is the next lever: one nudge when a run ends with text after
   loading an action skill without committing its action. Measure over-action on
   informational questions if tried.
2. **Out-of-coverage requests read as “can’t answer”** (terra `load_beyond_loaded`
   0/4). The loaded table covers the subject but not the period, and terra never
   treats the gap as missing data. Only one case shows it. Add cases where loaded
   data misses the requested period, entities, or grain before changing guidance.
   A candidate fix is meta's “a subject change can require other data”, extended
   to coverage.
3. **Notes are only used once they exist.** The held-out `note_standing_rule`
   (“Going forward, leave META out of every comparison”) was applied to the
   dashboard by all three models, but none saved the rule. That session has no
   notes, so no `[SESSION NOTES]` block is shown. A context-level option is to
   always show the block, with a one-line empty state. Re-test on new held-out
   phrasings, not this one.
4. **Plain-text questions** (TEXT_QUESTION, terra only): legitimate blockers
   asked in prose instead of `ask_user`, graded ACCEPTABLE. They still cost the user
   a typed reply.
5. **The LiteLLM bridge does not resend `phase`** on assistant messages; the API
   docs say dropping it can degrade newer models. Worth checking separately.
6. **Azure token rate limits** cause most ERRORs. The harness retries with fresh
   workspaces; keep `--per-model` at 2–3.

**Code and prompt changes from this evaluation:**
- `data_loader/probe_utils.py`: DuckDB `ILIKE` casts to VARCHAR, so contains-filters
  on dates and numbers load (bug).
- `data_operations/discovery.py`: `find_data` falls back to a phrase's words when the
  whole phrase matches nothing (tool affordance).
- `connected_data` skill: search connected sources before another route unless
  the user named the source (replaced sentence).
- workspace skill: notes are the only memory across threads; save rules the user
  asks to keep (+~110 characters).
- meta skill: “Nothing runs after your final text…” (replaced sentence, +~40
  characters).
- configure skill: state workflow changes in the proposal's `summary` (replaced
  wording).

Net always-on prompt growth is about 150 characters.

## Context review follow-up (`migrated`, 38 cases on the three affected sessions × 3 models)

The context review found that three of the four template sessions were saved at old
state versions (8–9). The browser migrates on load, but the harness sent the saved
state as-is, so threads in those sessions lost the user's requests (stored in the
legacy `answer` field) and labeled each takeaway as “instruction for the next
table”. Earlier runs on `unemployment`, `stocks`, and `grocery_ref` therefore saw a
degraded thread.

Changes:
- Harness: templates are migrated with the application's own `migrateState`
  (bundled with esbuild, run with node) when snapshotted.
- Layer: `normalize_state` applies the legacy `answer` → request step, for saved
  states read without a browser.
- Index: thread titles are the first request in thread order (were first in list
  order) and index lines collapse line breaks.
- `read_file` takes `paths` (globs allowed, up to 20 files, 60K-character budget),
  and table views list every row for tables of at most 25 rows.
- Three held-out cases whose questions span several charts and tables (`span_*`).

| Model | Pass (38) | Notes |
|---|---|---|
| gpt-6.1-sol | 38/38 | |
| gpt-5.6-terra | 36/38 | workflow announce (class A); report rewrite instead of delete |
| gpt-6-luna | 36/38 | `note_remember` (class C); asked calendar vs meteorological seasons |

On the 35 cases shared with `final`, the pass rate is unchanged (100/105 both): the
known failures are model behaviour, not the degraded thread. All 9 `span_*` runs
pass. All three models used `paths` unprompted in 17 runs, typically a chart with
its table, or two charts with their tables. luna answered `span_two_charts` and
`span_charts_entity` from a single batched read (12.6s, 9.9s); sol answered
`span_tables` from one read of a 6-row table, now listed in full. When a table is
larger than 25 rows the models still follow the read with a script, as expected.
