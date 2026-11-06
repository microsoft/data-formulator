"""The session state the layer is built from (design-docs/61).

Interactive runs send it with the request (``session_state``: the browser's state,
allow-listed, without preview rows or images); server-side runs read the saved
``session_state.json``. Both pass through :func:`normalize_state`.
"""

from __future__ import annotations

from typing import Any

ALLOWED_KEYS = (
    "inputTables", "derivedTables", "loadedTableNodes", "fileNodes", "artifactSets",
    "externalTableReferences", "tableSemantics", "draftNodes", "charts", "conceptShelfItems",
    "focusedId", "generatedReports", "textTurns", "activeWorkspace",
)
_LIST_KEYS = tuple(key for key in ALLOWED_KEYS if key not in ("focusedId", "activeWorkspace"))
_DROPPED = frozenset({"rows", "thumbnail", "chartThumbnails"})


def _slim(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _slim(item) for key, item in value.items() if key not in _DROPPED}
    if isinstance(value, list):
        return [_slim(item) for item in value]
    if isinstance(value, str) and value.startswith("data:") and len(value) > 1000:
        return f"<{value[:value.find(',')] if ',' in value else 'data'} omitted>"
    return value


def _reply_legacy_answers(state: dict[str, Any]) -> None:
    """Sessions saved before state version 10 keep the user's reply to an agent turn in its ``answer``;
    the application turns it into a request message on load (``stateMigrations.ts``). Do the same for saved
    states read without a browser, so threads keep the user's requests."""
    turns = state["textTurns"]
    if not any(isinstance(turn.get("answer"), str) and turn["answer"].strip() for turn in turns):
        return
    nodes = [node for key in ("textTurns", "derivedTables", "draftNodes", "loadedTableNodes", "fileNodes",
                              "generatedReports", "artifactSets") for node in state[key]]
    ids = {node.get("id") for node in nodes}
    for turn in list(turns):
        answer = turn.pop("answer", None)
        answer = answer.strip() if isinstance(answer, str) else ""
        if not answer:
            continue
        children = [node for node in nodes if node.get("parentNodeId") == turn.get("id")]
        if any(child.get("kind") == "text" and str(child.get("prompt") or "").strip() == answer for child in children):
            continue
        reply_id = f"{turn['id']}-reply"
        while reply_id in ids:
            reply_id += "-migrated"
        ids.add(reply_id)
        created = [float(child["createdAt"]) for child in children if _number(child.get("createdAt"))]
        reply = {"kind": "text", "id": reply_id, "displayId": reply_id, "textKind": "explain", "content": "",
                 "prompt": answer, "parentNodeId": turn["id"],
                 "createdAt": min([*created, float(turn.get("createdAt") or 0) + 1])}
        for child in children:
            if not (child.get("kind") == "text" and child.get("prompt") and not child.get("content")):
                child["parentNodeId"] = reply_id
        turns.append(reply)
        nodes.append(reply)


def _number(value: Any) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def normalize_state(state: Any) -> dict[str, Any]:
    """The allow-listed state: lists default to empty, preview rows and embedded images left out."""
    source = state if isinstance(state, dict) else {}
    normalized: dict[str, Any] = {}
    for key in _LIST_KEYS:
        value = source.get(key)
        normalized[key] = _slim([item for item in value if isinstance(item, dict)]) if isinstance(value, list) else []
    _reply_legacy_answers(normalized)
    focus = source.get("focusedId")
    normalized["focusedId"] = focus if isinstance(focus, dict) else None
    workspace = source.get("activeWorkspace")
    normalized["activeWorkspace"] = {"id": workspace.get("id"), "displayName": workspace.get("displayName")} \
        if isinstance(workspace, dict) else None
    return normalized


def load_saved_state(identity_id: str | None, workspace_id: str | None) -> dict[str, Any] | None:
    """The saved state, for runs without a browser (workflows, schedules)."""
    if not identity_id or not workspace_id:
        return None
    try:
        from data_formulator.workspace_factory import get_workspace_manager
        state = get_workspace_manager(identity_id).load_session_state(workspace_id)
    except Exception:
        return None
    return state if isinstance(state, dict) else None
