---
name: connected_data
description: Find, inspect, and load data beyond the session — connected sources, referenced tables, semantic models, the web, or local files.
when_to_use: Before discovering, probing, or loading data that is not already a table in the session, or answering what data a connected source holds.
tools: []
actions: []
---

# Connected Data

| State | What the agent can do | What changes it |
|---|---|---|
| Connected-source catalogs | Discover tables, inspect metadata, and run bounded read-only probes. | Discovery does not load data or make catalog paths readable in sandboxed Python. |
| External table references in the workspace | Use the cached schema and exact source ID/table key to describe, probe, or load a relevant subset. | Adding a large source can succeed as a virtual reference. Only a materialized query result is a Python input. |
| Import proposal or connector form awaiting review | Explain the grounded choice and wait for the user's selection or Connect. | Clear single-option imports may execute automatically; only successful execution establishes availability. |

## Register Acquired Data

For newly acquired analysis data, register one bounded reusable working dataset
before charting or reporting, even when the user did not explicitly request a
table. Supply `acquisition` with a non-sensitive `source` and `scope` (including
dates, grain, measures, and units), plus `query` and `limitations` when relevant.
Declare the actual acquired file inputs. The server persists this as agent-managed
source data with an acquisition timestamp and file hashes, not a derived result
or user-uploaded original. Never include credentials in acquisition metadata.
Combine parsing, normalization, and validation in the creation code when possible;
use the returned `id` and `path` immediately for analysis and chart provenance.
Reuse an existing suitable input rather than registering it again. Discovery
listings, raw response fragments, caches, and intermediate calculations stay in
scratch. Do not create a separate staging table for each chart transformation.

For an explicit acquisition refresh, supply the new acquired file inputs and
`acquisition` metadata again. Without it, replacement data has ordinary
generated/derived semantics rather than retaining an outdated acquisition claim.

## Choose an Acquisition Route

Ground the user's question in relevant workspace tables, files, attachments,
external references, and previous results. Check scope, grain, and freshness;
do not force a new subject onto unrelated existing data.

When inputs are missing, choose among the available routes below. Unless the
user named where the data comes from, search connected sources for the subject
(`search`, which covers the `sources/` catalogs) before another route; then choose the route that best fits the
requested source and access. A missing connector alone does not establish that
data is inaccessible.

| Available access | Next step |
|---|---|
| Relevant workspace data or files | Read the listed paths and analyze directly; resolve external references through Data Access Paths below. |
| Connected source | Discover matching data, inspect unresolved metadata, and use `propose_data_operation` to load a suitable working dataset. |
{terminal_acquisition_route}
| A new connection is needed or the user requests reusable connected access | Load the `configure` skill and use `propose_connection` with verified non-sensitive fields. The user supplies credentials and confirms Connect; do not claim access before success. |
| No available authorized route can obtain required inputs | Explain the concrete blocker and request an upload, pasted data, image, or user-managed authentication as appropriate. Never request secrets in chat. |

Ask for essential intent or scope that inspection cannot resolve, and honor
required application approvals. Do not ask the user to perform an acquisition
step that available tools can complete. After successful acquisition, continue
through analysis and the requested chart, file, report, or answer in the same run.
Discovery or a saved intermediate alone does not complete an analysis request.
Finding a local file does not register a connector or load workspace data; propose
a connection only when needed for access or requested for reuse. Do not work
around unavailable sources with sandbox network access.

## Data Access Paths

The system eagerly copies reasonably sized selected external tables into the
workspace and keeps large tables as external references, using configured row
and byte thresholds when sizes are known. This is an initial access decision,
not a reason to ask the user to manage storage. Already loaded data stays loaded.

Use the same `propose_data_operation` action for workspace preparation and concrete
loads; no separate preparation tool is needed. Omit `query` to add a source using
the same size policy as manual selection: known large tables become virtual
references, while smaller or unknown-size tables use ordinary loading. For an
analysis request, submit the needed working-dataset query directly: the application
automatically adds a virtual source reference only if that source/table is not
already represented in the workspace. Do not make a separate preparation call.

Inspect each returned `load_outcomes` entry. `availability: virtual` and
`compute_ready: false` means registration succeeded but rows remain remote, with
no Python-readable path. A query load can return this source reference alongside
a `materialized`, `compute_ready: true` dataset. Use that dataset directly; do not
reload merely because the source remains virtual. If no suitable materialized
result exists, use the source ID/table key to refine the query as needed.
Registration alone does not complete a computation request, and query failures
remain failures even when source registration succeeded. A request only to add
the source does not require materialization.

