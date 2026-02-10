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
    uv pip install mcp pandas vl-convert-python

    # Set your LLM API key:
    export OPENAI_API_KEY="sk-..."          # or ANTHROPIC_API_KEY, etc.
    export DF_MCP_MODEL_ENDPOINT="openai"   # openai | anthropic | azure | gemini | ollama
    export DF_MCP_MODEL_NAME="gpt-4o"       # model name

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
# ║                         SAMPLE DATA                                    ║
# ╚═════════════════════════════════════════════════════════════════════════╝

SAMPLE_CSV = """Country,Year,GDP_Billion,Population_Million,CO2_Emission_MT
United States,2018,20580,327,5280
United States,2019,21430,329,5130
United States,2020,20940,331,4570
United States,2021,23320,332,5010
United States,2022,25460,333,5060
China,2018,13890,1393,10060
China,2019,14280,1398,10170
China,2020,14720,1402,10670
China,2021,17730,1405,11470
China,2022,17960,1406,11400
Germany,2018,3970,83,759
Germany,2019,3890,83,702
Germany,2020,3890,83,644
Germany,2021,4220,83,675
Germany,2022,4070,84,666
India,2018,2710,1353,2480
India,2019,2870,1366,2600
India,2020,2660,1380,2440
India,2021,3180,1393,2710
India,2022,3390,1407,2830
Japan,2018,4970,126,1160
Japan,2019,5080,126,1140
Japan,2020,5040,126,1060
Japan,2021,4940,125,1070
Japan,2022,4230,125,1050
Brazil,2018,1870,210,460
Brazil,2019,1870,211,470
Brazil,2020,1440,212,440
Brazil,2021,1650,213,490
Brazil,2022,1920,214,490"""

