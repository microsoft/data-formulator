# Intent routing evals — guidelines

These evals check whether the analyst agent routes a request to the right kind of
work given its context (design-docs/61): analyze what is loaded, load data from a
connected source, connect a new source, author a workflow or schedule, write a
report or app, edit or delete session items, manage files and notes, or simply
answer. They run the real `/api/agent/analyst-streaming` endpoint against live
models with real sessions, connectors, and files, and grade the agent's first
decisive move.

They are not part of the pytest suites (live models, minutes per run).

## What is measured

The **decisive move** is the first event that commits the run to a path:

- an action (`visualize`, `write_report`, `write_app`, `propose_data_operation`,
  `propose_connection`, `propose_workflow`, `propose_schedule`,
  `propose_session_changes`, `ask_user`, `long_response`),
- a tool that changes the session (`create_data`, `update_data`, `create_file`,
  `edit_file`, `move_file`, `delete_items`, `run_terminal`),
- or the run's completion (a plain answer).

Everything before it (skills loaded, files read, catalogs searched) is the
**path**. Each case lists the decisive moves that are *ideal* and *acceptable*;
some also require or forbid path steps (for example, loading data should be
grounded in a catalog look-up; an answer about loaded data must not be invented).

## Grades

| Grade | Meaning |
|---|---|
| IDEAL | The best move for the request and context. |
| ACCEPTABLE | A reasonable move a careful analyst might make (asking a genuinely needed question, computing an answer instead of charting it). |
| CHAT_ONLY | Answered in text when the request needed the agent to *do* something it could do (load, chart, connect, author, edit, delete, save). The interaction stalls: the user must ask again. |
| WRONG_PATH | Committed to a different kind of work (charting unrelated data instead of loading, inventing data, creating a duplicate instead of editing, editing when asked to analyze). |
| OVER_ACTION | Did work when a direct answer was the right response. |
| UNNEEDED_ASK | Asked the user for something the context already answers. |
| ERROR | The run failed or hit the budget before a decisive move. |

Grading is automatic from the trace; then every non-IDEAL result is read by hand
and the grade is corrected where the rule missed a legitimate behavior. Corrections
are recorded with a reason. A pass is IDEAL or ACCEPTABLE.

## Coverage

Cases cross **sessions** with **intents** and **phrasings**:

- Sessions: empty (connected sources only); analysis in progress (loaded table,
  derived table, chart on canvas, report, notes); a connected-source table
  reference in view; a session with an app and saved workflow.
- Intents: analyze loaded data; load data from a connected source (explicit, and
  *implicit* — a question about data that is not loaded); data not available
  anywhere; connect a source; author a workflow; schedule; report; app; edit a
  chart; delete; discover what data exists; conceptual questions; notes; reusable
  helpers; rename/move files; ambiguous or terse requests; multi-intent
  requests; non-English requests.
- Phrasings: explicit commands, implicit needs, terse, verbose, polite questions,
  requests that name the wrong thing, and negatives where the right move is to
  just answer. Each intent has at least two phrasings, ideally in different
  sessions.

Cases are split into a **dev** set (used while iterating) and a **held-out** set
(run only at the start and the end) to check that fixes generalize.

## Fixing guidelines (avoid overfitting)

1. **Fix failure classes, not cases.** A change needs a root cause shared by at
   least two failing cases (different phrasings, sessions, or models), or a clear
   defect in context, tools, or validation. One-off misses of a weak model are
   noted, not fixed.
2. **Prefer, in order:** correct or missing context (what the agent can see); tool
   and skill affordances (what a tool is for, when it applies); general rules.
   Never copy a test prompt's wording, entity names, or examples into prompts,
   skills, or tool descriptions.
3. **Keep the prompt budget.** Net growth of the always-on prompt per iteration
   stays under ~1K characters; prefer replacing or clarifying text over adding.
4. **Do not tune for the weakest model.** `gpt-6-luna` is expected to be weaker; a
   fix motivated only by it is kept only if it is general and does not hurt the
   stronger models.
5. **Re-run after each change** (all models, dev set) and compare with the
   previous run; a fix that regresses another case is reverted or reworked. Model
   runs are noisy, so a single flip is not evidence; look at classes.
6. **Record each iteration** in `LOG.md`: the failure class, the evidence (case
   ids, models), the change, and the before/after numbers.

## Running

```
uv run python tests/eval/intent_routing/run.py --models gpt-6.1-sol gpt-5.6-terra gpt-6-luna   # all cases
uv run python tests/eval/intent_routing/run.py --set dev --per-model 2                          # iterate on dev
uv run python tests/eval/intent_routing/run.py --models gpt-6-luna --cases note_remember --repeat 3
uv run python tests/eval/intent_routing/run.py --report experiment_data/intent_eval/runs/<run>   # re-summarize (applies overrides.json)
uv run python tests/eval/intent_routing/run.py --regrade experiment_data/intent_eval/runs/<run>  # after changing cases.py
uv run python tests/eval/intent_routing/run.py --scenarios                                       # rewrite SCENARIOS.md
uv run python tests/eval/intent_routing/run.py --full --cases ... --name t1                      # run to completion, for timing
uv run python tests/eval/intent_routing/timing.py experiment_data/intent_eval/runs/t1           # where the time goes
DF_EVAL_BACKEND=<snapshot>/py-src uv run python tests/eval/intent_routing/run.py --full ...     # compare another backend under the same load
uv run python tests/eval/intent_routing/multiturn.py --name mt-on --repeat 2                   # multi-turn scenarios (one session each)
DF_AGENT_CONTINUATION=off uv run python tests/eval/intent_routing/multiturn.py --name mt-off --repeat 2
uv run python tests/eval/intent_routing/multiturn.py --report <run dir> [<run dir> ...]
```

Multi-turn scenarios (`multiturn.py`) send a sequence of requests to one session. Between turns the
harness applies each run's results to the session state as the browser does, so fresh and continued
conversations see the same session; each turn is graded like a case, plus an optional check of what it did.

Files: `cases.py` (sessions, cases, grading), `multiturn.py` (multi-turn scenarios), `harness.py` (server, fixtures,
streaming trace), `run.py` (runner and reports), `SCENARIOS.md` (generated case
catalog), `LOG.md` (iterations and analysis).

A run starts a real server (browser opening and the scheduler disabled) on a private
Data Formulator home and drives it over HTTP exactly as the browser does: same request
body, `Origin` header (the terminal requires a same-origin request), and the session
state the browser would hold. Fixtures are snapshotted once into
`experiment_data/intent_eval/templates/` (gitignored): four real public-data sessions,
a saved workflow, and a folder of public CSVs registered as a local-folder connector
(the built-in sample datasets connector is also present). Each (case, model, repeat)
gets a fresh copy of its session. Traces, grades and `summary.md` are written to
`experiment_data/intent_eval/runs/<run>/`; manual grade corrections go in that run's
`overrides.json` (`{"model/case/repeat": {"grade": ..., "reason": ...}}`).

Rate-limited runs are retried with backoff in a fresh workspace; at most
`--per-model` runs per model are in flight.
