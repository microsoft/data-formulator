# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for ConfinedDir path safety and LocalFolderDataLoader."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pyarrow as pa
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq
import pytest

from data_formulator.security.path_safety import ConfinedDir
from data_formulator.data_loader.local_folder_data_loader import (
    LocalFolderDataLoader,
    SUPPORTED_EXTENSIONS,
)

pytestmark = [pytest.mark.backend]


# ── ConfinedDir tests ────────────────────────────────────────────────────


class TestConfinedDir:

    def test_resolve_valid_relative_path(self, tmp_path: Path) -> None:
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "file.csv").touch()
        jail = ConfinedDir(tmp_path, mkdir=False)
        resolved = jail / "data/file.csv"
        assert resolved == (tmp_path / "data" / "file.csv").resolve()

    def test_reject_absolute_path(self, tmp_path: Path) -> None:
        jail = ConfinedDir(tmp_path, mkdir=False)
        with pytest.raises(ValueError, match="Absolute path"):
            jail / "/etc/passwd"

    def test_reject_dotdot_traversal(self, tmp_path: Path) -> None:
        jail = ConfinedDir(tmp_path, mkdir=False)
        with pytest.raises(ValueError, match="Path traversal"):
            jail / "../etc/passwd"

    def test_reject_dotdot_in_middle(self, tmp_path: Path) -> None:
        jail = ConfinedDir(tmp_path, mkdir=False)
        with pytest.raises(ValueError, match="Path traversal"):
            jail / "data/../../etc/passwd"

    def test_reject_empty_path(self, tmp_path: Path) -> None:
        jail = ConfinedDir(tmp_path, mkdir=False)
        with pytest.raises(ValueError, match="Empty"):
            jail / ""

    def test_symlink_escape_rejected(self, tmp_path: Path) -> None:
        """A symlink pointing outside the jail should be caught by resolve()."""
        outside = tmp_path / "outside"
        outside.mkdir()
        secret = outside / "secret.txt"
        secret.write_text("secret")

        jail_dir = tmp_path / "jail"
        jail_dir.mkdir()
        link = jail_dir / "escape"
        link.symlink_to(outside)

        jail = ConfinedDir(jail_dir, mkdir=False)
        with pytest.raises(ValueError, match="escapes confined"):
            jail / "escape/secret.txt"

    def test_write_creates_parents(self, tmp_path: Path) -> None:
        jail = ConfinedDir(tmp_path, mkdir=False)
        target = jail.write("sub/dir/file.txt", b"hello")
        assert target.read_bytes() == b"hello"
        assert target.parent.is_dir()

    def test_resolve_with_mkdir_parents(self, tmp_path: Path) -> None:
        jail = ConfinedDir(tmp_path, mkdir=False)
        resolved = jail.resolve("new/nested/path.txt", mkdir_parents=True)
        assert resolved.parent.is_dir()

    def test_repr(self, tmp_path: Path) -> None:
        jail = ConfinedDir(tmp_path, mkdir=False)
        assert "ConfinedDir" in repr(jail)
        assert str(tmp_path) in repr(jail)


# ── LocalFolderDataLoader tests ──────────────────────────────────────────


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """Create a sample data directory with various file types."""
    # CSV
    csv_content = "name,age,city\nAlice,30,NYC\nBob,25,LA\n"
    (tmp_path / "people.csv").write_text(csv_content)

    # TSV
    tsv_content = "id\tvalue\n1\tfoo\n2\tbar\n"
    (tmp_path / "data.tsv").write_text(tsv_content)

    # Parquet
    table = pa.table({"x": [1, 2, 3], "y": ["a", "b", "c"]})
    pq.write_table(table, str(tmp_path / "numbers.parquet"))

    # JSON
    (tmp_path / "config.json").write_text(json.dumps([{"key": "val"}]))

    # JSONL
    (tmp_path / "events.jsonl").write_text('{"event":"click","ts":1}\n{"event":"view","ts":2}\n')

    # Subdirectory
    sub = tmp_path / "reports"
    sub.mkdir()
    (sub / "q1.csv").write_text("metric,value\nrev,100\n")
    (sub / "q2.parquet").write_bytes(b"")  # empty, won't parse but exists

    # Hidden file (should be excluded)
    (tmp_path / ".hidden.csv").write_text("a,b\n1,2\n")

    # Unsupported file type
    (tmp_path / "readme.md").write_text("# Hello")

    return tmp_path


