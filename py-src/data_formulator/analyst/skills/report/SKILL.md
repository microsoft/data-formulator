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

## Reading first

The report is for the user to read and act on in the app, not a document to dress up.
Answer the request on the first screen — the bottom line, the key numbers, the main
caveat — then the support. Keep it scannable: short sections, tables over paragraphs
of figures, bullets for parallel points. Put what only some readers need (method, full
data, raw log lines, long lists) in collapsed details. Make every claim traceable: a
number to its chart or table, a statement to its source.

## Genre

Start the report with front matter naming its genre; it shapes the structure (the
reader picks typeface, density, and width):

```
---
style: research
---
```

- `notes` (default): a write-up of an exploration — findings as sections, prose around charts.
- `analysis`: data work — logs, prices, metrics, tables. Lead with the answer and the
  numbers (summary callout, metrics); then each finding with its chart or table and
  what it means; anomalies and data-quality issues as caveats; how it was computed and
  the full tables in details. For logs: a short timeline of what happened, with the
  telling log lines quoted (excerpts in code blocks).
- `research`: a review over papers or documents — state the evidence scope in a line or
  two (a caveat callout); cover the sources in a table (one row per source: what it does,
  its key result, its main limitation) rather than a paragraph each; group findings by
  theme in short bullets backed by excerpts and citations; contrast approaches with
  compare columns; end with references.
- `search`: a synthesis of web or search results — many sources of mixed reliability and
  date. Lead with the answer; then organize by claim: what sources agree on, where they
  conflict, what is unknown; cite every claim (`[^key]`, with the source's date and a
  quoted line); prefer primary and recent sources and say how many support each point.
- `brief`: a short answer or executive summary — a summary callout, metrics, two or three
  short sections, at most two charts. Cut everything else.

The genre guides shape and density; the request still decides the content.

## Blocks

Blocks open with `:::name{attributes}` and close with `:::`, each on its own line;
they can nest. Use them where they help the reader, not to decorate every section.

- **Excerpt** — show the key passage of a source instead of only paraphrasing it:
  ```
  :::excerpt{source="files/paper.pdf" page=4 title="Madaan et al. 2023, Self-Refine"}
  The exact words from the source.
  :::
  ```
  `source` is the session path you read (`files/…`, or the `scratch/…` file a tool
  saved, such as a fetched web page): the reader clicks the citation to open it at the
  quote (at `page` for PDFs), and the quote is checked against it for you. Add `url` for
  the public link and `section` ("§3.2", "Table 2") where it helps. Copy the words
  exactly; mark omissions with `…`. Keep excerpts short and say why each matters.
- **Callout** — `:::summary` (the key takeaways, as a few bullets, at the top),
  `:::finding`, `:::caveat` (a limitation or evidence gap), `:::definition`, or `:::note`;
  add `{title="…"}` to label it. A few per report at most.
- **Metrics** — headline numbers as cards: a `:::metrics` block holding a bullet list,
  one number per item, the value bold first: `- **$7,200** Monthly revenue — at full enrollment`.
  Three to six items; every number must come from the data.
- **Compare** — side-by-side columns for two to four options, papers, or segments:
  a `:::compare` block holding `:::column{title="…"}` blocks with short bullets each.
- **Details** — `:::details{title="How this was computed"}` holds material the reader
  may want but need not read: method, full tables, raw lines, long source lists. It
  shows collapsed under its title, so the title must say what is inside.
- **Citations** — cite sources with footnote markers, `…improves accuracy[^madaan]`,
  and define each once at the end, linking the session file you read (or the URL) and
  quoting the line that supports the claim:
  `[^madaan]: Madaan et al., [Self-Refine](scratch/…/2303.17651.md) (2023) — "Self-Refine improves performance across all seven tasks"`.
  They are numbered in order of use and listed as references; the reader hovers a number
  to preview it and clicks to open the source at the quoted line.
