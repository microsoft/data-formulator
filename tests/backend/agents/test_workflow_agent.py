from __future__ import annotations

import json
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest
import yaml

from data_formulator.datalake.workspace import Workspace
from data_formulator.workflows.agent import TOOLS, WorkflowAgent, new_run, public_run
from data_formulator.workflows.instances import WorkflowStore, parse_workflow, resolve_setup

pytestmark = [pytest.mark.backend]


@pytest.fixture
def instance():
    return {"version": 1, "name": "Live stocks", "overview": "Recurring review",
            "source": {"kind": "yahoo", "symbols": ["MSFT", "SPY"], "lookback_days": 30},
            "deliverables": ["Report"], "steps": [{"id": "work", "instructions": "Fetch, analyze, verify",
                "checkers": [{"id": "coverage", "condition": "All symbols accounted for", "on_fail": "work"}]}]}


@pytest.fixture
def agent(tmp_path, instance):
    workspace = Workspace("workflow-test", root_dir=tmp_path)
    state = new_run(instance, "test")
    return WorkflowAgent(MagicMock(), workspace, state, lambda value: None, Event(), "")


def test_workflow_setup_defaults_overrides_and_snapshot(instance):
    instance["parameters"] = [
        {"name": "symbol", "label": "Stock symbol", "required": True},
        {"name": "period", "label": "Period", "type": "select", "options": ["Month", "Year"], "default": "Month"},
        {"name": "days", "label": "Days", "type": "number", "default": 30},
        {"name": "details", "label": "Include details", "type": "boolean", "default": False},
    ]
    parsed = parse_workflow(yaml.safe_dump(instance))
    state = new_run(parsed, "setup", {"parameters": {"symbol": "AAPL", "days": 90}, "instructions": " Focus on volatility. "})
    assert state["setup"] == {"parameters": {"symbol": "AAPL", "period": "Month", "days": 90, "details": False},
                              "instructions": "Focus on volatility."}
    assert public_run(state)["setup"] == state["setup"]
    assert parsed == instance
    with pytest.raises(ValueError, match="Stock symbol"):
        new_run(parsed, "missing")


@pytest.mark.parametrize("setup", [[], {"parameters": []}, {"instructions": 42}, {"instructions": "x" * 8001},
    {"parameters": {"unknown": "value"}}, {"parameters": {"period": "Other"}},
    {"parameters": {"days": True}}, {"parameters": {"days": float("inf")}}, {"parameters": {"details": "yes"}}])
def test_workflow_setup_rejects_invalid_values(instance, setup):
    instance["parameters"] = [
        {"name": "period", "label": "Period", "type": "select", "options": ["Month"]},
        {"name": "days", "label": "Days", "type": "number"},
        {"name": "details", "label": "Details", "type": "boolean"},
    ]
    with pytest.raises(ValueError):
        resolve_setup(instance, setup)


@pytest.mark.parametrize("parameters", [None, {}, [None], [{"name": "bad-name", "label": "Bad"}],
    [{"name": "choice", "label": "Choice", "type": "select", "options": []}],
    [{"name": "choice", "label": "Choice", "type": "select", "options": ["One"], "default": "Two"}],
    [{"name": "days", "label": "Days", "type": "number", "default": "many"}],
    [{"name": "same", "label": "Same"}] * 2])
def test_workflow_parameter_definitions_are_validated(instance, parameters):
    instance["parameters"] = parameters
    with pytest.raises(ValueError):
        parse_workflow(yaml.safe_dump(instance))


def test_workflow_setup_allows_custom_choices(instance):
    instance["parameters"] = [{"name": "period", "label": "Period", "type": "select",
                              "options": ["Month"], "allow_custom": True}]
    assert resolve_setup(instance, {"parameters": {"period": "Last quarter"}})["parameters"]["period"] == "Last quarter"


def test_workflow_setup_reaches_agent_as_user_guidance(agent):
    agent.state["setup"] = {"parameters": {"symbol": "AAPL"}, "instructions": "Focus on volatility."}
    agent.cancel.set()
    list(agent.run_workflow())
    setup_message = next(message for message in agent.state["trajectory"] if "Confirmed workflow setup:" in message.get("content", ""))
    assert setup_message["role"] == "user"
    assert '"symbol": "AAPL"' in setup_message["content"]
    assert "Focus on volatility." in setup_message["content"]
    assert "not permission to bypass" in setup_message["content"]


def test_public_run_counts_tool_invocations_not_model_turns(instance):
    state = new_run(instance, "counter")
    state["calls"] = 5
    state["trajectory"] = [{"role": "assistant", "content": "Thinking"},
        {"role": "tool", "tool_call_id": "first", "content": "Done"},
        {"role": "assistant", "content": "Continue"},
        {"role": "tool", "tool_call_id": "second", "content": "Tool failed"}]
    result = public_run(state)
    assert result["tool_calls"] == 2
    assert result["calls"] == 5
    assert "trajectory" not in result


def test_step_description_survives_parsing_and_checkpoint_creation(instance):
    instance["steps"][0]["description"] = "Compare recent market performance with a verified baseline."
    parsed = parse_workflow(yaml.safe_dump(instance))
    assert new_run(parsed, "description-test")["instance"]["steps"][0]["description"] == instance["steps"][0]["description"]
    adaptation = next(item for item in TOOLS if item["function"]["name"] == "adapt_plan")
    assert "description" in adaptation["function"]["parameters"]["properties"]["steps"]["items"]["properties"]


@pytest.mark.parametrize("description", [None, "", "  ", 3, {}])
def test_step_description_rejects_invalid_values(instance, description):
    instance["steps"][0]["description"] = description
    with pytest.raises(ValueError, match="Step description must be nonempty text"):
        parse_workflow(yaml.safe_dump(instance))


def test_terminal_proposal_pauses_without_executing_or_recording_evidence(agent, monkeypatch):
    proposal = {"id": "approval", "argv": ["ls"], "cwd": str(agent.run_dir), "purpose": "Inspect inputs"}
    monkeypatch.setattr(agent.terminal_skill, "handle_action", lambda *args: iter([{"type": "interact", "terminal_request": proposal}]))
    result = agent._execute("run_terminal", {"argv": ["ls"]}, "terminal-call")
    assert "has not executed" in result
    assert agent.state["status"] == "paused"
    assert agent.state["terminal_request"] == {**proposal, "call_id": "terminal-call"}
    assert "terminal-call" not in agent.state["evidence"]


def test_workflow_uses_analyst_discovery_and_skill_loading(agent, monkeypatch):
    names = {item["function"]["name"] for item in agent._current_tools()}
    assert {"find_data", "list_connectors", "describe_data", "propose_data_operation", "load_skill"} <= names
    skill = agent._loaded_skill_tool_map()["find_data"]
    monkeypatch.setattr(skill, "handle_tool", lambda *args: SimpleNamespace(text="Found connected prices"))
    assert "Found connected prices" in agent._execute("find_data", {"query": "prices"}, "discovery")
    assert "loaded" in agent._execute("load_skill", {"name": "terminal"}, "skill")
    assert "terminal" in agent._loaded_skills
    assert "Filesystem writes" in agent._build_system_prompt()


