from __future__ import annotations

import json
import io
import hashlib
import mimetypes
from urllib.parse import quote
from typing import Any, Generator

from data_formulator.datalake.text_edit import apply_text_patch, TextEditConflictError
from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.analyst.input_provenance import normalize_input_sources
from data_formulator.analyst.replacement import record_run_artifact
from data_formulator.datalake.workspace import agent_file_path_error
from data_formulator.analyst.deletion import delete_files, file_imported, forget_deleted, plan_deletion
from data_formulator.analyst.session_edits import edit_session_file
from data_formulator.analyst.session_files import SessionFiles, helper_module_name
from data_formulator.sandbox.session_imports import helper_warnings, sign_helper
from data_formulator.analyst.skills.html_app.skill import (
    REACT_APP_SUFFIX, check_app_revision, replace_file_in_place,
)
from data_formulator.analyst.skills.map.skill import MAP_SUFFIX, check_map_revision
from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine, workspace_table_input
from .data_loading import WorkspaceDataLoading


class WorkspaceSkill:
    def __init__(self) -> None:
        self._data_loading = WorkspaceDataLoading()

    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        if name == "probe_data":
            return self._data_loading.handle_tool(name, args, ctx)
        if name == "list_files":
            return ToolResult(text=json.dumps(SessionFiles(ctx).list(args.get("path") or ""), ensure_ascii=False))
        if name == "read_file":
            files = SessionFiles(ctx)
            items = args.get("files")
            if items is None:
                # Older conversations read with path/paths/offset/limit.
                items = ([{key: args[key] for key in ("path", "offset", "limit") if args.get(key) is not None}]
                         if args.get("path") else []) + [{"path": path} for path in args.get("paths") or []]
            return ToolResult(text=json.dumps(files.read_items(items), ensure_ascii=False, default=str))
        if name == "search":
            return ToolResult(text=SessionFiles(ctx).search(
                args.get("query") or args.get("pattern") or "", args.get("path"), regex=bool(args.get("regex")),
                max_results=args.get("max_results", 20)))
        if name == "move_file":
            moved = self._move_file(args, ctx)
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(
                ctx.workspace, ctx.payload.get("input_tables", []),
            ).manifest
            return ToolResult(text=json.dumps(moved, ensure_ascii=False))
        if name == "delete_items":
            plan = plan_deletion(args.get("items"), ctx)
            delete_files(plan, ctx)
            forget_deleted(plan, ctx)
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(
                ctx.workspace, ctx.payload.get("input_tables", []),
            ).manifest
            return ToolResult(text=json.dumps({"deleted": plan}, ensure_ascii=False))
        if name in {"create_data", "update_data"}:
            import pandas as pd
            table_name = args.get("table_name")
            if not isinstance(table_name, str) or not table_name:
                raise ValueError("table_name is required")
            expected_hash = args.get("expected_content_hash")
            if name == "update_data":
                if not isinstance(expected_hash, str) or len(expected_hash) != 32 or any(
                    character not in "0123456789abcdef" for character in expected_hash
                ):
                    raise ValueError("expected_content_hash must be the current table content hash")
            elif expected_hash is not None:
                raise ValueError("create_data does not accept expected_content_hash")
            if ("rows" in args) == ("code" in args):
                raise ValueError("Provide exactly one of rows or code with output_variable")
            display_name = args.get("display_name")
            if display_name is not None and (not isinstance(display_name, str) or not display_name.strip()
                    or len(display_name) > 80 or any(ord(character) < 32 for character in display_name)):
                raise ValueError("display_name must be a non-empty single-line title of at most 80 characters")
            engine = WorkspaceInputEngine(ctx.workspace, ctx.payload.get("input_tables", []))
            if "input_sources" not in args:
                raise ValueError("input_sources is required; use [] for generated data without inputs")
            sources = []
            for source in normalize_input_sources(args, None):
                if source["kind"] == "file" and source["id"].startswith("scratch/"):
                    path = ctx.workspace.resolve_scratch_file(source["id"].removeprefix("scratch/"))
                    with path.open("rb") as content:
                        source["content_hash"] = hashlib.file_digest(content, "sha256").hexdigest()
                    sources.append(source)
                else:
                    sources.extend(normalize_input_sources({"input_sources": [source]}, engine.manifest, ctx.workspace))
            for source in sources:
                item = next((item for item in engine.manifest.inputs if item.id == source["id"]), None)
                if item is None and source["kind"] == "data":
                    item = workspace_table_input(ctx.workspace, source["id"])
                if item is None:
                    continue
                if item.content_hash is not None:
                    source["content_hash"] = item.content_hash
                if item.kind == "data":
                    source["table_name"] = item.display_name
            if "code" in args:
                if ctx.runtime is None or not str(args.get("output_variable", "")).isidentifier():
                    raise ValueError("Python runtime and output_variable are required")
                execution = ctx.runtime.run_explore_code(
                    args["code"], ctx.payload.get("input_tables", []), output_variable=args["output_variable"],
                )
                if execution.get("status") != "ok":
                    raise ValueError(execution.get("error", "Python execution failed"))
                frame = execution.get("output")
            else:
                rows = args["rows"]
                if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
                    raise ValueError("rows must be a non-empty array of objects")
                frame = pd.DataFrame(rows)
            metadata = ctx.workspace.save_agent_data(
                frame, table_name, input_sources=sources, expected_content_hash=expected_hash,
                display_name=display_name, acquisition=args.get("acquisition"),
            )
            input_tables = ctx.payload.setdefault("input_tables", [])
            input_tables[:] = [table for table in input_tables if table.get("name") != metadata.name]
            input_tables.append({
                "name": metadata.name, "rows": json.loads(frame.head(20).to_json(orient="records", date_format="iso")),
                "virtual": True,
            })
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(ctx.workspace, input_tables).manifest
            return ToolResult(text=json.dumps({
                "id": next(item.id for item in ctx.payload["workspace_inputs"].data
                           if item.path == f"data/{metadata.filename}"),
                "table_name": metadata.name, "content_hash": metadata.content_hash,
                "row_count": metadata.row_count, "operation": "update" if name == "update_data" else "create",
                "input_sources": sources, "origin": metadata.origin, "role": metadata.role,
                "edit_policy": metadata.edit_policy,
                "display_name": metadata.original_name,
                "path": f"data/{metadata.filename}",
                **({"acquisition": metadata.import_options["acquisition"]} if metadata.import_options and "acquisition" in metadata.import_options else {}),
            }, ensure_ascii=False))
        if name == "edit_file" and str(args.get("path") or "").startswith("session/"):
            return ToolResult(text=json.dumps(edit_session_file(args, ctx), ensure_ascii=False))
        if name in {"create_file", "edit_file"}:
            editing = name == "edit_file"
            filename = args.get("filename")
            content = args.get("content")
            expected_hash = args.get("expected_content_hash")
            patching = "replacements" in args or "append_text" in args
            if editing:
                raw_path = args.get("path")
                if not isinstance(raw_path, str) or not raw_path.startswith("files/"):
                    raise ValueError("path must identify a workspace file under files/")
                filename = raw_path.removeprefix("files/")
                metadata, original = ctx.workspace.read_workspace_file(filename)
                if metadata.origin != "agent" or metadata.edit_policy != "agent_editable":
                    raise ValueError("This workspace file is protected; create a copy instead")
                if not isinstance(expected_hash, str) or len(expected_hash) != 64 or any(
                    character not in "0123456789abcdef" for character in expected_hash
                ):
                    raise ValueError("expected_content_hash must be the current SHA-256 hash")
                current_hash = hashlib.sha256(original).hexdigest()
                if current_hash != expected_hash:
                    raise TextEditConflictError("File changed; read it again before editing")
                if sum(("content" in args, "code" in args, patching)) != 1:
                    raise ValueError("Provide exactly one of content, code, or a text patch")
                if patching:
                    if len(original) > 2_000_000:
                        raise ValueError("Text files must be under 2 MB")
                    content = apply_text_patch(
                        original.decode("utf-8"), expected_content_hash=expected_hash,
                        replacements=args.get("replacements"), append_text=args.get("append_text"),
                        max_chars=2_000_000,
                    )
            elif patching:
                raise ValueError("Text patches require edit_file")
            if args.get("replaces") is not None and not editing:
                raise ValueError("To replace a file, revise it with edit_file and replaces set to its path")
            # Fixing a file the user wants replaced rewrites it in place, even an app.
            replaces = replace_file_in_place(args, ctx) if editing else None
            display_name = args.get("display_name")
            if display_name is not None:
                if (not isinstance(display_name, str) or not display_name.strip()
                        or len(display_name.strip()) > 80
                        or any(ord(character) < 32 or ord(character) == 127 for character in display_name)):
                    raise ValueError("display_name must be a non-empty single-line title of at most 80 characters")
                display_name = display_name.strip()
            if not editing and (problem := agent_file_path_error(filename)):
                raise ValueError(problem)
            if "code" in args:
                if content is not None or not args.get("code") or not str(args.get("output_variable", "")).isidentifier():
                    raise ValueError("Provide either content or code with an output_variable")
                if ctx.runtime is None:
                    raise RuntimeError("Python runtime is unavailable")
                result = ctx.runtime.run_explore_code(
                    args["code"], ctx.payload.get("input_tables", []),
                    output_variable=args["output_variable"],
                )
                if result.get("status") != "ok":
                    raise ValueError(result.get("error", "Python execution failed"))
                content = result.get("output")
            import pandas as pd
            if isinstance(content, pd.DataFrame):
                if not filename.lower().endswith(".parquet"):
                    raise ValueError("DataFrame artifacts require a .parquet filename")
                buffer = io.BytesIO()
                content.to_parquet(buffer, index=False)
                encoded = buffer.getvalue()
            elif isinstance(content, bytes):
                encoded = content
            elif isinstance(content, str) and "\x00" not in content:
                encoded = content.encode("utf-8")
                if len(encoded) > 2_000_000:
                    raise ValueError("Text files must be under 2 MB")
            else:
                raise ValueError("Output must be a DataFrame, bytes, or UTF-8 text without null bytes")
            if len(encoded) > 128 * 1024 * 1024:
                raise ValueError("Files must be under 128 MB")
            app = None
            if editing:
                previous = original.decode("utf-8", errors="replace") if len(original) <= 2_000_000 else None
                app = check_app_revision(filename, previous, content, ctx) or check_map_revision(filename, content, ctx)
                if app is not None and display_name is None:
                    display_name = app["title"]
            elif filename.lower().endswith(REACT_APP_SUFFIX):
                raise ValueError("Create apps with write_app (html_app skill); it validates the code and opens the app")
            elif filename.lower().endswith(MAP_SUFFIX):
                raise ValueError("Create maps with write_map (map skill); it checks the spec against the data and opens the map")
            metadata = ctx.workspace.save_workspace_file(
                encoded, filename,
                "text/jsx" if filename.lower().endswith(REACT_APP_SUFFIX)
                else "application/json" if filename.lower().endswith(MAP_SUFFIX) else mimetypes.guess_type(filename)[0],
                expected_content_hash=expected_hash if editing else None,
                display_name=display_name, agent_managed=True,
                code_signature=sign_helper(filename, encoded),
            )
            record_run_artifact(ctx, "file", f"files/{metadata.name}", metadata.display_name or metadata.name)
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(
                ctx.workspace, ctx.payload.get("input_tables", []),
            ).manifest
            return ToolResult(text=json.dumps({
                "name": metadata.name, "path": f"files/{metadata.name}", "file_size": len(encoded),
                "content_hash": metadata.content_hash, "display_name": metadata.display_name,
                "origin": metadata.origin, "edit_policy": metadata.edit_policy,
                "url": f"/api/workspace/files/{quote(metadata.name, safe='')}",
                "temporary": False, "available_in_workspace": True,
                **({"app": True, "tables": app["tables"], "warnings": app["warnings"]} if app is not None else {}),
                **({"replaces": replaces} if replaces else {}),
                **self._helper_info(metadata.name),
            }, ensure_ascii=False))
        return ToolResult(text=f"workspace has no tool '{name}'.")

    @staticmethod
    def _helper_info(name: str) -> dict[str, Any]:
        """For a Python file: the module sandboxed code imports it as, or why it cannot."""
        if not name.endswith(".py"):
            return {}
        warnings = helper_warnings(name)
        module = helper_module_name(f"files/{name}")
        return {"helper_warnings": warnings} if warnings else {"importable_as": module}

    @staticmethod
    def _move_file(args: dict[str, Any], ctx: SkillContext) -> dict[str, Any]:
        source, target = args.get("path"), args.get("new_path")
        if not isinstance(source, str) or not source.startswith("files/"):
            raise ValueError("path must be a workspace file under files/")
        if not isinstance(target, str) or not target.startswith("files/"):
            raise ValueError("new_path must be under files/, e.g. files/notes/plan.md")
        name, new_name = source[len("files/"):], target[len("files/"):]
        if problem := agent_file_path_error(new_name):
            raise ValueError(problem)
        if name.lower().endswith(".app.jsx") != new_name.lower().endswith(".app.jsx"):
            raise ValueError("An app keeps its .app.jsx extension")
        if name.lower().endswith(MAP_SUFFIX) != new_name.lower().endswith(MAP_SUFFIX):
            raise ValueError("A map keeps its .map.json extension")
        if helper_module_name(source) and helper_module_name(source) != helper_module_name(target):
            from data_formulator.analyst.session_layer import session_layer
            layer = session_layer(ctx.payload)
            tables = layer.items()["tables"] if layer is not None else []
            users = [table.get("name") or table.get("id") for table in tables if file_imported(name, table)]
            if users:
                raise ValueError(f"The code of {', '.join(map(str, users))} imports {source}; moving it would break "
                                 "their refresh. Leave it in place or copy it instead.")
        try:
            moved = ctx.workspace.rename_workspace_file(name, new_name)
        except FileNotFoundError:
            raise ValueError(f"{source} does not exist. Use list_files to see the workspace files.") from None
        return {"moved": {"from": source, "to": f"files/{moved.name}"}, "content_hash": moved.content_hash,
                **WorkspaceSkill._helper_info(moved.name)}

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action == "propose_data_operation":
            return (yield from self._data_loading.handle_action(action, spec, ctx))
        yield {"type": "error", "message": f"workspace has no action '{action}'."}
        return f"workspace has no action '{action}'."


def get_skill() -> WorkspaceSkill:
    return WorkspaceSkill()