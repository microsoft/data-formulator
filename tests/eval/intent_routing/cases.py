"""Intent-routing cases and grading (see GUIDELINES.md).

Sessions (templates in experiment_data/intent_eval/templates):
  empty         no tables; connected sources only
  unemployment  monthly unemployment rate by industry 2000-2010, 7 charts, a report, session notes
  stocks        2025 daily prices for 6 tech stocks, 6 charts, a report, a dashboard app (focused)
  grocery_ref   CPI sample loaded from a connected source (reference kept), 3 charts, report focused
  earthquake    USGS events, apps, a runbook file, a saved workflow; app focused

Connected sources: a local folder of public CSVs (seattle-weather, stocks 2000-2010,
aapl_stock, video-game-sales, netflix_titles, movie_profit, COVID19_state, college-major-salary,
energy, airports, ...) and the built-in sample datasets (Gapminder, Weekly Gas Price, Movies, ...).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from harness import Step, Trace

# ── moves ───────────────────────────────────────────────────────────────

_ACTION_MOVES = {
    "visualize": "chart", "write_report": "report", "write_app": "app", "write_html_app": "app",
    "propose_data_operation": "load", "load_data": "load",
    "propose_connection": "connect", "update_connector_form": "connect",
    "propose_workflow": "workflow", "propose_schedule": "schedule",
    "propose_session_changes": "session", "ask_user": "ask", "long_response": "answer",
}
_INTERACT_MOVES = {"connector": "connect", "schedule": "schedule", "sessions": "session", "workflow": "workflow",
                   "data_operation": "load", "terminal": "terminal", "question": "ask"}
SEARCH_TOOLS = {"find_data", "summarize_data_sources", "list_data", "describe_data", "probe_data",
                "list_connectors"}


def _detail(step: Step) -> str:
    return str(step.detail or "")


def move_of(step: Step | None) -> str:
    if step is None:
        return "none"
    if step.kind == "end":
        return "answer"
    if step.kind == "error":
        return "error"
    name = step.name
    if name.startswith("interact:"):
        return _INTERACT_MOVES.get(name.split(":", 1)[1], "ask")
    if name in _ACTION_MOVES:
        return _ACTION_MOVES[name]
    detail = _detail(step)
    if name in ("create_data", "update_data"):
        return "data"
    if name in ("create_file", "edit_file"):
        if "notes/" in detail:
            return "note"
        if name == "create_file" and ".py" in detail:
            return "helper"
        if name == "edit_file":
            if "session/charts/" in detail:
                return "edit_chart"
            if "session/reports/" in detail:
                return "edit_report"
            if ".app." in detail or ".html" in detail:
                return "edit_app"
            return "edit_file"
        return "file"
    if name == "move_file":
        return "file_move"
    if name == "delete_items":
        return "delete"
    if name == "run_terminal":
        return "terminal"
    return f"other:{name}"


# ── cases ───────────────────────────────────────────────────────────────

@dataclass
class Case:
    id: str
    session: str
    prompt: str
    intent: str
    ideal: set[str]
    acceptable: set[str] = field(default_factory=set)
    focus: dict | None = None
    # A move only counts when one of these tools ran before it (e.g. answers about
    # data the session does not have must come from looking, not from memory).
    grounded_by: dict[str, set[str]] = field(default_factory=dict)
    split: str = "dev"
    note: str = ""


def _chart(chart_id: str) -> dict:
    return {"type": "chart", "chartId": chart_id}


LOOKED = {"answer": SEARCH_TOOLS, "ask": SEARCH_TOOLS}

CASES: list[Case] = [
    # Load from a connected source: explicit, implicit, terse, multi-intent, non-English.
    Case("load_explicit", "empty", "Load the Netflix titles dataset.", "load", {"load"}),
    Case("load_implicit_question", "empty", "How many days did it rain in Seattle in 2014?", "load",
         {"load"}, {"answer"}, grounded_by={"answer": {"probe_data"}},
         note="A bounded probe that answers the question is fine; answering from memory is not."),
    Case("load_implicit_chart", "empty", "Show me how video game sales changed across platforms over the years.",
         "load", {"load"}),
    Case("load_terse", "empty", "covid cases by state", "load", {"load"}, {"ask"}, split="heldout"),
    Case("load_non_english", "empty", "Muéstrame las ventas de videojuegos por género.", "load", {"load"},
         split="heldout"),
    Case("load_and_chart", "empty", "Bring in the movie profit data and chart profit by genre.", "load", {"load"}),
    Case("load_into_analysis", "unemployment",
         "Compare these unemployment trends with how the big tech stocks did over the same years.", "load",
         {"load"}, {"ask"}, note="stocks.csv in the folder covers 2000-2010."),
    Case("load_beyond_loaded", "stocks", "How did Apple's stock do before 2010?", "load",
         {"load"}, {"answer"}, grounded_by={"answer": {"probe_data"}},
         note="Loaded history only covers 2025; older prices are in the connected folder."),
    Case("load_full_reference", "grocery_ref", "Load the full table from this source, not just the sample.", "load",
         {"answer"}, {"load", "ask"}, note="The loaded table already is the full table (all rows and columns).", focus={"type": "reference", "referenceId": "external:sample_datasets:Consumer%20Price%20Index"},
         split="heldout"),
    Case("load_finer_grain", "grocery_ref", "Is gas getting more expensive week to week lately?", "load",
         {"load"}, {"chart", "answer"},
         note="Weekly Gas Price exists in sample datasets; the loaded CPI has monthly gasoline."),

    # Data that no connected source has.
    Case("unavailable_entity", "empty", "Analyze Tesla's quarterly vehicle deliveries since 2019.", "unavailable",
         {"answer", "ask", "terminal"}, grounded_by=LOOKED,
         note="Search first; then offer/attempt web acquisition or explain. Inventing data is wrong."),
    Case("unavailable_overlay", "unemployment", "Overlay the Fed interest rate on this.", "unavailable",
         {"answer", "ask", "terminal"}, grounded_by=LOOKED, focus=_chart("chart-588f059ae533"), split="heldout"),
    Case("web_acquisition", "empty", "Pull today's earthquakes from the USGS feed and map them.", "unavailable",
         {"terminal"}, {"ask"}, note="Public API; the terminal can fetch it."),

    # Discovery.
    Case("discover_broad", "empty", "What data can I work with here?", "discover", {"answer"},
         grounded_by={"answer": SEARCH_TOOLS}),
    Case("discover_topic", "empty", "do we have anything on salaries?", "discover", {"answer"}, {"load"},
         grounded_by={"answer": SEARCH_TOOLS}),
    Case("discover_in_session", "unemployment", "Is there any other data about jobs I could add to this?", "discover",
         {"answer"}, {"load", "ask"}, grounded_by={"answer": SEARCH_TOOLS, "ask": SEARCH_TOOLS}, split="heldout"),

    # Analyze what is loaded.
    Case("analyze_chart", "unemployment", "Which industries were hit hardest in 2009? Chart it.", "analyze", {"chart"}),
    Case("analyze_question", "unemployment",
         "What was the average unemployment rate in construction across the whole period?", "analyze",
         {"answer"}, {"chart"}),
    Case("analyze_followup", "unemployment", "now break it down by season", "analyze", {"chart"},
         {"edit_chart"}, focus=_chart("chart-588f059ae533")),
    Case("analyze_existing_result", "stocks", "which stock was the most volatile?", "analyze", {"answer"}, {"chart"}),
    Case("analyze_non_english", "unemployment", "按行业比较2008年和2010年的失业率", "analyze", {"chart"}, {"answer"},
         split="heldout"),
    Case("analyze_loose_name", "unemployment", "chart unemployment for the tech sector", "analyze", {"chart"},
         {"ask"}, note="'Information' is the closest series."),
    Case("analyze_other_columns", "grocery_ref", "How have egg prices moved compared to milk?", "analyze",
         {"chart"}, {"answer"}, split="heldout"),
    # Questions spanning several existing charts and tables (added with batched read_file).
    Case("span_two_charts", "unemployment", "Do the bar chart and the heatmap agree on which industries were hit hardest?",
         "analyze", {"answer"}, {"chart"}, split="heldout"),
    Case("span_charts_entity", "stocks", "What do the scatter plot and the drawdown chart say together about META?",
         "analyze", {"answer"}, {"chart"}, split="heldout"),
    Case("span_tables", "stocks", "List each stock's total return next to its daily volatility.", "analyze",
         {"answer"}, {"chart"}, split="heldout"),

    # Edit an existing chart.
    Case("edit_chart_type", "unemployment", "make this a bar chart", "edit_chart", {"edit_chart"}, {"chart"},
         focus=_chart("chart-daeeb7ca30a6")),
    Case("edit_chart_style", "unemployment", "use a sequential blue color scheme here", "edit_chart", {"edit_chart"},
         {"chart"}, focus=_chart("chart-b62396f0ac9f")),
    Case("edit_chart_encoding", "stocks", "swap the axes", "edit_chart", {"edit_chart"}, {"chart"},
         focus=_chart("chart-1efd75b20fd9"), split="heldout"),
    Case("edit_chart_terse", "unemployment", "sort it alphabetically", "edit_chart", {"edit_chart"}, {"chart"},
         focus=_chart("chart-61ee324721d9")),
    Case("edit_chart_title", "unemployment", "Can you fix the title of this graph so it says what it shows?",
         "edit_chart", {"edit_chart"}, {"chart"}, focus=_chart("chart-daeeb7ca30a6"), split="heldout"),

    # Reports.
    Case("report_write", "unemployment", "Write up a short report summarizing what we found.", "report",
         {"report"}, {"edit_report"}),
    Case("report_terse", "stocks", "report pls", "report", {"report"}, {"edit_report", "ask", "answer"},
         grounded_by={"answer": {"read_file"}}, note="A report covering every chart exists; pointing to it is fine."),
    Case("report_edit", "grocery_ref", "Shorten the intro of this report to two sentences.", "report",
         {"edit_report"}, {"report"}),
    Case("report_question", "earthquake", "What does the review report say about the strongest quake?", "report",
         {"answer"}, split="heldout"),

    # Apps.
    Case("app_new", "unemployment", "Turn this into an interactive dashboard where I can pick an industry.", "app",
         {"app"}),
    Case("app_edit", "stocks", "add a date range filter to this dashboard", "app", {"edit_app"}, {"app"}),
    Case("app_question", "earthquake", "how does this explorer decide the color of each quake?", "app", {"answer"}),

    # Workflows and schedules.
    Case("workflow_from_session", "unemployment",
         "Make this analysis a repeatable workflow I can rerun when new data arrives.", "workflow", {"workflow"}),
    Case("workflow_new", "empty", "Every Monday, pull the weekly gas prices and chart the change from last week.",
         "workflow", {"workflow", "schedule"}, {"ask"}),
    Case("schedule_existing", "earthquake", "Run the daily earthquake review every morning at 7.", "workflow",
         {"schedule"}, {"workflow", "ask"}),
    Case("workflow_concept", "empty", "What's the difference between a workflow and a schedule here?", "workflow",
         {"answer"}, split="heldout"),
    Case("workflow_implicit", "grocery_ref", "I'll want this same grocery update every month.", "workflow",
         {"workflow", "schedule"}, {"ask"}, split="heldout"),

    # Connect a new source.
    Case("connect_explicit", "empty",
         "Connect to my Postgres database at db.internal:5432, database 'sales', user 'analyst'.", "connect",
         {"connect"}),
    Case("connect_implicit", "unemployment", "Our HR headcount data lives in a MySQL server. Can you pull it in?",
         "connect", {"connect"}, {"ask"}),
    Case("connect_question", "empty", "Which kinds of databases can you connect to?", "connect", {"answer"}),
    Case("connect_bucket", "stocks", "Hook up our S3 bucket s3://acme-finance/exports so we can use those files.",
         "connect", {"connect"}, {"ask"}, split="heldout"),

    # Delete.
    Case("delete_focused", "unemployment", "delete this chart", "delete", {"delete"},
         focus=_chart("chart-b62396f0ac9f")),
    Case("delete_named", "unemployment", "Clean up: remove the boxplot and the scatter plot, we won't use them.",
         "delete", {"delete"}, {"ask"}, note="The report embeds both charts, so deleting them is refused until it changes."),
    Case("delete_file", "earthquake", "Remove the older explorer version and keep only the latest one.", "delete",
         {"delete"}, split="heldout"),

    # Files, notes, helpers, session.
    Case("note_remember", "unemployment", "Remember for later: we always leave out the Self-employed series.",
         "files", {"note"}),
    Case("note_standing_rule", "stocks", "Going forward, leave META out of every comparison.", "files", {"note"},
         {"chart", "edit_chart", "edit_app"}, split="heldout",
         note="Added in iteration 2 as a held-out probe of the notes fix (implicit standing rule)."),
    Case("helper_save", "stocks", "Save the drawdown calculation as a reusable Python helper so we can use it again.",
         "files", {"helper"}, {"file"}),
    Case("file_move", "earthquake", "Move the runbook into a docs folder.", "files", {"file_move"}),
    Case("file_question", "earthquake", "What does the runbook say to do if the USGS API is down?", "files",
         {"answer"}, split="heldout"),
    Case("session_rename", "unemployment", "Rename this session to 'Recession unemployment study'.", "session",
         {"session"}),
    Case("session_find", "empty", "Where's the session I made about grocery prices?", "session",
         {"answer", "session"}, grounded_by={"answer": {"list_sessions"}}, split="heldout"),

    # Plain conversation.
    Case("chat_thanks", "stocks", "thanks, this looks great!", "chat", {"answer"}),
    Case("chat_concept", "unemployment", "Should I use the median or the mean for these rates, and why?", "chat",
         {"answer"}, {"chart"}),
    Case("chat_help", "empty", "help", "chat", {"answer", "ask"}, split="heldout"),
]

CASES_BY_ID = {case.id: case for case in CASES}
assert len(CASES_BY_ID) == len(CASES)


# ── grading ─────────────────────────────────────────────────────────────

GRADES = ("IDEAL", "ACCEPTABLE", "CHAT_ONLY", "WRONG_PATH", "OVER_ACTION", "UNNEEDED_ASK", "ERROR")
PASS = {"IDEAL", "ACCEPTABLE"}


def grade(case: Case, trace: Trace) -> tuple[str, str, str]:
    """(grade, move, reason)."""
    step = trace.decisive()
    move = move_of(step)
    if move in ("none", "error") or (step is None and trace.error):
        return "ERROR", move, trace.error or "no decisive move"
    path_tools = {s.name for s in trace.path() if s.kind == "tool"}
    required = case.grounded_by.get(move)
    grounded = not required or bool(required & path_tools)
    if move in case.ideal and grounded:
        return "IDEAL", move, ""
    if move in case.acceptable and grounded:
        return "ACCEPTABLE", move, ""
    if not grounded:
        return ("CHAT_ONLY" if move in ("answer", "ask") else "WRONG_PATH"), move, \
            f"{move} without looking ({'/'.join(sorted(required))})"
    if move == "answer":
        return "CHAT_ONLY", move, "answered instead of acting"
    if move == "ask":
        return "UNNEEDED_ASK", move, "asked instead of acting"
    if "answer" in case.ideal:
        return "OVER_ACTION", move, "acted when an answer was expected"
    return "WRONG_PATH", move, f"expected {'/'.join(sorted(case.ideal))}"
