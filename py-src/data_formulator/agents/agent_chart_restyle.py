# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Chart restyle agent.

A single-turn agent that takes a Vega-Lite spec + a natural-language instruction
and returns a modified Vega-Lite spec representing the same chart with the
requested style changes applied.

The only HARD rule is that the agent must not touch the spec's `data` block —
the caller strips data on input and re-attaches the live rows on output, so the
data values, columns, and column names are fixed and reused as-is.

Encoding/mark/aggregation changes are allowed when the user's instruction calls
for them (e.g. "swap x and y", "make this a stacked bar"); the prompt's soft
guidance is to preserve them by default.

See: design-docs/28-chart-style-refinement-agent.md
"""

import copy
import json
import logging
from typing import Any

from data_formulator.agents.agent_utils import extract_json_objects

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = r'''You are a Vega-Lite chart-edit assistant.

You will be given:
- A Vega-Lite spec for the chart the user is currently looking at (the `data` block has been stripped — assume real rows are attached at render time)
- A small sample of the underlying data (head rows)
- A natural-language instruction describing the change the user wants
- The chart type label (e.g. "Bar Chart")
- Optionally, a STYLE REFERENCE spec from a previous version of this chart that captures the visual style the user wants preserved

Your job is to return a NEW Vega-Lite spec that applies the requested change. You can edit anything in the spec — encodings, marks, scales, axes, legends, titles, color schemes, the `transform` pipeline, etc. Do whatever the user asked for, as long as it can be expressed in Vega-Lite v5 over the columns already in the data sample.

When a STYLE REFERENCE is provided, follow it closely: carry its visual decisions (axis formatting, color schemes, legend placement, mark properties, titles, helper layers) forward onto the current spec wherever they still make sense. The user's instruction wins if they conflict.

Hard rules:
1. Do not include a `data` block in your output. The caller re-attaches live rows.
2. Only reference columns that exist in the data sample.

Out-of-scope: only refuse if the request genuinely needs data that isn't in the table — e.g. joining another dataset, a column that doesn't exist and can't be derived from existing ones. In that case return:
{"out_of_scope": true, "rationale": "<one sentence on what data is missing>"}

Otherwise return:
{
  "vlSpec": <the new Vega-Lite spec, with no `data` block>,
  "label": "<two-word lowercase label, e.g. \"dark theme\", \"rotated labels\", \"percent of total\">",
  "rationale": "<one short sentence on what you changed>"
}

Return ONLY the JSON object — no markdown fences, no commentary.
'''


class ChartRestyleAgent(object):
    """Single LLM call to produce a restyled Vega-Lite spec."""

    def __init__(self, client, language_instruction: str = ""):
        self.client = client
        self.language_instruction = language_instruction

    def run(
        self,
        vl_spec: dict,
        instruction: str,
        chart_type: str,
        data_sample: list[dict] | None = None,
        style_reference_spec: dict | None = None,
    ) -> dict:
        """Generate a restyled spec.

        Args:
            vl_spec: The current Vega-Lite spec (with `data` already stripped).
            instruction: The user's natural-language style instruction.
            chart_type: The chart template label (e.g. "Bar Chart").
            data_sample: A few sample rows so the agent can reason about
                value ranges and label lengths. Optional.
            style_reference_spec: An older Vega-Lite spec whose visual style
                the agent should follow closely. Used by the "refresh stale
                variant" flow so the new spec preserves the look the user
                originally created. Optional.

        Returns:
            On success: {"vlSpec": <new spec without data>, "rationale": str}
            On out-of-scope: {"out_of_scope": True, "rationale": str}
        """
        # Build the user message.
        parts: list[str] = [f"[CHART TYPE]\n{chart_type}\n"]

        if data_sample:
            try:
                sample_str = json.dumps(data_sample[:10], default=str, ensure_ascii=False)
            except Exception:
                sample_str = "[]"
            parts.append(f"[DATA SAMPLE (first 10 rows)]\n{sample_str}\n")

        try:
            spec_str = json.dumps(vl_spec, ensure_ascii=False)
        except Exception as e:
            logger.warning("ChartRestyleAgent: failed to serialize input spec", exc_info=e)
            spec_str = "{}"
        parts.append(f"[CURRENT VEGA-LITE SPEC]\n{spec_str}\n")

        if style_reference_spec:
            try:
                ref_str = json.dumps(style_reference_spec, ensure_ascii=False)
            except Exception:
                ref_str = ""
            if ref_str:
                parts.append(
                    "[STYLE REFERENCE — a previous spec for this same chart]\n"
                    "Carry the visual decisions in this spec forward onto the\n"
                    "current spec above (axes, colors, legends, mark properties,\n"
                    "helper layers, etc.) wherever they still make sense.\n"
                    f"{ref_str}\n"
                )

        parts.append(f"[USER INSTRUCTION]\n{instruction}\n")
        parts.append(
            "Return the JSON object described in the system prompt, "
            "applying the user's style instruction to the current spec."
        )

        user_text = "\n".join(parts)

        system_prompt = SYSTEM_PROMPT
        if self.language_instruction:
            system_prompt = system_prompt + "\n\n" + self.language_instruction

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]

        logger.info("[ChartRestyleAgent] run start | chart_type=%s", chart_type)

        response = self.client.get_completion(messages=messages)

        for choice in response.choices:
            content = choice.message.content or ""
            logger.debug("ChartRestyleAgent raw response:\n%s", content)
            blocks = extract_json_objects(content + "\n")
            for parsed in blocks:
                if not isinstance(parsed, dict):
                    continue
                if parsed.get("out_of_scope"):
                    return {
                        "out_of_scope": True,
                        "rationale": str(parsed.get("rationale", "")).strip(),
                    }
                new_spec = parsed.get("vlSpec")
                if isinstance(new_spec, dict):
                    cleaned = self._enforce_guardrails(vl_spec, new_spec)
                    if cleaned is not None:
                        return {
                            "vlSpec": cleaned,
                            "rationale": str(parsed.get("rationale", "")).strip(),
                            "label": str(parsed.get("label", "")).strip(),
                        }

        # No usable response.
        logger.warning("[ChartRestyleAgent] no valid spec extracted from LLM response")
        return {
            "out_of_scope": True,
            "rationale": "The model did not return a usable Vega-Lite spec.",
        }

    # ------------------------------------------------------------------
    # Guardrails
    # ------------------------------------------------------------------

    def _enforce_guardrails(self, original: dict, candidate: dict) -> dict | None:
        """Apply post-hoc guardrails to a candidate spec.

        Hard guardrail: strip any `data` block the model emitted. The caller
        re-attaches live data; we don't want the model to invent or filter
        rows.

        Field-binding changes are NOT rejected — they're allowed when the
        user's instruction calls for them (e.g. "swap x and y", "drop the
        color encoding"). We log them for diagnostics.

        Returns the cleaned spec on success, or None if the spec must be rejected.
        """
        cleaned = copy.deepcopy(candidate)
        cleaned.pop("data", None)

        # Diagnostic-only: note any encoding diffs so we can investigate
        # surprising agent behavior. Not a failure.
        original_bindings = self._collect_field_bindings(original)
        candidate_bindings = self._collect_field_bindings(cleaned)
        for key, orig_field in original_bindings.items():
            cand_field = candidate_bindings.get(key)
            if cand_field is None:
                logger.info(
                    "[ChartRestyleAgent] note: channel %s removed (was %r)",
                    key, orig_field,
                )
            elif cand_field != orig_field:
                logger.info(
                    "[ChartRestyleAgent] note: channel %s field changed %r -> %r",
                    key, orig_field, cand_field,
                )

        return cleaned

    def _collect_field_bindings(self, spec: Any) -> dict[str, str]:
        """Collect a flat map of (path -> field name) for every encoding.<channel>.field
        anywhere in the spec (top-level + nested under `layer`, `concat`, `vconcat`,
        `hconcat`, `spec`, `repeat`).
        """
        bindings: dict[str, str] = {}

        def walk(node: Any, path: str) -> None:
            if not isinstance(node, dict):
                return
            enc = node.get("encoding")
            if isinstance(enc, dict):
                for channel, ch_def in enc.items():
                    if isinstance(ch_def, dict) and "field" in ch_def:
                        bindings[f"{path}/encoding/{channel}"] = str(ch_def["field"])
            for container in ("layer", "concat", "vconcat", "hconcat"):
                arr = node.get(container)
                if isinstance(arr, list):
                    for i, child in enumerate(arr):
                        walk(child, f"{path}/{container}[{i}]")
            for key in ("spec", "repeat"):
                child = node.get(key)
                if isinstance(child, dict):
                    walk(child, f"{path}/{key}")

        walk(spec, "")
        return bindings
