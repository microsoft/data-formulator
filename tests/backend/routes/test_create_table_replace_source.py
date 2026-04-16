"""Integration tests for create-table with replace_source (P3+P4).

P3: re-uploading the same file should overwrite, not append _1 / _2.
P4: "Load All" with replace_source=true should remove orphaned sheets.
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
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)
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


def _make_csv(rows: list[dict]) -> bytes:
    return pd.DataFrame(rows).to_csv(index=False).encode()


# ── P3: overwrite semantics ──────────────────────────────────────────

def test_overwrite_same_table_name(client, tmp_workspace) -> None:
    """Uploading the same table_name twice should overwrite, not create _1."""
    csv_v1 = _make_csv([{"a": 1}])
    csv_v2 = _make_csv([{"a": 1}, {"a": 2}])

    resp1 = _upload(client, csv_v1, "data.csv", "my_table")
    assert resp1.get_json()["status"] == "success"

    resp2 = _upload(client, csv_v2, "data.csv", "my_table")
    assert resp2.get_json()["status"] == "success"
    assert resp2.get_json()["table_name"] == "my_table"

    tables = tmp_workspace.list_tables()
    assert "my_table" in tables
    assert "my_table_1" not in tables


# ── P3: replace_source cleans old tables ─────────────────────────────

def test_replace_source_removes_old_tables(client, tmp_workspace) -> None:
    """replace_source=true should remove all tables from the same source file."""
    csv = _make_csv([{"x": 1}])

    _upload(client, csv, "report.csv", "report_sheet1")
    _upload(client, csv, "report.csv", "report_sheet2")
    assert "report_sheet1" in tmp_workspace.list_tables()
    assert "report_sheet2" in tmp_workspace.list_tables()

    _upload(client, csv, "report.csv", "report_new", replace_source=True)
    tables = tmp_workspace.list_tables()
    assert "report_new" in tables
    assert "report_sheet1" not in tables
    assert "report_sheet2" not in tables


# ── P4: sheet count changes ──────────────────────────────────────────

def test_fewer_sheets_after_replace_no_orphans(client, tmp_workspace) -> None:
    """First upload 2 sheets, then replace_source with 1 → old sheet2 gone."""
    csv = _make_csv([{"v": 42}])

    _upload(client, csv, "业绩.xlsx", "业绩_xlsx_sheet1")
    _upload(client, csv, "业绩.xlsx", "业绩_xlsx_sheet2")
    assert len(tmp_workspace.list_tables()) == 2

    _upload(client, csv, "业绩.xlsx", "业绩_xlsx_sheet1", replace_source=True)
    tables = tmp_workspace.list_tables()
    assert "业绩_xlsx_sheet1" in tables
    assert "业绩_xlsx_sheet2" not in tables
    assert len(tables) == 1
