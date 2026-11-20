# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Demo front pages ("sites" in code), configured without code (see ``demos/README.md``).

A demo is served at ``/demo/<id>``: the page sends the id with each API request in the
``X-DF-Demo`` header, which selects the demo's profile, analyst guidance and its users' own
storage (``<root>/sites/<id>/``). Requests without it are the standard app.

Data Formulator ships the demos in ``data_formulator/demos/<id>/`` (profile, images, build
script); a demo's content (session ZIPs) is installed into ``<DF_SITES_DIR>/<id>/<release>/``
(default ``<DATA_FORMULATOR_HOME>/site-content``) by its ``build.py``, from the page on a local
install. A profile installed there takes precedence over the shipped one. ``DF_SITE=<id>``
makes ``/`` open that demo.
"""

from __future__ import annotations

import logging
import os
import re
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator

import yaml

logger = logging.getLogger(__name__)

DEMO_HEADER = "X-DF-Demo"
_SITE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
# The demos shipped with Data Formulator.
PACKAGED_DEMOS = Path(__file__).resolve().parent.parent / "demos"
# Image types a site's logo may be.
LOGO_SUFFIXES = (".svg", ".png", ".jpg", ".jpeg", ".webp")


def sites_dir() -> Path:
    """The folder holding each demo's installed ``<id>/profile.yaml`` and content."""
    configured = os.getenv("DF_SITES_DIR")
    if configured:
        return Path(configured).expanduser()
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home() / "site-content"


def packaged_demo_dir(site_id: str) -> Path | None:
    """The demo's folder shipped with Data Formulator (profile, images, build.py), if any."""
    if not _SITE_ID.fullmatch(site_id or ""):
        return None
    folder = PACKAGED_DEMOS / site_id
    return folder if (folder / "profile.yaml").is_file() else None


def offered_demos() -> set[str] | None:
    """The demos this server offers (``DF_DEMOS``, comma-separated ids), or None for all it has."""
    listed = {item.strip() for item in os.getenv("DF_DEMOS", "").split(",") if item.strip()}
    return listed or None