def test_workflow_guidance_has_one_completion_policy(agent):
    prompt = agent._build_system_prompt()
    assert "Plain text never completes a workflow" in prompt
    assert "Plain text with no tool calls ends the run" not in prompt
    assert "5 actions" not in prompt
    assert "Both finish the run" not in prompt
    assert "it publishes both the derived table and chart" in prompt
    assert "do not call create_data merely to stage or duplicate" in prompt
    tools = {item["function"]["name"]: item["function"] for item in agent._current_tools()}
    assert "No separate create_data call" in tools["visualize"]["description"]
    assert "use visualize directly" in tools["create_data"]["description"]
    agent._execute("load_skill", {"name": "report"}, "report-skill")
    assert "Creating any artifact does not complete" in agent.state["trajectory"][-1]["content"]


def test_workflow_action_pauses_and_resolved_result_becomes_evidence(agent, monkeypatch):
    def propose(*args):
        yield {"type": "interact", "data_operation": {"id": "operation"}}
    monkeypatch.setattr(agent.registry.get_skill("workspace"), "handle_action", propose)
    assert "awaiting" in agent._execute("propose_data_operation", {}, "import-call")
    assert agent.state["status"] == "paused"
    assert "import-call" not in agent.state["evidence"]
    agent.resolve_pending({"result_table_ids": ["prices"]})
    assert "interaction" not in agent.state
    assert "prices" in agent.state["evidence"]["import-call"]["text"]
    assert "do not repeat" in agent.state["trajectory"][-1]["content"]


def test_workflow_automatically_loads_and_publishes_the_recommended_plan(agent, monkeypatch):
    import pyarrow as pa
    from data_formulator.datalake.catalog_cache import save_catalog

    save_catalog(agent.workspace.user_home, "warehouse", [{"name": "Prices", "table_key": "prices",
        "path": ["prices"], "metadata": {"_source_name": "prices"}}])
    loader = MagicMock()
    loader.fetch_data_as_arrow.return_value = pa.table({"price": [100.0, 101.0]})
    loader.get_safe_params.return_value = {}
    monkeypatch.setattr("data_formulator.data_connector.resolve_live_loader", lambda *args, **kwargs: loader)
    agent.state["checks"] = {"coverage": {"status": "passed"}}
    result = agent._execute("propose_data_operation", {"user_review_needed": False,
        "options": [{"label": "Load prices", "tables": [{"source_id": "warehouse", "table_key": "prices"}]}]}, "load")
    assert agent.state["status"] == "running"
    assert "interaction" not in agent.state
    assert agent.state["outputs"][0]["tool"] == "create_data"
    assert agent.state["outputs"][0]["step_id"] == agent.state["step_id"]
    assert agent.state["outputs"][0]["plan_revision"] == 0
    assert json.loads(agent.state["outputs"][0]["stdout"])["table_name"] in agent.workspace.list_tables()
    assert agent._run_payload["workspace_inputs"].inputs
    assert not agent.state["checks"]
    assert '"status": "loaded"' in result
    loader.fetch_data_as_arrow.assert_called_once()


def test_workflow_asks_a_structured_question_and_retains_its_reply(agent):
    agent._execute("ask_user", {"questions": [{"text": "Which date range should I use?", "responseType": "single_choice",
                                             "options": ["Last month", "Last quarter"], "required": True}]}, "question")
    assert agent.state["status"] == "paused"
    assert agent.state["message"] == "Which date range should I use?"
    assert len(agent.state["interaction"]["questions"][0]["options"]) == 2
    assert "question" not in agent.state["evidence"]
    agent.resolve_pending({"user_reply": "Last quarter"})
    assert "interaction" not in agent.state
    assert "Last quarter" in agent.state["trajectory"][-1]["content"]


def test_legacy_help_uses_the_question_interaction(agent):
    agent._execute("request_help", {"question": "Please confirm the source."}, "help")
    assert agent.state["interaction"]["questions"][0]["text"] == "Please confirm the source."


def test_steering_is_injected_once_without_changing_progress(agent):
    agent.state["checks"] = {"coverage": {"status": "passed"}}
    agent.read_messages = lambda: [{"id": "first", "text": "Use weekly returns."}]
    before = {key: agent.state[key] for key in ("status", "step_id", "checks", "revision")}
    agent._inject_messages()
    agent._inject_messages()
    assert agent.state["trajectory"] == [{"role": "user", "content": "Workflow steering from the user:\nUse weekly returns."}]
    assert {key: agent.state[key] for key in before} == before


def test_new_steering_allows_returning_to_an_earlier_step(agent):
    agent.state["instance"]["steps"].append({"id": "report", "instructions": "Write the report"})
    agent.state["step_id"] = "report"
    agent._execute("move_to_step", {"step_id": "work", "reason": "Check inputs"}, "first-jump")
    agent.state["transitions"] *= 3
    agent.state["evidence"] = {}
    agent.state["step_id"] = "report"
    agent._evidence("observed", "execute_python_script", "Coverage verified")
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["observed"], "explanation": "Coverage verified"}, "check")
    agent.read_messages = lambda: [{"id": "new-scope", "text": "Revisit the input date range before reporting."}]
    agent._inject_messages()
    agent._execute("move_to_step", {"step_id": "work", "reason": "Recheck coverage for the new user instruction"}, "steered-jump")
    assert agent.state["step_id"] == "work"
    assert agent.state["status"] == "running"
    assert agent.state["checks"]["coverage"]["status"] == "passed"
    assert agent.state["transitions"][-1]["from"] == "report"
    assert "including earlier steps" in agent._build_system_prompt()


def test_adapt_plan_updates_only_the_run_and_requires_fresh_verification(agent, tmp_path):
    store = WorkflowStore(tmp_path)
    original = json.loads(json.dumps(agent.state["instance"]))
    store.save("review.yaml", yaml.safe_dump(original))
    saved = store.read("review.yaml")
    agent._evidence("observed", "execute_python_script", "Coverage verified")
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["observed"], "explanation": "Coverage verified"}, "check")
    steps = [{"id": "recheck", "instructions": "Check the user-requested date range",
              "checkers": [{"id": "coverage", "condition": "Requested dates are present", "on_fail": "recheck"}]},
             {"id": "report", "instructions": "Update the report"}]
    result = agent._execute("adapt_plan", {"steps": steps, "step_id": "recheck", "reason": "User changed the date range"}, "adapt")
    assert "saved workflow unchanged" in result
    assert agent.state["instance"]["steps"] == steps
    assert agent.state["instance"]["deliverables"] == original["deliverables"]
    assert agent.state["original_instance"] == original
    assert store.read("review.yaml") == saved
    assert agent.state["step_id"] == "recheck"
    assert not agent.state["checks"]
    assert agent.state["plan_revisions"][0]["previous_steps"] == original["steps"]
    assert "adapt" in agent.state["evidence"]
    assert agent.state["plan_review_pending"]
    assert agent.state["visited"] == []
    assert agent.state["plan_revisions"][0]["previous_checks"]["coverage"]["status"] == "passed"
    with pytest.raises(ValueError, match="review_plan"):
        agent._execute("write_report", {"report": "Too early"}, "report")
    assert "write_report" not in {spec["function"]["name"] for spec in agent._current_tools()}
    agent._execute("review_plan", {"step_id": "recheck", "steps": [
        {"id": step["id"], "status": "pending", "explanation": "New scope needs inspection", "evidence_ids": []}
        for step in steps]}, "review")
    assert not agent.state["plan_review_pending"]
    assert "write_report" in {spec["function"]["name"] for spec in agent._current_tools()}


