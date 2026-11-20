import json


def test_external_reference_agent_sample_bounds_values_without_mutation():
    from data_formulator.analyst.workspace_inputs import normalize_external_references

    reference = {"kind": "external-table-reference", "id": "ref", "connectorId": "source",
                 "tableKey": "reviews", "displayName": "Reviews",
                 "summary": {"sampleRows": [{"review": "x" * 1000, "nested": {"items": list(range(30))}}],
                             "inspection": {"schema_source": "inferred", "columns_omitted": 2}}}
    summary = normalize_external_references([reference])[0]["summary"]
    assert summary["sampleRows"][0]["review"] == "x" * 200 + "..."
    assert summary["sampleRows"][0]["nested"]["items"] == list(range(10))
    assert summary["sampleTruncated"] is True
    assert summary["inspection"]["columns_omitted"] == 2
    assert len(reference["summary"]["sampleRows"][0]["review"]) == 1000


def test_semantic_reference_keeps_bounded_model_shape_for_agents():
    from data_formulator.analyst.workspace_inputs import normalize_external_references

    columns = [{"name": "Sales", "type": "number", "role": "measure", "aggregation": "sum", "entity": "Sales",
                "ref": "SUM('Sales'[Amount])", "format": "$#,0.00", "description": "d" * 400}]
    columns.append({"name": "Date", "role": "time_dimension", "ref": "orders.date", "granularities": ["day", "month"]})
    columns += [{"name": f"Dim {index}", "type": "string", "role": "dimension", "entity": "Product"} for index in range(200)]
    reference = {"kind": "external-table-reference", "id": "ref", "connectorId": "powerbi", "tableKey": "model",
                 "displayName": "Model", "queryModel": "semantic",
                 "summary": {"columns": columns, "relationships": [{"from": "Sales[Key]", "to": "Product[Key]"}] * 30}}
    item = normalize_external_references([reference])[0]
    assert item["queryModel"] == "semantic"
    summary = item["summary"]
    assert summary["columns"][0] == {"name": "Sales", "type": "number", "role": "measure", "aggregation": "sum",
                                     "entity": "Sales", "ref": "SUM('Sales'[Amount])", "format": "$#,0.00",
                                     "description": "d" * 160}
    assert summary["columns"][1] == columns[1]
    assert len(summary["columns"]) == 150 and summary["columnsOmitted"] == 52
    assert len(summary["relationships"]) == 20
    assert summary["relationshipsOmitted"] == 10
    assert len(reference["summary"]["columns"]) == 202
    assert len(reference["summary"]["relationships"]) == 30
    assert normalize_external_references(json.loads(json.dumps([item])))[0] == item
