# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from data_formulator.agents.agent_utils import generate_data_summary, extract_json_objects

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = r'''You are a data analyst helping users understand their visualizations.

You are given:
- The chart image.
- The chart type and the encoding spec (which fields are mapped to which visual channels, including any aggregation).
- [CHART-LEVEL DATA]: a small sample of the rows the chart actually plots.
- [SOURCE DATA SUMMARY]: a broader summary of the underlying tables.

Your task is to produce:

1. **title**: A short, descriptive title for the chart (5-10 words). Summarize the subject, the dimensions compared, and the scope. Do not include the chart type in the title. Use title case.

2. **summary**: A 1-2 sentence overview of what the chart shows — the subject, the observed pattern, and the scope. This reads as a figure caption directly under the chart, so write it for a reader who has not yet looked at any individual finding. Distinct from the short title (the title is the headline; the summary is the abstract). Do not name the chart type. Do not restate the title verbatim.

3. **insights**: A list of 1-3 structured insights. Each insight has:
   - "title": a 2-4 word noun phrase capturing the finding (e.g. "Q3 Sales Spike", "North Region Lead", "Rising Errors"). Title case. No leading kind label like "Anomaly:" — the kind is shown via a colored icon in the UI.
   - "text": one sentence describing a key finding. Be specific — reference actual values, categories, or trends that are visible in the chart and verifiable from the [CHART-LEVEL DATA].
   - "kind": exactly one of {"anomaly", "comparison", "trend", "relationship"} — the type of finding. See [INSIGHT KIND] below.

[INSIGHT KIND]
Classify each insight with exactly one "kind" — one of:
- "anomaly":      an outlier, spike, dip, or unusual value compared to its neighbors or the overall pattern.
- "comparison":   a top-N / ranking / ordering / max / min observation, or a gap between groups (e.g. "North leads", "Q3 is lowest").
- "trend":        a monotonic or directional change along a continuous (usually temporal) axis (e.g. "revenue is rising", "errors decline over time").
- "relationship": a correlation, distribution shape, composition, or structural pattern across two or more variables (e.g. "marketing spend correlates with revenue", "distribution is bimodal").

If a finding legitimately blends two kinds (e.g. a Q3 spike that is both an anomaly and a trend reversal), pick the dominant one — the aspect a reader of the chart would notice first. Use exactly one of the four values above; do not invent new ones, do not abbreviate, do not omit.

Respond with a JSON object in exactly this format (no markdown fences):

{"title": "...", "summary": "...", "insights": [{"title": "...", "text": "...", "kind": "anomaly"}, {"title": "...", "text": "...", "kind": "trend"}]}
'''


# Whitelist of kinds the agent is allowed to emit.  Anything else is
# dropped at parse time — the frontend then renders such insights as
# the catch-all "observation" kind.  Keep in sync with `InsightKind` in
# `src/components/ComponentType.tsx`.
ALLOWED_KINDS = frozenset({"anomaly", "comparison", "trend", "relationship"})


def _format_encoding_spec(encoding_map):
    """Render the encoding map as a compact human-readable block.

    Input shape: {channel: {field: str, aggregate?: str, dtype?: str}}.
    Skips channels with no field assigned.

    For aggregated channels, also surfaces the synthesized chart-level
    column name (e.g. ``Revenue_average``) so the LLM can match encoding
    channels to the columns it sees in [CHART-LEVEL DATA].
    """
    if not isinstance(encoding_map, dict) or not encoding_map:
        return ""

    lines = []
    has_aggregate = False
    for channel, enc in encoding_map.items():
        if not isinstance(enc, dict):
            continue
        field = enc.get('field') or enc.get('fieldID') or enc.get('fieldName')
        if not field:
            continue
        aggregate = enc.get('aggregate')
        dtype = enc.get('dtype')
        if aggregate:
            has_aggregate = True
            # Mirror frontend's prepVisTable column naming: <field>_<agg>
            # (count is special — surfaces as a top-level "_count" column)
            if aggregate == 'count':
                synthesized = '_count'
            else:
                synthesized = f"{field}_{aggregate}"
            descr = f"{channel} → {field} (aggregate={aggregate}, appears in chart data as `{synthesized}`)"
        else:
            descr = f"{channel} → {field}"
        if dtype:
            descr += f" [dtype={dtype}]"
        lines.append("  - " + descr)

    if not lines:
        return ""

    header = "[ENCODING SPEC]"
    if has_aggregate:
        header += "  (when aggregated, the chart-level column is the synthesized name shown)"
    return header + "\n" + "\n".join(lines)


