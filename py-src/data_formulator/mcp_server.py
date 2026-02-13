# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Data Formulator MCP Server

Exposes Data Formulator's AI-powered data visualization capabilities
as an MCP (Model Context Protocol) server with the following tools:

1. list_demo_data: List predefined demo datasets with URLs
2. visualize_data: Given data URLs + instruction → transformed data + chart (PNG)
3. explore_data: Multi-turn iterative exploration → rounds of response + data + chart
4. create_chart: Create a chart directly from data URLs + field mappings

Setup:
    # Install with uv (recommended)
    uv pip install -e ".[mcp]"          # from project root
    # or install mcp separately
    uv pip install mcp

Running the MCP server:
    # Option 1: Run directly with uv
    uv run python -m data_formulator.mcp_server

    # Option 2: Run with python (after installing)
    python -m data_formulator.mcp_server

    # Option 3: Run the module file directly
    uv run py-src/data_formulator/mcp_server.py

Configure in Claude Desktop (claude_desktop_config.json):

    Azure OpenAI with Azure AD auth (recommended for Microsoft users):
    {
      "mcpServers": {
        "data-formulator": {
          "command": "uv",
          "args": [
            "--directory", "/path/to/data-formulator",
            "run", "python", "-m", "data_formulator.mcp_server"
          ],
          "env": {
            "DF_MCP_MODEL_ENDPOINT": "azure",
            "DF_MCP_MODEL_NAME": "gpt-4o",
            "DF_MCP_API_BASE": "https://YOUR_RESOURCE.openai.azure.com/",
            "DF_MCP_API_VERSION": "2025-04-01-preview"
          }
        }
      }
    }

    OpenAI (with API key):
    {
      "mcpServers": {
        "data-formulator": {
          "command": "uv",
          "args": [
            "--directory", "/path/to/data-formulator",
            "run", "python", "-m", "data_formulator.mcp_server"
          ],
          "env": {
            "OPENAI_API_KEY": "sk-...",
            "DF_MCP_MODEL_ENDPOINT": "openai",
            "DF_MCP_MODEL_NAME": "gpt-4o"
          }
        }
      }
    }

Configure in VS Code (settings.json):

    Azure OpenAI with Azure AD auth (recommended for Microsoft users):
    {
      "mcp": {
        "servers": {
          "data-formulator": {
            "command": "uv",
            "args": [
              "--directory", "/path/to/data-formulator",
              "run", "python", "-m", "data_formulator.mcp_server"
            ],
            "env": {
              "DF_MCP_MODEL_ENDPOINT": "azure",
              "DF_MCP_MODEL_NAME": "gpt-4o",
              "DF_MCP_API_BASE": "https://YOUR_RESOURCE.openai.azure.com/",
              "DF_MCP_API_VERSION": "2025-04-01-preview"
            }
          }
        }
      }
    }

    OpenAI (with API key):
    {
      "mcp": {
        "servers": {
          "data-formulator": {
            "command": "uv",
            "args": [
              "--directory", "/path/to/data-formulator",
              "run", "python", "-m", "data_formulator.mcp_server"
            ],
            "env": {
              "OPENAI_API_KEY": "sk-...",
              "DF_MCP_MODEL_ENDPOINT": "openai",
              "DF_MCP_MODEL_NAME": "gpt-4o"
            }
          }
        }
      }
    }

Environment variables:
    DF_MCP_MODEL_ENDPOINT - LLM provider: "azure" | "openai" | "anthropic" | "gemini" | "ollama"
                            (default: "azure")
    DF_MCP_MODEL_NAME     - Model name (default: "gpt-4o")
    DF_MCP_API_BASE       - API base URL (required for azure, e.g. "https://YOUR_RESOURCE.openai.azure.com/")
    DF_MCP_API_VERSION    - API version for Azure (default: "2025-04-01-preview")
    DF_MCP_API_KEY        - API key (optional for Azure AD auth; required for OpenAI/Anthropic)
    OPENAI_API_KEY        - Fallback API key for OpenAI endpoint
    ANTHROPIC_API_KEY     - Fallback API key for Anthropic endpoint
    DATALAKE_ROOT         - Workspace root directory (optional)

    Azure AD auth (no API key needed):
        When using DF_MCP_MODEL_ENDPOINT=azure with no API key set, the server
        automatically uses DefaultAzureCredential for token-based auth.
        Make sure you are logged in via `az login` or have a managed identity.

    Other providers:
        export DF_MCP_MODEL_ENDPOINT="openai"   && export OPENAI_API_KEY="sk-..."
        export DF_MCP_MODEL_ENDPOINT="anthropic" && export ANTHROPIC_API_KEY="sk-ant-..."
        export DF_MCP_MODEL_ENDPOINT="gemini"   && export GEMINI_API_KEY="..."
        export DF_MCP_MODEL_ENDPOINT="ollama"    # no key needed, runs locally
