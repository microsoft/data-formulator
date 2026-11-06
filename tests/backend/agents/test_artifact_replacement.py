from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from data_formulator.analyst.replacement import (
    mark_run_artifacts_used, record_run_artifact, resolve_replacement,
)
from data_formulator.analyst.skills import SkillContext, build_registry
from data_formulator.datalake.workspace import Workspace

pytestmark = pytest.mark.backend

LISTED = [
    {"id": "d_trend", "node_id": "d_trend", "kind": "table", "name": "Trend", "aliases": ["chart-trend"]},
    {"id": "d_base", "node_id": "d_base", "kind": "table", "name": "Base", "blocked": "the table Trend was computed from it"},
    {"id": "report-1", "node_id": "report-1", "kind": "report", "name": "Findings"},
]


def _ctx(workspace=None, **payload):
    return SimpleNamespace(workspace=workspace, payload={"replaceable_artifacts": LISTED, "run_artifacts": {}, **payload})


def test_resolves_listed_artifacts_by_id_or_chart_id() -> None:
    ctx = _ctx()
    assert resolve_replacement("chart-trend", "table", ctx) == {"id": "d_trend", "kind": "table", "name": "Trend", "node_id": "d_trend"}
    assert resolve_replacement("report-1", "report", ctx)["name"] == "Findings"


@pytest.mark.parametrize("target, kind, message", [
    ("d_missing", "table", "not an agent-created artifact"),
    ("d_base", "table", "the table Trend was computed from it"),
    ("report-1", "table", "it is a report"),
    ("", "table", "replaces must be the id"),
])
def test_refuses_what_cannot_be_replaced(target, kind, message) -> None:
    with pytest.raises(ValueError, match=message):
        resolve_replacement(target, kind, _ctx())


def test_this_runs_artifacts_are_replaceable_until_a_later_step_reads_them() -> None:
    ctx = _ctx()
    record_run_artifact(ctx, "table", "d_new", "New", aliases=["chart-new"])
    assert resolve_replacement("chart-new", "table", ctx)["id"] == "d_new"
    mark_run_artifacts_used(ctx, ["d_new"])
    with pytest.raises(ValueError, match="a later step of this run already uses it"):
        resolve_replacement("d_new", "table", ctx)


def test_refuses_a_table_an_app_reads(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"a": [1]}), "d_trend")
    workspace.save_workspace_file(b'// @df-app {"version": 2, "title": "T", "tables": ["d_trend"]}\nexport default function App() { return null; }\n',
                                  "trend.app.jsx", "text/jsx", agent_managed=True)
    with pytest.raises(ValueError, match="the app files/trend.app.jsx reads it"):
        resolve_replacement("d_trend", "table", _ctx(workspace))


def test_write_report_names_the_report_it_replaces() -> None:
    skill = build_registry().get_skill("report")
    ctx = SkillContext(client=None, workspace=None, payload={"replaceable_artifacts": LISTED, "run_artifacts": {}})
    events = list(_drain(skill.handle_action("write_report", {"report": "# Fixed", "replaces": "report-1"}, ctx)))
    assert events[0] == {"type": "action", "action": "write_report",
                         "replaces": {"id": "report-1", "kind": "report", "name": "Findings", "node_id": "report-1"}}
    events, observation = _drain_with_result(skill.handle_action("write_report", {"report": "# Fixed", "replaces": "d_trend"}, ctx))
    assert events[0]["type"] == "error" and observation.startswith("[REPORT NOT DELIVERED]")


def _drain(generator):
    return _drain_with_result(generator)[0]


def _drain_with_result(generator):
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value


class _Runtime:
    def __init__(self):
        self.ran = 0

    def run_visualize_code(self, **_):
        self.ran += 1
        return {"status": "ok", "transform_result": {"status": "ok", "chart_id": "chart-fixed", "code": "df",
                "content": {"rows": [{"a": 1}], "virtual": {"table_name": "d_fixed", "row_count": 1}}}}

    def register_run_chart(self, *_):
        pass


def test_visualize_replaces_a_table_and_records_the_fix_for_this_run(tmp_path) -> None:
    skill = build_registry().get_skill("visualization")
    runtime = _Runtime()
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"a": [1]}), "d_fixed")
    run = {"replaceable_artifacts": LISTED, "run_artifacts": {}, "workspace_inputs": None}
    ctx = SkillContext(client=None, workspace=workspace, payload=run, runtime=runtime)
    spec = {"title": "Fixed trend", "display_name": "Fixed trend", "input_sources": [], "code": "df", "output_variable": "df",
            "chart": {}, "replaces": "chart-trend"}
    events, observation = _drain_with_result(skill.handle_action("visualize", spec, ctx))
    result = next(event for event in events if event["type"] == "result")
    assert result["content"]["replaces"] == {"id": "d_trend", "kind": "table", "name": "Trend", "node_id": "d_trend"}
    assert "Replaced Trend (d_trend)" in observation
    # The fix itself can be replaced later in the run, by its table or chart id.
    assert resolve_replacement("chart-fixed", "table", ctx)["id"] == "d_fixed"

    # A refused replacement fails before any code runs.
    events, observation = _drain_with_result(skill.handle_action("visualize", {**spec, "replaces": "d_base"}, ctx))
    assert runtime.ran == 1 and events[0]["type"] == "error" and "FAILED" in observation
