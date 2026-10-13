---
name: html_app
description: >-
  Build an interactive app (dashboard, explorer, comparison tool, or custom
  visual) that runs in a sandbox on the canvas and reads workspace tables live.
when_to_use: >-
  The user asks for an interactive app, dashboard, explorer, or custom UI with
  controls such as filters, tabs, sliders, drill-down, or linked views, or asks
  to change an existing app. Not for a
  narrative document (use report), a single chart (use visualize), a plain file,
  or an ordinary answer.
always_on: false
tools: []
actions:
  - write_app
  - write_html_app
---

# Skill: Interactive apps

## Plan

Ground the app in workspace data before writing it. Confirm the tables and
exact column names and types it needs; load, create, or derive missing tables
first (for example a cleaned or pre-aggregated table from `create_data`).
Declare every table the app reads in `tables`, and every connected source it
queries live in `sources`. Build one focused app around the
user's question: a headline, a few linked views, and only the controls that
change them.

Use what the session already shows, as ideas rather than rules:

- Continue the analysis: earlier questions, findings, and the session's charts
  ([SESSION INDEX], session/charts) show what the user cares about. Reuse the
  tables behind those charts.
- Dimensions, metrics, and periods the user switched between make natural
  controls; default them to what was discussed.
- Field semantics (units, percentages, date granularity) decide formats;
  never sum rates or averages.
- Fit the purpose: monitoring, explaining a finding, exploring, or comparing.
- Compute headline numbers from the data, not from the conversation, and note
  earlier caveats (cleaning, exclusions) in a `Note`.
- With little context, build a broad overview of the key measures.

## The app file

Write apps with `write_app` as one React file (`<name>.app.jsx`) whose default
export is the app component. It runs in a sandbox: no network, browser storage,
dialogs, or navigation; keep state in React. Import only from these modules:

- `react`: hooks (`useState`, `useMemo`, …).
- `@df/ui`, `@df/data`, `@df/chart`, `@df/format`, `@df/icons` (below).
- `d3`, `lodash`, `@df/geo`: for custom visuals and data shaping (below).
- `@mui/material`: rarely needed; DF components already match the DF theme.

