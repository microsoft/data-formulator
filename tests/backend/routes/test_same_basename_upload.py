"""Contract / integration tests for uploading files with the same base name
but different extensions (e.g. data.csv + data.xlsx).

Covers two known issues:

1. **Orphan-cleanup ID mismatch** (frontend contract):
   The frontend preview creates table IDs from the raw filename (e.g. "数据.csv"),
   but after upload the workspace returns a sanitized name (e.g. "数据_csv").
   The orphan-cleanup in handleFileLoadAllTables compares these two sets,
   and a mismatch causes it to wrongly delete the first table on re-upload.

2. **Backend coexistence**:
   Two files with the same basename but different extensions must produce
   distinct workspace tables and not overwrite each other.
"""
from __future__ import annotations

import io
import shutil
from unittest.mock import patch

import pandas as pd
import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace
from data_formulator.datalake.parquet_utils import (
    sanitize_table_name as parquet_sanitize_table_name,
)
from data_formulator.routes.tables import tables_bp

pytestmark = [pytest.mark.backend, pytest.mark.contract]


# ── helpers ──────────────────────────────────────────────────────────

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
            replace_source: bool = False):
    data = {
        "file": (io.BytesIO(file_bytes), filename),
        "table_name": table_name,
    }
    if replace_source:
        data["replace_source"] = "true"
    return client.post(
        "/api/tables/create-table",
        data=data,
        content_type="multipart/form-data",
    )


CSV_CONTENT = "姓名,年龄\n张三,25\n李四,30\n"


def _make_excel_bytes(rows: list[dict]) -> bytes:
    buf = io.BytesIO()
    pd.DataFrame(rows).to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


EXCEL_CONTENT = _make_excel_bytes([{"姓名": "王五", "年龄": 28}])


# ═══════════════════════════════════════════════════════════════════════
# 1. Contract: preview ID ≠ workspace ID — the root cause of orphan bug
# ═══════════════════════════════════════════════════════════════════════

class TestPreviewIdVsWorkspaceIdMismatch:
    """Demonstrate that the frontend preview ID (raw filename) does NOT match
    the sanitized workspace table name returned by the backend.

    This mismatch is harmless on first upload but causes the orphan-cleanup
    to wrongly remove tables on re-upload.
    """

    @pytest.mark.parametrize("preview_id, expected_ws_name", [
        ("数据.csv",            "数据_csv"),
        ("数据.xlsx",           "数据_xlsx"),
        ("数据.xlsx-Sheet1",    "数据_xlsx_sheet1"),
        ("sales report.csv",   "sales_report_csv"),
    ])
    def test_preview_id_differs_from_workspace_name(
        self, preview_id: str, expected_ws_name: str,
    ) -> None:
        """The frontend sends preview_id as table_name.
        parquet_sanitize_table_name converts it to a different string.
        Any comparison between the two will fail."""
        ws_name = parquet_sanitize_table_name(preview_id)
        assert ws_name == expected_ws_name
        assert ws_name != preview_id, (
            "If these are equal the orphan bug wouldn't trigger, "
            "but currently they always differ."
        )

    def test_orphan_cleanup_would_wrongly_remove_on_reupload(
        self, client, tmp_workspace,
    ) -> None:
        """Simulate the re-upload scenario that triggers the orphan bug.

        1. First upload: 数据.csv → workspace table name "数据_csv"
        2. Re-upload: frontend orphan-cleanup checks
              newTableIds = {"数据.csv"}   (preview IDs)
              existing table id = "数据_csv"  (workspace name)
              "数据_csv" NOT in {"数据.csv"} → WRONGLY marked as orphan
        """
        csv_bytes = CSV_CONTENT.encode("utf-8")

        # -- first upload --
        resp = _upload(client, csv_bytes, "数据.csv", "数据.csv")
        ws_name = resp.get_json()["data"]["table_name"]
        assert ws_name == "数据_csv"

        # -- simulate the frontend orphan-cleanup check --
        # On re-upload, the preview still uses raw filename as ID
        new_preview_ids = {"数据.csv"}
        existing_ws_id = ws_name  # "数据_csv"

        would_be_removed = existing_ws_id not in new_preview_ids
        assert would_be_removed is True, (
            "BUG: the existing table would be wrongly removed because "
            f"'{existing_ws_id}' is not in preview IDs {new_preview_ids}"
        )


# ═══════════════════════════════════════════════════════════════════════
# 2. Backend: same basename, different extensions → both must coexist
# ═══════════════════════════════════════════════════════════════════════

