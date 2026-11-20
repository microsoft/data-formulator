# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Build the UIS demo's story seeds from the data (maintainer tool).

Each story on the UIS page opens on a seed: one question answered, as the AI analyst would answer
it on the site, with the tables it made and what it drew from them: a map (``write_map``) or a
small dashboard (``write_app``), plus a ranking chart where it helps. This script makes those
seeds from the dataset sessions build.py installs, without AI models: each story below says how
its tables are computed (Python run in the app's sandbox, so the app can refresh them), what it
draws (an app's React code is in apps/), and how its answer, headline and dek read, with every
figure taken from the computed rows.

    uv run python py-src/data_formulator/demos/unesco/build.py --only education-sdg4   # the datasets first
    uv run python py-src/data_formulator/demos/unesco/make_stories.py                   # every story
    uv run python py-src/data_formulator/demos/unesco/make_stories.py --only education-sdg4-e20

It reads the dataset sessions from ``<sites dir>/unesco/<release>/`` (``--sites-dir``, default
``DF_SITES_DIR``), rewrites ``stories/<story id>/`` (state.json, the tables' parquet files and
``files/`` with the map or app) and the story's ``headline`` and ``dek`` in profile.yaml. A
story's ``expect`` checks fail when a new release changes what its text says (for example who
ranks first); reword the story then. Redraw the covers afterwards with make_covers.py.
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
_spec = importlib.util.spec_from_file_location("unesco_build", HERE / "build.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)

# Short, common country names for charts and maps (the analyst rules ask for them).
SHORT_NAMES = {
    "Bolivia (Plurinational State of)": "Bolivia",
    "China, Hong Kong Special Administrative Region": "Hong Kong",
    "China, Macao Special Administrative Region": "Macao",
    "Democratic People's Republic of Korea": "North Korea",
    "Democratic Republic of the Congo": "DR Congo",
    "Iran (Islamic Republic of)": "Iran",
    "Lao People's Democratic Republic": "Laos",
    "Micronesia (Federated States of)": "Micronesia",
    "Republic of Korea": "South Korea",
    "Republic of Moldova": "Moldova",
    "Russian Federation": "Russia",
    "Syrian Arab Republic": "Syria",
    "United Kingdom of Great Britain and Northern Ireland": "UK",
    "United Republic of Tanzania": "Tanzania",
    "United States of America": "US",
    "Venezuela (Bolivarian Republic of)": "Venezuela",
    "Viet Nam": "Vietnam",
}
# Territories smaller than this (thousands of people, DEM indicator 200101) stay out of country rankings.
MIN_POPULATION = 100
# Values UIS flags as not applicable, suppressed or counted elsewhere.
EXCLUDED_MAGNITUDES = "('NA', 'SUPP', 'INCLUDED')"
# Session state a seed holds; the rest of a session (model settings, UI layout, messages) is not seeded.
KEEP = ("__stateVersion", "activeWorkspace", "derivedTables", "charts", "conceptShelfItems", "textTurns",
        "tableSemantics", "fileNodes", "focusedId", "canvasTabs", "canvasTabActive")
EMPTY_CHANNELS = ("color", "opacity", "column", "row")
# What the agent says before making each table: what the step is for, in its own words (never the table's
# title again, which the card right below shows).
STEP_MESSAGES = {
    'upper_secondary_completion': "I'll take each country's latest upper secondary completion rate.",
    'lowest_upper_secondary_completion': 'Then the 15 lowest, where the gap is widest.',
    'completion_by_wealth': 'Splitting completion by household wealth to see who gets left behind.',
    'primary_reading_proficiency': 'Looking at how many children read well by the end of primary school.',
    'most_primary_schools_without_electricity': "Checking which countries' primary schools most often go without power.",
    'african_schools_without_basic_services': 'Zooming in on sub-Saharan Africa, where water, toilets and power are scarcest.',
    'out_of_school_children': 'Counting children and young people out of school in each country.',
    'most_out_of_school_children': 'Then the 15 countries that account for most of them.',
    'international_students_hosted': 'Measuring how many international students each country hosts.',
    'international_students_trend': 'Following the biggest hosts since 2010 to see who is gaining.',
    'adult_illiteracy_by_sex': 'First the world picture for adults who cannot read, women and men apart.',
    'adult_illiteracy_by_region': 'Breaking it down by region to see where it concentrates.',
    'adults_who_cannot_read_by_country': 'And country by country, for the map.',
    'adult_years_of_schooling': 'Taking how many years of school adults have had on average.',
    'fewest_years_of_schooling': 'Then the 15 countries where adults have had the least.',
    'research_spending': 'Comparing how much of their economy countries put into research.',
    'most_research_spending': 'Ranking the 15 biggest research spenders.',
    'women_researchers': "Checking women's share of researchers in each country.",
    'women_at_least_half_of_researchers': 'Picking out the countries where women are at least half.',
    'research_rankings': 'Setting spending beside the number of researchers to see who leads on both.',
    'china_us_research': 'Following China and the US side by side over time.',
    'public_heritage_spending': 'Looking at what governments spend per person on heritage.',
    'most_public_heritage_spending': 'Then the 15 that spend the most.',
    'heritage_spending_by_level': 'Splitting heritage spending between national and local government.',
    'heritage_spending_nature_share': 'Seeing how much of it goes to natural rather than cultural heritage.',
    'heritage_spending_change': 'And how spending per person moved since before the pandemic.',
}
# Seeds' thread times: a fixed day (Nov 2026), so seeds only change when their content does.
EPOCH = 1794700000000


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
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


# Country names read with "the" in running text.
WITH_THE = {"Bahamas", "Central African Republic", "Comoros", "Czech Republic", "Dominican Republic", "Gambia",
            "Maldives", "Marshall Islands", "Netherlands", "Philippines", "Seychelles", "Solomon Islands", "UK",
            "United Arab Emirates", "US"}


def the(country: str, start: bool = False) -> str:
    """A country's name as it reads in a sentence: 'the UK' ('The UK' at its start)."""
    return f"{'The' if start else 'the'} {country}" if country in WITH_THE else country


def countries(items) -> str:
    return names([the(item) for item in items])


# ---------------------------------------------------------------------------------------------------
# Code for derived tables. It runs in the app's sandbox with the dataset's tables under data/, as the
# app runs it again when a visitor refreshes the table; its result is the variable `out`.
# ---------------------------------------------------------------------------------------------------

def _population_cte() -> str:
    return (f"population as (\n"
            f"        select COUNTRY_ID as country_id, value as thousands\n"
            f"        from read_parquet('data/dem_national.parquet')\n"
            f"        where indicator_id = '200101'\n"
            f"        qualify row_number() over (partition by COUNTRY_ID order by year desc) = 1\n"
            f"    )")


def _latest_cte(name: str, table: str, indicator: str, years: tuple[int, int]) -> str:
    return (f"{name} as (\n"
            f"        select COUNTRY_ID as country_id, country, year, value\n"
            f"        from read_parquet('data/{table}.parquet')\n"
            f"        where indicator_id = '{indicator}' and year between {years[0]} and {years[1]}\n"
            f"          and value is not null and coalesce(magnitude, '') not in {EXCLUDED_MAGNITUDES}\n"
            f"        qualify row_number() over (partition by COUNTRY_ID order by year desc) = 1\n"
            f"    )")


def _with_short_names(sql: str) -> str:
    return (f'import duckdb\n\nout = duckdb.sql("""\n    {sql.strip()}\n""").df()\n'
            f"out['country'] = out.country.replace({SHORT_NAMES!r})\n")


def latest_code(table: str, indicator: str, years: tuple[int, int], column: str, *, value: str = "value",
                digits: int = 1, order: str = "desc", limit: int | None = None) -> str:
    """One row per country: its latest value of ``indicator`` in ``years`` (``value`` may transform it)."""
    return _with_short_names(f"""
    with {_latest_cte('v', table, indicator, years)},
    {_population_cte()}
    select v.country_id, v.country, v.year as latest_year, round({value}, {digits}) as {column}
    from v join population using (country_id)
    where population.thousands >= {MIN_POPULATION}
    order by {column} {order}, v.country{f'''
    limit {limit}''' if limit else ''}""")


def paired_code(table: str, indicators: dict[str, str], years: tuple[int, int], extra: str, order: str,
                limit: int | None = None) -> str:
    """One row per country: two indicators from the same (latest shared) year in ``years``, as columns.

    ``indicators`` maps each column to its indicator; ``extra`` adds computed columns to the select.
    """
    (first, first_id), (second, second_id) = indicators.items()
    return _with_short_names(f"""
    with pairs as (
        select a.COUNTRY_ID as country_id, a.country, a.year, a.value as {first}, b.value as {second}
        from read_parquet('data/{table}.parquet') a
        join read_parquet('data/{table}.parquet') b using (COUNTRY_ID, year)
        where a.indicator_id = '{first_id}' and b.indicator_id = '{second_id}'
          and a.year between {years[0]} and {years[1]}
          and a.value is not null and b.value is not null
          and coalesce(a.magnitude, '') not in {EXCLUDED_MAGNITUDES}
          and coalesce(b.magnitude, '') not in {EXCLUDED_MAGNITUDES}
        qualify row_number() over (partition by a.COUNTRY_ID order by a.year desc) = 1
    ),
    {_population_cte()}
    select p.country_id, p.country, p.year as latest_year, round(p.{first}, 1) as {first},
           round(p.{second}, 1) as {second}, {extra}
    from pairs p join population using (country_id)
    where population.thousands >= {MIN_POPULATION}
    order by {order}, p.country{f'''
    limit {limit}''' if limit else ''}""")


# ---------------------------------------------------------------------------------------------------
# A story being made: its workspace (the dataset session), and the tables, charts and files it adds.
# ---------------------------------------------------------------------------------------------------

class Story:
    def __init__(self, story: dict, starter: dict, content: Path, work: Path):
        self.id = story["id"]
        self.story = story
        self.release = build.starter_release(starter["id"])
        self.workspace = WorkspaceManager(work).create_and_open_workspace(self.id, "local:site-builder")
        self.workspace.import_session_zip(io.BytesIO((content / starter["file"]).read_bytes()))
        self.sandbox = create_sandbox("local")
        self.tables: list[dict] = []
        self.charts: list[dict] = []
        self.files: list[dict] = []
        # The file the session opens on, pictured on the story's card: the last one made unless a story says otherwise.
        self.lead: str | None = None

    def source(self, *indicators: str) -> str:
        """The source line the analyst rules ask for: release and indicator code(s)."""
        return f"UIS, {self.release} release; indicator{'s' if len(indicators) > 1 else ''} {', '.join(indicators)}"

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
                            "fields": fields, "frame": frame, "sources": sources})
        return frame

    def chart(self, table_id: str, chart_type: str, encodings: dict[str, dict], title: str, subtitle: str) -> None:
        """A canvas chart of one of the story's tables (``encodings``: channel -> {field, dtype, …})."""
        self.charts.append({"table": table_id, "type": chart_type, "encodings": encodings, "title": title,
                            "subtitle": subtitle})

    def ranking(self, table_id: str, value: str, title: str, subtitle: str, *, lowest_first: bool = False) -> None:
        self.chart(table_id, "Bar Chart", {
            "x": {"field": value, "dtype": "quantitative"},
            "y": {"field": "country", "dtype": "nominal", "sortBy": "x",
                  "sortOrder": "ascending" if lowest_first else "descending"},
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
                           "media_type": "application/json", "after": result["tables"][-1]})

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
                           "media_type": "text/jsx", "after": tables[-1]})


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


