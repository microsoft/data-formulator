"""Integration tests for file upload → parquet conversion.

Verifies that uploaded files (xlsx, csv) are always converted to parquet
by the ``create_table`` route, and that multi-sheet Excel files resolve
to the correct sheet via suffix matching or frontend ``sheet_name`` hint.

Uses **real fixture files** in ``tests/backend/fixtures/excel/``.
"""
from __future__ import annotations

import io
import shutil
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
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)
    register_error_handlers(app)
    with patch("data_formulator.routes.tables._get_workspace", return_value=tmp_workspace):
        with app.test_client() as c:
            yield c


def _upload(client, file_bytes: bytes, filename: str, table_name: str,
            sheet_name: str | None = None, replace_source: bool = False):
    data: dict = {
        "file": (io.BytesIO(file_bytes), filename),
        "table_name": table_name,
    }
    if sheet_name:
        data["sheet_name"] = sheet_name
    if replace_source:
        data["replace_source"] = "true"
    return client.post(
        "/api/tables/create-table",
        data=data,
        content_type="multipart/form-data",
    )


# ═══════════════════════════════════════════════════════════════════════
# 1. Parquet conversion: uploaded files MUST be stored as .parquet
# ═══════════════════════════════════════════════════════════════════════

class TestParquetConversion:
    """Regardless of source format, the workspace must store .parquet files."""

    def test_csv_upload_stored_as_parquet(self, client, tmp_workspace) -> None:
        csv_path = FIXTURE_DIR / "员工花名册_utf8.csv"
        if not csv_path.exists():
            pytest.skip("fixture missing")
        with open(csv_path, "rb") as f:
            resp = _upload(client, f.read(), "员工花名册.csv", "员工花名册")
        assert resp.get_json()["status"] == "success"
        meta = tmp_workspace.get_table_metadata("员工花名册")
        assert meta is not None
        assert meta.file_type == "parquet"
        assert meta.filename.endswith(".parquet")
        assert meta.source_file == "员工花名册.csv"

    def test_xlsx_upload_stored_as_parquet(self, client, tmp_workspace) -> None:
        xlsx_path = FIXTURE_DIR / "sales_report.xlsx"
        if not xlsx_path.exists():
            pytest.skip("fixture missing")
        with open(xlsx_path, "rb") as f:
            resp = _upload(client, f.read(), "sales_report.xlsx", "sales_xlsx_orders")
        assert resp.get_json()["status"] == "success"
        meta = tmp_workspace.get_table_metadata("sales_xlsx_orders")
        assert meta is not None
        assert meta.file_type == "parquet"
        assert meta.filename == "sales_xlsx_orders.parquet"
        assert meta.source_type == "upload"
        assert meta.source_file == "sales_report.xlsx"

    def test_gbk_csv_converted_correctly(self, client, tmp_workspace) -> None:
        gbk_path = FIXTURE_DIR / "员工花名册_gbk.csv"
        if not gbk_path.exists():
            pytest.skip("fixture missing")
        with open(gbk_path, "rb") as f:
            resp = _upload(client, f.read(), "员工花名册.csv", "员工数据")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("员工数据")
        assert "姓名" in df.columns
        assert df.iloc[0]["姓名"] == "张三"


# ═══════════════════════════════════════════════════════════════════════
# 2. Multi-sheet Excel: English sheet names
# ═══════════════════════════════════════════════════════════════════════

