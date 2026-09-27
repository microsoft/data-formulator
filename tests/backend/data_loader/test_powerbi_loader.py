import json

import pytest

from data_formulator.data_loader.powerbi_data_loader import PowerBIDataLoader

pytestmark = [pytest.mark.backend]

_WS = "a260d482-0b46-4f01-bff7-ab772bf87119"
_DS = "c79822f2-f3b9-4f81-8b86-040b86fd264f"


def _meta(kind, table, name=None, y=None, hidden=False, description=None, fmt=None, folder=None, x=None, s=None):
    return {"[K]": kind, "[T]": table, "[N]": name, "[Y]": y, "[H]": hidden, "[D]": description,
            "[F]": fmt, "[G]": folder, "[X]": x, "[S]": s}


_METADATA_ROWS = [
    _meta("table", "Sales", description="Order lines"),
    _meta("table", "Customer"),
    _meta("table", "Reseller"),
    _meta("table", "Date", y="Time"),
    _meta("table", "Scratch", hidden=True),
    _meta("column", "Sales", "RowNumber-1", "Integer", hidden=True, x="RowNumber"),
    _meta("column", "Sales", "CustomerKey", "Integer", hidden=True, x="Data"),
    _meta("column", "Customer", "City", "Text", description="Customer city.", x="Data"),
    _meta("column", "Reseller", "City", "Text", x="Data"),
    _meta("column", "Customer", "Segment", "Text", x="Data"),
    _meta("column", "Customer", "Is Active", "Boolean", x="Data"),
    _meta("column", "Date", "Month", "Date", fmt="mmm, yyyy", x="Data"),
    _meta("column", "Date", "Year", "Integer", x="Calculated"),
    _meta("column", "Sales", "Sales Amount", "Number", description="Line revenue.", x="Data", s="Sum"),
    _meta("column", "Sales", "Unit Price", "Number", x="Data", s="Average"),
    _meta("column", "Sales", "Line Label", "Text", x="Data", s="Count"),
    _meta("column", "Scratch", "Note", "Text", x="Data"),
    _meta("measure", "Sales", "Sales", "Variant", description="Total sales.", fmt="\\$#,0", folder="Core"),
    _meta("measure", "Sales", "Orders", "Variant"),
    _meta("measure", "Sales", "Draft", "Variant", hidden=True),
    _meta("measure", "Scratch", "Scratch Measure", "Variant"),
    _meta("relationship", "Sales", "CustomerKey", "Customer", False, "CustomerKey", "OneDirection", "Many", "One"),
    _meta("relationship", "Sales", "ShipDateKey", "Date", True, "DateKey", "BothDirections", "Many", "One"),
]


class _Response:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status

    def json(self):
        return self.payload


@pytest.fixture
def pbi(monkeypatch):
    monkeypatch.setattr("azure.identity.DefaultAzureCredential", lambda: None)
    loader = PowerBIDataLoader({"workspace": "Sales Analytics"})
    monkeypatch.setattr(loader._credential, "token", lambda: "token")
    loader.requests = []
    loader.query_rows = []

    def request(method, url, headers=None, timeout=None, params=None, json=None):
        loader.requests.append((method, url, params, json))
        if url.endswith("/groups"):
            return _Response({"value": [{"id": _WS, "name": "Sales Analytics"}]})
        if url.endswith("/datasets"):
            return _Response({"value": [{"id": _DS, "name": "AdventureWorks Sales", "description": "Governed sales"}]})
        query = json["queries"][0]["query"]
        if "INFO.VIEW" in query:
            return _Response({"results": [{"tables": [{"rows": _METADATA_ROWS}]}]})
        return loader.query_rows.pop(0)

    monkeypatch.setattr(loader._session, "request", request)
    return loader


def _fields(loader):
    return {field["name"]: field for field in loader.list_tables()[0]["metadata"]["columns"]}


def _last_dax(loader):
    return loader.requests[-1][3]["queries"][0]["query"]


