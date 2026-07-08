# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Conversational data loading agent.

General-purpose conversational agent that can:
- Extract tables from images / text / files
- Execute Python code in a sandboxed environment
- Show inline table previews
- Prepare tables for user-confirmed loading
"""

import io
import json
import logging
import os
import re

import pandas as pd

from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.agent_utils import accumulate_reasoning_content
from data_formulator.datalake.parquet_utils import df_to_safe_records

logger = logging.getLogger(__name__)

_AGENT_ID = "data_loading_chat"

# Max live probe_data calls allowed per user turn (design 37 §7).
PROBE_TURN_BUDGET = 20


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a data assistant helping users load and prepare data for analysis in Data Formulator.

Tools available:
- read_file / write_file / list_directory — workspace filesystem (scratch/ uploads)
- execute_python — run Python (pandas, numpy, DuckDB). All DataFrames are auto-saved to scratch/.
- list_data — browse the catalog hierarchy of connected sources (cache-only, fast)
- find_data — regex search across cached catalogs (names, descriptions, columns)
- describe_data — read full metadata (schema, columns, row count) for one table
- probe_data — run a bounded read on one table (count / distinct values / aggregate / sample) to size a slice and pick real filter values. Returns at most a few hundred rows — for inspection, NOT bulk loading.
- show_user_data_preview — show interactive table preview with Load button (for execute_python results or extracted tables only)
- propose_load_plan — propose a multi-table loading plan for user confirmation

CRITICAL: You MUST call the show_user_data_preview tool to show data. Do NOT just describe data in text.

Three workflows:

**Workflow 1 — Uploaded file or code processing:**
1. Inspect files with read_file/list_directory
2. Process with execute_python (DataFrames auto-saved to scratch/)
3. Call show_user_data_preview(saved_dfs=["df_name"])

**Workflow 2 — Unstructured text or image extraction:**
1. Extract table into CSV format
2. Call show_user_data_preview(tables=[{{"name": "...", "data": "col1,col2\\n..."}}])

**Workflow 3 — Find and load data from connected sources (including sample datasets):**
1. Call find_data(query="...") to search. The query is a case-insensitive regex —
   use alternation for synonyms ("orders|sales|revenue"), anchors ("^fact_"), word
   boundaries ("\\border\\b"), or optional groups ("customers?") when helpful. Escape
   "." if you mean a literal dot. Pass exclude="_staging|_test" to drop noise.
   When search is ambiguous, restrict with scope="<source_id>" or
   scope="<source_id>:<path/segments>".
2. If find_data returns nothing useful or is ambiguous, fall back to list_data:
   - list_data() → which sources exist
   - list_data(source_id="...") → top-level folders / tables
   - list_data(source_id, path=[...]) → drill in
   - Pass filter="..." (plain substring, not regex) when a directory has many entries.
   Responses are capped at 200 entries; if truncated:true, narrow with filter or
   switch back to find_data with a scope.
3. For EACH promising not-imported table, call describe_data(source_id, table_key)
   to inspect columns and understand available values.
4. Based on column metadata, decide which columns to filter on and what values to use.
   When a table is large, or you need real filter values / a sense of the data before
   committing, call probe_data(source_id, table_key, query=...) — a bounded read that
   returns count / distinct values / aggregates / a small sample. Use it to pick REAL
   filter values instead of guessing. It returns at most a few hundred rows; for the
   full table use propose_load_plan, never probe_data.
5. Call propose_load_plan(candidates=[...], reasoning="...") — the UI shows a
   confirmation card.
6. Keep your text brief after propose_load_plan. The UI handles the rest.

Workflow selection rubric (apply in order):
- User pasted/uploaded data, attached an image, or asked to process scratch files → Workflow 1 or 2.
- User asked "what data do you have / what's available / which sources are connected" → call
  list_data() — it returns the per-source summary. Drill in with list_data(source_id, ...).
  Do NOT rely solely on the summary below; it only shows counts.
- Otherwise, if connected data sources are listed below AND the user is describing data they want
  to analyze (an entity, metric, time range, region, product, demo data, etc.) → start with
  Workflow 3. Try regex variants (English + the user's language, synonyms, table-name fragments,
  folder names) with find_data before giving up. The built-in 'sample_datasets' source is
  included automatically.
- Only fall back to synthetic data after Workflow 3 returned no plausible matches.

Rules:
- After show_user_data_preview or propose_load_plan, keep text VERY brief. The UI shows the preview automatically.
- show_user_data_preview is ONLY for: (a) DataFrames you actually produced with execute_python via saved_dfs=, or (b) tables you literally extracted from a user-provided image or pasted text via tables=. NEVER use show_user_data_preview(tables=...) to narrate, describe, or invent contents of a connector-sourced table. To load ANY table from a connected source (including sample_datasets), you MUST use propose_load_plan.
- For sample datasets, NEVER use execute_python or write_file to recreate them — use Workflow 3.
- execute_python auto-saves ALL DataFrames created in code.
- In propose_load_plan, always pass source_id and table_key exactly from find_data/describe_data. If propose_load_plan returns an error listing valid source_ids, re-run find_data with a better query and retry — do NOT guess IDs.
- Do NOT set row_limit in propose_load_plan; the system applies the user's configured global limit automatically.

Filter rules for propose_load_plan:
- You MUST call describe_data BEFORE proposing filters. Do NOT guess column names or values.
- Use the column names exactly as returned by describe_data. Do NOT invent column names.
- Filter values must be plain values without SQL wildcards. WRONG: "%奔图%". CORRECT: "奔图".
- For partial text matching, use operator ILIKE — the backend adds wildcards automatically.
- For exact matching of a known category value, use operator EQ.
- Preferred operators: EQ (exact match), ILIKE (contains text), IN (multiple values), GT/LT/GTE/LTE (numeric/date ranges), BETWEEN (date ranges).
- Do NOT use LIKE with manually added % wildcards. Always use ILIKE for text search — it is case-insensitive and auto-wildcarded.
- If you are unsure about the exact filter value, prefer ILIKE over EQ for text columns.

Current date and time: {current_time}
Currently loaded workspace tables: {table_names}
Connected data sources:
{connector_summary}

IMPORTANT:
- When extracting tables: clean column names, remove units from values (note in headers), flatten multi-level headers.
- Synthetic data: 20-30 rows default, no implicit bias.
"""

