from __future__ import annotations

import importlib
import json
import sys
from unittest.mock import patch

import flask
import pytest

terminal = importlib.import_module("data_formulator.analyst.skills.terminal.skill")
pytestmark = [pytest.mark.backend]


@pytest.fixture(autouse=True)
def terminal_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "config"))
    monkeypatch.delenv("DF_TERMINAL_MODE", raising=False)
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))


@pytest.mark.parametrize("mode", ["off", "ask", "auto"])
@pytest.mark.parametrize("kind", ["analyst", "workflow"])
def test_terminal_policy_controls_first_turn_prompt_and_tools(tmp_path, monkeypatch, mode, kind):
    from threading import Event
    from unittest.mock import MagicMock
    from data_formulator.analyst.agent import AnalystAgent
    from data_formulator.analyst.skills import build_registry
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.workflows.agent import WorkflowAgent, new_run

    monkeypatch.setattr("data_formulator.configuration.terminal_mode", lambda: mode)
    workspace = Workspace("terminal-policy", root_dir=tmp_path)
    registry = build_registry()
    if kind == "analyst":
        agent = AnalystAgent(MagicMock(), workspace, skill_registry=registry)
        agent._loaded_skills = agent._initial_loaded_skills(None)
    else:
        definition = {"version": 1, "name": "Policy", "overview": "Test", "deliverables": ["Summary"],
                      "steps": [{"id": "work", "instructions": "Find data"}]}
        agent = WorkflowAgent(MagicMock(), workspace, new_run(definition, "policy"), lambda state: None, Event(), "")
    prompt = agent._build_system_prompt()
    tools = agent._current_tools()
    names = {spec["function"]["name"] for spec in tools}
    assert registry.has("terminal")
    workspace_guidance = agent.registry.load_body("workspace")
    assert "## Choose an Acquisition Route" in workspace_guidance
    assert "{terminal_acquisition_route}" not in prompt
    if mode == "off":
        assert "terminal" not in prompt.lower()
        assert "terminal" not in json.dumps(tools).lower()
        assert "Existing CLI access or local files" not in workspace_guidance
        assert not agent.registry.has("terminal")
        assert not agent._build_skill_body_message("terminal")[0]
    else:
        assert "run_terminal" in names
        assert "terminal" in agent._loaded_skills
        assert "Use it proactively" in prompt
        assert "Existing CLI access or local files" in workspace_guidance
        assert "without requiring a new connector" in workspace_guidance
        assert "CLI acquisition -> scratch dataset -> workspace input" in prompt
        assert "`create_data` and acquisition metadata" in workspace_guidance
        assert "Read access is not confined to the workspace" in prompt
        assert "Use online resources when needed" in prompt
        assert "write confinement does not prevent data uploads or remote changes" in prompt
        terminal_spec = next(spec["function"] for spec in tools if spec["function"]["name"] == "run_terminal")
        assert "acquire data" in terminal_spec["description"]
        assert "local files outside the workspace" in terminal_spec["description"]
        assert "online datasets, documentation, or APIs" in terminal_spec["description"]
        assert "command output is sent to the model provider" in terminal_spec["description"]
        assert "{terminal_policy}" not in prompt
        assert "{terminal_filesystem_policy}" not in prompt
        assert "sandboxDisablingReason" in prompt
        assert "dangerouslyDisableSandbox" in terminal_spec["parameters"]["properties"]
        assert "write_paths" not in terminal_spec["parameters"]["properties"]
        assert ("pauses for approval of each exact invocation" in prompt) == (mode == "ask")
        assert ("Auto approval is enabled" in prompt) == (mode == "auto")
    history = [
        {"role": "user", "content": "[SKILL LOADED: terminal]\nOld Ask-only instructions"},
        {"role": "user", "content": "[SKILL LOADED: workspace]\nOld connector-only instructions"},
    ]
    agent._rehydrate_loaded_skills(history)
    assert "Old Ask-only" not in history[0]["content"]
    assert "Old connector-only" not in history[1]["content"]
    assert "{terminal_acquisition_route}" not in history[1]["content"]
    assert ("Existing CLI access or local files" in history[1]["content"]) == (mode != "off")
    assert ("terminal" in agent._loaded_skills) == (mode != "off")


