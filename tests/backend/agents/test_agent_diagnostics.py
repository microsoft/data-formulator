"""Tests for the unified AgentDiagnostics builder.

Background
----------
Diagnostics payloads were previously built inline in both DataRecAgent and
DataTransformationAgent with near-identical ~40-line dict literals.  This
module validates the new centralised AgentDiagnostics class that replaces
those duplicates and also covers DataLoadAgent (which had no diagnostics).

The tests are written TDD-style — they should **fail** until
agents/agent_diagnostics.py is implemented.
"""
from __future__ import annotations

import re
import time

import pytest

pytestmark = [pytest.mark.backend]

# ---------------------------------------------------------------------------
# Import the class under test (will fail until the module exists)
# ---------------------------------------------------------------------------
from data_formulator.agents.agent_diagnostics import AgentDiagnostics


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def sample_diag() -> AgentDiagnostics:
    return AgentDiagnostics(
        agent_name="TestAgent",
        model_info={"provider": "openai", "model": "gpt-4o"},
        base_system_prompt="You are a helpful assistant.",
        agent_coding_rules="rule-1",
        language_instruction="Use Chinese.",
        assembled_system_prompt="You are a helpful assistant.\n\nUse Chinese.",
    )


SAMPLE_MESSAGES = [
    {"role": "system", "content": "sys"},
    {"role": "user", "content": "hello"},
]

ISO_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

# ===================================================================
# Shared-field tests (every method must produce these top-level keys)
# ===================================================================