def test_plan_review_can_carry_evidence_but_not_old_check_status(agent):
    agent._evidence("observed", "list_workspace_items", "Existing input inspected")
    agent.state["visited"] = ["work"]
    agent._execute("adapt_plan", {"reason": "Reorganize verification", "step_id": "work",
        "steps": [{"id": "work", "instructions": "Inspect inputs"}]}, "adapt")
    assert agent.state["plan_revisions"][0]["evidence_ids"] == ["observed"]
    assert agent.state["evidence"]["observed"]["plan_revision"] == 0
    assert agent.state["evidence"]["adapt"]["plan_revision"] == 1
    assessment = {"id": "work", "status": "completed", "explanation": "Input remains applicable", "evidence_ids": ["adapt"]}
    with pytest.raises(ValueError, match="substantive"):
        agent._execute("review_plan", {"step_id": "work", "steps": [assessment]}, "review")
    assert agent.state["plan_review_pending"]
    assessment["evidence_ids"] = ["observed"]
    agent._execute("review_plan", {"step_id": "work", "steps": [assessment]}, "review")
    assert agent.state["step_progress"]["work"]["status"] == "completed"
    assert not agent.state["checks"]
    with pytest.raises(ValueError, match="current evidence"):
        agent._require_evidence(["observed"])
    agent._execute("adapt_plan", {"reason": "Add final verification", "step_id": "verify",
        "steps": [{"id": "work", "instructions": "Inspect inputs"}, {"id": "verify", "instructions": "Verify outputs"}]}, "adapt-again")
    assert len(agent.state["plan_revisions"]) == 2
    assert agent.state["plan_revisions"][0]["previous_progress"] == {}
    assert agent.state["plan_revisions"][1]["previous_progress"]["work"]["status"] == "completed"
    assert agent.state["plan_revisions"][1]["plan_revision"] == 1
    assert "review" in agent.state["plan_revisions"][1]["evidence_ids"]
    assert agent.state["step_progress"] == {}
    assert agent.state["evidence"]["adapt-again"]["plan_revision"] == 2
    with pytest.raises(ValueError, match="exactly once"):
        agent._execute("review_plan", {"step_id": "work", "steps": [assessment]}, "partial-review")
    assert agent.state["plan_review_pending"]
    assert json.loads(agent._build_system_prompt().split("Current run plan:\n")[1])["review_required"] is True


@pytest.mark.parametrize("steps,target", [([], "work"),
    ([{"id": "work", "instructions": "Inspect", "next": "missing"}], "work"),
    ([{"id": "work", "instructions": "Inspect"}], "missing")])
def test_invalid_adaptation_leaves_run_plan_unchanged(agent, steps, target):
    before = json.loads(json.dumps(agent.state))
    with pytest.raises(ValueError):
        agent._execute("adapt_plan", {"steps": steps, "step_id": target, "reason": "New context"}, "adapt")
    assert agent.state["instance"] == before["instance"]
    assert agent.state["step_id"] == before["step_id"]
    assert "plan_revisions" not in agent.state


def test_workflow_planning_skill_is_loaded_and_its_yaml_is_valid(agent):
    import re
    import data_formulator.workflows.agent as workflow_module

    skill = Path(workflow_module.__file__).with_name("workflow-skill.md").read_text()
    assert skill in agent._build_system_prompt()
    examples = re.findall(r"```yaml\n(.*?)```", skill, re.DOTALL)
    assert examples
    for example in examples:
        assert parse_workflow(example)["steps"]


def test_instance_roundtrip_and_cycles(tmp_path, instance):
    instance["prompt"] = "Find sales data and use the methodology document to interpret returns."
    instance["source"] = [{"name": "Sales", "connector": "warehouse", "table": "sales"},
                          {"path": "files/methodology.pdf", "purpose": "Return definitions"}]
    instance["steps"][0]["next"] = "work"
    store = WorkflowStore(tmp_path)
    store.save("stocks.yaml", yaml.safe_dump(instance))
    assert parse_workflow(store.read("stocks.yaml")) == instance
    assert store.list_all()[0]["name"] == "Live stocks"
    with pytest.raises(ValueError):
        store.save("../escape.yaml", yaml.safe_dump(instance))


def test_prompt_and_source_guidance_reach_agent_unchanged(agent):
    agent.state["instance"]["prompt"] = "Compare sales with targets, using the reporting guide."
    agent.state["instance"]["source"] = [
        {"connector": "warehouse", "table": "sales", "freshness": "latest complete week"},
        {"path": "files/reporting-guide.pdf", "purpose": "Definitions and exclusions"},
    ]
    agent.cancel.set()
    list(agent.run_workflow())
    supplied = json.loads(agent.state["trajectory"][1]["content"].split("\nRun directory:", 1)[0])
    assert supplied == agent.state["instance"]
    assert "Read prompt and source guidance" in agent.state["trajectory"][0]["content"]


def test_sources_are_optional_guidance_not_adapter_configuration(instance):
    del instance["source"]
    assert parse_workflow(yaml.safe_dump(instance)) == instance
    for source in ("Use the uploaded sales file", {"kind": "workspace", "file": "sales.csv"},
                   {"kind": "yahoo", "symbols": ["https://finance.yahoo.com/quote/MSFT/"]}):
        instance["source"] = source
        assert parse_workflow(yaml.safe_dump(instance))["source"] == source


def test_bundled_stock_source_is_descriptive_guidance():
    import data_formulator.workflows.agent as workflow_module
    instance = parse_workflow(Path(workflow_module.__file__).with_name("stock-review.yaml").read_text())
    assert isinstance(instance["source"], str)
    assert all(value in instance["source"] for value in ("Yahoo Finance", "MSFT", "SPY", "90 calendar days"))


def test_household_demo_uses_catalog_sample_and_progressive_chart_steps():
    import data_formulator.workflows.agent as workflow_module
    from data_formulator.data_loader.sample_datasets_loader import SampleDatasetsLoader

    instance = parse_workflow(Path(workflow_module.__file__).with_name("household-cost-review.yaml").read_text())
    tables = SampleDatasetsLoader().list_tables("Consumer Price Index")
    assert len(tables) == 1
    assert tables[0]["name"] in instance["source"]
    assert "Month" in {column["name"] for column in tables[0]["metadata"]["columns"]}
    assert [step["id"] for step in instance["steps"]] == ["prepare", "trends", "movers", "basket", "brief"]
    assert len(instance["deliverables"]) == 4
    assert "user_review_needed false" in instance["source"]
    assert "historical" in instance["prompt"]
    basket = next(step for step in instance["steps"] if step["id"] == "basket")
    assert "transform the raw price input directly" in basket["instructions"]
    assert "not a separate create_data call" in basket["instructions"]
    assert "chart's derived table" in instance["deliverables"][2]