# ---------------------------------------------------------------------------
# Tool definitions (OpenAI function calling format)
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file from the workspace. Files in scratch/ are user uploads. Use max_lines to preview large files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path within workspace (e.g. scratch/data.csv)",
                    },
                    "max_lines": {
                        "type": "integer",
                        "description": "Optional: only return first N lines",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write a file to scratch/. Use for saving transformed or intermediate data.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Plain filename only, no path separators (e.g. 'sales.csv'). Will be sanitized and saved under scratch/.",
                    },
                    "content": {
                        "type": "string",
                        "description": "File content",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "List files in a workspace directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path (default: workspace root)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_python",
            "description": (
                "Run Python code in a sandbox with pandas, numpy, DuckDB. "
                "Workspace tables are in data/ as parquet. "
                "All DataFrame variables created in code are AUTO-SAVED to scratch/ as CSV. "
                "The result includes saved_dataframes listing them — use those names in show_user_data_preview."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python code to execute",
                    },
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_data",
            "description": (
                "Browse the catalog of connected data sources. Cache-only, fast.\n"
                "- No args: per-source summary (source_id, table_count, is_hierarchical).\n"
                "- source_id only: top-level entries (folders with table counts, plus root tables).\n"
                "- source_id + path: direct children at that hierarchy level.\n"
                "- filter: case-insensitive substring on the next path segment / table name (no regex here).\n"
                "Workspace tables are already in the system prompt and are not repeated."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "Data source identifier. Omit for source-level summary."},
                    "path": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Hierarchy path as an array of segments (e.g. ['sales', 'fy26']).",
                    },
                    "filter": {"type": "string", "description": "Substring filter on the next path segment / table name."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_user_data_preview",
            "description": (
                "Show interactive table preview(s) with Load button. Two modes (use exactly one):\n"
                "1. saved_dfs: reference DataFrames auto-saved by execute_python (by variable name)\n"
                "2. tables: inline CSV data for direct extraction from text/images\n"
                "For tables in a connected source (including sample_datasets), use propose_load_plan instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "saved_dfs": {
                        "type": "array",
                        "description": "DataFrame variable names from execute_python (e.g. ['df_clean', 'df_summary'])",
                        "items": {"type": "string"},
                    },
                    "tables": {
                        "type": "array",
                        "description": "Inline CSV tables for direct text/image extraction",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Table name"},
                                "data": {"type": "string", "description": "CSV-formatted data"},
                            },
                            "required": ["name", "data"],
                        },
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_data",
            "description": (
                "Regex search across cached catalogs for tables matching a query. "
                "Searches table names, table descriptions, column names, and column descriptions.\n"
                "- query: case-insensitive regex. Plain keywords work as literals; use alternation "
                "(orders|sales|revenue), anchors (^fact_), word boundaries (\\border\\b), and optional "
                "groups (customers?) when useful. Escape . if you mean a literal dot.\n"
                "- scope: 'all' (default), 'workspace', 'connected', '<source_id>', or '<source_id>:<path>' "
                "to restrict to a subtree (path is /-joined segments).\n"
                "- exclude: optional regex on table name to drop hits (e.g. '_staging|_test').\n"
                "- fields: subset of ['name','description','columns'] to restrict matching; default is all."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Case-insensitive regex."},
                    "scope": {"type": "string", "description": "Search scope. Default: all"},
                    "exclude": {"type": "string", "description": "Optional regex; drops hits whose name matches."},
                    "fields": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["name", "description", "columns"]},
                        "description": "Restrict matching to these fields. Default: all.",
                    },
                    "limit": {"type": "integer", "description": "Max results. Default 50, max 200."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "describe_data",
            "description": "Read full metadata (columns, types, description, row count) for one table. Use source_id + table_key from find_data results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "Data source identifier"},
                    "table_key": {"type": "string", "description": "Table key within the source"},
                },
                "required": ["source_id", "table_key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "probe_data",
            "description": (
                "Run a bounded, read-only query on ONE connected-source table to size a slice and "
                "pick REAL filter values before proposing a load. Single-table only (no joins). "
                "Returns at MOST a few hundred rows — this is for inspection/reasoning, NOT bulk "
                "loading (use propose_load_plan for full data). Call describe_data first so you use "
                "exact column names.\n"
                "The query is a structured object; common shapes:\n"
                "- count rows: {\"aggregates\": [{\"op\": \"count\"}]}\n"
                "- distinct values + frequency: {\"group_by\": [\"region\"], \"aggregates\": [{\"op\": \"count\", \"as\": \"n\"}], \"order_by\": [{\"column\": \"n\", \"dir\": \"desc\"}], \"limit\": 50}\n"
                "- date range: {\"aggregates\": [{\"op\": \"min\", \"column\": \"ts\", \"as\": \"lo\"}, {\"op\": \"max\", \"column\": \"ts\", \"as\": \"hi\"}]}\n"
                "- sample rows under a filter: {\"filters\": [{\"column\": \"region\", \"op\": \"EQ\", \"value\": \"West\"}], \"limit\": 20}\n"
                "- aggregate: {\"group_by\": [\"region\"], \"aggregates\": [{\"op\": \"sum\", \"column\": \"revenue\", \"as\": \"total\"}]}\n"
                "If the result is marked exact:false, it was computed over a bounded sample — treat counts as approximate."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "Data source identifier"},
                    "table_key": {"type": "string", "description": "Table key within the source"},
                    "query": {
                        "type": "object",
                        "description": "SPJQ query object over the single table.",
                        "properties": {
                            "filters": {
                                "type": "array",
                                "description": "Row filters (AND-combined).",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "column": {"type": "string"},
                                        "op": {"type": "string", "enum": ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "ILIKE", "BETWEEN", "IS_NULL"]},
                                        "value": {"description": "Scalar; array for IN/BETWEEN; omit for IS_NULL."},
                                    },
                                    "required": ["column", "op"],
                                },
                            },
                            "columns": {"type": "array", "items": {"type": "string"}, "description": "Projection (omit = all columns)."},
                            "group_by": {"type": "array", "items": {"type": "string"}, "description": "Group-by keys."},
                            "aggregates": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "op": {"type": "string", "enum": ["count", "count_distinct", "sum", "avg", "min", "max"]},
                                        "column": {"type": "string", "description": "Required except for op=count."},
                                        "as": {"type": "string", "description": "Output column alias."},
                                    },
                                    "required": ["op"],
                                },
                            },
                            "order_by": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "column": {"type": "string"},
                                        "dir": {"type": "string", "enum": ["asc", "desc"]},
                                    },
                                    "required": ["column"],
                                },
                            },
                            "limit": {"type": "integer", "description": "Max rows (hard-capped server-side)."},
                        },
                    },
                },
                "required": ["source_id", "table_key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_load_plan",
            "description": "Propose a data loading plan for the user to confirm. The UI will show an interactive card with checkboxes and a Load button. Use ONLY for connected data source tables (not workspace/sample).",
            "parameters": {
                "type": "object",
                "properties": {
                    "candidates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_id": {"type": "string"},
                                "table_key": {"type": "string"},
                                "display_name": {"type": "string"},
                                "source_table": {"type": "string", "description": "Optional legacy import id. Prefer source_id + table_key; the backend resolves the real import id."},
                                "filters": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "column": {"type": "string"},
                                            "operator": {"type": "string"},
                                            "value": {"description": "Filter value. BETWEEN/IN may use an array."},
                                        },
                                    },
                                },
                                "sort_by": {"type": "string"},
                                "sort_order": {"type": "string", "enum": ["asc", "desc"]},
                            },
                            "required": ["source_id", "table_key", "display_name"],
                        },
                    },
                    "reasoning": {"type": "string", "description": "Brief explanation of why these tables are recommended"},
                },
                "required": ["candidates"],
            },
        },
    },
]


