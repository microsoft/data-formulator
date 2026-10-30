from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.map.geo import country_id, county_id, normalize_name, region_id, state_id
from data_formulator.analyst.skills.map.validate import check_structure, validate_map
from data_formulator.datalake.workspace import Workspace


pytestmark = [pytest.mark.backend]

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
def workspace(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({
        "country": ["United States", "Congo, Dem. Rep.", "Côte d'Ivoire", "World", "KOR"],
        "year": [2019, 2020, 2020, 2020, 2020],
        "value": [1.0, 2.0, 3.0, 4.0, 5.0],
    }), "indicators")
    workspace.write_parquet(pd.DataFrame({
        "city": ["Seattle", "Austin"], "lon": [-122.3, -97.7], "lat": [47.6, 30.3], "pop": [0.7, 1.0],
    }), "cities")
    return workspace


def _map(**overrides):
    body = {
        "view": {"basemap": "world"},
        "data": {"ind": {"table": "indicators"}},
        "layers": [{"id": "ind", "type": "regions", "data": "ind", "key": "country", "color": {"field": "value"}}],
        "controls": [{"type": "slider", "field": "year", "data": "ind", "play": True}],
    }
    body.update(overrides)
    return body


def _run(workspace, spec):
    skill = build_registry().get_skill("map")
    ctx = SkillContext(client=None, workspace=workspace, payload={"input_tables": []})
    generator = skill.handle_action("write_map", spec, ctx)
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value


def test_registry_exposes_write_map_and_routes_maps_to_it() -> None:
    registry = build_registry()
    assert registry.action_owner("write_map") == "map"
    schema = {tool["function"]["name"]: tool["function"] for tool in registry.action_tools_for(["map"])}["write_map"]
    assert set(schema["parameters"]["required"]) == {"title", "map"}
    body = registry.load_body("map")
    assert all(term in body for term in ("write_map", "keyType", "bivariate", "selectionFilter", "dorling", "great-circle", "semanticType", "theme"))
    assert "load `map`" in registry.load_body("meta")


def test_country_and_state_keys_resolve_like_the_renderer() -> None:
    assert {country_id(value) for value in ["USA", "US", "840", 840, "United States", "united states of america"]} == {"USA"}
    assert country_id("Congo, Dem. Rep.") == "COD" and country_id("Côte d'Ivoire") == "CIV" and country_id("Cote d'Ivoire") == "CIV"
    assert country_id("Korea, Rep.") == "KOR" and country_id("UK") == "GBR" and country_id("Kosovo") == "XKX"
    assert country_id("World") is None and country_id("FR", "iso3") is None
    assert state_id("CA") == state_id("California") == state_id(6) == state_id("06") == "06"
    assert state_id("Washington DC") == "11" and state_id("99") is None
    assert county_id(6037) == "06037" and county_id("99001") is None
    assert region_id("Texas", "us-states") == "48" and region_id("48201", "us-counties") == "48201"
    assert normalize_name("The Gambia") == "gambia"


def test_country_table_matches_the_renderers_copy() -> None:
    python_copy = json.loads((REPO / "py-src/data_formulator/analyst/skills/map/countries.json").read_text(encoding="utf-8"))
    frontend_copy = json.loads((REPO / "src/maps/data/countries.json").read_text(encoding="utf-8"))
    assert python_copy == frontend_copy


