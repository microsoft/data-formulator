"""Agent responsiveness on large real data: the UIS (UNESCO) demo sessions.

Sends the request the browser sends when a visitor asks a question in a UIS dataset session, against a
real server, and records when each streamed event arrives, every model call (start, first output, total,
tokens), and every tool's duration. Two modes:

- ``--fake``: a scripted instant model (no network), so the time measured is the server's own: building
  the context, running tools on the data, saving the session. ``--script`` picks what the fake does.
- live (default): real models, for end-to-end numbers.

    uv run python tests/eval/uis_responsiveness/bench.py --fake --script none inspect python --repeat 3
    uv run python tests/eval/uis_responsiveness/bench.py --models gpt-6.1-sol --datasets education-opri
    uv run python tests/eval/uis_responsiveness/bench.py --report experiment_data/uis_bench/runs/<run>

UIS sessions come from the installed demo (``<DF_SITES_DIR>/unesco/<release>/<dataset>.zip``; install
it from ``/demo/unesco`` or with ``demos/unesco/build.py``). Runs go to ``experiment_data/uis_bench/runs``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import statistics
import sys
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

import requests
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "intent_routing"))
import harness  # noqa: E402

REPO = harness.REPO
ROOT = REPO / "experiment_data" / "uis_bench"
SESSIONS = ROOT / "sessions"
PROFILE = REPO / "py-src" / "data_formulator" / "demos" / "unesco" / "profile.yaml"
SITE_CONTENT = Path(os.getenv("DF_SITES_DIR", Path.home() / ".data_formulator" / "site-content")).expanduser()
DEMO = "unesco"

_LATEST_PER_COUNTRY = ("import pandas as pd\n"
                       "df = pd.read_parquet('data/{big}.parquet')\n"
                       "ind = df['indicator_id'].value_counts().index[0]\n"
                       "sub = df[df['indicator_id'] == ind]\n"
                       "latest = sub.sort_values('year').groupby(sub.columns[1]).tail(1)\n")

# Fake model scripts: the responses the instant model gives, in order, then a final answer.
# ``{big}`` is the session's largest table.
SCRIPTS: dict[str, list[dict[str, Any]]] = {
    "none": [],
    "inspect": [{"tool": "read_file", "args": {"files": [{"path": "session/tables/{big}.json"}]}}],
    "python": [{"tool": "execute_python_script", "args": {
        "purpose": "Latest value per country for one indicator",
        "code": _LATEST_PER_COUNTRY + "print(len(df), ind, len(latest))\n"}}],
    "duckdb": [{"tool": "execute_python_script", "args": {
        "purpose": "Values per indicator",
        "code": ("import duckdb\n"
                 "print(duckdb.sql(\"SELECT indicator_id, count(*) n FROM 'data/{big}.parquet' "
                 "GROUP BY 1 ORDER BY n DESC LIMIT 5\").df())\n")}}],
    "visualize": [{"tool": "visualize", "args": {
        "title": "Latest value by country", "display_name": "Latest by country",
        "input_sources": [{"id": "{big}", "kind": "data"}],
        "code": _LATEST_PER_COUNTRY + "result = latest.nlargest(20, 'value')[[sub.columns[1], 'value']]\n",
        "output_variable": "result",
        "chart": {"chart_type": "Bar Chart", "encodings": {"x": "value", "y": "{key}"}}}}],
    "search": [{"tool": "search", "args": {"query": "out of school"}}],
    "search-rare": [{"tool": "search", "args": {"query": "Tuvalu", "path": ["session/tables/"]}}],
    "python+visualize": [],  # filled below
}
SCRIPTS["python+visualize"] = SCRIPTS["python"] + SCRIPTS["visualize"]

FAKE_PATCH = r"""
import json as _j, os as _o, time as _t, threading as _th
from types import SimpleNamespace as _NS
from data_formulator.agents import client_utils as _cu0
_script = _j.loads(_o.environ.get("DF_BENCH_FAKE") or "null")
if _script is not None:
    _clock = _th.Lock()
    _dump = _o.path.join(_o.environ["DATA_FORMULATOR_HOME"], "first_prompt.json")
    def _fake(self, messages, tools, stream=False, **kwargs):
        # The script's step: tool results since the request's last user message.
        last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=0)
        index = sum(1 for m in messages[last_user:] if m.get("role") == "tool")
        with _clock:
            if not _o.path.exists(_dump):
                with open(_dump, "w") as out:
                    _j.dump({"messages": messages, "tools": tools}, out, default=str)
        step = _script[index] if index < len(_script) else {"text": "Done."}
        def chunk(delta, finish=None):
            return _NS(choices=[_NS(delta=delta, finish_reason=finish)], usage=None)
        def chunks():
            if "tool" in step:
                call = _NS(index=0, id=f"call_{index}", type="function",
                           function=_NS(name=step["tool"], arguments=_j.dumps(step["args"])))
                yield chunk(_NS(content=None, tool_calls=[call]), "tool_calls")
            else:
                yield chunk(_NS(content=step["text"], tool_calls=None), "stop")
        return chunks()
    _cu0.Client.get_completion_with_tools = _fake
