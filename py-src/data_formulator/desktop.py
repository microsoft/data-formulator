import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request


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


def run_desktop() -> None:
    try:
        import webview
    except ImportError as exc:
        raise RuntimeError(
            "Desktop support is not installed. Run: uv pip install -e '.[desktop]'"
        ) from exc

    port = _available_port()
    url = f"http://127.0.0.1:{port}"
    os.environ["DATA_FORMULATOR_DESKTOP"] = "1"
    from data_formulator.auth.azure_cli import expose_azure_cli
    expose_azure_cli()
    sys.argv = [sys.argv[0], "--host", "127.0.0.1", "--port", str(port)]

    from data_formulator.app import run_app

    server_thread = threading.Thread(target=run_app, daemon=True)
    server_thread.start()
    _wait_until_ready(url)

    webview.create_window(
        "Data Formulator",
        url,
        width=1440,
        height=900,
        min_size=(960, 640),
    )
    webview.start()


if __name__ == "__main__":
    run_desktop()