---
name: html_app
description: >-
  Build an app (a panel of charts on one page, dashboard, explorer, interactive
  story, slides, comparison tool, or custom visual) that runs in a sandbox on
  the canvas and reads workspace tables live; Flint charts are its building
  blocks.
when_to_use: >-
  The user asks to put several charts together on one page (a panel, a
  one-pager, an overview of charts with short descriptions), or for an
  interactive app, dashboard, explorer, interactive or scrolling story, slides
  or walkthrough, or custom UI with controls such as filters, tabs, sliders,
  drill-down, or linked views, or asks to change an existing app. Not for a
  written narrative document whose charts run between paragraphs (use report),
  a single chart (use visualize), a map or a map-centred view with its own
  controls (use map), a plain file, or an ordinary answer.
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
user's question, in the form that fits it (below): a headline, a few views
that work together, and only the controls that change them.

Use what the session already shows, as ideas rather than rules:

- Continue the analysis: earlier questions, findings, and the session's charts
  ([SESSION INDEX], session/charts) show what the user cares about. Reuse the
  tables behind those charts.
- Dimensions, metrics, and periods the user switched between make natural
  controls; default them to what was discussed.
- Field semantics (units, percentages, date granularity) decide formats;
  never sum rates or averages.
- Fit the purpose: monitoring, explaining a finding, exploring, or comparing.
- Compute headline numbers from the data, not from the conversation; a
  caveat that changes how a number reads (Words, below) goes in the closing
  note.
- With little context, build a broad overview of the key measures.

## Choose the form

An app is React, so any form is open; charts are its building blocks. Pick
the form for what the reader does, and combine forms when it helps:

- **Panel** (put a few charts together; the most common ask): a headline,
  then 3–6 charts in a mosaic, each with its finding and a line of
  description; nothing to click (Panels, below). Use it when the user wants
  charts gathered, a summary, a one-pager, or an overview without saying
  they want to filter or explore.
- **Dashboard** (monitor, get an overview): a `FilterBar`, a row of KPIs,
  then a lead chart and the charts that explain it in a `Grid`, linked
  through one focus in state (Linking charts, below).
- **Explorer** (find patterns, drill down): controls and charts drive the
  queries; a chart is a control through `select` and `onSelect`; a `DataTable`
  shows the rows behind the selection.
- **Data story** (explain one finding, as a news graphic does), when the user
  asks to explain, tell, or walk someone through a finding, and the data has
  3 or more distinct things to show: each step's text beside its own chart,
  each chart showing something the others do not (Data stories, below). When the steps would only re-highlight one chart, make a
  panel or a short write-up with annotated charts instead.
- **Slides** (present findings in order): one finding at a time with a stepper;
  the chart's focus follows the slide.
- **Comparison** (A against B): the same chart side by side in a two-column
  `Grid`, same measure, scale, and colours; or one chart with a
  `ToggleButtonGroup` to switch.

Ground every number, highlight, and note in the data: compute the step
targets (the peak month, the largest region) and the figures in the text from
query results, not from memory of the conversation.

## The app file

Write apps with `write_app` as one React file (`<name>.app.jsx`) whose default
export is the app component. It runs in a sandbox: no network, browser storage,
dialogs, or navigation; keep state in React. Import only from these modules:

- `react`: hooks (`useState`, `useMemo`, …).
- `@mui/material`: the page's layout, text, tiles, and controls (Layout and
  UI, below).
- `@df/chart` (`FlintChart`, `DataTable`, `AppTheme`, …), `@df/data`,
  `@df/format`, `@df/icons` (below).
- `d3`, `lodash`, `@df/geo`: for custom visuals and data shaping (below).

