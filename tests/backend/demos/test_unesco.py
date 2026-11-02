"""The UIS demo shipped in data_formulator/demos/unesco: its profile, images and build script."""

import importlib.util
import io
import json
import re
import zipfile
from pathlib import Path

import pytest
import yaml

from data_formulator import sites
from data_formulator.session_format import SESSION_STATE_VERSION

pytestmark = [pytest.mark.backend]

REPO = Path(__file__).resolve().parents[3]
DEMO = sites.packaged_demo_dir("unesco")
# Loaded by path, as the app does: the demo folder is data, not a Python package.
_spec = importlib.util.spec_from_file_location("unesco_build", DEMO / "build.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)


def test_profile_is_served_with_its_datasets_and_live_stories(tmp_path, monkeypatch):
    monkeypatch.setenv("DF_SITES_DIR", str(tmp_path))
    profile = sites.site_profile("unesco")
    assert profile is not None
    assert "general readers" in sites.site_analyst_rules("unesco")

    config = sites.site_frontend_config("unesco")
    assert config["name"] == "UIS Data Explorer" and config["badge"] == "Beta" and config["disclaimer"]
    assert any("{release}" in item for item in config["about"])
    assert config["suggestions"] == [] and config["chat_placeholder"]
    assert config["starters"] and not any(starter["available"] for starter in config["starters"])

    stories = [story for starter in config["starters"] for story in starter["stories"]]
    assert len({story["id"] for story in stories}) == len(stories) == 16
    for starter in profile["starters"]:
        assert starter["file"].endswith(".zip") and starter["id"] in build.STARTERS
        assert starter["icon"] in {"school", "science", "landmark", "chart", "table"}
    for story in stories:
        assert story["prompt"] and len(story["prompt"]) < 300 and story["follow_ups"]
        assert story["available"] is False  # its session is built by build.py, not committed


def test_every_image_the_profile_names_is_committed_and_nothing_else():
    profile = yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))
    images = {name for name in build.referenced_files(profile) if name.endswith(".png")}
    committed = {path.relative_to(build.ASSETS).as_posix() for path in build.ASSETS.rglob("*") if path.is_file()}
    assert images == committed


def test_install_copies_the_profile_and_images(tmp_path):
    profile = yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))
    site = tmp_path / "unesco"
    build.install_static(profile, site)
    content = site / profile["release"]
    assert (site / "profile.yaml").read_bytes() == build.PROFILE.read_bytes()
    assert (site / "skill" / "SKILL.md").read_bytes() == (DEMO / "skill" / "SKILL.md").read_bytes()
    sessions = [name for name in build.referenced_files(profile) if name.endswith(".zip")]
    assert build.missing_files(profile, content) == sessions


def _fake_uis_download(raw: Path) -> None:
    """A few rows in the shape of the UIS bulk zips: enough to run the real build."""
    files = {
        "SDG11": {
            "SDG11_COUNTRY.csv": "country_id,country_name_en\nFRA,France\nKEN,Kenya\n",
            "SDG11_LABEL.csv": "indicator_id,indicator_label_en\nHER.1,Heritage spending per person\n",
            "SDG11_DATA_NATIONAL.csv": ("indicator_id,country_id,year,value,magnitude,qualifier\n"
                                        "HER.1,FRA,2022,40.5,,\nHER.1,KEN,2022,1.2,,UIS_EST\n"),
            "SDG11_DATA_REGIONAL.csv": ("indicator_id,region_id,year,value,magnitude,qualifier\n"
                                        "HER.1,SDG: Europe,2022,30.1,,\n"),
            "SDG11_REGION.csv": "region_id,country_id,country_name_en\nSDG: Europe,FRA,France\n",
            "SDG11 README.md": "# Heritage\n",
        },
        "DEM": {
            "DEM_COUNTRY.csv": "country_id,country_name_en\nFRA,France\nKEN,Kenya\n",
            "DEM_LABEL.csv": "indicator_id,indicator_label_en\nPOP,Population\n",
            "DEM_DATA_NATIONAL.csv": "indicator_id,country_id,year,value,magnitude,qualifier\nPOP,FRA,2022,68000000,,\n",
        },
    }
    raw.mkdir()
    for code, members in files.items():
        with zipfile.ZipFile(raw / f"{code}.zip", "w") as archive:
            for name, text in members.items():
                archive.writestr(name, text)


def test_build_makes_a_session_data_formulator_can_open(tmp_path):
    from data_formulator.datalake.workspace_manager import WorkspaceManager

    profile = yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))
    starter = next(starter for starter in profile["starters"] if starter["id"] == "culture")
    _fake_uis_download(tmp_path / "raw")
    target = build.build_starter(starter, profile, tmp_path / "raw", tmp_path / "work", tmp_path / "out")
    assert target == tmp_path / "out" / starter["file"]

    workspace = WorkspaceManager(tmp_path / "import").create_and_open_workspace("check", "local:test")
    state = workspace.import_session_zip(io.BytesIO(target.read_bytes()))
    tables = {table["id"]: table for table in state["inputTables"]}
    assert set(tables) == {"sdg11_indicators", "sdg11_national", "sdg11_regional", "dem_indicators",
                           "dem_national", "countries", "region_members"}
    assert tables["sdg11_national"]["snapshot"]["rowCount"] == 2
    assert state["activeWorkspace"] == {"id": "culture", "displayName": starter["title"]}
    with zipfile.ZipFile(target) as archive:
        guide = next(name for name in archive.namelist() if name.endswith("UIS data guide.md"))
        assert "`sdg11_national` (2 rows)" in archive.read(guide).decode()


