"""The space skill (design-docs/69): only on space requests, loading a space's datasets."""

from __future__ import annotations

import json
from pathlib import Path

import flask
import pyarrow as pa
import pytest

from data_formulator import spaces
from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.session_files import SessionFiles
from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.datalake.workspace import Workspace
from data_formulator.spaces.datasets import space_datasets, load_datasets
from data_formulator.spaces.skill import space_skill_body

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
    monkeypatch.delenv("DF_SPACE", raising=False)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("DF_SPACES_DIR", str(tmp_path / "content"))
    monkeypatch.setattr(spaces, "SHIPPED_SPACES", tmp_path / "shipped")
    for space_id, profile in (("demo", PROFILE), ("other", OTHER_PROFILE)):
        (tmp_path / "content" / space_id / "r1").mkdir(parents=True)
        (tmp_path / "content" / space_id / "profile.yaml").write_text(profile, encoding="utf-8")
    content = tmp_path / "content" / "demo" / "r1"
    (content / "culture.zip").write_bytes(_dataset_zip(tmp_path, "culture", {"spending": [1, 2], "countries": [1]},
                                                       {"guide.md": "culture guide", "docs/shared.md": "same"}))
    (content / "education.zip").write_bytes(_dataset_zip(tmp_path, "education", {"schools": [3], "countries": [1]},
                                                         {"guide.md": "education guide", "docs/shared.md": "same"}))
    (tmp_path / "content" / "other" / "r1" / "science.zip").write_bytes(
        _dataset_zip(tmp_path, "science", {"research": [4]}, {}))
    spaces.space_profile.cache_clear()
    yield
    spaces.space_profile.cache_clear()


def _ctx(workspace, demo: str | None = "demo") -> SkillContext:
    return SkillContext(client=None, workspace=workspace, payload={"space": demo, "input_tables": []})


def _run(generator):
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value


def _skill():
    return build_registry().with_space("demo").get_skill("space")


# -- only on demos ------------------------------------------------------------------------------


def test_the_standard_registry_never_has_the_space_skill():
    registry = build_registry()
    assert not registry.has("space")
    assert registry.action_owner("load_datasets") is None
    for space_id in (None, "", "missing", "../etc"):
        assert registry.with_space(space_id) is registry


def test_a_space_registry_is_a_copy_with_the_space_skill_and_every_other_skill(tmp_path):
    registry = build_registry()
    demo = registry.with_space("demo")
    assert demo.has("space") and demo.action_owner("load_datasets") == "space"
    assert set(demo.metas) == set(registry.metas) | {"space"}
    assert demo.tool_specs == {**registry.tool_specs, "space": demo.tool_specs["space"]}
    assert not registry.has("space")
    # Its data is the demo's sources: the analyst's sources/ folder stays.
    assert SessionFiles(_ctx(Workspace("visitor", root_dir=tmp_path / "ws"))).sources.enabled


def test_a_space_without_installed_datasets_gets_no_skill(tmp_path):
    for name in ("culture.zip", "education.zip"):
        (tmp_path / "content" / "demo" / "r1" / name).unlink()
    assert not build_registry().with_space("demo").has("space")


