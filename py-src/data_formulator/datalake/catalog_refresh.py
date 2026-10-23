from __future__ import annotations

import logging
import json
import os
import threading
from concurrent.futures import CancelledError, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from filelock import FileLock, Timeout
from flask import copy_current_request_context, has_request_context

from data_formulator.datalake.catalog_cache import (
    CatalogSnapshot,
    load_catalog_snapshot,
    record_catalog_refresh_failure,
    save_catalog,
)
from data_formulator.data_loader.external_data_loader import CatalogCachePolicy
from data_formulator.datalake.naming import safe_source_id
from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)

_REFRESH_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="catalog-refresh")
_REFRESH_LOCK = threading.Lock()
_REFRESHING: set[tuple[str, str]] = set()


def _discovery_paths(root: Path | str, source_id: str) -> tuple[Path, Path]:
    jail = ConfinedDir(Path(root) / "catalog_discovery", mkdir=True)
    name = safe_source_id(source_id)
    return jail.resolve(f"{name}.json"), jail.resolve(f"{name}.lock")


def _write_discovery(path: Path, state: dict[str, Any]) -> None:
    temporary = path.with_suffix(f".{uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(state), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def catalog_discovery_status(root: Path | str, source_id: str) -> dict[str, Any]:
    path, lock_path = _discovery_paths(root, source_id)
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "idle"}
    if state.get("status") == "running":
        try:
            with FileLock(lock_path, timeout=0):
                return {"status": "interrupted", "message": "Discovery was interrupted. Retry to continue."}
        except Timeout:
            pass
    return state


def cancel_catalog_discovery(root: Path | str, source_id: str) -> None:
    path, _ = _discovery_paths(root, source_id)
    with FileLock(path.with_suffix(".state.lock"), timeout=10):
        _write_discovery(path, {"status": "cancelled", "message": "Discovery cancelled."})


def start_catalog_discovery(root: Path | str, source_id: str, loader: Any) -> dict[str, Any]:
    path, lock_path = _discovery_paths(root, source_id)
    lock = FileLock(lock_path, timeout=0, thread_local=False)
    try:
        lock.acquire()
    except Timeout:
        return {"status": "running", "message": "Discovering tables and files..."}
    state = {"status": "running", "message": "Discovering tables and files..."}
    try:
        with FileLock(path.with_suffix(".state.lock"), timeout=10):
            _write_discovery(path, state)

        def run() -> None:
            previous_callback = getattr(loader, "progress_callback", None)
            def check_cancelled() -> None:
                if json.loads(path.read_text(encoding="utf-8")).get("status") == "cancelled":
                    raise CancelledError()

            def progress(message: str) -> None:
                with FileLock(path.with_suffix(".state.lock"), timeout=10):
                    check_cancelled()
                    _write_discovery(path, {"status": "running", "message": message})

            try:
                check_cancelled()
                loader.progress_callback = progress
                tables = loader.list_tables()
                loader.ensure_table_keys(tables)
                with FileLock(path.with_suffix(".state.lock"), timeout=10):
                    check_cancelled()
                    save_catalog(root, source_id, tables, refresh_kind="listing")
                    from data_formulator.datalake.catalog_cache import _load_catalog_raw
                    if _load_catalog_raw(root, source_id) is None:
                        raise OSError("Catalog could not be saved")
                    _write_discovery(path, {"status": "complete", "message": ""})
            except CancelledError:
                pass
            except Exception as exc:
                from data_formulator.data_loader.connector_errors import classify_connector_error
                error = classify_connector_error(exc, operation="catalog").to_error_dict()
                with FileLock(path.with_suffix(".state.lock"), timeout=10):
                    if json.loads(path.read_text(encoding="utf-8")).get("status") != "cancelled":
                        _write_discovery(path, {"status": "failed", "message": error["message"], "error": error})
                logger.debug("Catalog discovery failed for %s", source_id, exc_info=True)
            finally:
                loader.progress_callback = previous_callback
                lock.release()

        task = copy_current_request_context(run) if has_request_context() else run
        _REFRESH_EXECUTOR.submit(task)
    except Exception:
        lock.release()
        raise
    return state