def _secure_filename(name: str) -> str:
    """Sanitise a user-supplied filename to prevent path traversal."""
    # Strip directory separators and null bytes
    name = re.sub(r'[/\\:\x00]', '_', name)
    # Remove leading dots (hidden files / parent traversal)
    name = name.lstrip('.')
    # Fallback
    return name or "unnamed"



def _summarize_catalog_shape(tables: list[dict]) -> tuple[int, int]:
    """Return ``(table_count, distinct_folder_count)`` for a catalog.

    Folder count is 0 when no table has a hierarchical ``path`` (depth >= 2);
    flat catalogs report 0 folders so the summary stays terse.
    """
    folders: set[str] = set()
    any_hierarchy = False
    for t in tables:
        path = t.get("path") or []
        if isinstance(path, list) and len(path) >= 2:
            any_hierarchy = True
            folders.add(str(path[0]))
    return len(tables), (len(folders) if any_hierarchy else 0)


def _build_connector_summary_block(
    user_home,
    *,
    max_total_chars: int = 1200,
) -> str:
    """Render a compact directory of cached connector catalogs.

    Only shows source IDs with table counts (and folder counts when the
    catalog is hierarchical). The agent is expected to call ``list_data``
    for full inventory.
    Strictly hard-capped at ``max_total_chars``.
    """
    if not user_home:
        return "  none"
    try:
        from pathlib import Path

        from data_formulator.datalake.catalog_cache import list_cached_sources, load_catalog
    except Exception:
        logger.debug("connector summary: imports failed", exc_info=True)
        return "  none"

    try:
        source_ids = list_cached_sources(user_home)
    except Exception:
        logger.debug("connector summary: list_cached_sources failed", exc_info=True)
        return "  none"

    if not source_ids:
        return "  none"

    user_home_path = Path(user_home)
    lines: list[str] = []
    for sid in sorted(source_ids):
        try:
            tables = load_catalog(user_home_path, sid) or []
        except Exception:
            logger.debug("connector summary: load_catalog failed for %s", sid, exc_info=True)
            tables = []
        n, k = _summarize_catalog_shape(tables)
        if n == 0:
            lines.append(f"- {sid}: 0 tables cached")
        elif k > 0:
            lines.append(
                f"- {sid}: {n} table{'s' if n != 1 else ''} "
                f"across {k} folder{'s' if k != 1 else ''}"
            )
        else:
            lines.append(f"- {sid}: {n} table{'s' if n != 1 else ''}")

    lines.append(
        "  (call list_data() for sources, list_data(source_id, ...) to drill, "
        "or find_data(query=...) to search)"
    )

    output = "\n".join(lines)
    if len(output) > max_total_chars:
        output = output[:max_total_chars].rstrip() + "\n  ... (truncated)"
    return output


