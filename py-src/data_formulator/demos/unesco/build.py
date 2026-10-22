# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Install the UIS demo (``unesco``) into the sites folder; see ../README.md.

Downloads the UIS Bulk Data Download Service zips and background PDFs, turns them into
one Data Formulator session per dataset (starter) in profile.yaml, then one session per
example analysis (story): its dataset plus the story's seed from stories/<id>/ (a question,
its answer and charts; see make_seeds.py). It installs those sessions with profile.yaml and
the front-page images (assets/) into ``<sites dir>/unesco/`` (default ``DF_SITES_DIR``,
``~/.data_formulator/site-content``). No AI models are involved.

Data Formulator runs ``install()`` when a local user installs the demo from its page; from a
checkout, run this file:

    uv run python py-src/data_formulator/demos/unesco/build.py                  # everything
    uv run python py-src/data_formulator/demos/unesco/build.py --only culture   # rebuild one dataset
    uv run python py-src/data_formulator/demos/unesco/build.py --sites-dir /srv/df-sites
"""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.session_format import SESSION_STATE_VERSION
from data_formulator.sites import referenced_files, sites_dir

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile.yaml"
# Front-page images, laid out as the profile names them (relative to the release folder).
ASSETS = HERE / "assets"
# Story seeds: stories/<story id>/state.json and the parquet files of its tables.
STORIES = HERE / "stories"
# ISO 3166-1 alpha-3 → numeric, the country ids of the world map Flint draws choropleths on.
ISO_NUMERIC = HERE / "iso3166_numeric.csv"
BASE_URL = "https://download.uis.unesco.org/bdds/202602/"

# Bulk dataset code -> (table prefix, display name)
DATASETS = {
    "SDG": ("sdg4", "Education: SDG 4 global and thematic indicators"),
    "OPRI": ("opri", "Education: other policy-relevant indicators (OPRI)"),
    "SCN-SDG": ("rd_sdg", "Science: SDG 9.5 research and development"),
    "SCN-OPRI": ("rd_opri", "Science: other policy-relevant R&D indicators"),
    "SDG11": ("sdg11", "Culture: SDG 11.4 expenditure on cultural and natural heritage"),
    "DEM": ("dem", "Demographic and socio-economic indicators"),
}

# Background notes: local name -> download name
DOCS = {
    "education-background.pdf": "UIS - Data Release Background Doc -EN-Feb 2026.pdf",
    "science-background.pdf": "UIS-RD-Database-Background-Information SDG 9.5-EN-Feb-2026.pdf",
    "culture-background.pdf": "UIS-CLT-Database-Background-Information SDG 11.4.1-EN-Feb-2026.pdf",
}

# Starter id -> bulk datasets and background notes it carries (DEM is added to every starter)
STARTERS = {
    "education-sdg4": (["SDG"], ["education-background.pdf"]),
    "education-opri": (["OPRI"], ["education-background.pdf"]),
    "science": (["SCN-SDG", "SCN-OPRI"], ["science-background.pdf"]),
    "culture": (["SDG11"], ["culture-background.pdf"]),
}

FLAGS = """\
Every value row carries two UIS flags (empty when not applicable):

- `magnitude` describes the nature of the value:
  - `NIL`: the value is 0 and means nil.
  - `NA`: the value is 0 but the data point is not applicable to that country; exclude it from averages.
  - `SUPP`: suppressed at the country's request; the value is empty.
  - `LOWREL`: numeric but of low reliability; flag it when you use it.
  - `INCLUDED`: empty; the data is included in another data point.
  - `INCLUDES`: numeric and includes data from another data point.
- `qualifier` describes who produced the value:
  - `NAT_EST`: national estimate.
  - `UIS_EST`: estimate produced by the UNESCO Institute for Statistics.