class TestSameBasenameDifferentExtension:
    """Upload 数据.csv and 数据.xlsx — both must exist as separate tables."""

    def test_both_tables_exist_after_upload(
        self, client, tmp_workspace,
    ) -> None:
        """Upload two CSV files with names that mimic CSV + Excel scenario.
        Both must produce distinct workspace tables."""
        csv_bytes = CSV_CONTENT.encode("utf-8")
        csv2_bytes = "姓名,年龄\n王五,28\n".encode("utf-8")

        resp1 = _upload(client, csv_bytes, "数据.csv", "数据.csv")
        assert resp1.get_json()["status"] == "success"
        name1 = resp1.get_json()["data"]["table_name"]

        # Simulate the Excel sheet upload: different table_name, different file
        resp2 = _upload(client, csv2_bytes, "数据_sheet1.csv", "数据.xlsx-Sheet1")
        assert resp2.get_json()["status"] == "success"
        name2 = resp2.get_json()["data"]["table_name"]

        assert name1 != name2, (
            f"Table names must differ: got {name1} and {name2}"
        )

        tables = tmp_workspace.list_tables()
        assert name1 in tables
        assert name2 in tables

    def test_both_readable_after_upload(
        self, client, tmp_workspace,
    ) -> None:
        csv_bytes = CSV_CONTENT.encode("utf-8")
        csv2_bytes = "姓名,年龄\n王五,28\n".encode("utf-8")

        resp1 = _upload(client, csv_bytes, "数据.csv", "数据.csv")
        name1 = resp1.get_json()["data"]["table_name"]

        resp2 = _upload(client, csv2_bytes, "数据_sheet1.csv", "数据.xlsx-Sheet1")
        name2 = resp2.get_json()["data"]["table_name"]

        df1 = tmp_workspace.read_data_as_df(name1)
        df2 = tmp_workspace.read_data_as_df(name2)
        assert list(df1.columns) == ["姓名", "年龄"]
        assert list(df2.columns) == ["姓名", "年龄"]
        assert df1.iloc[0]["姓名"] == "张三"
        assert df2.iloc[0]["姓名"] == "王五"

    def test_reupload_csv_does_not_destroy_other_table(
        self, client, tmp_workspace,
    ) -> None:
        """Re-uploading one file should not affect another file's table."""
        csv_v1 = CSV_CONTENT.encode("utf-8")
        csv_v2 = "姓名,年龄\n赵六,35\n".encode("utf-8")
        other_csv = "姓名,年龄\n王五,28\n".encode("utf-8")

        _upload(client, csv_v1, "数据.csv", "数据.csv")
        _upload(client, other_csv, "数据_sheet1.csv", "数据.xlsx-Sheet1")

        # Re-upload first CSV with new data
        resp = _upload(client, csv_v2, "数据.csv", "数据.csv")
        assert resp.get_json()["status"] == "success"

        tables = tmp_workspace.list_tables()
        csv_name = resp.get_json()["data"]["table_name"]
        assert csv_name in tables
        assert "数据_xlsx_sheet1" in tables, (
            "Other table must survive the first file's re-upload"
        )

    def test_replace_source_only_affects_same_source_file(
        self, client, tmp_workspace,
    ) -> None:
        """replace_source on one file should only remove tables from that
        file, not tables from a different source file."""
        csv_bytes = CSV_CONTENT.encode("utf-8")
        other_csv = "姓名,年龄\n王五,28\n".encode("utf-8")

        _upload(client, csv_bytes, "数据.csv", "数据.csv")
        _upload(client, other_csv, "数据_sheet1.csv", "数据.xlsx-Sheet1")

        # Re-upload with replace_source=true — should only touch 数据.csv tables
        _upload(client, csv_bytes, "数据.csv", "数据.csv", replace_source=True)

        tables = tmp_workspace.list_tables()
        assert "数据_csv" in tables
        assert "数据_xlsx_sheet1" in tables, (
            "replace_source for 数据.csv must not remove tables from other source files"
        )


# ═══════════════════════════════════════════════════════════════════════
# 3. filePreviewFiles / filePreviewTables array mismatch (contract test)
# ═══════════════════════════════════════════════════════════════════════

class TestFileArrayMismatch:
    """Document the array-index mismatch that happens when an Excel file
    has multiple sheets while being co-uploaded with other files.

    filePreviewFiles:  [csv_file,  xlsx_file]           — length 2
    filePreviewTables: [csv_table, sheet1, sheet2]      — length 3

    The fallback `filePreviewFiles[i] || filePreviewFiles[0]` at i=2
    sends the WRONG file (csv instead of xlsx) for sheet2.
    """

    def test_index_fallback_sends_wrong_file(self) -> None:
        """Pure logic test: demonstrate the fallback picks the wrong file."""
        # Simulated arrays matching the frontend structure
        files = ["数据.csv", "数据.xlsx"]             # 2 files
        tables = ["数据.csv", "数据.xlsx-Sheet1", "数据.xlsx-Sheet2"]  # 3 tables

        for i, table_id in enumerate(tables):
            # This mirrors: filePreviewFiles[i]?.name || filePreviewFiles[0]?.name
            file_name = files[i] if i < len(files) else files[0]

            if i == 2:
                assert file_name == "数据.csv", (
                    "BUG: table '数据.xlsx-Sheet2' gets the CSV file "
                    "because filePreviewFiles[2] is out of bounds and "
                    "falls back to filePreviewFiles[0]"
                )
                assert file_name != "数据.xlsx", (
                    "The correct file should be 数据.xlsx but we got 数据.csv"
                )
