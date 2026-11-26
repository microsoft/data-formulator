from datetime import datetime
from urllib.parse import parse_qs, urlsplit

import pyarrow as pa
import pytest
import requests
from google.auth.credentials import AnonymousCredentials
from google.auth.exceptions import DefaultCredentialsError

from data_formulator.data_loader.google_analytics_data_loader import GoogleAnalyticsDataLoader

pytestmark = [pytest.mark.backend]

_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
_METADATA = {
    "dimensions": [
        {"apiName": "date", "uiName": "Date", "description": "  Reporting date.  "},
        {"apiName": "pagePath", "uiName": "Page path"},
        {"apiName": "country", "uiName": "Country"},
        {"apiName": "deviceCategory", "uiName": "Device", "description": "  "},
        {"apiName": "customEvent:tag", "uiName": "Shared", "customDefinition": True},
        {"apiName": "untitled"},
    ],
    "metrics": [
        {"apiName": "screenPageViews", "uiName": "Views", "type": "TYPE_INTEGER"},
        {"apiName": "activeUsers", "uiName": "Active users", "type": "TYPE_INTEGER"},
        {"apiName": "sessions", "uiName": "Sessions", "type": "TYPE_INTEGER"},
        {"apiName": "bounceRate", "uiName": "Bounce rate", "type": "TYPE_FLOAT"},
        {"apiName": "customEvent:score", "uiName": "Shared", "type": "TYPE_STANDARD", "customDefinition": True},
        {"apiName": "purchaseRevenue", "uiName": "Revenue", "type": "TYPE_CURRENCY", "blockedReasons": ["NO_REVENUE_METRICS"]},
    ],
}
_ACCOUNTS = [
    {"accountSummaries": [{"account": "accounts/1", "displayName": "First", "propertySummaries": [
        {"property": "properties/123", "displayName": "Store"},
    ]}], "nextPageToken": "next+/="},
    {"accountSummaries": [{"account": "accounts/2", "displayName": "Second", "propertySummaries": [
        {"property": "properties/456", "displayName": "Blog"},
    ]}]},
]


class _Response:
    def __init__(self, payload, status=200):
        self.payload, self.status_code, self.reason = payload, status, "Forbidden"

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


def _report(rows=None):
    return {"dimensionHeaders": [{"name": "pagePath"}, {"name": "date"}],
            "metricHeaders": [{"name": "bounceRate", "type": "TYPE_FLOAT"},
                              {"name": "screenPageViews", "type": "TYPE_INTEGER"}],
            "rows": rows or []}


def _make(monkeypatch, metadata=None, **params):
    monkeypatch.setattr("google.auth.default", lambda scopes: (AnonymousCredentials(), "project"))
    loader = GoogleAnalyticsDataLoader({"property_id": "123", **params})
    loader.requests = []
    loader.responses = []
    loader.accounts = list(_ACCOUNTS)
    loader.metadata = _METADATA if metadata is None else metadata

    def request(method, url, json=None, timeout=None):
        assert timeout == 60
        loader.requests.append((method, url, json))
        if "/accountSummaries?" in url:
            page = 1 if parse_qs(urlsplit(url).query).get("pageToken") else 0
            return _Response(loader.accounts[page])
        if url.endswith("/metadata"):
            return loader.metadata if isinstance(loader.metadata, _Response) else _Response(loader.metadata)
        return loader.responses.pop(0)

    monkeypatch.setattr(loader._session, "request", request)
    return loader


@pytest.fixture
def ga4(monkeypatch):
    return _make(monkeypatch)


