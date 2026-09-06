from __future__ import annotations

import json
from pathlib import PurePosixPath
from typing import Any, Generator

from data_formulator.analyst.input_provenance import memory_sources
from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.analyst.workspace_inputs import (
    WorkspaceInputEngine,
    workspace_memory_is_fresh,
)


class WorkspaceSkill:
    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
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
                for raw_path in (ctx.payload or {}).get("scratch_files", []) or []:
                    path = PurePosixPath(str(raw_path))
                    if len(path.parts) != 2 or path.parts[0] != "scratch" or ".." in path.parts:
                        continue
                    if query and query not in path.name.casefold():
                        continue
                    items.append({
                        "id": f"temp:{path.as_posix()}",
                        "name": path.name,
                        "kind": "temp",
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
        if name == "manage_workspace_memory":
            return self._manage_memory(args, ctx)
        return ToolResult(text=f"workspace has no tool '{name}'.")

    @staticmethod
    def _manage_memory(args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        action = args.get("action")
        memory_id = str(args.get("memory_id", "")).strip()
        if action == "rename":
            if not memory_id or not str(args.get("name", "")).strip():
                raise ValueError("rename requires memory_id and name")
            memory = ctx.workspace.rename_memory(memory_id, args["name"])
            return ToolResult(text=json.dumps({"id": memory.id, "name": memory.name}))
        if action == "delete":
            if not memory_id:
                raise ValueError("delete requires memory_id")
            return ToolResult(text=json.dumps({
                "id": memory_id,
                "deleted": ctx.workspace.delete_memory(memory_id),
            }))
        if action == "patch":
            memory = ctx.workspace.patch_memory_text(
                memory_id,
                expected_content_hash=args.get("expected_content_hash"),
                replacements=args.get("replacements"),
                append_text=args.get("append_text"),
            )
            return ToolResult(text=json.dumps({
                "id": memory.id,
                "name": memory.name,
                "kind": memory.kind,
                "content_hash": memory.content_hash,
                "file_size": memory.file_size,
                "updated_at": memory.updated_at.isoformat(),
            }))
        if action not in {"save", "refresh"}:
            raise ValueError(f"Unsupported memory action: {action}")
        existing = ctx.workspace.get_memory_metadata(memory_id) if memory_id else None
        if action == "refresh" and existing is None:
            raise ValueError("refresh requires a valid memory_id")
        if action == "save" and args.get("kind") not in {"table", "text"}:
            raise ValueError("save requires kind: table or text")
        kind = args.get("kind") or getattr(existing, "kind", "table")
        if kind not in {"table", "text"}:
            raise ValueError(f"Unsupported memory kind: {kind}")
        if existing is not None and existing.kind != kind:
            raise ValueError("refresh cannot change memory kind")
        name_arg = str(args.get("name") or getattr(existing, "name", "")).strip()
        description = args.get("description")
        if description is None and existing is not None:
            description = existing.description
        if not name_arg or not str(description or "").strip():
            raise ValueError(f"{action} requires name and description")
        if kind == "text":
            content = args.get("content")
            if not isinstance(content, str):
                raise ValueError(f"{action} of text memory requires content")
            raw_sources = args.get("input_sources")
            sources = (
                memory_sources(raw_sources, (ctx.payload or {}).get("workspace_inputs"))
                if raw_sources
                else list(getattr(existing, "sources", []))
            )
            memory = ctx.workspace.write_memory_text(
                content,
                name_arg,
                sources=sources,
                description=str(description),
                memory_id=memory_id if action == "refresh" else None,
            )
            return ToolResult(text=json.dumps({
                "id": memory.id,
                "name": memory.name,
                "kind": memory.kind,
                "path": f"memory/{memory.filename}",
                "content_hash": memory.content_hash,
                "file_size": memory.file_size,
                "source_count": len(memory.sources),
            }, ensure_ascii=False))
        if ctx.runtime is None:
            raise RuntimeError("Memory execution runtime is unavailable")
        for field in ("code", "output_variable"):
            if not str(args.get(field, "")).strip():
                raise ValueError(f"{action} requires {field}")
        sources = memory_sources(
            args.get("input_sources"),
            (ctx.payload or {}).get("workspace_inputs"),
        )
        result = ctx.runtime.materialize_memory_table(
            args["code"],
            args["output_variable"],
            name_arg,
            sources,
            description=str(description),
            memory_id=memory_id if action == "refresh" else None,
        )
        if result.get("status") != "ok":
            raise ValueError(result.get("error", "Failed to save table memory"))
        return ToolResult(text=json.dumps(result["memory"], ensure_ascii=False))

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        yield {"type": "error", "message": f"workspace has no action '{action}'."}
        return f"workspace has no action '{action}'."


def get_skill() -> WorkspaceSkill:
    return WorkspaceSkill()