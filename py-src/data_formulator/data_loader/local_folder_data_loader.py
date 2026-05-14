# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Local folder data loader — reads data files from a directory on the local filesystem.

Only available in local deployment mode (backend bound to localhost).
Uses ConfinedDir to ensure all file access stays within the connected root directory.
"""

import json
import logging
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode
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
                "description": "Include files in subdirectories",
            },
            {
                "name": "file_pattern",
                "type": "string",
                "required": False,
                "default": "",
                "tier": "connection",
                "description": "Glob pattern to filter files (e.g. '*.csv')",
            },
        ]

    @staticmethod
    def auth_instructions() -> str:
        return (
            "Point `root_dir` to a local directory containing data files.\n\n"
            "**Supported formats:** CSV, TSV, Parquet, JSON, JSONL, Excel (.xlsx/.xls)\n\n"
            "Click **Browse** to open a folder picker, or paste a directory path."
        )

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "folder", "label": "Folder"},
            {"key": "table", "label": "File"},
        ]

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.root_dir = Path(params.get("root_dir", "")).resolve()
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
            elif child.is_file() and child.suffix.lower() in SUPPORTED_EXTENSIONS:
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

        # Read a small sample for preview
        try:
            table = self.fetch_data_as_arrow("/".join(path), {"size": 5})
            sample_df = table.to_pandas()
            meta["columns"] = [
                {"name": c, "type": str(sample_df[c].dtype)}
                for c in sample_df.columns
            ]
            meta["sample_rows"] = df_to_safe_records(sample_df)
            meta["row_count"] = meta.get("row_count") or len(sample_df)
        except Exception as exc:
            logger.debug("Sample read failed for %s: %s", path, exc)

        return meta

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """Return data files as 'tables', with subdirectories as namespaces."""
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
            if filepath.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            if filepath.name.startswith("."):
                continue

            rel = filepath.relative_to(self.root_dir)
            name = str(rel)

            if table_filter and table_filter.lower() not in name.lower():
                continue

            metadata = self._file_metadata(filepath)
            results.append({
                "name": name,
                "metadata": metadata,
                "path": list(rel.parts),
            })

        return results

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Read a file from the connected folder into an Arrow table."""
        if self._jail is None:
            self._jail = ConfinedDir(self.root_dir, mkdir=False)

        resolved = self._jail / source_table
        opts = import_options or {}
        size = opts.get("size", 1_000_000)

        ext = resolved.suffix.lower()
        if ext == ".parquet":
            table = pq.read_table(str(resolved))
        elif ext in (".csv", ".tsv"):
            table = pa_csv.read_csv(str(resolved))
        elif ext in (".json", ".jsonl"):
            import pyarrow.json as pa_json
            table = pa_json.read_json(str(resolved))
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(str(resolved))
            table = pa.Table.from_pandas(df)
        else:
            raise ValueError(f"Unsupported file type: {ext}")

        # Store total before slicing so callers can get the real count
        self._last_total_rows = table.num_rows

        if table.num_rows > size:
            table = table.slice(0, size)

        logger.info(
            "Fetched %d rows from local file: %s",
            table.num_rows, source_table,
        )
        return table

    # -- Helpers -----------------------------------------------------------

    def _file_metadata(self, filepath: Path) -> dict[str, Any]:
        """Extract lightweight metadata without reading the full file."""
        ext = filepath.suffix.lower()
        try:
            stat = filepath.stat()
        except OSError:
            return {}

        meta: dict[str, Any] = {
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
            elif ext in (".csv", ".tsv"):
                with open(filepath, "r", errors="replace") as f:
                    header = f.readline().strip()
                sep = "\t" if ext == ".tsv" else ","
                meta["columns"] = [
                    {"name": c.strip().strip('"'), "type": "string"}
                    for c in header.split(sep)
                    if c.strip()
                ]
                meta["row_count"] = None
            elif ext in (".json", ".jsonl"):
                with open(filepath, "r", errors="replace") as f:
                    first_line = f.readline().strip()
                if first_line:
                    try:
                        obj = json.loads(first_line)
                        if isinstance(obj, dict):
                            meta["columns"] = [
                                {"name": k, "type": type(v).__name__}
                                for k, v in obj.items()
                            ]
                        elif isinstance(obj, list) and obj and isinstance(obj[0], dict):
                            meta["columns"] = [
                                {"name": k, "type": type(v).__name__}
                                for k, v in obj[0].items()
                            ]
                    except json.JSONDecodeError:
                        pass
                meta["row_count"] = None
            elif ext in (".xlsx", ".xls"):
                meta["row_count"] = None
        except Exception as exc:
            logger.debug("Metadata extraction failed for %s: %s", filepath, exc)

        return meta