def _stories():
    profile = yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))
    return [(starter, story) for starter in profile["starters"] for story in starter.get("stories") or []]


@pytest.mark.parametrize("story_id", [story["id"] for _, story in _stories()])
def test_each_story_has_a_seed_that_holds_together(story_id):
    story = next(story for _, story in _stories() if story["id"] == story_id)
    seed_dir = build.STORIES / story_id
    seed = json.loads((seed_dir / "state.json").read_text(encoding="utf-8"))
    assert story["file"] == f"stories/{story_id}.zip"
    # Only the analysis: no model or connection settings, UI layout, messages or agent transcripts.
    assert set(seed) <= {"__stateVersion", "activeWorkspace", "derivedTables", "charts", "conceptShelfItems",
                         "textTurns", "tableSemantics", "focusedId"}
    assert not any("dialog" in (table.get("derive") or {}) for table in seed["derivedTables"])
    tables = {table["id"] for table in seed["derivedTables"]}
    assert {path.stem for path in seed_dir.glob("*.parquet")} == {t["virtual"]["tableId"] for t in seed["derivedTables"]}
    # One question, answered: its prompt starts the conversation and matches the profile.
    prompts = [turn for turn in seed["textTurns"] if turn.get("prompt")]
    assert len(prompts) == 1 and prompts[0]["prompt"] == story["prompt"]
    assert prompts[0]["parentNodeId"].startswith("conversation-root:")
    ids = {turn["id"] for turn in seed["textTurns"]} | tables
    assert all(turn["parentNodeId"] in ids for turn in seed["textTurns"] if turn is not prompts[0])
    # Charts draw the seed's tables with fields it defines, and the first is focused.
    concepts = {item["id"] for item in seed["conceptShelfItems"]}
    assert seed["charts"] and all(chart["tableRef"] in tables for chart in seed["charts"])
    assert all(enc["fieldID"] in concepts for chart in seed["charts"] for enc in chart["encodingMap"].values() if enc.get("fieldID"))
    assert seed["focusedId"] == {"type": "chart", "chartId": seed["charts"][0]["id"]}
    if seed["charts"][0]["chartType"] == "Choropleth":
        assert [chart["chartType"] for chart in seed["charts"]] == ["Choropleth", "Bar Chart"]


def test_build_adds_a_story_to_its_dataset_session(tmp_path):
    from data_formulator.datalake.workspace_manager import WorkspaceManager

    profile = yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))
    starter = next(starter for starter in profile["starters"] if starter["id"] == "culture")
    story = next(story for story in starter["stories"] if story["id"] == "culture-c20")
    _fake_uis_download(tmp_path / "raw")
    content = tmp_path / "content"
    build.build_starter(starter, profile, tmp_path / "raw", tmp_path / "work", content)
    target = build.build_story(story, starter, tmp_path / "stories", content)

    workspace = WorkspaceManager(tmp_path / "import").create_and_open_workspace("check", "local:test")
    state = workspace.import_session_zip(io.BytesIO(target.read_bytes()))
    seed = json.loads((build.STORIES / story["id"] / "state.json").read_text(encoding="utf-8"))
    tables = workspace.get_metadata().tables
    assert {table["id"] for table in state["inputTables"]} <= set(tables)
    assert all(table["virtual"]["tableId"] in tables for table in state["derivedTables"])
    assert state["charts"] == seed["charts"] and state["textTurns"] == seed["textTurns"]
    assert state["activeWorkspace"] == {"id": "culture-c20", "displayName": story["headline"]}



def test_session_state_version_matches_the_frontend():
    source = (REPO / "src" / "app" / "stateMigrations.ts").read_text(encoding="utf-8")
    assert int(re.search(r"DF_STATE_VERSION\s*=\s*(\d+)", source).group(1)) == SESSION_STATE_VERSION


def test_install_builds_and_reports_what_is_still_missing(tmp_path):
    _fake_uis_download(tmp_path / "raw")
    lines = []
    with pytest.raises(build.InstallError, match="missing from"):
        build.install(tmp_path / "sites", tmp_path / "raw", only=["culture"], download_missing=False, log=lines.append)
    content = tmp_path / "sites" / "unesco" / yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))["release"]
    assert (content / "culture.zip").is_file() and (content / "stories" / "culture-c20.zip").is_file()
    assert (tmp_path / "sites" / "unesco" / "profile.yaml").is_file()
    assert lines[0] == "building culture" and any("story culture-c20" in line for line in lines)
    assert build._log is print


def test_install_rejects_unknown_datasets(tmp_path):
    with pytest.raises(build.InstallError, match="unknown datasets: nope"):
        build.install(tmp_path, tmp_path / "raw", only=["nope"], download_missing=False, log=lambda line: None)
