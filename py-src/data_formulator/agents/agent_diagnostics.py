# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unified diagnostics builder for all agent pipelines.

Centralises the JSON structure returned as ``result['diagnostics']``,
ensuring a single schema definition for both back-end construction
and front-end consumption (DiagnosticsViewer in MessageSnackbar.tsx).
"""

from __future__ import annotations

import time
from typing import Any


class AgentDiagnostics:
    """Captures prompt context once at agent init, then builds diagnostics per request."""

    def __init__(
        self,
        agent_name: str,
        model_info: dict,
        base_system_prompt: str,
        agent_coding_rules: str = "",
        language_instruction: str = "",
        assembled_system_prompt: str = "",
    ):
        self._agent_name = agent_name
        self._model_info = model_info
        self._prompt_ctx = {
            "base_system_prompt": base_system_prompt,
            "agent_coding_rules": agent_coding_rules,
            "language_instruction": language_instruction,
            "assembled_system_prompt": assembled_system_prompt,
        }

    # -- helpers ----------------------------------------------------------

    def _base(self, messages: list[dict]) -> dict[str, Any]:
        return {
            "agent": self._agent_name,
            "timestamp": _now(),
            "model": self._model_info,
            "prompt_components": self._prompt_ctx,
            "llm_request": {
                "message_count": len(messages),
                "messages": messages,
            },
        }

    # -- 1. LLM connection failure / early exception ----------------------

    def for_error(self, messages: list[dict], error: str = "") -> dict[str, Any]:
        return {**self._base(messages), "error": error}

    # -- 2. Full diagnostics (code-execution agents) ----------------------

    def for_response(
        self,
        messages: list[dict],
        *,
        raw_content: str,
        finish_reason: str | None,
        json_spec: dict | None,
        json_fallback_used: bool,
        code_found: bool,
        code: str | None,
        output_variable: str,
        output_variable_in_code: bool,
        code_patched: bool = False,
        supplemented: bool,
        sandbox_mode: str | None,
        exec_status: str | None,
        exec_error: str | None = None,
        exec_df_names: list[str] | None = None,
        t_llm: float = 0.0,
        t_supplement: float = 0.0,
        t_exec: float = 0.0,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
    ) -> dict[str, Any]:
        exec_dict: dict[str, Any] = {
            "sandbox_mode": sandbox_mode,
            "status": exec_status,
        }
        if exec_error is not None:
            exec_dict["error_message"] = exec_error
        if exec_df_names is not None:
            exec_dict["available_dataframes"] = exec_df_names

        return {
            **self._base(messages),
            "llm_response": {
                "raw_content": raw_content,
                "finish_reason": finish_reason,
            },
            "parsing": {
                "json_spec_found": not json_fallback_used,
                "json_spec": json_spec,
                "json_fallback_used": json_fallback_used,
                "code_found": code_found,
                "code": code,
                "output_variable": output_variable,
                "output_variable_in_code": output_variable_in_code,
                "code_patched": code_patched,
                "supplemented": supplemented,
            },
            "execution": exec_dict,
            "performance": {
                "llm_seconds": round(t_llm, 3),
                "supplement_seconds": round(t_supplement, 3),
                "exec_seconds": round(t_exec, 3),
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        }

    # -- 3. JSON-only agents (DataLoadAgent — no code/execution) ----------

    def for_json_only(
        self,
        messages: list[dict],
        *,
        raw_content: str = "",
        finish_reason: str | None = None,
        t_llm: float = 0.0,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
    ) -> dict[str, Any]:
        return {
            **self._base(messages),
            "llm_response": {
                "raw_content": raw_content,
                "finish_reason": finish_reason,
            },
            "performance": {
                "llm_seconds": round(t_llm, 3),
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        }


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
