from __future__ import annotations

import json
import io
import hashlib
import mimetypes
from pathlib import PurePosixPath
from urllib.parse import quote
from typing import Any, Generator

from data_formulator.datalake.text_edit import apply_text_patch, TextEditConflictError
from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.analyst.input_provenance import normalize_input_sources
from data_formulator.analyst.workspace_inputs import (
    WorkspaceInputEngine,
    workspace_memory_is_fresh,
)
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
        if name in {
            "summarize_data_sources", "list_data", "find_data", "describe_data", "probe_data",
            "list_connectors", "describe_connector", "read_connector_form",
        }:
            return self._data_loading.handle_tool(name, args, ctx)
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
                    sources.extend(normalize_input_sources({"input_sources": [source]}, engine.manifest))
            for source in sources:
                item = next((item for item in engine.manifest.inputs if item.id == source["id"]), None)
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
                display_name=display_name,
            )
            input_tables = ctx.payload.setdefault("input_tables", [])
            input_tables[:] = [table for table in input_tables if table.get("name") != metadata.name]
            input_tables.append({
                "name": metadata.name, "rows": json.loads(frame.head(20).to_json(orient="records", date_format="iso")),
                "virtual": True,
            })
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(ctx.workspace, input_tables).manifest
            return ToolResult(text=json.dumps({
                "table_name": metadata.name, "content_hash": metadata.content_hash,
                "row_count": metadata.row_count, "operation": "update" if name == "update_data" else "create",
                "input_sources": sources, "origin": metadata.origin, "role": metadata.role,
                "edit_policy": metadata.edit_policy,
                "display_name": metadata.original_name,
                "path": f"data/{metadata.filename}",
            }, ensure_ascii=False))
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
            display_name = args.get("display_name")
            if display_name is not None:
                if (not isinstance(display_name, str) or not display_name.strip()
                        or len(display_name.strip()) > 80
                        or any(ord(character) < 32 or ord(character) == 127 for character in display_name)):
                    raise ValueError("display_name must be a non-empty single-line title of at most 80 characters")
                display_name = display_name.strip()
            if not editing and (not isinstance(filename, str) or not filename.strip() or filename != filename.strip()
                    or len(filename.encode("utf-8")) > 255 or filename.startswith((".", "_"))
                    or filename == "data_operations"
                    or any(character in '/\\' or ord(character) < 32 for character in filename)):
                raise ValueError("filename must be a visible filename without directories")
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
            metadata = ctx.workspace.save_workspace_file(
                encoded, filename, mimetypes.guess_type(filename)[0],
                expected_content_hash=expected_hash if editing else None,
                display_name=display_name, agent_managed=True,
            )
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(
                ctx.workspace, ctx.payload.get("input_tables", []),
            ).manifest
            return ToolResult(text=json.dumps({
                "name": metadata.name, "path": f"files/{metadata.name}", "file_size": len(encoded),
                "content_hash": metadata.content_hash, "display_name": metadata.display_name,
                "origin": metadata.origin, "edit_policy": metadata.edit_policy,
                "url": f"/api/workspace/files/{quote(metadata.name, safe='')}",
                "temporary": False, "available_in_workspace": True,
            }, ensure_ascii=False))
        input_tables = (ctx.payload or {}).get("input_tables") or []
        input_tool_names = {
            "list_workspace_items",
            "read_workspace_item",
            "search_workspace_items",
        }
        input_engine = (
            WorkspaceInputEngine(ctx.workspace, input_tables)
            if name in input_tool_names else None
        )
        if name == "list_workspace_items" and input_engine is not None:
            scope = args.get("scope", "input")
            query = str(args.get("query", "")).casefold().strip()
            if scope == "input":
                result = json.loads(input_engine.list_items(
                    kinds=args.get("kinds"),
                    query=args.get("query", ""),
                ))
                return ToolResult(text=json.dumps({
                    "scope": scope,
                    "items": result["inputs"],
                    "count": result["count"],
                }, ensure_ascii=False))
            if args.get("kinds"):
                raise ValueError("kinds is only supported for input scope")
            if scope == "memory":
                items = [
                    {
                        "id": item.id,
                        "name": item.name,
                        "kind": item.kind,
                        "media_type": item.media_type,
                        "path": f"memory/{item.filename}",
                        "description": item.description,
                        "content_hash": item.content_hash,
                        "row_count": item.row_count,
                        "columns": [column.name for column in item.columns],
                        "sources": [source.__dict__ for source in item.sources],
                        "fresh": workspace_memory_is_fresh(item, ctx.workspace),
                        "updated_at": item.updated_at.isoformat(),
                    }
                    for item in ctx.workspace.list_memory()
                    if not query or query in item.name.casefold()
                ]
            elif scope == "temp":
                items = []
                for raw_path in ctx.workspace.list_scratch_files():
                    path = PurePosixPath(str(raw_path))
                    display_name = ctx.workspace.get_scratch_display_name(path.as_posix().removeprefix("scratch/"))
                    if query and query not in path.name.casefold() and query not in (display_name or "").casefold():
                        continue
                    with ctx.workspace.resolve_scratch_file(path.as_posix().removeprefix("scratch/")).open("rb") as source:
                        content_hash = hashlib.file_digest(source, "sha256").hexdigest()
                    items.append({
                        "id": f"temp:{path.as_posix()}",
                        "name": path.name,
                        **({"display_name": display_name} if display_name else {}),
                        "kind": "temp",
                        "content_hash": content_hash,
                        "path": path.as_posix(),
                        "capabilities": ["python"],
                    })
            else:
                raise ValueError(f"Unsupported workspace item scope: {scope}")
            return ToolResult(text=json.dumps({
                "scope": scope,
                "items": items,
                "count": len(items),
            }, ensure_ascii=False))
        if name == "read_workspace_item" and input_engine is not None:
            return ToolResult(text=input_engine.read_item(
                args.get("item_id", ""),
                locator=args.get("locator"),
                options=args.get("options"),
                limit=args.get("limit", 200),
            ))
        if name == "search_workspace_items" and input_engine is not None:
            return ToolResult(text=input_engine.search_items(
                args.get("query", ""),
                input_ids=args.get("item_ids"),
                kinds=args.get("kinds"),
                options=args.get("options"),
                max_results=args.get("max_results", 20),
            ))
        return ToolResult(text=f"workspace has no tool '{name}'.")

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action in {"propose_data_operation", "propose_connection", "update_connector_form"}:
            return (yield from self._data_loading.handle_action(action, spec, ctx))
        yield {"type": "error", "message": f"workspace has no action '{action}'."}
        return f"workspace has no action '{action}'."


def get_skill() -> WorkspaceSkill:
    return WorkspaceSkill()