class TestMultiSheetEnglish:
    """sales_report.xlsx has sheets: Orders, Returns."""

    @pytest.fixture(autouse=True)
    def _load_fixture(self):
        self.xlsx_path = FIXTURE_DIR / "sales_report.xlsx"
        if not self.xlsx_path.exists():
            pytest.skip("fixture missing")
        self.xlsx_bytes = self.xlsx_path.read_bytes()

    def test_upload_orders_sheet_via_suffix(self, client, tmp_workspace) -> None:
        """table_name ends with '_orders' → should match 'Orders' sheet."""
        resp = _upload(client, self.xlsx_bytes, "sales_report.xlsx",
                       "sales_report_xlsx_orders")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("sales_report_xlsx_orders")
        assert "OrderID" in df.columns
        assert len(df) == 5

    def test_upload_returns_sheet_via_suffix(self, client, tmp_workspace) -> None:
        """table_name ends with '_returns' → should match 'Returns' sheet."""
        resp = _upload(client, self.xlsx_bytes, "sales_report.xlsx",
                       "sales_report_xlsx_returns")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("sales_report_xlsx_returns")
        assert "ReturnID" in df.columns
        assert "RefundAmount" in df.columns
        assert len(df) == 2

    def test_upload_both_sheets_coexist(self, client, tmp_workspace) -> None:
        """Upload both sheets — each becomes its own parquet table."""
        _upload(client, self.xlsx_bytes, "sales_report.xlsx",
                "sales_report_xlsx_orders")
        _upload(client, self.xlsx_bytes, "sales_report.xlsx",
                "sales_report_xlsx_returns")
        tables = tmp_workspace.list_tables()
        assert "sales_report_xlsx_orders" in tables
        assert "sales_report_xlsx_returns" in tables
        assert len(tmp_workspace.read_data_as_df("sales_report_xlsx_orders")) == 5
        assert len(tmp_workspace.read_data_as_df("sales_report_xlsx_returns")) == 2

    def test_sheet_hint_overrides_inference(self, client, tmp_workspace) -> None:
        """Frontend sends sheet_name='Returns' — backend should use it."""
        resp = _upload(client, self.xlsx_bytes, "sales_report.xlsx",
                       "my_custom_name", sheet_name="Returns")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("my_custom_name")
        assert "ReturnID" in df.columns

    def test_invalid_sheet_hint_falls_back(self, client, tmp_workspace) -> None:
        """Bad sheet_name hint → backend should fall back gracefully."""
        resp = _upload(client, self.xlsx_bytes, "sales_report.xlsx",
                       "sales_report_xlsx_orders", sheet_name="NoSuchSheet")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("sales_report_xlsx_orders")
        assert "OrderID" in df.columns


# ═══════════════════════════════════════════════════════════════════════
# 3. Multi-sheet Excel: Chinese sheet names
# ═══════════════════════════════════════════════════════════════════════

class TestMultiSheetChinese:
    """产品利润分析.xlsx has sheets: 销售数据, 利润汇总."""

    @pytest.fixture(autouse=True)
    def _load_fixture(self):
        self.xlsx_path = FIXTURE_DIR / "产品利润分析.xlsx"
        if not self.xlsx_path.exists():
            pytest.skip("fixture missing")
        self.xlsx_bytes = self.xlsx_path.read_bytes()

    def test_upload_sales_sheet(self, client, tmp_workspace) -> None:
        resp = _upload(client, self.xlsx_bytes, "产品利润分析.xlsx",
                       "产品利润分析_xlsx_销售数据")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("产品利润分析_xlsx_销售数据")
        assert "产品名称" in df.columns
        assert "销售数量" in df.columns
        assert len(df) == 5

    def test_upload_profit_sheet(self, client, tmp_workspace) -> None:
        resp = _upload(client, self.xlsx_bytes, "产品利润分析.xlsx",
                       "产品利润分析_xlsx_利润汇总")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("产品利润分析_xlsx_利润汇总")
        assert "毛利率" in df.columns
        assert "净利润" in df.columns

    def test_chinese_sheet_hint(self, client, tmp_workspace) -> None:
        """Frontend hint '利润汇总' should be validated and used."""
        resp = _upload(client, self.xlsx_bytes, "产品利润分析.xlsx",
                       "custom_profit", sheet_name="利润汇总")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("custom_profit")
        assert "净利润" in df.columns


# ═══════════════════════════════════════════════════════════════════════
# 4. Multi-sheet Excel: mixed Chinese-English (3 sheets)
# ═══════════════════════════════════════════════════════════════════════