@pytest.mark.parametrize("filename,dataset,columns", [
    ("gas-price-review.yaml", "Weekly Gas Price", {"date", "fuel", "grade", "formulation", "price"}),
    ("movie-performance-review.yaml", "Movies", {"Production Budget", "Worldwide Gross", "Major Genre", "IMDB Rating"}),
])
def test_enhanced_demo_workflows_are_discoverable_and_use_available_samples(tmp_path, filename, dataset, columns):
    from data_formulator.data_loader.sample_datasets_loader import SampleDatasetsLoader

    store = WorkflowStore(tmp_path)
    path = f"demo/{filename}"
    workflow = parse_workflow(store.read(path))
    assert any(item["path"] == path and item["origin"] == "demo" and "error" not in item for item in store.list_all())
    table = next(table for table in SampleDatasetsLoader().list_tables(dataset) if table["name"] == dataset)
    assert columns <= {column["name"] for column in table["metadata"]["columns"]}
    assert dataset in workflow["source"]
    assert "user_review_needed false" in workflow["source"]
    assert len(workflow["deliverables"]) == 4
    assert len(workflow["steps"]) == 5
    assert all(step.get("description") and step.get("checkers") for step in workflow["steps"])
    assert "independent verification script" in workflow["steps"][-1]["instructions"]
    assert "historical" in workflow["prompt"]


def test_formal_sources_are_agent_guidance(instance, agent):
    instance["source"] = [{"id": "guide", "type": "instruction", "instruction": "Read the methodology."},
        {"id": "prices", "type": "retrieval", "request": {"method": "POST", "url": "https://example.com/prices",
            "params": {"symbol": "MSFT"}}, "response": {"format": "json"}}]
    assert parse_workflow(yaml.safe_dump(instance)) == instance
    agent.state["instance"] = instance
    agent.cancel.set()
    list(agent.run_workflow())
    supplied = json.loads(agent.state["trajectory"][1]["content"].split("\nRun directory:", 1)[0])
    assert supplied["source"] == instance["source"]
    assert "formal request specifications" in agent.state["trajectory"][0]["content"]
    assert "bypass tool authorization" in agent.state["trajectory"][0]["content"]
    tools = {item["function"]["name"] for item in agent._current_tools()}
    assert "retrieve_source" not in tools
    assert "run_terminal" in tools


@pytest.mark.parametrize("mutation", [
    lambda instance: instance["steps"][0].update(next="missing"),
    lambda instance: instance["steps"].append(instance["steps"][0].copy()),
    lambda instance: instance.update(deliverables=[]),
    lambda instance: instance["steps"][0].update(instructions=""),
    lambda instance: instance.update(prompt=" "),
    lambda instance: instance.update(prompt={"text": "wrong type"}),
    lambda instance: instance.update(source=[]),
    lambda instance: instance.update(source=[42]),
])
def test_invalid_instances(instance, mutation):
    mutation(instance)
    with pytest.raises(ValueError):
        parse_workflow(yaml.safe_dump(instance))


def test_delivery_requires_current_post_report_verification(agent, monkeypatch):
    state = agent.state
    completion = {"summary": "Verified", "deliverables": [{"index": 0, "evidence_ids": ["verify"], "explanation": "Checked"}]}
    with pytest.raises(ValueError):
        agent._execute("complete_workflow", completion, "end")
    state["calls"] = 1
    agent._execute("write_report", {"report": "# Review\n42 observations"}, "report")
    with pytest.raises(ValueError, match="verification script"):
        agent._execute("complete_workflow", completion, "end")
    state["calls"] = 2
    monkeypatch.setattr(agent, "_run_explore_code", lambda *args, **kwargs: {"status": "ok", "stdout": "42 rows reconciled", "output": {}})
    agent._execute("execute_python_script", {"code": "print(42)"}, "verify")
    agent._execute("record_check", {"check_id": "coverage", "status": "passed", "evidence_ids": ["verify"], "explanation": "Reconciled"}, "check")
    agent._execute("complete_workflow", completion, "end")
    assert state["status"] == "completed"
    (agent.run_dir / "changed.csv").write_text("value\n4\n")
    with pytest.raises(ValueError):
        agent._execute("complete_workflow", completion, "end")
    assert state["checks"]["coverage"]["status"] == "passed"
    (agent.run_dir / "report.md").unlink()
    with pytest.raises(ValueError, match="write the report"):
        agent._execute("complete_workflow", completion, "end")
    assert state["report"] == ""
    assert not state["checks"]


def test_later_output_preserves_step_checks_but_requires_final_verification(agent, monkeypatch):
    agent._execute("create_data", {"table_name": "prices", "rows": [{"value": 42}], "input_sources": []}, "data")
    monkeypatch.setattr(agent, "_run_explore_code", lambda *args, **kwargs: {
        "status": "ok", "stdout": "42 rows reconciled", "output": {}})
    agent.state["calls"] = 1
    agent._execute("execute_python_script", {"code": "print(42)"}, "inspect")
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["inspect"], "explanation": "Inputs verified"}, "check")
    agent.state["instance"]["steps"].append({"id": "report", "instructions": "Write report"})
    agent._execute("move_to_step", {"step_id": "report", "reason": "Inputs verified"}, "move")
    agent.state["calls"] = 2
    agent._execute("write_report", {"report": "# Review\n42 observations"}, "report")
    assert agent.state["checks"]["coverage"]["status"] == "passed"
    completion = {"summary": "Verified", "deliverables": [
        {"index": 0, "evidence_ids": ["verify"], "explanation": "Final report checked"}]}
    with pytest.raises(ValueError, match="verification script"):
        agent._execute("complete_workflow", completion, "early")
    agent.state["calls"] = 3
    agent._execute("execute_python_script", {"code": "print(42)"}, "verify")
    agent.state["evidence"]["verify"]["status"] = "failed"
    with pytest.raises(ValueError, match="verification script"):
        agent._execute("complete_workflow", completion, "failed-verification")
    agent.state["evidence"]["verify"].pop("status")
    agent._execute("complete_workflow", completion, "done")
    assert agent.state["status"] == "completed"


@pytest.mark.parametrize("dependency", ["table", "scratch", "report"])
@pytest.mark.parametrize("resume", [False, True])
def test_changed_dependencies_invalidate_step_checks(agent, dependency, resume):
    if dependency == "table":
        agent._execute("create_data", {"table_name": "prices", "rows": [{"value": 42}], "input_sources": []}, "data")
    elif dependency == "report":
        agent._execute("write_report", {"report": "Original report"}, "report")
    else:
        (agent.run_dir / "values.csv").write_text("value\n42\n")
        agent._refresh_artifacts()
    agent._evidence("observed", "execute_python_script", "Checked current values")
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["observed"], "explanation": "Coverage verified"}, "check")
    if resume:
        agent = WorkflowAgent(MagicMock(), agent.workspace, json.loads(json.dumps(agent.state)), lambda value: None, Event(), "")
    if dependency == "table":
        agent._execute("update_data", {"table_name": "prices", "rows": [{"value": 99}], "input_sources": [],
            "expected_content_hash": agent.workspace.get_table_metadata("prices").content_hash}, "update")
    elif dependency == "report":
        agent._execute("write_report", {"report": "Revised report"}, "update")
    else:
        (agent.run_dir / "values.csv").unlink()
        agent._refresh_artifacts()
    assert not agent.state["checks"]
    with pytest.raises(ValueError, match="current evidence"):
        agent._execute("record_check", {"check_id": "coverage", "status": "passed",
            "evidence_ids": ["observed"], "explanation": "Cannot reuse stale evidence"}, "stale-check")


