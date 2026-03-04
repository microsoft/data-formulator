"""
Tests for AzureSQLDataLoader and FabricLakehouseDataLoader.

All network/driver calls are replaced with in-process mocks so the tests run
without any real Azure SQL or Fabric endpoints, ODBC drivers, or AAD credentials.

Simulated environment:
  - Database schema: two tables (sales.orders, sales.customers)
  - orders:  id (int), amount (float), status (nvarchar) — 3 sample rows
  - customers: id (int), name (nvarchar), city (nvarchar) — 2 sample rows

The mocks intercept:
  - connectorx.read_sql   → used by AzureSQLDataLoader SQL-auth path
  - pyodbc.connect        → used by both loaders for Entra-ID auth
  - azure.identity.*Credential.get_token → returns a fake AAD token
"""

from __future__ import annotations

import json
import struct
import types
from unittest.mock import MagicMock, patch, PropertyMock
from typing import Any

import pandas as pd
import pyarrow as pa
import pytest

# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

_TABLES_DF = pd.DataFrame(
    {
        "TABLE_SCHEMA": ["sales", "sales"],
        "TABLE_NAME": ["orders", "customers"],
        "TABLE_TYPE": ["BASE TABLE", "BASE TABLE"],
    }
)

_ORDERS_COLS_DF = pd.DataFrame(
    {
        "COLUMN_NAME": ["id", "amount", "status"],
        "DATA_TYPE": ["int", "float", "nvarchar"],
        "IS_NULLABLE": ["NO", "YES", "YES"],
        "COLUMN_DEFAULT": [None, None, None],
        "CHARACTER_MAXIMUM_LENGTH": [None, None, 50],
        "NUMERIC_PRECISION": [10, 15, None],
        "NUMERIC_SCALE": [0, 2, None],
    }
)

_CUSTOMERS_COLS_DF = pd.DataFrame(
    {
        "COLUMN_NAME": ["id", "name", "city"],
        "DATA_TYPE": ["int", "nvarchar", "nvarchar"],
        "IS_NULLABLE": ["NO", "YES", "YES"],
        "COLUMN_DEFAULT": [None, None, None],
        "CHARACTER_MAXIMUM_LENGTH": [None, 100, 50],
        "NUMERIC_PRECISION": [10, None, None],
        "NUMERIC_SCALE": [0, None, None],
    }
)

_ORDERS_DATA_DF = pd.DataFrame(
    {
        "id": [1, 2, 3],
        "amount": [99.99, 149.0, 299.50],
        "status": ["shipped", "pending", "delivered"],
    }
)

_CUSTOMERS_DATA_DF = pd.DataFrame(
    {
        "id": [1, 2],
        "name": ["Alice", "Bob"],
        "city": ["Seattle", "New York"],
    }
)

_COUNT_ORDERS_DF = pd.DataFrame({"row_count": [3]})
_COUNT_CUSTOMERS_DF = pd.DataFrame({"row_count": [2]})


# ---------------------------------------------------------------------------
# Query router: dispatches query strings to mock DataFrames
# ---------------------------------------------------------------------------

def _query_router(sql: str) -> pd.DataFrame:
    """Map a SQL query string to a simulated result DataFrame."""
    sql_upper = sql.strip().upper()

    # Connection probe
    if sql_upper == "SELECT 1":
        return pd.DataFrame({"col": [1]})

    # Table listing
    if "INFORMATION_SCHEMA.TABLES" in sql_upper:
        return _TABLES_DF

    # Column metadata
    if "INFORMATION_SCHEMA.COLUMNS" in sql_upper:
        if "'ORDERS'" in sql_upper or "ORDERS" in sql_upper:
            return _ORDERS_COLS_DF
        return _CUSTOMERS_COLS_DF

    # Row count
    if "COUNT(*)" in sql_upper:
        if "ORDERS" in sql_upper:
            return _COUNT_ORDERS_DF
        return _COUNT_CUSTOMERS_DF

    # Sample / full data fetch
    if "ORDERS" in sql_upper:
        return _ORDERS_DATA_DF
    return _CUSTOMERS_DATA_DF


def _make_arrow(sql: str) -> pa.Table:
    """Return a PyArrow Table for the given SQL query."""
    return pa.Table.from_pandas(_query_router(sql), preserve_index=False)