@pytest.mark.parametrize("ignore_interrupt", [False, True])
def test_terminal_pause_retains_partial_output_and_stops_process(tmp_path, ignore_interrupt):
    from threading import Event
    import time

    cancel = Event()
    code = ("import signal\n"
            + ("signal.signal(signal.SIGINT, signal.SIG_IGN)\n" if ignore_interrupt else "")
            + "print('partial output', flush=True)\nwhile True: pass")
    events = terminal.run_command({"argv": [sys.executable, "-c", code],
        "cwd": str(tmp_path), "timeout_seconds": 30}, scratch_dir=tmp_path, cancel=cancel)
    assert next(events)["type"] == "terminal_running"
    started = time.monotonic()
    cancel.set()
    result = list(events)[-1]["result"]
    assert time.monotonic() - started < 3
    assert result["interrupted"]
    assert not result["timed_out"]
    assert result["exit_code"] != 0
    assert "partial output" in result["output"]


def test_terminal_acquired_data_can_be_analyzed_and_published_without_connector(tmp_path):
    from data_formulator.analyst.agent import AnalystAgent
    from data_formulator.analyst.skills.analysis.skill import get_skill as analysis_skill
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.analyst.skills.visualization.skill import get_skill as visualization_skill
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
    from data_formulator.datalake.workspace import Workspace

    source = tmp_path / "usage.csv"
    source.write_text("day,tokens\n2026-09-01,10\n2026-09-02,30\n")
    workspace = Workspace("terminal-acquisition", root_dir=tmp_path / "workspace")
    code = (
        "import os, pathlib, shutil, sys\n"
        "destination = pathlib.Path(os.environ['DF_SCRATCH_DIR']) / 'usage.csv'\n"
        "shutil.copyfile(sys.argv[1], destination)\n"
        "print('scratch/usage.csv')\n"
    )
    result = list(terminal.run_command({
        "argv": [sys.executable, "-c", code, str(source)],
        "cwd": str(tmp_path), "timeout_seconds": 10,
    }, scratch_dir=workspace.confined_scratch.root))[-1]["result"]
    assert result["exit_code"] == 0, result
    assert not result["timed_out"]
    assert not result["truncated"]
    skill = WorkspaceSkill()
    context = SkillContext(client=None, workspace=workspace, runtime=AnalystAgent(client=None, workspace=workspace))
    items = json.loads(skill.handle_tool("list_workspace_items", {"scope": "temp"}, context).text)["items"]
    acquired = next(item for item in items if item["path"] == "scratch/usage.csv")
    assert workspace.list_tables() == []
    published = json.loads(skill.handle_tool("create_data", {
        "table_name": "acquired_usage",
        "display_name": "Daily Usage",
        "acquisition": {"source": str(source), "scope": "Daily tokens for September 1-2, 2026", "query": "Read the supplied CSV", "limitations": "Two days only; tokens, not cost"},
        "input_sources": [{"id": acquired["path"], "kind": "file"}],
        "code": f"import pandas as pd\nresult = pd.read_csv({acquired['path']!r})",
        "output_variable": "result",
    }, context).text)
    assert published["role"] == "source"
    assert published["origin"] == "agent"
    assert published["edit_policy"] == "agent_editable"
    assert published["row_count"] == 2
    assert published["input_sources"][0]["id"] == acquired["path"]
    assert published["input_sources"][0]["content_hash"] == acquired["content_hash"]
    assert (workspace.confined_scratch.root / "usage.csv").read_bytes() == source.read_bytes()
    restored = Workspace("terminal-acquisition", root_dir=tmp_path / "workspace").get_table_metadata("acquired_usage")
    assert restored.role == "source"
    assert restored.import_options["acquisition"] == published["acquisition"]
    assert published["acquisition"]["source"] == str(source)
    assert published["acquisition"]["acquired_at"]
    (workspace.confined_scratch.root / "usage.csv").unlink()
    inspection = analysis_skill().handle_tool("execute_python_script", {
        "code": f"import pandas as pd\nusage = pd.read_parquet({published['path']!r})\nprint(int(usage['tokens'].sum()))",
    }, context)
    assert inspection.text.strip() == "40"
    events = list(visualization_skill().handle_action("visualize", {
        "title": "Daily Token Usage", "display_name": "Daily Usage Chart",
        "input_sources": [{"id": published["id"], "kind": "data"}],
        "code": f"import pandas as pd\nresult_df = pd.read_parquet({published['path']!r})",
        "output_variable": "result_df",
        "chart": {"chart_type": "Line Chart", "encodings": {"x": {"field": "day"}, "y": {"field": "tokens"}}},
    }, context))
    assert not any(event["type"] == "error" for event in events), events
    assert events[0]["input_sources"][0]["id"] == published["id"]
    assert any(event["type"] == "result" for event in events)


