# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Metadata management for the Data Lake workspace.

This module defines the schema and operations for workspace.yaml,
which tracks all data sources (uploaded files and data loader ingests).
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, date, timezone
from decimal import Decimal
from pathlib import Path
from typing import Literal, Any
import yaml
import logging

logger = logging.getLogger(__name__)

METADATA_VERSION = "1.1"
METADATA_FILENAME = "workspace.yaml"


def make_json_safe(value: Any) -> Any:
    """
    Convert a value (possibly containing numpy/pandas/pyarrow scalars) into
    a JSON/YAML-safe primitive structure.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return str(value)

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, dict):
        return {str(k): make_json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [make_json_safe(v) for v in value]

    # numpy scalars, pandas scalars, etc.
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return make_json_safe(item())
        except Exception:
            pass

    return str(value)


@dataclass
class ColumnInfo:
    """Information about a single column in a table."""
    name: str
    dtype: str

    def to_dict(self) -> dict:
        return {"name": self.name, "dtype": self.dtype}

    @classmethod
    def from_dict(cls, data: dict) -> "ColumnInfo":
        return cls(name=data["name"], dtype=data["dtype"])


@dataclass
class TableMetadata:
    """Metadata for a single table/file in the workspace."""
    name: str
    source_type: Literal["upload", "data_loader"]
    filename: str
    file_type: str
    created_at: datetime
    content_hash: str | None = None
    file_size: int | None = None
    # For data_loader sources:
    loader_type: str | None = None
    loader_params: dict | None = None
    source_table: str | None = None
    source_query: str | None = None
    last_synced: datetime | None = None
    row_count: int | None = None
    columns: list[ColumnInfo] | None = None
    # Small set of representative rows for previewing (list of records).
    sample_rows: list[dict[str, Any]] | None = None

    def to_dict(self) -> dict:
        """Convert to dictionary for YAML serialization."""
        result = {
            "source_type": self.source_type,
            "filename": self.filename,
            "file_type": self.file_type,
            "created_at": self.created_at.isoformat(),
        }
        
        if self.content_hash is not None:
            result["content_hash"] = self.content_hash
        if self.file_size is not None:
            result["file_size"] = self.file_size
        if self.loader_type is not None:
            result["loader_type"] = self.loader_type
        if self.loader_params is not None:
            result["loader_params"] = self.loader_params
        if self.source_table is not None:
            result["source_table"] = self.source_table
        if self.source_query is not None:
            result["source_query"] = self.source_query
        if self.last_synced is not None:
            result["last_synced"] = self.last_synced.isoformat()
        if self.row_count is not None:
            result["row_count"] = self.row_count
        if self.columns is not None:
            result["columns"] = [col.to_dict() for col in self.columns]
        if self.sample_rows is not None:
            result["sample_rows"] = make_json_safe(self.sample_rows)
        
        return result

    @classmethod
    def from_dict(cls, name: str, data: dict) -> "TableMetadata":
        """Create from dictionary (YAML deserialization)."""
        columns = None
        if "columns" in data and data["columns"] is not None:
            columns = [ColumnInfo.from_dict(col) for col in data["columns"]]
        
        created_at = data["created_at"]
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        
        last_synced = data.get("last_synced")
        if isinstance(last_synced, str):
            last_synced = datetime.fromisoformat(last_synced)
        
        return cls(
            name=name,
            source_type=data["source_type"],
            filename=data["filename"],
            file_type=data["file_type"],
            created_at=created_at,
            content_hash=data.get("content_hash"),
            file_size=data.get("file_size"),
            loader_type=data.get("loader_type"),
            loader_params=data.get("loader_params"),
            source_table=data.get("source_table"),
            source_query=data.get("source_query"),
            last_synced=last_synced,
            row_count=data.get("row_count"),
            columns=columns,
            sample_rows=data.get("sample_rows"),
        )


@dataclass
class WorkspaceMetadata:
    """Metadata for the entire workspace."""
    version: str
    created_at: datetime
    updated_at: datetime
    tables: dict[str, TableMetadata] = field(default_factory=dict)

    def add_table(self, table: TableMetadata) -> None:
        """Add or update a table in the metadata."""
        self.tables[table.name] = table
        self.updated_at = datetime.now(timezone.utc)

    def remove_table(self, name: str) -> bool:
        """Remove a table from the metadata. Returns True if removed."""
        if name in self.tables:
            del self.tables[name]
            self.updated_at = datetime.now(timezone.utc)
            return True
        return False

    def get_table(self, name: str) -> TableMetadata | None:
        """Get metadata for a specific table."""
        return self.tables.get(name)

    def list_tables(self) -> list[str]:
        """List all table names."""
        return list(self.tables.keys())

    def to_dict(self) -> dict:
        """Convert to dictionary for YAML serialization."""
        return {
            "version": self.version,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "tables": {
                name: table.to_dict() 
                for name, table in self.tables.items()
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceMetadata":
        """Create from dictionary (YAML deserialization)."""
        created_at = data["created_at"]
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        
        updated_at = data["updated_at"]
        if isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at)
        
        tables = {}
        tables_data = data.get("tables", {})
        if tables_data:
            for name, table_data in tables_data.items():
                tables[name] = TableMetadata.from_dict(name, table_data)
        
        return cls(
            version=data["version"],
            created_at=created_at,
            updated_at=updated_at,
            tables=tables,
        )

    @classmethod
    def create_new(cls) -> "WorkspaceMetadata":
        """Create a new empty workspace metadata."""
        now = datetime.now(timezone.utc)
        return cls(
            version=METADATA_VERSION,
            created_at=now,
            updated_at=now,
            tables={},
        )


def load_metadata(workspace_path: Path) -> WorkspaceMetadata:
    """
    Load workspace metadata from YAML file.
    
    Args:
        workspace_path: Path to the workspace directory
        
    Returns:
        WorkspaceMetadata object
        
    Raises:
        FileNotFoundError: If metadata file doesn't exist
        ValueError: If metadata file is invalid
    """
    metadata_file = workspace_path / METADATA_FILENAME
    
    if not metadata_file.exists():
        raise FileNotFoundError(f"Metadata file not found: {metadata_file}")
    
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        
        if data is None:
            raise ValueError("Empty metadata file")
        
        return WorkspaceMetadata.from_dict(data)
    
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML in metadata file: {e}")


def save_metadata(workspace_path: Path, metadata: WorkspaceMetadata) -> None:
    """
    Save workspace metadata to YAML file.
    
    Args:
        workspace_path: Path to the workspace directory
        metadata: WorkspaceMetadata object to save
    """
    metadata_file = workspace_path / METADATA_FILENAME
    
    # Update the updated_at timestamp
    metadata.updated_at = datetime.now(timezone.utc)
    
    # Ensure directory exists
    workspace_path.mkdir(parents=True, exist_ok=True)
    
    with open(metadata_file, "w", encoding="utf-8") as f:
        yaml.dump(
            metadata.to_dict(),
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
    
    logger.debug(f"Saved metadata to {metadata_file}")


def metadata_exists(workspace_path: Path) -> bool:
    """Check if workspace metadata file exists."""
    return (workspace_path / METADATA_FILENAME).exists()
