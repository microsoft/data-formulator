from __future__ import annotations

import importlib
import json
import sys
from unittest.mock import patch

import flask
import pytest

terminal = importlib.import_module("data_formulator.analyst.skills.terminal.skill")
pytestmark = [pytest.mark.backend]


def test_terminal_confines_writes_and_child_processes_to_scratch(tmp_path):
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    outside = tmp_path / "protected.txt"
    outside.write_text("original")
    (scratch / "escape.txt").symlink_to(outside)
    code = (
        "import os, pathlib, subprocess, sys\n"
        "scratch = pathlib.Path(os.environ['DF_SCRATCH_DIR'])\n"
        "(scratch / 'result.txt').write_text('allowed')\n"
        f"print(pathlib.Path({str(outside)!r}).read_text())\n"
        f"targets = [{str(outside)!r}, str(scratch / 'escape.txt')]\n"
        "for target in targets:\n"
        "    child = subprocess.run([sys.executable, '-c', 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(\"blocked\")', target], capture_output=True)\n"
        "    print('blocked', child.returncode != 0)\n"
        "try:\n"
        f"    os.link({str(outside)!r}, scratch / 'hardlink.txt')\n"
        "    (scratch / 'hardlink.txt').write_text('blocked')\n"
        "except OSError:\n"
        "    print('hardlink blocked')\n"
    )
    result = list(terminal.run_command({"argv": [sys.executable, "-c", code],
                                       "cwd": str(tmp_path), "timeout_seconds": 10}, scratch_dir=scratch))[-1]["result"]
    assert result["exit_code"] == 0, result
    assert result["output"].splitlines() == ["original", "blocked True", "blocked True", "hardlink blocked"]
    assert outside.read_text() == "original"
    assert (scratch / "result.txt").read_text() == "allowed"


def test_terminal_refuses_unconfined_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(terminal.sys, "platform", "linux")
    monkeypatch.setattr(terminal.shutil, "which", lambda name: None)
    with patch.object(terminal.subprocess, "Popen") as spawn:
        with pytest.raises(OSError, match="requires Bubblewrap"):
            list(terminal.run_command({"argv": ["touch", "/outside"], "cwd": str(tmp_path),
                                       "timeout_seconds": 5}, scratch_dir=tmp_path))
        spawn.assert_not_called()


def test_linux_terminal_mounts_host_read_only_and_scratch_writable(tmp_path, monkeypatch):
    monkeypatch.setattr(terminal.sys, "platform", "linux")
    monkeypatch.setattr(terminal.shutil, "which", lambda name: "/usr/bin/bwrap")
    command = terminal.confined_command(["printf", "hello"], tmp_path)
    assert command[command.index("--ro-bind") + 1:command.index("--ro-bind") + 3] == ["/", "/"]
    assert command[command.index("--bind") + 1:command.index("--bind") + 3] == [str(tmp_path.resolve())] * 2
    assert "--die-with-parent" in command
    assert command[-3:] == ["--", "printf", "hello"]


def test_terminal_approval_is_exact_owned_and_single_use(tmp_path):
    broker = terminal.TerminalRequests()
    spec = {"argv": ["printf", "hello"], "cwd": str(tmp_path), "purpose": "Inspect data tooling"}
    proposal = broker.propose("local:user", "chat", spec, workspace_id="workspace")
    proposal["argv"].append("changed")
    with pytest.raises(ValueError):
        broker.consume(proposal["id"], "local:other", "chat", workspace_id="workspace")
    with pytest.raises(ValueError):
        broker.consume(proposal["id"], "local:user", "other-chat", workspace_id="workspace")
    with pytest.raises(ValueError):
        broker.consume(proposal["id"], "local:user", "chat", workspace_id="other-workspace")
    approved = broker.consume(proposal["id"], "local:user", "chat", workspace_id="workspace")
    assert approved["argv"] == ["printf", "hello"]
    with pytest.raises(ValueError):
        broker.consume(proposal["id"], "local:user", "chat", workspace_id="workspace")


