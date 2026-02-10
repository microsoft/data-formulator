#!/usr/bin/env python3
"""
Sample script: Using Data Formulator as an MCP Server

This script demonstrates how to use Data Formulator's MCP server for:
  1. Data Recommendation / Visualization (one-shot)
  2. Iterative Data Exploration (multi-turn)

There are TWO ways to use the MCP tools demonstrated here:

  (A) Direct invocation — import and call the tool functions directly
      (no MCP client/server needed, great for scripting & testing)

  (B) MCP client — connect to the MCP server over stdio and call tools
      via the MCP protocol (how real MCP hosts like Claude Desktop use it)

Prerequisites:
    # Install dependencies with uv (from project root):
    uv pip install -e ".[mcp]"
    # or:
    uv pip install mcp pandas vl-convert-python requests

    # Azure OpenAI with Azure AD auth (recommended for Microsoft users):
    #   No API key needed — uses DefaultAzureCredential (az login).
    export DF_MCP_MODEL_ENDPOINT="azure"
    export DF_MCP_MODEL_NAME="gpt-4o"
    export DF_MCP_API_BASE="https://YOUR_RESOURCE.openai.azure.com/"
    export DF_MCP_API_VERSION="2025-04-01-preview"   # optional, has default

    # Alternative: OpenAI
    #   export DF_MCP_MODEL_ENDPOINT="openai"
    #   export DF_MCP_MODEL_NAME="gpt-4o"
    #   export OPENAI_API_KEY="sk-..."

    # Alternative: Anthropic
    #   export DF_MCP_MODEL_ENDPOINT="anthropic"
    #   export DF_MCP_MODEL_NAME="claude-sonnet-4-20250514"
    #   export ANTHROPIC_API_KEY="sk-ant-..."

    # Alternative: Ollama (local, no key)
    #   export DF_MCP_MODEL_ENDPOINT="ollama"
    #   export DF_MCP_MODEL_NAME="llama3"

Usage:
    # Run all demos with uv (recommended):
    uv run python py-src/tests/test_mcp_server.py

    # Run all demos (direct invocation, no server process needed):
    python py-src/tests/test_mcp_server.py

    # Run only one demo:
    uv run python py-src/tests/test_mcp_server.py --demo 1   # one-shot visualization
    uv run python py-src/tests/test_mcp_server.py --demo 2   # iterative exploration
    uv run python py-src/tests/test_mcp_server.py --demo 3   # MCP client over stdio
"""

import argparse
import asyncio
import json
import base64
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Setup paths so we can import data_formulator
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

OUTPUT_DIR = SCRIPT_DIR / "mcp_demo_output"
OUTPUT_DIR.mkdir(exist_ok=True)


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║                   DEMO DATA URLS                                       ║
# ╚═════════════════════════════════════════════════════════════════════════╝

# These URLs come from the predefined demo datasets (also available via
# the list_demo_data MCP tool). You can use any publicly accessible URL
# pointing to a csv, tsv, json, jsonl, or xlsx file.

GAPMINDER_URL = "https://raw.githubusercontent.com/vega/vega-datasets/refs/heads/main/data/gapminder.json"
DISASTERS_URL = "https://raw.githubusercontent.com/vega/vega-datasets/refs/heads/main/data/disasters.csv"
LIFE_EXPECTANCY_URL = "https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2023/2023-12-05/life_expectancy.csv"
MOVIES_URL = "https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2025/2025-07-29/movies.csv"


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║                  HELPERS                                               ║
# ╚═════════════════════════════════════════════════════════════════════════╝

def save_chart(base64_data_url: str | None, filename: str) -> None:
    """Save a base64 data URL (data:image/png;base64,...) to a PNG file."""
    if not base64_data_url:
        print(f"  ⚠  No chart image for {filename}")
        return
    try:
        b64 = base64_data_url.split(",", 1)[1] if "," in base64_data_url else base64_data_url
        filepath = OUTPUT_DIR / filename
        filepath.write_bytes(base64.b64decode(b64))
        print(f"  ✅ Chart saved: {filepath}")
    except Exception as e:
        print(f"  ❌ Failed to save chart {filename}: {e}")


def save_json_result(data: dict, filename: str) -> None:
    """Save a dict to a JSON file."""
    filepath = OUTPUT_DIR / filename
    filepath.write_text(json.dumps(data, indent=2, default=str))
    print(f"  📄 Result saved: {filepath}")


def print_section(title: str) -> None:
    width = 70
    print()
    print("=" * width)
    print(f"  {title}")
    print("=" * width)


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  DEMO 1: One-shot Visualization (Data Recommendation)                 ║
# ╚═════════════════════════════════════════════════════════════════════════╝

