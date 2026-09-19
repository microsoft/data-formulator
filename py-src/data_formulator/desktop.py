import ctypes
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from multiprocessing import freeze_support
from pathlib import Path


_INSTANCE_HOST = "127.0.0.1"
_INSTANCE_PORT = int(os.environ.get("DF_DESKTOP_COORDINATION_PORT", "0"))
_ACTIVATE_MESSAGE = b"DATA_FORMULATOR_ACTIVATE_V1\n"
_ACTIVATE_ACK = b"DATA_FORMULATOR_ACTIVE_V1\n"


def _configure_standard_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue
        try:
            reconfigure(errors="replace")
        except (OSError, ValueError):
            pass


def _instance_directory() -> Path:
    home = Path(os.environ.get("DATA_FORMULATOR_HOME") or Path.home() / ".data_formulator")
    directory = home.expanduser() / ".desktop"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    return directory


def _signal_existing_instance(timeout: float = 1.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            port = int((_instance_directory() / "port").read_text(encoding="ascii"))
            if not 0 < port < 65536:
                raise ValueError("Invalid desktop activation port")
            with socket.create_connection((_INSTANCE_HOST, port), timeout=0.2) as client:
                client.sendall(_ACTIVATE_MESSAGE)
                acknowledgement = b""
                while len(acknowledgement) < len(_ACTIVATE_ACK):
                    chunk = client.recv(len(_ACTIVATE_ACK) - len(acknowledgement))
                    if not chunk:
                        break
                    acknowledgement += chunk
                return acknowledgement == _ACTIVATE_ACK
        except (OSError, ValueError):
            time.sleep(0.05)
    return False


class _DesktopCoordinator:
    def __init__(self, listener, lock):
        self.listener = listener
        self.lock = lock
        self.activate = threading.Event()
        threading.Thread(
            target=_listen_for_activation,
            args=(listener, self.activate),
            daemon=True,
        ).start()

    def close(self) -> None:
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()
        self.lock.release()


def _claim_single_instance() -> _DesktopCoordinator | None:
    from filelock import FileLock, Timeout

    directory = _instance_directory()
    lock = FileLock(directory / "instance.lock", thread_local=False)
    deadline = time.monotonic() + 5.0
    while True:
        try:
            lock.acquire(timeout=0)
            break
        except Timeout:
            if _signal_existing_instance(timeout=0.3):
                return None
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    "Data Formulator is already running but is not responding. "
                    "Wait for it to finish starting, or close it before trying again."
                ) from None

    coordinator = None
    try:
        coordinator = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        coordinator.bind((_INSTANCE_HOST, _INSTANCE_PORT))
        coordinator.listen(2)
        (directory / "port").write_text(str(coordinator.getsockname()[1]), encoding="ascii")
        return _DesktopCoordinator(coordinator, lock)
    except Exception as exc:
        if coordinator is not None:
            coordinator.close()
        lock.release()
        raise RuntimeError(
            f"Could not open desktop coordination port {_INSTANCE_PORT}: {exc}"
        ) from exc


def _listen_for_activation(coordinator: socket.socket, activate: threading.Event) -> None:
    while True:
        try:
            connection, _ = coordinator.accept()
        except OSError:
            return
        with connection:
            try:
                connection.settimeout(0.5)
                message = b""
                while len(message) < len(_ACTIVATE_MESSAGE):
                    chunk = connection.recv(len(_ACTIVATE_MESSAGE) - len(message))
                    if not chunk:
                        break
                    message += chunk
                if message == _ACTIVATE_MESSAGE:
                    activate.set()
                    connection.sendall(_ACTIVATE_ACK)
            except OSError:
                continue


def _activate_window(window, activate: threading.Event) -> None:
    while True:
        activate.wait()
        activate.clear()
        window.restore()
        window.show()


def _available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
        server_socket.bind(("127.0.0.1", 0))
        return server_socket.getsockname()[1]


def _wait_until_ready(url: str, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.1)
    raise RuntimeError("Data Formulator did not start within 30 seconds")