def seed_state(story: Story, index: int, prompt: str, answer: str, headline: str) -> dict:
    action = f"exploreDataFromNL_{EPOCH + index * 600_000}"
    clock = iter(range(EPOCH + index * 600_000, EPOCH + (index + 1) * 600_000, 1000))
    root = f"conversation-root:{uuid.uuid5(uuid.NAMESPACE_URL, 'df-demo-unesco/' + story.id)}"
    prompt_turn = {"kind": "text", "id": f"textTurn_{action}_prompt", "displayId": f"textTurn_{action}_prompt",
                   "textKind": "explain", "content": "", "prompt": prompt, "parentNodeId": root,
                   "actionId": action, "createdAt": next(clock)}
    turns, tables, files, concepts = [prompt_turn], [], [], []
    head = prompt_turn["id"]
    started = prompt_turn["createdAt"]

    # Tables a map or app draws come last, so the thread ends on what the story opens.
    lead_name = story.lead or story.files[-1]["name"]
    # Tables a map or app draws come last, and the lead file's last of all, so the thread ends on what the story opens.
    ordered = sorted(story.tables, key=lambda table: (any(file["after"] == table["id"] for file in story.files),
                                                      any(file["after"] == table["id"] and file["name"] == lead_name
                                                          for file in story.files)))
    for step, table in enumerate(ordered, start=1):
        made = sorted((file for file in story.files if file["after"] == table["id"]), key=lambda file: file["name"] == lead_name)
        expect(table["id"] in STEP_MESSAGES, f"{table['id']} has no step message in STEP_MESSAGES")
        label = STEP_MESSAGES[table["id"]]
        progress = [{"id": f"progress-{action}-{step}-1", "kind": "tool", "label": f"Querying: {', '.join(table['sources'])}",
                     "status": "completed", "tool": "create_data"}]
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
            files.append({"kind": "file", "id": f"file-{file['name']}", "path": file["name"], "displayName": file["title"],
                          "contentHash": hashlib.sha256(file["content"]).hexdigest(), "parentNodeId": head,
                          "createdAt": next(clock)})
            head = files[-1]["id"]

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

    turns.append({"kind": "text", "id": f"textTurn_{action}_closing_turn", "displayId": f"textTurn_{action}_closing",
                  "textKind": "explain", "content": answer.strip(), "parentNodeId": head, "actionId": action,
                  "createdAt": next(clock), "startedAt": started, "answered": True})
    lead = files[-1]["path"]
    # Every map and app keeps a tab; the lead's is open.
    tabs = [{"key": f"file:{node['path']}", "target": {"type": "file", "fileName": node["path"]},
             "addedAt": EPOCH + index, "viewedAt": EPOCH + index} for index, node in enumerate(files)]
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
        "canvasTabActive": tabs[-1]["key"],
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


def _yaml_text(key: str, text: str) -> list[str]:
    """``key: "text"`` as a story field in profile.yaml, folded under 110 columns."""
    lines = textwrap.wrap(json.dumps(text, ensure_ascii=False), 110 - 8 - len(key) - 2, break_long_words=False,
                          break_on_hyphens=False)
    return [f"        {key}: {lines[0]}", *[f"          {line}" for line in lines[1:]]]


def set_story_text(texts: dict[str, dict[str, str]]) -> None:
    """Write each story's headline and dek into profile.yaml, keeping the rest of the file as it is."""
    lines = PROFILE.read_text(encoding="utf-8").split("\n")
    out, story, index = [], None, 0
    while index < len(lines):
        line = lines[index]
        if (match := re.match(r"^      - id: (\S+)$", line)):
            story = match.group(1)
        key = next((key for key in ("headline", "dek") if line.startswith(f"        {key}:")), None)
        if story in texts and key:
            out += _yaml_text(key, texts[story][key])
            index += 1
            while index < len(lines) and lines[index].startswith("          "):
                index += 1
            continue
        out.append(line)
        index += 1
    PROFILE.write_text("\n".join(out), encoding="utf-8")


# ---------------------------------------------------------------------------------------------------
# The stories. Each makes its tables and its map or app, and returns its answer, headline and dek.
# ---------------------------------------------------------------------------------------------------

# No intrinsicDomain: with one, any percentage spanning 50 would be coloured as diverging around it.
PERCENT = {"semanticType": "Percentage", "unit": "%"}
COUNTRY = {"country_id": {"semanticType": "ID", "displayName": "Country code"},
           "country": {"semanticType": "Country", "displayName": "Country"}}
LATEST = {"latest_year": {"semanticType": "Year", "displayName": "Latest year with data"}}
MAP_VIEW = {"style": "light"}
# Round colour classes for shares a map's switch compares (the map skill's comparable scales).
SHARE_CLASSES = [20, 40, 60, 80]


def on_one_scale(fields: dict, *names: str, thresholds: list[float] = SHARE_CLASSES) -> dict:
    """The fields with ``names`` given one colour scale on a map, so its switch compares them."""
    return {name: {**info, "thresholds": thresholds} if name in names else info for name, info in fields.items()}

STORY_MAKERS: dict[str, Callable[[Story], dict[str, str]]] = {}


def story(story_id: str):
    def register(make):
        STORY_MAKERS[story_id] = make
        return make
    return register


def in_region(s: Story, frame: pd.DataFrame, region: str) -> int:
    """How many of the frame's countries are in a UIS/SDG region (as region_members names it)."""
    members = set(s.sql(f"select COUNTRY_ID as country_id from read_parquet('data/region_members.parquet') "
                        f"where region = '{region}'").country_id)
    expect(bool(members), f"no region named {region!r}")
    return int(frame.country_id.isin(members).sum())