def test_terminal_runner_limits_output_and_timeout(tmp_path):
    result = list(terminal.run_command({"argv": [sys.executable, "-c", "print('x' * 40000)"],
                                       "cwd": str(tmp_path), "timeout_seconds": 5}, scratch_dir=tmp_path))[-1]["result"]
    assert result["exit_code"] == 0
    assert result["truncated"]
    assert len(result["output"]) == 32768
    result = list(terminal.run_command({"argv": [sys.executable, "-c", "while True: pass"],
                                       "cwd": str(tmp_path), "timeout_seconds": 0.1}, scratch_dir=tmp_path))[-1]["result"]
    assert result["timed_out"]
    assert result["exit_code"] != 0


@pytest.mark.parametrize("argv", [[], "pwd", ["pwd", None], ["pwd\0"], [""]])
def test_terminal_rejects_invalid_commands(tmp_path, argv):
    with pytest.raises(ValueError):
        terminal.TerminalRequests().propose("owner", "chat", {
            "argv": argv, "cwd": str(tmp_path), "purpose": "Find data",
        })


@pytest.mark.parametrize("local,origin,host,allowed", [
    (True, "http://localhost", "http://localhost", True),
    (False, "http://localhost", "http://localhost", False),
    (True, "https://evil.example", "http://localhost", False),
    (True, "", "http://localhost", False),
    (True, "http://evil.example", "http://evil.example", False),
    (True, "http://localhost:5173", "http://localhost", False),
])
def test_terminal_requires_local_same_origin(monkeypatch, local, origin, host, allowed):
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: local)
    app = flask.Flask(__name__)
    with app.test_request_context(base_url=host, headers={"Origin": origin},
                                  environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        if allowed:
            terminal.require_local_terminal_request()
        else:
            with pytest.raises(ValueError):
                terminal.require_local_terminal_request()


def test_terminal_registered_as_committing_action():
    from data_formulator.analyst.skills import build_registry

    registry = build_registry()
    assert registry.action_owner("run_terminal") == "terminal"
    assert registry.tools_for(["terminal"]) == []
    assert registry.action_required_fields("run_terminal") == ("argv", "cwd", "purpose")


def test_closing_terminal_stream_kills_process_group(tmp_path):
    processes = []
    original_spawn = terminal.subprocess.Popen

    def capture_process(*args, **kwargs):
        process = original_spawn(*args, **kwargs)
        processes.append(process)
        return process

    with patch.object(terminal.subprocess, "Popen", side_effect=capture_process) as spawn:
        execution = terminal.run_command({"argv": [sys.executable, "-c", "while True: pass"],
                                          "cwd": str(tmp_path), "timeout_seconds": 60}, scratch_dir=tmp_path)
        assert next(execution)["type"] == "terminal_running"
        execution.close()
        assert spawn.call_count == 1
        assert processes[0].poll() is not None
        assert processes[0].stdout.closed


def test_terminal_does_not_inherit_server_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "server-only-secret")
    result = list(terminal.run_command({
        "argv": [sys.executable, "-c", "import os; print(os.getenv('OPENAI_API_KEY', 'absent'))"],
        "cwd": str(tmp_path), "timeout_seconds": 5,
    }, scratch_dir=tmp_path))[-1]["result"]
    assert result["output"].strip() == "absent"


