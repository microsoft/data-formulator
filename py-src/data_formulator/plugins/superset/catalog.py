# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Two-tier Superset dataset catalog with TTL caching.

Tier 1 -- summary: lightweight list for browsing.
Tier 2 -- detail: full column descriptions, types, extra metadata.

Migrated verbatim from data-formulator 0.6 ``superset/catalog.py``.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


class SupersetCatalog:

    def __init__(self, superset_client: Any, cache_ttl: int = 300):
        self.client = superset_client
        self.cache_ttl = cache_ttl
        self._cache: dict[str, dict] = {}

    # -- tier 1: summary -------------------------------------------------

    def _fetch_all_datasets(self, access_token: str | None, page_size: int = 1000) -> list[dict]:
        """Fetch all dataset pages from Superset (auto-pagination)."""
        all_results: list[dict] = []
        page = 0
        while True:
            raw = self.client.list_datasets(access_token, page=page, page_size=page_size)
            batch = raw.get("result", [])
            all_results.extend(batch)
            total = raw.get("count", len(all_results))
            if len(all_results) >= total or len(batch) < page_size:
                break
            page += 1
        return all_results

    def get_catalog_summary(
        self,
        access_token: str | None,
        user_id: int | None,
    ) -> list[dict]:
        """Lightweight dataset list (cached per user)."""
        cache_key = f"summary_{user_id}"
        cached = self._cache.get(cache_key)
        if cached and time.time() - cached["ts"] < self.cache_ttl:
            return cached["data"]

        all_raw = self._fetch_all_datasets(access_token)
        datasets: list[dict] = []
        for ds in all_raw:
            columns = ds.get("columns") or []
            if not columns and ds.get("id") is not None:
                try:
                    detail = self.client.get_dataset_detail(access_token, ds["id"])
                    columns = detail.get("columns") or []
                except Exception:
                    logger.debug("Failed to fetch dataset detail for %s", ds.get("id"), exc_info=True)
            datasets.append(
                {
                    "id": ds["id"],
                    "name": ds.get("table_name") or "",
                    "schema": ds.get("schema") or "",
                    "database": (ds.get("database") or {}).get("database_name", "") or "",
                    "description": ds.get("description") or "",
                    "column_count": len(columns),
                    "column_names": [c.get("column_name") or "" for c in columns],
                    "row_count": ds.get("row_count"),
                }
            )

        self._cache[cache_key] = {"data": datasets, "ts": time.time()}
        return datasets

    # -- tier 2: detail --------------------------------------------------

    def get_dataset_detail(
        self,
        access_token: str,
        dataset_id: int,
    ) -> dict:
        return self.client.get_dataset_detail(access_token, dataset_id)

    @staticmethod
    def _load_json_blob(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str) and value.strip():
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                logger.debug("Failed to parse Superset json_metadata", exc_info=True)
        return {}

    @staticmethod
    def _quote_identifier(name: str) -> str:
        escaped = (name or "").replace('"', '""')
        return f'"{escaped}"'

    @staticmethod
    def _sql_literal(value: Any) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
        escaped = str(value).replace("'", "''")
        return f"'{escaped}'"

    @staticmethod
    def _normalize_column_type(column: dict[str, Any] | None) -> str:
        if not column:
            return "STRING"
        raw = (
            column.get("type_generic")
            or column.get("type")
            or column.get("python_date_format")
            or column.get("expressionType")
            or ""
        )
        normalized = str(raw).upper()
        if column.get("is_dttm"):
            return "TEMPORAL"
        if any(token in normalized for token in ("DATE", "TIME", "TEMPORAL")):
            return "TEMPORAL"
        if any(token in normalized for token in ("INT", "FLOAT", "DOUBLE", "NUMERIC", "DECIMAL", "BIGINT")):
            return "NUMERIC"
        if "BOOL" in normalized:
            return "BOOLEAN"
        return "STRING"

    @staticmethod
    def _infer_input_type(filter_type: str, column_type: str) -> str:
        normalized_filter = (filter_type or "").lower()
        if "time" in normalized_filter or column_type == "TEMPORAL":
            return "time"
        if "number" in normalized_filter or "range" in normalized_filter or column_type == "NUMERIC":
            return "numeric"
        if "select" in normalized_filter:
            return "select"
        return "text"

    @staticmethod
    def _build_dataset_sql(detail: dict[str, Any]) -> tuple[int, str, str]:
        database = detail.get("database") or {}
        db_id = database["id"]
        table_name = detail.get("table_name") or ""
        schema = detail.get("schema", "") or ""
        dataset_sql = (detail.get("sql") or "").strip()
        dataset_kind = (detail.get("kind") or "").lower()

        if dataset_kind == "virtual" and dataset_sql:
            return db_id, schema, f"SELECT * FROM ({dataset_sql.rstrip(';')}) AS _vds"

        prefix = f'"{schema}".' if schema else ""
        return db_id, schema, f'SELECT * FROM {prefix}"{table_name}"'

    def _get_dataset_detail_cached(
        self,
        access_token: str,
        dataset_id: int,
        cache: dict[int, dict[str, Any]],
    ) -> dict[str, Any]:
        if dataset_id not in cache:
            cache[dataset_id] = self.client.get_dataset_detail(access_token, dataset_id)
        return cache[dataset_id]

    # -- dashboards ------------------------------------------------------

    def _fetch_all_dashboards(self, access_token: str | None, page_size: int = 1000) -> list[dict]:
        """Fetch all dashboard pages from Superset (auto-pagination)."""
        all_results: list[dict] = []
        page = 0
        while True:
            raw = self.client.list_dashboards(access_token, page=page, page_size=page_size)
            batch = raw.get("result", [])
            all_results.extend(batch)
            total = raw.get("count", len(all_results))
            if len(all_results) >= total or len(batch) < page_size:
                break
            page += 1
        return all_results

    def get_dashboard_summary(
        self,
        access_token: str | None,
        user_id: int | None,
    ) -> list[dict]:
        """Lightweight dashboard list (cached per user)."""
        cache_key = f"dashboards_{user_id}"
        cached = self._cache.get(cache_key)
        if cached and time.time() - cached["ts"] < self.cache_ttl:
            return cached["data"]

        all_raw = self._fetch_all_dashboards(access_token)
        dashboards: list[dict] = []
        for db in all_raw:
            owners = db.get("owners") or []
            dashboards.append(
                {
                    "id": db["id"],
                    "title": db.get("dashboard_title") or "",
                    "slug": db.get("slug") or "",
                    "status": db.get("status") or "published",
                    "url": db.get("url") or "",
                    "changed_on_delta_humanized": db.get("changed_on_delta_humanized") or "",
                    "owners": [
                        (o.get("first_name") or "") + " " + (o.get("last_name") or "")
                        for o in owners
                    ],
                }
            )

        self._cache[cache_key] = {"data": dashboards, "ts": time.time()}
        return dashboards

    def get_dashboard_datasets(
        self,
        access_token: str,
        dashboard_id: int,
    ) -> list[dict]:
        """Return datasets used by a specific dashboard."""
        raw = self.client.get_dashboard_datasets(access_token, dashboard_id)
        datasets: list[dict] = []
        for ds in raw.get("result", []):
            columns = ds.get("columns") or []
            datasets.append(
                {
                    "id": ds.get("id"),
                    "name": ds.get("table_name") or ds.get("name") or "",
                    "schema": ds.get("schema") or "",
                    "database": ((ds.get("database") or {}).get("database_name", "")
                        if isinstance(ds.get("database"), dict)
                        else ds.get("database_name") or "") or "",
                    "description": ds.get("description") or "",
                    "column_count": len(columns),
                    "column_names": [c.get("column_name") or "" for c in columns],
                    "row_count": ds.get("row_count"),
                }
            )
        return datasets

    def get_dashboard_filters(
        self,
        access_token: str,
        dashboard_id: int,
        dataset_id: int | None = None,
    ) -> list[dict]:
        """Return native filter definitions for a dashboard."""
        detail = self.client.get_dashboard_detail(access_token, dashboard_id)
        metadata = self._load_json_blob(detail.get("json_metadata"))
        raw_filters = (
            metadata.get("native_filter_configuration")
            or metadata.get("filter_configuration")
            or []
        )
        if isinstance(raw_filters, str):
            try:
                raw_filters = json.loads(raw_filters)
            except Exception:
                raw_filters = []

        dataset_cache: dict[int, dict[str, Any]] = {}
        filter_defs: list[dict] = []
        seen: set[tuple[str, int, str]] = set()

        is_time_filter_type = lambda ft: any(
            tok in (ft or "").lower() for tok in ("time", "date", "temporal")
        )

        def _extract_default_value(rf: dict) -> Any:
            """Pull the default filter value from Superset's native filter config."""
            dm = rf.get("defaultDataMask") or {}
            fs = dm.get("filterState") or {}
            return fs.get("value")

        for raw_filter in raw_filters:
            if not isinstance(raw_filter, dict):
                continue
            targets = raw_filter.get("targets") or []
            control_values = raw_filter.get("controlValues") or {}
            filter_id = str(raw_filter.get("id") or raw_filter.get("name") or f"filter-{len(filter_defs)}")
            filter_name = raw_filter.get("name") or raw_filter.get("description") or "Unnamed filter"
            filter_type = str(raw_filter.get("filterType") or raw_filter.get("type") or "")
            multi = bool(
                control_values.get("multiSelect")
                or control_values.get("enableMultiple")
                or control_values.get("multi_select")
            )
            required = bool(raw_filter.get("required"))
            time_filter = is_time_filter_type(filter_type)

            if time_filter and dataset_id is not None:
                requested_dataset_id = int(dataset_id)
                dataset_detail = self._get_dataset_detail_cached(access_token, requested_dataset_id, dataset_cache)
                columns = dataset_detail.get("columns") or []
                column_name = ""

                for target in targets:
                    if not isinstance(target, dict):
                        continue
                    target_dataset_id = target.get("datasetId") or target.get("dataset_id")
                    if target_dataset_id and int(target_dataset_id) != requested_dataset_id:
                        continue
                    column_obj = target.get("column") or {}
                    column_name = (
                        column_obj.get("name")
                        or target.get("column_name")
                        or target.get("columnName")
                        or ""
                    )
                    if column_name:
                        break

                if not column_name:
                    main_dttm = (dataset_detail.get("main_dttm_col") or "").strip()
                    if main_dttm:
                        column_name = main_dttm
                    else:
                        for col in columns:
                            if col.get("is_dttm"):
                                column_name = col.get("column_name") or col.get("name") or ""
                                if column_name:
                                    break

                if not column_name:
                    continue

                dedupe_key = (filter_id, requested_dataset_id, column_name)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                column_meta = next(
                    (
                        col for col in columns
                        if (col.get("column_name") or col.get("name") or "") == column_name
                    ),
                    None,
                )
                column_type = self._normalize_column_type(column_meta)
                input_type = self._infer_input_type(filter_type, column_type)
                default_val = _extract_default_value(raw_filter)
                filter_defs.append(
                    {
                        "id": filter_id,
                        "name": filter_name,
                        "filter_type": filter_type or input_type,
                        "input_type": input_type,
                        "dataset_id": requested_dataset_id,
                        "dataset_name": dataset_detail.get("table_name") or "",
                        "column_name": column_name,
                        "column_type": column_type,
                        "multi": multi,
                        "required": required,
                        "supports_search": False,
                        "default_value": default_val,
                    }
                )
                continue

            effective_targets = list(targets)
            if not effective_targets and time_filter and dataset_id is not None:
                effective_targets = [{"datasetId": dataset_id}]

            for target in effective_targets:
                if not isinstance(target, dict):
                    continue
                target_dataset_id = target.get("datasetId") or target.get("dataset_id")
                if not target_dataset_id:
                    continue
                target_dataset_id = int(target_dataset_id)
                if dataset_id is not None and target_dataset_id != dataset_id:
                    continue

                column_obj = target.get("column") or {}
                column_name = (
                    column_obj.get("name")
                    or target.get("column_name")
                    or target.get("columnName")
                    or ""
                )

                dataset_detail = self._get_dataset_detail_cached(access_token, target_dataset_id, dataset_cache)
                columns = dataset_detail.get("columns") or []

                if not column_name and time_filter:
                    main_dttm = (dataset_detail.get("main_dttm_col") or "").strip()
                    if main_dttm:
                        column_name = main_dttm
                    else:
                        for col in columns:
                            if col.get("is_dttm"):
                                column_name = col.get("column_name") or col.get("name") or ""
                                break

                if not column_name:
                    continue

                dedupe_key = (filter_id, target_dataset_id, column_name)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                column_meta = next(
                    (
                        col for col in columns
                        if (col.get("column_name") or col.get("name") or "") == column_name
                    ),
                    None,
                )
                column_type = self._normalize_column_type(column_meta)
                input_type = self._infer_input_type(filter_type, column_type)
                default_val = _extract_default_value(raw_filter)
                filter_defs.append(
                    {
                        "id": filter_id,
                        "name": filter_name,
                        "filter_type": filter_type or input_type,
                        "input_type": input_type,
                        "dataset_id": target_dataset_id,
                        "dataset_name": dataset_detail.get("table_name") or "",
                        "column_name": column_name,
                        "column_type": column_type,
                        "multi": multi,
                        "required": required,
                        "supports_search": input_type == "select",
                        "default_value": default_val,
                    }
                )

        return filter_defs

    def get_filter_options(
        self,
        access_token: str,
        dataset_id: int,
        column_name: str,
        keyword: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Fetch distinct values for a dataset column."""
        detail = self.client.get_dataset_detail(access_token, dataset_id)
        columns = detail.get("columns") or []
        valid_columns = {
            (column.get("column_name") or column.get("name") or ""): column
            for column in columns
        }
        if column_name not in valid_columns:
            raise ValueError(f"Unknown column: {column_name}")

        safe_limit = max(1, min(int(limit), 200))
        safe_offset = max(0, int(offset))
        trimmed_keyword = keyword.strip()

        def _normalize_raw_options(payload: Any) -> list[dict[str, Any]]:
            result = payload.get("result", payload) if isinstance(payload, dict) else payload
            if isinstance(result, dict):
                if isinstance(result.get("values"), list):
                    result = result.get("values")
                elif isinstance(result.get("data"), list):
                    result = result.get("data")
                else:
                    result = [result]

            normalized: list[dict[str, Any]] = []
            if not isinstance(result, list):
                return normalized

            for item in result:
                raw = item
                label = None
                if isinstance(item, dict):
                    if "value" in item:
                        raw = item.get("value")
                        label = item.get("label")
                    elif "label" in item:
                        raw = item.get("label")
                        label = item.get("label")
                    elif column_name in item:
                        raw = item.get(column_name)
                    elif item:
                        raw = next(iter(item.values()))
                elif isinstance(item, (list, tuple)):
                    raw = item[0] if item else None

                if raw is None:
                    continue
                if trimmed_keyword and trimmed_keyword.lower() not in str(raw).lower():
                    continue
                normalized.append({
                    "label": "" if label is None else str(label),
                    "value": raw,
                })

            deduped: list[dict[str, Any]] = []
            seen: set[str] = set()
            for item in normalized:
                key = repr(item["value"])
                if key in seen:
                    continue
                seen.add(key)
                if not item["label"]:
                    item["label"] = str(item["value"])
                deduped.append(item)
            return deduped

        for fetcher in (
            lambda: self.client.get_datasource_column_values(access_token, dataset_id, column_name),
            lambda: self.client.get_dataset_distinct_values(access_token, column_name),
        ):
            try:
                raw_options = _normalize_raw_options(fetcher())
                sliced = raw_options[safe_offset : safe_offset + safe_limit + 1]
                return {
                    "dataset_id": dataset_id,
                    "column_name": column_name,
                    "options": sliced[:safe_limit],
                    "has_more": len(sliced) > safe_limit,
                }
            except Exception:
                logger.debug(
                    "Superset native option endpoint failed for dataset=%s column=%s",
                    dataset_id,
                    column_name,
                    exc_info=True,
                )

        db_id, schema, base_sql = self._build_dataset_sql(detail)
        quoted_column = self._quote_identifier(column_name)

        where_clauses = [f"{quoted_column} IS NOT NULL"]
        if trimmed_keyword:
            where_clauses.append(
                f"CAST({quoted_column} AS VARCHAR) ILIKE {self._sql_literal(f'%{trimmed_keyword}%')}"
            )

        sql = (
            f"SELECT DISTINCT {quoted_column} "
            f"FROM ({base_sql}) AS _src "
            f"WHERE {' AND '.join(where_clauses)} "
            f"ORDER BY 1 "
            f"LIMIT {safe_limit + 1} OFFSET {safe_offset}"
        )
        sql_session = self.client.create_sql_session(access_token)
        result = self.client.execute_sql_with_session(
            sql_session,
            db_id,
            sql,
            schema,
            row_limit=safe_limit + 1,
        )
        rows = result.get("data", []) or []
        has_more = len(rows) > safe_limit
        rows = rows[:safe_limit]

        result_columns = result.get("columns") or []
        col_key = None
        if result_columns:
            col_key = (
                result_columns[0].get("column_name")
                or result_columns[0].get("name")
                or result_columns[0].get("label")
            )
        if not col_key and rows:
            col_key = next(iter(rows[0]), None) if isinstance(rows[0], dict) else None

        options = []
        for row in rows:
            if isinstance(row, dict):
                raw = row.get(col_key) if col_key else next(iter(row.values()), None)
            elif isinstance(row, (list, tuple)):
                raw = row[0] if row else None
            else:
                raw = row
            options.append({
                "label": "" if raw is None else str(raw),
                "value": raw,
            })
        return {
            "dataset_id": dataset_id,
            "column_name": column_name,
            "options": options,
            "has_more": has_more,
        }

    # -- cache management ------------------------------------------------

    def invalidate(self, user_id: int | None = None) -> None:
        if user_id is not None:
            self._cache.pop(f"summary_{user_id}", None)
            self._cache.pop(f"dashboards_{user_id}", None)
        else:
            self._cache.clear()
