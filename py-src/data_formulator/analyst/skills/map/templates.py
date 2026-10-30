# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Map templates (src/maps/templates.ts): a named kind of map bound to columns.

The renderer compiles templates; this mirror compiles them only so ``validate_map`` can check the
bound columns, region keys, and coordinates against the data like any layer spec.
"""

from __future__ import annotations

import re
from typing import Any

TEMPLATES = ("choropleth", "bubbles", "points", "density", "spikes", "flows", "tracks", "bivariate", "cartogram", "vectors")
CHANNELS = ("region", "lat", "lon", "color", "color2", "size", "label", "time", "filter", "weight",
            "origin", "destination", "originLat", "originLon", "destinationLat", "destinationLon", "group", "order",
            "angle", "u", "v")

# Channels people choose among the agent's offered columns; the others (where marks go) the agent fixes.
CHOICE_CHANNELS = ("color", "color2", "size", "weight", "label", "time", "filter")
# Measures that get a switch on the map when offered several columns.
_SWITCH_CHANNELS = ("color", "size", "color2")

_WHERE = ("region", "lat", "lon")
# (requirements: each a tuple of alternatives, channels, layer type)
TEMPLATE_DEFS: dict[str, tuple[tuple[tuple[str, ...], ...], tuple[str, ...], str]] = {
    "choropleth": ((("region",), ("color",)), ("region", "color", "label", "time", "filter"), "regions"),
    "bubbles": ((_WHERE, ("size",)), ("region", "lat", "lon", "size", "color", "label", "time", "filter"), "bubbles"),
    "points": ((("lat", "lon"),), ("lat", "lon", "color", "size", "label", "time", "filter"), "points"),
    "density": ((("lat", "lon"),), ("lat", "lon", "weight", "time", "filter"), "hexbin"),
    "spikes": ((_WHERE, ("size",)), ("region", "lat", "lon", "size", "color", "label", "time", "filter"), "spikes"),
    "flows": ((("origin", "originLat"), ("destination", "destinationLat")),
              ("origin", "destination", "originLat", "originLon", "destinationLat", "destinationLon", "size", "color", "time", "filter"), "flows"),
    "tracks": ((("lat", "lon"), ("group",)), ("lat", "lon", "group", "order", "color", "size", "time", "filter"), "paths"),
    "vectors": ((("lat", "lon"), ("angle", "u")), ("lat", "lon", "angle", "u", "v", "size", "color", "time", "filter"), "vectors"),
    "bivariate": ((("region",), ("color",), ("color2",)), ("region", "color", "color2", "label", "time", "filter"), "regions"),
    "cartogram": ((("region",), ("size",)), ("region", "size", "color", "label", "time", "filter"), "bubbles"),
}


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


_CSS_COLOR = re.compile(r"^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(rgb|rgba|hsl|hsla)\([^()]*\)|[a-zA-Z]+)$")


def _css_color(value: Any) -> bool:
    """A hex, rgb()/hsl(), or named CSS colour (names are checked by the renderer)."""
    return isinstance(value, str) and bool(_CSS_COLOR.match(value.strip()))


def channel_binding(value: Any) -> tuple[str | None, list[str]]:
    """A channel's shown column and the columns offered for it.

    A channel is a column, a list of columns (the first is shown), or ``{"field", "options"}``
    (no ``field``: offered but not shown).
    """
    if _text(value):
        return value, [value]
    if isinstance(value, list):
        options = [item for item in value if _text(item)]
        return (options[0] if options else None), options
    if isinstance(value, dict):
        options = [item for item in value.get("options") or [] if _text(item)] if isinstance(value.get("options"), list) else []
        field = value.get("field") if _text(value.get("field")) else None
        if field and field not in options:
            options = [field, *options]
        return field, options
    return None, []


def offered_columns(spec: dict[str, Any]) -> list[tuple[str, str]]:
    """(channel, column) for every column a template offers, shown or not."""
    encoding = spec.get("encoding") if isinstance(spec.get("encoding"), dict) else {}
    channels = TEMPLATE_DEFS.get(spec.get("template"), ((), (), ""))[1]
    return [(channel, column) for channel in channels for column in channel_binding(encoding.get(channel))[1]]


def template_errors(spec: dict[str, Any]) -> list[str]:
    name = spec.get("template")
    if name not in TEMPLATES:
        return [f"template must be one of {', '.join(TEMPLATES)}."]
    requires, channels, _ = TEMPLATE_DEFS[name]
    errors: list[str] = []
    if not isinstance(spec.get("data"), dict):
        errors.append("A template map needs data: a table, sql with tables, or inline values.")
    encoding = spec.get("encoding")
    if not isinstance(encoding, dict):
        errors.append("A template map needs encoding: the columns it maps.")
        encoding = {}
    for channel, value in encoding.items():
        if channel == "tooltip":
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                errors.append("encoding.tooltip must list column names.")
        elif channel not in CHANNELS:
            errors.append(f"encoding.{channel} is not a channel; {name} takes {', '.join(channels)}.")
        elif _text(value):
            continue
        elif channel not in CHOICE_CHANNELS:
            errors.append(f"encoding.{channel} must be one column name; only {', '.join(CHOICE_CHANNELS)} take a list of options.")
        else:
            options = value if isinstance(value, list) else value.get("options") if isinstance(value, dict) else None
            field = value.get("field") if isinstance(value, dict) else None
            if not isinstance(options, list) or not options or not all(_text(item) for item in options):
                errors.append(f"encoding.{channel} must be a column name, a list of column names, "
                              "or {\"field\", \"options\"} with options listing column names.")
            elif field is not None and not (_text(field) and field in options):
                errors.append(f"encoding.{channel}.field must be one of its options.")

    def has(channel: str) -> bool:
        return channel_binding(encoding.get(channel))[0] is not None

    for options in requires:
        if options is _WHERE:
            if not has("region") and not (has("lat") and has("lon")):
                errors.append(f"{name} needs encoding.region, or encoding.lat and encoding.lon.")
        elif not any(has(option) for option in options):
            errors.append(f"{name} needs encoding.{' or encoding.'.join(options)}.")
    if "lat" in channels and has("lat") != has("lon"):
        errors.append("encoding.lat and encoding.lon go together.")
    if name == "vectors" and has("u") != has("v"):
        errors.append("encoding.u and encoding.v go together (east and north components).")
    properties = spec.get("properties") if isinstance(spec.get("properties"), dict) else {}
    if "color" in properties and not _css_color(properties["color"]):
        errors.append('properties.color must be a CSS colour, such as "#4e79a7" or "darkslategray".')
    if spec.get("layers") is not None:
        errors.append("Give template (with encoding) or layers, not both.")
    return errors


def _geo(properties: dict[str, Any]) -> dict[str, Any]:
    geography = properties.get("geography")
    built_in = {"world": "countries", "us-states": "us-states", "us-counties": "us-counties"}.get(geography or "")
    out: dict[str, Any] = {}
    if built_in:
        out["geo"] = built_in
    elif isinstance(geography, str) and geography.startswith("files/"):
        out["geo"] = geography
    for key in ("featureKey", "keyType"):
        if properties.get(key):
            out[key] = properties[key]
    return out


def compile_template(spec: dict[str, Any]) -> dict[str, Any]:
    """The layer spec a template map stands for (what the renderer draws)."""
    name = spec["template"]
    raw: dict[str, Any] = spec.get("encoding") or {}
    channels = TEMPLATE_DEFS[name][1]
    encoding: dict[str, Any] = {channel: channel_binding(raw.get(channel))[0] for channel in channels}
    encoding = {channel: field for channel, field in encoding.items() if field}
    properties: dict[str, Any] = spec.get("properties") or {}
    # A measure offered several columns gets a switch; color and size offered the same columns share one.
    switches: list[dict[str, Any]] = []
    refs: dict[str, Any] = {}
    for channel in _SWITCH_CHANNELS:
        field, options = channel_binding(raw.get(channel))
        if channel not in encoding or len(options) < 2:
            continue
        same = next((control for control in switches
                     if control["value"] == field and [option["value"] for option in control["options"]] == options), None)
        if same:
            refs[channel] = {"param": same["param"]}
            continue
        switches.append({"type": "select", "param": channel, "options": [{"value": option} for option in options], "value": field})
        refs[channel] = {"param": channel}

    def field_of(channel: str) -> Any:
        return refs.get(channel, encoding.get(channel))

    layer: dict[str, Any] = {"id": "main", "type": TEMPLATE_DEFS[name][2], "data": "main"}
    if name == "flows":
        layer["from"] = {"key": encoding["origin"], **_geo(properties)} if encoding.get("origin") else \
            {"lon": encoding.get("originLon"), "lat": encoding.get("originLat")}
        layer["to"] = {"key": encoding["destination"], **_geo(properties)} if encoding.get("destination") else \
            {"lon": encoding.get("destinationLon"), "lat": encoding.get("destinationLat")}
    elif name == "tracks":
        layer.update({"lon": encoding.get("lon"), "lat": encoding.get("lat"), "group": encoding.get("group")})
        if encoding.get("order"):
            layer["order"] = encoding["order"]
    elif encoding.get("region"):
        layer.update({"key": encoding["region"], **_geo(properties)})
    else:
        layer.update({"lon": encoding.get("lon"), "lat": encoding.get("lat")})
    # Lines show which way they go with arrowheads, the cue readers decode best.
    if name in ("flows", "tracks"):
        layer["direction"] = properties.get("direction") or "arrow"
    if name == "vectors":
        layer.update({"angle": encoding["angle"]} if encoding.get("angle") else {"u": encoding.get("u"), "v": encoding.get("v")})
    if name == "density":
        layer["type"] = properties.get("density") or "hexbin"
        if encoding.get("weight"):
            layer["weight"] = encoding["weight"]
    if name == "bivariate":
        layer["color"] = {"type": "bivariate", "field": field_of("color"), "field2": field_of("color2")}
    elif encoding.get("color"):
        layer["color"] = {"field": field_of("color")}
    if encoding.get("size"):
        layer["size"] = {"field": field_of("size")}
    if encoding.get("label"):
        layer["text"] = encoding["label"]
    # Tooltips list every measure a switch can show, so switching never hides a value.
    measures = [column for key in ("color", "color2", "size", "weight") if encoding.get(key)
                for column in (channel_binding(raw.get(key))[1] if key in refs else [encoding[key]])]
    headings = [encoding[key] for key in ("angle", "u", "v") if name == "vectors" and encoding.get(key)]
    tooltip = [*(raw.get("tooltip") or []), *measures, *headings]
    if tooltip:
        layer["tooltip"] = list(dict.fromkeys(tooltip))
    controls: list[dict[str, Any]] = list(switches)
    if encoding.get("time"):
        controls.append({"type": "slider", "field": encoding["time"], "data": "main"})
    if encoding.get("filter"):
        controls.append({"type": "checkboxes", "field": encoding["filter"], "data": "main"})
    geography = properties.get("geography")
    basemap = {"world": "world", "us-states": "us-states", "us-counties": "us-counties"}.get(geography or "")
    if isinstance(geography, str) and geography.startswith("files/"):
        basemap = "none"
    view = {**({"basemap": basemap} if basemap else {}), **(spec.get("view") or {})}
    compiled = {key: value for key, value in spec.items() if key not in ("template", "encoding", "properties")}
    compiled.update({"view": view, "data": {"main": spec.get("data")}, "layers": [layer],
                     "controls": controls + list(spec.get("controls") or [])})
    return compiled
