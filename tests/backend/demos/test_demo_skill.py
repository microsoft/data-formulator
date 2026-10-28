"""The demo skill (design-docs/69): only on demo requests, loading a demo's datasets."""

from __future__ import annotations

import json
from pathlib import Path

import flask
import pyarrow as pa
import pytest

from data_formulator import sites
from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.session_files import SessionFiles
from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.datalake.workspace import Workspace
from data_formulator.sites.datasets import demo_datasets, load_datasets
from data_formulator.sites.skill import demo_skill_body

pytestmark = [pytest.mark.backend]

PROFILE = """\
name: Demo Explorer
tagline: Explore two small datasets.
release: r1
starters:
  - id: culture
    title: Culture
    description: Heritage spending.
    file: culture.zip
    stories:
      - id: c1
        headline: Who pays for heritage
        prompt: Who pays for heritage?
  - id: education
    title: Education
    description: Schools.
    file: education.zip
"""

OTHER_PROFILE = """\
name: Other
release: r1
starters:
  - id: science
    title: Science
    file: science.zip
"""


def _dataset_zip(root: Path, name: str, tables: dict[str, list[int]], files: dict[str, str]) -> bytes:
    workspace = Workspace(f"builder-{name}", root_dir=root / "build")
    for table, values in tables.items():
        metadata = workspace.write_parquet_from_arrow(pa.table({"value": values}), table)
        metadata.description = f"{table} of {name}"
        workspace.add_table_metadata(metadata)
    for path, text in files.items():
        workspace.save_workspace_file(text.encode(), path, "text/markdown")
    return workspace.export_session_zip({"inputTables": []}).getvalue()


@pytest.fixture(autouse=True)
def _demos(tmp_path, monkeypatch):
    monkeypatch.delenv("DF_SITE", raising=False)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("DF_SITES_DIR", str(tmp_path / "content"))
    monkeypatch.setattr(sites, "PACKAGED_DEMOS", tmp_path / "shipped")
    for site_id, profile in (("demo", PROFILE), ("other", OTHER_PROFILE)):
        (tmp_path / "content" / site_id / "r1").mkdir(parents=True)
        (tmp_path / "content" / site_id / "profile.yaml").write_text(profile, encoding="utf-8")
    content = tmp_path / "content" / "demo" / "r1"
    (content / "culture.zip").write_bytes(_dataset_zip(tmp_path, "culture", {"spending": [1, 2], "countries": [1]},
                                                       {"guide.md": "culture guide", "docs/shared.md": "same"}))
    (content / "education.zip").write_bytes(_dataset_zip(tmp_path, "education", {"schools": [3], "countries": [1]},
                                                         {"guide.md": "education guide", "docs/shared.md": "same"}))
    (tmp_path / "content" / "other" / "r1" / "science.zip").write_bytes(
        _dataset_zip(tmp_path, "science", {"research": [4]}, {}))
    sites.site_profile.cache_clear()
    yield
    sites.site_profile.cache_clear()


def _ctx(workspace, demo: str | None = "demo") -> SkillContext:
    return SkillContext(client=None, workspace=workspace, payload={"demo": demo, "input_tables": []})


def _run(generator):
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value


def _skill():
    return build_registry().with_demo("demo").get_skill("demo")


# -- only on demos ------------------------------------------------------------------------------


def test_the_standard_registry_never_has_the_demo_skill():
    registry = build_registry()
    assert not registry.has("demo")
    assert registry.action_owner("load_datasets") is None
    for site_id in (None, "", "missing", "../etc"):
        assert registry.with_demo(site_id) is registry


def test_a_demo_registry_is_a_copy_with_the_demo_skill_and_without_other_data_paths():
    registry = build_registry()
    demo = registry.with_demo("demo")
    assert demo.has("demo") and demo.action_owner("load_datasets") == "demo"
    for name in ("connected_data", "terminal", "configure", "html_app"):
        assert not demo.has(name) and registry.has(name)
    assert not registry.has("demo")


def test_a_demo_without_installed_datasets_gets_no_skill(tmp_path):
    for name in ("culture.zip", "education.zip"):
        (tmp_path / "content" / "demo" / "r1" / name).unlink()
    assert not build_registry().with_demo("demo").has("demo")


