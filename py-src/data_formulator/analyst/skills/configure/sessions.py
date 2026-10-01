"""Session discovery and organization for the configure skill."""

from __future__ import annotations

from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext

from .forms import form_event, identity_of, review_requested

MAX_SUMMARIZED_SESSIONS = 200
MAX_SESSIONS = 50


def _manager(ctx: SkillContext):
    from data_formulator.workspace_factory import get_workspace_manager

    return get_workspace_manager(identity_of(ctx))


def _unique(values, limit: int) -> list[str]:
    seen: list[str] = []
    for value in values:
        text = " ".join(str(value or "").split())
        if text and text not in seen:
            seen.append(text[:160])
        if len(seen) >= limit:
            break
    return seen


def session_summary(state: dict[str, Any] | None) -> dict[str, Any]:
    """Summarize saved session content for search without loading table rows."""
    state = state if isinstance(state, dict) else {}
    turns = [turn for turn in state.get("textTurns") or [] if isinstance(turn, dict)]
    derived = [table for table in state.get("derivedTables") or [] if isinstance(table, dict)]
    prompts = [turn.get("prompt") for turn in turns]
    prompts += [entry.get("content") for table in derived
                for entry in ((table.get("derive") or {}).get("trigger") or {}).get("interaction") or []
                if isinstance(entry, dict) and entry.get("role") == "prompt"]
    return {
        "data": _unique((table.get("displayId") or table.get("id") for table in state.get("inputTables") or []
                         if isinstance(table, dict)), 12),
        "prompts": _unique(prompts, 6),
        "reports": _unique((report.get("title") for report in state.get("generatedReports") or []
                            if isinstance(report, dict)), 6),
        "workflows": _unique((((turn.get("workflowDefinition") or {}).get("definition") or {}).get("name")
                              or (turn.get("workflow") or {}).get("overview") for turn in turns
                              if turn.get("workflowDefinition") or turn.get("workflow")), 6),
        "chart_count": len(state.get("charts") or []),
    }


def list_sessions(args: dict[str, Any], ctx: SkillContext) -> dict[str, Any]:
    manager = _manager(ctx)
    query_terms = str(args.get("query") or "").casefold().split()
    try:
        limit = max(1, min(int(args.get("limit") or 20), 50))
    except (TypeError, ValueError):
        limit = 20
    empty_only = args.get("empty") is True
    current = ctx.payload.get("workspace_id")
    workspaces = manager.list_workspaces()
    matches = []
    for index, workspace in enumerate(workspaces):
        summary = {}
        if index < MAX_SUMMARIZED_SESSIONS:
            try:
                summary = session_summary(manager.load_session_state(workspace["id"]))
            except (OSError, ValueError):
                summary = {}
        entry = {
            "id": workspace["id"],
            "name": workspace.get("display_name") or workspace["id"],
            "current": workspace["id"] == current,
            "created_at": workspace.get("created_at"),
            "updated_at": workspace.get("updated_at"),
            "table_count": workspace.get("table_count"),
            "chart_count": workspace.get("chart_count", summary.get("chart_count")),
            **({"scheduled_run": workspace["scheduled_run"]} if workspace.get("scheduled_run") else {}),
            **{key: value for key, value in summary.items() if key != "chart_count" and value},
        }
        text = str(entry).casefold()
        if empty_only and (entry.get("table_count") or entry.get("chart_count") or summary.get("reports")):
            continue
        if all(term in text for term in query_terms):
            matches.append(entry)
    return {
        "sessions": matches[:limit],
        "count": min(len(matches), limit),
        "total_matches": len(matches),
        "total_sessions": len(workspaces),
        "current_session_id": current,
        "note": ("Sessions are newest first. Show sessions the user asked to find with propose_session_changes, "
                 "which lets them open, rename, or delete each one."),
    }


def _clean_text(value: Any, limit: int) -> str | None:
    text = " ".join(str(value or "").split())
    if not text or len(text) > limit or any(ord(character) < 32 or ord(character) == 127 for character in text):
        return None
    return text


def propose_session_changes(spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
    """Show sessions in a panel where the user renames, opens, or deletes each one.

    The agent may suggest names; they apply only when the user asked for the
    rename (``user_review_needed: false``), otherwise they prefill the rename
    field. Deletion is always the user's own per-session action.
    """
    try:
        review = review_requested(spec)
    except ValueError as exc:
        return str(exc)
    manager = _manager(ctx)
    workspaces = {item["id"]: item for item in manager.list_workspaces()}
    current = ctx.payload.get("workspace_id")
    if current and current not in workspaces:
        # A provisional session stays unlisted until it holds work; it can still be renamed.
        workspaces[current] = {"id": current, "display_name": "Current session"}
    raw_items = spec.get("sessions") or []
    if not isinstance(raw_items, list) or len(raw_items) > MAX_SESSIONS:
        return f"sessions must be a list of at most {MAX_SESSIONS} entries."
    items: list[dict[str, Any]] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            return "Each session entry needs a session_id."
        session_id = raw.get("session_id")
        workspace = workspaces.get(session_id)
        if workspace is None:
            return f"Unknown session {session_id!r}. Call list_sessions for current IDs."
        if any(item["session_id"] == session_id for item in items):
            continue
        current_name = workspace.get("display_name") or session_id
        suggested = None
        if raw.get("display_name") is not None:
            suggested = _clean_text(raw["display_name"], 120)
            if suggested is None:
                return "Session names must be non-empty single-line text of at most 120 characters."
        reason = _clean_text(raw.get("reason"), 200) if raw.get("reason") else None
        items.append({
            "session_id": session_id, "current_name": current_name, "current": session_id == current,
            **({"suggested_name": suggested} if suggested and suggested != current_name else {}),
            **({"reason": reason} if reason else {}),
            **{key: workspace[key] for key in ("updated_at", "table_count", "chart_count") if workspace.get(key) is not None},
        })
    open_id = spec.get("open_session_id")
    if open_id is not None and open_id not in workspaces:
        return f"Unknown session {open_id!r}. Call list_sessions for current IDs."
    if open_id == current:
        open_id = None
    if not items and not open_id:
        return "Nothing to show: list at least one session or a session to open."
    opening = {"session_id": open_id, "display_name": workspaces[open_id].get("display_name") or open_id} if open_id else None
    title = _clean_text(spec.get("title"), 80) or (
        f"Open {opening['display_name']}" if opening and not items else
        f"{len(items)} session{'s' if len(items) != 1 else ''}")
    renames = any("suggested_name" in item for item in items)
    auto_submit = not review and (renames or bool(opening))
    yield form_event(
        "sessions", ctx,
        title=title,
        body={"items": items, **({"open": opening} if opening else {})},
        default_response=("Applying the requested session changes." if auto_submit
                          else "Here are the sessions; rename, open, or delete each one from the panel."),
        auto_submit=auto_submit,
    )
    return None