def test_only_a_space_agent_preloads_the_skill(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    standard = AnalystAgent(client=None, workspace=workspace)
    assert "space" not in standard._initial_loaded_skills(None)
    assert not standard._build_skill_body_message("space")[0]  # load_skill("space") fails
    demo = AnalystAgent(client=None, workspace=workspace, space="demo")
    assert "space" in demo._initial_loaded_skills(None)


def test_a_resumed_conversation_does_not_reopen_the_skill_outside_the_space(tmp_path):
    agent = AnalystAgent(client=None, workspace=Workspace("visitor", root_dir=tmp_path / "ws"))
    agent._loaded_skills = {"meta"}
    trajectory = [{"role": "user", "content": "[SKILL LOADED: space] You can now use the action(s): load_datasets."}]
    agent._rehydrate_loaded_skills(trajectory)
    assert "space" not in agent._loaded_skills
    assert "no longer available" in trajectory[0]["content"]


def test_only_a_request_naming_a_space_is_a_space_request():
    app = flask.Flask(__name__)
    with app.test_request_context("/", headers={"X-DF-Space": "demo"}):
        assert spaces.current_space() == "demo"
    for headers in ({}, {"X-DF-Space": "missing"}):
        with app.test_request_context("/", headers=headers):
            assert spaces.current_space() is None


def test_the_handler_refuses_outside_a_space(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    events, observation = _run(_skill().handle_action("load_datasets", {"datasets": ["culture"]}, _ctx(workspace, demo=None)))
    assert observation.startswith("[ERROR]") and events[0]["type"] == "error"
    assert workspace.list_tables() == []


def test_a_space_cannot_load_another_spaces_datasets(tmp_path):
    workspace = Workspace("visitor", root_dir=tmp_path / "ws")
    _, observation = _run(_skill().handle_action("load_datasets", {"datasets": ["science"]}, _ctx(workspace)))
    assert "Unknown dataset" in observation and workspace.list_tables() == []


# -- datasets -----------------------------------------------------------------------------------


def test_the_body_lists_datasets_shared_tables_and_examples():
    body = space_skill_body("demo")
    assert "# This space: Demo Explorer" in body and "Explore two small datasets." in body
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
    assert [dataset.id for dataset in space_datasets("demo")] == ["culture", "education"]


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


def test_the_space_has_no_session_suggestions():
    registry = build_registry().with_space("demo")
    assert registry.action_owner("suggest_sessions") is None
    assert [spec["function"]["name"] for spec in registry.action_tools_for(["space"])] == ["load_datasets"]


def test_the_standard_analyst_keeps_its_data_paths(tmp_path):
    agent = AnalystAgent(client=None, workspace=Workspace("visitor", root_dir=tmp_path / "ws"))
    agent._loaded_skills = {"meta"}
    agent._run_payload = {}
    prompt = agent._build_system_prompt()
    tools = agent._current_tools()
    visualize = next(tool for tool in tools if tool["function"]["name"] == "visualize")
    assert "connector_inputs" in visualize["function"]["parameters"]["properties"]
    assert "connected_data" in prompt and "connector forms" in prompt and "acquire remote data" in prompt


# -- the data folder ----------------------------------------------------------------------------


def test_a_data_folder_holds_the_datasets_tables_and_is_offered_only_on_its_space(tmp_path, monkeypatch):
    import pyarrow.parquet as pq
    from data_formulator import data_connector
    from data_formulator.spaces.data_folder import write_data_folders

    profile = tmp_path / "content" / "demo" / "profile.yaml"
    profile.write_text(PROFILE + "sources:\n  - folder: data\n    name: Demo datasets\n", encoding="utf-8")
    spaces.space_profile.cache_clear()
    content = tmp_path / "content" / "demo" / "r1"
    write_data_folders(spaces.space_profile("demo"), content, log=lambda line: None)
    files = sorted(str(path.relative_to(content / "data")) for path in (content / "data").rglob("*.parquet"))
    assert files == ["culture/countries.parquet", "culture/spending.parquet", "education/countries.parquet",
                     "education/schools.parquet"]
    assert pq.read_table(content / "data" / "culture" / "spending.parquet").column("value").to_pylist() == [1, 2]

    monkeypatch.setattr(data_connector, "DATA_CONNECTORS", {})
    monkeypatch.setattr(data_connector, "_ADMIN_CONNECTOR_IDS", set())
    monkeypatch.setattr(data_connector, "_SPACE_FOLDER_CONNECTORS", {})
    monkeypatch.setattr(data_connector, "_sync_installation_connectors", lambda: None)
    app = flask.Flask(__name__)
    with app.test_request_context("/", headers={"X-DF-Space": "demo"}):
        assert data_connector.visible_admin_connector_ids() == {"demo-demo-data"}
        connector = data_connector.DATA_CONNECTORS["demo-demo-data"]
        assert connector._display_name == "Demo datasets" and connector._uses_configured_params()
        assert connector._default_params["root_dir"] == str(content / "data")
    for headers in ({}, {"X-DF-Space": "other"}):
        with app.test_request_context("/", headers=headers):
            assert "demo-demo-data" not in data_connector.visible_admin_connector_ids()
