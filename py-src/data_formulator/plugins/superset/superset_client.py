# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Thin wrapper around the Superset public REST API.

Migrated verbatim from data-formulator 0.6 ``superset/superset_client.py``.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)


class SupersetClient:
    """Every Superset API call goes through this class so that upstream
    changes only require edits in one place."""

    def __init__(self, base_url: str, timeout: int = 60):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _headers(self, access_token: str | None) -> dict:
        if access_token:
            return {"Authorization": f"Bearer {access_token}"}
        return {}

    # -- datasets --------------------------------------------------------

    def list_datasets(
        self,
        access_token: str,
        page: int = 0,
        page_size: int = 100,
    ) -> dict:
        """Return datasets the current user can see (DatasourceFilter)."""
        resp = requests.get(
            f"{self.base_url}/api/v1/dataset/",
            headers=self._headers(access_token),
            params={
                "q": f"(page:{page},page_size:{page_size})",
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def get_dataset_detail(self, access_token: str, dataset_id: int) -> dict:
        resp = requests.get(
            f"{self.base_url}/api/v1/dataset/{dataset_id}",
            headers=self._headers(access_token),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json().get("result", {})

    def get_dataset_distinct_values(self, access_token: str, column_name: str) -> dict:
        resp = requests.get(
            f"{self.base_url}/api/v1/dataset/distinct/{quote(column_name, safe='')}",
            headers=self._headers(access_token),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def get_datasource_column_values(
        self,
        access_token: str,
        dataset_id: int,
        column_name: str,
    ) -> dict:
        resp = requests.get(
            f"{self.base_url}/api/v1/datasource/table/{dataset_id}/column/{quote(column_name, safe='')}/values/",
            headers=self._headers(access_token),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    # -- dashboards ------------------------------------------------------

    def list_dashboards(
        self,
        access_token: str,
        page: int = 0,
        page_size: int = 100,
    ) -> dict:
        rison_q = (
            f"(order_column:changed_on_delta_humanized,"
            f"order_direction:desc,"
            f"page:{page},page_size:{page_size})"
        )
        resp = requests.get(
            f"{self.base_url}/api/v1/dashboard/?q={rison_q}",
            headers=self._headers(access_token),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def get_dashboard_datasets(self, access_token: str, dashboard_id: int) -> dict:
        resp = requests.get(
            f"{self.base_url}/api/v1/dashboard/{dashboard_id}/datasets",
            headers=self._headers(access_token),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def get_dashboard_detail(self, access_token: str, dashboard_id: int) -> dict:
        resp = requests.get(
            f"{self.base_url}/api/v1/dashboard/{dashboard_id}",
            headers=self._headers(access_token),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json().get("result", {})

    # -- SQL Lab ---------------------------------------------------------

    def get_csrf_token(self, access_token: str) -> str:
        resp = requests.get(
            f"{self.base_url}/api/v1/security/csrf_token/",
            headers=self._headers(access_token),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json().get("result", "")

    def create_sql_session(self, access_token: str) -> requests.Session:
        """Create a reusable SQL Lab session with auth + CSRF prepared."""
        sql_session = requests.Session()
        sql_session.headers.update(self._headers(access_token))

        csrf_resp = sql_session.get(
            f"{self.base_url}/api/v1/security/csrf_token/",
            timeout=self.timeout,
        )
        csrf_resp.raise_for_status()
        csrf = csrf_resp.json().get("result", "")
        if csrf:
            sql_session.headers.update({"X-CSRFToken": csrf})
        return sql_session

    @staticmethod
    def _extract_jinja_params(sql: str) -> dict[str, str]:
        """Find {{ var }} references in SQL and return default empty values."""
        params: dict[str, str] = {}
        for match in re.finditer(r"\{\{\s*(\w+)\s*\}\}", sql):
            params.setdefault(match.group(1), "")
        return params

    def execute_sql_with_session(
        self,
        sql_session: requests.Session,
        database_id: int,
        sql: str,
        schema: str = "",
        row_limit: int = 100_000,
    ) -> dict:
        """Execute SQL via an existing session."""
        body: dict[str, Any] = {
            "database_id": database_id,
            "sql": sql,
            "schema": schema,
            "runAsync": False,
            "queryLimit": row_limit,
        }
        jinja_params = self._extract_jinja_params(sql)
        if jinja_params:
            body["templateParams"] = json.dumps(jinja_params)

        resp = sql_session.post(
            f"{self.base_url}/api/v1/sqllab/execute/",
            json=body,
            timeout=self.timeout,
        )
        if not resp.ok:
            detail = ""
            try:
                payload = resp.json()
                detail = payload.get("message") or payload.get("errors") or payload
            except Exception:
                detail = resp.text
            raise requests.HTTPError(
                f"{resp.status_code} Server Error for url: {resp.url} detail={detail}",
                response=resp,
            )
        return resp.json()