Never hardcode colors or fonts. Read data only with `@df/data`; do not embed it,
including map boundaries (use `@df/geo` or Flint's Map charts).

## `@df/data`

- `useQuery(table, options)` → `{rows, totalRowCount, loading, error, truncated}`.
  Re-runs when options change; stale responses are dropped. Options (no others):
  `columns` (group-by keys when aggregating); `aggregates`:
  `[{op: "count"}, {op: "sum" | "avg" | "min" | "max", field}]` producing
  `_count`, `<field>_sum`, `<field>_avg`, …; `filters`:
  `{field, op: "in", values}`, `{field, op: "range", min, max}`,
  `{field, op: "contains", value}` (AND); `search`; `orderBy`: a column, a list,
  or `[{field, descending}]` (with aggregates, also result columns such as
  `amount_sum`); `descending`; `limit` (default 5000, max 50000); `offset`.
  Pass `null` as the table to skip a query.
- `useDistinct(table, column, {limit, filters})` → the query result plus
  `values` (sorted distinct values), e.g. for a `Select`.
- `useTable(table, {limit})` → all rows of a small table.

- `useSql(sql, params, {limit})` → the same result shape, from read-only DuckDB
  SQL over the declared tables, referred to by name: joins, window functions,
  date bucketing, percentiles, `CASE`. Use `?` placeholders bound from `params`
  (for filter values); never splice values into the text. One `SELECT` (CTEs
  allowed); no table functions. Rows are capped at `limit` (default 5000,
  max 50000); `truncated` says more matched. Pass `null` as sql to skip it.
- `useSourceQuery(source, query, {limit})` → the same result shape, read live
  from a connected source declared in `sources` (its reference id), each time
  the app runs. `query` is the data-loading shape: `filters`
  (`[{column, op, value}]`), `columns`, `group_by`, `aggregates`
  (`[{op, column, as}]`, op `count`/`count_distinct`/`sum`/`avg`/`min`/`max`),
  `order_by` (`[{column, dir}]`), `limit`, or `native: {language, text}` where
  the source allows it. Use it when the app must show current source data;
  prefer workspace tables for data already loaded.

Aggregate and filter in the query (`useSql` or `useQuery` options) instead of
loading all rows and computing in JavaScript.

## `@df/ui`

Pass a query result as `query` and the component shows loading, empty, and
error states itself; `children` may then be a function of the rows.

- Layout: `Page {title, eyebrow, subtitle, meta}` (always the root),
  `Section {title, actions}`, `Grid {min=320 | columns | main}` (`main` = 2:1),
  `Row`, `Stack`, `Note` (sources and caveats).
- Filters: `FilterBar {sticky}` holding `Select {label, value, onChange, options,
  allLabel, loading}`, `MultiSelect {label, value, onChange, options}`,
  `Chips {label, value, onChange, options}` (multi-select toggles),
  `Segmented {label, value, onChange, options}` (2–5 choices),
  `RangeSlider {label, value: [lo, hi], onChange, min, max, step, format}`,
  `Search {label, value, onChange}`. `options` are values or `{value, label}`;
  `allLabel` adds an "all" choice with value `''`.
- Views: `Tabs {items: [{value, label, content}]}` (only the active tab mounts).
- Tiles: `Card` / `ChartCard {title, subtitle, actions, footer, query, empty,
  height, wide}`; `KpiGrid {query}` holding `Kpi {label, value, unit, delta,
  deltaFormat, goodDirection: "up" | "down", note, spark: {data, x, y}}`;
  `Callout {title, tone: "info" | "warning"}`; `Badge {tone}`.
- Data: `DataTable {data | query, columns: [{field, label, format, align, bar}],
  maxHeight}`; `format` is `"number"`, `"number:2"`, `"compact"`, `"percent"`,
  `"delta"`, `"date"`, or a function; `bar` draws an in-cell bar.
- States: `QueryView {query, empty}`, `Loading`, `Empty`, `ErrorState`.

## `@df/chart`, `@df/format`, `@df/icons`

- `FlintChart {chartType, encodings, data | query, table, labels, title,
  subtitle, theme, height = 260}` is the same chart engine as the DF canvas. `encodings` maps
  channels (`x`, `y`, `color`, `size`, `column`, …) to a column name or
  `{field, type, aggregate, sortBy, sortOrder}`; leave out `type` unless needed.
  Pass `table` when the rows keep that table's columns so its semantic types
  apply, and `labels` (`{field: "Axis title"}`) for computed columns. `theme` is
  a Flint theme id (e.g. `"economist"`); when the session's charts use one (the
  `theme` in `session/charts/<id>.json`), pass the same so the app matches. Chart types include Bar Chart, Grouped Bar Chart, Stacked Bar Chart,
  Line Chart, Area Chart, Scatter Plot, Heatmap, Histogram, Boxplot, Pie Chart,
  Donut Chart, Lollipop Chart, Slope Chart, Bump Chart, Range Area Chart, Map
  (`latitude`/`longitude`, with `size`/`color`), Choropleth (country or US state
  names or codes as `id`). Maps draw world or US boundaries offline.
- `VegaChart {spec, data | query, height}`: a raw Vega-Lite spec for custom
  visuals; `width` defaults to the container.
- `Sparkline {data, x, y}`.
- `format.number(v, digits)`, `.compact(v)` (12.3K), `.percent(v)` (ratios
  0–1), `.delta(v)` (+1.2 / −0.4), `.date(v)`; each returns "—" for missing values.
- `Icon {name}`: `trend-up`, `trend-down`, `info`, `warning`, `money`, `people`,
  `globe`, `calendar`, `time`, `chart`, `table`, `search`, `filter`, `star`, …

## `d3`, `lodash`, `@df/geo`

Prefer `FlintChart`; reach for d3 only for visuals Flint lacks (custom maps,
networks, trees, annotated diagrams).

- `d3`: the full d3 v7 API. Compute scales, shapes, layouts, and projections in
  `useMemo` and render SVG with React; size from the container.
- `lodash`: `import _ from 'lodash'` or named imports (`groupBy`, `sumBy`,
  `orderBy`, …) for shaping query results. Only the `lodash` module path.
- `@df/geo`: boundaries for d3 maps. `countries()` and `states()` return GeoJSON
  features (`id`: ISO 3166-1 numeric or FIPS; `properties.name`); also `land()`,
  `nation()`, `countryBorders()`, `stateBorders()`, the `world` and `us`
  TopoJSON, and `feature` / `mesh` from topojson-client. Project US states with
  `d3.geoAlbersUsa()`.

## Starter app