State colours and fonts once, in the theme, and read them from it everywhere
else (Look, below). Read data only with `@df/data`; do not embed it,
including map boundaries (use `@df/geo` or Flint's Map charts).

Lay the code out like the starter app below: 2-space indentation, one statement
per line, one JSX element per line (break a long tag's props over several
lines), and lines under about 100 characters. Never pack a component, a query,
or a chart onto one long line: dense lines are where unbalanced braces (such as
`encodings={{ x: {...}, y: {...} }}`) slip in and stop the app from loading.
In JSX text, a line break next to `{value}` drops the space: write
``{`${share} of the total`}`` or `{' '}` where words meet values.

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
  allowed); no table functions in `FROM` (split a list column with `unnest(...)`
  in the `SELECT` list). Rows are capped at `limit` (default 5000,
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

## Layout and UI: MUI

Build the page with MUI (`@mui/material`), which runs inside DF's theme:
`Container`, `Stack`, `Grid`, `Box` for layout; `Paper` or `Card` for tiles;
`Typography` for text; `TextField select`, `Select`, `ToggleButtonGroup`,
`Autocomplete`, `Slider`, `Tabs`, `Chip` for controls; `Skeleton`, `Alert`
for states. Import from `@mui/material` (`import { Stack, Typography } from
'@mui/material'`); `@mui/material/Box` and `@mui/material/styles` paths work
too. Icons: `@mui/icons-material` (`import { TrendingUp } from
'@mui/icons-material'`). Not available: `@mui/x-*` (data grid, date pickers)
and `@mui/lab`; `@df/chart` has the tables and data controls instead (below).

### Spacing: let containers own the gaps

Space comes from the containers, never from the content, so every gap on the
page is one of a few sizes and nothing needs tuning:

- One root: `<Container maxWidth="lg" sx={{ py: 3 }}>` (a dashboard or
  panel), or `maxWidth="md"` for a reading page; inside it one
  `<Stack spacing={3}>` holding the page's blocks in order.
- Gaps by level (MUI spacing units: 6 px in a compact app, 8 px in a normal
  one): `spacing={3}` between the page's blocks
  (`4` between a story's steps), `spacing={2}` between tiles in a `Grid` and
  between a tile's parts, `spacing={1}` (or 0.5) between a label and its value
  or a title and its subtitle. Nothing larger: a wider gap reads as a gap in
  the page, not a pause.
- Group what belongs together in its own `Stack`, so the page's gap falls
  only between groups: the kicker, headline, and deck (`spacing={1}`) with the
  lead paragraph under them (`spacing={2}`); a table or chart with its title
  and its source note (`spacing={1}`). Only a note about the whole page
  closes it as a block of its own.
- Put `spacing` on `Stack` and `Grid container`, and `p: 2` on a tile; set no
  `m`/`mt`/`mb` on `Typography`, charts, or tiles, and no `gutterBottom`. A
  gap that looks wrong is fixed on its container.
- Rows of tiles: `<Grid container spacing={2}>` with `<Grid size={{ xs: 12,
  md: 8 }}>` cells (12 columns; `xs: 12` stacks them on a narrow screen).
- Width by what the chart needs. Only a chart with a long axis spans the full
  width (`md: 12`): a time series of many points, a heatmap of months, many
  categories side by side. A scatter, a ranking, a donut, or a bar chart of a
  few categories is read in a box about 1.2–2 times as wide as it is tall: give
  it `md: 6` or `md: 8` and put what explains it beside it (a `BarList`, a
  `DataTable`, a short note, KPIs). A stretched chart leaves its marks
  scattered across empty space; never fill a row with one by itself.
- Size by the row, not by the chart: a row of *only* charts gets one height
  (`height: 360` on each tile; 300–420 for charts, a lead row up to 460), and
  each chart in it takes `height="fill"`, so it uses whatever its title and
  caption leave and the row ends together with no empty bands. Charts fit
  their tile's width on their own; never set a chart's width. A row of KPIs
  or text tiles keeps its natural height (`height: '100%'` so they end
  together).
- When a row holds something of fixed size (a `BarList`, a short table, a
  stack of two small charts) beside a chart, let that set the row's height:
  no height on the tiles (`height: '100%'`), the chart `height="fill"`. Never
  give such a row a number height: each `BarList` row takes about 34px (12
  rows ≈ 400px plus the tile's title), and a list cut short by its tile hides
  the rest behind "+N more". Give
  the fixed side enough to show (two short lists rather than one) so the row
  is tall enough for its chart: a line or area chart wants a box at least
  about half as tall as it is wide, or it is drawn narrower than its box.
- Side by side text and chart: a `Grid container spacing={4}
  alignItems="flex-start"` with `size={{ xs: 12, md: 5 }}` text and
  `size={{ xs: 12, md: 7 }}` chart.
- Controls: `ValueSelect`, `ValueChips`, `DateRange`, `NumberRange`,
  `Segmented`, and `Search` (from `@df/chart`) in one `FilterBar`, rather than
  raw MUI selects, sliders, or date inputs. One or two controls sit beside
  the title, as `AppHeader`'s children. Three or more get a full-width
  `FilterBar` under the header. Never give a single control a row of its own.

### Header

`<AppHeader kicker title deck period asOf count source where labels
variant>{controls}</AppHeader>` draws the kicker, title, and deck, then a
context line, "Jan 2023 – Jun 2024 · 3,193 films · Source: …", then
"Showing Region: West · Period: …" for what the controls hold.

- `title`, by form. A story, panel, slide deck, or report states its main
  finding as a sentence, computed from the data ("Construction lost the most
  jobs in 2009", not "Unemployment by industry"). A dashboard or explorer
  states its current finding the same way, computed from the rows it shows so
  it follows the controls ("Revenue up 12% on the year before"), or names what
  it monitors when there is no single finding ("Weekly fuel prices, U.S.
  retail"). Avoid "Dashboard", "Explorer", and "Overview" as the title's main
  words.
- `deck`: one sentence on what the page covers: the measure, unit, scope, and
  period ("Monthly unemployment rate by industry, %, 2000–2010"), or the key
  number behind the title. Put how to use the page ("click a bar…") in a tile's
  subtitle, not here.
- `period`: the data's date range, `[from, to]` from a query, or `{table,
  column}` to read it. `asOf`: when the data was updated or what it runs
  through, when that differs from the period's end. `count`: the records shown
  (`{value, noun}`). `source`: where the data comes from (the table's source or
  the user's file); never invent one.
- `where`: what the controls hold (the same object as for `queryFilters`), with
  `labels` naming the fields, so a screenshot still says what it shows.
- `kicker`: a short topic ("Energy"). `variant="editorial"` for a story or
  reading page sets a larger title.
- Children: one or two controls (a `FilterBar`, `FocusChips`) beside the title.

### Pieces

- Header: every app opens with one `AppHeader` (from `@df/chart`), which tells
  the reader what they are looking at before any chart does (Header, below).
- Tile: `<Paper variant="outlined" sx={{ p: 2, height: 360, display:
  'flex', flexDirection: 'column', gap: 1 }}>` holding a heading
  (`variant="subtitle1" fontWeight={600}` saying what the chart shows — the
  finding where there is one — with `variant="body2" color="text.secondary"`
  for the measure, unit, and period, in a `Stack spacing={0.5}`), then the
  chart with `height="fill"`, then at most a one-line caption
  (`variant="caption" color="text.secondary"`). On an editorial page drop the
  `Paper` and let the chart sit on the page.
- Tables: a `DataTable` needs room, a tile at least half the page wide
  (`md: 6`) or the full width, with 2–5 columns. For a top-N list in a
  narrower tile use `BarList` (a name over a bar, the value at the end).
- KPIs: one `KpiStrip` of 2–5 `Kpi`s, not a box each. A number alone says
  little: give each one what it is read against, a `previous` value with `vs`
  (the year before, the prior period, the average) or a `target`, and a
  `trend` sparkline where its history matters; otherwise a `note` saying what
  it counts. Compute both numbers from query rows.
- Fill what you draw: every tile's space goes to its content. A tile holds a
  chart, a table, or a list, never a lone sentence; a row of tiles ends
  together at its content (a set height with `height="fill"` charts); controls
  and KPIs take one line each, not a tile's worth of space.
- Notes and sources: `Typography variant="caption" color="text.secondary"` at
  the end of the page, one or two short lines (`maxWidth: 720`).
- Reading text: paragraphs at most about 70 characters wide (`maxWidth:
  '68ch'` on a `Typography`, or a `md: 5` column).
- States: a `FlintChart` or `DataTable` given `query` shows loading, empty,
  and error itself. Elsewhere use `query.loading` (a `Skeleton
  variant="rounded"` of the content's height) and `query.error` (an `Alert
  severity="error"`).

### Words

How much text an app carries depends on its form. A **dashboard**,
**explorer**, **panel**, or **slides** is read at a glance: the charts carry
it, and text names and points. Write each piece once, short, and only where
the page would mislead without it:

- Title: the finding, up to about 12 words. Deck: one sentence.
- Tile heading: the finding; subtitle: the measure, unit, and period in a
  few words. A hint for a gesture the reader cannot guess, in two or three
  words ("click a bar to filter").
- KPI: a label of a few words; its note, if any, under 6 words.
- A slide: its takeaway headline and at most two short lines.
- Closing note: two short lines at most: the source, and a caveat only when
  it changes how a number reads (a partial last year, a changed definition,
  a sample). Leave out what the reader does not need to act on the page:
  how values were computed, how filters apply, counts of missing values,
  "not live" or "not causal" disclaimers, and definitions the labels already
  give.
- No `Alert` for caveats; an `Alert` is for a failed query or data that
  cannot answer what the page asks.
- Never repeat what the header, a control, an axis, or a legend already says.

Such a page has about 150 words of text outside its charts and tables.

A **data story** (or another reading page) is read, not scanned: each step's
text explains what its chart shows, as long as that takes, in paragraphs of
plain sentences. Its headings, captions, and closing note follow the rules
above.

### Look

Most apps need no styling: the default look is finished, and a preset covers
most of the rest. Go further only when the user or the subject asks for it,
from the cheapest step up:

1. **The default** (no `AppTheme`): the board. Soft outlined cards on a quiet
   page, tight headings, light tables, and charts without frames or axis rules
   in the accent. Use it for dashboards and explorers.
2. **A preset**: `<AppTheme theme="nyt">` wraps the app once. Every chart takes
   the theme, and MUI takes its text colours, accent, fonts and, for a theme
   with its own paper, the page and `Paper` colours. Pick it for the form and
   the audience, not by habit; when the session's charts share a theme, use
   that one. The presets, by what they suit:

   - Monitoring and business: `board` (the default), `powerbi-light` (white
     tiles, legend at the right), `powerbi` (dark tiles), `apple` (a quiet app
     interface, rounded bars), `material` (Material Design, purple-led).
   - Editorial (stories, panels, explainers): `nyt` (serif headline, values
     on marks, series named at their ends), `economist` (compact, red tab),
     `bbc` (big bold headline, no axis lines), `datawrapper` (plain web
     chart, values on bars).
   - Presentation and print: `mckinsey` (slides: takeaway headlines, values
     printed), `nature` (journal figures, axis titles with units), `swiss`
     (warm paper, grid, one red accent).
   - Playful or poster: `cartoon` (cream paper, comic type, outlined marks),
     `pop` (electric colours, heavy black), `de-stijl` (red, yellow, blue
     planes and black lines).

   One of the user's saved themes (the theme skill's `list_themes`) works by
   id, like a preset.
3. **An adjusted theme**: a Flint theme object that `extends` a preset and
   overrides parts of it, for a brand, a mood, or a dark page:

   ```js
   const THEME = {
     extends: 'board',
     ink: {
       accent: '#2f6b4f',
       series: { categorical: ['#2f6b4f', '#c0803a', '#6b7f99', '#a34e3b'] },
       // A dark page: the page (panel), the tiles (canvas, plot), and text.
       // surface: { canvas: '#161b22', plot: '#161b22', panel: '#0d1117' },
       // text: { primary: '#e6edf3', secondary: '#9198a1' },
       // structure: { grid: '#262c36', rule: '#30363d' },
     },
     // type: { headline: { family: 'Georgia, serif' } },
   };
   ```

   `<AppTheme theme={THEME}>` restyles the page, MUI, the `--df-*` tokens,
   and every chart together. This object (and a category's `colors`) is the
   one place for colour values and font names. Fonts are the system's (no
   web fonts load): a stack such as `Georgia, serif` or `ui-monospace,
   monospace`. Beyond `ink` and `type`, a theme sets `structure` (axes,
   grid, frame), `marks`, `legend`, `dataLabels`, `furniture` (house rules
   and tabs), and `layout.density`; the theme skill describes every part and
   saves a look for reuse. Extend the preset nearest to the goal and
   override only what differs.
4. **The app's own CSS**, for its own elements: `sx` on an element, or
   `<GlobalStyles styles={{ '.app-legend': {...} }} />` (from
   `@mui/material`) for classes the app names with an `app-` prefix. It reads
   the theme through tokens, which follow every step above:

   - Colour: `--df-text`, `--df-muted`, `--df-faint`, `--df-primary`,
     `--df-primary-soft`, `--df-on-primary`, `--df-positive`,
     `--df-negative`, `--df-warning`; the page `--df-canvas`, a tile
     `--df-surface`, `--df-grid`, `--df-rule` (borders), `--df-hover`;
     `--df-palette-1` … `--df-palette-10` (the series colours, in the
     charts' order).
   - Type: `--df-font`, `--df-font-display`, `--df-font-mono`;
     `--df-text-xs`, `-sm`, `-md`, `-lg`, `-xl`.
   - Shape: `--df-space` (the spacing unit), `--df-radius`,
     `--df-radius-tile`.

   In `sx` and MUI props, theme keys say the same: `color: 'text.secondary'`,
   `bgcolor: 'background.paper'`, `borderColor: 'divider'`,
   `'primary.main'`, `'success.main'`, `'error.main'`.

So that the app's styles never fight the theme:

- `--df-*` tokens are read-only: MUI and the charts do not read them back, so
  setting one recolours only the app's own CSS. Change the look in the theme
  object; name the app's own variables `--app-…`.
- Style MUI components through their props and `sx` on the component itself,
  never through MUI's class names (`.MuiPaper-root`); restyle charts through
  `theme`, never by selecting their SVG.
- Scope global CSS to `app-` classes; never restyle bare elements (`svg`,
  `text`, `table`, `button`) or `body`.
- Space with the layout rules above (container `spacing`, tile padding).

By form: a **dashboard** or **explorer** uses `Container maxWidth="lg"`,
outlined tiles, and the default look; a **data story** uses `maxWidth="lg"`
with an editorial `AppTheme` (`nyt`, `economist`), text and charts on the page
without tiles; **slides** use `maxWidth="md"` and one tile per slide.

- Density: apps are compact by default, sized for the canvas panel: a 6 px
  spacing unit, a smaller type scale (body 14 px, `h5` 19 px), and 30 px
  controls. Write spacing in units and type by variant, never in pixels, and
  the density sizes them. `<AppTheme density="normal">` gives MUI's own scale
  (8 px, body 16 px, 36 px controls) for a presentation or a reading page
  shown large; it combines with `theme`.

## `@df/chart`, `@df/format`, `@df/icons`

- `FlintChart {chart | spec | chartType + encodings, data | query, table,
  semanticTypes, labels, title, subtitle, kicker, source, theme, height = 260 | "fill", chartProperties,
  annotations, select, onFocus, onSelect, focus, note, view, onView, filter}` is the same chart engine
  as the DF canvas, live in the app: it shows a tooltip on hover and fits the
  width of its container (it never pushes it wider). `height="fill"` takes the
  height its container gives it (a tile with a set height, a box with a set
  height), at least 160 px; it never makes the container taller. `chart="<id>"` draws one of the session's charts (Reusing the session's
  charts, below). `encodings` maps channels (`x`, `y`, `color`, `size`,
  `column`, `detail`, …) to a column name or `{field, type, aggregate, sortBy,
  sortOrder}`; leave out `type` unless needed. Without `data` or `query`, a
  chart with a `table` reads that table's rows. `labels` names axis and legend
  titles by field; `''` hides one. `hide={{source: ['Nuclear']}}` leaves marks
  out of view while keeping the axes and colors (a story's reveal). `theme`
  (a Flint theme id) overrides the `AppTheme` for one chart. Chart types
  include Bar Chart, Grouped Bar Chart, Stacked Bar Chart, Line Chart, Area
  Chart, Scatter Plot, Heatmap, Histogram, Boxplot, Pie Chart, Donut Chart,
  Lollipop Chart, Slope Chart, Bump Chart, Range Area Chart, Map
  (`latitude`/`longitude`, with `size`/`color`), Choropleth (country or US state
  names or codes as `id`). Maps draw world or US boundaries offline; a
  Choropleth is drawn static, without selection or focus.
- `DataTable {data | query, columns: [{field, label, format, align, bar, heat,
  total}], maxHeight, sortable, groupBy, collapsed}`: a sortable table.
  `format` is `"number"`, `"number:2"`, `"compact"`, `"percent"`, `"delta"`,
  `"date"`, or a function; `bar` draws an in-cell bar, `heat` tints the cell
  by its value (red/green around zero when the column has negatives).
  `groupBy="region"` puts rows under a header row per region (click to fold;
  `collapsed` starts folded) showing each column's `total` (`"sum"`, `"avg"`,
  `"min"`, `"max"`, `"count"`, or a function of the rows, e.g. a ratio of
  sums); a column with a `total` also adds a Total row. Together they make a
  matrix. Use it for every table rather than MUI's `Table`.
  It fits its box on its own: headings wrap, a table a little taller than
  `maxHeight` (default 420) tightens its rows to show them all, a table of
  up to 4 rows too wide for its tile turns on its side (its columns become
  rows), then its type gets smaller, and only then it scrolls, its first
  column held. Set `maxHeight`
  only to cap a long table; never size one to a neighbour.
- `AppTheme {theme, density}`: the app's look from a Flint theme, and its
  density (`"compact"` by default, or `"normal"`) (Layout and UI, above).
- Filters: a `FilterBar {sticky}` at the top holds labeled controls side by
  side (label above, wrapping on a narrow screen):
  `ValueSelect {table, column, label, value, onChange, allLabel = "All",
  options, where}` (a dropdown of the column's values; `''` is all);
  `ValueChips {table, column, label, value: [], onChange, options, where}`
  (chips to toggle a few values, type-ahead for many; `[]` is all);
  `DateRange {table, column, label = "Period", value: [from, to] | null,
  onChange, granularity: "year" | "month"}` (a slider over the data's months
  or years; values in the column's own format, a month or year taking its
  whole span); `NumberRange {table, column, label, value: [lo, hi] | null,
  onChange, format}` (a slider over the column's extent);
  `Segmented {label, value, onChange, options}` (one of 2–5 choices: a
  measure, a view); `Search {label, value, onChange}` (fires when typing
  pauses). Choices and extents come from the column; `options` or
  `min`/`max` give them instead, and `where` narrows them by the other
  filters. Each takes `width` and `grow`. `null`, `''`, and `[]` mean "all".
- `queryFilters(where)` turns what the controls hold into `useQuery` filters:
  `queryFilters({ region, product: chosen, date: { range: dates }, price: {
  range: prices } })`; empty controls are left out. `inFocus(row, where)` tests
  a row against the same shapes (or a chart's focus), for rows already loaded.
- `BarList {data | query, label, value, format, limit = 10, focus, onFocus}`:
  a ranked list (name over a bar, value at the end), compact for a tile or a
  sidebar; clicking a row sets the focus to it. In a tile of natural height it
  shows all `limit` rows; in a tile too short for them, it shows what fits and
  "+N more" (so size the tile by the list, not the list by the tile).
- `Kpi {label, value, format, unit, previous, vs, target, change, good, trend,
  x, y, note}` in a `KpiStrip` (a row of them with dividers): the label, the
  value (`format` as in `DataTable`), then its change against `previous`
  ("▲ +12% vs 2023"; `change`: `"percent"`, `"points"` (the default for a
  percent value), or `"number"`) or the share of `target` reached, coloured by
  `good` (`"up"`, `"down"`, or `"none"`), a sparkline of `trend` (rows or a
  query, with its `x` and `y` fields), and a `note`.
- `TargetBar {value, target, label, goodDirection}`: progress toward a
  target, under a KPI's value.
- `FocusChips {focus, onChange, labels}`: the shared focus as removable chips
  with "Clear all"; put it in the control row of a linked dashboard.
- `VegaChart {spec, data | query, height}`: a raw Vega-Lite spec, only for a
  visual Flint has no chart type for. It fits the whole drawing, axes and
  labels included, into its box (`height` in pixels or `"fill"`). Never use it
  in place of a `FlintChart` that failed: it has no theme, focus, selection,
  view, or filter.
- `Sparkline {data, x, y}`.
- `useInks()`, `useMeasure()`, `useSize(ref)`: the theme's resolved colours
  and a container's size, for the app's own components (Custom components,
  below).
- `format.number(v, digits)`, `.compact(v)` (12.3K), `.percent(v)` (ratios
  0–1), `.delta(v)` (+1.2 / −0.4), `.date(v)`; each returns "—" for missing values.
- `Icon {name}`: `trend-up`, `trend-down`, `info`, `warning`, `money`, `people`,
  `globe`, `calendar`, `time`, `chart`, `table`, `search`, `filter`, `star`, …

### Making a chart

- Pick the chart for the question: change over time → Line Chart; comparing
  categories → Bar Chart sorted by value (on the category channel, `sortBy:
  "y", sortOrder: "descending"`), with the categories on `y` when names are long; parts of a whole → Stacked Bar Chart (Pie or Donut
  only for 2–5 parts); a distribution → Histogram or Boxplot; a relationship →
  Scatter Plot; two categories → Heatmap; places → Map or Choropleth.
- Name what the chart shows, once, in one of two ways (never both on one
  chart): a headline that states the finding where there is one ("West sold
  the most"), and a deck with the measure, unit, and period ("Revenue by
  region, 2024, USD").
  - **The app's heading** over an untitled chart, in a tile: for dashboards and
    explorers, where chart tiles sit beside tables, KPIs, and lists, and a
    heading may hold a control or a hint ("Click a bar to select"). Every tile
    then reads the same.
  - **Flint's title**: `title`, `subtitle` (the deck), `kicker` (a short line
    above), and `source` (the text after "Source:"), drawn in the theme's type
    with the legend and labels laid out around them. For a chart that stands as
    a figure of its own: a story step, a slide, a panel or one-pager, a report,
    especially under an editorial `AppTheme` (`nyt`, `economist`,
    `datawrapper`, `bbc`), whose house style (a serif headline, a deck, a
    source line, series named at their ends) is part of the chart. Put such a
    figure on the page without a `Paper` around it.
- Tell Flint what the fields mean. Pass `table` when the rows keep that table's
  columns, so its semantic types and names apply. For computed columns
  (`price_avg`, `amount_sum`, `_count`) pass `labels` (`{price_avg: "Avg
  price"}`) and `semanticTypes` (`{price_avg: "Price"}`): the type sets number
  formats, the zero baseline, and the colour scheme. Use `Amount`, `Price`,
  `Quantity`, `Count`, `Number`, `Percentage`, `PercentageChange`, `Profit`,
  `Rank`, `Score`, `Temperature`, `Date`, `Year`, `YearMonth`, `Category`,
  `Country`, `State`, or `City`; `{semanticType, unit: "USD"}` adds a unit when
  the data establishes it. A share or rate held as 0–1 takes `{semanticType:
  "Percentage", intrinsicDomain: [0, 1]}` so it reads as 16% rather than 0.16. A year column takes `Year` and no `type`: a
  `type: "quantitative"` year is drawn as a number ("2,020"). Categories with a
  conventional colour (parties, win/loss) take `{semanticType: "Category",
  colors: {Republican: "#d62728", Democratic: "#1f5fbf"}}`; a `table` column's
  stored colours apply on their own (Color in the visualization guidance).
- Keep it legible: about 12 categories on an axis and 8 colours at most; cut
  the rest in the query (`orderBy` with `limit`). One measure per chart.
- Give a chart room of its shape. A chart's file (`session/charts/<id>.json`)
  says the size it draws at on the canvas, e.g. "412×618 px (tall)": keep that
  width-to-height ratio in the app. Set `height` from the width its card will
  have (a tall chart gets a full row or a taller card; a wide one a full-width
  card), and put charts of different shapes in a `Grid` with
  `alignItems="flex-start"` so a tall one does not stretch its neighbours.

- Mark what the reader should see with `annotations`: `{y: 2, text: "2%
  target", dashed: true}` draws a line across the plot at a value, `{x:
  ["2008-01", "2009-06"], text: "Recession"}` shades a band between two
  values, and `{at: {year: 2021, region: "West"}, text: "Record"}` writes a
  note on the one mark those fields pick out (name every field that tells the
  marks apart: x, and color for a line). Values are in the data's own terms
  (the same date strings, categories, or numbers); a few per chart at most.
  A chart marks what its title says, computed from its rows: the peak or
  latest point it names, and the reference it is read against (an average,
  a target, a period).

### Reusing the session's charts

The user's canvas charts are in `session/charts/<id>.json`. An app can draw
them rather than rebuild them:

- `<FlintChart chart="<id>" />` draws the chart as it is on the canvas (type,
  fields, title, settings, theme) from its own table, so it matches what the
  user made. Declare that table in the app's `tables`. Under a tile heading
  pass `title=""` (the heading names it). Other props change it: `height`,
  `title`, `select`,
  `focus`, `annotations`, `encodings` by channel (`{color: "segment"}`; `null`
  drops one), `chartProperties`, and `data` or `query` for other rows (a
  filtered or aggregated query with the same columns).
- `spec={...}` takes a chart in the same shape (`{chart_type, table, title,
  encodings, config, theme}`): copy a chart file and change what the app
  needs, or write one. `config` is the chart's settings
  (`chartProperties`).

Reuse a chart when the app shows what the user already made; write a new one
when the app needs a view the canvas does not have.

### Focus: what the reader and the app do with a chart

Every chart in an app shows a tooltip on hover. Beyond that, apps do one thing
with charts: put the **focus** on part of one, keeping those marks at full
ink and muting the rest. A focus names marks by their values:
`{region: 'West'}`, `{model: ['A', 'B']}`, `{year: {range: [2010, 2020]}}`.
Fields a chart's rows do not carry are left out for that chart, so one focus
can apply to several different charts.

- `select`: the reader picks marks on the chart. `select` lets them click a
  mark (a bar, a slice, a point, a line's series; shift-click adds);
  `select="range"` lets them drag over a period on a time axis, or a box on a
  scatter. A click on empty space or Escape clears it. `onFocus(focus)` gives
  what they picked as a focus (`{region: {in: ['West']}}`, `{year: {range:
  [2010, 2015]}}`, or `null` when cleared); `onSelect(rows)` gives the picked
  rows, e.g. for a drill-down: `onSelect={values => setRegion(values[0]?.region
  ?? '')}`, filtering other queries by `region`.
- `focus`: the app sets it: `<FlintChart focus={{region: 'West'}} … />`. It
  also picks out what a tile's title names (`focus={{season: top.season}}`
  under "Summer brings 38% of reports"), the rest muted.
- `note`: a few words on the one mark (or the end of the one line) the focus
  picks out, in place of its value: `note="Record high"`. When the focus picks
  out one mark or one line and there is no note, its value is labelled.

- `view`: the range the chart frames, on the field its x (or y) axis draws:
  `view={{ date: [from, to] }}` (or `null` for everything). The chart moves in
  place. With `onView`, the reader can drag over a period on the chart to zoom
  in (double-click goes back), reported in the same shape.
- `filter`: rows to keep, in the shapes controls hold (`{ grade: chosen, date:
  { range: period } }`; empty values keep all). The chart narrows its own
  rows, and its scales and totals follow.

No other chart controls or drawn lines: a chart changes by its focus, view,
or filter, or the app shows another chart.

### Controls steer charts in place

When a control is about a chart's own rows, give its value to the chart
rather than querying again: the chart changes in place, without loading or
redrawing, and its own gestures can drive the control back.

- A period or range control over the chart's axis frames it with `view`, two
  ways: the slider frames the chart, and a period dragged on the chart moves
  the slider.

  ```jsx
  const [period, setPeriod] = useState(null);
  <DateRange table="prices" column="date" value={period} onChange={setPeriod} />
  <FlintChart … encodings={{ x: 'date', y: 'price', color: 'grade' }}
    view={{ date: period }} onView={view => setPeriod(view ? view.date : null)} />
  ```

- Category chips or a range over loaded rows narrow a chart with `filter`
  (`filter={{ grade: grades, date: { range: period } }}`), so a chart of
  averages beside the framed line follows the same period.
- Picking items to compare against the rest is a `focus` (highlight), not a
  filter.
- Numbers computed elsewhere (KPIs, a `DataTable`, aggregates in SQL) and
  tables larger than the app loads follow through the query
  (`queryFilters`): load a chart's rows once, unfiltered (up to a few
  thousand), and steer it; filter in the query only what must be recomputed.

### Linking charts

Keep one focus in state; let the charts the reader picks on set it with
`onFocus`, and pass it to every chart as `focus`. Each chart emphasizes the
marks that match on the fields its rows carry and ignores the rest, so a bar
chart by region and a scatter of countries with `region` on `color` follow
the same focus:

```jsx
const [focus, setFocus] = useState(null);
// ...
<FlintChart … select onFocus={setFocus} focus={focus} />
<FlintChart … select="range" onFocus={setFocus} focus={focus} />
<DataTable data={rows.filter(row => inFocus(row, focus))} … />
```

- A chart takes part when its rows carry the field: group its query by the
  field too (a monthly line per `region`), or encode the field on `detail`.
- Filter a table or a KPI by the focus with a small `inFocus(row, focus)`:
  each field `in` its list, or within its `range`.
- A control sets the focus too: `setFocus(value ? {region: {in: [value]}} : null)`.

Highlight (a shared focus) to compare a selection with the whole; filter (the
focus or `onSelect` into the queries) to drill into a subset at another level
of detail.

### Data stories

A data story walks the reader through a finding in steps, each step's text
beside its own chart, stacked down the page. Compose each step as a two-column
`Grid` (text, then chart; stacked on a narrow screen); the page scrolls as
usual and nothing is pinned.

```jsx
// One step: its text beside its chart.
function Step({ title, text, children }) {
  return (
    <Grid container spacing={4} alignItems="center">
      <Grid size={{ xs: 12, md: 5 }}>
        <Stack spacing={1.5}>
          <Typography variant="h5" component="h2">{title}</Typography>
          <Typography sx={{ fontSize: '1.0625rem', lineHeight: 1.65 }}>{text}</Typography>
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: 7 }}>{children}</Grid>
    </Grid>
  );
}
// ...
<Stack spacing={4}>
  {steps.map(item => (
    <Step key={item.title} title={item.title} text={item.text}>
      <FlintChart chartType="Line Chart" title="Monthly revenue by region, USD" query={monthly} height={300}
        encodings={{ x: 'month', y: 'revenue_sum', color: 'region' }}
        hide={item.hide} focus={item.focus} note={item.note} annotations={item.annotations || []} />
    </Step>
  ))}
</Stack>
```

A story earns its steps only when each step's chart shows something the
others do not. Plan the steps as a sequence of views before writing them;
each step's chart differs from the one before through one of these moves:

- **Reveal**: start with one series (`hide` the others) and bring them in as
  the text introduces them.
- **Focus**: put one series, period, or group in `focus`, the rest muted.
- **Mark**: a `note` on the number the passage cites, an `annotations` line at
  a threshold or target, a band over a period the passage names.
- **Switch**: a different chart for a different question (the change from
  start to end as bars, a breakdown of the total).
- **Hand over**: the last step turns on `select` so the reader explores.

Keep the data, encodings, and scales the same across the steps that reveal,
focus, or mark, so the reader compares like with like as they scroll. A step
that changes nothing on the chart belongs in the text of a neighbouring step.

- Keep a step's two sides in balance: the text at reading size (17 px, as in
  `Step` above) and centred beside its chart (`alignItems="center"`), and the
  chart about as tall as the text, 280–340 px for 60–90 words, never more
  than about twice the text's height. A tall chart beside a short paragraph
  leaves a column of white space; shorten the chart or say more. Use the same
  layout for every step, so the steps read as one sequence.
- Mark sparingly: at most two or three notes on a chart, on points far apart,
  so their labels do not collide.
- Put an `AppHeader variant="editorial"` (the finding as its title) and a
  lead-in paragraph above the steps, and the full data after them (a table, a
  chart to explore).
- Balance text and chart: 3–7 steps, each a title and 2–4 sentences (about
  50–90 words) that say what the step shows, with the numbers it marks, and
  why it matters. A one-line step leaves its side empty beside the chart;
  much longer text outgrows it (split it into two steps). Open on the
  starting point, build to the finding, and end by handing the chart to the
  reader. Compute every focus, note, and number from the queries.
- Set the page for reading: `<AppTheme theme="nyt" density="normal">` (or
  `economist`), so body text is 16–17 px and headings are full size, and no
  tiles around the charts.

Slides are the same steps shown one at a time, with `useState` and a stepper
(a `Segmented` with one choice per slide, or Previous/Next buttons). A slide
is one screen: the headline and stepper on top, then the slide as a box of
fixed height (`height: 'min(620px, calc(100vh - 160px))'`, `display: 'flex',
flexDirection: 'column'`, `gap: 2`) holding its action title (the finding as
a sentence), one to three sentences, and the chart with `height="fill"`.
Nothing else goes above the deck; supporting KPIs belong on a slide.

### Panels

A panel puts a few charts together to be read at a glance, like a magazine
spread or a one-page summary: no controls and no linking. It differs from a
report, where charts run down the page one after another between paragraphs:
a panel arranges them side by side, sized by importance.

- An `AppHeader` whose title states the overall finding, and a deck that
  says, in a sentence, what the charts show together.
- A `Grid container spacing={2}` as a mosaic: the lead chart takes `size={{
  xs: 12, md: 8 }}`, smaller ones `md: 4`, a wide one (a long time axis, a
  stacked breakdown) `md: 8` or `12`. Fill each row to 12. For two small
  charts beside a tall lead, put them in one `md: 4` cell as a `Stack
  spacing={2}`.
- Each chart in a tile whose heading is its finding ("West sold the most"),
  the line under it the measure, unit, and period, and a caption under the
  chart with one sentence of description or the number that matters.
  Compute findings and numbers from the data.
- Or, as an editorial spread under an editorial `AppTheme` (`nyt`,
  `economist`, `datawrapper`): no tiles; each chart a figure carrying its own
  `title` (the finding), `subtitle`, and `source`, in the theme's house style.
- Heights by role: the lead chart about 360–420 px, the others 150–220, so
  two small tiles stand beside the lead. Leave `select` off.
- One `AppTheme` for the whole panel; the source in a caption at the end.

```jsx
<Container maxWidth="lg" sx={{ py: 3 }}>
  <Stack spacing={3}>
    <Stack spacing={0.5}>
      <Typography variant="h5" component="h1" fontWeight={600}>Sales in 2024: growth came from technology</Typography>
      <Typography color="text.secondary">Revenue rose {format.percent(growth)} on 2023. Four views of where it came from.</Typography>
    </Stack>
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 8 }}>
        <Tile title="Revenue grew, led by technology" subtitle="Monthly revenue by category, USD"
          caption="Technology added the most each month; furniture was flat.">
          <FlintChart chartType="Line Chart" query={monthly} height={400}
            encodings={{ x: 'month', y: 'revenue_sum', color: 'category' }} labels={{ month: '', revenue_sum: '', category: '' }} />
        </Tile>
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <Stack spacing={2} sx={{ height: '100%' }}>
          <Tile title={top.region + ' sold the most'} subtitle="Revenue by region, 2024">
            <FlintChart chartType="Bar Chart" query={byRegion} height={150}
              encodings={{ y: { field: 'region', sortBy: 'x', sortOrder: 'descending' }, x: 'revenue_sum' }} />
          </Tile>
          {/* … a second small tile */}
        </Stack>
      </Grid>
      {/* … a row of one plus one wide, or three */}
    </Grid>
    <Typography variant="caption" color="text.secondary">Source: …</Typography>
  </Stack>
</Container>
```

`Tile` is the app's own small component, as in the starter app: a `Paper
variant="outlined"` (a flex column with `gap: 1`) holding the heading, the
chart, and the caption.

## Custom components: `d3`, `lodash`, `@df/geo`

Use `FlintChart` for the standard charts: it themes, formats, links, and
explains itself for free. For anything else, write the component: a dumbbell
or bullet chart, a waffle, a calendar, a network or tree, a custom map, an
annotated diagram, a KPI tile or table cell of your own design. A component
of 40–80 lines goes far, and it joins the app as the charts do when it
follows this recipe:

- Size from its container: `const [ref, { width }] = useMeasure();` on a
  wrapping `div`, then draw once `width > 0` (`useSize(ref)` for a ref you
  already have).
- Compute scales, shapes, and layouts with d3 in `useMemo`, and render the
  SVG with React (JSX elements, not `d3.select` edits).
- Take colours from `useInks()` (both from `@df/chart`): `palette` (the series
  colours, in the charts' order, so a category matches its colour in the
  charts), `accent`, `text`, `muted`, `faint`, `grid`, `rule`, `surface`,
  `positive`, `negative`, and `dark`. They are resolved colour values, so d3
  can interpolate them, and they follow the AppTheme, dark ones included.
  In CSS, the `--df-*` tokens say the same (Look, above).
- Join the focus: dim marks outside it (`inFocus(row, focus)`), and set it on
  click (`onFocus({state: {in: [row.state]}})`; the same mark again clears
  it). Put MUI's `Tooltip` around a mark for its values, and format them with
  `format`. Text at 11–12 px in `text` or `muted`; gridlines in `grid`.

```jsx
// A dumbbell chart: each state's value in two periods, joined by a line.
function Dumbbell({ rows, focus, onFocus }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const row = 26;
  const left = 110;
  const height = rows.length * row + 24;
  const x = useMemo(() => d3.scaleLinear()
    .domain([0, d3.max(rows, d => Math.max(d.before, d.after)) || 1])
    .nice()
    .range([left, Math.max(left + 1, width - 40)]), [rows, width]);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} fontSize={12} role="img" aria-label="By state">
          {x.ticks(5).map(tick => (
            <g key={tick} transform={`translate(${x(tick)},0)`}>
              <line y2={height - 24} stroke={inks.grid} />
              <text y={height - 6} textAnchor="middle" fill={inks.muted} fontSize={11}>{tick}</text>
            </g>
          ))}
          {rows.map((d, i) => {
            const y = i * row + row / 2;
            const picked = focus?.state?.in?.[0] === d.state;
            return (
              <Tooltip key={d.state} title={`${d.state}: ${d.before} → ${d.after}`}>
                <g
                  opacity={!focus || inFocus(d, focus) ? 1 : 0.25}
                  onClick={() => onFocus(picked ? null : { state: { in: [d.state] } })}
                  style={{ cursor: 'pointer' }}
                >
                  <rect y={y - row / 2} width={width} height={row} fill="transparent" />
                  <text x={left - 10} y={y} dy="0.35em" textAnchor="end" fill={inks.text}>
                    {d.state}
                  </text>
                  <line x1={x(d.before)} x2={x(d.after)} y1={y} y2={y} stroke={inks.rule} />
                  <circle cx={x(d.before)} cy={y} r={5} fill={inks.palette[2]} />
                  <circle cx={x(d.after)} cy={y} r={5} fill={inks.accent} />
                </g>
              </Tooltip>
            );
          })}
        </svg>
      )}
    </div>
  );
}
```

Give it a key like any chart (a `div className="app-legend"` with swatches in
`var(--df-palette-3)` and `var(--df-primary)`), a tile heading that states its
finding, and the query's loading state (`Skeleton`) while its rows load.

- `d3`: the full d3 v7 API (scales, shapes, layouts, projections, `rollups`).
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
import {
  Container,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@df/data';
import {
  AppHeader,
  BarList,
  DateRange,
  FilterBar,
  FlintChart,
  FocusChips,
  Kpi,
  KpiStrip,
  Segmented,
  ValueSelect,
  inFocus,
  queryFilters,
} from '@df/chart';
import { format } from '@df/format';

const METRICS = [
  { value: 'revenue', label: 'Revenue', type: 'Amount' },
  { value: 'orders', label: 'Orders', type: 'Count' },
];

// A titled tile. Its parts are spaced by the gap, not by margins; with a
// height (one per row), a chart inside takes height="fill".
function Tile({ title, subtitle, caption, height = '100%', children }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, height, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Stack spacing={0.25}>
        <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        )}
      </Stack>
      {children}
      {caption && (
        <Typography variant="caption" color="text.secondary">{caption}</Typography>
      )}
    </Paper>
  );
}

const total = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0);
const largest = (rows, field) => rows.reduce((best, row) => (
  !best || row[field] > best[field] ? row : best
), null);
// The same month a year earlier, for 'YYYY-MM' months.
const yearBefore = month => month && `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;

