# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Routes for a space's starter and story sessions, front-page images and (locally) its install."""

from flask import Blueprint, send_file

from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.spaces import known_space_id, space_content_dir, space_logo_path, space_profile, space_starter, space_story

space_bp = Blueprint("space", __name__, url_prefix="/api/spaces")


def _site(space: str) -> str:
    """The URL's space as named on disk; an unknown one becomes "", which no lookup below finds."""
    return known_space_id(space) or ""


def _content_file(space: str, file_name: str, message: str):
    content_dir = space_content_dir(space) if space_profile(space) else None
    path = (content_dir / file_name) if content_dir and file_name else None
    # Paths come from the profile; still refuse anything outside the content folder.
    if path is None or not path.resolve().is_relative_to(content_dir.resolve()) or not path.is_file():
        raise AppError(ErrorCode.TABLE_NOT_FOUND, message)
    return path


@space_bp.route("/<space>/starters/<starter_id>", methods=["GET"])
def download_starter(space: str, starter_id: str):
    space = _site(space)
    file_name = str((space_starter(space, starter_id) or {}).get("file") or "") if space_profile(space) else ""
    path = _content_file(space, file_name, "Starter session not found.")
    return send_file(path, mimetype="application/zip", download_name=f"{starter_id}.zip")


def _story_path(space: str, story_id: str, field: str, index: int | None = None):
    story = space_story(space, story_id) if space_profile(space) else None
    value = (story or {}).get(field)
    if index is not None:
        items = value if isinstance(value, list) else []
        value = (items[index] or {}).get("image") if 0 <= index < len(items) and isinstance(items[index], dict) else None
    return _content_file(space, str(value or ""), "Story not found.")


def _image(path):
    return send_file(path, mimetype="image/png" if path.suffix == ".png" else None, max_age=3600)


@space_bp.route("/<space>/stories/<story_id>", methods=["GET"])
def download_story(space: str, story_id: str):
    """A story's session (ZIP): its dataset with the story's question already answered."""
    space = _site(space)
    return send_file(_story_path(space, story_id, "file"), mimetype="application/zip",
                     download_name=f"{story_id}.zip")


@space_bp.route("/<space>/stories/<story_id>/image", methods=["GET"])
def story_image(space: str, story_id: str):
    """A story's cover image for the front page."""
    space = _site(space)
    return _image(_story_path(space, story_id, "image"))


@space_bp.route("/<space>/stories/<story_id>/stack/<int:index>", methods=["GET"])
def story_stack_image(space: str, story_id: str, index: int):
    """One chart of a story's front-page stack of findings."""
    space = _site(space)
    return _image(_story_path(space, story_id, "stack", index))


@space_bp.route("/<space>/hero", methods=["GET"])
def hero_image(space: str):
    """The front page's picture of the app at work."""
    space = _site(space)
    file_name = str((space_profile(space) or {}).get("hero_image") or "")
    return _image(_content_file(space, file_name, "Image not found."))


@space_bp.route("/<space>/logo", methods=["GET"])
def logo_image(space: str):
    """The space's logo, shown beside its name (from its shipped assets until it is installed)."""
    path = space_logo_path(_site(space)) if _site(space) else None
    if path is None:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Image not found.")
    response = _image(path)
    # An SVG opened on its own runs no scripts.
    response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
    return response


@space_bp.route("/<space>/install", methods=["POST"])
def start_install(space: str):
    """Start building and installing the space's content (local installs only)."""
    from data_formulator.spaces.install import start
    space = _site(space)
    return json_ok(start(space))


@space_bp.route("/<space>/install", methods=["GET"])
def install_status(space: str):
    from data_formulator.spaces.install import status
    space = _site(space)
    return json_ok(status(space))
