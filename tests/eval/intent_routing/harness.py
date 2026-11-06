"""Live harness for intent-routing evals (see GUIDELINES.md).

Runs a real Data Formulator server against a private home, prepares one fresh
workspace per (case, model, repeat) from a template session, sends the request
the browser would send to ``/api/agent/analyst-streaming``, and records the
streamed events until the agent commits to a decisive move.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

REPO = Path(__file__).resolve().parents[3]
EVAL_ROOT = REPO / "experiment_data" / "intent_eval"
TEMPLATES = EVAL_ROOT / "templates"
USER_WORKSPACES = Path.home() / ".data_formulator" / "users" / "localchenwang" / "workspaces"
USER_WORKFLOWS = USER_WORKSPACES.parent / "workflows"
USER_DATASETS = Path.home() / "datasets"

# Template sessions (public data) snapshotted from a real Data Formulator home.
SESSION_SOURCES = {
    "unemployment": "session_20261006_175625_4e14",
    "stocks": "session_20261007_131722_473a",
    "grocery_ref": "session_20260929_113902_9054",
    "earthquake": "session_20261011_182240_8402",
}
WORKFLOW_SOURCES = ["daily-global-earthquake-review.workflow.yaml"]
TEMPLATE_NOTES = {
    "unemployment": {
        "notes/analysis.md": "# Analysis notes\n\n- Rates are percentages of the industry labor force, monthly, 2000-2010.\n"
                             "- The user cares most about the 2008-2009 recession.\n",
    },
}

ACTIONS = {
    "visualize", "write_report", "write_app", "write_html_app", "propose_data_operation", "load_data",
    "propose_connection", "update_connector_form", "propose_workflow", "propose_schedule",
    "propose_session_changes", "ask_user", "long_response",
}
MUTATING_TOOLS = {
    "create_data", "update_data", "create_file", "edit_file", "move_file", "delete_items", "run_terminal",
}


MIGRATE_SCRIPT = """
import { readFileSync, writeFileSync } from 'fs';
import { migrateState } from '%s';
for (const path of process.argv.slice(2)) {
  writeFileSync(path, JSON.stringify(migrateState(JSON.parse(readFileSync(path, 'utf8')))));
}
"""


def migrate_states(paths: list[Path]) -> None:
    """Upgrade saved session states with the application's own migrations, as the browser does on load."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        entry, bundle = Path(tmp) / "migrate.ts", Path(tmp) / "migrate.cjs"
        entry.write_text(MIGRATE_SCRIPT % (REPO / "src" / "app" / "stateMigrations").as_posix())
        subprocess.run([str(REPO / "node_modules" / ".bin" / "esbuild"), str(entry), "--bundle", "--platform=node",
                        "--format=cjs", "--log-level=warning", f"--outfile={bundle}"], check=True)
        subprocess.run(["node", str(bundle), *map(str, paths)], check=True)


def snapshot_templates(force: bool = False) -> None:
    """Copy the template sessions (migrated to the current state version), workflows, and datasets folder."""
    if TEMPLATES.exists() and not force:
        if not (TEMPLATES / ".migrated").exists():
            migrate_states(list((TEMPLATES / "workspaces").glob("*/session_state.json")))
            (TEMPLATES / ".migrated").touch()
        return
    shutil.rmtree(TEMPLATES, ignore_errors=True)
    (TEMPLATES / "workspaces").mkdir(parents=True)
    for name, source in SESSION_SOURCES.items():
        shutil.copytree(USER_WORKSPACES / source, TEMPLATES / "workspaces" / name,
                        ignore=shutil.ignore_patterns("*.lock"))
    (TEMPLATES / "workflows").mkdir()
    for name in WORKFLOW_SOURCES:
        shutil.copy2(USER_WORKFLOWS / name, TEMPLATES / "workflows" / name)
    shutil.copytree(USER_DATASETS, TEMPLATES / "datasets",
                    ignore=shutil.ignore_patterns("*.numbers", "*.png", "*.xlsx"))
    migrate_states(list((TEMPLATES / "workspaces").glob("*/session_state.json")))
    (TEMPLATES / ".migrated").touch()


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


