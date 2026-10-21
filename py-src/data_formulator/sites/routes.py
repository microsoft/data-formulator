# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Routes for the current site's starter and story sessions and front-page images."""

from flask import Blueprint, send_file

from data_formulator.errors import AppError, ErrorCode
from data_formulator.sites import current_site, site_content_dir, site_profile, site_starter, site_story

site_bp = Blueprint("site", __name__, url_prefix="/api/site")


@site_bp.route("/starters/<starter_id>", methods=["GET"])
def download_starter(starter_id: str):
    site = current_site()
    starter = site_starter(site, starter_id) if site else None
    file_name = str((starter or {}).get("file") or "")
    content_dir = site_content_dir(site) if site else None
    path = (content_dir / file_name) if content_dir and file_name else None
    # Starter files come from the profile in code; still refuse anything outside the content folder.
    if path is None or path.parent.resolve() != content_dir.resolve() or not path.is_file():
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Starter session not found.")
    return send_file(path, mimetype="application/zip", download_name=f"{starter_id}.zip")


def _story_path(story_id: str, field: str, index: int | None = None):
    site = current_site()
    story = site_story(site, story_id) if site else None
    value = (story or {}).get(field)
    if index is not None:
        items = value if isinstance(value, list) else []
        value = (items[index] or {}).get("image") if 0 <= index < len(items) and isinstance(items[index], dict) else None
    file_name = str(value or "")
    content_dir = site_content_dir(site) if site else None
    path = (content_dir / file_name) if content_dir and file_name else None
    # Paths come from the profile; still refuse anything outside the content folder.
    if path is None or not path.resolve().is_relative_to(content_dir.resolve()) or not path.is_file():
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Story not found.")
    return path


@site_bp.route("/stories/<story_id>", methods=["GET"])
def download_story(story_id: str):
    """A story's session (ZIP): its dataset with the story's question already answered."""
    return send_file(_story_path(story_id, "file"), mimetype="application/zip", download_name=f"{story_id}.zip")


@site_bp.route("/stories/<story_id>/image", methods=["GET"])
def story_image(story_id: str):
    """A story's cover image for the front page."""
    path = _story_path(story_id, "image")
    response = send_file(path, mimetype="image/png" if path.suffix == ".png" else None, max_age=3600)
    return response


@site_bp.route("/stories/<story_id>/stack/<int:index>", methods=["GET"])
def story_stack_image(story_id: str, index: int):
    """One chart of a story's front-page stack of findings."""
    path = _story_path(story_id, "stack", index)
    return send_file(path, mimetype="image/png" if path.suffix == ".png" else None, max_age=3600)


@site_bp.route("/hero", methods=["GET"])
def hero_image():
    """The front page's picture of the app at work."""
    site = current_site()
    file_name = str((site_profile(site) or {}).get("hero_image") or "") if site else ""
    content_dir = site_content_dir(site) if site else None
    path = (content_dir / file_name) if content_dir and file_name else None
    if path is None or not path.resolve().is_relative_to(content_dir.resolve()) or not path.is_file():
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Image not found.")
    return send_file(path, mimetype="image/png" if path.suffix == ".png" else None, max_age=3600)
