# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SupersetLoader — ExternalDataLoader implementation for Apache Superset.

Treats Superset as a hierarchical data source:
  dashboard (table_group) → dataset (table)

Authentication is JWT-based (``auth_mode() = "token"``).  Data is fetched
via Superset's Chart Data API (``POST /api/v1/chart/data``), which only
requires ``datasource access`` permission and automatically applies
Row-Level Security (RLS).
"""

import json
import logging
from typing import Any

import pyarrow as pa

from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
)
from data_formulator.data_loader.superset_client import SupersetClient
from data_formulator.data_loader.superset_auth_bridge import SupersetAuthBridge

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# SupersetLoader
# ---------------------------------------------------------------------------

class SupersetLoader(ExternalDataLoader):
    """Treats a Superset instance as a hierarchical data source.

    Hierarchy: ``dashboard`` (namespace) → ``dataset`` (table).
    Datasets not attached to any dashboard appear under a synthetic
    "All Datasets" namespace at the root level.
    """

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "url", "type": "string", "required": True,
             "tier": "connection",
             "description": "Superset base URL (e.g. https://bi.company.com)"},
            {"name": "username", "type": "string", "required": False,
             "tier": "auth",
             "description": "Superset username (optional if using SSO)"},
            {"name": "password", "type": "password", "required": False, "sensitive": True,
             "tier": "auth",
             "description": "Superset password (optional if using SSO)"},
        ]

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** url: `https://bi.company.com` · username: `admin` · password: `***`

**Setup:** Provide the base URL of your Superset instance and credentials for a user with at least **Gamma** role (read access to datasets).

**SSO:** If your Superset uses SSO, use the SSO bridge flow instead of password auth (configure via `PLG_SUPERSET_SSO_LOGIN_URL`)."""

    @staticmethod
    def auth_mode() -> str:
        return "token"

    @staticmethod
    def auth_config() -> dict:
        import os
        url = os.environ.get("PLG_SUPERSET_URL", "").rstrip("/")
        login_url = os.environ.get(
            "PLG_SUPERSET_SSO_LOGIN_URL",
            f"{url}/df-sso-bridge/" if url else "",
        )
        return {
            "mode": "sso_exchange",
            "display_name": "Superset",
            "exchange_url": f"{url}/api/v1/df-token-exchange/" if url else "",
            "login_url": login_url,
            "supports_refresh": True,
        }

    @staticmethod
    def delegated_login_config() -> dict[str, Any] | None:
        """Return popup-based login config if PLG_SUPERSET_URL is set."""
        import os
        superset_url = os.environ.get("PLG_SUPERSET_URL", "")
        if not superset_url:
            return None
        login_url = os.environ.get(
            "PLG_SUPERSET_SSO_LOGIN_URL",
            f"{superset_url.rstrip('/')}/df-sso-bridge/",
        )
        return {"login_url": login_url}

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "dashboard", "label": "Dashboard"},
            {"key": "dataset", "label": "Dataset"},
        ]

    def __init__(self, params: dict[str, Any]):
        import os
        self.params = params

        self.url = (
            params.get("url")
            or os.environ.get("PLG_SUPERSET_URL", "")
        ).strip().rstrip("/")
        if self.url and not self.url.startswith(("http://", "https://")):
            self.url = f"http://{self.url}"
        self.username = params.get("username", "")
        self.password = params.get("password", "")

        if not self.url:
            raise ValueError("Superset URL is required")

        self._client = SupersetClient(self.url)
        self._bridge = SupersetAuthBridge(self.url)

        # Authenticate immediately — priority order:
        # 1. Explicit Superset access_token (from SSO bridge popup or vault)
        # 2. SSO token exchange (shared IdP, requires TokenExchangeView on Superset)
        # 3. Username/password → Superset login API
        self._access_token: str | None = params.get("access_token")
        self._refresh_token: str | None = params.get("refresh_token")
        if self._access_token:
            return
        sso_token = params.get("sso_access_token")
        if sso_token:
            self._try_sso_exchange(sso_token)
            if self._access_token:
                return
        if self.username and self.password:
            self._do_login()
        elif not self._access_token:
            raise ValueError("Superset requires either username/password or an SSO access token")

    def _do_login(self) -> None:
        result = self._bridge.login(self.username, self.password)
        self._access_token = result.get("access_token")
        self._refresh_token = result.get("refresh_token")
        if not self._access_token:
            raise ValueError("Superset login failed: no access token returned")

    def _try_sso_exchange(self, sso_token: str) -> None:
        """Best-effort SSO token exchange — silently ignored on failure."""
        try:
            result = self._bridge.exchange_sso_token(sso_token)
            self._access_token = result.get("access_token")
            self._refresh_token = result.get("refresh_token")
            if self._access_token:
                logger.info("SSO token exchange succeeded for Superset")
        except Exception:
            logger.debug("SSO token exchange not available", exc_info=True)

    @staticmethod
    def _is_token_expired(token: str, buffer_seconds: int = 60) -> bool:
        """Check JWT exp claim without hitting Superset API."""
        import base64
        import time
        try:
            payload = token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload))
            return time.time() > claims.get("exp", 0) - buffer_seconds
        except Exception:
            return True  # conservative: assume expired

    def _ensure_token(self) -> str:
        """Return a valid access token, refreshing if needed.

        Uses JWT exp claim to detect expiry (no API call).
        Tries refresh token first, then full re-login with password.
        SSO tokens that expire without a refresh token will raise.
        """
        if not self._access_token:
            raise ValueError("Not authenticated with Superset")

        if not self._is_token_expired(self._access_token):
            return self._access_token

        # Token expired — try refresh
        if self._refresh_token:
            try:
                result = self._bridge.refresh_token(self._refresh_token)
                new_token = result.get("access_token")
                if new_token:
                    self._access_token = new_token
                    return self._access_token
            except Exception:
                logger.debug("Token refresh failed", exc_info=True)

        # Refresh failed or unavailable — try password re-login
        if self.username and self.password:
            self._do_login()
            return self._access_token

        raise ValueError("Superset token expired and cannot refresh (no password or refresh token available)")

    # -- test_connection ---------------------------------------------------

    def test_connection(self) -> bool:
        try:
            token = self._ensure_token()
            # Try a lightweight API call — list datasets with page_size=1
            result = self._client.list_datasets(token, page=0, page_size=1)
            return "result" in result
        except Exception:
            return False

    # -- sync_catalog_metadata (full metadata sync) -------------------------

    def sync_catalog_metadata(
        self, table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """Enrich list_tables with per-dataset column details.

        Uses ``/api/v1/dataset/{pk}/column`` (faster than full detail
        endpoint).  UUID and description already come from ``list_datasets()``
        default response.
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        tables = self.list_tables(table_filter)
        token = self._ensure_token()

        for t in tables:
            meta = t.get("metadata") or {}
            ds_uuid = meta.get("uuid")
            if ds_uuid:
                t["table_key"] = ds_uuid
            else:
                t.setdefault("table_key", meta.get("_source_name") or t.get("name", ""))

        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {}
            for t in tables:
                ds_id = (t.get("metadata") or {}).get("dataset_id")
                if ds_id:
                    futures[pool.submit(
                        self._client.get_dataset_columns, token, ds_id,
                    )] = t

            for future in as_completed(futures, timeout=120):
                table_entry = futures[future]
                try:
                    columns_raw = future.result()
                    if columns_raw:
                        columns = [
                            self._build_column_entry(c) for c in columns_raw
                        ]
                        table_entry.setdefault("metadata", {})["columns"] = columns
                        table_entry["metadata"]["source_metadata_status"] = "synced"
                    else:
                        meta = table_entry.setdefault("metadata", {})
                        meta["columns"] = []
                        meta["source_metadata_status"] = "partial"
                except Exception:
                    logger.warning(
                        "Column fetch failed for dataset %s",
                        (table_entry.get("metadata") or {}).get("dataset_id"),
                        exc_info=True,
                    )
                    table_entry.setdefault("metadata", {})["source_metadata_status"] = "unavailable"

        self.ensure_table_keys(tables)
        return tables

    # -- list_tables (lightweight, for catalog tree building) ----------------

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List datasets grouped under dashboards **and** under "All Datasets".

        Returns only lightweight metadata (id, name, row_count, schema,
        database).  Column definitions and sample rows are fetched lazily
        via ``preview-data`` when the user clicks a specific dataset.
        """
        token = self._ensure_token()

        all_datasets = self._fetch_all_datasets(token)
        ds_by_id: dict[int, dict] = {ds["id"]: ds for ds in all_datasets}

        def _make_lightweight_meta(ds: dict) -> dict:
            meta: dict[str, Any] = {
                "dataset_id": ds["id"],
                "row_count": ds.get("row_count"),
                "schema": ds.get("schema", ""),
                "database": (ds.get("database") or {}).get("database_name", ""),
            }
            if ds.get("uuid"):
                meta["uuid"] = ds["uuid"]
            desc = (ds.get("description") or "").strip()
            if desc:
                meta["description"] = desc
            return meta

        def _make_entry(ds: dict, folder: str, ds_name: str) -> dict:
            return {
                "name": f"{ds['id']}:{ds_name}",
                "path": [folder, ds_name],
                "metadata": _make_lightweight_meta(ds),
            }

        results: list[dict[str, Any]] = []

        # Walk dashboards → datasets
        raw = self._client.list_dashboards(token, page=0, page_size=500)
        dashboards = raw.get("result", [])
        for dash in dashboards:
            dash_title = dash.get("dashboard_title", f"Dashboard {dash['id']}")
            try:
                ds_raw = self._client.get_dashboard_datasets(token, dash["id"])
                dash_datasets = ds_raw.get("result", [])
            except Exception:
                logger.debug("Failed to fetch datasets for dashboard %s", dash.get("id"))
                continue

            for ds in dash_datasets:
                ds_name = ds.get("table_name") or ds.get("name") or f"dataset_{ds.get('id', '?')}"
                if table_filter and table_filter.lower() not in ds_name.lower():
                    continue
                full_ds = ds_by_id.get(ds["id"], ds)
                results.append(_make_entry(full_ds, dash_title, ds_name))

        # All datasets under "All Datasets"
        for ds in all_datasets:
            ds_name = ds.get("table_name") or ""
            if table_filter and table_filter.lower() not in ds_name.lower():
                continue
            results.append(_make_entry(ds, "All Datasets", ds_name))

        return results

    def search_catalog(self, query: str, limit: int = 100) -> dict:
        """Search Superset datasets and dashboards as a lightweight tree."""
        text = (query or "").strip()
        if not text:
            return {"tree": [], "truncated": False}

        token = self._ensure_token()
        needle = text.lower()
        max_results = max(1, int(limit or 100))
        tree: list[dict] = []
        result_count = 0
        truncated = False

        def _dataset_name(ds: dict) -> str:
            return ds.get("table_name") or ds.get("name") or f"dataset_{ds.get('id', '?')}"

        def _dataset_meta(ds: dict) -> dict:
            return {
                "dataset_id": ds["id"],
                "row_count": ds.get("row_count"),
                "schema": ds.get("schema", ""),
                "database": (ds.get("database") or {}).get("database_name", ""),
            }

        all_datasets = self._fetch_all_datasets(token)
        dataset_children: list[dict] = []
        for ds in all_datasets:
            ds_name = _dataset_name(ds)
            if needle not in ds_name.lower():
                continue
            if result_count >= max_results:
                truncated = True
                break
            dataset_children.append({
                "name": ds_name,
                "node_type": "table",
                "path": ["__all__", str(ds["id"])],
                "metadata": _dataset_meta(ds),
            })
            result_count += 1

        if dataset_children:
            tree.append({
                "name": "All Datasets",
                "node_type": "namespace",
                "path": ["__all__"],
                "metadata": None,
                "children": dataset_children,
            })

        raw_dashboards = self._client.list_dashboards(token, page=0, page_size=500)
        for dash in raw_dashboards.get("result", []):
            dash_title = dash.get("dashboard_title", f"Dashboard {dash['id']}")
            if needle not in dash_title.lower():
                continue
            if result_count >= max_results:
                truncated = True
                break
            dash_id = dash["id"]
            tables = self._build_dashboard_group_metadata(token, dash_id)
            tree.append({
                "name": dash_title,
                "node_type": "table_group",
                "path": [str(dash_id)],
                "metadata": {
                    "dashboard_id": dash_id,
                    "tables": tables,
                },
                "children": [
                    {
                        "name": tbl["name"],
                        "node_type": "table",
                        "path": [str(dash_id), str(tbl["dataset_id"])],
                        "metadata": {
                            "dataset_id": tbl["dataset_id"],
                            "row_count": tbl.get("row_count"),
                            "parent_group": str(dash_id),
                        },
                    }
                    for tbl in tables
                ],
            })
            result_count += 1

        return {"tree": tree, "truncated": truncated}

    # -- ls (lazy/hierarchical) --------------------------------------------

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        token = self._ensure_token()

        if len(path) == 0:
            # Root: list dashboards as table_group nodes + "All Datasets" namespace
            raw = self._client.list_dashboards(token, page=0, page_size=500)
            dashboards = raw.get("result", [])
            nodes = []
            for d in dashboards:
                title = d.get("dashboard_title", f"Dashboard {d['id']}")
                if filter and filter.lower() not in title.lower():
                    continue
                dash_id = d["id"]
                tables = self._build_dashboard_group_metadata(token, dash_id)
                nodes.append(CatalogNode(
                    name=title,
                    node_type="table_group",
                    path=[str(dash_id)],
                    metadata={
                        "dashboard_id": dash_id,
                        "tables": tables,
                    },
                ))
            # Add synthetic "All Datasets" entry (namespace, not table_group)
            if not filter or "all datasets" in (filter or "").lower():
                nodes.append(CatalogNode(
                    name="All Datasets",
                    node_type="namespace",
                    path=["__all__"],
                ))
            return nodes

        if len(path) == 1:
            # Expand "All Datasets" namespace (dashboards are table_group leaves, no children)
            parent_id = path[0]
            if parent_id == "__all__":
                datasets = self._fetch_all_datasets(token)
            else:
                # Should not normally be called for dashboards (they're table_group leaves),
                # but support it for backwards compatibility
                try:
                    raw = self._client.get_dashboard_datasets(token, int(parent_id))
                    datasets = raw.get("result", [])
                except Exception:
                    datasets = []

            nodes = []
            for ds in datasets:
                name = ds.get("table_name") or ds.get("name") or f"dataset_{ds.get('id', '?')}"
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=name,
                    node_type="table",
                    path=[parent_id, str(ds["id"])],
                    metadata={
                        "dataset_id": ds["id"],
                        "row_count": ds.get("row_count"),
                        "schema": ds.get("schema", ""),
                        "database": (ds.get("database") or {}).get("database_name", ""),
                    },
                ))
            return nodes

        return []

    def _build_dashboard_group_metadata(
        self, token: str, dashboard_id: int,
    ) -> list[dict]:
        """Build tables list for a dashboard table_group node.

        Returns tables only.  Filters are fetched lazily via
        ``get_dashboard_filters()`` when the user actually clicks a dashboard.

        This is a **lightweight** call: it fetches only dataset names and IDs
        from the dashboard endpoint, NOT per-dataset detail or SQL queries.
        """
        try:
            ds_raw = self._client.get_dashboard_datasets(token, dashboard_id)
            datasets = ds_raw.get("result", [])
        except Exception:
            logger.debug("Failed to fetch datasets for dashboard %s", dashboard_id)
            return []

        tables = []
        for ds in datasets:
            ds_id = ds["id"]
            name = ds.get("table_name") or ds.get("name") or f"dataset_{ds_id}"
            tables.append({
                "name": name,
                "dataset_id": ds_id,
                "row_count": ds.get("row_count"),
            })

        return tables


    # -- Chart Data API query builders ------------------------------------

    @staticmethod
    def _build_chart_data_filters(
        source_filters: list[dict] | None,
    ) -> list[dict]:
        """Convert *source_filters* to Chart Data API ``filters`` format.

        Returns a list of ``{"col": ..., "op": ..., "val": ...}`` dicts
        understood by ``POST /api/v1/chart/data``.  BETWEEN is split into
        two conditions (``>=`` + ``<=``) since Chart Data API has no native
        BETWEEN operator.
        """
        if not source_filters:
            return []

        valid_ops = frozenset({
            "EQ", "NEQ", "GT", "GTE", "LT", "LTE",
            "IN", "NOT_IN", "LIKE", "ILIKE",
            "IS_NULL", "IS_NOT_NULL",
            "BETWEEN",
        })

        op_map = {
            "EQ": "==", "NEQ": "!=",
            "GT": ">", "GTE": ">=", "LT": "<", "LTE": "<=",
            "IN": "IN", "NOT_IN": "NOT IN",
            "LIKE": "LIKE", "ILIKE": "ILIKE",
            "IS_NULL": "IS NULL", "IS_NOT_NULL": "IS NOT NULL",
        }

        filters: list[dict] = []
        for sf in source_filters:
            if not isinstance(sf, dict):
                continue
            col = sf.get("column")
            op = (sf.get("operator") or "").upper()
            value = sf.get("value")

            if not col or op not in valid_ops:
                continue

            if op in ("IS_NULL", "IS_NOT_NULL"):
                filters.append({"col": col, "op": op_map[op], "val": None})
            elif op in ("IN", "NOT_IN"):
                if not isinstance(value, list) or len(value) == 0:
                    continue
                filters.append({"col": col, "op": op_map[op], "val": value})
            elif op == "BETWEEN":
                if not isinstance(value, list) or len(value) != 2:
                    continue
                filters.append({"col": col, "op": ">=", "val": value[0]})
                filters.append({"col": col, "op": "<=", "val": value[1]})
            else:
                filters.append({"col": col, "op": op_map[op], "val": value})

        return filters

    @staticmethod
    def _build_chart_data_orderby(
        sort_columns: list[str] | None,
        sort_order: str | None = "asc",
    ) -> list[list]:
        """Convert sort settings to Chart Data API ``orderby`` format.

        Returns ``[["col_name", is_ascending], ...]``.
        """
        if not isinstance(sort_columns, list) or not sort_columns:
            return []

        is_asc = str(sort_order).lower() != "desc"
        result: list[list] = []
        for col in sort_columns:
            if not isinstance(col, str):
                continue
            col_name = col.strip()
            if not col_name:
                continue
            result.append([col_name, is_asc])

        return result

    # -- get_metadata / get_column_types ------------------------------------

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path or len(path) < 2:
            return {}
        dataset_id_str = path[-1]
        try:
            dataset_id = int(dataset_id_str)
        except ValueError:
            return {}
        token = self._ensure_token()
        try:
            detail = self._client.get_dataset_detail(token, dataset_id)
            columns = [
                self._build_column_entry(c) for c in (detail.get("columns") or [])
            ]
            result: dict[str, Any] = {
                "dataset_id": dataset_id,
                "row_count": detail.get("row_count"),
                "columns": columns,
                "schema": detail.get("schema", ""),
                "database": (detail.get("database") or {}).get("database_name", ""),
            }
            dataset_desc = (detail.get("description") or "").strip()
            if dataset_desc:
                result["description"] = dataset_desc
            return result
        except Exception as e:
            logger.warning("get_metadata failed for dataset %s: %s", dataset_id, e)
            return {}

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        """Return source-level column types from Superset dataset detail.

        Includes ``is_dttm`` flag which reliably identifies temporal columns
        regardless of the raw type string, and ``description`` from the
        column's ``verbose_name`` or ``description`` field when available.
        """
        try:
            dataset_id = int(source_table)
        except (ValueError, TypeError):
            return {}
        token = self._ensure_token()
        try:
            detail = self._client.get_dataset_detail(token, dataset_id)
            columns = [
                self._build_column_entry(c) for c in (detail.get("columns") or [])
            ]
            result: dict[str, Any] = {"columns": columns}
            dataset_desc = (detail.get("description") or "").strip()
            if dataset_desc:
                result["description"] = dataset_desc
            return result
        except Exception as e:
            logger.warning("get_column_types failed for dataset %s: %s", source_table, e)
            return {}

    @classmethod
    def _build_column_entry(cls, c: dict[str, Any]) -> dict[str, Any]:
        """Build a standardised column metadata dict from a Superset column record.

        Extracts ``verbose_name``, ``description``, and ``expression``
        when available.  ``description`` falls back to ``verbose_name``
        so consumers that only read ``description`` still get useful text.
        """
        entry: dict[str, Any] = {
            "name": c.get("column_name", ""),
            "type": cls._normalize_column_type(c),
            "is_dttm": bool(c.get("is_dttm")),
        }
        verbose = (c.get("verbose_name") or "").strip()
        desc = (c.get("description") or "").strip()
        entry["description"] = verbose or desc or None
        if verbose:
            entry["verbose_name"] = verbose
        expr = (c.get("expression") or "").strip()
        if expr:
            entry["expression"] = expr
        return entry

    @staticmethod
    def _normalize_column_type(column: dict[str, Any] | None) -> str:
        """Normalize Superset column metadata to a standard type category.

        Uses ``is_dttm``, ``type_generic``, and raw ``type`` to classify
        into TEMPORAL / NUMERIC / BOOLEAN / STRING.
        """
        if not column:
            return "STRING"
        raw = str(
            column.get("type_generic")
            or column.get("type")
            or column.get("python_date_format")
            or ""
        ).upper()
        if column.get("is_dttm"):
            return "TEMPORAL"
        if any(t in raw for t in ("DATE", "TIME", "TEMPORAL", "TIMESTAMP")):
            return "TEMPORAL"
        if any(t in raw for t in ("INT", "FLOAT", "DOUBLE", "NUMERIC", "DECIMAL", "BIGINT", "NUMBER")):
            return "NUMERIC"
        if "BOOL" in raw:
            return "BOOLEAN"
        return "STRING"

    # -- get_column_values (smart filter support) ----------------------------

    def get_column_values(
        self,
        source_table: str,
        column_name: str,
        keyword: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Return distinct values for *column_name* in a Superset dataset.

        Uses a three-tier fallback strategy (same as 0.6):
        1. ``/api/v1/datasource/table/{id}/column/{col}/values/``
        2. ``/api/v1/dataset/distinct/{col}``
        3. SQL ``SELECT DISTINCT`` via SQL Lab
        """
        try:
            dataset_id = int(source_table)
        except (ValueError, TypeError):
            return {"options": [], "has_more": False}

        token = self._ensure_token()
        safe_limit = max(1, min(int(limit), 200))
        safe_offset = max(0, int(offset))
        trimmed = keyword.strip()

        def _normalize(payload: Any) -> list[dict[str, Any]]:
            result = payload.get("result", payload) if isinstance(payload, dict) else payload
            if isinstance(result, dict):
                result = result.get("values", result.get("data", [result]))
            if not isinstance(result, list):
                return []
            out: list[dict[str, Any]] = []
            seen: set[str] = set()
            for item in result:
                raw, label = item, None
                if isinstance(item, dict):
                    raw = item.get("value", item.get("label", next(iter(item.values()), None)))
                    label = item.get("label")
                elif isinstance(item, (list, tuple)):
                    raw = item[0] if item else None
                if raw is None:
                    continue
                if trimmed and trimmed.lower() not in str(raw).lower():
                    continue
                key = repr(raw)
                if key in seen:
                    continue
                seen.add(key)
                out.append({"label": str(label) if label else str(raw), "value": raw})
            return out

        for fetcher in (
            lambda: self._client.get_datasource_column_values(token, dataset_id, column_name),
            lambda: self._client.get_dataset_distinct_values(token, column_name),
        ):
            try:
                options = _normalize(fetcher())
                sliced = options[safe_offset: safe_offset + safe_limit + 1]
                return {
                    "options": [{"label": o["label"], "value": o["value"]} for o in sliced[:safe_limit]],
                    "has_more": len(sliced) > safe_limit,
                }
            except Exception:
                logger.debug(
                    "Native option endpoint failed for dataset=%s column=%s",
                    dataset_id, column_name, exc_info=True,
                )

        # Tier 3: Chart Data API with columns aggregation (GROUP BY = DISTINCT)
        try:
            query: dict[str, Any] = {
                "columns": [column_name],
                "filters": [
                    {"col": column_name, "op": "IS NOT NULL", "val": None},
                ],
                "orderby": [[column_name, True]],
                "row_limit": safe_limit + 1,
                "row_offset": safe_offset,
            }
            if trimmed:
                query["filters"].append(
                    {"col": column_name, "op": "ILIKE", "val": f"%{trimmed}%"}
                )
            result = self._client.post_chart_data(token, dataset_id, [query])

            queries_result = result.get("result", [])
            rows = queries_result[0].get("data", []) if queries_result else []
            has_more = len(rows) > safe_limit
            rows = rows[:safe_limit]

            col_key = column_name
            if rows and isinstance(rows[0], dict) and column_name not in rows[0]:
                col_key = next(iter(rows[0]), column_name)

            options = []
            for row in rows:
                raw = row.get(col_key) if isinstance(row, dict) else row
                options.append({"label": str(raw) if raw is not None else "", "value": raw})
            return {"options": options, "has_more": has_more}
        except Exception:
            logger.warning(
                "Chart Data API fallback for column values failed dataset=%s column=%s",
                dataset_id, column_name, exc_info=True,
            )
            return {"options": [], "has_more": False}

    # -- fetch_data_as_arrow -----------------------------------------------

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Fetch dataset data via Superset's Chart Data API.

        Uses ``POST /api/v1/chart/data`` with ``result_type=samples``
        which only requires ``datasource access`` permission (no SQL Lab
        permission needed) and automatically applies Row-Level Security.

        ``source_table`` must be a numeric dataset ID as a string, e.g. ``"42"``.
        """
        opts = import_options or {}
        size = opts.get("size", 100_000)

        try:
            dataset_id = int(source_table)
        except (ValueError, TypeError):
            raise ValueError(
                f"source_table must be a numeric dataset ID (got: {source_table!r})"
            )

        token = self._ensure_token()

        query: dict[str, Any] = {
            "row_limit": size,
            "result_type": "samples",
        }

        filters = self._build_chart_data_filters(opts.get("source_filters"))
        if filters:
            query["filters"] = filters

        orderby = self._build_chart_data_orderby(
            opts.get("sort_columns"), opts.get("sort_order", "asc"),
        )
        if orderby:
            query["orderby"] = orderby

        logger.info(
            "Superset Chart Data API: dataset_id=%s query=%s",
            dataset_id, query,
        )
        result = self._client.post_chart_data(token, dataset_id, [query])

        queries_result = result.get("result", [])
        if not queries_result:
            return self._empty_arrow_table(token, dataset_id)

        query_result = queries_result[0]
        rows = query_result.get("data", []) or []
        logger.info(
            "Superset Chart Data result: dataset_id=%s rows=%d",
            dataset_id, len(rows),
        )

        if not rows:
            col_names = query_result.get("colnames") or []
            if not col_names:
                return self._empty_arrow_table(token, dataset_id)
            return pa.table(
                {name: pa.array([], type=pa.string()) for name in col_names}
            )

        columns = list(rows[0].keys())
        col_data = {col: [row.get(col) for row in rows] for col in columns}
        return pa.table(col_data)

    def _empty_arrow_table(self, token: str, dataset_id: int) -> pa.Table:
        """Build a 0-row Arrow table preserving column names from metadata."""
        try:
            detail = self._client.get_dataset_detail(token, dataset_id)
            col_names = [
                c.get("column_name", "")
                for c in (detail.get("columns") or [])
                if c.get("column_name")
            ]
            if col_names:
                return pa.table(
                    {name: pa.array([], type=pa.string()) for name in col_names}
                )
        except Exception:
            logger.debug("Failed to fetch column names for empty table", exc_info=True)
        return pa.table({})

    # -- list_tables_tree (override) ----------------------------------------

    def list_tables_tree(self, table_filter: str | None = None) -> dict:
        """Build a **lightweight** catalog tree (names + basic metadata only).

        No per-dataset detail/SQL queries at this stage — column lists and
        sample rows are fetched on demand via ``get-catalog`` with a path
        or ``preview-data``.

        Dashboard (table_group) nodes include child dataset nodes so the
        frontend can render them as expandable tree items.
        """
        root_nodes = self.ls(path=[], filter=table_filter)
        tree: list[dict] = []

        for node in root_nodes:
            d = {
                "name": node.name,
                "node_type": node.node_type,
                "path": node.path,
                "metadata": node.metadata,
            }
            if node.node_type == "namespace":
                child_nodes = self.ls(path=node.path, filter=table_filter)
                d["children"] = [
                    {
                        "name": cn.name,
                        "node_type": cn.node_type,
                        "path": cn.path,
                        "metadata": cn.metadata,
                    }
                    for cn in child_nodes
                ]
            elif node.node_type == "table_group":
                tables = (node.metadata or {}).get("tables", [])
                d["children"] = [
                    {
                        "name": tbl["name"],
                        "node_type": "table",
                        "path": node.path + [str(tbl["dataset_id"])],
                        "metadata": {
                            "dataset_id": tbl["dataset_id"],
                            "row_count": tbl.get("row_count"),
                            "parent_group": node.path[0] if node.path else None,
                        },
                    }
                    for tbl in tables
                ]
            else:
                d["children"] = []
            tree.append(d)

        return {
            "hierarchy": self.catalog_hierarchy(),
            "effective_hierarchy": self.effective_hierarchy(),
            "tree": tree,
        }

    # -- helpers -----------------------------------------------------------

    def _fetch_all_datasets(self, token: str) -> list[dict]:
        """Paginate through all datasets."""
        all_results: list[dict] = []
        page = 0
        page_size = 100
        while True:
            raw = self._client.list_datasets(token, page=page, page_size=page_size)
            batch = raw.get("result", [])
            all_results.extend(batch)
            total = raw.get("count", len(all_results))
            if len(all_results) >= total or len(batch) < page_size:
                break
            page += 1
        return all_results
