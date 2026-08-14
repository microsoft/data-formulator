from __future__ import annotations

from unittest import mock

import pyarrow as pa
import pytest

from data_formulator.data_loader.clickhouse_data_loader import ClickHouseDataLoader
from data_formulator.data_loader.external_data_loader import MAX_IMPORT_ROWS


class FakeClient:
    def __init__(self):
        self.queries: list[tuple[str, dict | None]] = []
        self.closed = False
        self.results: list[pa.Table] = []

    def query_arrow(self, query, parameters=None):
        self.queries.append((query, parameters))
        if self.results:
            return self.results.pop(0)
        return pa.table({})

    def close(self):
        self.closed = True


@pytest.fixture
def fake_client():
    return FakeClient()


@pytest.fixture
def loader(fake_client):
    with mock.patch(
        "data_formulator.data_loader.clickhouse_data_loader.clickhouse_connect.get_client",
        return_value=fake_client,
    ):
        return ClickHouseDataLoader(
            {
                "host": "clickhouse.example",
                "port": 8443,
                "username": "analyst",
                "password": "secret",
                "secure": True,
                "verify": True,
                "timeout": 12,
            }
        )


def test_static_contract_and_sensitive_password():
    params = {item["name"]: item for item in ClickHouseDataLoader.list_params()}
    assert params["host"]["required"] is True
    assert params["password"]["sensitive"] is True
    assert params["verify"]["default"] is True
    assert [level["key"] for level in ClickHouseDataLoader.catalog_hierarchy()] == [
        "database",
        "table",
    ]


def test_constructor_maps_secure_read_only_options(fake_client):
    with mock.patch(
        "data_formulator.data_loader.clickhouse_data_loader.clickhouse_connect.get_client",
        return_value=fake_client,
    ) as get_client:
        loader = ClickHouseDataLoader(
            {
                "host": "cloud.example",
                "port": "8443",
                "username": "reader",
                "password": "top-secret",
                "secure": "true",
                "verify": "true",
                "timeout": "20",
                "database": "analytics",
            }
        )

    kwargs = get_client.call_args.kwargs
    assert kwargs["host"] == "cloud.example"
    assert kwargs["port"] == 8443
    assert kwargs["secure"] is True
    assert kwargs["verify"] is True
    assert kwargs["connect_timeout"] == 20
    assert kwargs["settings"]["readonly"] == 1
    assert "password" not in loader.get_safe_params()


def test_constructor_normalizes_none_optional_parameters(fake_client):
    with mock.patch(
        "data_formulator.data_loader.clickhouse_data_loader.clickhouse_connect.get_client",
        return_value=fake_client,
    ) as get_client:
        loader = ClickHouseDataLoader(
            {
                "host": "cloud.example",
                "username": "reader",
                "password": None,
                "database": None,
            }
        )

    assert loader.password == ""
    assert loader.database == ""
    assert get_client.call_args.kwargs["password"] == ""
    assert get_client.call_args.kwargs["database"] is None


def test_constructor_preserves_falsy_non_none_parameters(fake_client):
    with mock.patch(
        "data_formulator.data_loader.clickhouse_data_loader.clickhouse_connect.get_client",
        return_value=fake_client,
    ) as get_client:
        loader = ClickHouseDataLoader(
            {
                "host": "cloud.example",
                "username": "reader",
                "password": 0,
                "database": 0,
            }
        )

    assert loader.password == "0"
    assert loader.database == "0"
    assert get_client.call_args.kwargs["password"] == "0"
    assert get_client.call_args.kwargs["database"] == "0"


def test_connection_failure_redacts_password():
    with mock.patch(
        "data_formulator.data_loader.clickhouse_data_loader.clickhouse_connect.get_client",
        side_effect=RuntimeError("server echoed top-secret"),
    ):
        with pytest.raises(ValueError) as exc_info:
            ClickHouseDataLoader(
                {
                    "host": "cloud.example",
                    "username": "reader",
                    "password": "top-secret",
                }
            )
    assert "top-secret" not in str(exc_info.value)
    assert exc_info.value.__cause__ is None
    assert exc_info.value.__suppress_context__ is True


@pytest.mark.parametrize(
    ("secure", "expected_port"),
    [(False, 8123), (True, 8443)],
)
def test_omitted_port_follows_transport_default(fake_client, secure, expected_port):
    with mock.patch(
        "data_formulator.data_loader.clickhouse_data_loader.clickhouse_connect.get_client",
        return_value=fake_client,
    ) as get_client:
        ClickHouseDataLoader(
            {
                "host": "cloud.example",
                "username": "reader",
                "secure": secure,
            }
        )
    assert get_client.call_args.kwargs["port"] == expected_port