_LOADING_HTML = """\
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center;
                 background: #fafafa; color: #666; font-family: "Courier New", monospace; user-select: none; }
    .binary-grid { display: flex; flex-direction: column; gap: 2px; margin-bottom: 24px; }
    .binary-row { display: flex; justify-content: center; gap: 3px; }
    .binary-cell { display: flex; width: 14px; height: 20px; align-items: center; justify-content: center;
                                 color: #bdbdbd; font-size: 12px; font-weight: 500; opacity: 0.25;
                                 transition: opacity 0.2s ease, color 0.2s ease; }
    .binary-cell.on { color: #1976d2; opacity: 0.9; }
    .title { font-size: 12px; font-weight: 400; letter-spacing: 3px; text-transform: uppercase;
                     animation: pulse 2.5s ease-in-out infinite; }
    .hint { margin-top: 8px; color: #999; font-size: 11px; }
    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .title { animation: none; } }
</style>
</head>
<body>
    <div class="binary-grid" aria-hidden="true">
        <div class="binary-row"><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span></div>
        <div class="binary-row"><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span></div>
        <div class="binary-row"><span class="binary-cell on">1</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell on">1</span><span class="binary-cell on">1</span><span class="binary-cell">0</span><span class="binary-cell">0</span></div>
    </div>
    <div class="title">Loading Data Formulator...</div>
        <script>
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                const cells = document.querySelectorAll('.binary-cell');
                window.setInterval(() => {
                    cells.forEach((cell) => {
                        if (Math.random() < 0.3) {
                            const isOn = cell.classList.toggle('on');
                            cell.textContent = isOn ? '1' : '0';
                        }
                    });
                }, 120);
            }
        </script>
</body>
</html>
"""


def _enable_per_monitor_dpi() -> None:
    """Upgrade DPI awareness to Per-Monitor V2 before the GUI starts.

    pywebview's WinForms backend only calls SetProcessDPIAware() (system DPI
    aware), which locks the scale factor at startup; on high-DPI displays the
    WebView2 content is then stretched after resizing or maximizing. Per-Monitor
    V2 lets Windows re-render the window for the monitor it is on. It requires
    Windows 10 1703+; failures degrade silently to the backend's default.
    """
    if sys.platform != "win32":
        return
    try:
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        pass


def _run_self_test() -> int:
    """Exercise sandbox execution inside a packaged build.

    Parquet reads pull in pyarrow modules that live in the PyInstaller archive,
    a path that only exists in frozen builds and cannot be covered by pytest.
    """
    import tempfile
    from contextlib import contextmanager

    import pandas as pd

    from data_formulator.sandbox import LocalSandbox

    class _TempWorkspace:
        def __init__(self, path: str) -> None:
            self._path = path

        @contextmanager
        def local_dir(self):
            yield self._path

    # Windows holds the sandbox's parquet handle open past the run, so a strict
    # cleanup raises before the test can report its result.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
        pd.DataFrame({"value": [1, 2, 3]}).to_parquet(
            os.path.join(tmp_dir, "sample.parquet")
        )
        result = LocalSandbox().run_python_code(
            'import pandas as pd\noutput_df = pd.read_parquet("sample.parquet")\n',
            _TempWorkspace(tmp_dir),
            "output_df",
        )

    if result.get("status") == "ok" and len(result["content"]) == 3:
        print("self-test sandbox parquet read: PASS")
    else:
        print(f"self-test sandbox parquet read: FAIL - {result.get('content')}")
        return 1

    return _self_test_clr()


def _self_test_clr() -> int:
    """Load the managed pythonnet assembly the WinForms backend depends on.

    Python.Runtime.dll is a .NET assembly; if packaging rewrites it the CLR
    cannot resolve Loader.Initialize and the GUI dies at startup. Importing
    `clr` reproduces that load without needing a desktop session.
    """
    if sys.platform != "win32":
        return 0
    try:
        import clr  # noqa: F401
    except Exception as exc:  # pragma: no cover - exercised only in frozen builds
        print(f"self-test clr import: FAIL - {exc}")
        return 1
    print("self-test clr import: PASS")
    return 0


