# Connector-Level Agent Tooling Interface

Status: **draft** — discussion doc, refining before implementation.
Owner: @chenwang
Scope:
- [py-src/data_formulator/data_loader/external_data_loader.py](../py-src/data_formulator/data_loader/external_data_loader.py) (the loader interface)
- [py-src/data_formulator/agents/agent_data_loading_chat.py](../py-src/data_formulator/agents/agent_data_loading_chat.py) (tools)
- [py-src/data_formulator/agents/context.py](../py-src/data_formulator/agents/context.py) (`handle_read_catalog_metadata` and friends)
- [py-src/data_formulator/data_connector.py](../py-src/data_formulator/data_connector.py) (live loader resolution)

Related: [32-data-loading-agent-navigation.md](32-data-loading-agent-navigation.md) (find/browse/inspect tools — cache-only), [13-unified-source-filters-plan.md](13-unified-source-filters-plan.md) (source-agnostic filter vocabulary), [14-unified-source-metadata-plan.md](14-unified-source-metadata-plan.md), [22-data-source-metadata-survey.md](22-data-source-metadata-survey.md).

---

## 1. Motivation

The data-loading agent stalls on large tables. Real symptom, verbatim from a session:

> Found the three requested Kusto tables under SampleMetrics. SQLServerLocation is tiny and safe to load fully. The two metrics tables are very large; **their column metadata is not synced, so I cannot safely add column filters or aggregations yet.** This plan loads only the platform-limited subset for exploration, not the full tables.

The agent did the right thing given what it can see — but what it can see is a **stale, column-less cache snapshot**. It has no way to look at the live source, so it can't build the filter/aggregation that would let a big table load safely. We route oversized tables into the chat precisely so the agent can narrow them down (design 25 / the size-routing work), and then the agent has no tool to actually do it.

The fix we want is **not** per-connector prompt tuning or one-off Kusto hacks. We want the agent to have **generic, connector-level tooling to interrogate any source**, so:

- A new loader gets useful agent behavior "for free" from base-class defaults.
- No loader needs bespoke agent glue or instance-specific tuning.
- The agent reasons about *any* source (SQL, Kusto, Mongo, Superset, blob, …) through one stable vocabulary.

This doc proposes what that interface looks like.

---

## 2. Where we are today

### 2.1 The loader interface already has live read methods

`ExternalDataLoader` is richer than the agent uses. Existing (mostly live) methods:

| Method | Live? | Returns |
|---|---|---|
| `list_tables(filter)` / `ls(path, filter)` | live | table enumeration |
| `catalog_hierarchy()` / `effective_hierarchy()` / `pinned_scope()` | pure | navigation shape |
| `get_metadata(path)` | **live** | columns, types, `row_count`, `sample_rows` |
| `get_column_types(source_table)` | **live** | source column types (widget hints) |
| `get_column_values(source_table, column, keyword, limit, offset)` | **live** | distinct values (default: empty) |
| `fetch_data_as_arrow(source_table, import_options)` | **live** | bounded rows w/ `columns`, `filters`, `source_filters`, `sort`, `size` |

### 2.2 The agent can't reach any of them

The three discovery tools are **cache-only** (design 32 made this an explicit non-goal: "No live connector calls during browse"):

- `list_data` / `find_data` → read `catalog_cache/<source>.json`.
- `describe_data` → [`handle_read_catalog_metadata`](../py-src/data_formulator/agents/context.py) just loads the cache entry and formats it. It never calls `get_metadata`.

`execute_python` runs in a sandbox with **no connector access** (pandas/duckdb over `scratch/` files only). So the agent's only live interaction with a source is indirect and after-the-fact.

### 2.3 Why the cache is column-less for the failing case

Cluster-wide Kusto browse (no pinned DB) runs `list_tables(fetch_columns=False)` on purpose — the bulk `.show database schema as json` per database across a whole cluster times out. So cluster-wide cache entries carry `row_count` + description but **no columns**. `describe_data` faithfully reports "not synced". This is the correct perf tradeoff for *browsing*; it's the wrong data for *the agent deciding how to filter*.

### 2.4 The load boundary: no raw queries — on purpose

