"""DuckDB queries over workspace parquet files may read only that file."""
from __future__ import annotations

import json
from unittest.mock import patch

import duckdb
import pandas as pd
import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace, run_sql_over_parquet_file
from data_formulator.routes.tables import tables_bp

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def workspace(tmp_path):
    ws = Workspace("test-user", root_dir=tmp_path / "root")
    ws.write_parquet(pd.DataFrame({"a{x}": [1, 2, 3], "name": ["p", "{q}", "r"]}), "t")
    return ws


@pytest.fixture()
def secret_file(tmp_path):
    path = tmp_path / "secret.csv"
    path.write_text("k\nSECRET\n")
    return path


def test_reads_the_table_including_braces_in_names_and_literals(workspace):
    df = workspace.run_parquet_sql(
        "t", "SELECT \"a{x}\", name FROM {parquet} AS t WHERE name = '{q}'")
    assert df.to_dict("records") == [{"a{x}": 2, "name": "{q}"}]


@pytest.mark.parametrize("statement", [
    "SELECT * FROM read_csv('{secret}')",
    "SELECT * FROM glob('{secret_dir}/*')",
    "COPY (SELECT 1) TO '{secret_dir}/out.csv'",
    "ATTACH '{secret_dir}/x.db'",
    "INSTALL httpfs",
    "LOAD httpfs",
    "SET enable_external_access = true",
])
def test_other_files_extensions_and_settings_are_denied(workspace, secret_file, statement):
    sql = statement.format(secret=secret_file, secret_dir=secret_file.parent)
    with pytest.raises(duckdb.Error):
        workspace.run_parquet_sql("t", f"SELECT COUNT(*) FROM {{parquet}}; {sql}")
    with pytest.raises(duckdb.Error):
        run_sql_over_parquet_file(workspace.get_parquet_path("t"), f"{sql} -- {{parquet}}")
    assert not (secret_file.parent / "out.csv").exists()


def test_sample_table_rejects_sql_in_size_and_offset(workspace, secret_file):
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)
    register_error_handlers(app)
    injection = f"1; SELECT * FROM read_csv('{secret_file}')"
    with patch("data_formulator.routes.tables._get_workspace", return_value=workspace), app.test_client() as client:
        for field in ("size", "offset"):
            response = client.post("/api/tables/sample-table", data=json.dumps({"table": "t", field: injection}),
                                   content_type="application/json")
            body = response.get_json()
            assert body["status"] == "error" and body["error"]["code"] == "INVALID_REQUEST"
            assert "SECRET" not in response.get_data(as_text=True)
