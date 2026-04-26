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


def safe_source_id(source_id: str) -> str:
    """Sanitise a ``source_id`` into a filesystem-safe, collision-resistant string.

    Used wherever a source / connector ID needs to become a filename component
    (e.g. ``connectors/<id>.json``, ``catalog_cache/<id>.json``).

    Rules:
    * ``/`` and ``\\`` → ``_``  (path separators)
    * ``:``            → ``--`` (Windows-unsafe, and preserves uniqueness so that
      ``mysql:prod`` and ``mysql_prod`` map to different filenames)

    Examples::

        >>> safe_source_id("postgresql:prod-db")
        'postgresql--prod-db'
        >>> safe_source_id("mysql_prod")
        'mysql_prod'
        >>> safe_source_id("a:b/c\\\\d")
        'a--b_c_d'
    """
    return source_id.replace("/", "_").replace("\\", "_").replace(":", "--")


__all__ = ["safe_source_id"]