class TestLocalFolderDataLoader:

    def test_list_params(self) -> None:
        params = LocalFolderDataLoader.list_params()
        names = {p["name"] for p in params}
        assert "root_dir" in names
        assert "recursive" in names
        assert "file_pattern" in names

    def test_test_connection_valid_dir(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        assert loader.test_connection() is True

    def test_test_connection_nonexistent_dir(self, tmp_path: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(tmp_path / "nope")})
        assert loader.test_connection() is False

    def test_list_tables_recursive(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        tables = loader.list_tables()
        names = {t["name"] for t in tables}

        # Should include top-level and subdirectory files
        assert "people.csv" in names
        assert "data.tsv" in names
        assert "numbers.parquet" in names
        assert "config.json" in names
        assert "events.jsonl" in names
        assert os.path.join("reports", "q1.csv") in names

        # Should exclude hidden files and unsupported types
        assert ".hidden.csv" not in names
        assert "readme.md" not in names

    def test_list_tables_non_recursive(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({
            "root_dir": str(data_dir),
            "recursive": "false",
        })
        loader.test_connection()
        tables = loader.list_tables()
        names = {t["name"] for t in tables}

        assert "people.csv" in names
        # Subdirectory files should not be included
        assert os.path.join("reports", "q1.csv") not in names

    def test_list_tables_with_filter(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        tables = loader.list_tables(table_filter="parquet")
        names = {t["name"] for t in tables}
        assert "numbers.parquet" in names
        assert "people.csv" not in names

    def test_list_tables_with_file_pattern(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({
            "root_dir": str(data_dir),
            "file_pattern": "*.csv",
        })
        loader.test_connection()
        tables = loader.list_tables()
        for t in tables:
            assert t["name"].endswith(".csv")

    def test_list_tables_path_hierarchy(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        tables = loader.list_tables()
        for t in tables:
            assert "path" in t
            assert isinstance(t["path"], list)
            # path should reconstruct the relative name
            assert os.path.join(*t["path"]) == t["name"]

    def test_fetch_csv(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        table = loader.fetch_data_as_arrow("people.csv")
        assert table.num_rows == 2
        assert "name" in table.column_names

    def test_fetch_tsv(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        table = loader.fetch_data_as_arrow("data.tsv")
        assert table.num_rows == 2

    def test_fetch_parquet(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        table = loader.fetch_data_as_arrow("numbers.parquet")
        assert table.num_rows == 3
        assert "x" in table.column_names

    def test_fetch_jsonl(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        table = loader.fetch_data_as_arrow("events.jsonl")
        assert table.num_rows == 2

    def test_fetch_subdirectory_file(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        table = loader.fetch_data_as_arrow("reports/q1.csv")
        assert table.num_rows == 1

    def test_fetch_with_size_limit(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        table = loader.fetch_data_as_arrow("people.csv", {"size": 1})
        assert table.num_rows == 1

    def test_fetch_path_traversal_rejected(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        with pytest.raises(ValueError, match="Path traversal|escapes"):
            loader.fetch_data_as_arrow("../../../etc/passwd")

    def test_fetch_unsupported_type_rejected(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        with pytest.raises(ValueError, match="Unsupported"):
            loader.fetch_data_as_arrow("readme.md")

    def test_metadata_parquet(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        tables = loader.list_tables(table_filter="numbers.parquet")
        assert len(tables) == 1
        meta = tables[0]["metadata"]
        assert meta["row_count"] == 3
        assert len(meta["columns"]) == 2
        assert meta["file_type"] == "parquet"

    def test_metadata_csv(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        tables = loader.list_tables(table_filter="people.csv")
        assert len(tables) == 1
        meta = tables[0]["metadata"]
        assert meta["row_count"] is None
        col_names = [c["name"] for c in meta["columns"]]
        assert "name" in col_names
        assert "age" in col_names

    def test_ls_root(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        nodes = loader.ls()
        names = {n.name for n in nodes}
        # Should find both files and the "reports" directory
        assert "people.csv" in names
        assert "reports" in names
        # Hidden files excluded
        assert ".hidden.csv" not in names

    def test_ls_subdirectory(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        nodes = loader.ls(path=["reports"])
        names = {n.name for n in nodes}
        assert "q1.csv" in names

    def test_ls_with_filter(self, data_dir: Path) -> None:
        loader = LocalFolderDataLoader({"root_dir": str(data_dir)})
        loader.test_connection()
        nodes = loader.ls(filter="parquet")
        names = {n.name for n in nodes}
        assert "numbers.parquet" in names
        assert "people.csv" not in names

    def test_catalog_hierarchy(self) -> None:
        h = LocalFolderDataLoader.catalog_hierarchy()
        assert len(h) == 2
        assert h[0]["key"] == "folder"
        assert h[1]["key"] == "table"