"""

import os
import sys
import json
import base64
import logging
import tempfile
from io import StringIO, BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pandas as pd
import requests

from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(Path(__file__).parent.parent.parent, 'api-keys.env'))
load_dotenv(os.path.join(Path(__file__).parent, 'api-keys.env'))

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from data_formulator.agents.client_utils import Client
from data_formulator.agents.agent_data_rec import DataRecAgent
from data_formulator.agents.agent_data_transform import DataTransformationAgent
from data_formulator.agents.agent_exploration import ExplorationAgent
from data_formulator.datalake.workspace import Workspace, WorkspaceWithTempData
from data_formulator.workflows.create_vl_plots import (
    assemble_vegailte_chart,
    spec_to_base64,
    detect_field_type,
    create_chart_spec,
)
from data_formulator.workflows.exploration_flow import create_chart_spec_from_data
from data_formulator.example_datasets_config import EXAMPLE_DATASETS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_model_config() -> dict[str, str]:
    """Build model config from environment variables."""
    endpoint = os.getenv("DF_MCP_MODEL_ENDPOINT", "azure")
    model = os.getenv("DF_MCP_MODEL_NAME", "gpt-4o")

    # Resolve API key: explicit > provider-specific
    api_key = os.getenv("DF_MCP_API_KEY", "")
    if not api_key:
        api_key = os.getenv(f"{endpoint.upper()}_API_KEY", "")

    api_base = os.getenv("DF_MCP_API_BASE", os.getenv(f"{endpoint.upper()}_API_BASE", ""))
    api_version = os.getenv("DF_MCP_API_VERSION", os.getenv(f"{endpoint.upper()}_API_VERSION", ""))

    return {
        "endpoint": endpoint,
        "model": model,
        "api_key": api_key,
        "api_base": api_base,
        "api_version": api_version,
    }


def _get_client() -> Client:
    """Create an LLM client from environment config."""
    return Client.from_config(_get_model_config())


def _get_workspace(session_id: str = "mcp_session") -> Workspace:
    """Create or reuse a workspace for the MCP session."""
    return Workspace(session_id)


def _detect_format_from_url(url: str) -> str:
    """Detect data format from URL file extension."""
    path = urlparse(url).path.lower()
    if path.endswith(".csv"):
        return "csv"
    elif path.endswith(".tsv"):
        return "tsv"
    elif path.endswith(".json"):
        return "json"
    elif path.endswith(".jsonl"):
        return "jsonl"
    elif path.endswith(".xlsx") or path.endswith(".xls"):
        return "xlsx"
    return "csv"  # default to CSV


def _load_data_from_url(url: str, data_format: str = "auto") -> pd.DataFrame:
    """
    Download and parse tabular data from a URL.

    Supported formats: csv, tsv, json, jsonl, xlsx.
    If data_format is "auto", the format is detected from the URL extension.

    Args:
        url: URL pointing to a data file (csv, tsv, json, jsonl, or xlsx).
        data_format: "csv", "tsv", "json", "jsonl", "xlsx", or "auto".

    Returns:
        pandas DataFrame
    """
    if data_format == "auto":
        data_format = _detect_format_from_url(url)

    resp = requests.get(url, timeout=60)
    resp.raise_for_status()

    if data_format == "json":
        parsed = resp.json()
        if isinstance(parsed, dict):
            parsed = [parsed]
        return pd.DataFrame(parsed)
    elif data_format == "jsonl":
        lines = resp.text.strip().split("\n")
        records = [json.loads(line) for line in lines if line.strip()]
        return pd.DataFrame(records)
    elif data_format == "tsv":
        return pd.read_csv(StringIO(resp.text), sep="\t")
    elif data_format in ("xlsx", "xls"):
        return pd.read_excel(BytesIO(resp.content))
    else:  # csv
        return pd.read_csv(StringIO(resp.text))


def _load_multiple_urls(data_urls: list[str], table_names: list[str] | None = None) -> list[dict]:
    """
    Load multiple data URLs and return a list of table dicts.

    Args:
        data_urls: List of URLs to load.
        table_names: Optional list of names for each table.
                     If not provided, names are derived from the URL filename.

    Returns:
        List of {"name": str, "rows": list[dict]} dicts.
    """
    tables = []
    for i, url in enumerate(data_urls):
        df = _load_data_from_url(url)
        rows = json.loads(df.to_json(orient="records", date_format="iso"))
        if table_names and i < len(table_names):
            name = table_names[i]
        else:
            # Derive name from URL filename (strip extension)
            filename = urlparse(url).path.split("/")[-1]
            name = filename.rsplit(".", 1)[0] if "." in filename else filename
        tables.append({"name": name, "rows": rows})
    return tables


def _make_chart_image(
    rows: list[dict],
    chart_type: str,
    chart_encodings: dict[str, str],
) -> str | None:
    """Create a base64 PNG from data rows + chart spec. Returns data URL or None."""
    try:
        df = pd.DataFrame(rows)
        if df.empty:
            return None

        encodings = {}
        for channel, field in chart_encodings.items():
            if field and field in df.columns:
                field_type = detect_field_type(df[field])
                encodings[channel] = {"field": field, "type": field_type}

        spec = assemble_vegailte_chart(df, chart_type, encodings)
        if spec:
            return spec_to_base64(spec)
    except Exception as e:
        logger.warning(f"Chart creation failed: {e}")
    return None





# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "Data Formulator",
    instructions=(
        "AI-powered data visualization server. "
        "Transform data, generate charts, and explore datasets interactively. "
        "Use list_demo_data to browse available demo datasets, then pass their "
        "URLs to visualize_data, explore_data, or create_chart."
    ),
    stateless_http=True,  # each HTTP request is independent; no session affinity needed
    json_response=True,  # all responses are JSON-serializable dicts
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False, #  https://github.com/modelcontextprotocol/python-sdk/issues/1798
    )
)


@mcp.tool()
def list_demo_data() -> dict[str, Any]:
    """
    List predefined demo datasets available for visualization and exploration.

    Returns a curated list of datasets with their URLs, formats, descriptions,
    and sample data. Use the returned URLs as input to visualize_data,
    explore_data, or create_chart.

    Returns:
        A dictionary with:
        - status: "ok"
        - datasets: List of dataset entries, each containing:
            - name: Human-readable dataset name
            - source: Data source (e.g. "vegadatasets", "tidytuesday")
            - description: Short description of the dataset
            - tables: List of tables, each with:
                - url: URL to download the data file
                - format: File format ("csv", "json", etc.)
                - sample: A few sample rows (string or list) to preview the data
    """
    datasets = []
    for ds in EXAMPLE_DATASETS:
        entry = {
            "name": ds["name"],
            "source": ds.get("source", ""),
            "description": ds.get("description", ""),
            "tables": [],
        }
        for table in ds.get("tables", []):
            t = {
                "url": table["url"],
                "format": table.get("format", "csv"),
            }
            # Include a short sample preview
            sample = table.get("sample", "")
            if isinstance(sample, list):
                t["sample"] = sample[:5]  # first 5 rows
            elif isinstance(sample, str):
                lines = sample.strip().split("\n")
                t["sample"] = "\n".join(lines[:6])  # header + 5 rows
            entry["tables"].append(t)
        datasets.append(entry)

    return {"status": "ok", "datasets": datasets}


@mcp.tool()
def visualize_data(
    data_urls: list[str],
    instruction: str,
    table_names: list[str] | None = None,
    chart_type: str = "",
    x: str = "",
    y: str = "",
    color: str = "",
    size: str = "",
    facet: str = "",
    max_repair_attempts: int = 1,
) -> dict[str, Any]:
    """
    Transform data and generate a visualization based on a natural language instruction.

    Given one or more data URLs and a natural language instruction, this tool:
    1. Downloads the data from the URLs (supports csv, tsv, json, jsonl, xlsx)
    2. Uses an AI agent to understand the intent and generate transformation code
    3. Executes the transformation to produce the output data
    4. Creates a chart (PNG) from the transformed data

    Use list_demo_data to discover available demo datasets and their URLs.

    Use this for one-shot data analysis tasks like:
    - "Show average sales by region as a bar chart"
    - "Create a scatter plot of price vs rating colored by category"
    - "Forecast the next 6 months of revenue"

    Args:
        data_urls: List of URLs pointing to data files (csv, tsv, json, jsonl, xlsx).
                   The format is auto-detected from the file extension.
        instruction: Natural language description of what visualization to create.
        table_names: Optional list of names for each table (one per URL).
                     If not provided, names are derived from the URL filename.
        chart_type: Optional chart type hint ("bar", "point", "line", "area", "heatmap",
                     "group_bar", "boxplot", "worldmap", "usmap"). Leave empty to let the AI decide.
        x: Optional field name for x-axis encoding.
        y: Optional field name for y-axis encoding.
        color: Optional field name for color encoding.
        size: Optional field name for size encoding.
        facet: Optional field name for facet encoding.
        max_repair_attempts: Max retries if code execution fails (default: 1).

    Returns:
        A dictionary with:
        - status: "ok" or "error"
        - instruction_summary: Short description of what was done
        - chart_type: The chart type used
        - chart_encodings: Mapping of visual channels to fields
        - transformed_data: List of row dicts (first 50 rows)
        - transformed_data_full_count: Total row count
        - chart_image_base64: Base64 PNG data URL of the chart (or null)
        - code: The Python transformation code generated
        - reasoning: The AI's reasoning about the transformation
    """
    try:
        # Load data from URLs
        input_tables = _load_multiple_urls(data_urls, table_names)

        # Build chart encodings from optional hints
        chart_encodings = {}
        if x: chart_encodings["x"] = x
        if y: chart_encodings["y"] = y
        if color: chart_encodings["color"] = color
        if size: chart_encodings["size"] = size
        if facet: chart_encodings["facet"] = facet

        # Decide mode: recommendation (no encodings) vs transform (has encodings)
        mode = "recommendation" if not chart_encodings else "transform"

        # Set up workspace + agent
        client = _get_client()
        workspace = _get_workspace()

        # Use register_metadata=True so agents can resolve tables via read_data_as_df
        with WorkspaceWithTempData(workspace, input_tables, register_metadata=True) as ws:
            if mode == "recommendation":
                agent = DataRecAgent(client=client, workspace=ws)
                results = agent.run(input_tables, instruction, n=1)
            else:
                agent = DataTransformationAgent(client=client, workspace=ws)
                goal = {"goal": instruction, "chart_type": chart_type, "chart_encodings": chart_encodings}
                results = agent.run(
                    input_tables,
                    json.dumps(goal),
                    [],  # no previous messages
                )

            # Repair loop
            attempts = 0
            while results[0]["status"] == "error" and attempts < max_repair_attempts:
                error_msg = results[0]["content"]
                repair_instruction = (
                    f"We ran into the following problem executing the code, please fix it:\n\n"
                    f"{error_msg}\n\n"
                    f"Please think step by step, reflect on why the error happens, and fix the code."
                )
                prev_dialog = results[0]["dialog"]

                if mode == "recommendation":
                    results = agent.followup(input_tables, prev_dialog, [], repair_instruction, n=1)
                else:
                    results = agent.followup(input_tables, prev_dialog, [], repair_instruction, n=1)
                attempts += 1

        # Process result
        result = results[0]
        if result["status"] != "ok":
            return {
                "status": "error",
                "message": result.get("content", "Unknown error"),
                "code": result.get("code", ""),
            }

        transformed_data = result["content"]
        refined_goal = result.get("refined_goal", {})
        code = result.get("code", "")

        out_rows = transformed_data.get("rows", [])
        out_chart_type = refined_goal.get("chart_type", chart_type or "bar")
        out_encodings = refined_goal.get("chart_encodings", chart_encodings)

        # Generate chart image
        chart_image = _make_chart_image(out_rows, out_chart_type, out_encodings)

        return {
            "status": "ok",
            "instruction_summary": refined_goal.get("display_instruction", instruction),
            "chart_type": out_chart_type,
            "chart_encodings": out_encodings,
            "transformed_data": out_rows[:50],
            "transformed_data_full_count": len(out_rows),
            "chart_image_base64": chart_image,
            "code": code,
            "reasoning": {
                "mode": refined_goal.get("mode", mode),
                "recommendation": refined_goal.get("recommendation", ""),
                "output_fields": refined_goal.get("output_fields", []),
            },
        }

    except Exception as e:
        logger.exception("visualize_data failed")
        return {"status": "error", "message": str(e)}


@mcp.tool()
def explore_data(
    data_urls: list[str],
    question: str,
    table_names: list[str] | None = None,
    max_iterations: int = 3,
    max_repair_attempts: int = 1,
) -> dict[str, Any]:
    """
    Iteratively explore a dataset through multiple rounds of AI-driven analysis.

    Given one or more data URLs and a high-level exploration question, this tool:
    1. Downloads the data from the URLs (supports csv, tsv, json, jsonl, xlsx)
    2. Breaks the question into a multi-step analysis plan
    3. For each step: transforms data, creates a chart, and decides the next step
    4. Returns all exploration steps with their data and charts

    Use list_demo_data to discover available demo datasets and their URLs.

    Use this for open-ended data exploration like:
    - "What are the key trends and patterns in this sales data?"
    - "Explore the factors that affect student performance"
    - "Analyze the relationship between weather and energy consumption"

    Args:
        data_urls: List of URLs pointing to data files (csv, tsv, json, jsonl, xlsx).
                   The format is auto-detected from the file extension.
        question: High-level exploration question or topic.
        table_names: Optional list of names for each table (one per URL).
                     If not provided, names are derived from the URL filename.
        max_iterations: Maximum number of exploration rounds (default: 3).
        max_repair_attempts: Max code repair retries per step (default: 1).

    Returns:
        A dictionary with:
        - status: "ok" or "error"
        - question: The original exploration question
        - steps: List of exploration step results, each containing:
            - iteration: Step number
            - question: The question addressed in this step
            - chart_type: Chart type used
            - chart_encodings: Visual channel mappings
            - transformed_data: Rows of transformed data (first 50)
            - chart_image_base64: Base64 PNG of the chart (or null)
            - code: Python transformation code
            - instruction_summary: Short description of what was done
        - summary: Final summary of exploration findings
        - total_steps: Number of steps completed
    """
    try:
        # Load data from URLs
        input_tables = _load_multiple_urls(data_urls, table_names)

        client = _get_client()
        workspace = _get_workspace()
        steps = []

        # Use register_metadata=True so agents can resolve tables via read_data_as_df
        with WorkspaceWithTempData(workspace, input_tables, register_metadata=True) as ws:
            rec_agent = DataRecAgent(client=client, workspace=ws)
            exploration_agent = ExplorationAgent(client=client, workspace=ws)

            completed_steps_for_agent = []
            current_question = question
            current_plan: list[str] = []
            previous_dialog: list[dict] = []
            previous_data: dict = {}

            for iteration in range(1, max_iterations + 1):
                # Step 1: Transform data for current question
                if previous_dialog:
                    latest_sample = previous_data.get("rows", []) if isinstance(previous_data, dict) else []
                    transform_results = rec_agent.followup(
                        input_tables=input_tables,
                        new_instruction=current_question,
                        latest_data_sample=latest_sample,
                        dialog=previous_dialog,
                    )
                else:
                    transform_results = rec_agent.run(
                        input_tables=input_tables,
                        description=current_question,
                    )

                # Repair loop
                attempt = 0
                while transform_results and transform_results[0]["status"] != "ok" and attempt < max_repair_attempts:
                    attempt += 1
                    error_msg = transform_results[0]["content"]
                    dialog = transform_results[0]["dialog"]
                    repair_instr = (
                        f"We ran into the following problem executing the code, please fix it:\n\n"
                        f"{error_msg}\n\nPlease think step by step and fix the code."
                    )
                    transform_results = rec_agent.followup(
                        input_tables=input_tables,
                        new_instruction=repair_instr,
                        latest_data_sample=[],
                        dialog=dialog,
                    )

                if not transform_results or transform_results[0]["status"] != "ok":
                    error_msg = transform_results[0]["content"] if transform_results else "Transform failed"
                    steps.append({
                        "iteration": iteration,
                        "question": current_question,
                        "status": "error",
                        "message": error_msg,
                    })
                    break

                result = transform_results[0]
                transformed_data = result["content"]
                refined_goal = result.get("refined_goal", {})
                code = result.get("code", "")
                previous_dialog = result.get("dialog", [])
                previous_data = transformed_data

                out_rows = transformed_data.get("rows", [])
                out_chart_type = refined_goal.get("chart_type", "bar")
                out_encodings = refined_goal.get("chart_encodings", {})

                # Create chart
                chart_image = _make_chart_image(out_rows, out_chart_type, out_encodings)

                step_result = {
                    "iteration": iteration,
                    "question": current_question,
                    "status": "ok",
                    "chart_type": out_chart_type,
                    "chart_encodings": out_encodings,
                    "transformed_data": out_rows[:50],
                    "transformed_data_full_count": len(out_rows),
                    "chart_image_base64": chart_image,
                    "code": code,
                    "instruction_summary": refined_goal.get("display_instruction", current_question),
                }
                steps.append(step_result)

                # Track for exploration agent
                completed_steps_for_agent.append({
                    "question": current_question,
                    "code": code,
                    "data": {
                        "rows": out_rows[:20],
                        "name": transformed_data.get("virtual", {}).get("table_name", f"step_{iteration}"),
                    },
                    "visualization": chart_image,
                })

                # Step 2: Decide next step via exploration agent
                if iteration >= max_iterations:
                    break

                try:
                    followup_results = exploration_agent.suggest_followup(
                        input_tables=input_tables,
                        completed_steps=completed_steps_for_agent,
                        next_steps=current_plan,
                    )

                    if followup_results and followup_results[0]["status"] == "ok":
                        plan = followup_results[0]["content"]
                        if plan.get("status") in ("present", "warning"):
                            # Agent decided to stop and present findings
                            break
                        next_steps = plan.get("next_steps", [])
                        if next_steps:
                            current_question = next_steps[0]
                            current_plan = next_steps[1:]
                        else:
                            break
                    else:
                        break
                except Exception as e:
                    logger.warning(f"Exploration planning failed: {e}")
                    break
        # Build summary
        summary_parts = []
        for s in steps:
            if s.get("status") == "ok":
                summary_parts.append(f"Step {s['iteration']}: {s.get('instruction_summary', s['question'])}")

        return {
            "status": "ok",
            "question": question,
            "steps": steps,
            "summary": "\n".join(summary_parts) if summary_parts else "No steps completed.",
            "total_steps": len(steps),
        }

    except Exception as e:
        logger.exception("explore_data failed")
        return {"status": "error", "message": str(e), "steps": []}


@mcp.tool()
def create_chart(
    data_url: str,
    chart_type: str,
    x: str = "",
    y: str = "",
    color: str = "",
    size: str = "",
    facet: str = "",
) -> dict[str, Any]:
    """
    Create a chart directly from a data URL and field mappings (no AI, no transformation).

    This is a fast, deterministic tool for creating standard charts when you already
    know exactly which fields to use and how to map them.

    Use list_demo_data to discover available demo datasets and their URLs.

    Args:
        data_url: URL pointing to a data file (csv, tsv, json, jsonl, xlsx).
        chart_type: One of "bar", "point", "line", "area", "heatmap",
                    "group_bar", "boxplot".
        x: Field name for x-axis.
        y: Field name for y-axis.
        color: Optional field name for color encoding.
        size: Optional field name for size encoding.
        facet: Optional field name for faceting.

    Returns:
        A dictionary with:
        - status: "ok" or "error"
        - chart_image_base64: Base64 PNG data URL
        - chart_type: The chart type used
        - fields_used: List of fields mapped to channels
    """
    try:
        df = _load_data_from_url(data_url)

        # Build encoding dict
        fields = []
        if x: fields.append(x)
        if y: fields.append(y)
        if color: fields.append(color)
        if size: fields.append(size)
        if facet: fields.append(facet)

        if not fields:
            return {"status": "error", "message": "At least one field (x or y) is required."}

        spec = create_chart_spec(df, fields, chart_type)
        if spec:
            image = spec_to_base64(spec)
            return {
                "status": "ok",
                "chart_image_base64": image,
                "chart_type": chart_type,
                "fields_used": fields,
            }
        else:
            return {"status": "error", "message": "Failed to create chart specification."}

    except Exception as e:
        logger.exception("create_chart failed")
        return {"status": "error", "message": str(e)}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """Run the MCP server (stdio transport)."""
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    mcp.run()


if __name__ == "__main__":
    main()
else:

    # See https://github.com/modelcontextprotocol/python-sdk?tab=readme-ov-file#streamablehttp-servers
   
    from starlette.applications import Starlette
    from starlette.routing import Mount
    import contextlib

    # Create a lifespan context manager to run the session manager
    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        async with mcp.session_manager.run():
            yield


    # Mount the StreamableHTTP server to the existing ASGI server
    app = Starlette(
        routes=[
            Mount("/", app=mcp.streamable_http_app()),
        ],
        lifespan=lifespan,
    )