@pytest.mark.parametrize(
    ("size", "expected"),
    [
        (None, MAX_IMPORT_ROWS),
        (0, 0),
        (10, 10),
        (MAX_IMPORT_ROWS + 1, MAX_IMPORT_ROWS),
    ],
)
def test_fetch_enforces_row_cap_and_quotes_identifiers(loader, fake_client, size, expected):
    options = {} if size is None else {"size": size}
    loader.fetch_data_as_arrow("`db.with.dot`.`table``name`", options)
    query, _ = fake_client.queries[-1]
    assert "FROM `db.with.dot`.`table``name`" in query
    assert query.endswith(f"LIMIT {expected}")


@pytest.mark.parametrize("size", [-1, "nope", True])
def test_fetch_rejects_invalid_sizes(loader, size):
    with pytest.raises(ValueError):
        loader.fetch_data_as_arrow("analytics.events", {"size": size})


def test_fetch_parameterizes_filters_and_quotes_sort_columns(loader, fake_client):
    loader.fetch_data_as_arrow(
        "analytics.events",
        {
            "size": 50,
            "source_filters": [
                {"column": "customer", "operator": "EQ", "value": "x' OR 1=1 --"},
                {"column": "region", "operator": "IN", "value": ["EU", "US"]},
            ],
            "sort_columns": ["created at", "amount`gross"],
            "sort_order": "desc",
        },
    )
    query, parameters = fake_client.queries[-1]
    assert "x' OR 1=1 --" not in query
    assert parameters["filter_0"] == "x' OR 1=1 --"
    assert "ORDER BY `created at` DESC, `amount``gross` DESC" in query


@pytest.mark.parametrize(
    "source",
    [
        "db.table; DROP TABLE users",
        "db.table--comment",
        "db.table/*comment",
        "SELECT * FROM db.table",
    ],
)
def test_fetch_rejects_raw_sql_and_dangerous_identifiers(loader, source):
    with pytest.raises(ValueError):
        loader.fetch_data_as_arrow(source)


def test_list_tables_returns_arrow_metadata_and_excludes_catalog_details(
    loader, fake_client
):
    fake_client.results = [
        pa.table(
            {
                "database": ["analytics"],
                "name": ["events"],
                "engine": ["MergeTree"],
                "comment": ["Event stream"],
                "total_rows": [12],
            }
        ),
        pa.table(
            {
                "database": ["analytics"],
                "table": ["events"],
                "name": ["event_id"],
                "type": ["UUID"],
                "comment": [""],
            }
        ),
    ]
    tables = loader.list_tables("event")
    assert tables == [
        {
            "name": "`analytics`.`events`",
            "path": ["analytics", "events"],
            "metadata": {
                "columns": [{"name": "event_id", "type": "UUID"}],
                "engine": "MergeTree",
                "description": "Event stream",
                "row_count": 12,
            },
        }
    ]
    assert "system.tables" in fake_client.queries[0][0]
    assert "database NOT IN" in fake_client.queries[0][0]


def test_pinned_database_catalog_and_lazy_browsing(fake_client):
    with mock.patch(
        "data_formulator.data_loader.clickhouse_data_loader.clickhouse_connect.get_client",
        return_value=fake_client,
    ):
        loader = ClickHouseDataLoader(
            {
                "host": "localhost",
                "username": "default",
                "database": "analytics",
            }
        )
    assert [level["key"] for level in loader.effective_hierarchy()] == ["table"]
    fake_client.results = [pa.table({"name": ["events", "orders"]})]
    nodes = loader.ls([], filter="event")
    assert [node.name for node in nodes] == ["events"]
    assert nodes[0].metadata["_source_name"] == "`analytics`.`events`"
    assert fake_client.queries[-1][1] == {"database": "analytics"}


def test_probe_cannot_escape_pinned_database(loader):
    loader.database = "analytics"
    result = loader.probe(["other_database", "secret_table"], {"limit": 1})
    assert "error" in result
    assert "configured database" in result["error"]


@pytest.mark.parametrize("failure_index", [0, 1, 2])
def test_get_metadata_returns_empty_when_a_query_fails(loader, failure_index):
    successful_results = [
        pa.table({"name": ["event_id"], "type": ["UUID"], "comment": [""]}),
        pa.table({"comment": ["Event stream"], "total_rows": [12]}),
        pa.table({"event_id": ["00000000-0000-0000-0000-000000000000"]}),
    ]
    side_effects = successful_results[:failure_index] + [
        RuntimeError("server leaked sensitive details")
    ]

    with (
        mock.patch.object(loader, "_read_sql", side_effect=side_effects),
        mock.patch(
            "data_formulator.data_loader.clickhouse_data_loader.logger.warning"
        ) as warning,
    ):
        assert loader.get_metadata(["analytics", "events"]) == {}

    warning.assert_called_once_with(
        "ClickHouse metadata lookup failed for %s (%s)",
        ["analytics", "events"],
        "RuntimeError",
    )


def test_close_and_connection_check(loader, fake_client):
    assert loader.test_connection() is True
    loader.close()
    assert fake_client.closed is True
    assert loader.test_connection() is False