def _format_chart_data_sample(chart_data_sample, max_rows=10):
    """Render a small sample of chart-level rows as a TSV-ish block.

    Truncates to ``max_rows``.  Keeps the format similar to pandas
    .to_string() so the LLM has a clear schema-by-example.
    """
    if not isinstance(chart_data_sample, list) or not chart_data_sample:
        return ""

    rows = chart_data_sample[:max_rows]
    # Collect a stable column order from the first row, then any extras.
    cols = []
    seen = set()
    for r in rows:
        if not isinstance(r, dict):
            continue
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                cols.append(k)
    if not cols:
        return ""

    def _fmt(v):
        if v is None:
            return ""
        s = str(v)
        return s if len(s) <= 60 else s[:57] + "..."

    header = "\t".join(cols)
    body_lines = ["\t".join(_fmt(r.get(c)) for c in cols) for r in rows]
    sample_block = header + "\n" + "\n".join(body_lines)

    truncated_note = ""
    if len(chart_data_sample) > max_rows:
        truncated_note = f"\n... ({len(chart_data_sample) - max_rows} more rows not shown)"

    return f"[CHART-LEVEL DATA] (sample of rows the chart plots)\n{sample_block}{truncated_note}"


class ChartInsightAgent(object):

    def __init__(self, client, workspace=None, language_instruction="", knowledge_store=None):
        self.client = client
        self.workspace = workspace
        self.language_instruction = language_instruction
        self._knowledge_store = knowledge_store

    def run(self, chart_image_base64, chart_type, field_names, input_tables=None,
            chart_data_sample=None, encoding_map=None, n=1):
        """
        Generate insight for a chart.

        Args:
            chart_image_base64: Base64-encoded PNG data URL of the chart.
            chart_type: The type of chart (e.g., "Bar Chart", "Scatter Plot").
            field_names: List of resolved field names referenced by the chart.
            input_tables: Optional list of input table dicts for source-data context.
            chart_data_sample: Optional list of dicts — sample of the rows the
                chart actually plots (raw fields, pre-aggregation). Helps ground
                insight text in the actual values the chart shows.
            encoding_map: Optional dict {channel: {field, aggregate?, dtype?}}
                describing how raw fields map to visual channels and which
                channels apply aggregation.
            n: Number of candidates to generate.
        """

        # Build chart metadata block
        context_parts = [f"Chart type: {chart_type}"]
        context_parts.append(f"Fields referenced: {', '.join(field_names)}")
        
        # Format the encoding spec
        encoding_block = _format_encoding_spec(encoding_map)
        if encoding_block:
            context_parts.append(encoding_block)
        
        # Format the chart data sample
        chart_data_block = _format_chart_data_sample(chart_data_sample)
        if chart_data_block:
            context_parts.append(chart_data_block)

        if input_tables and self.workspace:
            data_summary = generate_data_summary(
                input_tables, workspace=self.workspace,
                include_data_samples=True, row_sample_size=3
            )
            
            context_parts.append(f"\n[DATA SUMMARY]\n{data_summary}")
            
        # Search relevant knowledge for analysis context
        if self._knowledge_store:
            try:
                search_query = " ".join([chart_type] + field_names[:5]).strip()
                if search_query:
                    relevant = self._knowledge_store.search(
                        search_query, categories=["experiences"], max_results=3,
                    )
                    if relevant:
                        kb_parts = ["Relevant analysis knowledge:"]
                        for item in relevant:
                            kb_parts.append(f"- {item['title']}: {item['snippet'][:200]}")
                        context_parts.append("\n".join(kb_parts))
            except Exception:
                logger.warning("Failed to search knowledge experiences", exc_info=True)

        # Assemble the context
        context = "\n".join(context_parts)

        # Build the message with image
        user_content = [
            {
                "type": "text",
                "text": f"[CHART METADATA]\n{context}\n\n[CHART IMAGE]\nHere is the chart to analyze:"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{chart_image_base64}",
                    "detail": "high"
                }
            }
        ]

        system_prompt = SYSTEM_PROMPT

        if self._knowledge_store:
            system_prompt += self._knowledge_store.format_rules_block()

        if self.language_instruction:
            system_prompt = system_prompt + "\n\n" + self.language_instruction

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ]

        has_chart_data = bool(chart_data_sample)
        has_encoding_spec = bool(encoding_block)
        logger.debug(f"ChartInsightAgent: analyzing {chart_type} chart with fields {field_names}")
        logger.info(
            f"[ChartInsightAgent] run start | chart_type={chart_type}"
            f" | has_chart_data={has_chart_data} | has_encoding_spec={has_encoding_spec}"
        )

        response = self.client.get_completion(messages=messages)

        candidates = []
        for choice in response.choices:
            logger.debug("\n=== Chart insight result ===>\n")
            logger.debug(choice.message.content + "\n")

            response_content = choice.message.content
            title = ""
            summary = ""
            insights = []

            # Parse JSON response
            json_blocks = extract_json_objects(response_content + "\n")
            for parsed in json_blocks:
                title = parsed.get('title', '')
                raw_summary = parsed.get('summary', '')
                if isinstance(raw_summary, str):
                    summary = raw_summary.strip()
                raw_insights = parsed.get('insights', [])
                if isinstance(raw_insights, list):
                    for ins in raw_insights:
                        if isinstance(ins, str):
                            insights.append({'text': ins})
                        elif isinstance(ins, dict) and ins.get('text'):
                            entry = {'text': ins['text']}
                            # Per-insight short title (2-4 word noun phrase).
                            # Optional — frontend falls back to first words of text.
                            raw_ins_title = ins.get('title')
                            if isinstance(raw_ins_title, str) and raw_ins_title.strip():
                                entry['title'] = raw_ins_title.strip()
                            # Whitelist the "kind" field — drop anything outside
                            # the known taxonomy so the frontend's fallback to
                            # "observation" is the only path for unknown kinds.
                            raw_kind = ins.get('kind')
                            if isinstance(raw_kind, str) and raw_kind in ALLOWED_KINDS:
                                entry['kind'] = raw_kind
                            insights.append(entry)
                # Backward compat: fall back to plain takeaways if insights absent
                if not insights:
                    takeaways = parsed.get('takeaways', [])
                    if isinstance(takeaways, str):
                        takeaways = [takeaways]
                    insights = [{'text': tw} for tw in takeaways]
                if title or summary or insights:
                    break

            # Derive plain takeaways list from insights for backward compat
            takeaways = [ins['text'] for ins in insights]

            if title or summary or insights:
                result = {
                    'status': 'ok',
                    'title': title,
                    'summary': summary,
                    'insights': insights,
                    'takeaways': takeaways,
                }
            else:
                logger.error(f"unable to parse insight from response: {response_content}")
                result = {
                    'status': 'other error',
                    'content': 'unable to generate chart insight'
                }

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'ChartInsightAgent'

            candidates.append(result)

        status = candidates[0].get('status', '?') if candidates else 'empty'
        logger.info(f"[ChartInsightAgent] run done | status={status}")
        return candidates
