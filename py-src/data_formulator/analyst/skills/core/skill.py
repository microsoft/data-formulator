# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""core skill — the analyst's always-on baseline capabilities.

Every other skill is optional and gated; ``core`` is ``always_on`` and loaded
automatically at the start of each run, so the agent is never truly empty. It
contributes the built-in data-inspection **tools** (``explore`` /
``inspect_source_data`` — ``load_skill`` is assembled by the shell because its
enum is dynamic) and the always-available **actions** — the committing tool
calls the agent acts with (``visualize`` / ``interact``; see
``design-docs/36``).

Each handler does *processing* (validate the action arguments, run/normalize,
emit events) and **returns an observation string** that the shell appends to the
trajectory as the action's tool-call result — exactly like an inspection tool.
There is no control verdict: the agent reads the observation and decides its own
next move (commit another action, or stop by giving its final answer — a turn
with no action ends the run). The one exception is ``interact``: it puts a
question widget to the user, which the agent cannot observe, so it **returns
``None``** — the shell reads that as "no observation to continue from" and ends
the run, pausing for the user's reply. Heavy execution substrate (sandbox-backed
``run_visualize_code`` / ``run_explore_code``) lives on the shell and is reached
via ``ctx.runtime``.
"""

from __future__ import annotations

import logging
from typing import Any, Generator

from data_formulator.agents.agent_utils import generate_data_summary
from data_formulator.agents.context import handle_inspect_source_data
from data_formulator.datalake.workspace_file_content import read_workspace_file_text
from data_formulator.security.code_signing import sign_result
from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine, WorkspaceInputManifest

from data_formulator.analyst.skills.base import (
    Event,
    SkillContext,
    ToolResult,
)

logger = logging.getLogger(__name__)


def _normalize_input_sources(
    action: dict[str, Any],
    manifest: WorkspaceInputManifest | None,
) -> list[dict[str, str]]:
    """Resolve action provenance to exact run-manifest inputs."""
    by_id = {item.id: item for item in manifest.inputs} if manifest is not None else {}
    raw_sources = action.get("input_sources")
    if raw_sources is None:
        legacy_names = action.get("input_tables", [])
        if not isinstance(legacy_names, list):
            raise ValueError("input_tables must be an array")
        data_by_name = {
            item.display_name: item for item in manifest.data
        } if manifest is not None else {}
        normalized = []
        for raw_name in legacy_names:
            name = str(raw_name).strip()
            item = data_by_name.get(name)
            if manifest is not None and item is None:
                raise ValueError(f"Unknown legacy input table: {name}")
            normalized.append({
                "id": item.id if item is not None else name,
                "kind": "data",
                "display_name": item.display_name if item is not None else name,
            })
        return normalized

    if not isinstance(raw_sources, list):
        raise ValueError("input_sources must be an array")
    normalized = []
    seen: set[str] = set()
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            raise ValueError("Each input source must be an object")
        input_id = str(raw_source.get("id", "")).strip()
        kind = raw_source.get("kind")
        if not input_id or kind not in {"data", "file"}:
            raise ValueError("Each input source requires a valid id and kind")
        item = by_id.get(input_id)
        if manifest is not None and (item is None or item.kind != kind):
            raise ValueError(f"Unknown or mismatched input source: {input_id}")
        if input_id in seen:
            continue
        seen.add(input_id)
        normalized.append({
            "id": input_id,
            "kind": kind,
            "display_name": item.display_name if item is not None else input_id,
        })
    return normalized

class CoreSkill:
    """The core skill processor: the ``explore`` / ``inspect_source_data`` tool
    handlers and the ``visualize`` / ``interact`` action handlers.

    Tool/action *schemas* live in ``core/tools.json`` and the skill's metadata
    in ``SKILL.md`` frontmatter (``load_skill`` is assembled by the shell because
    its enum is dynamic); this class is purely behaviour — it validates an
    action's arguments and returns an observation string that the shell feeds
    back as the action's tool-call result (or ``None`` for ``interact``, the one
    terminal action that ends the run by pausing for the user). There is no
    control verdict.
    """

    # ------------------------------------------------------------------
    # Tools
    # ------------------------------------------------------------------

    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        """Execute a core inspection tool by delegating to the shell runtime.

        (In practice the shell's tool loop intercepts these inline — they need
        loop-level sandbox state — but implementing them here keeps the skill
        self-consistent and lets the shell route them generically if it stops
        special-casing.)
        """
        input_tables = (ctx.payload or {}).get("input_tables") or []
        if name == "execute_python_script":
            result = ctx.runtime.run_explore_code(args.get("code", ""), input_tables)
            text = result.get("stdout", "")
            if result.get("error"):
                text += f"\n\nError: {result['error']}"
            return ToolResult(text=text)
        if name == "inspect_source_data":
            text = handle_inspect_source_data(
                args.get("table_names", []), input_tables, ctx.workspace,
            )
            return ToolResult(text=text)
        if name == "read_workspace_file":
            result = read_workspace_file_text(ctx.workspace, args.get("name", ""))
            suffix = "\n\n[Output truncated]" if result.truncated else ""
            return ToolResult(text=f"[WORKSPACE FILE: {result.name}]\n\n{result.content}{suffix}")
        input_tool_names = {
            "list_workspace_inputs",
            "preview_workspace_input",
            "read_workspace_input",
            "search_workspace_inputs",
        }
        input_engine = (
            WorkspaceInputEngine(ctx.workspace, input_tables)
            if name in input_tool_names else None
        )
        if name == "list_workspace_inputs" and input_engine is not None:
            return ToolResult(text=input_engine.list_inputs(
                kinds=args.get("kinds"),
                query=args.get("query", ""),
            ))
        if name == "preview_workspace_input" and input_engine is not None:
            return ToolResult(text=input_engine.preview_input(
                args.get("input_id", ""),
                locator=args.get("locator"),
                options=args.get("options"),
                limit=args.get("limit", 50),
            ))
        if name == "read_workspace_input" and input_engine is not None:
            return ToolResult(text=input_engine.read_input(
                args.get("input_id", ""),
                locator=args.get("locator"),
                options=args.get("options"),
                limit=args.get("limit", 200),
            ))
        if name == "search_workspace_inputs" and input_engine is not None:
            return ToolResult(text=input_engine.search_inputs(
                args.get("query", ""),
                input_ids=args.get("input_ids"),
                kinds=args.get("kinds"),
                options=args.get("options"),
                max_results=args.get("max_results", 20),
            ))
        return ToolResult(text=f"core has no tool '{name}'.")

    # ------------------------------------------------------------------
    # Actions — dispatch (each committing tool call routes to one handler)
    # ------------------------------------------------------------------

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action == "visualize":
            return (yield from self._handle_visualize(spec, ctx))
        if action == "ask_user":
            return (yield from self._handle_interact(spec, ctx))
        yield {
            "type": "error",
            "message": f"core cannot handle action '{action}'.",
            "message_code": "agent.unknownAction",
        }
        return f"core cannot handle action '{action}'."

    # ------------------------------------------------------------------
    # visualize
    # ------------------------------------------------------------------

    def _handle_visualize(
        self, action: dict[str, Any], ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        code = action.get("code", "")
        output_variable = action.get("output_variable", "result_df")
        chart_spec = action.get("chart", {})
        field_metadata = action.get("field_metadata", {})
        field_display_names = action.get("field_display_names", {})
        display_instruction = action.get("display_instruction", "")
        title = action.get("title", "")
        subtitle = action.get("subtitle", "")
        step_index = int((ctx.payload or {}).get("completed_step_count", 0)) + 1

        try:
            input_sources = _normalize_input_sources(
                action,
                (ctx.payload or {}).get("workspace_inputs"),
            )
        except ValueError as exc:
            message = str(exc)
            yield {
                "type": "error",
                "message": message,
                "message_code": "agent.parseActionFailed",
            }
            return f"[OBSERVATION – Step {step_index} FAILED]\n\nError: {message}"

        yield {
            "type": "action",
            "action": "visualize",
            "display_instruction": display_instruction,
            "input_sources": input_sources,
            "input_tables": [
                source["display_name"]
                for source in input_sources
                if source["kind"] == "data"
            ],
        }

        viz_result = ctx.runtime.run_visualize_code(
            code=code,
            output_variable=output_variable,
            chart_spec=chart_spec,
            field_metadata=field_metadata,
            field_display_names=field_display_names,
            display_instruction=display_instruction,
            title=title,
            subtitle=subtitle,
            messages=ctx.trajectory,
        )

        if viz_result["status"] != "ok":
            error_msg = viz_result.get("error_message", "Unknown error")
            observation = (
                f"[OBSERVATION – Step {step_index} FAILED]\n\nError: {error_msg}"
            )
            yield {
                "type": "error",
                "message": error_msg,
                "display_instruction": display_instruction,
            }
            # Recoverable: hand the error back and let the agent re-decide.
            return observation

        transform_result = viz_result["transform_result"]
        sign_result(transform_result)
        transformed_data = transform_result["content"]

        # Register the chart so a same-run report (and inspect_chart) can
        # reference it by its forwarded, run-stable id.
        ctx.runtime.register_run_chart(transform_result, chart_spec)

        yield {
            "type": "result",
            "status": "success",
            "content": {
                "question": display_instruction,
                "result": transform_result,
            },
        }

        observation = self._format_observation(
            step_index=step_index,
            display_instruction=display_instruction,
            code=transform_result.get("code", ""),
            data=transformed_data,
            chart_id=transform_result.get("chart_id"),
            workspace=ctx.workspace,
        )
        return observation

    # ------------------------------------------------------------------
    # interact — put question(s) to the user and pause (terminal)
    # ------------------------------------------------------------------

    def _handle_interact(
        self, action: dict[str, Any], ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        """Render a structured question/explanation widget and end the run.

        ``interact`` is the one *terminal* action: the agent cannot observe its
        own question, so there is nothing to feed back. On a valid payload it
        yields the widget event and **returns ``None``** — the shell reads that
        as "no observation to continue from" and stops the loop, waiting for the
        user's reply (which starts a fresh turn). A malformed payload is instead
        recoverable: it returns an error string so the agent can retry.
        """
        try:
            payload = self._normalize_interact_action(action)
        except ValueError:
            msg = "ask_user action requires non-empty questions."
            yield {
                "type": "error",
                "message": msg,
                "message_code": "agent.parseActionFailed",
            }
            return msg
        yield {
            "type": "interact",
            "thought": action.get("thought", ""),
            **payload,
        }
        return None

    # ------------------------------------------------------------------
    # Observation formatting
    # ------------------------------------------------------------------

    @staticmethod
    def _format_observation(
        step_index: int,
        display_instruction: str,
        code: str,
        data: dict[str, Any],
        workspace: Any,
        chart_id: str | None = None,
    ) -> str:
        """Build the trajectory observation for a successful visualize step."""
        data_summary = generate_data_summary(
            [{
                "name": data.get("virtual", {}).get("table_name", f"step_{step_index}"),
                "rows": data["rows"],
            }],
            workspace=workspace,
        )
        chart_ref = ""
        if chart_id:
            chart_ref = (
                f"\n\n**Chart id**: `{chart_id}` — to embed this chart in a report, "
                f"write `![caption](chart://{chart_id})`; to read it again, pass this "
                f"id to `inspect_chart`."
            )
        return (
            f"[OBSERVATION – Step {step_index}]\n\n"
            f"**Visualization**: {display_instruction}\n\n"
            f"**Code**:\n```python\n{code}\n```\n\n"
            f"**Transformed Data**:\n{data_summary}"
            f"{chart_ref}"
        )

    # ------------------------------------------------------------------
    # Action-argument normalizers (moved verbatim from the shell)
    # ------------------------------------------------------------------

    @classmethod
    def _sanitize_clarification_options(cls, raw_options: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_options, list):
            return []
        options: list[dict[str, Any]] = []
        for raw_option in raw_options[:3]:
            if isinstance(raw_option, str):
                label = raw_option.strip()
                label_code = ""
            elif isinstance(raw_option, dict):
                label = str(raw_option.get("label", "")).strip()
                label_code = str(raw_option.get("label_code", "")).strip()
            else:
                continue
            if not label and not label_code:
                continue
            option: dict[str, Any] = {}
            if label:
                option["label"] = label
            if label_code:
                option["label_code"] = label_code
            options.append(option)
        return options

    @classmethod
    def _sanitize_clarification_questions(cls, raw_questions: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_questions, list):
            return []
        questions: list[dict[str, Any]] = []
        for raw_question in raw_questions[:3]:
            if not isinstance(raw_question, dict):
                continue
            text = str(raw_question.get("text", "")).strip()
            text_code = str(raw_question.get("text_code", "")).strip()
            if not text and not text_code:
                continue
            options = cls._sanitize_clarification_options(raw_question.get("options"))
            response_type = raw_question.get("responseType") or raw_question.get("response_type")
            if response_type not in ("single_choice", "free_text"):
                response_type = "single_choice" if options else "free_text"
            question: dict[str, Any] = {
                "responseType": response_type,
                "required": bool(raw_question.get("required", True)),
            }
            if text:
                question["text"] = text
            if text_code:
                question["text_code"] = text_code
            if isinstance(raw_question.get("text_params"), dict):
                question["text_params"] = raw_question["text_params"]
            if options:
                question["options"] = options
            questions.append(question)
        return questions

    @classmethod
    def _normalize_interact_action(cls, action: dict[str, Any]) -> dict[str, Any]:
        """Normalize the ``interact`` action to ``{questions: [...]}``.

        Subsumes the clarify + explain shapes:
          * the native shape carries ``questions: [{text, options?, required?,
            responseType?}, ...]`` — clarifications (required answers / options)
            and explanations (a statement the user need not answer) side by side;
          * for back-compat we also accept a bare ``explanation`` string (+ an
            optional ``followups`` list rendered as that question's options),
            which becomes one non-required, free-text question.
        """
        questions = cls._sanitize_clarification_questions(action.get("questions"))

        explanation = str(action.get("explanation", "")).strip()
        if explanation:
            followups = cls._sanitize_clarification_options(action.get("followups"))
            explain_q: dict[str, Any] = {
                "text": explanation,
                "responseType": "single_choice",
                "required": False,
            }
            if followups:
                explain_q["options"] = followups
            questions.append(explain_q)

        if not questions:
            raise ValueError("ask_user action requires non-empty questions[]")
        return {"questions": questions}

def get_skill() -> CoreSkill:
    """Factory used by the registry's eager instantiation."""
    return CoreSkill()