def _write_desktop_test_result(result_path: str, passed: bool, message: str) -> None:
    Path(result_path).write_text(json.dumps({"passed": passed, "message": message}) + "\n")


def _gui_is_ready(window) -> bool:
    return window.evaluate_js(
        "window.location.search.includes('desktop=1') && "
        "document.readyState === 'complete' && "
        "Boolean(document.getElementById('root')?.childElementCount)"
    ) is True


def _monitor_gui_test(window, result_path: str) -> None:
    try:
        while not _gui_is_ready(window):
            time.sleep(0.25)
        _write_desktop_test_result(result_path, True, "Frontend mounted in native webview")
        os._exit(0)
    except Exception as exc:
        _write_desktop_test_result(result_path, False, str(exc))
        os._exit(1)


def _gui_test_timeout(result_path: str) -> None:
    _write_desktop_test_result(result_path, False, "GUI self-test exceeded 120 seconds")
    os._exit(1)


def run_desktop() -> None:
    # PyInstaller replaces freeze_support() so spawned multiprocessing workers
    # enter their target function instead of relaunching the desktop app.
    freeze_support()
    _configure_standard_streams()

    if os.environ.get("DF_DESKTOP_SELF_TEST") == "1":
        sys.exit(_run_self_test())

    gui_test = os.environ.get("DF_DESKTOP_GUI_TEST") == "1"
    result_path = os.environ.get("DF_DESKTOP_TEST_RESULT", "")
    if gui_test:
        if not result_path or not os.environ.get("DATA_FORMULATOR_HOME"):
            raise RuntimeError("GUI test requires DF_DESKTOP_TEST_RESULT and an isolated DATA_FORMULATOR_HOME")
        _write_desktop_test_result(result_path, False, "GUI self-test started but did not finish")
        watchdog = threading.Timer(120, _gui_test_timeout, args=(result_path,))
        watchdog.daemon = True
        watchdog.start()

    coordinator = _claim_single_instance()
    if coordinator is None:
        if gui_test:
            _write_desktop_test_result(result_path, False, "Another desktop instance is running")
            sys.exit(1)
        return

    try:
        import webview
    except ImportError as exc:
        coordinator.close()
        raise RuntimeError(
            "Desktop support is not installed. Run: uv pip install -e '.[desktop]'"
        ) from exc

    _enable_per_monitor_dpi()

    try:
        activate = coordinator.activate

        port = _available_port()
        url = f"http://127.0.0.1:{port}?desktop=1"

        # Show a lightweight loading page first so the user gets feedback while
        # the heavy backend imports and the Flask server start up.
        window = webview.create_window(
            "Data Formulator",
            html=_LOADING_HTML,
            width=1440,
            height=900,
            min_size=(960, 640),
        )
        threading.Thread(
            target=_activate_window,
            args=(window, activate),
            daemon=True,
        ).start()

        def _start_backend() -> None:
            # Importing the app pulls in heavy dependencies (litellm, pyarrow,
            # azure, ...) and takes a while; run it off the GUI thread so the
            # loading page stays responsive, then swap in the real URL.
            try:
                os.environ["DATA_FORMULATOR_DESKTOP"] = "1"
                from data_formulator.auth.azure_cli import expose_azure_cli
                expose_azure_cli()
                sys.argv = [sys.argv[0], "--host", "127.0.0.1", "--port", str(port)]

                from data_formulator.app import run_app

                server_thread = threading.Thread(target=run_app, daemon=True)
                server_thread.start()
                _wait_until_ready(url)
            except Exception as exc:  # pragma: no cover - error path
                print(f"Failed to start the backend: {exc}")
                if gui_test:
                    _write_desktop_test_result(result_path, False, f"Backend failed: {exc}")
                    os._exit(1)
                return
            window.load_url(url)

        threading.Thread(target=_start_backend, daemon=True).start()
        if gui_test:
            webview.start(_monitor_gui_test, (window, result_path), gui="edgechromium" if sys.platform == "win32" else None)
            sys.exit(1)
        else:
            webview.start()
    finally:
        coordinator.close()


if __name__ == "__main__":
    run_desktop()