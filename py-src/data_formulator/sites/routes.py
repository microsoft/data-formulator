# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Routes for the current site's starter sessions."""

from flask import Blueprint, send_file

from data_formulator.errors import AppError, ErrorCode
from data_formulator.sites import current_site, site_content_dir, site_starter

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
