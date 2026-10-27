"""Tests for the Snowflake data loader."""

import os

import pyarrow as pa
import pytest

from data_formulator.data_loader.external_data_loader import ConnectorParamError
from data_formulator.data_loader.snowflake_data_loader import SnowflakeDataLoader

pytestmark = [pytest.mark.backend]


def _bare_loader(*, database: str = "", schema: str = "") -> SnowflakeDataLoader:
    loader = object.__new__(SnowflakeDataLoader)
    loader.params = {
        key: value
        for key, value in (("database", database), ("schema", schema))
        if value
    }
    loader.database = database
    loader.schema = schema
    return loader


def test_password_path_requires_credentials() -> None:
    params = {
        "account": "myorg-myaccount",
        "warehouse": "COMPUTE_WH",
    }
    with pytest.raises(ConnectorParamError, match="user"):
        SnowflakeDataLoader.validate_params(params)
    with pytest.raises(ConnectorParamError, match="password"):
        SnowflakeDataLoader.validate_params(
            {
                "account": "myorg-myaccount",
                "warehouse": "COMPUTE_WH",
                "user": "analyst",
            }
        )


def test_hierarchy_is_database_schema_table() -> None:
    assert [level["key"] for level in SnowflakeDataLoader.catalog_hierarchy()] == [
        "database",
        "schema",
        "table",
    ]


def test_effective_hierarchy_pins_database_and_schema() -> None:
    loader = _bare_loader(database="ANALYTICS", schema="PUBLIC")
    assert [level["key"] for level in loader.effective_hierarchy()] == ["table"]


def test_resolve_source_table_variants() -> None:
    loader = _bare_loader(database="ANALYTICS", schema="PUBLIC")
    assert loader._resolve_source_table("DB.SCHEMA.TABLE") == ("DB", "SCHEMA", "TABLE")
    assert loader._resolve_source_table("SALES.ORDERS") == ("ANALYTICS", "SALES", "ORDERS")
    assert loader._resolve_source_table("ORDERS") == ("ANALYTICS", "PUBLIC", "ORDERS")


def test_fetch_builds_projection_filter_sort_and_limit(monkeypatch) -> None:
    loader = _bare_loader(database="ANALYTICS", schema="PUBLIC")
    captured: dict[str, str] = {}
    expected = pa.table({"ID": [2]})

    def fake_query_arrow(query: str) -> pa.Table:
        captured["query"] = query
        return expected

    monkeypatch.setattr(loader, "_query_arrow", fake_query_arrow)

    result = loader.fetch_data_as_arrow(
        "ORDERS",
        {
            "size": 25,
            "columns": ["ID", "CUSTOMER"],
            "conditions": [{"column": "ID", "operator": ">", "value": 1}],
            "sort_columns": ["ID"],
            "sort_order": "desc",
        },
    )

    assert result is expected
    query = captured["query"]
    assert 'SELECT "ID", "CUSTOMER" FROM "ANALYTICS"."PUBLIC"."ORDERS"' in query
    assert 'WHERE "ID" > 1' in query
    assert 'ORDER BY "ID" DESC' in query
    assert query.endswith("LIMIT 25")


_LIVE_ENV = (
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_WAREHOUSE",
    "SNOWFLAKE_TEST_DATABASE",
    "SNOWFLAKE_TEST_SCHEMA",
    "SNOWFLAKE_TEST_TABLE",
)
_live_ready = all(os.environ.get(key) for key in _LIVE_ENV)


@pytest.mark.live
@pytest.mark.skipif(
    not _live_ready,
    reason=f"set {', '.join(_LIVE_ENV)} to run the live Snowflake test",
)
def test_live_snowflake_roundtrip() -> None:
    database = os.environ["SNOWFLAKE_TEST_DATABASE"]
    schema = os.environ["SNOWFLAKE_TEST_SCHEMA"]
    table = os.environ["SNOWFLAKE_TEST_TABLE"]
    source_table = f"{database}.{schema}.{table}"

    loader = SnowflakeDataLoader(
        {
            "account": os.environ["SNOWFLAKE_ACCOUNT"],
            "user": os.environ["SNOWFLAKE_USER"],
            "password": os.environ["SNOWFLAKE_PASSWORD"],
            "warehouse": os.environ["SNOWFLAKE_WAREHOUSE"],
            "database": database,
            "schema": schema,
            "role": os.environ.get("SNOWFLAKE_ROLE", ""),
        }
    )

    assert loader.test_connection()

    tables = loader.list_tables()
    names = {item["name"] for item in tables}
    assert source_table in names

    column_types = loader.get_column_types(source_table)
    assert column_types["columns"]

    arrow = loader.fetch_data_as_arrow(source_table, {"size": 5})
    assert arrow.num_rows <= 5
    assert arrow.num_columns > 0
