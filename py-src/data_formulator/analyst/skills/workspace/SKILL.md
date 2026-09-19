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
| Proposed import or connector form | Explain the grounded choice and wait for review. | The user chooses an import option or clicks Connect; only a successful result establishes availability. |

Ownership controls writes and lifecycle, not read access. A workspace without
tables may still have usable files; files need no promotion or another upload to be read.
An external source is not automatically a connected source. Do not invent access,
paths, credentials, or datasets, or treat probe samples as the full dataset.

## Read Available Data

Treat loaded tables and external references as peers when selecting workspace
data for any analysis, chart, report, or follow-up. Storage location determines
the access steps, not relevance or availability. Do not fall back to an unrelated
loaded table just because it is immediately readable. A workspace containing only
references still has data to analyze.

Reuse stable IDs and exact paths from `[WORKSPACE INPUTS]` and file context.
Do not list again merely to obtain IDs already present.

| Need | Tool |
|---|---|
| Loaded table schema, statistics, samples | `inspect_source_data` if context is insufficient |
| External reference schema or evidence | Reuse its cached summary; `describe_data` for missing schema or `probe_data` for a structured query, using its exact connector address |
| External rows needed for Python or a chart | `propose_data_operation` for the relevant subset; continue with the actual returned table ID and path after success |
| Bounded rows or normalized file text | `read_workspace_item` with the input ID |
| Matching local content or external reference metadata | `search_workspace_items`; remote rows require `probe_data`, and a metadata miss does not rule out matching records |
| Computation or a Python-only file, including scratch | `execute_python_script` with its listed path |
| Refreshed inventory, prior scratch, edit hash, or stored memory | `list_workspace_items`; choose `input`, `temp`, or `memory` scope |

Sandboxed Python can read listed `data/...`, `files/...`, and `scratch/...`
paths together. It cannot fetch unconnected external data or write files directly.
Existing memory remains readable: table memory appears as data, text memory as
a file. Reuse fresh memory rather than re-extracting its source.

## Resolve External Table Access

Include `[EXTERNAL TABLE REFERENCES]` alongside loaded tables when planning the
analysis, even when loaded tables could provide a partial answer. These are
sources the user has already selected, not a request to rediscover or reconnect
them. Prefer the focused
reference, but consider all relevant workspace sources on follow-up questions.
Use `describe_data` when the cached schema is empty or insufficient. Match join
keys and filter values against existing tables; then load the needed raw rows
with `propose_data_operation`, one option and `user_review_needed: false`, and
continue the analysis from its result. Do not merely suggest using the reference.
Ask only about intent that inspection cannot resolve, such as the meaning of
"top" when multiple rankings are meaningful.

Aggregate queries belong to `probe_data`; import queries accept only filters,
columns, ordering, and limits. Check probe exactness before using its results as
population evidence. Small output limits do not guarantee small scans on file
sources, especially for global ordering or aggregation.

Read `query_capabilities` in reference context and discovery results before
probing (`source_query_capabilities` maps source IDs in search results):
- `server_query`: filters and aggregations execute on the source engine. Use
  selective queries; source-side execution does not guarantee low cost.
- `remote_file_scan`: Azure Blob, S3, and similar sources read files into the
  application. CSV/JSON probes may transfer and scan the entire source despite
  a small result limit. Parquet may reduce reads, but do not assume pushdown.
- `local_file_scan`: files are scanned locally, with no source database engine.
- `unknown`: do not assume server-side execution or cheap probes.

For file scans, reuse cached schema/samples and relevant loaded tables first.
Do not probe merely as a prerequisite to loading. Once the needed row scope is
known, load it once and compute locally; only probe when its result is needed
to answer the question or decide the scope. For example, determine a game from
the available ratings table, then load its matching reviews, rather than
aggregating all remote reviews and scanning them again for the import.

Preserve the requested coverage: do not add an arbitrary row limit and present
the imported subset as the full population. Reuse an already imported subset
only when its filters and coverage match the current question. Keep imported
rows and source-level evidence distinct. Report actual access failures or ask
about unresolved scope; the reference's remote storage alone is not a blocker.

Read saved import predicates, projection, and limits before proposing another
load. Adding columns does not widen row coverage. An unusual score distribution
alone does not prove an extract is incomplete; reloading unchanged source data
with the same row scope will not create missing categories. Reuse the existing
rows unless a needed column, different scope, known truncation, or source change
justifies another query, and explain that distinction.

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

Reconcile discoveries with existing workspace inputs to avoid duplicate imports.
For suitable missing data needed by an import or analysis request,
call `propose_data_operation` in the same run, not a promise to load later.
Set `user_review_needed: false` for one unambiguous recommended load and continue
from its execution result without a confirmation pause. Set it to true if the
user must resolve ambiguity or approve a material change to their requested data.
If the user asked only to find or describe available data, answer with findings
without an unsolicited import. If nothing suitable is accessible, explain what
was checked and offer a concrete connection or upload next step.

### Import Proposals

Provide one to three complete alternatives, with one or more related tables per
option. One option is enough when the choice is clear. Use exact discovered IDs,
table keys, columns, and values. For a whole table omit `query`; use raw-row
filters, projection, ordering, or limits only when the task needs them. Do not
invent operation IDs or hashes; the server creates them.

Give each resulting table a concise `display_name` describing its subject and
scope, especially for subsets: "Last of Us Part II Reviews", not the raw CSV
path or "Game Reviews" for every game. Names describe data, not commands such
as "Load reviews". Do not claim complete coverage when the result is limited.
Import filters and projection are persisted with the table for later summaries.

Alongside the call, briefly explain what was found and what each choice provides,
including coverage or compromises. Use concise option labels, not reasoning in
labels or column lists instead of an explanation. Supply `response` when there is
no accompanying narration. Multiple alternatives always require review. Changes
to requested subjects, date coverage, or granularity also require review, even
with one option. Wait for the actual import result before claiming data is loaded
or analyzing it. An omitted review flag defaults to false for a single option.

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
