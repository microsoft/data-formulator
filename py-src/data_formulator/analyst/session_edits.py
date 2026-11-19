"""Editing the session's charts and reports (design-docs/60, 74).

``session://charts/<id>`` and ``session://reports/<id>`` are edited like
workspace files (full content or text replacements against the content hash).
An edit is validated before it lands; a rejected edit changes nothing and lists
every problem. The application applies an accepted edit from the tool result.
"""

from __future__ import annotations

import difflib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from data_formulator.analyst import names, references
from data_formulator.analyst.session_files import content_hash
from data_formulator.datalake.text_edit import TextEditConflictError, apply_text_patch

MAX_SESSION_TEXT = 1_000_000
CHART_KEYS = ("chart_type", "table", "title", "subtitle", "encodings", "config", "theme")
ENCODING_KEYS = ("field", "type", "aggregate", "sortOrder", "sortBy", "scheme")
TYPES = ("quantitative", "nominal", "ordinal", "temporal")
AGGREGATES = ("count", "sum", "average")
SORT_ORDERS = ("ascending", "descending")


def report_map_paths(text: str) -> set[str]:
    """The map files a report embeds (``![caption](files/<name>.map.json)``, or the older ``map://files/…``)."""
    return {reference.name for reference in references.find(text)
            if reference.form == "embed" and reference.name.endswith(".map.json")}


def workspace_map_paths(ctx: Any) -> set[str] | None:
    """The session paths of the workspace's map files, or None when they cannot be listed."""
    workspace = getattr(ctx, "workspace", None)
    if workspace is None or not hasattr(workspace, "list_workspace_files"):
        return None
    try:
        return {f"files/{file.name}" for file in workspace.list_workspace_files() if file.name.endswith(".map.json")}
    except Exception:
        return None


@lru_cache(maxsize=1)
def chart_catalog() -> dict[str, Any]:
    return json.loads((Path(__file__).with_name("chart_catalog.json")).read_text(encoding="utf-8"))


def _close(value: str, options: list[str]) -> str:
    match = difflib.get_close_matches(value, options, n=1, cutoff=0.6)
    return f" (did you mean {match[0]!r}?)" if match else ""


def chart_text(spec: dict[str, Any]) -> str:
    return json.dumps(spec, indent=2, ensure_ascii=False) + "\n"


def validate_chart(text: str, previous: dict[str, Any], columns: list[str], saved_themes: list[str] | None = None) -> dict[str, Any]:
    """The chart spec ``text`` describes, normalized; raises ``ValueError`` listing every problem.

    ``saved_themes`` are the ids of the user's saved themes, which charts use like presets.
    """
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
    themes = [*catalog["themes"], *(saved_themes or [])]
    if theme is not None and theme not in themes:
        problems.append(f"theme {theme!r} is not a theme{_close(str(theme), themes)}; themes: {', '.join(themes)}")
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


def run_chart_ids(payload: dict[str, Any]) -> list[str]:
    """Charts made earlier in this run, which a report may refer to before the session lists them."""
    return [str(chart.get("chart_id")) for chart in payload.get("charts") or [] if isinstance(chart, dict)]


def validate_report(text: str, known: dict[str, str], previous: str = "") -> str | None:
    """Raises ``ValueError`` for an empty report, or one that adds references to names the session does not have
    (``known``, from ``references.known_names``), listing every one with the closest real names. References that
    already did not resolve in ``previous`` do not block the edit; the returned note names them."""
    if not text.strip():
        raise ValueError("Report not changed: it would be empty.")
    missing = references.unresolved(references.find(text), known)
    before = {reference.name for reference, _ in references.unresolved(references.find(previous), known)}
    added = [(reference, close) for reference, close in missing if reference.name not in before]
    if added:
        raise ValueError("Report not changed: " + references.describe(added, known)
                         + " Refer to items by their names in list_files or the session index "
                           "(![caption](session://charts/<id>), [text](session://tables/<name>), "
                           "![caption](files/<name>.map.json)), then edit again.")
    kept = [(reference, close) for reference, close in missing if reference.name in before]
    return ("Still unresolved from before this edit: " + references.describe(kept, known)
            + " They show as their captions; patch or remove them.") if kept else None


def _saved_theme_ids(ctx: Any) -> list[str]:
    user_home = getattr(getattr(ctx, "workspace", None), "user_home", None)
    if not user_home:
        return []
    from data_formulator.knowledge.themes import ThemeStore
    try:
        return [theme["id"] for theme in ThemeStore(user_home).list()]
    except Exception:
        return []


def edit_session_file(args: dict[str, Any], ctx: Any) -> dict[str, Any]:
    """Edit ``session://charts/<id>`` or ``session://reports/<id>``; returns the result for the agent."""
    from data_formulator.analyst.session_layer import session_layer

    payload = ctx.payload or {}
    layer = session_layer(payload)
    path = names.canonical(args["path"]) if isinstance(args.get("path"), str) else args.get("path")
    entry = layer.view(path) if layer is not None and isinstance(path, str) else None
    if entry is None:
        raise ValueError(f"{path} is not in this session. Use list_files session:// to see the session's items.")
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

    note = None
    if (chart_id := names.leaf_of(path, "charts")) is not None:
        base = json.loads(current)
        spec = validate_chart(text, base, [str(column) for column in entry.get("columns") or []], _saved_theme_ids(ctx))
        text = chart_text(spec)
        # `base` is what the edit was made against: the application skips an edit to a chart changed meanwhile.
        update: dict[str, Any] = {"kind": "chart", "id": chart_id, "spec": spec,
                                  **({} if entry.get("made_in_run") else {"base": base})}
    elif (report_id := names.leaf_of(path, "reports")) is not None:
        note = validate_report(text, references.known_names(layer, getattr(ctx, "workspace", None), run_chart_ids(payload)),
                               current)
        update = {"kind": "report", "id": report_id, "content": text, "base": current}
    else:
        raise ValueError(f"{path} cannot be edited")
    layer.record_edit(path, text)
    return {"path": path, "content_hash": content_hash(text), "session_update": update,
            **({"note": note} if note else {})}