def test_new_table_and_file_preserve_observed_checks(agent):
    agent._evidence("observed", "execute_python_script", "Checked current inputs")
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["observed"], "explanation": "Coverage verified"}, "check")
    agent._execute("create_data", {"table_name": "additional", "rows": [{"value": 42}], "input_sources": []}, "data")
    agent._execute("create_file", {"filename": "notes.txt", "content": "Additional notes"}, "file")
    assert agent.state["checks"]["coverage"]["status"] == "passed"
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["observed"], "explanation": "Evidence is still applicable"}, "check-again")


def test_legacy_evidence_expires_after_an_output_revision(agent):
    agent.state["evidence"]["legacy"] = {"tool": "execute_python_script", "revision": 0, "text": "Checked"}
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["legacy"], "explanation": "Previously checked"}, "check")
    agent._execute("write_report", {"report": "New report"}, "report")
    assert not agent.state["checks"]
    with pytest.raises(ValueError, match="current evidence"):
        agent._require_evidence(["legacy"], current_revision=False)


def test_failed_check_and_repair(agent):
    agent._evidence("actual", "execute_python_script", "Missing SPY")
    assert agent.state["evidence"]["actual"]["step_id"] == "work"
    assert agent.state["evidence"]["actual"]["call"] == agent.state["calls"]
    with pytest.raises(ValueError, match="evidence"):
        agent._execute("record_check", {"check_id": "coverage", "status": "passed", "evidence_ids": ["invented"], "explanation": "No"}, "check")
    agent._execute("record_check", {"check_id": "coverage", "status": "failed", "evidence_ids": ["actual"], "explanation": "Missing symbol"}, "check")
    agent._execute("move_to_step", {"step_id": "work", "reason": "Refetch missing symbol"}, "move")
    assert agent.state["checks"]["coverage"]["status"] == "failed"
    assert agent.state["transitions"][0]["to"] == "work"


def test_table_only_workflow_can_verify_and_complete(agent, monkeypatch):
    agent.state["instance"]["deliverables"] = ["Analysis table"]
    agent.state["instance"]["steps"][0]["checkers"] = []
    agent.state["calls"] = 1
    agent._execute("create_data", {"table_name": "values", "rows": [{"value": 2}], "input_sources": []}, "data")
    agent.state["calls"] = 2
    monkeypatch.setattr(agent, "_run_explore_code", lambda *args, **kwargs: {"status": "ok", "stdout": "Verified values", "output": {}})
    agent._execute("execute_python_script", {"code": "print('checked')"}, "verify")
    agent._execute("complete_workflow", {"summary": "Verified", "deliverables": [
        {"index": 0, "evidence_ids": ["data", "verify"], "explanation": "Table checked"}]}, "done")
    assert agent.state["status"] == "completed"


def test_output_path_safety(agent, monkeypatch):
    monkeypatch.setattr(agent, "_run_explore_code", lambda *args, **kwargs: {"status": "ok", "stdout": "", "output": {"../escape.csv": pd.DataFrame({"value": [1]})}})
    with pytest.raises(ValueError, match="Output names"):
        agent._execute("execute_python_script", {"code": ""}, "script")
    monkeypatch.setattr(agent, "_run_explore_code", lambda *args, **kwargs: {"status": "ok", "stdout": "", "output": {"report.md": "Unverified report"}})
    with pytest.raises(ValueError, match="reserved"):
        agent._execute("execute_python_script", {"code": ""}, "script")


def test_workflow_uses_shared_tools_without_a_live_source_adapter(agent):
    names = {item["function"]["name"] for item in TOOLS}
    assert "fetch_live_data" not in names
    assert {"execute_python_script", "list_workspace_items", "read_workspace_item", "create_data", "run_terminal"} <= names
    with pytest.raises(ValueError, match="Unknown workflow tool"):
        agent._execute("fetch_live_data", {}, "removed")


def test_native_data_file_and_report_outputs(agent):
    result = agent._execute("create_data", {"table_name": "workflow_values", "rows": [{"value": 2}], "input_sources": []}, "data")
    assert "Evidence ID: data" in result
    data = json.loads(agent.state["outputs"][0]["stdout"])
    assert data["table_name"] == "workflow_values"
    assert data["origin"] == "agent"
    agent._execute("create_file", {"filename": "workflow-notes.txt", "content": "Checked values"}, "file")
    file_output = json.loads(agent.state["outputs"][1]["stdout"])
    assert file_output["path"] == "files/workflow-notes.txt"
    assert file_output["available_in_workspace"] is True
    agent._execute("write_report", {"report": "# Values\n2"}, "report-1")
    agent._execute("write_report", {"report": "# Values\nVerified 2"}, "report-2")
    assert len([output for output in agent.state["outputs"] if output["type"] == "report"]) == 1
    assert agent.state["outputs"][-1]["content"] == "# Values\nVerified 2"
    assert all(output["step_id"] == agent.state["step_id"] for output in agent.state["outputs"])
    assert all(output["plan_revision"] == 0 for output in agent.state["outputs"])
    assert agent.state["evidence"]["data"]["revision"] < agent.state["revision"]


def test_native_visualization_output(agent, monkeypatch):
    agent._evidence("observed", "execute_python_script", "Input verified")
    agent._execute("record_check", {"check_id": "coverage", "status": "passed",
        "evidence_ids": ["observed"], "explanation": "Inputs covered"}, "check")
    monkeypatch.setattr(agent, "run_visualize_code", lambda **kwargs: {"status": "ok", "transform_result": {
        "status": "ok", "chart_id": "chart-workflow", "code": "result = values", "content": {
            "rows": [{"category": "A", "value": 2}], "virtual": {"table_name": "chart_values", "row_count": 1}},
        "refined_goal": {"chart": {"chart_type": "Bar Chart", "encodings": {"x": "category", "y": "value"}}},
    }})
    result = agent._execute("visualize", {"input_sources": [], "title": "Values by category", "display_name": "Category Values", "code": "",
        "chart": {"chart_type": "Bar Chart", "encodings": {"x": "category", "y": "value"}}}, "chart")
    assert "chart-workflow" in result
    assert agent.state["checks"]["coverage"]["status"] == "passed"
    output = agent.state["outputs"][0]
    assert output["type"] == "result"
    assert output["step_id"] == agent.state["step_id"]
    assert output["plan_revision"] == 0
    assert output["content"]["result"]["chart_id"] == "chart-workflow"
    assert output["content"]["result"]["code_signature"]
    assert output["content"]["result"]["refined_goal"]["display_name"] == "Category Values"


