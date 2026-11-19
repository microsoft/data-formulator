# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Install the NeurIPS demo (``neurips``) into the sites folder; see README.md.

Turns the assembled NeurIPS dataset (``<data>``, made by crawl.py, enrich.py and assemble.py;
default ``~/.cache/data-formulator/neurips/dataset``) into one Data Formulator session per dataset
(starter) in profile.yaml, then one session per example analysis (story): its dataset plus the
story's seed from stories/<id>/ (see make_stories.py). It installs those sessions with profile.yaml,
the analyst's demo guidance (skill/) and the front-page images (assets/) into
``<sites dir>/neurips/`` (default ``DF_SITES_DIR``). No AI models are involved.

    uv run python py-src/data_formulator/demos/neurips/build.py
    uv run python py-src/data_formulator/demos/neurips/build.py --only neurips-2026
    uv run python py-src/data_formulator/demos/neurips/build.py --sites-dir /srv/df-sites
"""

from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.security.code_signing import sign_code
from data_formulator.session_format import SESSION_STATE_VERSION
from data_formulator.sites import referenced_files, sites_dir

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile.yaml"
ASSETS = HERE / "assets"
STORIES = HERE / "stories"
FILE_TYPES = {".map.json": "application/json", ".app.jsx": "text/jsx"}
DEFAULT_DATA = Path.home() / ".cache" / "data-formulator" / "neurips" / "dataset"
SITE_ID = "neurips"
# The time zone of each city NeurIPS 2026 meets in, for its sessions' local times.
TIME_ZONES = {"Sydney": "Australia/Sydney", "Atlanta": "America/New_York", "Paris": "Europe/Paris",
              "San Diego": "America/Los_Angeles", "Mexico City": "America/Mexico_City"}

COUNTRY_RULE = ("an institution's country: `ror_country_code` where ROR matched the string, else "
                "`openalex_country_code`, else the first organization's `country_code` in `institution_orgs`")

TABLES = {
    "papers_2026": (
        "NeurIPS 2026's accepted papers, one row per paper (orals and spotlights are also posters): title, "
        "abstract, track, presentation (Oral, Spotlight or Poster), the topic its authors chose (topic, as "
        "'Area->Subarea'; topic_area), an LLM's topic from the same list (topic_llm), and where and when its "
        "poster is shown: city (Sydney, Atlanta or Paris), session, start_local/end_local (the city's local "
        "time), day and poster_position. Join authorships_2026 on paper_id for authors and institutions."),
    "authorships_2026": (
        "NeurIPS 2026's authors, one row per paper and author (position 1 is the first author): name and "
        "institution as the author gave them on neurips.cc. Institution strings are not merged: the same "
        "place appears written many ways. Join institutions and institution_orgs on institution for what "
        "they are and their country."),
    "papers": (
        "Every NeurIPS paper 1987–2026, one row per paper: year, title, abstract, track, presentation "
        "(Oral, Spotlight or Poster, 2020 on), topic (chosen by authors, 2023 on), topic_llm (an LLM's topic "
        "from NeurIPS 2025–2026's list, for every year, so topics compare over time), n_authors and cited_by "
        "(OpenAlex citations, where matched). 2026 schedules are in papers_2026."),
    "authorships": (
        "Authors of every NeurIPS paper 1987–2026, one row per paper and author: name and institution as "
        "the source gave them (source: neurips.cc 2020 on, OpenAlex before, or papers.nips.cc with no "
        "institution where OpenAlex has no record). Join institutions and institution_orgs on institution."),
    "institutions": (
        "Every institution string authors gave, verbatim, with how often it is used (authorships, papers, "
        "first_year, last_year) and what it refers to, each from its own source: ror_* (the Research "
        "Organization Registry's match, only where it was confident: name, country, city, lat/lng, types) "
        "and openalex_* (OpenAlex's institution for the string). For " + COUNTRY_RULE + "."),
    "institution_orgs": (
        "An LLM's reading of each institution string: the organizations it names (org_index in the order "
        "written), each with parent (the larger organization it belongs to, e.g. Microsoft for Microsoft "
        "Research Asia), country_code (ISO 3166-1 alpha-2) and kind (university, company, research "
        "institute, ...). Use it to group spellings of one organization and to split joint affiliations."),
    "countries": (
        "Countries: country_code (ISO 3166-1 alpha-2, as institutions give it, and a world map's key with "
        "keyType iso2), country_id (alpha-3), a short English name, its UN SDG region and map_id (ISO 3166-1 "
        "numeric, the id of @df/geo's country shapes in apps)."),
    "conferences": ("Where NeurIPS met each year: city, country_code and lat/lng (2020 and 2021 were online); main is "
                    "the year's main city where it met in more than one (2025: San Diego and Mexico City; 2026: Sydney, "
                    "Atlanta and Paris)."),
}

STARTERS = {
    "neurips-2026": ["papers_2026", "authorships_2026", "institutions", "institution_orgs", "countries"],
    "neurips-history": ["papers", "authorships", "institutions", "institution_orgs", "countries", "conferences"],
    "microsoft": ["papers", "authorships", "papers_2026", "authorships_2026", "institutions", "institution_orgs",
                  "countries", "conferences"],
}


def local_times(frame: pd.DataFrame) -> pd.DataFrame:
    """Session times in the city's own time zone (neurips.cc gives them with a US Pacific offset)."""
    def convert(value, city):
        if not isinstance(value, str) or city not in TIME_ZONES:
            return None
        return pd.Timestamp(value).tz_convert(ZoneInfo(TIME_ZONES[city])).tz_localize(None)
    frame["start_local"] = [convert(v, c) for v, c in zip(frame.start_time, frame.city)]
    frame["end_local"] = [convert(v, c) for v, c in zip(frame.end_time, frame.city)]
    frame["day"] = pd.to_datetime(frame.start_local).dt.date
    return frame


