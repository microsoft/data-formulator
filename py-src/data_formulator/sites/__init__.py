# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Site profiles: one deployment serving specialized front pages by hostname.

A site (e.g. ``unesco``) is selected per request from the hostname
(``DF_SITES='{"unesco.data-formulator.ai": "unesco"}'``) or forced for the
whole server with ``DF_SITE=unesco`` (local testing). Requests without a site
keep today's behaviour and storage paths.

Each site has a profile in code (``sites/<id>/profile.yaml``: copy, starter
sessions, questions) and content on disk (``DF_SITES_DIR/<id>/<release>/``,
default ``<DATA_FORMULATOR_HOME>/site-content``) holding the starter-session
ZIPs. User data for a site is stored under ``<root>/sites/<id>/``.
"""

from __future__ import annotations

import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_SITE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
_PROFILE_DIR = Path(__file__).parent


@lru_cache(maxsize=None)
def site_profile(site_id: str) -> dict[str, Any] | None:
    """The profile for ``site_id`` shipped with the code, or None if there is none."""
    if not _SITE_ID.match(site_id or ""):
        return None
    path = _PROFILE_DIR / site_id / "profile.yaml"
    if not path.is_file():
        return None
    profile = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    profile["id"] = site_id
    return profile


@lru_cache(maxsize=4)
def _host_map(raw: str) -> dict[str, str]:
    try:
        mapping = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        logger.warning("DF_SITES is not valid JSON; ignoring it")
        return {}
    if not isinstance(mapping, dict):
        return {}
    return {str(host).strip().lower(): str(site).strip() for host, site in mapping.items()}


def current_site() -> str | None:
    """The site for the current request, or None for the default site."""
    forced = os.getenv("DF_SITE", "").strip()
    if forced:
        return forced if site_profile(forced) else None
    try:
        from flask import has_request_context, request
    except ImportError:
        return None
    if not has_request_context():
        return None
    host = (request.host or "").split(":", 1)[0].strip().lower()
    site = _host_map(os.getenv("DF_SITES", "")).get(host)
    return site if site and site_profile(site) else None


def site_scope(root: Path, site: str | None = None) -> Path:
    """``root`` for the default site; ``root/sites/<id>`` for a site's user data."""
    site = site if site is not None else current_site()
    return root / "sites" / site if site else root


def blob_site_prefix(site: str | None = None) -> str:
    site = site if site is not None else current_site()
    return f"sites/{site}/" if site else ""


def site_content_dir(site_id: str) -> Path:
    """Where the site's starter sessions for its current release live."""
    configured = os.getenv("DF_SITES_DIR")
    if configured:
        base = Path(configured).expanduser()
    else:
        from data_formulator.datalake.workspace import get_data_formulator_home
        base = get_data_formulator_home() / "site-content"
    profile = site_profile(site_id) or {}
    release = str(profile.get("release") or "").strip()
    return base / site_id / release if release else base / site_id


def site_starter(site_id: str, starter_id: str) -> dict[str, Any] | None:
    for starter in (site_profile(site_id) or {}).get("starters") or []:
        if starter.get("id") == starter_id:
            return starter
    return None


def site_frontend_config(site_id: str) -> dict[str, Any]:
    """The profile as sent to the frontend, with each starter's availability on disk."""
    profile = site_profile(site_id) or {}
    content = site_content_dir(site_id)
    starters = []
    for starter in profile.get("starters") or []:
        file_name = str(starter.get("file") or "")
        starters.append({
            "id": starter.get("id"),
            "title": starter.get("title", ""),
            "subtitle": starter.get("subtitle", ""),
            "description": starter.get("description", ""),
            "questions": list(starter.get("questions") or []),
            "available": bool(file_name) and (content / file_name).is_file(),
            "workspace": f"/api/site/starters/{starter.get('id')}",
        })
    return {
        "id": site_id,
        "name": profile.get("name", ""),
        "tagline": profile.get("tagline", ""),
        "intro": profile.get("intro", ""),
        "release": profile.get("release", ""),
        "attribution": profile.get("attribution", ""),
        "links": list(profile.get("links") or []),
        "starters": starters,
    }