def test_workflow_writes_reject_escaped_paths(tmp_path, instance, agent):
    outside = tmp_path / "outside"
    outside.mkdir()
    workspace = Workspace("confined-test", root_dir=tmp_path / "workspace")
    (workspace.confined_scratch.root / "workflow-escaped").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="escapes confined"):
        WorkflowAgent(MagicMock(), workspace, new_run(instance, "escaped"), lambda state: None, Event(), "")
    target = outside / "report.md"
    target.write_text("Original")
    (agent.run_dir / "report.md").symlink_to(target)
    with pytest.raises(ValueError, match="symlinks"):
        agent._execute("write_report", {"report": "Changed"}, "report")
    assert target.read_text() == "Original"


def test_step_time_includes_model_and_tool_work_but_not_paused_time(agent, monkeypatch):
    import data_formulator.workflows.agent as workflow_module

    clock = [100.0]
    monkeypatch.setattr(workflow_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    first_step = agent.state["step_id"]

    def stream(*args):
        clock[0] += 2
        if False:
            yield
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[
            SimpleNamespace(id="timed", function=SimpleNamespace(name="record_check", arguments="{}"))]))])

    def execute(*args):
        clock[0] += 3
        agent.state.update(status="paused", message="Review progress")
        return "Checked"

    monkeypatch.setattr(agent, "_stream_llm", stream)
    monkeypatch.setattr(agent, "_execute", execute)
    list(agent.run_workflow())
    assert agent.state["step_elapsed_seconds"][first_step] == 5
    clock[0] += 3600
    agent.state["status"] = "running"
    list(agent.run_workflow())
    assert agent.state["step_elapsed_seconds"][first_step] == 10


def test_workflow_forwards_report_stream_before_committing(agent, monkeypatch):
    assert agent.registry.action_stream_spec("write_report") == ("report", "report")

    def stream(*args):
        yield {"type": "action", "action": "write_report"}
        yield {"type": "text_delta", "channel": "report", "content": "# Review\n"}
        yield {"type": "text_delta", "channel": "report", "content": "Verified prices."}
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[
            SimpleNamespace(id="report-call", function=SimpleNamespace(name="write_report", arguments=json.dumps({"report": "# Review\nVerified prices."})))]))])

    monkeypatch.setattr(agent, "_stream_llm", stream)
    events = agent.run_workflow()
    assert next(events) == {"type": "action", "action": "write_report"}
    assert next(events)["content"] == "# Review\n"
    assert next(events)["content"] == "Verified prices."
    assert not agent.state["outputs"]
    assert next(events)["type"] == "activity"
    assert next(events)["run"]["outputs"][0]["content"] == "# Review\nVerified prices."
    events.close()


def test_plain_text_does_not_finish_and_pause_resumes(agent, monkeypatch):
    responses = iter([(None, "Done"), ("request_help", {"question": "Need permission"})])

    def stream(*args):
        name, payload = next(responses)
        calls = [SimpleNamespace(id="help", function=SimpleNamespace(name=name, arguments=json.dumps(payload)))] if name else None
        if False:
            yield
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=payload if not name else None, tool_calls=calls))])

    monkeypatch.setattr(agent, "_stream_llm", stream)
    events = list(agent.run_workflow())
    assert events[0]["run"]["activity"] == "Done"
    assert next(event for event in events if event["type"] == "activity")["message"] == "Running request help."
    assert agent.state["status"] == "paused"
    assert agent.state["calls"] == 2
    assert agent.state["trajectory"][-1]["role"] == "tool"
    assert agent.state["trajectory"][-2]["tool_calls"][0]["id"] == "help"
    agent.state["status"] = "running"
    agent.cancel.set()
    list(agent.run_workflow())
    assert agent.state["status"] == "paused"
    assert agent.state["calls"] == 2


@pytest.mark.parametrize("tool_name,arguments,narration,expected_activity", [
    ("list_workspace_items", {}, "I am checking the available workspace data.", "I am checking the available workspace data."),
    ("execute_python_script", {"code": "print('checked')", "purpose": "Verify the basket totals."}, None, "Verify the basket totals."),
    ("execute_python_script", {"code": "print('checked')", "purpose": "Verify the basket totals."}, "Checking all four items.", "Checking all four items."),
    ("execute_python_script", {"code": "print('checked')", "purpose": ""}, None, "Running execute python script."),
    ("visualize", {"title": "Weekly prices", "chart": {"chart_type": "Line Chart"},
        "input_sources": [{"id": "data:prices", "display_name": "Prices"}], "code": "private code"}, None, "Running visualize."),
])
def test_disconnect_before_tool_preserves_resumable_trajectory(agent, monkeypatch, tool_name, arguments, narration, expected_activity):
    def stream(*args):
        if False:
            yield
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=narration, tool_calls=[
            SimpleNamespace(id="pending", function=SimpleNamespace(name=tool_name, arguments=json.dumps(arguments)))]))])

    monkeypatch.setattr(agent, "_stream_llm", stream)
    events = agent.run_workflow()
    event = next(events)
    assert event == {"type": "activity", "tool": tool_name, "message": expected_activity,
        "active_tool": agent.state["active_tool"]}
    assert event["active_tool"]["step_id"] == agent.state["step_id"]
    assert "code" not in event["active_tool"]["details"]
    if tool_name == "visualize":
        assert event["active_tool"]["details"] == {"title": "Weekly prices", "chart_type": "Line Chart", "inputs": "Prices"}
    assert agent.state["activity"] == expected_activity
    events.close()
    assert agent.state["status"] == "paused"
    assert agent.state["trajectory"][-1]["tool_call_id"] == "pending"
    assert "interrupted" in agent.state["trajectory"][-1]["content"]


@pytest.fixture
def workflow_client(tmp_path, monkeypatch):
    from flask import Flask, request
    from data_formulator.errors import AppError
    from data_formulator.routes import workflows

    app = Flask(__name__)
    app.register_blueprint(workflows.workflow_bp)
    app.register_error_handler(AppError, lambda error: ({"error": str(error)}, 400))
    workspaces = {name: Workspace("test-user", root_dir=tmp_path / name) for name in ("first", "second")}
    monkeypatch.setattr(workflows, "is_local_mode", lambda: True)
    monkeypatch.setattr(workflows, "get_identity_id", lambda: "test-user")
    monkeypatch.setattr(workflows, "get_user_home", lambda identity: tmp_path / "user")
    monkeypatch.setattr(workflows, "get_workspace", lambda identity: workspaces[request.headers["X-Workspace-Id"]])
    return app.test_client(), workspaces


