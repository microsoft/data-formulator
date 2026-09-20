---
name: visualization
description: Transform workspace inputs and commit charts.
always_on: false
tools: []
actions:
  - visualize
---

# Visualization

Use `visualize` to run Python that produces a DataFrame and render it as a
chart. The result returns as an observation, so inspect it before deciding what
to do next.

Follow the workspace Data Access Paths to choose or load inputs. Compute
chart-specific filters, grouping, and ranking from their listed paths. No
separate `create_data` call is needed to prepare or publish chart data.

For the optional one-off chart path, declare `connector_inputs` in this call.
Each input has a unique `alias`, `source_id`,
`table_key`, and optional structured `query`. The backend persists the query
result and supplies `connector_inputs['alias']` as its actual Parquet path before
running Python. Read it with `pd.read_parquet(connector_inputs['alias'])`.
Do not guess a filename or connect to the source from sandboxed Python.

Connector inputs are added to provenance automatically; `input_sources` lists
other durable inputs used by the code. Use `[]` when there are no other inputs.
Matching loaded queries are reused. If Python or rendering fails, the returned
bindings remain available; retry with those paths instead of reloading.

- `title`: concise, neutral analytical heading naming the subject, measure, and
  lens. Do not name the chart type, imply causality, or editorialize.
- `subtitle`: supporting context not already clear from title or axes, at most
  16 words.
- `display_instruction`: at most 12 words stating the question or hypothesis.
- `code`: standalone Python producing the DataFrame named by `output_variable`.
- `input_sources`: durable inputs materially used by the transform. Use stable
  IDs and kinds from workspace context; use `[]` when none contributed.
- `field_metadata`: semantic annotations for encoded fields. Preserve units,
  baselines, intrinsic domains, and ordinal order; never invent a unit.
- `field_display_names`: concise human-readable labels for axes and legends.
- `chart.encodings`: map each channel to a Flint encoding object such as
  `{"x": {"field": "category", "type": "nominal"}}`. A bare field-name
  string is accepted as shorthand. Every `field` must name an output column.

Choose the chart from the analytical intent: comparison, trend, distribution,
relationship, composition, deviation, ranking, uncertainty, or spatial pattern.
Order time chronologically, ordinal values semantically, and rankings by their
measure. Aggregate, bin, facet, or limit excessive categories when needed.

Common chart contracts:

| Intent | Chart types | Required encoding shape |
|---|---|---|
| relationship | Scatter Plot, Regression | quantitative x and y |
| comparison | Bar Chart, Grouped Bar Chart, Lollipop Chart | category and value |
| trend | Line Chart, Area Chart | ordered x and value |
| distribution | Histogram, Density Plot, Boxplot, Violin Plot | raw quantitative values |
| composition | Stacked Bar Chart, Pie Chart, Streamgraph | value plus category |
| uncertainty | Range Area Chart | x, lower y, upper y2 |
| spatial | Map, Choropleth | longitude/latitude or region id |

Pass raw values to Histogram and ECDF Plot rather than precomputing bins or a
CDF. Regression computes its trend line; do not calculate predictions in code.
Pie Chart uses `size` for wedge values. Grouped Bar Chart uses `group`. Map uses
longitude/latitude; Choropleth uses region `id` and quantitative `color`.
All encoded fields must exist in the output DataFrame.