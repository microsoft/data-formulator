# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Data Formulator MCP Server

Exposes Data Formulator's AI-powered data visualization capabilities
as an MCP (Model Context Protocol) server with the following tools:

1. visualize_data: Given data + instruction → transformed data + chart (PNG)
2. explore_data: Multi-turn iterative exploration → rounds of response + data + chart

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
    OPENAI_API_KEY / ANTHROPIC_API_KEY / etc. - API keys for LLM providers
    DF_MCP_MODEL_ENDPOINT - LLM provider (default: "openai")
    DF_MCP_MODEL_NAME     - Model name (default: "gpt-4o")
    DF_MCP_API_KEY        - API key (overrides provider-specific key)
    DF_MCP_API_BASE       - Custom API base URL (optional)
    DATALAKE_ROOT         - Workspace root directory (optional)
"""

import os
import sys
import json
import base64
import logging
import tempfile
from pathlib import Path
from typing import Any

import pandas as pd

from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(Path(__file__).parent.parent.parent, 'api-keys.env'))
load_dotenv(os.path.join(Path(__file__).parent, 'api-keys.env'))

from mcp.server.fastmcp import FastMCP

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

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_model_config() -> dict[str, str]:
    """Build model config from environment variables."""
    endpoint = os.getenv("DF_MCP_MODEL_ENDPOINT", "openai")
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


def _parse_data_input(data: str, data_format: str = "auto") -> pd.DataFrame:
    """
    Parse data from a string (JSON or CSV) into a DataFrame.

    Args:
        data: Raw data string (JSON array or CSV text)
        data_format: "json", "csv", or "auto" (detect automatically)

    Returns:
        pandas DataFrame
    """
    if data_format == "auto":
        stripped = data.strip()
        if stripped.startswith("[") or stripped.startswith("{"):
            data_format = "json"
        else:
            data_format = "csv"

    if data_format == "json":
        parsed = json.loads(data)
        if isinstance(parsed, dict):
            parsed = [parsed]
        return pd.DataFrame(parsed)
    else:
        from io import StringIO
        return pd.read_csv(StringIO(data))


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
    description=(
        "AI-powered data visualization server. "
        "Transform data, generate charts, and explore datasets interactively."
    ),
)


@mcp.tool()
def visualize_data(
    data: str,
    instruction: str,
    data_format: str = "auto",
    table_name: str = "input_data",
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

    Given tabular data (JSON or CSV) and a natural language instruction, this tool:
    1. Uses an AI agent to understand the intent and generate transformation code
    2. Executes the transformation to produce the output data
    3. Creates a chart (PNG) from the transformed data

    Use this for one-shot data analysis tasks like:
    - "Show average sales by region as a bar chart"
    - "Create a scatter plot of price vs rating colored by category"
    - "Forecast the next 6 months of revenue"

    Args:
        data: Tabular data as a JSON array of objects or CSV text.
        instruction: Natural language description of what visualization to create.
        data_format: "json", "csv", or "auto" (default: auto-detect).
        table_name: Name for the input table (default: "input_data").
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
        # Parse input data
        df = _parse_data_input(data, data_format)
        rows = json.loads(df.to_json(orient="records", date_format="iso"))

        input_tables = [{"name": table_name, "rows": rows}]

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
        temp_data = [{"name": table_name, "rows": rows}]

        with WorkspaceWithTempData(workspace, temp_data) as ws:
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
    data: str,
    question: str,
    data_format: str = "auto",
    table_name: str = "input_data",
    max_iterations: int = 3,
    max_repair_attempts: int = 1,
) -> dict[str, Any]:
    """
    Iteratively explore a dataset through multiple rounds of AI-driven analysis.

    Given tabular data and a high-level exploration question, this tool:
    1. Breaks the question into a multi-step analysis plan
    2. For each step: transforms data, creates a chart, and decides the next step
    3. Returns all exploration steps with their data and charts

    Use this for open-ended data exploration like:
    - "What are the key trends and patterns in this sales data?"
    - "Explore the factors that affect student performance"
    - "Analyze the relationship between weather and energy consumption"

    Args:
        data: Tabular data as a JSON array of objects or CSV text.
        question: High-level exploration question or topic.
        data_format: "json", "csv", or "auto" (default: auto-detect).
        table_name: Name for the input table (default: "input_data").
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
        # Parse input data
        df = _parse_data_input(data, data_format)
        rows = json.loads(df.to_json(orient="records", date_format="iso"))

        input_tables = [{"name": table_name, "rows": rows}]

        client = _get_client()
        workspace = _get_workspace()
        temp_data = [{"name": table_name, "rows": rows}]

        steps = []

        with WorkspaceWithTempData(workspace, temp_data) as ws:
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
    data: str,
    chart_type: str,
    x: str = "",
    y: str = "",
    color: str = "",
    size: str = "",
    facet: str = "",
    data_format: str = "auto",
) -> dict[str, Any]:
    """
    Create a chart directly from data and field mappings (no AI, no transformation).

    This is a fast, deterministic tool for creating standard charts when you already
    know exactly which fields to use and how to map them.

    Args:
        data: Tabular data as a JSON array of objects or CSV text.
        chart_type: One of "bar", "point", "line", "area", "heatmap",
                    "group_bar", "boxplot".
        x: Field name for x-axis.
        y: Field name for y-axis.
        color: Optional field name for color encoding.
        size: Optional field name for size encoding.
        facet: Optional field name for faceting.
        data_format: "json", "csv", or "auto".

    Returns:
        A dictionary with:
        - status: "ok" or "error"
        - chart_image_base64: Base64 PNG data URL
        - chart_type: The chart type used
        - fields_used: List of fields mapped to channels
    """
    try:
        df = _parse_data_input(data, data_format)

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