class TestSharedFields:
    """All builder methods must emit agent, timestamp, model, prompt_components, llm_request."""

    SHARED_TOP_KEYS = {"agent", "timestamp", "model", "prompt_components", "llm_request"}

    def test_for_error_has_shared_keys(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_error(SAMPLE_MESSAGES, error="boom")
        assert self.SHARED_TOP_KEYS <= d.keys()

    def test_for_response_has_shared_keys(self, sample_diag: AgentDiagnostics) -> None:
        d = _make_full_response(sample_diag)
        assert self.SHARED_TOP_KEYS <= d.keys()

    def test_for_json_only_has_shared_keys(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_json_only(SAMPLE_MESSAGES, raw_content="{}")
        assert self.SHARED_TOP_KEYS <= d.keys()

    def test_agent_name_propagated(self, sample_diag: AgentDiagnostics) -> None:
        assert sample_diag.for_error(SAMPLE_MESSAGES)["agent"] == "TestAgent"
        assert _make_full_response(sample_diag)["agent"] == "TestAgent"
        assert sample_diag.for_json_only(SAMPLE_MESSAGES)["agent"] == "TestAgent"

    def test_timestamp_is_iso8601(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_error(SAMPLE_MESSAGES)
        assert ISO_TIMESTAMP_RE.match(d["timestamp"])

    def test_model_info_preserved(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_error(SAMPLE_MESSAGES)
        assert d["model"] == {"provider": "openai", "model": "gpt-4o"}

    def test_prompt_components_complete(self, sample_diag: AgentDiagnostics) -> None:
        pc = sample_diag.for_error(SAMPLE_MESSAGES)["prompt_components"]
        assert pc["base_system_prompt"] == "You are a helpful assistant."
        assert pc["agent_coding_rules"] == "rule-1"
        assert pc["language_instruction"] == "Use Chinese."
        assert "Use Chinese." in pc["assembled_system_prompt"]

    def test_llm_request_message_count(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_error(SAMPLE_MESSAGES)
        assert d["llm_request"]["message_count"] == 2
        assert d["llm_request"]["messages"] is SAMPLE_MESSAGES


# ===================================================================
# for_error — minimal diagnostics for LLM connection failures
# ===================================================================

class TestForError:

    def test_contains_error_field(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_error(SAMPLE_MESSAGES, error="connection timeout")
        assert d["error"] == "connection timeout"

    def test_no_parsing_or_execution_sections(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_error(SAMPLE_MESSAGES)
        assert "parsing" not in d
        assert "execution" not in d
        assert "performance" not in d


# ===================================================================
# for_response — full diagnostics for code-execution agents
# ===================================================================

class TestForResponse:

    def test_top_level_sections(self, sample_diag: AgentDiagnostics) -> None:
        d = _make_full_response(sample_diag)
        for section in ("llm_response", "parsing", "execution", "performance"):
            assert section in d, f"missing section: {section}"

    def test_llm_response_fields(self, sample_diag: AgentDiagnostics) -> None:
        d = _make_full_response(sample_diag)
        lr = d["llm_response"]
        assert lr["raw_content"] == "```json\n{}\n```\n```python\nx=1\n```"
        assert lr["finish_reason"] == "stop"

    def test_parsing_fields(self, sample_diag: AgentDiagnostics) -> None:
        d = _make_full_response(sample_diag)
        p = d["parsing"]
        assert p["json_spec_found"] is True
        assert p["json_fallback_used"] is False
        assert p["code_found"] is True
        assert p["code"] == "x=1"
        assert p["output_variable"] == "result_df"
        assert p["output_variable_in_code"] is False
        assert p["supplemented"] is False

    def test_execution_fields(self, sample_diag: AgentDiagnostics) -> None:
        d = _make_full_response(sample_diag)
        ex = d["execution"]
        assert ex["sandbox_mode"] == "local"
        assert ex["status"] == "ok"

    def test_execution_error_fields_present_when_failed(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_response(
            SAMPLE_MESSAGES,
            raw_content="", finish_reason=None,
            json_spec=None, json_fallback_used=True,
            code_found=False, code=None,
            output_variable="result_df", output_variable_in_code=False,
            supplemented=False,
            sandbox_mode="local",
            exec_status="error", exec_error="NameError: x",
            exec_df_names=["df1"],
        )
        ex = d["execution"]
        assert ex["status"] == "error"
        assert ex["error_message"] == "NameError: x"
        assert ex["available_dataframes"] == ["df1"]

    def test_performance_rounding(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_response(
            SAMPLE_MESSAGES,
            raw_content="", finish_reason=None,
            json_spec=None, json_fallback_used=True,
            code_found=False, code=None,
            output_variable="r", output_variable_in_code=False,
            supplemented=False,
            sandbox_mode=None, exec_status=None,
            t_llm=1.23456789, t_supplement=0.00012, t_exec=2.9999,
            prompt_tokens=100, completion_tokens=50,
        )
        perf = d["performance"]
        assert perf["llm_seconds"] == 1.235
        assert perf["supplement_seconds"] == 0.0
        assert perf["exec_seconds"] == 3.0
        assert perf["prompt_tokens"] == 100
        assert perf["completion_tokens"] == 50


# ===================================================================
# for_json_only — lightweight diagnostics for DataLoadAgent
# ===================================================================

class TestForJsonOnly:

    def test_has_llm_response_and_performance(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_json_only(
            SAMPLE_MESSAGES,
            raw_content='{"fields":{}}',
            finish_reason="stop",
            t_llm=0.5,
            prompt_tokens=80,
            completion_tokens=20,
        )
        assert d["llm_response"]["raw_content"] == '{"fields":{}}'
        assert d["performance"]["llm_seconds"] == 0.5
        assert d["performance"]["prompt_tokens"] == 80

    def test_no_parsing_or_execution_sections(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_json_only(SAMPLE_MESSAGES)
        assert "parsing" not in d
        assert "execution" not in d

    def test_defaults_when_no_kwargs(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_json_only(SAMPLE_MESSAGES)
        assert d["llm_response"]["raw_content"] == ""
        assert d["performance"]["llm_seconds"] == 0.0


# ===================================================================
# Schema compatibility — ensure the structure matches what the
# front-end DiagnosticsViewer (MessageSnackbar.tsx) consumes
# ===================================================================

class TestSchemaCompatibility:
    """The front-end currently does JSON.stringify(diagnostics, null, 2)
    and expands it.  These tests lock down the top-level key set so that
    a back-end change doesn't silently break the viewer."""

    FULL_RESPONSE_KEYS = {
        "agent", "timestamp", "model", "prompt_components",
        "llm_request", "llm_response", "parsing", "execution", "performance",
    }
    ERROR_KEYS = {
        "agent", "timestamp", "model", "prompt_components",
        "llm_request", "error",
    }
    JSON_ONLY_KEYS = {
        "agent", "timestamp", "model", "prompt_components",
        "llm_request", "llm_response", "performance",
    }

    def test_for_response_key_set(self, sample_diag: AgentDiagnostics) -> None:
        assert _make_full_response(sample_diag).keys() == self.FULL_RESPONSE_KEYS

    def test_for_error_key_set(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_error(SAMPLE_MESSAGES, error="e")
        assert d.keys() == self.ERROR_KEYS

    def test_for_json_only_key_set(self, sample_diag: AgentDiagnostics) -> None:
        d = sample_diag.for_json_only(SAMPLE_MESSAGES)
        assert d.keys() == self.JSON_ONLY_KEYS


# ===================================================================
# Multiple instances — verify isolation between agents
# ===================================================================

class TestMultipleInstances:

    def test_different_agent_names(self) -> None:
        d1 = AgentDiagnostics("DataRecAgent", {}, "p1")
        d2 = AgentDiagnostics("DataTransformationAgent", {}, "p2")
        assert d1.for_error([])["agent"] == "DataRecAgent"
        assert d2.for_error([])["agent"] == "DataTransformationAgent"

    def test_prompt_isolation(self) -> None:
        d1 = AgentDiagnostics("A", {}, "prompt-A", assembled_system_prompt="asm-A")
        d2 = AgentDiagnostics("B", {}, "prompt-B", assembled_system_prompt="asm-B")
        assert d1.for_error([])["prompt_components"]["base_system_prompt"] == "prompt-A"
        assert d2.for_error([])["prompt_components"]["base_system_prompt"] == "prompt-B"


# ===================================================================
# Helpers
# ===================================================================

def _make_full_response(diag: AgentDiagnostics) -> dict:
    """Build a for_response payload with representative values."""
    return diag.for_response(
        SAMPLE_MESSAGES,
        raw_content="```json\n{}\n```\n```python\nx=1\n```",
        finish_reason="stop",
        json_spec={"chart_type": "Bar Chart"},
        json_fallback_used=False,
        code_found=True,
        code="x=1",
        output_variable="result_df",
        output_variable_in_code=False,
        supplemented=False,
        sandbox_mode="local",
        exec_status="ok",
        t_llm=1.2,
        t_supplement=0.1,
        t_exec=0.5,
        prompt_tokens=200,
        completion_tokens=100,
    )