@pytest.mark.parametrize("spec, message", [
    ({"layers": "x"}, "layers must be a list"),
    ({"layers": [{"type": "pie", "data": "d"}]}, "type must be one of"),
    ({"data": {"d": {"values": []}}, "layers": [{"type": "regions", "data": "d"}]}, "regions need key"),
    ({"data": {"d": {"values": []}}, "layers": [{"type": "points", "data": "d", "lon": "x"}]}, "need lon and lat"),
    ({"data": {"d": {"values": []}}, "layers": [{"type": "flows", "data": "d", "from": {"key": "a"}}]}, "flows need from and to"),
    ({"data": {"d": {"values": []}}, "layers": [{"type": "regions", "data": "e", "key": "k"}]}, "not defined in data"),
    ({"data": {"d": {"values": []}}, "layers": [{"type": "regions", "data": "d", "key": "k", "color": {"field": {"param": "m"}}}]},
     "which no control defines"),
    ({"data": {"d": {"values": []}}, "layers": [{"type": "regions", "data": "d", "key": "k", "color": {"type": "bivariate", "field": "a"}}]},
     "needs field and field2"),
    ({"view": {"projection": "robinson"}, "layers": []}, "view.projection must be one of"),
    ({"data": {"d": {"values": []}}, "layers": [{"id": "a", "type": "points", "data": "d", "lon": "x", "lat": "y",
                                               "selectionFilter": {"layer": "zz", "field": "f"}}]}, "does not exist"),
])
def test_structure_errors_explain_the_fix(spec, message) -> None:
    errors, _ = check_structure(spec)
    assert any(message in error for error in errors), errors


def test_write_map_saves_validated_spec_and_reports_unmatched_keys(workspace) -> None:
    events, observation = _run(workspace, {"filename": "indicators.map.json", "title": "Indicators", "map": _map()})

    assert [event["type"] for event in events] == ["action"]
    assert events[0]["action"] == "write_map" and events[0]["file"]["path"] == "files/indicators.map.json"
    metadata, content = workspace.read_workspace_file("indicators.map.json")
    saved = json.loads(content)
    assert saved["title"] == "Indicators" and saved["version"] == 1 and saved["layers"][0]["key"] == "country"
    assert (metadata.media_type, metadata.display_name, metadata.origin) == ("application/json", "Indicators", "agent")
    result = json.loads(observation)
    assert result["status"] == "delivered" and result["tables"] == ["indicators"]
    assert len(result["warnings"]) == 1 and "1 of 5" in result["warnings"][0] and "'World'" in result["warnings"][0]


@pytest.mark.parametrize("change, message", [
    ({"layers": [{"type": "regions", "data": "ind", "key": "nation", "color": {"field": "value"}}]}, '"nation" is not a column'),
    ({"data": {"ind": {"table": "missing"}}}, "Unknown workspace tables: missing"),
    ({"controls": [{"type": "slider", "field": "decade", "data": "ind"}]}, '"decade" is not a column'),
])
def test_write_map_refuses_specs_that_do_not_fit_the_data(workspace, change, message) -> None:
    events, observation = _run(workspace, {"filename": "bad.map.json", "title": "Bad", "map": _map(**change)})
    assert events[0]["type"] == "error" and message in observation
    assert observation.startswith("[MAP NOT CREATED]")
    assert not [item for item in workspace.list_workspace_files() if item.name == "bad.map.json"]


def test_validation_warns_about_swapped_coordinates_and_constant_controls(workspace) -> None:
    spec = {
        "data": {"c": {"table": "cities"}},
        "layers": [{"type": "points", "data": "c", "lon": "lat", "lat": "lon"}],
        "controls": [{"type": "checkboxes", "field": "city", "data": "c"}],
    }
    warnings = validate_map(spec, workspace)["warnings"]
    assert any("out-of-range" in warning and "swapped" in warning for warning in warnings)
    spec["layers"][0].update(lon="lon", lat="lat")
    assert validate_map(spec, workspace)["warnings"] == []


def test_validation_warns_when_a_checkbox_filter_has_too_many_values(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({
        "lon": [float(i) for i in range(40)], "lat": [float(i) for i in range(40)], "twh": [i + 0.5 for i in range(40)],
    }), "plants")
    spec = {
        "data": {"p": {"table": "plants"}},
        "layers": [{"type": "points", "data": "p", "lon": "lon", "lat": "lat"}],
        "controls": [{"type": "checkboxes", "field": "twh", "data": "p"}],
    }
    assert any("40 distinct values" in warning for warning in validate_map(spec, workspace)["warnings"])