def demo_1_one_shot_visualization():
    """
    Demonstrates the `visualize_data` tool:
      Input:  data URLs + natural language instruction
      Output: transformed data + chart image (PNG) + reasoning
    """
    print_section("DEMO 1: One-shot Data Visualization")

    # Import the MCP tool functions directly
    from data_formulator.mcp_server import visualize_data, list_demo_data

    # --- Example 1.0: List demo datasets ---
    print("\n📋 Example 1.0: List available demo datasets")
    demo_data = list_demo_data()
    print(f"   Found {len(demo_data['datasets'])} demo datasets:")
    for ds in demo_data["datasets"]:
        urls = [t["url"] for t in ds["tables"]]
        print(f"   • {ds['name']}: {ds['description'][:60]}...")
        for t in ds["tables"]:
            print(f"     URL: {t['url'][:80]}... ({t['format']})")

    # --- Example 1a: Gapminder (JSON URL), let AI recommend a visualization ---
    print("\n📊 Example 1a: Gapminder life expectancy trends (JSON URL)")
    print(f"   URL: {GAPMINDER_URL}")
    print("   Instruction: 'Show life expectancy trends over time for the top 5 most populous countries'")

    result = visualize_data(
        data_urls=[GAPMINDER_URL],
        instruction="Show life expectancy trends over time for the top 5 most populous countries as a line chart",
        table_names=["gapminder"],
    )

    print(f"   Status: {result['status']}")
    if result["status"] == "ok":
        print(f"   Summary: {result['instruction_summary']}")
        print(f"   Chart type: {result['chart_type']}")
        print(f"   Encodings: {result['chart_encodings']}")
        print(f"   Data rows: {result['transformed_data_full_count']}")
        print(f"   Code:\n{result['code'][:300]}...")
        save_chart(result.get("chart_image_base64"), "demo1a_gapminder.png")
        save_json_result(result, "demo1a_result.json")
    else:
        print(f"   Error: {result.get('message', 'Unknown')}")

    # --- Example 1b: Disasters (CSV URL) ---
    print("\n📊 Example 1b: Natural disasters deaths over time (CSV URL)")
    print(f"   URL: {DISASTERS_URL}")
    print("   Instruction: 'Show total deaths by disaster type over time'")

    result = visualize_data(
        data_urls=[DISASTERS_URL],
        instruction="Show the total deaths by disaster entity for the top 5 deadliest disaster types as a bar chart",
        table_names=["disasters"],
    )

    print(f"   Status: {result['status']}")
    if result["status"] == "ok":
        print(f"   Summary: {result['instruction_summary']}")
        print(f"   Chart type: {result['chart_type']}")
        print(f"   Encodings: {result['chart_encodings']}")
        print(f"   Output fields: {result['reasoning']['output_fields']}")
        save_chart(result.get("chart_image_base64"), "demo1b_disasters.png")
        save_json_result(result, "demo1b_result.json")
    else:
        print(f"   Error: {result.get('message', 'Unknown')}")

    # --- Example 1c: Netflix movies (CSV URL), computed metric ---
    print("\n📊 Example 1c: Netflix most viewed movies (CSV URL)")
    print(f"   URL: {MOVIES_URL}")
    print("   Instruction: 'Show top 10 most viewed movies'")

    result = visualize_data(
        data_urls=[MOVIES_URL],
        instruction="Show the top 10 most viewed movies as a horizontal bar chart sorted by views",
        table_names=["netflix_movies"],
    )

    print(f"   Status: {result['status']}")
    if result["status"] == "ok":
        print(f"   Summary: {result['instruction_summary']}")
        print(f"   Chart type: {result['chart_type']}")
        print(f"   Data preview: {result['transformed_data'][:3]}")
        save_chart(result.get("chart_image_base64"), "demo1c_netflix.png")
        save_json_result(result, "demo1c_result.json")
    else:
        print(f"   Error: {result.get('message', 'Unknown')}")


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  DEMO 2: Iterative Exploration (Multi-turn Workflow)                   ║
# ╚═════════════════════════════════════════════════════════════════════════╝

