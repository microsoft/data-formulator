from dataclasses import FrozenInstanceError, asdict, replace
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.agent_config import ANALYST_EXECUTION_DEFAULTS, AnalystExecutionConfig
from data_formulator.analyst.agent import AnalystAgent
from data_formulator.datalake.workspace import Workspace


def test_analyst_execution_defaults():
    assert asdict(ANALYST_EXECUTION_DEFAULTS) == {
        "max_actions": 10,
        "max_tool_rounds_per_action": 12,
        "empty_response_retries": 2,
        "empty_response_backoff_seconds": 3.0,
        "stream_open_retries": 2,
        "stream_open_backoff_seconds": 1.0,
        "outer_iteration_multiplier": 3,
        "min_outer_iterations": 12,
    }
    assert ANALYST_EXECUTION_DEFAULTS.max_outer_iterations == 30
    assert replace(ANALYST_EXECUTION_DEFAULTS, max_actions=1).max_outer_iterations == 12
    assert replace(ANALYST_EXECUTION_DEFAULTS, max_actions=5).max_outer_iterations == 15
    with pytest.raises(FrozenInstanceError):
        setattr(ANALYST_EXECUTION_DEFAULTS, "max_actions", 20)


@pytest.mark.parametrize("overrides", [
    {"max_actions": 0}, {"max_actions": True}, {"max_actions": "10"},
    {"max_tool_rounds_per_action": -1}, {"max_tool_rounds_per_action": 1.5},
    {"outer_iteration_multiplier": 0}, {"min_outer_iterations": 0},
    {"empty_response_retries": -1}, {"empty_response_retries": False},
    {"stream_open_retries": -1}, {"stream_open_retries": 0.5},
    {"empty_response_backoff_seconds": -1}, {"empty_response_backoff_seconds": float("nan")},
    {"stream_open_backoff_seconds": float("inf")}, {"stream_open_backoff_seconds": True},
])
def test_invalid_execution_config_is_rejected(overrides):
    with pytest.raises(ValueError, match=next(iter(overrides))):
        AnalystExecutionConfig(**overrides)


def test_legacy_action_override_does_not_mutate_config():
    config = AnalystExecutionConfig(max_actions=7, max_tool_rounds_per_action=4)
    workspace = SimpleNamespace(user_home=None)
    agent = AnalystAgent(client=None, workspace=workspace, execution_config=config,
                         max_iterations=10, max_repair_attempts=99)
    assert agent.max_iterations == agent.execution_config.max_actions == 10
    assert agent.execution_config.max_tool_rounds_per_action == 4
    assert config.max_actions == 7
    assert ANALYST_EXECUTION_DEFAULTS.max_actions == 10
    assert AnalystAgent(client=None, workspace=workspace).execution_config == ANALYST_EXECUTION_DEFAULTS
    assert AnalystAgent(client=None, workspace=workspace, execution_config=config).max_iterations == 7


def test_each_workspace_session_gets_a_stable_prompt_cache_key():
    from data_formulator.agents.client_utils import Client

    workspace = SimpleNamespace(user_home=None)
    keys = [AnalystAgent(client=Client("openai", "gpt-5", api_key="k"), workspace=workspace,
                         identity_id="user", workspace_id=session).client.prompt_cache_key
            for session in ("session-a", "session-a", "session-b")]
    assert keys[0] == keys[1] != keys[2]
    assert "session-a" not in keys[0] and "user" not in keys[0]


def test_effective_execution_config_is_logged(tmp_path):
    config = AnalystExecutionConfig(max_actions=7, max_tool_rounds_per_action=4)
    agent = AnalystAgent(client=SimpleNamespace(model="test"),
                         workspace=Workspace("test-user", root_dir=tmp_path), execution_config=config)
    agent._reasoning_log = MagicMock()
    with (
        patch.object(agent, "_get_next_action", return_value=iter([{
            "type": "agent_action", "action_data": None, "reason": "done", "final_text": "Done.",
        }])),
        patch("data_formulator.analyst.agent.render_external_reference_context", return_value=""),
    ):
        events = list(agent.run([], "Summarize", trajectory=[{"role": "user", "content": "Summarize"}]))
    assert events[-1]["type"] == "completion"
    session_start = next(call for call in agent._reasoning_log.log.call_args_list if call.args[0] == "session_start")
    assert session_start.kwargs["execution_config"] == asdict(config)


@pytest.mark.parametrize("retries", [0, 1, 2])
def test_stream_open_retry_budget_and_backoff(retries):
    client = MagicMock(model="test")
    client.get_completion_with_tools.side_effect = TimeoutError("timed out")
    agent = AnalystAgent(client=client, workspace=SimpleNamespace(user_home=None),
                         execution_config=AnalystExecutionConfig(
                             stream_open_retries=retries, stream_open_backoff_seconds=0.25))
    with patch("data_formulator.analyst.agent.time.sleep") as sleep:
        with pytest.raises(TimeoutError):
            agent._open_stream([], [])
    assert client.get_completion_with_tools.call_count == retries + 1
    assert [call.args[0] for call in sleep.call_args_list] == [0.25 * 2 ** attempt for attempt in range(retries)]


def test_stream_open_retries_recover_without_retrying_permanent_errors():
    client = MagicMock(model="test")
    chunks = [SimpleNamespace(choices=[])]
    client.get_completion_with_tools.side_effect = [TimeoutError("timed out"), iter(chunks)]
    agent = AnalystAgent(client=client, workspace=SimpleNamespace(user_home=None))
    with patch("data_formulator.analyst.agent.time.sleep") as sleep:
        assert list(agent._open_stream([], [])) == chunks
    sleep.assert_called_once_with(1.0)
    client.get_completion_with_tools.reset_mock(side_effect=True)
    client.get_completion_with_tools.side_effect = ValueError("invalid model")
    with patch("data_formulator.analyst.agent.time.sleep") as sleep:
        with pytest.raises(ValueError, match="invalid model"):
            agent._open_stream([], [])
    client.get_completion_with_tools.assert_called_once()
    sleep.assert_not_called()