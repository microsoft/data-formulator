# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Background tasks: long terminal commands that run apart from the agent run that started them.

A task runs with the same sandbox as ``run_terminal`` but in its own thread, with no 60-second
limit (a budget of hours instead). It keeps running when the agent stops; only finishing, the
user, the agent, or its budget ends it. Its full output goes to a log in the workspace scratch
folder, so the agent and the user can read it while it runs and after.

The agent manages tasks with ``wait`` (park until a task ends, the timeout passes, or the run is
stopped; then read a digest and report progress) instead of re-running chunks of work.
Tasks live in this server process: a server restart loses track of them.
"""

from __future__ import annotations

import secrets
import subprocess
import tempfile
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from data_formulator.analyst import process_io

TASK_BUDGET_SECONDS = 2 * 60 * 60
STOP_GRACE_SECONDS = 5.0
LOG_DIR = "tasks"
TAIL_LINES = 40
MAX_TASKS_PER_WORKSPACE = 8
_ENDED = ("completed", "failed", "stopped", "timed_out")


class BackgroundTask:
    def __init__(self, *, owner: str, workspace_id: str, conversation: str, proposal: dict[str, Any], scratch_dir: Path) -> None:
        self.id = "task-" + secrets.token_hex(6)
        self.owner = owner
        self.workspace_id = workspace_id
        self.conversation = conversation
        self.purpose = str(proposal.get("purpose") or "")
        self.argv = list(proposal.get("argv") or [])
        self.cwd = str(proposal.get("cwd") or "")
        self.sandboxed = not proposal.get("dangerouslyDisableSandbox", False)
        self.started = time.time()
        self.ended: float | None = None
        self.status = "running"
        self.exit_code: int | None = None
        self.stopped_by: str | None = None
        self.error: str | None = None
        self.log_name = f"{LOG_DIR}/{self.id}.log"
        self.log_path = scratch_dir / self.log_name
        self.output_bytes = 0
        self.tail: deque[str] = deque(maxlen=TAIL_LINES)
        self._partial = ""
        self._stop = threading.Event()
        self._process: subprocess.Popen | None = None

    @property
    def running(self) -> bool:
        return self.status == "running"

    def record(self, chunk: bytes) -> None:
        self.output_bytes += len(chunk)
        text = self._partial + chunk.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
        *lines, self._partial = text.split("\n")
        self.tail.extend(line for line in lines if line.strip())

    def last_lines(self, count: int = 8) -> list[str]:
        lines = [*self.tail, *([self._partial] if self._partial.strip() else [])]
        return [line[-300:] for line in lines[-count:]]

    def summary(self, *, lines: int = 8) -> dict[str, Any]:
        """What the user's task list and the agent's digest show of the task."""
        now = self.ended or time.time()
        return {
            "id": self.id, "conversation_id": self.conversation, "purpose": self.purpose,
            "command": " ".join(self.argv)[:400], "status": self.status, "started": self.started, "ended": self.ended,
            "elapsed_seconds": round(now - self.started), "exit_code": self.exit_code, "stopped_by": self.stopped_by,
            "error": self.error, "output_bytes": self.output_bytes, "last_lines": self.last_lines(lines),
            "log": f"scratch/{self.log_name}", "sandboxed": self.sandboxed,
        }


class TaskManager:
    """The server's background tasks, by owner and workspace."""

    def __init__(self) -> None:
        self._tasks: dict[str, BackgroundTask] = {}
        self._changed = threading.Condition()

    # -- starting -----------------------------------------------------------------------------

    def start(self, proposal: dict[str, Any], *, scratch_dir: Path, owner: str, workspace_id: str,
              conversation: str) -> BackgroundTask:
        from data_formulator.analyst.skills.terminal.skill import prepare_command

        if sum(task.running for task in self.list(owner, workspace_id)) >= MAX_TASKS_PER_WORKSPACE:
            raise ValueError(f"At most {MAX_TASKS_PER_WORKSPACE} background tasks can run at once; wait for or stop one first.")
        scratch_dir = scratch_dir.resolve(strict=True)
        (scratch_dir / LOG_DIR).mkdir(exist_ok=True)
        runtime = tempfile.TemporaryDirectory(prefix="df-task-")
        try:
            argv, environment, _policy = prepare_command(proposal, scratch_dir=scratch_dir, runtime_dir=Path(runtime.name))
            task = BackgroundTask(owner=owner, workspace_id=workspace_id, conversation=conversation, proposal=proposal,
                                  scratch_dir=scratch_dir)
            log = open(task.log_path, "wb")
            try:
                task._process = process_io.spawn(argv, cwd=task.cwd, env=environment)
            except BaseException:
                log.close()
                raise
        except BaseException:
            runtime.cleanup()
            raise
        with self._changed:
            self._tasks[task.id] = task
        threading.Thread(target=self._watch, args=(task, log, runtime), name=f"df-{task.id}", daemon=True).start()
        return task

    def _watch(self, task: BackgroundTask, log, runtime: tempfile.TemporaryDirectory) -> None:
        process = task._process
        assert process is not None and process.stdout is not None
        pipe = process_io.OutputPipe(process.stdout)
        deadline = task.started + TASK_BUDGET_SECONDS
        interrupted_at: float | None = None
        timed_out = False
        last_output = time.monotonic()
        try:
            while True:
                now = time.monotonic()
                if task._stop.is_set() and interrupted_at is None:
                    interrupted_at = now
                    process_io.interrupt(process)
                if interrupted_at is not None and now - interrupted_at > STOP_GRACE_SECONDS:
                    break
                if time.time() > deadline:
                    timed_out = True
                    break
                if pipe.open:
                    for chunk in pipe.read(0.25):
                        last_output = time.monotonic()
                        log.write(chunk)
                        log.flush()
                        task.record(chunk)
                else:
                    time.sleep(0.25)
                exited = process.poll() is not None
                # Done once the command exits and its output is drained (or a child it left keeps the pipe silent).
                if exited and (not pipe.open or time.monotonic() - last_output > 2):
                    break
        except Exception as exc:  # the task's watcher must always settle the task
            task.error = str(exc)
        finally:
            process_io.kill_tree(process)
            process.wait()
            pipe.close()
            log.close()
            runtime.cleanup()
            task.exit_code = process.returncode
            task.ended = time.time()
            task.status = ("stopped" if task.stopped_by else "timed_out" if timed_out
                           else "failed" if task.error or process.returncode != 0 else "completed")
            with self._changed:
                self._changed.notify_all()

    # -- reading and stopping -----------------------------------------------------------------

    def list(self, owner: str, workspace_id: str) -> list[BackgroundTask]:
        return sorted((task for task in self._tasks.values() if task.owner == owner and task.workspace_id == workspace_id),
                      key=lambda task: task.started)

    def get(self, task_id: str, owner: str, workspace_id: str) -> BackgroundTask | None:
        task = self._tasks.get(task_id)
        return task if task and task.owner == owner and task.workspace_id == workspace_id else None

    def stop(self, task_id: str, owner: str, workspace_id: str, *, by: str) -> BackgroundTask | None:
        """Ask a task to stop: an interrupt, then a forced kill after a short grace period."""
        task = self.get(task_id, owner, workspace_id)
        if task is None or not task.running:
            return task
        task.stopped_by = task.stopped_by or by
        task._stop.set()
        with self._changed:
            self._changed.notify_all()
        return task

    def wait(self, tasks: list[BackgroundTask], timeout: float, *, cancel: threading.Event | None = None) -> str:
        """Park until one of ``tasks`` ends, ``timeout`` seconds pass, or ``cancel`` is set; returns why."""
        running = {task.id for task in tasks if task.running}
        if not running:
            return "ended"
        deadline = time.monotonic() + max(0.0, timeout)
        with self._changed:
            while True:
                if any(not self._tasks[task_id].running for task_id in running):
                    return "ended"
                if cancel is not None and cancel.is_set():
                    return "cancelled"
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return "timeout"
                self._changed.wait(timeout=min(0.5, remaining))


