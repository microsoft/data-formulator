# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""map skill — writes a map artifact (``files/<name>.map.json``).

A map is a declarative spec (basemap, layers, controls) that the built-in D3 renderer
draws on the canvas, reading workspace tables live through read-only SQL. ``write_map``
validates the spec against the data (fields, region-key joins, coordinates) and saves an
agent-managed file; ``edit_file`` revisions are checked by ``check_map_revision``.

  - ``{"type": "action", "action": "write_map", "file": {...}}``
"""

from __future__ import annotations

import json
from typing import Any, Generator

from data_formulator.analyst.replacement import record_run_artifact
from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.analyst.skills.html_app.skill import _app_target, _invalid_title, _save_app, replace_file_in_place
from data_formulator.analyst.skills.map.validate import validate_map

MAP_SUFFIX = ".map.json"
MAX_MAP_BYTES = 1_000_000


def encode_map(spec: dict[str, Any]) -> bytes:
    return (json.dumps(spec, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def check_map_revision(filename: str, content: Any, ctx: SkillContext) -> dict[str, Any] | None:
    """Validate an ``edit_file`` revision of a map; ``None`` for other files.

    Raises ``ValueError`` (prefixed ``[MAP NOT UPDATED]``) so a broken edit is refused.
    """
    if not filename.lower().endswith(MAP_SUFFIX):
        return None
    try:
        if not isinstance(content, str):
            raise ValueError("A map must be UTF-8 JSON text")
        try:
            spec = json.loads(content)
        except ValueError as error:
            raise ValueError(f"The map is not valid JSON: {error}") from error
        if len(content.encode("utf-8")) > MAX_MAP_BYTES:
            raise ValueError(f"The map is over {MAX_MAP_BYTES:,} bytes; read data from workspace tables instead of embedding it")
        result = validate_map(spec, ctx.workspace)
    except ValueError as error:
        raise ValueError(f"[MAP NOT UPDATED] {error}") from error
    title = spec.get("title") if isinstance(spec.get("title"), str) and spec.get("title").strip() else filename
    return {"title": title.strip(), "tables": result["tables"], "warnings": result["warnings"]}


class MapSkill:
    """Behaviour for the ``write_map`` action (schema in ``tools.json``)."""

    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        return ToolResult(text=f"map has no tool '{name}'.")

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
        if action != "write_map":
            yield {"type": "error", "message": f"map cannot handle action '{action}'.", "message_code": "agent.unknownAction"}
            return f"map cannot handle action '{action}'."
        updating = spec.get("path") is not None
        try:
            replaces = replace_file_in_place(spec, ctx)
            file, result = self._write(spec, ctx)
        except (ValueError, FileNotFoundError) as error:
            yield {"type": "error", "message": f"write_map failed: {error}", "message_code": "agent.parseActionFailed"}
            return f"[MAP NOT {'UPDATED' if updating else 'CREATED'}] {error}"
        record_run_artifact(ctx, "file", file["path"], file.get("display_name") or file["name"])
        yield {"type": "action", "action": action, "file": file, "updated": updating, **({"replaces": replaces} if replaces else {})}
        return json.dumps({
            "status": "updated" if updating else "delivered",
            "message": f"The map was {'updated' if updating else 'saved'} and opened on the canvas.",
            **{key: file[key] for key in ("name", "path", "display_name", "content_hash")},
            "tables": result["tables"],
            "warnings": result["warnings"],
            "revise_with": "Small changes: edit_file with this path and content_hash (targeted replacements on the JSON). "
                           "Larger rewrites: write_map with path and expected_content_hash.",
        }, ensure_ascii=False)

    @staticmethod
    def _write(spec: dict[str, Any], ctx: SkillContext) -> tuple[dict[str, Any], dict[str, Any]]:
        filename, expected_hash = _app_target(spec, MAP_SUFFIX, ctx)
        title = spec.get("title")
        if problem := _invalid_title(title):
            raise ValueError(problem)
        body = spec.get("map")
        if isinstance(body, str):
            try:
                body = json.loads(body)
            except ValueError as error:
                raise ValueError(f"map must be the map spec object: {error}") from error
        if not isinstance(body, dict):
            raise ValueError("map must be the map spec object (view, data, layers, controls)")
        body = {"version": 1, "title": title.strip(), **{key: value for key, value in body.items() if key not in ("version", "title")}}
        result = validate_map(body, ctx.workspace)
        encoded = encode_map(body)
        if len(encoded) > MAX_MAP_BYTES:
            raise ValueError(f"The map is {len(encoded):,} bytes; keep it under {MAX_MAP_BYTES:,} and read data from workspace tables")
        return _save_app(ctx, encoded, filename, "application/json", title.strip(), expected_hash), result


def get_skill() -> MapSkill:
    return MapSkill()