def test_steering_inbox_is_scoped_idempotent_and_does_not_pause(workflow_client, instance):
    from uuid import uuid4
    from data_formulator.routes import workflows

    client, workspaces = workflow_client
    identifier = uuid4().hex
    path = workflows.run_path(workspaces["first"], identifier)
    state = new_run(instance, identifier)
    workflows.save_run(path, state)
    payload = {"run_id": identifier, "message_id": uuid4().hex, "message": "Use weekly returns."}
    for attempt in range(2):
        assert client.post("/api/workflows/message", json=payload, headers={"X-Workspace-Id": "first"}).status_code == 200
    assert workflows.read_messages(path) == [{"id": payload["message_id"], "text": payload["message"]}]
    assert json.loads(path.read_text()) == state
    assert client.post("/api/workflows/message", json=payload, headers={"X-Workspace-Id": "second"}).status_code == 400
    state["status"] = "completed"
    workflows.save_run(path, state)
    payload["message_id"] = uuid4().hex
    assert client.post("/api/workflows/message", json=payload, headers={"X-Workspace-Id": "first"}).status_code == 400


def test_steering_arriving_during_call_reaches_next_call(agent, monkeypatch):
    inbox = []
    observed = []
    agent.read_messages = lambda: inbox

    def stream(trajectory, tools):
        observed.append([message["content"] for message in trajectory])
        if len(observed) == 1:
            inbox.append({"id": "during-call", "text": "Compare weekly returns."})
        else:
            agent.cancel.set()
        if False:
            yield
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[], content="Working"))])

    monkeypatch.setattr(agent, "_stream_llm", stream)
    list(agent.run_workflow())
    assert not any("Compare weekly returns." in content for content in observed[0])
    assert observed[1][-1] == "Workflow steering from the user:\nCompare weekly returns."
    assert agent.state["applied_message_ids"] == ["during-call"]


def test_library_without_workspace_and_invalid_run(workflow_client):
    client, _ = workflow_client
    response = client.post("/api/workflows/list", json={})
    assert response.status_code == 200
    demos = response.json["data"]["items"]
    assert any(item["path"] == "demo/household-cost-review.yaml" for item in demos)
    assert all(item["origin"] == "demo" for item in demos)
    assert response.json["data"]["runs"] == []
    assert client.post("/api/workflows/run", json={}).status_code == 400
    assert client.post("/api/workflows/run", json={}, headers={"X-Workspace-Id": "first"}).status_code == 400
    assert client.post("/api/workflows/save", json={"path": "../escape.yaml", "content": "x"}).status_code == 400
    assert client.post("/api/workflows/delete", json={"path": "../escape.yaml"}).status_code == 400
    assert client.post("/api/workflows/delete", json={"path": "missing.yaml"}).status_code == 400


def test_server_demos_are_read_only_and_do_not_shadow_user_workflows(workflow_client, instance):
    client, _ = workflow_client
    demo_path = "demo/household-cost-review.yaml"
    demo = client.post("/api/workflows/read", json={"path": demo_path})
    assert demo.status_code == 200
    assert parse_workflow(demo.json["data"]["content"])["name"] == "Grocery Price Changes"
    content = yaml.safe_dump(instance)
    assert client.post("/api/workflows/save", json={"path": demo_path, "content": content}).status_code == 400
    assert client.post("/api/workflows/delete", json={"path": demo_path}).status_code == 400
    assert client.post("/api/workflows/read", json={"path": "demo/../stock-review.yaml"}).status_code == 400
    assert client.post("/api/workflows/read", json={"path": "demo/agent.py"}).status_code == 400
    assert client.post("/api/workflows/save", json={"path": "household-cost-review.yaml", "content": content}).status_code == 200
    items = client.post("/api/workflows/list", json={}).json["data"]["items"]
    assert any(item["path"] == "household-cost-review.yaml" and item["origin"] == "user" for item in items)
    assert any(item["path"] == demo_path and item["origin"] == "demo" for item in items)
    assert client.post("/api/workflows/read", json={"path": demo_path}).json == demo.json
    assert client.post("/api/workflows/delete", json={"path": "household-cost-review.yaml"}).status_code == 200
    assert client.post("/api/workflows/read", json={"path": demo_path}).status_code == 200


@pytest.mark.parametrize("decision", ["approve", "reject"])
def test_terminal_resume_executes_only_approved_stored_command(workflow_client, monkeypatch, instance, decision):
    from uuid import uuid4
    from data_formulator.routes import workflows
    from data_formulator.analyst.skills.terminal import skill as terminal

    client, workspaces = workflow_client
    identifier = uuid4().hex
    broker = terminal.TerminalRequests()
    client.application.extensions["terminal_requests"] = broker
    proposal = broker.propose("test-user", identifier, {"argv": ["echo", "approved"],
        "cwd": str(workspaces["first"].confined_scratch.root), "purpose": "Inspect prices"}, workspace_id="first")
    state = new_run(instance, identifier)
    state.update(status="paused", terminal_request={**proposal, "call_id": "command"})
    workflows.save_run(workflows.run_path(workspaces["first"], identifier), state)
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.routes.agents.get_client", lambda model: MagicMock())
    commands = []

    def command(spec, *, scratch_dir):
        commands.append(spec["argv"])
        assert scratch_dir == workspaces["first"].confined_scratch.root
        yield {"type": "terminal_result", "result": {"exit_code": 0, "output": "prices acquired"}}

    def resume(self):
        assert "terminal_request" not in self.state
        assert self.state["evidence"]["command"]["tool"] == "run_terminal"
        assert "do not repeat" in self.state["trajectory"][-1]["content"]
        self.state.update(status="completed", message="Verified")
        self.checkpoint(self.state)
        yield {"type": "workflow_state", "run": workflows.public_run(self.state)}

    monkeypatch.setattr(terminal, "run_command", command)
    monkeypatch.setattr(WorkflowAgent, "run_workflow", resume)
    body = {"run_id": identifier, "model": {}, "terminal_response": {
        "request_id": proposal["id"], "decision": decision, "argv": ["not", "approved"]}}
    headers = {"X-Workspace-Id": "first", "Origin": "http://localhost"}
    assert client.post("/api/workflows/run", json=body, headers={**headers, "Origin": "https://other.example"}).status_code == 400
    response = client.post("/api/workflows/run", json=body, headers=headers)
    events = [json.loads(line) for line in response.data.decode().splitlines()]
    assert events[-1]["run"]["status"] == "completed"
    assert commands == ([["echo", "approved"]] if decision == "approve" else [])
    assert client.post("/api/workflows/run", json=body, headers=headers).status_code == 400
    assert client.post("/api/workflows/run", json=body, headers={**headers, "X-Workspace-Id": "second"}).status_code == 400


def test_pending_terminal_cannot_be_resumed_by_plain_reply(workflow_client, instance):
    from uuid import uuid4
    from data_formulator.routes import workflows
    client, workspaces = workflow_client
    identifier = uuid4().hex
    state = new_run(instance, identifier)
    state.update(status="paused", terminal_request={"id": "pending", "call_id": "command"})
    workflows.save_run(workflows.run_path(workspaces["first"], identifier), state)
    response = client.post("/api/workflows/run", json={"run_id": identifier, "model": {}, "reply": "yes"},
                           headers={"X-Workspace-Id": "first"})
    assert response.status_code == 400
    assert "Approve or reject" in response.json["error"]