def _retry_allowed(snapshot: CatalogSnapshot, policy: CatalogCachePolicy) -> bool:
    if not snapshot.last_refresh_error or not snapshot.last_refresh_attempt_at:
        return True
    try:
        attempted_at = datetime.fromisoformat(
            snapshot.last_refresh_attempt_at.replace("Z", "+00:00")
        )
        if attempted_at.tzinfo is None:
            attempted_at = attempted_at.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - attempted_at).total_seconds()
        return elapsed >= max(0, policy.minimum_retry_seconds)
    except ValueError:
        return True


def _refresh_catalog(
    workspace_root: Path,
    source_id: str,
    loader: Any,
    policy: CatalogCachePolicy,
) -> None:
    try:
        if policy.automatic_refresh_kind == "full":
            tables = loader.sync_catalog_metadata()
        else:
            tables = loader.list_tables()
        if hasattr(loader, "ensure_table_keys"):
            loader.ensure_table_keys(tables)
        save_catalog(
            workspace_root,
            source_id,
            tables,
            refresh_kind=policy.automatic_refresh_kind,
        )
    except Exception as exc:
        record_catalog_refresh_failure(workspace_root, source_id, str(exc))
        logger.debug("Automatic catalog refresh failed for %s", source_id, exc_info=True)


def _complete_refresh(
    key: tuple[str, str],
    workspace_root: Path,
    source_id: str,
    loader: Any,
    policy: CatalogCachePolicy,
) -> None:
    try:
        _refresh_catalog(workspace_root, source_id, loader, policy)
    finally:
        with _REFRESH_LOCK:
            _REFRESHING.discard(key)


def ensure_catalog_freshness(
    workspace_root: Path | str,
    source_id: str,
) -> CatalogSnapshot | None:
    """Return the current snapshot and safely refresh it when policy permits."""
    from data_formulator.data_connector import resolve_catalog_refresh_target

    root = Path(workspace_root)
    try:
        loader_class, loader = resolve_catalog_refresh_target(source_id)
    except Exception:
        return load_catalog_snapshot(
            root,
            source_id,
            listing_ttl_seconds=None,
            metadata_ttl_seconds=None,
        )

    if hasattr(loader_class, "catalog_cache_policy"):
        policy = loader_class.catalog_cache_policy()
    else:
        policy = CatalogCachePolicy(
            refresh_cost="free",
            automatic_refresh="always",
            automatic_refresh_kind="full",
        )
    snapshot = load_catalog_snapshot(
        root,
        source_id,
        listing_ttl_seconds=policy.listing_ttl_seconds,
        metadata_ttl_seconds=policy.metadata_ttl_seconds,
    )
    may_refresh = (
        loader is not None
        and policy.automatic_refresh != "never"
        and (
            policy.automatic_refresh == "always"
            or policy.automatic_refresh == "while_connected"
        )
    )
    if not may_refresh:
        return snapshot

    target_freshness = (
        snapshot.metadata_freshness
        if snapshot is not None and policy.automatic_refresh_kind == "full"
        else snapshot.listing_freshness if snapshot is not None else "unknown"
    )
    should_refresh = (
        snapshot is None
        or (
            target_freshness != "fresh"
            and _retry_allowed(snapshot, policy)
        )
    )
    if not should_refresh:
        return snapshot

    key = (str(root.resolve()), source_id)
    with _REFRESH_LOCK:
        if key in _REFRESHING:
            return snapshot
        _REFRESHING.add(key)

    if snapshot is None:
        _complete_refresh(key, root, source_id, loader, policy)
        return load_catalog_snapshot(
            root,
            source_id,
            listing_ttl_seconds=policy.listing_ttl_seconds,
            metadata_ttl_seconds=policy.metadata_ttl_seconds,
        )

    _REFRESH_EXECUTOR.submit(
        _complete_refresh,
        key,
        root,
        source_id,
        loader,
        policy,
    )
    return snapshot