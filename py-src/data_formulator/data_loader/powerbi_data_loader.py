# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""PowerBIDataLoader — semantic-layer connector for Power BI / Fabric semantic models.

Each semantic model in the pinned workspace is one semantic leaf whose columns
are its visible table columns (dimensions) and measures. Queries compile to a
DAX ``SUMMARIZECOLUMNS`` and run through the executeQueries REST API; metadata
comes from ``INFO.VIEW.*`` through the same endpoint and permission.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from threading import Lock
from typing import Any

import pandas as pd
import pyarrow as pa
import requests

from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.query_runtime import check_cancelled
from data_formulator.security.sanitize import sanitize_error_message

logger = logging.getLogger(__name__)

_API = "https://api.powerbi.com/v1.0/myorg"
_SCOPE = "https://analysis.windows.net/powerbi/api/.default"
_GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_REQUEST_TIMEOUT_SECONDS = 120
_MAX_ROWS = 10_001
_TIME_TYPES = {"Date", "DateTime", "Time"}
_INTEGER_TYPES = {"Integer", "Int64", "WholeNumber"}
_NUMBER_TYPES = {"Number", "Double", "Decimal", "Currency"}

# One query returns tables, columns, measures and relationships (one result table per call).
_METADATA_DAX = """EVALUATE UNION(
SELECTCOLUMNS(INFO.VIEW.TABLES(), "K", "table", "T", [Name], "N", BLANK(), "Y", [DataCategory],
  "H", [IsHidden] || [IsPrivate], "D", [Description], "F", BLANK(), "G", BLANK(), "X", BLANK(), "S", BLANK()),
SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "K", "column", "T", [Table], "N", [Name], "Y", [DataType],
  "H", [IsHidden], "D", [Description], "F", [FormatString], "G", [DisplayFolder], "X", [Type], "S", [SummarizeBy]),
SELECTCOLUMNS(INFO.VIEW.MEASURES(), "K", "measure", "T", [Table], "N", [Name], "Y", [DataType],
  "H", [IsHidden], "D", [Description], "F", [FormatString], "G", [DisplayFolder], "X", BLANK(), "S", BLANK()),
SELECTCOLUMNS(INFO.VIEW.RELATIONSHIPS(), "K", "relationship", "T", [FromTable], "N", [FromColumn], "Y", [ToTable],
  "H", NOT [IsActive], "D", [ToColumn], "F", [CrossFilteringBehavior], "G", [FromCardinality], "X", [ToCardinality], "S", BLANK())
)"""
# Power BI visuals aggregate numeric columns by their default summarization ("implicit measures").
_IMPLICIT_AGGREGATIONS = {"Sum": "SUM", "Average": "AVERAGE", "Min": "MIN", "Max": "MAX",
                          "Count": "COUNT", "DistinctCount": "DISTINCTCOUNT"}


class _CachedCredential:
    """Keep one token per loader so each request does not re-authenticate."""

    def __init__(self, credential: Any):
        self._credential = credential
        self._lock = Lock()
        self._token: Any = None

    def token(self) -> str:
        with self._lock:
            if self._token is None or self._token.expires_on <= time.time() + 300:
                self._token = self._credential.get_token(_SCOPE)
            return self._token.token