def test_account_catalog_paginates_and_caches_metadata(monkeypatch):
    loader = _make(monkeypatch, property_id="")
    tables = loader.list_tables()
    assert [(item["name"], item["table_key"], item["path"]) for item in tables] == [
        ("Store (properties/123)", "properties/123", ["Store (properties/123)"]),
        ("Blog (properties/456)", "properties/456", ["Blog (properties/456)"]),
    ]
    assert loader.requests[:2] == [
        ("GET", "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", None),
        ("GET", "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200&pageToken=next%2B%2F%3D", None),
    ]
    assert [item["name"] for item in loader.list_tables("bLoG")] == ["Blog (properties/456)"]
    assert loader.list_tables("missing") == []
    assert len([url for _, url, _ in loader.requests if url.endswith("/metadata")]) == 2
    assert loader.get_metadata(tables[0]["path"]) == tables[0]["metadata"]
    assert tables[0]["metadata"]["_source_name"] == "Store (properties/123)"
    assert tables[0]["metadata"]["description"] == "Google Analytics 4 property Store (properties/123)"
    loader.responses = [_Response({})]
    loader.query_data_as_arrow("Blog (properties/456)", {"columns": ["Country"]}, 5)
    assert loader.requests[-1][1] == "https://analyticsdata.googleapis.com/v1beta/properties/456:runReport"


def test_pinned_property_and_field_mapping(ga4):
    assert ga4.property_id == "properties/123"
    tables = ga4.list_tables()
    assert len(tables) == 1
    assert (tables[0]["name"], tables[0]["table_key"], tables[0]["path"]) == (
        "properties/123", "properties/123", ["properties/123"])
    metadata = tables[0]["metadata"]
    assert metadata["query_model"] == "semantic"
    assert metadata["_source_name"] == "properties/123"
    fields = {field["ref"]: field for field in metadata["columns"]}
    assert fields["date"] == {"name": "Date", "ref": "date", "role": "time_dimension", "type": "time",
                              "description": "Reporting date."}
    assert fields["screenPageViews"] == {"name": "Views", "ref": "screenPageViews", "role": "measure", "type": "number"}
    assert fields["pagePath"]["role"] == "dimension" and fields["pagePath"]["type"] == "string"
    assert "description" not in fields["deviceCategory"]
    assert fields["untitled"]["name"] == "untitled"
    assert fields["customEvent:tag"]["name"] == "Shared (customEvent:tag)"
    assert fields["customEvent:score"]["name"] == "Shared (customEvent:score)"
    assert "purchaseRevenue" not in fields
    assert all("aggregation" not in field for field in fields.values())
    assert [field["role"] for field in metadata["columns"]] == ["time_dimension"] + ["dimension"] * 5 + ["measure"] * 5
    assert ga4.get_column_types("123") == {"columns": metadata["columns"], "description": "Google Analytics 4 property 123"}
    assert ga4.get_metadata([]) == {}
    assert ga4.query_model("Store (properties/123)") == "semantic"
    assert ga4.list_tables("456") == []
    assert len(ga4.requests) == 1 and ga4.requests[0][1].endswith("/properties/123/metadata")
    assert GoogleAnalyticsDataLoader.connection_identity({"property_id": "123"}) == "123"
    assert GoogleAnalyticsDataLoader.connection_identity({}) == ""


@pytest.mark.parametrize("source", ["456", "properties/456", "Other (properties/456)"])
def test_pinned_property_refuses_other_properties(ga4, source):
    for action in (lambda: ga4.query_data_as_arrow(source, {"columns": ["Views"]}, 10),
                   lambda: ga4.get_metadata([source]), lambda: ga4.get_column_types(source),
                   lambda: ga4.preview_data(source), lambda: ga4.query_model(source)):
        with pytest.raises(ValueError, match="This connection is limited to"):
            action()
    assert ga4.requests == []


@pytest.mark.parametrize("source", ["123", "properties/123", "Store (properties/123)",
                                    "Moved from properties/999 (properties/123)"])
def test_source_aliases_resolve_to_the_same_property(ga4, source):
    ga4.responses = [_Response({})]
    ga4.query_data_as_arrow(source, {"columns": ["Country"]}, 10)
    assert ga4.requests[-1][1].endswith("/properties/123:runReport")


