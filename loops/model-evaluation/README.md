# Loop — Open-Source (Ollama) Model Review for the Data Formulator Analyst Agent

**This document is an autonomous runbook.** You are a coding agent. Read it fully,
then *spin the experiments yourself*: pick models, load data, generate questions,
drive the `AnalystAgent`, grade the outputs, and write the report. Every step below
is concrete enough to execute without further input. When a choice is genuinely
ambiguous, pick the reasonable default named here and record the decision in the
report rather than stopping to ask.

---

## 0. Purpose

Data Formulator can be pointed at any LLM, including open-source models served locally
through Ollama. But we don't currently have a principled, evidence-based view of **which
open-source models are actually good enough to drive the analyst agent**, nor of the
hardware and settings each one needs. This loop produces that review: a reproducible
benchmark of open-source models against the agent, with clear recommendations.

**The questions this review must answer (these become the report's headline sections):**
1. **Which Ollama models actually work** with the Data Formulator analyst agent? (a
   clear pass / partial / fail list).
2. **Minimum specs** — especially VRAM — to run each working model at a usable quality.
3. **Required settings** — quantization, context length (`num_ctx`), and other Ollama
   `options` that make the difference between working and failing.
4. **The low-VRAM story** — how small can you go? Identify the *smallest model that still
   works*, the quant / `num_ctx` it needs, and call out the practical VRAM floor for usable
   quality.

Keep these four questions pinned. Everything measured should ladder up to answering them.

---

## 1. Mission

Benchmark a broad set of open-source Ollama models against the unified **`AnalystAgent`**
(the agent that powers Data Formulator's "Explore" / Data Thread). For each model, on
several datasets, an LLM *asker* poses direct and open-ended analysis questions; the
analyst agent answers by exploring data and producing charts / data-thread content; an
LLM *grader* scores the answers. Reference runs with hosted models calibrate the scale.

**Deliverable:** `loops/model-evaluation/report.md` — a results table + a model
recommendation guide that directly answers the four questions in §0, including the
practical low-VRAM floor.

All scratch work, scripts, raw transcripts, and aggregates live under
`loops/model-evaluation/work/` (see §9 for the layout).

---

## 2. Environment & setup

- **Repo:** this working tree. Python source is under `py-src/`; the project is
  installed editable. **Use `uv` only**, never pip: `uv pip install -e .`,
  `uv run python ...`, `uv run pytest`. The venv is `.venv/` — `source .venv/bin/activate`.
- **GPU box:** run on the multi-GPU eval box (≈4×A100). Exploit the hardware: serve
  several models concurrently and/or run datasets in parallel (see §7.4). Smaller models
  can share a GPU; large models get a dedicated GPU.
- **Ollama:** install/serve locally (`ollama serve`). Pull models with `ollama pull <model>`.
  The agent talks to Ollama through LiteLLM via the `Client` wrapper (next section).
- **Reference (hosted) models:** use the Azure OpenAI resource already wired for evals
  (managed identity, no API key — `DefaultAzureCredential` resolves it). Deployments
  available include `gpt-5.5`, `gpt-5-mini`. Confirm the endpoint
  the same way the chart-reading handoff does, use az login with .env azure stuff.
  ([agent_eval_plans/00-AGENT-HANDOFF.md](../../agent_eval_plans/00-AGENT-HANDOFF.md) §3).

### 2.1 Talking to a model — the `Client` wrapper

`data_formulator.agents.client_utils.Client` is the single LLM entry point for every
agent. It already supports Ollama and Azure:

```python
from data_formulator.agents.client_utils import Client

# Local model under test (Ollama)
agent_client = Client(
    endpoint="ollama",
    model="qwen2.5-coder:7b",            # ollama/ prefix added automatically
    api_base="http://localhost:11434",   # default; LiteLLM strips a trailing /api
)

# Reference / asker / grader (Azure managed identity — no api_key)
ref_client = Client(
    endpoint="azure",
    model="gpt-5.5",                      # deployment name
    api_base="https://<resource>.openai.azure.com/",
)
```

> **Ollama `options` (quantization, context length, etc.):** LiteLLM forwards extra
> kwargs to Ollama's `options` (e.g. `num_ctx`, `temperature`, `num_gpu`). The agent
> calls `client.get_completion_with_tools(...)`. Decide early how you will pass
> `num_ctx` (see §6) — either bake it into the Modelfile (`ollama create` with
> `PARAMETER num_ctx ...`) or pass it through the client call. **Record exactly what you
> used** — the context-length setting is one of the four questions in §0.

---

## 3. Step 1 — Choose the Ollama models to test

**Search first, then decide.** Use web search / the Ollama library to pick a current,
representative set. Bias toward models with strong **coding** and **instruction-following**
ability, since the analyst agent's core action (`visualize`) emits Python + a chart spec
through native tool-calls (see §7.1). Cover a range of sizes so the VRAM story is complete.

Selection guidance:
- **Tool-calling matters.** The analyst commits actions as **native tool calls**, not
  JSON-in-text. Prefer models Ollama lists as supporting tools/function-calling. Flag any
  model that lacks tool support — it will likely fail the agent loop, which is itself a
  finding.
- **Size buckets to cover** (span the spectrum so the report can speak to different VRAM budgets):
  - **~3–4B** (small, low-VRAM): e.g. `llama3.2:3b`, `qwen2.5-coder:3b`, `phi-class`.
  - **~7–9B** (mainstream): e.g. `qwen2.5-coder:7b`, `llama3.1:8b`,
    `mistral`/`ministral`, `granite` coder, `deepseek-coder` variants.
  - **~14–34B** (mid/large): e.g. `qwen2.5-coder:14b/32b`, `devstral`, `gpt-oss`-class.
  - **Large reference-tier OSS** if the box allows: pick one or two flagships.
- Treat the list as a hypothesis; the actual Ollama catalog at run time is the authority.
  **List the final set in the report** with: model name, parameter count, quantization
  pulled, on-disk size, and Ollama tool-calling support (yes/no).

**Hardware-requirement table (build this and put it in the report):**

| Model | Params | Quant | Disk | Est. VRAM @ ctx | Tool-calling |
|-------|--------|-------|------|-----------------|--------------|

Estimate VRAM at the context length you actually run (KV cache grows with `num_ctx` — a
3B model that fits at 4k may not at 32k). Verify estimates against `ollama ps` / `nvidia-smi`
during a real run and record the *observed* peak.

---

## 4. Step 2 — Seed datasets

Assemble a **corpus of ~30 real tables** as the exploration starting points — a broad,
varied set so each model is tested across many domains and data shapes, not a handful of
tables. Source them from the families Data Formulator already ships / references:

- **vega_datasets** — installed as a package (`from vega_datasets import data`) and also
  configured in [py-src/data_formulator/example_datasets_config.py](../../py-src/data_formulator/example_datasets_config.py)
  (Gapminder, Movies, US Income, Unemployment, Disasters...). Good clean multi-type tables.
- **TidyTuesday** — real, messier tables. Several are wired in `example_datasets_config.py`
  (College Majors, weekly gas prices, movies/shows) and more exist under
  [experiment_data/tidytuesday/](../../experiment_data/tidytuesday/). Use these for the
  "real-world schema" condition.
- **spider** (optional / secondary) — text-to-SQL databases. Only include if you also want
  a relational/multi-table condition; otherwise skip and note it as future work. (Most of
  the analyst's value is single-table-to-chart, so vega + tidytuesday are the priority.)

**Target ~30 tables total**, balanced across the sources and spanning domains and data
types (temporal, categorical, quantitative, geographic; some clean, some with
nulls/messiness; a range of row/column counts). For each, download/materialize it and
record a one-line description + schema in `work/datasets/`. Keep each small enough to fit a
local model's context (downsample very large tables to a few thousand rows, noting it).
**Carve out a dev subset** of these for pipeline calibration (§6.1) — the remaining tables
are the held-out test corpus.

### 4.1 Loading a seed table into a workspace (the agent reads tables from disk)

The agent's context builder reads tables via `workspace.read_data_as_df(name)`
([py-src/data_formulator/agents/context.py](../../py-src/data_formulator/agents/context.py)),
so a seed table must be **registered in a `Workspace`** before the agent can use it. Recipe:

```python
import pyarrow as pa, pandas as pd
from data_formulator.datalake.workspace import Workspace

ws = Workspace(identity_id="eval", root_dir="loops/model-evaluation/work/ws")
df = pd.read_csv(...)                      # your seed table
name = ws.get_fresh_name("gapminder")
meta = ws.write_parquet_from_arrow(pa.Table.from_pandas(df), name)
ws.add_table_metadata(meta)                # now read_data_as_df(name) works
```

Then pass `input_tables=[{"name": name}]` to `agent.run(...)`. **Smoke-test this once**
(load one table, confirm `ws.read_data_as_df(name)` returns the frame) before scaling.

---

## 5. Step 3 — Generate questions (the *asker*)

For **each dataset**, use a hosted asker model (**`gpt-5.5`**) to generate **exactly 5
analysis questions**. Generate once per dataset and **reuse the identical question set
across all models under test** — the question must be a constant so model is the only
variable. With ~30 datasets × 5 questions, **each model is tested on ~150 questions** (the
test goal per model).

- Per dataset, generate **5 questions** with a fixed mix — default **3 direct + 2
  open-ended** (keep the split constant across datasets):
  - **Direct** ("Show the trend of life expectancy over time for each cluster.") — has a
    fairly determinate good answer; easier to grade for correctness.
  - **Open-ended** ("What's the most interesting story in this data? Explore it.") — tests
    initiative, multi-step exploration, and judgment.
- Give the asker the table name, schema, and a few sample rows (use the same lightweight
  table summary the agent sees). Ask it to return strict JSON: a list of
  `{id, dataset, kind: "direct"|"open", question}`.
- Persist the generated questions to `work/questions/<dataset>.json` and **freeze them**
  (do not regenerate per model). Sanity-check that each file has exactly 5 well-formed,
  on-topic questions before the sweep — a bad question contaminates every model equally.

---

## 6. Settings to hold fixed (and to vary deliberately)

To isolate the model variable, **freeze**: the asker model + prompt, the grader model +
rubric, the question sets, the agent's `max_iterations` (start at **5**), and temperature
(**0** for agent, asker, and grader unless a model rejects it).

**Deliberately vary (these are findings, not nuisance):**
- **Quantization** — record what each `ollama pull` actually fetched (usually q4_K_M). If a
  model fails, optionally retry at a higher quant and note whether it helped.
- **Context length (`num_ctx`)** — the agent's system prompt + table context + tool schemas
  are sizable. A too-small `num_ctx` will truncate the system frame and the model will fail
  to follow the action protocol. Establish a **working default** (try 8192; bump to 16384
  if outputs look truncated) and note the minimum that works per model. This is central to
  the low-VRAM story (bigger `num_ctx` ⇒ more VRAM).
- **Tool-calling support** — if a model can't emit native tool calls, capture that as the
  failure mode.

### 6.1 Calibrate on a dev set before the mass run

**Do not launch the full ~30-dataset sweep blind.** First carve out a small **dev set** and
use it to shake out the pipeline end-to-end:

- **Dev set:** ~3 datasets (pick varied ones — one clean vega table, one messy TidyTuesday
  table, one with nulls/odd types) × their 5 frozen questions = ~15 dev items. Pick **2–3
  models** spanning the size spectrum (one small, one mid, plus one **hosted reference**
  `gpt-5.5`/`gpt-5-mini`). Keep the dev datasets clearly tagged so they're reportable
  separately and not silently mixed into the headline test numbers.
- **What the dev run must validate** before you trust the mass run:
  - the harness drives `AnalystAgent.run` and records every event type (§7.1) without crashing;
  - the **answer bundle + per-action execution outcomes** (§7.2) are captured correctly,
    including a deliberately code-broken case (confirm the `code-broken` level is detected);
  - the **outcome-level classifier** (§7.3) assigns sane levels — eyeball all ~15;
  - the **grader** returns valid strict JSON on every item and its scores look reasonable
    against your own read (this is the judge-calibration sample, §8);
  - resume/idempotency works (re-running skips completed items);
  - the reference model lands near the top of the scale (a sanity floor for the rubric).
- **Tune here, freeze after.** Adjust prompts (asker/grader), `num_ctx` default, timeouts,
  and the outcome taxonomy on the dev set. Once the dev run looks right, **freeze the
  pipeline** and only then launch the full corpus. Record the dev-set findings (especially
  any rubric/classifier adjustments) in the report's Method section.

---

## 7. Step 4 — Run the analyst agent (the harness)

Build a small harness under `work/` that, for each `(model, dataset, question)`, drives the
real `AnalystAgent` and captures everything it emits.

### 7.1 Driving the agent

`AnalystAgent` lives at [py-src/data_formulator/analyst/agent.py](../../py-src/data_formulator/analyst/agent.py).
`run(...)` is a **generator that yields event dicts**; consume them to exhaustion (or until a
terminal event) and record them. Minimal shape:

```python
from data_formulator.analyst.agent import AnalystAgent

agent = AnalystAgent(
    client=agent_client,            # the Ollama Client from §2.1
    workspace=ws,                   # the Workspace from §4.1
    max_iterations=5,
    identity_id="eval",             # enables reasoning log; pass None to skip
)

events = []
for ev in agent.run(input_tables=[{"name": name}], user_question=question["question"]):
    events.append(ev)
    if ev.get("type") in ("completion", "interact", "error"):
        break
```

**Event types to capture** (from the run loop / skills):
- `agent_action` — the committed action (`visualize` / `interact` / `delegate` / `write_report`)
  and its `action_data` (code, chart spec, etc.).
- `result` — a visualization result: the transformed table (`rows`) + chart spec + `chart_id`.
  This is the **data-thread content** — the primary artifact to grade.
- `tool_start` / `tool_result` — inspection-tool activity (`execute_python_script`,
  `inspect_source_data`, `load_skill`).
- `text_delta` with `channel="report"` — streamed report markdown (if `write_report` runs).
- `completion` — final answer / status (`success`, `tool_rounds_exhausted`, etc.).
- `error` — capture the message + code; **classify the failure** (see §7.3).

### 7.2 What "produces an answer" means here — capture the whole spectrum

The agent answers by **acting on data**, not by prose alone. A good run typically commits
one or more `visualize` actions (each yields a `result` with a derived table + chart), and
ends with a concise closing answer. But the interesting signal is the *spectrum between*
"did nothing" and "perfect": a model may emit code that **doesn't run**, code that **runs
but produces the wrong/empty table**, a chart with the **wrong encodings**, or a technically
correct answer that **misses the point of the question**. Capture enough to tell these apart.

For every committed `visualize` (and every `execute_python_script` tool call), record the
**execution outcome** explicitly — don't just keep the final answer:
- **did the code run?** (the sandbox raised vs. returned) — from the `result` / `tool_result`
  event and the observation the loop fed back. Note the exception type/message if it threw.
- **how many repair attempts** the agent took before the code ran (or gave up).
- **did it yield a non-empty, sensible output table?** (row/col counts; all-null or 0-row
  outputs are a distinct "ran but empty" outcome).
- **the chart spec actually produced** (type + encodings) vs. what the question called for.

Persist, per `(model, dataset, question)`:
- the full ordered event list (`work/runs/<model>/<dataset>/<qid>.jsonl`),
- a distilled "answer bundle": the closing text, each chart's spec + a sample of its output
  rows, the Python the agent ran, **and the per-action execution outcomes above**. This
  bundle is what you hand the grader (§8).
- run metadata: terminal status, action count, **code-error count + repair-loop count**,
  wall-clock time, tokens if available, and observed peak VRAM (`nvidia-smi` snapshot).

### 7.3 Outcome taxonomy — a graded spectrum, not just pass/fail (this is half the report)

Classify **every run** (not only failures) into exactly one outcome level, so the report can
show the full distribution per model rather than a binary. The levels, worst → best:

1. **no-action** — model never emits a native action at all (often: no tool-calling support,
   or `num_ctx` truncated the protocol). The "doesn't work at all" floor.
2. **malformed-action** — emits actions but with broken/invalid args (bad JSON, missing
   required field) and never recovers.
3. **code-broken** — commits `visualize` but the code **never runs successfully** (throws
   every attempt; agent exhausts the repair budget). Record the dominant exception.
4. **ran-but-empty/wrong** — code runs, but the output table is **empty, all-null, or clearly
   wrong** (bad aggregation/join/filter), so the chart is meaningless.
5. **ran-but-suboptimal** — produces a valid chart, but it's a **weak answer**: wrong chart
   type for the question, missing an obvious encoding/breakdown, answers a narrower question
   than asked, or stops short on an open-ended prompt.
6. **good** — runs cleanly and answers the question well; chart + transform are faithful and
   appropriate; concise close.

Also flag, orthogonally (a run can be `good` and still carry a flag): **protocol-drift**
(narrates instead of acting, or re-explores the same thing without closing), **slow**
(usable but far slower than the reference), and **timeout/OOM** (too big for VRAM or hangs —
maps to level 1 for scoring but tag the cause).

The per-model **distribution across these levels** (e.g. "40% good, 30% ran-but-suboptimal,
20% code-broken, 10% no-action") plus the dominant failure level is exactly what turns the
report from "works / doesn't" into an honest, graded review.

### 7.4 Parallelism (use the box)

Iterate `models × datasets × questions` (~30 datasets × 5 questions = ~150 per model). To
exploit ≥4 GPUs: run several models concurrently (separate Ollama model loads / pinned GPUs),
and/or fan out datasets per model. Keep the **asker and grader calls serialized enough** to
respect Azure rate limits. Make the harness **resumable** (skip `(model,dataset,qid)` whose
`.jsonl` already exists) so a crash mid-sweep doesn't restart everything. Always exercise the
**dev-set calibration run (§6.1) first** and freeze the pipeline before launching the full
corpus.

---

## 8. Step 5 — Grade the answers (the *grader*)

Use **`gpt-5.5`** as the grader (a different concern from the agent under test; the agent is
the Ollama model, so there's no self-grading). Temperature 0.

For each `(model, dataset, question)` answer bundle, the grader sees: the question, the table
schema + samples, and the agent's answer bundle (closing text + chart specs + output-row
samples + code + **the per-action execution outcomes from §7.2**). The grader is told the
run's mechanical outcome level (§7.3) so it scores *quality given that the code ran* rather
than re-deriving whether it ran. It returns **strict JSON** scores on a fixed rubric, e.g.
(1–5 each):
- **task_completion** — did it actually answer the question that was asked (not a narrower one)?
- **code_executed** — did the agent's code run cleanly (no errors / few repairs)?
- **result_correctness** — are the transforms/aggregations and the output table faithful to
  the data (right filter/group/join; non-empty, sensible)?
- **chart_appropriateness** — sensible chart type + encodings for the question.
- **insightfulness** (esp. for open-ended) — did it surface something meaningful / explore,
  or stop at the shallow first answer?
- **protocol_adherence** — clean agent behavior (acted decisively, no flailing/repetition).
- plus a one-line `rationale`, the **outcome level** from §7.3, and an overall
  `verdict ∈ {pass, partial, fail}` (partial = ran-but-suboptimal / ran-but-empty: the
  "works but not ideal" middle the review must surface).

Also compute a **reference delta**: grade the hosted reference runs (`gpt-5.5`, `gpt-5-mini`)
on the identical questions so each local model can be reported *relative to* a known-good
ceiling, not just on an absolute scale. Persist all scores to `work/grades/`.

**Calibrate the judge:** spot-check ~5–10 graded items by hand and confirm the grader's
scores are sane; note any systematic judge bias in the report.

---

## 9. Step 6 — Summarize & deliverables

### 9.1 `work/` layout

```
loops/model-evaluation/work/
  ws/                      # the eval Workspace (seed tables registered here)
  models.json              # the chosen model set + hardware table (§3)
  datasets/                # ~30 materialized seed tables + descriptions (§4); dev subset tagged
  dataset_splits.json      # which datasets are dev (§6.1) vs held-out test
  questions/<dataset>.json # frozen question sets — 5 per dataset (§5)
  runs/<model>/<dataset>/<qid>.jsonl   # full event streams (§7)
  bundles/<model>/<dataset>/<qid>.json # distilled answer bundles (§7.2)
  grades/<model>/...                   # grader JSON (§8)
  aggregates.{json,csv}    # per-model means, win-rates vs reference, outcome-level distribution
  scripts/                 # all harness/asker/grader/aggregation scripts
```

Put **every script** under `work/scripts/`. Keep them runnable with `uv run python`.

### 9.2 `report.md` (the headline deliverable)

Write `loops/model-evaluation/report.md`. It must, up front, answer the four §0 questions,
then back them with data. Required sections:

1. **TL;DR verdict table** — every tested model with: size, quant, `num_ctx` used, observed
   peak VRAM, overall score, score relative to the `gpt-5-mini` / `gpt-5.5` reference, and
   the **outcome-level distribution** (§7.3) — e.g. `% good / suboptimal / empty-wrong /
   code-broken / no-action` — plus the dominant level. Don't collapse to a single pass/fail.
2. **"These models work, these don't" — and how they fall short** — group models into clear
   tiers (reliable / usable-with-caveats / unusable), and for the middle tier name the
   *specific* shortfall (e.g. "code runs but charts are often the wrong type", "fine on direct
   questions, gives up on open-ended"). The graded middle is the point of the review.
3. **Minimum specs & the low-VRAM floor** — name the *smallest model that actually works*,
   the quant + `num_ctx` it needs, and the realistic quality at that size. State the
   practical VRAM floor for usable quality and the recommended step-ups across the spectrum.
4. **Recommended settings** — quantization, `num_ctx`, `max_iterations`, and any Ollama
   `options` that materially helped. Include a copy-pasteable Ollama setup for the top pick.
5. **Method** — datasets, question counts, asker/grader models, rubric, and reproduction
   command(s). Note judge-calibration findings and limitations.
6. **Per-model notes** — short paragraph each: outcome-level distribution, what it did well,
   *how* it fell short (which level dominated and why), and example transcript pointers for
   a representative good run and a representative failure.

Keep it evidence-led and honest: the graded middle ("runs but not ideal") and a credible
"fail" list are as valuable as the "works" list.

---

## 10. Conventions & guardrails

- **`uv` only.** `uv run python ...` / `uv pip install ...`. Source is in `py-src/`.
- **No secrets** in the repo, scripts, or transcripts. Azure auth is managed-identity only;
  do not write API keys anywhere.
- **Freeze the controls** (asker, grader, questions, `max_iterations`, temperature) so the
  model is the only variable; **record** every deliberately-varied setting (quant, `num_ctx`).
- **Make the sweep resumable** and idempotent; never delete prior runs to "retry" — write to
  a fresh path and keep the originals.
- **Don't commit/push or run destructive git ops** on this working tree.
- Keep all artifacts under `loops/model-evaluation/work/`; the only top-level deliverable is
  `loops/model-evaluation/report.md`.

---

## 11. Suggested order of work

1. **Smoke the stack**: activate venv; confirm one Ollama chat completion through `Client`
   and one Azure (`gpt-5.5`) completion; load one seed table into a `Workspace` and confirm
   `read_data_as_df` works; drive `AnalystAgent.run` once on a tiny model + one question and
   capture the event stream end-to-end. Fix wiring before scaling.
2. **Pick models** (§3) and write `work/models.json` + the hardware table.
3. **Materialize ~30 datasets** (§4) and **freeze the 5-question sets per dataset** (§5) with
   `gpt-5.5`; record the dev vs. test split (§6.1) in `work/dataset_splits.json`.
4. **Build the harness** (§7): runner → answer bundles + per-action execution outcomes,
   resumable, with outcome-level tagging.
5. **Calibrate on the dev set** (§6.1): run 2–3 models (incl. a hosted reference) over the
   ~15 dev items end-to-end; validate capture, classifier, grader JSON, and resume; tune
   prompts/`num_ctx`/timeouts; then **freeze the pipeline**.
6. **Mass run**: sweep all `models × test-datasets × questions` (~150 questions/model).
7. **Grade** (§8) all runs incl. the `gpt-5.5` / `gpt-5-mini` reference; calibrate the judge.
8. **Aggregate** into `aggregates.{json,csv}` and **write `report.md`** (§9.2), leading with
   the four §0 answers and the low-VRAM floor.