Supply `query` to request concrete rows, preferably with selective filters,
projection, or aggregation. Even `query: {}` requests materialization rather than
automatic virtual registration; use it only when the ordinary full load is
appropriate. Concrete queries never silently fall back to references. If a query
fails or exceeds limits, refine it without changing the requested coverage or
ask about a necessary tradeoff. `availability: materialized` and
`compute_ready: true` means use the returned path and scope for local work, not
that the result necessarily covers the full source.

| Starting point | Agent path |
|---|---|
| Relevant workspace table or file covers the task | Read its listed path, compute locally, and visualize or report. No connector load is needed. |
| Large external reference, no suitable local copy | Reuse cached metadata; describe or probe only for unresolved schema or scope. Load a bounded, reusable working dataset with `propose_data_operation`, then analyze and visualize from the successful result. |
| Needed data is absent | Follow Choose an Acquisition Route above. For connected data, load a suitable working dataset directly; missing source references are registered automatically with query loads. A discovery-only request does not require loading. |
| Follow-up on an existing analysis | Reuse a result whose fields, scope, grain, and freshness support the request. Query the source for gaps; chart styling alone needs no reload. For governed measures, follow Semantic Models below. |
| Single external chart with known schema and scope, and no broader analysis requested | Optionally use `visualize` with `connector_inputs` for a bounded query and chart in one call. When unsure, use the separate load path. |

### Choose a Reusable Working Dataset

Default to separate load then analysis/visualization actions. Load enough data to
answer the current request and support closely related follow-ups, not every
possible future question. Keep useful dimensions, join keys, measures, and time
granularity within the requested subject and date scope. Prefer a coherent slice
over a chart-specific top-N result, but avoid speculative bulk loading.

For example, to compare service failures last week, load daily counts by service
and failure category for that week when those fields exist and aggregation is
supported. Python can then produce totals, trends, and breakdowns from one copy.
Do not load all raw events unless record-level analysis needs them. Conversely,
retain raw values when distributions or individual records are required. Do not
average precomputed averages; retain sufficient components such as sums and
non-null counts, or use appropriate raw data for later rollups.

Use selective filters and projection; source-side aggregation can preserve useful
detail without copying the full source. More reusable does not necessarily mean
more rows. Do not widen requested subjects or dates, discard required granularity,
or silently truncate coverage to fit a limit. If an adequate dataset cannot be
loaded within connector limits, explain the constraint and resolve the tradeoff.

After success, use returned IDs, paths, schema, row counts, and scope directly;
no extra workspace listing is needed. Continue to the requested answer or chart
in the same run. Keep the working dataset as an input; derive chart-specific
results locally when its coverage and metric semantics support them.

## Resolve External Table Access

External references express the user's selected data context. Treat them as
intended analysis inputs, not suggestions to discover alternatives, unless the
request indicates otherwise. Their rows needing materialization does not make
the source missing from the workspace. Prefer the focused source when relevant.
Use cached schema and samples;
read the table's `sources/` file only for missing metadata and `probe_data` only when a value
or semantic uncertainty affects the query. Match join keys and filter values
against available evidence. Ask only about intent inspection cannot resolve,
such as the meaning of "top" when multiple rankings are meaningful. Report
disconnected sources or access failures explicitly.

When `query_capabilities.aggregate_loading` is `supported`, loading also accepts
`group_by` and `aggregates`, each with a unique `as` output name. Do not combine
aggregate fields with raw `columns`. Prefer source-side aggregation for
`server_query` sources (SQL databases and Kusto): load a reusable result at
sufficient granularity, not necessarily the final chart
totals or raw rows that Python would aggregate again. Aggregate
results are bounded at 10,000 rows; an overflowing result without an explicit
limit fails rather than silently truncating. Explicit limits represent requested
top-N or partial coverage. Unsupported connectors fail rather than loading a
sampled aggregate. Probe output is inspection evidence, not a durable input.
Small output limits do not guarantee small scans on file sources, especially for
global ordering or aggregation.

Prefer loading a complete, bounded working dataset and using Python locally.
When raw loading is too large or prohibited, or structured loading cannot express
the required reduction, use `query.native` only for an advertised
`query_capabilities.native_query_languages` language. Kusto accepts
`{"native": {"language": "kql", "text": "Events | summarize event_count=count() by category"}}`.
Add the relevant date/scope filters before aggregation. Submit one query expression
over the selected table; commands, statements, comments, external/remote access,
and plugins are unavailable. Native queries cannot be mixed with structured fields
except `limit`. Execution is bounded to 60 seconds, 16 MiB, and 10,000 loaded rows;
partial failures are rejected. Limits/sampling written into KQL still mean partial
coverage. Load the reusable result, then compute comparisons and charts locally.
Other native languages follow `query_capabilities.native_query_guidance`.

### Semantic Models