def bullets(frame: pd.DataFrame, column: str, unit: str = "%", digits: int = 1, year: bool = True,
            prefix: str = "") -> str:
    return "\n".join(f"- **{row.country}:** {prefix}{fmt(getattr(row, column), digits)}{unit}"
                     + (f" ({row.latest_year})" if year else "") for row in frame.itertuples())


def choropleth(s: Story, filename: str, title: str, subtitle: str, table: str, color: str | list[str],
               fields: dict, source: str, **properties) -> None:
    s.map(filename, title, {
        "subtitle": subtitle, "source": source, "template": "choropleth", "data": {"table": table},
        "encoding": {"region": "country_id", "color": color,
                     "tooltip": ["country", *([color] if isinstance(color, str) else color), "latest_year"]},
        "properties": {"geography": "world", "keyType": "iso3", **properties},
        "fields": fields, "view": MAP_VIEW,
    })


def bubbles(s: Story, filename: str, title: str, subtitle: str, table: str, size: str, fields: dict,
            source: str) -> None:
    s.map(filename, title, {
        "subtitle": subtitle, "source": source, "template": "bubbles", "data": {"table": table},
        "encoding": {"region": "country_id", "size": size, "tooltip": ["country", size, "latest_year"]},
        "properties": {"geography": "world", "keyType": "iso3"},
        "fields": fields, "view": MAP_VIEW,
    })


# --- Education: SDG 4 --------------------------------------------------------------------------------

@story("education-sdg4-e20")
def finishing_school(s: Story) -> dict[str, str]:
    years, indicator = (2020, 2025), "CR.MOD.3"
    fields = {**COUNTRY, **LATEST, "completion": {**PERCENT, "displayName": "Upper secondary completion"}}
    description = (f"Upper secondary completion rate (%), both sexes, each country's latest UIS modelled estimate in "
                   f"{years[0]}–{years[1]} (latest_year); territories under 100,000 people left out. "
                   f"Source: {s.source(indicator)}.")
    s.table("upper_secondary_completion", "Upper secondary completion by country", description,
                    latest_code("sdg4_national", indicator, years, "completion", order="asc"), fields)
    lowest = s.table("lowest_upper_secondary_completion", "15 countries with the lowest upper secondary completion",
                     description.replace("each country's", "the 15 lowest countries'"),
                     latest_code("sdg4_national", indicator, years, "completion", order="asc", limit=15), fields)
    subtitle = f"Share of young people who finished upper secondary school, latest modelled estimates, {years[0]}–{years[1]}"
    s.ranking("lowest_upper_secondary_completion", "completion", "Fewest finish upper secondary school",
              f"{subtitle}; {s.source(indicator)}", lowest_first=True)
    choropleth(s, "upper_secondary_completion.map.json", "Where young people finish upper secondary school", subtitle,
               "upper_secondary_completion", "completion", fields, s.source(indicator))
    african = in_region(s, lowest, "SDG: Sub-Saharan Africa")
    expect(african >= 10, f"only {african} of the 15 lowest are in sub-Saharan Africa")
    first, below = lowest.iloc[0], lowest[lowest.completion < 10]
    return {
        "headline": "Finishing upper secondary school is rarest in sub-Saharan Africa",
        "dek": (f"In {the(first.country)}, just {round(first.completion)} in 100 young people finish upper secondary school. "
                f"{countries(below.country[1:4])} are all below {int(below.completion[1:4].max()) + 1} in 100."),
        "answer": f"""
**{the(first.country, True)} has the lowest upper secondary completion rate: just {fmt(first.completion)}% ({first.latest_year}).** {african} of the 15 lowest rates are in sub-Saharan Africa:

{bullets(lowest.head(5), 'completion')}

The map shows every country's latest rate; hover a country for its figure. These are UIS modelled estimates, and blank countries have no recent estimate. Source: {s.source(indicator)}.
""",
    }


@story("education-sdg4-e21")
def rich_and_poor(s: Story) -> dict[str, str]:
    years, indicators = (2018, 2025), {"poorest": "CR.3.Q1", "richest": "CR.3.Q5"}
    fields = {**COUNTRY, **LATEST,
              "poorest": {**PERCENT, "displayName": "Completion, poorest fifth"},
              "richest": {**PERCENT, "displayName": "Completion, richest fifth"},
              "gap": {"semanticType": "Number", "unit": "percentage points", "displayName": "Rich–poor gap"}}
    source = s.source(*indicators.values())
    description = (f"Upper secondary completion rate (%) for the poorest and richest fifth of households, and the gap "
                   f"between them (percentage points), from each country's latest survey in {years[0]}–{years[1]} that "
                   f"has both (latest_year). Source: {source}.")
    every = s.table("completion_by_wealth", "Upper secondary completion, richest and poorest fifth", description,
                    paired_code("sdg4_national", indicators, years, "round(p.richest - p.poorest, 1) as gap", "gap desc"),
                    fields)
    subtitle = (f"Upper secondary completion, richest minus poorest fifth of households, percentage points; "
                f"latest survey, {years[0]}–{years[1]}")
    # The two groups' rates read on one scale; the gap, in points, keeps its own.
    choropleth(s, "completion_by_wealth.map.json", "The rich–poor gap in finishing school", subtitle,
               "completion_by_wealth", ["gap", "poorest", "richest"], on_one_scale(fields, "poorest", "richest"), source)
    # The session opens on a dashboard of the gaps; the map is beside it.
    s.app("completion_by_wealth.app.jsx", "Rich and poor in finishing school", ["completion_by_wealth"], source)
    first = every.iloc[0]
    next_four = every.iloc[1:5]
    return {
        "headline": f"In {the(first.country)}, the rich–poor gap in finishing school is widest",
        "dek": (f"In {the(first.country)}, {round(first.richest)}% of young people from the richest fifth of families finish "
                f"upper secondary school, but only {round(first.poorest)}% from the poorest: the widest gap of "
                f"{len(every)} countries. {countries(next_four.country[:2])} come next."),
        "answer": f"""
**{the(first.country, True)} has the widest gap of the {len(every)} countries with recent surveys:** {fmt(first.richest)}% of young people from the richest fifth of families finished upper secondary school, against {fmt(first.poorest)}% from the poorest fifth, a **{fmt(first.gap, 0)}-point gap** ({first.latest_year}).

{names([f"{the(row.country, i == 0)} ({fmt(row.gap, 0)} points)" for i, row in enumerate(next_four.itertuples())])} come next.

The dashboard sets the richest against the poorest for the widest gaps; the map beside it can switch between the gap and each group's rate. Each country's latest survey from {years[0]}–{years[1]}. Source: {source}.
""",
    }


@story("education-sdg4-e22")
def learning_to_read(s: Story) -> dict[str, str]:
    years, indicator = (2018, 2025), "READ.PRIMARY"
    fields = {**COUNTRY, **LATEST,
              "reading": {**PERCENT, "displayName": "Pupils reaching minimum reading proficiency"}}
    description = (f"Share of pupils (%) reaching minimum proficiency in reading by the end of primary school, both "
                   f"sexes, from each country's latest assessment in {years[0]}–{years[1]} (latest_year). "
                   f"Source: {s.source(indicator)}.")
    every = s.table("primary_reading_proficiency", "Reading proficiency at the end of primary school", description,
                    latest_code("sdg4_national", indicator, years, "reading"), fields)
    subtitle = (f"Share of pupils reaching minimum reading proficiency by the end of primary school; latest "
                f"assessment, {years[0]}–{years[1]}")
    choropleth(s, "primary_reading_proficiency.map.json", "Where children learn to read by the end of primary school",
               subtitle, "primary_reading_proficiency", "reading", fields, s.source(indicator))
    s.app("primary_reading_proficiency.app.jsx", "Learning to read by the end of primary school",
          ["primary_reading_proficiency"], s.source(indicator))
    top = every.head(5)
    expect(top.reading.iloc[0] >= 95, "no country is near 100% any more")
    half = int((every.reading < 50).sum())
    return {
        "headline": "Where nearly every pupil learns to read",
        "dek": (f"By the end of primary school, {round(top.reading.iloc[0])}% of pupils in {the(top.country.iloc[0])} reach "
                f"minimum reading proficiency. In {half} of {len(every)} countries assessed, fewer than half do."),
        "answer": f"""
**Nearly every pupil reaches minimum reading proficiency by the end of primary school in {countries(top.country[:3])}.** The highest shares:

{bullets(top, 'reading')}

At the other end, fewer than half of pupils reach it in {half} of the {len(every)} countries with a recent assessment. The dashboard shows how countries spread between the two, with the highest and lowest; the map beside it shows where they are. Each country's latest assessment from {years[0]}–{years[1]}. Source: {s.source(indicator)}.
""",
    }