LAUNCHER = """
import sys, os, json, threading, webbrowser
webbrowser.open = lambda *a, **k: None
import data_formulator.workflows.scheduler as scheduler
scheduler.start_scheduler = lambda app: None
# Diagnostics: record each Responses API output's items (type, phase, text start).
from litellm.completion_extras.litellm_responses_transformation import transformation as _rt
_parse, _lock = _rt.OpenAiResponsesToChatCompletionStreamIterator.chunk_parser, threading.Lock()
_log = os.path.join(os.environ["DATA_FORMULATOR_HOME"], "responses.jsonl")
def _chunk_parser(self, chunk):
    try:
        if isinstance(chunk, dict) and chunk.get("type") == "response.completed":
            items = []
            for item in (chunk.get("response") or {}).get("output") or []:
                text = "".join(part.get("text", "") for part in item.get("content") or [] if isinstance(part, dict))
                items.append({"type": item.get("type"), "phase": item.get("phase"), "name": item.get("name"),
                              "text": text[:300]})
            with _lock, open(_log, "a") as out:
                out.write(json.dumps({"items": items}) + "\\n")
    except Exception:
        pass
    return _parse(self, chunk)
_rt.OpenAiResponsesToChatCompletionStreamIterator.chunk_parser = _chunk_parser
# Diagnostics: every model call's request size, token usage, and timing (keyed by the run's prompt cache key).
import time as _time
from data_formulator.agents import client_utils as _cu
_calls_log = os.path.join(os.environ["DATA_FORMULATOR_HOME"], "llm_calls.jsonl")
_get = _cu.Client.get_completion_with_tools
def _timed(self, messages, tools, stream=False, **kwargs):
    started = _time.time()
    record = {"key": self.prompt_cache_key, "model": self.model, "started": started,
              "messages": len(messages), "system_chars": len(str(messages[0].get("content") or "")) if messages else 0,
              "message_chars": len(json.dumps(messages[1:], default=str)), "tools": len(tools or []),
              "tool_chars": len(json.dumps(tools or [], default=str))}
    # Experiments (env): one prompt cache key for every session; parallel tool calls.
    original_key = self.prompt_cache_key
    if os.environ.get("DF_EVAL_SHARED_CACHE_KEY"):
        self.prompt_cache_key = os.environ["DF_EVAL_SHARED_CACHE_KEY"]
    if os.environ.get("DF_EVAL_PARALLEL_TOOLS") and "parallel_tool_calls" in kwargs:
        kwargs["parallel_tool_calls"] = True
    try:
        source = _get(self, messages, tools, stream=stream, **kwargs)
    finally:
        self.prompt_cache_key = original_key
    if not stream:
        return source
    record["produced"], record["text_chars"] = [], 0
    def chunks():
        first = None
        try:
            for chunk in source:
                if first is None:
                    first = _time.time()
                delta = chunk.choices[0].delta if getattr(chunk, "choices", None) else None
                if delta is not None and record.get("first_output") is None and (
                        getattr(delta, "content", None) or getattr(delta, "tool_calls", None)):
                    record["first_output"] = round(_time.time() - started, 2)
                if delta is not None:
                    record["text_chars"] += len(getattr(delta, "content", None) or "")
                    for call in getattr(delta, "tool_calls", None) or []:
                        name = getattr(getattr(call, "function", None), "name", None)
                        if name:
                            record["produced"].append(name)
                usage = getattr(chunk, "usage", None)
                if usage:
                    details = getattr(usage, "prompt_tokens_details", None)
                    completion = getattr(usage, "completion_tokens_details", None)
                    record.update(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                                  cached_tokens=getattr(details, "cached_tokens", None) if details else None,
                                  reasoning_tokens=getattr(completion, "reasoning_tokens", None) if completion else None)
                yield chunk
        finally:
            record.update(first_chunk=round((first or _time.time()) - started, 2), total=round(_time.time() - started, 2))
            with _lock, open(_calls_log, "a") as out:
                out.write(json.dumps(record) + "\\n")
    return chunks()
_cu.Client.get_completion_with_tools = _timed
from data_formulator import run_app
sys.argv = ["data_formulator", "--port", sys.argv[1]]
run_app()
"""