def test_edit_file_validates_map_revisions_and_create_file_points_to_write_map(workspace) -> None:
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
    _run(workspace, {"filename": "indicators.map.json", "title": "Indicators", "map": _map()})
    ctx = SkillContext(client=None, workspace=workspace, payload={"input_tables": []})
    metadata, original = workspace.read_workspace_file("indicators.map.json")

    with pytest.raises(ValueError, match=r"\[MAP NOT UPDATED\].*\"nope\" is not a column"):
        WorkspaceSkill().handle_tool("edit_file", {"path": "files/indicators.map.json", "expected_content_hash": metadata.content_hash,
            "replacements": [{"old_text": '"field": "value"', "new_text": '"field": "nope"'}]}, ctx)
    assert workspace.read_workspace_file("indicators.map.json")[1] == original

    result = json.loads(WorkspaceSkill().handle_tool("edit_file", {"path": "files/indicators.map.json",
        "expected_content_hash": metadata.content_hash,
        "replacements": [{"old_text": '"title": "Indicators"', "new_text": '"title": "World indicators"'}]}, ctx).text)
    assert result["app"] is True and result["display_name"] == "World indicators" and result["tables"] == ["indicators"]

    with pytest.raises(ValueError, match="write_map"):
        WorkspaceSkill().handle_tool("create_file", {"filename": "x.map.json", "content": "{}"}, ctx)


def test_maps_count_as_apps_reading_their_tables(workspace) -> None:
    from data_formulator.analyst.skills.html_app.skill import read_app_manifest
    _run(workspace, {"filename": "indicators.map.json", "title": "Indicators", "map": _map()})
    text = workspace.read_workspace_file("indicators.map.json")[1].decode()
    assert read_app_manifest("indicators.map.json", text) == {"title": "Indicators", "tables": ["indicators"]}
    assert read_app_manifest("notes.json", text) is None


def test_styles_themes_and_field_annotations_validate() -> None:
    errors, warnings = check_structure({
        "view": {"style": "dark", "theme": "nyt", "labels": False},
        "fields": {"pop": "Count", "rate": {"semanticType": "Percentage", "divergingMidpoint": 10}},
        "data": {"d": {"values": []}},
        "layers": [{"type": "regions", "data": "d", "key": "k", "color": {"field": "pop"}},
                   {"type": "regions", "data": "d", "key": "k", "color": {"field": "rate"}}],
    })
    assert errors == []
    # Totals on a choropleth favour big regions; rates do not.
    assert len(warnings) == 1 and "pop" in warnings[0] and "bubbles" in warnings[0]
    errors, _ = check_structure({"view": {"style": "neon", "labels": "yes"}, "fields": {"x": 3}, "layers": []})
    assert any("view.style" in error for error in errors)
    assert any("view.labels" in error for error in errors)
    assert any("fields.x" in error for error in errors)


def test_template_maps_validate_against_the_data(workspace) -> None:
    from data_formulator.analyst.skills.map.templates import compile_template, template_errors
    template = {"template": "choropleth", "data": {"table": "indicators"},
                "encoding": {"region": "country", "color": "value", "time": "year"}}
    compiled = compile_template(template)
    assert compiled["layers"][0]["type"] == "regions" and compiled["controls"][0]["field"] == "year"
    assert template_errors({"template": "bubbles", "data": {}, "encoding": {"color": "x"}}) == [
        "bubbles needs encoding.region, or encoding.lat and encoding.lon.", "bubbles needs encoding.size."]

    events, observation = _run(workspace, {"filename": "t.map.json", "title": "Template", "map": template})
    assert events[0]["type"] == "action"
    saved = json.loads(workspace.read_workspace_file("t.map.json")[1])
    # The file keeps the template; the renderer compiles it.
    assert saved["template"] == "choropleth" and "layers" not in saved
    assert json.loads(observation)["tables"] == ["indicators"]

    events, observation = _run(workspace, {"filename": "bad.map.json", "title": "Bad",
                                           "map": {**template, "encoding": {"region": "nation", "color": "value"}}})
    assert events[0]["type"] == "error" and '"nation" is not a column' in observation