"""


def download(raw: Path) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    targets = {f"{code}.zip": f"{code}.zip" for code in DATASETS} | DOCS
    for local, remote in targets.items():
        path = raw / local
        if path.exists():
            continue
        url = BASE_URL + urllib.request.quote(remote)
        _log(f"downloading {url}")
        with urllib.request.urlopen(url) as response, open(path, "wb") as out:
            shutil.copyfileobj(response, out)


def extract(raw: Path, work: Path, code: str) -> Path:
    target = work / code
    if not target.exists():
        with zipfile.ZipFile(raw / f"{code}.zip") as archive:
            archive.extractall(target)
    return target


def csv(folder: Path, code: str, part: str) -> Path | None:
    path = folder / f"{code}_{part}.csv"
    return path if path.is_file() else None


def readme(folder: Path) -> Path | None:
    return next(iter(sorted(folder.glob("*README*.md"))), None)


def read_csv(path: Path) -> str:
    return f"read_csv('{path.as_posix()}', header=true, all_varchar=true)"


def write_table(con, workspace, name: str, sql: str, description: str) -> int:
    table: pa.Table = con.sql(sql).arrow()
    if hasattr(table, "read_all"):
        table = table.read_all()
    meta = workspace.write_parquet_from_arrow(table, name)
    meta.description = description
    workspace.add_table_metadata(meta)
    return table.num_rows


def dataset_tables(con, workspace, folder: Path, code: str) -> list[tuple[str, int, str]]:
    prefix, title = DATASETS[code]
    country = csv(folder, code, "COUNTRY")
    label = csv(folder, code, "LABEL")
    national = csv(folder, code, "DATA_NATIONAL")
    regional = csv(folder, code, "DATA_REGIONAL")
    metadata = csv(folder, code, "METADATA")
    written = []

    con.execute(f"create or replace temp view labels as select trim(indicator_id) as indicator_id, "
                f"trim(indicator_label_en) as indicator from {read_csv(label)}")
    con.execute(f"create or replace temp view national as select trim(indicator_id) as indicator_id, country_id, "
                f"try_cast(year as integer) as year, try_cast(value as double) as value, "
                f"nullif(trim(magnitude), '') as magnitude, nullif(trim(qualifier), '') as qualifier "
                f"from {read_csv(national)}")

    name = f"{prefix}_indicators"
    description = (f"{title}: one row per indicator with its label and national coverage "
                   f"(countries with data, first and last year, number of values). Search `indicator` "
                   f"to find indicator_id values for {prefix}_national"
                   + (f" and {prefix}_regional." if regional else "."))
    rows = write_table(con, workspace, name, """
        select l.indicator_id, l.indicator,
               count(distinct n.country_id) as countries, min(n.year) as first_year,
               max(n.year) as last_year, count(n.value) as value_count
        from labels l left join national n using (indicator_id)
        group by all order by l.indicator_id""", description)
    written.append((name, rows, description))

    name = f"{prefix}_national"
    description = (f"{title}: national values, one row per indicator_id, country and year. Join "
                   f"{prefix}_indicators on indicator_id for the label. magnitude and qualifier are UIS "
                   f"data flags (see the data guide).")
    rows = write_table(con, workspace, name, f"""
        select n.indicator_id, n.country_id, c.country_name_en as country, n.year, n.value,
               n.magnitude, n.qualifier
        from national n left join {read_csv(country)} c using (country_id)
        order by n.indicator_id, n.country_id, n.year""", description)
    written.append((name, rows, description))

    if regional:
        name = f"{prefix}_regional"
        description = (f"{title}: UIS regional and global aggregates, one row per indicator_id, region "
                       f"and year. region_group is the regional classification (SDG, WB income groups, "
                       f"UIS, ...). Prefer these official aggregates over averaging national values.")
        rows = write_table(con, workspace, name, f"""
            select trim(indicator_id) as indicator_id,
                   trim(split_part(region_id, ':', 1)) as region_group, region_id as region,
                   try_cast(year as integer) as year, try_cast(value as double) as value,
                   nullif(trim(magnitude), '') as magnitude, nullif(trim(qualifier), '') as qualifier
            from {read_csv(regional)} order by 1, 3, 4""", description)
        written.append((name, rows, description))

    if metadata:
        name = f"{prefix}_sources"
        description = (f"{title}: source notes per data point (indicator_id, country_id, year). A data "
                       f"point can have several rows; type tells what the note is (for example data "
                       f"source or data status).")
        rows = write_table(con, workspace, name, f"""
            select trim(indicator_id) as indicator_id, country_id, try_cast(year as integer) as year,
                   type, metadata as note
            from {read_csv(metadata)} order by 1, 2, 3""", description)
        written.append((name, rows, description))
    return written


def shared_tables(con, workspace, folders: dict[str, Path]) -> list[tuple[str, int, str]]:
    written = []
    countries = next(path for code, folder in folders.items() if (path := csv(folder, code, "COUNTRY")))
    description = ("UIS countries and territories: country_id (ISO 3166-1 alpha-3), English name, and map_id "
                   "(ISO 3166-1 numeric), the id to use for a country in a world map (Choropleth).")
    rows = write_table(con, workspace, "countries", f"""
        select c.country_id, c.country_name_en as country, m.map_id
        from {read_csv(countries)} c left join read_csv_auto('{ISO_NUMERIC.as_posix()}') m using (country_id)
        order by 2""", description)
    written.append(("countries", rows, description))

    regions = next((path for code, folder in folders.items() if (path := csv(folder, code, "REGION"))), None)
    if regions:
        description = ("Membership of countries in regional groupings: region (as in the *_regional "
                       "tables), its region_group (SDG, WB, UNICEF, ...), country_id and country.")
        rows = write_table(con, workspace, "region_members", f"""
            select trim(split_part(region_id, ':', 1)) as region_group, region_id as region,
                   country_id, country_name_en as country
            from {read_csv(regions)} order by 1, 2, 4""", description)
        written.append(("region_members", rows, description))
    return written


def pdf_markdown(path: Path, title: str) -> str:
    from pypdf import PdfReader

    pages = []
    for number, page in enumerate(PdfReader(str(path)).pages, start=1):
        text = re.sub(r"[ \t]+\n", "\n", page.extract_text() or "")
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if text:
            pages.append(f"## Page {number}\n\n{text}")
    return f"# {title}\n\nText extracted from the UIS PDF; page numbers follow the original.\n\n" + "\n\n".join(pages)


def data_guide(starter: dict, profile: dict, tables: list[tuple[str, int, str]], files: list[str]) -> str:
    regional = any(name.endswith("_regional") for name, _, _ in tables)
    steps = [
        "Find the indicator first: search the `*_indicators` table's `indicator` label (case-insensitive, "
        "several words) and check `countries`, `first_year`, `last_year` and `value_count` before choosing one. "
        "Labels name the breakdown (both sexes, female, male, GPIA for the adjusted gender parity index, "
        "location, wealth quintile) and the unit.",
        "Filter the large `*_national`" + (" and `*_regional`" if regional else "") + " tables by indicator_id "
        "(and country or year) in SQL before loading anything into Python; some have millions of rows.",
        *(["Use the `*_regional` tables for regional and world figures; they are the official UIS aggregates."]
          if regional else ["There are no official regional aggregates here; say so if you aggregate national "
                            "values, and state which countries are included."]),
        "Coverage is sparse: when comparing countries, say which year each value is from (for example the "
        "latest year available since a cut-off).",
        "For a world map, use a Choropleth with `id` = `countries.map_id` (join on country_id) and `color` = "
        "the value; keep the country name in the table for the tooltip.",
        "Cite the year range and \"UIS, February 2026 release\" with each result; name indicators in plain words "
        "for readers and keep indicator_id codes and table names to your code.",
    ]
    lines = [
        f"# Data guide: {starter['title']}",
        "",
        f"Source: {profile['attribution'].strip()}",
        "",
        "## Tables",
        "",
        *[f"- `{name}` ({rows:,} rows): {description}" for name, rows, description in tables],
        "",
        "## How to answer questions",
        "",
        *[f"{number}. {step}" for number, step in enumerate(steps, start=1)],
        "",
        "## Data flags",
        "",
        FLAGS,
        "## Documents",
        "",
        *[f"- `{name}`" for name in files],
        "",
        "Use the README for the file structure and the background notes for methodology, data sources and "
        "country-specific notes (search them for a country or indicator name).",
        "",
    ]
    return "\n".join(lines)


def session_state(workspace, starter: dict, order: list[str]) -> dict:
    now = int(time.time() * 1000)
    metadata = workspace.get_metadata()
    input_tables = []
    for name in order:
        table = metadata.tables[name]
        input_tables.append({
            "kind": "input-table",
            "id": name,
            "displayId": name,
            "source": {"kind": "workspace", "tableId": name},
            "snapshot": {
                "columns": [{"name": column.name, "type": "number" if column.dtype in ("integer", "number") else "string"}
                            for column in table.columns],
                "rowCount": table.row_count,
                "capturedAt": now,
            },
            "description": table.description or "",
            "sourceConfig": {"type": "example", "canRefresh": False},
            "addedAt": now,
        })
    return {
        "__stateVersion": SESSION_STATE_VERSION,
        "inputTables": input_tables,
        "workspaceItemOrder": [f"shelf-card-{name}" for name in order],
        "activeWorkspace": {"id": starter["id"], "displayName": starter["title"]},
    }


def build_starter(starter: dict, profile: dict, raw: Path, work: Path, out: Path) -> Path:
    codes, docs = STARTERS[starter["id"]]
    codes = [*codes, "DEM"]
    folders = {code: extract(raw, work, code) for code in codes}
    manager = WorkspaceManager(work / "sessions")
    workspace = manager.create_and_open_workspace(starter["id"], "local:site-builder")
    con = duckdb.connect()

    tables = []
    for code in codes:
        tables += dataset_tables(con, workspace, folders[code], code)
    tables += shared_tables(con, workspace, folders)

    files = []
    for code in codes:
        if (path := readme(folders[code])):
            name = f"docs/{code} README.md"
            workspace.save_workspace_file(path.read_bytes(), name, "text/markdown")
            files.append(name)
    for doc in docs:
        if (raw / doc).is_file():
            name = f"docs/{doc.removesuffix('.pdf')}.md"
            title = doc.removesuffix(".pdf").replace("-", " ").capitalize() + " (UIS, February 2026)"
            workspace.save_workspace_file(pdf_markdown(raw / doc, title).encode("utf-8"), name, "text/markdown")
            files.append(name)
        else:
            _log(f"  skipping missing {doc}")
    guide = data_guide(starter, profile, tables, files)
    workspace.save_workspace_file(guide.encode("utf-8"), "UIS data guide.md", "text/markdown")

    order = [name for name, _, _ in tables]
    archive = workspace.export_session_zip(session_state(workspace, starter, order))
    out.mkdir(parents=True, exist_ok=True)
    target = out / starter["file"]
    target.write_bytes(archive.getvalue())
    for name, rows, _ in tables:
        _log(f"  {name}: {rows:,} rows")
    return target


def build_story(story: dict, starter: dict, work: Path, content: Path) -> Path:
    """A story's session: its dataset's session with the story's seed (question, answer, charts) added."""
    seed = STORIES / story["id"]
    state = json.loads((seed / "state.json").read_text(encoding="utf-8"))
    workspace = WorkspaceManager(work / "stories").create_and_open_workspace(story["id"], "local:site-builder")
    dataset = workspace.import_session_zip(io.BytesIO((content / starter["file"]).read_bytes()))
    for path in sorted(seed.glob("*.parquet")):
        workspace.write_parquet_from_arrow(pq.read_table(path), path.stem)
    state = {**state, "inputTables": dataset["inputTables"], "workspaceItemOrder": dataset["workspaceItemOrder"]}
    target = content / story["file"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(workspace.export_session_zip(state).getvalue())
    return target


def install_static(profile: dict, site: Path) -> None:
    """Copy the profile and front-page images into the installed site."""
    content = site / str(profile["release"])
    for path in sorted(ASSETS.rglob("*")):
        if path.is_file():
            target = content / path.relative_to(ASSETS)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    site.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PROFILE, site / "profile.yaml")


