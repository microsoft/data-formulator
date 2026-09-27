import json
import time
from types import SimpleNamespace

import pyarrow as pa
import pytest

from data_formulator.data_loader.cube_data_loader import CubeDataLoader

pytestmark = [pytest.mark.backend]

_META = {"cubes": [
    {
        "name": "orders_view", "type": "view", "title": "Orders", "description": "Governed orders",
        "measures": [
            {"name": "orders_view.count", "title": "Orders Count", "shortTitle": "Count", "type": "number", "aggType": "count"},
            {"name": "orders_view.net_revenue", "title": "Orders Net Revenue", "shortTitle": "Net Revenue",
             "type": "number", "aggType": "sum", "description": "Revenue after refunds"},
            {"name": "orders_view.customers", "title": "Orders Customers", "shortTitle": "Customers",
             "type": "number", "aggType": "countDistinct"},
        ],
        "dimensions": [
            {"name": "orders_view.segment", "title": "Customer Segment", "shortTitle": "Segment", "type": "string"},
            {"name": "orders_view.customer_name", "title": "Customer Name", "shortTitle": "Name", "type": "string"},
            {"name": "orders_view.product_name", "title": "Product Name", "shortTitle": "Name", "type": "string"},
            {"name": "orders_view.created_at", "title": "Orders Created At", "shortTitle": "Order Date", "type": "time",
             "granularities": [{"name": "fiscal_year"}]},
            {"name": "orders_view.secret", "title": "Hidden", "type": "string", "isVisible": False},
        ],
    },
    {"name": "orders", "type": "cube", "connectedComponent": 1, "measures": [],
     "dimensions": [{"name": "orders.id", "type": "number"}]},
    {"name": "customers", "type": "cube", "connectedComponent": 1, "measures": [],
     "dimensions": [{"name": "customers.id", "type": "number"}]},
    {"name": "private_orders", "type": "cube", "public": False, "isVisible": False,
     "measures": [{"name": "private_orders.count", "type": "number", "isVisible": False, "public": False}],
     "dimensions": []},
]}


class _Response:
    def __init__(self, payload, status=200):
        self.payload, self.status_code, self.reason = payload, status, "Bad Request"

    def json(self):
        return self.payload


@pytest.fixture
def cube(monkeypatch):
    loader = CubeDataLoader({"api_url": "http://cube.test/cubejs-api/", "api_token": "secret-token"})
    loader.requests = []
    loader.load_responses = []

    def request(method, url, json=None, timeout=None):
        loader.requests.append((method, url, json))
        if url.endswith("/v1/meta"):
            return _Response(_META)
        return loader.load_responses.pop(0)

    monkeypatch.setattr(loader._session, "request", request)
    # Patch the defining module's globals; other tests may reload the data_loader package.
    monkeypatch.setitem(CubeDataLoader._load.__globals__, "time",
                        SimpleNamespace(monotonic=time.monotonic, sleep=lambda seconds: None))
    return loader


def _fields(loader):
    return {field["name"]: field for field in loader.list_tables()[0]["metadata"]["columns"]}


def test_catalog_maps_members_to_semantic_fields(cube):
    tables = cube.list_tables()
    assert [table["table_key"] for table in tables] == ["orders_view", "orders", "customers"]
    metadata = tables[0]["metadata"]
    assert metadata["query_model"] == "semantic" and metadata["description"] == "Governed orders"
    fields = _fields(cube)
    assert set(fields) == {"Count", "Net Revenue", "Customers", "Segment", "Customer Name", "Product Name", "Order Date"}
    assert fields["Net Revenue"] == {
        "name": "Net Revenue", "ref": "orders_view.net_revenue", "type": "number", "role": "measure",
        "entity": "orders_view", "aggregation": "sum", "description": "Measure (sum): Revenue after refunds",
    }
    assert fields["Order Date"]["role"] == "time_dimension"
    assert fields["Order Date"]["granularities"] == ["day", "week", "month", "quarter", "year", "fiscal_year"]
    assert tables[1]["metadata"]["relationships"] == [{"from": "orders", "to": "customers", "kind": "joinable"}]
    assert cube.query_model("orders_view") == "semantic"
    assert cube.requests[0][2] is None and cube._session.headers["Authorization"] == "secret-token"


