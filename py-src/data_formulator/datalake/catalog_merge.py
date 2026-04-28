"""Catalog merge — produce a merged metadata view from cache + annotations.

Merge rules (from design doc):

* User annotation wins for display: ``display_description = user || source``
* Both user and source descriptions are preserved in separate keys for
  agent search weighting.
* Column-level merge follows the same pattern.
* Tags and notes come from annotations only.
"""

from __future__ import annotations

import copy
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def merge_table_metadata(
    cache_table: dict[str, Any],
    annotation: dict[str, Any] | None,
) -> dict[str, Any]:
    """Merge a single table's cache entry with its user annotation.

    Parameters
    ----------
    cache_table : dict
        A table record from ``catalog_cache`` (has ``metadata``, ``table_key``, etc.).
    annotation : dict or None
        The matching entry from ``catalog_annotations.tables[table_key]``.
        ``None`` or ``{}`` means no user annotation.

    Returns a new dict (does not mutate inputs).
    """
    result = copy.deepcopy(cache_table)
    meta = result.setdefault("metadata", {})

    source_desc = meta.get("description", "")
    user_desc = (annotation or {}).get("description", "")

    meta["source_description"] = source_desc
    meta["user_description"] = user_desc
    meta["display_description"] = user_desc or source_desc

    user_notes = (annotation or {}).get("notes", "")
    if user_notes:
        meta["notes"] = user_notes

    user_tags = (annotation or {}).get("tags")
    if user_tags:
        meta["tags"] = user_tags

    # Column-level merge
    source_cols = {
        c["name"]: c for c in meta.get("columns", []) if isinstance(c, dict) and "name" in c
    }
    user_cols = (annotation or {}).get("columns", {}) or {}

    all_col_names = list(source_cols.keys())
    for cn in user_cols:
        if cn not in source_cols:
            all_col_names.append(cn)

    merged_cols = []
    for col_name in all_col_names:
        src_col = source_cols.get(col_name, {})
        usr_col = user_cols.get(col_name, {})

        merged_col = dict(src_col)
        if not merged_col.get("name"):
            merged_col["name"] = col_name

        src_cdesc = src_col.get("description", "")
        usr_cdesc = usr_col.get("description", "")

        merged_col["source_description"] = src_cdesc
        merged_col["user_description"] = usr_cdesc
        merged_col["display_description"] = usr_cdesc or src_cdesc

        merged_cols.append(merged_col)

    if merged_cols:
        meta["columns"] = merged_cols

    return result


def merge_catalog(
    cache_tables: list[dict[str, Any]],
    annotations: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Merge a full catalog cache with annotations.

    Parameters
    ----------
    cache_tables : list
        Table records from ``catalog_cache``.
    annotations : dict or None
        Full annotations data (the ``tables`` dict from the annotation file),
        keyed by ``table_key``.

    Returns a new list of merged table records.
    """
    ann_tables = (annotations or {}).get("tables", {}) if isinstance(annotations, dict) else {}

    merged = []
    for t in cache_tables:
        table_key = t.get("table_key", "")
        ann = ann_tables.get(table_key) if table_key else None
        merged.append(merge_table_metadata(t, ann))

    return merged