def missing_files(profile: dict, content: Path) -> list[str]:
    return [name for name in referenced_files(profile) if not (content / name).is_file()]


DEFAULT_RAW = Path.home() / ".cache" / "data-formulator" / "uis-raw"
_log: Callable[[str], None] = print


class InstallError(Exception):
    """The demo could not be installed (e.g. a download failed or a file is missing)."""


def install(sites: Path | None = None, raw: Path | None = None, *, only: list[str] | None = None,
            rebuild: bool = False, download_missing: bool = True, log: Callable[[str], None] = print) -> Path:
    """Build and install the demo into ``<sites>/unesco/``; returns that folder.

    Dataset sessions already built are kept unless ``rebuild`` or ``only`` asks for them; story
    sessions are always assembled again. ``log`` receives one line per step.
    """
    global _log
    _log = log
    try:
        profile = yaml.safe_load(PROFILE.read_text(encoding="utf-8"))
        site = (sites or sites_dir()).expanduser() / "unesco"
        content = site / str(profile["release"])
        raw = raw or DEFAULT_RAW
        unknown = set(only or []) - {starter["id"] for starter in profile["starters"]}
        if unknown:
            raise InstallError(f"unknown datasets: {', '.join(sorted(unknown))}")
        starters = [starter for starter in profile["starters"] if not only or starter["id"] in only]
        todo = [starter for starter in starters if rebuild or only or not (content / starter["file"]).is_file()]

        if todo and download_missing:
            try:
                download(raw)
            except OSError as exc:
                raise InstallError(f"could not download the UIS data: {exc}") from exc
        with tempfile.TemporaryDirectory(prefix="uis-build-") as tmp:
            for starter in todo:
                log(f"building {starter['id']}")
                target = build_starter(starter, profile, raw, Path(tmp), content)
                log(f"  -> {target.name} ({target.stat().st_size / 2**20:.1f} MB)")
        for starter in starters:
            if starter not in todo:
                log(f"{starter['id']}: already built")

        # Stories are quick to assemble, so they always follow their dataset session.
        with tempfile.TemporaryDirectory(prefix="uis-stories-") as tmp:
            for starter in starters:
                if not (content / starter["file"]).is_file():
                    continue
                for story in starter.get("stories") or []:
                    if story.get("file") and (STORIES / story["id"] / "state.json").is_file():
                        target = build_story(story, starter, Path(tmp), content)
                        log(f"  story {story['id']} -> {target.name} ({target.stat().st_size / 2**20:.1f} MB)")

        install_static(profile, site)
        missing = missing_files(profile, content)
        if missing:
            raise InstallError(f"missing from {content}: {', '.join(missing)}")
        log(f"unesco: installed in {site}")
        return site
    finally:
        _log = print


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sites-dir", type=Path, help="where to install (default: DF_SITES_DIR)")
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW,
                        help="cache for the UIS downloads (default: ~/.cache/data-formulator/uis-raw)")
    parser.add_argument("--no-download", action="store_true", help="use only UIS files already in --raw")
    parser.add_argument("--only", nargs="*", help="build only these datasets (starter ids)")
    parser.add_argument("--rebuild", action="store_true", help="rebuild dataset sessions that already exist")
    args = parser.parse_args()
    try:
        install(args.sites_dir, args.raw, only=args.only, rebuild=args.rebuild, download_missing=not args.no_download)
    except InstallError as exc:
        sys.exit(f"unesco: {exc}")


if __name__ == "__main__":
    main()
