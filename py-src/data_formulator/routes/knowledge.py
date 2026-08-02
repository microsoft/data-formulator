# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Knowledge management API — CRUD + search + workflow distillation.

All endpoints use ``POST`` with JSON body.  Access is scoped to the
current user via ``get_identity_id()`` and confined via ``ConfinedDir``.
"""

from __future__ import annotations

import logging
import re

from flask import Blueprint, request

from data_formulator.error_handler import json_ok

from data_formulator.auth.identity import get_identity_id
from data_formulator.datalake.workspace import get_user_home
from data_formulator.errors import AppError, ErrorCode
from data_formulator.knowledge.store import KnowledgeStore, VALID_CATEGORIES, KNOWLEDGE_LIMITS

logger = logging.getLogger(__name__)

knowledge_bp = Blueprint("knowledge", __name__, url_prefix="/api/knowledge")


def _get_store() -> KnowledgeStore:
    identity_id = get_identity_id()
    user_home = get_user_home(identity_id)
    return KnowledgeStore(user_home)


def _require_json_field(data: dict, field: str) -> str:
    value = data.get(field, "")
    if not value or not isinstance(value, str) or not value.strip():
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            f"'{field}' is required",
        )
    return value.strip()


# ── limits ─────────────────────────────────────────────────────────────────


@knowledge_bp.route("/limits", methods=["POST"])
def knowledge_limits():
    """Return body-length and description limits so the frontend stays in sync."""
    return json_ok({"limits": KNOWLEDGE_LIMITS})


# ── list ──────────────────────────────────────────────────────────────────


@knowledge_bp.route("/list", methods=["POST"])
def knowledge_list():
    data = request.get_json(silent=True) or {}
    category = _require_json_field(data, "category")

    if category not in VALID_CATEGORIES:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            f"Invalid category: {category}",
        )

    store = _get_store()
    items = store.list_all(category)
    return json_ok({"items": items})


# ── read ──────────────────────────────────────────────────────────────────


@knowledge_bp.route("/read", methods=["POST"])
def knowledge_read():
    data = request.get_json(silent=True) or {}
    category = _require_json_field(data, "category")
    path = _require_json_field(data, "path")

    store = _get_store()
    try:
        content = store.read(category, path)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    except FileNotFoundError:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Knowledge file not found")

    return json_ok({"content": content, "category": category, "path": path})


# ── write ─────────────────────────────────────────────────────────────────


@knowledge_bp.route("/write", methods=["POST"])
def knowledge_write():
    data = request.get_json(silent=True) or {}
    category = _require_json_field(data, "category")
    path = _require_json_field(data, "path")
    content = data.get("content", "")
    if not isinstance(content, str):
        raise AppError(ErrorCode.INVALID_REQUEST, "'content' must be a string")

    store = _get_store()
    try:
        store.write(category, path, content)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc

    return json_ok({"category": category, "path": path})


# ── delete ────────────────────────────────────────────────────────────────


@knowledge_bp.route("/delete", methods=["POST"])
def knowledge_delete():
    data = request.get_json(silent=True) or {}
    category = _require_json_field(data, "category")
    path = _require_json_field(data, "path")

    store = _get_store()
    try:
        store.delete(category, path)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    except FileNotFoundError:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Knowledge file not found")

    return json_ok(None)


# ── search ────────────────────────────────────────────────────────────────


@knowledge_bp.route("/search", methods=["POST"])
def knowledge_search():
    data = request.get_json(silent=True) or {}
    query = data.get("query", "")
    categories = data.get("categories")

    if categories is not None:
        if not isinstance(categories, list):
            raise AppError(ErrorCode.INVALID_REQUEST, "'categories' must be a list")
        invalid = set(categories) - VALID_CATEGORIES
        if invalid:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                f"Invalid categories: {invalid}",
            )

    store = _get_store()
    results = store.search(query, categories=categories)
    return json_ok({"results": results})


# ── distill workflow ────────────────────────────────────────────────────


@knowledge_bp.route("/distill-workflow", methods=["POST"])
def distill_workflow():
    """Distill user-visible analysis context into a reusable workflow.

    Session-scoped payload (design-docs/24):
    ``workflow_context`` carries a list of ``threads`` (one per leaf
    derived table the user has on screen), each with its own chronological
    ``events`` array. ``workspace_id`` + ``workspace_name`` bind the
    resulting file to the active session so re-distilling upserts the
    same file.

    Required body fields: ``workflow_context`` and ``model``.
    Optional: ``user_instruction`` (natural-language focus hint for the LLM),
    ``category_hint`` (sub-directory under workflows/).
    """
    data = request.get_json(silent=True) or {}
    workflow_context = data.get("workflow_context")
    if not isinstance(workflow_context, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "'workflow_context' is required")

    threads = workflow_context.get("threads")
    if not isinstance(threads, list) or not threads:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "'workflow_context.threads' is required and must be a non-empty list",
        )

    workspace_id_raw = workflow_context.get("workspace_id", "")
    workspace_id = workspace_id_raw.strip() if isinstance(workspace_id_raw, str) else ""
    workspace_name_raw = workflow_context.get("workspace_name", "")
    workspace_name = workspace_name_raw.strip() if isinstance(workspace_name_raw, str) else ""
    if not workspace_id or not workspace_name:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "'workflow_context.workspace_id' and 'workspace_name' are required",
        )

    model_config = data.get("model")
    if not model_config or not isinstance(model_config, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "'model' configuration is required")

    user_instruction_raw = data.get("user_instruction", "")
    user_instruction = user_instruction_raw.strip() if isinstance(user_instruction_raw, str) else ""

    category_hint_raw = data.get("category_hint", "")
    category_hint = category_hint_raw.strip() if isinstance(category_hint_raw, str) else ""

    timeout_raw = data.get("timeout_seconds")
    timeout_seconds: int | None = None
    if isinstance(timeout_raw, (int, float)) and timeout_raw > 0:
        timeout_seconds = int(timeout_raw)

    identity_id = get_identity_id()
    user_home = get_user_home(identity_id)

    # Build client and run distillation
    from data_formulator.routes.agents import get_client, _get_ui_lang
    from data_formulator.agents.agent_workflow_distill import WorkflowDistillAgent

    client = get_client(model_config)

    agent = WorkflowDistillAgent(
        client=client,
        language_code=_get_ui_lang(),
        timeout_seconds=timeout_seconds,
    )
    try:
        md_content = agent.run(workflow_context, user_instruction=user_instruction)
    except Exception as exc:
        logger.warning("Workflow distillation LLM call failed: %s", type(exc).__name__)
        from data_formulator.error_handler import classify_and_wrap_llm_error
        raise classify_and_wrap_llm_error(exc) from exc

    # Save to knowledge/workflows/
    store = KnowledgeStore(user_home)

    # Bind the file to the workspace, set the title to the agent-generated
    # descriptive subtitle, and upsert below.
    md_content, title_core, filename_hint = _apply_session_front_matter(
        md_content, workspace_id, workspace_name,
    )

    filename = _workflow_filename(filename_hint or title_core or workspace_name)
    rel_path = f"{category_hint}/{filename}" if category_hint else filename

    # Upsert: if a previous workflow exists for this workspace at a
    # different path (e.g. user renamed the workspace), delete it after a
    # successful write so we keep one file per session.
    existing = store.find_workflow_by_workspace_id(workspace_id)

    try:
        store.write("workflows", rel_path, md_content)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc

    if existing and existing.get("path") and existing["path"] != rel_path:
        try:
            store.delete("workflows", existing["path"])
        except Exception:
            logger.warning(
                "Failed to delete stale session workflow at %s",
                existing.get("path"),
                exc_info=True,
            )

    return json_ok({"path": rel_path, "category": "workflows"})


# ── helpers for session-scoped distillation ───────────────────────────────


def _apply_session_front_matter(
    content: str, workspace_id: str, workspace_name: str,
) -> tuple[str, str, str]:
    """Override / inject session-binding fields in the workflow front matter.

    - Sets the visible ``title`` to the agent-emitted descriptive
      ``subtitle`` (preferred) or the pre-existing ``title``, with any
      legacy ``Workflow from <name>: `` prefix stripped. The ``subtitle``
      field is removed from the front matter once consumed.
    - Consumes the agent-emitted short ``filename`` hint (removed from the
      front matter) and returns it so the caller can name the file without
      using the long descriptive title.
    - Stamps ``source_workspace_id`` and ``source_workspace_name`` so the
      file can be looked up on subsequent distillations.
    - Forces ``source: distill`` (idempotent if already set).

    Returns ``(content_with_front_matter, title_core, filename_hint)``.
    """
    from data_formulator.knowledge.store import parse_front_matter

    meta, body = parse_front_matter(content)
    if not isinstance(meta, dict):
        meta = {}

    subtitle = str(meta.pop("subtitle", "") or "").strip()
    filename_hint = str(meta.pop("filename", "") or "").strip()
    existing_title = str(meta.get("title", "") or "").strip()

    # Strip any legacy "Workflow from <prev name>: " (or "Experience from")
    # prefix so update-mode runs don't carry it forward.
    title_core = subtitle or _strip_workflow_prefix(existing_title)
    if not title_core:
        title_core = workspace_name

    meta["title"] = title_core
    meta["source"] = "distill"
    meta["source_workspace_id"] = workspace_id
    meta["source_workspace_name"] = workspace_name

    return _serialize_front_matter(meta, body), title_core, filename_hint


_EXP_PREFIX_RE = re.compile(r"^\s*(?:Workflow|Experience) from .+?:\s*", re.IGNORECASE)

# Path separators, Windows-reserved chars and control chars that must never
# appear in a filename derived from untrusted LLM output.
_UNSAFE_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def _strip_workflow_prefix(title: str) -> str:
    return _EXP_PREFIX_RE.sub("", title).strip()


def _serialize_front_matter(meta: dict, body: str) -> str:
    """Render front matter back to YAML, preserving body verbatim."""
    import yaml

    yaml_text = yaml.safe_dump(
        meta, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).rstrip("\n")
    # Ensure body starts on a fresh line.
    body_text = body.lstrip("\n")
    return f"---\n{yaml_text}\n---\n\n{body_text}"


def _workflow_filename(title: str) -> str:
    """Slugify an LLM-supplied name into a clean, safe ``.md`` filename.

    Re-distilling a session upserts by ``source_workspace_id`` (see caller),
    so the file is replaced even when the name changes. ``safe_data_filename``
    enforces the security boundary (basename only, no ``.``/``..``); the slug
    step just keeps separators and reserved chars out so the name is clean and
    portable. Unicode (e.g. CJK) is preserved.
    """
    from data_formulator.datalake.parquet_utils import safe_data_filename

    cleaned = _UNSAFE_FILENAME_CHARS.sub("-", title)
    cleaned = re.sub(r"\s+", "-", cleaned.strip())
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    slug = cleaned.strip(".-").lower()[:80] or "session-workflow"
    try:
        return safe_data_filename(f"{slug}.md")
    except ValueError:
        return "session-workflow.md"
