# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SupersetLoader — ExternalDataLoader implementation for Apache Superset.

Treats Superset as a hierarchical data source:
  dashboard (namespace) → dataset (table)

Authentication is JWT-based (``auth_mode() = "token"``).  Data is fetched
via Superset's SQL Lab API, reusing the existing ``SupersetClient`` and
``SupersetAuthBridge`` from the legacy plugin.
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

logger = logging.getLogger(__name__)

# Lazy-imported Superset helpers (only if the plugin deps are available)
_SupersetClient = None
_SupersetAuthBridge = None


def _ensure_imports():
    global _SupersetClient, _SupersetAuthBridge
    if _SupersetClient is None:
        from data_formulator.plugins.superset.superset_client import SupersetClient
        from data_formulator.plugins.superset.auth_bridge import SupersetAuthBridge
        _SupersetClient = SupersetClient
        _SupersetAuthBridge = SupersetAuthBridge


# ---------------------------------------------------------------------------
# SQL building helpers (extracted from plugins/superset/routes/data.py)
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
        _ensure_imports()
        self.params = params

        self.url = (params.get("url") or "").rstrip("/")
        if self.url and not self.url.startswith(("http://", "https://")):
            self.url = f"http://{self.url}"
        self.username = params.get("username", "")
        self.password = params.get("password", "")

        if not self.url:
            raise ValueError("Superset URL is required")

        self._client = _SupersetClient(self.url)
        self._bridge = _SupersetAuthBridge(self.url)

        # Authenticate immediately
        self._access_token: str | None = params.get("access_token")
        self._refresh_token: str | None = params.get("refresh_token")
        if not self._access_token and self.username and self.password:
            self._do_login()
        elif not self._access_token:
            raise ValueError("Superset requires either username/password or an SSO access token")

    def _do_login(self) -> None:
        result = self._bridge.login(self.username, self.password)
        self._access_token = result.get("access_token")
        self._refresh_token = result.get("refresh_token")
        if not self._access_token:
            raise ValueError("Superset login failed: no access token returned")

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

    # -- list_tables (flat/eager) ------------------------------------------

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List all datasets the user can access (flat).

        Fetches detail per dataset to populate columns — may be slow for
        large Superset instances.
        """
        token = self._ensure_token()
        all_datasets = self._fetch_all_datasets(token)
        results = []
        for ds in all_datasets:
            name = ds.get("table_name") or ""
            if table_filter and table_filter.lower() not in name.lower():
                continue

            # The list endpoint doesn't include columns or row_count —
            # fetch detail for each dataset.
            columns: list[dict] = []
            row_count = ds.get("row_count")
            sample_rows: list[dict] = []
            try:
                detail = self._client.get_dataset_detail(token, ds["id"])
                columns = [
                    {"name": c.get("column_name") or c.get("name") or "", "type": c.get("type") or ""}
                    for c in (detail.get("columns") or [])
                ]
                row_count = detail.get("row_count") or row_count

                # Fetch sample rows via SQL Lab
                db_id, schema, base_sql = _build_dataset_sql(detail)
                sql_session = self._client.create_sql_session(token)
                result = self._client.execute_sql_with_session(
                    sql_session, db_id, f"SELECT * FROM ({base_sql}) AS _src LIMIT 10", schema, 10,
                )
                sample_rows = result.get("data", []) or []
            except Exception:
                logger.debug("Failed to fetch detail for dataset %s", ds.get("id"))

            results.append({
                "name": f"{ds.get('id')}:{name}",
                "metadata": {
                    "dataset_id": ds["id"],
                    "row_count": row_count,
                    "columns": columns,
                    "sample_rows": sample_rows,
                    "schema": ds.get("schema", ""),
                    "database": (ds.get("database") or {}).get("database_name", ""),
                },
            })
        return results

    # -- ls (lazy/hierarchical) --------------------------------------------

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        token = self._ensure_token()

        if len(path) == 0:
            # Root: list dashboards + "All Datasets"
            raw = self._client.list_dashboards(token, page=0, page_size=500)
            dashboards = raw.get("result", [])
            nodes = []
            for d in dashboards:
                title = d.get("dashboard_title", f"Dashboard {d['id']}")
                if filter and filter.lower() not in title.lower():
                    continue
                nodes.append(CatalogNode(
                    name=title,
                    node_type="namespace",
                    path=[str(d["id"])],
                    metadata={"dashboard_id": d["id"]},
                ))
            # Add synthetic "All Datasets" entry
            if not filter or "all datasets" in (filter or "").lower():
                nodes.append(CatalogNode(
                    name="All Datasets",
                    node_type="namespace",
                    path=["__all__"],
                ))
            return nodes

        if len(path) == 1:
            # Expand a dashboard or "All Datasets"
            parent_id = path[0]
            if parent_id == "__all__":
                datasets = self._fetch_all_datasets(token)
            else:
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

    # -- fetch_data_as_arrow -----------------------------------------------

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Fetch dataset data via Superset's SQL Lab API.

        ``source_table`` is either:
        - A dataset ID (int as string): ``"42"``
        - A ``"dataset_id:table_name"`` pair: ``"42:orders_fact"``
        """
        opts = import_options or {}
        size = opts.get("size", 100_000)

        # Parse dataset_id from source_table
        dataset_id_str = source_table.split(":")[0] if ":" in source_table else source_table
        try:
            dataset_id = int(dataset_id_str)
        except ValueError:
            raise ValueError(f"source_table must be a dataset ID (got: {source_table!r})")

        token = self._ensure_token()
        detail = self._client.get_dataset_detail(token, dataset_id)
        db_id, schema, base_sql = _build_dataset_sql(detail)

        # Build SQL
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
