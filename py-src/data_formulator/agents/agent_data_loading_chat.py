# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Conversational data loading agent.

Replaces the old DataCleanAgentStream with a general-purpose
conversational agent that can:
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

import litellm
import openai
import pandas as pd

from data_formulator.agents.agent_data_clean_stream import parse_table_sections
from data_formulator.agents.agent_utils import accumulate_reasoning_content

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a data assistant helping users load and prepare data for analysis in Data Formulator.

Tools available:
- read_file / write_file / list_directory — workspace filesystem
- execute_python — run Python (pandas, numpy, DuckDB). All DataFrames are auto-saved to scratch/.
- list_sample_datasets — list available built-in datasets with their tables and exact call syntax
- show_user_data_preview — show interactive table preview with Load button
- search_data_candidates — search across all data sources for tables matching a keyword
- read_candidate_metadata — read detailed metadata for a table from a connected source
- propose_load_plan — propose a multi-table loading plan for user confirmation

CRITICAL: You MUST call the show_user_data_preview tool to show data. Do NOT just describe data in text.

Four workflows:

**Workflow 1 — Sample dataset:**
1. Call list_sample_datasets to see what's available (returns exact dataset_name to use)
2. Call show_user_data_preview(dataset_name="<exact name>") — ALL tables in the dataset are shown

**Workflow 2 — Uploaded file or code processing:**
1. Inspect files with read_file/list_directory
2. Process with execute_python (DataFrames auto-saved to scratch/)
3. Call show_user_data_preview(saved_dfs=["df_name"])

**Workflow 3 — Unstructured text or image extraction:**
1. Extract table into CSV format
2. Call show_user_data_preview(tables=[{{"name": "...", "data": "col1,col2\\n..."}}])

**Workflow 4 — Find and load data from connected sources:**
1. Call search_data_candidates(query="...", scope="all") to find relevant tables
2. For EACH promising not-imported table, call read_candidate_metadata(source_id, table_key) to inspect columns and understand available values
3. Based on the column metadata, decide which columns to filter on and what values to use
4. Call propose_load_plan(candidates=[...], reasoning="...") — the UI shows a confirmation card
5. Keep your text brief after propose_load_plan. The UI handles the rest.

Rules:
- After show_user_data_preview or propose_load_plan, keep text VERY brief. The UI shows the preview automatically.
- For sample datasets, NEVER use execute_python or write_file to recreate them.
- execute_python auto-saves ALL DataFrames created in code.
- Use Workflow 4 when the user describes an analysis goal and you need to find relevant data from connected sources.
- In propose_load_plan, always pass source_id and table_key exactly from search_data_candidates/read_candidate_metadata.
- Do NOT set row_limit in propose_load_plan; the system applies the user's configured global limit automatically.

Filter rules for propose_load_plan:
- You MUST call read_candidate_metadata BEFORE proposing filters. Do NOT guess column names or values.
- Use the column names exactly as returned by read_candidate_metadata. Do NOT invent column names.
- Filter values must be plain values without SQL wildcards. WRONG: "%奔图%". CORRECT: "奔图".
- For partial text matching, use operator ILIKE — the backend adds wildcards automatically.
- For exact matching of a known category value, use operator EQ.
- Preferred operators: EQ (exact match), ILIKE (contains text), IN (multiple values), GT/LT/GTE/LTE (numeric/date ranges), BETWEEN (date ranges).
- Do NOT use LIKE with manually added % wildcards. Always use ILIKE for text search — it is case-insensitive and auto-wildcarded.
- If you are unsure about the exact filter value, prefer ILIKE over EQ for text columns.