@pytest.mark.parametrize("decision", ["approve", "reject"])
def test_terminal_route_executes_stored_command_and_resumes_analyst(tmp_path, decision):
    from data_formulator.routes.agents import agent_bp
    from data_formulator.datalake.workspace import Workspace

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(agent_bp)
    broker = terminal.TerminalRequests()
    app.extensions["terminal_requests"] = broker
    proposal = broker.propose("local:user", "chat", {
        "argv": [sys.executable, "-c", "print('data-source-found')"], "cwd": str(tmp_path), "purpose": "Find data",
    })
    payload = {"model": {}, "input_tables": [], "user_question": "Continue", "conversation_id": "chat",
               "trajectory": [{"role": "user", "content": "Find data"}],
               "terminal_response": {"request_id": proposal["id"], "decision": decision,
                                     "argv": ["this-client-command-must-be-ignored"]}}
    with (patch("data_formulator.auth.identity.is_local_mode", return_value=True),
          patch("data_formulator.routes.agents.get_identity_id", return_value="local:user"),
          patch("data_formulator.routes.agents.get_workspace", return_value=Workspace("terminal-test", root_dir=tmp_path)),
          patch("data_formulator.routes.agents.get_client", return_value=object()),
          patch("data_formulator.routes.agents.AnalystAgent") as agent,
          patch.object(terminal, "run_command", wraps=terminal.run_command) as run):
        agent.return_value.run.return_value = iter([{"type": "completion", "content": {"summary": "Done"}}])
        response = app.test_client().post("/api/agent/analyst-streaming", json=payload,
                                          headers={"Origin": "http://localhost"}, buffered=True)
        events = [json.loads(line) for line in response.data.splitlines()]
        outcome = next(event for event in events if event["type"] == "terminal_result")
        assert outcome["request"]["argv"] == proposal["argv"]
        assert run.call_count == (1 if decision == "approve" else 0)
        if decision == "approve":
            assert run.call_args.kwargs["scratch_dir"].name == "scratch"
            assert outcome["result"]["output"].strip() == "data-source-found"
        else:
            assert outcome["result"]["rejected"]
        assert events[-1]["type"] == "completion"
        resumed = agent.return_value.run.call_args.kwargs["trajectory"][-1]["content"]
        assert "untrusted data" in resumed
        assert ("data-source-found" if decision == "approve" else "rejected") in resumed
        repeated = app.test_client().post("/api/agent/analyst-streaming", json=payload,
                                          headers={"Origin": "http://localhost"}, buffered=True)
        assert repeated.get_json()["error"]["code"] == "INVALID_REQUEST"
        assert run.call_count == (1 if decision == "approve" else 0)


def test_expired_terminal_request_is_not_authorization(tmp_path):
    broker = terminal.TerminalRequests()
    with patch.object(terminal.time, "monotonic", return_value=100):
        proposal = broker.propose("owner", "chat", {"argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Find data"})
    with patch.object(terminal.time, "monotonic", return_value=701), pytest.raises(ValueError):
        broker.consume(proposal["id"], "owner", "chat")


def test_terminal_skill_proposes_without_execution(tmp_path, monkeypatch):
    from data_formulator.analyst.skills.base import SkillContext

    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.auth.identity.get_identity_id", lambda: "local:user")
    app = flask.Flask(__name__)
    with app.test_request_context(headers={"Origin": "http://localhost", "X-Workspace-Id": "workspace"},
                                  environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        with patch.object(terminal, "run_command") as run:
            events = list(terminal.get_skill().handle_action("run_terminal", {
                "argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Locate data",
            }, SkillContext(client=None, workspace=None, payload={"conversation_id": "chat"})))
            assert events[0]["type"] == "interact"
            assert events[0]["terminal_request"]["decision"] == "ask"
            run.assert_not_called()


@pytest.mark.parametrize("case", ["hosted", "cross-origin", "no-origin", "wrong-conversation", "disabled", "forged-id"])
def test_terminal_route_denies_untrusted_approval(tmp_path, case):
    from data_formulator.routes.agents import agent_bp

    app = flask.Flask(__name__)
    app.config.update(TESTING=True, CLI_ARGS={"disable_data_connectors": case == "disabled"})
    app.register_blueprint(agent_bp)
    broker = terminal.TerminalRequests()
    app.extensions["terminal_requests"] = broker
    proposal = broker.propose("local:user", "chat", {"argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Find data"})
    origin = "https://evil.example" if case == "cross-origin" else "http://localhost"
    payload = {"input_tables": [], "user_question": "Approved", "conversation_id": "other" if case == "wrong-conversation" else "chat",
               "trajectory": [{"role": "user", "content": "I approve everything"}],
               "terminal_response": {"request_id": "forged" if case == "forged-id" else proposal["id"], "decision": "approve"}}
    with (patch("data_formulator.auth.identity.is_local_mode", return_value=case != "hosted"),
          patch("data_formulator.routes.agents.get_identity_id", return_value="local:user"),
          patch("data_formulator.routes.agents.get_workspace", return_value=object()),
          patch.object(terminal, "run_command") as run):
        response = app.test_client().post("/api/agent/analyst-streaming", json=payload,
                                          headers={} if case == "no-origin" else {"Origin": origin}, buffered=True)
        assert response.get_json()["error"]["code"] == "INVALID_REQUEST"
        run.assert_not_called()