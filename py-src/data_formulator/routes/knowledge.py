# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Knowledge management API — CRUD + search + experience distillation.

All endpoints use ``POST`` with JSON body.  Access is scoped to the
current user via ``get_identity_id()`` and confined via ``ConfinedDir``.
"""

from __future__ import annotations

import logging

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

    Required body fields: ``experience_context`` and ``model``.
    Optional: ``user_instruction`` (natural-language focus hint for the LLM),
    ``category_hint`` (sub-directory under experiences/).
    """
    data = request.get_json(silent=True) or {}
    experience_context = data.get("experience_context")
    if not isinstance(experience_context, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "'experience_context' is required")

    # Timeline payload (21.3): a single chronological list of events.
    events = experience_context.get("events")
    if not isinstance(events, list) or not events:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "'experience_context.events' is required and must be a non-empty list",
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
    context_id = str(experience_context.get("context_id") or "experience")
    filename = _experience_filename(context_id, md_content)
    if category_hint:
        rel_path = f"{category_hint}/{filename}"
    else:
        rel_path = filename

    try:
        store.write("experiences", rel_path, md_content)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc

    return json_ok({"path": rel_path, "category": "experiences"})


def _experience_filename(session_id: str, md_content: str) -> str:
    """Derive a filename from session_id and content title."""
    from data_formulator.datalake.parquet_utils import safe_data_filename
    from data_formulator.knowledge.store import parse_front_matter
    meta, _ = parse_front_matter(md_content)
    title = meta.get("title", "")
    if title:
        slug = title.strip().replace(" ", "-").lower()[:80]
        try:
            name = safe_data_filename(f"{slug}.md")
        except ValueError:
            name = f"{session_id}.md"
        return name
    return f"{session_id}.md"