class Server:
    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.home = run_dir / "home"
        self.port = _free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.proc: subprocess.Popen | None = None
        self.user_home: Path | None = None

    def start(self) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "DATA_FORMULATOR_HOME": str(self.home), "PYTHONUNBUFFERED": "1",
               "DF_AGENT_LOG": os.environ.get("DF_AGENT_LOG", "verbose")}
        # Run another backend (e.g. a snapshot of py-src) to compare against the working tree under the same load.
        if os.environ.get("DF_EVAL_BACKEND"):
            env["PYTHONPATH"] = os.environ["DF_EVAL_BACKEND"]
        log = open(self.run_dir / "server.log", "w")
        self.proc = subprocess.Popen([sys.executable, "-c", LAUNCHER, str(self.port)], cwd=REPO, env=env,
                                     stdout=log, stderr=subprocess.STDOUT)
        deadline = time.time() + 120
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"server exited; see {self.run_dir / 'server.log'}")
            try:
                if requests.get(f"{self.base}/api/app-config", timeout=2).ok:
                    break
            except requests.RequestException:
                time.sleep(1)
        else:
            raise RuntimeError("server did not start")
        self._setup_user()

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def _setup_user(self) -> None:
        probe = f"probe-{uuid.uuid4().hex[:6]}"
        requests.post(f"{self.base}/api/sessions/create", json={"id": probe}, timeout=30).raise_for_status()
        matches = list(self.home.glob(f"users/*/workspaces/{probe}"))
        if not matches:
            raise RuntimeError("could not locate the user home")
        self.user_home = matches[0].parent.parent
        shutil.rmtree(matches[0], ignore_errors=True)
        workflows = self.user_home / "workflows"
        workflows.mkdir(exist_ok=True)
        for item in (TEMPLATES / "workflows").iterdir():
            shutil.copy2(item, workflows / item.name)
        response = requests.post(f"{self.base}/api/connectors", json={
            "loader_type": "local_folder", "display_name": "datasets",
            "params": {"root_dir": str(TEMPLATES / "datasets"), "recursive": "true"},
        }, timeout=60)
        response.raise_for_status()
        self.connector_id = response.json().get("data", response.json()).get("id")
        for source in (self.connector_id, "sample_datasets"):
            try:
                requests.post(f"{self.base}/api/connectors/sync-catalog-metadata",
                              json={"connector_id": source}, timeout=120)
            except requests.RequestException:
                pass

    # ── per-run workspaces ──────────────────────────────────────────────

    def prepare_workspace(self, session: str, workspace_id: str, focus: dict | None) -> dict[str, Any]:
        """Create the run's workspace and return the session state the browser would hold."""
        assert self.user_home is not None
        target = self.user_home / "workspaces" / workspace_id
        if session == "empty":
            requests.post(f"{self.base}/api/sessions/create", json={"id": workspace_id}, timeout=30).raise_for_status()
            state: dict[str, Any] = {"activeWorkspace": {"id": workspace_id, "displayName": "New session"}}
        else:
            shutil.copytree(TEMPLATES / "workspaces" / session, target)
            state = json.loads((target / "session_state.json").read_text())
            state["activeWorkspace"] = {**(state.get("activeWorkspace") or {}), "id": workspace_id}
            meta = target / "workspace_meta.json"
            if meta.exists():
                data = json.loads(meta.read_text())
                data["id"] = workspace_id
                meta.write_text(json.dumps(data))
        if focus is not None:
            state["focusedId"] = focus
        requests.post(f"{self.base}/api/sessions/save", json={"id": workspace_id, "state": state},
                      timeout=30).raise_for_status()
        for name, text in TEMPLATE_NOTES.get(session, {}).items():
            headers = {"X-Workspace-Id": workspace_id}
            created = requests.post(f"{self.base}/api/workspace/files/text", json={"name": name}, headers=headers,
                                    timeout=30)
            created.raise_for_status()
            content_hash = (created.json().get("data") or created.json())["content_hash"]
            requests.put(f"{self.base}/api/workspace/files/{name}/text", headers=headers, timeout=30,
                         json={"content": text, "content_hash": content_hash}).raise_for_status()
        return state


# ── request and trace ───────────────────────────────────────────────────

_STATE_KEYS = (
    "inputTables", "derivedTables", "loadedTableNodes", "fileNodes", "artifactSets",
    "externalTableReferences", "tableSemantics", "draftNodes", "charts", "conceptShelfItems",
    "focusedId", "generatedReports", "textTurns", "activeWorkspace",
)


def _table_ref(table: dict[str, Any]) -> dict[str, Any]:
    source = table.get("source") or {}
    snapshot = table.get("snapshot") or {}
    ref = {
        "name": source.get("tableId") or table.get("id"),
        "display_name": table.get("displayId") or table.get("id"),
        "columns": [{"name": c.get("name"), "type": str(c.get("type") or "unknown")}
                    for c in snapshot.get("columns") or []],
    }
    if snapshot.get("rowCount") is not None:
        ref["row_count"] = snapshot["rowCount"]
    return ref


def request_body(state: dict[str, Any], question: str, model_id: str) -> dict[str, Any]:
    return {
        "conversation_id": f"exploreDataFromNL_{int(time.time() * 1000)}",
        "input_tables": [_table_ref(t) for t in state.get("inputTables") or []],
        "external_references": state.get("externalTableReferences") or [],
        "session_state": {key: state[key] for key in _STATE_KEYS if key in state},
        "model": {"id": model_id, "is_global": True},
        "user_question": question,
    }


