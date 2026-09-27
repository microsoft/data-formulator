# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""CubeDataLoader — semantic-layer connector for Cube (https://cube.dev).

Each public cube or view is one semantic leaf whose columns are its
dimensions and measures. Selecting dimensions and measures is the query;
Cube groups by the selected dimensions and computes governed measures.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any
from urllib.parse import urlsplit

import pandas as pd
import pyarrow as pa
import requests

from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.query_runtime import check_cancelled
from data_formulator.security.sanitize import sanitize_error_message

logger = logging.getLogger(__name__)

_DEFAULT_GRANULARITIES = ("day", "week", "month", "quarter", "year")
_GRAIN_NAME_RE = re.compile(r"^(?P<base>.+) \((?P<grain>[A-Za-z_][A-Za-z0-9_]*)\)$")
_NATIVE_KEYS = {"measures", "dimensions", "timeDimensions", "filters", "segments", "order", "limit", "offset", "timezone"}
_INTEGER_AGGREGATIONS = {"count", "countDistinct", "countDistinctApprox"}
_REQUEST_TIMEOUT_SECONDS = 30
_QUERY_TIMEOUT_SECONDS = 120
_MAX_ROWS = 10_001


class CubeDataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Cube"
    DESCRIPTION = "Query governed measures and dimensions from a Cube semantic layer."
    QUERY_EXECUTION = "semantic_query"
    AUTH_GUIDE = "cube.md"

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "api_url", "type": "string", "required": True, "tier": "connection",
             "description": "Cube REST API URL, e.g. http://localhost:4000 (defaults to the /cubejs-api base path)"},
            {"name": "api_token", "type": "password", "required": False, "sensitive": True, "tier": "auth",
             "description": "Cube API token (JWT signed with the API secret); not needed for dev-mode servers"},
        ]

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [{"key": "table", "label": "Cube / View"}]

    @classmethod
    def query_capabilities(cls) -> dict[str, Any]:
        return {
            **super().query_capabilities(),
            "native_query_languages": ["cube_json"],
            "native_query_guidance": (
                "One Cube REST query object as JSON text, using member refs from describe_data "
                "(e.g. {\"measures\": [\"orders.count\"], \"dimensions\": [\"orders.status\"], "
                "\"filters\": [{\"member\": \"orders.count\", \"operator\": \"gt\", \"values\": [\"100\"]}]}). "
                "Members must belong to the selected cube or view. Use it for measure-value filters "
                "or shapes the structured query cannot express. Maximum 10000 rows."
            ),
        }

    def __init__(self, params: dict[str, Any]):
        self.params = params
        url = str(params.get("api_url") or "").strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise ValueError("Cube API URL must start with http:// or https://")
        if not urlsplit(url).path:
            url += "/cubejs-api"
        token = str(params.get("api_token") or "").strip()
        self.api_url = url
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})
        if token:
            self._session.headers["Authorization"] = token
        self._meta_cache: dict[str, Any] | None = None

    # -- HTTP -----------------------------------------------------------------

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._session.request(
            method, f"{self.api_url}{path}", json=body, timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code >= 400:
            detail = payload.get("error") if isinstance(payload, dict) else None
            raise ValueError(sanitize_error_message(
                f"Cube API error {response.status_code}: {detail or response.reason}"
            ))
        return payload if isinstance(payload, dict) else {}

    def _meta(self, refresh: bool = False) -> dict[str, Any]:
        if refresh or self._meta_cache is None:
            self._meta_cache = self._request("GET", "/v1/meta")
        return self._meta_cache

    def _cube(self, name: str) -> dict[str, Any]:
        for cube in self._meta().get("cubes", []):
            if cube.get("name") == name:
                if not cube.get("public", True) or not cube.get("isVisible", True) or not self._fields(cube):
                    raise ValueError(f"Cube {name!r} is private or has no visible fields. Refresh the catalog and use a public view.")
                return cube
        raise ValueError(f"Cube or view {name!r} was not found. Refresh the catalog and use an exact table_key.")

    def _load(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        started = time.monotonic()
        while True:
            check_cancelled()
            payload = self._request("POST", "/v1/load", {"query": query})
            if payload.get("error") != "Continue wait":
                break
            if time.monotonic() - started > _QUERY_TIMEOUT_SECONDS:
                raise TimeoutError("Cube query did not finish within 120 seconds.")
            time.sleep(1)
        if payload.get("error"):
            raise ValueError(sanitize_error_message(f"Cube query failed: {payload['error']}"))
        data = payload.get("data")
        return data if isinstance(data, list) else []

    # -- Catalog --------------------------------------------------------------

    def test_connection(self) -> bool:
        try:
            self._meta(refresh=True)
            return True
        except Exception:
            return False

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        meta = self._meta(refresh=True)
        needle = (table_filter or "").casefold()
        tables = []
        for cube in meta.get("cubes", []):
            name = cube.get("name")
            if not name or (needle and needle not in f"{name} {cube.get('title', '')}".casefold()):
                continue
            # Dev-mode servers also return private cubes, whose members are all hidden.
            if not cube.get("public", True) or not cube.get("isVisible", True) or not self._fields(cube):
                continue
            tables.append({
                "name": name,
                "table_key": name,
                "path": [name],
                "metadata": self._leaf_metadata(cube, meta.get("cubes", [])),
            })
        return tables

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        cube = self._cube(path[-1])
        return self._leaf_metadata(cube, self._meta().get("cubes", []))

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        metadata = self.get_metadata([source_table])
        result: dict[str, Any] = {"columns": metadata["columns"]}
        if metadata.get("description"):
            result["description"] = metadata["description"]
        return result

    def query_model(self, source_table: str) -> str:
        return "semantic"

    def _leaf_metadata(self, cube: dict[str, Any], cubes: list[dict[str, Any]]) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "query_model": "semantic",
            "_source_name": cube["name"],
            "cube_type": cube.get("type", "cube"),
            "columns": self._fields(cube),
        }
        description = (cube.get("description") or "").strip() or cube.get("title")
        if description:
            metadata["description"] = description
        component = cube.get("connectedComponent")
        if component is not None and cube.get("type", "cube") == "cube":
            joinable = [other["name"] for other in cubes if other.get("name") != cube["name"]
                        and other.get("type", "cube") == "cube" and other.get("connectedComponent") == component]
            if joinable:
                metadata["relationships"] = [{"from": cube["name"], "to": other, "kind": "joinable"} for other in joinable]
        return metadata

    @staticmethod
    def _fields(cube: dict[str, Any]) -> list[dict[str, Any]]:
        members = [(member, "measure") for member in cube.get("measures", [])]
        members += [(member, "time_dimension" if member.get("type") == "time" else "dimension")
                    for member in cube.get("dimensions", [])]
        members = [(member, role) for member, role in members
                   if member.get("name") and member.get("isVisible", True) and member.get("public", True)]

        def caption(member: dict[str, Any]) -> str:
            return member.get("shortTitle") or member.get("title") or member["name"].split(".")[-1]

        short = [caption(member) for member, _ in members]
        titled = [member.get("title") or member["name"] for member, _ in members]
        fields = []
        for index, (member, role) in enumerate(members):
            name = short[index]
            if short.count(name) > 1:
                name = titled[index] if titled.count(titled[index]) == 1 else member["name"]
            field: dict[str, Any] = {
                "name": name,
                "ref": member["name"],
                "type": "number" if role == "measure" else member.get("type", "string"),
                "role": role,
                "entity": (member.get("aliasMember") or member["name"]).split(".")[0],
            }
            description = (member.get("description") or "").strip() or member.get("title") or name
            if role == "measure":
                aggregation = member.get("aggType")
                if aggregation:
                    field["aggregation"] = aggregation
                label = f"Measure ({aggregation})" if aggregation else "Measure"
            elif role == "time_dimension":
                custom = [item.get("name") for item in member.get("granularities") or [] if item.get("name")]
                field["granularities"] = list(dict.fromkeys([*_DEFAULT_GRANULARITIES, *custom]))
                label = f"Time dimension; select as '{name} (month)' etc."
            else:
                label = "Dimension"
            if member.get("format"):
                field["format"] = member["format"] if isinstance(member["format"], str) else json.dumps(member["format"])
            field["description"] = f"{label}: {description}"
            fields.append(field)
        return fields

    # -- Query ----------------------------------------------------------------

    def query_data_as_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= _MAX_ROWS:
            raise ValueError(f"Semantic query result limit must be between 1 and {_MAX_ROWS}.")
        cube = self._cube(source_table)
        fields = self._fields(cube)
        if query.get("native") is not None:
            native = query["native"]
            self.validate_native_query(native.get("language"), native.get("text"))
            cube_query = json.loads(native["text"])
            self._check_native_members(cube_query, fields)
            requested = cube_query.get("limit")
            cube_query["limit"] = min(requested, limit) if isinstance(requested, int) and requested > 0 else limit
            outputs = self._native_outputs(cube_query, fields)
        else:
            cube_query, outputs = self._compile(source_table, fields, query)
            cube_query["limit"] = limit
        logger.info("Executing Cube query against %s", source_table)
        return self._to_arrow(self._load(cube_query), outputs)

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        out_limit = probe_utils.clamp_probe_limit((query or {}).get("limit"))
        try:
            table = self.query_data_as_arrow(path[-1], query or {}, out_limit)
        except (ValueError, TimeoutError, requests.RequestException) as exc:
            return {"error": f"probe failed: {exc}"}
        return probe_utils.shape_probe_payload(table, out_limit, exact=True)

    def preview_data(self, source_table: str, import_options: dict[str, Any] | None = None,
                     *, purpose: str = "ui") -> dict[str, Any]:
        options = dict(import_options or {})
        if not options.get("columns") and options.get("structured_query") is None:
            # No raw rows exist; sample measures grouped by every dimension instead.
            fields = self._fields(self._cube(source_table))
            columns = [field["name"] for field in fields if field["role"] == "measure"][:8]
            columns += [field["name"] if field["role"] == "dimension" else f"{field['name']} (month)"
                        for field in fields if field["role"] != "measure"]
            options["columns"] = columns[:20]
        return super().preview_data(source_table, options, purpose=purpose)

    def fetch_data_as_arrow(self, source_table: str, import_options: dict[str, Any] | None = None) -> pa.Table:
        options = import_options or {}
        if options.get("structured_query") is not None:
            query = options["structured_query"]
        else:
            if not options.get("columns"):
                raise ValueError(
                    f"Select dimensions and measures for semantic model {source_table!r}; "
                    "it cannot be loaded as raw rows."
                )
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

    def _compile(
        self, source_table: str, fields: list[dict[str, Any]], query: dict[str, Any],
    ) -> tuple[dict[str, Any], list[tuple[str, str, dict[str, Any]]]]:
        if query.get("group_by") or query.get("aggregates"):
            raise ValueError(
                "Semantic models compute measures themselves: select dimensions and measures in "
                "columns instead of group_by/aggregates."
            )
        columns = query.get("columns") or []
        if not columns:
            raise ValueError(
                f"Select at least one dimension or measure of {source_table!r} in columns. "
                "Use describe_data to list fields."
            )
        if len(set(columns)) != len(columns):
            raise ValueError("Each column may be selected only once.")
        by_name = {field["name"]: field for field in fields}
        cube_query: dict[str, Any] = {}
        outputs: list[tuple[str, str, dict[str, Any]]] = []
        for column in columns:
            field = by_name.get(column)
            if field is not None:
                key = "measures" if field["role"] == "measure" else "dimensions"
                cube_query.setdefault(key, []).append(field["ref"])
                outputs.append((column, field["ref"], field))
                continue
            match = _GRAIN_NAME_RE.match(column)
            field = by_name.get(match.group("base")) if match else None
            if field is None or field["role"] != "time_dimension" or match.group("grain") not in field["granularities"]:
                raise ValueError(
                    f"Unknown field {column!r} for semantic model {source_table!r}. "
                    "Use describe_data to list fields; select time grains as 'Name (grain)'."
                )
            grain = match.group("grain")
            cube_query.setdefault("timeDimensions", []).append({"dimension": field["ref"], "granularity": grain})
            outputs.append((column, f"{field['ref']}.{grain}", field))
        filters = self._compile_filters(by_name, query.get("filters") or [])
        if filters:
            cube_query["filters"] = filters
        keys = {name: key for name, key, _ in outputs}
        order = []
        for item in query.get("order_by") or []:
            if item.get("column") not in keys:
                raise ValueError(f"order_by column {item.get('column')!r} must be one of the selected columns.")
            order.append([keys[item["column"]], "desc" if item.get("dir") == "desc" else "asc"])
        if order:
            cube_query["order"] = order
        return cube_query, outputs

    @staticmethod
    def _compile_filters(by_name: dict[str, dict[str, Any]], filters: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def text(value: Any) -> str:
            if isinstance(value, bool):
                return "true" if value else "false"
            return str(value)

        compiled: list[dict[str, Any]] = []
        for item in filters:
            field = by_name.get(item.get("column"))
            if field is None:
                raise ValueError(f"Unknown filter column {item.get('column')!r}. Filter on a dimension name from describe_data.")
            if field["role"] == "measure":
                raise ValueError("Filters on measure values require a native cube_json query.")
            member, op, value = field["ref"], str(item.get("op") or item.get("operator") or "").upper(), item.get("value")
            values = [text(v) for v in value] if isinstance(value, (list, tuple)) else [text(value)]
            simple = {"EQ": "equals", "IN": "equals", "NEQ": "notEquals", "NOT_IN": "notEquals",
                      "GT": "gt", "GTE": "gte", "LT": "lt", "LTE": "lte"}
            if op in simple:
                if field["role"] == "time_dimension" and op in {"GT", "GTE", "LT", "LTE"}:
                    date_ops = {"GT": "afterDate", "GTE": "afterOrOnDate", "LT": "beforeDate", "LTE": "beforeOrOnDate"}
                    compiled.append({"member": member, "operator": date_ops[op], "values": values[:1]})
                else:
                    compiled.append({"member": member, "operator": simple[op], "values": values})
            elif op in {"IS_NULL", "IS_NOT_NULL"}:
                compiled.append({"member": member, "operator": "notSet" if op == "IS_NULL" else "set"})
            elif op == "BETWEEN":
                if len(values) != 2:
                    raise ValueError("BETWEEN requires two values.")
                if field["role"] == "time_dimension":
                    compiled.append({"member": member, "operator": "inDateRange", "values": values})
                else:
                    compiled += [{"member": member, "operator": "gte", "values": values[:1]},
                                 {"member": member, "operator": "lte", "values": values[1:]}]
            elif op in {"LIKE", "ILIKE"}:
                pattern = values[0]
                core = pattern.strip("%")
                if not core or "%" in core:
                    raise ValueError("LIKE patterns support only leading and/or trailing % wildcards.")
                starts, ends = pattern.startswith("%"), pattern.endswith("%")
                operator = "contains" if starts and ends else "endsWith" if starts else "startsWith" if ends else "equals"
                compiled.append({"member": member, "operator": operator, "values": [core]})
            else:
                raise ValueError(f"Unsupported filter operator {op!r} for semantic models.")
        return compiled

    # -- Native queries -------------------------------------------------------

    def validate_native_query(self, language: str, text: str) -> None:
        if language != "cube_json":
            raise ValueError("This connector supports native cube_json queries only.")
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError) as exc:
            raise ValueError("cube_json must be one JSON query object.") from exc
        if not isinstance(parsed, dict):
            raise ValueError("cube_json must be one JSON query object, not an array.")
        unknown = set(parsed) - _NATIVE_KEYS
        if unknown:
            raise ValueError(f"Unsupported cube_json fields: {sorted(unknown)}. Allowed: {sorted(_NATIVE_KEYS)}.")
        if not parsed.get("measures") and not parsed.get("dimensions") and not parsed.get("timeDimensions"):
            raise ValueError("cube_json must select measures, dimensions, or timeDimensions.")
        limit = parsed.get("limit")
        if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= _MAX_ROWS):
            raise ValueError(f"cube_json limit must be between 1 and {_MAX_ROWS}.")

    @staticmethod
    def _check_native_members(query: dict[str, Any], fields: list[dict[str, Any]]) -> None:
        refs = {field["ref"] for field in fields}
        grains = {f"{field['ref']}.{grain}" for field in fields for grain in field.get("granularities", [])}
        used: list[Any] = [*query.get("measures", []), *query.get("dimensions", []),
                           *(item.get("dimension") for item in query.get("timeDimensions", []) if isinstance(item, dict))]

        def collect(filters: list[Any]) -> None:
            for item in filters:
                if not isinstance(item, dict):
                    raise ValueError("cube_json filters must be objects.")
                if "member" in item:
                    used.append(item["member"])
                collect(item.get("and", []) + item.get("or", []))

        collect(query.get("filters", []))
        order = query.get("order") or {}
        used += list(order) if isinstance(order, dict) else [item[0] for item in order if isinstance(item, list) and item]
        outside = sorted({str(member) for member in used if member not in refs and member not in grains})
        if outside:
            raise ValueError(f"cube_json members must belong to the selected cube or view: {outside}.")

    @staticmethod
    def _native_outputs(query: dict[str, Any], fields: list[dict[str, Any]]) -> list[tuple[str, str, dict[str, Any]]]:
        by_ref = {field["ref"]: field for field in fields}
        outputs = [(by_ref[ref]["name"], ref, by_ref[ref]) for ref in [*query.get("measures", []), *query.get("dimensions", [])]]
        for item in query.get("timeDimensions", []):
            if item.get("granularity"):
                field = by_ref[item["dimension"]]
                outputs.append((f"{field['name']} ({item['granularity']})", f"{item['dimension']}.{item['granularity']}", field))
        return outputs

    # -- Results --------------------------------------------------------------

    @staticmethod
    def _to_arrow(rows: list[dict[str, Any]], outputs: list[tuple[str, str, dict[str, Any]]]) -> pa.Table:
        columns: dict[str, pa.Array] = {}
        for name, key, field in outputs:
            values = [row.get(key) for row in rows]
            kind = field.get("type")
            if kind == "number":
                integer = field.get("aggregation") in _INTEGER_AGGREGATIONS
                numbers = pd.to_numeric(pd.Series(values, dtype="object"), errors="coerce")
                columns[name] = pa.array(numbers.astype("Int64" if integer else "float64"), from_pandas=True)
            elif kind == "time":
                columns[name] = pa.array(pd.to_datetime(pd.Series(values, dtype="object"), errors="coerce", utc=True)
                                         .dt.tz_localize(None), from_pandas=True)
            elif kind == "boolean":
                columns[name] = pa.array([None if v is None else str(v).lower() in {"true", "1"} for v in values],
                                         type=pa.bool_())
            else:
                columns[name] = pa.array([None if v is None else str(v) for v in values], type=pa.string())
        return pa.table(columns)
