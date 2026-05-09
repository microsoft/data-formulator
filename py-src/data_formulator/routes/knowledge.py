# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Knowledge management API — CRUD + search + experience distillation.

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


# ── distill experience ────────────────────────────────────────────────────


@knowledge_bp.route("/distill-experience", methods=["POST"])
def distill_experience():
    """Distill user-visible analysis context into a reusable experience.

    Session-scoped payload (design-docs/24):
    ``experience_context`` carries a list of ``threads`` (one per leaf
    derived table the user has on screen), each with its own chronological
    ``events`` array. ``workspace_id`` + ``workspace_name`` bind the
    resulting file to the active session so re-distilling upserts the
    same file.

    Required body fields: ``experience_context`` and ``model``.
    Optional: ``user_instruction`` (natural-language focus hint for the LLM),
    ``category_hint`` (sub-directory under experiences/).
    """
    data = request.get_json(silent=True) or {}
    experience_context = data.get("experience_context")
    if not isinstance(experience_context, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "'experience_context' is required")

    threads = experience_context.get("threads")
    if not isinstance(threads, list) or not threads:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "'experience_context.threads' is required and must be a non-empty list",
        )

    workspace_id_raw = experience_context.get("workspace_id", "")
    workspace_id = workspace_id_raw.strip() if isinstance(workspace_id_raw, str) else ""
    workspace_name_raw = experience_context.get("workspace_name", "")
    workspace_name = workspace_name_raw.strip() if isinstance(workspace_name_raw, str) else ""
    if not workspace_id or not workspace_name:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "'experience_context.workspace_id' and 'workspace_name' are required",
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
    from data_formulator.agents.agent_experience_distill import ExperienceDistillAgent

    client = get_client(model_config)

    agent = ExperienceDistillAgent(
        client=client,
        language_code=_get_ui_lang(),
        timeout_seconds=timeout_seconds,
    )
    try:
        md_content = agent.run(experience_context, user_instruction=user_instruction)
    except Exception as exc:
        logger.warning("Experience distillation LLM call failed: %s", type(exc).__name__)
        from data_formulator.error_handler import classify_and_wrap_llm_error
        raise classify_and_wrap_llm_error(exc) from exc

    # Save to knowledge/experiences/
    store = KnowledgeStore(user_home)

    # Bind the file to the workspace, override title to
    # "Experience from <workspace name>: <subtitle>", and upsert below.
    md_content = _apply_session_front_matter(md_content, workspace_id, workspace_name)

    filename = _experience_filename(workspace_name)
    rel_path = f"{category_hint}/{filename}" if category_hint else filename

    # Upsert: if a previous experience exists for this workspace at a
    # different path (e.g. user renamed the workspace), delete it after a
    # successful write so we keep one file per session.
    existing = store.find_experience_by_workspace_id(workspace_id)

    try:
        store.write("experiences", rel_path, md_content)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc

    if existing and existing.get("path") and existing["path"] != rel_path:
        try:
            store.delete("experiences", existing["path"])
        except Exception:
            logger.warning(
                "Failed to delete stale session experience at %s",
                existing.get("path"),
                exc_info=True,
            )

    return json_ok({"path": rel_path, "category": "experiences"})


# ── helpers for session-scoped distillation ───────────────────────────────


def _apply_session_front_matter(
    content: str, workspace_id: str, workspace_name: str,
) -> str:
    """Override / inject session-binding fields in the experience front matter.

    - Composes the visible ``title`` as ``Experience from <name>: <subtitle>``
      using the LLM-emitted ``subtitle`` (preferred) or pre-existing
      ``title``. The original ``subtitle`` field is removed from the
      front matter once consumed.
    - Stamps ``source_workspace_id`` and ``source_workspace_name`` so the
      file can be looked up on subsequent distillations.
    - Forces ``source: distill`` (idempotent if already set).
    """
    from data_formulator.knowledge.store import parse_front_matter

    meta, body = parse_front_matter(content)
    if not isinstance(meta, dict):
        meta = {}

    subtitle = str(meta.pop("subtitle", "") or "").strip()
    existing_title = str(meta.get("title", "") or "").strip()

    # Strip any "Experience from <prev name>: " prefix from a prior pass so
    # update-mode runs don't double-prefix when the LLM echoes the title.
    title_core = subtitle or _strip_experience_prefix(existing_title)
    if not title_core:
        title_core = workspace_name

    new_title = f"Experience from {workspace_name}: {title_core}"
    meta["title"] = new_title
    meta["source"] = "distill"
    meta["source_workspace_id"] = workspace_id
    meta["source_workspace_name"] = workspace_name

    return _serialize_front_matter(meta, body)


_EXP_PREFIX_RE = re.compile(r"^\s*Experience from .+?:\s*", re.IGNORECASE)


def _strip_experience_prefix(title: str) -> str:
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


def _experience_filename(workspace_name: str) -> str:
    """Derive a deterministic filename from the workspace name.

    Re-distilling the same session always lands on the same file.
    Falls back to a literal slug when sanitisation rejects the name.
    """
    from data_formulator.datalake.parquet_utils import safe_data_filename

    slug = workspace_name.strip().replace(" ", "-").lower()[:80] or "session-experience"
    try:
        return safe_data_filename(f"{slug}.md")
    except ValueError:
        return "session-experience.md"
