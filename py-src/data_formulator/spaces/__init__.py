# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Spaces: Data Formulator set up around a space's data, configured without code (see ``spaces/README.md`` and
design-docs/77).

A space is served at ``/space/<id>``: the page sends the id with each API request in the ``X-DF-Space`` header, which selects the space's profile, analyst guidance and its users' own storage
(``<root>/sites/<id>/``). Requests without it are the standard app. A space adds content; what users may do (their
own connections, folders, tools) is the deployment's, the same as in the standard app.

Data Formulator ships the spaces in ``data_formulator/spaces/shipped/<id>/`` (profile, images, build script); a space's
content (session ZIPs) is installed into ``<DF_SPACES_DIR>/<id>/<release>/`` (default
``<DATA_FORMULATOR_HOME>/site-content``) by its ``build.py``, from the page on a local install. A profile installed
there takes precedence over the shipped one. ``DF_SPACE=<id>`` makes ``/`` open that space.

Stored names keep the words from before spaces were named so: users' work is under ``<root>/sites/<id>/``, installed
content under ``site-content/``, and data-folder connectors are ``demo-<id>-<folder>``.
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

SPACE_HEADER = "X-DF-Space"
_SPACE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
# The spaces shipped with Data Formulator.
SHIPPED_SPACES = Path(__file__).resolve().parent / "shipped"
# Image types a space's logo may be.
LOGO_SUFFIXES = (".svg", ".png", ".jpg", ".jpeg", ".webp")


def _setting(name: str) -> str:
    return os.getenv(name, "").strip()


def space_setting(space_id: str, key: str) -> list[str] | None:
    """The operator's per-space list ``DF_SPACES__<id>__<key>`` (comma-separated; ``-`` in the id may be written
    ``_``), or None when it is not set."""
    for variant in dict.fromkeys((space_id, space_id.replace("-", "_"))):
        value = os.getenv(f"DF_SPACES__{variant}__{key}")
        if value is not None:
            return [item.strip() for item in value.split(",") if item.strip()]
    return None


def spaces_dir() -> Path:
    """The folder holding each space's installed ``<id>/profile.yaml`` and content."""
    configured = _setting("DF_SPACES_DIR")
    if configured:
        return Path(configured).expanduser()
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home() / "site-content"


def shipped_space_dir(space_id: str) -> Path | None:
    """The space's folder shipped with Data Formulator (profile, images, build.py), if any."""
    if not _SPACE_ID.fullmatch(space_id or ""):
        return None
    folder = SHIPPED_SPACES / space_id
    return folder if (folder / "profile.yaml").is_file() else None


def offered_spaces() -> set[str] | None:
    """The spaces this server offers (``DF_SPACES``, comma-separated ids), or None for all it has."""
    listed = {item.strip() for item in _setting("DF_SPACES").split(",") if item.strip()}
    return listed or None


@lru_cache(maxsize=None)
def space_profile(space_id: str) -> dict[str, Any] | None:
    """The space's profile: installed in the spaces folder, else shipped with Data Formulator; or None (also for a
    space the server does not offer, ``DF_SPACES``)."""
    if not _SPACE_ID.fullmatch(space_id or ""):
        return None
    offered = offered_spaces()
    if offered is not None and space_id not in offered:
        return None
    path = next((base / space_id / "profile.yaml" for base in (spaces_dir(), SHIPPED_SPACES)
                 if (base / space_id / "profile.yaml").is_file()), None)
    if path is None:
        return None
    # Profiles are edited by hand; a mistake disables the space rather than breaking the app.
    try:
        profile = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        logger.error("Space %r: cannot read %s: %s", space_id, path, exc)
        return None
    problem = _profile_problem(profile)
    if problem:
        logger.error("Space %r: %s in %s", space_id, problem, path)
        return None
    profile["id"] = space_id
    return profile


def _profile_problem(profile: Any) -> str | None:
    """What makes ``profile`` unusable as a space profile, or None."""
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
    from data_formulator.spaces.data_folder import SAFE_NAME
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


def space_status(space_id: str) -> str | None:
    """``"ready"`` when every file the profile names is installed, ``"not_installed"`` otherwise,
    or None when there is no such space."""
    profile = space_profile(space_id)
    if not profile:
        return None
    content = space_content_dir(space_id)
    ready = all((content / name).is_file() for name in referenced_files(profile))
    return "ready" if ready else "not_installed"


def all_space_ids() -> list[str]:
    """Every space with a valid profile, installed or shipped."""
    ids = set()
    for base in (spaces_dir(), SHIPPED_SPACES):
        if base.is_dir():
            ids |= {folder.name for folder in base.iterdir() if (folder / "profile.yaml").is_file()}
    return sorted(space_id for space_id in ids if space_profile(space_id))


