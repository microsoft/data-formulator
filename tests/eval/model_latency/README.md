# Model start-up latency

How long the analyst agent waits for the model before anything shows, from tiny prompts up to real
long UIS sessions. These benchmarks complement `../uis_responsiveness/`, which times whole runs.

| Case | Size | What it is |
|---|---|---|
| `tiny` | short | 3 small tools, one-line system prompt, "say hello" (~220 tokens) |
| `small-tool` | short | same, plus 5 rows of Gapminder and a chart request (~320 tokens) |
| `app-empty` | large | the app's real first request in an empty session: full system prompt, 18 tools (~18.7K) |
| `uis-first` | large | the first question in the `education-sdg4` UIS session (~15.5K) |
| `uis-long` | large | a follow-up in a 20-turn UIS session with conversation history (~27K) |
| `uis-long-3tools` | ablation | `uis-long` with only 3 of the 18 tools (~22.4K) |
| `uis-long-no-history` | ablation | `uis-long` with the history dropped, only the session index and the question (~17.9K) |
| `uis-first-core-tools`, `uis-first-trimmed`, `uis-first-lean` | ablation | `uis-first` with 10 of 18 tools, with eight guidance sections dropped, or both (~13K / 12K / 9.6K) |
| `uis-long-lean` | ablation | `uis-long` with both cuts (~21K) |
| `uis-long-lean-chart` | ablation | `uis-long` with `visualize` keeping only code, chart and title |
| `uis-long-low-verbosity`, `answer`, `answer-low-verbosity` | ablation | `verbosity: low` on a chart call and on a short written answer |

The large cases replay what the app really sends. `capture.py` runs the app on those sessions and
saves the body of the first model request to `experiment_data/model_latency/requests/`. Recapture
after changing the prompt, tools or session context. The `uis-long` session is
`experiment_data/uis_bench/sessions/sdg4-long`. `capture.py` also prints the app-level start time:
submit to first streamed event (app overhead) and to the agent's first model output.

`bench.py` sends each case straight to the Azure Responses API (no app), cold (a unique first line
defeats the prompt cache) and then warm (the same body, cache hit). Each `--target` is
`<account>:<model>`: an Azure OpenAI resource name and a deployment (or set `DF_BENCH_TARGETS`,
comma-separated). It needs `az login` with access to that resource; set `DF_BENCH_SUBSCRIPTION` if
it is not in the CLI's default subscription. Results append to `experiment_data/model_latency/results.jsonl`.

```
uv run python tests/eval/model_latency/capture.py                 # (re)capture the large cases
uv run python tests/eval/model_latency/capture.py --repeat 3      # app-level start time
uv run python tests/eval/model_latency/bench.py --rounds 4 \
    --target my-account:gpt-6.1-sol --target my-account:gpt-6-luna
uv run python tests/eval/model_latency/bench.py --cases tiny uis-long --target my-account:gpt-6.1-sol   # a subset
uv run python tests/eval/model_latency/bench.py --summary-only
```

## Findings (2026-10-23, one Azure OpenAI resource in East US 2, low reasoning, 4 rounds)

Median seconds to the first output token (function arguments or answer text):

| Case | input tokens | gpt-6.1-sol cold | warm | gpt-6-luna cold | warm |
|---|---:|---:|---:|---:|---:|
| tiny | 220 | 1.6 | 1.3 | 0.7 | 0.9 |
| small-tool | 320 | 1.4 | 1.6 | 0.8 | 0.8 |
| app-empty | 18.7K | 2.1 | 2.3 | 1.7 | 1.6 |
| uis-first | 15.5K | 2.1 | 4.7* | 1.9 | 1.7 |
| uis-long | 27.2K | 3.6 | 3.5 | 3.3 | 2.3 |
| uis-long-3tools | 22.4K | 3.2 | 2.9 | 2.3 | 1.8 |
| uis-long-no-history | 17.9K | 2.2 | 2.3 | 2.0 | 1.9 |

\* one slow sample (7.4 s) in four.

- The app adds little: its first streamed event arrives 0.05–0.15 s after submit. Through the app,
  the first model output came after 2–6 s (3 runs per case).
- A prompt cache hit barely helps time to first output; nearly all of the input was cached in the
  warm runs, yet they were about as slow as cold ones.
- The 20-turn conversation history is the largest cost in `uis-long`: dropping it saves ~1.4 s
  (gpt-6.1-sol). Cutting 15 of the 18 tools (~4.8K tokens) saves ~0.4 s.
- The full app prompt costs ~0.5–1 s over a tiny prompt. gpt-6-luna is 0.3–1 s faster on every case.

## Findings: what to cut (2026-10-23, gpt-6.1-sol, 4-5 rounds)

- A smaller prompt does not start faster in this range: `uis-first` at 15.5K, 13K, 12K and 9.6K input tokens all
  reached first output in ~2.0 s, and the agent picked the same first tool. On `uis-long` the lean variant was within
  noise. Trimming tools and guidance is worth it for cost and tool choice, not for latency.
- `visualize` without its presentation fields (subtitle, display name, field types and labels, input list) wrote
  244 instead of 288 tokens and generated in 2.2 s instead of 3.2 s.
- `verbosity: low` changed little: answers 90 → 81 tokens, chart calls unchanged.
- JSON-escaping code costs ~6.5% more tokens than raw text, so free-form tools would save little.
- A live UIS request (`../uis_responsiveness`, 6 questions) takes 20-34 s over 4-7 model calls; ~57% of it is
  waiting for each call's first output and ~39% generating. Most requests read or search, run Python to check the
  data, chart, then answer: the number of calls is the main cost.