`fetch_data_as_arrow` is deliberately constrained:

> Only source_table is supported (no raw query strings) to avoid security and dialect diversity issues across loaders.

This is a core principle we should preserve. **"Give the agent direct DB access" cannot mean "let the LLM emit raw SQL/KQL".** It must mean "give the agent a rich, structured, read-only capability vocabulary that each loader compiles to its own dialect."

---

## 3. Design principles

1. **Structured, not raw.** The agent expresses intent as structured operations (filter, project, group, aggregate, count, distinct, profile). Loaders compile to SQL/KQL/pipeline. No LLM-authored query text ever reaches a driver.
2. **Connector-level & generic.** Capabilities live on `ExternalDataLoader`. The agent never special-cases a source. One tool surface for all loaders.
3. **Native-first execution; shared building blocks, not a lowest-common-denominator default.** Each loader runs a probe the way its backend does it best — DB systems compile the query to their dialect and push it down to the source engine; file/object systems read-and-compute in an embedded engine (DuckDB) over the actual files. The base class supplies *reusable strategy building blocks* (a shared SQL compiler, a DuckDB read-and-compute helper) so a loader **picks a strategy** rather than hand-rolling one, and any loader in a known family (SQL, file) is useful for free. A bounded-sample fallback exists for the rare loader that can do neither, but it is explicit and advertises `approximate` — it is **never** the silent default. We do **not** ship the old "pull a local copy of N rows and re-aggregate a sample" behaviour as the universal path: it is approximate for large tables and wastes bandwidth pulling raw rows a real backend could have aggregated itself.
4. **Read-only & bounded.** Every capability is read-only, row/time/byte-capped, and time-limited. Reuse the `notruncation`-on-bounded-fetch pattern; never unbounded.
5. **Exactness is self-describing.** Every probe result carries an `exact` flag, so the agent (and UI) knows whether a number is source-exact or a bounded-sample approximation without a separate capability-negotiation step.
6. **Stay agentic — no cache write-back.** Probe/describe results live in the agent's conversation context and drive the current turn's reasoning; they are **not** persisted back into `catalog_cache`. The cache stays owned by the browse/sync path (design 14/32); the agent just reads live when it needs more than the cache holds. This keeps the two concerns cleanly separated and avoids merge/staleness conflicts.

---

## 4. Proposed interface: `describe` + `probe`

Two capabilities on `ExternalDataLoader`, both keyed by catalog `path` (the same list `get_metadata` already takes):

- **`describe(path)`** — schema/metadata (columns, types, `row_count`, a small `sample_rows`). Not a data query; it's the Phase-1 unblocker.
- **`probe(path, query)`** — a single bounded read expressed as a restricted **single-table Select–Project–Aggregate query** (SPJ *minus the join* — see §4.2). One function, one compiler per loader, covering count / distinct / sample / aggregate as degenerate shapes of the same object.

### 4.1 `describe(path)`
Live schema + sample. Thin wrapper over `get_metadata(path)` returning columns, types, `row_count`, and a small `sample_rows`. When the cache lacks columns (the reported failure), the agent calls this and gets the real schema back.

### 4.2 `probe(path, query)` — the SPJQ query object
A structured, read-only query over **one table**. It speaks the source-agnostic filter vocabulary from design 13 and expresses select (σ), project (π), and aggregate (γ) — deliberately **no join**. That "single-table only" restraint is what keeps it compilable across every backend and stops it degenerating into a raw-query hole.

```jsonc
{
  "path":       ["db", "table"],          // ONE table — no joins, no subqueries
  "filters":    [{"column": "...", "op": "EQ|NEQ|GT|GTE|LT|LTE|IN|ILIKE|BETWEEN|IS_NULL", "value": ...}], // σ
  "columns":    ["colA", "colB"],          // π  (projection; omit = all)
  "group_by":   ["region"],                // γ keys
  "aggregates": [{"op": "count|count_distinct|sum|avg|min|max", "column": "...", "as": "..."}], // γ metrics
  "order_by":   [{"column": "...", "dir": "asc|desc"}],
  "limit":      100                        // bounded, hard-capped
}
```