@story("education-sdg4-e23")
def schools_without_power(s: Story) -> dict[str, str]:
    years = (2020, 2026)
    indicators = {"without_electricity": "SCHBSP.1.WELEC", "without_internet": "SCHBSP.1.WINTERN",
                  "without_drinking_water": "SCHBSP.1.WWATA"}
    indicator = indicators["without_electricity"]
    fields = {**COUNTRY, **LATEST,
              "without_electricity": {**PERCENT, "displayName": "Primary schools without electricity"},
              "without_internet": {**PERCENT, "displayName": "Primary schools without internet for teaching"},
              "without_drinking_water": {**PERCENT, "displayName": "Primary schools without basic drinking water"}}
    description = (f"Share of primary schools (%) without access to electricity (100 minus the share with access), "
                   f"each country's latest figure in {years[0]}–{years[1]} (latest_year). Source: {s.source(indicator)}.")
    top = s.table("most_primary_schools_without_electricity", "15 countries where most primary schools lack electricity",
                  description.replace("each country's", "the 15 highest countries'"),
                  latest_code("sdg4_national", indicator, years, "without_electricity", value="100 - v.value", limit=15),
                  fields)
    subtitle = f"Share of primary schools without electricity; latest figure, {years[0]}–{years[1]}"
    s.ranking("most_primary_schools_without_electricity", "without_electricity", "Where most primary schools have no power",
              f"{subtitle}; {s.source(indicator)}")
    # Sub-Saharan Africa, where most such schools are: the map frames the region, and switches between services.
    ctes = ",\n    ".join(_latest_cte(name, "sdg4_national", code, years) for name, code in indicators.items())
    africa = s.table("african_schools_without_basic_services", "Primary schools without basic services, sub-Saharan Africa",
                     f"Share of primary schools (%) without electricity, internet for teaching or basic drinking water, "
                     f"in sub-Saharan Africa: each figure is the country's latest in {years[0]}–{years[1]} (latest_year is "
                     f"the electricity figure's). Source: {s.source(*indicators.values())}.",
                     _with_short_names(f"""
    with {ctes},
    africa as (
        select COUNTRY_ID as country_id from read_parquet('data/region_members.parquet')
        where region = 'SDG: Sub-Saharan Africa'
    )
    select e.country_id, e.country, e.year as latest_year, round(100 - e.value) as without_electricity,
           round(100 - i.value) as without_internet, round(100 - w.value) as without_drinking_water
    from without_electricity e join africa using (country_id)
    left join without_internet i using (country_id) left join without_drinking_water w using (country_id)
    order by without_electricity desc, e.country"""), fields)
    source = s.source(*indicators.values())
    # Shares of schools going without: a red ramp, so more reads as worse.
    choropleth(s, "african_schools_without_basic_services.map.json", "Primary schools without basic services in sub-Saharan Africa",
               f"Share of primary schools without electricity, internet or drinking water; latest figures, {years[0]}–{years[1]}",
               "african_schools_without_basic_services", list(indicators), on_one_scale(fields, *indicators), source,
               scheme="reds")
    african = in_region(s, top, "SDG: Sub-Saharan Africa")
    expect(african >= 10, f"only {african} of the 15 highest are in sub-Saharan Africa")
    first, after = top.iloc[0], top.iloc[1:3]
    offline = africa.without_internet.dropna()
    return {
        "headline": f"In {the(first.country)}, {round(first.without_electricity)}% of primary schools have no power",
        "dek": (f"Schools without electricity are concentrated in sub-Saharan Africa. After {the(first.country)} come "
                f"{names([f'{the(row.country)} ({round(row.without_electricity)}%)' for row in after.itertuples()])}."),
        "answer": f"""
**Schools without power are concentrated in sub-Saharan Africa:** {african} of the 15 countries where the most primary schools lack electricity are there. Share of primary schools without electricity:

{bullets(top.head(5), 'without_electricity', digits=0)}

Internet is rarer still: in the typical country of the region, {round(offline.median())}% of primary schools have none for teaching. The map of sub-Saharan Africa switches between electricity, internet and drinking water. Latest figures from {years[0]}–{years[1]}. Source: {source}.
""",
    }

# --- Education: other policy-relevant indicators -------------------------------------------------------

@story("education-opri-o20")
def out_of_school(s: Story) -> dict[str, str]:
    years, indicator = (2020, 2026), "OFST.1T3.CP"
    fields = {**COUNTRY, **LATEST,
              "out_of_school": {"semanticType": "Count", "displayName": "Out-of-school children and young people"}}
    description = (f"Number of out-of-school children, adolescents and youth of primary and secondary school age, both "
                   f"sexes, each country's latest figure in {years[0]}–{years[1]} (latest_year). Source: {s.source(indicator)}.")
    s.table("out_of_school_children", "Out-of-school children and young people by country", description,
            latest_code("opri_national", indicator, years, "out_of_school", digits=0), fields)
    top = s.table("most_out_of_school_children", "15 countries with the most children out of school",
                  description.replace("each country's", "the 15 highest countries'"),
                  latest_code("opri_national", indicator, years, "out_of_school", digits=0, limit=15), fields)
    subtitle = f"Children and young people of primary and secondary school age out of school; latest figure, {years[0]}–{years[1]}"
    s.ranking("most_out_of_school_children", "out_of_school", "Where the most children are out of school",
              f"{subtitle}; {s.source(indicator)}")
    bubbles(s, "out_of_school_children.map.json", "Where out-of-school children and young people live", subtitle,
            "out_of_school_children", "out_of_school", fields, s.source(indicator))
    millions = [round(value / 1e6) for value in top.out_of_school[:3]]
    first = top.iloc[0]
    return {
        "headline": f"{the(first.country, True)} has the most children out of school, about {millions[0]} million",
        "dek": (f"{countries(top.country[:3])} have the most children and young people out of school, about "
                f"{millions[0]}, {millions[1]} and {millions[2]} million."),
        "answer": f"""
**{countries(top.country[:3])} have the most out-of-school children and young people:** about **{millions[0]} million**, **{millions[1]} million** and **{millions[2]} million**. The largest numbers:

{bullets(top.head(5).assign(millions=top.out_of_school / 1e6), 'millions', ' million')}

The map sizes each country's circle by its number; hover a circle for the figure. Each country's latest figure from {years[0]}–{years[1]}; primary and secondary school age, both sexes. Source: {s.source(indicator)}.
""",
    }


@story("education-opri-o21")
def students_abroad(s: Story) -> dict[str, str]:
    years, indicator = (2021, 2026), "26637"
    fields = {**COUNTRY, **LATEST,
              "international_students": {"semanticType": "Count", "displayName": "International students hosted"}}
    description = (f"Inbound internationally mobile students in higher education, both sexes, each host country's latest "
                   f"figure in {years[0]}–{years[1]} (latest_year). Source: {s.source(indicator)}.")
    s.table("international_students_hosted", "International students hosted by country", description,
            latest_code("opri_national", indicator, years, "international_students", digits=0), fields)
    subtitle = f"International students in higher education, by host country; latest figure, {years[0]}–{years[1]}"
    bubbles(s, "international_students_hosted.map.json", "Where students from abroad study", subtitle,
            "international_students_hosted", "international_students", fields, s.source(indicator))
    s.table("international_students_trend", "International students in the five largest host countries, since 2010",
            f"International students in higher education hosted each year since 2010 by the five largest hosts (by their "
            f"latest figure in {years[0]}–{years[1]}). Source: {s.source(indicator)}.",
            _with_short_names(f"""
    with v as (
        select COUNTRY_ID as country_id, country, year, value
        from read_parquet('data/opri_national.parquet')
        where indicator_id = '{indicator}' and value is not null
          and coalesce(magnitude, '') not in {EXCLUDED_MAGNITUDES}
    ),
    top as (
        select country_id, value from v where year between {years[0]} and {years[1]}
        qualify row_number() over (partition by country_id order by year desc) = 1
        order by value desc limit 5
    )
    select v.country_id, v.country, v.year, round(v.value) as international_students
    from v join top using (country_id)
    where v.year >= 2010
    order by v.country, v.year"""),
            {**COUNTRY, "year": {"semanticType": "Year", "displayName": "Year"},
             "international_students": fields["international_students"]})
    s.app("international_students.app.jsx", "The largest hosts of students from abroad",
          ["international_students_hosted", "international_students_trend"], s.source(indicator))
    top = s.sql("select * from read_parquet('data/international_students_hosted.parquet') "
                "order by international_students desc limit 5")
    first, second = top.iloc[0], top.iloc[1]
    thousands = lambda value: f"{round(value / 1000):,}"
    return {
        "headline": f"{names([the(first.country, True), the(second.country)])} host the most students from abroad",
        "dek": (f"{the(first.country, True)} hosts {thousands(first.international_students)},000 international "
                f"students ({first.latest_year}) and {the(second.country)} {thousands(second.international_students)},000 "
                f"({second.latest_year}), followed by {countries(top.country[2:5])}."),
        "answer": f"""
**{names([the(first.country, True), the(second.country)])} host the most international students:** {thousands(first.international_students)},000 and {thousands(second.international_students)},000. The largest hosts:

{bullets(top.head(5).assign(thousands=top.international_students / 1000), 'thousands', ',000', digits=0)}

These are students who crossed a border to study in higher education. The dashboard ranks the largest hosts and shows how the five largest grew since 2010; the map beside it sizes every host country by its number. Each country's latest figure from {years[0]}–{years[1]}. Source: {s.source(indicator)}.
""",
    }