def test_full_request_and_header_mapped_arrow_types(ga4):
    ga4.responses = [_Response(_report([
        {"dimensionValues": [{"value": "/shoes"}, {"value": "20260301"}],
         "metricValues": [{"value": "0.25"}, {"value": "12"}]},
        {"dimensionValues": [{"value": "/boots"}, {"value": "invalid"}],
         "metricValues": [{"value": "invalid"}, {"value": "0"}]},
    ]))]
    table = ga4.query_data_as_arrow("123", {
        "columns": ["Views", "Date", "Bounce rate", "Page path"],
        "filters": [
            {"column": "Date", "op": "BETWEEN", "value": ["2026-03-01", "2026-03-31"]},
            {"column": "Country", "op": "EQ", "value": "France"},
            {"column": "Device", "op": "IN", "value": ["mobile", "desktop"]},
            {"column": "Country", "op": "NEQ", "value": "Belgium"},
            {"column": "Device", "op": "NOT_IN", "value": ["tablet"]},
            {"column": "Page path", "op": "ILIKE", "value": "%Shoes%"},
            {"column": "Page path", "op": "LIKE", "value": "/a_b%c.d%"},
            {"column": "Views", "op": "GT", "value": "10"},
            {"column": "Bounce rate", "op": "BETWEEN", "value": [0.1, "0.9"]},
        ],
        "order_by": [{"column": "Views", "dir": "desc"}, {"column": "Page path", "dir": "asc"}],
    }, 100)
    assert ga4.requests[-1] == ("POST", "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport", {
        "dimensions": [{"name": "date"}, {"name": "pagePath"}],
        "metrics": [{"name": "screenPageViews"}, {"name": "bounceRate"}],
        "dateRanges": [{"startDate": "2026-03-01", "endDate": "2026-03-31"}],
        "dimensionFilter": {"andGroup": {"expressions": [
            {"filter": {"fieldName": "country", "stringFilter": {"matchType": "EXACT", "value": "France", "caseSensitive": True}}},
            {"filter": {"fieldName": "deviceCategory", "inListFilter": {"values": ["mobile", "desktop"], "caseSensitive": True}}},
            {"notExpression": {"filter": {"fieldName": "country", "stringFilter": {"matchType": "EXACT", "value": "Belgium", "caseSensitive": True}}}},
            {"notExpression": {"filter": {"fieldName": "deviceCategory", "inListFilter": {"values": ["tablet"], "caseSensitive": True}}}},
            {"filter": {"fieldName": "pagePath", "stringFilter": {"matchType": "CONTAINS", "value": "Shoes", "caseSensitive": False}}},
            {"filter": {"fieldName": "pagePath", "stringFilter": {"matchType": "FULL_REGEXP", "value": r"(?s)/a.b.*c\.d.*", "caseSensitive": True}}},
        ]}},
        "metricFilter": {"andGroup": {"expressions": [
            {"filter": {"fieldName": "screenPageViews", "numericFilter": {"operation": "GREATER_THAN", "value": {"doubleValue": 10.0}}}},
            {"filter": {"fieldName": "bounceRate", "betweenFilter": {"fromValue": {"doubleValue": 0.1}, "toValue": {"doubleValue": 0.9}}}},
        ]}},
        "orderBys": [{"metric": {"metricName": "screenPageViews"}, "desc": True},
                     {"dimension": {"dimensionName": "pagePath"}, "desc": False}],
        "limit": 100,
    })
    assert table.column_names == ["Views", "Date", "Bounce rate", "Page path"]
    assert table.column("Views").type == pa.int64() and table.column("Views").to_pylist() == [12, 0]
    assert table.column("Bounce rate").type == pa.float64() and table.column("Bounce rate").to_pylist() == [0.25, None]
    assert pa.types.is_timestamp(table.column("Date").type)
    assert table.column("Date").to_pylist() == [datetime(2026, 3, 1), None]
    assert table.column("Page path").type == pa.string() and table.column("Page path").to_pylist() == ["/shoes", "/boots"]