Everything the agent needs is a degenerate shape of this one object:

| Intent | Query shape |
|---|---|
| **sample** rows | no `group_by`, no `aggregates`, `limit=N` |
| **count** | `aggregates=[{op:count}]`, no `group_by` |
| **distinct values** (+ frequency) | `group_by=[c]`, `aggregates=[{op:count}]`, `order_by` desc |
| **profile / aggregate** | `group_by=[region]`, `aggregates=[sum(x), min(ts), max(ts)]` |
| **date range** | `aggregates=[{op:min,column:ts}, {op:max,column:ts}]` |

The **same** SPJQ object compiles to each backend's native form; **§5** details the per-backend execution strategies (native pushdown for DBs, read-and-compute for files, an explicit sample fallback).

Result payload: `{rows, columns, row_count?, exact: bool, compiled_note?}` — `exact=false` flags the rare sampled/approximate answer (Strategy C, §5.3).

`limit` is always **hard-capped server-side** (e.g. `min(limit, MAX_PROBE_ROWS)`) — not for correctness but to protect the agent's context window. We deliberately never return a large table for the LLM to parse, because those rows become input tokens on the next turn. The result message **always** states the cap so the agent knows it is looking at a capped preview, e.g. *"showing 50 of N rows (capped at 50 — use aggregate shapes or the load plan for the full table)"*. When `group_by`/`aggregates` reduce the result below the cap the note simply confirms the full grouped result fit; when the cap trims raw rows it also sets `exact=false`.

---

## 5. Execution strategies — native-first, per backend

A probe is **always compiled and executed against the backend that owns the data** — never by pulling a "local copy" of raw rows back to the app and re-aggregating a sample. `describe` stays a thin live wrapper over `get_metadata` (native `information_schema` / `.show schema` where a loader overrides it). `probe` runs with one of three strategies; the first two are exact and are the expected path, the third is an explicit, advertised fallback.

### 5.1 Strategy A — Native pushdown (DB systems)

Postgres, MySQL, MSSQL, BigQuery, Athena, **Kusto**, Mongo. The loader compiles the SPJQ object to its own dialect and executes it **on the source engine**:

- SQL family → `SELECT … WHERE … GROUP BY … ORDER BY … LIMIT` (shared compiler, dialect-specific quoting; alongside the existing `build_*_where_clause*` helpers).
- Kusto → `T | where … | summarize … by … | order by … | take …`.
- Mongo → single-collection pipeline `$match / $group / $sort / $limit`.

The source filters/groups/aggregates over the **whole** table using its own indexes and returns only the small result. Always `exact=true`. This is the path that fixes the large-Kusto-table motivation: a `summarize … by …` over the full table instead of a sample of the first N rows.

### 5.2 Strategy B — Read-and-compute (file / object systems)

Local folder, S3/blob, and other file-backed sources (parquet/csv/json). There's no query engine on the source, so "native" here means **hand the file(s) to an embedded analytical engine (DuckDB) and run the compiled SQL there** — letting DuckDB scan the file directly (`read_parquet('…')` / `read_csv_auto('…')`) with predicate & projection pushdown into the scan. Reading the file *is* the native operation for these sources, so this is **exact**, not a sample. Because DuckDB speaks SQL, the **same compiler as Strategy A** produces the query — only the `FROM` target differs (`read_parquet('…')` vs. a table name). This is the preferred implementation for file sources: DuckDB is faster and more correct than hand-rolling scans/aggregation in Python.

### 5.3 Strategy C — Bounded-sample (explicit fallback only)

For the rare loader that can neither push down nor cheaply read-and-compute (e.g. a thin API loader exposing only `fetch_data_as_arrow`), the base class offers `_probe_via_sample`: fetch a bounded set of rows and compute the SPJQ over that sample in DuckDB. This is `exact=false`, and the loader must **opt in** by overriding `probe` to call it. It is **not** a silent default — we add a proper native strategy in preference to leaning on it. The `exact` flag travels back to the agent so it can phrase a sampled number honestly.

### 5.4 Shared building blocks

So "each backend instantiates the probe arguments to best do computation" — but they don't each reinvent it:

