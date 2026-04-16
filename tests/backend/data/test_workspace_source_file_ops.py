"""Unit tests for Workspace.delete_tables_by_source_file (P4: orphan cleanup).

Regression: re-uploading an Excel file with fewer sheets left orphaned
table entries in workspace.yaml.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from data_formulator.datalake.workspace_metadata import TableMetadata
from data_formulator.datalake.workspace import Workspace

pytestmark = [pytest.mark.backend]


def _make_table(name: str, filename: str) -> TableMetadata:
    return TableMetadata(
        name=name,
        source_type="upload",
        filename=filename,
        file_type="excel",
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture()
def workspace(tmp_path) -> Workspace:
    ws = Workspace("test-user", root_dir=tmp_path)
    # Seed two tables from the same source, one from a different source
    ws.add_table_metadata(_make_table("业绩_xlsx_sheet1", "业绩.xlsx"))
    ws.add_table_metadata(_make_table("业绩_xlsx_sheet2", "业绩.xlsx"))
    ws.add_table_metadata(_make_table("产品_csv", "产品.csv"))
    # Create dummy physical files
    (ws.get_file_path("业绩.xlsx")).write_bytes(b"fake-excel")
    (ws.get_file_path("产品.csv")).write_bytes(b"fake-csv")
    return ws


def test_deletes_all_tables_from_matching_source(workspace: Workspace) -> None:
    deleted = workspace.delete_tables_by_source_file("业绩.xlsx")
    assert set(deleted) == {"业绩_xlsx_sheet1", "业绩_xlsx_sheet2"}
    assert "业绩_xlsx_sheet1" not in workspace.list_tables()
    assert "业绩_xlsx_sheet2" not in workspace.list_tables()
    assert not workspace.get_file_path("业绩.xlsx").exists()


def test_does_not_affect_other_source_files(workspace: Workspace) -> None:
    workspace.delete_tables_by_source_file("业绩.xlsx")
    assert "产品_csv" in workspace.list_tables()
    assert workspace.get_file_path("产品.csv").exists()


def test_returns_empty_when_no_match(workspace: Workspace) -> None:
    deleted = workspace.delete_tables_by_source_file("不存在.xlsx")
    assert deleted == []
    assert len(workspace.list_tables()) == 3