def test_catalog_tree_response_keeps_semantic_fields(cube):
    from data_formulator.data_connector import _catalog_tree_payload

    tables = cube.list_tables()
    tables.append({"name": "raw", "table_key": "raw", "path": ["raw"],
                   "metadata": {"columns": [{"name": f"c{index}", "type": "int", "description": "x"} for index in range(60)]}})
    nodes = {node["name"]: node["metadata"] for node in _catalog_tree_payload(cube, tables)}
    assert [field["name"] for field in nodes["orders_view"]["columns"]][:2] == ["Count", "Net Revenue"]
    assert nodes["raw"]["columns"][0] == {"name": "c0", "type": "int"}
    assert len(nodes["raw"]["columns"]) == 50 and nodes["raw"]["column_count"] == 60


def test_structured_query_compiles_to_cube_and_returns_requested_names(cube):
    cube.load_responses = [
        _Response({"error": "Continue wait"}),
        _Response({"data": [
            {"orders_view.segment": "SMB", "orders_view.created_at.month": "2026-01-01T00:00:00.000",
             "orders_view.net_revenue": "10.5", "orders_view.customers": "3"},
            {"orders_view.segment": None, "orders_view.created_at.month": "2026-02-01T00:00:00.000",
             "orders_view.net_revenue": None, "orders_view.customers": "4"},
        ]}),
    ]
    table = cube.query_data_as_arrow("orders_view", {
        "columns": ["Segment", "Order Date (month)", "Net Revenue", "Customers"],
        "filters": [{"column": "Segment", "op": "IN", "value": ["SMB", "Enterprise"]},
                    {"column": "Order Date", "op": "BETWEEN", "value": ["2026-01-01", "2026-03-31"]},
                    {"column": "Customer Name", "op": "ILIKE", "value": "%smith%"}],
        "order_by": [{"column": "Net Revenue", "dir": "desc"}],
    }, 10001)
    body = cube.requests[-1][2]["query"]
    assert body == {
        "dimensions": ["orders_view.segment"],
        "timeDimensions": [{"dimension": "orders_view.created_at", "granularity": "month"}],
        "measures": ["orders_view.net_revenue", "orders_view.customers"],
        "filters": [
            {"member": "orders_view.segment", "operator": "equals", "values": ["SMB", "Enterprise"]},
            {"member": "orders_view.created_at", "operator": "inDateRange", "values": ["2026-01-01", "2026-03-31"]},
            {"member": "orders_view.customer_name", "operator": "contains", "values": ["smith"]},
        ],
        "order": [["orders_view.net_revenue", "desc"]],
        "limit": 10001,
    }
    assert table.column_names == ["Segment", "Order Date (month)", "Net Revenue", "Customers"]
    assert table.column("Net Revenue").to_pylist() == [10.5, None]
    assert table.column("Customers").type == pa.int64()
    assert pa.types.is_timestamp(table.column("Order Date (month)").type)
    assert len([request for request in cube.requests if request[1].endswith("/v1/load")]) == 2


@pytest.mark.parametrize("query,message", [
    ({"columns": []}, "Select at least one"),
    ({"group_by": ["Segment"], "aggregates": [{"op": "sum", "column": "Net Revenue", "as": "x"}]}, "compute measures"),
    ({"columns": ["Revenue"]}, "Unknown field"),
    ({"columns": ["Order Date (hour)"]}, "Unknown field"),
    ({"columns": ["Segment"], "filters": [{"column": "Net Revenue", "op": "GT", "value": 1}]}, "native cube_json"),
    ({"columns": ["Segment"], "order_by": [{"column": "Count"}]}, "selected columns"),
])
def test_structured_query_rejects_non_semantic_shapes(cube, query, message):
    with pytest.raises(ValueError, match=message):
        cube.query_data_as_arrow("orders_view", query, 100)