def test_catalog_maps_model_to_semantic_fields(pbi):
    tables = pbi.list_tables()
    assert [(table["name"], table["table_key"]) for table in tables] == [("AdventureWorks Sales", _DS)]
    assert pbi.requests[0][2] == {"$filter": "name eq 'Sales Analytics'"}
    metadata = tables[0]["metadata"]
    assert metadata["query_model"] == "semantic" and metadata["dataset_id"] == _DS
    assert metadata["description"] == "Governed sales Tables: Sales: Order lines"
    fields = _fields(pbi)
    assert set(fields) == {"Sales", "Orders", "Customer[City]", "Reseller[City]", "Segment", "Is Active", "Month", "Year",
                           "Sales Amount", "Unit Price", "Line Label"}
    assert fields["Sales Amount"] == {"name": "Sales Amount", "ref": "SUM('Sales'[Sales Amount])", "type": "number",
                                      "data_type": "Number", "role": "measure", "aggregation": "sum", "entity": "Sales",
                                      "description": "Measure: sum of Sales[Sales Amount]. Line revenue."}
    assert fields["Unit Price"]["ref"] == "AVERAGE('Sales'[Unit Price])"
    assert fields["Line Label"]["role"] == "dimension"
    assert fields["Sales"] == {"name": "Sales", "ref": "[Sales]", "type": "number", "role": "measure", "entity": "Sales",
                               "description": "Measure in Core: Total sales.", "format": "\\$#,0"}
    assert fields["Customer[City]"]["ref"] == "'Customer'[City]"
    assert fields["Month"]["role"] == "time_dimension" and fields["Month"]["type"] == "time"
    assert fields["Year"]["type"] == "number" and fields["Is Active"]["type"] == "boolean"
    assert metadata["relationships"] == [
        {"from": "Sales[CustomerKey]", "to": "Customer[CustomerKey]", "cardinality": "many_to_one", "cross_filter": "single"},
        {"from": "Sales[ShipDateKey]", "to": "Date[DateKey]", "cardinality": "many_to_one", "cross_filter": "both",
         "active": False},
    ]
    assert pbi.query_model(_DS) == "semantic"


def test_structured_query_compiles_to_summarizecolumns(pbi):
    pbi.list_tables()
    pbi.query_rows.append(_Response({"results": [{"tables": [{"rows": [
        {"[__c0]": "Consumer", "[__c1]": "2019-01-01T00:00:00", "[__c2]": 120.5, "[__c3]": 3},
        {"[__c0]": "O'Brien \"Co\"", "[__c1]": "2019-02-01T00:00:00", "[__c2]": None, "[__c3]": 1},
    ]}]}]}))
    table = pbi.query_data_as_arrow("AdventureWorks Sales", {
        "columns": ["Segment", "Month", "Sales", "Orders"],
        "filters": [{"column": "Segment", "op": "IN", "value": ["O'Brien \"Co\"", "Consumer"]},
                    {"column": "Year", "op": "GTE", "value": 2019},
                    {"column": "Month", "op": "BETWEEN", "value": ["2019-01-01", "2019-06-30T12:00:00"]},
                    {"column": "Customer[City]", "op": "LIKE", "value": "%ville"}],
        "order_by": [{"column": "Sales", "dir": "desc"}],
    }, 11)
    assert _last_dax(pbi) == (
        "EVALUATE SELECTCOLUMNS(TOPN(11, SUMMARIZECOLUMNS('Customer'[Segment], 'Date'[Month], "
        "TREATAS({\"O'Brien \"\"Co\"\"\", \"Consumer\"}, 'Customer'[Segment]), "
        "KEEPFILTERS(FILTER(ALL('Date'[Year]), 'Date'[Year] >= 2019)), "
        "KEEPFILTERS(FILTER(ALL('Date'[Month]), 'Date'[Month] >= DATE(2019, 1, 1) && "
        "'Date'[Month] <= DATE(2019, 6, 30) + TIME(12, 0, 0))), "
        "KEEPFILTERS(FILTER(ALL('Customer'[City]), RIGHT('Customer'[City], 5) = \"ville\")), "
        "\"__c2\", [Sales], \"__c3\", [Orders]), [__c2], DESC), "
        "\"__c0\", 'Customer'[Segment], \"__c1\", 'Date'[Month], \"__c2\", [__c2], \"__c3\", [__c3]) "
        "ORDER BY [__c2] DESC"
    )
    assert pbi.requests[-1][3]["serializerSettings"] == {"includeNulls": True}
    assert table.column_names == ["Segment", "Month", "Sales", "Orders"]
    assert table.column("Sales").to_pylist() == [120.5, None]
    assert table.column("Orders").to_pylist() == [3, 1]
    assert str(table.schema.field("Month").type).startswith("timestamp")