def task_manager(app=None) -> TaskManager:
    """The server's task manager (one per Flask app; a module default without one)."""
    if app is None:
        from flask import current_app, has_app_context
        app = current_app._get_current_object() if has_app_context() else None
    if app is None:
        return _DEFAULT
    return app.extensions.setdefault("background_tasks", TaskManager())


_DEFAULT = TaskManager()


def describe_tasks(tasks: list[BackgroundTask], *, lines: int = 8) -> str:
    """A compact digest of tasks for the agent: status, time, progress and the last output lines."""
    if not tasks:
        return "No background tasks."
    parts = []
    for task in tasks:
        info = task.summary(lines=lines)
        minutes, seconds = divmod(info["elapsed_seconds"], 60)
        status = info["status"] + (f" by the {info['stopped_by']}" if info["stopped_by"] else "")
        if info["exit_code"] is not None and info["status"] != "stopped":
            status += f" (exit {info['exit_code']})"
        head = f"- {info['id']} [{status}, {minutes}m{seconds:02d}s, {info['output_bytes']} bytes of output, log {info['log']}]: {info['purpose']}"
        tail = "\n".join(f"    | {line}" for line in info["last_lines"])
        parts.append(head + (f"\n{tail}" if tail else ""))
    return "\n".join(parts)
