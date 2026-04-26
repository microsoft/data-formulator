# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Knowledge management API — CRUD + search + experience distillation.

All endpoints use ``POST`` with JSON body.  Access is scoped to the
current user via ``get_identity_id()`` and confined via ``ConfinedDir``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from flask import Blueprint, jsonify, request

from data_formulator.auth.identity import get_identity_id
from data_formulator.datalake.workspace import get_user_home
from data_formulator.errors import AppError, ErrorCode
from data_formulator.knowledge.store import KnowledgeStore, VALID_CATEGORIES
from data_formulator.security.path_safety import ConfinedDir

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
    return jsonify({"status": "ok", "items": items})


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

    return jsonify({"status": "ok", "content": content, "category": category, "path": path})


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

    return jsonify({"status": "ok", "category": category, "path": path})


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

    return jsonify({"status": "ok"})


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
    return jsonify({"status": "ok", "results": results})


# ── distill experience ────────────────────────────────────────────────────


@knowledge_bp.route("/distill-experience", methods=["POST"])
def distill_experience():
    """Distill a reasoning log into a reusable experience document.

    Required body fields: ``session_id``, ``user_question``, ``model``.
    Optional: ``category_hint`` (sub-directory under experiences/).
    """
    data = request.get_json(silent=True) or {}
    session_id = _require_json_field(data, "session_id")
    user_question = _require_json_field(data, "user_question")
    model_config = data.get("model")
    if not model_config or not isinstance(model_config, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "'model' configuration is required")

    category_hint = data.get("category_hint", "").strip()

    identity_id = get_identity_id()
    user_home = get_user_home(identity_id)

    # Read the reasoning log for the given session
    log_lines = _read_session_log(user_home, session_id)
    if not log_lines:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "No reasoning log found for this session",
        )

    # Build client and run distillation
    from data_formulator.routes.agents import get_client, get_language_instruction
    from data_formulator.agents.agent_experience_distill import ExperienceDistillAgent

    client = get_client(model_config)
    language_instruction = get_language_instruction(mode="full")

    agent = ExperienceDistillAgent(
        client=client,
        language_instruction=language_instruction,
    )
    md_content = agent.run(log_lines, user_question, session_id=session_id)

    # Save to knowledge/experiences/
    store = _get_store()
    filename = _experience_filename(session_id, md_content)
    if category_hint:
        rel_path = f"{category_hint}/{filename}"
    else:
        rel_path = filename

    try:
        store.write("experiences", rel_path, md_content)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc

    return jsonify({
        "status": "ok",
        "path": rel_path,
        "category": "experiences",
    })


def _read_session_log(user_home: Path, session_id: str) -> list[dict]:
    """Find and read the JSONL log file for *session_id*.

    Searches all date sub-directories under ``agent-logs/`` for a file
    whose name starts with the session_id.  All I/O goes through
    :class:`ConfinedDir` for path safety.
    """
    logs_root = user_home / "agent-logs"
    if not logs_root.is_dir():
        return []

    try:
        jail = ConfinedDir(logs_root, mkdir=False)
    except Exception:
        return []

    for date_dir in sorted(jail.iterdir(), reverse=True):
        if not date_dir.is_dir():
            continue
        rel_date = date_dir.name
        for log_file in jail.iterdir(rel_date):
            if log_file.name.startswith(session_id) and log_file.suffix == ".jsonl":
                try:
                    rel_path = f"{rel_date}/{log_file.name}"
                    content = jail.read_text(rel_path)
                    lines = content.strip().splitlines()
                    return [json.loads(line) for line in lines if line.strip()]
                except Exception:
                    logger.warning("Failed to read log file %s", log_file.name)
                    return []

    return []


def _experience_filename(session_id: str, md_content: str) -> str:
    """Derive a filename from session_id and content title."""
    from data_formulator.datalake.parquet_utils import safe_data_filename
    from data_formulator.knowledge.store import parse_front_matter
    meta, _ = parse_front_matter(md_content)
    title = meta.get("title", "")
    if title:
        slug = title.strip().replace(" ", "-").lower()[:50]
        try:
            name = safe_data_filename(f"{slug}.md")
        except ValueError:
            name = f"{session_id}.md"
        return name
    return f"{session_id}.md"