```jsx
import { useState } from 'react';
import { Page, FilterBar, Select, Segmented, KpiGrid, Kpi, Grid, ChartCard, DataTable, Note, Badge } from '@df/ui';
import { useQuery, useDistinct } from '@df/data';
import { FlintChart } from '@df/chart';
import { format } from '@df/format';

export default function App() {
  const [region, setRegion] = useState('');
  const [metric, setMetric] = useState('revenue');
  const regions = useDistinct('sales', 'region');
  const filters = region ? [{ field: 'region', op: 'in', values: [region] }] : [];
  const value = `${metric}_sum`;
  const monthly = useQuery('sales', { columns: ['month'], filters, aggregates: [{ op: 'sum', field: metric }], orderBy: 'month' });
  const top = useQuery('sales', { columns: ['product'], filters, aggregates: [{ op: 'sum', field: metric }],
    orderBy: [{ field: value, descending: true }], limit: 8 });
  const rows = monthly.rows;
  const total = rows.reduce((sum, row) => sum + row[value], 0);
  const first = rows[0]?.[value];
  const last = rows[rows.length - 1]?.[value];

  return (
    <Page eyebrow="Sales" title="Revenue grew through the year" subtitle="Monthly sales by region and product."
          meta={<Badge>{rows.length} months</Badge>}>
      <FilterBar>
        <Select label="Region" value={region} onChange={setRegion} options={regions.values} allLabel="All regions" />
        <Segmented label="Metric" value={metric} onChange={setMetric}
                   options={[{ value: 'revenue', label: 'Revenue' }, { value: 'orders', label: 'Orders' }]} />
      </FilterBar>
      <KpiGrid query={monthly}>
        <Kpi label="Total" value={format.compact(total)} delta={first ? (last - first) / first : null}
             deltaFormat={format.percent} note="Change from first to last month" spark={{ data: rows, x: 'month', y: value }} />
      </KpiGrid>
      <Grid main>
        <ChartCard title="Monthly trend" subtitle="Selected metric per month" query={monthly}>
          {data => <FlintChart chartType="Line Chart" data={data} encodings={{ x: 'month', y: value }}
                               labels={{ month: 'Month', [value]: metric === 'revenue' ? 'Revenue' : 'Orders' }} />}
        </ChartCard>
        <ChartCard title="Top products" query={top}>
          {data => <DataTable data={data} columns={[{ field: 'product', label: 'Product' }, { field: value, label: 'Total', format: 'compact', bar: true }]} />}
        </ChartCard>
      </Grid>
      <Note>Source: sales table. Months without orders are omitted.</Note>
    </Page>
  );
}
```

## Quality checklist

- The headline states the finding or purpose; 3–5 KPIs lead with the key
  numbers, their units and period, and a delta or sparkline when change matters.
- Filters on top, KPIs, then one primary chart card with supporting cards beside
  or below. Every card has a title that says what it shows and its unit.
- Controls apply immediately and default to a meaningful selection.
- Skip nulls rather than treating them as zero; disclose truncated results.
- Format numbers with `@df/format` or DataTable `format`.

## Delivery

Call `write_app` once with a new `.app.jsx` filename, a short `title`, the
declared `tables`, and the complete `code`. A successful call opens the app on
the canvas and returns its `path`, `content_hash`, and any `warnings`; fix
warnings by revising the app. Briefly tell the user what the app shows and how
to use it.

## Revising an app

When the user asks to change an app, including the selected one or one marked
agent-editable in the inventory, revise that app: the revision rewrites it in
place under the same path, and the result gives its new `content_hash`. Make a
separate app with a new filename only when the user asks for a new or another
app. When the user wants a broken or unwanted app fixed (including errors from
its banner), also pass `replaces` with the app's path.

- Small changes (a chart, a control, a label, a query): `edit_file` with the
  app's path, `expected_content_hash`, and targeted `replacements`. Keep the
  first-line `// @df-app` manifest; edit its `title` or `tables` there when they
  change.
- Larger restructuring: `write_app` with `path` and `expected_content_hash`
  instead of `filename`, plus the new `title`, `tables`, and complete `code`.

Apps are saved as written: the server checks only imports, the manifest, and the
default export, so check the code before writing. Close every brace (a JSX
object attribute such as `encodings={{x: 'month'}}` closes both), make a
`QueryView` child a function `{rows => ...}`, and give `query` to a `Card`,
`ChartCard`, or `KpiGrid` with a function child. An app that fails to render
shows its error, and the user can ask you to fix it.

Use `write_html_app` only when the user explicitly asks for plain HTML: one
self-contained `.html` document with inline CSS/JS, styled with the `df-*` kit
classes (`df-app`, `df-header`, `df-toolbar`, `df-card`, `df-kpis`, `df-chart`)
and reading data through the global `DF` runtime (`await DF.ready`,
`DF.query(table, options)` with the options above, `DF.chart(target, vegaLiteSpec)`,
`DF.format`). Revise HTML apps the same way (`write_html_app` with `path` for
rewrites) and keep their `df-app-manifest` script.
