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
3. **No handcuffing / no per-instance tuning.** The base class provides working default implementations built on primitives every loader already has (`fetch_data_as_arrow` + local compute). A brand-new loader is immediately useful; overriding is a *performance/pushdown* optimization, not a correctness requirement.
4. **Read-only & bounded.** Every capability is read-only, row/time/byte-capped, and time-limited. Reuse the `notruncation`-on-bounded-fetch pattern; never unbounded.
5. **Capability negotiation.** A loader advertises what it can push down so the agent (and UI) know what's cheap vs. approximate.
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

Compiles per loader:
- SQL family → `SELECT … WHERE … GROUP BY … ORDER BY … LIMIT` via a group-by/agg builder alongside the existing `build_*_where_clause*` helpers.
- Kusto → `T | where … | summarize … by … | order by … | take …`.
- Mongo → single-collection pipeline `$match / $group / $sort / $limit`.
- Superset → query API where available, else the default (§5).

Result payload: `{rows, columns, row_count?, exact: bool, compiled_note?}` — `exact=false` flags a sampled/approximate answer (see §5).

`limit` is always **hard-capped server-side** (e.g. `min(limit, MAX_PROBE_ROWS)`) — not for correctness but to protect the agent's context window. We deliberately never return a large table for the LLM to parse, because those rows become input tokens on the next turn. The result message **always** states the cap so the agent knows it is looking at a capped preview, e.g. *"showing 50 of N rows (capped at 50 — use aggregate shapes or the load plan for the full table)"*. When `group_by`/`aggregates` reduce the result below the cap the note simply confirms the full grouped result fit; when the cap trims raw rows it also sets `exact=false`.

---

## 5. Default implementations (why nobody is handcuffed)

Two defaults on the base class, so a loader that only implements `fetch_data_as_arrow` still answers both capabilities:

| Capability | Base default | Override for pushdown |
|---|---|---|
| `describe` | `get_metadata(path)` (already default-implemented via `ls`) | native `information_schema` / `.show schema` |
| `probe` | push `filters`+`columns`+`limit` down through `fetch_data_as_arrow` (already supported), then apply `group_by`/`aggregates`/`order_by` in DuckDB **server-side, inside the loader**; set `exact=false` if the fetch cap was hit | compile the whole query to `GROUP BY` / `summarize` / `$group` for exact, source-side results |

Because `probe` *without* `group_by`/`aggregates` is just `filters`+`columns`+`limit`, it maps **directly** onto what `fetch_data_as_arrow` already does — so the `sample`/`count` shapes are correct for every existing loader with near-zero new code, and the `aggregate` shape works everywhere via the DuckDB default until a loader opts into pushdown.

The `exact` flag travels back to the agent so it knows when a number is authoritative vs. sampled and can phrase its plan honestly.

SQL loaders share one compiler (they already share `build_*_where_clause*`), so pushdown for Postgres/MySQL/MSSQL/Athena/BigQuery is largely one mixin, not five copies.

### 5.1 Capability advertisement

```python
def agent_capabilities(self) -> dict[str, str]:
    # "pushdown" | "approximate" | "unavailable"
    return {"describe": "pushdown", "probe": "pushdown"}
```

`probe: "approximate"` means the loader falls back to the DuckDB default (bounded sample → local compute); `"pushdown"` means exact, source-side. The agent uses this to caveat approximate answers; the UI can reuse it later (e.g. filter widgets).

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
- **Phase 2 (probe, default only):** ship `probe_data` with the DuckDB default (works for every loader). The agent can size a slice, sample under a filter, and pick real values via degenerate query shapes (count / sample / distinct).
- **Phase 3 (pushdown + full aggregate):** SQL compiler mixin + Kusto/Mongo `probe` overrides for exact, source-side `group_by`/aggregates; capability advertisement; probe→plan prompt loop.
- **Phase 4 (polish):** UI reuse of `agent_capabilities` for smart filter widgets; profile caching; approximate→exact upgrade hints.

---

## 9. Open questions

1. ~~**Tool granularity for the LLM:** one polymorphic tool vs. several named tools?~~ **Resolved:** one `probe_data` tool taking the SPJQ query object, plus `describe_data` for schema. Degenerate shapes cover count / distinct / sample / aggregate, so there's nothing extra to select between.
2. ~~**Auto vs. explicit live fallback in `describe_data`:** fire `get_metadata` automatically whenever columns are missing vs. require `live=true`?~~ **Resolved:** always auto — `describe_data` fires `get_metadata` automatically whenever a table node's cached columns are missing (one query per described table), no `live` flag. The per-turn probe budget (§7) caps runaway calls.
3. ~~**Where does the local-compute default run?** Loader process vs. the agent's DuckDB sandbox.~~ **Resolved:** loader-side. The DuckDB default runs inside the loader process, keeping connector concerns out of the agent and avoiding shipping rows into `scratch/`.
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