def table_frame(name: str, data: Path) -> pd.DataFrame:
    con = duckdb.connect()
    parquet = lambda table: f"read_parquet('{(data / f'{table}.parquet').as_posix()}')"
    if name == "papers_2026":
        frame = con.sql(f"""
            select paper_id, title, abstract, track, presentation, topic,
                   nullif(split_part(topic, '->', 1), '') as topic_area, topic_llm, city, session,
                   start_time, end_time, poster_position, room, n_authors, url, openreview_url
            from {parquet('papers')} where year = 2026 order by paper_id""").df()
        frame = local_times(frame)
        return frame[["paper_id", "title", "abstract", "track", "presentation", "topic", "topic_area", "topic_llm",
                      "city", "session", "day", "start_local", "end_local", "poster_position", "room", "n_authors",
                      "url", "openreview_url"]]
    if name == "authorships_2026":
        return con.sql(f"select paper_id, position, author, institution from {parquet('authorships')} "
                       f"where year = 2026 order by paper_id, position").df()
    if name == "papers":
        return con.sql(f"""
            select paper_id, year, title, abstract, track, presentation, topic, topic_llm, n_authors, cited_by,
                   openalex_id, url, source
            from {parquet('papers')} order by year, paper_id""").df()
    if name == "authorships":
        return con.sql(f"select paper_id, year, position, author, institution, source from {parquet('authorships')} "
                       f"order by year, paper_id, position").df()
    return con.sql(f"select * from {parquet(name)}").df()


def write_table(workspace, name: str, frame: pd.DataFrame) -> int:
    meta = workspace.write_parquet_from_arrow(pa.Table.from_pandas(frame, preserve_index=False), name)
    meta.description = TABLES[name]
    workspace.add_table_metadata(meta)
    return len(frame)