@pytest.mark.parametrize(
    "column_type, expected",
    [
        # ClickHouse's Arrow writer degrades these to their physical form.
        ("DateTime", "toDateTime64({column}, 0)"),
        ("DateTime('Asia/Tokyo')", "toDateTime64({column}, 0)"),
        ("Nullable(DateTime)", "toDateTime64({column}, 0)"),
        ("LowCardinality(Nullable(DateTime))", "toDateTime64({column}, 0)"),
        ("IPv4", "toString({column})"),
        ("IPv6", "toString({column})"),
        ("Enum8('a' = 1, 'b' = 2)", "toString({column})"),
        ("Enum16('a' = 1)", "toString({column})"),
        ("FixedString(4)", "toString({column})"),
        ("UUID", "toString({column})"),
        ("Int128", "toString({column})"),
        ("UInt256", "toString({column})"),
        # DuckDB's DECIMAL precision caps at 38.
        ("Decimal(76, 10)", "toString({column})"),
        ("Nullable(Decimal(50, 2))", "toString({column})"),
        # JSON cannot be serialised by the Arrow writer at all.
        ("JSON", "toJSONString({column})"),
        ("Object('json')", "toJSONString({column})"),
        ("Dynamic", "toString({column})"),
        # Everything below already crosses Arrow intact.
        ("DateTime64(3)", None),
        ("Nullable(DateTime64(3))", None),
        ("Date", None),
        ("Date32", None),
        ("UInt32", None),
        ("Int64", None),
        ("String", None),
        ("LowCardinality(String)", None),
        ("Decimal(18, 4)", None),
        ("Decimal(38, 4)", None),
        ("Bool", None),
        ("Array(Int32)", None),
        ("Map(String, Int32)", None),
        ("Tuple(a Int32, b String)", None),
    ],
)
def test_cast_function_covers_lossy_types(column_type, expected):
    assert ClickHouseDataLoader._cast_function(column_type) == expected


def test_fetch_projects_lossy_columns(loader, fake_client):
    # DateTime, IPv4 and JSON all degrade (or fail) through Arrow, so the
    # loader must project them server-side; UInt32 must be left alone.
    fake_client.results = [
        pa.table(
            {
                "name": ["created at", "amount", "client ip", "payload"],
                "type": ["DateTime", "UInt32", "IPv4", "JSON"],
            }
        )
    ]
    loader.fetch_data_as_arrow("analytics.events", {"size": 10})
    query, _ = fake_client.queries[-1]
    assert (
        "SELECT * REPLACE ("
        "toString(`client ip`) AS `client ip`, "
        "toDateTime64(`created at`, 0) AS `created at`, "
        "toJSONString(`payload`) AS `payload`)" in query
    )
    assert "`amount`" not in query


def test_fetch_projects_within_explicit_column_list(loader, fake_client):
    fake_client.results = [
        pa.table(
            {
                "name": ["created_at", "status"],
                "type": ["DateTime", "Enum8('on' = 1)"],
            }
        )
    ]
    loader.fetch_data_as_arrow(
        "analytics.events", {"columns": ["amount", "created_at", "status"]}
    )
    query, _ = fake_client.queries[-1]
    assert (
        "SELECT `amount`, toDateTime64(`created_at`, 0) AS `created_at`, "
        "toString(`status`) AS `status`" in query
    )


def test_fetch_keeps_plain_star_without_lossy_columns(loader, fake_client):
    fake_client.results = [pa.table({"name": ["amount"], "type": ["UInt32"]})]
    loader.fetch_data_as_arrow("analytics.events")
    query, _ = fake_client.queries[-1]
    assert query.startswith("SELECT * FROM")


def test_fetch_survives_column_type_lookup_failure(loader, fake_client):
    original = loader._read_sql
    calls = {"n": 0}

    def flaky(query, parameters=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("system.columns unavailable")
        return original(query, parameters)

    with mock.patch.object(loader, "_read_sql", side_effect=flaky):
        loader.fetch_data_as_arrow("analytics.events")
    query, _ = fake_client.queries[-1]
    assert query.startswith("SELECT * FROM `analytics`.`events`")


def test_metadata_sample_projects_lossy_columns(loader, fake_client):
    fake_client.results = [
        pa.table(
            {
                "name": ["created_at", "amount"],
                "type": ["DateTime", "UInt32"],
                "comment": ["", ""],
            }
        ),
        pa.table({"comment": ["Event stream"], "total_rows": [12]}),
        pa.table({"created_at": [0], "amount": [1]}),
    ]
    loader.get_metadata(["analytics", "events"])
    sample_query, _ = fake_client.queries[-1]
    assert (
        "SELECT * REPLACE (toDateTime64(`created_at`, 0) AS `created_at`) "
        "FROM `analytics`.`events` LIMIT 5" in sample_query
    )
    # The sample reuses the types already fetched, so no extra type lookup.
    assert sum("system.columns" in query for query, _ in fake_client.queries) == 1
