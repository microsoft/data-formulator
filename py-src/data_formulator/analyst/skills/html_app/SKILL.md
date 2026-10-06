---
name: html_app
description: >-
  Build an interactive HTML app (dashboard, explorer, comparison tool, or custom
  visual) that runs in a sandbox on the canvas and reads workspace tables live.
when_to_use: >-
  The user asks for an interactive app, dashboard, explorer, or custom UI with
  controls such as filters, tabs, sliders, drill-down, or linked views. Not for a
  narrative document (use report), a single chart (use visualize), a plain file,
  or an ordinary answer.
always_on: false
tools: []
actions:
  - write_html_app
---

# Skill: Interactive HTML apps

## Plan

Ground the app in workspace data before writing it. Confirm the tables and
columns it needs; load, create, or derive missing tables first (for example a
cleaned or pre-aggregated table from `create_data`). Declare every table the app
reads in `tables`. Prefer a focused app that answers the user's goal well over
many loosely related widgets.

## Sandbox

The app is one self-contained HTML document rendered in an isolated sandbox:

- Inline `<style>` and `<script>` only. External scripts, stylesheets, fonts,
  images, and CDNs are blocked; use the built-in runtime, CSS, inline SVG, or
  `data:` URIs.
- No network access (`fetch`, XHR, WebSocket), no browser storage
  (`localStorage`, cookies, IndexedDB), no forms submission, popups, dialogs
  (`alert`/`confirm`/`prompt`), or navigation. Keep state in JavaScript memory.
- Do not embed bulk data in the HTML; read it through the runtime so the app
  stays small and reflects the current tables.

## Runtime

A global `DF` object is available before your scripts run:

- `await DF.ready` — wait for the host before reading data. `DF.manifest.tables`
  lists the declared tables.
- `await DF.query(table, options)` → `{rows, totalRowCount}`. Options:
  - `columns`: columns to return (default: all). With `aggregates`, these are
    the group-by keys.
  - `aggregates`: `[{op: "count"}, {op: "sum" | "avg" | "min" | "max", field}]`.
    Result columns are `_count`, `<field>_sum`, `<field>_avg`, `<field>_min`,
    `<field>_max`.
  - `filters`: `{field, op: "in", values}`, `{field, op: "range", min, max}`,
    or `{field, op: "contains", value}`; combined with AND. `search` matches
    text across all columns.
  - `orderBy` (source column names, not aggregate result columns; sort
    aggregated rows in JavaScript) with `descending` (boolean); `limit`
    (default 5000, at most 50000) and `offset`.
  - `totalRowCount` counts matching rows (or groups) before `limit`; disclose
    when rows are truncated.
- `await DF.table(table, {limit})` → rows; shorthand for small tables.
- `await DF.chart(target, spec)` renders a Vega-Lite spec into an element or
  CSS selector and returns the Vega view. Put rows in `spec.data = {values: rows}`;
  use `width: "container"` for responsive charts. `DF.vega` and `DF.vegaLite`
  are also available.
- Theme CSS variables: `--df-font`, `--df-font-mono`, `--df-text`,
  `--df-muted`, `--df-bg`, `--df-surface`, `--df-border`, `--df-primary`.
  `DF.theme.palette` is the categorical color palette.

Query on the server for large tables: filter and aggregate with `DF.query`
when controls change instead of loading every row. Show a loading state while
waiting and a readable message when a query fails. Uncaught errors are shown to
the user.

## Design

Use the full canvas width and let the page scroll vertically. Start with a short
title and the key takeaway or summary metrics, then controls and linked views.
Label units, use readable number formatting, and keep the styling consistent
with the theme variables. Make controls keyboard accessible with visible labels.

## Delivery

Call `write_html_app` once with a new `.html` filename, a short `title`, the
declared `tables`, and the complete document. A successful call opens the app
on the canvas and returns its `path`, `content_hash`, and any sandbox
`warnings`; fix warnings with `edit_file`. To revise an existing app, use
`edit_file` with its path and current content hash, keeping the
`df-app-manifest` script; edit its `tables` list when the app reads other
tables. Briefly tell the user what the app shows and how to use it.
