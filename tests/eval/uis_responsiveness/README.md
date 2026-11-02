# Agent responsiveness on UIS data

How quickly the analyst agent responds when a visitor asks a question in one of the UIS (UNESCO
Institute for Statistics) demo sessions. These sessions hold large tables: `education-opri` has
8 tables, ~12M rows in total, the largest with 4.2M rows. `bench.py` sends the browser's request to
a real server and records when each streamed event arrives, every model call (start, first output,
total, tokens, cache hits) and every tool's duration.

```
uv run python tests/eval/uis_responsiveness/bench.py --fake --script none python python+visualize --repeat 2
uv run python tests/eval/uis_responsiveness/bench.py --models gpt-6.1-sol --datasets education-opri science \
    --per-dataset 2 --repeat 2                                     # live, the demo's story prompts
uv run python tests/eval/uis_responsiveness/bench.py --fake --script python --followups "And for girls?"
uv run python tests/eval/uis_responsiveness/bench.py --report experiment_data/uis_bench/runs/<run>
mkdir -p /tmp/head && git archive HEAD py-src | tar -x -C /tmp/head
DF_EVAL_BACKEND=/tmp/head/py-src uv run python tests/eval/uis_responsiveness/bench.py ...   # another backend
```

`--fake` replaces the model with an instant scripted one (`--script`: `none`, `inspect`, `python`,
`duckdb`, `visualize`, `python+visualize`), so what remains is the server's own time. Requests carry
the demo header, so sessions live where the demo keeps them (`<home>/sites/unesco/...`). Sessions
come from the installed demo (`/demo/unesco` → Install, or `demos/unesco/build.py`). Runs go to
`experiment_data/uis_bench/runs/`.

Experiment flags (environment): `DF_EVAL_SHARED_CACHE_KEY=<key>` (one prompt cache key for every
session), `DF_BENCH_INDEX_DESCRIPTIONS=1` (table descriptions in the session index).

## Findings (2026-10, gpt-6.1-sol, macOS, 8 sequential live runs per configuration)

| Configuration | Median total | p90 | First visible progress | Chart shown | Non-model time | First-call cache hits |
|---|---|---|---|---|---|---|
| HEAD | 45.4 s | 57.5 s | 12.7 s | 40.3 s | 6–10 s | 0% |
| Fixed (sandbox prewarm) | 30.1 s | 43.9 s | **5.4 s** | 24.9 s | 0.5–1.6 s | 0% |
| Fixed + one shared prompt-cache key | 29.5 s | 38.6 s | 5.9 s | 24.7 s | 0.5–1.2 s | 86% |
| Fixed + table descriptions in index | 31.8 s | — | 5.9 s | 27.2 s | — | 0% |

Model trajectories vary between runs, so differences in total time are partly noise. The
non-model time and the time to first progress are the stable measures.

### Fixed

1. **Every request waited 5–8 s for a Python worker before calling the model.** `_get_next_action`
   opened `SandboxSession(workspace)`, which acquired a warm worker synchronously. A cold worker
   imports pandas, numpy, scikit-learn, scipy and duckdb before it is ready (about 5–8 s, with or
   without OS confinement). Demo sessions never had a warm worker: workers are keyed by
   `confinement.worker_key`, and site workspaces (`<home>/sites/<id>/users/...`) are outside
   `shared_read_roots()`, so each new demo session got its own dedicated worker. The session now
   *prewarms* the worker in the background and acquires it on first `execute`. An `acquire` claims
   a worker that is already starting rather than starting a second one. Pre-model server time fell
   from 5.3–6.0 s to 0.1 s; the cold start now overlaps the first model call (4–6 s).
2. **Demo sessions each started their own worker.** `shared_read_roots()` now includes
   `<home>/sites/` (each demo site's `users/`), and creates it so that a worker started earlier
   can see later demo sessions (bwrap binds only folders that exist). This matches the policy
   for `users/`; ephemeral workspaces keep dedicated workers. On a running server, the Python step
   in each new demo session fell from 5.2–6.6 s to 0.43 s (the work on 4.2M rows itself).
3. **Rate limits stalled silently.** Under load, the provider rate-limits; the agent retried
   after 10, 20 and 40 s while the user saw only heartbeats. Each wait is now announced as a
   `warning` event ("The AI model is busy… Retrying in N seconds"). The stream wrapper flushes
   collected warnings on its heartbeat, so they arrive during the wait. The agent also waits as
   long as the provider asks (`retry-after-ms`, `retry-after`, or "retry after N seconds" anywhere
   in the wrapped exceptions, capped at 60 s). Burst check (16 concurrent visitors): 44
   warnings delivered on time. Azure's Responses streams report the limit *inside* the stream
   (`MidStreamFallbackError`, no headers or hint), so those waits keep the 10/20/40 s
   backoff. Sustained overload still ends in an error after 3 retries; that is quota.
4. **`get_field_summary` on large tables** (the uncommitted `agent_utils.py` change, kept):
   `inspect_source_data` / `read_file` of `session/tables/opri_national.json` (4.2M rows) fell
   from 4.6 s to 1.2 s. The remaining ~0.8 s is mostly null checks and distinct values on 4.2M strings.

### Measured, not a problem

- Context building: about 30 ms. The first prompt is about 80K characters (system 37K, tools 43K,
  session index 1.7–2.3K) and is identical across sessions and datasets.
- Data work on 4.2M rows: Python reading the table and grouping, about 0.4 s; `visualize`, about 0.5 s.
  Follow-up questions in the same session reach the model in about 0.1 s.

### Tried, no latency gain

- **One shared prompt-cache key**: first-call cache hits went from 0% to 86%, but the wait for
  first output did not fall (4.6 s → 5.0 s). It saves cost, not time.
- **Table descriptions in the session index**: the model still opened by reading the indicators
  table (7 of 8 runs), so there was no saved round-trip.

### Remaining time and proposals

The rest is model time: about 5 calls per question (read the indicators table → 1–4 Python
look-ups → `visualize` → final text). Each call waits about 3 s for its first output; `visualize`
calls take about 9 s to generate (~475 tokens).

1. **Fewer round-trips to find the right indicator.** UIS data is stored long: one value per
   indicator code, country and year (`OFST.1.CP`, ...). Before answering, the agent must find the
   code that matches the question in the `*_indicators` table (2–3K labelled rows). For "Where do
   out-of-school children live? Show me on a map." it spent two of five model calls on that:
   `read_file session/tables/opri_indicators.json` (5.5 s; description and a sample of rows,
   which rarely contain the right one), then a Python keyword search (3.9 s). Only then did it
   compute the values (5.2 s), chart (10.5 s) and answer (6.1 s). If the first look-up could
   return the *matching* rows (for example a search over a table's text columns, or
   `inspect_source_data` accepting a query), that would save one call, about 4–5 s of ~30 s.
   Putting table descriptions in the context did not change the agent's behavior (above), so
   this needs a tool change. Evaluate it with the intent-routing evals before adopting it.
