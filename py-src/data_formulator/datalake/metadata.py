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
from typing import Callable, Literal, Any
import yaml
import logging
import tempfile
import time
import os
import sys

logger = logging.getLogger(__name__)

METADATA_VERSION = "1.1"
METADATA_FILENAME = "workspace.yaml"
LOCK_FILENAME = ".workspace.lock"
MAX_LOCK_WAIT_SECONDS = 10


if sys.platform == 'win32':
    # Windows: use LockFileEx/UnlockFileEx via ctypes for whole-file locking,
    # semantically equivalent to fcntl.flock on Unix.
    import ctypes
    import ctypes.wintypes
    import msvcrt as _msvcrt

    # use_last_error=True: ctypes saves GetLastError() per-thread immediately
    # after each call, avoiding races with other threads.
    _kernel32 = ctypes.WinDLL('kernel32', use_last_error=True) 

    _LOCKFILE_EXCLUSIVE_LOCK = 0x0002
    _LOCKFILE_FAIL_IMMEDIATELY = 0x0001

    class _OVERLAPPED(ctypes.Structure):
        _fields_ = [
            ('Internal', ctypes.POINTER(ctypes.c_ulong)),
            ('InternalHigh', ctypes.POINTER(ctypes.c_ulong)),
            ('Offset', ctypes.wintypes.DWORD),
            ('OffsetHigh', ctypes.wintypes.DWORD),
            ('hEvent', ctypes.wintypes.HANDLE),
        ]

    def _lock_file(fd: int) -> None:
        """Acquire an exclusive, non-blocking lock on the whole file (Windows)."""
        handle = _msvcrt.get_osfhandle(fd)
        overlapped = _OVERLAPPED()
        result = _kernel32.LockFileEx(
            ctypes.wintypes.HANDLE(handle),
            ctypes.wintypes.DWORD(_LOCKFILE_EXCLUSIVE_LOCK | _LOCKFILE_FAIL_IMMEDIATELY),
            ctypes.wintypes.DWORD(0),       # reserved
            ctypes.wintypes.DWORD(0xFFFFFFFF),  # bytes to lock (low)
            ctypes.wintypes.DWORD(0xFFFFFFFF),  # bytes to lock (high)
            ctypes.byref(overlapped),
        )
        if not result:
            raise ctypes.WinError(ctypes.get_last_error())

    def _unlock_file(fd: int) -> None:
        """Release the whole-file lock (Windows)."""
        handle = _msvcrt.get_osfhandle(fd)
        overlapped = _OVERLAPPED()
        result = _kernel32.UnlockFileEx(
            ctypes.wintypes.HANDLE(handle),
            ctypes.wintypes.DWORD(0),       # reserved
            ctypes.wintypes.DWORD(0xFFFFFFFF),
            ctypes.wintypes.DWORD(0xFFFFFFFF),
            ctypes.byref(overlapped),
        )
        if not result:
            raise ctypes.WinError(ctypes.get_last_error())
else:
    import fcntl as _fcntl

    def _lock_file(fd: int) -> None:
        """Acquire an exclusive, non-blocking lock on the whole file (Unix)."""
        _fcntl.flock(fd, _fcntl.LOCK_EX | _fcntl.LOCK_NB)

    def _unlock_file(fd: int) -> None:
        """Release the whole-file lock (Unix)."""
        _fcntl.flock(fd, _fcntl.LOCK_UN)