Catalog entries with `query_model: semantic` (for example Cube views or Power BI
semantic models) expose dimensions and governed measures, not a fixed dataset.
The preview is illustrative; a loaded result covers its saved query, not the
whole model. Reuse it when it supports the request. Query the model for missing
measures, dimensions, scope, or grain; roll up locally only when the metric's
semantics permit it, not merely because its values are numeric.

- Select dimensions and measures in `query.columns`; the model groups by the
  selected dimensions. Use `"Name (grain)"` for advertised time granularities,
  otherwise the model's date columns. Do not send `group_by`/`aggregates`.
- Prefer governed measures over recreating business metrics from raw columns.
  If a metric requires a raw-source fallback, distinguish it from the governed definition.
- Read the model's `sources/` file for missing fields, native `ref`s, or granularities;
  page with `offset`/`limit`, or `search` within it for a field or a role (`time_dimension`). Use `probe_data` when values or
  coverage need checking, not as a mandatory step before every load.
- Filter on dimensions. For measure filters or other unsupported query shapes,
  use `query.native` with the advertised language and exact field `ref`s.
- Omitting `query` adds only a reference. Supply a query to materialize a result
  for Python analysis and visualization.

Read `query_capabilities` in reference context and in a table's `sources/` file before
probing:
- `server_query`: filters and aggregations execute on the source engine. Use
  selective queries; source-side execution does not guarantee low cost.
- `remote_file_scan`: Azure Blob, S3, and similar sources read files into the
  application. CSV/JSON probes may transfer and scan the entire source despite
  a small result limit. Parquet may reduce reads, but do not assume pushdown.
- `local_file_scan`: files are scanned locally, with no source database engine.
- `semantic_query`: a semantic layer computes governed measures; see Semantic Models.
- `unknown`: do not assume server-side execution or cheap probes.

Avoid scanning a file source twice merely to probe then import the same scope.
Before another load, read saved predicates, projection, limits, and any known
staleness. A broader local slice can answer a narrower request. Missing columns,
insufficient coverage or detail, known truncation, or a freshness requirement
can justify another query; an unusual distribution alone does not.

## Bring In Missing Data

For a missing named subject, `search` connected catalogs before asking the user
to supply a dataset. Missing geography, dates, or granularity need not block a bounded catalog search.
Use discovered coverage to resolve scope; ask only about remaining choices.

Connected catalogs are read-only files: `sources/<source_id>/<catalog path>/<table>`.

| Discovery goal | Tool |
|---|---|
| Broad availability question | `list_files` of `sources/` (every connected source with its table count), then one source's folder |
| Named subject or table | `search` (session first, then catalogs); `path: ["sources/"]` or `["sources/<source_id>/"]` for catalogs only and every match |
| Browse a hierarchy | `list_files` of a folder, one level at a time; a glob (`sources/<source_id>/*sales*`) for any depth |
| Verify matching columns, types, coverage, or filter values | `read_file` of the table: `source_id`, `table_key`, columns one per line |
| Metadata cannot resolve a loading choice | `probe_data` with a bounded structured query |

Do not ask which source to inspect for a broad availability question: list
connected sources first. Respect omitted counts and pagination; an empty or
truncated search is not proof that data does not exist. Report access failures
as failures, not as absent data. Prefer cached discovery before live probes.
Use structured queries, not generated source-specific SQL.

Reconcile discoveries with workspace inputs to avoid duplicate imports, then
continue along the Data Access Paths. If nothing suitable is accessible, explain
what was checked and offer a concrete connection or upload next step.

### Import Proposals

Provide one to three complete alternatives, with one or more related tables per
option. Use one option with `user_review_needed: false` for a clear load. Set it
to true for unresolved choices or material changes to the requested coverage or
meaning; multiple alternatives always require review. Retaining useful columns
or finer detail that preserves the requested answer is an implementation choice,
not a reason to pause. Coarsening away required detail or substituting subjects
or dates requires review.

Use exact discovered IDs, table keys, columns, and values. Omit `query` for an
appropriate whole-table copy; otherwise use a structured subset or aggregate
query. Do not invent operation IDs or hashes; the server creates them.

Give each resulting table a concise `display_name` describing its subject and
scope, especially for subsets: "Last of Us Part II Reviews", not the raw CSV
path or "Game Reviews" for every game. Names describe data, not commands such
as "Load reviews". Do not claim complete coverage when the result is limited.
Import filters and projection are persisted with the table for later summaries.

Alongside the call, briefly explain what was found and what each choice provides,
including coverage or compromises. Use concise option labels, not reasoning in
labels or column lists instead of an explanation. Supply `response` when there is
no accompanying narration. Wait for the actual import result before claiming
data is loaded or analyzing it. An omitted review flag defaults to false for a
single option.
