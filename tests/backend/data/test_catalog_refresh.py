from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.datalake.catalog_cache import (
    load_catalog,
    record_catalog_refresh_failure,
    save_catalog,
)
from data_formulator.datalake.catalog_refresh import (
    ensure_catalog_freshness, start_catalog_discovery, catalog_discovery_status,
)
from data_formulator.data_loader.external_data_loader import CatalogCachePolicy

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


class _LoaderClass:
    policy = CatalogCachePolicy(
        listing_ttl_seconds=0,
        metadata_ttl_seconds=0,
        refresh_cost="cheap",
        automatic_refresh="while_connected",
        minimum_retry_seconds=300,
    )

    @classmethod
    def catalog_cache_policy(cls) -> CatalogCachePolicy:
        return cls.policy


def test_discovery_runs_outside_request_and_deduplicates(tmp_path):
    loader = MagicMock()
    loader.list_tables.return_value = []
    with patch("data_formulator.datalake.catalog_refresh._REFRESH_EXECUTOR.submit") as submit:
        assert start_catalog_discovery(tmp_path, "src", loader)["status"] == "running"
        assert start_catalog_discovery(tmp_path, "src", loader)["status"] == "running"
        submit.assert_called_once()
        loader.list_tables.assert_not_called()
        assert catalog_discovery_status(tmp_path, "src")["status"] == "running"
        submit.call_args.args[0]()
    assert catalog_discovery_status(tmp_path, "src")["status"] == "complete"
    assert load_catalog(tmp_path, "src") == []


def test_discovery_failure_preserves_cache_and_can_retry(tmp_path):
    save_catalog(tmp_path, "src", [{"name": "cached"}])
    loader = MagicMock()
    loader.list_tables.side_effect = TimeoutError("timed out")
    with patch("data_formulator.datalake.catalog_refresh._REFRESH_EXECUTOR.submit", side_effect=lambda task: task()):
        start_catalog_discovery(tmp_path, "src", loader)
        assert catalog_discovery_status(tmp_path, "src")["status"] == "failed"
        assert load_catalog(tmp_path, "src") == [{"name": "cached"}]
        loader.list_tables.side_effect = None
        loader.list_tables.return_value = [{"name": "fresh"}]
        start_catalog_discovery(tmp_path, "src", loader)
    assert catalog_discovery_status(tmp_path, "src")["status"] == "complete"


def test_discovery_releases_lock_from_worker_thread(tmp_path):
    loader = MagicMock()
    loader.list_tables.return_value = []
    with ThreadPoolExecutor(max_workers=1) as executor, \
         patch("data_formulator.datalake.catalog_refresh._REFRESH_EXECUTOR.submit", wraps=executor.submit) as submit:
        start_catalog_discovery(tmp_path, "src", loader)
    assert catalog_discovery_status(tmp_path, "src")["status"] == "complete"
    from filelock import FileLock
    with FileLock(tmp_path / "catalog_discovery" / "src.lock", timeout=0):
        pass
    submit.assert_called_once()


def test_discovery_status_is_user_scoped_and_detects_worker_exit(tmp_path):
    from data_formulator.datalake.catalog_refresh import _discovery_paths, _write_discovery
    path, _ = _discovery_paths(tmp_path / "alice", "src")
    _write_discovery(path, {"status": "running", "message": "Alice's private catalog"})
    assert catalog_discovery_status(tmp_path / "alice", "src")["status"] == "interrupted"
    assert catalog_discovery_status(tmp_path / "bob", "src") == {"status": "idle"}


def test_cancelled_discovery_does_not_recreate_deleted_cache(tmp_path):
    from data_formulator.datalake.catalog_refresh import cancel_catalog_discovery
    from data_formulator.datalake.catalog_cache import _load_catalog_raw
    loader = MagicMock()
    def listing():
        cancel_catalog_discovery(tmp_path, "src")
        return [{"name": "must-not-save"}]
    loader.list_tables.side_effect = listing
    with patch("data_formulator.datalake.catalog_refresh._REFRESH_EXECUTOR.submit", side_effect=lambda task: task()):
        start_catalog_discovery(tmp_path, "src", loader)
    assert catalog_discovery_status(tmp_path, "src")["status"] == "cancelled"
    assert _load_catalog_raw(tmp_path, "src") is None


def _make_stale(tmp_path: Path, source_id: str) -> None:
    path = tmp_path / "catalog_cache" / f"{source_id}.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["listing_refreshed_at"] = "2020-01-01T00:00:00Z"
    raw["metadata_refreshed_at"] = "2020-01-01T00:00:00Z"
    path.write_text(json.dumps(raw), encoding="utf-8")


def test_disconnected_source_serves_stale_without_refresh(tmp_path: Path) -> None:
    save_catalog(tmp_path, "src", [{"name": "stale"}])
    _make_stale(tmp_path, "src")

    with patch(
        "data_formulator.data_connector.resolve_catalog_refresh_target",
        return_value=(_LoaderClass, None),
    ):
        snapshot = ensure_catalog_freshness(tmp_path, "src")

    assert snapshot is not None
    assert snapshot.listing_freshness == "stale"
    assert snapshot.tables == [{"name": "stale"}]


def test_missing_connected_source_refreshes_synchronously(tmp_path: Path) -> None:
    loader = MagicMock()
    loader.list_tables.return_value = [{"name": "fresh"}]

    with patch(
        "data_formulator.data_connector.resolve_catalog_refresh_target",
        return_value=(_LoaderClass, loader),
    ):
        snapshot = ensure_catalog_freshness(tmp_path, "src")

    assert snapshot is not None
    assert snapshot.tables == [{"name": "fresh"}]
    loader.list_tables.assert_called_once_with()


def test_stale_refresh_is_deduplicated_and_serves_stale(tmp_path: Path) -> None:
    save_catalog(tmp_path, "src", [{"name": "stale"}])
    _make_stale(tmp_path, "src")
    loader = MagicMock()

    with (
        patch(
            "data_formulator.data_connector.resolve_catalog_refresh_target",
            return_value=(_LoaderClass, loader),
        ),
        patch("data_formulator.datalake.catalog_refresh._REFRESH_EXECUTOR.submit") as submit,
    ):
        first = ensure_catalog_freshness(tmp_path, "src")
        second = ensure_catalog_freshness(tmp_path, "src")

    assert first is not None and second is not None
    assert first.tables == second.tables == [{"name": "stale"}]
    submit.assert_called_once()


def test_recent_failure_suppresses_retry_and_preserves_tables(tmp_path: Path) -> None:
    save_catalog(tmp_path, "src", [{"name": "stale"}])
    _make_stale(tmp_path, "src")
    record_catalog_refresh_failure(tmp_path, "src", "timeout")

    with (
        patch(
            "data_formulator.data_connector.resolve_catalog_refresh_target",
            return_value=(_LoaderClass, MagicMock()),
        ),
        patch("data_formulator.datalake.catalog_refresh._REFRESH_EXECUTOR.submit") as submit,
    ):
        snapshot = ensure_catalog_freshness(tmp_path, "src")

    assert snapshot is not None
    assert snapshot.last_refresh_error == "timeout"
    assert load_catalog(tmp_path, "src") == [{"name": "stale"}]
    submit.assert_not_called()