@pytest.mark.parametrize("filters,expected", [
    ([], ("28daysAgo", "yesterday")),
    ([{"column": "Date", "op": "EQ", "value": "2026-02-10T12:00:00"}], ("2026-02-10", "2026-02-10")),
    ([{"column": "Date", "op": "IN", "value": ["2026-02-10"]}], ("2026-02-10", "2026-02-10")),
    ([{"column": "Date", "op": "GTE", "value": "2026-02-10"}], ("2026-02-10", "today")),
    ([{"column": "Date", "op": "GT", "value": "2026-02-10"}], ("2026-02-11", "today")),
    ([{"column": "Date", "op": "LTE", "value": "2026-02-28"}], ("2026-02-01", "2026-02-28")),
    ([{"column": "Date", "op": "LT", "value": "2026-03-01"}], ("2026-02-01", "2026-02-28")),
    ([{"column": "Date", "op": "BETWEEN", "value": ["2026-01-01", "2026-03-31"]},
      {"column": "Date", "op": "GTE", "value": "2026-02-10"},
      {"column": "Date", "op": "LT", "value": "2026-02-20"}], ("2026-02-10", "2026-02-19")),
])
def test_default_and_partial_date_ranges(ga4, filters, expected):
    ga4.responses = [_Response({})]
    ga4.query_data_as_arrow("123", {"columns": ["Views"], "filters": filters}, 10)
    body = ga4.requests[-1][2]
    assert body["dateRanges"] == [{"startDate": expected[0], "endDate": expected[1]}]
    assert "dimensionFilter" not in body and body["dimensions"] == []


@pytest.mark.parametrize("op,pattern,kind,text", [
    ("LIKE", "%AbC%", "CONTAINS", "AbC"),
    ("ILIKE", "AbC%", "BEGINS_WITH", "AbC"),
    ("LIKE", "%AbC", "ENDS_WITH", "AbC"),
    ("ILIKE", "AbC", "EXACT", "AbC"),
    ("LIKE", "a_b%c.d", "FULL_REGEXP", r"(?s)a.b.*c\.d"),
    ("ILIKE", "%a_b%", "FULL_REGEXP", "(?s).*a.b.*"),
    ("LIKE", r"%a\.+*?()|[]{}^$_%", "FULL_REGEXP", r"(?s).*a\\\.\+\*\?\(\)\|\[\]\{\}\^\$..*"),
    ("LIKE", "%", "CONTAINS", ""),
    ("LIKE", "", "EXACT", ""),
    ("LIKE", "%%abc%%", "FULL_REGEXP", "(?s).*.*abc.*.*"),
])
def test_like_translation(ga4, op, pattern, kind, text):
    ga4.responses = [_Response({})]
    ga4.query_data_as_arrow("123", {"columns": ["Country"], "filters": [
        {"column": "Page path", "op": op, "value": pattern}]}, 10)
    assert ga4.requests[-1][2]["dimensionFilter"] == {"andGroup": {"expressions": [
        {"filter": {"fieldName": "pagePath", "stringFilter": {"matchType": kind, "value": text, "caseSensitive": op == "LIKE"}}},
    ]}}


@pytest.mark.parametrize("op", ["IS_NULL", "IS_NOT_NULL"])
def test_dimension_empty_filters(ga4, op):
    ga4.responses = [_Response({})]
    ga4.query_data_as_arrow("123", {"columns": ["Country"], "filters": [{"column": "Country", "op": op}]}, 10)
    expected = {"filter": {"fieldName": "country", "emptyFilter": {}}}
    if op == "IS_NOT_NULL":
        expected = {"notExpression": expected}
    assert ga4.requests[-1][2]["dimensionFilter"] == {"andGroup": {"expressions": [expected]}}


