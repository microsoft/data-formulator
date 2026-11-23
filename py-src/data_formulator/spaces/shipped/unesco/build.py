# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Install the UIS space (``unesco``) into the spaces folder; see ../README.md.

Downloads the UIS Bulk Data Download Service zips and background PDFs (each dataset from its
latest release, see RELEASES), turns them into one Data Formulator session per dataset (starter)
in profile.yaml, then one session per example analysis (story): its dataset plus the story's
seed from stories/<id>/ (a question, its answer, tables, and map or app; see make_stories.py).
It installs those sessions with profile.yaml and the front-page images (assets/) into
``<spaces dir>/unesco/`` (default ``DF_SPACES_DIR``, ``~/.data_formulator/site-content``). No AI
models are involved.

Data Formulator runs ``install()`` when a local user installs the space from its page; from a
checkout, run this file:

    uv run python py-src/data_formulator/spaces/shipped/unesco/build.py                  # everything
    uv run python py-src/data_formulator/spaces/shipped/unesco/build.py --only culture   # rebuild one dataset
    uv run python py-src/data_formulator/spaces/shipped/unesco/build.py --spaces-dir /srv/df-spaces
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

import duckdb
import pyarrow as pa
import yaml

from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.spaces import spaces_dir
from data_formulator.spaces.builder import (InstallError, build_stories, dataset_state, finish, folder_source,
                                           save_session)

HERE = Path(__file__).resolve().parent
SPACE_ID = "unesco"
PROFILE = HERE / "profile.yaml"
# Front-page images, laid out as the profile names them (relative to the release folder).
ASSETS = HERE / "assets"
# Story seeds: stories/<story id>/state.json, the parquet files of its tables and files/ (its map or app).
STORIES = HERE / "stories"
# ISO 3166-1 alpha-3 → numeric, the country ids of the world map Flint draws choropleths on.
ISO_NUMERIC = HERE / "iso3166_numeric.csv"
BASE_URL = "https://download.uis.unesco.org/bdds/"

# Bulk dataset code -> (table prefix, display name, display name of its `<prefix>_indicators` table).
# The indicators table lists every indicator, so its name says it is the whole catalog, not a query result.
DATASETS = {
    "SDG": ("sdg4", "Education: Sustainable Development Goal 4 (SDG 4) global and thematic indicators",
            "All SDG 4 education indicators (catalog)"),
    "OPRI": ("opri", "Education: other policy-relevant indicators (OPRI)", "All OPRI education indicators (catalog)"),
    "SCN-SDG": ("rd_sdg", "Science: Sustainable Development Goal 9.5 (SDG 9.5) research and development",
                "All SDG 9.5 R&D indicators (catalog)"),
    "SCN-OPRI": ("rd_opri", "Science: other policy-relevant R&D indicators", "All other R&D indicators (catalog)"),
    "SDG11": ("sdg11", "Culture: Sustainable Development Goal 11.4 (SDG 11.4) expenditure on cultural and natural "
              "heritage", "All SDG 11.4 heritage indicators (catalog)"),
    "DEM": ("dem", "Demographic and socio-economic indicators", "All demographic indicators (catalog)"),
}
# Table name -> the name the app shows for it (tables not listed show their name).
DISPLAY_NAMES = {f"{prefix}_indicators": catalog for prefix, _, catalog in DATASETS.values()}

# Bulk dataset code -> the UIS release folder it is downloaded from (<BASE_URL><release>/<code>.zip). UIS updates
# datasets on their own schedules: one not in a newer release keeps its last one.
RELEASES = {"SDG": "202611", "OPRI": "202611", "DEM": "202611",
            "SCN-SDG": "202602", "SCN-OPRI": "202602", "SDG11": "202602"}

# Background notes: local name -> (release folder, download name)
DOCS = {
    "education-background.pdf": ("202611", "UIS-Data-Release-Background-Doc-EN-Nov-2026.pdf"),
    "science-background.pdf": ("202602", "UIS-RD-Database-Background-Information SDG 9.5-EN-Feb-2026.pdf"),
    "culture-background.pdf": ("202602", "UIS-CLT-Database-Background-Information SDG 11.4.1-EN-Feb-2026.pdf"),
}
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")

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


def raw_path(raw: Path, name: str) -> Path:
    """Where a download is cached: ``<raw>/<release>/<name>``, so a new release never reuses an older file."""
    release = DOCS[name][0] if name in DOCS else RELEASES[name.removesuffix(".zip")]
    return raw / release / name


def release_name(release: str) -> str:
    """A release folder as people say it: ``202611`` -> ``November 2026``."""
    return f"{MONTHS[int(release[4:]) - 1]} {release[:4]}"


def starter_release(starter_id: str) -> str:
    """The release a dataset's values come from (its own bulk datasets, not the shared demographic one)."""
    codes, _ = STARTERS[starter_id]
    return release_name(max(RELEASES[code] for code in codes))


