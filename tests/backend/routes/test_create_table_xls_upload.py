"""Integration test for the full .xls upload flow via /api/tables/create-table.

Exercises the real chain: Flask request -> create_table route -> save_uploaded_file
-> workspace parquet storage, using the test_cn.xls fixture.
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace
from data_formulator.routes.tables import tables_bp

pytestmark = [pytest.mark.backend]

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "excel"


@pytest.fixture()
def tmp_workspace(tmp_path):
    ws = Workspace("test-user", root_dir=tmp_path)
    yield ws
    shutil.rmtree(tmp_path, ignore_errors=True)


@pytest.fixture()
def client(tmp_workspace):
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)

    with patch("data_formulator.routes.tables._get_workspace", return_value=tmp_workspace):
        with app.test_client() as c:
            yield c


def test_upload_xls_creates_table_and_returns_columns(client, tmp_workspace):
    """POST a real .xls file -> create-table should succeed and store it."""
    xls_path = FIXTURE_DIR / "test_cn.xls"
    if not xls_path.exists():
        pytest.skip("test_cn.xls fixture not found")

    with open(xls_path, "rb") as f:
        resp = client.post(
            "/api/tables/create-table",
            data={
                "file": (f, "test_cn.xls"),
                "table_name": "测试中文表",
            },
            content_type="multipart/form-data",
        )

    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["status"] == "success"
    assert data["row_count"] > 0
    assert len(data["columns"]) > 0
    assert data["table_name"]

    df = tmp_workspace.read_data_as_df(data["table_name"])
    assert len(df) == data["row_count"]


def test_upload_xls_preserves_chinese_column_names(client, tmp_workspace):
    """Chinese column headers in .xls should survive the full round-trip."""
    xls_path = FIXTURE_DIR / "test_cn.xls"
    if not xls_path.exists():
        pytest.skip("test_cn.xls fixture not found")

    with open(xls_path, "rb") as f:
        resp = client.post(
            "/api/tables/create-table",
            data={
                "file": (f, "test_cn.xls"),
                "table_name": "列名保留测试",
            },
            content_type="multipart/form-data",
        )

    data = resp.get_json()
    assert data["status"] == "success"

    original_df = pd.read_excel(xls_path)
    original_columns = set(original_df.columns)
    returned_columns = set(data["columns"])
    assert original_columns == returned_columns, (
        f"Column mismatch: expected {original_columns}, got {returned_columns}"
    )


def test_upload_xls_table_name_sanitized_for_unicode(client, tmp_workspace):
    """A pure-Chinese table_name should not become empty after sanitization."""
    xls_path = FIXTURE_DIR / "test_cn.xls"
    if not xls_path.exists():
        pytest.skip("test_cn.xls fixture not found")

    with open(xls_path, "rb") as f:
        resp = client.post(
            "/api/tables/create-table",
            data={
                "file": (f, "test_cn.xls"),
                "table_name": "订单明细",
            },
            content_type="multipart/form-data",
        )

    data = resp.get_json()
    assert data["status"] == "success"
    assert len(data["table_name"]) > 0
    assert "订单" in data["table_name"] or "table" not in data["table_name"]


def test_upload_xls_rejects_missing_table_name(client):
    """Omitting table_name should return 400."""
    xls_path = FIXTURE_DIR / "test_cn.xls"
    if not xls_path.exists():
        pytest.skip("test_cn.xls fixture not found")

    with open(xls_path, "rb") as f:
        resp = client.post(
            "/api/tables/create-table",
            data={"file": (f, "test_cn.xls")},
            content_type="multipart/form-data",
        )

    assert resp.status_code == 400
    assert resp.get_json()["status"] == "error"


def test_list_tables_returns_sample_rows_for_xls(client, tmp_workspace):
    """After uploading .xls, list-tables must return non-empty sample_rows and correct row_count."""
    xls_path = FIXTURE_DIR / "test_cn.xls"
    if not xls_path.exists():
        pytest.skip("test_cn.xls fixture not found")

    with open(xls_path, "rb") as f:
        create_resp = client.post(
            "/api/tables/create-table",
            data={
                "file": (f, "test_cn.xls"),
                "table_name": "list_tables_test",
            },
            content_type="multipart/form-data",
        )
    create_data = create_resp.get_json()
    assert create_data["status"] == "success"

    list_resp = client.get("/api/tables/list-tables")
    assert list_resp.status_code == 200
    list_data = list_resp.get_json()
    assert list_data["status"] == "success"

    table_entry = next(
        (t for t in list_data["tables"] if t["name"] == create_data["table_name"]),
        None,
    )
    assert table_entry is not None, f"Table {create_data['table_name']} not found in list-tables"
    assert table_entry["row_count"] > 0, "row_count should be > 0 for uploaded .xls"
    assert len(table_entry["sample_rows"]) > 0, "sample_rows should not be empty for uploaded .xls"
    assert len(table_entry["columns"]) > 0, "columns should not be empty for uploaded .xls"
