"""The UIS demo shipped in data_formulator/spaces/shipped/unesco: its profile, images and build script."""

import hashlib
import importlib.util
import io
import json
import re
import zipfile
from pathlib import Path

import pytest
import yaml

from data_formulator import spaces
from data_formulator.spaces import builder
from data_formulator.session_format import SESSION_STATE_VERSION

pytestmark = [pytest.mark.backend]

REPO = Path(__file__).resolve().parents[3]
DEMO = spaces.shipped_space_dir("unesco")
# Loaded by path, as the app does: the demo folder is data, not a Python package.
_spec = importlib.util.spec_from_file_location("unesco_build", DEMO / "build.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)


def test_profile_is_served_with_its_datasets_and_live_stories(tmp_path, monkeypatch):
    monkeypatch.setenv("DF_SPACES_DIR", str(tmp_path))
    profile = spaces.space_profile("unesco")
    assert profile is not None
    assert "general readers" in spaces.space_analyst_rules("unesco")

    config = spaces.space_frontend_config("unesco")
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
    images = {name for name in spaces.referenced_files(profile) if name.endswith(".png")}
    committed = {path.relative_to(build.ASSETS).as_posix() for path in build.ASSETS.rglob("*") if path.is_file()}
    assert images == committed


def test_install_copies_the_profile_and_images(tmp_path):
    profile = yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))
    site = tmp_path / "unesco"
    builder.install_static(DEMO, profile, site)
    content = site / profile["release"]
    assert (site / "profile.yaml").read_bytes() == build.PROFILE.read_bytes()
    assert (site / "skill" / "SKILL.md").read_bytes() == (DEMO / "skill" / "SKILL.md").read_bytes()
    sessions = [name for name in spaces.referenced_files(profile) if name.endswith(".zip")]
    assert builder.missing_files(profile, content) == sessions


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
    for code, members in files.items():
        path = build.raw_path(raw, f"{code}.zip")
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, "w") as archive:
            for name, text in members.items():
                archive.writestr(name, text)


def test_download_takes_each_dataset_from_its_own_release(tmp_path, monkeypatch):
    urls = []

    def urlopen(url):
        urls.append(url)
        return io.BytesIO(b"zip")

    monkeypatch.setattr(build.urllib.request, "urlopen", urlopen)
    build.download(tmp_path)
    assert f"{build.BASE_URL}202611/SDG.zip" in urls and f"{build.BASE_URL}202602/SDG11.zip" in urls
    # Cached by release, so a newer release never reuses an older download.
    assert (tmp_path / "202611" / "SDG.zip").is_file() and (tmp_path / "202602" / "SDG11.zip").is_file()
    assert not list(tmp_path.rglob("*.part"))
    urls.clear()
    build.download(tmp_path)
    assert urls == []


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
    # The indicator list is named as the whole catalog, so it is not mistaken for a query result.
    assert tables["sdg11_indicators"]["displayId"] == "All SDG 11.4 heritage indicators (catalog)"
    assert tables["sdg11_national"]["displayId"] == "sdg11_national"
    # Loaded, as far as the app can tell, from the demo's data folder, so it shows that source and refreshes from it.
    assert tables["sdg11_national"]["sourceConfig"] | {"lastRefreshed": 0} == {
        "type": "database", "connectorId": "demo-unesco-data", "databaseTable": "culture/sdg11_national.parquet",
        "canRefresh": True, "lastRefreshed": 0, "originalTableName": "sdg11_national"}
    assert workspace.get_table_metadata("sdg11_national").source_table == "culture/sdg11_national.parquet"
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
                         "textTurns", "tableSemantics", "fileNodes", "focusedId", "canvasTabs", "canvasTabActive"}
    assert not any("dialog" in (table.get("derive") or {}) for table in seed["derivedTables"])
    tables = {table["id"] for table in seed["derivedTables"]}
    assert {path.stem for path in seed_dir.glob("*.parquet")} == {t["virtual"]["tableId"] for t in seed["derivedTables"]}
    # One question, answered: its prompt starts the conversation and matches the profile.
    prompts = [turn for turn in seed["textTurns"] if turn.get("prompt")]
    assert len(prompts) == 1 and prompts[0]["prompt"] == story["prompt"]
    assert prompts[0]["parentNodeId"].startswith("conversation-root:")
    files = {node["id"]: node for node in seed["fileNodes"]}
    ids = {turn["id"] for turn in seed["textTurns"]} | tables | set(files)
    assert all(turn["parentNodeId"] in ids for turn in seed["textTurns"] if turn is not prompts[0])
    assert all(node["parentNodeId"] in ids for node in [*seed["derivedTables"], *files.values()])
    # Its map or app: the files it names are in the seed, as made; it opens on the last, where the answer follows.
    assert files and {node["path"] for node in files.values()} == {path.name for path in (seed_dir / "files").iterdir()}
    for node in files.values():
        content = (seed_dir / "files" / node["path"]).read_bytes()
        assert hashlib.sha256(content).hexdigest() == node["contentHash"]
        if node["path"].endswith(".app.jsx"):
            manifest = json.loads(content.decode().split("\n", 1)[0].removeprefix("// @df-app "))
            assert manifest["title"] == node["displayName"] and set(manifest["tables"]) <= tables
        else:
            assert node["path"].endswith(".map.json") and json.loads(content)["data"]["table"] in tables
    lead = seed["fileNodes"][-1]
    assert seed["focusedId"] == {"type": "file", "fileName": lead["path"]}
    # Every map and app keeps a tab; the lead's is open.
    assert [tab["key"] for tab in seed["canvasTabs"]] == [f"file:{node['path']}" for node in seed["fileNodes"]]
    assert seed["canvasTabActive"] == f"file:{lead['path']}"
    assert seed["textTurns"][-1]["parentNodeId"] == lead["id"]
    # Charts draw the seed's tables with fields it defines.
    concepts = {item["id"] for item in seed["conceptShelfItems"]}
    assert all(chart["tableRef"] in tables for chart in seed["charts"])
    assert all(enc["fieldID"] in concepts for chart in seed["charts"] for enc in chart["encodingMap"].values() if enc.get("fieldID"))