def test_selected_import_loads_native_data_then_continues_workflow(workflow_client, monkeypatch, instance):
    from uuid import uuid4
    import pyarrow as pa
    from data_formulator.routes import workflows
    from data_formulator.data_operations import ConnectorQueryStep, DataOperation, DataOperationPlan, DataOperationRepository, LoadQuery

    client, workspaces = workflow_client
    workspace = workspaces["first"]
    identifier = uuid4().hex
    plan = DataOperationPlan(id="prices-plan", label="Daily prices", summary="Prices", steps=(ConnectorQueryStep(
        source_id="market", table_key="prices", display_name="Prices", source_table="prices", query=LoadQuery(limit=100)),))
    operation = DataOperation(id="import-prices", reason="Acquire workflow inputs", plans=(plan,))
    DataOperationRepository.for_workspace(workspace).create(operation, conversation_id=identifier)
    state = new_run(instance, identifier)
    state.update(status="paused", interaction={"call_id": "import-call", "tool": "propose_data_operation",
                                              "data_operation": operation.to_public_dict()})
    workflows.save_run(workflows.run_path(workspace, identifier), state)
    loader = MagicMock()
    loader.fetch_data_as_arrow.return_value = pa.table({"symbol": ["MSFT", "SPY"], "price": [100.0, 200.0]})
    loader.get_safe_params.return_value = {}
    monkeypatch.setattr("data_formulator.data_connector.resolve_live_loader", lambda *args, **kwargs: loader)
    monkeypatch.setattr("data_formulator.routes.agents.get_client", lambda model: MagicMock())

    def resume(self):
        assert "interaction" not in self.state
        assert self._run_payload["input_tables"]
        assert "result_table_ids" in self.state["evidence"]["import-call"]["text"]
        assert self.state["outputs"][0]["tool"] == "create_data"
        self.state.update(status="completed", message="Imported and verified")
        self.checkpoint(self.state)
        yield {"type": "workflow_state", "run": workflows.public_run(self.state)}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", resume)
    body = {"run_id": identifier, "model": {}, "interaction_response": {"operation_id": operation.id, "plan_id": plan.id}}
    bad_body = {**body, "interaction_response": {"operation_id": "different-run", "plan_id": plan.id}}
    assert client.post("/api/workflows/run", json=bad_body, headers={"X-Workspace-Id": "first"}).status_code == 400
    response = client.post("/api/workflows/run", json=body, headers={"X-Workspace-Id": "first"})
    events = [json.loads(line) for line in response.data.decode().splitlines()]
    assert events[-1]["run"]["status"] == "completed"
    assert workspace.list_tables()
    loader.fetch_data_as_arrow.assert_called_once()


@pytest.mark.parametrize("workflow_path", ["stock-review.yaml", "demo/household-cost-review.yaml"])
def test_run_checkpoint_is_session_scoped(workflow_client, monkeypatch, instance, workflow_path):
    from data_formulator.routes import workflows

    client, _ = workflow_client
    assert client.post("/api/workflows/save", json={"path": "stock-review.yaml", "content": yaml.safe_dump(instance)}).status_code == 200
    monkeypatch.setattr("data_formulator.routes.agents.get_client", lambda model: MagicMock())

    class Runner:
        def __init__(self, client, workspace, state, checkpoint, cancel, identity):
            self.state = state
            self.checkpoint = checkpoint

        def run_workflow(self):
            self.state.update(status="completed", message="Delivered")
            self.checkpoint(self.state)
            yield {"type": "workflow_state", "run": workflows.public_run(self.state)}

    monkeypatch.setattr(workflows, "WorkflowAgent", Runner)
    setup = {"parameters": {}, "instructions": "Focus on recent changes."}
    response = client.post("/api/workflows/run", json={"path": workflow_path, "model": {}, "setup": setup}, headers={"X-Workspace-Id": "first"})
    events = [json.loads(line) for line in response.data.decode().splitlines()]
    identifier = events[-1]["run"]["id"]
    assert events[-1]["run"]["status"] == "completed"
    assert events[-1]["run"]["setup"]["instructions"] == setup["instructions"]
    if workflow_path.startswith("demo/"):
        assert events[-1]["run"]["instance"]["name"] == "Grocery Price Changes"
    assert "trajectory" not in events[-1]["run"]
    saved = client.post("/api/workflows/run-state", json={"run_id": identifier}, headers={"X-Workspace-Id": "first"})
    assert saved.json["data"]["run"]["setup"] == events[-1]["run"]["setup"]
    assert client.post("/api/workflows/run-state", json={"run_id": identifier}, headers={"X-Workspace-Id": "first"}).status_code == 200
    assert client.post("/api/workflows/run-state", json={"run_id": identifier}, headers={"X-Workspace-Id": "second"}).status_code == 400
    assert client.post("/api/workflows/run", json={"run_id": identifier, "model": {}}, headers={"X-Workspace-Id": "first"}).status_code == 400
    assert client.post("/api/workflows/artifact", json={"run_id": identifier, "filename": "../secret"}, headers={"X-Workspace-Id": "first"}).status_code == 400


@pytest.mark.parametrize("active", [False, True])
def test_run_state_recovers_orphaned_executor_only(workflow_client, instance, active):
    from uuid import uuid4
    from filelock import FileLock
    from data_formulator.routes import workflows

    client, workspaces = workflow_client
    identifier = uuid4().hex
    path = workflows.run_path(workspaces["first"], identifier)
    state = new_run(instance, identifier)
    workflows.save_run(path, state)
    execution_lock = FileLock(str(path) + ".lock")
    if active:
        execution_lock.acquire(timeout=0)
    try:
        response = client.post("/api/workflows/run-state", json={"run_id": identifier}, headers={"X-Workspace-Id": "first"})
        assert response.status_code == 200
        saved = json.loads(path.read_text())
        assert saved["status"] == ("running" if active else "paused")
        assert saved["trajectory"] == state["trajectory"]
        assert saved["outputs"] == state["outputs"]
        if not active:
            assert "interrupted" in saved["message"]
            assert "paused" in response.get_data(as_text=True)
    finally:
        if active:
            execution_lock.release()


def test_duplicate_run_lock_is_rejected(workflow_client, monkeypatch):
    from uuid import uuid4
    from filelock import FileLock
    from data_formulator.routes.workflows import run_path, save_run

    client, workspaces = workflow_client
    identifier = uuid4().hex
    path = run_path(workspaces["first"], identifier)
    save_run(path, {"id": identifier, "status": "paused"})
    with FileLock(str(path) + ".lock"):
        response = client.post("/api/workflows/run", json={"run_id": identifier, "model": {}}, headers={"X-Workspace-Id": "first"})
    assert response.status_code == 400
    assert "already running" in response.json["error"]


def test_checkpoint_directory_cannot_escape_session(workflow_client, tmp_path):
    from uuid import uuid4

    client, workspaces = workflow_client
    outside = tmp_path / "outside"
    outside.mkdir()
    (workspaces["first"].confined_scratch.root / "_workflow_runs").symlink_to(outside, target_is_directory=True)
    headers = {"X-Workspace-Id": "first"}
    assert client.post("/api/workflows/list", json={}, headers=headers).status_code == 400
    assert client.post("/api/workflows/run", json={"run_id": uuid4().hex, "model": {}}, headers=headers).status_code == 400
    assert not list(outside.iterdir())