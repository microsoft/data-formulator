# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Local folder data loader — reads data files from a directory on the local filesystem.

Only available in local deployment mode (backend bound to localhost).
Uses ConfinedDir to ensure all file access stays within the connected root directory.
"""

import logging
import os
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS
from data_formulator.data_loader import probe_utils
from data_formulator.datalake.parquet_utils import df_to_safe_records
from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = frozenset({
    ".csv", ".tsv", ".parquet",
    ".json", ".jsonl",
    ".xlsx", ".xls",
})


class LocalFolderDataLoader(ExternalDataLoader):
    """Browse and import data files from a local directory."""

    DISPLAY_NAME = "Local Folder"

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {
                "name": "root_dir",
                "type": "string",
                "required": True,
                "default": "",
                "tier": "connection",
                "description": "Absolute path to the local directory to browse",
            },
            {
                "name": "recursive",
                "type": "boolean",
                "required": False,
                "default": "true",
                "tier": "connection",
                "advanced": True,
                "description": "Include files in subdirectories",
            },
            {
                "name": "file_pattern",
                "type": "string",
                "required": False,
                "default": "",
                "tier": "connection",
                "advanced": True,
                "description": "Glob pattern to filter files (e.g. '*.csv')",
            },
        ]

    AUTH_GUIDE = "local_folder.md"
    QUERY_EXECUTION = "local_file_scan"

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "folder", "label": "Folder"},
            {"key": "table", "label": "File"},
        ]

    def __init__(self, params: dict[str, Any]):
        self.params = params
        raw_root = params.get("root_dir", "") or ""
        # Expand ~ and environment variables (e.g. $HOME, %USERPROFILE%) so users
        # can paste shell-style paths into the connect dialog.
        expanded = os.path.expandvars(os.path.expanduser(raw_root))
        self.root_dir = Path(expanded).resolve()
        recursive_val = params.get("recursive", True)
        if isinstance(recursive_val, str):
            self.recursive = recursive_val.lower() not in ("false", "0", "no")
        else:
            self.recursive = bool(recursive_val)
        self.file_pattern = params.get("file_pattern", "")
        self._jail: ConfinedDir | None = None

    def test_connection(self) -> bool:
        """Validate the root directory exists and is readable."""
        try:
            if not self.root_dir.is_dir():
                return False
            # Verify we can list the directory
            next(self.root_dir.iterdir(), None)
            self._jail = ConfinedDir(self.root_dir, mkdir=False)
            return True
        except (PermissionError, OSError):
            return False

    # -- Catalog tree API --------------------------------------------------

    def ls(
        self,
        path: list[str] | None = None,
        filter: str | None = None,
    ) -> list[CatalogNode]:
        """List children at a catalog path.

        path=[] → list top-level folders and files.
        path=["subfolder"] → list contents of subfolder.
        """
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []

        # Navigate to the target directory
        if path:
            try:
                target = self._jail / "/".join(path)
            except ValueError:
                return []
            if not target.is_dir():
                return []
        else:
            target = self.root_dir

        nodes: list[CatalogNode] = []
        try:
            children = sorted(target.iterdir())
        except PermissionError:
            return []

        for child in children:
            if child.name.startswith("."):
                continue

            rel_parts = list(child.relative_to(self.root_dir).parts)

            if child.is_dir():
                if filter and filter.lower() not in child.name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=child.name,
                    node_type="namespace",
                    path=rel_parts,
                ))
            elif child.is_file():
                try:
                    self._jail / "/".join(rel_parts)
                except ValueError:
                    continue
                if self.file_pattern and not child.match(self.file_pattern):
                    continue
                if filter and filter.lower() not in child.name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=child.name,
                    node_type="table",
                    path=rel_parts,
                    metadata=self._file_metadata(child),
                ))

        return nodes

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        """Get detailed metadata for a single file, including sample rows."""
        if not path:
            return {}
        try:
            resolved = self._jail / "/".join(path)
        except ValueError:
            return {}
        if not resolved.is_file():
            return {}

        meta = self._file_metadata(resolved)
        if meta.get("artifact_kind") == "file":
            return meta
        if resolved.suffix.lower() == ".parquet":
            meta["inspection"] = {"schema_source": "footer", "row_count_status": "exact", "sample_status": "not_requested"}
            return meta

        # Read a small sample for preview
        try:
            preview = self.preview_data("/".join(path), purpose="agent")
            meta["columns"] = preview["columns"]
            meta["sample_rows"] = preview["rows"]
            meta["inspection"] = preview["inspection"]
        except Exception as exc:
            logger.debug("Sample read failed for %s: %s", path, exc)

        return meta

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """Return catalog entries with file artifacts identified in metadata."""
        if self._jail is None:
            self._jail = ConfinedDir(self.root_dir, mkdir=False)

        results: list[dict[str, Any]] = []
        pattern = self.file_pattern or "*"

        if self.recursive:
            candidates = self.root_dir.rglob(pattern)
        else:
            candidates = self.root_dir.glob(pattern)

        for filepath in sorted(candidates):
            if not filepath.is_file():
                continue
            rel = filepath.relative_to(self.root_dir)
            if any(part.startswith(".") for part in rel.parts):
                continue
            name = str(rel)
            try:
                self._jail / name
            except ValueError:
                continue

            if table_filter and table_filter.lower() not in name.lower():
                continue

            metadata = self._file_metadata(filepath)
            results.append({
                "name": name,
                "metadata": metadata,
                "path": list(rel.parts),
            })

        return results

    def read_file(self, source_path: str, max_bytes: int = 128 * 1024 * 1024) -> bytes:
        if self._jail is None:
            self._jail = ConfinedDir(self.root_dir, mkdir=False)
        resolved = self._jail / source_path
        if any(part.startswith(".") for part in Path(source_path).parts):
            raise ValueError("Hidden files are not available")
        if not resolved.is_file():
            raise ValueError("Source is not a file")
        with resolved.open("rb") as source:
            content = source.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise ValueError("File exceeds the workspace file size limit")
        return content

    def preview_data(self, source_table: str, import_options: dict[str, Any] | None = None,
                     *, purpose: str = "ui") -> dict[str, Any]:
        if self._jail is None:
            self._jail = ConfinedDir(self.root_dir, mkdir=False)
        resolved = self._jail / source_table
        if not resolved.is_file():
            raise ValueError("Source is not a file")
        if resolved.suffix.lower() not in SUPPORTED_EXTENSIONS - {".xlsx", ".xls"}:
            raise ValueError("File artifacts must use the file preview")
        return probe_utils.preview_file(probe_utils.register_file_scan, str(resolved), import_options, purpose=purpose)

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Read a file from the connected folder into an Arrow table."""
        opts = import_options or {}
        return self.query_data_as_arrow(source_table, probe_utils.query_from_import_options(opts),
                                        min(opts.get("size", 1_000_000), MAX_IMPORT_ROWS))

    def query_data_as_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        import duckdb

        if self._jail is None:
            self._jail = ConfinedDir(self.root_dir, mkdir=False)
        resolved = self._jail / source_table
        if not resolved.is_file():
            raise ValueError("Source is not a file")
        if resolved.suffix.lower() in (".xlsx", ".xls"):
            raise ValueError("File artifacts must use the file preview or file import")
        self._last_total_rows = None
        sql = probe_utils.compile_probe_sql(query, limit, dialect=probe_utils.DUCKDB)
        with duckdb.connect(config={"memory_limit": "512MB"}) as connection:
            if resolved.suffix.lower() == ".parquet":
                self._last_total_rows = pq.ParquetFile(str(resolved)).metadata.num_rows
            probe_utils.register_file_scan(connection, str(resolved))
            return connection.execute(sql).fetch_arrow_table()

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        limit = probe_utils.clamp_probe_limit(query.get("limit"))
        try:
            result = self.query_data_as_arrow("/".join(path), query, limit)
            return probe_utils.shape_probe_payload(result, limit, exact=True)
        except Exception as exc:
            return {"error": f"probe failed: {exc}"}

    # -- Helpers -----------------------------------------------------------

    def _file_metadata(self, filepath: Path) -> dict[str, Any]:
        """Extract lightweight metadata without reading the full file."""
        ext = filepath.suffix.lower()
        try:
            stat = filepath.stat()
        except OSError:
            return {}

        meta: dict[str, Any] = {
            "artifact_kind": "table" if ext in SUPPORTED_EXTENSIONS - {".xlsx", ".xls"} else "file",
            "file_size": stat.st_size,
            "modified": stat.st_mtime,
            "file_type": ext.lstrip("."),
        }

        try:
            if ext == ".parquet":
                pf = pq.ParquetFile(str(filepath))
                meta["row_count"] = pf.metadata.num_rows
                schema = pf.schema_arrow
                meta["columns"] = [
                    {"name": schema.field(i).name, "type": str(schema.field(i).type)}
                    for i in range(len(schema))
                ]
            elif ext in SUPPORTED_EXTENSIONS:
                meta["row_count"] = None
        except Exception as exc:
            logger.debug("Metadata extraction failed for %s: %s", filepath, exc)

        return meta
