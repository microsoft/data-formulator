from __future__ import annotations

import os
import json
from pathlib import Path
import secrets
import selectors
import signal
import subprocess
import shutil
import sys
import threading
import time
from typing import Any, Generator
from urllib.parse import urlsplit

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult


def require_local_terminal_request() -> None:
    from flask import current_app, has_request_context, request
    from data_formulator.auth.identity import is_local_mode

    if not has_request_context() or not is_local_mode() or os.name != "posix":
        raise ValueError("Terminal is available only in single-user local mode on macOS or Linux.")
    if current_app.config.get("CLI_ARGS", {}).get("disable_data_connectors"):
        raise ValueError("Terminal data access is disabled in this deployment.")
    origin = request.headers.get("Origin", "")
    host = urlsplit(request.host_url)
    if (request.remote_addr not in {"127.0.0.1", "::1"}
            or host.hostname not in {"localhost", "127.0.0.1", "::1"}
            or origin != request.host_url.rstrip("/")
            or request.headers.get("Sec-Fetch-Site") == "cross-site"):
        raise ValueError("Terminal requires a same-origin request to the local application.")


class TerminalRequests:
    def __init__(self) -> None:
        self._pending: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def propose(self, owner: str, conversation: str, spec: dict[str, Any], *, workspace_id: str = "") -> dict[str, Any]:
        argv = spec.get("argv")
        if (not isinstance(argv, list) or not argv or len(argv) > 256
                or any(not isinstance(arg, str) or "\0" in arg for arg in argv)
                or not argv[0] or sum(map(len, argv)) > 16000):
            raise ValueError("argv must be a non-empty list of command arguments (maximum 16000 characters).")
        cwd = spec.get("cwd")
        if not isinstance(cwd, str) or not Path(cwd).expanduser().is_absolute():
            raise ValueError("cwd must be an absolute directory path.")
        directory = Path(cwd).expanduser().resolve(strict=True)
        if not directory.is_dir():
            raise ValueError("cwd must be a directory.")
        purpose = spec.get("purpose")
        if not isinstance(purpose, str) or not purpose.strip() or len(purpose) > 2000:
            raise ValueError("Explain the data discovery or connection purpose (maximum 2000 characters).")
        proposal = {"id": secrets.token_urlsafe(32), "argv": list(argv), "cwd": str(directory),
                    "purpose": purpose.strip(), "decision": "ask", "timeout_seconds": 60}
        with self._lock:
            now = time.monotonic()
            self._pending = {key: value for key, value in self._pending.items() if value["expires"] > now}
            if len(self._pending) >= 128:
                raise ValueError("Too many pending terminal requests. Wait for earlier requests to expire.")
            self._pending[proposal["id"]] = {"owner": owner, "conversation": conversation, "workspace_id": workspace_id,
                                            "expires": now + 600, "proposal": proposal}
        return dict(proposal, argv=list(argv))

    def consume(self, request_id: str, owner: str, conversation: str, *, workspace_id: str = "") -> dict[str, Any]:
        with self._lock:
            pending = self._pending.get(request_id)
            if (pending is None or pending["owner"] != owner or pending["conversation"] != conversation
                    or pending["workspace_id"] != workspace_id
                    or pending["expires"] <= time.monotonic()):
                raise ValueError("Terminal request expired or does not belong to this conversation.")
            del self._pending[request_id]
            return pending["proposal"]


def confined_command(argv: list[str], scratch_dir: Path) -> list[str]:
    scratch = str(scratch_dir.resolve(strict=True))
    if sys.platform == "darwin":
        executable = "/usr/bin/sandbox-exec"
        if not Path(executable).is_file():
            raise OSError("Terminal write confinement is unavailable; command was not run.")
        profile = (
            '(version 1)(deny default)'
            '(allow process-exec process-fork)(allow signal (target children))'
            '(allow file-read* sysctl-read mach-lookup network*)'
            f'(allow file-write* (subpath {json.dumps(scratch)}))'
        )
        return [executable, "-p", profile, *argv]
    if sys.platform == "linux":
        executable = shutil.which("bwrap")
        if not executable:
            raise OSError("Terminal write confinement requires Bubblewrap (bwrap); command was not run.")
        return [executable, "--die-with-parent", "--new-session", "--unshare-all", "--share-net",
                "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--remount-ro", "/proc",
                "--bind", scratch, scratch, "--cap-drop", "ALL", "--", *argv]
    raise OSError("Terminal write confinement is unavailable on this platform; command was not run.")


def run_command(proposal: dict[str, Any], *, scratch_dir: Path) -> Generator[Event, None, None]:
    output = bytearray()
    total = 0
    scratch_dir = scratch_dir.resolve(strict=True)
    if not scratch_dir.is_dir():
        raise OSError("Workspace scratch directory is unavailable; command was not run.")
    argv = confined_command(proposal["argv"], scratch_dir)
    temporary_dir = scratch_dir / "_terminal_tmp"
    cache_dir = scratch_dir / "_terminal_cache"
    temporary_dir.mkdir(exist_ok=True)
    cache_dir.mkdir(exist_ok=True)
    environment = {key: value for key, value in os.environ.items()
                   if key in {"PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT", "WINDIR"}}
    environment.update({"DF_SCRATCH_DIR": str(scratch_dir), "TMPDIR": str(temporary_dir),
                        "TMP": str(temporary_dir), "TEMP": str(temporary_dir),
                        "XDG_CACHE_HOME": str(cache_dir), "PYTHONDONTWRITEBYTECODE": "1"})
    process = subprocess.Popen(
        argv, cwd=proposal["cwd"], env=environment, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
    )

    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    os.set_blocking(process.stdout.fileno(), False)
    deadline = time.monotonic() + proposal["timeout_seconds"]
    last_heartbeat = time.monotonic()
    timed_out = False
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            ready = selector.select(timeout=min(0.25, remaining))
            for key, _ in ready:
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    selector.unregister(key.fd)
                else:
                    total += len(chunk)
                    output.extend(chunk)
                    if len(output) > 32768:
                        del output[:-32768]
            if process.poll() is not None and (not selector.get_map() or not ready):
                break
            if time.monotonic() - last_heartbeat >= 0.25:
                yield {"type": "terminal_running"}
                last_heartbeat = time.monotonic()
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        selector.close()
        process.stdout.close()
    yield {"type": "terminal_result", "result": {
        "exit_code": process.returncode, "timed_out": timed_out,
        "output": bytes(output).decode("utf-8", errors="replace"), "truncated": total > 32768,
    }}


class TerminalSkill:
    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        return ToolResult(text="Terminal execution is a committing action, not an inspection tool.")

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
        from flask import current_app
        from data_formulator.auth.identity import get_identity_id
        from data_formulator.workspace_factory import get_active_workspace_id

        if action != "run_terminal":
            return "Unknown terminal action."
        try:
            require_local_terminal_request()
        except ValueError as exc:
            return str(exc)
        owner = get_identity_id()
        conversation = ctx.payload.get("conversation_id")
        workspace_id = get_active_workspace_id()
        if not owner or not workspace_id or not isinstance(conversation, str) or not conversation:
            return "A local identity, workspace, and conversation are required for terminal access."
        broker = current_app.extensions.setdefault("terminal_requests", TerminalRequests())
        try:
            proposal = broker.propose(owner, conversation, spec, workspace_id=workspace_id)
        except (ValueError, OSError) as exc:
            return str(exc)
        yield {"type": "interact", "terminal_request": proposal}
        return None


def get_skill() -> TerminalSkill:
    return TerminalSkill()