def _short(value: Any, limit: int = 600) -> Any:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + f"…(+{len(text) - limit})"


@dataclass
class Step:
    kind: str  # tool | action | skill | text | end | error
    name: str
    detail: Any = None
    t: float = 0.0


@dataclass
class Trace:
    steps: list[Step] = field(default_factory=list)
    final_text: str = ""
    seconds: float = 0.0
    error: str | None = None

    def decisive(self) -> Step | None:
        for step in self.steps:
            if step.kind == "action" or (step.kind == "tool" and step.name in MUTATING_TOOLS):
                return step
            if step.kind in ("end", "error"):
                return step
        return None

    def path(self) -> list[Step]:
        out = []
        for step in self.steps:
            if step is self.decisive():
                break
            out.append(step)
        return out

    def to_json(self) -> dict[str, Any]:
        return {"steps": [step.__dict__ for step in self.steps], "final_text": self.final_text,
                "seconds": self.seconds, "error": self.error}


def _args(event: dict[str, Any]) -> Any:
    for key in ("args", "arguments", "tool_args", "input"):
        if key in event:
            return event[key]
    return None


def run_case(server: Server, workspace_id: str, body: dict[str, Any], *, budget: float = 420.0,
             tail: float = 5.0, raw_path: Path | None = None) -> Trace:
    trace = Trace()
    start = time.time()
    decided_at: float | None = None
    raw = open(raw_path, "w") if raw_path else None
    text_parts: list[str] = []
    try:
        with requests.post(f"{server.base}/api/agent/analyst-streaming", json=body, stream=True,
                           headers={"X-Workspace-Id": workspace_id, "Origin": server.base,
                                    "Sec-Fetch-Site": "same-origin"},
                           timeout=(15, 300)) as response:
            if not response.ok:
                trace.error = f"HTTP {response.status_code}: {response.text[:300]}"
                return trace
            for chunk in response.iter_lines():
                line = chunk.decode("utf-8", errors="replace") if isinstance(chunk, bytes) else chunk
                now = time.time() - start
                if not line:
                    continue
                if raw:
                    raw.write(line + "\n")
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                etype = event.get("type")
                step: Step | None = None
                if etype == "tool_start":
                    name = event.get("tool") or event.get("name") or event.get("tool_name") or "?"
                    step = Step("action" if name in ACTIONS else "tool", name, _short(_args(event) or {}), now)
                elif etype == "skill_loaded":
                    step = Step("skill", event.get("skill") or event.get("name") or "?", None, now)
                elif etype in ("action", "agent_action"):
                    data = event.get("action_data") or {}
                    name = event.get("action") or (data.get("action") if isinstance(data, dict) else None) \
                        or (data.get("type") if isinstance(data, dict) else None)
                    if name and not any(s.kind == "action" and s.name == name for s in trace.steps[-3:]):
                        step = Step("action", name, _short(data), now)
                elif etype == "interact":
                    form = event.get("form") or {}
                    kind = (form.get("kind") if form else None) or ("data_operation" if event.get("data_operation")
                                                                    else "terminal" if event.get("terminal_request")
                                                                    else "question")
                    step = Step("action", f"interact:{kind}",
                                _short({k: v for k, v in event.items() if k not in ("trajectory",)}), now)
                elif etype == "text_delta":
                    text_parts.append(str(event.get("content") or event.get("delta") or event.get("text") or ""))
                elif etype == "completion":
                    content = event.get("content")
                    form = content.get("form") if isinstance(content, dict) else None
                    if isinstance(form, dict) and form.get("kind"):
                        trace.steps.append(Step("action", f"interact:{form['kind']}", _short(form), now))
                    trace.final_text = "".join(text_parts) or _short(content or event, 4000)
                    step = Step("end", "completion", _short(content or "", 2000), now)
                elif etype == "error":
                    step = Step("error", "error", _short(event), now)
                if step:
                    trace.steps.append(step)
                    if decided_at is None and trace.decisive() is not None:
                        decided_at = now
                if step and step.kind in ("end", "error"):
                    break
                if decided_at is not None and now - decided_at > tail:
                    break
                if now > budget:
                    trace.error = "budget"
                    break
    except requests.RequestException as exc:
        trace.error = f"{type(exc).__name__}: {exc}"
    finally:
        if raw:
            raw.close()
        trace.seconds = round(time.time() - start, 1)
        if not trace.final_text:
            trace.final_text = "".join(text_parts)[:4000]
    return trace