@pytest.mark.parametrize(("query", "message"), [
    ({"columns": ["Segment"], "group_by": ["Segment"]}, "compute measures themselves"),
    ({"columns": []}, "at least one dimension or measure"),
    ({"columns": ["City"]}, "Unknown fields"),
    ({"columns": ["Segment", "Month"]}, "need at least one measure"),
    ({"columns": ["Segment", "Sales"], "filters": [{"column": "Sales", "op": "GT", "value": 1}]}, "native dax"),
    ({"columns": ["Segment", "Sales"], "filters": [{"column": "Year", "op": "EQ", "value": "2019; DROP"}]}, "must be a number"),
    ({"columns": ["Segment", "Sales"], "filters": [{"column": "Segment", "op": "REGEX", "value": "x"}]}, "Unsupported filter"),
    ({"columns": ["Segment", "Sales"], "order_by": [{"column": "Orders"}]}, "must be one of the selected"),
])
def test_invalid_structured_queries_fail_before_execution(pbi, query, message):
    pbi.list_tables()
    count = len(pbi.requests)
    with pytest.raises(ValueError, match=message):
        pbi.query_data_as_arrow(_DS, query, 10)
    assert len(pbi.requests) == count


def test_same_table_dimensions_and_measure_only_queries_are_allowed(pbi):
    pbi.list_tables()
    pbi.query_rows += [_Response({"results": [{"tables": [{"rows": []}]}]}) for _ in range(2)]
    pbi.query_data_as_arrow(_DS, {"columns": ["Segment", "Customer[City]"]}, 10)
    assert "SUMMARIZECOLUMNS('Customer'[Segment], 'Customer'[City])" in _last_dax(pbi)
    pbi.query_data_as_arrow(_DS, {"columns": ["Sales"], "filters": [
        {"column": "Segment", "op": "NOT_IN", "value": ["A"]}, {"column": "Is Active", "op": "EQ", "value": True},
        {"column": "Reseller[City]", "op": "IS_NULL"}]}, 10)
    dax = _last_dax(pbi)
    assert "NOT ('Customer'[Segment] IN {\"A\"})" in dax
    assert "TREATAS({TRUE()}, 'Customer'[Is Active])" in dax
    assert "ISBLANK('Reseller'[City])" in dax


def test_native_dax_is_validated_and_mapped(pbi):
    pbi.list_tables()
    pbi.query_rows.append(_Response({"results": [{"tables": [{"rows": [
        {"Customer[Segment]": "A", "Date[Month]": "2019-01-01T00:00:00", "[Sales]": 10},
        {"Customer[Segment]": "B", "Date[Month]": None, "[Sales]": 2.5},
        {"Customer[Segment]": "C", "Date[Month]": None, "[Sales]": 1},
    ]}]}]}))
    text = "EVALUATE TOPN(5, SUMMARIZECOLUMNS('Customer'[Segment], \"Sales\", [Sales]), [Sales], DESC)"
    table = pbi.query_data_as_arrow("AdventureWorks Sales", {"native": {"language": "dax", "text": text}}, 2)
    assert _last_dax(pbi) == text
    assert table.column_names == ["Segment", "Month", "Sales"] and table.num_rows == 2
    assert table.column("Sales").to_pylist() == [10.0, 2.5]
    assert pbi.query_capabilities()["native_query_languages"] == ["dax"]


