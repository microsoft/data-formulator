from datetime import date, timedelta

import pyarrow as pa
import pytest
from google.auth.credentials import AnonymousCredentials
from google.auth.exceptions import DefaultCredentialsError

from data_formulator.data_loader.search_console_data_loader import SearchConsoleDataLoader

pytestmark = [pytest.mark.backend]

_TODAY = date(2026, 11, 11)

_SITES = {"siteEntry": [
    {"siteUrl": "sc-domain:example.com", "permissionLevel": "siteOwner"},
    {"siteUrl": "https://shop.example.com/", "permissionLevel": "SITE_RESTRICTED_USER"},
    {"siteUrl": "https://other.example/", "permissionLevel": "siteUnverifiedUser"},
]}


class _Response:
    def __init__(self, payload, status=200):
        self.payload, self.status_code, self.reason = payload, status, "Forbidden"

    def json(self):
        return self.payload


def _make(monkeypatch, **params):
    monkeypatch.setattr("google.auth.default", lambda scopes: (AnonymousCredentials(), "project"))
    # Patch the defining module's globals; other tests may reload the data_loader package.
    monkeypatch.setitem(SearchConsoleDataLoader._compile_filters.__globals__, "_pacific_today", lambda: _TODAY)
    loader = SearchConsoleDataLoader({"site_url": "sc-domain:example.com", **params})
    loader.requests = []
    loader.responses = []

    def request(method, url, json=None, timeout=None):
        loader.requests.append((method, url, json))
        return _Response(_SITES) if url.endswith("/sites") else loader.responses.pop(0)

    monkeypatch.setattr(loader._session, "request", request)
    return loader


@pytest.fixture
def gsc(monkeypatch):
    return _make(monkeypatch)


def test_catalog_is_the_connected_property(gsc):
    tables = gsc.list_tables()
    assert [table["table_key"] for table in tables] == ["sc-domain:example.com"] and gsc.requests == []
    metadata = tables[0]["metadata"]
    assert metadata["query_model"] == "semantic"
    roles = {field["name"]: field["role"] for field in metadata["columns"]}
    assert roles["Date"] == "time_dimension" and roles["Query"] == "dimension" and roles["CTR"] == "measure"
    assert gsc.list_tables("shop") == []
    assert gsc.query_model("sc-domain:example.com") == "semantic"
    assert SearchConsoleDataLoader.connection_identity({"site_url": "https://shop.example.com/"}) == "shop.example.com"


@pytest.mark.parametrize("site,ok", [
    ("sc-domain:example.com", True),
    ("https://shop.example.com/", True),
    ("https://shop.example.com", False),  # URL-prefix properties keep their trailing slash
    ("https://other.example/", False),    # unverified users cannot read data
])
def test_connection_checks_the_property_is_readable(monkeypatch, site, ok):
    assert _make(monkeypatch, site_url=site).test_connection() is ok


def test_queries_stay_on_the_connected_property(gsc):
    with pytest.raises(ValueError, match="limited to"):
        gsc.query_data_as_arrow("https://shop.example.com/", {"columns": ["Clicks"]}, 10)


