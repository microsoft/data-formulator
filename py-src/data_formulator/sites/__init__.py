# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Demo front pages ("sites" in code and settings), configured without code (see ``demos/README.md``).

A site is a folder ``<DF_SITES_DIR>/<id>/`` (default ``DF_SITES_DIR`` is
``<DATA_FORMULATOR_HOME>/site-content``) with a ``profile.yaml`` (text,
datasets, example sessions, analyst guidance) and its content in
``<release>/`` (session ZIPs, images). In a source checkout, the profile may
instead come from the repository's ``demos/<id>/``, e.g. the UIS example.

The site is selected per request from the hostname
(``DF_SITES='{"unesco.data-formulator.ai": "unesco"}'``) or for the whole
server with ``DF_SITE=unesco``. Requests without a site keep the standard app
and storage paths. User data for a site is stored under ``<root>/sites/<id>/``.
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
_PACKAGE_DIR = Path(__file__).resolve().parent.parent
# The repository's demos, in a source checkout.
_REPO_DEMOS_DIR = _PACKAGE_DIR.parent.parent / "demos"


def sites_dir() -> Path:
    """The folder holding each site's ``<id>/profile.yaml`` and content."""
    configured = os.getenv("DF_SITES_DIR")
    if configured:
        return Path(configured).expanduser()
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home() / "site-content"


@lru_cache(maxsize=None)
def site_profile(site_id: str) -> dict[str, Any] | None:
    """The profile for ``site_id`` from the sites folder (or this checkout's demos/), or None."""
    if not _SITE_ID.fullmatch(site_id or ""):
        return None
    path = next((base / site_id / "profile.yaml" for base in (sites_dir(), _REPO_DEMOS_DIR)
                 if (base / site_id / "profile.yaml").is_file()), None)
    if path is None:
        return None
    # Profiles are edited by hand; a mistake disables the site rather than breaking the app.
    try:
        profile = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        logger.error("Site %r: cannot read %s: %s", site_id, path, exc)
        return None
    problem = _profile_problem(profile)
    if problem:
        logger.error("Site %r: %s in %s", site_id, problem, path)
        return None
    profile["id"] = site_id
    return profile


def _profile_problem(profile: Any) -> str | None:
    """What makes ``profile`` unusable as a site profile, or None."""
    if not isinstance(profile, dict):
        return "the profile is not a mapping of fields"
    starters = profile.get("starters") or []
    if not isinstance(starters, list) or not all(isinstance(starter, dict) for starter in starters):
        return "'starters' is not a list of datasets"
    for starter in starters:
        if not str(starter.get("id") or "").strip():
            return "a starter has no 'id'"
        stories = starter.get("stories") or []
        if not isinstance(stories, list) or not all(isinstance(story, dict) for story in stories):
            return f"starter {starter['id']!r}: 'stories' is not a list of stories"
        for story in stories:
            # The story's question: answered in its saved session, or asked live when there is none.
            if not str(story.get("id") or "").strip() or not str(story.get("prompt") or "").strip():
                return f"starter {starter['id']!r}: every story needs an 'id' and a 'prompt'"
    for field in ("about", "links"):
        if not isinstance(profile.get(field) or [], list):
            return f"'{field}' is not a list"
    return None


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


def warn_about_missing_sites() -> None:
    """Log configured sites (``DF_SITE``, ``DF_SITES``) that have no usable profile."""
    forced = os.getenv("DF_SITE", "").strip()
    configured = set(_host_map(os.getenv("DF_SITES", "")).values()) | ({forced} if forced else set())
    for site_id in sorted(configured):
        if not site_profile(site_id):
            logger.warning("Site %r is configured but %s has no valid profile.yaml; those requests get the "
                           "standard app (see demos/README.md).", site_id, sites_dir() / site_id)


def site_scope(root: Path, site: str | None = None) -> Path:
    """``root`` for the default site; ``root/sites/<id>`` for a site's user data."""
    site = site if site is not None else current_site()
    return root / "sites" / site if site else root


def blob_site_prefix(site: str | None = None) -> str:
    site = site if site is not None else current_site()
    return f"sites/{site}/" if site else ""


def site_content_dir(site_id: str) -> Path:
    """Where the site's starter sessions for its current release live."""
    base = sites_dir()
    profile = site_profile(site_id) or {}
    release = str(profile.get("release") or "").strip()
    return base / site_id / release if release else base / site_id


def site_starter(site_id: str, starter_id: str) -> dict[str, Any] | None:
    for starter in (site_profile(site_id) or {}).get("starters") or []:
        if starter.get("id") == starter_id:
            return starter
    return None


def site_analyst_rules(site_id: str | None) -> str:
    """The site's standing guidance for the analyst (audience, tone), added to every request's rules."""
    return str(((site_profile(site_id) or {}) if site_id else {}).get("analyst_rules") or "").strip()


def site_story(site_id: str, story_id: str) -> dict[str, Any] | None:
    """An example analysis listed under one of the site's starters."""
    for starter in (site_profile(site_id) or {}).get("starters") or []:
        for story in starter.get("stories") or []:
            if story.get("id") == story_id:
                return story
    return None


def _version(path: Path) -> str:
    """A query string that changes when the file does, so browsers never show a stale image."""
    return f"?v={int(path.stat().st_mtime)}"


def _story_config(story: dict[str, Any], content: Path) -> dict[str, Any]:
    story_id = str(story.get("id") or "")
    session = str(story.get("file") or "")
    image = str(story.get("image") or "")
    return {
        "id": story_id,
        "label": story.get("label", ""),
        "headline": story.get("headline", ""),
        "dek": story.get("dek", ""),
        "featured": bool(story.get("featured")),
        "prompt": str(story.get("prompt") or "").strip(),
        "follow_ups": [str(question) for question in story.get("follow_ups") or []],
        # A saved session opening on the prompt already answered; without one the analyst runs the prompt live.
        "available": bool(session) and (content / session).is_file(),
        "session": f"/api/site/stories/{story_id}",
        "image": f"/api/site/stories/{story_id}/image{_version(content / image)}" if image and (content / image).is_file() else None,
        # A few findings to show as a stack of chart cards; only those whose image is built.
        "stack": [{"label": str(item.get("label") or ""), "image": f"/api/site/stories/{story_id}/stack/{index}{_version(content / str(item['image']))}"}
                  for index, item in enumerate(story.get("stack") or [])
                  if isinstance(item, dict) and item.get("image") and (content / str(item["image"])).is_file()],
    }


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
            "kicker": starter.get("kicker", ""),
            "source_url": starter.get("source_url", ""),
            "icon": starter.get("icon", ""),
            "start_note": starter.get("start_note", ""),
            "stories": [_story_config(story, content) for story in starter.get("stories") or []],
        })
    return {
        "id": site_id,
        "name": profile.get("name", ""),
        "headline": profile.get("headline", ""),
        "badge": profile.get("badge", ""),
        "tagline": profile.get("tagline", ""),
        "intro": profile.get("intro", ""),
        "about": [str(item) for item in profile.get("about") or []],
        "release": profile.get("release", ""),
        "hero_image": f"/api/site/hero{_version(content / hero)}" if (hero := str(profile.get("hero_image") or "")) and (content / hero).is_file() else None,
        "attribution": profile.get("attribution", ""),
        "disclaimer": profile.get("disclaimer", ""),
        "links": list(profile.get("links") or []),
        "starters": starters,
    }