@pytest.mark.parametrize("op,operation", [
    ("EQ", "EQUAL"), ("NEQ", "EQUAL"), ("GT", "GREATER_THAN"), ("GTE", "GREATER_THAN_OR_EQUAL"),
    ("LT", "LESS_THAN"), ("LTE", "LESS_THAN_OR_EQUAL"),
])
def test_numeric_comparisons(ga4, op, operation):
    ga4.responses = [_Response({})]
    ga4.query_data_as_arrow("123", {"columns": ["Views"], "filters": [{"column": "Views", "op": op, "value": "2.5"}]}, 10)
    expected = {"filter": {"fieldName": "screenPageViews", "numericFilter": {"operation": operation, "value": {"doubleValue": 2.5}}}}
    if op == "NEQ":
        expected = {"notExpression": expected}
    assert ga4.requests[-1][2]["metricFilter"] == {"andGroup": {"expressions": [expected]}}


@pytest.mark.parametrize("query,message", [
    ({"columns": []}, "Select at least one"),
    ({"columns": ["Views", "Views"]}, "only once"),
    ({"group_by": ["Country"]}, "computes measures"),
    ({"aggregates": [{"op": "sum", "column": "Views"}]}, "computes measures"),
    ({"columns": ["Missing"]}, "Unknown Google Analytics field.*Available"),
    ({"columns": ["Revenue"]}, "Unknown Google Analytics field"),
    ({"columns": ["Country"], "filters": [{"column": "Missing", "op": "EQ", "value": "x"}]}, "Unknown filter column"),
    ({"columns": ["Country"], "filters": [{"column": "Country", "op": "GT", "value": "x"}]}, "dimension filter"),
    ({"columns": ["Country"], "filters": [{"column": "Country", "op": "EQ", "value": ["x", "y"]}]}, "dimension filter"),
    ({"columns": ["Country"], "filters": [{"column": "Country", "op": "IN", "value": []}]}, "dimension filter"),
    ({"columns": ["Country"], "filters": [{"column": "Date", "op": "EQ", "value": "today"}]}, "ISO dates"),
    ({"columns": ["Country"], "filters": [{"column": "Date", "op": "IN", "value": ["2026-01-01", "2026-01-02"]}]}, "one ISO date"),
    ({"columns": ["Country"], "filters": [{"column": "Date", "op": "NEQ", "value": "2026-01-01"}]}, "one ISO date"),
    ({"columns": ["Country"], "filters": [{"column": "Date", "op": "BETWEEN", "value": ["2026-03-01", "2026-02-01"]}]}, "empty range"),
    ({"columns": ["Country"], "filters": [{"column": "Date", "op": "GT", "value": "2026-02-01"},
                                         {"column": "Date", "op": "LT", "value": "2026-02-01"}]}, "empty range"),
    ({"columns": ["Views"], "filters": [{"column": "Views", "op": "EQ", "value": "many"}]}, "numeric values"),
    ({"columns": ["Views"], "filters": [{"column": "Views", "op": "BETWEEN", "value": [1, "many"]}]}, "numeric values"),
    ({"columns": ["Views"], "filters": [{"column": "Views", "op": "IN", "value": [1, 2]}]}, "metric filter"),
    ({"columns": ["Views"], "filters": [{"column": "Views", "op": "BETWEEN", "value": [1]}]}, "metric filter"),
    ({"columns": ["Views"], "filters": [{"column": "Views", "op": "IS_NULL"}]}, "metric filter"),
    ({"columns": ["Country"], "order_by": [{"column": "Views"}]}, "selected columns"),
    ({"native": {"language": "sql", "text": "select 1"}}, "not supported"),
])
def test_rejected_query_shapes(ga4, query, message):
    with pytest.raises(ValueError, match=message):
        ga4.query_data_as_arrow("123", query, 100)
    assert all(method == "GET" for method, _, _ in ga4.requests)