def data_guide(starter: dict, profile: dict, tables: list[tuple[str, int]]) -> str:
    steps = [
        "Count papers with distinct paper_id. A paper has many authors: to say how many papers involve a "
        "country or organization, count distinct papers with at least one such author; to share credit, "
        "give each paper's authors 1/n_authors each. Say which one you used.",
        "Institutions are as authors wrote them (\"Microsoft\", \"Microsoft Research\", \"MSR Asia\" are "
        "different strings). To find an organization, use institution_orgs (organization or parent, an "
        "LLM's reading) or the ror_name / openalex_institution columns of institutions, and check the "
        "strings you matched; never match a short name like 'MSR' or 'Meta' without checking.",
        f"For {COUNTRY_RULE}. Say \"where authors work\": the data has affiliations, not nationality.",
        "Affiliations cover about 98% of authorships from 2020 on, but only those papers OpenAlex knows "
        "before (most years 70–85%, 2006 almost none): for earlier years compare shares, not counts, and "
        "say so.",
        "topic is the authors' own choice (2023 on). topic_llm is an LLM's choice from the same 2025–2026 "
        "list for every year: it agrees with authors on the area 70% of the time (the areas overlap), so "
        "use it for broad trends and say it is an AI estimate.",
        "For a world map, use the map skill (`write_map`) with a choropleth keyed by country_code "
        "(keyType iso2), or bubbles at an institution's ror_lat/ror_lng.",
        "Cite the source with each result, e.g. \"Source: neurips.cc; OpenAlex\".",
    ]
    lines = [
        f"# Data guide: {starter['title']}", "", f"Source: {profile['attribution'].strip()}", "", "## Tables", "",
        *[f"- `{name}` ({rows:,} rows): {TABLES[name]}" for name, rows in tables], "",
        "## How to answer questions", "", *[f"{n}. {step}" for n, step in enumerate(steps, 1)], "",
    ]
    return "\n".join(lines)


def session_state(workspace, starter: dict, order: list[str]) -> dict:
    now = int(time.time() * 1000)
    metadata = workspace.get_metadata()
    input_tables = []
    for name in order:
        table = metadata.tables[name]
        input_tables.append({
            "kind": "input-table", "id": name, "displayId": name,
            "source": {"kind": "workspace", "tableId": name},
            "snapshot": {"columns": [{"name": c.name, "type": "number" if c.dtype in ("integer", "number") else "string"}
                                     for c in table.columns], "rowCount": table.row_count, "capturedAt": now},
            "description": table.description or "", "sourceConfig": {"type": "example", "canRefresh": False},
            "addedAt": now,
        })
    return {"__stateVersion": SESSION_STATE_VERSION, "inputTables": input_tables,
            "workspaceItemOrder": [f"shelf-card-{name}" for name in order],
            "activeWorkspace": {"id": starter["id"], "displayName": starter["title"]}}


def build_starter(starter: dict, profile: dict, data: Path, work: Path, out: Path) -> Path:
    workspace = WorkspaceManager(work / "sessions").create_and_open_workspace(starter["id"], "local:site-builder")
    names = [name for name in STARTERS[starter["id"]]
             if name in ("papers_2026", "authorships_2026") or (data / f"{name}.parquet").is_file()]
    for name in set(STARTERS[starter["id"]]) - set(names):
        _log(f"  skipping {name}: not in {data}")
    tables = [(name, write_table(workspace, name, table_frame(name, data))) for name in names]
    workspace.save_workspace_file(data_guide(starter, profile, tables).encode("utf-8"), "NeurIPS data guide.md",
                                  "text/markdown")
    archive = workspace.export_session_zip(session_state(workspace, starter, [name for name, _ in tables]))
    out.mkdir(parents=True, exist_ok=True)
    target = out / starter["file"]
    target.write_bytes(archive.getvalue())
    for name, rows in tables:
        _log(f"  {name}: {rows:,} rows")
    return target


def signed_here(table: dict) -> dict:
    """A seed's derived table with its code signed by this installation, so the app can refresh it."""
    derive = table.get("derive")
    if not isinstance(derive, dict) or not derive.get("code"):
        return table
    return {**table, "derive": {**derive, "codeSignature": sign_code(derive["code"])}}


