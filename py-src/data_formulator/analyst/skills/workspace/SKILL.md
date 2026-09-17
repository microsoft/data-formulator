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
| Proposed import or connector form | Explain the grounded choice and wait for review. | The user chooses an import option or clicks Connect; only a successful result establishes availability. |

Ownership controls writes and lifecycle, not read access. A workspace without
tables may still have usable files; files need no promotion or another upload to be read.
An external source is not automatically a connected source. Do not invent access,
paths, credentials, or datasets, or treat probe samples as the full dataset.

## Read Available Data

Reuse stable IDs and exact paths from `[WORKSPACE INPUTS]` and file context.
Do not list again merely to obtain IDs already present.

| Need | Tool |
|---|---|
| Table schema, statistics, samples | `inspect_source_data` if context is insufficient |
| Bounded rows or normalized file text | `read_workspace_item` with the input ID |
| Matching content within current readable inputs | `search_workspace_items` |
| Computation or a Python-only file, including scratch | `execute_python_script` with its listed path |
| Refreshed inventory, prior scratch, edit hash, or stored memory | `list_workspace_items`; choose `input`, `temp`, or `memory` scope |

Sandboxed Python can read listed `data/...`, `files/...`, and `scratch/...`
paths together. It cannot fetch unconnected external data or write files directly.
Existing memory remains readable: table memory appears as data, text memory as
a file. Reuse fresh memory rather than re-extracting its source.

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
The proposal itself obtains user confirmation; do not ask permission separately.
If the user asked only to find or describe available data, answer with findings
without an unsolicited import. If nothing suitable is accessible, explain what
was checked and offer a concrete connection or upload next step.

### Import Proposals

Provide one to three complete alternatives, with one or more related tables per
option. One option is enough when the choice is clear. Use exact discovered IDs,
table keys, columns, and values. For a whole table omit `query`; use raw-row
filters, projection, ordering, or limits only when the task needs them. Do not
invent operation IDs or hashes; the server creates them.

Alongside the call, briefly explain what was found and what each choice provides,
including coverage or compromises. Use concise option labels, not reasoning in
labels or column lists instead of an explanation. Wait for the user's choice and
the actual import result before claiming data is loaded or analyzing it.

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