def test_build_adds_a_story_to_its_dataset_session(tmp_path):
    from data_formulator.datalake.workspace_manager import WorkspaceManager

    profile = yaml.safe_load(build.PROFILE.read_text(encoding="utf-8"))
    starter = next(starter for starter in profile["starters"] if starter["id"] == "culture")
    story = next(story for story in starter["stories"] if story["id"] == "culture-c20")
    _fake_uis_download(tmp_path / "raw")
    content = tmp_path / "content"
    build.build_starter(starter, profile, tmp_path / "raw", tmp_path / "work", content)
    target = builder.build_story(DEMO, story, starter, tmp_path / "stories", content)

    workspace = WorkspaceManager(tmp_path / "import").create_and_open_workspace("check", "local:test")
    state = workspace.import_session_zip(io.BytesIO(target.read_bytes()))
    seed = json.loads((build.STORIES / story["id"] / "state.json").read_text(encoding="utf-8"))
    tables = workspace.get_metadata().tables
    assert {table["id"] for table in state["inputTables"]} <= set(tables)
    assert all(table["virtual"]["tableId"] in tables for table in state["derivedTables"])
    assert state["charts"] == seed["charts"] and state["textTurns"] == seed["textTurns"]
    assert state["activeWorkspace"] == {"id": "culture-c20", "displayName": story["headline"]}
    # Its map is in the workspace as the analyst saves one: under its title, for the analyst to revise.
    (node,) = state["fileNodes"]
    saved = workspace.get_metadata().files[node["path"]]
    assert saved.content_hash == node["contentHash"] and saved.display_name == node["displayName"]
    assert saved.origin == "agent" and saved.media_type == "application/json"
    # The seed's code is signed by this installation, so the app can refresh its tables.
    from data_formulator.security.code_signing import verify_code
    derives = [table["derive"] for table in state["derivedTables"] if (table.get("derive") or {}).get("code")]
    assert derives and all(verify_code(derive["code"], derive["codeSignature"]) for derive in derives)



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
    # Each dataset table's source is in the data folder, where the session says it is.
    with zipfile.ZipFile(content / "culture.zip") as archive:
        state = json.loads(archive.read("state.json"))
    paths = [table["sourceConfig"]["databaseTable"] for table in state["inputTables"]]
    assert paths and all((content / "data" / path).is_file() for path in paths)
    assert lines[0] == "building culture" and any("story culture-c20" in line for line in lines)
    assert build._log is print


def test_install_rejects_unknown_datasets(tmp_path):
    with pytest.raises(build.InstallError, match="unknown datasets: nope"):
        build.install(tmp_path, tmp_path / "raw", only=["nope"], download_missing=False, log=lambda line: None)