@pytest.mark.parametrize(("text", "message"), [
    ("SELECT 1", "start with DEFINE or EVALUATE"),
    ("EVALUATE ROW(\"a\", 1) EVALUATE ROW(\"b\", 2)", "exactly one EVALUATE"),
    ("EVALUATE ROW(\"a\", 1); EVALUATE ROW(\"b\", 2)", "semicolons"),
    ("EVALUATE ROW(\"a\", 1) // note", "comments"),
    ("EVALUATE INFO.VIEW.MEASURES()", "metadata"),
    ("DEFINE MEASURE 'Sales'[x] = 1", "exactly one EVALUATE"),
])
def test_native_dax_rejections(pbi, text, message):
    with pytest.raises(ValueError, match=message):
        pbi.validate_native_query("dax", text)


def test_native_dax_ignores_keywords_inside_strings_and_names(pbi):
    pbi.validate_native_query("dax", "DEFINE VAR x = \"EVALUATE; // INFO.\" EVALUATE ROW(\"a\", [EVALUATE -- x])")
    with pytest.raises(ValueError, match="dax queries only"):
        pbi.validate_native_query("cube_json", "{}")


def test_service_errors_are_reported(pbi):
    pbi.list_tables()
    pbi.query_rows.append(_Response({"error": {"code": "DatasetExecuteQueriesError", "pbi.error": {"details": [
        {"code": "DetailsMessage", "detail": {"value": "Query (1, 10) The column 'x' was not found."}}]}}}, 400))
    with pytest.raises(ValueError, match="Query \\(1, 10\\) The column .*x.* was not found"):
        pbi.query_data_as_arrow(_DS, {"columns": ["Sales"]}, 10)
    pbi.query_rows.append(_Response({"results": [{"tables": [{"rows": [], "error": {"code": "TooManyRows",
                                                                                   "message": "More than 100000 rows"}}]}]}))
    with pytest.raises(ValueError, match="More than 100000 rows"):
        pbi.query_data_as_arrow(_DS, {"columns": ["Sales"]}, 10)
    pbi.query_rows.append(_Response({}, 404))
    with pytest.raises(ValueError, match="Read and Build"):
        pbi.query_data_as_arrow(_DS, {"columns": ["Sales"]}, 10)


def test_metadata_failure_keeps_model_listed(pbi, monkeypatch):
    def fail(*_args, **_kwargs):
        raise ValueError("Power BI API error 403: denied")

    monkeypatch.setattr(pbi, "_execute", fail)
    metadata = pbi.list_tables()[0]["metadata"]
    assert metadata["source_metadata_status"] == "unavailable" and "denied" in metadata["description"]


def test_preview_samples_measures_over_a_date_column(pbi):
    pbi.list_tables()
    pbi.query_rows.append(_Response({"results": [{"tables": [{"rows": [
        {"[__c0]": "2019-01-01T00:00:00", "[__c1]": 1.0, "[__c2]": 2, "[__c3]": 3.0, "[__c4]": 4.0}]}]}]}))
    preview = pbi.preview_data(_DS)
    names = [column["name"] for column in preview["columns"]]
    assert names[0] == "Month" and set(names[1:3]) == {"Sales", "Orders"}
    assert names[3:] == ["Sales Amount", "Unit Price"]
    assert "SUMMARIZECOLUMNS('Date'[Month], " in _last_dax(pbi) and "SUM('Sales'[Sales Amount])" in _last_dax(pbi)


def test_workspace_id_skips_lookup_and_service_principal_path(monkeypatch):
    captured = {}
    monkeypatch.setattr("azure.identity.ClientSecretCredential",
                        lambda tenant, client, secret: captured.update(tenant=tenant, client=client) or None)
    loader = PowerBIDataLoader({"workspace": _WS, "tenant_id": "t", "client_id": "c", "client_secret": "s"})
    assert loader.auth_path == "service_principal" and captured == {"tenant": "t", "client": "c"}
    assert loader._workspace_path() == f"/groups/{_WS}"
    with pytest.raises(ValueError, match="workspace"):
        PowerBIDataLoader({"workspace": " "})
    assert json.dumps(PowerBIDataLoader.catalog_hierarchy()) == '[{"key": "table", "label": "Semantic model"}]'