def test_structured_query_compiles_to_search_analytics(monkeypatch):
    gsc = _make(monkeypatch, site_url="https://shop.example.com/")
    gsc.responses = [_Response({"rows": [
        {"keys": ["running shoes", "2026-03-01"], "clicks": 12, "impressions": 300, "ctr": 0.04, "position": 3.2},
        {"keys": ["trail shoes", "2026-03-02"], "clicks": 0, "impressions": 15, "ctr": 0, "position": 11.0},
    ]})]
    table = gsc.query_data_as_arrow("https://shop.example.com/", {
        "columns": ["Query", "Date", "Clicks", "CTR"],
        "filters": [
            {"column": "Date", "op": "BETWEEN", "value": ["2026-03-01", "2026-03-31"]},
            {"column": "Country", "op": "IN", "value": ["FRA", "bel"]},
            {"column": "Device", "op": "EQ", "value": "mobile"},
            {"column": "Query", "op": "ILIKE", "value": "%shoes%"},
            {"column": "Page", "op": "LIKE", "value": "https://shop.example.com/p?a=1%"},
            {"column": "Search appearance", "op": "NOT_IN", "value": ["VIDEO"]},
        ],
    }, 100)
    method, url, body = gsc.requests[-1]
    assert method == "POST"
    assert url.endswith("/sites/https%3A%2F%2Fshop.example.com%2F/searchAnalytics/query")
    assert body == {
        "startDate": "2026-03-01", "endDate": "2026-03-31", "type": "web",
        "dimensions": ["query", "date"], "rowLimit": 100,
        "dimensionFilterGroups": [{"groupType": "and", "filters": [
            {"dimension": "country", "operator": "includingRegex", "expression": "^(?:fra|bel)$"},
            {"dimension": "device", "operator": "equals", "expression": "MOBILE"},
            {"dimension": "query", "operator": "contains", "expression": "shoes"},
            {"dimension": "page", "operator": "includingRegex", "expression": r"^https://shop\.example\.com/p\?a=1.*$"},
            {"dimension": "searchAppearance", "operator": "notEquals", "expression": "VIDEO"},
        ]}],
    }
    assert table.column_names == ["Query", "Date", "Clicks", "CTR"]
    assert table.column("Clicks").type == pa.int64() and table.column("Clicks").to_pylist() == [12, 0]
    assert table.column("CTR").to_pylist() == [0.04, 0.0]
    assert pa.types.is_timestamp(table.column("Date").type)
    assert table.column("Query").to_pylist() == ["running shoes", "trail shoes"]


def test_measures_only_query_and_default_date_range(gsc):
    gsc.responses = [_Response({"rows": [{"keys": [], "clicks": 5, "impressions": 50, "ctr": 0.1, "position": 2.5}]}),
                     _Response({})]
    table = gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Clicks", "Position"]}, 10)
    body = gsc.requests[-1][2]
    today = _TODAY
    assert "dimensions" not in body and "dimensionFilterGroups" not in body
    assert (body["startDate"], body["endDate"]) == ((today - timedelta(days=27)).isoformat(), today.isoformat())
    assert table.to_pylist() == [{"Clicks": 5, "Position": 2.5}]
    empty = gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Query", "Clicks"]}, 10)
    assert empty.num_rows == 0 and empty.column_names == ["Query", "Clicks"]


@pytest.mark.parametrize("filters,expected", [
    ([{"column": "Date", "op": "EQ", "value": "2026-02-10"}], ("2026-02-10", "2026-02-10")),
    ([{"column": "Date", "op": "GT", "value": "2026-02-10"}, {"column": "Date", "op": "LT", "value": "2026-02-20"}],
     ("2026-02-11", "2026-02-19")),
    ([{"column": "Date", "op": "LTE", "value": "2026-02-28T00:00:00"}], ("2026-02-01", "2026-02-28")),
    ([{"column": "Date", "op": "BETWEEN", "value": ["2026-01-01", "2026-03-31"]},
      {"column": "Date", "op": "GTE", "value": "2026-02-01"}], ("2026-02-01", "2026-03-31")),
])
def test_date_filters_set_the_requested_range(gsc, filters, expected):
    gsc.responses = [_Response({"rows": []})]
    gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Clicks"], "filters": filters}, 10)
    body = gsc.requests[-1][2]
    assert (body["startDate"], body["endDate"]) == expected


def test_order_by_sorts_the_complete_result_locally(gsc):
    rows = [{"keys": [query], "clicks": clicks, "impressions": 10, "ctr": 0.1, "position": position}
            for query, clicks, position in [("a", 9, 4.0), ("b", 3, 1.5), ("c", 5, 1.5)]]
    gsc.responses = [_Response({"rows": rows})]
    table = gsc.query_data_as_arrow("sc-domain:example.com", {
        "columns": ["Query", "Clicks", "Position"],
        "order_by": [{"column": "Position", "dir": "asc"}, {"column": "Clicks", "dir": "desc"}],
    }, 2)
    assert gsc.requests[-1][2]["rowLimit"] == 25_000
    assert table.column("Query").to_pylist() == ["c", "b"]
    gsc.responses = [_Response({"rows": rows * 8334})]
    with pytest.raises(ValueError, match="may exceed 25,000 rows"):
        gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Query", "Clicks"],
                                                          "order_by": [{"column": "Query"}]}, 10)


