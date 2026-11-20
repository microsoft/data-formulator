"""Agent file-system eval: analysis, multi-turn, report and workflow tasks, run to completion.

    DF_EVAL_BACKEND=experiment_data/fs_eval/before/py-src uv run python tests/eval/agent_fs/run.py --name before
    uv run python tests/eval/agent_fs/run.py --name after
    uv run python tests/eval/agent_fs/run.py --tasks a1 m2 --name smoke
    uv run python tests/eval/agent_fs/run.py --report experiment_data/fs_eval/runs/before experiment_data/fs_eval/runs/after
    uv run python tests/eval/agent_fs/run.py --suite routing --name routing   # tool choice, one request per case

Sessions: the intent-eval templates (unemployment, stocks, earthquake), two UIS demo sessions (uis-opri: 8 tables,
~12M rows; uis-science), ``docs`` (a 15-page PDF and a 3-sheet Excel workbook, no tables) and ``empty`` with a
Kusto connector to the public help cluster's Samples database (remote data). Every task runs to completion on one
model (default gpt-6.1-sol, low reasoning). Pauses are answered as a user would: a proposed data load is approved
with its first option, a question gets "use your best judgment". Answers are graded against values computed from
the data; charts, reports and workflow proposals by what the run produced.

The routing suite (``--suite routing``) checks tool choice: each case is one request with the calls that count as a
right choice (reasonable alternatives accepted), the preferred call (reported, not required) and calls to avoid.
Pauses and forms count as the calls that made them (ask_user, run_terminal, propose_connection, …), and a form or a
terminal request ends the turn, as the user decides there. Read the answers too: the checks are deliberately loose.
The report counts the model turns until the first right call was executed (turns are model calls that produced
something; rate-limited attempts do not count) and lists what came before it. Calls before it are usually
groundwork, not wrong picks: loading the skill that unlocks a tool, finding a source before loading it, reading
a file for the content hash an edit needs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import statistics
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "intent_routing"))
import harness  # noqa: E402
import multiturn  # noqa: E402

REPO = harness.REPO
ROOT = REPO / "experiment_data" / "fs_eval"
FIXTURES = ROOT / "fixtures"
UIS_SESSIONS = REPO / "experiment_data" / "uis_bench" / "sessions"
UIS = {"uis-opri": "education-opri", "uis-science": "science"}
KUSTO = {"loader_type": "kusto", "display_name": "Kusto Samples",
         "params": {"kusto_cluster": "https://help.kusto.windows.net", "kusto_database": "Samples"}}


# ── tasks ────────────────────────────────────────────────────────────────

@dataclass
class Turn:
    prompt: str
    answer: list[str] = field(default_factory=list)   # regexes that must all appear in the answer (or report)
    needs: set[str] = field(default_factory=set)      # chart | report | workflow
    workflow: list[str] = field(default_factory=list)  # regexes the proposed workflow (YAML and target) must match
    # Tool routing: each regex must match some call ("<tool> <json args>"; pauses and forms count as calls,
    # e.g. ask_user, run_terminal, propose_connection); prefer is the best choice, reported but not required.
    calls: list[str] = field(default_factory=list)
    prefer: str = ""
    avoid: list[str] = field(default_factory=list)
    focus: dict | None = None  # what is on the canvas when the request is sent (else as the session left it)


@dataclass
class Task:
    id: str
    kind: str          # analysis | discovery | multi | report | workflow_author | workflow_run
    session: str
    turns: list[Turn] = field(default_factory=list)
    workflow: str = ""  # YAML for workflow_run
    saved_workflows: dict[str, str] = field(default_factory=dict)  # saved in the user's workflows before the task


WF_UNEMPLOYMENT = """version: 1
name: Recession Impact Briefing
overview: Compare each industry's unemployment rate before and during the 2008-2009 recession.
prompt: Use the loaded unemployment-across-industries table. Compare each industry's average rate in 2007
  with 2009, chart the change by industry, and write a short briefing naming the three hardest-hit industries.
deliverables:
- A chart of the 2007 to 2009 change in average unemployment rate by industry.
- A short briefing naming the three industries with the largest increases, with their values.
"""

WF_KUSTO = """version: 1
name: Storm Events by State
overview: Count storm events by US state from the StormEvents table in the Kusto Samples database.
prompt: Load storm event counts by state from the StormEvents table of the connected Kusto Samples
  database (aggregate in the query; do not load raw rows), chart the ten states with the most events,
  and state the top state and its count.
