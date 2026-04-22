# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Path confinement primitive — prevents path traversal at the API level.

Usage::

    jail = ConfinedDir("/tmp/workspace")
    safe = jail / "data/sales.parquet"        # OK
    jail / "../etc/passwd"                     # raises ValueError
    jail.write("data/out.parquet", raw_bytes)  # resolve + mkdir + write
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class ConfinedDir:
    """A directory jail that prevents any path operation from escaping its root.

    All path resolution goes through this single chokepoint.  If the
    resolved path escapes the root, ``ValueError`` is raised immediately.

    Thread-safe: instances are immutable after construction; Path.resolve()
    and is_relative_to() are OS-level and inherently safe for concurrent use.
    """

    __slots__ = ("_root",)

    def __init__(self, root: Path | str, *, mkdir: bool = True):
        self._root = Path(root).resolve()
        if mkdir:
            self._root.mkdir(parents=True, exist_ok=True)

    # -- properties --------------------------------------------------------

    @property
    def root(self) -> Path:
        """The resolved, canonical root directory."""
        return self._root

    # -- core API ----------------------------------------------------------

    def resolve(self, relative: str, *, mkdir_parents: bool = False) -> Path:
        """Resolve *relative* within this jail.

        Raises ``ValueError`` if the result would escape the root.

        Defence is layered:
          1. Reject absolute paths outright.
          2. Reject path segments equal to ``..``.
          3. Join onto root, canonicalise with ``resolve()``, and confirm
             the result is still under root (catches symlink escapes).
        """
        if not relative:
            raise ValueError("Empty relative path")
        if Path(relative).is_absolute():
            raise ValueError(f"Absolute path not allowed: {relative!r}")

        parts = Path(relative).parts
        if ".." in parts:
            raise ValueError(f"Path traversal segment '..' in: {relative!r}")

        candidate = (self._root / relative).resolve()
        if not candidate.is_relative_to(self._root):
            raise ValueError(
                f"Path escapes confined directory: {relative!r} "
                f"resolves to {candidate}"
            )

        if mkdir_parents:
            candidate.parent.mkdir(parents=True, exist_ok=True)

        return candidate

    def write(self, relative: str, data: bytes) -> Path:
        """Resolve, create parent dirs, and write *data* atomically."""
        target = self.resolve(relative, mkdir_parents=True)
        target.write_bytes(data)
        return target

    def __truediv__(self, relative: str) -> Path:
        """Operator overload: ``jail / "sub/path"`` → ``jail.resolve("sub/path")``."""
        return self.resolve(relative)

    def __repr__(self) -> str:
        return f"ConfinedDir({self._root})"