def test_native_query_is_validated_scoped_and_named(cube):
    native = {"measures": ["orders_view.count"], "dimensions": ["orders_view.segment"],
              "filters": [{"or": [{"member": "orders_view.count", "operator": "gt", "values": ["100"]}]}],
              "limit": 50}
    cube.load_responses = [_Response({"data": [{"orders_view.count": "120", "orders_view.segment": "SMB"}]})]
    table = cube.query_data_as_arrow("orders_view", {"native": {"language": "cube_json", "text": json.dumps(native)}}, 11)
    assert cube.requests[-1][2]["query"]["limit"] == 11
    assert table.to_pylist() == [{"Count": 120, "Segment": "SMB"}]
    for text, message in [
        ("[{}]", "not an array"), ('{"measures": ["orders_view.count"], "ungrouped": true}', "Unsupported"),
        ('{"limit": 5}', "must select"), ("not json", "one JSON"),
    ]:
        with pytest.raises(ValueError, match=message):
            cube.validate_native_query("cube_json", text)
    with pytest.raises(ValueError, match="belong to the selected"):
        cube.query_data_as_arrow("orders_view", {"native": {"language": "cube_json",
                                 "text": '{"measures": ["orders.count"]}'}}, 11)
    assert cube.query_capabilities()["native_query_languages"] == ["cube_json"]


def test_probe_and_raw_fetch_behaviour(cube):
    cube.load_responses = [_Response({"data": [{"orders_view.segment": "SMB", "orders_view.count": "2"}]})]
    payload = cube.probe(["orders_view"], {"columns": ["Segment", "Count"], "limit": 5})
    assert payload["rows"] == [{"Segment": "SMB", "Count": 2}] and payload["exact"] is True
    assert cube.requests[-1][2]["query"]["limit"] == 5
    assert "probe failed" in cube.probe(["orders_view"], {"columns": ["Nope"]})["error"]
    with pytest.raises(ValueError, match="cannot be loaded as raw rows"):
        cube.fetch_data_as_arrow("orders_view", {})


def test_preview_samples_measures_by_dimensions(cube):
    cube.load_responses = [_Response({"data": [{"orders_view.count": "2", "orders_view.segment": "SMB"}]})]
    preview = cube.preview_data("orders_view", {"size": 10})
    body = cube.requests[-1][2]["query"]
    assert body["measures"] == ["orders_view.count", "orders_view.net_revenue", "orders_view.customers"]
    assert body["dimensions"] == ["orders_view.segment", "orders_view.customer_name", "orders_view.product_name"]
    assert body["timeDimensions"] == [{"dimension": "orders_view.created_at", "granularity": "month"}]
    assert body["limit"] == 10
    assert preview["rows"][0]["Segment"] == "SMB"


def test_errors_are_reported_without_token(cube):
    cube.load_responses = [_Response({"error": "Can't find join path"}, status=400)]
    with pytest.raises(ValueError) as caught:
        cube.query_data_as_arrow("orders_view", {"columns": ["Segment"]}, 10)
    assert "find join path" in str(caught.value) and "secret-token" not in str(caught.value)
    assert cube.get_safe_params() == {"api_url": "http://cube.test/cubejs-api/"}


def test_token_is_optional_and_base_path_defaults():
    loader = CubeDataLoader({"api_url": "http://localhost:4000/"})
    assert loader.api_url == "http://localhost:4000/cubejs-api"
    assert "Authorization" not in loader._session.headers
    assert CubeDataLoader({"api_url": "https://cube.example/custom-api"}).api_url == "https://cube.example/custom-api"
