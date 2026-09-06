from __future__ import annotations

from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult


class InteractionSkill:
    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        return ToolResult(text=f"interaction has no tool '{name}'.")

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action == "ask_user":
            return (yield from self._handle_interact(spec, ctx))
        yield {
            "type": "error",
            "message": f"interaction cannot handle action '{action}'.",
            "message_code": "agent.unknownAction",
        }
        return f"interaction cannot handle action '{action}'."

    def _handle_interact(
        self, action: dict[str, Any], ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        try:
            payload = self._normalize_interact_action(action)
        except ValueError:
            message = "ask_user action requires non-empty questions."
            yield {
                "type": "error",
                "message": message,
                "message_code": "agent.parseActionFailed",
            }
            return message
        yield {
            "type": "interact",
            "thought": action.get("thought", ""),
            **payload,
        }
        return None

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
        questions = cls._sanitize_clarification_questions(action.get("questions"))

        explanation = str(action.get("explanation", "")).strip()
        if explanation:
            followups = cls._sanitize_clarification_options(action.get("followups"))
            explain_question: dict[str, Any] = {
                "text": explanation,
                "responseType": "single_choice",
                "required": False,
            }
            if followups:
                explain_question["options"] = followups
            questions.append(explain_question)

        if not questions:
            raise ValueError("ask_user action requires non-empty questions[]")
        return {"questions": questions}


def get_skill() -> InteractionSkill:
    return InteractionSkill()