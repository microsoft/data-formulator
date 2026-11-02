# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Validate a map spec before it is saved (the renderer's checks are in src/maps/spec.ts).

Errors refuse the write; warnings go back to the model with the saved file: fields that
are missing from a table, region keys that match no boundary, coordinates out of range,
controls whose field has a single value. Data checks read each source once through the
same read-only workspace SQL the map uses when it draws.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from data_formulator.analyst.skills.map.geo import layer_geo_set, normalize_key, region_id
from data_formulator.analyst.skills.map.templates import compile_template, offered_columns, template_errors

logger = logging.getLogger(__name__)

PROJECTIONS = ("equalEarth", "naturalEarth", "mercator", "equirectangular", "orthographic", "albersUsa",
               "albers", "conicEqualArea", "azimuthalEqualArea", "stereographic", "transverseMercator")
BASEMAPS = ("world", "world-detailed", "us-states", "us-counties", "none")
TILES = ("none", "light", "dark", "streets")
STYLES = ("light", "muted", "atlas", "dark", "minimal")
# Flint semantic types whose values add up across places (design-docs/70): on a choropleth they favour big regions.
ADDITIVE_TYPES = ("Count", "Amount", "Quantity", "Profit")
KEY_TYPES = ("auto", "iso3", "iso2", "iso-numeric", "country-name", "us-state", "fips", "property")
FLOW_DIRECTIONS = ("arrow", "taper", "animate", "none")
LAYER_TYPES = ("regions", "bubbles", "points", "heatmap", "hexbin", "flows", "spikes", "labels", "paths", "shapes", "vectors")
CLASS_METHODS = ("continuous", "quantile", "equal", "jenks", "threshold", "log")
AGGREGATES = ("sum", "mean", "median", "min", "max", "count", "first")
CONTROL_TYPES = ("slider", "select", "checkboxes", "range", "search", "layers", "details", "stats")
FILTER_OPS = ("==", "!=", ">", ">=", "<", "<=", "in", "between", "contains")
PARAM_CONTROLS = ("slider", "select", "checkboxes", "range")
# Past this many values a checkbox per value is noise.
MAX_FILTER_VALUES = 30
BUILT_IN_SETS = ("countries", "countries-detailed", "us-states", "us-counties")

MAX_LAYERS = 12
MAX_CONTROLS = 12
MAX_INLINE_ROWS = 2000
VALIDATION_ROWS = 20_000