if _o.environ.get("DF_BENCH_INDEX_DESCRIPTIONS"):
    # Experiment: each table's description (clipped) on its session-index line.
    from data_formulator.analyst.session_layer import layer as _layer
    _index = _layer.SessionLayer.index
    def _index_with_descriptions(self):
        text = _index(self)
        for table in self.tables:
            description = " ".join(str(table.get("description") or "").split())
            if description:
                path = f"session/tables/{self.table_name(table)}.json"
                clipped = description if len(description) <= 200 else description[:199] + "…"
                text = "\n".join(line + f" — {clipped}" if line.startswith(f"- `{path}`") else line
                                 for line in text.split("\n"))
        return text
    _layer.SessionLayer.index = _index_with_descriptions
_prof_dir = _o.environ.get("DF_BENCH_PROFILE")
if _prof_dir:
    import cProfile as _cp
    from data_formulator.analyst import agent as _ag
    _run = _ag.AnalystAgent.run
    def _profiled(self, *args, **kwargs):
        profile = _cp.Profile()
        profile.enable()
        try:
            yield from _run(self, *args, **kwargs)
        finally:
            profile.disable()
            profile.dump_stats(_o.path.join(_prof_dir, f"run-{_t.time():.3f}.prof"))
    _ag.AnalystAgent.run = _profiled
