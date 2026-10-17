"""Editing the session's charts and reports as files (design-docs/60).

``session/charts/<id>.json`` and ``session/reports/<id>.md`` are edited like
workspace files (full content or text replacements against the content hash).
An edit is validated before it lands; a rejected edit changes nothing and lists
every problem. The application applies an accepted edit from the tool result.
"""

from __future__ import annotations

import difflib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from data_formulator.analyst.session_files import content_hash
from data_formulator.datalake.text_edit import TextEditConflictError, apply_text_patch

MAX_SESSION_TEXT = 1_000_000
CHART_KEYS = ("chart_type", "table", "title", "subtitle", "encodings", "config", "theme")
ENCODING_KEYS = ("field", "type", "aggregate", "sortOrder", "sortBy", "scheme")
TYPES = ("quantitative", "nominal", "ordinal", "temporal")
AGGREGATES = ("count", "sum", "average")
SORT_ORDERS = ("ascending", "descending")
_CHART_REF = re.compile(r"chart://([A-Za-z0-9_.:-]+)")


@lru_cache(maxsize=1)
def chart_catalog() -> dict[str, Any]:
    return json.loads((Path(__file__).with_name("chart_catalog.json")).read_text(encoding="utf-8"))


def _close(value: str, options: list[str]) -> str:
    match = difflib.get_close_matches(value, options, n=1, cutoff=0.6)
    return f" (did you mean {match[0]!r}?)" if match else ""


def chart_text(spec: dict[str, Any]) -> str:
    return json.dumps(spec, indent=2, ensure_ascii=False) + "\n"


def validate_chart(text: str, previous: dict[str, Any], columns: list[str]) -> dict[str, Any]:
    """The chart spec ``text`` describes, normalized; raises ``ValueError`` listing every problem."""
    try:
        spec = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError(f"Chart not changed: the file is not valid JSON ({error.msg} at line {error.lineno}).") from None
    if not isinstance(spec, dict):
        raise ValueError("Chart not changed: the file must be a JSON object.")
    catalog = chart_catalog()
    problems: list[str] = []
    for key in spec:
        if key not in CHART_KEYS:
            problems.append(f"unknown key {key!r}; a chart has {', '.join(CHART_KEYS)}")
    if spec.get("table") != previous.get("table"):
        problems.append(f"table cannot change (it is {previous.get('table')!r}); make a new chart with visualize")

    chart_type = spec.get("chart_type")
    template = catalog["chart_types"].get(chart_type) if isinstance(chart_type, str) else None
    if template is None:
        problems.append(f"chart_type {chart_type!r} is not a chart type{_close(str(chart_type), list(catalog['chart_types']))}; "
                        f"types: {', '.join(catalog['chart_types'])}")

    encodings: dict[str, Any] = {}
    raw_encodings = spec.get("encodings", {})
    if not isinstance(raw_encodings, dict):
        problems.append("encodings must be an object of channel -> {field, ...}")
        raw_encodings = {}
    for channel, encoding in raw_encodings.items():
        if encoding in (None, "", {}):
            continue
        if template is not None and channel not in template["channels"]:
            problems.append(f"{chart_type} has no channel {channel!r}; its channels: {', '.join(template['channels'])}")
            continue
        if isinstance(encoding, str):
            encoding = {"field": encoding}
        if not isinstance(encoding, dict):
            problems.append(f"encodings.{channel} must be a field name or an object with field")
            continue
        unknown = [key for key in encoding if key not in ENCODING_KEYS]
        if unknown:
            problems.append(f"encodings.{channel} has unknown {', '.join(map(repr, unknown))}; allowed: {', '.join(ENCODING_KEYS)}")
        field = encoding.get("field")
        if not isinstance(field, str) or field not in columns:
            problems.append(f"encodings.{channel}.field {field!r} is not a column of {previous.get('table')}"
                            f"{_close(str(field), columns)}; columns: {', '.join(columns)}")
        if "type" in encoding and encoding["type"] not in TYPES:
            problems.append(f"encodings.{channel}.type must be one of {', '.join(TYPES)}")
        aggregate = encoding.get("aggregate")
        if aggregate == "mean":
            encoding = {**encoding, "aggregate": "average"}
        elif aggregate is not None and aggregate not in AGGREGATES:
            problems.append(f"encodings.{channel}.aggregate must be one of {', '.join(AGGREGATES)}")
        if "sortOrder" in encoding and encoding["sortOrder"] not in SORT_ORDERS:
            problems.append(f"encodings.{channel}.sortOrder must be ascending or descending")
        for key in ("sortBy", "scheme"):
            if key in encoding and not isinstance(encoding[key], str):
                problems.append(f"encodings.{channel}.{key} must be a string")
        encodings[channel] = {key: encoding[key] for key in ENCODING_KEYS if key in encoding}

    config = spec.get("config") or {}
    previous_config = previous.get("config") or {}
    if not isinstance(config, dict):
        problems.append("config must be an object of chart options")
        config = {}
    options = template["options"] if template is not None else {}
    for key, value in config.items():
        option = options.get(key)
        if option is None:
            # Options the chart already had stay as they are; new ones must be the type's.
            if key in previous_config and previous_config[key] == value:
                continue
            problems.append(f"{chart_type} has no option {key!r}" + (f"; its options: {', '.join(options)}" if options else ""))
        elif option["type"] == "binary" and not isinstance(value, bool):
            problems.append(f"config.{key} must be true or false")
        elif option["type"] == "continuous" and (not isinstance(value, (int, float)) or isinstance(value, bool)
                                                 or value < option.get("min", float("-inf"))
                                                 or value > option.get("max", float("inf"))):
            problems.append(f"config.{key} must be a number from {option.get('min', '-∞')} to {option.get('max', '∞')}")
        elif option["type"] == "discrete" and value not in option["options"]:
            problems.append(f"config.{key} must be one of {', '.join(json.dumps(o) for o in option['options'])}")

    theme = spec.get("theme")
    if theme is not None and theme not in catalog["themes"]:
        problems.append(f"theme {theme!r} is not a theme{_close(str(theme), catalog['themes'])}; themes: {', '.join(catalog['themes'])}")
    for key in ("title", "subtitle"):
        if spec.get(key) is not None and (not isinstance(spec[key], str) or len(spec[key]) > 300):
            problems.append(f"{key} must be text of at most 300 characters")

    if problems:
        raise ValueError("Chart not changed: " + "; ".join(problems) + ".")
    normalized: dict[str, Any] = {"chart_type": chart_type, "table": previous.get("table")}
    for key in ("title", "subtitle"):
        if spec.get(key):
            normalized[key] = spec[key]
    normalized["encodings"] = encodings
    if config:
        normalized["config"] = config
    if theme is not None:
        normalized["theme"] = theme
    return normalized