Current date and time: {current_time}
Currently loaded workspace tables: {table_names}
Connected data sources: {connector_summary}
Sample datasets are available — call list_sample_datasets to see them.

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
            "name": "list_sample_datasets",
            "description": "List available built-in sample datasets with their tables and the exact dataset_name to use with show_user_data_preview.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_user_data_preview",
            "description": (
                "Show interactive table preview(s) with Load button. Three modes (use exactly one):\n"
                "1. dataset_name: load built-in sample dataset by name\n"
                "2. saved_dfs: reference DataFrames auto-saved by execute_python (by variable name)\n"
                "3. tables: inline CSV data for direct extraction from text/images\n"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "dataset_name": {
                        "type": "string",
                        "description": "Exact dataset name from list_sample_datasets (e.g. 'Space launches'). All tables in the dataset are shown.",
                    },
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
            "name": "search_data_candidates",
            "description": "Search across all data sources (workspace tables, connected databases, sample datasets) for tables matching a keyword.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search keyword (e.g. 'orders', 'sales')"},
                    "scope": {"type": "string", "enum": ["all", "workspace", "connected"], "description": "Search scope. Default: all"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_candidate_metadata",
            "description": "Read detailed metadata (columns, types, description, row count) for a specific table from a connected data source. Use source_id and table_key from search_data_candidates results.",
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
        """Call the LLM with tool definitions, working around Client.get_completion
        not supporting a `tools` parameter."""
        if self.client.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.client.params.get("api_base", None),
                api_key=self.client.params.get("api_key", ""),
                timeout=120,
            )
            return client.chat.completions.create(
                model=self.client.model,
                messages=messages,
                tools=TOOLS,
                stream=stream,
            )
        else:
            params = self.client.params.copy()
            return litellm.completion(
                model=self.client.model,
                messages=messages,
                tools=TOOLS,
                drop_params=True,
                stream=stream,
                **params,
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
        elif name == "list_sample_datasets":
            return self._tool_list_sample_datasets()
        elif name == "show_user_data_preview":
            return self._tool_show_user_data_preview(args, scratch_jail)
        elif name == "search_data_candidates":
            return self._tool_search_data_candidates(args)
        elif name == "read_candidate_metadata":
            return self._tool_read_candidate_metadata(args)
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
                            "preview": df.head(3).to_dict(orient="records"),
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
        """Unified data preview with 3 modes."""
        dataset_name = args.get("dataset_name")
        saved_dfs = args.get("saved_dfs")
        tables = args.get("tables")

        if dataset_name:
            return self._preview_sample_dataset(dataset_name)
        elif saved_dfs:
            return self._preview_saved_dfs(saved_dfs, scratch_jail)
        elif tables:
            return self._preview_inline_tables(tables, scratch_jail)
        else:
            return {"error": "Provide one of: dataset_name, saved_dfs, or tables."}

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
                    "sample_rows": df.head(5).to_dict(orient="records"),
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
                    "sample_rows": df.head(5).to_dict(orient="records"),
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
                    "sample_rows": df.head(5).to_dict(orient="records"),
                    "total_rows": len(df),
                    "csv_scratch_path": file_path,
                })
            except Exception as e:
                logger.warning("Scratch file preview failed for %s", table_name, exc_info=e)
                actions.append({"type": "preview_table", "name": table_name, "error": "Table preview failed"})

        return {"actions": actions}

    def _tool_list_sample_datasets(self):
        """Return structured list of available datasets with call syntax."""
        from data_formulator.example_datasets_config import EXAMPLE_DATASETS

        datasets = []
        for ds in EXAMPLE_DATASETS:
            tables = []
            for t in ds.get("tables", []):
                url = t.get("url", "")
                table_name = url.split("/")[-1].split(".")[0] if url else "table"
                sample = t.get("sample", [])
                if isinstance(sample, list) and sample:
                    cols = list(sample[0].keys()) if isinstance(sample[0], dict) else []
                elif isinstance(sample, str) and sample.strip():
                    header = sample.strip().split("\n")[0]
                    sep = "," if t.get("format") == "csv" else "\t"
                    cols = header.split(sep)
                else:
                    cols = []
                tables.append({"table_name": table_name, "columns_preview": cols[:6]})

            datasets.append({
                "dataset_name": ds["name"],
                "description": ds.get("description", ""),
                "tables": tables,
                "call": f'show_user_data_preview(dataset_name="{ds["name"]}")',
            })

        return {"datasets": datasets}

    def _preview_sample_dataset(self, dataset_name):
        """Build preview actions for a built-in sample dataset (exact match)."""
        from data_formulator.example_datasets_config import EXAMPLE_DATASETS

        matched = None
        for ds in EXAMPLE_DATASETS:
            if ds["name"].lower() == dataset_name.lower().strip():
                matched = ds
                break

        if not matched:
            available = ", ".join(ds["name"] for ds in EXAMPLE_DATASETS)
            return {"error": f"Dataset '{dataset_name}' not found. Available: {available}. Use list_sample_datasets to see exact names."}

        tables_info = []
        for table in matched.get("tables", []):
            sample = table.get("sample", [])
            if isinstance(sample, list) and len(sample) > 0:
                columns = list(sample[0].keys()) if isinstance(sample[0], dict) else []
                tables_info.append({
                    "table_url": table.get("url", ""),
                    "format": table.get("format", "json"),
                    "columns": columns,
                    "sample_rows": sample[:5],
                    "total_sample_rows": len(sample),
                })
            elif isinstance(sample, str) and sample.strip():
                try:
                    df = pd.read_csv(io.StringIO(sample.strip()),
                                     sep="," if table.get("format") == "csv" else "\t")
                    tables_info.append({
                        "table_url": table.get("url", ""),
                        "format": table.get("format", "csv"),
                        "columns": list(df.columns),
                        "sample_rows": df.head(5).to_dict(orient="records"),
                        "total_sample_rows": len(df),
                    })
                except Exception:
                    tables_info.append({
                        "table_url": table.get("url", ""),
                        "format": table.get("format", "csv"),
                        "columns": [],
                        "sample_rows": [],
                        "total_sample_rows": 0,
                    })

        actions = [{
            "type": "load_sample_dataset",
            "name": matched["name"],
            "description": matched.get("description", ""),
            "live": matched.get("live", False),
            "refreshIntervalSeconds": matched.get("refreshIntervalSeconds"),
            "tables": tables_info,
        }]

        return {"actions": actions}

    # ------------------------------------------------------------------
    # Data discovery tools
    # ------------------------------------------------------------------

    def _tool_search_data_candidates(self, args):
        """Search across workspace + connector catalog for matching tables."""
        from data_formulator.agents.context import handle_search_data_tables
        query = args.get("query", "")
        scope = args.get("scope", "all")
        text = handle_search_data_tables(query, scope, self.workspace)
        return {"result": text}

    def _tool_read_candidate_metadata(self, args):
        """Read detailed metadata for a specific table from a connected source."""
        from data_formulator.agents.context import handle_read_catalog_metadata
        source_id = args.get("source_id", "")
        table_key = args.get("table_key", "")
        text = handle_read_catalog_metadata(source_id, table_key, self.workspace)
        return {"result": text}

    def _tool_propose_load_plan(self, args):
        """Produce a structured load plan action for frontend rendering."""
        candidates = [
            self._normalize_load_plan_candidate(c)
            for c in (args.get("candidates", []) or [])
            if isinstance(c, dict)
        ]
        reasoning = args.get("reasoning", "")
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
        """
        result = dict(candidate)
        source_id = str(result.get("source_id") or "")
        table_key = str(result.get("table_key") or "")
        catalog_entry = self._lookup_catalog_entry(source_id, table_key)

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
        result.pop("row_limit", None)
        return result

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
        experiences relevant to the user's current request.  Falls back
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

        connector_summary = "none"
        try:
            user_home = getattr(self.workspace, "user_home", None)
            if user_home:
                from data_formulator.datalake.catalog_cache import list_cached_sources
                sources = list_cached_sources(user_home)
                if sources:
                    connector_summary = ", ".join(sources)
        except Exception:
            logger.debug("Could not list cached sources for prompt", exc_info=True)

        from datetime import datetime
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M (%A)")

        prompt = SYSTEM_PROMPT.format(
            table_names=table_names,
            connector_summary=connector_summary,
            current_time=current_time,
        )

        if self._knowledge_store:
            prompt += self._knowledge_store.format_rules_block()

        # Inject relevant experiences from knowledge store
        if self._knowledge_store:
            try:
                search_query = (
                    last_user_text.strip()
                    if last_user_text and last_user_text.strip()
                    else "data loading cleaning preparation"
                )
                relevant = self._knowledge_store.search(
                    search_query,
                    categories=["experiences"],
                    max_results=3,
                )
                if relevant:
                    knowledge_block = "[RELEVANT KNOWLEDGE]\n"
                    for item in relevant:
                        knowledge_block += f"\n### {item['title']}\n{item['snippet']}\n"
                    prompt += "\n\n" + knowledge_block
            except Exception:
                logger.warning("Failed to search knowledge experiences", exc_info=True)

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