@pytest.mark.parametrize("query,message", [
    ({"columns": []}, "Select at least one"),
    ({"columns": ["Clicks", "Clicks"]}, "only once"),
    ({"group_by": ["Query"], "aggregates": [{"op": "sum", "column": "Clicks", "as": "x"}]}, "computes measures"),
    ({"columns": ["Revenue"]}, "Unknown Search Console field"),
    ({"columns": ["Query"], "filters": [{"column": "Clicks", "op": "GT", "value": 1}]}, "cannot filter on measures"),
    ({"columns": ["Query"], "filters": [{"column": "Query", "op": "GT", "value": "a"}]}, "Unsupported filter operator"),
    ({"columns": ["Search appearance", "Date", "Clicks"]}, "grouped on its own"),
    ({"columns": ["Query"], "filters": [{"column": "Date", "op": "EQ", "value": "last week"}]}, "ISO dates"),
    ({"columns": ["Query"], "filters": [{"column": "Date", "op": "IN", "value": ["2026-01-01", "2026-01-05"]}]},
     "EQ, BETWEEN"),
    ({"columns": ["Query"], "filters": [{"column": "Date", "op": "GT", "value": "2026-02-01"},
                                       {"column": "Date", "op": "LT", "value": "2026-02-01"}]}, "empty range"),
    ({"columns": ["Query"], "order_by": [{"column": "Clicks"}]}, "selected columns"),
    ({"native": {"language": "sql", "text": "select 1"}}, "not supported"),
])
def test_structured_query_rejects_unsupported_shapes(gsc, query, message):
    with pytest.raises(ValueError, match=message):
        gsc.query_data_as_arrow("sc-domain:example.com", query, 100)


def test_limits_preview_and_raw_fetch(gsc):
    with pytest.raises(ValueError, match="between 1 and"):
        gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Clicks"]}, 20_000)
    with pytest.raises(ValueError, match="cannot be loaded as raw rows"):
        gsc.fetch_data_as_arrow("sc-domain:example.com", {})
    gsc.responses = [_Response({"rows": [{"keys": ["shoes"], "clicks": 1, "impressions": 2, "ctr": 0.5, "position": 1}]})]
    preview = gsc.preview_data("sc-domain:example.com", {"size": 10})
    assert gsc.requests[-1][2]["dimensions"] == ["query"] and gsc.requests[-1][2]["rowLimit"] == 10
    assert preview["rows"][0]["Query"] == "shoes"
    gsc.responses = [_Response({"rows": []})]
    assert gsc.probe(["sc-domain:example.com"], {"columns": ["Page", "Impressions"], "limit": 5})["rows"] == []
    assert "probe failed" in gsc.probe(["sc-domain:example.com"], {"columns": ["Nope"]})["error"]


def test_api_errors_are_reported(gsc):
    gsc.responses = [_Response({"error": {"code": 403, "message": "User does not have sufficient permission"}}, 403)]
    with pytest.raises(ValueError, match="403.*sufficient permission"):
        gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Clicks"]}, 10)


def test_params_and_credentials(monkeypatch):
    with pytest.raises(ValueError, match="search_type"):
        _make(monkeypatch, search_type="maps")
    assert _make(monkeypatch, search_type="discover")._leaf_metadata("x")["description"].startswith(
        "Google Search Console performance (discover)")

    def no_credentials(scopes):
        raise DefaultCredentialsError("Your default credentials were not found.")

    monkeypatch.setattr("google.auth.default", no_credentials)
    with pytest.raises(ValueError, match="Could not load Google credentials"):
        SearchConsoleDataLoader({"site_url": "sc-domain:example.com"})
    with pytest.raises(ValueError, match="Could not load Google credentials"):
        SearchConsoleDataLoader({"site_url": "sc-domain:example.com", "credentials_path": "/nonexistent/key.json"})
    with pytest.raises(ValueError, match="site_url is required"):
        SearchConsoleDataLoader({"site_url": "  "})
    assert SearchConsoleDataLoader.infer_auth_path({"credentials_path": "k.json"}) == "service_account_file"
    assert SearchConsoleDataLoader.auth_instructions().startswith("**Example**")