- **SQL compiler** (one place): SPJQ → SQL with parameterized/escaped values and dialect quoting. Reused by every SQL DB (Strategy A) *and* the DuckDB read-and-compute path (Strategy B). This is the big reuse — one compiler, two families.
- **DuckDB engine helper**: point DuckDB at a loader's file(s), run the shared-compiled SQL, return Arrow. Serves the whole file/object family.
- **Kusto & Mongo** bring their own compilers (KQL / aggregation pipeline) but reuse the same SPJQ object and result payload.

A new SQL or file loader gets a working, exact probe by wiring into the matching mixin; only a genuinely new *kind* of backend needs a new compiler.

### 5.5 No separate capability negotiation

Earlier drafts advertised an `agent_capabilities()` map (`pushdown`/`approximate`/`unavailable`). That is redundant: the probe result already carries `exact` (true for Strategy A/B, false for the Strategy C sample), and a loader that hasn't opted into any strategy returns an `{error}` from the base `probe`. The agent reads the `exact` flag to caveat approximate numbers and treats an error as "probe unavailable, fall back to describe / the load plan" — no extra negotiation method to keep in sync. `probe` stays a concrete base method (not `@abstractmethod`) so third-party plugin loaders that predate it keep working; the default simply reports the source unsupported.

---

## 6. Agent integration

1. **Live loader resolution inside a tool call.** The agent stream runs inside the Flask request context, so `DataConnector._get_identity()` + `load_connectors(identity)` + the registry lookup (mirroring [`_resolve_connector_with_key`](../py-src/data_formulator/data_connector.py)) can turn `source_id → live loader` mid-turn. Factor a small helper so the agent/context layer isn't cache-only anymore.
2. **Two tools** thin-wrap the capabilities: `describe_data` (gains a live fallback — auto when the cached entry has no columns, capped to table nodes) and `probe_data(path, query)` (the single SPJQ probe). One query tool means fewer ways for the LLM to mis-select. Both the tool description and every result message make the row cap explicit — `probe_data` returns *at most N rows* and exists for inspection/reasoning, not bulk loading — so the agent understands it will never get a huge table dumped into its context and routes full-data needs through the load plan instead.
3. **Stay agentic — results are in-context only.** `describe`/`probe` results feed the agent's reasoning for the current turn; we do **not** write them back into `catalog_cache`. If a later turn needs fresh schema again it simply re-describes (cheap, bounded, budget-capped). The cache remains owned by the browse/sync path, so there's no merge-with-`sync_catalog_metadata` problem to solve.
4. **Prompt update.** Teach the probe→plan loop: `describe_data` for schema, `probe_data` (count / distinct / aggregate shapes) to size the slice and pick real filter values, then `propose_load_plan`. Reinforce "never guess columns/values — probe first" (the prompt already says this for the cache path).
5. **Shared query object with the load path.** `probe` *without* `group_by`/`aggregates` is the same select-project-limit shape `fetch_data_as_arrow` / `ingest_to_workspace` already consume via `import_options`. Converging them on one query object means the agent probes and loads with the *same* structure, and there's one compiler per loader serving both — a net simplification, not just a new tool.

---

## 7. Security & guardrails

- **Read-only.** No DDL/DML/writes; capabilities compile only to read queries. The raw-query ban stays.
- **Bounded everything.** Row caps, byte caps (`notruncation` only on a bounded shape), and per-call timeouts. Reuse `MAX_IMPORT_ROWS` conventions.
- **Per-turn probe budget.** Cap probe calls per turn to avoid a chatty agent hammering the source; return a "budget exhausted" signal.
- **Serialize non-parallel-safe clients.** Kusto's client mutates `self.kusto_database` per query — probes must serialize like batch import does.
- **Identity scoping.** Loader resolution goes through the same per-identity registry as imports; no cross-user leakage.
- **Injection surface.** Because the agent supplies *values*, not query text, values flow through the existing parameterized/escaped builders. Column/table identifiers validated against the (freshly probed) schema, not free-form.

---

## 8. Phasing

