"""Multi-turn scenarios: does continuing a session's conversation (design-docs/63) help?

    uv run python tests/eval/intent_routing/multiturn.py --name mt-on                      # continuation on
    DF_AGENT_CONTINUATION=off uv run python tests/eval/intent_routing/multiturn.py --name mt-off
    uv run python tests/eval/intent_routing/multiturn.py --report experiment_data/intent_eval/runs/mt-on ...

Each scenario is a sequence of requests in one session. Between turns the harness applies
each run's results to the session state as the browser does (new tables and charts, chart and
report edits, deletions, loaded tables, reports, the conversation's messages, and the focus
moving to what was made), so a fresh start and a continued conversation see the same session.
Each turn is graded like the single-turn cases, plus an optional check of what it did.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

import harness  # noqa: E402
from cases import PASS, Case, grade  # noqa: E402
from harness import Step, Trace  # noqa: E402

MODELS = ["gpt-6.1-sol", "gpt-5.6-terra", "gpt-6-luna"]


# ── scenarios ────────────────────────────────────────────────────────────

@dataclass
class Turn:
    prompt: str
    ideal: set[str]
    acceptable: set[str] = field(default_factory=set)
    focus: dict | None = None            # move the canvas before the request (else: where the last turn left it)
    edit: Callable[[dict], None] | None = None   # a user edit to the state before the request
    with_next: bool = False              # sent at the same time as the next turn
    check: Callable[[dict, list[dict]], tuple[bool, str]] | None = None  # (state after, events) -> ok, why


def _made_chart_edited(index: int):
    """The turn edited (not re-created) the chart made by turn ``index``."""
    def check(state: dict, events: list[dict]) -> tuple[bool, str]:
        target = state.get("_made", {}).get(index, {}).get("chart")
        edited = [e for e in events if e.get("type") == "tool_start" and e.get("tool") == "edit_file"]
        paths = [str((e.get("args") or {}).get("path")) for e in edited]
        if target and any(target in path for path in paths):
            return True, ""
        return False, f"did not edit {target}: {paths or 'no edit'}"
    return check


def _embeds_charts_from(*indexes: int):
    """The report embeds a chart this scenario made (in any of the turns ``indexes``)."""
    def check(state: dict, events: list[dict]) -> tuple[bool, str]:
        report = "".join(e.get("content") or "" for e in events
                         if e.get("type") == "text_delta" and e.get("channel") == "report")
        wanted = [chart for index in indexes if (chart := state.get("_made", {}).get(index, {}).get("chart"))]
        if not report:
            return False, "no report"
        return any(f"chart://{chart}" in report for chart in wanted), f"report embeds none of {wanted}"
    return check


def _bar_chart(chart_index: int):
    def edit(state: dict) -> None:
        chart_id = state.get("_made", {}).get(chart_index, {}).get("chart")
        for chart in state["charts"]:
            if chart["id"] == chart_id:
                chart["chartType"] = "Bar Chart"
    return edit


@dataclass
class Scenario:
    id: str
    session: str
    turns: list[Turn]
    focus: dict | None = None
    note: str = ""


SCENARIOS = [
    Scenario("deepen", "unemployment", [
        Turn("Which industries were hit hardest in 2009? Chart it.", {"chart"}),
        Turn("Now show how the three hardest-hit ones changed month by month in 2008–2009.", {"chart"}),
        Turn("Switch that chart to an area chart.", {"edit_chart"}, {"chart"}, check=_made_chart_edited(1)),
        Turn("Write a short report on what we found in this thread.", {"report"}, check=_embeds_charts_from(0, 1)),
    ], note="Follow-ups build on the previous turn's own results."),
    Scenario("load_iterate", "empty", [
        Turn("How did Seattle's weather vary by month in 2014?", {"load", "chart"}),
        Turn("Compare the rainiest and the driest month.", {"chart", "answer"}),
        Turn("Remember for later: always show temperatures in Fahrenheit.", {"note"}),
        Turn("Add the daily maximum temperature trend for 2014.", {"chart"}),
    ], note="Data loaded in turn 1 is reused; a standing preference is saved."),
    Scenario("switch_back", "stocks", [
        Turn("Which stock had the best return per unit of volatility?", {"answer", "chart"},
             focus={"type": "chart", "chartId": "chart-1efd75b20fd9"}),
        Turn("When did NVDA hit its deepest drawdown?", {"answer", "chart"},
             focus={"type": "chart", "chartId": "chart-82ccb08de691"}),
        Turn("Back to this chart: label each point with its ticker.", {"edit_chart"}, {"chart"},
             focus={"type": "chart", "chartId": "chart-1efd75b20fd9"}),
    ], note="The user moves between threads; the agent must follow the canvas."),
    Scenario("edit_between", "unemployment", [
        Turn("Chart the average yearly unemployment rate for Construction and Manufacturing.", {"chart"}),
        Turn("Why does 2009 stand out in this chart?", {"answer"}, {"chart"}, edit=_bar_chart(0)),
        Turn("Delete the heatmap of deviations from 2007, we don't need it.", {"delete"}, {"ask"}),
    ], note="The user turns the chart into a bar chart between turns; the agent should see it changed."),
    Scenario("concurrent", "stocks", focus={"type": "chart", "chartId": "chart-cd8c9a984f88"}, turns=[
        Turn("Chart average daily trading volume by stock.", {"chart"}, with_next=True),
        Turn("What was META's worst single trading day?", {"answer"}, {"chart"}),
        Turn("Put the volume chart and the META finding into one short report.", {"report"},
             check=_embeds_charts_from(0)),
    ], note="Two requests at once; the third needs both."),
]


# ── the browser's side: apply a run's results to the session state ─────────

def _now_ms() -> int:
    return int(time.time() * 1000)


def _focus_node(state: dict) -> str:
    focus = state.get("focusedId") or {}
    kind = focus.get("type")
    if kind == "chart":
        chart = next((c for c in state["charts"] if c["id"] == focus.get("chartId")), None)
        if chart:
            return chart["tableRef"]
    if kind == "table" and focus.get("tableId"):
        return focus["tableId"]
    if kind == "report" and focus.get("reportId"):
        return focus["reportId"]
    if kind == "file":
        node = next((n for n in state.get("fileNodes") or [] if n.get("path") == focus.get("fileName")), None)
        if node:
            return node["id"]
    return f"conversation-root:{_now_ms()}"


def _field(state: dict, name: str) -> str:
    for item in state.setdefault("conceptShelfItems", []):
        if item.get("name") == name:
            return item["id"]
    field_id = f"field-{name}-{len(state['conceptShelfItems'])}"
    state["conceptShelfItems"].append({"id": field_id, "name": name, "type": "auto", "source": "custom"})
    return field_id


def _encoding_map(state: dict, encodings: dict) -> dict:
    out = {}
    for channel, value in (encodings or {}).items():
        spec = value if isinstance(value, dict) else {"field": value}
        if spec.get("field"):
            out[channel] = {"fieldID": _field(state, spec["field"]),
                            **{k: v for k, v in spec.items() if k in ("aggregate", "sortOrder", "sortBy", "scheme")}}
    return out


def apply_turn(state: dict, events: list[dict], prompt: str, turn_id: str, index: int,
               server: harness.Server, workspace_id: str) -> None:
    for key in ("textTurns", "derivedTables", "charts", "generatedReports", "inputTables", "loadedTableNodes"):
        state.setdefault(key, [])
    made = state.setdefault("_made", {}).setdefault(index, {})
    now = _now_ms()
    ask = {"kind": "text", "id": f"{turn_id}-ask", "displayId": f"{turn_id}-ask", "textKind": "explain", "content": "",
           "prompt": prompt, "parentNodeId": _focus_node(state), "createdAt": now}
    state["textTurns"].append(ask)
    head, focus, last_action, report = ask["id"], None, {}, []
    names = lambda: {(t.get("virtual") or {}).get("tableId") or (t.get("source") or {}).get("tableId") or t["id"]: t["id"]
                     for t in state["inputTables"] + state["derivedTables"]}
    for event in events:
        kind = event.get("type")
        if kind == "action":
            last_action = event
        elif kind == "result":
            result = event["content"]["result"]
            goal = result.get("refined_goal") or {}
            virtual = result["content"]["virtual"]
            rows = result["content"].get("rows") or []
            columns = goal.get("output_fields") or (list(rows[0]) if rows else [])
            sources = [names()[n] for n in last_action.get("input_tables") or [] if n in names()]
            table_id = virtual["table_name"]
            state["derivedTables"] = [t for t in state["derivedTables"] if t["id"] != table_id]
            state["derivedTables"].append({
                "kind": "table", "id": table_id, "displayId": goal.get("display_name") or goal.get("title") or table_id,
                "names": columns, "metadata": {c: {"type": "number" if rows and isinstance(rows[0].get(c), (int, float)) else "string"}
                                               for c in columns},
                "virtual": {"tableId": table_id, "rowCount": virtual.get("row_count")},
                "derive": {"source": sources, "code": result.get("code") or "",
                           "trigger": {"tableId": sources[0] if sources else head}},
                "parentNodeId": head, "createdAt": now})
            chart = goal.get("chart") or {}
            state["charts"].append({"id": result["chart_id"], "chartType": chart.get("chart_type") or "Auto",
                                    "tableRef": table_id, "encodingMap": _encoding_map(state, chart.get("encodings")),
                                    "title": goal.get("title"), "subtitle": goal.get("subtitle"), "source": "user"})
            made["chart"], made["table"] = result["chart_id"], table_id
            head, focus = table_id, {"type": "chart", "chartId": result["chart_id"]}
        elif kind == "text_delta" and event.get("channel") == "report":
            report.append(event.get("content") or "")
        elif kind == "tool_result" and event.get("tool") == "edit_file" and event.get("status") == "ok":
            try:
                update = json.loads(event.get("stdout") or "{}").get("session_update")
            except json.JSONDecodeError:
                update = None
            if update and update.get("kind") == "chart":
                for chart in state["charts"]:
                    if chart["id"] == update["id"]:
                        spec = update["spec"]
                        chart.update(chartType=spec.get("chart_type") or chart["chartType"],
                                     encodingMap=_encoding_map(state, spec.get("encodings")),
                                     title=spec.get("title", chart.get("title")))
                        focus = {"type": "chart", "chartId": chart["id"]}
            elif update and update.get("kind") == "report":
                for item in state["generatedReports"]:
                    if item["id"] == update["id"]:
                        item["content"] = update["content"]
        elif kind == "tool_result" and event.get("tool") == "delete_items" and event.get("status") == "ok":
            plan = json.loads(event.get("stdout") or "{}").get("deleted") or {}
            gone_tables = {t["node_id"] for t in plan.get("tables") or []}
            gone_charts = {c["id"] for c in plan.get("charts") or []}
            state["derivedTables"] = [t for t in state["derivedTables"] if t["id"] not in gone_tables]
            state["inputTables"] = [t for t in state["inputTables"] if t["id"] not in gone_tables]
            state["charts"] = [c for c in state["charts"] if c["id"] not in gone_charts and c["tableRef"] not in gone_tables]
            if (state.get("focusedId") or {}).get("chartId") in gone_charts:
                state["focusedId"] = None
        elif kind == "data_operation_result":
            tables = requests.get(f"{server.base}/api/tables/list-tables", headers={"X-Workspace-Id": workspace_id},
                                  timeout=30).json().get("data", {}).get("tables", [])
            for name in event["operation"].get("result_table_ids") or []:
                table = next((t for t in tables if t.get("name") == name), None)
                if not table or name in names():
                    continue
                state["inputTables"].append({
                    "kind": "input-table", "id": name, "displayId": name, "source": {"kind": "workspace", "tableId": name},
                    "snapshot": {"columns": [{"name": c["name"], "type": c.get("type")} for c in table.get("columns") or []],
                                 "rowCount": table.get("row_count")}})
                state["loadedTableNodes"].append({"kind": "loaded-table", "id": f"loaded-{name}", "tableId": name,
                                                  "parentNodeId": head, "createdAt": now})
                head = f"loaded-{name}"
        elif kind == "completion":
            content = event.get("content") or {}
            summary = content.get("summary") if isinstance(content, dict) else str(content)
            if report:
                text = "".join(report)
                title = next((line[2:] for line in text.splitlines() if line.startswith("# ")), "Report")
                report_id = f"report-{turn_id}"
                state["generatedReports"].append({"id": report_id, "title": title, "content": text,
                                                  "parentNodeId": head, "createdAt": now})
                head, focus = report_id, {"type": "report", "reportId": report_id}
            if summary:
                state["textTurns"].append({"kind": "text", "id": f"{turn_id}-answer", "displayId": f"{turn_id}-answer",
                                           "textKind": "explain", "content": summary, "parentNodeId": head,
                                           "createdAt": now + 1})
    if focus:
        state["focusedId"] = focus


def _session_state(state: dict) -> dict:
    return {key: value for key, value in state.items() if not key.startswith("_")}


# ── running ──────────────────────────────────────────────────────────────

def _events(path: Path) -> list[dict]:
    out = []
    for line in open(path):
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def run_scenario(server: harness.Server, scenario: Scenario, model: str, repeat: int, run_dir: Path) -> list[dict]:
    from data_formulator.model_registry import ModelRegistry

    workspace_id = f"mt-{scenario.id}-{model.replace('.', '')}-{repeat}"
    state = server.prepare_workspace(scenario.session, workspace_id, scenario.focus)
    model_id = ModelRegistry.make_id("azure", model)
    rows, index = [], 0
    while index < len(scenario.turns):
        group = [index]
        while scenario.turns[group[-1]].with_next and group[-1] + 1 < len(scenario.turns):
            group.append(group[-1] + 1)
        for turn_index in group:
            turn = scenario.turns[turn_index]
            if turn.focus is not None:
                state["focusedId"] = turn.focus
            if turn.edit:
                turn.edit(state)
        requests.post(f"{server.base}/api/sessions/save", json={"id": workspace_id, "state": _session_state(state)},
                      timeout=30)

        def one(turn_index: int) -> tuple[int, Trace, list[dict], float, float]:
            turn = scenario.turns[turn_index]
            raw = run_dir / "traces" / f"{workspace_id}-t{turn_index}.jsonl"
            body = harness.request_body(_session_state(state), turn.prompt, model_id)
            for attempt in range(6):
                started = time.time()
                trace = harness.run_case(server, workspace_id, body, tail=1e9, budget=600, raw_path=raw)
                # A rate-limited turn did not join the conversation, so it can simply be sent again.
                if not any(step.kind == "error" and "Rate limit" in str(step.detail) for step in trace.steps):
                    break
                time.sleep(30 * (attempt + 1))
            return turn_index, trace, _events(raw), started, time.time()

        with ThreadPoolExecutor(max_workers=len(group)) as pool:
            results = sorted(pool.map(one, group), key=lambda item: item[3])
        for turn_index, trace, events, started, ended in results:
            turn = scenario.turns[turn_index]
            apply_turn(state, events, turn.prompt, f"{workspace_id}-t{turn_index}", turn_index, server, workspace_id)
            case = Case(f"{scenario.id}#{turn_index}", scenario.session, turn.prompt, "multi", turn.ideal, turn.acceptable)
            result, move, reason = grade(case, trace)
            checked = turn.check(state, events) if turn.check and result in PASS else (None, "")
            busy = max([step.t for step in trace.steps] or [trace.seconds])
            rows.append({"scenario": scenario.id, "turn": turn_index, "model": model, "repeat": repeat,
                         "workspace_id": workspace_id, "prompt": turn.prompt, "grade": result, "move": move,
                         "reason": reason, "check": checked[0], "check_reason": checked[1], "busy": round(busy, 1),
                         "started": started, "ended": ended, "path": [f"{s.kind}:{s.name}" for s in trace.path()],
                         "trace": trace.to_json()})
        index = group[-1] + 1
    return rows


def run(args: argparse.Namespace) -> Path:
    harness.snapshot_templates()
    run_dir = harness.EVAL_ROOT / "runs" / args.name
    (run_dir / "traces").mkdir(parents=True, exist_ok=True)
    server = harness.Server(run_dir)
    server.start()
    scenarios = [s for s in SCENARIOS if not args.scenarios or s.id in args.scenarios]
    jobs = [(s, m, r) for r in range(args.repeat) for s in scenarios for m in args.models]
    slots = {model: threading.Semaphore(args.per_model) for model in args.models}
    print(f"{len(jobs)} scenario runs → {run_dir}", flush=True)
    out = open(run_dir / "results.jsonl", "a")
    lock = threading.Lock()

    def job(scenario, model, repeat):
        with slots[model]:
            return run_scenario(server, scenario, model, repeat, run_dir)

    try:
        with ThreadPoolExecutor(max_workers=len(args.models) * args.per_model) as pool:
            futures = [pool.submit(job, *item) for item in jobs]
            for done, future in enumerate(as_completed(futures), 1):
                try:
                    rows = future.result()
                except Exception as exc:
                    print(f"  harness error: {exc!r}", flush=True)
                    continue
                with lock:
                    for row in rows:
                        out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                print(f"[{done}/{len(jobs)}] {rows[0]['model']:<14} {rows[0]['scenario']:<13} "
                      + " ".join(f"{r['grade'][:5]}{'' if r['check'] in (None, True) else '!'}/{r['busy']}s" for r in rows),
                      flush=True)
    finally:
        out.close()
        server.stop()
    return run_dir


# ── report ───────────────────────────────────────────────────────────────

_CALLS: dict[Path, list[dict]] = {}


def _calls(run_dir: Path, row: dict) -> list[dict]:
    """The model calls of one turn: its session's cache key, within the turn's time."""
    if run_dir not in _CALLS:
        _CALLS[run_dir] = [json.loads(line) for line in open(run_dir / "home" / "llm_calls.jsonl")]
    key = hashlib.sha256(f"local:chenwang:{row['workspace_id']}".encode()).hexdigest()[:32]
    return sorted((call for call in _CALLS[run_dir]
                   if call["key"] == key and row["started"] - 1 <= call["started"] <= row["ended"]),
                  key=lambda call: call["started"])


def report(run_dirs: list[Path]) -> None:
    lines = []
    for run_dir in run_dirs:
        rows = [json.loads(line) for line in open(run_dir / "results.jsonl")]
        for row in rows:
            row["calls"] = _calls(run_dir, row)
        lines += [f"## {run_dir.name}", "",
                  "| Model | Turns | Pass | Checks ok | Median busy s | Calls/turn | 1st-call cached | Input tok/turn | Uncached tok/turn |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for model in sorted({row["model"] for row in rows}):
            mine = [row for row in rows if row["model"] == model and row["grade"] != "ERROR"]
            checks = [row["check"] for row in mine if row["check"] is not None]
            first = [row["calls"][0] for row in mine if row["calls"]]
            cached = sum(c.get("cached_tokens") or 0 for c in first) / max(sum(c.get("input_tokens") or 0 for c in first), 1)
            inputs = [sum(c.get("input_tokens") or 0 for c in row["calls"]) for row in mine]
            uncached = [sum((c.get("input_tokens") or 0) - (c.get("cached_tokens") or 0) for c in row["calls"]) for row in mine]
            lines.append(f"| {model} | {len(mine)} | {sum(r['grade'] in PASS for r in mine)} | "
                         f"{sum(checks)}/{len(checks)} | {statistics.median(r['busy'] for r in mine):.1f} | "
                         f"{statistics.mean(len(r['calls']) for r in mine):.2f} | {100 * cached:.0f}% | "
                         f"{statistics.mean(inputs):,.0f} | {statistics.mean(uncached):,.0f} |")
        by_turn = defaultdict(list)
        for row in rows:
            by_turn[(row["scenario"], row["turn"])].append(row)
        lines += ["", "| Scenario turn | Pass | Median busy s | Calls |", "|---|---|---|---|"]
        for (scenario, turn), mine in sorted(by_turn.items()):
            lines.append(f"| {scenario} #{turn} | {sum(r['grade'] in PASS for r in mine)}/{len(mine)} | "
                         f"{statistics.median(r['busy'] for r in mine):.1f} | {statistics.mean(len(r['calls']) for r in mine):.1f} |")
        lines.append("")
    print("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", default=MODELS)
    parser.add_argument("--scenarios", nargs="*")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--per-model", type=int, default=2)
    parser.add_argument("--name")
    parser.add_argument("--report", nargs="*", type=Path)
    args = parser.parse_args()
    if args.report:
        report(args.report)
    else:
        args.name = args.name or time.strftime("mt-%Y%m%d-%H%M%S")
        report([run(args)])


if __name__ == "__main__":
    main()
