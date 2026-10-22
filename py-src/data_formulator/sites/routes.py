# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Routes for a demo's starter and story sessions, front-page images and (locally) its install."""

from flask import Blueprint, send_file

from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.sites import site_content_dir, site_profile, site_starter, site_story

site_bp = Blueprint("site", __name__, url_prefix="/api/demos")


def _content_file(site: str, file_name: str, message: str):
    content_dir = site_content_dir(site) if site_profile(site) else None
    path = (content_dir / file_name) if content_dir and file_name else None
    # Paths come from the profile; still refuse anything outside the content folder.
    if path is None or not path.resolve().is_relative_to(content_dir.resolve()) or not path.is_file():
        raise AppError(ErrorCode.TABLE_NOT_FOUND, message)
    return path


@site_bp.route("/<site>/starters/<starter_id>", methods=["GET"])
def download_starter(site: str, starter_id: str):
    file_name = str((site_starter(site, starter_id) or {}).get("file") or "") if site_profile(site) else ""
    path = _content_file(site, file_name, "Starter session not found.")
    return send_file(path, mimetype="application/zip", download_name=f"{starter_id}.zip")


def _story_path(site: str, story_id: str, field: str, index: int | None = None):
    story = site_story(site, story_id) if site_profile(site) else None
    value = (story or {}).get(field)
    if index is not None:
        items = value if isinstance(value, list) else []
        value = (items[index] or {}).get("image") if 0 <= index < len(items) and isinstance(items[index], dict) else None
    return _content_file(site, str(value or ""), "Story not found.")


def _image(path):
    return send_file(path, mimetype="image/png" if path.suffix == ".png" else None, max_age=3600)


@site_bp.route("/<site>/stories/<story_id>", methods=["GET"])
def download_story(site: str, story_id: str):
    """A story's session (ZIP): its dataset with the story's question already answered."""
    return send_file(_story_path(site, story_id, "file"), mimetype="application/zip",
                     download_name=f"{story_id}.zip")


@site_bp.route("/<site>/stories/<story_id>/image", methods=["GET"])
def story_image(site: str, story_id: str):
    """A story's cover image for the front page."""
    return _image(_story_path(site, story_id, "image"))


@site_bp.route("/<site>/stories/<story_id>/stack/<int:index>", methods=["GET"])
def story_stack_image(site: str, story_id: str, index: int):
    """One chart of a story's front-page stack of findings."""
    return _image(_story_path(site, story_id, "stack", index))


@site_bp.route("/<site>/hero", methods=["GET"])
def hero_image(site: str):
    """The front page's picture of the app at work."""
    file_name = str((site_profile(site) or {}).get("hero_image") or "")
    return _image(_content_file(site, file_name, "Image not found."))


@site_bp.route("/<site>/install", methods=["POST"])
def start_install(site: str):
    """Start building and installing the demo's content (local installs only)."""
    from data_formulator.sites.install import start
    return json_ok(start(site))


@site_bp.route("/<site>/install", methods=["GET"])
def install_status(site: str):
    from data_formulator.sites.install import status
    return json_ok(status(site))