class DataLoadingAgent:
    """Conversational agent for data loading and extraction."""

    def __init__(self, client, workspace, available_datasets=None, language_instruction="", knowledge_store=None, row_limit=None):
        self.client = client
        self.workspace = workspace
        self.available_datasets = available_datasets or []
        self.language_instruction = language_instruction
        self._knowledge_store = knowledge_store
        self.row_limit = row_limit or 2_000_000

    # ------------------------------------------------------------------
    # Main streaming entry point
    # ------------------------------------------------------------------

    def stream(self, messages):
        """Stream a conversation turn. Yields SSE event dicts.

        Parameters
        ----------
        messages : list[dict]
            Chat history in the format:
            [{"role": "user", "content": "...", "attachments": [...]}, ...]
        """
        last_user_text = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                last_user_text = str(msg.get("content", ""))
                break
        system_prompt = self._build_system_prompt(last_user_text)
        llm_messages = [{"role": "system", "content": system_prompt}]

        # Per-turn probe budget (design 37 §7): bound live probe_data calls so a
        # chatty model can't hammer the source within a single turn.
        self._probe_budget = PROBE_TURN_BUDGET

        # Convert chat messages to LLM format
        for msg in messages:
            llm_messages.append(self._convert_message(msg))

        collected_text = []
        actions = []
        max_iterations = 10  # safety limit for agentic loop

        from data_formulator.sandbox.local_sandbox import SandboxSession
        with SandboxSession() as sandbox_session:
            self._sandbox_session = sandbox_session
            yield from self._agentic_loop(
                llm_messages, collected_text, actions, max_iterations,
            )
            self._sandbox_session = None

        # Emit structured actions (if any)
        if actions:
            yield {"type": "actions", "actions": actions}

        # Emit done event
        yield {"type": "done", "full_text": "".join(collected_text)}

    def _agentic_loop(self, llm_messages, collected_text, actions, max_iterations):
        """Inner loop extracted so stream_chat can wrap it in a SandboxSession."""
        for _iteration in range(max_iterations):
            # Call LLM with tool definitions
            try:
                response = self._call_llm(llm_messages, stream=True)
            except Exception as e:
                logger.error(f"LLM call failed: {e}")
                yield {"type": "text_delta", "content": f"\n\nError calling model: {e}"}
                break

            # Accumulate streaming response
            tool_calls_acc = {}  # id -> {name, arguments_str}
            current_text = []
            accumulated_reasoning = None
            finish_reason = None

            for chunk in response:
                if not hasattr(chunk, 'choices') or len(chunk.choices) == 0:
                    continue

                delta = chunk.choices[0].delta
                finish_reason = chunk.choices[0].finish_reason

                # Accumulate reasoning_content (DeepSeek V4 reasoning models)
                accumulated_reasoning = accumulate_reasoning_content(
                    accumulated_reasoning, delta
                )

                # Stream text tokens
                if hasattr(delta, 'content') and delta.content:
                    collected_text.append(delta.content)
                    current_text.append(delta.content)
                    yield {"type": "text_delta", "content": delta.content}

                # Accumulate tool calls
                if hasattr(delta, 'tool_calls') and delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {
                                "id": getattr(tc_delta, 'id', None) or f"call_{idx}",
                                "name": "",
                                "arguments": "",
                            }
                        if hasattr(tc_delta, 'id') and tc_delta.id:
                            tool_calls_acc[idx]["id"] = tc_delta.id
                        if hasattr(tc_delta.function, 'name') and tc_delta.function.name:
                            tool_calls_acc[idx]["name"] = tc_delta.function.name
                        if hasattr(tc_delta.function, 'arguments') and tc_delta.function.arguments:
                            tool_calls_acc[idx]["arguments"] += tc_delta.function.arguments

            # If no tool calls, the LLM is done
            if not tool_calls_acc:
                break

            # Build assistant message with tool calls for LLM context
            assistant_msg = {"role": "assistant", "content": "".join(current_text) or None}
            if accumulated_reasoning is not None:
                assistant_msg["reasoning_content"] = accumulated_reasoning
            assistant_msg["tool_calls"] = []
            for idx in sorted(tool_calls_acc.keys()):
                tc = tool_calls_acc[idx]
                assistant_msg["tool_calls"].append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": tc["arguments"],
                    },
                })
            llm_messages.append(assistant_msg)

            # Execute each tool call
            for idx in sorted(tool_calls_acc.keys()):
                tc = tool_calls_acc[idx]
                tool_name = tc["name"]
                try:
                    tool_args = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    tool_args = {}

                # Emit tool start event
                yield {
                    "type": "tool_start",
                    "tool": tool_name,
                    "code": tool_args.get("code"),
                    "args": tool_args,
                }

                # Execute the tool
                result = self._execute_tool(tool_name, tool_args)

                # Emit tool result event
                yield {"type": "tool_result", "tool": tool_name, **result}

                # Collect actions from tool results
                if result.get("actions"):
                    actions.extend(result["actions"])

                # Append tool result to LLM messages for context
                # Strip heavy data (sample_rows) to keep context small
                # and prevent the LLM from narrating the data
                llm_result = {k: v for k, v in result.items() if k != 'actions'}
                if 'actions' in result:
                    # Summarize actions for LLM context
                    action_summaries = []
                    for a in result['actions']:
                        summary = {"type": a.get("type"), "name": a.get("name")}
                        if a.get("columns"):
                            summary["columns"] = a["columns"][:5]
                        if a.get("total_rows"):
                            summary["total_rows"] = a["total_rows"]
                        if a.get("tables"):
                            summary["tables"] = [
                                {"columns": t.get("columns", [])[:5], "total_sample_rows": t.get("total_sample_rows")}
                                for t in a["tables"]
                            ]
                        action_summaries.append(summary)
                    llm_result["actions_summary"] = action_summaries
                    llm_result["note"] = "The UI is showing an interactive preview with Load buttons. Do NOT re-describe the data."
                llm_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(llm_result, default=str),
                })

            # Loop back for LLM to generate follow-up text

    # ------------------------------------------------------------------
    # LLM call with tool support
    # ------------------------------------------------------------------

    def _call_llm(self, messages, stream=True):
        """Call the LLM with tool definitions."""
        return self.client.get_completion_with_tools(
            messages, tools=TOOLS, stream=stream, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model),
        )

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------

    def _execute_tool(self, name, args):
        """Execute a tool and return result dict."""
        workspace_jail = self.workspace.confined_root
        scratch_jail = self.workspace.confined_scratch

        if name == "read_file":
            return self._tool_read_file(args, workspace_jail)
        elif name == "write_file":
            return self._tool_write_file(args, scratch_jail)
        elif name == "list_directory":
            return self._tool_list_directory(args, workspace_jail)
        elif name == "execute_python":
            return self._tool_execute_python(args)
        elif name == "show_user_data_preview":
            return self._tool_show_user_data_preview(args, scratch_jail)
        elif name == "list_data":
            return self._tool_list_data(args)
        elif name == "find_data":
            return self._tool_find_data(args)
        elif name == "describe_data":
            return self._tool_describe_data(args)
        elif name == "probe_data":
            return self._tool_probe_data(args)
        elif name == "propose_load_plan":
            return self._tool_propose_load_plan(args)
        else:
            return {"error": f"Unknown tool: {name}"}

    def _tool_read_file(self, args, workspace_jail):
        """Read a file from workspace, confined to workspace directory."""
        rel_path = args.get("path", "")
        try:
            target = workspace_jail.resolve(rel_path)
        except ValueError:
            return {"error": "Access denied: path outside workspace"}

        if not target.exists():
            return {"error": f"File not found: {rel_path}"}
        if not target.is_file():
            return {"error": f"Not a file: {rel_path}"}

        try:
            content = target.read_text(encoding="utf-8", errors="replace")
            max_lines = args.get("max_lines")
            if max_lines:
                lines = content.splitlines()
                content = "\n".join(lines[:max_lines])
                if len(lines) > max_lines:
                    content += f"\n... ({len(lines) - max_lines} more lines)"
            if len(content) > 50000:
                content = content[:50000] + "\n... (truncated)"
            return {"content": content}
        except Exception as e:
            return {"error": f"Failed to read file: {e}"}

    def _tool_write_file(self, args, scratch_jail):
        """Write a file to scratch directory."""
        filename = _secure_filename(args.get("path", "output.txt"))
        try:
            target = scratch_jail.resolve(filename)
        except ValueError:
            return {"error": "Access denied: invalid filename"}
        content = args.get("content", "")

        try:
            target.write_text(content, encoding="utf-8")
            return {"path": f"scratch/{filename}", "size": len(content)}
        except Exception as e:
            return {"error": f"Failed to write file: {e}"}

    def _tool_list_directory(self, args, workspace_jail):
        """List files in a workspace directory."""
        rel_path = args.get("path") or ""
        try:
            target = workspace_jail.resolve(rel_path) if rel_path else workspace_jail.root
        except ValueError:
            return {"error": "Access denied: path outside workspace"}

        if not target.exists() or not target.is_dir():
            return {"error": f"Directory not found: {rel_path}"}

        try:
            entries = [
                f.name + ("/" if f.is_dir() else "")
                for f in sorted(target.iterdir())
                if not f.name.startswith(".")  # skip hidden files
            ]
            return {"entries": entries}
        except Exception as e:
            return {"error": f"Failed to list directory: {e}"}

    def _tool_execute_python(self, args):
        """Execute Python code in sandbox. Auto-saves all DataFrames to scratch/."""
        code = args.get("code", "")
        if not code.strip():
            return {"error": "No code provided"}

        try:
            # Wrap code: capture stdout, collect ALL DataFrame variables
            capture_code = (
                "import io as _io, sys as _sys, pandas as _pd\n"
                "_old_stdout = _sys.stdout\n"
                "_sys.stdout = _captured = _io.StringIO()\n"
                "\n"
                f"{code}\n"
                "\n"
                "_sys.stdout = _old_stdout\n"
                "# Collect all user-created DataFrames\n"
                "_dfs = {k: v for k, v in locals().items()\n"
                "        if isinstance(v, _pd.DataFrame) and not k.startswith('_')}\n"
                "_pack = {\n"
                "    'stdout': _captured.getvalue(),\n"
                "    'dataframes': {k: v for k, v in _dfs.items()},\n"
                "}\n"
            )

            with self.workspace.local_dir() as local_path:
                import os as _os
                workspace_path = _os.path.abspath(str(local_path))
                allowed_objects = {"_pack": None}

                session = getattr(self, "_sandbox_session", None)
                if session is not None:
                    raw = session.execute(capture_code, allowed_objects, workspace_path)
                else:
                    from data_formulator.sandbox import create_sandbox
                    sandbox = create_sandbox("local")
                    raw = sandbox._run_in_warm_subprocess(
                        capture_code, allowed_objects, workspace_path
                    )

            if raw["status"] == "ok":
                pack = raw["allowed_objects"].get("_pack", {})
                stdout_text = pack.get("stdout", "") if isinstance(pack, dict) else ""
                dfs = pack.get("dataframes", {}) if isinstance(pack, dict) else {}

                response: dict = {
                    "stdout": str(stdout_text) if stdout_text else "",
                    "error": None,
                }

                scratch_jail = self.workspace.confined_scratch
                saved = {}
                for name, df in dfs.items():
                    if isinstance(df, pd.DataFrame):
                        safe_name = _secure_filename(name)
                        csv_path = scratch_jail.resolve(f"{safe_name}.csv")
                        df.to_csv(csv_path, index=False)
                        saved[name] = {
                            "path": f"scratch/{safe_name}.csv",
                            "rows": len(df),
                            "columns": list(df.columns),
                            "preview": df_to_safe_records(df.head(3)),
                        }

                if saved:
                    response["saved_dataframes"] = saved

                return response
            else:
                return {
                    "stdout": "",
                    "error": raw.get("error_message", raw.get("content", "Unknown error")),
                }

        except Exception as e:
            logger.error("execute_python failed", exc_info=e)
            return {"stdout": "", "error": "Code execution failed"}

    def _tool_show_user_data_preview(self, args, scratch_jail):
        """Unified data preview. To load from a connected source (including
        the built-in 'sample_datasets'), use propose_load_plan instead."""
        saved_dfs = args.get("saved_dfs")
        tables = args.get("tables")

        if saved_dfs:
            return self._preview_saved_dfs(saved_dfs, scratch_jail)
        elif tables:
            return self._preview_inline_tables(tables, scratch_jail)
        else:
            return {"error": "Provide one of: saved_dfs or tables. For connected-source tables (including sample_datasets), use propose_load_plan."}

    def _preview_saved_dfs(self, df_names, scratch_jail):
        """Preview DataFrames auto-saved by execute_python."""
        actions = []

        for name in df_names:
            safe_name = _secure_filename(name)
            try:
                csv_path = scratch_jail.resolve(f"{safe_name}.csv")
            except ValueError:
                actions.append({"type": "preview_table", "name": name, "error": "Access denied: invalid name"})
                continue

            if not csv_path.exists():
                actions.append({"type": "preview_table", "name": name,
                                "error": f"No saved DataFrame '{name}'. Run execute_python first."})
                continue

            try:
                df = pd.read_csv(csv_path)
                actions.append({
                    "type": "preview_table",
                    "name": name,
                    "columns": list(df.columns),
                    "sample_rows": df_to_safe_records(df.head(5)),
                    "total_rows": len(df),
                    "csv_scratch_path": f"scratch/{safe_name}.csv",
                })
            except Exception as e:
                logger.warning("Table preview failed for %s", name, exc_info=e)
                actions.append({"type": "preview_table", "name": name, "error": "Table preview failed"})

        return {"actions": actions}

    def _preview_inline_tables(self, tables, scratch_jail):
        """Preview inline CSV tables (from text/image extraction)."""
        actions = []

        for spec in tables:
            name = _secure_filename(spec.get("name", "table"))
            csv_data = spec.get("data", "")

            try:
                df = pd.read_csv(io.StringIO(csv_data))
                csv_path = scratch_jail.resolve(f"{name}.csv")
                df.to_csv(csv_path, index=False)

                actions.append({
                    "type": "preview_table",
                    "name": name,
                    "columns": list(df.columns),
                    "sample_rows": df_to_safe_records(df.head(5)),
                    "total_rows": len(df),
                    "csv_scratch_path": f"scratch/{name}.csv",
                })
            except Exception as e:
                logger.warning("Inline table preview failed for %s", name, exc_info=e)
                actions.append({"type": "preview_table", "name": name, "error": "Table preview failed"})

        return {"actions": actions}

    def _preview_scratch_files(self, scratch_files, scratch_dir):
        """Read scratch CSV files and build preview actions."""
        workspace_jail = self.workspace.confined_root
        actions = []

        for spec in scratch_files:
            file_path = spec.get("path", "")
            table_name = _secure_filename(spec.get("name", "table"))

            try:
                target = workspace_jail.resolve(file_path)
            except ValueError:
                actions.append({"type": "preview_table", "name": table_name, "error": "Path outside workspace"})
                continue

            if not target.exists():
                actions.append({"type": "preview_table", "name": table_name, "error": f"File not found: {file_path}"})
                continue

            try:
                df = pd.read_csv(target)
                actions.append({
                    "type": "preview_table",
                    "name": table_name,
                    "columns": list(df.columns),
                    "sample_rows": df_to_safe_records(df.head(5)),
                    "total_rows": len(df),
                    "csv_scratch_path": file_path,
                })
            except Exception as e:
                logger.warning("Scratch file preview failed for %s", table_name, exc_info=e)
                actions.append({"type": "preview_table", "name": table_name, "error": "Table preview failed"})

        return {"actions": actions}

    # ------------------------------------------------------------------
    # Data discovery tools
    # ------------------------------------------------------------------

    def _tool_list_data(self, args):
        """Browse the catalog hierarchy.

        Three modes:
          * no args                       → per-source summary
          * source_id only                → top-level entries of that source
          * source_id + path              → direct children at that level

        Cache-only. Workspace tables are not included; they're already in the
        system prompt.  See design-docs/32-data-loading-agent-navigation.md §3.1.
        """
        from data_formulator.datalake.catalog_cache import (
            list_path_children,
            list_sources_summary,
        )

        user_home = getattr(self.workspace, "user_home", None)
        if not user_home:
            return {"sources": []}

        source_id = (args.get("source_id") or "").strip()
        if not source_id:
            try:
                return {"sources": list_sources_summary(user_home)}
            except Exception:
                logger.debug("list_data: list_sources_summary failed", exc_info=True)
                return {"sources": []}

        path = args.get("path") or []
        if not isinstance(path, list):
            return {"error": "path must be an array of strings"}
        filter_arg = args.get("filter")

        try:
            return list_path_children(
                user_home, source_id, path=path, filter=filter_arg,
            )
        except Exception as exc:
            logger.debug("list_data: list_path_children failed", exc_info=True)
            return {"error": f"list_data failed: {exc}"}

    def _tool_find_data(self, args):
        """Regex search across cached catalogs.

        ``scope`` accepts: 'all' (default), 'workspace', 'connected',
        '<source_id>', or '<source_id>:<path/segments>'. The
        path-scoped form restricts catalog search to a subtree.

        Workspace tables are searched with a plain substring match (they're
        small, regex-on-name has little extra value there).  Catalog cache
        search is regex-based.  See design-docs §3.2.
        """
        from data_formulator.datalake.catalog_cache import (
            CatalogSearchError,
            search_catalog_cache,
        )

        query = (args.get("query") or "").strip()
        if not query:
            return {"error": "query is required"}

        scope_raw = (args.get("scope") or "all").strip()
        exclude = args.get("exclude") or None
        fields = args.get("fields") or None
        limit = args.get("limit")
        try:
            limit = max(1, min(int(limit), 200)) if limit else 50
        except (TypeError, ValueError):
            limit = 50

        # ── Parse scope ───────────────────────────────────────────────
        search_workspace = False
        source_ids: list[str] | None = None
        path_prefix: list[str] | None = None

        if scope_raw == "all":
            search_workspace = True
        elif scope_raw == "workspace":
            search_workspace = True
            source_ids = []  # skip catalog cache entirely
        elif scope_raw == "connected":
            pass  # catalog only, all sources
        elif ":" in scope_raw:
            sid, _, path_str = scope_raw.partition(":")
            source_ids = [sid.strip()] if sid.strip() else []
            path_prefix = [seg for seg in path_str.split("/") if seg]
        else:
            source_ids = [scope_raw]

        user_home = getattr(self.workspace, "user_home", None)
        results: list[dict] = []

        # ── Workspace search (substring; existing semantics) ─────────
        if search_workspace:
            try:
                ws_meta = self.workspace.get_metadata()
                if ws_meta:
                    ws_hits = ws_meta.search_tables(query, limit=min(limit, 50))
                    for hit in ws_hits:
                        results.append({
                            "source": "workspace",
                            "name": hit["name"],
                            "description": (hit.get("description") or "")[:120],
                            "matched_columns": hit.get("matched_columns", []),
                            "status": "imported",
                        })
            except Exception:
                logger.debug("find_data: workspace search failed", exc_info=True)

        # ── Catalog cache search (regex) ─────────────────────────────
        if source_ids != [] and user_home:
            try:
                imported_names = {r["name"] for r in results}
                cache_hits = search_catalog_cache(
                    user_home,
                    query,
                    source_ids=source_ids,
                    limit_per_source=min(limit, 50),
                    exclude_tables=imported_names,
                    exclude_pattern=exclude,
                    fields=fields,
                    path_prefix=path_prefix,
                )
                for hit in cache_hits[:limit]:
                    results.append({
                        "source": hit.get("source_id", "connected"),
                        "source_id": hit.get("source_id", ""),
                        "table_key": hit.get("table_key", ""),
                        "name": hit["name"],
                        "description": (hit.get("description") or "")[:120],
                        "matched_columns": hit.get("matched_columns", []),
                        "status": "not imported",
                    })
            except CatalogSearchError as exc:
                return {"error": str(exc)}
            except Exception:
                logger.debug("find_data: catalog search failed", exc_info=True)

        if not results:
            try:
                from data_formulator.datalake.catalog_cache import list_cached_sources
                known = sorted(list_cached_sources(user_home) or []) if user_home else []
            except Exception:
                known = []
            return {
                "results": [],
                "valid_source_ids": known,
                "note": (
                    f"No tables matched query={query!r} scope={scope_raw!r}. "
                    "Try a broader pattern, alternation (a|b), or list_data to browse."
                ),
            }

        return {"results": results[:limit], "query": query, "scope": scope_raw}

    def _tool_describe_data(self, args):
        """Read detailed metadata for one table.  Delegates to context handler."""
        from data_formulator.agents.context import handle_read_catalog_metadata
        source_id = args.get("source_id", "")
        table_key = args.get("table_key", "")
        text = handle_read_catalog_metadata(source_id, table_key, self.workspace)
        return {"result": text}

    def _resolve_catalog_path(self, source_id, table_key):
        """Return the catalog ``path`` for a table_key, or ``None`` if unknown.

        Used by ``probe_data`` to turn the model-facing ``table_key`` into the
        loader-facing catalog path that ``probe``/``get_metadata`` expect.
        """
        user_home = getattr(self.workspace, "user_home", None)
        if not user_home:
            return None
        from pathlib import Path
        from data_formulator.datalake.catalog_cache import load_catalog
        try:
            catalog = load_catalog(Path(user_home), source_id) or []
        except Exception:
            logger.debug("probe_data: load_catalog failed", exc_info=True)
            return None
        for t in catalog:
            if t.get("table_key") == table_key:
                path = t.get("path")
                if path:
                    return list(path)
                name = t.get("name")
                return [name] if name else None
        return None

    def _tool_probe_data(self, args):
        """Run a bounded SPJQ probe on one connected-source table (design 37 §4.2).

        Resolves the live loader mid-turn, maps ``table_key`` → catalog path,
        and delegates to ``loader.probe``. Guarded by a per-turn budget so a
        chatty model can't hammer the source. Results are capped to at most a
        few hundred rows and never written back to the cache (we stay agentic).
        """
        from data_formulator.data_loader.probe_utils import PROBE_MAX_ROWS

        source_id = (args.get("source_id") or "").strip()
        table_key = (args.get("table_key") or "").strip()
        query = args.get("query") or {}
        if not source_id or not table_key:
            return {"error": "source_id and table_key are required"}
        if not isinstance(query, dict):
            return {"error": "query must be an object"}

        if getattr(self, "_probe_budget", 0) <= 0:
            return {"error": (
                "Probe budget exhausted for this turn. Summarize what you've "
                "learned and call propose_load_plan, or ask the user to continue."
            )}

        path = self._resolve_catalog_path(source_id, table_key)
        if path is None:
            return {"error": (
                f"table_key '{table_key}' not found in source '{source_id}'. "
                "Use find_data / describe_data to get an exact table_key first."
            )}

        try:
            from data_formulator.data_connector import resolve_live_loader
            loader = resolve_live_loader(source_id)
        except Exception as exc:
            return {"error": f"source '{source_id}' is not connected: {exc}"}

        self._probe_budget -= 1
        try:
            result = loader.probe(path, query)
        except Exception as exc:
            logger.debug("probe_data failed", exc_info=True)
            return {"error": f"probe failed: {exc}"}

        if isinstance(result, dict) and "error" not in result:
            result.setdefault(
                "note",
                f"probe returns at most {PROBE_MAX_ROWS} rows for inspection; "
                "use propose_load_plan to load the full table.",
            )
        return result

    def _tool_propose_load_plan(self, args):
        """Produce a structured load plan action for frontend rendering.

        Candidates are validated against the cached catalog before they leave
        this turn.  If *every* candidate fails to resolve, we return a
        recoverable error so the model can retry with corrected IDs instead
        of emitting a card the user can't actually use.
        """
        raw = [c for c in (args.get("candidates", []) or []) if isinstance(c, dict)]
        candidates = [self._normalize_load_plan_candidate(c) for c in raw]
        reasoning = args.get("reasoning", "")

        resolvable = [c for c in candidates if not c.get("resolution_error")]
        if candidates and not resolvable:
            # All candidates failed. Hand the model the valid IDs and ask it
            # to retry.  Returning an "error" here keeps the assistant loop
            # alive; the frontend never sees a broken card.
            hint = self._format_valid_sources_hint()
            failures = "; ".join(
                f"{c.get('source_id')!r}/{c.get('table_key')!r}: {c.get('resolution_error')}"
                for c in candidates
            )
            return {
                "error": (
                    "All proposed candidates failed to resolve against the catalog. "
                    f"Errors: {failures}. "
                    "Re-run search_data_candidates and read_candidate_metadata, then "
                    "call propose_load_plan again with the exact source_id and "
                    f"table_key from those tools.\n\n{hint}"
                )
            }

        actions = [{
            "type": "load_plan",
            "candidates": candidates,
            "reasoning": reasoning,
        }]
        return {"actions": actions}

    def _normalize_load_plan_candidate(self, candidate):
        """Resolve a model-proposed candidate into frontend import shape.

        The model sees catalog names and stable table keys, but each loader may
        require a different opaque import id.  Superset, for example, must be
        loaded by numeric dataset_id, not by the Chinese dataset label.

        If ``source_id`` is not a known cached source or ``table_key`` does
        not match any catalog entry, a ``resolution_error`` field is set so
        the caller can fail loudly (rather than emit a card that 500s when
        the user clicks Load).
        """
        result = dict(candidate)
        source_id = str(result.get("source_id") or "")
        table_key = str(result.get("table_key") or "")

        resolution_error = None
        known_sources = self._known_source_ids()
        if not source_id:
            resolution_error = "missing source_id"
        elif known_sources and source_id not in known_sources:
            resolution_error = (
                f"unknown source_id {source_id!r}; "
                f"valid: {', '.join(sorted(known_sources)) or 'none'}"
            )

        catalog_entry = self._lookup_catalog_entry(source_id, table_key)
        if resolution_error is None and not catalog_entry:
            if not table_key:
                resolution_error = "missing table_key"
            else:
                resolution_error = (
                    f"table_key {table_key!r} not found in source {source_id!r}"
                )

        metadata = (catalog_entry or {}).get("metadata") or {}
        display_name = (
            result.get("display_name")
            or (catalog_entry or {}).get("name")
            or table_key
            or result.get("source_table")
            or "table"
        )
        import_id = (
            metadata.get("dataset_id")
            if metadata.get("dataset_id") is not None
            else metadata.get("_source_name")
        )
        if import_id is None:
            import_id = result.get("source_table") or table_key or display_name

        source_name = (
            metadata.get("_source_name")
            or metadata.get("_catalogName")
            or display_name
        )

        result["source_id"] = source_id
        result["table_key"] = table_key
        result["display_name"] = str(display_name)
        result["source_table"] = str(import_id)
        result["source_table_name"] = str(source_name)
        result["filters"] = self._normalize_load_plan_filters(result.get("filters"))
        if resolution_error:
            result["resolution_error"] = resolution_error
        result.pop("row_limit", None)
        return result

    def _known_source_ids(self):
        """Return the set of cached source_ids the agent can legitimately use."""
        try:
            user_home = getattr(self.workspace, "user_home", None)
            if not user_home:
                return set()
            from data_formulator.datalake.catalog_cache import list_cached_sources
            return set(list_cached_sources(user_home) or [])
        except Exception:
            logger.debug("Could not list cached sources", exc_info=True)
            return set()

    def _format_valid_sources_hint(self) -> str:
        """Compact directory of valid source_ids for the model retry path."""
        known = self._known_source_ids()
        if not known:
            return "No connected sources are currently cached."
        return "Valid source_ids: " + ", ".join(sorted(known))

    def _lookup_catalog_entry(self, source_id, table_key):
        if not source_id or not table_key:
            return None
        try:
            user_home = getattr(self.workspace, "user_home", None)
            if not user_home:
                return None
            from pathlib import Path
            from data_formulator.datalake.catalog_cache import load_catalog

            for table in load_catalog(Path(user_home), source_id) or []:
                meta = table.get("metadata") or {}
                identifiers = {
                    str(table.get("table_key") or ""),
                    str(meta.get("uuid") or ""),
                    str(meta.get("dataset_id") or ""),
                    str(meta.get("_source_name") or ""),
                    str(table.get("name") or ""),
                }
                if table_key in identifiers:
                    return table
        except Exception:
            logger.debug("Could not resolve load plan candidate from catalog", exc_info=True)
        return None

    @staticmethod
    def _normalize_load_plan_filters(filters):
        if not isinstance(filters, list):
            return []
        op_map = {
            "=": "EQ",
            "==": "EQ",
            "!=": "NEQ",
            "<>": "NEQ",
            ">": "GT",
            ">=": "GTE",
            "<": "LT",
            "<=": "LTE",
            "CONTAINS": "ILIKE",
        }
        valid_ops = {
            "EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN",
            "LIKE", "ILIKE", "IS_NULL", "IS_NOT_NULL", "BETWEEN",
        }
        normalized = []
        for item in filters:
            if not isinstance(item, dict):
                continue
            column = str(item.get("column") or "").strip()
            if not column:
                continue
            op = str(item.get("operator") or "EQ").strip().upper()
            op = op_map.get(op, op)
            if op not in valid_ops:
                op = "EQ"
            if op not in {"IS_NULL", "IS_NOT_NULL"}:
                value = item.get("value")
                if isinstance(value, str):
                    raw = value.strip()
                    stripped = raw.strip("%")
                    has_wildcards = stripped != raw
                    if has_wildcards:
                        value = stripped
                        if not value:
                            continue
                        if op in ("EQ", "LIKE"):
                            op = "ILIKE"
                    elif op == "LIKE":
                        op = "ILIKE"
                entry = {"column": column, "operator": op, "value": value}
            else:
                entry = {"column": column, "operator": op}
            normalized.append(entry)
        return normalized

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_system_prompt(self, last_user_text: str = ""):
        """Build the system prompt with current workspace context.

        *last_user_text* is used to search the knowledge store for
        workflows relevant to the user's current request.  Falls back
        to a generic query when empty.
        """
        table_names = "none"
        try:
            metadata = self.workspace.list_tables()
            if metadata:
                table_names = ", ".join(self._table_display_name(m) for m in metadata)
        except Exception as e:
            logger.warning("Could not list tables for system prompt", exc_info=e)
            from data_formulator.error_handler import collect_stream_warning
            collect_stream_warning(
                "Could not load table list — data chat context may be incomplete",
                detail=str(e),
                message_code="TABLE_LIST_FAILED",
            )

        user_home = getattr(self.workspace, "user_home", None)
        connector_summary = _build_connector_summary_block(user_home)

        from datetime import datetime
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M (%A)")

        prompt = SYSTEM_PROMPT.format(
            table_names=table_names,
            connector_summary=connector_summary,
            current_time=current_time,
        )

        if self._knowledge_store:
            prompt += self._knowledge_store.format_rules_block()

        # Inject relevant workflows from knowledge store
        if self._knowledge_store:
            try:
                search_query = (
                    last_user_text.strip()
                    if last_user_text and last_user_text.strip()
                    else "data loading cleaning preparation"
                )
                relevant = self._knowledge_store.search(
                    search_query,
                    categories=["workflows"],
                    max_results=3,
                )
                if relevant:
                    knowledge_block = "[RELEVANT KNOWLEDGE]\n"
                    for item in relevant:
                        knowledge_block += f"\n### {item['title']}\n{item['snippet']}\n"
                    prompt += "\n\n" + knowledge_block
            except Exception:
                logger.warning("Failed to search knowledge workflows", exc_info=True)

        if self.language_instruction:
            prompt += "\n\n" + self.language_instruction

        return prompt

    @staticmethod
    def _table_display_name(table) -> str:
        """Return a table name from workspace strings or metadata-like objects."""
        if isinstance(table, str):
            return table
        if isinstance(table, dict):
            return str(table.get("table_name") or table.get("name") or table)
        return str(getattr(table, "table_name", table))

    def _convert_message(self, msg):
        """Convert a chat message to LLM message format."""
        role = msg.get("role", "user")
        content = msg.get("content", "")
        attachments = msg.get("attachments", [])

        if not attachments:
            return {"role": role, "content": content}

        # Build multimodal content parts. Text comes first so vision models get
        # the user's instruction before the attached images.
        parts = []
        image_parts = []
        file_parts = []

        for att in attachments:
            att_type = att.get("type", "")
            if att_type == "image":
                url = att.get("url", "")
                if url:
                    image_parts.append({
                        "type": "image_url",
                        "image_url": {"url": url, "detail": "high"},
                    })
            elif att_type in ("file", "text_file"):
                # Reference scratch path in text
                scratch_path = att.get("scratchPath", "")
                preview = att.get("preview", "")
                name = att.get("name", "file")
                if scratch_path:
                    file_parts.append({
                        "type": "text",
                        "text": f"[Uploaded file: {name} at {scratch_path}]\n{preview}",
                    })

        if content:
            parts.append({"type": "text", "text": content})
        if image_parts:
            label = "[USER ATTACHMENT]" if len(image_parts) == 1 else "[USER ATTACHMENTS]"
            parts.append({"type": "text", "text": f"{label}: image(s) provided by the user."})
            parts.extend(image_parts)
        parts.extend(file_parts)

        return {"role": role, "content": parts if parts else content}