@pytest.mark.parametrize("value", [None, True, "nan", "inf", "-inf"])
def test_invalid_numeric_values(ga4, value):
    with pytest.raises(ValueError, match="numeric values"):
        ga4.query_data_as_arrow("123", {"columns": ["Views"], "filters": [{"column": "Views", "op": "GT", "value": value}]}, 10)


def test_dimension_only_and_empty_typed_results(ga4):
    ga4.responses = [_Response({"dimensionHeaders": [{"name": "country"}],
                                "rows": [{"dimensionValues": [{"value": "France"}]}]}), _Response(_report())]
    table = ga4.query_data_as_arrow("123", {"columns": ["Country"]}, 10)
    assert ga4.requests[-1][2]["metrics"] == [] and table.to_pylist() == [{"Country": "France"}]
    table = ga4.query_data_as_arrow("123", {"columns": ["Date", "Views", "Bounce rate", "Page path"]}, 10)
    assert table.num_rows == 0 and table.column_names == ["Date", "Views", "Bounce rate", "Page path"]
    assert pa.types.is_timestamp(table.column("Date").type)
    assert [table.column(name).type for name in ["Views", "Bounce rate", "Page path"]] == [pa.int64(), pa.float64(), pa.string()]


@pytest.mark.parametrize("metric_type", ["TYPE_FLOAT", "TYPE_SECONDS", "TYPE_MILLISECONDS", "TYPE_MINUTES", "TYPE_HOURS",
                                        "TYPE_STANDARD", "TYPE_CURRENCY", "TYPE_FEET", "TYPE_MILES", "TYPE_METERS", "TYPE_KILOMETERS"])
def test_other_metric_types_are_float64(ga4, metric_type):
    ga4.responses = [_Response({"metricHeaders": [{"name": "screenPageViews", "type": metric_type}],
                                "rows": [{"metricValues": [{"value": "1.25"}]}]})]
    table = ga4.query_data_as_arrow("123", {"columns": ["Views"]}, 10)
    assert table.column("Views").type == pa.float64() and table.column("Views").to_pylist() == [1.25]


def test_preview_defaults_fetch_options_and_probe(ga4):
    ga4.responses = [_Response({}), _Response({}), _Response({}), _Response({}), _Response({})]
    assert ga4.preview_data("123", {"size": 10})["rows"] == []
    body = ga4.requests[-1][2]
    assert body["dimensions"] == [{"name": "pagePath"}]
    assert body["metrics"] == [{"name": ref} for ref in ["screenPageViews", "activeUsers", "sessions"]]
    assert body["limit"] == 10
    ga4.preview_data("123", {"columns": ["Country"]})
    assert ga4.requests[-1][2]["dimensions"] == [{"name": "country"}]
    ga4.preview_data("123", {"structured_query": {"columns": ["Views"]}})
    assert ga4.requests[-1][2]["dimensions"] == []
    ga4.fetch_data_as_arrow("123", {"columns": ["Country"], "size": 7,
                                   "source_filters": [{"column": "Country", "operator": "EQ", "value": "France"}],
                                   "sort_columns": ["Country"], "sort_order": "desc"})
    assert ga4.requests[-1][2]["orderBys"] == [{"dimension": {"dimensionName": "country"}, "desc": True}]
    assert ga4.requests[-1][2]["dimensionFilter"]["andGroup"]["expressions"][0]["filter"]["stringFilter"]["value"] == "France"
    assert ga4.requests[-1][2]["limit"] == 7
    assert ga4.probe(["123"], {"columns": ["Country"], "limit": 5})["rows"] == []
    assert ga4.requests[-1][2]["limit"] == 5
    assert "probe failed" in ga4.probe(["123"], {"columns": ["Missing"]})["error"]
    assert "non-empty table path" in ga4.probe([], {})["error"]