def test_template_channels_offer_column_options(workspace) -> None:
    from data_formulator.analyst.skills.map.templates import compile_template, template_errors
    workspace.write_parquet(pd.DataFrame({
        "country": ["USA", "FRA"], "fossil": [1.0, 2.0], "nuclear": [3.0, 4.0], "continent": ["NA", "EU"], "year": [2020, 2021],
    }), "energy")
    template = {"template": "bubbles", "data": {"table": "energy"}, "encoding": {
        "region": "country", "size": ["fossil", "nuclear"], "color": ["fossil", "nuclear"],
        "time": {"options": ["year"]}, "filter": {"field": "continent", "options": ["continent"]}}}
    compiled = compile_template(template)
    layer = compiled["layers"][0]
    assert layer["size"]["field"] == layer["color"]["field"] == {"param": "color"}
    assert layer["tooltip"] == ["fossil", "nuclear"]
    # One shared switch; time is offered but not shown, so no slider.
    assert [control["type"] for control in compiled["controls"]] == ["select", "checkboxes"]
    assert validate_map(template, workspace)["warnings"] == []

    assert template_errors({**template, "encoding": {"region": ["country"], "size": "fossil"}})[0].startswith(
        "encoding.region must be one column name")
    assert "encoding.size.field must be one of its options." in template_errors(
        {**template, "encoding": {"region": "country", "size": {"field": "x", "options": ["fossil"]}}})
    with pytest.raises(ValueError, match='encoding.time: "yr" is not a column'):
        validate_map({**template, "encoding": {**template["encoding"], "time": {"options": ["yr"]}}}, workspace)


def test_vector_maps_and_flow_direction_validate(workspace) -> None:
    from data_formulator.analyst.skills.map.templates import compile_template, template_errors
    workspace.write_parquet(pd.DataFrame({
        "lon": [-40.0, -37.0], "lat": [45.0, 48.0], "u": [5.0, -3.0], "v": [1.0, 4.0], "speed": [5.1, 5.0],
    }), "wind")
    template = {"template": "vectors", "data": {"table": "wind"},
                "encoding": {"lat": "lat", "lon": "lon", "u": "u", "v": "v", "color": "speed"}}
    layer = compile_template(template)["layers"][0]
    assert layer["type"] == "vectors" and (layer["u"], layer["v"]) == ("u", "v")
    assert validate_map(template, workspace)["warnings"] == []
    assert "encoding.u and encoding.v go together (east and north components)." in template_errors(
        {**template, "encoding": {"lat": "lat", "lon": "lon", "u": "u"}})
    assert any("needs encoding.angle or encoding.u" in error for error in template_errors(
        {**template, "encoding": {"lat": "lat", "lon": "lon"}}))
    with pytest.raises(ValueError, match='"heading" is not a column'):
        validate_map({**template, "encoding": {"lat": "lat", "lon": "lon", "angle": "heading"}}, workspace)

    flows = compile_template({"template": "flows", "data": {"table": "t"}, "encoding": {"origin": "a", "destination": "b"}})
    assert flows["layers"][0]["direction"] == "arrow"
    errors, _ = check_structure({"data": {"t": {"table": "t"}}, "layers": [
        {"type": "flows", "data": "t", "from": {"key": "a"}, "to": {"key": "b"}, "direction": "sideways"}]})
    assert any("direction must be one of" in error for error in errors)


def test_template_colour_property_is_checked() -> None:
    from data_formulator.analyst.skills.map.templates import template_errors
    base = {"template": "flows", "data": {"table": "t"}, "encoding": {"origin": "a", "destination": "b"}}
    assert template_errors({**base, "properties": {"color": "#e15759"}}) == []
    assert template_errors({**base, "properties": {"color": "darkslategray"}}) == []
    assert template_errors({**base, "properties": {"color": "not a colour!"}}) == [
        'properties.color must be a CSS colour, such as "#4e79a7" or "darkslategray".']