def dax_table(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def dax_name(name: str) -> str:
    return "[" + name.replace("]", "]]") + "]"


def dax_string(value: Any) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def _strip_dax(text: str) -> tuple[str, bool]:
    """Blank out string literals and quoted identifiers; report whether comments were present."""
    out, index, has_comment = [], 0, False
    while index < len(text):
        char = text[index]
        pair = text[index:index + 2]
        if pair in ("//", "--", "/*"):
            has_comment = True
            out.append(" ")
            index += 2
            continue
        closer = {'"': '"', "'": "'", "[": "]"}.get(char)
        if closer:
            end = index + 1
            while end < len(text):
                if text[end] == closer:
                    if text[end + 1:end + 2] == closer:
                        end += 2
                        continue
                    break
                end += 1
            out.append(" " if char != "[" else "[]")
            index = end + 1
            continue
        out.append(char)
        index += 1
    return "".join(out), has_comment


class PowerBIDataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Power BI"
    DESCRIPTION = "Query governed measures and dimensions from Power BI / Fabric semantic models."
    QUERY_EXECUTION = "semantic_query"
    AUTH_GUIDE = "powerbi.md"

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "workspace", "type": "string", "required": True, "tier": "connection",
             "description": "Workspace name or ID that holds the semantic models"},
            {"name": "client_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"},
            {"name": "client_secret", "type": "string", "required": False, "sensitive": True, "tier": "auth",
             "description": "Service principal only"},
            {"name": "tenant_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"},
        ]

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        return [
            {
                "id": "ambient",
                "label": "Azure default identity",
                "description": "Use Azure CLI, managed identity, VS Code, or environment credentials.",
                "fields": [],
                "required_fields": [],
                "kind": "ambient",
                "default": True,
                "cli_login": {
                    "provider": "azure",
                    "label": "Sign in with Azure CLI",
                    "status_url": "/api/local/azure-status",
                    "login_url": "/api/local/azure-login",
                },
            },
            {
                "id": "service_principal",
                "label": "Service principal",
                "description": "Use an Entra application client ID, secret, and tenant ID. Not supported for models with row-level security.",
                "fields": ["client_id", "client_secret", "tenant_id"],
                "required_fields": ["client_id", "client_secret", "tenant_id"],
                "kind": "credentials",
            },
        ]

    @classmethod
    def infer_auth_path(cls, params: dict[str, Any]) -> str:
        if all(params.get(name) for name in ("client_id", "client_secret", "tenant_id")):
            return "service_principal"
        return "ambient"

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [{"key": "table", "label": "Semantic model"}]

    @classmethod
    def query_capabilities(cls) -> dict[str, Any]:
        return {
            **super().query_capabilities(),
            "native_query_languages": ["dax"],
            "native_query_guidance": (
                "One read-only DAX query: optional DEFINE (MEASURE/VAR/COLUMN/TABLE) then exactly one EVALUATE, "
                "using table, column and measure names from describe_data, e.g. "
                "EVALUATE SUMMARIZECOLUMNS('Product'[Category], \"Sales\", [Sales]). Use it for measure-value "
                "filters, TOPN/ranking or shapes the structured query cannot express. Maximum 10000 rows."
            ),
        }

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.auth_path = params.get("_auth_path") or self.infer_auth_path(params)
        workspace = str(params.get("workspace") or "").strip()
        if not workspace:
            raise ValueError("Enter the Power BI workspace name or ID.")
        if self.auth_path == "service_principal":
            from azure.identity import ClientSecretCredential
            credential = ClientSecretCredential(params["tenant_id"], params["client_id"], params["client_secret"])
        else:
            from azure.identity import DefaultAzureCredential
            credential = DefaultAzureCredential()
        self._credential = _CachedCredential(credential)
        self._session = requests.Session()
        self._workspace = workspace
        self._workspace_id: str | None = workspace if _GUID_RE.match(workspace) else None
        self._models: dict[str, dict[str, Any]] = {}
        self._fields_cache: dict[str, dict[str, Any]] = {}

    # -- HTTP -----------------------------------------------------------------

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = self._session.request(
            method, f"{_API}{path}", headers={"Authorization": f"Bearer {self._credential.token()}"},
            timeout=_REQUEST_TIMEOUT_SECONDS, **kwargs,
        )
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code >= 400:
            raise ValueError(sanitize_error_message(self._error_text(response.status_code, payload)))
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _error_text(status: int, payload: Any) -> str:
        error = payload.get("error") if isinstance(payload, dict) else None
        detail = ""
        if isinstance(error, dict):
            details = (error.get("pbi.error") or {}).get("details") or []
            messages = [item.get("detail", {}).get("value") for item in details if item.get("code") == "DetailsMessage"]
            detail = next((m for m in messages if m), "") or error.get("message") or error.get("code") or ""
        if status in (401, 403, 404):
            return (f"Power BI API error {status}: {detail or 'access denied'}. The account needs Read and Build "
                    "permission on the semantic model, and the tenant must allow the Execute Queries REST API.")
        if status == 429:
            return "Power BI rate limit reached (120 queries per minute per user). Wait a minute and retry."
        return f"Power BI query failed ({status}): {detail or 'unknown error'}"

    def _workspace_path(self) -> str:
        if self._workspace_id is None:
            escaped = self._workspace.replace("'", "''")
            groups = self._request("GET", "/groups", params={"$filter": f"name eq '{escaped}'"}).get("value") or []
            if not groups:
                raise ValueError(f"Power BI workspace {self._workspace!r} was not found or is not shared with this account.")
            self._workspace_id = groups[0]["id"]
        return f"/groups/{self._workspace_id}"

    def _execute(self, dataset_id: str, dax: str) -> list[dict[str, Any]]:
        check_cancelled()
        payload = self._request("POST", f"{self._workspace_path()}/datasets/{dataset_id}/executeQueries", json={
            "queries": [{"query": dax}], "serializerSettings": {"includeNulls": True},
        })
        results = payload.get("results") or [{}]
        result = results[0]
        table = (result.get("tables") or [{}])[0]
        # The service reports truncation (row/value/size limits) as an error inside a 200 response.
        error = payload.get("error") or result.get("error") or table.get("error")
        if error:
            raise ValueError(sanitize_error_message(f"Power BI query failed: {error.get('message') or error.get('code') or error}"))
        return table.get("rows") or []

    # -- Catalog --------------------------------------------------------------

    def _datasets(self) -> list[dict[str, Any]]:
        return self._request("GET", f"{self._workspace_path()}/datasets").get("value") or []

    def test_connection(self) -> bool:
        try:
            self._datasets()
            return True
        except Exception:
            return False

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        needle = (table_filter or "").casefold()
        self._models = {}
        tables = []
        for dataset in self._datasets():
            if not dataset.get("id") or not dataset.get("name"):
                continue
            if needle and needle not in dataset["name"].casefold():
                continue
            self._models[dataset["id"]] = dataset
            try:
                metadata = self._leaf_metadata(dataset["id"], refresh=True)
            except Exception as exc:
                logger.info("Power BI metadata unavailable for %s: %s", dataset["name"], exc)
                metadata = {"query_model": "semantic", "dataset_id": dataset["id"],
                            "source_metadata_status": "unavailable",
                            "description": f"Metadata unavailable: {exc}"}
            tables.append({"name": dataset["name"], "table_key": dataset["id"], "path": [dataset["name"]],
                           "metadata": metadata})
        return tables

    def _dataset_id(self, source_table: str) -> str:
        if not self._models:
            self._models = {item["id"]: item for item in self._datasets() if item.get("id")}
        if source_table in self._models or _GUID_RE.match(source_table or ""):
            return source_table
        matches = [key for key, item in self._models.items() if item.get("name") == source_table]
        if len(matches) != 1:
            raise ValueError(f"Semantic model {source_table!r} was not found (or the name is ambiguous). "
                             "Refresh the catalog and use the exact table_key.")
        return matches[0]

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        return self._leaf_metadata(self._dataset_id(path[-1])) if path else {}

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        metadata = self.get_metadata([source_table])
        result: dict[str, Any] = {"columns": metadata.get("columns", [])}
        if metadata.get("description"):
            result["description"] = metadata["description"]
        return result

    def query_model(self, source_table: str) -> str:
        return "semantic"

    def _leaf_metadata(self, dataset_id: str, refresh: bool = False) -> dict[str, Any]:
        if refresh or dataset_id not in self._fields_cache:
            self._fields_cache[dataset_id] = self._build_metadata(dataset_id, self._execute(dataset_id, _METADATA_DAX))
        return self._fields_cache[dataset_id]

    def _build_metadata(self, dataset_id: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        items = [{key.strip("[]"): value for key, value in row.items()} for row in rows]
        tables = {item["T"]: item for item in items if item["K"] == "table"}
        hidden_tables = {name for name, item in tables.items() if item.get("H")}

        def visible(item: dict[str, Any]) -> bool:
            return not item.get("H") and item.get("T") not in hidden_tables and item.get("X") != "RowNumber"

        columns = [item for item in items if item["K"] == "column" and visible(item)]
        measures = [item for item in items if item["K"] == "measure" and visible(item)]
        measure_names = {item["N"] for item in measures}
        column_counts: dict[str, int] = {}
        for item in columns:
            column_counts[item["N"]] = column_counts.get(item["N"], 0) + 1

        fields: list[dict[str, Any]] = []
        for item in measures:
            folder = f" in {item['G']}" if item.get("G") else ""
            field = {"name": item["N"], "ref": dax_name(item["N"]), "type": "number", "role": "measure",
                     "entity": item["T"], "description": f"Measure{folder}: {item.get('D') or item['N']}"}
            if item.get("F"):
                field["format"] = item["F"]
            fields.append(field)
        for item in columns:
            name = item["N"]
            if column_counts[name] > 1 or name in measure_names:
                name = f"{item['T']}[{item['N']}]"
            data_type = item.get("Y") or "Text"
            column_ref = f"{dax_table(item['T'])}{dax_name(item['N'])}"
            implicit = _IMPLICIT_AGGREGATIONS.get(item.get("S") or "")
            if implicit and data_type in _INTEGER_TYPES | _NUMBER_TYPES:
                aggregation = implicit.lower()
                field = {"name": name, "ref": f"{implicit}({column_ref})", "type": "number",
                         "data_type": "Integer" if implicit in {"COUNT", "DISTINCTCOUNT"} else "Number" if implicit == "AVERAGE" else data_type,
                         "role": "measure", "aggregation": aggregation, "entity": item["T"],
                         "description": f"Measure: {aggregation} of {item['T']}[{item['N']}]. {item.get('D') or ''}".strip()}
                if item.get("F"):
                    field["format"] = item["F"]
                fields.append(field)
                continue
            role = "time_dimension" if data_type in _TIME_TYPES else "dimension"
            kind = ("time" if role == "time_dimension" else "number" if data_type in _INTEGER_TYPES | _NUMBER_TYPES
                    else "boolean" if data_type == "Boolean" else "string")
            label = "Time dimension" if role == "time_dimension" else "Dimension"
            field = {"name": name, "ref": column_ref, "type": kind,
                     "data_type": data_type, "role": role, "entity": item["T"],
                     "description": f"{label}: {item.get('D') or item['N']}"}
            if item.get("F"):
                field["format"] = item["F"]
            fields.append(field)

        relationships = [
            {"from": f"{item['T']}[{item['N']}]", "to": f"{item['Y']}[{item['D']}]",
             "cardinality": f"{str(item.get('G') or '').lower()}_to_{str(item.get('X') or '').lower()}",
             "cross_filter": "both" if item.get("F") == "BothDirections" else "single",
             **({"active": False} if item.get("H") else {})}
            for item in items if item["K"] == "relationship"
        ]
        dataset = self._models.get(dataset_id) or {}
        metadata: dict[str, Any] = {"query_model": "semantic", "dataset_id": dataset_id, "columns": fields}
        if dataset.get("name"):
            metadata["_source_name"] = dataset["name"]
        description = (dataset.get("description") or "").strip()
        entity_notes = [f"{name}: {item['D']}" for name, item in tables.items() if name not in hidden_tables and item.get("D")]
        if description or entity_notes:
            metadata["description"] = " ".join(filter(None, [description, "Tables: " + "; ".join(entity_notes) if entity_notes else ""]))
        if relationships:
            metadata["relationships"] = relationships
        return metadata

    # -- Query ----------------------------------------------------------------

    def query_data_as_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= _MAX_ROWS:
            raise ValueError(f"Semantic query result limit must be between 1 and {_MAX_ROWS}.")
        dataset_id = self._dataset_id(source_table)
        fields = self._leaf_metadata(dataset_id).get("columns") or []
        if query.get("native") is not None:
            native = query["native"]
            self.validate_native_query(native.get("language"), native.get("text"))
            rows = self._execute(dataset_id, native["text"])[:limit]
            return self._native_to_arrow(rows)
        dax, outputs = self._compile(source_table, fields, query, limit)
        logger.info("Executing Power BI query against %s", source_table)
        rows = self._execute(dataset_id, dax)[:limit]
        return self._to_arrow(rows, outputs)

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
            # No raw rows exist; sample a few measures over one date column instead.
            fields = self._leaf_metadata(self._dataset_id(source_table)).get("columns") or []
            measures = [field for field in fields if field["role"] == "measure"]
            # Prefer authored measures over implicit column sums, led by the largest folder of the busiest table.
            has_authored = any(not field.get("aggregation") for field in measures)
            group = lambda field: (field["entity"], field["description"].split(":")[0])  # noqa: E731
            groups = [group(field) for field in measures if not (has_authored and field.get("aggregation"))]
            core = max(set(groups), key=groups.count) if groups else None
            columns = [field["name"] for field in sorted(measures, key=lambda field: (
                has_authored and bool(field.get("aggregation")), group(field) != core))][:8]
            grain = next((field for field in fields if field["role"] == "time_dimension"
                          and field["name"].split("[")[-1].rstrip("]") in ("Month", "Year")), None)
            grain = grain or next((field for field in fields if field["role"] == "time_dimension"), None)
            options["columns"] = ([grain["name"]] if grain else []) + columns
        return super().preview_data(source_table, options, purpose=purpose)

    def fetch_data_as_arrow(self, source_table: str, import_options: dict[str, Any] | None = None) -> pa.Table:
        options = import_options or {}
        if options.get("structured_query") is not None:
            query = options["structured_query"]
        else:
            if not options.get("columns"):
                raise ValueError(f"Select dimensions and measures for semantic model {source_table!r}; "
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

    def _compile(self, source_table: str, fields: list[dict[str, Any]], query: dict[str, Any],
                 limit: int) -> tuple[str, list[tuple[str, dict[str, Any]]]]:
        if query.get("group_by") or query.get("aggregates"):
            raise ValueError("Semantic models compute measures themselves: select dimensions and measures in "
                             "columns instead of group_by/aggregates.")
        columns = query.get("columns") or []
        if not columns:
            raise ValueError(f"Select at least one dimension or measure of {source_table!r} in columns. "
                             "Use describe_data to list fields.")
        if len(set(columns)) != len(columns):
            raise ValueError("Each column may be selected only once.")
        by_name = {field["name"]: field for field in fields}
        unknown = [column for column in columns if column not in by_name]
        if unknown:
            raise ValueError(f"Unknown fields {unknown} for semantic model {source_table!r}. "
                             "Use describe_data to list fields.")
        selected = [by_name[column] for column in columns]
        dimensions = [field for field in selected if field["role"] != "measure"]
        measures = [field for field in selected if field["role"] == "measure"]
        if not measures and len({field["entity"] for field in dimensions}) > 1:
            raise ValueError("Dimensions from different tables need at least one measure; without one, Power BI "
                             "returns every combination instead of the ones that occur in the data.")

        aliases = {field["name"]: f"__c{index}" for index, field in enumerate(selected)}
        args = [field["ref"] for field in dimensions]
        args += self._compile_filters(by_name, query.get("filters") or [])
        args += [f"{dax_string(aliases[field['name']])}, {field['ref']}" for field in measures]
        table = f"SUMMARIZECOLUMNS({', '.join(args)})"

        def row_ref(field: dict[str, Any]) -> str:
            return field["ref"] if field["role"] != "measure" else dax_name(aliases[field["name"]])

        order = []
        for item in query.get("order_by") or []:
            if item.get("column") not in aliases:
                raise ValueError(f"order_by column {item.get('column')!r} must be one of the selected columns.")
            order.append((by_name[item["column"]], "DESC" if item.get("dir") == "desc" else "ASC"))
        ordering = ", ".join(f"{row_ref(field)}, {direction}" for field, direction in order)
        table = f"TOPN({limit}, {table}{', ' + ordering if ordering else ''})"
        projection = ", ".join(f"{dax_string(aliases[field['name']])}, {row_ref(field)}" for field in selected)
        dax = f"EVALUATE SELECTCOLUMNS({table}, {projection})"
        if order:
            dax += " ORDER BY " + ", ".join(f"{dax_name(aliases[field['name']])} {direction}" for field, direction in order)
        return dax, [(aliases[field["name"]], field) for field in selected]

    @staticmethod
    def _literal(field: dict[str, Any], value: Any) -> str:
        data_type = field.get("data_type")
        if value is None:
            return "BLANK()"
        if data_type in _INTEGER_TYPES | _NUMBER_TYPES:
            if isinstance(value, bool):
                raise ValueError(f"Filter value for {field['name']!r} must be a number.")
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Filter value for {field['name']!r} must be a number.") from exc
            return str(int(number)) if number.is_integer() and data_type in _INTEGER_TYPES else repr(number)
        if data_type == "Boolean":
            truthy = value if isinstance(value, bool) else str(value).strip().lower() in {"true", "1"}
            return "TRUE()" if truthy else "FALSE()"
        if data_type in _TIME_TYPES:
            try:
                moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValueError(f"Filter value for {field['name']!r} must be an ISO date.") from exc
            text = f"DATE({moment.year}, {moment.month}, {moment.day})"
            if moment.hour or moment.minute or moment.second:
                text += f" + TIME({moment.hour}, {moment.minute}, {moment.second})"
            return text
        return dax_string(value)

    def _compile_filters(self, by_name: dict[str, dict[str, Any]], filters: list[dict[str, Any]]) -> list[str]:
        compiled = []
        for item in filters:
            field = by_name.get(item.get("column"))
            if field is None:
                raise ValueError(f"Unknown filter column {item.get('column')!r}. Filter on a dimension name from describe_data.")
            if field["role"] == "measure":
                raise ValueError("Filters on measure values require a native dax query.")
            ref, op, value = field["ref"], str(item.get("op") or item.get("operator") or "").upper(), item.get("value")
            values = list(value) if isinstance(value, (list, tuple)) else [value]
            if op in {"EQ", "IN"}:
                compiled.append(f"TREATAS({{{', '.join(self._literal(field, v) for v in values)}}}, {ref})")
                continue
            if op in {"NEQ", "NOT_IN"}:
                predicate = f"NOT ({ref} IN {{{', '.join(self._literal(field, v) for v in values)}}})"
            elif op in {"GT", "GTE", "LT", "LTE"}:
                symbol = {"GT": ">", "GTE": ">=", "LT": "<", "LTE": "<="}[op]
                predicate = f"{ref} {symbol} {self._literal(field, values[0])}"
            elif op == "BETWEEN":
                if len(values) != 2:
                    raise ValueError("BETWEEN requires two values.")
                predicate = f"{ref} >= {self._literal(field, values[0])} && {ref} <= {self._literal(field, values[1])}"
            elif op in {"IS_NULL", "IS_NOT_NULL"}:
                predicate = f"{'' if op == 'IS_NULL' else 'NOT '}ISBLANK({ref})"
            elif op in {"LIKE", "ILIKE"}:
                pattern = str(values[0])
                core = pattern.strip("%")
                if not core or "%" in core:
                    raise ValueError("LIKE patterns support only leading and/or trailing % wildcards.")
                starts, ends = pattern.startswith("%"), pattern.endswith("%")
                literal = dax_string(core)
                predicate = (f"CONTAINSSTRING({ref}, {literal})" if starts and ends
                             else f"RIGHT({ref}, {len(core)}) = {literal}" if starts
                             else f"LEFT({ref}, {len(core)}) = {literal}" if ends else f"{ref} = {literal}")
            else:
                raise ValueError(f"Unsupported filter operator {op!r} for semantic models.")
            compiled.append(f"KEEPFILTERS(FILTER(ALL({ref}), {predicate}))")
        return compiled

    # -- Native queries -------------------------------------------------------

    def validate_native_query(self, language: str, text: str) -> None:
        if language != "dax":
            raise ValueError("This connector supports native dax queries only.")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("dax must be one DAX query.")
        stripped, has_comment = _strip_dax(text)
        if has_comment:
            raise ValueError("dax queries may not contain comments.")
        if ";" in stripped:
            raise ValueError("dax must be a single query without semicolons.")
        if not re.match(r"^\s*(DEFINE|EVALUATE)\b", stripped, re.IGNORECASE):
            raise ValueError("dax must start with DEFINE or EVALUATE.")
        if len(re.findall(r"\bEVALUATE\b", stripped, re.IGNORECASE)) != 1:
            raise ValueError("dax must contain exactly one EVALUATE (one result table).")
        if re.search(r"\bINFO\s*\.", stripped, re.IGNORECASE) or "$SYSTEM" in stripped.upper():
            raise ValueError("dax may not query model metadata; use describe_data instead.")

    # -- Results --------------------------------------------------------------

    @staticmethod
    def _column_array(values: list[Any], field: dict[str, Any] | None) -> pa.Array:
        data_type = (field or {}).get("data_type")
        series = pd.Series(values, dtype="object")
        if data_type in _TIME_TYPES:
            return pa.array(pd.to_datetime(series, errors="coerce"), from_pandas=True)
        if data_type == "Boolean":
            return pa.array([None if v is None else bool(v) for v in values], type=pa.bool_())
        if data_type in _INTEGER_TYPES:
            return pa.array(pd.to_numeric(series, errors="coerce").astype("Int64"), from_pandas=True)
        if data_type in _NUMBER_TYPES:
            return pa.array(pd.to_numeric(series, errors="coerce").astype("float64"), from_pandas=True)
        present = [v for v in values if v is not None]
        if present and all(isinstance(v, bool) for v in present):
            return pa.array(values, type=pa.bool_())
        if present and all(isinstance(v, int) and not isinstance(v, bool) for v in present):
            return pa.array(values, type=pa.int64())
        if present and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
            return pa.array([None if v is None else float(v) for v in values], type=pa.float64())
        return pa.array([None if v is None else str(v) for v in values], type=pa.string())

    def _to_arrow(self, rows: list[dict[str, Any]], outputs: list[tuple[str, dict[str, Any]]]) -> pa.Table:
        return pa.table({field["name"]: self._column_array([row.get(f"[{alias}]") for row in rows], field)
                         for alias, field in outputs})

    def _native_to_arrow(self, rows: list[dict[str, Any]]) -> pa.Table:
        keys = list(rows[0]) if rows else []
        short = [key[key.index("[") + 1:-1] if "[" in key and key.endswith("]") else key for key in keys]
        names = [s if short.count(s) == 1 else key for key, s in zip(keys, short)]
        return pa.table({name: self._column_array([row.get(key) for row in rows], None) for key, name in zip(keys, names)})