"""


def ensure_sessions() -> list[str]:
    """Unzip each installed UIS dataset session once into experiment_data/uis_bench/sessions."""
    releases = sorted(path for path in (SITE_CONTENT / "unesco").glob("*") if path.is_dir())
    if not releases:
        raise SystemExit(f"UIS demo not installed under {SITE_CONTENT / 'unesco'}")
    for archive in sorted(releases[-1].glob("*.zip")):
        target = SESSIONS / archive.stem
        if not (target / ".migrated").exists():
            target.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(target)
            harness.migrate_states([target / "state.json"])
            (target / ".migrated").touch()
    return sorted(path.name for path in SESSIONS.iterdir() if (path / "workspace").exists())


def story_questions() -> dict[str, list[str]]:
    profile = yaml.safe_load(PROFILE.read_text())
    return {starter["id"]: [story["prompt"] for story in starter.get("stories") or [] if story.get("prompt")]
            for starter in profile.get("starters") or []}


def biggest_table(dataset: str) -> str:
    import pyarrow.parquet as pq
    files = sorted((SESSIONS / dataset / "workspace" / "data").glob("*.parquet"),
                   key=lambda path: pq.ParquetFile(path).metadata.num_rows)
    return files[-1].stem


class BenchServer(harness.Server):
    def __init__(self, run_dir: Path, env: dict[str, str]):
        super().__init__(run_dir)
        # One folder per server (its home, server.log, llm_calls.jsonl): a run may start several.
        self.run_dir = self.home = run_dir / f"home-{uuid.uuid4().hex[:6]}"
        self.extra_env = env

    def start(self) -> None:
        saved, old = harness.LAUNCHER, {key: os.environ.get(key) for key in self.extra_env}
        harness.LAUNCHER = FAKE_PATCH + saved
        os.environ.update(self.extra_env)
        try:
            super().start()
        finally:
            harness.LAUNCHER = saved
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def _setup_user(self) -> None:
        probe = f"probe-{uuid.uuid4().hex[:6]}"
        requests.post(f"{self.base}/api/sessions/create", json={"id": probe}, timeout=30).raise_for_status()
        matches = list(self.home.glob(f"users/*/workspaces/{probe}"))
        if not matches:
            raise RuntimeError("could not locate the user home")
        self.user_home = matches[0].parent.parent
        shutil.rmtree(matches[0], ignore_errors=True)

    def prepare_uis(self, dataset: str, workspace_id: str) -> dict[str, Any]:
        """Install the dataset session where the demo keeps its visitors' sessions (site-scoped)."""
        assert self.user_home is not None
        source = SESSIONS / dataset
        target = self.home / "sites" / DEMO / "users" / self.user_home.name / "workspaces" / workspace_id
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source / "workspace", target, ignore=shutil.ignore_patterns("*.lock"))
        meta = target / "workspace_meta.json"
        meta.write_text(json.dumps({**json.loads(meta.read_text()), "id": workspace_id}))
        state = json.loads((source / "state.json").read_text())
        state["activeWorkspace"] = {**(state.get("activeWorkspace") or {}), "id": workspace_id}
        requests.post(f"{self.base}/api/sessions/save", json={"id": workspace_id, "state": state},
                      headers={"X-DF-Demo": DEMO}, timeout=60).raise_for_status()
        return state


def cache_key(workspace_id: str) -> str:
    return hashlib.sha256(f"local:{os.environ.get('USER', '')}:{workspace_id}".encode()).hexdigest()[:32]