def demo_2_iterative_exploration():
    """
    Demonstrates the `explore_data` tool:
      Input:  data URLs + high-level question
      Output: multiple rounds of analysis, each with data + chart + reasoning

    The AI agent:
      1. Breaks the question into sub-questions
      2. For each sub-question: transforms data → creates chart → interprets result
      3. Decides the next question based on findings
      4. Presents a summary when exploration is complete
    """
    print_section("DEMO 2: Iterative Data Exploration")

    from data_formulator.mcp_server import explore_data

    # --- Example 2a: Explore Gapminder data ---
    print("\n🔍 Example 2a: Explore Gapminder global development trends")
    print(f"   URL: {GAPMINDER_URL}")
    print("   Question: 'Explore the relationship between population growth, life expectancy, and fertility'")
    print("   Max iterations: 3")
    print("   (This may take a minute as the AI performs multiple analysis rounds...)\n")

    result = explore_data(
        data_urls=[GAPMINDER_URL],
        question="Explore the relationship between population growth, life expectancy, and fertility rates across countries. What patterns emerge?",
        table_names=["gapminder"],
        max_iterations=3,
    )

    print(f"   Status: {result['status']}")
    print(f"   Total steps completed: {result['total_steps']}")

    if result["status"] == "ok":
        print(f"\n   📋 Summary:\n   {result['summary']}")

        for step in result["steps"]:
            i = step["iteration"]
            print(f"\n   --- Step {i} ---")
            print(f"   Question: {step['question']}")
            if step.get("status") == "ok":
                print(f"   Chart type: {step['chart_type']}")
                print(f"   Encodings: {step['chart_encodings']}")
                print(f"   Data rows: {step.get('transformed_data_full_count', 'N/A')}")
                save_chart(step.get("chart_image_base64"), f"demo2a_step{i}.png")
            else:
                print(f"   Error: {step.get('message', 'Unknown')}")

        save_json_result(result, "demo2a_exploration.json")

    # --- Example 2b: Explore life expectancy data ---
    print("\n\n🔍 Example 2b: Explore life expectancy across countries")
    print(f"   URL: {LIFE_EXPECTANCY_URL}")
    print("   Question: 'Analyze life expectancy trends and identify countries with the fastest improvements'")
    print("   Max iterations: 3\n")

    result = explore_data(
        data_urls=[LIFE_EXPECTANCY_URL],
        question="Analyze life expectancy trends over time. Which regions improved the most? Are there any countries that regressed?",
        table_names=["life_expectancy"],
        max_iterations=3,
    )

    print(f"   Status: {result['status']}")
    print(f"   Total steps: {result['total_steps']}")

    if result["status"] == "ok":
        print(f"\n   📋 Summary:\n   {result['summary']}")

        for step in result["steps"]:
            i = step["iteration"]
            print(f"\n   --- Step {i} ---")
            print(f"   Question: {step['question']}")
            if step.get("status") == "ok":
                print(f"   Chart type: {step['chart_type']}")
                print(f"   Summary: {step.get('instruction_summary', '')}")
                save_chart(step.get("chart_image_base64"), f"demo2b_step{i}.png")

        save_json_result(result, "demo2b_exploration.json")


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  DEMO 3: MCP Client over stdio (full MCP protocol)                    ║
# ╚═════════════════════════════════════════════════════════════════════════╝