export default function App() {
  const [region, setRegion] = useState('');
  const [metric, setMetric] = useState('revenue');
  // The period frames the trend in place (view) and narrows the other views.
  const [period, setPeriod] = useState(null);
  // A product picked in the list: one focus, shared by the views.
  const [focus, setFocus] = useState(null);
  const measure = METRICS.find(option => option.value === metric);
  const value = `${metric}_sum`;
  const aggregates = [{ op: 'sum', field: metric }];
  // A focus names values as `{product: {in: ['Desk']}}`: the one product picked, or ''.
  const product = focus?.product?.in?.[0] ?? '';
  const monthly = useQuery('sales', {
    columns: ['month'],
    filters: queryFilters({ region, product }),
    aggregates,
    orderBy: 'month',
  });
  // A view that picks something leaves out its own filter, so it keeps every choice.
  const byProduct = useQuery('sales', {
    columns: ['product'],
    filters: queryFilters({ region, month: { range: period } }),
    aggregates,
  });
  const byRegionMonth = useQuery('sales', {
    columns: ['region', 'month'],
    filters: queryFilters({ product, month: { range: period } }),
    aggregates,
    orderBy: 'month',
  });

  // Every figure comes from the rows: the framed months, and the year before them.
  const months = monthly.rows.filter(row => inFocus(row, { month: { range: period } }));
  const latest = months[months.length - 1];
  const recent = months.slice(-12);
  const before = monthly.rows.filter(row => (
    recent.length === 12 && row.month >= yearBefore(recent[0].month) && row.month < recent[0].month
  ));
  const lastYear = monthly.rows.find(row => row.month === yearBefore(latest?.month));
  const peak = largest(months, value);
  const average = months.length ? total(months, value) / months.length : null;
  const topProduct = largest(byProduct.rows, value);
  const productShare = topProduct && topProduct[value] / total(byProduct.rows, value);
  const regionTotals = Object.values(byRegionMonth.rows.reduce((sums, row) => {
    const sum = (sums[row.region]?.[value] ?? 0) + row[value];
    sums[row.region] = { region: row.region, [value]: sum };
    return sums;
  }, {}));
  const topRegion = largest(regionTotals, value);
  const regionShare = topRegion && topRegion[value] / total(regionTotals, value);
  const yearChange = before.length === 12 ? total(recent, value) / total(before, value) - 1 : null;
  // The headline states the finding, computed from the rows it shows.
  const headline = yearChange === null
    ? `${measure.label} by month, region, and product`
    : `${measure.label} ${yearChange >= 0 ? 'up' : 'down'} ${format.percent(Math.abs(yearChange))}`
      + ' on the year before';
  const unit = metric === 'revenue' ? 'compact' : 'number';

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <AppHeader
          kicker="Sales"
          title={headline}
          deck="Monthly sales by region and product, the last 12 months against the 12 before."
          period={[months[0]?.month, latest?.month]}
          source="sales table"
          where={{ region, product, month: { range: period } }}
          labels={{ region: 'Region', product: 'Product', month: 'Period' }}
        />
        <FilterBar>
          <ValueSelect
            table="sales"
            column="region"
            label="Region"
            value={region}
            onChange={setRegion}
            allLabel="All regions"
          />
          <Segmented
            label="Measure"
            value={metric}
            onChange={setMetric}
            options={METRICS}
          />
          <DateRange
            table="sales"
            column="month"
            value={period}
            onChange={setPeriod}
          />
          <FocusChips focus={focus} onChange={setFocus} labels={{ product: 'Product' }} />
        </FilterBar>
        <KpiStrip>
          <Kpi
            label={`${measure.label}, last 12 months`}
            value={recent.length ? total(recent, value) : null}
            format={unit}
            previous={before.length === 12 ? total(before, value) : null}
            vs="the 12 before"
            trend={months}
            x="month"
            y={value}
          />
          <Kpi
            label={`Latest month, ${latest?.month ?? ''}`}
            value={latest?.[value]}
            format={unit}
            previous={lastYear?.[value]}
            vs={lastYear?.month}
          />
          <Kpi
            label={`Top product: ${topProduct?.product ?? '—'}`}
            value={productShare}
            format="percent"
            note={`${format.compact(topProduct?.[value])} in the period`}
          />
          <Kpi
            label={`Top region: ${topRegion?.region ?? '—'}`}
            value={topRegion?.[value]}
            format={unit}
            note={`${format.percent(regionShare)} of the total`}
          />
        </KpiStrip>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Tile
              title={peak ? `${measure.label} peaked in ${peak.month}` : 'Monthly trend'}
              subtitle={`${measure.label} per month${product ? `, ${product}` : ''}; drag to zoom`}
            >
              <FlintChart
                chartType="Line Chart"
                height="fill"
                query={monthly}
                encodings={{ x: 'month', y: value }}
                semanticTypes={{ month: 'YearMonth', [value]: measure.type }}
                labels={{ month: '', [value]: '' }}
                view={{ month: period }}
                onView={view => setPeriod(view ? view.month : null)}
                annotations={peak ? [
                  { at: { month: peak.month }, text: `Peak: ${format.compact(peak[value])}` },
                  { y: Math.round(average), text: 'Monthly average', dashed: true },
                ] : []}
              />
            </Tile>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Tile
              title={topProduct
                ? `${topProduct.product} brings ${format.percent(productShare)}`
                : 'Products'}
              subtitle={`${measure.label} by product; click one to focus`}
            >
              <BarList
                query={byProduct}
                label="product"
                value={value}
                format={unit}
                focus={focus}
                onFocus={setFocus}
              />
            </Tile>
          </Grid>
        </Grid>
        <Tile
          title={topRegion
            ? `${topRegion.region} leads with ${format.percent(regionShare)} of the total`
            : 'By region'}
          subtitle={`${measure.label} by region and month; click a cell to filter by its region`}
        >
          <FlintChart
            chartType="Heatmap"
            height={200}
            query={byRegionMonth}
            encodings={{ x: 'month', y: 'region', color: value }}
            semanticTypes={{ month: 'YearMonth', [value]: measure.type }}
            labels={{ month: '', region: '', [value]: measure.label }}
            // The region picked, or else the one the title names.
            focus={{ region: region || topRegion?.region }}
            select
            onSelect={values => setRegion(values[0]?.region ?? '')}
          />
        </Tile>
        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
          Changes compare the last 12 months shown with the 12 months before them.
          Regions and products narrow every view except their own.
        </Typography>
      </Stack>
    </Container>
  );
}
```

## Story example

```jsx
import { Container, Grid, Stack, Typography } from '@mui/material';
import { useQuery } from '@df/data';
import { AppHeader, AppTheme, DataTable, FlintChart } from '@df/chart';
import { format } from '@df/format';