SDG_REGIONS = ("Sub-Saharan Africa", "Northern Africa and Western Asia", "Central and Southern Asia",
               "Eastern and South-Eastern Asia", "Latin America and the Caribbean", "Oceania",
               "Europe and Northern America")


@story("education-opri-o22")
def adults_who_cannot_read(s: Story) -> dict[str, str]:
    indicators = ("ILLPOP.AG15T99", "ILLPOP.AG15T99.F", "ILLPOP.AG15T99.M")
    source = s.source(*indicators)
    millions = {"semanticType": "Number", "displayName": "Adults who cannot read (millions)"}
    trend = s.table("adult_illiteracy_by_sex", "Adults who cannot read, world, by sex",
                    f"Adults aged 15 and over who cannot read and write, world (UIS aggregate), women and men, by year "
                    f"since 2000. Source: {source}.",
                    textwrap.dedent(f'''\
                        import duckdb

                        out = duckdb.sql("""
                            select year, case indicator_id when '{indicators[1]}' then 'Women' else 'Men' end as sex,
                                   round(value / 1e6, 1) as millions
                            from read_parquet('data/opri_regional.parquet')
                            where region = 'UIS: World' and indicator_id in ('{indicators[1]}', '{indicators[2]}')
                              and year >= 2000 and value is not null
                            order by year, sex
                        """).df()
                    '''),
                    {"year": {"semanticType": "Year", "displayName": "Year"},
                     "sex": {"semanticType": "Category", "displayName": "Sex"}, "millions": millions})
    regions = ", ".join(f"'SDG: {region}'" for region in SDG_REGIONS)
    by_region = s.table("adult_illiteracy_by_region", "Adults who cannot read, by region",
                        f"Adults aged 15 and over who cannot read and write in each SDG region, latest year with a world "
                        f"estimate, with the share who are women. Source: {source}.",
                        textwrap.dedent(f'''\
                            import duckdb

                            out = duckdb.sql("""
                                with v as (
                                    select region, year, indicator_id, value
                                    from read_parquet('data/opri_regional.parquet')
                                    where indicator_id in ('{indicators[0]}', '{indicators[1]}')
                                      and region in ({regions})
                                )
                                select replace(t.region, 'SDG: ', '') as region, t.year, round(t.value / 1e6, 1) as millions,
                                       round(100 * f.value / t.value, 1) as women_share
                                from v t left join v f on f.region = t.region and f.year = t.year
                                  and f.indicator_id = '{indicators[1]}'
                                where t.indicator_id = '{indicators[0]}'
                                  and t.year = (select max(year) from v where indicator_id = '{indicators[0]}')
                                order by millions desc
                            """).df()
                        '''),
                        {"region": {"semanticType": "Category", "displayName": "Region"},
                         "year": {"semanticType": "Year", "displayName": "Year"}, "millions": millions,
                         "women_share": {**PERCENT, "displayName": "Women among them"}})
    s.app("adult_illiteracy.app.jsx", "Adults who cannot read", ["adult_illiteracy_by_sex", "adult_illiteracy_by_region"], source)
    country_years = (2016, 2025)
    country_fields = {**COUNTRY, **LATEST, "adults": {"semanticType": "Count", "displayName": "Adults who cannot read"}}
    s.table("adults_who_cannot_read_by_country", "Adults who cannot read, by country",
            f"Adults aged 15 and over who cannot read and write, each country's latest figure in "
            f"{country_years[0]}–{country_years[1]} (latest_year). Source: {s.source(indicators[0])}.",
            latest_code("opri_national", indicators[0], country_years, "adults", digits=0), country_fields)
    bubbles(s, "adults_who_cannot_read.map.json", "Where adults who cannot read live",
            f"Adults aged 15 and over who cannot read and write; latest figure, {country_years[0]}–{country_years[1]}",
            "adults_who_cannot_read_by_country", "adults", country_fields, s.source(indicators[0]))
    s.lead = "adult_illiteracy.app.jsx"
    latest_year = int(trend.year.max())
    first_year = int(trend.year.min())
    expect(int(by_region.year.iloc[0]) == latest_year, "the regions' year differs from the world's")
    now = trend[trend.year == latest_year].set_index("sex").millions
    then = trend[trend.year == first_year].millions.sum()
    total, women_share = now.sum(), now["Women"] / now.sum()
    top = by_region.iloc[0]
    expect(women_share > 0.5, "women are no longer the majority")
    return {
        "headline": f"{round(total)} million adults still cannot read",
        "dek": (f"In {latest_year}, {round(total)} million adults could not read and write a simple statement, "
                f"down from {round(then)} million in {first_year}. Nearly two-thirds of them were women."
                if 0.6 <= women_share < 0.67 else
                f"In {latest_year}, {round(total)} million adults could not read and write a simple statement, "
                f"down from {round(then)} million in {first_year}. {round(100 * women_share)}% of them were women."),
        "answer": f"""
**In {latest_year}, {round(total)} million adults could not read and write a simple statement**, down from {round(then)} million in {first_year}.

- **{round(100 * women_share)}%** of them are women ({round(now['Women'])} million).
- **{top.region}** has the most: {round(top.millions)} million, {round(100 * top.millions / total)}% of the world's total.

The dashboard shows the trend since {first_year} by sex, and the SDG regions with an estimate for {latest_year}; a map beside it shows the countries where they live. These are UIS estimates for adults aged 15 and over. Source: {source}.
""",
    }


@story("education-opri-o23")
def years_in_school(s: Story) -> dict[str, str]:
    years, indicator = (2020, 2026), "MYS.1T8.AG25T99"
    fields = {**COUNTRY, **LATEST,
              "years_of_schooling": {"semanticType": "Number", "unit": "years",
                                     "displayName": "Average years of schooling, adults 25+"}}
    description = (f"Mean years of schooling of adults aged 25 and over, both sexes, each country's latest figure in "
                   f"{years[0]}–{years[1]} (latest_year). Source: {s.source(indicator)}.")
    every = s.table("adult_years_of_schooling", "Adults' average years of schooling by country", description,
                    latest_code("opri_national", indicator, years, "years_of_schooling"), fields)
    lowest = s.table("fewest_years_of_schooling", "15 countries where adults have the fewest years of schooling",
                     description.replace("each country's", "the 15 lowest countries'"),
                     latest_code("opri_national", indicator, years, "years_of_schooling", order="asc", limit=15), fields)
    subtitle = f"Average years of schooling of adults aged 25 and over; latest figure, {years[0]}–{years[1]}"
    s.ranking("fewest_years_of_schooling", "years_of_schooling", "Where adults have the fewest years of schooling",
              f"{subtitle}; {s.source(indicator)}", lowest_first=True)
    choropleth(s, "adult_years_of_schooling.map.json", "How many years of school adults have", subtitle,
               "adult_years_of_schooling", "years_of_schooling", fields, s.source(indicator))
    top, bottom = every.iloc[0], lowest.iloc[0]
    by_name = every.set_index("country").years_of_schooling
    big = [name for name in ("US", "China", "India") if name in by_name]
    expect(len(big) == 3 and bottom.years_of_schooling < 2, "the comparison countries changed")
    return {
        "headline": f"From {round(top.years_of_schooling)} years of school to fewer than two",
        "dek": (f"Adults aged 25 and over average {fmt(by_name['US'])} years of schooling in the US, {fmt(by_name['China'])} "
                f"in China and {fmt(by_name['India'])} in India, but {fmt(bottom.years_of_schooling)} in {the(bottom.country)}."),
        "answer": f"""
**Adults aged 25 and over have {fmt(top.years_of_schooling)} years of schooling on average in {the(top.country)}, the most, and {fmt(bottom.years_of_schooling)} in {the(bottom.country)}, the fewest.** The US averages {fmt(by_name['US'])} years, China {fmt(by_name['China'])} and India {fmt(by_name['India'])}.

The fewest years of schooling:

{bullets(lowest.head(5), 'years_of_schooling', ' years')}

The map uses each country's latest figure from {years[0]}–{years[1]}; blank countries have none. Source: {s.source(indicator)}.
""",
    }