def validate_report(text: str, chart_ids: set[str]) -> None:
    if not text.strip():
        raise ValueError("Report not changed: it would be empty.")
    unknown = sorted({chart_id for chart_id in _CHART_REF.findall(text) if chart_id not in chart_ids})
    if unknown:
        raise ValueError(f"Report not changed: it embeds charts that are not in the session: {', '.join(unknown)}. "
                         "Embed charts by id with ![caption](chart://<id>); list_files session/charts shows them.")


def edit_session_file(args: dict[str, Any], ctx: Any) -> dict[str, Any]:
    """Edit ``session/charts/<id>.json`` or ``session/reports/<id>.md``; returns the result for the agent."""
    from data_formulator.analyst.session_layer import session_layer

    payload = ctx.payload or {}
    layer = session_layer(payload)
    path = args.get("path")
    entry = layer.view(path) if layer is not None and isinstance(path, str) else None
    if entry is None:
        raise ValueError(f"{path} is not in this session. Use list_files session/ to see the session's files.")
    if not entry.get("editable"):
        raise ValueError(f"{path} is read-only; it describes the session. Edit charts and reports instead.")
    current = str(entry.get("content", ""))
    expected = args.get("expected_content_hash")
    if not isinstance(expected, str) or expected != content_hash(current):
        raise TextEditConflictError(f"{path} changed or the hash is wrong; read_file it again before editing")
    patching = "replacements" in args or "append_text" in args
    if ("content" in args) == patching or "code" in args:
        raise ValueError("Provide exactly one of content or a text patch (replacements/append_text)")
    if patching:
        text = apply_text_patch(current, expected_content_hash=expected, replacements=args.get("replacements"),
                                append_text=args.get("append_text"), max_chars=MAX_SESSION_TEXT)
    else:
        text = args.get("content")
        if not isinstance(text, str) or len(text) > MAX_SESSION_TEXT:
            raise ValueError(f"content must be text under {MAX_SESSION_TEXT:,} characters")

    if path.startswith("session/charts/"):
        chart_id = path[len("session/charts/"):-len(".json")]
        base = json.loads(current)
        spec = validate_chart(text, base, [str(column) for column in entry.get("columns") or []])
        text = chart_text(spec)
        # `base` is what the edit was made against: the application skips an edit to a chart changed meanwhile.
        update: dict[str, Any] = {"kind": "chart", "id": chart_id, "spec": spec,
                                  **({} if entry.get("made_in_run") else {"base": base})}
    elif path.startswith("session/reports/"):
        chart_ids = {key[len("session/charts/"):-len(".json")] for key in layer.paths() if key.startswith("session/charts/")}
        chart_ids |= {str(chart.get("chart_id")) for chart in payload.get("charts") or [] if isinstance(chart, dict)}
        validate_report(text, chart_ids)
        update = {"kind": "report", "id": path[len("session/reports/"):-len(".md")], "content": text, "base": current}
    else:
        raise ValueError(f"{path} cannot be edited")
    layer.record_edit(path, text)
    return {"path": path, "content_hash": content_hash(text), "session_update": update}
