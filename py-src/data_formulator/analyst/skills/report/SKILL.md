---
name: report
description: >-
  Create a Markdown report from exploration findings, with supporting charts.
when_to_use: >-
  The user requests a report deliverable or a shareable narrative document
  built from charts and findings in the data thread. Not for an ordinary
  answer or summary, even if it needs expansion (follow the meta response rules),
  or for producing a single new chart (use visualize).
always_on: false
tools: []
actions:
  - write_report
---

# Skill: Report writing

## Scope and structure

Match the report's scope, audience, format, and length to the user's request;
do not force a fixed template. Use the focused thread for context and read other
threads (session/threads) only when relevant. Cover the requested findings, not automatically
every chart or step in the exploration.

Default to a descriptive title and concise sections organized around findings.
Use prose, tables, and charts where they help explain the evidence, with material
limitations and a takeaway when useful. Do not add sections just to fill a template.

## Grounding

Check the evidence behind key claims before writing. Reuse verified findings and
charts; read a chart and its table together with `read_file` (`session/charts/<id>.json`
gives the encodings; the table view gives the transformation code and sample rows)
when their meaning or values need confirmation. Use the backing data for
full-population claims, not just the sample. Create new charts or analysis only where needed for the requested report.
Do not invent numbers or imply unsupported causation; distinguish findings from
uncertainty and disclose material coverage limits.

## Delivery

Call `write_report` with the complete Markdown document in `report`, including any
needed charts already created. A successful call delivers the report as-is and
returns an observation; it does not end the run. Follow the baseline completion rules.

Embed supporting charts using `![caption](chart://chart_id)` on its own line.
The ID must be a chart in the session ([SESSION INDEX], session/charts) or from a successful `visualize` result.
Use concise captions and explain the relevant takeaway; avoid duplicate embeds.
Use standard Markdown tables for tabular results.