deliverables:
- A table of storm event counts by state.
- A bar chart of the ten states with the most storm events.
- One sentence naming the state with the most events and its count.
"""

TASKS: list[Task] = [
    # single-turn analysis with answers computed from the data
    Task("a1", "analysis", "unemployment", [Turn(
        "Which industry had the highest unemployment rate in January 2010, and what was the rate?",
        [r"construction", r"24\.7"])]),
    Task("a2", "analysis", "stocks", [Turn(
        "Over the period in the data, which stock gained the most, and by roughly what percentage?",
        [r"googl|alphabet|google", r"7[34](\.\d)?\s?%"])]),
    Task("a3", "analysis", "earthquake", [Turn(
        "What was the strongest earthquake in the data, and where was it?", [r"7\.7", r"panama"])]),
    Task("a4", "analysis", "uis-opri", [Turn(
        "How many primary-school-age children were out of school in Nigeria in the latest year with data?",
        [r"2023", r"9[.,]0[67]|9\.1 ?million|9,070"])]),
    Task("a5", "analysis", "uis-opri", [Turn(
        "How many adults in India could not read in the most recent year available?",
        [r"2023", r"190[.,]7|191 ?million|190,709"])]),
    Task("a6", "analysis", "uis-science", [Turn(
        "Which country spent the largest share of its GDP on research and development in 2022, and how much?",
        [r"israel", r"6\.[12]"])]),
    Task("a7", "analysis", "docs", [Turn(
        "According to the SDG 11.4.1 background PDF, where do the population estimates used by UIS come from?",
        [r"world population prospects", r"2024"])]),
    Task("a8", "analysis", "docs", [Turn(
        "In the video game sales workbook, which genre sold the most in Japan, and how much?",
        [r"role.playing", r"352"])]),
    Task("a9", "analysis", "empty", [Turn(
        "In the Kusto Samples database, which US state had the most storm events in the StormEvents table?",
        [r"texas", r"4,?701"])]),
    Task("a10", "analysis", "unemployment", [Turn(
        "Show how the Construction unemployment rate changed from 2000 to 2010.", needs={"chart"})]),
    # discovery in connected sources
    Task("d1", "discovery", "empty", [Turn("Do we have any data about storms?", [r"stormevents"])]),
    Task("d2", "discovery", "empty", [Turn(
        "Which columns in the Kusto StormEvents table record damage?", [r"damageproperty", r"damagecrops"])]),
    Task("d3", "discovery", "empty", [Turn("What data can I work with here?", [r"storm", r"gas|gapminder|sample"])]),
    Task("d4", "discovery", "empty", [Turn(
        "Is there a dataset on gas prices? Chart weekly regular gasoline prices over time.", needs={"chart"})]),
    # multi-turn
    Task("m1", "multi", "unemployment", [
        Turn("Chart the monthly unemployment rate for Construction and Manufacturing.", needs={"chart"}),
        Turn("When did Construction peak, and at what rate?", [r"2010", r"27\.1"]),
        Turn("Add Finance to the same comparison.", needs={"chart"})]),
    Task("m2", "multi", "uis-opri", [
        Turn("Where do out-of-school children of primary school age live? Show me on a map.", needs={"chart"}),
        Turn("Which five countries have the most?", [r"nigeria"]),
        Turn("Now show the same for girls only.", needs={"chart"})]),
    Task("m3", "multi", "docs", [
        Turn("What sheets does the video game workbook have, and what is in each?",
             [r"recent top games", r"by platform", r"japan by genre"]),
        Turn("Which platform has the highest global sales there?", [r"ps2", r"1,?255"]),
        Turn("Chart the top 5 platforms by global sales.", needs={"chart"})]),
    # reports
    Task("r1", "report", "unemployment", [Turn(
        "Write a short report on how the 2008-2009 recession affected unemployment across industries.",
        needs={"report"})]),
    Task("r2", "report", "uis-science", [Turn(
        "Write a short report on which countries invest the most in research and development as a share of GDP.",
        [r"israel"], needs={"report"})]),
    # workflow authoring
    Task("w1", "workflow_author", "unemployment", [Turn(
        "Turn this into a reusable workflow I can rerun each month: chart the latest unemployment rates by "
        "industry and summarize the biggest changes.", needs={"workflow"})]),
    Task("w2", "workflow_author", "empty", [Turn(
        "Create a weekly workflow that pulls storm event counts by state from the StormEvents table in the Kusto "
        "Samples database and reports the top 10 states.", needs={"workflow"})]),
    Task("w3", "workflow_author", "empty", [Turn(
        "Update my saved My Fuel Review workflow so it also charts the diesel-minus-regular price gap over time. "
        "Keep everything else as it is.", needs={"workflow"},
        workflow=[r'"target": \{"id": "fuel-review\.workflow\.yaml"', r"diesel.{0,20}(minus|-|gap|over).{0,20}regular",
                  r"48 distinct observed weeks", r"seasonal ind"])],
        saved_workflows={"fuel-review.workflow.yaml": "demo:gas-price-review.yaml:My Fuel Review"}),
    # workflow execution
    Task("x1", "workflow_run", "unemployment", workflow=WF_UNEMPLOYMENT),
    Task("x2", "workflow_run", "empty", workflow=WF_KUSTO),
]

# ── tool routing suite (--suite routing) ──────────────────────────────────
# One request each; calls lists what counts as a right choice (alternatives that are also reasonable are
# accepted), prefer the best one. Answers are reviewed by hand as well.
R = Task
ROUTING = [
    # reading and finding what the session has
    R("t01", "routing", "uis-opri", [Turn("What's the indicator code for the number of out-of-school children of "
      "primary school age?", [r"ofst\.1\.cp"], calls=[r"^(search|read_file|execute_python_script)"],
      prefer=r"^search ")]),
    R("t02", "routing", "docs", [Turn("What does page 10 of the heritage background PDF say about population data?",
      [r"population prospects"], calls=[r"^(read_file|search) .*sdg11"], prefer=r'^read_file .*"pages"')]),
    R("t03", "routing", "docs", [Turn("Which sheets are in the video game sales workbook?",
      [r"recent top games", r"by platform", r"japan by genre"], calls=[r"^(read_file|list_files)"],
      prefer=r"^(read_file|list_files) ", avoid=[r"^execute_python_script"])]),
    R("t04", "routing", "unemployment", [Turn("What did I write in my analysis notes?", [r"recession"],
      avoid=[r"^execute_python_script", r"^search "])]),
    R("t05", "routing", "unemployment", [Turn("In the bar chart of average unemployment-rate increase by industry, "
      "which industry rose the most?", [r"construction"], calls=[r"^(read_file|execute_python_script|search)"],
      prefer=r"^read_file .*session/(charts|tables)")]),
    R("t06", "routing", "earthquake", [Turn("What does the earthquake runbook say to do first?",
      calls=[r"^(read_file|search) .*runbook|^read_file "], prefer=r"^read_file .*runbook",
      avoid=[r"^execute_python_script"])]),
    R("t07", "routing", "unemployment", [Turn("Where in this session is a turning point mentioned?",
      [r"turning point"], calls=[r"^(search|read_file)"], prefer=r"^search ")]),
    R("t08", "routing", "stocks", [Turn("Show me the first 10 rows of stock-hist.",
      calls=[r"^(read_file|execute_python_script)"], prefer=r'^read_file .*"rows"')]),
    R("t09", "routing", "earthquake", [Turn("Which files do I have in this session?", [r"runbook"],
      avoid=[r"^execute_python_script"])]),
    # computing, charting, reporting
    R("t10", "routing", "unemployment", [Turn("What was the average unemployment rate in Construction in 2009?",
      [r"1\d\.\d"], calls=[r"^(execute_python_script|visualize)"], prefer=r"^execute_python_script")]),
    R("t11", "routing", "stocks", [Turn("Plot the daily closing price of AAPL.", needs={"chart"},
      calls=[r"^visualize"])]),
    R("t12", "routing", "unemployment", [Turn("Write a short report on how the recession affected Finance.",
      needs={"report"}, calls=[r"^write_report"])]),
    R("t13", "routing", "unemployment", [Turn("Build an interactive dashboard to explore unemployment by industry.",
      calls=[r"^(write_app|write_html_app)"])]),
    # changing the session
    R("t14", "routing", "unemployment", [Turn("Rename the title of the bar chart of average increase by industry to "
      "'Unemployment increase 2007-2009 by industry'.", calls=[r'^edit_file .*session/charts/'],
      avoid=[r"^visualize"])]),
    R("t15", "routing", "unemployment", [Turn("Add to my notes that I prefer seasonally adjusted rates.",
      calls=[r"^(create_file|edit_file) .*notes/"])]),
    R("t16", "routing", "earthquake", [Turn("Move the runbook into a docs folder.", calls=[r"^move_file .*runbook"])]),
    R("t17", "routing", "stocks", [Turn("Delete the candlestick chart.", calls=[r"^delete_items"])]),
    # connected sources
    R("t18", "routing", "empty", [Turn("Do we have any data about movies?", [r"movie"],
      calls=[r"^(search|list_files) .*|^search"], prefer=r"^search ", avoid=[r"^(load_data|propose_data_operation)"])]),
    R("t19", "routing", "empty", [Turn("What columns does the Gapminder sample dataset have?", [r"life", r"fertility"],
      calls=[r"^(search|read_file|list_files)"], avoid=[r"^(load_data|propose_data_operation)"])]),
    R("t20", "routing", "empty", [Turn("How many Tornado events are in the Kusto StormEvents table?", [r"1,?238"],
      calls=[r"^(probe_data|load_data|propose_data_operation)"], prefer=r"^probe_data")]),
    R("t21", "routing", "empty", [Turn("Load the Gapminder dataset.", calls=[r"^(load_data|propose_data_operation)"],
      avoid=[r"^ask_user"])]),
    R("t22", "routing", "grocery_ref", [Turn("Which columns does the Consumer Price Index reference have?",
      avoid=[r"^(load_data|propose_data_operation|execute_python_script)"])]),
    # workflows, schedules, setup
    R("t23", "routing", "empty", [Turn("Which workflows do I have saved?", [r"earthquake"],
      calls=[r"^list_files .*workflows"])]),
    R("t24", "routing", "empty", [Turn("What steps does my Daily Global Earthquake Review workflow run?",
      calls=[r"^read_file .*workflows/"])]),
    R("t25", "routing", "empty", [Turn("Is anything scheduled to run?", calls=[r"workflows"],
      prefer=r"^(read_file .*schedules\.json|list_files .*workflows)")]),
    R("t26", "routing", "empty", [Turn("Schedule the Fuel Price Trends workflow every Monday at 9am.",
      calls=[r"^propose_schedule"])]),
    R("t27", "routing", "empty", [Turn("Connect to my Postgres database.", calls=[r"^propose_connection"])]),
    R("t28", "routing", "empty", [Turn("Find my earlier session about earthquakes.", calls=[r"^list_sessions"])]),
    R("t29", "routing", "empty", [Turn("Pull today's earthquakes from the USGS feed and map them.",
      calls=[r"^run_terminal"])]),
    # "it" is the chart on the canvas: improving it in place, or asking how, are both reasonable.
    R("t30", "routing", "unemployment", [Turn("Make it better.",
      calls=[r"^(edit_file .*session/charts/|visualize|ask_user)"], avoid=[r"^(write_report|write_app)"])]),
    # harder choices
    # Nothing to refer to: ask first (the harness then answers "no preference", so later calls are not graded).
    R("t31", "routing", "empty", [Turn("Make it better.", calls=[r"^ask_user"])]),
    R("t32", "routing", "docs", [Turn("Where does the heritage background PDF mention Table 2?", [r"table 2"],
      calls=[r"^(search|read_file)"], prefer=r"^search ")]),
    R("t33", "routing", "unemployment", [Turn("What code produced the industry segmented trend estimates table?",
      calls=[r"^(read_file|search) "], avoid=[r"^execute_python_script"])]),
    R("t34", "routing", "earthquake", [Turn("Change the original earthquake explorer app so it shows only magnitude 4 "
      "and above by default.", calls=[r"^(read_file|search) .*explorer|^write_app|^edit_file .*explorer"])]),
    R("t35", "routing", "empty", [Turn("Which Kusto tables have a column about property damage?",
      [r"stormevents"], calls=[r"^(search|list_files|read_file) "], prefer=r"^search .*(damage|property)")]),
    R("t36", "routing", "empty", [Turn("Do any of my workflows use earthquake data from USGS?", [r"daily global earthquake"],
      calls=[r"workflows"])]),
    # A connected-source reference on the canvas: charting it means probing or loading it first.
    R("t37", "routing", "grocery_ref", [Turn("Chart how this index changed over time.",
      calls=[r"^(probe_data|load_data|propose_data_operation|visualize)"],
      focus={"type": "external-table", "referenceId": "external:sample_datasets:Consumer%20Price%20Index"})]),
]
SUITES = {"fs": TASKS, "routing": ROUTING}
TASKS_BY_ID = {task.id: task for task in TASKS + ROUTING}


# ── server and sessions ──────────────────────────────────────────────────

class FsServer(harness.Server):
    def _setup_user(self) -> None:
        super()._setup_user()
        try:
            response = requests.post(f"{self.base}/api/connectors", json=KUSTO, timeout=120)
            response.raise_for_status()
            self.kusto_id = response.json().get("data", response.json()).get("id")
            requests.post(f"{self.base}/api/connectors/sync-catalog-metadata",
                          json={"connector_id": self.kusto_id}, timeout=300)
        except requests.RequestException as exc:
            print(f"Kusto connector not available: {exc}", flush=True)

    def prepare(self, session: str, workspace_id: str) -> dict[str, Any]:
        assert self.user_home is not None
        target = self.user_home / "workspaces" / workspace_id
        if session in UIS:
            source = UIS_SESSIONS / UIS[session]
            shutil.copytree(source / "workspace", target, ignore=shutil.ignore_patterns("*.lock"))
            meta = target / "workspace_meta.json"
            meta.write_text(json.dumps({**json.loads(meta.read_text()), "id": workspace_id}))
            state = json.loads((source / "state.json").read_text())
        elif session == "docs":
            requests.post(f"{self.base}/api/sessions/create", json={"id": workspace_id}, timeout=30).raise_for_status()
            from data_formulator.datalake.workspace import Workspace
            workspace = Workspace("eval", workspace_path=target)
            for path in sorted((FIXTURES / "files").iterdir()):
                media = {".pdf": "application/pdf",
                         ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}[path.suffix]
                workspace.save_workspace_file(path.read_bytes(), path.name, media)
            state = {}
        else:
            return self.prepare_workspace(session, workspace_id, None)
        active = state.get("activeWorkspace") or {}
        state["activeWorkspace"] = {**active, "id": workspace_id, "displayName": active.get("displayName") or session}
        requests.post(f"{self.base}/api/sessions/save", json={"id": workspace_id, "state": state},
                      timeout=60).raise_for_status()
        return state


def _model(model: str) -> dict[str, Any]:
    from data_formulator.model_registry import ModelRegistry
    return {"id": ModelRegistry.make_id("azure", model), "is_global": True, "reasoning_effort": "low"}


def _headers(server: harness.Server, workspace_id: str) -> dict[str, str]:
    return {"X-Workspace-Id": workspace_id, "Origin": server.base, "Sec-Fetch-Site": "same-origin"}


# ── running ──────────────────────────────────────────────────────────────

def run_turn(server: FsServer, workspace_id: str, state: dict, turn: Turn, model: str,
             raw_dir: Path, tag: str) -> dict[str, Any]:
    """One user request, run to completion; pauses are answered and the run resumed (at most 4 times)."""
    if turn.focus is not None:
        state["focusedId"] = turn.focus
    body = harness.request_body(multiturn._session_state(state), turn.prompt, "")
    body["model"] = _model(model)
    events: list[dict] = []
    started = time.time()
    final_text, error = "", None
    for attempt in range(5):
        raw = raw_dir / f"{tag}-{attempt}.jsonl"
        for retry in range(4):
            trace = harness.run_case(server, workspace_id, body, tail=1e9, budget=900, raw_path=raw)
            if not any(step.kind == "error" and "Rate limit" in str(step.detail) for step in trace.steps):
                break
            time.sleep(30 * (retry + 1))
        segment = multiturn._events(raw)
        events += segment
        final_text += ("\n" if final_text else "") + (trace.final_text or "")
        error = trace.error or next((json.dumps(e)[:300] for e in segment if e.get("type") == "error"), None)
        pause = next((e for e in reversed(segment) if e.get("type") == "interact"), None)
        if pause is None:
            break
        resume = {**body, "trajectory": pause.get("trajectory"),
                  "completed_step_count": pause.get("completed_step_count", 0)}
        resume.pop("interaction_response", None)
        operation = pause.get("data_operation") or {}
        if operation.get("id") and operation.get("plans"):
            resume["interaction_response"] = {"operation_id": operation["id"], "plan_id": operation["plans"][0]["id"]}
            resume["user_question"] = "Load it."
        elif pause.get("terminal_request") or pause.get("form"):
            break  # the user decides in the terminal prompt or the form
        else:
            resume["user_question"] = "No preference. Use your best judgment and continue."
        body = resume
    return {"events": events, "final_text": final_text, "error": error, "started": started,
            "seconds": round(time.time() - started, 1)}


def run_workflow(server: FsServer, workspace_id: str, task: Task, model: str, raw_dir: Path) -> dict[str, Any]:
    """Run a workflow definition to completion; data loads it proposes are approved."""
    started = time.time()
    payload: dict[str, Any] = {"content": task.workflow, "model": _model(model)}
    run, events, error = None, [], None
    for attempt in range(6):
        with open(raw_dir / f"{task.id}-run{attempt}.jsonl", "w") as raw:
            try:
                with requests.post(f"{server.base}/api/workflows/run", json=payload, stream=True,
                                   headers=_headers(server, workspace_id), timeout=(15, 1200)) as response:
                    if not response.ok:
                        error = f"HTTP {response.status_code}: {response.text[:300]}"
                        break
                    for line in response.iter_lines():
                        if not line:
                            continue
                        raw.write(line.decode() + "\n")
                        event = json.loads(line)
                        events.append({key: event.get(key) for key in ("type", "tool", "action")})
                        if event.get("type") == "workflow_state":
                            run = event.get("run")
                        elif event.get("type") == "error":
                            error = json.dumps(event)[:300]
            except requests.RequestException as exc:
                error = f"{type(exc).__name__}: {exc}"
        if run is None or run.get("status") != "paused":
            break
        interaction = run.get("interaction") or {}
        operation = interaction.get("data_operation") or {}
        payload = {"run_id": run["id"], "model": _model(model)}
        if operation.get("id") and operation.get("plans"):
            payload["interaction_response"] = {"operation_id": operation["id"], "plan_id": operation["plans"][0]["id"]}
        elif interaction:
            payload["reply"] = "No preference. Use your best judgment and continue."
        else:
            break
    return {"run": run, "events": events, "error": error, "started": started, "seconds": round(time.time() - started, 1)}


_FORM_TOOLS = {"connector": "propose_connection", "schedule": "propose_schedule", "sessions": "propose_session_changes",
               "workflow": "propose_workflow"}


def calls_made(events: list[dict]) -> list[str]:
    """Every call as "<tool> <json args>", with pauses and forms as the calls that made them."""
    calls = []
    for event in events:
        kind = event.get("type")
        if kind == "tool_start" and event.get("tool"):
            calls.append(f"{event['tool']} {json.dumps(event.get('args') or {}, ensure_ascii=False)}")
        elif kind == "action" and event.get("action"):
            calls.append(str(event["action"]))
        elif kind in ("interact", "completion"):
            content = event.get("content") if isinstance(event.get("content"), dict) else {}
            form = event.get("form") or content.get("form")
            if isinstance(form, dict) and form.get("kind") in _FORM_TOOLS:
                calls.append(_FORM_TOOLS[form["kind"]])
            if event.get("questions"):
                calls.append("ask_user")
            if event.get("terminal_request"):
                calls.append(f"run_terminal {json.dumps(event['terminal_request'].get('argv'))}")
            if event.get("data_operation"):
                calls.append("propose_data_operation")
    return calls


def tools_used(events: list[dict]) -> list[str]:
    return [str(e.get("tool") or e.get("action")) for e in events
            if e.get("type") in ("tool_start", "action") and (e.get("tool") or e.get("action"))]


def grade_turn(turn: Turn, result: dict[str, Any]) -> tuple[bool, str]:
    events, text = result["events"], result["final_text"].lower()
    if result["error"] and not text:
        return False, f"error: {result['error'][:120]}"
    made = set()
    if any(e.get("type") == "result" for e in events):
        made.add("chart")
    if any(e.get("type") == "action" and e.get("action") == "write_report" for e in events):
        made.add("report")
    proposed = ""
    for event in events:
        content = event.get("content")
        form = content.get("form") if isinstance(content, dict) else None
        if event.get("type") == "completion" and isinstance(form, dict) and form.get("kind") == "workflow":
            try:
                from data_formulator.workflows.instances import parse_definition
                parse_definition((form.get("workflow") or {}).get("content", ""))
                made.add("workflow")
                proposed = (form["workflow"].get("content", "") + "\n"
                            + json.dumps({"target": form["workflow"].get("target")}))
            except ValueError as exc:
                return False, f"invalid workflow: {exc}"
    missing = turn.needs - made
    if missing:
        return False, f"missing {', '.join(sorted(missing))}"
    report_text = " ".join(str(e.get("content") or e.get("delta") or "") for e in events
                           if e.get("type") == "text_delta" and e.get("channel") == "report").lower()
    unmatched = [pattern for pattern in turn.answer if not re.search(pattern, text + " " + report_text)]
    if unmatched:
        return False, f"answer lacks {unmatched}"
    calls = calls_made(events)
    missing = [pattern for pattern in turn.calls if not any(re.search(pattern, call) for call in calls)]
    if missing:
        return False, f"no call matching {missing}"
    avoided = [call[:80] for call in calls if any(re.search(pattern, call) for pattern in turn.avoid)]
    if avoided:
        return False, f"called {avoided}"
    unmatched = [pattern for pattern in turn.workflow
                 if not re.search(pattern, " ".join(proposed.split()), re.IGNORECASE)]
    if unmatched:
        return False, f"workflow lacks {unmatched}"
    return True, ""


def run_task(server: FsServer, task: Task, model: str, run_dir: Path) -> list[dict]:
    workspace_id = f"fs-{task.id}-{uuid.uuid4().hex[:6]}"
    state = server.prepare(task.session, workspace_id)
    for name, spec in task.saved_workflows.items():
        # "demo:<built-in>:<new name>" copies a built-in example under a new name.
        _, demo, title = spec.split(":", 2)
        content = (Path(harness.REPO) / "py-src/data_formulator/workflows" / demo).read_text()
        content = re.sub(r"^name: .*$", f"name: {title}", content, count=1, flags=re.MULTILINE)
        (server.user_home / "workflows").mkdir(parents=True, exist_ok=True)
        (server.user_home / "workflows" / name).write_text(content)
    raw_dir = run_dir / "traces"
    rows = []
    if task.kind == "workflow_run":
        result = run_workflow(server, workspace_id, task, model, raw_dir)
        run = result["run"] or {}
        outputs = run.get("outputs") or []
        ok = run.get("status") == "completed" and any(o.get("type") == "result" for o in outputs)
        why = "" if ok else f"status {run.get('status')}, {len(outputs)} outputs, {result['error'] or run.get('message', '')}"
        rows.append({"task": task.id, "kind": task.kind, "session": task.session, "turn": 0,
                     "prompt": (run.get("instance") or {}).get("name", ""), "workspace_id": workspace_id, "ok": ok,
                     "why": why[:200], "seconds": result["seconds"], "started": result["started"],
                     "tools": tools_used(result["events"]), "final_text": "", "error": result["error"]})
        print(f"{task.id} {'PASS' if ok else 'FAIL'} {result['seconds']:6.1f}s {why[:120]}", flush=True)
        return rows
    for index, turn in enumerate(task.turns):
        result = run_turn(server, workspace_id, state, turn, model, raw_dir, f"{task.id}-t{index}")
        ok, why = grade_turn(turn, result)
        multiturn.apply_turn(state, result["events"], turn.prompt, f"{workspace_id}-t{index}", index, server,
                             workspace_id)
        requests.post(f"{server.base}/api/sessions/save",
                      json={"id": workspace_id, "state": multiturn._session_state(state)}, timeout=60)
        rows.append({"task": task.id, "kind": task.kind, "session": task.session, "turn": index, "prompt": turn.prompt,
                     "workspace_id": workspace_id, "ok": ok, "why": why, "seconds": result["seconds"],
                     "started": result["started"], "tools": tools_used(result["events"]),
                     "call_log": [call[:300] for call in calls_made(result["events"])],
                     "preferred": (any(re.search(turn.prefer, call) for call in calls_made(result["events"]))
                                   if turn.prefer else None),
                     "final_text": result["final_text"][:3000], "error": result["error"]})
        print(f"{task.id}#{index} {'PASS' if ok else 'FAIL'} {result['seconds']:6.1f}s {why}", flush=True)
    return rows


def run(args: argparse.Namespace) -> Path:
    harness.snapshot_templates()
    run_dir = ROOT / "runs" / args.name
    (run_dir / "traces").mkdir(parents=True, exist_ok=True)
    server = FsServer(run_dir)
    server.start()
    tasks = [TASKS_BY_ID[t] for t in args.tasks] if args.tasks else SUITES[args.suite]
    pending = [(task, rep) for rep in range(args.repeat) for task in tasks]
    lock = threading.Lock()
    results_path = run_dir / "results.jsonl"

    def worker() -> None:
        while True:
            with lock:
                if not pending:
                    return
                task, rep = pending.pop(0)
            try:
                rows = run_task(server, task, args.model, run_dir)
            except Exception as exc:  # keep the run going; record the failure
                rows = [{"task": task.id, "kind": task.kind, "session": task.session, "turn": 0, "ok": False,
                         "why": f"harness: {type(exc).__name__}: {exc}"[:300], "seconds": 0, "started": time.time(),
                         "tools": [], "final_text": "", "error": str(exc), "workspace_id": ""}]
                print(f"{task.id} HARNESS ERROR {exc}", flush=True)
            with lock, open(results_path, "a") as out:
                for row in rows:
                    out.write(json.dumps({**row, "repeat": rep, "model": args.model}) + "\n")

    try:
        threads = [threading.Thread(target=worker) for _ in range(args.parallel)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        server.stop()
    return run_dir


# ── report ───────────────────────────────────────────────────────────────

def _key(workspace_id: str) -> str:
    return hashlib.sha256(f"local:{os.environ.get('USER', '')}:{workspace_id}".encode()).hexdigest()[:32]


_RETRY = re.compile(r"Retrying in (\d+) second")


def rate_limit_wait(run_dir: Path, row: dict) -> int:
    """Seconds of rate-limit backoff the agent announced during one turn (all its resumes)."""
    pattern = f"{row['task']}-run*.jsonl" if row["kind"] == "workflow_run" else f"{row['task']}-t{row['turn']}-*.jsonl"
    total = 0
    for trace in (run_dir / "traces").glob(pattern):
        for line in open(trace):
            if "LLM_RATE_LIMIT_RETRY" in line:
                found = _RETRY.search(json.loads(line).get("warning", {}).get("message", ""))
                total += int(found.group(1)) if found else 0
    return total


_SAME_CALL = {"load_data": "propose_data_operation"}


def call_turns(model_calls: list[dict], call_log: list[str]) -> list[tuple[int, str]]:
    """(model turn, call) for each executed call. Turns count model calls that produced something (rate-limited
    attempts do not count); a call the model asked for but that was not executed (a gated action) is skipped."""
    turns = [call for call in model_calls if call.get("produced") or call.get("text_chars")]
    out, index = [], 0
    for turn, call in enumerate(turns, start=1):
        for name in call.get("produced") or []:
            if index < len(call_log):
                logged = call_log[index].split(" ", 1)[0]
                if _SAME_CALL.get(logged, logged) == name:
                    out.append((turn, call_log[index]))
                    index += 1
    out += [(len(turns), call) for call in call_log[index:]]   # unaligned leftovers: the last turn
    return out


def first_turn(turned: list[tuple[int, str]], patterns: list[str]) -> int | None:
    """The model turn by which every pattern has matched an executed call, or None."""
    found = []
    for pattern in patterns:
        turn = next((turn for turn, call in turned if re.search(pattern, call)), None)
        if turn is None:
            return None
        found.append(turn)
    return max(found)


def metrics(run_dir: Path) -> list[dict]:
    rows = [json.loads(line) for line in open(run_dir / "results.jsonl")]
    by_key: dict[str, list[dict]] = {}
    calls_path = run_dir / "home" / "llm_calls.jsonl"
    for line in open(calls_path) if calls_path.exists() else []:
        call = json.loads(line)
        by_key.setdefault(call["key"], []).append(call)
    for row in rows:
        mine = [c for c in by_key.get(_key(row["workspace_id"]), [])
                if row["started"] - 1 <= c["started"] <= row["started"] + row["seconds"] + 1]
        row["calls"] = len(mine)
        row["input_tokens"] = sum(c.get("input_tokens") or 0 for c in mine)
        row["output_tokens"] = sum(c.get("output_tokens") or 0 for c in mine)
        row["wait"] = rate_limit_wait(run_dir, row)
        task = TASKS_BY_ID.get(row["task"])
        if task is not None and row["kind"] == "routing" and row["turn"] < len(task.turns):
            turn = task.turns[row["turn"]]
            turned = call_turns(mine, row.get("call_log") or [])
            row["turns"] = max((t for t, _ in turned), default=0) or (1 if row.get("final_text") else 0)
            if turn.calls:
                row["right_turn"] = first_turn(turned, turn.calls)
                row["before_right"] = [call.split(" ", 1)[0] for t, call in turned
                                       if row["right_turn"] is not None and t < row["right_turn"]]
            if turn.prefer:
                row["prefer_turn"] = first_turn(turned, [turn.prefer])
    return rows


def report(run_dirs: list[Path]) -> str:
    runs = {run_dir.name: metrics(run_dir) for run_dir in run_dirs}
    names = list(runs)
    out = ["| Kind | " + " | ".join(f"{n}: pass" for n in names) + " | "
           + " | ".join(f"{n}: median s" for n in names) + " | "
           + " | ".join(f"{n}: net median s" for n in names) + " | " + " | ".join(f"{n}: calls/turn" for n in names)
           + " | " + " | ".join(f"{n}: input tok/turn" for n in names) + " |",
           "|---|" + "---|" * (5 * len(names))]
    kinds = ["analysis", "discovery", "multi", "report", "workflow_author", "workflow_run", "routing"]
    for kind in kinds + ["all"]:
        cells: list[list[str]] = [[], [], [], [], []]
        for name in names:
            rows = [r for r in runs[name] if kind == "all" or r["kind"] == kind]
            cells[0].append(f"{sum(r['ok'] for r in rows)}/{len(rows)}" if rows else "—")
            cells[1].append(f"{statistics.median(r['seconds'] for r in rows):.0f}" if rows else "—")
            cells[2].append(f"{statistics.median(r['seconds'] - r['wait'] for r in rows):.0f}" if rows else "—")
            cells[3].append(f"{statistics.mean(r['calls'] for r in rows):.1f}" if rows else "—")
            cells[4].append(f"{statistics.mean(r['input_tokens'] for r in rows):,.0f}" if rows else "—")
        out.append(f"| {kind} | " + " | ".join(sum(cells, [])) + " |")
    out += ["", "| Task#turn | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    keys = sorted({(r["task"], r["turn"]) for rows in runs.values() for r in rows},
                  key=lambda k: ([t.id for t in TASKS + ROUTING].index(k[0]) if k[0] in TASKS_BY_ID else 99, k[1]))
    for key in keys:
        cells = []
        for name in names:
            mine = [r for r in runs[name] if (r["task"], r["turn"]) == key]
            cells.append("; ".join(
                f"{'✓' if r['ok'] else '✗'} {r['seconds']:.0f}s" + (f" (wait {r['wait']}s)" if r["wait"] else "")
                + f" {r['calls']}c "
                f"[{', '.join(r['tools'])[:100]}]" + ("" if r["ok"] else f" — {r['why'][:80]}") for r in mine) or "—")
        out.append(f"| {key[0]}#{key[1]} | " + " | ".join(cells) + " |")
    for name in names:
        routed = [r for r in runs[name] if "right_turn" in r]
        if routed:
            at = [r["right_turn"] for r in routed if r["right_turn"] is not None]
            setup = [r["right_turn"] - sum(1 for c in r["before_right"] if c == "load_skill") for r in routed
                     if r["right_turn"] is not None]
            out += ["", f"Model turns until a right call ({name}, {len(routed)} cases with expected calls): "
                        f"turn 1: {at.count(1)}, turn 2: {at.count(2)}, turn 3+: {sum(t >= 3 for t in at)}, "
                        f"never: {len(routed) - len(at)}; mean {statistics.mean(at):.2f}"
                        + (f"; not counting load_skill turns: mean {statistics.mean(setup):.2f}, "
                           f"turn 1: {setup.count(1)}" if setup else "")]
            late = [r for r in routed if (r["right_turn"] or 99) > 1]
            for r in sorted(late, key=lambda r: r["task"]):
                out.append(f"- {r['task']}: turn {r['right_turn']} after {', '.join(r['before_right']) or '—'}")
            preferred = [r for r in runs[name] if "prefer_turn" in r]
            if preferred:
                hits = [r["prefer_turn"] for r in preferred if r["prefer_turn"] is not None]
                out.append(f"Preferred call: used in {len(hits)}/{len(preferred)}, at turn 1 in {hits.count(1)}")
            direct = [r for r in runs[name] if r.get("kind") == "routing" and "right_turn" not in r]
            if direct:
                out.append("Answered without a tool expected: " + ", ".join(
                    f"{r['task']} ({r['turns']} turn{'s' if r['turns'] != 1 else ''})" for r in direct))
    for name in names:
        rated = [r for r in runs[name] if r.get("preferred") is not None]
        if rated:
            out.append(f"Preferred tool used ({name}): {sum(bool(r['preferred']) for r in rated)}/{len(rated)}")
    out += ["", "Net median s subtracts the rate-limit backoff the agent announced. Rate-limit wait per run: "
            + ", ".join(f"{name} {sum(r['wait'] for r in runs[name])} s" for name in names), "", "Tool calls per run:"]
    for name in names:
        counts: dict[str, int] = {}
        for row in runs[name]:
            for tool in row["tools"]:
                counts[tool] = counts.get(tool, 0) + 1
        out.append(f"- {name}: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument("--tasks", nargs="*", default=None)
    parser.add_argument("--suite", choices=sorted(SUITES), default="fs")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--parallel", type=int, default=2)
    parser.add_argument("--report", nargs="*", type=Path, default=None)
    args = parser.parse_args()
    if args.report:
        print(report(args.report))
        return
    run_dir = run(args)
    summary = report([run_dir])
    (run_dir / "summary.md").write_text(summary)
    print(summary)


if __name__ == "__main__":
    main()