# --- Science: research and development -----------------------------------------------------------------

RD_SHARE = {"semanticType": "Percentage", "unit": "% of GDP", "displayName": "Research spending (% of GDP)"}
RESEARCHERS = {"semanticType": "Number", "unit": "per million people", "displayName": "Researchers per million people"}


@story("science-s20")
def research_spending(s: Story) -> dict[str, str]:
    years, indicator = (2020, 2024), "EXPGDP.TOT"
    fields = {**COUNTRY, **LATEST, "rd_share": RD_SHARE}
    description = (f"Gross domestic expenditure on research and development as a share of GDP (%), each country's latest "
                   f"figure in {years[0]}–{years[1]} (latest_year); territories under 100,000 people left out. "
                   f"Source: {s.source(indicator)}.")
    s.table("research_spending", "Research spending by country", description,
            latest_code("rd_sdg_national", indicator, years, "rd_share", digits=2), fields)
    top = s.table("most_research_spending", "15 countries spending the most on research",
                  description.replace("each country's", "the 15 highest countries'"),
                  latest_code("rd_sdg_national", indicator, years, "rd_share", digits=2, limit=15), fields)
    subtitle = f"Spending on research and development as a share of GDP; latest figure, {years[0]}–{years[1]}"
    s.ranking("most_research_spending", "rd_share", "Who spends the most on research", f"{subtitle}; {s.source(indicator)}")
    choropleth(s, "research_spending.map.json", "Research spending as a share of GDP", subtitle, "research_spending",
               "rd_share", fields, s.source(indicator))
    first, second = top.iloc[0], top.iloc[1]
    return {
        "headline": f"{the(first.country, True)} and {the(second.country)} spend the most on research",
        "dek": (f"{the(first.country, True)} spends {fmt(first.rd_share, 2)}% of its GDP on research and "
                f"{the(second.country)} {fmt(second.rd_share, 2)}%, ahead of {countries(top.country[2:5])}."),
        "answer": f"""
**{the(first.country, True)} and {the(second.country)} spend the most on research:** {fmt(first.rd_share, 2)}% and {fmt(second.rd_share, 2)}% of their GDP. The highest shares:

{bullets(top.head(5), 'rd_share', '%', digits=2)}

The map uses each country's latest figure from {years[0]}–{years[1]}; blank countries have none, and territories under 100,000 people are left out. Source: {s.source(indicator)}.
""",
    }


@story("science-s21")
def women_in_research(s: Story) -> dict[str, str]:
    years, indicator = (2019, 2024), "FRESP.THC"
    fields = {**COUNTRY, **LATEST,
              "women_share": {**PERCENT, "displayName": "Women among researchers", "divergingMidpoint": 50}}
    description = (f"Women as a share of researchers (%, headcount), each country's latest figure in "
                   f"{years[0]}–{years[1]} (latest_year). Source: {s.source(indicator)}.")
    every = s.table("women_researchers", "Women's share of researchers by country", description,
                    latest_code("rd_opri_national", indicator, years, "women_share"), fields)
    half = s.table("women_at_least_half_of_researchers", "Countries where women are at least half of researchers",
                   description.replace("each country's", "countries where it is 50% or more, each from its"),
                   latest_code("rd_opri_national", indicator, years, "women_share") + "out = out[out.women_share >= 50]\n",
                   fields)
    subtitle = f"Women as a share of researchers (headcount); latest figure, {years[0]}–{years[1]}"
    s.ranking("women_at_least_half_of_researchers", "women_share", "Where women are at least half of researchers",
              f"{subtitle}; {s.source(indicator)}")
    choropleth(s, "women_researchers.map.json", "Women's share of researchers", f"{subtitle}; parity at 50%",
               "women_researchers", "women_share", fields, s.source(indicator))
    first = half.iloc[0]
    return {
        "headline": f"Women are at least half of researchers in {len(half)} countries",
        "dek": (f"{the(first.country, True)} leads at {fmt(first.women_share)}%, then {countries(half.country[1:3])}. "
                f"Across the {len(every)} countries with recent data, the typical share is {round(every.women_share.median())}%."),
        "answer": f"""
**Women are at least half of researchers in {len(half)} of the {len(every)} countries with recent data.** The highest shares:

{bullets(half.head(5), 'women_share')}

In the typical country, {round(every.women_share.median())}% of researchers are women. The map shades countries above parity (50%) and below it in different colours. It uses each country's latest headcount from {years[0]}–{years[1]}. Source: {s.source(indicator)}.
""",
    }


RANKINGS_CODE = """\
import duckdb

out = duckdb.sql(\"\"\"
    with spending as (
        select COUNTRY_ID as country_id, country, year, value
        from read_parquet('data/rd_sdg_national.parquet')
        where indicator_id = 'EXPGDP.TOT' and year between 2020 and 2024 and value is not null
        qualify row_number() over (partition by COUNTRY_ID order by year desc) = 1
    ),
    researchers as (
        select COUNTRY_ID as country_id, country, year, value
        from read_parquet('data/rd_sdg_national.parquet')
        where indicator_id = 'RESDEN.INHAB.TFTE' and year between 2020 and 2024 and value is not null
        qualify row_number() over (partition by COUNTRY_ID order by year desc) = 1
    ),
    __POPULATION__,
    countries as (
        select coalesce(s.country_id, r.country_id) as country_id, coalesce(s.country, r.country) as country,
               s.year as spending_year, round(s.value, 2) as rd_share,
               r.year as researchers_year, round(r.value) as researchers_per_million
        from spending s full join researchers r using (country_id)
    )
    select c.*,
           case when rd_share is not null then rank() over (order by rd_share desc nulls last) end as rd_share_rank,
           case when researchers_per_million is not null
                then rank() over (order by researchers_per_million desc nulls last) end as researchers_rank
    from countries c join population using (country_id)
    where population.thousands >= __MIN__
    order by rd_share desc nulls last, researchers_per_million desc nulls last, country
\"\"\").df()
out['country'] = out.country.replace(__SHORT__)
"""



@story("science-s22")
def korea_research_rank(s: Story) -> dict[str, str]:
    source = s.source("EXPGDP.TOT", "RESDEN.INHAB.TFTE")
    code = (RANKINGS_CODE.replace("__POPULATION__", _population_cte()).replace("__MIN__", str(MIN_POPULATION))
            .replace("__SHORT__", repr(SHORT_NAMES)))
    rankings = s.table("research_rankings", "Research spending and researchers by country",
                       f"Each country's latest research spending (% of GDP) and researchers per million people (full-time "
                       f"equivalent) in 2020–2024, with its rank on each; territories under 100,000 people left out. "
                       f"Source: {source}.", code,
                       {**COUNTRY, "rd_share": RD_SHARE, "researchers_per_million": RESEARCHERS,
                        "spending_year": {"semanticType": "Year", "displayName": "Research spending year"},
                        "researchers_year": {"semanticType": "Year", "displayName": "Researchers year"},
                        "rd_share_rank": {"semanticType": "Rank", "displayName": "Rank in research spending"},
                        "researchers_rank": {"semanticType": "Rank", "displayName": "Rank in researchers"}})
    s.app("korea_research_rank.app.jsx", "South Korea's research rank", ["research_rankings"], source)
    s.map("researchers_per_million.map.json", "Researchers per million people", {
        "subtitle": "Full-time equivalent researchers per million people; latest figure, 2020–2024",
        "source": s.source("RESDEN.INHAB.TFTE"), "template": "choropleth", "data": {"table": "research_rankings"},
        "encoding": {"region": "country_id", "color": ["researchers_per_million", "rd_share"],
                     "tooltip": ["country", "researchers_per_million", "rd_share", "researchers_year"]},
        "properties": {"geography": "world", "keyType": "iso3"},
        "fields": {"researchers_per_million": RESEARCHERS, "rd_share": RD_SHARE}, "view": MAP_VIEW,
    })
    s.lead = "korea_research_rank.app.jsx"
    korea = rankings.set_index("country").loc["South Korea"]
    leader = rankings.iloc[0]
    expect(int(korea.rd_share_rank) == 2 and int(korea.researchers_rank) == 1, "South Korea's ranks changed")
    # Territories left out of the ranking for their size may still have more researchers per person.
    tiny = s.sql(f"""select country from read_parquet('data/rd_sdg_national.parquet')
                     where indicator_id = 'RESDEN.INHAB.TFTE' and year between 2020 and 2024
                       and value > {korea.researchers_per_million} order by value desc""").country.tolist()
    most = "the most of any country" + (f" except tiny {names(tiny)}" if tiny else "")
    return {
        "headline": "South Korea: second in research spending, first in researchers",
        "dek": (f"South Korea spends {fmt(korea.rd_share, 2)}% of its GDP on research, behind only {the(leader.country)}, "
                f"and has {fmt(korea.researchers_per_million, 0)} researchers per million people, {most}."),
        "answer": f"""
**South Korea ranks second in research spending and first in researchers.**

- **Research spending:** {fmt(korea.rd_share, 2)}% of GDP ({int(korea.spending_year)}), behind only {the(leader.country)} ({fmt(leader.rd_share, 2)}%).
- **Researchers:** {fmt(korea.researchers_per_million, 0)} per million people ({int(korea.researchers_year)}), the most of {int(rankings.researchers_per_million.notna().sum())} countries.

The dashboard shows both top-10 rankings with South Korea highlighted; a world map beside it shows researchers per million people everywhere. Each country's latest figure from 2020–2024; territories under 100,000 people left out. Source: {source}.
""",
    }


