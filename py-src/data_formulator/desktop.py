import ctypes
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from multiprocessing import freeze_support


_INSTANCE_HOST = "127.0.0.1"
_INSTANCE_PORT = int(os.environ.get("DF_DESKTOP_COORDINATION_PORT", "49731"))
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


def _signal_existing_instance(timeout: float = 1.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((_INSTANCE_HOST, _INSTANCE_PORT), timeout=0.2) as client:
                client.sendall(_ACTIVATE_MESSAGE)
                return client.recv(len(_ACTIVATE_ACK)) == _ACTIVATE_ACK
        except OSError:
            time.sleep(0.05)
    return False


def _claim_single_instance() -> socket.socket | None:
    coordinator = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        coordinator.bind((_INSTANCE_HOST, _INSTANCE_PORT))
        coordinator.listen(2)
        return coordinator
    except OSError as exc:
        coordinator.close()
        if _signal_existing_instance():
            return None
        raise RuntimeError(
            f"Desktop coordination port {_INSTANCE_PORT} is already in use"
        ) from exc


def _listen_for_activation(coordinator: socket.socket, activate: threading.Event) -> None:
    while True:
        try:
            connection, _ = coordinator.accept()
        except OSError:
            return
        with connection:
            try:
                message = connection.recv(len(_ACTIVATE_MESSAGE))
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


def run_desktop() -> None:
    # PyInstaller replaces freeze_support() so spawned multiprocessing workers
    # enter their target function instead of relaunching the desktop app.
    freeze_support()
    _configure_standard_streams()

    if os.environ.get("DF_DESKTOP_SELF_TEST") == "1":
        sys.exit(_run_self_test())

    coordinator = _claim_single_instance()
    if coordinator is None:
        return

    try:
        import webview
    except ImportError as exc:
        raise RuntimeError(
            "Desktop support is not installed. Run: uv pip install -e '.[desktop]'"
        ) from exc

    _enable_per_monitor_dpi()

    try:
        activate = threading.Event()
        threading.Thread(
            target=_listen_for_activation,
            args=(coordinator, activate),
            daemon=True,
        ).start()

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
                return
            window.load_url(url)

        threading.Thread(target=_start_backend, daemon=True).start()
        webview.start()
    finally:
        coordinator.close()


if __name__ == "__main__":
    run_desktop()