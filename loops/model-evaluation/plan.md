# Loop — Open-Source (Ollama) Model Evaluation

**High-level plan.** Execute end-to-end, making reasonable decisions when details are
ambiguous, and record them in the final report (`report.md`; all working artifacts go
under `work/`).

## Goal

Benchmark open-source (Ollama) models that drive Data Formulator's analyst agents —
inspect tabular data, write transformation code, and commit a visualization — and report
**two independent axes**:

1. **Success rate** — does the agent actually produce a rendered chart? (reliability)
2. **Quality when produced** — how good is the chart when it finishes, scored 0-100 by a
   code + vision grader? (competence)

Keep them separate: a model can write good code yet fail to deliver it through the
protocol. The dominant open-model failure mode is **driving the tool/transport, not
analyzing the data**, so each model runs through more than one agent transport:

- `analyst` — native function/tool calls (with a content-JSON salvage fallback).
- `mini` — single-decision, pure-prompt JSON contract; the production low-cost agent.

Always include the Azure references `gpt-5.5`, `gpt-5-mini` as the baseline.

## Data

A frozen **45-question** set across **15 datasets** from the `../visbench` benchmark, fed
as the **raw / grouped source tables** (not VisBench's derived single-table `data.csv`) so
the agent must do its own joins:

- **vega_datasets** single tables — 9 single-table questions.
- **TidyTuesday** multi-CSV weeks — 18 multi-table questions.
- **Spider** databases grouped by DB — 18 multi-table questions.

Reuse VisBench's quality-filtered question and reference chart for each item. The single-
vs multi-table split (9 / 36) is the axis along which models diverge most.

## Steps

1. **Select & pull models** — the open roster across size tiers (1B → 120B) plus the three
   Azure references.
2. **Prepare the benchmark** — materialize the 45 questions as raw/grouped tables and
   freeze the VisBench questions + reference charts, reused identically across every model
   and agent.
3. **Run agents** — every `(agent, model, question)` cell with `--agent` in `analyst`
   and `mini`; capture the event stream and render each chart to PNG. Frozen controls:
   `max_iterations = 5`, 240 s timeout, resumable.
4. **Score (two phases, GPT-5.5 grader):**
   - **Phase 1 — reliability:** five sequential gates (responded → emitted action → code
     ran → output → **produced chart**). The chart gate is decisive and defines the
     success rate; only those runs proceed.
   - **Phase 2 — quality (0-100, produced charts only):** code review vs the question
     (0-50) + vision review of the rendered PNG vs the reference chart (0-50).
5. **Aggregate & report** — report the two axes separately (never collapse them); for
   ranking only, derive success-weighted quality (Phase 2 over all 45, no-chart = 0) and
   combined = `0.3 × (success_rate × 100) + 0.7 × success-weighted quality`. Always show
   the single- vs multi-table split, the per-gate drop-off, comparison to the references,
   and recommendations per size tier (with which `--agent`).

## Principles

- **Two axes stay separate** — `combined` is for ranking only.
- **Freeze controls** — same questions, grader, `max_iterations`, and timeout across every cell.
- **`mini` is the production low-cost agent** — `simple` was removed; don't run `--agent simple`.
- **`uv` only**, no secrets (Azure auth via Entra ID), resumable, all artifacts under `work/`.