def run_one(server: BenchServer, dataset: str, question: str, model_id: str,
            session: tuple[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """Ask *question* in a fresh copy of the dataset session, or in *session* (workspace id, state)."""
    workspace_id, state = session or (f"uis-{dataset}-{uuid.uuid4().hex[:8]}", None)
    if state is None:
        state = server.prepare_uis(dataset, workspace_id)
    body = harness.request_body(state, question, model_id)
    events: list[dict[str, Any]] = []
    start, error, headers_at = time.time(), None, None
    try:
        with requests.post(f"{server.base}/api/agent/analyst-streaming", json=body, stream=True,
                           headers={"X-Workspace-Id": workspace_id, "Origin": server.base,
                                    "Sec-Fetch-Site": "same-origin", "X-DF-Demo": DEMO},
                           timeout=(15, 600)) as response:
            headers_at = round(time.time() - start, 3)
            if not response.ok:
                error = f"HTTP {response.status_code}: {response.text[:300]}"
            for line in response.iter_lines():
                if not line:
                    continue
                now = time.time() - start
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                etype = event.get("type")
                record = {"t": round(now, 3), "type": etype, "size": len(line),
                          "tool": event.get("tool") or event.get("action")}
                if etype == "tool_result":
                    record["status"] = event.get("status")
                    record["preview"] = json.dumps(event, default=str)[:300]
                events.append(record)
                if etype in ("completion", "interact", "error"):
                    if etype == "error":
                        error = json.dumps(event)[:400]
                    break
                if now > 600:
                    error = "budget"
                    break
    except requests.RequestException as exc:
        error = f"{type(exc).__name__}: {exc}"
    return {"dataset": dataset, "question": question, "workspace_id": workspace_id, "state": state,
            "cache_key": cache_key(workspace_id), "started": start, "headers": headers_at,
            "seconds": round(time.time() - start, 2), "error": error, "events": events,
            "home": server.home.name}


# ── report ───────────────────────────────────────────────────────────────


def _calls_by_key(run_dir: Path) -> dict[str, list[dict]]:
    calls: dict[str, list[dict]] = {}
    for path in run_dir.glob("home*/llm_calls.jsonl"):
        for line in open(path):
            call = json.loads(line)
            calls.setdefault(call["key"], []).append(call)
    for value in calls.values():
        value.sort(key=lambda call: call["started"])
    return calls


def analyze(row: dict[str, Any], calls: list[dict]) -> dict[str, Any]:
    events = row["events"]

    def first(pred) -> float | None:
        return next((e["t"] for e in events if pred(e)), None)

    tools: list[tuple[str, float]] = []
    open_tools: list[dict] = []
    for event in events:
        if event["type"] == "tool_start":
            open_tools.append(event)
        elif event["type"] == "tool_result" and open_tools:
            begun = open_tools.pop(0)
            tools.append((begun["tool"] or "?", event["t"] - begun["t"]))
    ends = [call["started"] + call["total"] for call in calls]
    return {
        "first_event": first(lambda e: True),
        "first_call": (calls[0]["started"] - row["started"]) if calls else None,
        "first_progress": first(lambda e: e["type"] in ("tool_start", "text_delta", "thinking_text", "action",
                                                        "agent_action", "plan", "skill_loaded")),
        "after_last_call": (row["started"] + row["seconds"] - ends[-1]) if calls else None,
        "total": row["seconds"],
        "calls": len(calls),
        "llm": sum(call["total"] for call in calls),
        "wait": sum(call.get("first_output") or call["first_chunk"] for call in calls),
        "tools": tools,
        "tool_time": sum(seconds for _, seconds in tools),
        "gaps": [round(calls[i + 1]["started"] - ends[i], 2) for i in range(len(calls) - 1)],
        "input_tokens": [call.get("input_tokens") for call in calls],
        "chars": (calls[0]["system_chars"], calls[0]["message_chars"], calls[0]["tool_chars"]) if calls else None,
    }


def _fmt(value: float | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def report(run_dir: Path) -> str:
    rows = [json.loads(line) for line in open(run_dir / "results.jsonl")]
    calls = _calls_by_key(run_dir)
    out = [f"# {run_dir.name}", "",
           "| Dataset | Model | Question | Error | First event | First model call | First progress | Total | "
           "Calls | Model | Tools | Non-model | Gaps between calls | After last call |",
           "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    stats: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        mine = [call for call in calls.get(row["cache_key"], [])
                if row["started"] <= call["started"] <= row["started"] + row["seconds"]]
        result = analyze(row, mine)
        stats.setdefault((row["dataset"], row["model"]), []).append(result)
        out.append(f"| {row['dataset']} | {row['model']} | {row['question'][:40]} | {(row['error'] or '')[:40]} | "
                   f"{_fmt(result['first_event'])} | {_fmt(result['first_call'])} | "
                   f"{_fmt(result['first_progress'])} | {result['total']:.1f} | {result['calls']} | "
                   f"{result['llm']:.1f} | {result['tool_time']:.1f} | {max(result['total'] - result['llm'], 0):.1f} | "
                   f"{', '.join(map(str, result['gaps']))} | {_fmt(result['after_last_call'])} |")
    out += ["", "## Medians (seconds)", "",
            "| Dataset | Model | Runs | First model call | First progress | Total | Non-model | Tools (median, count) | "
            "First call chars: system / messages / tools |", "|---|---|---|---|---|---|---|---|---|"]
    for (dataset, model), results in sorted(stats.items()):
        def med(key: str) -> float:
            values = [r[key] for r in results if r[key] is not None]
            return statistics.median(values) if values else float("nan")
        tools: dict[str, list[float]] = {}
        for result in results:
            for name, seconds in result["tools"]:
                tools.setdefault(name, []).append(seconds)
        tool_text = ", ".join(f"{name} {statistics.median(v):.1f} (×{len(v)})" for name, v in sorted(tools.items()))
        nonmodel = statistics.median([max(r["total"] - r["llm"], 0) for r in results])
        chars = next((r["chars"] for r in results if r["chars"]), None)
        out.append(f"| {dataset} | {model} | {len(results)} | {med('first_call'):.2f} | {med('first_progress'):.2f} | "
                   f"{med('total'):.1f} | {nonmodel:.1f} | {tool_text} | "
                   f"{' / '.join(f'{c:,}' for c in chars) if chars else '—'} |")
    return "\n".join(out)


# ── main ─────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fake", action="store_true", help="instant scripted model (server time only)")
    parser.add_argument("--script", nargs="+", default=["none"], choices=sorted(SCRIPTS))
    parser.add_argument("--models", nargs="+", default=["gpt-6.1-sol"])
    parser.add_argument("--datasets", nargs="+", default=None)
    parser.add_argument("--questions", nargs="+", default=None, help="default: the demo's story prompts")
    parser.add_argument("--per-dataset", type=int, default=1, help="story prompts per dataset")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--followups", nargs="*", default=[],
                        help="questions asked next in the same session (rows labeled <model>/turn<N>)")
    parser.add_argument("--parallel", type=int, default=1)
    parser.add_argument("--profile", action="store_true", help="cProfile each agent run")
    parser.add_argument("--name", default=None)
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()
    if args.report:
        print(report(args.report))
        return

    available = ensure_sessions()
    datasets = args.datasets or available
    questions = story_questions()
    run_dir = ROOT / "runs" / (args.name or time.strftime("%Y%m%d-%H%M%S"))
    run_dir.mkdir(parents=True, exist_ok=True)
    from data_formulator.model_registry import ModelRegistry

    # One server per (dataset, script/model group): the fake's script is fixed at server start.
    groups: list[tuple[str, str, dict[str, str], list[tuple[str, str]]]] = []
    for dataset in datasets:
        asked = args.questions or questions.get(dataset, ["What does this data show?"])[:args.per_dataset]
        if args.fake:
            for script in args.script:
                big = biggest_table(dataset)
                import pyarrow.parquet as pq
                key = pq.read_schema(SESSIONS / dataset / "workspace" / "data" / f"{big}.parquet").names[1]
                steps = json.loads(json.dumps(SCRIPTS[script]).replace("{big}", big).replace("{key}", key))
                groups.append((dataset, f"fake-{script}", {"DF_BENCH_FAKE": json.dumps(steps)},
                               [(q, ModelRegistry.make_id("azure", args.models[0])) for q in asked] * args.repeat))
        else:
            for model in args.models:
                groups.append((dataset, model, {}, [(q, ModelRegistry.make_id("azure", model)) for q in asked]
                               * args.repeat))

    results_path = run_dir / "results.jsonl"
    lock = threading.Lock()
    for dataset, label, env, jobs in groups:
        if args.profile:
            (run_dir / "profiles").mkdir(exist_ok=True)
            env = {**env, "DF_BENCH_PROFILE": str(run_dir / "profiles")}
        server = BenchServer(run_dir, env)
        server.start()
        pending = list(jobs)

        def worker() -> None:
            while True:
                with lock:
                    if not pending:
                        return
                    question, model_id = pending.pop(0)
                row = run_one(server, dataset, question, model_id)
                rows = [(label, row)]
                for turn, followup in enumerate(args.followups, start=2):
                    rows.append((f"{label}/turn{turn}", run_one(server, dataset, followup, model_id,
                                                                (row["workspace_id"], row["state"]))))
                for row_label, result in rows:
                    result["model"] = row_label
                    result.pop("state", None)
                    with lock, open(results_path, "a") as out:
                        out.write(json.dumps(result) + "\n")
                    print(f"{dataset:16s} {row_label:20s} {result['seconds']:6.1f}s {result['error'] or ''}", flush=True)

        try:
            threads = [threading.Thread(target=worker) for _ in range(args.parallel)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        finally:
            if args.profile:
                time.sleep(3)  # let the last run's profile finish writing
            server.stop()
    summary = report(run_dir)
    (run_dir / "summary.md").write_text(summary)
    print(summary)


if __name__ == "__main__":
    main()