def test_terminal_policy_change_invalidates_approval(tmp_path):
    from data_formulator.configuration import save_configuration

    broker = terminal.TerminalRequests()
    proposal = broker.propose("local:user", "chat", {"argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Locate data"})
    save_configuration({"terminal_mode": "off"}, 0)
    save_configuration({"terminal_mode": "ask"}, 1)
    with pytest.raises(ValueError, match="policy changed"):
        broker.consume(proposal["id"], "local:user", "chat")


@pytest.mark.parametrize("mode", ["off", "auto"])
def test_terminal_action_obeys_policy_without_client_override(tmp_path, monkeypatch, mode):
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.configuration import save_configuration

    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.auth.identity.get_identity_id", lambda: "local:user")
    save_configuration({"terminal_mode": mode}, 0)
    app = flask.Flask(__name__)
    with app.test_request_context(headers={"Origin": "http://localhost", "X-Workspace-Id": "workspace"},
                                  environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        with patch.object(terminal, "run_command", return_value=(event for event in [
            {"type": "terminal_running"}, {"type": "terminal_result", "result": {"exit_code": 0, "output": "data.csv"}},
        ])) as run:
            action = terminal.get_skill().handle_action("run_terminal", {
                "argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Locate data", "mode": "auto",
            }, SkillContext(client=None, workspace=Workspace("workspace", root_dir=tmp_path), payload={"conversation_id": "chat"}))
            events = []
            try:
                while True:
                    events.append(next(action))
            except StopIteration as completed:
                observation = completed.value
            assert all(event["type"] != "interact" for event in events)
            if mode == "off":
                run.assert_not_called()
                assert "disabled" in observation
            else:
                run.assert_called_once()
                assert events[0]["type"] == "terminal_started"
                assert events[-1]["type"] == "terminal_result"
                assert "data.csv" in observation
                assert not app.extensions["terminal_requests"]._pending


@pytest.mark.parametrize("mode", ["ask", "auto"])
def test_unsandboxed_action_always_requires_approval(tmp_path, monkeypatch, mode):
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.configuration import save_configuration

    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.auth.identity.get_identity_id", lambda: "local:user")
    save_configuration({"terminal_mode": mode}, 0)
    app = flask.Flask(__name__)
    with app.test_request_context(headers={"Origin": "http://localhost", "X-Workspace-Id": "workspace"},
                                  environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        with patch.object(terminal, "run_command") as run:
            events = list(terminal.get_skill().handle_action("run_terminal", {
                "argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Acquire data",
                "dangerouslyDisableSandbox": True, "sandboxDisablingReason": "Client needs a protected state directory",
                "decision": "approve",
            }, SkillContext(client=None, workspace=Workspace("workspace", root_dir=tmp_path),
                            payload={"conversation_id": "chat"})))
        run.assert_not_called()
        proposal = events[0]["terminal_request"]
        assert proposal["decision"] == "ask"
        assert proposal["dangerouslyDisableSandbox"] is True
        proposal["sandboxDisablingReason"] = "Client tampering"
        stored = app.extensions["terminal_requests"].consume(proposal["id"], "local:user", "chat", workspace_id="workspace")
        assert stored["sandboxDisablingReason"] == "Client needs a protected state directory"


@pytest.mark.parametrize("decision", [None, "auto", "ask", "reject", "approve"])
def test_unsandboxed_runner_requires_approval(tmp_path, decision):
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    target = tmp_path / "outside"
    proposal = {"argv": [sys.executable, "-c", f"from pathlib import Path; Path({str(target)!r}).write_text('approved')"],
                "cwd": str(tmp_path), "timeout_seconds": 5, "decision": decision,
                "dangerouslyDisableSandbox": True, "sandboxDisablingReason": "Write requested output outside scratch"}
    if decision == "approve":
        assert list(terminal.run_command(proposal, scratch_dir=scratch))[-1]["result"]["exit_code"] == 0
        assert target.read_text() == "approved"
    else:
        with pytest.raises(ValueError, match="explicit approval"):
            list(terminal.run_command(proposal, scratch_dir=scratch))
        assert not target.exists()


@pytest.mark.parametrize("reason", [None, "", " ", 12, "x" * 2001])
def test_unsandboxed_request_requires_reason(tmp_path, reason):
    with pytest.raises(ValueError, match="reason"):
        terminal.TerminalRequests().propose("local:user", "chat", {
            "argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Acquire data",
            "dangerouslyDisableSandbox": True, "sandboxDisablingReason": reason,
        })


def test_default_state_write_executes_immediately_in_auto(tmp_path, monkeypatch):
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.configuration import save_configuration

    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.auth.identity.get_identity_id", lambda: "local:user")
    save_configuration({"terminal_mode": "auto"}, 0)
    state = terminal.Path.home() / ".azure"
    state.mkdir()
    app = flask.Flask(__name__)
    with app.test_request_context(headers={"Origin": "http://localhost", "X-Workspace-Id": "workspace"},
                                  environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        events = list(terminal.get_skill().handle_action("run_terminal", {
            "argv": [sys.executable, "-c", f"from pathlib import Path; Path({str(state / 'state')!r}).write_text('updated')"],
            "cwd": str(tmp_path), "purpose": "Query with existing CLI state",
        }, SkillContext(client=None, workspace=Workspace("workspace", root_dir=tmp_path),
                        payload={"conversation_id": "chat"})))
        assert events[0]["type"] == "terminal_started"
        assert not any(event["type"] == "interact" for event in events)
        assert events[-1]["result"]["exit_code"] == 0
        assert events[-1]["result"]["sandboxed"] is True
        assert (state / "state").read_text() == "updated"


@pytest.mark.parametrize("paths", ["/tmp", ["relative"], ["/"], [None], ["bad\0path"], ["/tmp"] * 9])
def test_terminal_rejects_legacy_write_grants(tmp_path, paths):
    with pytest.raises((ValueError, OSError)):
        terminal.TerminalRequests().propose("local:user", "chat", {
            "argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Inspect data", "write_paths": paths,
        })


def test_analyst_auto_terminal_cancellation_closes_command(tmp_path, monkeypatch):
    from unittest.mock import MagicMock
    from data_formulator.analyst.agent import AnalystAgent
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.datalake.workspace import Workspace

    monkeypatch.setattr("data_formulator.configuration.terminal_mode", lambda: "auto")
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.auth.identity.get_identity_id", lambda: "local:user")
    workspace = Workspace("workspace", root_dir=tmp_path)
    agent = AnalystAgent(MagicMock(), workspace)
    agent._suppress_stream_channel = None
    closed = []
    def command():
        try:
            yield {"type": "terminal_running"}
            yield {"type": "terminal_result", "result": {"exit_code": 0}}
        finally:
            closed.append(True)
    execution = command()
    monkeypatch.setattr(terminal, "run_command", lambda *args, **kwargs: execution)
    with flask.Flask(__name__).test_request_context(headers={"Origin": "http://localhost", "X-Workspace-Id": "workspace"},
                                                    environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        action = terminal.get_skill().handle_action("run_terminal", {"argv": ["pwd"], "cwd": str(tmp_path), "purpose": "Locate data"},
            SkillContext(client=None, workspace=workspace, payload={"conversation_id": "chat"}))
        events = agent._route_skill_events(action, 0, [], [])
        assert next(events)["type"] == "terminal_started"
        assert next(events)["type"] == "terminal_running"
        events.close()
        assert closed == [True]


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


@pytest.mark.parametrize("configured", [False, True])
def test_terminal_policy_allows_atomic_updates_but_protects_other_home_files(tmp_path, configured):
    from data_formulator.configuration import save_configuration

    state_directory = terminal.Path.home() / "client-state"
    state_directory.mkdir()
    if configured:
        save_configuration({"sandbox": {"filesystem": {"allowWrite": [str(state_directory)]}}}, 0)
    cache = state_directory / "token-cache"
    cache.write_text("old-token-placeholder")
    protected = [terminal.Path.home() / name for name in ("config", "other.json")]
    for target in protected:
        target.write_text("original")
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    code = (
        "import pathlib\n"
        f"cache = pathlib.Path({str(cache)!r})\n"
        "lock = pathlib.Path(str(cache) + '.lockfile')\n"
        "with lock.open('x'):\n"
        "    temporary = cache.with_suffix('.tmp')\n"
        "    temporary.write_text('new-token-placeholder')\n"
        "    temporary.replace(cache)\n"
        "lock.unlink()\n"
        f"for target in {list(map(str, protected))!r}:\n"
        "    try:\n"
        "        pathlib.Path(target).write_text('blocked')\n"
        "    except PermissionError:\n"
        "        print('blocked')\n"
    )
    proposal = {"argv": [sys.executable, "-c", code], "cwd": str(scratch), "timeout_seconds": 5,
                "decision": "auto"}
    result = list(terminal.run_command(proposal, scratch_dir=scratch))[-1]["result"]
    assert (result["exit_code"] == 0) == configured, result
    assert cache.read_text() == ("new-token-placeholder" if configured else "old-token-placeholder")
    assert not terminal.Path(str(cache) + ".lockfile").exists()
    if configured:
        assert result["output"].splitlines() == ["blocked"] * len(protected)
        save_configuration({"sandbox": {"filesystem": {"allowWrite": []}}}, 1)
        repeated = list(terminal.run_command(proposal, scratch_dir=scratch))[-1]["result"]
        assert repeated["exit_code"] != 0
    assert all(target.read_text() == "original" for target in protected)


@pytest.mark.parametrize("link_kind", ["symlink", "hardlink"])
def test_terminal_policy_skips_link_aliases(tmp_path, link_kind):
    from data_formulator.configuration import save_configuration

    outside = tmp_path / "protected.txt"
    outside.write_text("original")
    cache = tmp_path / "cache"
    if link_kind == "symlink":
        cache.symlink_to(outside)
    else:
        terminal.os.link(outside, cache)
    save_configuration({"sandbox": {"filesystem": {"allowWrite": [str(cache)]}}}, 0)
    assert terminal.sandbox_filesystem_policy()["allowWrite"] == []
    assert outside.read_text() == "original"


@pytest.mark.parametrize("decision", ["ask", "auto", "reject", None])
def test_runner_refuses_legacy_write_grants(tmp_path, decision):
    state = tmp_path / "state"
    state.mkdir()
    with patch.object(terminal.subprocess, "Popen") as spawn, pytest.raises(ValueError, match="Legacy"):
        list(terminal.run_command({"argv": ["pwd"], "cwd": str(tmp_path), "timeout_seconds": 5,
                                   "decision": decision, "write_paths": [str(state.resolve())]}, scratch_dir=tmp_path))
    spawn.assert_not_called()


def test_terminal_runtime_state_is_private_and_disposable(tmp_path):
    code = (
        "import json, os, pathlib\n"
        "runtime = pathlib.Path(os.environ['DF_RUNTIME_DIR'])\n"
        "(pathlib.Path(os.environ['XDG_CACHE_HOME']) / 'cache').write_text('temporary')\n"
        "print(json.dumps({'runtime': str(runtime), 'mode': runtime.stat().st_mode & 0o777}))\n"
    )
    result = list(terminal.run_command({"argv": [sys.executable, "-c", code], "cwd": str(tmp_path),
                                       "timeout_seconds": 5}, scratch_dir=tmp_path))[-1]["result"]
    assert result["exit_code"] == 0, result
    details = json.loads(result["output"])
    assert details["mode"] == 0o700
    assert not terminal.Path(details["runtime"]).exists()
    assert not terminal.Path(details["runtime"]).is_relative_to(tmp_path.resolve())
    assert not (tmp_path / "_terminal_cache").exists()


def test_terminal_revalidates_policy_paths_before_execution(tmp_path):
    from data_formulator.configuration import save_configuration

    state = tmp_path / "state"
    state.mkdir()
    save_configuration({"sandbox": {"filesystem": {"allowWrite": [str(state)]}}}, 0)
    assert terminal.sandbox_filesystem_policy()["allowWrite"] == [str(state.resolve())]
    state.rmdir()
    state.symlink_to(terminal.Path.home(), target_is_directory=True)
    with pytest.raises(ValueError, match="home"):
        terminal.sandbox_filesystem_policy()


@pytest.mark.parametrize("state_path", terminal.DEFAULT_ALLOW_WRITE)
def test_terminal_default_policy_allows_cli_state_without_approval(tmp_path, state_path):
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    state = terminal.Path(state_path).expanduser()
    state.mkdir(parents=True)
    target = state / "msal_token_cache.json"
    target.write_text("unchanged")
    result = list(terminal.run_command({"argv": [sys.executable, "-c",
        "import pathlib,sys; target=pathlib.Path(sys.argv[1]); lock=target.with_suffix('.lock'); lock.touch(); temporary=target.with_suffix('.tmp'); temporary.write_text('changed'); temporary.replace(target); lock.unlink()", str(target)],
        "cwd": str(tmp_path), "timeout_seconds": 5, "decision": "auto"}, scratch_dir=scratch))[-1]["result"]
    assert result["exit_code"] == 0, result
    assert target.read_text() == "changed"


def test_terminal_configured_policy_replaces_defaults_and_is_reusable(tmp_path):
    from data_formulator.configuration import save_configuration

    custom = terminal.Path.home() / "custom-state"
    custom.mkdir()
    azure = terminal.Path.home() / ".azure"
    azure.mkdir()
    save_configuration({"sandbox": {"filesystem": {"allowWrite": [str(custom)]}}}, 0)
    assert terminal.sandbox_filesystem_policy()["allowWrite"] == [str(custom.resolve())]
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    for invocation in range(2):
        result = list(terminal.run_command({"argv": [sys.executable, "-c",
            f"from pathlib import Path; Path({str(custom / 'state')!r}).write_text({str(invocation)!r})"],
            "cwd": str(tmp_path), "timeout_seconds": 5, "decision": "auto"}, scratch_dir=scratch))[-1]["result"]
        assert result["exit_code"] == 0, result
    save_configuration({"sandbox": {"filesystem": {"allowWrite": []}}}, 1)
    assert terminal.sandbox_filesystem_policy()["allowWrite"] == []


def test_terminal_default_policy_rejects_redirects_and_creates_only_cache_children(tmp_path, monkeypatch):
    home = terminal.Path.home()
    (home / ".azure").symlink_to(tmp_path, target_is_directory=True)
    (home / ".aws").mkdir()
    policy = terminal.sandbox_filesystem_policy(prepare=True)
    assert str(tmp_path.resolve()) not in policy["allowWrite"]
    assert "~/.azure" in policy["skipped"]
    assert (home / ".aws/sso/cache").is_dir()
    assert not (home / ".config/gcloud").exists()
    monkeypatch.setenv("AZURE_CONFIG_DIR", str(home))
    assert str(home.resolve()) not in terminal.sandbox_filesystem_policy()["allowWrite"]


@pytest.mark.parametrize("paths", [["/"], ["~"], ["relative"], "~/.azure", [None], ["~/.azure"] * 65])
def test_terminal_sandbox_configuration_rejects_invalid_paths(paths):
    from data_formulator.configuration import save_configuration

    with pytest.raises(ValueError):
        save_configuration({"sandbox": {"filesystem": {"allowWrite": paths}}}, 0)


def test_terminal_rejects_home_and_ancestor_grants():
    from data_formulator.configuration import validate_overrides

    home = terminal.Path.home().resolve()
    for directory in [home, *home.parents]:
        with pytest.raises(ValueError, match="home"):
            validate_overrides({"sandbox": {"filesystem": {"allowWrite": [str(directory)]}}})


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
    state = tmp_path / "state"
    state.mkdir()
    command = terminal.confined_command(["pwd"], tmp_path, write_paths=[str(state.resolve())])
    assert command.count("--bind") == 2
    assert command[command.index(str(state.resolve())) - 1:command.index(str(state.resolve())) + 2] == [
        "--bind", str(state.resolve()), str(state.resolve())]


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


@pytest.mark.parametrize("exit_code,output,blocked", [
    (1, "Operation not permitted: ~/.azure/msal_token_cache.json.lockfile", True),
    (1, "Permission denied: ~/.azure/msal_token_cache.bin", True),
    (1, "Permission denied: report.csv", True),
    (1, "Read-only file system: client-state", True),
    (1, "Authentication required: sign in to your account", False),
    (0, "Operation not permitted: ~/.azure/msal_token_cache.json.lockfile", False),
])
def test_terminal_reports_access_denial_without_guessing_its_source(tmp_path, exit_code, output, blocked):
    result = list(terminal.run_command({
        "argv": [sys.executable, "-c", "import sys; print(sys.argv[1]); sys.exit(int(sys.argv[2]))", output, str(exit_code)],
        "cwd": str(tmp_path), "timeout_seconds": 5,
    }, scratch_dir=tmp_path))[-1]["result"]
    assert result["exit_code"] == exit_code
    assert result["output"].strip() == output
    assert (result.get("error_code") == "TERMINAL_ACCESS_DENIED") == blocked
    if blocked:
        assert "does not establish invalid credentials" in result["error"]
        assert "OS permissions, or a remote service" in result["error"]
    else:
        assert "error" not in result


def test_terminal_does_not_inherit_server_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "server-only-secret")
    monkeypatch.setenv("AWS_PROFILE", "data-reader")
    monkeypatch.setenv("CLOUDSDK_CONFIG", str(tmp_path / "cloud-config"))
    result = list(terminal.run_command({
        "argv": [sys.executable, "-c", "import json, os; print(json.dumps({'secret': os.getenv('OPENAI_API_KEY', 'absent'), 'home': os.getenv('HOME'), 'profile': os.getenv('AWS_PROFILE'), 'cloud_config': os.getenv('CLOUDSDK_CONFIG')}))"],
        "cwd": str(tmp_path), "timeout_seconds": 5,
    }, scratch_dir=tmp_path))[-1]["result"]
    assert json.loads(result["output"]) == {"secret": "absent", "home": terminal.os.environ.get("HOME"), "profile": "data-reader", "cloud_config": str(tmp_path / "cloud-config")}


@pytest.mark.parametrize("decision", ["approve", "reject"])
@pytest.mark.parametrize("mode", ["ask", "auto"])
@pytest.mark.parametrize("unsandboxed", [False, True])
def test_terminal_route_executes_stored_command_and_resumes_analyst(tmp_path, decision, mode, unsandboxed):
    from data_formulator.routes.agents import agent_bp
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.configuration import save_configuration

    save_configuration({"terminal_mode": mode}, 0)
    state = tmp_path / "client-state"
    state.mkdir()
    target = state / "updated"
    code = f"import pathlib; pathlib.Path({str(target)!r}).write_text('approved'); " if unsandboxed else ""
    code += "print('data-source-found')"
    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(agent_bp)
    broker = terminal.TerminalRequests()
    app.extensions["terminal_requests"] = broker
    proposal = broker.propose("local:user", "chat", {
        "argv": [sys.executable, "-c", code], "cwd": str(tmp_path), "purpose": "Find data",
        "dangerouslyDisableSandbox": unsandboxed, "sandboxDisablingReason": "Access client state" if unsandboxed else "",
    }, mode=mode)
    payload = {"model": {}, "input_tables": [], "user_question": "Continue", "conversation_id": "chat",
               "trajectory": [{"role": "user", "content": "Find data"}],
               "terminal_response": {"request_id": proposal["id"], "decision": decision,
                                     "argv": ["this-client-command-must-be-ignored"],
                                     "dangerouslyDisableSandbox": not unsandboxed, "sandboxDisablingReason": "tampered"}}
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
        assert outcome["request"]["dangerouslyDisableSandbox"] == unsandboxed
        assert outcome["request"]["sandboxDisablingReason"] == proposal["sandboxDisablingReason"]
        assert target.exists() == (unsandboxed and decision == "approve")
        assert run.call_count == (1 if decision == "approve" else 0)
        if decision == "approve":
            assert run.call_args.kwargs["scratch_dir"].name == "scratch"
            assert outcome["result"]["sandboxed"] == (not unsandboxed)
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