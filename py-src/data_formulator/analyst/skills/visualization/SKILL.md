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

## Progressive Visual Analysis

When grounded data supports a view that advances the question, publish it and
use the returned evidence to guide subsequent analysis; do not reserve all charts
for final delivery. Reuse useful views and avoid redundant charts. Respect explicit
nonvisual requests; prefer a scalar or table for exact lookups or validation tallies.
Inspect the returned data, specification, and diagnostics, claiming visual inspection
only when image evidence is available. Verify numerical claims independently.
Before comparing periods, check that the first and last periods are complete;
flag or exclude partial ones. Answer from the data; label facts it cannot support.

## Inputs and Publication

Each `visualize` parameter describes what to write in it. Keep the code standalone and
every encoded field an output column.

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