@pytest.mark.parametrize("op,pattern,expected", [
    # LIKE is case-sensitive, so it cannot use Search Console's case-insensitive contains.
    ("LIKE", "%AbC%", {"dimension": "query", "operator": "includingRegex", "expression": "^.*AbC.*$"}),
    ("ILIKE", "%AbC%", {"dimension": "query", "operator": "contains", "expression": "AbC"}),
    ("ILIKE", "AbC", {"dimension": "query", "operator": "includingRegex", "expression": "(?i)^AbC$"}),
    ("LIKE", "a_b%c.d", {"dimension": "query", "operator": "includingRegex", "expression": "^a.b.*c\\.d$"}),
    ("ILIKE", "%a_b%", {"dimension": "query", "operator": "includingRegex", "expression": "(?i)^.*a.b.*$"}),
])
def test_like_patterns_keep_sql_semantics(gsc, op, pattern, expected):
    import re
    gsc.responses = [_Response({"rows": []})]
    gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Clicks"],
                            "filters": [{"column": "Query", "op": op, "value": pattern}]}, 10)
    compiled = gsc.requests[-1][2]["dimensionFilterGroups"][0]["filters"][0]
    assert compiled == expected
    if compiled["operator"] == "includingRegex":  # Python's re agrees with RE2 on this subset.
        regex = re.compile(compiled["expression"])
        sample = pattern.replace("%", "xyz").replace("_", "-")
        assert regex.fullmatch(sample) and not regex.fullmatch(sample + "\n")


def test_discover_reports_hide_query_and_position(monkeypatch):
    discover = _make(monkeypatch, search_type="discover")
    names = [field["name"] for field in discover.list_tables()[0]["metadata"]["columns"]]
    assert "Query" not in names and "Position" not in names and "Page" in names
    with pytest.raises(ValueError, match="for the discover report"):
        discover.query_data_as_arrow("sc-domain:example.com", {"columns": ["Query", "Clicks"]}, 10)
    discover.responses = [_Response({"rows": []})]
    discover.preview_data("sc-domain:example.com", {"size": 5})
    body = discover.requests[-1][2]
    assert body["type"] == "discover" and body["dimensions"] == ["page"]


def test_search_appearance_alone_or_as_filter(gsc):
    gsc.responses = [_Response({"rows": [{"keys": ["AMP_BLUE_LINK"], "clicks": 1, "impressions": 4}]}),
                     _Response({"rows": []})]
    table = gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Search appearance", "Clicks"]}, 10)
    assert table.column("Search appearance").to_pylist() == ["AMP_BLUE_LINK"]
    gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Page", "Clicks"], "filters": [
        {"column": "Search appearance", "op": "EQ", "value": "AMP_BLUE_LINK"}]}, 10)
    assert gsc.requests[-1][2]["dimensions"] == ["page"]


def test_default_range_uses_pacific_time_today():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from data_formulator.data_loader.search_console_data_loader import _pacific_today
    assert _pacific_today() in {datetime.now(ZoneInfo("America/Los_Angeles")).date(),
                                datetime.now(ZoneInfo("America/Los_Angeles")).date() - timedelta(days=1)}


def test_service_account_file_gets_the_read_only_scope(monkeypatch):
    seen = {}

    def from_file(path, scopes):
        seen.update(path=path, scopes=scopes)
        return AnonymousCredentials()

    monkeypatch.setattr("google.oauth2.service_account.Credentials.from_service_account_file", from_file)
    SearchConsoleDataLoader({"site_url": "sc-domain:example.com", "credentials_path": "/keys/sa.json"})
    assert seen == {"path": "/keys/sa.json", "scopes": ["https://www.googleapis.com/auth/webmasters.readonly"]}


def test_executor_overflow_limit_is_accepted(gsc):
    gsc.responses = [_Response({"rows": []})]
    gsc.query_data_as_arrow("sc-domain:example.com", {"columns": ["Query", "Clicks"]}, 10_001)
    assert gsc.requests[-1][2]["rowLimit"] == 10_001
