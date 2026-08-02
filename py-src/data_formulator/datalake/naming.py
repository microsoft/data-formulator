# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Lightweight ID / filename sanitisation helpers.

No heavy dependencies (no pandas, pyarrow, etc.) so that both
:mod:`data_connector` and :mod:`datalake.catalog_cache` can import
without pulling in the data stack.

For **table-name** sanitisation see :mod:`datalake.table_names`.
For **data-file** sanitisation see :func:`datalake.parquet_utils.safe_data_filename`.
"""

from __future__ import annotations

import re


_SAFE_SOURCE_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def safe_source_id(source_id: str) -> str:
    """Sanitise a ``source_id`` into a filesystem-safe, collision-resistant string.

    Used wherever a source / connector ID needs to become a filename component
    (e.g. ``connectors/<id>.json``, ``catalog_cache/<id>.json``).

    Rules:
    * ``/`` and ``\\`` → ``_``  (path separators)
    * ``:``            → ``--`` (Windows-unsafe, and preserves uniqueness so that
      ``mysql:prod`` and ``mysql_prod`` map to different filenames)
    * final value must match ``[A-Za-z0-9._-]+`` and not be ``.`` or ``..``

    Examples::

        >>> safe_source_id("postgresql:prod-db")
        'postgresql--prod-db'
        >>> safe_source_id("mysql_prod")
        'mysql_prod'
        >>> safe_source_id("a:b/c\\\\d")
        'a--b_c_d'
    """
    sanitized = source_id.replace("/", "_").replace("\\", "_").replace(":", "--")
    if not sanitized or sanitized in {".", ".."}:
        raise ValueError("source_id must not be empty or relative-dot segments")
    if len(sanitized) > 255:
        raise ValueError("source_id is too long")
    if not _SAFE_SOURCE_ID_RE.fullmatch(sanitized):
        raise ValueError("source_id contains unsupported characters")
    return sanitized


__all__ = ["safe_source_id"]
