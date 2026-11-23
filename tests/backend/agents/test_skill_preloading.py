"""Skills a request starts with, chosen from the session (not the request's wording)."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.workspace_inputs import WorkspaceInputManifest, WorkspaceInputRef

pytestmark = [pytest.mark.backend]

DATA = WorkspaceInputManifest(inputs=(WorkspaceInputRef(
    id="data:h:sales", kind="data", display_name="sales", media_type=None, size_bytes=1, content_hash="h",
    capabilities=("python",)),))


@pytest.fixture
def agent(monkeypatch):
    monkeypatch.setattr("data_formulator.configuration.terminal_mode", lambda: "ask")
    return AnalystAgent(client=SimpleNamespace(model="x"), workspace=SimpleNamespace(user_home=None),
                        skill_registry=build_registry(), identity_id=None)


def test_a_session_with_data_starts_with_the_baseline_only(agent):
    assert agent._initial_loaded_skills(DATA, None) == {"meta"}


def test_an_empty_session_starts_ready_to_acquire_data_or_set_up_a_source(agent):
    assert agent._initial_loaded_skills(WorkspaceInputManifest(inputs=())) == {
        "meta", "connected_data", "configure", "terminal"}


def test_a_connector_form_preloads_configure(agent):
    assert agent._initial_loaded_skills(DATA, {"connector": "postgres"}) == {"meta", "configure"}
