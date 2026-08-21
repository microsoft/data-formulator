---
name: data-loading
description: >-
   Discover connected data sources, add new data connectors through a
   user-confirmed form, inspect table metadata, and run bounded read-only probes
   when the current workspace data is insufficient.
when_to_use: >-
  The user's question needs data that is not already available as a workspace
   input, the user asks what connected data is available, or the user wants to
   connect a database, warehouse, or cloud source. Not for analyzing tables
   already listed in the workspace context.
always_on: false
tools:
   - summarize_data_sources
   - list_data
   - find_data
   - describe_data
   - probe_data
   - list_connectors
   - describe_connector
actions:
  - propose_data_operation
  - propose_connection
---

# Skill: Data discovery

The analysis input tables listed in your context are already materialized and
are the only data that can be read directly. Everything these tools return is
*not* loaded yet — it lives in a connected source and only becomes usable after
the user selects a loading option and the server materializes it.

Use these tools to determine whether connected sources contain data needed for
the user's goal. They are read-only: discovering, describing, or probing a
source does not add anything to the workspace analysis inputs.

## When nothing is loaded yet

Discovery is cheap. For a broad question such as “what data can I load?”, follow
this sequence before answering:

1. Call `summarize_data_sources({})` for a bounded overview of every connected source.
2. Summarize its hierarchy stats, top-level items, and sample tables directly.
3. Recommend concrete starting points. Use `list_data` or `find_data` only when
   deeper navigation or search is needed.

Use `list_data({source_id, path})` when the user wants to navigate a hierarchy,
and a queried `find_data` when they name a subject. Summary samples and top-level
items are bounded; respect their `omitted` counts.

Pick the path that fits:

- The user named a subject → `find_data`, then propose the tables that match.
- The user asked what data exists, or asked nothing specific → summarize every
   connected source using `summarize_data_sources`, then propose useful starting points.
- Nothing is connected → `list_connectors`, then `propose_connection`, or say
  they can upload a file.

Never use `ask_user` to ask which connected source to inspect for a broad
availability question. Summarize them all with one bounded call and answer directly.
Use `ask_user` only for a choice that remains necessary after discovery.

## Adding a connector

When the user wants to connect a new source, do not merely ask them to navigate
to settings and do not attempt to connect on their behalf.

1. Call `list_connectors` first because available built-ins and plugins vary by
   deployment. For a broad request such as "help me connect", summarize the
   concrete available types and ask which one they use.
2. Once the source type is known, call `describe_connector` when field or auth
   details are useful.
3. **When the requested source type is known and available, you MUST call
   `propose_connection` in this same turn.** Do not stop with text such as
   "I'll open the form", "you'll need to provide", or a list of required
   fields. Only the action opens the form. Include one or two helpful sentences
   alongside the action call explaining what the user should review or supply;
   this text appears above the chat while the form opens on the canvas. Pass
   `prefilled` values the user already supplied, including values parsed from a
   connection string or config snippet. Never invent missing values.
4. The form is only a proposal. The user reviews it and clicks Connect; the
   action must never connect automatically.

Prefilled values may include credentials the user deliberately supplied. Do not
repeat those values in prose or subsequent tool output. They are transient form
seeds and are removed from persisted UI state.

## Discovery sequence

1. Use `find_data` when the user names a business concept or table. Use
   `list_data` when you need to browse available sources or hierarchy.
   `list_data` returns one level; `find_data` searches recursively and may omit
   `query` to enumerate folders or tables below an exact source path.
2. Use `describe_data` before relying on columns, types, row counts, or filter
   values. Pass the exact `source_id` and `table_key` returned by discovery.
3. Use `probe_data` only when metadata is insufficient to choose a useful
   bounded result. Probes are limited, read-only, and may be approximate.
4. First reconcile discoveries with every table in `[PRIMARY ANALYSIS INPUTS]`,
   `[OTHER ANALYSIS INPUTS]`, or `[ANALYSIS INPUT TABLES]`. If the needed data is
   already loaded, use or explain that analysis input instead of proposing it.
5. When there are genuinely missing useful alternatives, call
   `propose_data_operation` with one
   to three complete immutable plans. This pauses for the user's choice; it
   does not load data yet.

## Proposing loading options

Write your answer as **message text alongside the call** — that prose is what
the user reads, so it carries the whole answer. Do not put it in an action
field, and do not leave the call bare. Say what you went looking for, what you
actually found, and what each option would give them — enough that they can
choose without opening a single preview. Two to four sentences; more when the
options differ in ways that matter (grain, coverage, freshness, joins needed),
fewer when the choice is obvious. Name real tables and columns you saw during
discovery, and say plainly when an option is a compromise or when you'd pick one
yourself. Write it as you'd say it to a colleague, not as a schema summary.

- Each `option` is a complete alternative: a concise action label (2–6 words)
   and one or more tables. The labels are buttons, not sentences — the
   reasoning belongs in your message text. The application displays table
   previews separately, so don't list columns as a substitute for explaining.
- An option is one coherent choice: one or a group of tables that serve the same
   analysis, and leave out the ones that don't.
- Use only source IDs, table keys, columns, and values grounded by discovery.
- For a whole table, omit `query`. Use the optional raw-row query only when the
   request needs filters, projection, ordering, or an intentional limit. It uses
   the same `filters` / `columns` / `order_by` / `limit` vocabulary as
   `probe_data`, without aggregation.
- Do not invent operation IDs, plan IDs, or hashes. The server creates them.
- Never propose an exact connector query already represented by a workspace
   table. The server also enforces this using persisted load provenance.

## Grounding rules

- Never invent source IDs, table keys, columns, or category values.
- Prefer cached catalog discovery before a live probe.
- Treat probe rows as evidence for planning, not as analysis input data.
- Keep queries structured and bounded. Do not generate source-specific SQL.
- If a source is unavailable or permissions changed, report the tool result and
  ask the user for the needed connection or choose another source.