def _is_param(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"param"} and isinstance(value["param"], str)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def check_structure(spec: Any) -> tuple[list[str], list[str]]:
    """Shape errors (which stop the map from drawing) and warnings."""
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(spec, dict):
        return ["The map must be a JSON object."], warnings
    view = spec.get("view", {})
    if not isinstance(view, dict):
        errors.append("view must be an object.")
        view = {}
    for key, allowed in (("projection", PROJECTIONS), ("basemap", BASEMAPS), ("tiles", TILES), ("style", STYLES)):
        if key in view and view[key] not in allowed:
            errors.append(f"view.{key} must be one of {', '.join(allowed)}.")
    for key in ("center", "rotate"):
        value = view.get(key)
        if value is not None and not (isinstance(value, list) and 2 <= len(value) <= 3
                                      and all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value)):
            errors.append(f"view.{key} must be [longitude, latitude] numbers.")
    if "theme" in view and not isinstance(view["theme"], str):
        errors.append("view.theme must be a chart theme id (or \"none\").")
    if "labels" in view and not isinstance(view["labels"], bool):
        errors.append("view.labels must be true or false.")
    fields = spec.get("fields", {})
    if not isinstance(fields, dict):
        errors.append("fields must map field names to semantic annotations.")
        fields = {}
    for name, annotation in fields.items():
        if isinstance(annotation, str):
            continue
        if not isinstance(annotation, dict) or not isinstance(annotation.get("semanticType", ""), str):
            errors.append(f"fields.{name} must be a semantic type or {{\"semanticType\", \"unit\", \"displayName\", ...}}.")
        elif "divergingMidpoint" in annotation and not isinstance(annotation["divergingMidpoint"], (int, float)):
            errors.append(f"fields.{name}.divergingMidpoint must be a number.")
    if view.get("tiles") not in (None, "none") and view.get("projection") not in (None, "mercator"):
        warnings.append("Street tiles draw only in the Mercator projection; the map uses Mercator.")

    data = spec.get("data", {})
    if not isinstance(data, dict):
        errors.append("data must be an object of named sources.")
        data = {}
    for name, source in data.items():
        if not isinstance(source, dict):
            errors.append(f"data.{name} must be an object.")
        elif isinstance(source.get("table"), str) and source["table"]:
            pass
        elif isinstance(source.get("sql"), str) and isinstance(source.get("tables"), list):
            pass
        elif isinstance(source.get("values"), list):
            if len(source["values"]) > MAX_INLINE_ROWS:
                errors.append(f"data.{name} embeds {len(source['values'])} rows; keep inline values under {MAX_INLINE_ROWS} "
                              "and read larger data from a workspace table.")
        else:
            errors.append(f"data.{name} needs a table, sql with tables, or inline values.")

    layers = spec.get("layers")
    if not isinstance(layers, list):
        errors.append("layers must be a list.")
        layers = []
    if len(layers) > MAX_LAYERS:
        errors.append(f"Use at most {MAX_LAYERS} layers.")
    ids: list[str] = []
    for index, layer in enumerate(layers):
        if not isinstance(layer, dict):
            errors.append(f"layers[{index}] must be an object.")
            continue
        where = f"layers[{index}]" + (f" ({layer['name']})" if isinstance(layer.get("name"), str) else "")
        kind = layer.get("type")
        if kind not in LAYER_TYPES:
            errors.append(f"{where}.type must be one of {', '.join(LAYER_TYPES)}.")
            continue
        ids.append(layer.get("id") if isinstance(layer.get("id"), str) and layer.get("id") else f"layer{index + 1}")
        if "data" in layer and layer["data"] not in data:
            errors.append(f"{where} reads data \"{layer['data']}\", which is not defined in data.")
        if kind != "shapes" and not layer.get("data"):
            errors.append(f"{where} needs data.")

        def located(location: Any) -> bool:
            return isinstance(location, dict) and (bool(location.get("key")) or (bool(location.get("lon")) and bool(location.get("lat"))))

        if kind == "flows":
            if not located(layer.get("from")) or not located(layer.get("to")):
                errors.append(f"{where}: flows need from and to, each a key or lon/lat.")
        elif kind == "regions":
            if not layer.get("key"):
                errors.append(f"{where}: regions need key, the field naming each row's region.")
        elif kind in ("points", "heatmap", "hexbin", "paths", "vectors"):
            if not layer.get("lon") or not layer.get("lat"):
                errors.append(f"{where}: {kind} need lon and lat fields.")
            if kind == "vectors" and not layer.get("angle") and not (layer.get("u") and layer.get("v")):
                errors.append(f"{where}: vectors need angle (degrees clockwise from north) or u and v (east and north components).")
        elif kind == "shapes":
            if not isinstance(layer.get("geo"), str):
                errors.append(f"{where}: shapes need geo, a built-in set or a files/… GeoJSON.")
        elif not located(layer):
            errors.append(f"{where}: {kind} need key or lon and lat.")
        if kind == "labels" and not layer.get("text"):
            errors.append(f"{where}: labels need text, the field to show.")
        for location in (layer, layer.get("from"), layer.get("to")):
            if isinstance(location, dict) and "keyType" in location and location["keyType"] not in KEY_TYPES:
                errors.append(f"{where}.keyType must be one of {', '.join(KEY_TYPES)}.")
        color = layer.get("color")
        if kind == "regions" and isinstance(color, dict) and isinstance(color.get("field"), str):
            declared = fields.get(color["field"])
            semantic = declared if isinstance(declared, str) else declared.get("semanticType") if isinstance(declared, dict) else None
            if semantic in ADDITIVE_TYPES:
                warnings.append(f"{where} colours regions by {color['field']}, a {semantic} that adds up: big regions dominate. "
                                "Map a rate (per capita, share) instead, or show the totals as bubbles.")
        if isinstance(color, dict):
            if "method" in color and color["method"] not in CLASS_METHODS:
                errors.append(f"{where}.color.method must be one of {', '.join(CLASS_METHODS)}.")
            if color.get("method") == "threshold" and not color.get("thresholds"):
                errors.append(f"{where}.color: the threshold method needs thresholds.")
            if color.get("type") == "bivariate" and (not color.get("field") or not color.get("field2")):
                errors.append(f"{where}.color: a bivariate colour needs field and field2.")
        if "curve" in layer and layer["curve"] not in ("arc", "great-circle", "straight"):
            errors.append(f"{where}.curve must be arc, great-circle, or straight.")
        if "layout" in layer and layer["layout"] != "dorling":
            errors.append(f"{where}.layout must be dorling.")
        if "direction" in layer and layer["direction"] not in FLOW_DIRECTIONS:
            errors.append(f"{where}.direction must be one of {', '.join(FLOW_DIRECTIONS)}.")
        if ("u" in layer) != ("v" in layer):
            errors.append(f"{where}: u and v go together.")
        link = layer.get("selectionFilter")
        if link is not None and not (isinstance(link, dict) and isinstance(link.get("layer"), str) and isinstance(link.get("field"), str)):
            errors.append(f"{where}.selectionFilter needs layer and field.")
        for encoding in (color, layer.get("size")):
            if isinstance(encoding, dict) and "aggregate" in encoding and encoding["aggregate"] not in AGGREGATES:
                errors.append(f"{where}: aggregate must be one of {', '.join(AGGREGATES)}.")
        filters = layer.get("filter", [])
        if not isinstance(filters, list):
            errors.append(f"{where}.filter must be a list.")
        else:
            for item in filters:
                if not isinstance(item, dict) or not item.get("field"):
                    errors.append(f"{where}: each filter needs a field.")
                elif "op" in item and item["op"] not in FILTER_OPS:
                    errors.append(f"{where}: filter op must be one of {', '.join(FILTER_OPS)}.")
    for index, layer in enumerate(layers):
        link = layer.get("selectionFilter") if isinstance(layer, dict) else None
        if isinstance(link, dict) and isinstance(link.get("layer"), str) and link["layer"] not in ids:
            errors.append(f"layers[{index}].selectionFilter names layer \"{link['layer']}\", which does not exist.")
    duplicates = sorted({layer_id for layer_id in ids if ids.count(layer_id) > 1})
    if duplicates:
        errors.append(f"Layer id \"{duplicates[0]}\" is used twice.")

    controls = spec.get("controls", [])
    if not isinstance(controls, list):
        errors.append("controls must be a list.")
        controls = []
    if len(controls) > MAX_CONTROLS:
        errors.append(f"Use at most {MAX_CONTROLS} controls.")
    params: set[str] = set()
    for index, control in enumerate(controls):
        if not isinstance(control, dict) or control.get("type") not in CONTROL_TYPES:
            errors.append(f"controls[{index}].type must be one of {', '.join(CONTROL_TYPES)}.")
            continue
        kind = control["type"]
        if kind in PARAM_CONTROLS:
            param = control.get("param") or control.get("field")
            if not param:
                errors.append(f"controls[{index}] ({kind}) needs param or field.")
                continue
            params.add(param)
            if control.get("data") is not None and control["data"] not in data:
                errors.append(f"controls[{index}] reads data \"{control['data']}\", which is not defined.")
            if kind == "select" and not control.get("options") and not (control.get("field") and control.get("data")):
                errors.append(f"controls[{index}] (select) needs options, or field and data to list values from.")
        if kind in ("details", "stats", "search") and control.get("layer") and control["layer"] not in ids:
            errors.append(f"controls[{index}] ({kind}) names layer \"{control['layer']}\", which does not exist.")

    def check_ref(value: Any, where: str) -> None:
        if _is_param(value) and value["param"] not in params:
            errors.append(f"{where} uses param \"{value['param']}\", which no control defines.")

    for index, layer in enumerate(layers):
        if not isinstance(layer, dict):
            continue
        for key in ("color", "size"):
            if isinstance(layer.get(key), dict):
                check_ref(layer[key].get("field"), f"layers[{index}].{key}.field")
        for item in layer.get("filter", []) if isinstance(layer.get("filter"), list) else []:
            if isinstance(item, dict):
                check_ref(item.get("field"), f"layers[{index}].filter")
                check_ref(item.get("value"), f"layers[{index}].filter")
    if not layers and not errors:
        warnings.append("The map has no layers; it shows only the basemap.")
    return errors, warnings