def known_space_id(space_id: str | None) -> str | None:
    """The space named ``space_id``, or None when there is no such space.

    The id returned is the space folder's name as listed on disk, never the caller's string, so a
    request's value cannot reach the storage and content paths built from it.
    """
    if not space_id or not _SPACE_ID.fullmatch(space_id):
        return None
    for base in (spaces_dir(), SHIPPED_SPACES):
        try:
            names = os.listdir(base)
        except OSError:
            continue
        name = next((name for name in names if name == space_id), None)
        if name is not None:
            return name if space_profile(name) else None
    return None


# A scope set for a stretch of code (``in_scope``), over the request's: e.g. a space's scheduled run, or copying a
# space session into the standard app. Holds ``(space,)`` so that "the standard app" (None) can be set too.
_SCOPE: ContextVar[tuple[str | None] | None] = ContextVar("df_site_scope", default=None)


@contextmanager
def in_scope(space: str | None) -> Iterator[None]:
    """Run the block in ``space``'s scope (None: the standard app), whatever the request's space is."""
    token = _SCOPE.set((space,))
    try:
        yield
    finally:
        _SCOPE.reset(token)


def current_space() -> str | None:
    """The space the current scope belongs to: ``in_scope``'s, else the request's ``X-DF-Space`` header; None for the
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
    return known_space_id((request.headers.get(SPACE_HEADER) or "").strip())


def current_space_connector_ids() -> set[str] | None:
    """The administrator connections the current request's space shows, or None in the standard app: its profile's
    ``sources`` (connections and its data folders) and those the operator exposes there (``DF_SPACES__<id>__connectors``,
    e.g. ``sample_datasets`` for the example datasets). Users' own connections follow the deployment's policy, as in
    the standard app."""
    from data_formulator.spaces.data_folder import folder_connector_id
    space = current_space()
    if space is None:
        return None
    sources = (space_profile(space) or {}).get("sources") or []
    listed = {source["connector"] if "connector" in source else folder_connector_id(space, source["folder"]) for source in sources}
    return listed | set(space_setting(space, "connectors") or [])


def current_space_model_ids() -> set[str] | None:
    """The server models the current request's space offers: the operator's ``DF_SPACES__<id>__models``, else the
    profile's ``models``; None offers them all (the standard app, or a space with neither)."""
    space = current_space()
    if space is None:
        return None
    models = space_setting(space, "models") or (space_profile(space) or {}).get("models")
    return set(models) if models else None


def current_space_workflows() -> set[str] | None:
    """The server workflows (``server/<name>``) the current request's space offers (its profile's ``workflows``), or
    None in the standard app. A space offers only these; Data Formulator's example workflows are the standard app's."""
    space = current_space()
    if space is None:
        return None
    return set((space_profile(space) or {}).get("workflows") or [])


def space_folder_sources(space_id: str) -> list[tuple[str, str, Path]]:
    """The space's installed data folders, as ``(connector id, label, path)``."""
    from data_formulator.spaces.data_folder import folder_connector_id, folder_sources
    profile = space_profile(space_id) or {}
    content = space_content_dir(space_id)
    return [(folder_connector_id(space_id, source["folder"]), str(source.get("name") or source["folder"]), path)
            for source in folder_sources(profile) if (path := content / source["folder"]).is_dir()]


def default_space() -> str | None:
    """The space ``/`` opens (``DF_SPACE``), or None for the standard home page."""
    space = _setting("DF_SPACE")
    return space if space and space_profile(space) else None


def warn_about_missing_spaces() -> None:
    """Log a ``DF_SPACE`` that names no space."""
    space = _setting("DF_SPACE")
    if space and not space_profile(space):
        logger.warning("DF_SPACE=%r names no space (no valid profile.yaml in %s or the shipped spaces); "
                       "/ shows the standard app (see spaces/README.md).", space, spaces_dir() / space)


def space_scope(root: Path, space: str | None = None) -> Path:
    """``root`` for the default space; ``root/sites/<id>`` for a space's user data."""
    space = space if space is not None else current_space()
    return root / "sites" / space if space else root


def blob_space_prefix(space: str | None = None) -> str:
    space = space if space is not None else current_space()
    return f"sites/{space}/" if space else ""


def space_content_dir(space_id: str) -> Path:
    """Where the space's starter sessions for its current release live."""
    base = spaces_dir()
    profile = space_profile(space_id) or {}
    release = str(profile.get("release") or "").strip()
    return base / space_id / release if release else base / space_id


