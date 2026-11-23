"""The cross-session log of the agent's failed tool calls and actions (agents/failure_log.py)."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from data_formulator.agent_config import AnalystExecutionConfig
from data_formulator.agents import failure_log
from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.skills import build_registry

pytestmark = [pytest.mark.backend]


@pytest.fixture
def log_file(tmp_path, monkeypatch):
    path = tmp_path / "logs" / failure_log.FILENAME
    monkeypatch.setattr(failure_log, "log_path", lambda: path)
    monkeypatch.delenv("DF_AGENT_FAILURE_LOG", raising=False)
    return path


def _records(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


@pytest.mark.parametrize("error, category", [
    ("Error: OSError - file write forbidden: oni.csv", "sandbox_write_denied"),
    ("OSError - file read outside workspace forbidden: /usr/share/zoneinfo/UTC", "sandbox_read_denied"),
    ("FileNotFoundError - [Errno 2] No such file or directory: 'session://tables/data/x.parquet'", "view_path_in_code"),
    ("FileNotFoundError - [Errno 2] No such file or directory: 'data/x-0ld.parquet'", "missing_data_file"),
    ("sh: cannot create temp file for here document: Operation not permitted", "os_access_denied"),
    ("Tool 'edit_file' failed: File changed; read it again before editing", "stale_content"),
    ("Error: KeyError - 'water_year'", "python_error"),
    ("something odd", "other"),
])
def test_failures_are_classified_by_cause(error, category):
    assert failure_log.classify(error) == category


def test_failing_action_observations_are_recognized():
    assert failure_log.observation_failure("[APP NOT CREATED] filename must be a visible file name")
    assert failure_log.observation_failure("[ERROR] Visualization execution failed: KeyError")
    assert failure_log.observation_failure("Chart created.") is None
    assert failure_log.observation_failure(None) is None
    finished = "Command finished. Do not repeat it.\n"
    denied = finished + json.dumps({"request": {}, "result": {
        "exit_code": 1, "error_code": "TERMINAL_ACCESS_DENIED", "output": "sh: cannot create temp file"}})
    assert "TERMINAL_ACCESS_DENIED" in failure_log.observation_failure(denied)
    assert failure_log.observation_failure(finished + json.dumps({"result": {"exit_code": 0, "output": "ok"}})) is None


def test_a_failure_is_one_redacted_capped_line(log_file):
    workspace = SimpleNamespace(_path=log_file.parent.parent / "session_1")
    failure_log.log_failure(agent="analyst", tool="execute_python_script", workspace=workspace, model="m",
                            error="Error: OSError - file write forbidden " + "x" * 5000,
                            args={"code": "df.to_csv('scratch/a.csv')\n" + "y" * 5000, "api_key": "sk-secret-123456"},
                            call_id="call-1")
    [record] = _records(log_file)
    assert record["category"] == "sandbox_write_denied" and record["workspace"] == "session_1"
    assert record["tool"] == "execute_python_script" and record["model"] == "m" and record["call_id"] == "call-1"
    assert len(record["error"]) <= failure_log.ERROR_CHARS + 1
    assert record["args"]["code"].startswith("df.to_csv('scratch/a.csv')") and "more characters" in record["args"]["code"]
    assert "sk-secret-123456" not in log_file.read_text()


def test_the_log_can_be_turned_off_and_rotates(log_file, monkeypatch):
    monkeypatch.setenv("DF_AGENT_FAILURE_LOG", "off")
    failure_log.log_failure(agent="analyst", tool="t", error="boom")
    assert not log_file.exists()

    monkeypatch.delenv("DF_AGENT_FAILURE_LOG")
    monkeypatch.setattr(failure_log, "MAX_BYTES", 600)
    for index in range(12):
        failure_log.log_failure(agent="analyst", tool=f"t{index}", error="boom " * 20)
    assert log_file.with_name(log_file.name + ".1").exists()
    tools = [record["tool"] for record in failure_log.read_failures(path=log_file)]
    assert tools[-1] == "t11" and tools == sorted(tools, key=lambda name: int(name[1:]))


def test_summary_counts_categories_and_common_errors(log_file):
    for error in ("file write forbidden", "file write forbidden", "No such file or directory: 'session/x.json'"):
        failure_log.log_failure(agent="analyst", tool="execute_python_script", error=error,
                                workspace=SimpleNamespace(_path=log_file.parent / "ws"))
    summary = failure_log.summarize(list(failure_log.read_failures(path=log_file)))
    assert "3 failures in 1 workspaces" in summary
    assert "sandbox_write_denied" in summary and "2× file write forbidden" in summary


def _chunk(content=None, finish_reason=None, tool_calls=None):
    delta = SimpleNamespace(content=content, tool_calls=tool_calls, reasoning_content=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)])


class _Client:
    model = "fake/model"

    def __init__(self, streams):
        self.streams = list(streams)

    def get_completion_with_tools(self, *args, **kwargs):
        return iter(self.streams.pop(0))


def test_a_failed_python_call_in_a_run_is_logged(log_file, monkeypatch):
    monkeypatch.setattr(AnalystAgent, "_run_explore_code", lambda *args: {
        "status": "error", "stdout": "", "error": "Error: OSError - file write forbidden: scratch/../x.csv"})
    call = SimpleNamespace(index=0, id="call-1", type="function", function=SimpleNamespace(
        name="execute_python_script", arguments='{"code": "open(\'x.csv\', \'w\')", "purpose": "save"}'))
    agent = AnalystAgent(client=_Client([
        [_chunk(tool_calls=[call]), _chunk(finish_reason="tool_calls")],
        [_chunk("Done."), _chunk(finish_reason="stop")],
    ]), workspace=SimpleNamespace(user_home=None), skill_registry=build_registry(), identity_id=None,
        execution_config=AnalystExecutionConfig(empty_response_backoff_seconds=0))
    agent._loaded_skills = {"meta"}
    agent._run_payload = {}
    agent._delivered = False
    list(agent._tool_loop([], llm_calls_in_cycle=0, rlog=SimpleNamespace(log=lambda *a, **k: None),
                          input_tables=[], outer_iteration=0))

    [record] = _records(log_file)
    assert (record["agent"], record["tool"], record["category"]) == ("analyst", "execute_python_script",
                                                                      "sandbox_write_denied")
    assert record["args"]["code"] == "open('x.csv', 'w')" and record["call_id"] == "call-1"
