"""Background tasks: long commands that run apart from the agent run that started them."""
from __future__ import annotations

import sys
import time
from threading import Event

import pytest

from data_formulator.analyst.background_tasks import TaskManager, describe_tasks

pytestmark = [pytest.mark.backend]


@pytest.fixture(autouse=True)
def terminal_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "config"))
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))


def _start(manager: TaskManager, tmp_path, code: str, purpose: str = "Count to three"):
    scratch = tmp_path / "scratch"
    scratch.mkdir(exist_ok=True)
    return manager.start({"argv": [sys.executable, "-c", code], "cwd": str(tmp_path), "purpose": purpose},
                         scratch_dir=scratch, owner="me", workspace_id="w1", conversation="run-1")


@pytest.mark.slow
def test_a_task_runs_on_its_own_logs_to_scratch_and_wakes_a_wait(tmp_path):
    manager = TaskManager()
    task = _start(manager, tmp_path, "import time\nfor i in range(3):\n    print('step', i, flush=True)\n    time.sleep(0.3)")
    assert task.running and manager.list("me", "w1") == [task] and manager.list("someone", "w1") == []
    # A wait parks until the task ends, well before its timeout.
    started = time.monotonic()
    assert manager.wait([task], 30) == "ended"
    assert time.monotonic() - started < 10
    assert task.status == "completed" and task.exit_code == 0
    assert task.last_lines() == ["step 0", "step 1", "step 2"]
    assert (tmp_path / "scratch" / task.log_name).read_text().splitlines() == ["step 0", "step 1", "step 2"]
    digest = describe_tasks([task])
    assert task.id in digest and "completed (exit 0)" in digest and "| step 2" in digest and "Count to three" in digest


@pytest.mark.slow
def test_stopping_a_task_interrupts_it_and_a_waiting_agent_learns_who_stopped_it(tmp_path):
    manager = TaskManager()
    task = _start(manager, tmp_path, "import time\nprint('working', flush=True)\nwhile True: time.sleep(0.1)")
    assert manager.wait([task], 0.5) == "timeout"
    manager.stop(task.id, "me", "w1", by="user")
    assert manager.wait([task], 15) == "ended"
    assert task.status == "stopped" and task.stopped_by == "user"
    assert "stopped by the user" in describe_tasks([task]) and "| working" in describe_tasks([task])


@pytest.mark.slow
def test_a_stopped_run_ends_its_wait_but_not_its_tasks(tmp_path):
    manager = TaskManager()
    task = _start(manager, tmp_path, "import time\nwhile True: time.sleep(0.1)")
    cancel = Event()
    cancel.set()
    assert manager.wait([task], 30, cancel=cancel) == "cancelled"
    assert task.running
    manager.stop(task.id, "me", "w1", by="user")
    manager.wait([task], 15)
    assert not task.running


