"""Integration tests: uploading a non-UTF-8 CSV should not produce garbled data.

These tests exercise the real user flow — upload a CSV file (possibly GBK),
have it saved to the workspace, and verify the data read back through
pd.read_csv / the API contains the correct Chinese characters.
"""
from __future__ import annotations

import io
import shutil
from unittest.mock import patch

import pandas as pd
import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace
from data_formulator.routes.tables import tables_bp

pytestmark = [pytest.mark.backend]

CHINESE_CSV_TEXT = "姓名,年龄,部门\n张三,25,技术部\n李四,30,市场部\n王五,28,财务部\n"


@pytest.fixture()
def tmp_workspace(tmp_path):
    ws = Workspace("test-user", root_dir=tmp_path)
    yield ws
    shutil.rmtree(tmp_path, ignore_errors=True)


@pytest.fixture()
def client(tmp_workspace):
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)
    register_error_handlers(app)
    with patch("data_formulator.routes.tables._get_workspace", return_value=tmp_workspace):
        with app.test_client() as c:
            yield c


def _upload(client, file_bytes: bytes, filename: str, table_name: str):
    return client.post(
        "/api/tables/create-table",
        data={
            "file": (io.BytesIO(file_bytes), filename),
            "table_name": table_name,
        },
        content_type="multipart/form-data",
    )


# ── Round-trip: save_uploaded_file → read_data_as_df ─────────────────

class TestWorkspaceRoundTrip:
    """Upload a GBK CSV to workspace, then read it back as a DataFrame."""

    def test_gbk_csv_columns_are_chinese(self, tmp_workspace) -> None:
        from data_formulator.datalake.file_manager import save_uploaded_file

        gbk_bytes = CHINESE_CSV_TEXT.encode("gbk")
        save_uploaded_file(tmp_workspace, gbk_bytes, "销售数据.csv")

        df = tmp_workspace.read_data_as_df("销售数据")
        assert list(df.columns) == ["姓名", "年龄", "部门"]

    def test_gbk_csv_cell_values_are_correct(self, tmp_workspace) -> None:
        from data_formulator.datalake.file_manager import save_uploaded_file

        gbk_bytes = CHINESE_CSV_TEXT.encode("gbk")
        save_uploaded_file(tmp_workspace, gbk_bytes, "销售数据.csv")

        df = tmp_workspace.read_data_as_df("销售数据")
        assert df.iloc[0]["姓名"] == "张三"
        assert df.iloc[1]["部门"] == "市场部"
        assert df.iloc[2]["年龄"] == 28

    def test_utf8_csv_still_works(self, tmp_workspace) -> None:
        from data_formulator.datalake.file_manager import save_uploaded_file

        utf8_bytes = CHINESE_CSV_TEXT.encode("utf-8")
        save_uploaded_file(tmp_workspace, utf8_bytes, "utf8数据.csv")

        df = tmp_workspace.read_data_as_df("utf8数据")
        assert list(df.columns) == ["姓名", "年龄", "部门"]
        assert df.iloc[0]["姓名"] == "张三"

    def test_utf8_bom_csv_columns_correct(self, tmp_workspace) -> None:
        from data_formulator.datalake.file_manager import save_uploaded_file

        bom_bytes = b"\xef\xbb\xbf" + CHINESE_CSV_TEXT.encode("utf-8")
        save_uploaded_file(tmp_workspace, bom_bytes, "bom数据.csv")

        df = tmp_workspace.read_data_as_df("bom数据")
        assert df.columns[0] == "姓名", (
            f"BOM should be stripped; first column is {df.columns[0]!r}"
        )


# ── API: parse-file endpoint with GBK CSV ────────────────────────────

class TestParseFileEndpoint:
    """POST a GBK-encoded CSV to /api/tables/parse-file and check the response."""

    def test_gbk_csv_parse_returns_chinese_columns(self, client) -> None:
        gbk_bytes = CHINESE_CSV_TEXT.encode("gbk")
        resp = client.post(
            "/api/tables/parse-file",
            data={"file": (io.BytesIO(gbk_bytes), "report.csv")},
            content_type="multipart/form-data",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        sheet = body["data"]["sheets"][0]
        assert sheet["columns"] == ["姓名", "年龄", "部门"]

    def test_gbk_csv_parse_returns_correct_rows(self, client) -> None:
        gbk_bytes = CHINESE_CSV_TEXT.encode("gbk")
        resp = client.post(
            "/api/tables/parse-file",
            data={"file": (io.BytesIO(gbk_bytes), "report.csv")},
            content_type="multipart/form-data",
        )
        rows = resp.get_json()["data"]["sheets"][0]["data"]
        assert rows[0]["姓名"] == "张三"
        assert rows[1]["部门"] == "市场部"
        assert rows[2]["年龄"] == 28


# ── API: create-table + get-table full round-trip ────────────────────

class TestCreateAndGetTable:
    """Upload a GBK CSV via create-table, then fetch via get-table."""

    def test_gbk_upload_then_get_returns_chinese(self, client, tmp_workspace) -> None:
        gbk_bytes = CHINESE_CSV_TEXT.encode("gbk")
        resp = _upload(client, gbk_bytes, "员工.csv", "员工")
        assert resp.get_json()["status"] == "success"

        get_resp = client.get("/api/tables/get-table?table_name=员工")
        assert get_resp.status_code == 200
        body = get_resp.get_json()
        assert body["status"] == "success"

        columns = body["data"]["columns"]
        assert "姓名" in columns
        assert "部门" in columns

        rows = body["data"]["rows"]
        assert any(row.get("姓名") == "张三" for row in rows)