# ---------------------------------------------------------------------------
# Fixture factories
# ---------------------------------------------------------------------------

def _make_cx_mock():
    """Mock connectorx.read_sql to route queries via _make_arrow."""
    cx_mock = MagicMock()
    cx_mock.read_sql.side_effect = lambda url, query, **kw: _make_arrow(query)
    return cx_mock


def _make_pyodbc_mock():
    """Mock pyodbc.connect; the returned connection routes pd.read_sql queries."""
    conn = MagicMock()
    # pyodbc connections are used as context managers for pd.read_sql
    conn.__enter__ = MagicMock(return_value=conn)
    conn.__exit__ = MagicMock(return_value=False)
    conn.close = MagicMock()
    return conn


def _make_token_mock():
    """Return a mock azure.identity credential whose get_token() always succeeds."""
    token = MagicMock()
    token.token = "fake-aad-token-for-testing"
    cred = MagicMock()
    cred.get_token.return_value = token
    return cred


# ---------------------------------------------------------------------------
# Helper: build a loader instance without real I/O
# ---------------------------------------------------------------------------

def _build_azure_sql_loader_sql_auth() -> "AzureSQLDataLoader":
    """Instantiate AzureSQLDataLoader using SQL authentication with cx mocked."""
    from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

    cx_mock = _make_cx_mock()
    with patch.dict("sys.modules", {"connectorx": cx_mock}):
        loader = AzureSQLDataLoader(
            {
                "server": "myserver.database.windows.net",
                "database": "mydb",
                "user": "sa",
                "password": "MyP@ss",
                "port": "1433",
            }
        )
    # Attach the cx mock so we can call methods later
    loader._cx_mock = cx_mock
    return loader


def _build_azure_sql_loader_entra(cred_mock=None) -> "AzureSQLDataLoader":
    """Instantiate AzureSQLDataLoader using Entra ID authentication."""
    from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

    if cred_mock is None:
        cred_mock = _make_token_mock()

    pyodbc_mock = MagicMock()
    conn = _make_pyodbc_mock()
    pyodbc_mock.connect.return_value = conn

    with (
        patch.dict("sys.modules", {"pyodbc": pyodbc_mock}),
        patch(
            "data_formulator.data_loader.azure_sql_data_loader.AzureSQLDataLoader._get_access_token",
            return_value="fake-token",
        ),
    ):
        loader = AzureSQLDataLoader(
            {
                "server": "myserver.database.windows.net",
                "database": "mydb",
                "client_id": "cid",
                "client_secret": "csec",
                "tenant_id": "tid",
            }
        )
    loader._pyodbc_mock = pyodbc_mock
    return loader


def _build_fabric_loader(cred_mock=None) -> "FabricLakehouseDataLoader":
    """Instantiate FabricLakehouseDataLoader with all I/O mocked."""
    from data_formulator.data_loader.fabric_lakehouse_data_loader import (
        FabricLakehouseDataLoader,
    )

    if cred_mock is None:
        cred_mock = _make_token_mock()

    pyodbc_mock = MagicMock()
    conn = _make_pyodbc_mock()
    pyodbc_mock.connect.return_value = conn

    with (
        patch.dict("sys.modules", {"pyodbc": pyodbc_mock}),
        patch(
            "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
            return_value="fake-token",
        ),
    ):
        loader = FabricLakehouseDataLoader(
            {
                "server": "myworkspace.datawarehouse.fabric.microsoft.com",
                "database": "MyLakehouse",
                "client_id": "cid",
                "client_secret": "csec",
                "tenant_id": "tid",
            }
        )
    loader._pyodbc_mock = pyodbc_mock
    return loader


# ===========================================================================
# Tests: module-level helpers
# ===========================================================================


