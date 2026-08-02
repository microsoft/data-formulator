# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""core skill — the analyst's always-on baseline capabilities.

Every other skill is optional and gated; ``core`` is ``always_on`` and loaded
automatically at the start of each run, so the agent is never truly empty. It
contributes the built-in data-inspection **tools** (``explore`` /
``inspect_source_data`` — ``load_skill`` is assembled by the shell because its
enum is dynamic) and the always-available **actions** — the committing tool
calls the agent acts with (``visualize`` / ``interact`` / ``delegate``; see
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
from data_formulator.security.code_signing import sign_result

from data_formulator.analyst.skills.base import (
    Event,
    SkillContext,
    ToolResult,
)

logger = logging.getLogger(__name__)

# Valid targets for a ``delegate`` action. Report generation is NOT a delegate
# target — it is the ``write_report`` action unlocked by the report skill.
_DELEGATE_TARGETS: tuple[str, ...] = ("data_loading",)


class CoreSkill:
    """The core skill processor: the ``explore`` / ``inspect_source_data`` tool
    handlers and the ``visualize`` / ``interact`` / ``delegate`` action handlers.

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
        if action == "delegate":
            return (yield from self._handle_delegate(spec, ctx))
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
        step_index = int((ctx.payload or {}).get("completed_step_count", 0)) + 1

        yield {
            "type": "action",
            "action": "visualize",
            "display_instruction": display_instruction,
            "input_tables": action.get("input_tables", []),
        }

        viz_result = ctx.runtime.run_visualize_code(
            code=code,
            output_variable=output_variable,
            chart_spec=chart_spec,
            field_metadata=field_metadata,
            field_display_names=field_display_names,
            display_instruction=display_instruction,
            title=title,
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
    # delegate — hand off to a peer agent
    # ------------------------------------------------------------------

    def _handle_delegate(
        self, action: dict[str, Any], ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        try:
            payload = self._normalize_delegate_action(action)
        except ValueError as exc:
            msg = str(exc) or "delegate action requires target and delegate_prompt."
            yield {
                "type": "error",
                "message": msg,
                "message_code": "agent.parseActionFailed",
            }
            return msg
        yield {
            "type": "delegate",
            "thought": action.get("thought", ""),
            **payload,
        }
        return (
            f"[DELEGATED to {payload['target']}] Handed off to the "
            f"'{payload['target']}' agent; this run is complete."
        )

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

    @classmethod
    def _normalize_delegate_action(cls, action: dict[str, Any]) -> dict[str, Any]:
        target = str(action.get("target", "")).strip()
        if target not in _DELEGATE_TARGETS:
            raise ValueError(
                f"delegate action requires 'target' ∈ {_DELEGATE_TARGETS}, got {target!r}"
            )
        message = str(action.get("message") or "").strip()
        # The agent writes a single complete instruction in `delegate_prompt`.
        # Fall back to the legacy `options[]` shape so older callers / cached
        # specs still hand off gracefully.
        delegate_prompt = str(action.get("delegate_prompt") or "").strip()
        if not delegate_prompt:
            raw_options = action.get("options")
            if isinstance(raw_options, list):
                for opt in raw_options:
                    if isinstance(opt, str) and opt.strip():
                        delegate_prompt = opt.strip()
                        break
        if not delegate_prompt:
            raise ValueError("delegate action requires a non-empty 'delegate_prompt'")
        payload: dict[str, Any] = {"target": target, "delegate_prompt": delegate_prompt}
        if message:
            payload["message"] = message
        return payload


def get_skill() -> CoreSkill:
    """Factory used by the registry's eager instantiation."""
    return CoreSkill()