def test_only_a_demo_agent_preloads_the_skill(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    standard = AnalystAgent(client=None, workspace=workspace)
    assert "demo" not in standard._initial_loaded_skills(None)
    assert not standard._build_skill_body_message("demo")[0]  # load_skill("demo") fails
    demo = AnalystAgent(client=None, workspace=workspace, demo="demo")
    assert "demo" in demo._initial_loaded_skills(None)


def test_a_resumed_conversation_does_not_reopen_the_skill_outside_the_demo(tmp_path):
    agent = AnalystAgent(client=None, workspace=Workspace("visitor", root_dir=tmp_path / "ws"))
    agent._loaded_skills = {"meta"}
    trajectory = [{"role": "user", "content": "[SKILL LOADED: demo] You can now use the action(s): load_datasets."}]
    agent._rehydrate_loaded_skills(trajectory)
    assert "demo" not in agent._loaded_skills
    assert "no longer available" in trajectory[0]["content"]


def test_only_a_request_naming_a_demo_is_a_demo_request():
    app = flask.Flask(__name__)
    with app.test_request_context("/", headers={"X-DF-Demo": "demo"}):
        assert sites.current_site() == "demo"
    for headers in ({}, {"X-DF-Demo": "missing"}):
        with app.test_request_context("/", headers=headers):
            assert sites.current_site() is None


def test_the_handler_refuses_outside_a_demo(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    events, observation = _run(_skill().handle_action("load_datasets", {"datasets": ["culture"]}, _ctx(workspace, demo=None)))
    assert observation.startswith("[ERROR]") and events[0]["type"] == "error"
    assert workspace.list_tables() == []


def test_a_demo_cannot_load_another_demos_datasets(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    _, observation = _run(_skill().handle_action("load_datasets", {"datasets": ["science"]}, _ctx(workspace)))
    assert "Unknown dataset" in observation and workspace.list_tables() == []


def test_connected_sources_are_hidden_on_a_demo(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    assert SessionFiles(_ctx(workspace, demo=None)).sources.enabled
    assert not SessionFiles(_ctx(workspace)).sources.available


# -- datasets -----------------------------------------------------------------------------------


def test_the_body_lists_datasets_shared_tables_and_examples():
    body = demo_skill_body("demo")
    assert "# This demo: Demo Explorer" in body and "Explore two small datasets." in body
    assert "loaded once): countries" in body
    assert "- `culture`: Culture. Heritage spending. Tables: spending (2 rows)." in body
    assert '- (culture) "Who pays for heritage?" Earlier finding: Who pays for heritage.' in body


def test_loading_datasets_copies_tables_and_files_once(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    first = load_datasets(workspace, "demo", ["culture"])
    assert first.table_names == ["spending", "countries"]
    assert workspace.get_table_metadata("spending").description == "spending of culture"
    both = load_datasets(workspace, "demo", ["culture", "education", "nope"])
    assert both.table_names == ["schools"] and both.present["education"] == ["countries"]
    assert both.unknown == ["nope"]
    # Each dataset keeps its own guide; identical files are not copied twice.
    assert both.files["education"] == ["education/guide.md", "docs/shared.md"]
    assert sorted(item.name for item in workspace.list_workspace_files()) == ["docs/shared.md", "education/guide.md", "guide.md"]
    assert workspace.read_workspace_file("education/guide.md")[1] == b"education guide"
    assert [dataset.id for dataset in demo_datasets("demo")] == ["culture", "education"]


def test_load_datasets_reports_loaded_tables_to_the_frontend_and_the_agent(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    ctx = _ctx(workspace)
    events, observation = _run(_skill().handle_action("load_datasets", {"datasets": ["culture", "education"]}, ctx))
    operation_event = next(event for event in events if event["type"] == "data_operation_result")
    operation = operation_event["operation"]
    assert operation["status"] == "loaded" and operation["result_table_ids"] == ["spending", "countries", "schools"]
    # The documents copied in come with the tables, for the thread; an identical one is not reported twice.
    files = workspace.get_metadata().files
    assert operation_event["files"] == [{"path": f"files/{name}", "content_hash": files[name].content_hash}
                                        for name in ["guide.md", "docs/shared.md", "education/guide.md"]]
    assert [table["name"] for table in ctx.payload["input_tables"]] == ["spending", "countries", "schools"]
    report = json.loads(observation.splitlines()[1])
    assert report[1]["already_in_session"] == ["countries"] and "education/guide.md" in observation

    events, observation = _run(_skill().handle_action("load_datasets", {"datasets": ["culture"]}, ctx))
    assert observation.startswith("Nothing new to load")
    assert not any(event["type"] == "data_operation_result" for event in events)


def test_the_demo_has_no_session_suggestions():
    registry = build_registry().with_demo("demo")
    assert registry.action_owner("suggest_sessions") is None
    assert [spec["function"]["name"] for spec in registry.action_tools_for(["demo"])] == ["load_datasets"]


def test_a_demo_offers_no_connected_source_tools_and_its_guidance_says_so():
    registry = build_registry()
    demo = registry.with_demo("demo")
    tools = {spec["function"]["name"] for spec in demo.tools_for(["meta", "demo"]) + demo.action_tools_for(["meta", "demo"])}
    assert {"load_datasets", "visualize", "execute_python_script", "write_report"} <= tools
    assert not tools & {"probe_data", "propose_data_operation", "write_app", "load_skill_html_app"}
    body = demo.load_body("meta")
    for absent in ("connected_data", "`configure`", "propose_data_operation", "probe_data", "html_app"):
        assert absent not in body, absent
    assert "`load_datasets`" in body
    # The standard app's guidance and tools are untouched.
    standard = registry.load_body("meta")
    assert "connected_data" in standard and "propose_data_operation" in standard
    assert "probe_data" in {spec["function"]["name"] for spec in registry.tools_for(["meta"])}


def test_the_demo_guidance_rules_still_match_the_baseline_text():
    from data_formulator.sites.skill import _DEMO_RULES, demo_body_edits

    demo_body_edits.cache_clear()
    edits = demo_body_edits()
    assert {name: len(pairs) for name, pairs in edits.items()} == {name: len(rules) for name, rules in _DEMO_RULES.items()}


def test_the_demo_refers_work_beyond_its_scope_to_the_full_app():
    body = demo_skill_body("demo")
    assert "https://github.com/microsoft/data-formulator" in body
    assert "regressions" in body and "dashboards" in body


def test_nothing_the_demo_analyst_sees_offers_other_data_paths(tmp_path):
    """The whole prompt and tool list of a demo run: no connectors, uploads, terminal, apps or the web."""
    agent = AnalystAgent(client=None, workspace=Workspace("visitor", root_dir=tmp_path / "ws"), demo="demo")
    agent._loaded_skills = {"meta"}
    agent._run_payload = {"demo": "demo"}
    prompt = agent._build_system_prompt()
    preloads = "\n".join(message["content"] for message in agent._preload_messages(agent._initial_loaded_skills(None)))
    agent._loaded_skills = {"meta", "demo"}
    tools = agent._current_tools()
    names = {tool["function"]["name"] for tool in tools}
    assert "load_datasets" in names
    assert not names & {"probe_data", "propose_data_operation", "run_terminal", "propose_connection", "write_app"}
    visualize = next(tool for tool in tools if tool["function"]["name"] == "visualize")
    assert "connector_inputs" not in visualize["function"]["parameters"]["properties"]
    text = "\n".join([prompt, preloads, json.dumps(tools)])
    for offer in ("connected_data", "configure", "propose_data_operation", "probe_data", "connector_inputs", "html_app",
                  "connector forms", "connected-source catalogs", "sources/<source_id>", "acquire remote data",
                  "run_terminal"):
        assert offer not in text, offer
    assert "Do not fetch data from the internet on this demo" in prompt


def test_the_standard_analyst_keeps_its_data_paths(tmp_path):
    agent = AnalystAgent(client=None, workspace=Workspace("visitor", root_dir=tmp_path / "ws"))
    agent._loaded_skills = {"meta"}
    agent._run_payload = {}
    prompt = agent._build_system_prompt()
    tools = agent._current_tools()
    visualize = next(tool for tool in tools if tool["function"]["name"] == "visualize")
    assert "connector_inputs" in visualize["function"]["parameters"]["properties"]
    assert "connected_data" in prompt and "connector forms" in prompt and "acquire remote data" in prompt
