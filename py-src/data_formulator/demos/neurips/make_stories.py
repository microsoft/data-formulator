# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Build the NeurIPS demo's story seeds from the data (maintainer tool).

Each story on the NeurIPS page opens on a seed: one question answered, as the AI analyst would answer
it on the site, with the tables it made and what it drew from them: a map (``write_map``) or a small
dashboard (``write_app``), plus a chart where it helps. This script makes those seeds from the dataset
sessions build.py installs, without AI models: each story below says how its tables are computed
(Python run in the app's sandbox, so the app can refresh them), what it draws (an app's React code is
in apps/), and how its answer, headline and dek read, with every figure taken from the computed rows.

    uv run python py-src/data_formulator/demos/neurips/build.py --sites-dir /tmp/neurips-sites   # the datasets first
    uv run python py-src/data_formulator/demos/neurips/make_stories.py --sites-dir /tmp/neurips-sites
    uv run python py-src/data_formulator/demos/neurips/make_stories.py --sites-dir /tmp/neurips-sites --only neurips-2026-n20

It reads the dataset sessions from ``<sites dir>/neurips/<release>/``, rewrites ``stories/<story id>/``
(state.json, the tables' parquet files and ``files/`` with the map or app) and the story's ``headline``
and ``dek`` in profile.yaml. A story's ``expect`` checks fail when new data changes what its text says;
reword the story then. Redraw the covers afterwards with make_covers.py.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import re
import shutil
import sys
import tempfile
import textwrap
import uuid
from pathlib import Path
from typing import Callable

import duckdb
import pandas as pd
import yaml

from data_formulator.analyst.skills.html_app.skill import lint_react_app, stamp_react_manifest, validate_react_app
from data_formulator.analyst.skills.map.skill import encode_map
from data_formulator.analyst.skills.map.validate import validate_map
from data_formulator.datalake.parquet_utils import df_to_safe_records
from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.sandbox import create_sandbox
from data_formulator.session_format import SESSION_STATE_VERSION
from data_formulator.sites import sites_dir

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile.yaml"
STORIES = HERE / "stories"
# The stories' apps, as React files whose `__SOURCE__` is filled in with the story's source line.
APPS = HERE / "apps"
# build.py is loaded by path, as the app loads it: the demo folder is data, not a package.
_spec = importlib.util.spec_from_file_location("neurips_build", HERE / "build.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)

# Session state a seed holds; the rest of a session (model settings, UI layout, messages) is not seeded.
KEEP = ("__stateVersion", "activeWorkspace", "derivedTables", "charts", "conceptShelfItems", "textTurns",
        "tableSemantics", "fileNodes", "focusedId", "canvasTabs", "canvasTabActive")
EMPTY_CHANNELS = ("color", "opacity", "column", "row")
# What the agent says before making each table: what the step is for, in its own words (never the table's
# title again, which the card right below shows).
STEP_MESSAGES = {
    'city_countries_2026': "First I'll trace where the authors behind each city's papers work, country by country.",
    'poster_sessions_2026': 'Then the poster schedule, to see how the papers split across the three cities and days.',
    'papers_by_country_2026': "I'll credit each paper to the countries its authors work in.",
    'top_countries_2026': 'Narrowing to the 15 leading countries so they compare at a glance.',
    'topics_2026': "Grouping this year's papers by the topics their authors picked, with orals and spotlights.",
    'top_organizations_2026': "Ranking universities and companies by how many papers they're on.",
    'organization_places_2026': 'And placing every organization on a map to show where the work happens.',
    'papers_per_year': 'Starting with how many papers each year accepted, and how big author teams were.',
    'topic_areas_by_year': "Next, each year's mix of topic areas, to see which ideas grew and which faded.",
    'title_words_by_year': 'Tracking a few telling words in paper titles across the decades.',
    'country_shares_by_year': "Following each year's share of papers by where authors work.",
    'country_shares_then_now': 'Comparing a decade ago with 2026 to make the shift concrete.',
    'conference_route': "Listing every host city in order, so the conference's travels can go on a map.",
    'microsoft_papers_2026': "Finding this year's papers with a Microsoft author, and when each is presented.",
    'microsoft_by_year': 'Counting Microsoft papers each year to see how its presence grew.',
    'top_microsoft_partners': 'Ranking the organizations Microsoft writes with most often.',
    'microsoft_partner_places': 'And mapping every co-authoring organization to show the reach of those ties.',
}
# Seeds' thread times: a fixed day (Nov 2026), so seeds only change when their content does.
EPOCH = 1794700000000
SEED_NAMESPACE = "df-demo-neurips/"


class StoryError(Exception):
    """A story could not be made, or the data no longer says what its text says."""


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise StoryError(message)


def _stable(*parts: str) -> str:
    return hashlib.sha1("/".join(parts).encode()).hexdigest()


def fmt(value: float, digits: int = 1) -> str:
    """A number as the answers write it: 4.9, 12, 1,234."""
    text = f"{value:,.{digits}f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def names(items: list[str]) -> str:
    """'A', 'A and B', 'A, B and C'."""
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


# Country names read with "the" in running text.
WITH_THE = {"Netherlands", "Philippines", "UK", "US", "UAE", "Czech Republic"}


def in_sentence(name: str) -> str:
    """'Computer Vision' -> 'computer vision' mid-sentence; acronyms stay ('Data-centric AI' -> 'data-centric AI')."""
    return " ".join(word if word.isupper() else word.lower() for word in name.split(" "))


def the(country: str, start: bool = False) -> str:
    return f"{'The' if start else 'the'} {country}" if country in WITH_THE else country


# ---------------------------------------------------------------------------------------------------
# Code for derived tables. It runs in the app's sandbox with the dataset's tables under data/, as the
# app runs it again when a visitor refreshes the table; its result is the variable `out`.
# ---------------------------------------------------------------------------------------------------

# An institution string's country: ROR's confident match, else OpenAlex's institution, else the first
# organization an AI model read in it.
INSTITUTION_COUNTRY = """institution_country as (
        select i.institution,
               coalesce(i.ror_country_code, i.openalex_country_code, o.country_code) as country_code
        from read_parquet('data/institutions.parquet') i
        left join (select institution, country_code from read_parquet('data/institution_orgs.parquet')
                   where org_index = 1) o using (institution)
    )"""

# Institution strings that name Microsoft or one of its companies (as an AI model read them).
MICROSOFT = """microsoft as (
        select distinct institution, organization
        from read_parquet('data/institution_orgs.parquet')
        where lower(coalesce(parent, '') || ' ' || organization) like '%microsoft%'
           or lower(coalesce(parent, organization)) in ('github', 'linkedin')
    )"""


def duck(sql: str, after: str = "") -> str:
    """Python for a derived table: one DuckDB query over the dataset's tables (plus ``after`` lines)."""
    return f'import duckdb\n\nout = duckdb.sql("""\n    {textwrap.dedent(sql).strip()}\n""").df()\n{after}'


# ---------------------------------------------------------------------------------------------------
# A story being made: its workspace (the dataset session), and the tables, charts and files it adds.
# ---------------------------------------------------------------------------------------------------

class Story:
    def __init__(self, story: dict, starter: dict, content: Path, work: Path):
        self.id = story["id"]
        self.story = story
        self.workspace = WorkspaceManager(work).create_and_open_workspace(self.id, "local:site-builder")
        self.workspace.import_session_zip(io.BytesIO((content / starter["file"]).read_bytes()))
        self.sandbox = create_sandbox("local")
        self.tables: list[dict] = []
        self.charts: list[dict] = []
        self.files: list[dict] = []
        # The chapter being made: each chapter is one question of the session's thread, with its tables and files.
        self.chapter = 0
        # Each chapter's lead file (what it opens on): its last one unless its maker says otherwise.
        self.lead: str | None = None
        self.leads: dict[int, str] = {}

    def begin(self, chapter: int) -> None:
        if self.lead:
            self.leads[self.chapter] = self.lead
        self.chapter, self.lead = chapter, None

    def lead_of(self, chapter: int) -> str:
        if chapter == self.chapter and self.lead:
            return self.lead
        return self.leads.get(chapter) or [file for file in self.files if file["chapter"] == chapter][-1]["name"]

    def sql(self, query: str) -> pd.DataFrame:
        """Facts for the text, from the dataset's tables and the story's (``data/<table>.parquet``)."""
        with self.workspace.local_dir() as root:
            return duckdb.sql(query.replace("'data/", f"'{Path(root).as_posix()}/data/")).df()

    def table(self, table_id: str, name: str, description: str, code: str, fields: dict[str, dict]) -> pd.DataFrame:
        """Run a derived table's code in the sandbox and keep its rows; ``fields`` are its columns' semantics."""
        result = self.sandbox.run_python_code(code=code, workspace=self.workspace, output_variable="out")
        if result["status"] != "ok":
            raise StoryError(f"{table_id}: {result['content']}")
        frame = result["content"].reset_index(drop=True)
        expect(len(frame) > 0, f"{table_id} has no rows")
        self.workspace.write_parquet(frame, table_id)
        sources = sorted(set(re.findall(r"data/(\w+)\.parquet", code)))
        self.tables.append({"id": table_id, "name": name, "description": description, "code": code,
                            "fields": fields, "frame": frame, "sources": sources, "chapter": self.chapter})
        return frame

    def chart(self, table_id: str, chart_type: str, encodings: dict[str, dict], title: str, subtitle: str) -> None:
        """A canvas chart of one of the story's tables (``encodings``: channel -> {field, dtype, …})."""
        self.charts.append({"table": table_id, "type": chart_type, "encodings": encodings, "title": title,
                            "subtitle": subtitle, "chapter": self.chapter})

    def ranking(self, table_id: str, label: str, value: str, title: str, subtitle: str) -> None:
        self.chart(table_id, "Bar Chart", {
            "x": {"field": value, "dtype": "quantitative"},
            "y": {"field": label, "dtype": "nominal", "sortBy": "x", "sortOrder": "descending"},
        }, title, subtitle)

    def map(self, filename: str, title: str, spec: dict) -> None:
        """A map file, checked as ``write_map`` checks it against the story's tables."""
        body = {"version": 1, "title": title, **spec}
        try:
            result = validate_map(body, self.workspace)
        except ValueError as error:
            raise StoryError(f"{filename}: {error}") from error
        expect(not result["warnings"], f"{filename}: {result['warnings']}")
        self.files.append({"name": filename, "title": title, "content": encode_map(body),
                           "media_type": "application/json", "after": result["tables"][-1], "chapter": self.chapter})

    def app(self, filename: str, title: str, tables: list[str], source: str) -> None:
        """An app from its template in apps/ (``__SOURCE__`` is its source line), checked as ``write_app`` checks it."""
        code = (APPS / filename).read_text(encoding="utf-8").replace("__SOURCE__", source)
        try:
            validate_react_app(code)
        except ValueError as error:
            raise StoryError(f"{filename}: {error}") from error
        warnings = lint_react_app(code, tables)
        expect(not warnings, f"{filename}: {warnings}")
        known = {table["id"] for table in self.tables}
        expect(set(tables) <= known, f"{filename} reads tables the story does not make: {set(tables) - known}")
        content = stamp_react_manifest(code, {"version": 2, "title": title, "tables": tables})
        self.files.append({"name": filename, "title": title, "content": content.encode("utf-8"),
                           "media_type": "text/jsx", "after": tables[-1], "chapter": self.chapter})


# ---------------------------------------------------------------------------------------------------
# The seed: the story's session state (a thread of one question), its tables' parquet files, its files.
# ---------------------------------------------------------------------------------------------------

def _column_type(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_numeric_dtype(series):
        return "number"
    return "string"


def _concept(concepts: list[dict], story_id: str, name: str) -> str:
    for item in concepts:
        if item["name"] == name:
            return item["id"]
    digest = _stable(story_id, name)
    concept_id = f"concept-{name}-{int(digest[:10], 16) % 10**13}-0.{int(digest[10:26], 16)}"
    concepts.append({"id": concept_id, "name": name, "source": "custom", "tableRef": "custom"})
    return concept_id


def _fingerprint(chart: dict) -> str:
    """Same as computeEncodingFingerprint in src/components/ComponentType.tsx."""
    tuples = sorted(f"{channel}:{(enc or {}).get('fieldID', '') or ''}:{(enc or {}).get('aggregate', '') or ''}"
                    for channel, enc in chart["encodingMap"].items())
    return f"{chart['chartType']}|{'|'.join(tuples)}"


def _semantics(fields: dict[str, dict]) -> dict[str, dict]:
    out = {}
    for name, info in fields.items():
        authored = dict(info)
        out[name] = {**authored, **({"authored": authored} if "displayName" in authored else {})}
    return out


def seed_state(story: Story, index: int, chapters: list[dict], headline: str) -> dict:
    """The session: one thread asking each chapter's question in turn (``chapters``: prompt, answer), each answered
    with its tables and files; it opens on the first chapter's lead file."""
    clock = iter(range(EPOCH + index * 3_600_000, EPOCH + (index + 1) * 3_600_000, 1000))
    head = f"conversation-root:{uuid.uuid5(uuid.NAMESPACE_URL, SEED_NAMESPACE + story.id)}"
    turns, tables, files, concepts = [], [], [], []
    for number, chapter in enumerate(chapters):
        action = f"exploreDataFromNL_{EPOCH + index * 3_600_000 + number * 300_000}"
        prompt_turn = {"kind": "text", "id": f"textTurn_{action}_prompt", "displayId": f"textTurn_{action}_prompt",
                       "textKind": "explain", "content": "", "prompt": chapter["prompt"], "parentNodeId": head,
                       "actionId": action, "createdAt": next(clock)}
        turns.append(prompt_turn)
        head = prompt_turn["id"]
        started = prompt_turn["createdAt"]
        own_tables = [table for table in story.tables if table["chapter"] == number]
        own_files = [file for file in story.files if file["chapter"] == number]
        lead_name = story.lead_of(number)
        # Tables a map or app draws come last, and the lead file's last of all, so each answer ends on what it opens.
        ordered = sorted(own_tables, key=lambda table: (any(file["after"] == table["id"] for file in own_files),
                                                        any(file["after"] == table["id"] and file["name"] == lead_name
                                                            for file in own_files)))
        for step, table in enumerate(ordered, start=1):
            made = sorted((file for file in own_files if file["after"] == table["id"]),
                          key=lambda file: file["name"] == lead_name)
            expect(table["id"] in STEP_MESSAGES, f"{table['id']} has no step message in STEP_MESSAGES")
            label = STEP_MESSAGES[table["id"]]
            progress = [{"id": f"progress-{action}-{step}-1", "kind": "tool", "status": "completed", "tool": "create_data",
                         "label": f"Querying: {', '.join(table['sources'])}"}]
            progress += [{"id": f"progress-{action}-{step}-{n}", "kind": "info", "status": "completed",
                          "label": f"{'Map' if file['name'].endswith('.map.json') else 'App'} created: {file['title']}"}
                         for n, file in enumerate(made, start=2)]
            turn = {"kind": "text", "id": f"textTurn_{action}_step_{step}", "displayId": f"textTurn_{action}_step_{step}",
                    "textKind": "explain", "content": label, "parentNodeId": head, "actionId": action,
                    "createdAt": next(clock), "startedAt": started, "progressSteps": progress}
            turns.append(turn)
            frame = table["frame"]
            tables.append({
                "kind": "table", "id": table["id"], "displayId": table["name"], "names": list(frame.columns),
                "rows": df_to_safe_records(frame),
                "metadata": {column: {"type": _column_type(frame[column]), "levels": []} for column in frame.columns},
                "derive": {
                    "code": table["code"], "outputVariable": "out", "source": table["sources"],
                    "trigger": {"tableId": table["sources"][0], "resultTableId": table["id"],
                                "chart": {"id": f"chart-trigger-{table['id']}", "chartType": "Auto", "encodingMap": {},
                                          "tableRef": table["sources"][0], "source": "trigger"}},
                },
                "virtual": {"tableId": table["id"], "rowCount": len(frame)},
                "description": table["description"], "parentNodeId": turn["id"], "createdAt": next(clock),
            })
            head = table["id"]
            for file in made:
                files.append({"kind": "file", "id": f"file-{file['name']}", "path": file["name"],
                              "displayName": file["title"], "contentHash": hashlib.sha256(file["content"]).hexdigest(),
                              "parentNodeId": head, "createdAt": next(clock)})
                head = files[-1]["id"]
        closing = {"kind": "text", "id": f"textTurn_{action}_closing_turn", "displayId": f"textTurn_{action}_closing",
                   "textKind": "explain", "content": chapter["answer"].strip(), "parentNodeId": head, "actionId": action,
                   "createdAt": next(clock), "startedAt": started, "answered": True}
        turns.append(closing)
        # The next question follows this answer, as a visitor's next question would.
        head = closing["id"]

    charts = []
    for spec in story.charts:
        chart = {
            "id": f"chart-{_stable(story.id, spec['table'], spec['title'])[:12]}",
            "chartType": spec["type"],
            "encodingMap": {
                **{channel: {"fieldID": _concept(concepts, story.id, enc["field"]),
                             **{key: value for key, value in enc.items() if key != "field"}}
                   for channel, enc in spec["encodings"].items()},
                **{channel: {"channel": channel, "bin": False} for channel in EMPTY_CHANNELS if channel not in spec["encodings"]},
            },
            "tableRef": spec["table"], "source": "user", "title": spec["title"], "subtitle": spec["subtitle"],
            "unread": False, "themeId": "datawrapper",
        }
        chart["titleKey"] = _fingerprint(chart)
        charts.append(chart)

    lead = story.lead_of(0)
    # Every map and app keeps a tab; the first chapter's lead is open.
    tabs = [{"key": f"file:{node['path']}", "target": {"type": "file", "fileName": node["path"]},
             "addedAt": EPOCH + n, "viewedAt": EPOCH + n + (len(files) if node["path"] == lead else 0)}
            for n, node in enumerate(files)]
    return {
        "__stateVersion": SESSION_STATE_VERSION,
        "activeWorkspace": {"id": story.id, "displayName": headline},
        "derivedTables": tables,
        "charts": charts,
        "conceptShelfItems": concepts,
        "textTurns": turns,
        "tableSemantics": [{"tableId": table["id"], "fields": _semantics(table["fields"])} for table in story.tables],
        "fileNodes": files,
        "focusedId": {"type": "file", "fileName": lead},
        "canvasTabs": tabs,
        "canvasTabActive": f"file:{lead}",
    }


def write_seed(story: Story, state: dict) -> Path:
    folder = STORIES / story.id
    shutil.rmtree(folder, ignore_errors=True)
    (folder / "files").mkdir(parents=True)
    (folder / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for table in story.tables:
        table["frame"].to_parquet(folder / f"{table['id']}.parquet", index=False)
    for file in story.files:
        (folder / "files" / file["name"]).write_bytes(file["content"])
    return folder


def _yaml_text(key: str, text: str, indent: int = 8) -> list[str]:
    """``key: "text"`` as a field in profile.yaml at ``indent``, folded under 110 columns."""
    lines = textwrap.wrap(json.dumps(text, ensure_ascii=False), 110 - indent - len(key) - 2, break_long_words=False,
                          break_on_hyphens=False)
    return [f"{' ' * indent}{key}: {lines[0]}", *[f"{' ' * (indent + 2)}{line}" for line in lines[1:]]]


def set_story_text(texts: dict[str, dict]) -> None:
    """Write each story's headline and dek, and its chapters' headline, key figure (stat and message) and file, into
    profile.yaml, keeping the rest of the file as it is
    (``texts``: story id -> {headline, dek, chapters: {chapter id: {headline, stat, message, file}}})."""
    lines = PROFILE.read_text(encoding="utf-8").split("\n")
    out, story, chapter, index = [], None, None, 0
    while index < len(lines):
        line = lines[index]
        if (match := re.match(r"^      - id: (\S+)$", line)):
            story, chapter = match.group(1), None
        elif (match := re.match(r"^        - id: (\S+)$", line)):
            chapter = match.group(1)
        elif re.match(r"^        \S", line):
            chapter = None
        texts_here = texts.get(story)
        if texts_here and chapter is None:
            key, indent, values = next((key for key in ("headline", "dek") if line.startswith(f"        {key}:")), None), 8, texts_here
        elif texts_here and chapter in texts_here.get("chapters", {}):
            key, indent, values = next((key for key in ("headline", "stat", "message", "file") if line.startswith(f"          {key}:")), None), 10, \
                texts_here["chapters"][chapter]
        else:
            key = None
        if key:
            out += _yaml_text(key, values[key], indent)
            index += 1
            while index < len(lines) and lines[index].startswith(" " * (indent + 2)) and not lines[index].lstrip().startswith("- "):
                index += 1
            continue
        out.append(line)
        index += 1
    PROFILE.write_text("\n".join(out), encoding="utf-8")


# ---------------------------------------------------------------------------------------------------
# The stories. Each makes its tables and its map or app, and returns its answer, headline and dek, and its key
# figure for the session's card: a short `stat` ("67%") and the `message` it goes with ("of the posters are shown in Sydney").
# ---------------------------------------------------------------------------------------------------

PERCENT = {"semanticType": "Percentage", "unit": "%"}
PAPERS = {"semanticType": "Count", "displayName": "Papers"}
YEAR = {"year": {"semanticType": "Year", "displayName": "Year"}}
MAP_VIEW = {"style": "light"}
SOURCE_2026 = "neurips.cc, NeurIPS 2026 schedule (November 2026)"
SOURCE_ALL = "NeurIPS proceedings and neurips.cc; affiliations from neurips.cc (2020 on) and OpenAlex"

STORY_MAKERS: dict[str, Callable[[Story], dict[str, str]]] = {}


def story(story_id: str):
    def register(make):
        STORY_MAKERS[story_id] = make
        return make
    return register


def bullets(frame: pd.DataFrame, label: str, value: str, unit: str = "", digits: int = 0) -> str:
    return "\n".join(f"- **{getattr(row, label)}:** {fmt(getattr(row, value), digits)}{unit}" for row in frame.itertuples())


# --- NeurIPS 2026 -------------------------------------------------------------------------------------

CITY_COUNTRY = {"city": {"semanticType": "City", "displayName": "City"},
                "country_code": {"semanticType": "ID", "displayName": "Country code"},
                "map_id": {"semanticType": "ID", "displayName": "Map id"},
                "country": {"semanticType": "Country", "displayName": "Country"}}


@story("n3")
def three_cities(s: Story) -> dict[str, str]:
    places = s.table("city_countries_2026", "Where the authors of each city's papers work",
                     "For each NeurIPS 2026 city, the countries its papers' authors work in: papers shown there with at "
                     "least one author in the country, and their share of the city's papers (a paper counts for every "
                     f"country of its authors). Source: {SOURCE_2026}; ROR; OpenAlex.",
                     duck(f"""
                         with {INSTITUTION_COUNTRY},
                         city_papers as (
                             select distinct p.city, p.paper_id, ic.country_code
                             from read_parquet('data/papers_2026.parquet') p
                             join read_parquet('data/authorships_2026.parquet') a using (paper_id)
                             join institution_country ic using (institution)
                             where p.city is not null and ic.country_code is not null
                         ),
                         totals as (select city, count(distinct paper_id) as n from read_parquet('data/papers_2026.parquet')
                                    where city is not null group by city)
                         select cp.city, cp.country_code, c.map_id, c.country, count(*) as papers,
                                round(100.0 * count(*) / any_value(t.n), 1) as share
                         from city_papers cp join totals t using (city)
                         join read_parquet('data/countries.parquet') c using (country_code)
                         group by cp.city, cp.country_code, c.map_id, c.country
                         order by cp.city, papers desc"""),
                     {**CITY_COUNTRY, "papers": PAPERS, "share": {**PERCENT, "displayName": "Share of the city's papers"}})
    sessions = s.table("poster_sessions_2026", "NeurIPS 2026 poster sessions",
                       "Every NeurIPS 2026 poster session: its city, day, local start and end time, posters, and the "
                       f"topic area most of them are in. Source: {SOURCE_2026}.",
                       duck("""
                           select city, session, day, strftime(min(start_local), '%H:%M') as starts,
                                  strftime(max(end_local), '%H:%M') as ends, count(*) as papers,
                                  mode(topic_area) as main_area
                           from read_parquet('data/papers_2026.parquet')
                           where city is not null
                           group by city, session, day
                           order by day, starts, city"""),
                       {"city": {"semanticType": "City", "displayName": "City"},
                        "session": {"semanticType": "Category", "displayName": "Session"},
                        "day": {"semanticType": "Date", "displayName": "Day"},
                        "starts": {"semanticType": "Time", "displayName": "Starts"},
                        "ends": {"semanticType": "Time", "displayName": "Ends"}, "papers": PAPERS,
                        "main_area": {"semanticType": "Category", "displayName": "Main topic area"}})
    s.app("three_cities.app.jsx", "NeurIPS 2026 in three cities", ["city_countries_2026", "poster_sessions_2026"],
          f"{SOURCE_2026}; ROR; OpenAlex")
    totals = sessions.groupby("city").papers.sum().sort_values(ascending=False)
    first = totals.index[0]
    paris = places[places.city == "Paris"].iloc[0]
    expect(list(totals.index) == ["Sydney", "Atlanta", "Paris"], f"cities: {list(totals.index)}")
    share = 100 * totals.iloc[0] / totals.sum()
    return {
        "headline": f"{first} shows {fmt(share, 0)}% of NeurIPS 2026's posters",
        "stat": f"{fmt(share, 0)}%", "message": f"of the posters are shown in {first}",
        "dek": "",
        "answer": f"""
**{first} shows {fmt(totals.iloc[0], 0)} of NeurIPS 2026's posters ({fmt(share, 0)}%), Atlanta {fmt(totals['Atlanta'], 0)} and Paris {fmt(totals['Paris'], 0)}.** The story maps where each city's authors work (most of Paris's are in {paris.country}, {fmt(paris.share, 0)}%) and lays out every poster session to plan a visit.
""",
    }


@story("n1")
def countries_2026(s: Story) -> dict[str, str]:
    # Each authorship (an author on a paper) counts once, in the country of the institution it lists, so the shares
    # of all authors add up to 100%; authorships whose institution has no known country are left out.
    code = duck(f"""
        with {INSTITUTION_COUNTRY},
        placed as (
            select a.paper_id, ic.country_code
            from read_parquet('data/authorships_2026.parquet') a
            join institution_country ic using (institution)
            where ic.country_code is not null
        )
        select p.country_code, c.country, count(*) as authors, count(distinct p.paper_id) as papers,
               round(100.0 * count(*) / (select count(*) from placed), 1) as share
        from placed p join read_parquet('data/countries.parquet') c using (country_code)
        group by all
        order by authors desc, c.country""")
    fields = {"country_code": {"semanticType": "ID", "displayName": "Country code"},
              "country": {"semanticType": "Country", "displayName": "Country"},
              "authors": {"semanticType": "Count", "displayName": "Authors working there"},
              "papers": {**PAPERS, "displayName": "Papers with an author there"},
              "share": {**PERCENT, "displayName": "Share of authors", "thresholds": [0.5, 2, 5, 15, 30]}}
    description = ("NeurIPS 2026 authors per country where they work: each author on a paper counts once, in the "
                   "country of the institution they list, so shares add up to 100%; with the papers that have an "
                   f"author there. Source: {SOURCE_2026}; ROR; OpenAlex.")
    countries = s.table("papers_by_country_2026", "NeurIPS 2026 authors by country", description, code, fields)
    s.table("top_countries_2026", "15 countries with the most NeurIPS 2026 authors", description,
            code.replace("order by authors desc, c.country", "order by authors desc, c.country\n    limit 15"), fields)
    s.ranking("top_countries_2026", "country", "authors", "Where NeurIPS 2026 authors work",
              f"Authors on NeurIPS 2026 papers working in each country; {SOURCE_2026}")
    s.map("papers_by_country_2026.map.json", "Where NeurIPS 2026 authors work", {
        "subtitle": "Share of NeurIPS 2026 authors working in each country, %",
        "source": f"{SOURCE_2026}; ROR; OpenAlex", "template": "choropleth", "data": {"table": "papers_by_country_2026"},
        "encoding": {"region": "country_code", "color": "share", "tooltip": ["country", "share", "authors", "papers"]},
        "properties": {"geography": "world", "keyType": "iso2"}, "fields": fields, "view": MAP_VIEW,
    })
    first, second = countries.iloc[0], countries.iloc[1]
    expect(len(countries) >= 40, f"only {len(countries)} countries")
    expect(abs(countries.share.sum() - 100) < 1, f"shares add up to {countries.share.sum():.1f}%")
    return {
        "headline": f"{fmt(first.share, 0)}% of NeurIPS 2026 authors work in {the(first.country)}",
        "stat": f"{fmt(first.share, 0)}%", "message": f"of authors work in {the(first.country)}",
        "dek": "",
        "answer": f"""
**{fmt(first.share, 0)}% of NeurIPS 2026 authors work in {the(first.country)} and {fmt(second.share, 0)}% in {the(second.country)};** {len(countries)} countries have at least one author. Each author on a paper counts once, where they work, not their nationality. Hover a country on the map for its authors and papers.
""",
    }


@story("n2")
def topics_2026(s: Story) -> dict[str, str]:
    topics = s.table("topics_2026", "NeurIPS 2026 papers by topic",
                     "NeurIPS 2026 papers per topic and area, as authors chose them, with how many are orals or "
                     f"spotlights (highlighted). Papers without a topic left out. Source: {SOURCE_2026}.",
                     duck("""
                         select topic_area as area,
                                coalesce(nullif(split_part(topic, '->', 2), ''), topic_area || ' (general)') as topic,
                                count(*) as papers,
                                count(*) filter (where presentation in ('Oral', 'Spotlight')) as highlighted
                         from read_parquet('data/papers_2026.parquet')
                         where topic_area is not null
                         group by all
                         order by papers desc"""),
                     {"area": {"semanticType": "Category", "displayName": "Topic area"},
                      "topic": {"semanticType": "Category", "displayName": "Topic"}, "papers": PAPERS,
                      "highlighted": {"semanticType": "Count", "displayName": "Orals and spotlights"}})
    s.app("topics_2026.app.jsx", "What NeurIPS 2026 is about", ["topics_2026"], SOURCE_2026)
    areas = topics.groupby("area").papers.sum().sort_values(ascending=False)
    top = topics.iloc[0]
    return {
        "headline": f"{areas.index[0]} is NeurIPS 2026's biggest area; {top.topic} its biggest topic",
        "stat": fmt(top.papers, 0), "message": f"papers on {in_sentence(top.topic)}",
        "dek": "",
        "answer": f"""
**{areas.index[0]} is the biggest area ({fmt(areas.iloc[0], 0)} papers) and {in_sentence(top.topic)} the biggest single topic ({fmt(top.papers, 0)}).** The story shows every topic as a tile, sized by its papers, and where the orals and spotlights go.
""",
    }


# An organization as the papers count it: a lab or unit under its company or university (Microsoft Research Asia ->
# Microsoft, Stanford's linguistics department -> Stanford), but a university's campuses kept apart (UC Berkeley).
_GROUP = """case when o.parent is not null and (o.kind <> 'university' or contains(o.organization, o.parent))
                     then replace(o.parent, 'Alphabet', 'Google') else o.organization end"""
# Names the AI model gave one organization in more than one form ("The" dropped first).
ALIASES = {"Massachusetts Institute of Technology": "MIT", "Korea Advanced Institute of Science and Technology": "KAIST",
           "Mila": "Mila – Quebec AI Institute", "Mila - Quebec AI Institute": "Mila – Quebec AI Institute",
           "École Polytechnique Fédérale de Lausanne": "EPFL"}
_BARE = f"regexp_replace({_GROUP}, '^The ', '')"
ORGANIZATION_GROUP = ("case " + _BARE + " " + " ".join(f"when '{name}' then '{alias}'" for name, alias in ALIASES.items())
                      + f" else {_BARE} end")


def organizations_code(authorships: str, where: str = "", limit: str = "", only: str = "") -> str:
    """Organizations by papers with an author there (``only``: a filter on the papers), with where ROR places them."""
    return duck(f"""
        with groups as (
            select distinct a.paper_id, {ORGANIZATION_GROUP} as organization, o.kind, o.country_code
            from read_parquet('data/{authorships}.parquet') a
            join read_parquet('data/institution_orgs.parquet') o using (institution)
            where o.kind not in ('independent', 'other') {only}
        ),
        organizations as (
            select g.organization,
                   case mode(g.kind) when 'company' then 'Company' when 'university' then 'University'
                        else 'Research institute or other' end as kind,
                   mode(g.country_code) as country_code, count(distinct g.paper_id) as papers
            from groups g group by g.organization
        ),
        places as (
            -- Where ROR places the organization's strings in its own country (not a subsidiary or lab abroad)
            select og.organization, arg_max(i.ror_lat, i.authorships) as lat, arg_max(i.ror_lng, i.authorships) as lng
            from read_parquet('data/institution_orgs.parquet') o
            join read_parquet('data/institutions.parquet') i using (institution)
            join organizations og on og.organization = {ORGANIZATION_GROUP}
            where o.org_index = 1 and i.ror_lat is not null and i.ror_country_code = og.country_code
            group by og.organization
        )
        select o.organization, o.kind, c.country, o.papers, p.lat, p.lng
        from organizations o left join places p using (organization)
        left join read_parquet('data/countries.parquet') c using (country_code)
        {where}
        order by o.papers desc, o.organization{limit}""")


ORGANIZATION_FIELDS = {"organization": {"semanticType": "Name", "displayName": "Organization"},
                       "kind": {"semanticType": "Category", "displayName": "Kind"},
                       "country": {"semanticType": "Country", "displayName": "Country"},
                       "papers": {**PAPERS, "displayName": "Papers"},
                       "lat": {"semanticType": "Latitude"}, "lng": {"semanticType": "Longitude"}}


@story("n4")
def organizations_2026(s: Story) -> dict[str, str]:
    description = ("NeurIPS 2026 papers per organization where at least one author works, with its kind and country "
                   "and where ROR places it. Organizations as an AI model read the institution strings, labs counted "
                   f"with their company or university, a university's campuses apart. Source: {SOURCE_2026}; ROR.")
    top = s.table("top_organizations_2026", "15 organizations with the most NeurIPS 2026 papers", description,
                  organizations_code("authorships_2026", limit="\n        limit 15"), ORGANIZATION_FIELDS)
    s.ranking("top_organizations_2026", "organization", "papers", "Who publishes most at NeurIPS 2026",
              f"Papers with at least one author at the organization, labs included; {SOURCE_2026}")
    placed = s.table("organization_places_2026", "Organizations with NeurIPS 2026 papers, on a map",
                     description + " Only organizations with 5 or more papers that ROR locates.",
                     organizations_code("authorships_2026", "where p.lat is not null and o.papers >= 5"),
                     ORGANIZATION_FIELDS)
    s.map("organizations_2026.map.json", "Where NeurIPS 2026 papers are written", {
        "subtitle": "Universities, companies and institutes by NeurIPS 2026 papers with an author there (5 or more)",
        "source": f"{SOURCE_2026}; ROR", "template": "bubbles", "data": {"table": "organization_places_2026"},
        "encoding": {"lat": "lat", "lon": "lng", "size": "papers", "color": "kind", "label": "organization",
                     "tooltip": ["organization", "country", "papers"]},
        "properties": {"geography": "world"}, "fields": ORGANIZATION_FIELDS, "view": MAP_VIEW,
    })
    company = placed[placed.kind == "Company"].iloc[0]
    expect(len(placed) > 100, f"only {len(placed)} organizations on the map")
    return {
        "headline": f"{top.iloc[0].organization} is on the most NeurIPS 2026 papers; {company.organization} leads companies",
        "stat": fmt(top.iloc[0].papers, 0), "message": f"papers from {top.iloc[0].organization}, #1",
        "dek": "",
        "answer": f"""
**{top.iloc[0].organization} has the most NeurIPS 2026 papers ({fmt(top.iloc[0].papers, 0)}), and {company.organization} leads the companies ({fmt(company.papers, 0)}).** The map shows every organization with 5 or more papers; find yours. Labs count with their company or university, as an AI model read the authors' institutions.
""",
    }


# --- NeurIPS over the years --------------------------------------------------------------------------

@story("h1")
def growth(s: Story) -> dict[str, str]:
    years = s.table("papers_per_year", "NeurIPS papers per year",
                    "NeurIPS papers per year since 1987 (all tracks), the average number of authors per paper, and "
                    f"the city NeurIPS met in (its main one in 2025 and 2026). Source: {SOURCE_ALL}.",
                    duck("""
                        select p.year, count(*) as papers, round(avg(p.n_authors), 2) as authors_per_paper,
                               any_value(c.city) as city
                        from read_parquet('data/papers.parquet') p
                        left join read_parquet('data/conferences.parquet') c on c.year = p.year and c.main
                        group by p.year
                        order by p.year"""),
                    {**YEAR, "papers": PAPERS,
                     "authors_per_paper": {"semanticType": "Number", "displayName": "Authors per paper"},
                     "city": {"semanticType": "City", "displayName": "Where NeurIPS met"}})
    s.app("growth.app.jsx", "From 90 papers to 9,000", ["papers_per_year"], SOURCE_ALL)
    first, last = years.iloc[0], years.iloc[-1]
    ratio = last.papers / first.papers
    expect(ratio > 50, f"only {ratio:.0f} times as many papers")
    return {
        "headline": f"NeurIPS has {round(ratio)} times as many papers as in {int(first.year)}",
        "stat": f"{round(ratio)}×", "message": f"as many papers as in {int(first.year)}",
        "dek": "",
        "answer": f"""
**From {fmt(first.papers, 0)} papers in {int(first.year)} to {fmt(last.papers, 0)} in {int(last.year)}.** The story follows the years in Denver, the slow climb, the deep learning boom and the move to three cities.
""",
    }


TITLE_TERMS = '''TERMS = {
    "neural network": r"\\bneural net",
    "kernel": r"\\bkernel",
    "Bayesian": r"\\bbayes",
    "deep": r"\\bdeep\\b",
    "diffusion": r"\\bdiffusion\\b",
    "language model": r"\\blanguage models?\\b|\\bllms?\\b",
}'''


@story("h2")
def ideas(s: Story) -> dict[str, str]:
    s.table("topic_areas_by_year", "Share of NeurIPS papers by topic area, by year",
            "Each year's NeurIPS papers by topic area, as an AI model classified every paper into NeurIPS 2025–2026's "
            "topic list (it agrees with authors' own choice of area about 70% of the time): papers and share of the "
            f"year's papers. Source: {SOURCE_ALL}; topics by an AI model.",
            duck("""
                select year, split_part(topic_llm, '->', 1) as area, count(*) as papers,
                       round(100.0 * count(*) / sum(count(*)) over (partition by year), 1) as share
                from read_parquet('data/papers.parquet')
                where topic_llm is not null
                group by year, area
                order by year, area"""),
            {**YEAR, "area": {"semanticType": "Category", "displayName": "Topic area (AI-classified)"},
             "papers": PAPERS, "share": {**PERCENT, "displayName": "Share of papers"}})
    code = f'''import duckdb
import pandas as pd

{TITLE_TERMS}
papers = duckdb.sql("select year, title from read_parquet('data/papers.parquet')").df()
totals = papers.groupby("year").size()
rows = []
for term, pattern in TERMS.items():
    hits = papers[papers.title.str.contains(pattern, case=False, regex=True)].groupby("year").size()
    for year, total in totals.items():
        rows.append({{"year": year, "term": term, "papers": int(hits.get(year, 0)),
                     "share": round(100 * hits.get(year, 0) / total, 1)}})
out = pd.DataFrame(rows)
'''
    words = s.table("title_words_by_year", "Words in NeurIPS paper titles by year",
                    "Share of each year's NeurIPS papers whose title contains a word (case-insensitive, whole words; "
                    "'language model' also counts LLM). Source: NeurIPS proceedings and neurips.cc.", code,
                    {**YEAR, "term": {"semanticType": "Category", "displayName": "Word in the title"}, "papers": PAPERS,
                     "share": {**PERCENT, "displayName": "Share of titles"}})
    s.app("ideas.app.jsx", "Forty years of ideas at NeurIPS", ["topic_areas_by_year", "title_words_by_year"],
          f"{SOURCE_ALL}; topics by an AI model")
    last = int(words.year.max())
    llm = words[(words.term == "language model") & (words.year == last)].share.iloc[0]
    expect(llm > 5, f"language models in only {llm}% of {last} titles")
    return {
        "headline": f"Neural networks, then probability, then deep learning; language models are in {fmt(llm, 0)}% of {last} titles",
        "stat": f"{fmt(llm, 0)}%", "message": f"of {last} titles name language models",
        "dek": "",
        "answer": f"""
**Forty years of ideas: neural networks first, then probabilistic methods and theory, then deep learning; in {last}, {fmt(llm, 0)}% of titles name language models.** The story shows each topic area as a stream (topics classified by an AI model, so broad trends) and how words in titles rose and fell.
""",
    }


@story("h3")
def geography(s: Story) -> dict[str, str]:
    lines = s.table("country_shares_by_year", "Share of NeurIPS papers by where authors work, by year",
                    "For each year since 2000, the share of NeurIPS papers with known affiliations that have at least "
                    "one author working in the US, China, Europe or elsewhere (a paper counts for each). Affiliations "
                    "are known for 98% of papers from 2020 and for 50–85% before (those OpenAlex records; 2006 left "
                    f"out). Source: {SOURCE_ALL}; ROR.",
                    duck(f"""
                        with {INSTITUTION_COUNTRY},
                        paper_groups as (
                            select distinct a.year, a.paper_id,
                                   case when ic.country_code = 'US' then 'US'
                                        when ic.country_code = 'CN' then 'China'
                                        when c.region = 'Europe' then 'Europe'
                                        else 'Elsewhere' end as place
                            from read_parquet('data/authorships.parquet') a
                            join institution_country ic using (institution)
                            join read_parquet('data/countries.parquet') c using (country_code)
                            where a.year >= 2000 and a.year != 2006
                        ),
                        known as (select year, count(distinct paper_id) as papers from paper_groups group by year)
                        select year, place, count(*) as papers, round(100.0 * count(*) / any_value(k.papers), 1) as share
                        from paper_groups join known k using (year)
                        group by year, place
                        order by year, place"""),
                    {**YEAR, "place": {"semanticType": "Region", "displayName": "Where authors work"},
                     "papers": PAPERS, "share": {**PERCENT, "displayName": "Share of papers"}})
    s.table("country_shares_then_now", "Share of NeurIPS papers by country, 2008–2012 and 2026",
            "For each country, the share of NeurIPS papers (with known affiliations) with at least one author working "
            "there, in 2008–2012 together and in 2026. Earlier affiliations only for papers OpenAlex records. "
            f"Source: {SOURCE_ALL}; ROR.",
            duck(f"""
                with {INSTITUTION_COUNTRY},
                paper_countries as (
                    select distinct case when a.year = 2026 then 'now' else 'then' end as period, a.paper_id,
                           ic.country_code
                    from read_parquet('data/authorships.parquet') a
                    join institution_country ic using (institution)
                    where (a.year between 2008 and 2012 or a.year = 2026) and ic.country_code is not null
                ),
                known as (select period, count(distinct paper_id) as n from paper_countries group by period),
                shares as (
                    select period, country_code, 100.0 * count(*) / any_value(k.n) as share
                    from paper_countries join known k using (period) group by period, country_code
                )
                select c.country_code, c.map_id, c.country,
                       round(coalesce(max(share) filter (where period = 'then'), 0), 1) as share_then,
                       round(coalesce(max(share) filter (where period = 'now'), 0), 1) as share_now
                from shares join read_parquet('data/countries.parquet') c using (country_code)
                where c.map_id is not null
                group by c.country_code, c.map_id, c.country
                order by share_now desc"""),
            {"country_code": {"semanticType": "ID", "displayName": "Country code"},
             "map_id": {"semanticType": "ID", "displayName": "Map id"},
             "country": {"semanticType": "Country", "displayName": "Country"},
             "share_then": {**PERCENT, "displayName": "Share of papers, 2008–2012"},
             "share_now": {**PERCENT, "displayName": "Share of papers, 2026"}})
    s.app("geography.app.jsx", "Where NeurIPS authors work", ["country_shares_by_year", "country_shares_then_now"],
          f"{SOURCE_ALL}; ROR")
    at = lambda place, year: lines[(lines.place == place) & (lines.year == year)].share.iloc[0]
    last = int(lines.year.max())
    cn0, cn = at("China", 2010), at("China", last)
    expect(cn > cn0, "China's share did not grow")
    return {
        "headline": f"China's share of NeurIPS papers rose from {fmt(cn0, 0)}% to {fmt(cn, 0)}% since 2010",
        "stat": f"{fmt(cn, 0)}%", "message": "of papers now have an author in China",
        "dek": "",
        "answer": f"""
**{fmt(cn)}% of NeurIPS {last} papers have an author working in China, up from {fmt(cn0)}% in 2010; the US share went from {fmt(at('US', 2010))}% to {fmt(at('US', last))}%.** The story compares the map then and now. Before 2020, affiliations are known only for the papers OpenAlex records, so early shares are estimates.
""",
    }


@story("h4")
def conference_cities(s: Story) -> dict[str, str]:
    route = s.table("conference_route", "Where NeurIPS met, year by year",
                    "NeurIPS's main city each year it met in person (2020 and 2021 were online; in 2025 it also met in "
                    "Mexico City, in 2026 in Atlanta and Paris), with its papers. Source: NeurIPS.",
                    duck("""
                        select c.year, c.city, n.country, c.lat, c.lng, p.papers
                        from read_parquet('data/conferences.parquet') c
                        join read_parquet('data/countries.parquet') n using (country_code)
                        join (select year, count(*) as papers from read_parquet('data/papers.parquet') group by year) p
                            using (year)
                        where c.main and c.lat is not null
                        order by c.year"""),
                    {**YEAR, "city": {"semanticType": "City", "displayName": "City"},
                     "country": {"semanticType": "Country", "displayName": "Country"},
                     "lat": {"semanticType": "Latitude"}, "lng": {"semanticType": "Longitude"}, "papers": PAPERS})
    s.map("conference_route.map.json", "Where NeurIPS met", {
        "subtitle": "NeurIPS's main city each year it met in person, 1987–2026; lines grow with its papers",
        "source": "NeurIPS", "template": "routes", "data": {"table": "conference_route"},
        "encoding": {"lat": "lat", "lon": "lng", "order": "year", "label": "city", "size": "papers",
                     "tooltip": ["year", "city", "papers"]},
        "properties": {"geography": "world", "direction": "arrow"},
        "fields": {"year": {"semanticType": "Year", "displayName": "Year"}, "city": {"semanticType": "City"},
                   "papers": PAPERS, "lat": {"semanticType": "Latitude"}, "lng": {"semanticType": "Longitude"}},
        # Centred on the Americas, so the way to Sydney crosses the Pacific and Europe stays in view.
        "view": {**MAP_VIEW, "rotate": [110, 0]},
    })
    cities = route.groupby("city", sort=False).year.agg(["count", "min", "max"])
    last = route.iloc[-1]
    expect("Denver" in cities.index, "no Denver")
    return {
        "headline": f"NeurIPS met {cities.loc['Denver', 'count']} times in Denver; in {int(last.year)} it goes to {last.city}",
        "stat": str(len(cities)), "message": f"host cities, from Denver to {last.city}",
        "dek": "",
        "answer": f"""
**NeurIPS met in Denver from {int(cities.loc['Denver', 'min'])} to {int(cities.loc['Denver', 'max'])}, then mostly in Vancouver and Montréal; in {int(last.year)} its main city is {last.city}, with Atlanta and Paris at the same time.** Follow the arrows on the map, year by year; 2020 and 2021 were online.
""",
    }


# --- Microsoft at NeurIPS ----------------------------------------------------------------------------

@story("m1")
def microsoft_2026(s: Story) -> dict[str, str]:
    papers = s.table("microsoft_papers_2026", "NeurIPS 2026 papers with Microsoft authors",
                     "NeurIPS 2026 papers with at least one author at Microsoft (an institution an AI model read as "
                     "Microsoft or one of its labs or companies, such as GitHub and LinkedIn), with the Microsoft teams "
                     f"named and where and when each poster is shown (local time). Source: {SOURCE_2026}.",
                     duck(f"""
                         with {MICROSOFT},
                         teams as (
                             select a.paper_id, string_agg(distinct m.organization, '; ') as microsoft_teams
                             from read_parquet('data/authorships_2026.parquet') a join microsoft m using (institution)
                             group by a.paper_id
                         )
                         select p.paper_id, p.title, p.presentation, p.topic_area, p.city, p.day,
                                strftime(p.start_local, '%H:%M') as starts, p.session, p.poster_position,
                                t.microsoft_teams, p.url
                         from read_parquet('data/papers_2026.parquet') p join teams t using (paper_id)
                         order by p.day, starts, p.city, p.poster_position"""),
                     {"paper_id": {"semanticType": "ID", "displayName": "Paper"},
                      "title": {"semanticType": "Name", "displayName": "Title"},
                      "presentation": {"semanticType": "Category", "displayName": "Presentation"},
                      "topic_area": {"semanticType": "Category", "displayName": "Topic area"},
                      "city": {"semanticType": "City", "displayName": "City"},
                      "day": {"semanticType": "Date", "displayName": "Day"},
                      "starts": {"semanticType": "Time", "displayName": "Starts"},
                      "session": {"semanticType": "Category", "displayName": "Session"},
                      "poster_position": {"semanticType": "ID", "displayName": "Poster"},
                      "microsoft_teams": {"semanticType": "Name", "displayName": "Microsoft teams"},
                      "url": {"semanticType": "ID", "displayName": "Link"}})
    s.table("microsoft_by_year", "NeurIPS papers with Microsoft authors by year",
            "NeurIPS papers per year since 1995 with at least one author at Microsoft (as an AI model read the "
            "institutions), and their share of the year's papers with known affiliations (98% of papers from 2020, "
            f"50–85% before; 2006 left out). Source: {SOURCE_ALL}.",
            duck(f"""
                with {MICROSOFT},
                known as (
                    select year, count(distinct paper_id) as known
                    from read_parquet('data/authorships.parquet')
                    where institution is not null group by year
                ),
                ms as (
                    select year, count(distinct paper_id) as papers
                    from read_parquet('data/authorships.parquet')
                    where institution in (select institution from microsoft) group by year
                )
                select year, coalesce(ms.papers, 0) as papers,
                       round(100.0 * coalesce(ms.papers, 0) / k.known, 1) as share
                from known k left join ms using (year)
                where year >= 1995 and year != 2006
                order by year"""),
            {**YEAR, "papers": {**PAPERS, "displayName": "Papers with Microsoft authors"},
             "share": {**PERCENT, "displayName": "Share of papers"}})
    s.app("microsoft_2026.app.jsx", "Microsoft at NeurIPS 2026", ["microsoft_papers_2026", "microsoft_by_year"],
          SOURCE_2026)
    by_city = papers.city.value_counts()
    expect(len(papers) >= 50, f"only {len(papers)} Microsoft papers")
    return {
        "headline": f"{len(papers)} NeurIPS 2026 papers have Microsoft authors",
        "stat": str(len(papers)), "message": "2026 papers with Microsoft authors",
        "dek": "",
        "answer": f"""
**{len(papers)} NeurIPS 2026 papers have at least one author at Microsoft: {names([f"{n} in {city}" for city, n in by_city.items()])}.** The story shows each one as a dot, by topic and by city, how that grew since 1995, and every paper with its poster session. Microsoft includes its labs and companies such as GitHub and LinkedIn, as an AI model read the institutions.
""",
    }


@story("m2")
def microsoft_partners(s: Story) -> dict[str, str]:
    only = ("and a.year >= 2020 and a.paper_id in (select paper_id from read_parquet('data/authorships.parquet') "
            "where institution in (select institution from microsoft))\n"
            "              and a.institution not in (select institution from microsoft)")
    code = lambda where="", limit="": organizations_code("authorships", where, limit, only).replace(
        "with groups as (", f"with {MICROSOFT},\n        groups as (")
    description = ("Organizations whose authors wrote NeurIPS papers with Microsoft authors, 2020–2026: papers "
                   "together, the organization's kind and country, and where ROR places it. Organizations as an AI "
                   f"model read the institution strings. Source: {SOURCE_ALL}; ROR.")
    top = s.table("top_microsoft_partners", "15 organizations that write the most NeurIPS papers with Microsoft",
                  description, code(limit="\n        limit 15"), ORGANIZATION_FIELDS)
    s.ranking("top_microsoft_partners", "organization", "papers", "Microsoft's most frequent NeurIPS co-authors",
              f"NeurIPS papers written with Microsoft authors, 2020–2026; {SOURCE_ALL}")
    placed = s.table("microsoft_partner_places", "Organizations that write NeurIPS papers with Microsoft, on a map",
                     description + " Only organizations with 2 or more papers together that ROR locates.",
                     code("where p.lat is not null and o.papers >= 2"),
                     ORGANIZATION_FIELDS)
    s.map("microsoft_partners.map.json", "Where Microsoft's NeurIPS co-authors work", {
        "subtitle": "Organizations by NeurIPS papers written with Microsoft authors, 2020–2026 (2 or more)",
        "source": f"{SOURCE_ALL}; ROR", "template": "bubbles", "data": {"table": "microsoft_partner_places"},
        "encoding": {"lat": "lat", "lon": "lng", "size": "papers", "color": "kind", "label": "organization",
                     "tooltip": ["organization", "country", "papers"]},
        "properties": {"geography": "world"}, "fields": ORGANIZATION_FIELDS, "view": MAP_VIEW,
    })
    universities = placed[placed.kind == "University"]
    expect(len(placed) > 100, f"only {len(placed)} partners on the map")
    leaders = list(top[top.papers == top.papers.max()].organization)
    return {
        "headline": f"Microsoft's most frequent NeurIPS co-authors are at {names(leaders)}",
        "stat": fmt(len(placed), 0), "message": "co-author organizations, 2+ papers each",
        "dek": "",
        "answer": f"""
**Since 2020, Microsoft authors wrote the most NeurIPS papers with {names(list(top.organization[:3]))}.** The map shows the {fmt(len(placed), 0)} organizations they wrote 2 or more papers with, {fmt(len(universities), 0)} of them universities, sized by papers together; find yours.
""",
    }


# Each session's own headline: what it covers, in a few words (its chapters' key figures are listed beside it).

def rows(s: Story, table: str) -> pd.DataFrame:
    return s.sql(f"select * from read_parquet('data/{table}.parquet')")


def this_year_headline(s: Story) -> str:
    return f"NeurIPS 2026: {len(rows(s, 'papers_by_country_2026'))} countries, three cities"


def since_1987_headline(s: Story) -> str:
    first = int(rows(s, "papers_per_year").year.min())
    return f"Forty years of NeurIPS, since {first}"


def microsoft_headline(s: Story) -> str:
    return "Microsoft at NeurIPS, and who it writes with"


TOPIC_HEADLINES: dict[str, Callable[[Story], str]] = {
    "this-year": this_year_headline, "since-1987": since_1987_headline, "microsoft-at-neurips": microsoft_headline,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sites-dir", type=Path, help="where build.py installed the demo (default: DF_SITES_DIR)")
    parser.add_argument("--only", nargs="*", help="only these story ids")
    args = parser.parse_args()

    profile = yaml.safe_load(PROFILE.read_text(encoding="utf-8"))
    content = (args.sites_dir or sites_dir()).expanduser() / build.SITE_ID / str(profile["release"])
    stories = [(starter, story) for starter in profile["starters"] for story in starter.get("stories") or []]
    unknown = set(args.only or []) - {story["id"] for _, story in stories}
    if unknown:
        sys.exit(f"unknown stories: {', '.join(sorted(unknown))}")
    texts, failed = {}, []
    with tempfile.TemporaryDirectory(prefix="neurips-stories-") as tmp:
        for index, (starter, entry) in enumerate(stories):
            if args.only and entry["id"] not in args.only:
                continue
            chapters = entry.get("chapters") or []
            missing = [chapter["id"] for chapter in chapters if chapter["id"] not in STORY_MAKERS]
            if not chapters or missing:
                failed.append(f"{entry['id']}: no chapters, or none made by make_stories.py: {missing}")
                continue
            if not (content / starter["file"]).is_file():
                failed.append(f"{entry['id']}: {content / starter['file']} is missing; run build.py first")
                continue
            made = Story(entry, starter, content, Path(tmp))
            made_texts = []
            try:
                for number, chapter in enumerate(chapters):
                    made.begin(number)
                    made_texts.append({**STORY_MAKERS[chapter["id"]](made), "prompt": chapter["prompt"]})
            except StoryError as error:
                failed.append(f"{entry['id']} ({chapter['id']}): {error}")
                continue
            headline = TOPIC_HEADLINES[entry["id"]](made) if entry["id"] in TOPIC_HEADLINES else made_texts[0]["headline"]
            folder = write_seed(made, seed_state(made, index, made_texts, headline))
            texts[entry["id"]] = {"headline": headline, "dek": "",
                                  "chapters": {chapter["id"]: {"headline": text["headline"], "stat": text["stat"],
                                                               "message": text["message"], "file": made.lead_of(number)}
                                               for number, (chapter, text) in enumerate(zip(chapters, made_texts))}}
            size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
            print(f"{entry['id']}: {headline} ({size / 1024:.0f} KB)")
            for chapter, text in zip(chapters, made_texts):
                print(f"  {chapter['id']}: {text['headline']}  [{text['stat']} | {text['message']}]")
    set_story_text(texts)
    if failed:
        sys.exit("\n".join(failed))


if __name__ == "__main__":
    main()
