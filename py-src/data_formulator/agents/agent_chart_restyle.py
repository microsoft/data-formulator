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

from data_formulator.agent_config import reasoning_effort_for
logger = logging.getLogger(__name__)

_AGENT_ID = "chart_restyle"

from data_formulator.agents.agent_utils import extract_json_objects
from data_formulator.agents.agent_language import inject_language_instruction

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
3. Preserve field-name escaping EXACTLY. Column names containing `.`, `[`, or `]` are escaped with a backslash in `field` references (e.g. a column literally named `Tomatoes, per lb.` appears as `"field": "Tomatoes, per lb\\."`). Keep those backslashes intact — do not drop or add them. An unescaped `.` makes Vega-Lite read it as a nested-object path, which breaks the chart (empty plot).

Out-of-scope: refuse if the request genuinely needs data that simply isn't there and can't be derived in Vega-Lite — e.g. joining a separate dataset, or a column that doesn't exist and can't be computed from the existing ones. Anything expressible with a Vega-Lite `transform` (aggregations, calculated fields, filters, folds, window/joinaggregate, etc.) is in scope — add the transforms you need. If you do refuse, return:
{"out_of_scope": true, "rationale": "<one sentence on what data is missing>"}

Otherwise return:
{
  "vlSpec": <the new Vega-Lite spec, with no `data` block>,
  "label": "<two-word lowercase label, e.g. \"dark theme\", \"rotated labels\", \"percent of total\">",
  "rationale": "<one short sentence on what you changed>",
  "configUI": <a SHORT list (2-4) of simple follow-up controls — see below>
}

[configUI — generative follow-up controls]
After you produce the new spec, design 2-4 small UI controls that let the user keep tweaking THIS specific variant without re-prompting. Pick knobs that are meaningful for the chart you just made (e.g. mark opacity, corner radius, point size, font size, gridlines on/off, label angle, color scheme, legend position).

Each control declares WHERE in the spec it writes and the allowed VALUES — there is NO code, just a `path` (the location in the spec) plus the value the chosen option writes there. Shapes:
- "key": short unique id, lowercase no spaces, e.g. "opacity"
- "label": short human label, e.g. "opacity"
- "path": array describing the location in the vlSpec to write the value to, e.g. ["mark","opacity"] or ["encoding","x","axis","labelAngle"] or ["config","legend","orient"]. Use array indices (numbers) for arrays, e.g. ["layer",0,"mark","color"]. Intermediate objects are created if missing.
- "type": one of "continuous" | "binary" | "discrete"
- for "continuous": "min", "max", optional "step", and "defaultValue" (number) — the value written at `path` is the number itself
- for "binary": "defaultValue" (true/false) — the boolean is written at `path`
- for "discrete": "options" (array of {"value": <any>, "label": "<text>"}) and "defaultValue" — the chosen option's `value` is written at `path`. The `value` may be a scalar OR a whole object (e.g. a full mark sub-spec or a color array), which the app sets wholesale at `path`.

Rules for configUI:
- `defaultValue` MUST equal what the spec you returned already encodes at that `path`, so the controls start in sync with the chart.
- Make sure `path` points at a real location in the spec you returned (so toggling actually changes the visible chart).
- Never use "__proto__", "prototype", or "constructor" as a path segment.

Example configUI:
[
  {"key": "opacity", "label": "opacity", "type": "continuous", "min": 0.2, "max": 1, "step": 0.05, "defaultValue": 0.9, "path": ["mark", "opacity"]},
  {"key": "grid", "label": "gridlines", "type": "binary", "defaultValue": true, "path": ["encoding", "y", "axis", "grid"]},
  {"key": "scheme", "label": "palette", "type": "discrete", "defaultValue": "tableau10", "path": ["encoding", "color", "scale", "scheme"],
   "options": [{"value": "tableau10", "label": "tableau"}, {"value": "category10", "label": "category"}, {"value": "set2", "label": "set2"}]}
]

If no meaningful per-variant control fits, return "configUI": [].

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

        system_prompt = inject_language_instruction(SYSTEM_PROMPT, self.language_instruction)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]

        logger.info("[ChartRestyleAgent] run start | chart_type=%s", chart_type)

        response = self.client.get_completion(messages=messages, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model))

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
                            "configUI": self._sanitize_config_ui(parsed.get("configUI")),
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

    _FORBIDDEN_PATH_SEGMENTS = {"__proto__", "prototype", "constructor"}

    def _sanitize_config_ui(self, raw: Any) -> list[dict]:
        """Validate the LLM-authored configUI array into a clean list.

        Each control is a declarative "write value at path" knob — there is no
        code. We validate the path (non-empty, no prototype-polluting segments)
        and the per-type params, dropping anything malformed. Returns [] when
        nothing is usable. The frontend re-validates as well.
        """
        if not isinstance(raw, list):
            return []
        out: list[dict] = []
        seen: set[str] = set()
        for c in raw:
            if not isinstance(c, dict):
                continue
            key = str(c.get("key", "")).strip()
            label = str(c.get("label", "")).strip()
            ctype = c.get("type")
            if not key or not label or key in seen:
                continue

            # Validate path: non-empty list of str / non-negative int, no
            # prototype-polluting segments.
            raw_path = c.get("path")
            if not isinstance(raw_path, list) or len(raw_path) == 0:
                continue
            path: list = []
            path_ok = True
            for seg in raw_path:
                if isinstance(seg, bool):
                    path_ok = False
                    break
                if isinstance(seg, int) and seg >= 0:
                    path.append(seg)
                elif isinstance(seg, str) and seg and seg not in self._FORBIDDEN_PATH_SEGMENTS:
                    path.append(seg)
                else:
                    path_ok = False
                    break
            if not path_ok:
                continue

            if ctype == "binary":
                out.append({"key": key, "label": label, "type": "binary",
                            "path": path, "defaultValue": bool(c.get("defaultValue"))})
            elif ctype == "continuous":
                try:
                    cmin = float(c.get("min"))
                    cmax = float(c.get("max"))
                except (TypeError, ValueError):
                    continue
                if not (cmax > cmin):
                    continue
                entry = {"key": key, "label": label, "type": "continuous",
                         "path": path, "min": cmin, "max": cmax}
                try:
                    step = float(c.get("step"))
                    if step > 0:
                        entry["step"] = step
                except (TypeError, ValueError):
                    pass
                try:
                    entry["defaultValue"] = float(c.get("defaultValue"))
                except (TypeError, ValueError):
                    entry["defaultValue"] = cmin
                out.append(entry)
            elif ctype == "discrete":
                opts_raw = c.get("options")
                if not isinstance(opts_raw, list):
                    continue
                options = [
                    {"value": o.get("value"), "label": str(o.get("label", "")).strip()}
                    for o in opts_raw
                    if isinstance(o, dict) and str(o.get("label", "")).strip()
                ]
                if not options:
                    continue
                default = c.get("defaultValue", options[0]["value"])
                out.append({"key": key, "label": label, "type": "discrete",
                            "path": path, "options": options, "defaultValue": default})
            else:
                continue
            seen.add(key)
        return out

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