@pytest.mark.slow
def test_the_agent_waits_on_its_tasks_and_hears_the_user_stopped_one(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from data_formulator.analyst import background_tasks
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.analyst.skills.terminal import skill as terminal

    manager = TaskManager()
    monkeypatch.setattr(background_tasks, "_DEFAULT", manager)
    monkeypatch.setattr(terminal, "_task_scope", lambda ctx: ("me", "w1", "run-1"))
    task = _start(manager, tmp_path, "import time\nprint('page 1', flush=True)\nwhile True: time.sleep(0.1)", "Crawl the org")
    context = SkillContext(client=None, workspace=None, payload={"conversation_id": "run-1"}, runtime=SimpleNamespace(cancel=None))
    # A check (timeout 0) reports progress without waiting.
    time.sleep(0.5)
    checked = terminal.TerminalSkill().handle_tool("wait_tasks", {"timeout_seconds": 0}, context).text
    assert "No task ended in 0s." in checked and "Crawl the org" in checked and "| page 1" in checked
    # The user stops it from their task list; the waiting agent hears it was their decision.
    import threading
    threading.Timer(0.5, lambda: manager.stop(task.id, "me", "w1", by="user")).start()
    waited = terminal.TerminalSkill().handle_tool("wait_tasks", {"timeout_seconds": 120}, context).text
    assert f"Ended since you last heard: {task.id} (stopped by the user)." in waited and "do not restart it" in waited


@pytest.mark.slow
def test_a_task_that_fails_at_once_is_reported_as_ended_not_running(tmp_path, monkeypatch):
    from data_formulator.analyst.skills.terminal import skill as terminal

    manager = TaskManager()
    monkeypatch.setattr("data_formulator.analyst.background_tasks.task_manager", lambda app=None: manager)
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    start = lambda code: terminal.start_background(
        {"argv": [sys.executable, "-c", code], "cwd": str(tmp_path), "purpose": "Count"},
        scratch_dir=scratch, owner="me", workspace_id="w1", conversation="run-1")

    failed = start("import sys\nprint('timeout: command not found', flush=True)\nsys.exit(127)")
    assert failed["exit_code"] == 127 and failed["task_status"] == "failed"
    assert "failed right away" in failed["output"] and "timeout: command not found" in failed["output"]
    assert failed["ended"] >= failed["started"] > 0

    running = start("import time\nwhile True: time.sleep(0.1)")
    assert running["exit_code"] is None and "task_status" not in running and "ended" not in running
    # The thread counts a task's time from its start, on this machine's clock.
    assert abs(running["started"] - time.time()) < 10
    manager.stop(running["background_task"], "me", "w1", by="user")


@pytest.mark.slow
def test_a_wait_reports_each_ending_once_even_between_waits_and_covers_every_run(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from data_formulator.analyst import background_tasks
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.analyst.skills.terminal import skill as terminal

    manager = TaskManager()
    monkeypatch.setattr(background_tasks, "_DEFAULT", manager)
    # The request after a stop is another run; it follows the tasks the earlier one started.
    monkeypatch.setattr(terminal, "_task_scope", lambda ctx: ("me", "w1", "run-2"))
    quick = _start(manager, tmp_path, "print('done', flush=True)", "Quick")
    slow = _start(manager, tmp_path, "import time\nwhile True: time.sleep(0.1)", "Slow")
    context = SkillContext(client=None, workspace=None, payload={"conversation_id": "run-2"}, runtime=SimpleNamespace(cancel=None))
    assert manager.wait([quick], 15) == "ended"
    # It ended while the agent was busy elsewhere: the next wait returns it at once.
    started = time.monotonic()
    first = terminal.TerminalSkill().handle_tool("wait_tasks", {"timeout_seconds": 120}, context).text
    assert time.monotonic() - started < 5
    assert f"Ended since you last heard: {quick.id} (completed)." in first and "Slow" in first
    # Told once: the next wait is about the task still running.
    again = terminal.TerminalSkill().handle_tool("wait_tasks", {"timeout_seconds": 0}, context).text
    assert "No task ended in 0s." in again and quick.id not in again and slow.id in again
    manager.stop(slow.id, "me", "w1", by="user")


@pytest.mark.slow
def test_the_user_can_ask_a_waiting_run_for_an_update(tmp_path, monkeypatch):
    import threading
    from types import SimpleNamespace
    from data_formulator.analyst import background_tasks
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.analyst.skills.terminal import skill as terminal

    manager = TaskManager()
    monkeypatch.setattr(background_tasks, "_DEFAULT", manager)
    monkeypatch.setattr(terminal, "_task_scope", lambda ctx: ("me", "w1", "run-1"))
    task = _start(manager, tmp_path, "import time\nwhile True: time.sleep(0.1)", "Crawl")
    context = SkillContext(client=None, workspace=None, payload={"conversation_id": "run-1"}, runtime=SimpleNamespace(cancel=None))
    # Another run's check-in does not end this wait early; this run's does, and the task keeps running.
    threading.Timer(0.3, lambda: manager.nudge("me", "w1", "run-other")).start()
    threading.Timer(0.8, lambda: manager.nudge("me", "w1", "run-1")).start()
    started = time.monotonic()
    waited = terminal.TerminalSkill().handle_tool("wait_tasks", {"timeout_seconds": 120}, context).text
    assert time.monotonic() - started < 10
    assert waited.startswith("The user asked for an update now.") and task.running
    # A check-in no wait picked up is for the run's next step, once.
    manager.nudge("me", "w1", "run-1")
    assert manager.take_nudge("me", "w1", "run-1") and not manager.take_nudge("me", "w1", "run-1")
    manager.stop(task.id, "me", "w1", by="user")


@pytest.mark.slow
def test_a_task_asks_to_wake_the_agent_when_it_ends_or_at_its_check_in(tmp_path):
    from data_formulator.analyst import background_tasks

    manager = TaskManager()
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    start = lambda code, **wake: manager.start({"argv": [sys.executable, "-c", code], "cwd": str(tmp_path), "purpose": "P", **wake},
                                               scratch_dir=scratch, owner="me", workspace_id="w1", conversation="run-1")
    ended = start("print(1)")
    quiet = start("print(1)", wake="none")
    stopped = start("import time\nwhile True: time.sleep(0.1)")
    checking = start("import time\nwhile True: time.sleep(0.1)", check_in_seconds=30)
    assert manager.wait([ended], 15) == "ended" and manager.wait([quiet], 15) == "ended"
    manager.stop(stopped.id, "me", "w1", by="user")
    assert manager.wait([stopped], 15) == "ended"
    assert [task.wake_due() for task in (ended, quiet, stopped)] == ["ended", None, None]
    assert ended.summary()["wake_due"] == "ended"
    # Once the agent is told, the ending wakes nothing more.
    manager.tell([ended])
    assert ended.wake_due() is None
    assert checking.wake_due() is None and checking.wake_due(now=checking.started + 31) == "check_in"
    # Old news wakes nothing: the agent hears of it with the user's next message.
    assert checking.wake_due(now=checking.started + 30 + background_tasks.WAKE_WINDOW_SECONDS + 1) is None
    late = start("print(1)")
    assert manager.wait([late], 15) == "ended" and late.wake_due() == "ended"
    assert late.wake_due(now=late.ended + background_tasks.WAKE_WINDOW_SECONDS + 1) is None
    checking.check_in_at = time.time() - 1
    manager.tell([checking])
    assert checking.wake_due() is None and checking.running
    manager.stop(checking.id, "me", "w1", by="user")


def test_wake_options_are_checked_when_a_task_is_proposed():
    from data_formulator.analyst.skills.terminal.skill import _wake_options

    assert _wake_options({}) == {"wake": "on_end"}
    assert _wake_options({"wake": "none", "check_in_seconds": 600}) == {"wake": "none", "check_in_seconds": 600}
    for bad in ({"wake": "later"}, {"check_in_seconds": 5}, {"check_in_seconds": "600"}, {"check_in_seconds": 10**6}):
        with pytest.raises(ValueError):
            _wake_options(bad)


def test_the_check_in_route_asks_the_users_run_for_an_update():
    from unittest.mock import patch
    import flask
    from data_formulator.error_handler import register_error_handlers
    from data_formulator.routes.tasks import task_bp

    app = flask.Flask(__name__)
    app.register_blueprint(task_bp)
    register_error_handlers(app)
    manager = app.extensions.setdefault("background_tasks", TaskManager())
    with patch("data_formulator.routes.tasks.get_identity_id", return_value="me"), \
            patch("data_formulator.routes.tasks.get_active_workspace_id", return_value="w1"):
        assert app.test_client().post("/api/tasks/checkin", json={}).get_json()["error"]["code"] == "INVALID_REQUEST"
        assert app.test_client().post("/api/tasks/checkin", json={"conversation_id": "run-1"}).get_json()["status"] == "success"
    assert manager.take_nudge("me", "w1", "run-1") and not manager.take_nudge("someone", "w1", "run-1")
