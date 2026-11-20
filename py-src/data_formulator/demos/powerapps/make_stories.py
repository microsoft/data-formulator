# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Build the Power Apps demo's story seeds from the data (maintainer tool).

Each story on the Power Apps page opens on a seed: a short thread of questions a sales team would ask of
its Dataverse data, answered as the AI analyst answers them on the site, with the tables it made and what
it drew from them: charts, a map (``write_map``) and a small app (``write_app``). This script makes those
seeds from the dataset session build.py installs, without AI models: each chapter below says how its
tables are computed (Python run in the app's sandbox, so the app can refresh them), what it draws (an
app's React code is in apps/), and how its answer, headline and key figure read, with every figure taken
from the computed rows.

    uv run python py-src/data_formulator/demos/powerapps/build.py --sites-dir /tmp/powerapps-sites   # the dataset first
    uv run python py-src/data_formulator/demos/powerapps/make_stories.py --sites-dir /tmp/powerapps-sites
    uv run python py-src/data_formulator/demos/powerapps/make_stories.py --sites-dir /tmp/powerapps-sites --only winning

It reads the dataset session from ``<sites dir>/powerapps/<release>/``, rewrites ``stories/<story id>/``
(state.json, the tables' parquet files and ``files/`` with the maps and apps) and each story's
``headline`` and its chapters' ``headline``, ``stat``, ``message`` and ``file`` in profile.yaml. A
chapter's ``expect`` checks fail when new data changes what its text says; reword the chapter then.
Redraw the covers afterwards with make_covers.py.
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
_spec = importlib.util.spec_from_file_location("powerapps_build", HERE / "build.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)

EMPTY_CHANNELS = ("color", "opacity", "column", "row")
# What the agent says before making each table: what the step is for, in its own words (never the table's
# title again, which the card right below shows).
STEP_MESSAGES = {
    "open_pipeline_by_stage": "I'll add up the open opportunities by sales stage, with each one's weighted value.",
    "region_results": "Joining each opportunity to its account's sales region, to compare won revenue and win rates.",
    "account_map": "Placing every account at its address, sized by its open pipeline.",
    "deals_to_chase": "Ranking the open deals by weighted value: estimated value times probability.",
    "open_deals": "Gathering every open deal with its account's region and location for the app.",
    "win_rate_by_quarter": "Counting won and lost deals by the quarter they closed in.",
    "win_rate_by_product": "Comparing win rates and won deal sizes across product lines.",
    "win_rate_by_source": "Comparing how often deals from each lead source are won.",
    "account_wins": "Working out each account's win rate, where it has closed at least three deals.",
    "forecast_by_month": "Spreading the open pipeline over the months the deals are expected to close.",
    "forecast_deals": "Listing the open deals behind the forecast, with their expected close dates.",
}
# Seeds' thread times: a fixed day (Nov 2026), so seeds only change when their content does.
EPOCH = 1795000000000
SEED_NAMESPACE = "df-demo-powerapps/"
SOURCE = "Dataverse (Power Apps)"


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


def money(value: float) -> str:
    """Dollars as the answers write them: $12.3M, $450K."""
    if abs(value) >= 1e6:
        return f"${fmt(value / 1e6, 1)}M"
    if abs(value) >= 1e3:
        return f"${fmt(value / 1e3, 0)}K"
    return f"${fmt(value, 0)}"


def pct(value: float) -> str:
    return f"{fmt(value, 0)}%"


def quarter_name(value) -> str:
    """2025-04-01 -> '2025 Q2'."""
    day = pd.Timestamp(value)
    return f"{day.year} Q{day.quarter}"


# ---------------------------------------------------------------------------------------------------
# Code for derived tables. It runs in the app's sandbox with the dataset's tables under data/, as the
# app runs it again when a visitor refreshes the table; its result is the variable `out`.
# ---------------------------------------------------------------------------------------------------

# Every opportunity with its account, in plain column names.
DEALS = """deals as (
        select o.cr746_name as deal, o.cr746_accountidname as account, a.cr746_salesregionname as region,
               a.industrycodename as industry, a.address1_city as city, a.address1_country as country,
               a.address1_latitude as lat, a.address1_longitude as lon,
               o.cr746_estimatedvalue as value, o.cr746_probability as probability,
               o.cr746_outcomename as outcome, o.cr746_salesstagename as stage,
               o.cr746_productlinename as product_line, o.cr746_leadsourcename as lead_source,
               o.cr746_estimatedclosedate as estimated_close, o.cr746_actualclosedate as actual_close
        from read_parquet('data/cr746_opportunity.parquet') o
        left join read_parquet('data/account.parquet') a on a.accountid = o.cr746_accountid
    )"""


def duck(sql: str, after: str = "") -> str:
    """Python for a derived table: one DuckDB query over the dataset's tables (plus ``after`` lines)."""
    return f'import duckdb\n\nout = duckdb.sql("""\n    {textwrap.dedent(sql).strip()}\n""").df()\n{after}'


def win_rate(won: str = "won", lost: str = "lost") -> str:
    return f"round(100.0 * {won} / nullif({won} + {lost}, 0), 1)"


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

    def begin(self, chapter: int) -> None:
        self.chapter = chapter

    def lead_of(self, chapter: int) -> str | None:
        """What a chapter opens on: its last map or app, else its last chart's table (None: the first table)."""
        files = [file for file in self.files if file["chapter"] == chapter]
        return files[-1]["name"] if files else None

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

    def app(self, filename: str, title: str, tables: list[str]) -> None:
        """An app from its template in apps/ (``__SOURCE__`` is its source line), checked as ``write_app`` checks it."""
        code = (APPS / filename).read_text(encoding="utf-8").replace("__SOURCE__", SOURCE)
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
# The seed: the story's session state (a thread of questions), its tables' parquet files, its files.
# ---------------------------------------------------------------------------------------------------

def _column_type(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_numeric_dtype(series):
        return "number"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
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


def _chart_id(story: Story, spec: dict) -> str:
    return f"chart-{_stable(story.id, spec['table'], spec['title'])[:12]}"


def seed_state(story: Story, index: int, chapters: list[dict], headline: str) -> dict:
    """The session: one thread asking each chapter's question in turn (``chapters``: prompt, answer), each answered
    with its tables, charts and files; it opens on the last chapter's app."""
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
        for step, table in enumerate(own_tables, start=1):
            made = [file for file in own_files if file["after"] == table["id"]]
            expect(table["id"] in STEP_MESSAGES, f"{table['id']} has no step message in STEP_MESSAGES")
            charted = [spec for spec in story.charts if spec["table"] == table["id"]]
            progress = [{"id": f"progress-{action}-{step}-1", "kind": "tool", "status": "completed", "tool": "create_data",
                         "label": f"Querying: {', '.join(table['sources'])}"}]
            progress += [{"id": f"progress-{action}-{step}-c{n}", "kind": "info", "status": "completed",
                          "label": f"Chart created: {spec['title']}"} for n, spec in enumerate(charted, start=1)]
            progress += [{"id": f"progress-{action}-{step}-{n}", "kind": "info", "status": "completed",
                          "label": f"{'Map' if file['name'].endswith('.map.json') else 'App'} created: {file['title']}"}
                         for n, file in enumerate(made, start=2)]
            turn = {"kind": "text", "id": f"textTurn_{action}_step_{step}", "displayId": f"textTurn_{action}_step_{step}",
                    "textKind": "explain", "content": STEP_MESSAGES[table["id"]], "parentNodeId": head,
                    "actionId": action, "createdAt": next(clock), "startedAt": started, "progressSteps": progress}
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
            "id": _chart_id(story, spec),
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

    # The session opens on its last chapter's app: what the story builds up to.
    lead = story.lead_of(len(chapters) - 1)
    expect(lead is not None, "the last chapter makes no map or app to open on")
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


def chapter_file(story: Story, number: int) -> str:
    """The map or app a chapter makes, or '' for a chapter answered with a chart."""
    return story.lead_of(number) or ""


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
    return [f"{' ' * indent}{key}: {lines[0] if lines else chr(34) * 2}", *[f"{' ' * (indent + 2)}{line}" for line in lines[1:]]]


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
# The chapters. Each makes its tables and charts, map or app, and returns its answer and headline, and its key
# figure for the session's card: a short `stat` ("$12.3M") and the `message` it goes with.
# ---------------------------------------------------------------------------------------------------

MONEY = {"semanticType": "Amount", "unit": "USD"}
PERCENT = {"semanticType": "Percentage", "unit": "%"}
COUNT = {"semanticType": "Count"}
STAGE_ORDER = "case stage when 'Qualify' then 1 when 'Develop' then 2 when 'Propose' then 3 else 4 end"
PLACE = {
    "account": {"semanticType": "Name", "displayName": "Account"},
    "city": {"semanticType": "City", "displayName": "City"},
    "country": {"semanticType": "Country", "displayName": "Country"},
    "region": {"semanticType": "Category", "displayName": "Sales region"},
    "lat": {"semanticType": "Latitude", "displayName": "Latitude"},
    "lon": {"semanticType": "Longitude", "displayName": "Longitude"},
}
DEAL = {
    "deal": {"semanticType": "Name", "displayName": "Opportunity"},
    "stage": {"semanticType": "Category", "displayName": "Sales stage"},
    "product_line": {"semanticType": "Category", "displayName": "Product line"},
    "value": {**MONEY, "displayName": "Estimated value"},
    "probability": {**PERCENT, "displayName": "Probability"},
    "weighted": {**MONEY, "displayName": "Weighted value"},
    "estimated_close": {"semanticType": "Date", "displayName": "Estimated close"},
}
MAP_VIEW = {"style": "light"}

CHAPTER_MAKERS: dict[str, Callable[[Story], dict[str, str]]] = {}


def chapter(chapter_id: str):
    def register(make):
        CHAPTER_MAKERS[chapter_id] = make
        return make
    return register


# --- Where is our pipeline? ----------------------------------------------------------------------------

@chapter("p1")
def open_pipeline(s: Story) -> dict[str, str]:
    stages = s.table("open_pipeline_by_stage", "Open pipeline by sales stage",
                     "Open opportunities by sales stage (Qualify, Develop, Propose, Close): how many, their estimated "
                     f"value and their weighted value (estimated value times probability). Source: {SOURCE}.",
                     duck(f"""
                         with {DEALS}
                         select stage, count(*) as deals, sum(value) as pipeline,
                                round(sum(value * probability / 100.0)) as weighted
                         from deals where outcome = 'Open'
                         group by stage order by {STAGE_ORDER}"""),
                     {"stage": DEAL["stage"], "deals": {**COUNT, "displayName": "Open deals"},
                      "pipeline": {**MONEY, "displayName": "Open pipeline"},
                      "weighted": {**MONEY, "displayName": "Weighted pipeline"}})
    s.ranking("open_pipeline_by_stage", "stage", "pipeline", "Open pipeline by sales stage",
              f"Estimated value of open opportunities, USD; {SOURCE}")
    total, deals, weighted = stages.pipeline.sum(), int(stages.deals.sum()), stages.weighted.sum()
    top = stages.sort_values("pipeline", ascending=False).iloc[0]
    expect(top.stage == "Qualify", f"the biggest stage is {top.stage}")
    return {
        "headline": f"{money(total)} of open pipeline across {deals} deals, {pct(100 * top.pipeline / total)} of it still in Qualify",
        "stat": money(total), "message": f"open pipeline across {deals} deals",
        "answer": f"""
**We have {money(total)} of open pipeline across {deals} deals ({money(weighted)} weighted by probability).** {money(top.pipeline)} of it ({pct(100 * top.pipeline / total)}) is still in Qualify, the earliest stage, the biggest share; {money(stages[stages.stage == 'Close'].pipeline.sum())} is in Close.
""",
    }


@chapter("p2")
def regions(s: Story) -> dict[str, str]:
    table = s.table("region_results", "Won revenue, open pipeline and win rate by sales region",
                    "Each sales region's won revenue (estimated value of won opportunities), open pipeline, and win "
                    f"rate (won / (won + lost) opportunities), by the account's sales region. Source: {SOURCE}.",
                    duck(f"""
                        with {DEALS},
                        regions as (
                            select region,
                                   sum(value) filter (where outcome = 'Won') as won_revenue,
                                   sum(value) filter (where outcome = 'Open') as open_pipeline,
                                   count(*) filter (where outcome = 'Won') as won,
                                   count(*) filter (where outcome = 'Lost') as lost
                            from deals where region is not null group by region
                        )
                        select region, won_revenue, open_pipeline, {win_rate()} as win_rate
                        from regions order by won_revenue desc"""),
                    {"region": PLACE["region"], "won_revenue": {**MONEY, "displayName": "Won revenue"},
                     "open_pipeline": {**MONEY, "displayName": "Open pipeline"},
                     "win_rate": {**PERCENT, "displayName": "Win rate"}})
    s.ranking("region_results", "region", "won_revenue", "Won revenue by sales region",
              f"Estimated value of won opportunities, USD; {SOURCE}")
    first, last = table.iloc[0], table.sort_values("win_rate").iloc[0]
    expect(first.region == "Europe", f"the top region is {first.region}")
    return {
        "headline": f"{first.region} brings in the most: {money(first.won_revenue)} won, at a {pct(first.win_rate)} win rate",
        "stat": money(first.won_revenue), "message": f"won in {first.region}, the top region",
        "answer": f"""
**{first.region} has won the most, {money(first.won_revenue)}, and wins {pct(first.win_rate)} of its closed deals.** {last.region} wins least often ({pct(last.win_rate)}). Win rate is won deals divided by won and lost ones.
""",
    }


@chapter("p3")
def accounts_on_a_map(s: Story) -> dict[str, str]:
    places = s.table("account_map", "Accounts with their open pipeline and won revenue",
                     "Every account with a known address: where it is, its sales region and industry, its open pipeline "
                     f"and won revenue, and how many opportunities it has. Source: {SOURCE}.",
                     duck(f"""
                         with {DEALS}
                         select account, any_value(city) as city, any_value(country) as country,
                                any_value(region) as region, any_value(industry) as industry,
                                any_value(lat) as lat, any_value(lon) as lon,
                                coalesce(sum(value) filter (where outcome = 'Open'), 0) as open_pipeline,
                                coalesce(sum(value) filter (where outcome = 'Won'), 0) as won_revenue,
                                count(*) as deals
                         from deals where lat is not null
                         group by account order by open_pipeline desc"""),
                     {**PLACE, "industry": {"semanticType": "Category", "displayName": "Industry"},
                      "open_pipeline": {**MONEY, "displayName": "Open pipeline"},
                      "won_revenue": {**MONEY, "displayName": "Won revenue"},
                      "deals": {**COUNT, "displayName": "Opportunities"}})
    s.map("accounts.map.json", "Where our accounts are", {
        "subtitle": "Each account at its address, sized by its open pipeline (USD), coloured by sales region",
        "source": SOURCE, "template": "bubbles", "data": {"table": "account_map"},
        "encoding": {"lat": "lat", "lon": "lon", "size": "open_pipeline", "color": "region", "label": "account",
                     "tooltip": ["account", "city", "country", "open_pipeline", "won_revenue"]},
        "properties": {"geography": "world"}, "fields": s.tables[-1]["fields"], "view": MAP_VIEW,
    })
    top = places.iloc[0]
    countries = places.country.nunique()
    expect(countries >= 10, f"only {countries} countries")
    return {
        "headline": f"Accounts in {countries} countries; {top.account} holds the most open pipeline",
        "stat": str(countries), "message": "countries with our accounts",
        "answer": f"""
**Our {len(places)} accounts are in {countries} countries; {top.account} ({top.city}) has the most open pipeline, {money(top.open_pipeline)}.** Bubbles are sized by open pipeline and coloured by sales region; hover one for its won revenue.
""",
    }


@chapter("p4")
def deals_to_chase(s: Story) -> dict[str, str]:
    deals = s.table("deals_to_chase", "The 15 open deals with the highest weighted value",
                    "Open opportunities ranked by weighted value (estimated value times probability), with their "
                    f"account, region, sales stage, product line and estimated close date. Source: {SOURCE}.",
                    duck(f"""
                        with {DEALS}
                        select deal, account, region, stage, product_line, value, probability,
                               round(value * probability / 100.0) as weighted, estimated_close
                        from deals where outcome = 'Open'
                        order by weighted desc, deal limit 15"""),
                    {**DEAL, "account": PLACE["account"], "region": PLACE["region"]})
    s.ranking("deals_to_chase", "deal", "weighted", "Open deals to chase first",
              f"Weighted value (estimated value × probability), USD, top 15; {SOURCE}")
    expect(deals.deal.is_unique, "deal names repeat in the top 15")
    top = deals.iloc[0]
    return {
        "headline": f"15 deals hold {money(deals.weighted.sum())} of weighted pipeline; the biggest is {top.deal}",
        "stat": money(deals.weighted.sum()), "message": "weighted in the top 15 open deals",
        "answer": f"""
**Chase {top.deal} at {top.account} first: {money(top.value)} at {pct(top.probability)} probability ({money(top.weighted)} weighted).** The top 15 open deals hold {money(deals.weighted.sum())} of weighted pipeline; {int((deals.stage == 'Close').sum())} of them are already in Close.
""",
    }


@chapter("p5")
def pipeline_app(s: Story) -> dict[str, str]:
    deals = s.table("open_deals", "Open deals with their account and location",
                    "Every open opportunity with its account, the account's region, country and location, its sales "
                    f"stage, product line, estimated and weighted value and estimated close date. Source: {SOURCE}.",
                    duck(f"""
                        with {DEALS}
                        select deal, account, region, country, lat, lon, stage, product_line, value, probability,
                               round(value * probability / 100.0) as weighted, estimated_close
                        from deals where outcome = 'Open'
                        order by weighted desc"""),
                    {**DEAL, **PLACE})
    s.app("pipeline_explorer.app.jsx", "Pipeline explorer", ["open_deals"])
    return {
        "headline": f"An app to explore {money(deals.value.sum())} of open pipeline by region and product line",
        "stat": str(len(deals)), "message": "open deals to explore in the app",
        "answer": f"""
**Here is a pipeline explorer for your sales team: {len(deals)} open deals worth {money(deals.value.sum())}.** Pick a sales region, product line or sales stage to update the key figures, the map of accounts, the pipeline by stage and the list of deals, biggest weighted value first.
""",
    }


# --- What wins deals? ----------------------------------------------------------------------------------

@chapter("w1")
def win_rate_over_time(s: Story) -> dict[str, str]:
    quarters = s.table("win_rate_by_quarter", "Won and lost deals and win rate by quarter",
                       "Won and lost opportunities by the quarter they closed in, and the win rate (won / (won + lost)). "
                       f"Source: {SOURCE}.",
                       duck(f"""
                           with {DEALS},
                           closed as (
                               select date_trunc('quarter', actual_close)::date as quarter,
                                      count(*) filter (where outcome = 'Won') as won,
                                      count(*) filter (where outcome = 'Lost') as lost
                               from deals where outcome in ('Won', 'Lost') and actual_close is not null
                               group by quarter
                           )
                           select quarter, won, lost, {win_rate()} as win_rate
                           from closed where won + lost >= 10 order by quarter"""),
                       {"quarter": {"semanticType": "Date", "displayName": "Quarter"},
                        "won": {**COUNT, "displayName": "Won"}, "lost": {**COUNT, "displayName": "Lost"},
                        "win_rate": {**PERCENT, "displayName": "Win rate"}})
    s.chart("win_rate_by_quarter", "Line Chart", {
        "x": {"field": "quarter", "dtype": "temporal"},
        "y": {"field": "win_rate", "dtype": "quantitative"},
    }, "Win rate by quarter", f"Won / (won + lost) deals closed in the quarter, quarters with 10 or more; {SOURCE}")
    won, lost = int(quarters.won.sum()), int(quarters.lost.sum())
    overall = 100 * won / (won + lost)
    first, recent = quarters.iloc[0], quarters.iloc[-4:]
    recent_rate = 100 * recent.won.sum() / (recent.won.sum() + recent.lost.sum())
    expect(recent_rate > first.win_rate, "the win rate did not improve on the first quarter")
    return {
        "headline": f"We win {pct(overall)} of closed deals, up from {pct(first.win_rate)} in {quarter_name(first.quarter)}",
        "stat": pct(overall), "message": "of closed deals are won",
        "answer": f"""
**We win {pct(overall)} of the deals we close ({won} won, {lost} lost).** It is better than when we started, {pct(first.win_rate)} in {quarter_name(first.quarter)}, and {pct(recent_rate)} over the last four quarters, but it moves around from quarter to quarter.
""",
    }


@chapter("w2")
def product_lines(s: Story) -> dict[str, str]:
    products = s.table("win_rate_by_product", "Win rate and won deal size by product line",
                       "Closed opportunities by product line: how many, the win rate (won / (won + lost)) and the "
                       f"average estimated value of won deals. Source: {SOURCE}.",
                       duck(f"""
                           with {DEALS},
                           closed as (
                               select product_line, count(*) filter (where outcome = 'Won') as won,
                                      count(*) filter (where outcome = 'Lost') as lost,
                                      avg(value) filter (where outcome = 'Won') as average_won_deal
                               from deals where outcome in ('Won', 'Lost') group by product_line
                           )
                           select product_line, won + lost as closed_deals, {win_rate()} as win_rate,
                                  round(average_won_deal) as average_won_deal
                           from closed order by win_rate desc"""),
                       {"product_line": DEAL["product_line"], "closed_deals": {**COUNT, "displayName": "Closed deals"},
                        "win_rate": {**PERCENT, "displayName": "Win rate"},
                        "average_won_deal": {**MONEY, "displayName": "Average won deal"}})
    s.ranking("win_rate_by_product", "product_line", "win_rate", "Win rate by product line",
              f"Won / (won + lost) deals; {SOURCE}")
    best, biggest = products.iloc[0], products.sort_values("average_won_deal", ascending=False).iloc[0]
    expect(best.product_line != biggest.product_line, "the most-won line also has the biggest deals")
    return {
        "headline": f"{best.product_line} wins most often ({pct(best.win_rate)}); {biggest.product_line} wins the biggest deals",
        "stat": pct(best.win_rate), "message": f"of {best.product_line} deals are won",
        "answer": f"""
**{best.product_line} wins most often: {pct(best.win_rate)} of its closed deals.** {biggest.product_line} wins less often ({pct(biggest.win_rate)}) but its won deals are the biggest, {money(biggest.average_won_deal)} on average.
""",
    }


@chapter("w3")
def lead_sources(s: Story) -> dict[str, str]:
    sources = s.table("win_rate_by_source", "Win rate and won revenue by lead source",
                      "Closed opportunities by lead source: how many, the win rate (won / (won + lost)) and won revenue. "
                      f"Source: {SOURCE}.",
                      duck(f"""
                          with {DEALS},
                          closed as (
                              select lead_source, count(*) filter (where outcome = 'Won') as won,
                                     count(*) filter (where outcome = 'Lost') as lost,
                                     sum(value) filter (where outcome = 'Won') as won_revenue
                              from deals where outcome in ('Won', 'Lost') group by lead_source
                          )
                          select lead_source, won + lost as closed_deals, {win_rate()} as win_rate, won_revenue
                          from closed order by win_rate desc"""),
                      {"lead_source": {"semanticType": "Category", "displayName": "Lead source"},
                       "closed_deals": {**COUNT, "displayName": "Closed deals"},
                       "win_rate": {**PERCENT, "displayName": "Win rate"},
                       "won_revenue": {**MONEY, "displayName": "Won revenue"}})
    s.ranking("win_rate_by_source", "lead_source", "win_rate", "Win rate by lead source",
              f"Won / (won + lost) deals; {SOURCE}")
    best, busiest = sources.iloc[0], sources.sort_values("closed_deals", ascending=False).iloc[0]
    expect(best.lead_source != busiest.lead_source, "the best source is also the busiest")
    return {
        "headline": f"{best.lead_source} deals win {pct(best.win_rate)} of the time; {busiest.lead_source} leads, our biggest source, {pct(busiest.win_rate)}",
        "stat": pct(best.win_rate), "message": f"of {best.lead_source.lower()} deals are won",
        "answer": f"""
**{best.lead_source} deals win most often, {pct(best.win_rate)}.** {busiest.lead_source} brings the most deals ({int(busiest.closed_deals)} closed) but wins only {pct(busiest.win_rate)} of them.
""",
    }


@chapter("w4")
def where_we_win(s: Story) -> dict[str, str]:
    places = s.table("account_wins", "Win rate and won revenue by account",
                     "Accounts with at least three closed opportunities: where they are, their sales region, won and lost "
                     f"deals, win rate (won / (won + lost)) and won revenue. Source: {SOURCE}.",
                     duck(f"""
                         with {DEALS},
                         accounts as (
                             select account, any_value(city) as city, any_value(country) as country,
                                    any_value(region) as region, any_value(lat) as lat, any_value(lon) as lon,
                                    count(*) filter (where outcome = 'Won') as won,
                                    count(*) filter (where outcome = 'Lost') as lost,
                                    coalesce(sum(value) filter (where outcome = 'Won'), 0) as won_revenue
                             from deals where lat is not null group by account
                         )
                         select account, city, country, region, lat, lon, won, lost, {win_rate()} as win_rate,
                                won_revenue
                         from accounts where won + lost >= 3 order by win_rate desc, won_revenue desc"""),
                     {**PLACE, "won": {**COUNT, "displayName": "Won"}, "lost": {**COUNT, "displayName": "Lost"},
                      "win_rate": {**PERCENT, "displayName": "Win rate"},
                      "won_revenue": {**MONEY, "displayName": "Won revenue"}})
    s.map("where_we_win.map.json", "Where we win", {
        "subtitle": "Accounts with 3 or more closed deals, sized by won revenue (USD), coloured by win rate",
        "source": SOURCE, "template": "bubbles", "data": {"table": "account_wins"},
        "encoding": {"lat": "lat", "lon": "lon", "size": "won_revenue", "color": "win_rate", "label": "account",
                     "tooltip": ["account", "country", "won", "lost", "win_rate", "won_revenue"]},
        "properties": {"geography": "world"}, "fields": s.tables[-1]["fields"], "view": MAP_VIEW,
    })
    by_region = places.groupby("region")[["won", "lost"]].sum()
    rates = (100 * by_region.won / (by_region.won + by_region.lost)).sort_values(ascending=False)
    expect(len(rates) >= 3, "too few regions on the map")
    return {
        "headline": f"{rates.index[0]} accounts win {pct(rates.iloc[0])} of their deals; {rates.index[-1]} {pct(rates.iloc[-1])}",
        "stat": pct(rates.iloc[0]), "message": f"win rate of {rates.index[0]} accounts",
        "answer": f"""
**{rates.index[0]} wins most often, {pct(rates.iloc[0])} of the closed deals of its accounts on the map, and {rates.index[-1]} least, {pct(rates.iloc[-1])}.** The map shows the {len(places)} accounts with three or more closed deals, sized by won revenue and coloured by win rate.
""",
    }


@chapter("w5")
def forecast_app(s: Story) -> dict[str, str]:
    months = s.table("forecast_by_month", "Open pipeline by expected close month, region and product line",
                     "Open opportunities by the month they are expected to close, sales region and product line: how "
                     f"many, their estimated value and weighted value (estimated value times probability). Source: {SOURCE}.",
                     duck(f"""
                         with {DEALS}
                         select strftime(date_trunc('month', estimated_close), '%Y-%m') as month,
                                'Q' || quarter(estimated_close) || ' ' || year(estimated_close) as quarter,
                                region, product_line, count(*) as deals, sum(value) as pipeline,
                                round(sum(value * probability / 100.0)) as weighted
                         from deals where outcome = 'Open' and estimated_close is not null
                         group by all order by month, region, product_line"""),
                     {"month": {"semanticType": "YearMonth", "displayName": "Expected close"},
                      "quarter": {"semanticType": "Category", "displayName": "Quarter"},
                      "region": PLACE["region"], "product_line": DEAL["product_line"],
                      "deals": {**COUNT, "displayName": "Open deals"},
                      "pipeline": {**MONEY, "displayName": "Open pipeline"},
                      "weighted": {**MONEY, "displayName": "Weighted pipeline"}})
    deals = s.table("forecast_deals", "Open deals by expected close date",
                    "Open opportunities with their account, sales region, product line, sales stage, estimated and "
                    f"weighted value and expected close month. Source: {SOURCE}.",
                    duck(f"""
                        with {DEALS}
                        select deal, account, region, product_line, stage, value, probability,
                               round(value * probability / 100.0) as weighted,
                               strftime(date_trunc('month', estimated_close), '%Y-%m') as month,
                               'Q' || quarter(estimated_close) || ' ' || year(estimated_close) as quarter
                        from deals where outcome = 'Open' and estimated_close is not null
                        order by month, weighted desc"""),
                    {**DEAL, "account": PLACE["account"], "region": PLACE["region"],
                     "month": {"semanticType": "YearMonth", "displayName": "Expected close"},
                     "quarter": {"semanticType": "Category", "displayName": "Quarter"}})
    s.app("sales_forecast.app.jsx", "Sales forecast", ["forecast_by_month", "forecast_deals"])
    quarters = months.groupby("quarter", sort=False).weighted.sum()
    today = pd.Timestamp.now()
    # The next two quarters: the full quarters after the one we are in.
    nxt = quarters.drop(f"Q{today.quarter} {today.year}", errors="ignore")
    expect(len(nxt) >= 2, "the open deals close in fewer than two quarters after this one")
    return {
        "headline": f"{money(nxt.iloc[0] + nxt.iloc[1])} weighted pipeline expected in {nxt.index[0]} and {nxt.index[1]}",
        "stat": money(nxt.iloc[0] + nxt.iloc[1]), "message": f"weighted forecast for {nxt.index[0]}–{nxt.index[1]}",
        "answer": f"""
**The next two quarters hold {money(nxt.iloc[0] + nxt.iloc[1])} of weighted pipeline: {money(nxt.iloc[0])} in {nxt.index[0]} and {money(nxt.iloc[1])} in {nxt.index[1]}.** The app shows the forecast by month and sales region; pick a product line or quarter to update it and see the deals behind it. Weighted pipeline is estimated value times probability.
""",
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
    with tempfile.TemporaryDirectory(prefix="powerapps-stories-") as tmp:
        for index, (starter, entry) in enumerate(stories):
            if args.only and entry["id"] not in args.only:
                continue
            chapters = entry.get("chapters") or []
            missing = [item["id"] for item in chapters if item["id"] not in CHAPTER_MAKERS]
            if not chapters or missing:
                failed.append(f"{entry['id']}: no chapters, or none made by make_stories.py: {missing}")
                continue
            if not (content / starter["file"]).is_file():
                failed.append(f"{entry['id']}: {content / starter['file']} is missing; run build.py first")
                continue
            made = Story(entry, starter, content, Path(tmp))
            made_texts = []
            try:
                for number, item in enumerate(chapters):
                    made.begin(number)
                    made_texts.append({**CHAPTER_MAKERS[item["id"]](made), "prompt": item["prompt"]})
            except StoryError as error:
                failed.append(f"{entry['id']} ({item['id']}): {error}")
                continue
            headline = made_texts[0]["headline"]
            folder = write_seed(made, seed_state(made, index, made_texts, entry.get("label") or headline))
            texts[entry["id"]] = {"headline": headline, "dek": "",
                                  "chapters": {item["id"]: {"headline": text["headline"], "stat": text["stat"],
                                                            "message": text["message"], "file": chapter_file(made, number)}
                                               for number, (item, text) in enumerate(zip(chapters, made_texts))}}
            size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
            print(f"{entry['id']}: {headline} ({size / 1024:.0f} KB)")
            for item, text in zip(chapters, made_texts):
                print(f"  {item['id']}: {text['headline']}  [{text['stat']} | {text['message']}]")
    set_story_text(texts)
    if failed:
        sys.exit("\n".join(failed))


if __name__ == "__main__":
    main()
