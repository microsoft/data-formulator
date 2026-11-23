# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""GoogleAnalyticsDataLoader — semantic connector for Google Analytics 4."""

from __future__ import annotations

import logging
import math
import re
from collections import Counter
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

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

_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta"
_DATA_API = "https://analyticsdata.googleapis.com/v1beta"
_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
_REQUEST_TIMEOUT_SECONDS = 60
_MAX_ROWS = 10_001
_RE2_SPECIAL = set("\\.+*?()|[]{}^$")


def _day(value: Any) -> date:
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError as exc:
        raise ValueError(f"Filter Date with ISO dates such as '2026-01-31', not {value!r}.") from exc


def _number(value: Any) -> float:
    try:
        number = float(value)
        if isinstance(value, bool) or not math.isfinite(number):
            raise ValueError
        return number
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Metric filters require numeric values.") from exc


class GoogleAnalyticsDataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Google Analytics 4"
    DESCRIPTION = "Query dimensions and metrics from Google Analytics 4 properties."
    QUERY_EXECUTION = "semantic_query"
    AUTH_GUIDE = "google_analytics.md"
    IDENTITY_PARAMS = ("property_id",)

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "property_id", "type": "text", "required": False, "tier": "filter", "default": "",
             "description": "One property to open, e.g. '123456789' "
                            "(leave empty to list every property the identity can read)"},
            {"name": "credentials_path", "type": "text", "required": False, "tier": "auth", "default": "",
             "description": "Path to service account JSON file (optional)"},
        ]

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        return [
            {"id": "default_credentials", "label": "Application default credentials",
             "description": "Use gcloud login with the Analytics scope, or GOOGLE_APPLICATION_CREDENTIALS.",
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
        self.property_id = str(params.get("property_id") or "").strip()
        if self.property_id:
            match = re.fullmatch(r"(?:properties/)?([0-9]+)", self.property_id)
            if not match:
                raise ValueError("property_id must be digits or properties/<digits>.")
            self.property_id = f"properties/{match[1]}"
        self._fields_cache: dict[str, list[dict[str, Any]]] = {}
        self._last_sampled = False
        try:
            if params.get("credentials_path"):
                credentials = service_account.Credentials.from_service_account_file(
                    params["credentials_path"], scopes=[_SCOPE])
            else:
                credentials, _ = google.auth.default(scopes=[_SCOPE])
        except (DefaultCredentialsError, OSError, ValueError) as exc:
            raise ValueError(sanitize_error_message(f"Could not load Google credentials: {exc}")) from exc
        self._session = AuthorizedSession(credentials)

    def _request(self, method: str, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._session.request(method, url, json=body, timeout=_REQUEST_TIMEOUT_SECONDS)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code >= 400:
            error = payload.get("error") if isinstance(payload, dict) else None
            detail = error.get("message") if isinstance(error, dict) else None
            raise ValueError(sanitize_error_message(
                f"Google Analytics API error {response.status_code}: {detail or response.reason}"))
        return payload if isinstance(payload, dict) else {}

    def _property(self, source_table: str) -> str:
        # The last match: leaf names end with "(properties/N)" and a display name may contain another one.
        matches = re.findall(r"properties/([0-9]+)", source_table)
        if matches:
            property_id = f"properties/{matches[-1]}"
        elif re.fullmatch(r"[0-9]+", source_table):
            property_id = f"properties/{source_table}"
        else:
            raise ValueError(f"Invalid Google Analytics property {source_table!r}.")
        if self.property_id and property_id != self.property_id:
            raise ValueError(f"This connection is limited to {self.property_id!r}.")
        return property_id

    def _properties(self) -> list[tuple[str, str]]:
        properties = []
        token = ""
        while True:
            url = f"{_ADMIN_API}/accountSummaries?pageSize=200"
            if token:
                url += f"&pageToken={quote(token, safe='')}"
            payload = self._request("GET", url)
            for account in payload.get("accountSummaries") or []:
                for item in account.get("propertySummaries") or []:
                    property_id = item["property"]
                    properties.append((f"{item.get('displayName') or property_id} ({property_id})", property_id))
            token = payload.get("nextPageToken")
            if not token:
                return properties

    def test_connection(self) -> bool:
        try:
            if self.property_id:
                self._fields(self.property_id)
                return True
            return bool(self._properties())
        except Exception:
            return False

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        properties = [(self.property_id, self.property_id)] if self.property_id else self._properties()
        needle = (table_filter or "").casefold()
        # ponytail: Listing makes one metadata call per property; make it lazy if large accounts are slow.
        return [{"name": name, "table_key": property_id, "path": [name], "metadata": self._leaf_metadata(name)}
                for name, property_id in properties if needle in name.casefold()]

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        return self._leaf_metadata(path[-1]) if path else {}

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        metadata = self._leaf_metadata(source_table)
        return {"columns": metadata["columns"], "description": metadata["description"]}

    def query_model(self, source_table: str) -> str:
        self._property(source_table)
        return "semantic"

    def _leaf_metadata(self, name: str) -> dict[str, Any]:
        return {"query_model": "semantic", "_source_name": name,
                "description": f"Google Analytics 4 property {name}",
                "columns": [dict(field) for field in self._fields(self._property(name))]}

    def _fields(self, property_id: str) -> list[dict[str, Any]]:
        if property_id not in self._fields_cache:
            payload = self._request("GET", f"{_DATA_API}/{property_id}/metadata")
            members = [(item, "time_dimension" if item["apiName"] == "date" else "dimension")
                       for item in payload.get("dimensions") or []]
            members += [(item, "measure") for item in payload.get("metrics") or [] if not item.get("blockedReasons")]
            names = Counter(item.get("uiName") or item["apiName"] for item, _ in members)
            fields = []
            for item, role in members:
                ref, name = item["apiName"], item.get("uiName") or item["apiName"]
                field = {"name": f"{name} ({ref})" if names[name] > 1 else name, "ref": ref, "role": role,
                         "type": "number" if role == "measure" else "time" if role == "time_dimension" else "string"}
                description = (item.get("description") or "").strip()
                if description:
                    field["description"] = description
                fields.append(field)
            self._fields_cache[property_id] = fields
        return self._fields_cache[property_id]

    def query_data_as_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= _MAX_ROWS:
            raise ValueError(f"Semantic query result limit must be between 1 and {_MAX_ROWS}.")
        property_id = self._property(source_table)
        if query.get("native") is not None:
            self.check_native_query(query["native"])
        body, outputs = self._compile(query, self._fields(property_id))
        body["limit"] = limit
        check_cancelled()
        logger.info("Executing Google Analytics query against %s", source_table)
        payload = self._request("POST", f"{_DATA_API}/{property_id}:runReport", body)
        # GA4 only sets samplingMetadatas when it sampled the events behind the report.
        self._last_sampled = bool((payload.get("metadata") or {}).get("samplingMetadatas"))
        return self._to_arrow(payload, outputs)

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        out_limit = probe_utils.clamp_probe_limit((query or {}).get("limit"))
        try:
            table = self.query_data_as_arrow(path[-1], query or {}, out_limit)
        except (ValueError, requests.RequestException) as exc:
            return {"error": f"probe failed: {exc}"}
        if self._last_sampled:
            return probe_utils.shape_probe_payload(table, out_limit, exact=False,
                                                   extra_note="Google Analytics sampled the events behind this result.")
        return probe_utils.shape_probe_payload(table, out_limit, exact=True)

    def preview_data(self, source_table: str, import_options: dict[str, Any] | None = None,
                     *, purpose: str = "ui") -> dict[str, Any]:
        options = dict(import_options or {})
        if not options.get("columns") and options.get("structured_query") is None:
            fields = self._fields(self._property(source_table))
            by_ref = {field["ref"]: field["name"] for field in fields}
            dimensions = [field["name"] for field in fields if field["role"] != "measure"]
            metrics = [field["name"] for field in fields if field["role"] == "measure"]
            leading = [by_ref["pagePath"]] if "pagePath" in by_ref else dimensions[:1]
            preferred = [by_ref[ref] for ref in ("screenPageViews", "activeUsers", "sessions") if ref in by_ref]
            options["columns"] = leading + (preferred or metrics[:3])
        return super().preview_data(source_table, options, purpose=purpose)

    def fetch_data_as_arrow(self, source_table: str, import_options: dict[str, Any] | None = None) -> pa.Table:
        options = import_options or {}
        if options.get("structured_query") is not None:
            query = options["structured_query"]
        else:
            if not options.get("columns"):
                raise ValueError(f"Select dimensions and measures for Google Analytics property {source_table!r}; "
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

    def _compile(self, query: dict[str, Any], fields: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        if query.get("group_by") or query.get("aggregates"):
            raise ValueError("Google Analytics computes measures itself: select dimensions and measures in "
                             "columns instead of group_by/aggregates.")
        columns = query.get("columns") or []
        if not columns:
            raise ValueError("Select at least one Google Analytics dimension or measure in columns.")
        if len(set(columns)) != len(columns):
            raise ValueError("Each column may be selected only once.")
        by_name = {field["name"]: field for field in fields}
        unknown = [column for column in columns if column not in by_name]
        if unknown:
            raise ValueError(f"Unknown Google Analytics field(s) {unknown}. Available: {list(by_name)[:8]}.")
        outputs = [by_name[column] for column in columns]
        body = self._compile_filters(by_name, query.get("filters") or [])
        body["dimensions"] = [{"name": field["ref"]} for field in outputs if field["role"] != "measure"]
        body["metrics"] = [{"name": field["ref"]} for field in outputs if field["role"] == "measure"]
        order = []
        for item in query.get("order_by") or []:
            if item.get("column") not in columns:
                raise ValueError(f"order_by column {item.get('column')!r} must be one of the selected columns.")
            field = by_name[item["column"]]
            kind = "metric" if field["role"] == "measure" else "dimension"
            order.append({kind: {f"{kind}Name": field["ref"]}, "desc": item.get("dir") == "desc"})
        if order:
            body["orderBys"] = order
        return body, outputs

    @staticmethod
    def _compile_filters(by_name: dict[str, dict[str, Any]], items: list[dict[str, Any]]) -> dict[str, Any]:
        start, end = None, None
        dimensions, metrics = [], []
        for item in items:
            column = item.get("column")
            field = by_name.get(column)
            if field is None:
                raise ValueError(f"Unknown filter column {column!r}.")
            op, value = str(item.get("op") or item.get("operator") or "").upper(), item.get("value")
            values = list(value) if isinstance(value, (list, tuple)) else [value]
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
                    raise ValueError("Filter Date with EQ, IN, BETWEEN or a comparison on one ISO date.")
                start = low if start is None or (low is not None and low > start) else start
                end = high if end is None or (high is not None and high < end) else end
                continue
            compiled = {"fieldName": field["ref"]}
            if field["role"] == "measure":
                operations = {"EQ": "EQUAL", "NEQ": "EQUAL", "GT": "GREATER_THAN", "GTE": "GREATER_THAN_OR_EQUAL",
                              "LT": "LESS_THAN", "LTE": "LESS_THAN_OR_EQUAL"}
                if op in operations and len(values) == 1:
                    compiled["numericFilter"] = {"operation": operations[op], "value": {"doubleValue": _number(values[0])}}
                elif op == "BETWEEN" and len(values) == 2:
                    compiled["betweenFilter"] = {"fromValue": {"doubleValue": _number(values[0])},
                                                 "toValue": {"doubleValue": _number(values[1])}}
                else:
                    raise ValueError(f"Unsupported metric filter operator or values for {column!r}: {op!r}.")
            elif op in {"IS_NULL", "IS_NOT_NULL"}:
                compiled["emptyFilter"] = {}
            elif op in {"EQ", "NEQ"} and len(values) == 1:
                compiled["stringFilter"] = {"matchType": "EXACT", "value": str(values[0]), "caseSensitive": True}
            elif op in {"IN", "NOT_IN"} and values:
                compiled["inListFilter"] = {"values": [str(value) for value in values], "caseSensitive": True}
            elif op in {"LIKE", "ILIKE"} and len(values) == 1:
                pattern = str(values[0])
                starts, ends = pattern.startswith("%"), pattern.endswith("%")
                core = pattern[1:] if starts else pattern
                core = core[:-1] if ends else core
                if "%" in core or "_" in core:
                    match_type = "FULL_REGEXP"
                    # (?s): SQL wildcards also match newlines, RE2's "." does not by default.
                    text = "(?s)" + "".join(".*" if char == "%" else "." if char == "_" else
                                            f"\\{char}" if char in _RE2_SPECIAL else char for char in pattern)
                else:
                    match_type = "CONTAINS" if starts and ends else "ENDS_WITH" if starts else "BEGINS_WITH" if ends else "EXACT"
                    text = core
                compiled["stringFilter"] = {"matchType": match_type, "value": text, "caseSensitive": op == "LIKE"}
            else:
                raise ValueError(f"Unsupported dimension filter operator or values for {column!r}: {op!r}.")
            expression = {"filter": compiled}
            if op in {"NEQ", "NOT_IN", "IS_NOT_NULL"}:
                expression = {"notExpression": expression}
            (metrics if field["role"] == "measure" else dimensions).append(expression)
        if start is not None and end is not None and start > end:
            raise ValueError(f"The Date filters leave an empty range ({start} to {end}).")
        body = {"dateRanges": [{"startDate": start.isoformat() if start else
                                (end - timedelta(days=27)).isoformat() if end else "28daysAgo",
                                "endDate": end.isoformat() if end else "today" if start else "yesterday"}]}
        for key, expressions in (("dimensionFilter", dimensions), ("metricFilter", metrics)):
            if expressions:
                body[key] = {"andGroup": {"expressions": expressions}}
        return body

    @staticmethod
    def _to_arrow(payload: dict[str, Any], outputs: list[dict[str, Any]]) -> pa.Table:
        rows = payload.get("rows") or []
        dimensions = {header["name"]: index for index, header in enumerate(payload.get("dimensionHeaders") or [])}
        metrics = {header["name"]: (index, header.get("type"))
                   for index, header in enumerate(payload.get("metricHeaders") or [])}
        columns: dict[str, pa.Array] = {}
        for field in outputs:
            ref = field["ref"]
            if field["role"] == "measure":
                index, metric_type = metrics.get(ref, (None, None))
                key = "metricValues"
            else:
                index, metric_type = dimensions.get(ref), None
                key = "dimensionValues"
            values = [(row.get(key) or [])[index].get("value") if index is not None else None for row in rows]
            if field["type"] == "time":
                columns[field["name"]] = pa.array(pd.to_datetime(pd.Series(values, dtype="object"),
                                                                 format="%Y%m%d", errors="coerce"), from_pandas=True)
            elif field["type"] == "number":
                numbers = pd.to_numeric(pd.Series(values, dtype="object"), errors="coerce")
                columns[field["name"]] = pa.array(numbers.astype("Int64" if metric_type == "TYPE_INTEGER" else "float64"),
                                                  from_pandas=True)
            else:
                columns[field["name"]] = pa.array([None if value is None else str(value) for value in values], type=pa.string())
        return pa.table(columns)
