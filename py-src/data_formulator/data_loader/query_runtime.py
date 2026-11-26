from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import importlib
import importlib.util
import logging
from multiprocessing import get_context
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore, Event, RLock
from time import monotonic
from typing import Any

import pyarrow as pa

from data_formulator.data_loader.external_data_loader import SourceTableMissing


logger = logging.getLogger(__name__)
_worker_slots = BoundedSemaphore(max(1, int(os.environ.get("DF_QUERY_MAX_WORKERS", "2"))))
_query_timeout = float(os.environ.get("DF_QUERY_TIMEOUT_SECONDS", "300"))
_queue_timeout = float(os.environ.get("DF_QUERY_QUEUE_TIMEOUT_SECONDS", "300"))

cancellation: ContextVar[Event | None] = ContextVar("query_cancellation", default=None)
_run_worker: ContextVar[QueryWorker | None] = ContextVar("query_worker", default=None)


class QueryCancelled(BaseException):
    pass


def check_cancelled() -> None:
    signal = cancellation.get()
    if signal is not None and signal.is_set():
        raise QueryCancelled()


def _loader_class_ref(loader_class: type) -> tuple[str, str, str | None]:
    module = sys.modules.get(loader_class.__module__)
    return loader_class.__module__, loader_class.__qualname__, getattr(module, "__file__", None)


def _resolve_loader_class(module_name: str, qualname: str, module_file: str | None) -> type:
    # Plugin loaders are imported from a file under a synthetic module name
    # (df_plugin_<key>) that only exists in the server process; load the same
    # file here so the spawned worker can run them.
    module = sys.modules.get(module_name)
    if module is None:
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError as exc:
            if exc.name != module_name or not module_file:
                raise
            spec = importlib.util.spec_from_file_location(module_name, module_file)
            if spec is None or spec.loader is None:
                raise
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            try:
                spec.loader.exec_module(module)
            except BaseException:
                sys.modules.pop(module_name, None)
                raise
    resolved: Any = module
    for part in qualname.split("."):
        resolved = getattr(resolved, part)
    return resolved


def _execute_worker_query(loader_class_ref, params, method, args, kwargs, output_path):
    try:
        loader = _resolve_loader_class(*loader_class_ref)(params)
        result = getattr(loader, method)(*args, **kwargs)
        if isinstance(result, pa.Table):
            with pa.OSFile(output_path, "wb") as sink:
                with pa.ipc.new_file(sink, result.schema) as writer:
                    writer.write_table(result)
            return "arrow", None
        else:
            return "result", result
    except SourceTableMissing as exc:
        return "missing", str(exc)
    except Exception as exc:
        return "error", str(exc)


def _query_worker(channel):
    try:
        while True:
            try:
                request = channel.recv()
            except (EOFError, BrokenPipeError):
                raise
            except Exception as exc:
                channel.send(("error", f"Source query request could not be read: {exc}"))
                continue
            response = _execute_worker_query(*request)
            del request
            channel.send(response)
            del response
    except (EOFError, BrokenPipeError):
        pass
    finally:
        channel.close()


class QueryWorker:
    def __init__(self):
        self._process = None
        self._channel = None
        self._slot = None
        self._lock = RLock()

    def _start(self):
        if self._process is not None and self._process.is_alive():
            return
        self.close()
        started = monotonic()
        while not _worker_slots.acquire(timeout=0.1):
            check_cancelled()
            if monotonic() - started >= _queue_timeout:
                raise TimeoutError("Timed out waiting for a source query worker")
        self._slot = _worker_slots
        child = None
        try:
            check_cancelled()
            context = get_context("spawn")
            self._channel, child = context.Pipe()
            self._process = context.Process(target=_query_worker, args=(child,), daemon=True)
            self._process.start()
        except BaseException:
            self.close()
            raise
        finally:
            if child is not None:
                child.close()

    def execute(self, loader, method, args, kwargs):
        with self._lock:
            return self._execute(loader, method, args, kwargs)

    def _execute(self, loader, method, args, kwargs):
        started = monotonic()
        with TemporaryDirectory(prefix="df-query-") as directory:
            output_path = str(Path(directory) / "result.arrow")
            try:
                self._start()
                deadline = monotonic() + _query_timeout
                self._channel.send((_loader_class_ref(type(loader)), loader.params, method, args, kwargs, output_path))
                while not self._channel.poll(0.1):
                    check_cancelled()
                    if monotonic() >= deadline:
                        raise TimeoutError("Source query exceeded its execution deadline")
                    if not self._process.is_alive():
                        raise RuntimeError("Source query worker exited before returning a result")
                check_cancelled()
                kind, payload = self._channel.recv()
            except (EOFError, BrokenPipeError, ConnectionResetError) as exc:
                self.close()
                raise RuntimeError("Source query worker exited unexpectedly") from exc
            except BaseException:
                self.close()
                raise
            if kind == "error":
                raise RuntimeError(payload)
            if kind == "missing":
                raise SourceTableMissing(payload)
            if kind == "arrow":
                with pa.OSFile(output_path, "rb") as source:
                    result = pa.ipc.open_file(source).read_all()
            else:
                result = payload
            check_cancelled()
            logger.info("[SourceQuery] method=%s worker_pid=%s duration_s=%.3f rows=%s",
                        method, self._process.pid, monotonic() - started,
                        result.num_rows if isinstance(result, pa.Table) else None)
            return result

    def close(self):
        with self._lock:
            self._close()

    def _close(self):
        if self._channel is not None:
            self._channel.close()
            self._channel = None
        if self._process is not None:
            if self._process.pid is not None:
                if self._process.is_alive():
                    self._process.terminate()
                self._process.join(timeout=2)
                if self._process.is_alive():
                    self._process.kill()
                    self._process.join()
            self._process.close()
            self._process = None
        if self._slot is not None:
            self._slot.release()
            self._slot = None


@contextmanager
def query_worker_scope(signal: Event, worker: QueryWorker | None = None):
    worker = worker if worker is not None else QueryWorker()
    worker_token = _run_worker.set(worker)
    cancellation_token = cancellation.set(signal)
    try:
        yield worker
    finally:
        try:
            worker.close()
        finally:
            _run_worker.reset(worker_token)
            cancellation.reset(cancellation_token)


def execute_source_query(loader, method: str, *args, **kwargs) -> Any:
    check_cancelled()
    signal = cancellation.get()
    if signal is None or getattr(loader, "QUERY_EXECUTION", "unknown") != "remote_file_scan":
        result = getattr(loader, method)(*args, **kwargs)
        check_cancelled()
        return result
    worker = _run_worker.get()
    if worker is not None:
        return worker.execute(loader, method, args, kwargs)
    with query_worker_scope(signal) as worker:
        return worker.execute(loader, method, args, kwargs)