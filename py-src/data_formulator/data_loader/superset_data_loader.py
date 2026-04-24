# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SupersetLoader — ExternalDataLoader implementation for Apache Superset.

Treats Superset as a hierarchical data source:
  dashboard (table_group) → dataset (table)

Authentication is JWT-based (``auth_mode() = "token"``).  Data is fetched
via Superset's SQL Lab API.
"""

import json
import logging
import re
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
# SQL building helpers
# ---------------------------------------------------------------------------

def _quote_identifier(name: str) -> str:
    escaped = (name or "").replace('"', '""')
    return f'"{escaped}"'


def _sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def _build_dataset_sql(detail: dict) -> tuple[int, str, str]:
    """Return (database_id, schema, base_select_sql) from a dataset detail."""
    db_id = detail["database"]["id"]
    table_name = detail["table_name"]
    schema = detail.get("schema", "") or ""
    dataset_sql = (detail.get("sql") or "").strip()
    dataset_kind = (detail.get("kind") or "").lower()

    if dataset_kind == "virtual" and dataset_sql:
        return db_id, schema, f"SELECT * FROM ({dataset_sql.rstrip(';')}) AS _vds"

    prefix = f'"{schema}".' if schema else ""
    return db_id, schema, f'SELECT * FROM {prefix}"{table_name}"'


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
        return {"login_url": login_url, "label": "Login via Superset"}

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "dashboard", "label": "Dashboard"},
            {"key": "dataset", "label": "Dataset"},
        ]

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.url = (params.get("url") or "").rstrip("/")
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
            return {
                "dataset_id": ds["id"],
                "row_count": ds.get("row_count"),
                "schema": ds.get("schema", ""),
                "database": (ds.get("database") or {}).get("database_name", ""),
            }

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


    @staticmethod
    def _build_source_filter_clauses(source_filters: list[dict] | None) -> list[str]:
        """Convert source_filters from import_options into SQL WHERE clause fragments.

        Each filter has: column, operator, value.
        Uses safe quoting — column names are double-quoted, string values are escaped.
        """
        if not source_filters:
            return []

        # Valid operators (prevents SQL injection via operator field)
        valid_ops = frozenset({
            "EQ", "NEQ", "GT", "GTE", "LT", "LTE",
            "IN", "NOT_IN", "LIKE", "ILIKE",
            "IS_NULL", "IS_NOT_NULL",
            "BETWEEN",
        })

        clauses: list[str] = []
        for sf in source_filters:
            if not isinstance(sf, dict):
                continue
            col = sf.get("column")
            op = (sf.get("operator") or "").upper()
            value = sf.get("value")

            if not col or op not in valid_ops:
                continue

            qcol = _quote_identifier(col)

            if op == "IS_NULL":
                clauses.append(f"{qcol} IS NULL")
            elif op == "IS_NOT_NULL":
                clauses.append(f"{qcol} IS NOT NULL")
            elif op in ("IN", "NOT_IN"):
                if not isinstance(value, list) or len(value) == 0:
                    continue
                literals = ", ".join(_sql_literal(v) for v in value)
                sql_op = "IN" if op == "IN" else "NOT IN"
                clauses.append(f"{qcol} {sql_op} ({literals})")
            elif op == "BETWEEN":
                if not isinstance(value, list) or len(value) != 2:
                    continue
                clauses.append(f"{qcol} BETWEEN {_sql_literal(value[0])} AND {_sql_literal(value[1])}")
            else:
                sql_ops = {
                    "EQ": "=", "NEQ": "!=", "GT": ">", "GTE": ">=",
                    "LT": "<", "LTE": "<=", "LIKE": "LIKE", "ILIKE": "ILIKE",
                }
                clauses.append(f"{qcol} {sql_ops[op]} {_sql_literal(value)}")

        return clauses

    # -- get_metadata ------------------------------------------------------

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
                {"name": c.get("column_name", ""), "type": c.get("type", "")}
                for c in (detail.get("columns") or [])
            ]
            return {
                "dataset_id": dataset_id,
                "row_count": detail.get("row_count"),
                "columns": columns,
                "schema": detail.get("schema", ""),
                "database": (detail.get("database") or {}).get("database_name", ""),
                "description": detail.get("description", ""),
            }
        except Exception as e:
            logger.warning("get_metadata failed for dataset %s: %s", dataset_id, e)
            return {}

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

        try:
            detail = self._client.get_dataset_detail(token, dataset_id)
            db_id, schema, base_sql = _build_dataset_sql(detail)
            qcol = _quote_identifier(column_name)
            where_parts = [f"{qcol} IS NOT NULL"]
            if trimmed:
                where_parts.append(
                    f"CAST({qcol} AS VARCHAR) ILIKE {_sql_literal(f'%{trimmed}%')}"
                )
            sql = (
                f"SELECT DISTINCT {qcol} FROM ({base_sql}) AS _src "
                f"WHERE {' AND '.join(where_parts)} "
                f"ORDER BY 1 LIMIT {safe_limit + 1} OFFSET {safe_offset}"
            )
            session = self._client.create_sql_session(token)
            result = self._client.execute_sql_with_session(
                session, db_id, sql, schema, row_limit=safe_limit + 1,
            )
            rows = result.get("data", []) or []
            has_more = len(rows) > safe_limit
            rows = rows[:safe_limit]

            cols = result.get("columns") or []
            col_key = (cols[0].get("column_name") or cols[0].get("name") or cols[0].get("label")) if cols else None
            if not col_key and rows and isinstance(rows[0], dict):
                col_key = next(iter(rows[0]), None)

            options = []
            for row in rows:
                raw = row.get(col_key) if isinstance(row, dict) and col_key else row
                options.append({"label": str(raw) if raw is not None else "", "value": raw})
            return {"options": options, "has_more": has_more}
        except Exception:
            logger.warning("SQL fallback for column values failed dataset=%s column=%s", dataset_id, column_name, exc_info=True)
            return {"options": [], "has_more": False}

    # -- fetch_data_as_arrow -----------------------------------------------

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Fetch dataset data via Superset's SQL Lab API.

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
        detail = self._client.get_dataset_detail(token, dataset_id)
        db_id, schema, base_sql = _build_dataset_sql(detail)

        # Build WHERE clauses from source_filters
        where_clauses = self._build_source_filter_clauses(opts.get("source_filters"))

        # Build SQL
        if where_clauses:
            full_sql = f"SELECT * FROM ({base_sql}) AS _src WHERE {' AND '.join(where_clauses)} LIMIT {size}"
        else:
            full_sql = f"SELECT * FROM ({base_sql}) AS _src LIMIT {size}"

        # Execute via SQL Lab
        sql_session = self._client.create_sql_session(token)
        result = self._client.execute_sql_with_session(
            sql_session, db_id, full_sql, schema, size,
        )

        rows = result.get("data", []) or []
        if not rows:
            return pa.table({})

        # Convert list-of-dicts to Arrow table
        columns = list(rows[0].keys())
        col_data = {col: [row.get(col) for row in rows] for col in columns}
        return pa.table(col_data)

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