def space_starter(space_id: str, starter_id: str) -> dict[str, Any] | None:
    for starter in (space_profile(space_id) or {}).get("starters") or []:
        if starter.get("id") == starter_id:
            return starter
    return None


def space_analyst_rules(space_id: str | None) -> str:
    """The space's standing guidance for the analyst (audience, tone), added to every request's rules."""
    return str(((space_profile(space_id) or {}) if space_id else {}).get("analyst_rules") or "").strip()


def space_story(space_id: str, story_id: str) -> dict[str, Any] | None:
    """An example analysis listed under one of the space's starters."""
    for starter in (space_profile(space_id) or {}).get("starters") or []:
        for story in starter.get("stories") or []:
            if story.get("id") == story_id:
                return story
    return None


def _version(path: Path) -> str:
    """A query string that changes when the file does, so browsers never show a stale image."""
    return f"?v={int(path.stat().st_mtime)}"


def space_logo_path(space_id: str) -> Path | None:
    """The space's logo file: in its installed content, else in its shipped ``assets/`` (so the menu can show it
    before it is installed); None when it has none."""
    name = str((space_profile(space_id) or {}).get("logo") or "")
    if not name:
        return None
    packaged = shipped_space_dir(space_id)
    for base in (space_content_dir(space_id), packaged / "assets" if packaged else None):
        path = base / name if base else None
        if path and path.resolve().is_relative_to(base.resolve()) and path.is_file():
            return path
    return None


def space_logo_url(space_id: str) -> str | None:
    path = space_logo_path(space_id)
    return f"/api/spaces/{space_id}/logo{_version(path)}" if path else None


def _story_config(space_id: str, story: dict[str, Any], content: Path) -> dict[str, Any]:
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
        "session": f"/api/spaces/{space_id}/stories/{story_id}",
        "image": f"/api/spaces/{space_id}/stories/{story_id}/image{_version(content / image)}" if image and (content / image).is_file() else None,
        # A few findings to show as a stack of chart cards; only those whose image is built.
        "stack": [{"label": str(item.get("label") or ""), "image": f"/api/spaces/{space_id}/stories/{story_id}/stack/{index}{_version(content / str(item['image']))}"}
                  for index, item in enumerate(story.get("stack") or [])
                  if isinstance(item, dict) and item.get("image") and (content / str(item["image"])).is_file()],
        # A session holding several findings: its chapters (stories, maps), each with its finding and, optionally, its
        # key figure (a short stat and the message it goes with), listed on its card.
        "chapters": [{"label": str(item.get("label") or ""), "kind": str(item.get("kind") or ""),
                      "headline": str(item.get("headline") or ""), "stat": str(item.get("stat") or ""),
                      "message": str(item.get("message") or "")}
                     for item in story.get("chapters") or [] if isinstance(item, dict)],
    }


def space_frontend_config(space_id: str) -> dict[str, Any]:
    """The profile as sent to the frontend, with each starter's availability on disk."""
    profile = space_profile(space_id) or {}
    content = space_content_dir(space_id)
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
            "workspace": f"/api/spaces/{space_id}/starters/{starter.get('id')}",
            "kicker": starter.get("kicker", ""),
            "source_url": starter.get("source_url", ""),
            "source_name": starter.get("source_name", ""),
            "icon": starter.get("icon", ""),
            "start_note": starter.get("start_note", ""),
            "stories": [_story_config(space_id, story, content) for story in starter.get("stories") or []],
        })
    return {
        "id": space_id,
        "name": profile.get("name", ""),
        "headline": profile.get("headline", ""),
        "badge": profile.get("badge", ""),
        "tagline": profile.get("tagline", ""),
        "suggestions": [str(item) for item in profile.get("suggestions") or []],
        "chat_placeholder": profile.get("chat_placeholder", ""),
        "intro": profile.get("intro", ""),
        "about": [str(item) for item in profile.get("about") or []],
        "release": profile.get("release", ""),
        "hero_image": f"/api/spaces/{space_id}/hero{_version(content / hero)}" if (hero := str(profile.get("hero_image") or "")) and (content / hero).is_file() else None,
        "logo": space_logo_url(space_id),
        # The space's own chart theme (a Flint ThemeSpec): new charts and maps on the space use it.
        **({"chart_theme": profile["chart_theme"]} if isinstance(profile.get("chart_theme"), dict) else {}),
        "attribution": profile.get("attribution", ""),
        "disclaimer": profile.get("disclaimer", ""),
        "install_note": profile.get("install_note", ""),
        "links": list(profile.get("links") or []),
        "workspace_collapsed": bool(profile.get("workspace_collapsed")),
        "starters": starters,
    }
