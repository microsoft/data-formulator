# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SearchConsoleDataLoader — semantic connector for Google Search Console.

Each verified Search Console property is one semantic leaf. Its columns are the
Search Analytics dimensions and measures; selecting them is the query, and
Search Console groups by the selected dimensions and computes the measures.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import google.auth
import pandas as pd
import pyarrow as pa
import requests
from google.auth.exceptions import DefaultCredentialsError
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.query_runtime import check_cancelled
from data_formulator.security.sanitize import sanitize_error_message

logger = logging.getLogger(__name__)

_API = "https://searchconsole.googleapis.com/webmasters/v3"
_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
_SEARCH_TYPES = ("web", "image", "video", "news", "discover", "googleNews")
_REQUEST_TIMEOUT_SECONDS = 60
_MAX_ROWS = 10_001
_API_ROW_LIMIT = 25_000  # Search Analytics rowLimit maximum
_DEFAULT_DAYS = 28
_RE2_SPECIAL = set("\\.+*?()|[]{}^$")
# Discover reports have no query dimension and no position metric.
_DISCOVER_UNSUPPORTED = {"query", "position"}

_FIELDS: list[dict[str, Any]] = [
    {"name": "Date", "ref": "date", "type": "time", "role": "time_dimension",
     "description": "Day in Pacific Time. Filter on Date to choose the range; without a Date filter "
                    f"the last {_DEFAULT_DAYS} days are queried."},
    {"name": "Query", "ref": "query", "type": "string", "role": "dimension",
     "description": "Search query. Anonymized queries are left out when grouping by query, so totals can be lower."},
    {"name": "Page", "ref": "page", "type": "string", "role": "dimension", "description": "Canonical URL shown in results."},
    {"name": "Country", "ref": "country", "type": "string", "role": "dimension",
     "description": "ISO 3166-1 alpha-3 country code in lower case, e.g. 'fra'."},
    {"name": "Device", "ref": "device", "type": "string", "role": "dimension", "description": "DESKTOP, MOBILE or TABLET."},
    {"name": "Search appearance", "ref": "searchAppearance", "type": "string", "role": "dimension",
     "description": "Search result feature, e.g. rich results."},
    {"name": "Clicks", "ref": "clicks", "type": "number", "role": "measure", "aggregation": "sum"},
    {"name": "Impressions", "ref": "impressions", "type": "number", "role": "measure", "aggregation": "sum"},
    {"name": "CTR", "ref": "ctr", "type": "number", "role": "measure",
     "description": "Clicks / impressions, between 0 and 1. Recompute from Clicks and Impressions; never sum it."},
    {"name": "Position", "ref": "position", "type": "number", "role": "measure",
     "description": "Average top position (1 is best). Weight by Impressions when combining rows; never sum it."},
]
_INTEGER_MEASURES = {"clicks", "impressions"}


def _re2_escape(text: str) -> str:
    return "".join(f"\\{char}" if char in _RE2_SPECIAL else char for char in text)


def _pacific_today() -> date:
    """Search Console dates are Pacific Time, so "today" must be too."""
    return datetime.now(ZoneInfo("America/Los_Angeles")).date()


def _like_regex(pattern: str, ignore_case: bool) -> str:
    """Translate a SQL LIKE pattern (% and _ wildcards) to an anchored RE2 expression."""
    body = "".join(".*" if char == "%" else "." if char == "_" else _re2_escape(char) for char in pattern)
    return ("(?i)" if ignore_case else "") + "^" + body + "$"


def _day(value: Any) -> date:
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError as exc:
        raise ValueError(f"Filter Date with ISO dates such as '2026-01-31', not {value!r}.") from exc


class SearchConsoleDataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Google Search Console"
    DESCRIPTION = "Query clicks, impressions, CTR and average position from Google Search Console properties."
    QUERY_EXECUTION = "semantic_query"
    AUTH_GUIDE = "search_console.md"

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "site_url", "type": "text", "required": True, "tier": "connection",
             "description": "Search Console property, e.g. 'sc-domain:example.com' or 'https://www.example.com/'"},
            {"name": "search_type", "type": "text", "required": False, "tier": "connection", "advanced": True,
             "default": "web", "description": "Report type: " + ", ".join(_SEARCH_TYPES)},
            {"name": "credentials_path", "type": "text", "required": False, "tier": "auth", "default": "",
             "description": "Path to service account JSON file (optional)"},
        ]

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        return [
            {"id": "default_credentials", "label": "Application default credentials",
             "description": "Use gcloud login with the Search Console scope, or GOOGLE_APPLICATION_CREDENTIALS.",
             "fields": [], "required_fields": [], "kind": "ambient", "default": True},
            {"id": "service_account_file", "label": "Service account file",
             "description": "Use a service account JSON key file on this machine.",
             "fields": ["credentials_path"], "required_fields": ["credentials_path"], "kind": "credentials"},
        ]

    @classmethod
    def infer_auth_path(cls, params: dict[str, Any]) -> str:
        return "service_account_file" if params.get("credentials_path") else "default_credentials"

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [{"key": "table", "label": "Property"}]

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.site_url = str(params.get("site_url") or "").strip()
        if not self.site_url:
            raise ValueError("site_url is required, e.g. 'sc-domain:example.com' or 'https://www.example.com/'.")
        self.search_type = str(params.get("search_type") or "web").strip()
        if self.search_type not in _SEARCH_TYPES:
            raise ValueError(f"search_type must be one of: {', '.join(_SEARCH_TYPES)}")
        self._fields = [field for field in _FIELDS
                        if not (self.search_type == "discover" and field["ref"] in _DISCOVER_UNSUPPORTED)]
        self._by_name = {field["name"]: field for field in self._fields}
        try:
            if params.get("credentials_path"):
                credentials = service_account.Credentials.from_service_account_file(
                    params["credentials_path"], scopes=[_SCOPE])
            else:
                credentials, _ = google.auth.default(scopes=[_SCOPE])
        except (DefaultCredentialsError, OSError, ValueError) as exc:
            raise ValueError(sanitize_error_message(f"Could not load Google credentials: {exc}")) from exc
        self._session = AuthorizedSession(credentials)

    # -- HTTP -----------------------------------------------------------------

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._session.request(method, f"{_API}{path}", json=body, timeout=_REQUEST_TIMEOUT_SECONDS)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code >= 400:
            error = payload.get("error") if isinstance(payload, dict) else None
            detail = error.get("message") if isinstance(error, dict) else None
            raise ValueError(sanitize_error_message(
                f"Search Console API error {response.status_code}: {detail or response.reason}"))
        return payload if isinstance(payload, dict) else {}

    # -- Catalog --------------------------------------------------------------

    def _sites(self) -> list[str]:
        entries = self._request("GET", "/sites").get("siteEntry") or []
        # Unverified users can list a property but cannot read its data.
        return [entry["siteUrl"] for entry in entries if entry.get("siteUrl") and
                str(entry.get("permissionLevel", "")).replace("_", "").lower() != "siteunverifieduser"]

    def test_connection(self) -> bool:
        # Catches both bad credentials and a site_url typo (e.g. a missing trailing slash).
        try:
            return self.site_url in self._sites()
        except Exception:
            return False

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        site = self.site_url
        if (table_filter or "").casefold() not in site.casefold():
            return []
        return [{"name": site, "table_key": site, "path": [site], "metadata": self._leaf_metadata(site)}]

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        return self._leaf_metadata(path[-1]) if path else {}

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        metadata = self._leaf_metadata(source_table)
        return {"columns": metadata["columns"], "description": metadata["description"]}

    def query_model(self, source_table: str) -> str:
        return "semantic"

    def _leaf_metadata(self, site: str) -> dict[str, Any]:
        return {
            "query_model": "semantic",
            "_source_name": site,
            "description": f"Google Search Console performance ({self.search_type}) for {site}",
            "columns": [dict(field) for field in self._fields],
        }

    # -- Query ----------------------------------------------------------------

    def query_data_as_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= _MAX_ROWS:
            raise ValueError(f"Semantic query result limit must be between 1 and {_MAX_ROWS}.")
        if source_table != self.site_url:
            raise ValueError(f"This connection is limited to {self.site_url!r}.")
        if query.get("native") is not None:
            self.check_native_query(query["native"])
        body, outputs, order = self._compile(query)
        # Search Console cannot sort, so ordered results are sorted here and must be complete.
        body["rowLimit"] = _API_ROW_LIMIT if order else limit
        check_cancelled()
        logger.info("Executing Search Console query against %s", source_table)
        rows = self._request("POST", f"/sites/{quote(source_table, safe='')}/searchAnalytics/query", body).get("rows") or []
        if order:
            if len(rows) >= _API_ROW_LIMIT:
                raise ValueError(f"Sorting needs the full result, which may exceed {_API_ROW_LIMIT:,} rows. "
                                 "Add filters or a shorter Date range, or drop order_by.")
            dimensions = body.get("dimensions", [])
            for ref, descending in reversed(order):
                key = (lambda row, i=dimensions.index(ref): row["keys"][i]) if ref in dimensions else \
                      (lambda row, ref=ref: row.get(ref, 0))
                rows.sort(key=key, reverse=descending)
            rows = rows[:limit]
        return self._to_arrow(rows, outputs, body.get("dimensions", []))

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        out_limit = probe_utils.clamp_probe_limit((query or {}).get("limit"))
        try:
            table = self.query_data_as_arrow(path[-1], query or {}, out_limit)
        except (ValueError, requests.RequestException) as exc:
            return {"error": f"probe failed: {exc}"}
        return probe_utils.shape_probe_payload(table, out_limit, exact=True)

    def preview_data(self, source_table: str, import_options: dict[str, Any] | None = None,
                     *, purpose: str = "ui") -> dict[str, Any]:
        options = dict(import_options or {})
        if not options.get("columns") and options.get("structured_query") is None:
            # No raw rows exist; show the top queries (or pages, where queries are not reported) instead.
            leading = "Query" if self.search_type not in ("discover", "googleNews") else "Page"
            options["columns"] = [leading] + [field["name"] for field in self._fields if field["role"] == "measure"]
        return super().preview_data(source_table, options, purpose=purpose)

    def fetch_data_as_arrow(self, source_table: str, import_options: dict[str, Any] | None = None) -> pa.Table:
        options = import_options or {}
        if options.get("structured_query") is not None:
            query = options["structured_query"]
        else:
            if not options.get("columns"):
                raise ValueError(f"Select dimensions and measures for Search Console property {source_table!r}; "
                                 "it cannot be loaded as raw rows.")
            query = {
                "columns": options["columns"],
                "filters": [{"column": item.get("column"), "op": item.get("operator"), "value": item.get("value")}
                            for item in options.get("source_filters") or []],
                "order_by": [{"column": column, "dir": options.get("sort_order", "asc")}
                             for column in options.get("sort_columns") or []][:1],
            }
        size = options.get("size")
        limit = size if isinstance(size, int) and 0 < size < _MAX_ROWS else _MAX_ROWS
        return self.query_data_as_arrow(source_table, query, limit)

    def _compile(self, query: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[tuple[str, bool]]]:
        if query.get("group_by") or query.get("aggregates"):
            raise ValueError("Search Console computes measures itself: select dimensions and measures in "
                             "columns instead of group_by/aggregates.")
        columns = query.get("columns") or []
        if not columns:
            raise ValueError("Select at least one Search Console dimension or measure in columns.")
        if len(set(columns)) != len(columns):
            raise ValueError("Each column may be selected only once.")
        unknown = [column for column in columns if column not in self._by_name]
        if unknown:
            raise ValueError(f"Unknown Search Console field(s) {unknown} for the {self.search_type} report. "
                             f"Available: {list(self._by_name)}.")
        outputs = [self._by_name[column] for column in columns]
        start, end, filters = self._compile_filters(query.get("filters") or [])
        body: dict[str, Any] = {"startDate": start.isoformat(), "endDate": end.isoformat(), "type": self.search_type}
        dimensions = [field["ref"] for field in outputs if field["role"] != "measure"]
        if "searchAppearance" in dimensions and len(dimensions) > 1:
            raise ValueError("Search appearance can only be grouped on its own. To break one appearance down, "
                             "filter on it and group by other dimensions.")
        if dimensions:
            body["dimensions"] = dimensions
        if filters:
            body["dimensionFilterGroups"] = [{"groupType": "and", "filters": filters}]
        order = []
        for item in query.get("order_by") or []:
            if item.get("column") not in columns:
                raise ValueError(f"order_by column {item.get('column')!r} must be one of the selected columns.")
            order.append((self._by_name[item["column"]]["ref"], item.get("dir") == "desc"))
        return body, outputs, order

    def _compile_filters(self, items: list[dict[str, Any]]) -> tuple[date, date, list[dict[str, str]]]:
        start: date | None = None
        end: date | None = None
        compiled: list[dict[str, str]] = []
        for item in items:
            column = item.get("column")
            field = self._by_name.get(column)
            if field is None:
                raise ValueError(f"Unknown filter column {column!r}.")
            op, value = str(item.get("op") or item.get("operator") or "").upper(), item.get("value")
            values = list(value) if isinstance(value, (list, tuple)) else [value]
            if field["role"] == "measure":
                raise ValueError("Search Console cannot filter on measures; load the rows, then filter them.")
            if field["role"] == "time_dimension":
                if op in {"EQ", "IN"} and len(values) == 1:
                    low = high = _day(values[0])
                elif op == "BETWEEN" and len(values) == 2:
                    low, high = _day(values[0]), _day(values[1])
                elif op in {"GT", "GTE"} and len(values) == 1:
                    low, high = _day(values[0]) + timedelta(days=1 if op == "GT" else 0), None
                elif op in {"LT", "LTE"} and len(values) == 1:
                    low, high = None, _day(values[0]) - timedelta(days=1 if op == "LT" else 0)
                else:
                    raise ValueError("Filter Date with EQ, BETWEEN or a comparison on one ISO date.")
                start = low if start is None or (low is not None and low > start) else start
                end = high if end is None or (high is not None and high < end) else end
                continue
            ref = field["ref"]
            texts = [str(v).upper() if ref == "device" else str(v).lower() if ref == "country" else str(v)
                     for v in values]
            alternatives = "^(?:" + "|".join(_re2_escape(text) for text in texts) + ")$"
            if op in {"EQ", "IN"}:
                compiled.append({"dimension": ref, "operator": "equals", "expression": texts[0]} if len(texts) == 1
                                else {"dimension": ref, "operator": "includingRegex", "expression": alternatives})
            elif op in {"NEQ", "NOT_IN"}:
                compiled.append({"dimension": ref, "operator": "notEquals", "expression": texts[0]} if len(texts) == 1
                                else {"dimension": ref, "operator": "excludingRegex", "expression": alternatives})
            elif op in {"LIKE", "ILIKE"}:
                pattern, core = texts[0], texts[0][1:-1]
                if op == "ILIKE" and len(pattern) > 2 and pattern[0] == pattern[-1] == "%" and not set(core) & {"%", "_"}:
                    # Search Console's contains is case-insensitive, like ILIKE.
                    compiled.append({"dimension": ref, "operator": "contains", "expression": core})
                else:
                    compiled.append({"dimension": ref, "operator": "includingRegex",
                                     "expression": _like_regex(pattern, op == "ILIKE")})
            else:
                raise ValueError(f"Unsupported filter operator {op!r} on {column!r}; use EQ, IN, NEQ, NOT_IN or LIKE.")
        end = end or _pacific_today()
        start = start or end - timedelta(days=_DEFAULT_DAYS - 1)
        if start > end:
            raise ValueError(f"The Date filters leave an empty range ({start} to {end}).")
        return start, end, compiled

    # -- Results --------------------------------------------------------------

    @staticmethod
    def _to_arrow(rows: list[dict[str, Any]], outputs: list[dict[str, Any]], dimensions: list[str]) -> pa.Table:
        columns: dict[str, pa.Array] = {}
        for field in outputs:
            ref = field["ref"]
            if ref in dimensions:
                index = dimensions.index(ref)
                values = [(row.get("keys") or [None] * len(dimensions))[index] for row in rows]
            else:
                values = [row.get(ref) for row in rows]
            if field["type"] == "time":
                columns[field["name"]] = pa.array(pd.to_datetime(pd.Series(values, dtype="object"), errors="coerce"),
                                                  from_pandas=True)
            elif field["type"] == "number":
                numbers = pd.to_numeric(pd.Series(values, dtype="object"), errors="coerce")
                columns[field["name"]] = pa.array(numbers.astype("Int64" if ref in _INTEGER_MEASURES else "float64"),
                                                  from_pandas=True)
            else:
                columns[field["name"]] = pa.array([None if v is None else str(v) for v in values], type=pa.string())
        return pa.table(columns)