def build_story(story: dict, starter: dict, work: Path, content: Path, theme_id: str | None = None) -> Path:
    """A story's session: its dataset's session with the story's seed (question, answer, tables, map or app)."""
    seed = STORIES / story["id"]
    state = json.loads((seed / "state.json").read_text(encoding="utf-8"))
    workspace = WorkspaceManager(work / "stories").create_and_open_workspace(story["id"], "local:site-builder")
    dataset = workspace.import_session_zip(io.BytesIO((content / starter["file"]).read_bytes()))
    for path in sorted(seed.glob("*.parquet")):
        workspace.write_parquet_from_arrow(pq.read_table(path), path.stem)
    titles = {node["path"]: node.get("displayName") for node in state.get("fileNodes") or []}
    for path in sorted((seed / "files").glob("*")):
        workspace.save_workspace_file(path.read_bytes(), path.name, FILE_TYPES.get("".join(path.suffixes[-2:])),
                                      display_name=titles.get(path.name), agent_managed=True)
    state = {**state, "derivedTables": [signed_here(table) for table in state.get("derivedTables") or []],
             "inputTables": dataset["inputTables"], "workspaceItemOrder": dataset["workspaceItemOrder"]}
    if theme_id:
        state["charts"] = [{**chart, "themeId": theme_id} if isinstance(chart, dict) else chart
                           for chart in state.get("charts") or []]
    target = content / story["file"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(workspace.export_session_zip(state).getvalue())
    return target


def install_static(profile: dict, site: Path) -> None:
    """Copy the profile, the analyst's demo guidance and front-page images into the installed site."""
    content = site / str(profile["release"])
    for path in sorted(ASSETS.rglob("*")) if ASSETS.is_dir() else []:
        if path.is_file():
            target = content / path.relative_to(ASSETS)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    site.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PROFILE, site / "profile.yaml")
    (site / "skill").mkdir(exist_ok=True)
    shutil.copyfile(HERE / "skill" / "SKILL.md", site / "skill" / "SKILL.md")


_log: Callable[[str], None] = print


class InstallError(Exception):
    """The demo could not be installed (e.g. the dataset is missing)."""


def install(sites: Path | None = None, data: Path | None = None, *, only: list[str] | None = None,
            rebuild: bool = False, log: Callable[[str], None] = print) -> Path:
    """Build and install the demo into ``<sites>/neurips/``; returns that folder.

    Dataset sessions already built are kept unless ``rebuild`` or ``only`` asks for them; story
    sessions are always assembled again.
    """
    global _log
    _log = log
    try:
        profile = yaml.safe_load(PROFILE.read_text(encoding="utf-8"))
        site = (sites or sites_dir()).expanduser() / SITE_ID
        content = site / str(profile["release"])
        data = data or DEFAULT_DATA
        if not (data / "papers.parquet").is_file():
            raise InstallError(f"no NeurIPS dataset in {data}: collect it with crawl.py, enrich.py and assemble.py "
                               f"(see demos/neurips/README.md)")
        unknown = set(only or []) - {starter["id"] for starter in profile["starters"]}
        if unknown:
            raise InstallError(f"unknown datasets: {', '.join(sorted(unknown))}")
        starters = [starter for starter in profile["starters"] if not only or starter["id"] in only]
        todo = [starter for starter in starters if rebuild or only or not (content / starter["file"]).is_file()]
        with tempfile.TemporaryDirectory(prefix="neurips-build-") as tmp:
            for starter in todo:
                log(f"building {starter['id']}")
                target = build_starter(starter, profile, data, Path(tmp), content)
                log(f"  -> {target.name} ({target.stat().st_size / 2**20:.1f} MB)")
        for starter in starters:
            if starter not in todo:
                log(f"{starter['id']}: already built")
        with tempfile.TemporaryDirectory(prefix="neurips-stories-") as tmp:
            for starter in starters:
                if not (content / starter["file"]).is_file():
                    continue
                for story in starter.get("stories") or []:
                    if story.get("file") and (STORIES / story["id"] / "state.json").is_file():
                        target = build_story(story, starter, Path(tmp), content,
                                             (profile.get("chart_theme") or {}).get("id"))
                        log(f"  story {story['id']} -> {target.name} ({target.stat().st_size / 2**20:.1f} MB)")
        install_static(profile, site)
        missing = [name for name in referenced_files(profile) if not (content / name).is_file()]
        if missing:
            raise InstallError(f"missing from {content}: {', '.join(missing)}")
        log(f"{SITE_ID}: installed in {site}")
        return site
    finally:
        _log = print


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sites-dir", type=Path, help="where to install (default: DF_SITES_DIR)")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA,
                        help="the assembled dataset (default: ~/.cache/data-formulator/neurips/dataset)")
    parser.add_argument("--only", nargs="*", help="build only these datasets (starter ids)")
    parser.add_argument("--rebuild", action="store_true", help="rebuild dataset sessions that already exist")
    args = parser.parse_args()
    try:
        install(args.sites_dir, args.data, only=args.only, rebuild=args.rebuild)
    except InstallError as exc:
        sys.exit(f"{SITE_ID}: {exc}")


if __name__ == "__main__":
    main()