CHINA_US_CODE = """\
import duckdb

out = duckdb.sql(\"\"\"
    select case COUNTRY_ID when 'CHN' then 'China' else 'US' end as country, year,
           round(max(value) filter (where indicator_id = 'EXPGDP.TOT'), 2) as rd_share,
           round(max(value) filter (where indicator_id = 'RESDEN.INHAB.TFTE')) as researchers_per_million
    from read_parquet('data/rd_sdg_national.parquet')
    where COUNTRY_ID in ('CHN', 'USA') and indicator_id in ('EXPGDP.TOT', 'RESDEN.INHAB.TFTE') and year >= 2000
    group by all
    order by country, year
\"\"\").df()
"""



@story("science-s23")
def china_and_us(s: Story) -> dict[str, str]:
    source = s.source("EXPGDP.TOT", "RESDEN.INHAB.TFTE")
    series = s.table("china_us_research", "China and US research spending and researchers",
                     f"Research spending (% of GDP) and researchers per million people (full-time equivalent), China and "
                     f"the US, by year since 2000. Source: {source}.", CHINA_US_CODE,
                     {"country": {"semanticType": "Country", "displayName": "Country"},
                      "year": {"semanticType": "Year", "displayName": "Year"},
                      "rd_share": RD_SHARE, "researchers_per_million": RESEARCHERS})
    s.app("china_us_research.app.jsx", "China and the US in research", ["china_us_research"], source)
    spend = series.dropna(subset=["rd_share"]).pivot(index="year", columns="country", values="rd_share").dropna()
    last, first = spend.index.max(), spend.index.min()
    then = spend.loc[first, "China"] / spend.loc[first, "US"]
    now = spend.loc[last, "China"] / spend.loc[last, "US"]
    expect(now > then and now < 1, "China is no longer catching up from below")
    fraction = {2: "half", 3: "a third", 4: "a quarter", 5: "a fifth"}.get(round(1 / then), f"{round(100 * then)}%")
    return {
        "headline": "China is catching up with the US in research",
        "dek": (f"China spent {fmt(spend.loc[last, 'China'], 2)}% of its GDP on research in {last}, against "
                f"{fmt(spend.loc[last, 'US'], 2)}% in the US. In {first} its share was only {fraction} of the US level."),
        "answer": f"""
**China is catching up with the US in research spending.** In {last}, China spent **{fmt(spend.loc[last, 'China'], 2)}%** of its GDP on research and the US **{fmt(spend.loc[last, 'US'], 2)}%**: China's share is {round(100 * now)}% of the US level, up from {round(100 * then)}% in {first}.

The dashboard also compares researchers per million people, where the US is still well ahead. Source: {source}.
""",
    }


# --- Culture: heritage spending ------------------------------------------------------------------------

PER_PERSON = {"semanticType": "Price", "unit": "PPP$ per person"}


@story("culture-c20")
def heritage_spending(s: Story) -> dict[str, str]:
    years, indicator = (2020, 2024), "HEXPCSTPPPCAP.HER.PU"
    fields = {**COUNTRY, **LATEST,
              "per_person": {**PER_PERSON, "displayName": "Public heritage spending per person"}}
    description = (f"Public spending on cultural and natural heritage per person, in constant 2017 purchasing-power "
                   f"dollars (PPP$), each country's latest figure in {years[0]}–{years[1]} (latest_year); territories "
                   f"under 100,000 people left out. Source: {s.source(indicator)}.")
    every = s.table("public_heritage_spending", "Public heritage spending per person by country", description,
                    latest_code("sdg11_national", indicator, years, "per_person", digits=2), fields)
    top = s.table("most_public_heritage_spending", "15 countries spending the most on heritage per person",
                  description.replace("each country's", "the 15 highest countries'"),
                  latest_code("sdg11_national", indicator, years, "per_person", digits=2, limit=15), fields)
    subtitle = (f"Government spending on cultural and natural heritage per person, constant 2017 purchasing-power "
                f"dollars; latest figure, {years[0]}–{years[1]}")
    s.ranking("most_public_heritage_spending", "per_person", "Who spends the most on heritage",
              f"{subtitle}; {s.source(indicator)}")
    choropleth(s, "public_heritage_spending.map.json", "What governments spend on heritage", subtitle,
               "public_heritage_spending", "per_person", fields, s.source(indicator))
    first, median = top.iloc[0], every.per_person.median()
    under_one = int((every.per_person < 1).sum())
    return {
        "headline": "From pennies to hundreds: what governments spend on heritage",
        "dek": (f"Among {len(every)} reporting countries, the typical government spends about ${round(median)} a person on "
                f"cultural and natural heritage. {the(first.country, True)} spends ${round(first.per_person)}; "
                f"{under_one} countries spend under $1."),
        "answer": f"""
**Governments spend very different amounts on heritage: about ${round(median)} a person in the typical country of the {len(every)} that report.** The highest:

{bullets(top.head(5), 'per_person', ' a person', digits=0, prefix='$')}

At the other end, {under_one} countries spend under $1 a person. Figures are public spending on cultural and natural heritage in constant 2017 purchasing-power dollars, each country's latest from {years[0]}–{years[1]}. Source: {s.source(indicator)}.
""",
    }




@story("culture-c21")
def who_pays(s: Story) -> dict[str, str]:
    years = (2020, 2024)
    indicators = {"national": "HEXPCSTPPPCAPGOV.NTL.HER.PU", "local": "HEXPCSTPPPCAPGOV.LOC.HER.PU"}
    source = s.source(*indicators.values())
    levels = s.table("heritage_spending_by_level", "National and local heritage spending by country",
                     f"Public spending on cultural and natural heritage per person by national and by local "
                     f"governments (constant 2017 PPP$), from each country's latest year in {years[0]}–{years[1]} with "
                     f"both (latest_year), and the local share of the two (%). Source: {source}.",
                     paired_code("sdg11_national", indicators, years,
                                 "round(100 * p.local / (p.local + p.national), 1) as local_share", "local_share desc"),
                     {**COUNTRY, **LATEST,
                      "national": {**PER_PERSON, "displayName": "National government spending per person"},
                      "local": {**PER_PERSON, "displayName": "Local government spending per person"},
                      "local_share": {**PERCENT, "displayName": "Local share"}})
    s.app("heritage_spending_by_level.app.jsx", "Who pays for heritage", ["heritage_spending_by_level"], source)
    national = int((levels.national > levels.local).sum())
    top = levels.iloc[0]
    expect(national > len(levels) / 2, "national governments no longer outspend local ones in most countries")
    return {
        "headline": "Who pays for heritage? Mostly national governments",
        "dek": (f"In {national} of {len(levels)} reporting countries, national governments outspend local ones. In "
                f"{the(top.country)}, towns and cities supply {round(top.local_share)}%."),
        "answer": f"""
**National governments pay more for heritage than local ones in {national} of the {len(levels)} countries that report both.**

Local governments spend more in {len(levels) - national} countries, most of all in {the(top.country)}, where towns and cities supply **{round(top.local_share)}%** of national and local heritage spending.

The dashboard ranks every country by the local share. Each country's latest year from {years[0]}–{years[1]} with both figures; regional governments are left out. Source: {source}.
""",
    }


