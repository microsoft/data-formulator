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

    with tempfile.TemporaryDirectory() as tmp_dir:
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

    try:
        activate = threading.Event()
        threading.Thread(
            target=_listen_for_activation,
            args=(coordinator, activate),
            daemon=True,
        ).start()

        port = _available_port()
        url = f"http://127.0.0.1:{port}?desktop=1"
        os.environ["DATA_FORMULATOR_DESKTOP"] = "1"
        from data_formulator.auth.azure_cli import expose_azure_cli
        expose_azure_cli()
        sys.argv = [sys.argv[0], "--host", "127.0.0.1", "--port", str(port)]

        from data_formulator.app import run_app

        server_thread = threading.Thread(target=run_app, daemon=True)
        server_thread.start()
        _wait_until_ready(url)

        window = webview.create_window(
            "Data Formulator",
            url,
            width=1440,
            height=900,
            min_size=(960, 640),
        )
        threading.Thread(
            target=_activate_window,
            args=(window, activate),
            daemon=True,
        ).start()
        webview.start()
    finally:
        coordinator.close()


if __name__ == "__main__":
    run_desktop()