def test_sampled_reports_make_probes_approximate(ga4):
    sampled = {**_report([{"dimensionValues": [{"value": "/"}, {"value": "20261101"}],
                           "metricValues": [{"value": "0.5"}, {"value": "7"}]}]),
               "metadata": {"samplingMetadatas": [{"samplesReadCount": "10", "samplingSpaceSize": "100"}]}}
    ga4.responses = [_Response(sampled), _Response(_report())]
    payload = ga4.probe(["123"], {"columns": ["Page path", "Views"], "limit": 5})
    assert payload["exact"] is False and "sampled" in str(payload)
    assert ga4.probe(["123"], {"columns": ["Page path", "Views"], "limit": 5})["exact"] is True
    with pytest.raises(ValueError, match="cannot be loaded as raw rows"):
        ga4.fetch_data_as_arrow("123")


def test_preview_fallback_columns(monkeypatch):
    metadata = {"dimensions": [{"apiName": "country", "uiName": "Country"}],
                "metrics": [{"apiName": f"metric{i}", "uiName": f"Metric {i}"} for i in range(5)]}
    loader = _make(monkeypatch, metadata=metadata)
    loader.responses = [_Response({})]
    loader.preview_data("123")
    assert loader.requests[-1][2]["dimensions"] == [{"name": "country"}]
    assert loader.requests[-1][2]["metrics"] == [{"name": f"metric{i}"} for i in range(3)]


@pytest.mark.parametrize("limit", [0, -1, True, 1.5, "10", 10_002])
def test_invalid_limits(ga4, limit):
    with pytest.raises(ValueError, match="between 1 and 10001"):
        ga4.query_data_as_arrow("123", {"columns": ["Country"]}, limit)
    assert ga4.requests == []


def test_executor_overflow_limit_and_structured_fetch(ga4):
    ga4.responses = [_Response({}), _Response({})]
    ga4.query_data_as_arrow("123", {"columns": ["Country"]}, 10_001)
    assert ga4.requests[-1][2]["limit"] == 10_001
    ga4.fetch_data_as_arrow("123", {"structured_query": {"columns": ["Country"]}})
    assert ga4.requests[-1][2]["limit"] == 10_001


@pytest.mark.parametrize("pinned", [True, False])
def test_connection_in_both_modes(monkeypatch, pinned):
    loader = _make(monkeypatch, property_id="123" if pinned else "")
    assert loader.test_connection() is True
    if pinned:
        assert all(url.endswith("/metadata") for _, url, _ in loader.requests)
        loader = _make(monkeypatch, metadata=_Response({"error": {"message": "No access"}}, 403))
    else:
        assert all("/accountSummaries?" in url for _, url, _ in loader.requests)
        loader.accounts = [{}]
        assert loader.test_connection() is False and loader.list_tables() == []

        def fail(*args, **kwargs):
            raise requests.ConnectionError("offline")

        monkeypatch.setattr(loader._session, "request", fail)
    assert loader.test_connection() is False


@pytest.mark.parametrize("payload,expected", [
    ({"error": {"message": "Insufficient permission token=fake-secret /tmp/private/location"}},
     "Google Analytics API error 403: Insufficient permission token=<redacted> <path>"),
    (ValueError("invalid JSON"), "Google Analytics API error 403: Forbidden"),
    (["not an object"], "Google Analytics API error 403: Forbidden"),
])
def test_api_errors_are_sanitized(ga4, payload, expected):
    ga4.responses = [_Response(payload, 403)]
    with pytest.raises(ValueError) as error:
        ga4.query_data_as_arrow("123", {"columns": ["Views"]}, 10)
    assert str(error.value) == expected


@pytest.mark.parametrize("property_id", ["abc", "accounts/123", "properties/123/x", "Store (properties/123)", "-1"])
def test_invalid_property_params(monkeypatch, property_id):
    with pytest.raises(ValueError, match="property_id"):
        _make(monkeypatch, property_id=property_id)


