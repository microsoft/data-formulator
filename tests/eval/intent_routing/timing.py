"""Where an agent request's time goes: model calls (waiting for first output, generating) and tools.

    uv run python tests/eval/intent_routing/timing.py experiment_data/intent_eval/runs/<run> [<run> ...]

Reads a run made with ``run.py --full``: ``results.jsonl`` (one row per request) and the server's
``home/llm_calls.jsonl`` (one row per model call, written by the harness launcher), joined by the
run's prompt cache key.
"""

from __future__ import annotations

import hashlib
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

IDENTITY = "local:chenwang"


def cache_key(workspace_id: str) -> str:
    return hashlib.sha256(f"{IDENTITY}:{workspace_id}".encode()).hexdigest()[:32]


def load(run_dir: Path) -> list[dict]:
    calls_by_key: dict[str, list[dict]] = defaultdict(list)
    for line in open(run_dir / "home" / "llm_calls.jsonl"):
        call = json.loads(line)
        calls_by_key[call["key"]].append(call)
    rows = []
    for line in open(run_dir / "results.jsonl"):
        row = json.loads(line)
        calls = sorted(calls_by_key.get(row.get("cache_key") or cache_key(row["workspace_id"]), []),
                       key=lambda call: call["started"])
        if not calls or row["grade"] == "ERROR":
            continue
        llm = sum(call["total"] for call in calls)
        wait = sum(call.get("first_output") or call["first_chunk"] for call in calls)
        rows.append({**row, "calls": calls, "llm": llm, "wait": wait, "generate": llm - wait,
                     "other": max(row["seconds"] - llm, 0)})
    return rows


def pct(values: list[float], q: float) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, int(q * len(values)))] if values else 0.0


def summarize(rows: list[dict], label: str) -> list[str]:
    lines = [f"## {label}", "", "| Model | Runs | Median s | p90 s | Calls/run | Model wait | Generating | Tools/other | "
             "1st call wait | Later call wait | 1st call cached | Input tok/call | Output tok/run |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for model in sorted({row["model"] for row in rows}):
        mine = [row for row in rows if row["model"] == model]
        total = sum(row["seconds"] for row in mine) or 1
        first = [row["calls"][0] for row in mine]
        later = [call for row in mine for call in row["calls"][1:]]
        all_calls = [call for row in mine for call in row["calls"]]
        cached = sum(call.get("cached_tokens") or 0 for call in first) / max(sum(call.get("input_tokens") or 0 for call in first), 1)
        lines.append(
            f"| {model} | {len(mine)} | {statistics.median(row['seconds'] for row in mine):.1f} | "
            f"{pct([row['seconds'] for row in mine], 0.9):.1f} | {statistics.mean(len(row['calls']) for row in mine):.1f} | "
            f"{100 * sum(row['wait'] for row in mine) / total:.0f}% | {100 * sum(row['generate'] for row in mine) / total:.0f}% | "
            f"{100 * sum(row['other'] for row in mine) / total:.0f}% | "
            f"{statistics.median(call.get('first_output') or call['first_chunk'] for call in first):.1f}s | "
            f"{statistics.median([call.get('first_output') or call['first_chunk'] for call in later] or [0]):.1f}s | "
            f"{100 * cached:.0f}% | {statistics.mean(call.get('input_tokens') or 0 for call in all_calls):,.0f} | "
            f"{statistics.mean(sum(call.get('output_tokens') or 0 for call in row['calls']) for row in mine):,.0f} |")
    lines += ["", "| Case | " + " | ".join(sorted({row["model"] for row in rows})) + " |",
              "|---|" + "---|" * len({row["model"] for row in rows})]
    for case in sorted({row["case"] for row in rows}):
        cells = []
        for model in sorted({row["model"] for row in rows}):
            mine = [row for row in rows if row["case"] == case and row["model"] == model]
            cells.append(f"{statistics.median(row['seconds'] for row in mine):.0f}s / {statistics.mean(len(row['calls']) for row in mine):.1f} calls"
                         if mine else "—")
        lines.append(f"| {case} | " + " | ".join(cells) + " |")
    return lines


def call_table(rows: list[dict]) -> list[str]:
    """Wait for first output by uncached input size, and request composition of first calls."""
    lines = ["", "### Wait for first output by uncached input tokens", "", "| Uncached tokens | Calls | Median wait |", "|---|---|---|"]
    buckets = [(0, 2000), (2000, 8000), (8000, 14000), (14000, 20000), (20000, 10**9)]
    calls = [call for row in rows for call in row["calls"] if call.get("input_tokens")]
    for low, high in buckets:
        inside = [call for call in calls if low <= call["input_tokens"] - (call.get("cached_tokens") or 0) < high]
        if inside:
            lines.append(f"| {low:,}–{high:,} | {len(inside)} | "
                         f"{statistics.median(call.get('first_output') or call['first_chunk'] for call in inside):.1f}s |")
    first = [row["calls"][0] for row in rows]
    lines += ["", "### First-call request composition (characters)", "",
              f"- system prompt: {statistics.median(call['system_chars'] for call in first):,.0f}",
              f"- tool schemas: {statistics.median(call['tool_chars'] for call in first):,.0f} "
              f"({statistics.median(call['tools'] for call in first):.0f} tools)",
              f"- user message (session context + question): {statistics.median(call['message_chars'] for call in first):,.0f}",
              f"- input tokens: {statistics.median(call.get('input_tokens') or 0 for call in first):,.0f}"]
    return lines


READ_TOOLS = {"read_file", "find_data", "describe_data", "list_files", "list_data", "summarize_data_sources",
              "inspect_chart", "list_connectors", "search", "probe_data", "list_workflows", "list_sessions",
              # tools of earlier runs (design-docs/65 replaced them)
              "inspect_source_data", "search_files", "list_workspace_items", "read_workspace_item",
              "search_workspace_items"}


def purpose(call: dict) -> str:
    produced = call.get("produced") or []
    if not produced:
        return "final text"
    if produced == ["load_skill"]:
        return "load_skill"
    if all(name in READ_TOOLS for name in produced):
        return "reads (batched)" if len(produced) > 1 else "read"
    if "execute_python_script" in produced:
        return "python"
    return "action/write"


def purposes(rows: list[dict]) -> list[str]:
    lines = ["", "### Model time by what the call produced", "",
             "| Model | " + " | ".join(("final text", "read", "reads (batched)", "load_skill", "python", "action/write")) + " |",
             "|---|" + "---|" * 6]
    for model in sorted({row["model"] for row in rows}):
        calls = [call for row in rows if row["model"] == model for call in row["calls"] if "produced" in call]
        total = sum(call["total"] for call in calls) or 1
        cells = []
        for kind in ("final text", "read", "reads (batched)", "load_skill", "python", "action/write"):
            mine = [call for call in calls if purpose(call) == kind]
            cells.append(f"{len(mine)} · {100 * sum(call['total'] for call in mine) / total:.0f}%")
        lines.append(f"| {model} | " + " | ".join(cells) + " |")
    return lines


def main() -> None:
    out = []
    for argument in sys.argv[1:]:
        run_dir = Path(argument)
        rows = load(run_dir)
        out += summarize(rows, run_dir.name) + call_table(rows) + purposes(rows) + [""]
    print("\n".join(out))


if __name__ == "__main__":
    main()
