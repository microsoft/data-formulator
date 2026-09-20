---
name: workspace
description: Read available data, discover and import connected data, and create or revise agent-managed workspace data and files.
always_on: false
tools:
  - create_data
  - update_data
  - create_file
  - edit_file
  - list_workspace_items
  - read_workspace_item
  - search_workspace_items
  - summarize_data_sources
  - list_data
  - find_data
  - describe_data
  - probe_data
  - list_connectors
  - describe_connector
  - read_connector_form
actions: [propose_data_operation, propose_connection, update_connector_form]
---

# Workspace

## Data Boundaries

| State | What the agent can do | What changes it |
|---|---|---|
| User-managed workspace data and files | Read listed inputs directly; prefer relevant user-managed sources. | Agent tools cannot overwrite protected originals; create a copy instead. |
| Agent-managed workspace data and files | Read, combine, analyze, and revise using listed paths and hashes. | Create with `create_data`/`create_file`; revise with `update_data`/`edit_file`. Durable until deleted. |
| Scratch | Read execution intermediates and legacy artifacts when relevant. | Internal temporary storage, not the destination for requested outputs. |
| Connected-source catalogs | Discover tables, inspect metadata, and run bounded read-only probes. | Discovery does not load data or make catalog paths readable in sandboxed Python. |
| External table references in the workspace | Use the cached schema and exact source ID/table key to describe, probe, or load a relevant subset. | A successful connector query creates an ordinary workspace table; the reference itself is not a Python input. |
| Import proposal or connector form awaiting review | Explain the grounded choice and wait for the user's selection or Connect. | Clear single-option imports may execute automatically; only successful execution establishes availability. |

Ownership controls writes and lifecycle, not read access. A workspace without
tables may still have usable files; files need no promotion or another upload to be read.
An external source is not automatically a connected source. Do not invent access,
paths, credentials, or datasets, or treat probe samples as the full dataset.

## Data Access Paths

The system eagerly copies reasonably sized selected external tables into the
workspace and keeps large tables as external references, using configured row
and byte thresholds when sizes are known. This is an initial access decision,
not a reason to ask the user to manage storage. Already loaded data stays loaded.

| Starting point | Agent path |
|---|---|
| Relevant workspace table or file covers the task | Read its listed path, compute locally, and visualize or report. No connector load is needed. |
| Large external reference, no suitable local copy | Reuse cached metadata; describe or probe only for unresolved schema or scope. Load a bounded, reusable working dataset with `propose_data_operation`, then analyze and visualize from the successful result. |
| Needed data is absent | Discover connected data, reconcile it with existing inputs, then load a suitable working dataset and continue. A discovery-only request does not require loading. |
| Follow-up on an existing analysis | Reuse a dataset whose coverage contains the request and whose columns, detail, and freshness support it; filter locally. Query the source only for a concrete gap, not chart styling or another local grouping. |
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
in the same run. Keep the working dataset as an input and derive chart-specific
filters, grouping, and ranking locally rather than replacing that input.

## Read Available Data

Reuse stable IDs and exact paths from `[WORKSPACE INPUTS]` and file context.
Do not list again merely to obtain IDs already present.

| Need | Tool |
|---|---|
| Loaded table schema, statistics, samples | `inspect_source_data` if context is insufficient |
| External reference schema or evidence | Reuse its cached summary; `describe_data` for missing schema or `probe_data` for a structured query, using its exact connector address |
| Bounded rows or normalized file text | `read_workspace_item` with the input ID |
| Matching local content or external reference metadata | `search_workspace_items`; remote rows require `probe_data`, and a metadata miss does not rule out matching records |
| Computation or a Python-only file, including scratch | `execute_python_script` with its listed path |
| Refreshed inventory, prior scratch, edit hash, or stored memory | `list_workspace_items`; choose `input`, `temp`, or `memory` scope |

Sandboxed Python can read listed `data/...`, `files/...`, and `scratch/...`
paths together. It cannot fetch unconnected external data or write files directly.
Existing memory remains readable: table memory appears as data, text memory as
a file. Reuse fresh memory rather than re-extracting its source.

## Resolve External Table Access

External references express the user's selected data context. Treat them as
intended analysis inputs, not suggestions to discover alternatives, unless the
request indicates otherwise. Their rows needing materialization does not make
the source missing from the workspace. Prefer the focused source when relevant.
Use cached schema and samples;
call `describe_data` only for missing metadata and `probe_data` only when a value
or semantic uncertainty affects the query. Match join keys and filter values
against available evidence. Ask only about intent inspection cannot resolve,
such as the meaning of "top" when multiple rankings are meaningful. Report
disconnected sources or access failures explicitly.

When `query_capabilities.aggregate_loading` is `supported`, loading also accepts
`group_by` and `aggregates`, each with a unique `as` output name. Do not combine
aggregate fields with raw `columns`. Prefer source-side aggregation for Kusto:
load a reusable result at sufficient granularity, not necessarily the final chart
totals or raw rows that Python would aggregate again. Aggregate
results are bounded at 10,000 rows; an overflowing result without an explicit
limit fails rather than silently truncating. Explicit limits represent requested
top-N or partial coverage. Unsupported connectors fail rather than loading a
sampled aggregate. Probe output is inspection evidence, not a durable input.
Small output limits do not guarantee small scans on file sources, especially for
global ordering or aggregation.