@story("culture-c22")
def monuments_or_nature(s: Story) -> dict[str, str]:
    years = (2020, 2024)
    indicators = {"cultural": "HEXPCSTPPPCAP.CULHER", "natural": "HEXPCSTPPPCAP.NATHER"}
    source = s.source(*indicators.values())
    fields = {**COUNTRY, **LATEST,
              "cultural": {**PER_PERSON, "displayName": "Spending on cultural heritage per person"},
              "natural": {**PER_PERSON, "displayName": "Spending on natural heritage per person"},
              "nature_share": {**PERCENT, "displayName": "Nature's share of heritage spending", "divergingMidpoint": 50}}
    shares = s.table("heritage_spending_nature_share", "Nature's share of heritage spending by country",
                     f"Public and private spending on cultural and on natural heritage per person (constant 2017 PPP$), "
                     f"from each country's latest year in {years[0]}–{years[1]} with both (latest_year), and nature's "
                     f"share of the two (%). Source: {source}.",
                     paired_code("sdg11_national", indicators, years,
                                 "round(100 * p.natural / (p.natural + p.cultural), 1) as nature_share",
                                 "nature_share desc"), fields)
    subtitle = (f"Natural heritage's share of spending on cultural and natural heritage, public and private; latest "
                f"year with both, {years[0]}–{years[1]}")
    s.ranking("heritage_spending_nature_share", "nature_share", "Nature's share of heritage spending",
              f"{subtitle}; {source}")
    choropleth(s, "heritage_spending_nature_share.map.json", "Monuments or nature: where heritage money goes",
               f"{subtitle}; more on nature above 50%", "heritage_spending_nature_share", "nature_share", fields, source)
    nature = shares[shares.nature_share > 50]
    expect(0 < len(nature) <= 6, f"{len(nature)} countries now spend more on nature")
    words = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}
    first = nature.iloc[0]
    return {
        "headline": f"Only {words[len(nature)]} countries spend more on nature than on monuments",
        "dek": (f"{the(first.country, True)} puts {round(first.nature_share)}% of its heritage spending into nature, "
                f"followed by {countries(nature.country[1:])}. The other {len(shares) - len(nature)} reporting countries "
                f"spend more on cultural heritage."),
        "answer": f"""
**Only {words[len(nature)]} of the {len(shares)} reporting countries spend more on natural heritage than on cultural heritage:**

{bullets(nature, 'nature_share')}

The other {len(shares) - len(nature)} spend more on cultural heritage such as monuments, museums and historic sites. The map shades countries by nature's share, from mostly culture to mostly nature. Public and private spending, each country's latest year from {years[0]}–{years[1]} with both figures. Source: {source}.
""",
    }


CHANGE_CODE = """\
import duckdb

out = duckdb.sql(\"\"\"
    with spending as (
        select COUNTRY_ID as country_id, country, year, value
        from read_parquet('data/sdg11_national.parquet')
        where indicator_id = 'HEXPCSTPPPCAP.HER.PU' and value is not null
          and coalesce(magnitude, '') not in __EXCLUDED__
    ),
    before as (
        select * from spending where year between 2017 and 2019
        qualify row_number() over (partition by country_id order by year desc) = 1
    ),
    since as (
        select * from spending where year between 2022 and 2024
        qualify row_number() over (partition by country_id order by year desc) = 1
    ),
    __POPULATION__
    select b.country_id, s.country, b.year as before_year, round(b.value, 1) as before_pandemic,
           s.year as latest_year, round(s.value, 1) as latest, round(s.value - b.value, 1) as change
    from before b join since s using (country_id) join population using (country_id)
    where population.thousands >= __MIN__
    order by change desc, s.country
\"\"\").df()
out['country'] = out.country.replace(__SHORT__)
"""



@story("culture-c23")
def after_the_pandemic(s: Story) -> dict[str, str]:
    indicator = "HEXPCSTPPPCAP.HER.PU"
    source = s.source(indicator)
    code = (CHANGE_CODE.replace("__EXCLUDED__", EXCLUDED_MAGNITUDES).replace("__POPULATION__", _population_cte())
            .replace("__MIN__", str(MIN_POPULATION)).replace("__SHORT__", repr(SHORT_NAMES)))
    change = s.table("heritage_spending_change", "Change in heritage spending per person since before the pandemic",
                     f"Public spending on cultural and natural heritage per person (constant 2017 PPP$): each country's "
                     f"latest figure in 2017–2019 (before_year) and in 2022–2024 (latest_year), and the change. "
                     f"Source: {source}.", code,
                     {**COUNTRY,
                      "before_year": {"semanticType": "Year", "displayName": "Year before the pandemic"},
                      "before_pandemic": {**PER_PERSON, "displayName": "Before the pandemic"},
                      "latest_year": {"semanticType": "Year", "displayName": "Latest year"},
                      "latest": {**PER_PERSON, "displayName": "Latest"},
                      "change": {"semanticType": "Price", "unit": "PPP$ per person",
                                 "displayName": "Change per person"}})
    s.app("heritage_spending_change.app.jsx", "Heritage spending since the pandemic", ["heritage_spending_change"], source)
    choropleth(s, "heritage_spending_change.map.json", "Where heritage spending rose and fell",
               "Change in public heritage spending per person, latest (2022–2024) against before the pandemic (2017–2019), "
               "constant 2017 PPP$", "heritage_spending_change", "change",
               {"change": {"semanticType": "Price", "unit": "PPP$ per person", "displayName": "Change per person",
                           "divergingMidpoint": 0}, **LATEST}, source)
    s.lead = "heritage_spending_change.app.jsx"
    up = change[change.change > 0]
    first, second = change.iloc[0], change.iloc[1]
    return {
        "headline": f"{the(first.country, True)} added the most heritage spending since the pandemic",
        "dek": (f"{the(first.country, True)} spends ${round(first.change)} more per person on heritage than before COVID-19 "
                f"and {the(second.country)} ${round(second.change)} more, followed by {countries(change.country[2:5])}."),
        "answer": f"""
**{the(first.country, True)} added the most: ${round(first.change)} more per person on heritage than before the pandemic** (${fmt(first.before_pandemic, 0)} in {first.before_year}, ${fmt(first.latest, 0)} in {first.latest_year}). The biggest increases:

{bullets(change.head(5), 'change', ' a person', digits=0, year=False, prefix='+$')}

Of the {len(change)} countries with figures for both periods, {len(up)} spend more than before the pandemic; a map beside the dashboard shows where spending rose and fell. Public spending per person in constant 2017 purchasing-power dollars. Source: {source}.
""",
    }



def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sites-dir", type=Path, help="where build.py installed the demo (default: DF_SITES_DIR)")
    parser.add_argument("--only", nargs="*", help="only these story ids")
    args = parser.parse_args()

    profile = yaml.safe_load(PROFILE.read_text(encoding="utf-8"))
    content = (args.sites_dir or sites_dir()).expanduser() / "unesco" / str(profile["release"])
    stories = [(starter, story) for starter in profile["starters"] for story in starter.get("stories") or []]
    unknown = set(args.only or []) - {story["id"] for _, story in stories}
    if unknown:
        sys.exit(f"unknown stories: {', '.join(sorted(unknown))}")
    texts, failed = {}, []
    with tempfile.TemporaryDirectory(prefix="uis-stories-") as tmp:
        for index, (starter, entry) in enumerate(stories):
            if args.only and entry["id"] not in args.only:
                continue
            if entry["id"] not in STORY_MAKERS:
                failed.append(f"{entry['id']}: no story in make_stories.py")
                continue
            if not (content / starter["file"]).is_file():
                failed.append(f"{entry['id']}: {content / starter['file']} is missing; run build.py first")
                continue
            made = Story(entry, starter, content, Path(tmp))
            try:
                text = STORY_MAKERS[entry["id"]](made)
            except StoryError as error:
                failed.append(f"{entry['id']}: {error}")
                continue
            folder = write_seed(made, seed_state(made, index, entry["prompt"], text["answer"], text["headline"]))
            texts[entry["id"]] = text
            size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
            artifacts = " + ".join([file["name"] for file in made.files] + [chart["type"] for chart in made.charts])
            print(f"{entry['id']}: {text['headline']} -> {artifacts} ({size / 1024:.0f} KB)")
    set_story_text(texts)
    if failed:
        sys.exit("\n".join(failed))


if __name__ == "__main__":
    main()