class TestEscHelper:
    def test_no_quotes(self):
        from data_formulator.data_loader.azure_sql_data_loader import _esc

        assert _esc("myschema") == "myschema"

    def test_single_quote_escaped(self):
        from data_formulator.data_loader.azure_sql_data_loader import _esc

        assert _esc("o'reilly") == "o''reilly"

    def test_multiple_quotes(self):
        from data_formulator.data_loader.azure_sql_data_loader import _esc

        assert _esc("it's a test's value") == "it''s a test''s value"

    def test_fabric_esc_same_behaviour(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import _esc

        assert _esc("it's") == "it''s"


class TestTokenBytes:
    def test_structure(self):
        from data_formulator.data_loader.azure_sql_data_loader import _token_bytes

        result = _token_bytes("hello")
        encoded = "hello".encode("UTF-16-LE")
        length = struct.unpack_from("<I", result)[0]
        assert length == len(encoded)
        assert result[4:] == encoded

    def test_empty_token(self):
        from data_formulator.data_loader.azure_sql_data_loader import _token_bytes

        result = _token_bytes("")
        assert len(result) == 4  # only the 4-byte length prefix, no data


# ===========================================================================
# Tests: list_params / auth_instructions (no network)
# ===========================================================================


class TestAzureSQLStaticMethods:
    def test_list_params_names(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        params = AzureSQLDataLoader.list_params()
        names = [p["name"] for p in params]
        assert "server" in names
        assert "database" in names
        assert "user" in names
        assert "password" in names
        assert "client_id" in names
        assert "client_secret" in names
        assert "tenant_id" in names

    def test_list_params_required_fields(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        for p in AzureSQLDataLoader.list_params():
            assert "name" in p
            assert "type" in p
            assert "required" in p
            assert "description" in p

    def test_server_and_database_are_required(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        by_name = {p["name"]: p for p in AzureSQLDataLoader.list_params()}
        assert by_name["server"]["required"] is True
        assert by_name["database"]["required"] is True

    def test_auth_instructions_nonempty(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        instr = AzureSQLDataLoader.auth_instructions()
        assert isinstance(instr, str) and len(instr) > 50

    def test_registered_in_data_loaders(self):
        from data_formulator.data_loader import DATA_LOADERS, AzureSQLDataLoader

        assert "azure_sql" in DATA_LOADERS
        assert DATA_LOADERS["azure_sql"] is AzureSQLDataLoader


class TestFabricLakehouseStaticMethods:
    def test_list_params_names(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        params = FabricLakehouseDataLoader.list_params()
        names = [p["name"] for p in params]
        assert "server" in names
        assert "database" in names
        assert "client_id" in names
        assert "client_secret" in names
        assert "tenant_id" in names

    def test_no_user_password_params(self):
        """Fabric does not support SQL auth; user/password should not appear."""
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        names = [p["name"] for p in FabricLakehouseDataLoader.list_params()]
        assert "user" not in names
        assert "password" not in names

    def test_server_and_database_are_required(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        by_name = {p["name"]: p for p in FabricLakehouseDataLoader.list_params()}
        assert by_name["server"]["required"] is True
        assert by_name["database"]["required"] is True

    def test_auth_instructions_nonempty(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        instr = FabricLakehouseDataLoader.auth_instructions()
        assert isinstance(instr, str) and len(instr) > 50

    def test_registered_in_data_loaders(self):
        from data_formulator.data_loader import DATA_LOADERS, FabricLakehouseDataLoader

        assert "fabric_lakehouse" in DATA_LOADERS
        assert DATA_LOADERS["fabric_lakehouse"] is FabricLakehouseDataLoader


# ===========================================================================
# Tests: AzureSQLDataLoader — init validation
# ===========================================================================


class TestAzureSQLInitValidation:
    def test_missing_server_raises(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        with pytest.raises(ValueError, match="server"):
            cx = _make_cx_mock()
            with patch.dict("sys.modules", {"connectorx": cx}):
                AzureSQLDataLoader({"server": "", "database": "mydb", "user": "u", "password": "p"})

    def test_missing_database_raises(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        with pytest.raises(ValueError, match="[Dd]atabase"):
            cx = _make_cx_mock()
            with patch.dict("sys.modules", {"connectorx": cx}):
                AzureSQLDataLoader({"server": "srv", "database": "", "user": "u", "password": "p"})

    def test_connection_failure_wraps_error(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        cx = MagicMock()
        cx.read_sql.side_effect = RuntimeError("connection refused")
        with pytest.raises(ValueError, match="Failed to connect"):
            with patch.dict("sys.modules", {"connectorx": cx}):
                AzureSQLDataLoader(
                    {"server": "bad-srv", "database": "db", "user": "u", "password": "p"}
                )

    def test_entra_connection_failure_wraps_error(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        pyodbc = MagicMock()
        pyodbc.connect.side_effect = RuntimeError("ODBC error")
        with pytest.raises(ValueError, match="Failed to connect"):
            with (
                patch.dict("sys.modules", {"pyodbc": pyodbc}),
                patch(
                    "data_formulator.data_loader.azure_sql_data_loader.AzureSQLDataLoader._get_access_token",
                    return_value="tok",
                ),
            ):
                AzureSQLDataLoader(
                    {
                        "server": "srv",
                        "database": "db",
                        "client_id": "c",
                        "client_secret": "s",
                        "tenant_id": "t",
                    }
                )


# ===========================================================================
# Tests: FabricLakehouseDataLoader — init validation
# ===========================================================================


class TestFabricLakehouseInitValidation:
    def test_missing_server_raises(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        with pytest.raises(ValueError, match="[Ss]erver|[Ee]ndpoint"):
            pyodbc = MagicMock()
            with (
                patch.dict("sys.modules", {"pyodbc": pyodbc}),
                patch(
                    "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                    return_value="tok",
                ),
            ):
                FabricLakehouseDataLoader({"server": "", "database": "MyLH"})

    def test_missing_database_raises(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        with pytest.raises(ValueError, match="[Dd]atabase|[Ll]akehouse|[Ww]arehouse"):
            pyodbc = MagicMock()
            with (
                patch.dict("sys.modules", {"pyodbc": pyodbc}),
                patch(
                    "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                    return_value="tok",
                ),
            ):
                FabricLakehouseDataLoader({"server": "srv.fabric.microsoft.com", "database": ""})

    def test_connection_failure_wraps_error(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        pyodbc = MagicMock()
        pyodbc.connect.side_effect = RuntimeError("ODBC driver not found")
        with pytest.raises(ValueError, match="Failed to connect"):
            with (
                patch.dict("sys.modules", {"pyodbc": pyodbc}),
                patch(
                    "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                    return_value="tok",
                ),
            ):
                FabricLakehouseDataLoader(
                    {"server": "srv.fabric.microsoft.com", "database": "MyLH"}
                )


# ===========================================================================
# Tests: AzureSQLDataLoader — fetch_data_as_arrow (SQL auth path)
# ===========================================================================


class TestAzureSQLFetchData:
    def _make_loader(self) -> "AzureSQLDataLoader":
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        cx_mock = _make_cx_mock()
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            loader = AzureSQLDataLoader(
                {
                    "server": "myserver.database.windows.net",
                    "database": "mydb",
                    "user": "sa",
                    "password": "pass",
                }
            )
        loader._cx_mock = cx_mock
        return loader

    def test_returns_arrow_table(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            result = loader.fetch_data_as_arrow("sales.orders")
        assert isinstance(result, pa.Table)
        assert result.num_rows == 3

    def test_column_names(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            result = loader.fetch_data_as_arrow("sales.orders")
        assert set(result.schema.names) == {"id", "amount", "status"}

    def test_table_without_schema_defaults_to_dbo(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            result = loader.fetch_data_as_arrow("orders")
        # Should work — query should include dbo as schema
        assert isinstance(result, pa.Table)

    def test_empty_source_table_raises(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with pytest.raises(ValueError, match="source_table"):
            with patch.dict("sys.modules", {"connectorx": cx_mock}):
                loader.fetch_data_as_arrow("")

    def test_size_limit_in_query(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        queries_seen: list[str] = []
        cx_mock.read_sql.side_effect = lambda url, q, **kw: (
            queries_seen.append(q) or _make_arrow(q)
        )
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            loader.fetch_data_as_arrow("sales.orders", size=50)
        # The last query executed for data fetch should contain TOP 50
        data_queries = [q for q in queries_seen if "TOP 50" in q.upper() or "top 50" in q.lower()]
        assert len(data_queries) >= 1

    def test_sort_columns_asc(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        queries_seen: list[str] = []
        cx_mock.read_sql.side_effect = lambda url, q, **kw: (
            queries_seen.append(q) or _make_arrow(q)
        )
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            loader.fetch_data_as_arrow("sales.orders", sort_columns=["amount"])
        data_queries = [q for q in queries_seen if "ORDER BY" in q.upper()]
        assert any("ASC" in q.upper() for q in data_queries)

    def test_sort_columns_desc(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        queries_seen: list[str] = []
        cx_mock.read_sql.side_effect = lambda url, q, **kw: (
            queries_seen.append(q) or _make_arrow(q)
        )
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            loader.fetch_data_as_arrow("sales.orders", sort_columns=["id"], sort_order="desc")
        data_queries = [q for q in queries_seen if "ORDER BY" in q.upper()]
        assert any("DESC" in q.upper() for q in data_queries)


# ===========================================================================
# Tests: AzureSQLDataLoader — list_tables (SQL auth path)
# ===========================================================================


class TestAzureSQLListTables:
    def _make_loader(self) -> "AzureSQLDataLoader":
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        cx_mock = _make_cx_mock()
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            loader = AzureSQLDataLoader(
                {
                    "server": "myserver.database.windows.net",
                    "database": "mydb",
                    "user": "sa",
                    "password": "pass",
                }
            )
        loader._cx_mock = cx_mock
        return loader

    def test_returns_list(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables()
        assert isinstance(tables, list)
        assert len(tables) == 2

    def test_table_names(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables()
        names = [t["name"] for t in tables]
        assert "sales.orders" in names
        assert "sales.customers" in names

    def test_metadata_shape(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables()
        for t in tables:
            md = t["metadata"]
            assert "row_count" in md
            assert "columns" in md
            assert "sample_rows" in md
            assert "table_type" in md

    def test_orders_row_count(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables()
        orders = next(t for t in tables if t["name"] == "sales.orders")
        assert orders["metadata"]["row_count"] == 3

    def test_orders_columns(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables()
        orders = next(t for t in tables if t["name"] == "sales.orders")
        col_names = [c["name"] for c in orders["metadata"]["columns"]]
        assert "id" in col_names
        assert "amount" in col_names
        assert "status" in col_names

    def test_table_filter(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables(table_filter="orders")
        assert len(tables) == 1
        assert tables[0]["name"] == "sales.orders"

    def test_table_filter_no_match(self):
        loader = self._make_loader()
        cx_mock = loader._cx_mock
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables(table_filter="nonexistent_xyz")
        assert tables == []

    def test_list_tables_returns_empty_on_connection_error(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        cx_mock = _make_cx_mock()
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            loader = AzureSQLDataLoader(
                {"server": "srv", "database": "db", "user": "u", "password": "p"}
            )
        # Now break the connection
        cx_mock.read_sql.side_effect = RuntimeError("connection lost")
        with patch.dict("sys.modules", {"connectorx": cx_mock}):
            tables = loader.list_tables()
        assert tables == []


# ===========================================================================
# Tests: AzureSQLDataLoader — Entra ID auth path
# ===========================================================================


class TestAzureSQLEntraAuth:
    def _make_loader_and_conn(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        pyodbc_mock = MagicMock()
        conn = _make_pyodbc_mock()
        pyodbc_mock.connect.return_value = conn

        with (
            patch.dict("sys.modules", {"pyodbc": pyodbc_mock}),
            patch(
                "data_formulator.data_loader.azure_sql_data_loader.AzureSQLDataLoader._get_access_token",
                return_value="fake-token",
            ),
        ):
            loader = AzureSQLDataLoader(
                {
                    "server": "myserver.database.windows.net",
                    "database": "mydb",
                    "client_id": "cid",
                    "client_secret": "csec",
                    "tenant_id": "tid",
                }
            )
        return loader, pyodbc_mock, conn

    def test_auth_mode_is_entra(self):
        loader, _, _ = self._make_loader_and_conn()
        assert loader._auth_mode == "entra"

    def test_fetch_data_via_pyodbc(self):
        loader, pyodbc_mock, conn = self._make_loader_and_conn()
        # Make pd.read_sql return orders data when called with a pyodbc connection
        with (
            patch.dict("sys.modules", {"pyodbc": pyodbc_mock}),
            patch(
                "data_formulator.data_loader.azure_sql_data_loader.AzureSQLDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=lambda q, c: _query_router(q)),
        ):
            result = loader.fetch_data_as_arrow("sales.orders")
        assert isinstance(result, pa.Table)

    def test_get_safe_params_hides_secret(self):
        loader, _, _ = self._make_loader_and_conn()
        safe = loader.get_safe_params()
        assert "client_secret" not in safe
        assert "server" in safe
        assert "database" in safe

    def test_service_principal_credential_used(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        pyodbc_mock = MagicMock()
        conn = _make_pyodbc_mock()
        pyodbc_mock.connect.return_value = conn

        client_cred_cls = MagicMock()
        token_obj = MagicMock()
        token_obj.token = "sp-token"
        client_cred_cls.return_value.get_token.return_value = token_obj

        azure_identity_mock = MagicMock()
        azure_identity_mock.ClientSecretCredential = client_cred_cls
        azure_identity_mock.DefaultAzureCredential = MagicMock()

        with (
            patch.dict("sys.modules", {"pyodbc": pyodbc_mock, "azure.identity": azure_identity_mock}),
            patch("data_formulator.data_loader.azure_sql_data_loader.AzureSQLDataLoader.__init__", lambda s, p: None),
        ):
            loader = AzureSQLDataLoader.__new__(AzureSQLDataLoader)
            loader.client_id = "cid"
            loader.client_secret = "csec"
            loader.tenant_id = "tid"

            # Call the real _get_access_token via the module's actual code path
            import data_formulator.data_loader.azure_sql_data_loader as mod
            original_fn = mod.AzureSQLDataLoader._get_access_token

            with patch.dict("sys.modules", {"azure.identity": azure_identity_mock}):
                token = original_fn(loader)

        client_cred_cls.assert_called_once_with(
            tenant_id="tid", client_id="cid", client_secret="csec"
        )
        assert token == "sp-token"

    def test_default_credential_used_when_no_sp(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        default_cred_cls = MagicMock()
        token_obj = MagicMock()
        token_obj.token = "cli-token"
        default_cred_cls.return_value.get_token.return_value = token_obj

        azure_identity_mock = MagicMock()
        azure_identity_mock.ClientSecretCredential = MagicMock()
        azure_identity_mock.DefaultAzureCredential = default_cred_cls

        with (
            patch("data_formulator.data_loader.azure_sql_data_loader.AzureSQLDataLoader.__init__", lambda s, p: None),
        ):
            loader = AzureSQLDataLoader.__new__(AzureSQLDataLoader)
            loader.client_id = ""
            loader.client_secret = ""
            loader.tenant_id = ""

            import data_formulator.data_loader.azure_sql_data_loader as mod

            with patch.dict("sys.modules", {"azure.identity": azure_identity_mock}):
                token = mod.AzureSQLDataLoader._get_access_token(loader)

        default_cred_cls.assert_called_once()
        assert token == "cli-token"


# ===========================================================================
# Tests: FabricLakehouseDataLoader — fetch_data_as_arrow
# ===========================================================================


class TestFabricFetchData:
    def _make_loader(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        pyodbc_mock = MagicMock()
        conn = _make_pyodbc_mock()
        pyodbc_mock.connect.return_value = conn

        with (
            patch.dict("sys.modules", {"pyodbc": pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
        ):
            loader = FabricLakehouseDataLoader(
                {
                    "server": "ws.datawarehouse.fabric.microsoft.com",
                    "database": "MyLakehouse",
                    "client_id": "cid",
                    "client_secret": "csec",
                    "tenant_id": "tid",
                }
            )
        loader._pyodbc_mock = pyodbc_mock
        return loader

    def test_returns_arrow_table(self):
        loader = self._make_loader()
        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=lambda q, c: _query_router(q)),
        ):
            result = loader.fetch_data_as_arrow("sales.orders")
        assert isinstance(result, pa.Table)
        assert result.num_rows == 3

    def test_empty_source_table_raises(self):
        loader = self._make_loader()
        with pytest.raises(ValueError, match="source_table"):
            with (
                patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
                patch(
                    "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                    return_value="fake-token",
                ),
                patch("pandas.read_sql", side_effect=lambda q, c: _query_router(q)),
            ):
                loader.fetch_data_as_arrow("")

    def test_size_limit_in_query(self):
        loader = self._make_loader()
        queries_seen: list[str] = []

        def capturing_read_sql(q, c):
            queries_seen.append(q)
            return _query_router(q)

        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=capturing_read_sql),
        ):
            loader.fetch_data_as_arrow("sales.orders", size=25)

        data_queries = [q for q in queries_seen if "TOP 25" in q.upper() or "top 25" in q.lower()]
        assert len(data_queries) >= 1

    def test_sort_order_desc(self):
        loader = self._make_loader()
        queries_seen: list[str] = []

        def capturing_read_sql(q, c):
            queries_seen.append(q)
            return _query_router(q)

        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=capturing_read_sql),
        ):
            loader.fetch_data_as_arrow("sales.orders", sort_columns=["id"], sort_order="desc")

        order_queries = [q for q in queries_seen if "ORDER BY" in q.upper()]
        assert any("DESC" in q.upper() for q in order_queries)


# ===========================================================================
# Tests: FabricLakehouseDataLoader — list_tables
# ===========================================================================


class TestFabricListTables:
    def _make_loader(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        pyodbc_mock = MagicMock()
        conn = _make_pyodbc_mock()
        pyodbc_mock.connect.return_value = conn

        with (
            patch.dict("sys.modules", {"pyodbc": pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
        ):
            loader = FabricLakehouseDataLoader(
                {
                    "server": "ws.datawarehouse.fabric.microsoft.com",
                    "database": "MyLakehouse",
                }
            )
        loader._pyodbc_mock = pyodbc_mock
        return loader

    def test_returns_list(self):
        loader = self._make_loader()
        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=lambda q, c: _query_router(q)),
        ):
            tables = loader.list_tables()
        assert isinstance(tables, list)
        assert len(tables) == 2

    def test_table_names(self):
        loader = self._make_loader()
        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=lambda q, c: _query_router(q)),
        ):
            tables = loader.list_tables()
        names = [t["name"] for t in tables]
        assert "sales.orders" in names
        assert "sales.customers" in names

    def test_metadata_shape(self):
        loader = self._make_loader()
        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=lambda q, c: _query_router(q)),
        ):
            tables = loader.list_tables()
        for t in tables:
            md = t["metadata"]
            assert "row_count" in md
            assert "columns" in md
            assert "sample_rows" in md
            assert "table_type" in md

    def test_table_filter(self):
        loader = self._make_loader()
        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=lambda q, c: _query_router(q)),
        ):
            tables = loader.list_tables(table_filter="customers")
        assert len(tables) == 1
        assert tables[0]["name"] == "sales.customers"

    def test_list_tables_empty_on_connection_error(self):
        loader = self._make_loader()
        broken_pyodbc = MagicMock()
        broken_pyodbc.connect.side_effect = RuntimeError("ODBC error")
        with (
            patch.dict("sys.modules", {"pyodbc": broken_pyodbc}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
        ):
            tables = loader.list_tables()
        assert tables == []

    def test_includes_views_in_table_listing(self):
        """Fabric returns both BASE TABLE and VIEW rows — both should be listed."""
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        tables_with_view = pd.DataFrame(
            {
                "TABLE_SCHEMA": ["dbo", "dbo"],
                "TABLE_NAME": ["delta_table", "report_view"],
                "TABLE_TYPE": ["BASE TABLE", "VIEW"],
            }
        )

        def router_with_view(q: str) -> pd.DataFrame:
            if "INFORMATION_SCHEMA.TABLES" in q.upper():
                return tables_with_view
            if "INFORMATION_SCHEMA.COLUMNS" in q.upper():
                return pd.DataFrame(
                    {
                        "COLUMN_NAME": ["id"],
                        "DATA_TYPE": ["int"],
                        "IS_NULLABLE": ["NO"],
                        "COLUMN_DEFAULT": [None],
                        "CHARACTER_MAXIMUM_LENGTH": [None],
                        "NUMERIC_PRECISION": [10],
                        "NUMERIC_SCALE": [0],
                    }
                )
            if "COUNT(*)" in q.upper():
                return pd.DataFrame({"row_count": [100]})
            return pd.DataFrame({"id": [1, 2]})

        loader = self._make_loader()
        with (
            patch.dict("sys.modules", {"pyodbc": loader._pyodbc_mock}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="fake-token",
            ),
            patch("pandas.read_sql", side_effect=lambda q, c: router_with_view(q)),
        ):
            tables = loader.list_tables()
        names = [t["name"] for t in tables]
        assert "dbo.delta_table" in names
        assert "dbo.report_view" in names


# ===========================================================================
# Tests: safe_params — sensitive fields removed
# ===========================================================================


class TestGetSafeParams:
    def test_azure_sql_hides_password(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        cx = _make_cx_mock()
        with patch.dict("sys.modules", {"connectorx": cx}):
            loader = AzureSQLDataLoader(
                {
                    "server": "srv",
                    "database": "db",
                    "user": "u",
                    "password": "super-secret",
                }
            )
        safe = loader.get_safe_params()
        assert "password" not in safe
        assert safe.get("server") == "srv"

    def test_azure_sql_hides_client_secret(self):
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        pyodbc = MagicMock()
        conn = _make_pyodbc_mock()
        pyodbc.connect.return_value = conn
        with (
            patch.dict("sys.modules", {"pyodbc": pyodbc}),
            patch(
                "data_formulator.data_loader.azure_sql_data_loader.AzureSQLDataLoader._get_access_token",
                return_value="tok",
            ),
        ):
            loader = AzureSQLDataLoader(
                {
                    "server": "srv",
                    "database": "db",
                    "client_id": "cid",
                    "client_secret": "my-secret",
                    "tenant_id": "tid",
                }
            )
        safe = loader.get_safe_params()
        assert "client_secret" not in safe
        assert safe.get("client_id") == "cid"

    def test_fabric_hides_client_secret(self):
        from data_formulator.data_loader.fabric_lakehouse_data_loader import (
            FabricLakehouseDataLoader,
        )

        pyodbc = MagicMock()
        conn = _make_pyodbc_mock()
        pyodbc.connect.return_value = conn
        with (
            patch.dict("sys.modules", {"pyodbc": pyodbc}),
            patch(
                "data_formulator.data_loader.fabric_lakehouse_data_loader.FabricLakehouseDataLoader._get_access_token",
                return_value="tok",
            ),
        ):
            loader = FabricLakehouseDataLoader(
                {
                    "server": "srv.fabric.microsoft.com",
                    "database": "MyLH",
                    "client_id": "cid",
                    "client_secret": "my-secret",
                    "tenant_id": "tid",
                }
            )
        safe = loader.get_safe_params()
        assert "client_secret" not in safe
        assert safe.get("server") == "srv.fabric.microsoft.com"


# ===========================================================================
# Tests: safe_select_list — unsupported type handling
# ===========================================================================


class TestSafeSelectList:
    def _make_loader(self) -> "AzureSQLDataLoader":
        from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

        cx = _make_cx_mock()
        with patch.dict("sys.modules", {"connectorx": cx}):
            loader = AzureSQLDataLoader(
                {"server": "srv", "database": "db", "user": "u", "password": "p"}
            )
        return loader

    def test_all_supported_types_returns_star(self):
        loader = self._make_loader()
        # Override _execute_query to return only supported column types
        supported_cols = pa.Table.from_pandas(
            pd.DataFrame({"COLUMN_NAME": ["id", "name"], "DATA_TYPE": ["int", "nvarchar"]})
        )
        loader._execute_query = MagicMock(return_value=supported_cols)
        result = loader._safe_select_list("dbo", "mytable")
        assert result == "*"

    def test_geometry_type_uses_stastext(self):
        loader = self._make_loader()
        cols_with_geo = pa.Table.from_pandas(
            pd.DataFrame(
                {"COLUMN_NAME": ["id", "location"], "DATA_TYPE": ["int", "geometry"]}
            )
        )
        loader._execute_query = MagicMock(return_value=cols_with_geo)
        result = loader._safe_select_list("dbo", "spatial_table")
        assert "STAsText()" in result
        assert "[id]" in result

    def test_xml_type_cast_to_nvarchar(self):
        loader = self._make_loader()
        cols_with_xml = pa.Table.from_pandas(
            pd.DataFrame(
                {"COLUMN_NAME": ["id", "doc"], "DATA_TYPE": ["int", "xml"]}
            )
        )
        loader._execute_query = MagicMock(return_value=cols_with_xml)
        result = loader._safe_select_list("dbo", "xml_table")
        assert "NVARCHAR(MAX)" in result
        assert "[doc]" in result

    def test_exception_returns_star(self):
        loader = self._make_loader()
        loader._execute_query = MagicMock(side_effect=RuntimeError("boom"))
        result = loader._safe_select_list("dbo", "badtable")
        assert result == "*"
