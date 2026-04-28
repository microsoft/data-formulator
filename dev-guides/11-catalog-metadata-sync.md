# 11. Catalog Metadata Sync & Annotations

## Overview

This module provides full catalog metadata synchronization from remote data
sources and user-owned annotation storage.  It powers Agent search, frontend
catalog browsing, and metadata preview for not-yet-imported datasets.

Design document: [`design-docs/catalog-metadata-sync.md`](../design-docs/catalog-metadata-sync.md)

## Architecture

```
catalog_cache/<source>.json     — auto-synced from remote (overwritten on refresh)
catalog_annotations/<source>.json — user-owned (never overwritten by sync)
catalog_merge.py                — runtime merge (user annotation priority)
```

### Data Flow

1. User connects or clicks Refresh → frontend calls `POST /sync-catalog-metadata`
2. Backend calls `loader.sync_catalog_metadata()` → enriched table list
3. Result is written to `catalog_cache/` and returned as a complete tree
4. Frontend stores tree in React state; node expansion is a local operation
5. Agent uses `search_data_tables` → `read_catalog_metadata` for discovery

## Key Files

| File | Responsibility |
|------|---------------|
| `py-src/.../external_data_loader.py` | Base `sync_catalog_metadata()` + `ensure_table_keys()` |
| `py-src/.../superset_data_loader.py` | Superset override with concurrent column fetch |
| `py-src/.../datalake/catalog_cache.py` | On-disk cache with `synced_at`, DuckDB/Python search |
| `py-src/.../datalake/catalog_annotations.py` | User annotations with file lock + optimistic versioning |
| `py-src/.../datalake/catalog_merge.py` | Runtime merge: `display_description = user \|\| source` |
| `py-src/.../data_connector.py` | API endpoints: sync, PATCH/GET annotations |
| `py-src/.../agents/context.py` | `handle_read_catalog_metadata()` agent tool |
| `src/views/DataSourceSidebar.tsx` | Frontend: sync API + local tree rendering |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/connectors/sync-catalog-metadata` | POST | Full metadata sync → tree + summary |
| `/api/connectors/catalog-annotations` | PATCH | Single-table annotation with optimistic concurrency |
| `/api/connectors/catalog-annotations` | GET | Read annotations for a source |

### Annotation PATCH request

```json
{
    "connector_id": "superset_prod",
    "table_key": "uuid-...",
    "expected_version": 1,
    "description": "...",
    "notes": "...",
    "tags": ["..."],
    "columns": { "col_name": { "description": "..." } }
}
```

Semantic rules:
- `description: ""` → delete the field
- All empty → remove the table entry from annotations
- `expected_version` mismatch → `ANNOTATION_CONFLICT` error

## table_key Contract

Every table record from `list_tables()` and `sync_catalog_metadata()` **must**
contain a `table_key` field — a stable unique identifier within the data source.

| Source type | table_key strategy |
|-------------|-------------------|
| Superset | dataset UUID |
| SQL databases | `_source_name` (schema.table) |
| File-based | file path or name |

`ensure_table_keys()` on the base class provides a fallback (→ `_source_name` → `name`).

## Search with Annotations

`search_catalog_cache()` accepts `annotations_by_source` parameter.
User annotation matches carry higher weight:

| Match type | Score |
|-----------|-------|
| Table name | +10 |
| User description | +8 |
| Source description | +5 |
| User notes | +3 |
| User column description | +3 |
| Column name | +2 |
| Source column description | +1 |

## Error Codes

| Code | Scenario |
|------|----------|
| `CATALOG_SYNC_TIMEOUT` | sync_catalog_metadata timeout (>120s) |
| `CATALOG_NOT_FOUND` | connector_id not found or not connected |
| `ANNOTATION_CONFLICT` | PATCH version mismatch |
| `ANNOTATION_INVALID_PATCH` | Missing table_key or no fields |

## Connection Lifecycle

| Operation | catalog_cache | catalog_annotations |
|-----------|--------------|-------------------|
| Disconnect | Keep | Keep |
| Delete connector | Delete | Keep |
| Reconnect | Overwrite on next sync | Unchanged |
| Re-sync (Refresh) | Overwrite | Unchanged |

## New Loader Checklist

When creating a new `ExternalDataLoader` subclass:

- [ ] Ensure `list_tables()` sets `table_key` on each record
- [ ] If `list_tables()` lacks column details, override `sync_catalog_metadata()`
- [ ] Use `ThreadPoolExecutor` for concurrent per-table detail fetching
- [ ] Set `source_metadata_status` per table: `"synced"`, `"partial"`, or `"unavailable"`
- [ ] Call `self.ensure_table_keys(tables)` before returning
