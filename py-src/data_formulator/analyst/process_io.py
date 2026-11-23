# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Run a command as its own process group and read its output without blocking, on POSIX and Windows.

The terminal and background tasks need the same three things: start a command so that it and
everything it starts can be stopped together, read its output while watching a deadline, and
interrupt, then kill, the whole group. POSIX does this with a new session, a selector on the
pipe, and signals to the process group. Windows pipes cannot be selected and Windows has no
process groups in that sense, so there a reader thread drains the pipe, a new console process
group receives CTRL_BREAK, and ``taskkill /T`` ends the process tree.
"""

from __future__ import annotations

import os
import queue
import selectors
import signal
import subprocess
import threading
from typing import Any, IO

WINDOWS = os.name == "nt"


def spawn(argv: list[str], *, cwd: str | os.PathLike, env: dict[str, str]) -> subprocess.Popen:
    """Start ``argv`` in its own process group, stdin closed, stderr merged into a stdout pipe."""
    group: dict[str, Any] = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS
                             else {"start_new_session": True})
    return subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **group)


class OutputPipe:
    """Non-blocking reads from a child's stdout; ``open`` turns False once it reaches end of file."""

    def __init__(self, stream: IO[bytes]):
        self._stream = stream
        self.open = True
        if WINDOWS:
            self._chunks: queue.Queue[bytes] = queue.Queue()
            threading.Thread(target=self._drain, name="df-output", daemon=True).start()
        else:
            self._selector = selectors.DefaultSelector()
            self._selector.register(stream, selectors.EVENT_READ)
            os.set_blocking(stream.fileno(), False)

    def _drain(self) -> None:
        try:
            while chunk := os.read(self._stream.fileno(), 65536):
                self._chunks.put(chunk)
        except OSError:
            pass
        self._chunks.put(b"")

    def read(self, timeout: float) -> list[bytes]:
        """Output that arrived within ``timeout`` seconds (empty if none or the pipe is closed)."""
        if not self.open:
            return []
        chunks: list[bytes] = []
        if WINDOWS:
            try:
                chunks.append(self._chunks.get(timeout=timeout))
                while True:
                    chunks.append(self._chunks.get_nowait())
            except queue.Empty:
                pass
        else:
            for key, _ in self._selector.select(timeout=timeout):
                chunks.append(os.read(key.fd, 65536))
        if b"" in chunks:
            self.open = False
            if not WINDOWS:
                self._selector.unregister(self._stream)
        return [chunk for chunk in chunks if chunk]

    def close(self) -> None:
        if not WINDOWS:
            self._selector.close()
        self._stream.close()


def interrupt(process: subprocess.Popen) -> None:
    """Ask the command and its children to stop (Ctrl+C on POSIX, Ctrl+Break on Windows)."""
    try:
        if WINDOWS:
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGINT)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def kill_tree(process: subprocess.Popen) -> None:
    """End the command and everything it started."""
    if WINDOWS:
        # Children whose parent already exited are no longer in the tree; a job object would also catch those.
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        except (OSError, subprocess.SubprocessError):
            pass
        if process.poll() is None:
            process.kill()
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
