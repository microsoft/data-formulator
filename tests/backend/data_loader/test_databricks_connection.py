"""Tests for the Databricks Unity Catalog loader.

Two layers:

1. **Pure-logic unit tests** — no connection at all. They validate auth-path
   declaration, param validation, the Unity Catalog hierarchy / scope pinning
   and source-table parsing.

2. **Live end-to-end test** (``@pytest.mark.live``) — exercises the real
   ``databricks-sql-connector`` against an actual SQL warehouse. There is no
   faithful local emulator (the SQL-warehouse protocol and Unity Catalog's
   ``information_schema`` have no local stand-in), so this is the real test.
   It is **skipped** unless you provide workspace credentials via env vars::

       DATABRICKS_SERVER_HOSTNAME=adb-....azuredatabricks.net
       DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/xxxx
       DATABRICKS_ACCESS_TOKEN=dapi....

   The easiest zero-infra way to get these is Databricks Free Edition, which
   ships the built-in ``samples`` catalog used below by default. Override the
   probe target with DATABRICKS_TEST_CATALOG / DATABRICKS_TEST_SCHEMA /
   DATABRICKS_TEST_TABLE if your workspace lacks ``samples``.
"""

import os

import pytest

from data_formulator.data_loader.databricks_data_loader import DatabricksDataLoader
from data_formulator.data_loader.external_data_loader import ConnectorParamError

pytestmark = [pytest.mark.backend]


# --------------------------------------------------------------------------- #
# Pure-logic unit tests (no connection)                                       #
# --------------------------------------------------------------------------- #

def _bare_loader(*, catalog: str = "", schema: str = "") -> DatabricksDataLoader:
    """A loader instance with attributes set but no live connection."""
    loader = object.__new__(DatabricksDataLoader)
    loader.params = {k: v for k, v in (("catalog", catalog), ("schema", schema)) if v}
    loader.catalog = catalog
    loader.schema = schema
    return loader


def test_token_is_default_auth_path_without_oauth(monkeypatch) -> None:
    monkeypatch.delenv("DATABRICKS_OAUTH_CLIENT_ID", raising=False)
    paths = DatabricksDataLoader.auth_paths()
    assert [p["id"] for p in paths] == ["token"]
    assert paths[0]["default"] is True
    assert DatabricksDataLoader.delegated_login_config() is None


def test_sign_in_path_appears_when_oauth_configured(monkeypatch) -> None:
    monkeypatch.setenv("DATABRICKS_OAUTH_CLIENT_ID", "client")
    paths = DatabricksDataLoader.auth_paths()
    assert paths[0]["id"] == "databricks_sign_in"
    assert paths[0]["kind"] == "delegated_login"
    assert paths[0]["default"] is True


def test_token_path_requires_access_token() -> None:
    params = {
        "server_hostname": "adb-1.11.azuredatabricks.net",
        "http_path": "/sql/1.0/warehouses/abc",
        "_auth_path": "token",
    }
    with pytest.raises(ConnectorParamError, match="access_token"):
        DatabricksDataLoader.validate_params(params)


def test_hierarchy_is_catalog_schema_table() -> None:
    assert [h["key"] for h in DatabricksDataLoader.catalog_hierarchy()] == [
        "catalog", "schema", "table",
    ]


def test_effective_hierarchy_pins_provided_catalog() -> None:
    loader = _bare_loader(catalog="main")
    assert [h["key"] for h in loader.effective_hierarchy()] == ["schema", "table"]


def test_resolve_source_table_variants() -> None:
    loader = _bare_loader(catalog="main", schema="sales")
    assert loader._resolve_source_table("c.s.t") == ("c", "s", "t")
    assert loader._resolve_source_table("s2.t2") == ("main", "s2", "t2")
    assert loader._resolve_source_table("t3") == ("main", "sales", "t3")


# --------------------------------------------------------------------------- #
# Live end-to-end test (real warehouse; skipped without credentials)          #
# --------------------------------------------------------------------------- #

_LIVE_ENV = ("DATABRICKS_SERVER_HOSTNAME", "DATABRICKS_HTTP_PATH", "DATABRICKS_ACCESS_TOKEN")
_live_ready = all(os.environ.get(k) for k in _LIVE_ENV)


@pytest.mark.live
@pytest.mark.skipif(not _live_ready, reason=f"set {', '.join(_LIVE_ENV)} to run the live Databricks test")
def test_live_unity_catalog_roundtrip() -> None:
    catalog = os.environ.get("DATABRICKS_TEST_CATALOG", "samples")
    schema = os.environ.get("DATABRICKS_TEST_SCHEMA", "nyctaxi")
    table = os.environ.get("DATABRICKS_TEST_TABLE", f"{catalog}.{schema}.trips")

    loader = DatabricksDataLoader({
        "server_hostname": os.environ["DATABRICKS_SERVER_HOSTNAME"],
        "http_path": os.environ["DATABRICKS_HTTP_PATH"],
        "access_token": os.environ["DATABRICKS_ACCESS_TOKEN"],
        "catalog": catalog,
        "schema": schema,
        "_auth_path": "token",
    })

    # 1) Browse: Unity Catalog listing returns 3-part names.
    tables = loader.list_tables()
    assert tables, "expected at least one table in the probe schema"
    names = {t["name"] for t in tables}
    assert table in names, f"{table} not found among {sorted(names)[:10]}"
    probe = next(t for t in tables if t["name"] == table)
    assert probe["path"] == table.split(".")

    # 2) Column types come back via DESCRIBE (works even where the samples
    #    catalog's information_schema.columns is empty).
    col_types = loader.get_column_types(table)
    assert col_types["columns"], "expected get_column_types to return columns"

    # 3) Fetch: real Arrow data path, bounded by LIMIT.
    arrow = loader.fetch_data_as_arrow(table, import_options={"size": 5})
    assert arrow.num_rows <= 5
    assert arrow.num_columns > 0