def download(raw: Path) -> None:
    targets = {f"{code}.zip": (release, f"{code}.zip") for code, release in RELEASES.items()} | DOCS
    for local, (release, remote) in targets.items():
        path = raw_path(raw, local)
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        url = f"{BASE_URL}{release}/{urllib.request.quote(remote)}"
        _log(f"downloading {url}")
        partial = path.with_name(path.name + ".part")
        with urllib.request.urlopen(url) as response, open(partial, "wb") as out:
            shutil.copyfileobj(response, out)
        partial.replace(path)


def extract(raw: Path, work: Path, code: str) -> Path:
    target = work / code
    if not target.exists():
        with zipfile.ZipFile(raw_path(raw, f"{code}.zip")) as archive:
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
    prefix, title, _ = DATASETS[code]
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
    description = (f"{title}: the full indicator catalog, one row per indicator with its label and national coverage "
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
    description = ("UIS countries and territories: country_id (ISO 3166-1 alpha-3), the key for a world map, "
                   "English name, and map_id (ISO 3166-1 numeric), kept for older Choropleth charts.")
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
        "For a world map, use the map skill (`write_map`) with a choropleth keyed by `country_id` (ISO 3166-1 "
        "alpha-3, `keyType: iso3`); keep the country name in the table for the tooltip.",
        "Labels ending \"(modelled data)\" (indicator_id with `MOD`) are UIS modelled estimates, often beside an "
        "observed series: say which one you used, and call modelled values \"modelled estimates\" in the chart or "
        "map subtitle and in the answer.",
        "Cite the year range and \"UIS, {release} release\" with each result, with the indicator_id code(s) "
        "used in that source line (for example \"Source: UIS, {release} release; indicator CR.MOD.3\"). Keep "
        "titles and axis labels in plain words, and table and column names to your code.".format(
            release=starter_release(starter["id"])),
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
        path = raw_path(raw, doc)
        if path.is_file():
            name = f"docs/{doc.removesuffix('.pdf')}.md"
            title = (doc.removesuffix(".pdf").replace("-", " ").capitalize()
                     + f" (UIS, {release_name(DOCS[doc][0])})")
            workspace.save_workspace_file(pdf_markdown(path, title).encode("utf-8"), name, "text/markdown")
            files.append(name)
        else:
            _log(f"  skipping missing {doc}")
    guide = data_guide(starter, profile, tables, files)
    workspace.save_workspace_file(guide.encode("utf-8"), "UIS data guide.md", "text/markdown")

    # Its tables are the space's data folder (sources), as if loaded from it, so they refresh from it.
    connector_id, source_table = folder_source(profile, SPACE_ID, starter["id"])
    state = dataset_state(workspace, starter, [name for name, _, _ in tables], connector_id=connector_id,
                          source_table=source_table, loader_type="LocalFolderDataLoader", display_names=DISPLAY_NAMES)
    target = save_session(workspace, state, out / starter["file"])
    for name, rows, _ in tables:
        _log(f"  {name}: {rows:,} rows")
    return target


DEFAULT_RAW = Path.home() / ".cache" / "data-formulator" / "uis-raw"
_log: Callable[[str], None] = print


def install(root: Path | None = None, raw: Path | None = None, *, only: list[str] | None = None,
            rebuild: bool = False, download_missing: bool = True, log: Callable[[str], None] = print) -> Path:
    """Build and install the space into ``<spaces>/unesco/``; returns that folder.

    Dataset sessions already built are kept unless ``rebuild`` or ``only`` asks for them; story
    sessions are always assembled again. ``log`` receives one line per step.
    """
    global _log
    _log = log
    try:
        profile = yaml.safe_load(PROFILE.read_text(encoding="utf-8"))
        space = (root or spaces_dir()).expanduser() / SPACE_ID
        content = space / str(profile["release"])
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

        with tempfile.TemporaryDirectory(prefix="uis-stories-") as tmp:
            build_stories(HERE, profile, starters, Path(tmp), content, log)
        return finish(HERE, profile, space, log=log)
    finally:
        _log = print


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--spaces-dir", type=Path, help="where to install (default: DF_SPACES_DIR)")
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW,
                        help="cache for the UIS downloads (default: ~/.cache/data-formulator/uis-raw)")
    parser.add_argument("--no-download", action="store_true", help="use only UIS files already in --raw")
    parser.add_argument("--only", nargs="*", help="build only these datasets (starter ids)")
    parser.add_argument("--rebuild", action="store_true", help="rebuild dataset sessions that already exist")
    args = parser.parse_args()
    try:
        install(args.spaces_dir, args.raw, only=args.only, rebuild=args.rebuild, download_missing=not args.no_download)
    except InstallError as exc:
        sys.exit(f"unesco: {exc}")


if __name__ == "__main__":
    main()
