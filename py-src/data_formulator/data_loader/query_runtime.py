from __future__ import annotations

from contextvars import ContextVar
from multiprocessing import get_context
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from typing import Any

import pyarrow as pa


cancellation: ContextVar[Event | None] = ContextVar("query_cancellation", default=None)


class QueryCancelled(BaseException):
    pass


def check_cancelled() -> None:
    signal = cancellation.get()
    if signal is not None and signal.is_set():
        raise QueryCancelled()


def _query_worker(loader_class, params, method, args, kwargs, output_path, sender):
    try:
        loader = loader_class(params)
        result = getattr(loader, method)(*args, **kwargs)
        if isinstance(result, pa.Table):
            with pa.OSFile(output_path, "wb") as sink:
                with pa.ipc.new_file(sink, result.schema) as writer:
                    writer.write_table(result)
            sender.send(("arrow", None))
        else:
            sender.send(("result", result))
    except Exception as exc:
        sender.send(("error", str(exc)))
    finally:
        sender.close()


def execute_source_query(loader, method: str, *args, **kwargs) -> Any:
    check_cancelled()
    signal = cancellation.get()
    if signal is None or getattr(loader, "QUERY_EXECUTION", "unknown") != "remote_file_scan":
        result = getattr(loader, method)(*args, **kwargs)
        check_cancelled()
        return result

    context = get_context("spawn")
    with TemporaryDirectory(prefix="df-query-") as directory:
        output_path = str(Path(directory) / "result.arrow")
        receiver, sender = context.Pipe(duplex=False)
        process = context.Process(
            target=_query_worker,
            args=(type(loader), loader.params, method, args, kwargs, output_path, sender),
            daemon=True,
        )
        try:
            process.start()
            sender.close()
            while not receiver.poll(0.1):
                check_cancelled()
                if not process.is_alive():
                    raise RuntimeError("Source query worker exited before returning a result")
            check_cancelled()
            try:
                kind, payload = receiver.recv()
            except EOFError as exc:
                raise RuntimeError("Source query worker exited unexpectedly") from exc
            if kind == "error":
                raise RuntimeError(payload)
            if kind == "arrow":
                with pa.OSFile(output_path, "rb") as source:
                    result = pa.ipc.open_file(source).read_all()
            else:
                result = payload
            check_cancelled()
            return result
        finally:
            sender.close()
            receiver.close()
            if process.pid is not None:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=2)
                if process.is_alive():
                    process.kill()
                    process.join()
                process.close()