@pytest.mark.parametrize("source", ["abc", "accounts/123", "", "-1"])
def test_invalid_source_property(ga4, source):
    with pytest.raises(ValueError, match="Invalid Google Analytics property"):
        ga4.query_data_as_arrow(source, {"columns": ["Country"]}, 10)


def test_params_and_auth_paths(monkeypatch):
    assert _make(monkeypatch, property_id="properties/123").property_id == "properties/123"
    assert GoogleAnalyticsDataLoader.DISPLAY_NAME == "Google Analytics 4"
    assert GoogleAnalyticsDataLoader.DESCRIPTION == "Query dimensions and metrics from Google Analytics 4 properties."
    assert GoogleAnalyticsDataLoader.QUERY_EXECUTION == "semantic_query"
    assert GoogleAnalyticsDataLoader.AUTH_GUIDE == "google_analytics.md"
    assert GoogleAnalyticsDataLoader.catalog_hierarchy() == [{"key": "table", "label": "Property"}]
    params = GoogleAnalyticsDataLoader.list_params()
    assert [item["name"] for item in params] == ["property_id", "credentials_path"]
    assert all(item["default"] == "" and item["required"] is False and item["type"] == "text" for item in params)
    assert [item["tier"] for item in params] == ["filter", "auth"]
    assert GoogleAnalyticsDataLoader.infer_auth_path({}) == "default_credentials"
    assert GoogleAnalyticsDataLoader.infer_auth_path({"credentials_path": "fake.json"}) == "service_account_file"
    paths = GoogleAnalyticsDataLoader.auth_paths()
    assert paths[0]["id"] == "default_credentials" and paths[0]["default"] is True and paths[0]["kind"] == "ambient"
    assert paths[1]["id"] == "service_account_file" and paths[1]["required_fields"] == ["credentials_path"]


@pytest.mark.parametrize("exception", [DefaultCredentialsError("Not found"), OSError("Unreadable"), ValueError("Invalid")])
@pytest.mark.parametrize("from_file", [True, False])
def test_credential_errors_do_not_read_files(monkeypatch, exception, from_file):
    def fail(*args, **kwargs):
        raise exception

    monkeypatch.setattr("google.auth.default", fail)
    monkeypatch.setattr("google.oauth2.service_account.Credentials.from_service_account_file", fail)
    params = {"credentials_path": "/fake/service-account.json"} if from_file else {}
    with pytest.raises(ValueError, match="Could not load Google credentials"):
        GoogleAnalyticsDataLoader(params)


@pytest.mark.parametrize("from_file", [True, False])
def test_credentials_get_the_analytics_read_only_scope(monkeypatch, from_file):
    seen = {}

    def from_service_account_file(path, scopes):
        seen.update(path=path, scopes=scopes)
        return AnonymousCredentials()

    def default(scopes):
        seen.update(scopes=scopes)
        return AnonymousCredentials(), "project"

    monkeypatch.setattr("google.auth.default", default)
    monkeypatch.setattr("google.oauth2.service_account.Credentials.from_service_account_file", from_service_account_file)
    GoogleAnalyticsDataLoader({"credentials_path": "/fake/service-account.json"} if from_file else {})
    assert seen == ({"path": "/fake/service-account.json", "scopes": [_SCOPE]} if from_file else {"scopes": [_SCOPE]})


def test_cancellation_prevents_the_report_request(ga4, monkeypatch):
    def cancelled():
        raise RuntimeError("cancelled")

    monkeypatch.setitem(GoogleAnalyticsDataLoader.query_data_as_arrow.__globals__, "check_cancelled", cancelled)
    with pytest.raises(RuntimeError, match="cancelled"):
        ga4.query_data_as_arrow("123", {"columns": ["Country"]}, 10)
    assert all(method == "GET" for method, _, _ in ga4.requests)