async def demo_3_mcp_client():
    """
    Demonstrates connecting to the Data Formulator MCP server as a proper
    MCP client over stdio transport.

    This is how real MCP hosts (Claude Desktop, VS Code Copilot, etc.) would
    connect to the server.
    """
    print_section("DEMO 3: MCP Client over stdio")

    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError:
        print("  ⚠  MCP client SDK not installed. Install with: pip install mcp")
        print("  Skipping Demo 3.")
        return

    # The server script to run
    server_script = str(PROJECT_ROOT / "py-src" / "data_formulator" / "mcp_server.py")

    server_params = StdioServerParameters(
        command=sys.executable,
        args=[server_script],
        env={
            **os.environ,  # inherit env (API keys, etc.)
            "PYTHONPATH": str(PROJECT_ROOT / "py-src"),
        },
    )

    print("  🔌 Connecting to Data Formulator MCP server...")

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # List available tools
            tools = await session.list_tools()
            print(f"  📦 Available tools: {[t.name for t in tools.tools]}")

            # --- Call list_demo_data via MCP ---
            print("\n  📋 Calling list_demo_data via MCP protocol...")
            demo_result = await session.call_tool("list_demo_data", arguments={})
            for content in demo_result.content:
                if hasattr(content, "text"):
                    result = json.loads(content.text)
                    print(f"  Found {len(result.get('datasets', []))} demo datasets")

            # --- Call visualize_data via MCP ---
            print("\n  📊 Calling visualize_data via MCP protocol...")

            viz_result = await session.call_tool(
                "visualize_data",
                arguments={
                    "data_urls": [GAPMINDER_URL],
                    "instruction": "Show life expectancy vs fertility as a scatter plot colored by cluster",
                    "table_names": ["gapminder"],
                },
            )

            # MCP returns content as TextContent or other content types
            for content in viz_result.content:
                if hasattr(content, "text"):
                    result = json.loads(content.text)
                    print(f"  Status: {result.get('status')}")
                    if result.get("status") == "ok":
                        print(f"  Summary: {result.get('instruction_summary')}")
                        print(f"  Chart type: {result.get('chart_type')}")
                        save_chart(result.get("chart_image_base64"), "demo3_mcp_viz.png")
                        save_json_result(result, "demo3_mcp_viz.json")

            # --- Call explore_data via MCP ---
            print("\n  🔍 Calling explore_data via MCP protocol...")
            print("  (This may take a minute...)")

            explore_result = await session.call_tool(
                "explore_data",
                arguments={
                    "data_urls": [DISASTERS_URL],
                    "question": "What are the most common and deadliest types of natural disasters?",
                    "table_names": ["disasters"],
                    "max_iterations": 2,
                },
            )

            for content in explore_result.content:
                if hasattr(content, "text"):
                    result = json.loads(content.text)
                    print(f"  Status: {result.get('status')}")
                    print(f"  Steps: {result.get('total_steps')}")
                    if result.get("status") == "ok":
                        for step in result.get("steps", []):
                            i = step["iteration"]
                            print(f"    Step {i}: {step.get('instruction_summary', step.get('question'))}")
                            save_chart(step.get("chart_image_base64"), f"demo3_mcp_explore_step{i}.png")
                        save_json_result(result, "demo3_mcp_explore.json")

    print("\n  ✅ MCP client demo complete!")


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  MAIN                                                                  ║
# ╚═════════════════════════════════════════════════════════════════════════╝

def main():
    parser = argparse.ArgumentParser(
        description="Demo: Data Formulator as an MCP Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_mcp_server.py              # Run demos 1 & 2 (direct invocation)
  python test_mcp_server.py --demo 1     # One-shot visualization only
  python test_mcp_server.py --demo 2     # Iterative exploration only
  python test_mcp_server.py --demo 3     # MCP client over stdio
  python test_mcp_server.py --demo all   # Run all demos including MCP client
        """,
    )
    parser.add_argument(
        "--demo",
        choices=["1", "2", "3", "all"],
        default=None,
        help="Which demo to run (default: 1 and 2)",
    )
    args = parser.parse_args()

    endpoint = os.getenv("DF_MCP_MODEL_ENDPOINT", "azure")

    print("🚀 Data Formulator MCP Server Demo")
    print(f"   Output directory: {OUTPUT_DIR}")
    print(f"   Model endpoint:  {endpoint}")
    print(f"   Model name:      {os.getenv('DF_MCP_MODEL_NAME', 'gpt-4o')}")
    if endpoint == "azure":
        print(f"   API base:        {os.getenv('DF_MCP_API_BASE', '(not set)')}")
        print(f"   Auth:            Azure AD (DefaultAzureCredential)")

    # Check for API key (not required for Azure AD auth)
    api_key = os.getenv("DF_MCP_API_KEY", os.getenv(f"{endpoint.upper()}_API_KEY", ""))
    if not api_key and endpoint not in ("azure", "ollama"):
        print(f"\n⚠️  No API key found for endpoint '{endpoint}'! Set one of:")
        print(f"   export DF_MCP_API_KEY='your-key'")
        print(f"   export {endpoint.upper()}_API_KEY='your-key'")
        print(f"   (or set them in api-keys.env)")
        print(f"\n   For Azure OpenAI with AD auth (no key needed):")
        print(f"   export DF_MCP_MODEL_ENDPOINT=azure")
        print(f"   export DF_MCP_API_BASE=https://YOUR_RESOURCE.openai.azure.com/")
        sys.exit(1)

    if args.demo == "1":
        demo_1_one_shot_visualization()
    elif args.demo == "2":
        demo_2_iterative_exploration()
    elif args.demo == "3":
        asyncio.run(demo_3_mcp_client())
    elif args.demo == "all":
        demo_1_one_shot_visualization()
        demo_2_iterative_exploration()
        asyncio.run(demo_3_mcp_client())
    else:
        # Default: run demos 1 and 2
        demo_1_one_shot_visualization()
        demo_2_iterative_exploration()

    print("\n" + "=" * 70)
    print(f"  ✅ Demo complete! Check outputs in: {OUTPUT_DIR}")
    print("=" * 70)


if __name__ == "__main__":
    main()