class TestMultiSheetMixed:
    """mixed_report_混合报表.xlsx has sheets: Summary, 明细数据, Q1."""

    @pytest.fixture(autouse=True)
    def _load_fixture(self):
        self.xlsx_path = FIXTURE_DIR / "mixed_report_混合报表.xlsx"
        if not self.xlsx_path.exists():
            pytest.skip("fixture missing")
        self.xlsx_bytes = self.xlsx_path.read_bytes()

    def test_upload_summary_sheet(self, client, tmp_workspace) -> None:
        resp = _upload(client, self.xlsx_bytes, "mixed_report_混合报表.xlsx",
                       "mixed_report_混合报表_xlsx_summary")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("mixed_report_混合报表_xlsx_summary")
        assert "Category" in df.columns
        assert "类别中文" in df.columns

    def test_upload_detail_sheet_chinese(self, client, tmp_workspace) -> None:
        resp = _upload(client, self.xlsx_bytes, "mixed_report_混合报表.xlsx",
                       "mixed_report_混合报表_xlsx_明细数据")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("mixed_report_混合报表_xlsx_明细数据")
        assert "商品名" in df.columns
        assert "SKU" in df.columns
        assert len(df) == 4

    def test_upload_q1_sheet(self, client, tmp_workspace) -> None:
        resp = _upload(client, self.xlsx_bytes, "mixed_report_混合报表.xlsx",
                       "mixed_report_混合报表_xlsx_q1")
        assert resp.get_json()["status"] == "success"
        df = tmp_workspace.read_data_as_df("mixed_report_混合报表_xlsx_q1")
        assert "Month" in df.columns
        assert "月份" in df.columns
        assert len(df) == 3

    def test_load_all_three_sheets(self, client, tmp_workspace) -> None:
        """Simulate 'Load All': upload all 3 sheets from same file."""
        names = [
            "mixed_report_混合报表_xlsx_summary",
            "mixed_report_混合报表_xlsx_明细数据",
            "mixed_report_混合报表_xlsx_q1",
        ]
        for name in names:
            resp = _upload(client, self.xlsx_bytes, "mixed_report_混合报表.xlsx", name)
            assert resp.get_json()["status"] == "success", f"Failed for {name}"

        tables = tmp_workspace.list_tables()
        for name in names:
            assert name in tables, f"{name} missing from workspace"

        assert len(tmp_workspace.read_data_as_df(names[0])) == 3   # Summary
        assert len(tmp_workspace.read_data_as_df(names[1])) == 4   # 明细数据
        assert len(tmp_workspace.read_data_as_df(names[2])) == 3   # Q1


# ═══════════════════════════════════════════════════════════════════════
# 5. replace_source with parquet-converted tables
# ═══════════════════════════════════════════════════════════════════════

class TestReplaceSourceWithParquet:
    """replace_source must still work after the parquet conversion change."""

    def test_replace_source_removes_parquet_tables(self, client, tmp_workspace) -> None:
        xlsx_path = FIXTURE_DIR / "sales_report.xlsx"
        if not xlsx_path.exists():
            pytest.skip("fixture missing")
        xlsx_bytes = xlsx_path.read_bytes()

        _upload(client, xlsx_bytes, "sales_report.xlsx", "sales_report_xlsx_orders")
        _upload(client, xlsx_bytes, "sales_report.xlsx", "sales_report_xlsx_returns")
        assert len(tmp_workspace.list_tables()) == 2

        _upload(client, xlsx_bytes, "sales_report.xlsx",
                "sales_report_xlsx_orders", replace_source=True)
        tables = tmp_workspace.list_tables()
        assert "sales_report_xlsx_orders" in tables
        assert "sales_report_xlsx_returns" not in tables
        assert len(tables) == 1


# ═══════════════════════════════════════════════════════════════════════
# 6. Metadata integrity after upload
# ═══════════════════════════════════════════════════════════════════════

class TestMetadataIntegrity:
    """Verify workspace.yaml metadata is correct after parquet conversion."""

    def test_source_file_and_original_name_recorded(self, client, tmp_workspace) -> None:
        xlsx_path = FIXTURE_DIR / "产品利润分析.xlsx"
        if not xlsx_path.exists():
            pytest.skip("fixture missing")
        with open(xlsx_path, "rb") as f:
            resp = _upload(client, f.read(), "产品利润分析.xlsx",
                           "产品利润分析.xlsx-销售数据")
        body = resp.get_json()
        assert body["status"] == "success"
        table_name = body["data"]["table_name"]

        meta = tmp_workspace.get_table_metadata(table_name)
        assert meta is not None
        assert meta.source_type == "upload"
        assert meta.source_file == "产品利润分析.xlsx"
        assert meta.original_name == "产品利润分析.xlsx-销售数据"
        assert meta.file_type == "parquet"
        assert meta.filename.endswith(".parquet")
        assert meta.row_count == 5