- **Phase 1 (unblock):** live `describe_data` fallback (`get_metadata`) — auto-fires when a table node's cached columns are missing. Fixes the reported failure with the smallest surface. Low risk, high value.
- **Phase 2 (probe — exact strategies first):** ship `probe_data` with the two exact strategies — the shared SQL compiler + Strategy A pushdown for the SQL family, and Strategy B read-and-compute (DuckDB over the files) for file/object sources. These cover the common cases correctly; no approximate default.
- **Phase 3 (remaining DB natives + fallback + prompt loop):** Kusto/Mongo `probe` compilers (KQL / pipeline) for exact source-side aggregation; the explicit bounded-sample fallback (Strategy C) for any loader that can do neither; probe→plan prompt loop.
- **Phase 4 (polish):** UI reuse of the probe `exact` flag for smart filter widgets; profile caching; approximate→exact upgrade hints.

---

## 9. Open questions

1. ~~**Tool granularity for the LLM:** one polymorphic tool vs. several named tools?~~ **Resolved:** one `probe_data` tool taking the SPJQ query object, plus `describe_data` for schema. Degenerate shapes cover count / distinct / sample / aggregate, so there's nothing extra to select between.
2. ~~**Auto vs. explicit live fallback in `describe_data`:** fire `get_metadata` automatically whenever columns are missing vs. require `live=true`?~~ **Resolved:** always auto — `describe_data` fires `get_metadata` automatically whenever a table node's cached columns are missing (one query per described table), no `live` flag. The per-turn probe budget (§7) caps runaway calls.
3. ~~**Where does the local-compute default run?** Loader process vs. the agent's DuckDB sandbox.~~ **Resolved — reframed:** there is no universal local-compute *default*. DB systems don't local-compute at all (Strategy A pushes down); file sources read-and-compute **inside the loader** via DuckDB over the actual files (Strategy B), and the rare sample fallback (Strategy C) also runs loader-side. Compute never happens in the agent's `scratch/` sandbox — connector concerns stay in the loader.
4. ~~**Cache write-back conflicts:** how to merge probed columns with a later full `sync_catalog_metadata`?~~ **Resolved — dropped:** we stay agentic and do not write probe results back to the cache (§3.6 / §6.3), so there's no merge conflict to manage.
5. ~~**Cost controls for metered sources** (BigQuery/Athena bytes-scanned): should `probe` require a dry-run byte estimate and refuse above a threshold?~~ **Resolved — not for now.** No dry-run byte estimate in v1; the row/time/byte caps (§7) already bound each probe. Revisit if a metered source proves expensive in practice.
6. ~~**Do we ever want a genuine escape hatch** (a vetted, read-only, sandboxed raw-query capability), gated behind a flag?~~ **Resolved — no.** No raw-query escape hatch, not even flagged. It reintroduces the raw-query risk §3.1 forbids, multiplies the per-dialect sandbox + cost-control burden (each backend has different ways to smuggle side effects / blow up cost), and isn't needed: `probe` covers single-table reads and joins/expressions go through DuckDB `execute_python` (§10). A genuine gap the structured vocabulary can't express is closed by adding a *typed* operator to `probe` (e.g. the date-bucketing follow-up), never by opening a raw hole.

---

## 10. Non-goals

- Raw LLM-authored SQL/KQL to drivers (violates §3.1). **No escape hatch, not even flagged** (§9.6): the per-dialect read-only-sandbox + cost-control burden outweighs the benefit, and typed `probe` operators + DuckDB `execute_python` cover the real needs.
- Reworking the post-load Data Agent (analysis side) — this is the loading agent only.
- Write/ingest changes — `ingest_to_workspace` / `fetch_data_as_arrow` load path is unchanged; `probe` is a read-only sibling that shares the same query shape.
- **Joins / multi-table probes** — `probe` is single-table by design (the "J" is dropped on purpose). Cross-table work is done by loading both tables and joining in DuckDB via `execute_python`.
- **Computed expressions / raw fragments in `probe` v1** — only bare columns + the fixed aggregate ops. (Date-bucketing like `bin(ts, 1d)` / `date_trunc` is the most likely early follow-up, added as a structured field, never as raw text.)
- Persistent agent "cwd" state — calls stay stateless with explicit `(source_id, path)` (consistent with design 32).