SAMPLE_JSON = json.dumps([
    {"Student": "Alice",   "Math": 92, "Science": 88, "English": 95, "History": 78, "Grade": "A"},
    {"Student": "Bob",     "Math": 76, "Science": 82, "English": 71, "History": 89, "Grade": "B"},
    {"Student": "Charlie", "Math": 88, "Science": 91, "English": 84, "History": 92, "Grade": "A"},
    {"Student": "Diana",   "Math": 65, "Science": 70, "English": 90, "History": 85, "Grade": "B"},
    {"Student": "Eve",     "Math": 95, "Science": 97, "English": 92, "History": 88, "Grade": "A"},
    {"Student": "Frank",   "Math": 58, "Science": 62, "English": 68, "History": 72, "Grade": "C"},
    {"Student": "Grace",   "Math": 84, "Science": 79, "English": 88, "History": 91, "Grade": "B"},
    {"Student": "Henry",   "Math": 91, "Science": 85, "English": 79, "History": 83, "Grade": "A"},
    {"Student": "Iris",    "Math": 73, "Science": 68, "English": 82, "History": 76, "Grade": "B"},
    {"Student": "Jack",    "Math": 87, "Science": 93, "English": 86, "History": 80, "Grade": "A"},
])


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
      Input:  data (CSV or JSON) + natural language instruction
      Output: transformed data + chart image (PNG) + reasoning
    """
    print_section("DEMO 1: One-shot Data Visualization")

    # Import the MCP tool function directly
    from data_formulator.mcp_server import visualize_data

    # --- Example 1a: CSV data, let AI recommend a visualization ---
    print("\n📊 Example 1a: GDP trends (CSV, AI-recommended chart)")
    print("   Instruction: 'Show GDP trends over time for each country as a line chart'")

    result = visualize_data(
        data=SAMPLE_CSV,
        instruction="Show GDP trends over time for each country as a line chart",
        data_format="csv",
        table_name="world_economy",
    )

    print(f"   Status: {result['status']}")
    if result["status"] == "ok":
        print(f"   Summary: {result['instruction_summary']}")
        print(f"   Chart type: {result['chart_type']}")
        print(f"   Encodings: {result['chart_encodings']}")
        print(f"   Data rows: {result['transformed_data_full_count']}")
        print(f"   Code:\n{result['code'][:300]}...")
        save_chart(result.get("chart_image_base64"), "demo1a_gdp_trends.png")
        save_json_result(result, "demo1a_result.json")
    else:
        print(f"   Error: {result.get('message', 'Unknown')}")

    # --- Example 1b: JSON data, with encoding hints ---
    print("\n📊 Example 1b: Student scores (JSON, with encoding hints)")
    print("   Instruction: 'Compare students by their average score across all subjects'")

    result = visualize_data(
        data=SAMPLE_JSON,
        instruction="Compare students by their average score across all subjects",
        data_format="json",
        table_name="student_scores",
    )

    print(f"   Status: {result['status']}")
    if result["status"] == "ok":
        print(f"   Summary: {result['instruction_summary']}")
        print(f"   Chart type: {result['chart_type']}")
        print(f"   Encodings: {result['chart_encodings']}")
        print(f"   Output fields: {result['reasoning']['output_fields']}")
        save_chart(result.get("chart_image_base64"), "demo1b_student_avg.png")
        save_json_result(result, "demo1b_result.json")
    else:
        print(f"   Error: {result.get('message', 'Unknown')}")

    # --- Example 1c: CO2 per capita analysis ---
    print("\n📊 Example 1c: CO2 per capita (CSV, computed metric)")
    print("   Instruction: 'Calculate CO2 emissions per capita and show as a grouped bar chart by country and year'")

    result = visualize_data(
        data=SAMPLE_CSV,
        instruction="Calculate CO2 emissions per capita (CO2 / Population) and show as a grouped bar chart by country for the latest year",
        data_format="csv",
        table_name="world_economy",
    )

    print(f"   Status: {result['status']}")
    if result["status"] == "ok":
        print(f"   Summary: {result['instruction_summary']}")
        print(f"   Chart type: {result['chart_type']}")
        print(f"   Data preview: {result['transformed_data'][:3]}")
        save_chart(result.get("chart_image_base64"), "demo1c_co2_per_capita.png")
        save_json_result(result, "demo1c_result.json")
    else:
        print(f"   Error: {result.get('message', 'Unknown')}")


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  DEMO 2: Iterative Exploration (Multi-turn Workflow)                   ║
# ╚═════════════════════════════════════════════════════════════════════════╝

def demo_2_iterative_exploration():
    """
    Demonstrates the `explore_data` tool:
      Input:  data + high-level question
      Output: multiple rounds of analysis, each with data + chart + reasoning

    The AI agent:
      1. Breaks the question into sub-questions
      2. For each sub-question: transforms data → creates chart → interprets result
      3. Decides the next question based on findings
      4. Presents a summary when exploration is complete
    """
    print_section("DEMO 2: Iterative Data Exploration")

    from data_formulator.mcp_server import explore_data

    # --- Example 2a: Explore world economy data ---
    print("\n🔍 Example 2a: Explore world economy trends")
    print("   Question: 'Explore the relationship between GDP growth, population, and CO2 emissions'")
    print("   Max iterations: 3")
    print("   (This may take a minute as the AI performs multiple analysis rounds...)\n")

    result = explore_data(
        data=SAMPLE_CSV,
        question="Explore the relationship between GDP growth, population, and CO2 emissions across countries. What patterns emerge?",
        data_format="csv",
        table_name="world_economy",
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

    # --- Example 2b: Explore student performance ---
    print("\n\n🔍 Example 2b: Explore student performance patterns")
    print("   Question: 'Analyze student performance across subjects and identify strengths/weaknesses'")
    print("   Max iterations: 3\n")

    result = explore_data(
        data=SAMPLE_JSON,
        question="Analyze student performance across subjects. Which subjects are hardest? Do grades correlate with specific subjects?",
        data_format="json",
        table_name="student_scores",
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

            # --- Call visualize_data via MCP ---
            print("\n  📊 Calling visualize_data via MCP protocol...")

            viz_result = await session.call_tool(
                "visualize_data",
                arguments={
                    "data": SAMPLE_CSV,
                    "instruction": "Show GDP per capita trends over time for each country",
                    "data_format": "csv",
                    "table_name": "world_economy",
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
                    "data": SAMPLE_CSV,
                    "question": "What are the key economic trends across countries?",
                    "data_format": "csv",
                    "table_name": "world_economy",
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

    print("🚀 Data Formulator MCP Server Demo")
    print(f"   Output directory: {OUTPUT_DIR}")
    print(f"   Model endpoint:  {os.getenv('DF_MCP_MODEL_ENDPOINT', 'openai')}")
    print(f"   Model name:      {os.getenv('DF_MCP_MODEL_NAME', 'gpt-4o')}")

    # Check for API key
    endpoint = os.getenv("DF_MCP_MODEL_ENDPOINT", "openai")
    api_key = os.getenv("DF_MCP_API_KEY", os.getenv(f"{endpoint.upper()}_API_KEY", ""))
    if not api_key:
        print(f"\n⚠️  No API key found! Set one of:")
        print(f"   export DF_MCP_API_KEY='your-key'")
        print(f"   export {endpoint.upper()}_API_KEY='your-key'")
        print(f"   (or set them in api-keys.env)")
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