@lru_cache(maxsize=None)
def site_profile(site_id: str) -> dict[str, Any] | None:
    """The demo's profile: installed in the sites folder, else shipped with Data Formulator; or None (also for a
    demo the server does not offer, ``DF_DEMOS``)."""
    if not _SITE_ID.fullmatch(site_id or ""):
        return None
    offered = offered_demos()
    if offered is not None and site_id not in offered:
        return None
    path = next((base / site_id / "profile.yaml" for base in (sites_dir(), PACKAGED_DEMOS)
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
    for field in ("about", "links", "suggestions", "sources", "models", "workflows"):
        if not isinstance(profile.get(field) or [], list):
            return f"'{field}' is not a list"
    if not all(isinstance(item, str) and item.strip() for item in profile.get("models") or []):
        return "'models' is not a list of model ids"
    if not all(isinstance(item, str) and item.startswith("server/") for item in profile.get("workflows") or []):
        return "'workflows' is not a list of server workflows (server/<name>.yaml)"
    from data_formulator.sites.data_folder import SAFE_NAME
    for source in profile.get("sources") or []:
        connector = isinstance(source, dict) and set(source) == {"connector"} and isinstance(source["connector"], str) \
            and bool(source["connector"].strip())
        folder = isinstance(source, dict) and set(source) <= {"folder", "name"} and isinstance(source.get("folder"), str) \
            and bool(SAFE_NAME.fullmatch(source["folder"])) and isinstance(source.get("name", ""), str)
        if not (connector or folder):
            return "each of 'sources' must be {connector: <connector id>} or {folder: <folder name>, name: <label>}"
    if "logo" in profile and not (isinstance(profile["logo"], str) and Path(profile["logo"]).suffix.lower() in LOGO_SUFFIXES):
        return f"'logo' is not an image file name ({', '.join(LOGO_SUFFIXES)})"
    if profile.get("chart_theme") is not None:
        from data_formulator.analyst.session_edits import chart_catalog
        from data_formulator.themes import validate_theme
        try:
            validate_theme(profile["chart_theme"], list(chart_catalog()["themes"]))
        except ValueError as exc:
            return f"'chart_theme': {exc}"
    return None


def referenced_files(profile: dict[str, Any]) -> list[str]:
    """Every content file the profile names, relative to its release folder."""
    files = [profile.get("hero_image"), profile.get("logo")]
    for starter in profile.get("starters") or []:
        files.append(starter.get("file"))
        for story in starter.get("stories") or []:
            files += [story.get("file"), story.get("image")]
            files += [item.get("image") for item in story.get("stack") or [] if isinstance(item, dict)]
    return [str(name) for name in files if name]


def demo_status(site_id: str) -> str | None:
    """``"ready"`` when every file the profile names is installed, ``"not_installed"`` otherwise,
    or None when there is no such demo."""
    profile = site_profile(site_id)
    if not profile:
        return None
    content = site_content_dir(site_id)
    ready = all((content / name).is_file() for name in referenced_files(profile))
    return "ready" if ready else "not_installed"


def all_demo_ids() -> list[str]:
    """Every demo with a valid profile, installed or shipped."""
    ids = set()
    for base in (sites_dir(), PACKAGED_DEMOS):
        if base.is_dir():
            ids |= {folder.name for folder in base.iterdir() if (folder / "profile.yaml").is_file()}
    return sorted(site_id for site_id in ids if site_profile(site_id))


def known_site_id(site_id: str | None) -> str | None:
    """The demo named ``site_id``, or None when there is no such demo.

    The id returned is the demo folder's name as listed on disk, never the caller's string, so a
    request's value cannot reach the storage and content paths built from it.
    """
    if not site_id or not _SITE_ID.fullmatch(site_id):
        return None
    for base in (sites_dir(), PACKAGED_DEMOS):
        try:
            names = os.listdir(base)
        except OSError:
            continue
        name = next((name for name in names if name == site_id), None)
        if name is not None:
            return name if site_profile(name) else None
    return None


# A scope set for a stretch of code (``in_scope``), over the request's: e.g. a demo's scheduled run, or copying a
# demo session into the standard app. Holds ``(site,)`` so that "the standard app" (None) can be set too.
_SCOPE: ContextVar[tuple[str | None] | None] = ContextVar("df_site_scope", default=None)


@contextmanager
def in_scope(site: str | None) -> Iterator[None]:
    """Run the block in ``site``'s scope (None: the standard app), whatever the request's demo is."""
    token = _SCOPE.set((site,))
    try:
        yield
    finally:
        _SCOPE.reset(token)


def current_site() -> str | None:
    """The demo the current scope belongs to: ``in_scope``'s, else the request's ``X-DF-Demo`` header; None for the
    standard app."""
    scope = _SCOPE.get()
    if scope is not None:
        return scope[0]
    try:
        from flask import has_request_context, request
    except ImportError:
        return None
    if not has_request_context():
        return None
    return known_site_id((request.headers.get(DEMO_HEADER) or "").strip())


def current_site_connector_ids() -> set[str] | None:
    """The connections the current request's demo offers (its profile's ``sources``: administrator connections and
    its data folders), or None in the standard app. A demo offers only these: no other admin connection, the example
    datasets or the visitor's own."""
    from data_formulator.sites.data_folder import folder_connector_id
    site = current_site()
    if site is None:
        return None
    sources = (site_profile(site) or {}).get("sources") or []
    return {source["connector"] if "connector" in source else folder_connector_id(site, source["folder"]) for source in sources}


def current_site_model_ids() -> set[str] | None:
    """The server models the current request's demo offers (its profile's ``models``); None offers them all (the
    standard app, or a demo that lists none)."""
    site = current_site()
    models = (site_profile(site) or {}).get("models") if site else None
    return set(models) if models else None


def current_site_workflows() -> set[str] | None:
    """The server workflows (``server/<name>``) the current request's demo offers (its profile's ``workflows``), or
    None in the standard app. A demo offers only these; Data Formulator's example workflows are the standard app's."""
    site = current_site()
    if site is None:
        return None
    return set((site_profile(site) or {}).get("workflows") or [])


def site_folder_sources(site_id: str) -> list[tuple[str, str, Path]]:
    """The demo's installed data folders, as ``(connector id, label, path)``."""
    from data_formulator.sites.data_folder import folder_connector_id, folder_sources
    profile = site_profile(site_id) or {}
    content = site_content_dir(site_id)
    return [(folder_connector_id(site_id, source["folder"]), str(source.get("name") or source["folder"]), path)
            for source in folder_sources(profile) if (path := content / source["folder"]).is_dir()]


def default_demo() -> str | None:
    """The demo ``/`` opens (``DF_SITE``), or None for the standard home page."""
    site = os.getenv("DF_SITE", "").strip()
    return site if site and site_profile(site) else None


def warn_about_missing_sites() -> None:
    """Log a ``DF_SITE`` that names no demo."""
    site = os.getenv("DF_SITE", "").strip()
    if site and not site_profile(site):
        logger.warning("DF_SITE=%r names no demo (no valid profile.yaml in %s or the shipped demos); "
                       "/ shows the standard app (see demos/README.md).", site, sites_dir() / site)


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


def _story_config(site_id: str, story: dict[str, Any], content: Path) -> dict[str, Any]:
    story_id = str(story.get("id") or "")
    session = str(story.get("file") or "")
    image = str(story.get("image") or "")
    return {
        "id": story_id,
        "label": story.get("label", ""),
        "title": story.get("title", ""),
        "headline": story.get("headline", ""),
        "dek": story.get("dek", ""),
        "featured": bool(story.get("featured")),
        "prompt": str(story.get("prompt") or "").strip(),
        "follow_ups": [str(question) for question in story.get("follow_ups") or []],
        # A saved session opening on the prompt already answered; without one the analyst runs the prompt live.
        "available": bool(session) and (content / session).is_file(),
        "session": f"/api/demos/{site_id}/stories/{story_id}",
        "image": f"/api/demos/{site_id}/stories/{story_id}/image{_version(content / image)}" if image and (content / image).is_file() else None,
        # A few findings to show as a stack of chart cards; only those whose image is built.
        "stack": [{"label": str(item.get("label") or ""), "image": f"/api/demos/{site_id}/stories/{story_id}/stack/{index}{_version(content / str(item['image']))}"}
                  for index, item in enumerate(story.get("stack") or [])
                  if isinstance(item, dict) and item.get("image") and (content / str(item["image"])).is_file()],
        # A session holding several findings: its chapters (stories, maps), each with its finding and, optionally, its
        # key figure (a short stat and the message it goes with), listed on its card.
        "chapters": [{"label": str(item.get("label") or ""), "kind": str(item.get("kind") or ""),
                      "headline": str(item.get("headline") or ""), "stat": str(item.get("stat") or ""),
                      "message": str(item.get("message") or "")}
                     for item in story.get("chapters") or [] if isinstance(item, dict)],
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
            "summary": starter.get("summary", ""),
            "questions": list(starter.get("questions") or []),
            "available": bool(file_name) and (content / file_name).is_file(),
            "workspace": f"/api/demos/{site_id}/starters/{starter.get('id')}",
            "kicker": starter.get("kicker", ""),
            "source_url": starter.get("source_url", ""),
            "source_name": starter.get("source_name", ""),
            "icon": starter.get("icon", ""),
            "start_note": starter.get("start_note", ""),
            "stories": [_story_config(site_id, story, content) for story in starter.get("stories") or []],
        })
    return {
        "id": site_id,
        "name": profile.get("name", ""),
        "headline": profile.get("headline", ""),
        "badge": profile.get("badge", ""),
        "tagline": profile.get("tagline", ""),
        "suggestions": [str(item) for item in profile.get("suggestions") or []],
        "chat_placeholder": profile.get("chat_placeholder", ""),
        "intro": profile.get("intro", ""),
        "about": [str(item) for item in profile.get("about") or []],
        "release": profile.get("release", ""),
        "hero_image": f"/api/demos/{site_id}/hero{_version(content / hero)}" if (hero := str(profile.get("hero_image") or "")) and (content / hero).is_file() else None,
        "logo": f"/api/demos/{site_id}/logo{_version(content / logo)}" if (logo := str(profile.get("logo") or "")) and (content / logo).is_file() else None,
        # The site's own chart theme (a Flint ThemeSpec): new charts and maps on the site use it.
        **({"chart_theme": profile["chart_theme"]} if isinstance(profile.get("chart_theme"), dict) else {}),
        "attribution": profile.get("attribution", ""),
        "disclaimer": profile.get("disclaimer", ""),
        "install_note": profile.get("install_note", ""),
        "links": list(profile.get("links") or []),
        "workspace_collapsed": bool(profile.get("workspace_collapsed")),
        "starters": starters,
    }