def map_tables(spec: dict[str, Any]) -> list[str]:
    if "template" in spec and not template_errors(spec):
        spec = compile_template(spec)
    tables: list[str] = []
    for source in (spec.get("data") or {}).values():
        if isinstance(source, dict):
            if isinstance(source.get("table"), str):
                tables.append(source["table"])
            elif isinstance(source.get("tables"), list):
                tables.extend(table for table in source["tables"] if isinstance(table, str))
    return list(dict.fromkeys(tables))


def _load_rows(workspace: Any, source: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    from data_formulator.app_queries import run_app_sql
    if "values" in source:
        rows = [row for row in source["values"] if isinstance(row, dict)]
        return rows, sorted({key for row in rows for key in row})
    tables = source.get("tables") if "tables" in source else [source["table"]]
    sql = source.get("sql") or f"select * from {_quote(source['table'])}"
    result = run_app_sql(workspace, tables, sql, [], VALIDATION_ROWS)
    return result["rows"], list(result.get("columns") or (result["rows"][0].keys() if result["rows"] else []))


def _fields(layer: dict[str, Any]) -> list[tuple[str, str]]:
    """(field, role) pairs a layer reads from its rows."""
    found: list[tuple[str, str]] = []
    for role in ("key", "lon", "lat", "text", "group", "order", "weight", "angle", "u", "v"):
        if isinstance(layer.get(role), str) and (role != "key" or layer.get("type") != "shapes"):
            found.append((layer[role], role))
    for end in ("from", "to"):
        location = layer.get(end)
        if isinstance(location, dict):
            for role in ("key", "lon", "lat"):
                if isinstance(location.get(role), str):
                    found.append((location[role], f"{end}.{role}"))
    for encoding in ("color", "size"):
        value = layer.get(encoding)
        if isinstance(value, dict) and layer.get("type") != "shapes":
            for key in ("field", "field2"):
                if isinstance(value.get(key), str):
                    found.append((value[key], f"{encoding}.{key}"))
    link = layer.get("selectionFilter")
    if isinstance(link, dict) and isinstance(link.get("field"), str):
        found.append((link["field"], "selectionFilter.field"))
    tooltip = layer.get("tooltip")
    if isinstance(tooltip, list):
        for item in tooltip:
            field = item if isinstance(item, str) else item.get("field") if isinstance(item, dict) else None
            if isinstance(field, str):
                found.append((field, "tooltip"))
    for item in layer.get("filter", []) if isinstance(layer.get("filter"), list) else []:
        if isinstance(item, dict) and isinstance(item.get("field"), str):
            found.append((item["field"], "filter"))
    return found


def _custom_keys(workspace: Any, path: str, feature_key: str | None) -> tuple[set[str] | None, str | None]:
    """The normalized keys of a workspace GeoJSON/TopoJSON file, or an error."""
    name = path.removeprefix("files/")
    try:
        if not hasattr(workspace, "read_workspace_file"):
            return None, None
        _, content = workspace.read_workspace_file(name)
        document = json.loads(content.decode("utf-8"))
    except FileNotFoundError:
        return None, f"{path} does not exist; save the boundaries as a workspace file first."
    except Exception as error:  # noqa: BLE001 - any parse problem is reported to the model
        return None, f"{path} is not readable GeoJSON or TopoJSON ({error})."
    features: list[dict[str, Any]] = []
    if isinstance(document, dict) and document.get("type") == "Topology" and isinstance(document.get("objects"), dict):
        first = next(iter(document["objects"].values()), {})
        features = [{"id": item.get("id"), "properties": item.get("properties") or {}} for item in first.get("geometries", [])]
    elif isinstance(document, dict) and document.get("type") == "FeatureCollection":
        features = [item for item in document.get("features", []) if isinstance(item, dict)]
    elif isinstance(document, dict) and document.get("type") == "Feature":
        features = [document]
    else:
        return None, f"{path} is not GeoJSON or TopoJSON."
    keys: set[str] = set()
    for index, item in enumerate(features):
        properties = item.get("properties") or {}
        if feature_key:
            if feature_key not in properties:
                return None, (f"{path} features have no \"{feature_key}\" property; properties include "
                              f"{', '.join(list(properties)[:12]) or 'none'}.")
            raw = properties[feature_key]
        else:
            raw = item.get("id", properties.get("id", properties.get("name", properties.get("NAME", index))))
        keys.add(normalize_key(raw))
    return keys, None


def check_data(spec: dict[str, Any], workspace: Any, offered: list[tuple[str, str]] | None = None) -> tuple[list[str], list[str]]:
    """Check fields and joins against the data: (errors, warnings).

    ``offered`` lists a template's (channel, column) choices, checked against its ``main`` data.
    """
    errors: list[str] = []
    warnings: list[str] = []
    rows_by_source: dict[str, list[dict[str, Any]]] = {}
    columns_by_source: dict[str, list[str]] = {}
    for name, source in (spec.get("data") or {}).items():
        try:
            rows, columns = _load_rows(workspace, source)
        except (ValueError, FileNotFoundError) as error:
            errors.append(f"data.{name}: {error}")
            continue
        rows_by_source[name] = rows
        columns_by_source[name] = columns
        if name == "main":
            for channel, column in offered or []:
                if column not in columns:
                    errors.append(f"encoding.{channel}: \"{column}\" is not a column of the data (columns: {', '.join(columns[:30])}).")
        if not rows:
            warnings.append(f"data.{name} has no rows.")
    basemap = (spec.get("view") or {}).get("basemap", "world")
    custom_cache: dict[tuple[str, str | None], tuple[set[str] | None, str | None]] = {}

    for index, layer in enumerate(spec.get("layers") or []):
        where = f"layers[{index}]" + (f" ({layer['name']})" if isinstance(layer.get("name"), str) else "")
        source = layer.get("data")
        if layer.get("type") == "shapes":
            geo = layer.get("geo")
            if isinstance(geo, str) and geo.startswith("files/"):
                keys, problem = custom_cache.setdefault((geo, layer.get("featureKey")), _custom_keys(workspace, geo, layer.get("featureKey")))
                if problem:
                    errors.append(f"{where}: {problem}")
            continue
        if source not in columns_by_source:
            continue
        columns = columns_by_source[source]
        rows = rows_by_source[source]
        missing = [(field, role) for field, role in _fields(layer) if field not in columns]
        for field, role in missing:
            errors.append(f"{where}.{role}: \"{field}\" is not a column of data.{source} (columns: {', '.join(columns[:30])}).")
        if missing or not rows:
            continue
        for location, label in ((layer, ""), (layer.get("from"), "from "), (layer.get("to"), "to ")):
            if not isinstance(location, dict):
                continue
            if location.get("key"):
                key_field = location["key"]
                geo = layer_geo_set(location.get("geo"), location.get("keyType"), basemap)
                values = list(dict.fromkeys(row.get(key_field) for row in rows if row.get(key_field) not in (None, "")))
                if not values:
                    warnings.append(f"{where}: {label}key \"{key_field}\" is empty in every row.")
                    continue
                if geo in BUILT_IN_SETS:
                    unmatched = [value for value in values if region_id(value, geo, location.get("keyType", "auto")) is None]
                elif geo.startswith("files/"):
                    keys, problem = custom_cache.setdefault((geo, location.get("featureKey")), _custom_keys(workspace, geo, location.get("featureKey")))
                    if problem:
                        errors.append(f"{where}: {problem}")
                        continue
                    unmatched = [] if keys is None else [value for value in values if normalize_key(value) not in keys]
                else:
                    errors.append(f"{where}.geo must be countries, us-states, us-counties, or a files/… GeoJSON path.")
                    continue
                if unmatched:
                    share = len(unmatched) / len(values)
                    sample = ", ".join(repr(value) for value in unmatched[:8])
                    message = (f"{where}: {len(unmatched)} of {len(values)} {label}key values in \"{key_field}\" match no {geo} region "
                               f"(e.g. {sample}).")
                    if share > 0.5:
                        message += (" Check keyType and geo: countries take ISO codes or names, us-states take names, "
                                    "abbreviations, or FIPS, us-counties take 5-digit FIPS.")
                    else:
                        message += " Rename them in the data (or ignore aggregates like 'World' and regions) if they should show."
                    warnings.append(message)
            elif location.get("lon") and location.get("lat"):
                bad = 0
                for row in rows:
                    try:
                        lon, lat = float(row.get(location["lon"])), float(row.get(location["lat"]))
                    except (TypeError, ValueError):
                        bad += 1
                        continue
                    if abs(lat) > 90 or abs(lon) > 180:
                        bad += 1
                if bad:
                    warnings.append(f"{where}: {bad} of {len(rows)} rows have missing or out-of-range {label}coordinates "
                                    f"({location['lon']}, {location['lat']}); check that lon and lat are not swapped.")
        if len(rows) >= VALIDATION_ROWS and layer.get("type") in ("regions", "bubbles", "spikes", "labels"):
            warnings.append(f"{where}: data.{source} has {VALIDATION_ROWS:,}+ rows; aggregate it per place with sql for a faster map.")

    for index, control in enumerate(spec.get("controls") or []):
        field = control.get("field")
        if not isinstance(field, str) or control.get("type") not in PARAM_CONTROLS:
            continue
        sources = [control["data"]] if control.get("data") else [name for name, columns in columns_by_source.items() if field in columns]
        if not sources:
            errors.append(f"controls[{index}]: no data source has the field \"{field}\".")
            continue
        for name in sources:
            if name in columns_by_source and field not in columns_by_source[name]:
                errors.append(f"controls[{index}]: \"{field}\" is not a column of data.{name}.")
            elif name in rows_by_source:
                distinct = {str(row.get(field)) for row in rows_by_source[name] if row.get(field) not in (None, "")}
                if len(distinct) < 2:
                    warnings.append(f"controls[{index}]: \"{field}\" has {len(distinct)} distinct value(s); the control does nothing.")
                elif control.get("type") == "checkboxes" and len(distinct) > MAX_FILTER_VALUES:
                    warnings.append(
                        f"controls[{index}]: \"{field}\" has {len(distinct)} distinct values, too many to tick one by one; "
                        "filter on a short category column, or use a range control for a number."
                    )
    return errors, warnings


def validate_map(spec: Any, workspace: Any | None) -> dict[str, Any]:
    """Validate a spec; raise ValueError listing errors, else return tables and warnings.

    A template map is checked as the layer spec it compiles to.
    """
    offered: list[tuple[str, str]] = []
    if isinstance(spec, dict) and "template" in spec:
        problems = template_errors(spec)
        if problems:
            raise ValueError("; ".join(problems[:12]))
        offered = offered_columns(spec)
        spec = compile_template(spec)
    errors, warnings = check_structure(spec)
    if errors:
        raise ValueError("; ".join(errors[:12]))
    tables = map_tables(spec)
    if workspace is not None:
        available = set(workspace.list_tables())
        missing = [table for table in tables if table not in available]
        if missing:
            listed = ", ".join(sorted(available)[:30]) or "none"
            raise ValueError(f"Unknown workspace tables: {', '.join(missing)}. Load or create them first. Available: {listed}")
        data_errors, data_warnings = check_data(spec, workspace, offered)
        if data_errors:
            raise ValueError("; ".join(data_errors[:12]))
        warnings.extend(data_warnings)
    return {"tables": tables, "warnings": warnings}