class WorkspaceLock:
    """
    Context manager for acquiring an exclusive lock on workspace metadata.
    Prevents race conditions when multiple processes/threads modify metadata concurrently.
    Uses LockFileEx on Windows and fcntl.flock on Unix — both provide whole-file locking.
    """

    def __init__(self, workspace_path: Path, timeout: float = MAX_LOCK_WAIT_SECONDS):
        self.lock_file = workspace_path / LOCK_FILENAME
        self.timeout = timeout
        self.lock_fd = None

    def __enter__(self):
        """Acquire exclusive lock with timeout."""
        # Ensure the lock file exists
        self.lock_file.parent.mkdir(parents=True, exist_ok=True)

        start_time = time.time()
        while True:
            try:
                # Open lock file (create if doesn't exist)
                # 'a+' creates the file atomically if missing and allows seek/read
                self.lock_fd = open(self.lock_file, 'a+')
                # Try to acquire exclusive whole-file lock (non-blocking)
                _lock_file(self.lock_fd.fileno())
                logger.debug(f"Acquired workspace lock: {self.lock_file}")
                return self
            except (IOError, OSError) as e:
                # Lock is held by another process
                if self.lock_fd:
                    self.lock_fd.close()
                    self.lock_fd = None

                elapsed = time.time() - start_time
                if elapsed >= self.timeout:
                    raise TimeoutError(
                        f"Failed to acquire workspace lock after {self.timeout}s. "
                        f"Another process may be holding it."
                    )

                # Wait a bit before retrying
                time.sleep(0.05)

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Release lock."""
        if self.lock_fd:
            try:
                _unlock_file(self.lock_fd.fileno())
                self.lock_fd.close()
                logger.debug(f"Released workspace lock: {self.lock_file}")
            except Exception as e:
                logger.warning(f"Error releasing lock: {e}")
            finally:
                self.lock_fd = None


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
    original_name: str | None = None

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
            result["loader_params"] = make_json_safe(self.loader_params)
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
        if self.original_name is not None:
            result["original_name"] = self.original_name
        
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
            original_name=data.get("original_name"),
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


# ── Internal helpers (no locking — caller must hold WorkspaceLock) ─────

def _read_metadata_file(workspace_path: Path) -> WorkspaceMetadata:
    """Read and parse workspace.yaml.  **Caller must already hold the lock.**"""
    metadata_file = workspace_path / METADATA_FILENAME
    if not metadata_file.exists():
        raise FileNotFoundError(f"Metadata file not found: {metadata_file}")
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            content = f.read()
        if not content or not content.strip():
            raise ValueError(
                f"Empty metadata file — possible concurrent write conflict. "
                f"File: {metadata_file}"
            )
        data = yaml.safe_load(content)
        if data is None:
            raise ValueError("Metadata file parsed to None")
        return WorkspaceMetadata.from_dict(data)
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML in metadata file: {e}")


def _write_metadata_file(workspace_path: Path, metadata: WorkspaceMetadata) -> None:
    """Atomically write workspace.yaml.  **Caller must already hold the lock.**"""
    metadata_file = workspace_path / METADATA_FILENAME
    metadata.updated_at = datetime.now(timezone.utc)
    workspace_path.mkdir(parents=True, exist_ok=True)

    temp_fd, temp_path = tempfile.mkstemp(
        dir=workspace_path,
        prefix=".workspace_",
        suffix=".yaml.tmp",
        text=True,
    )
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                metadata.to_dict(),
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
            )
        os.replace(temp_path, metadata_file)
        logger.debug(f"Saved metadata to {metadata_file}")
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


# ── Public API (with locking) ────────────────────────────────────────

def load_metadata(workspace_path: Path) -> WorkspaceMetadata:
    """Load workspace metadata from YAML file with file locking."""
    with WorkspaceLock(workspace_path):
        return _read_metadata_file(workspace_path)


def save_metadata(workspace_path: Path, metadata: WorkspaceMetadata) -> None:
    """Save workspace metadata to YAML file with atomic write and file locking."""
    with WorkspaceLock(workspace_path):
        _write_metadata_file(workspace_path, metadata)


def update_metadata(
    workspace_path: Path,
    updater: Callable[[WorkspaceMetadata], None],
) -> WorkspaceMetadata:
    """Atomically read → update → write workspace metadata.

    The *updater* callback receives the current :class:`WorkspaceMetadata`
    and should mutate it in place.  The entire read-modify-write is
    protected by a **single** lock acquisition, preventing the
    lost-update race condition that occurs when ``load_metadata`` and
    ``save_metadata`` each acquire their own independent lock.

    Returns:
        The updated :class:`WorkspaceMetadata` (useful for refreshing caches).
    """
    with WorkspaceLock(workspace_path):
        metadata = _read_metadata_file(workspace_path)
        updater(metadata)
        _write_metadata_file(workspace_path, metadata)
        return metadata


def metadata_exists(workspace_path: Path) -> bool:
    """Check if workspace metadata file exists."""
    return (workspace_path / METADATA_FILENAME).exists()