Read `query_capabilities` in reference context and discovery results before
probing (`source_query_capabilities` maps source IDs in search results):
- `server_query`: filters and aggregations execute on the source engine. Use
  selective queries; source-side execution does not guarantee low cost.
- `remote_file_scan`: Azure Blob, S3, and similar sources read files into the
  application. CSV/JSON probes may transfer and scan the entire source despite
  a small result limit. Parquet may reduce reads, but do not assume pushdown.
- `local_file_scan`: files are scanned locally, with no source database engine.
- `unknown`: do not assume server-side execution or cheap probes.

Avoid scanning a file source twice merely to probe then import the same scope.
Before another load, read saved predicates, projection, limits, and any known
staleness. A broader local slice can answer a narrower request. Missing columns,
insufficient coverage or detail, known truncation, or a freshness requirement
can justify another query; an unusual distribution alone does not.

## Bring In Missing Data

For a missing named subject, search connected catalogs with `find_data` before asking the user
to supply a dataset. Missing geography, dates, or granularity need not block a bounded catalog search.
Use discovered coverage to resolve scope; ask only about remaining choices.

| Discovery goal | Tool |
|---|---|
| Broad availability question | `summarize_data_sources({})` across connected sources |
| Named subject or table | `find_data` with a query; narrow by source/path when known |
| Browse a hierarchy | `list_data` for one level; `find_data` for descendants |
| Verify matching columns, types, coverage, or filter values | `describe_data` with exact discovered source ID and table key |
| Metadata cannot resolve a loading choice | `probe_data` with a bounded structured query |

Do not ask which source to inspect for a broad availability question: summarize
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

## Connections and External Access

When asked to connect, call `propose_connection` in the same turn. With no known
type, `propose_connection({})` opens a form with a selector. Use `list_connectors`
to look up supported types and `describe_connector` for fields or authentication.
A connector form is a persistent artifact, not a prose question. Accompany it
with brief review guidance; only the user can confirm Connect.

For an existing form, call `read_connector_form` first. Use its current ID and
revision with `update_connector_form` for changed non-sensitive fields only;
preserve other user edits. Do not create a duplicate or ask for values already
present. On revision conflict, reread on the next turn before reconciling.
To change connector type, use `propose_connection` with the new type; it reuses
the pending form and resets its fields.

Use only user-supplied or verified connection values. Credentials are never
returned by form reads or changed by form patches. New-form prefills may include
credentials the user deliberately supplied, but never repeat them in prose or
tool output; those seeds are transient and excluded from persisted state.

For local file discovery or installed CLI diagnostics, load `terminal` only when
available and needed. Host commands require explicit approval. Finding a local
file or using a cloud CLI does not register a connector or load workspace data;
propose a suitable connection, such as `local_folder`, then discover and import.
Do not work around unavailable sources with sandbox network access.

## Create or Revise Workspace Outputs

For a dataset intended for queries, charts, or repeated analysis, use `create_data`
instead of creating a CSV or Parquet file and importing it. Supply literal
`rows` or sandboxed `code` producing a DataFrame in `output_variable`, along with
actual `input_sources` from the input inventory. Use `[]` for data generated without
inputs, and clearly label synthetic data. For scratch inputs, use their exact
`scratch/...` path as the source `id` with `kind: file`; the server records the
current content hash. Creation rejects existing table names.

Use `update_data` only when explicitly revising an existing agent-created editable
table. Supply its current `content_hash` and recompute the replacement data. Its
table ID and conversation references stay intact; dependent agent data is marked
stale, not recomputed. On conflict, reread and reconcile. User-uploaded and
connector-imported tables are protected: create a derived copy instead.

Use the file tools below for documents, scripts, and requested exports. A CSV or
Parquet file remains a file; its extension does not automatically register data.

Use `create_file` for a requested document, script, or export, not as
an extra step before every analysis. Supply literal text or code producing an
output variable: DataFrame requires `.parquet`, str becomes UTF-8, bytes preserve
binary content. Choose a reasonably concise, descriptive filename without unnecessary
qualifiers or cryptic abbreviations. Provide a short meaningful `display_name`, keeping acronyms and
omitting extensions and underscores. Creation rejects existing filenames.

Use `edit_file` for revisions to an agent-managed file at the same `files/...` path.
Read the file and obtain its SHA-256 `content_hash` from the latest create/edit
result or input inventory. Imported originals remain protected.
Choose a text patch for a small change or full text/code replacement for a new
version, including regenerated Parquet. On conflict, reread and reconcile; never
blindly retry with a newer hash. Names and titles are preserved unless changed.

Never write directly to `data/`, `files/`, `memory/`, or hidden runtime files through
sandboxed Python. Use the data/file tools to persist requested outputs; scratch
is only for internal temporary work. Do not invent paths or URLs. Created files
appear immediately for preview, editing, download, and direct analysis.
