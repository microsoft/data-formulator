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
    assert f"A task ended: {task.id} (stopped by the user)." in waited and "do not restart it" in waited