// One step: its text beside its chart; stacked on a narrow screen.
function Step({ title, text, children }) {
  return (
    <Grid container spacing={4} alignItems="center">
      <Grid size={{ xs: 12, md: 5 }}>
        <Stack spacing={1.5}>
          <Typography variant="h5" component="h2">{title}</Typography>
          <Typography sx={{ fontSize: '1.0625rem', lineHeight: 1.65 }}>{text}</Typography>
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: 7 }}>{children}</Grid>
    </Grid>
  );
}

export default function App() {
  const monthly = useQuery('sales', {
    columns: ['month', 'region'],
    aggregates: [{ op: 'sum', field: 'revenue' }],
    orderBy: 'month',
  });
  const byRegion = useQuery('sales', {
    columns: ['region'],
    aggregates: [{ op: 'sum', field: 'revenue' }],
    orderBy: [{ field: 'revenue_sum', descending: true }],
  });
  const peak = monthly.rows.reduce(
    (best, row) => (!best || row.revenue_sum > best.revenue_sum ? row : best),
    null,
  );
  const leader = peak?.region;
  const others = [...new Set(monthly.rows.map(row => row.region))].filter(region => region !== leader);
  const months = [...new Set(monthly.rows.map(row => row.month))];
  const secondHalf = [months[Math.floor(months.length / 2)], months[months.length - 1]];
  // Each step's chart differs from the one before: a reveal, a mark, a focus, another chart.
  const steps = [
    {
      title: `Start with ${leader}`,
      text: `${leader} ended the year with the most revenue, and its best month was ${peak?.month}, `
        + `at ${format.compact(peak?.revenue_sum)}. Follow its line first, on its own, before the others come in.`,
      hide: { region: others },
      annotations: peak ? [{ at: { month: peak.month, region: leader }, text: 'Best month' }] : [],
    },
    {
      title: 'Against the other regions',
      text: `${others.length} other regions sold through the same months. For the first half of the year `
        + 'the lines stayed close together, and no region held a clear lead for long.',
    },
    {
      title: `${leader} pulled ahead late in the year`,
      text: 'The gap opened in the second half. While the other regions held steady, '
        + `${leader} kept adding revenue month after month, and the others never closed it.`,
      focus: { region: leader },
      annotations: [{ x: secondHalf, text: 'Second half' }],
    },
    {
      title: 'Over the whole year',
      text: `Added up over the year, ${leader} sold the most in total. The bars put every region `
        + 'side by side, so the size of the lead is easy to read.',
      chart: 'total',
    },
    {
      title: 'Explore it',
      text: 'The full picture is yours to explore. Click a line to follow one region through the '
        + 'year, and the table below lists every region\'s total.',
    },
  ];
  // The chart a step shows: the monthly lines as the step sets them, or the totals as bars.
  const chartOf = (item, last) => item.chart === 'total'
    ? (
      <FlintChart
        chartType="Bar Chart"
        title="Revenue by region, USD"
        query={byRegion}
        encodings={{ y: { field: 'region', sortBy: 'x', sortOrder: 'descending' }, x: 'revenue_sum' }}
        semanticTypes={{ revenue_sum: 'Amount' }}
        labels={{ region: '', revenue_sum: '' }}
        height={300}
      />
    )
    : (
      <FlintChart
        chartType="Line Chart"
        title="Monthly revenue by region, USD"
        query={monthly}
        encodings={{ x: 'month', y: 'revenue_sum', color: 'region' }}
        semanticTypes={{ month: 'YearMonth', revenue_sum: 'Amount' }}
        labels={{ month: '', revenue_sum: '', region: '' }}
        height={300}
        select={last}
        hide={item.hide}
        focus={item.focus}
        annotations={item.annotations || []}
      />
    );

  return (
    <AppTheme theme="nyt" density="normal">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={4}>
          <AppHeader
            variant="editorial"
            kicker="Sales"
            title={leader ? `${leader} led the year` : 'Sales through the year'}
            deck="Monthly revenue by region, USD."
            source="sales table"
          />
          {steps.map((item, index) => (
            <Step key={item.title} title={item.title} text={item.text}>
              {chartOf(item, index === steps.length - 1)}
            </Step>
          ))}
          <Stack spacing={1}>
            <Typography variant="h6" component="h2">Revenue by region</Typography>
            <DataTable
              query={byRegion}
              columns={[
                { field: 'region', label: 'Region' },
                { field: 'revenue_sum', label: 'Revenue', format: 'compact', bar: true },
              ]}
            />
            <Typography variant="caption" color="text.secondary">Source: sales table.</Typography>
          </Stack>
        </Stack>
      </Container>
    </AppTheme>
  );
}
```

## Quality checklist

- An `AppHeader` opens the app: a story, panel, or deck states its finding
  in the title; a dashboard states its current finding or names what it
  monitors; the deck gives measure, unit, scope, and period; the context line
  gives the period, count, and source, and `where` the active filters. 3–5 KPIs lead with the key numbers,
  each read against something: a previous period, a target, or a sparkline.
- A `FilterBar` on top, KPIs, then one primary chart tile with supporting tiles
  beside or below. Every tile's heading states its finding, computed from its
  rows ("West leads with 35%"), and the subtitle its measure and unit. Each
  chart marks what its heading names: `focus` on the bar or series it names,
  an `annotations` note on the point (the peak, the latest value). Each tile
  shows something the others do not (not one ranking as both a list and a
  table).
- Gaps come from `Stack`/`Grid` `spacing` and tile padding only; no margins on
  text, charts, or tiles; colors and fonts from the theme.
- Controls apply immediately and default to a meaningful selection.
- Skip nulls rather than treating them as zero; disclose truncated results.
- Text fits the form (Words): on a dashboard, explorer, panel, or slides,
  headings state findings, subtitles name the measure, and the closing note
  has at most two lines of material caveats.
- Format numbers with `@df/format` or DataTable `format`.
- A story has 3–7 steps, each its text beside a chart showing something the
  others do not (a reveal, a focus, a mark, or a different chart); a story
  whose steps would show the same chart is a panel or a write-up instead.
- A panel's tiles each state a finding, the measure, and a caption; the lead
  chart is the largest, and the grid's rows are filled.
- Linked charts each carry the linked field in their rows; the ones the reader
  picks on have `select` and `onFocus`, and all take the shared `focus`.

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
object attribute such as `encodings={{x: 'month'}}` closes both), and import
every MUI component you use. An app that fails to render
shows its error, and the user can ask you to fix it.

Fixing a reported error: you do not see the app run, so work from the message.
- A chart error names the chart (its title or type and encodings) and what
  failed. Fix that chart's props; leave the rest of the app as it is.
- An error from inside the chart engine ("Cannot read …", "… is undefined")
  is triggered by one of the chart's props, not by how it is written: drop or
  change one at a time — a `sortBy`, an `aggregate`, `select`, `view`,
  `chartProperties`, a `column` facet, an unusual channel — starting with the
  one least needed, and say which you changed. Restating the same encodings in
  longer form changes nothing.
- Keep `FlintChart`: do not replace charts with `VegaChart` or hand-built
  Vega-Lite to get around an error; the app would lose its theme, linking, and
  in-place controls. If a chart still fails after two changes, show it in a
  simpler form (fewer channels, no interaction) and say so.
- Say what you changed and that you could not see the result; do not report
  the error as fixed.

Use `write_html_app` only when the user explicitly asks for plain HTML: one
self-contained `.html` document with inline CSS/JS, styled with the `df-*` kit
classes (`df-app`, `df-header`, `df-toolbar`, `df-card`, `df-kpis`, `df-chart`)
and reading data through the global `DF` runtime (`await DF.ready`,
`DF.query(table, options)` with the options above, `DF.chart(target, vegaLiteSpec)`,
`DF.format`). Revise HTML apps the same way (`write_html_app` with `path` for
rewrites) and keep their `df-app-manifest` script.
