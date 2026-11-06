"""Model start-up latency for Data Formulator agent requests, from tiny prompts to real long UIS sessions.

Short cases are synthetic (3 tools, a short prompt, a few rows of data). Large cases replay requests the app really
sends, captured by ``capture.py`` into ``experiment_data/model_latency/requests/``: the full system prompt, all 18
tools and, for ``uis-long``, a 20-item conversation. Two ablations of ``uis-long`` show where its start-up time goes.

Every case runs cold (a unique first line defeats the prompt cache) and then warm (the same body again, cache hit),
straight against the Azure Responses API so app overhead is excluded. Results append to a JSONL file and a summary of
medians prints at the end. Targets are ``<account>:<model>`` (an Azure OpenAI resource name and a deployment), given
with ``--target`` or ``DF_BENCH_TARGETS`` (comma-separated). Auth uses ``az login``; set ``DF_BENCH_SUBSCRIPTION``
to take the token from a subscription other than the CLI's default.

    uv run python tests/eval/model_latency/capture.py             # once, to (re)capture the large cases
    uv run python tests/eval/model_latency/bench.py --rounds 3 --target my-account:gpt-6.1-sol
    uv run python tests/eval/model_latency/bench.py --cases tiny uis-long --target my-account:gpt-6-luna
    uv run python tests/eval/model_latency/bench.py --summary-only
"""
from __future__ import annotations

import argparse
import copy
import json
import random
import statistics
import subprocess
import os
import time
import uuid
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[3]
REQUESTS = REPO / "experiment_data" / "model_latency" / "requests"
RESULTS = REPO / "experiment_data" / "model_latency" / "results.jsonl"
SUBSCRIPTION = os.environ.get("DF_BENCH_SUBSCRIPTION")
API = "2025-04-01-preview"
KEEP_TOOLS = ("execute_python_script", "search", "visualize")

SMALL_TOOLS = [
    {"type": "function", "name": "search", "description": "Search session tables and files.",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"type": "function", "name": "execute_python_script", "description": "Run Python over the session's data.",
     "parameters": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
    {"type": "function", "name": "visualize", "description": "Compute a table with pandas and chart it.",
     "parameters": {"type": "object", "properties": {"code": {"type": "string"}, "chart": {"type": "object"}},
                    "required": ["code", "chart"]}},
]
SMALL_SYSTEM = "You are a data analyst agent in a Data Formulator session. Use one tool call at a time."
SMALL_DATA = ("Table session/tables/gapminder (5 of 1,704 rows; columns country, year, life_expect, pop):\n"
              "Afghanistan,1952,28.8,8425333\nAfghanistan,1957,30.3,9240934\nAlbania,1952,55.2,1282697\n"
              "Algeria,1952,43.1,9279525\nAngola,1952,30.0,4232095")


def _small(question: str, data: str = "") -> dict:
    content = f"{data}\n\n{question}" if data else question
    return {"instructions": SMALL_SYSTEM, "tools": SMALL_TOOLS, "reasoning": {"effort": "low"},
            "input": [{"role": "user", "content": content}], "parallel_tool_calls": False, "store": False}


def _captured(case: str) -> dict:
    path = REQUESTS / f"{case}.json"
    if not path.exists():
        raise SystemExit(f"{path} is missing; run tests/eval/model_latency/capture.py first")
    return json.loads(path.read_text())


def _fewer_tools(body: dict) -> dict:
    body = copy.deepcopy(body)
    body["tools"] = [tool for tool in body["tools"] if tool.get("name") in KEEP_TOOLS]
    return body


def _last_question_only(body: dict) -> dict:
    body = copy.deepcopy(body)
    users = [item for item in body["input"] if item.get("role") == "user"]
    body["input"] = [users[0], users[-1]] if len(users) > 1 else users  # session index + latest question
    return body


# Tools a typical analysis request uses; the rest (loading, terminal, file moves, …) could load on demand.
CORE_TOOLS = ("execute_python_script", "read_file", "search", "list_files", "visualize", "ask_user", "edit_file",
              "create_data", "write_report", "load_skill")
# Prompt sections a first analysis question rarely needs (they could move into skills loaded on demand).
OPTIONAL_SECTIONS = ("## Common Workflows", "## Longer tasks", "## Python packages for analysis",
                     "# Terminal for data acquisition", "## Data Beyond the Session", "## Delete Session Items",
                     "## Create or Revise Workspace Outputs", "## Execution contract")


def _core_tools(body: dict) -> dict:
    body = copy.deepcopy(body)
    body["tools"] = [tool for tool in body["tools"] if tool.get("name") in CORE_TOOLS]
    return body


def _trimmed_prompt(body: dict) -> dict:
    """Drop whole sections (a heading and everything up to the next heading of the same or higher level)."""
    import re
    body = copy.deepcopy(body)
    text = body["instructions"]
    for heading in OPTIONAL_SECTIONS:
        level = len(heading.split(" ", 1)[0])
        start = text.find("\n" + heading + "\n")
        if start < 0:
            continue
        match = re.compile(r"\n#{1,%d} " % level).search(text, start + len(heading) + 2)
        text = text[:start] + (text[match.start():] if match else "")
    body["instructions"] = text
    return body


# Presentation fields of `visualize` the server could infer (inputs from the code's reads, types and labels from the
# data, the table name from the title) instead of the model writing them.
INFERABLE_CHART_FIELDS = ("subtitle", "display_name", "display_instruction", "field_metadata", "field_display_names",
                          "input_sources", "input_tables")


def _lean_visualize(body: dict) -> dict:
    body = copy.deepcopy(body)
    for tool in body["tools"]:
        if tool.get("name") != "visualize":
            continue
        parameters = tool["parameters"]
        for field in INFERABLE_CHART_FIELDS:
            parameters["properties"].pop(field, None)
        parameters["required"] = [field for field in parameters.get("required", []) if field not in INFERABLE_CHART_FIELDS]
    return body


def _low_verbosity(body: dict) -> dict:
    body = copy.deepcopy(body)
    body["text"] = {**(body.get("text") or {}), "verbosity": "low"}
    return body


def _answer_case() -> dict:
    """A question answered in words, not a chart: how long the model's written answers run."""
    return _small("In a few sentences, what does this table tell us about life expectancy? Answer directly; no tools.",
                  SMALL_DATA)


def _lean(body: dict) -> dict:
    return _trimmed_prompt(_core_tools(body))


# case: (size, build)
CASES = {
    "tiny": ("short", lambda: _small("Say hello in five words.")),
    "small-tool": ("short", lambda: _small("Chart life expectancy over time for Albania and Algeria.", SMALL_DATA)),
    "app-empty": ("large", lambda: _captured("app-empty")),
    "uis-first": ("large", lambda: _captured("uis-first")),
    "uis-long": ("large", lambda: _captured("uis-long")),
    "uis-long-3tools": ("ablation", lambda: _fewer_tools(_captured("uis-long"))),
    "uis-long-no-history": ("ablation", lambda: _last_question_only(_captured("uis-long"))),
    "uis-first-core-tools": ("ablation", lambda: _core_tools(_captured("uis-first"))),
    "uis-first-trimmed": ("ablation", lambda: _trimmed_prompt(_captured("uis-first"))),
    "uis-first-lean": ("ablation", lambda: _lean(_captured("uis-first"))),
    "uis-long-lean": ("ablation", lambda: _lean(_captured("uis-long"))),
    "uis-long-lean-chart": ("ablation", lambda: _lean_visualize(_captured("uis-long"))),
    "uis-long-low-verbosity": ("ablation", lambda: _low_verbosity(_captured("uis-long"))),
    "answer": ("short", _answer_case),
    "answer-low-verbosity": ("ablation", lambda: _low_verbosity(_answer_case())),
}


def _token() -> str:
    command = ["az", "account", "get-access-token", "--resource", "https://cognitiveservices.azure.com",
               "--query", "accessToken", "-o", "tsv"]
    if SUBSCRIPTION:
        command += ["--subscription", SUBSCRIPTION]
    return subprocess.check_output(command, text=True).strip()


def _prepare(body: dict, model: str, salt: str) -> dict:
    body = {key: value for key, value in copy.deepcopy(body).items() if not key.startswith("_")}
    if body.get("model") and body["model"] != model:
        # Encrypted reasoning from earlier turns is only valid for the model that produced it.
        body["input"] = [item for item in body["input"] if item.get("type") != "reasoning"]
    body.update(model=model, stream=True)
    body["instructions"] = f"[run {salt}]\n{body.get('instructions') or ''}"
    return body


def call(client: httpx.Client, auth: str, account: str, body: dict) -> dict:
    url = f"https://{account}.openai.azure.com/openai/responses?api-version={API}"
    started = time.time()
    out: dict = {"status": None, "headers_s": None, "first_event_s": None, "first_output_s": None}
    try:
        with client.stream("POST", url, json=body, timeout=180,
                           headers={"Authorization": f"Bearer {auth}"}) as response:
            out["status"] = response.status_code
            out["headers_s"] = round(time.time() - started, 2)
            if response.status_code != 200:
                out["error"] = response.read().decode()[:300]
                return out
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                kind = event.get("type", "")
                if out["first_event_s"] is None and kind == "response.output_item.added":
                    out["first_event_s"] = round(time.time() - started, 2)
                if out["first_output_s"] is None and kind.endswith(("arguments.delta", "output_text.delta")):
                    out["first_output_s"] = round(time.time() - started, 2)
                if kind == "response.output_item.added" and event.get("item", {}).get("type") == "function_call":
                    out["tool"] = event["item"].get("name")
                if kind in ("response.completed", "response.incomplete", "response.failed"):
                    usage = (event.get("response") or {}).get("usage") or {}
                    out["input"] = usage.get("input_tokens")
                    out["cached"] = (usage.get("input_tokens_details") or {}).get("cached_tokens")
                    out["output"] = usage.get("output_tokens")
                    out["reasoning"] = (usage.get("output_tokens_details") or {}).get("reasoning_tokens")
    except Exception as exc:  # a stall or dropped stream is a result too
        out["error"] = f"{type(exc).__name__}: {exc}"[:300]
    out["total_s"] = round(time.time() - started, 2)
    return out


def summarize(path: Path, since: float = 0) -> None:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    rows = [row for row in rows if row.get("started", 0) >= since]
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        groups.setdefault((row["target"], row["case"], row["phase"]), []).append(row)

    def median(values: list) -> str:
        values = [value for value in values if value is not None]
        return f"{statistics.median(values):.1f}" if values else "-"

    print(f"\n{'target':34} {'case':22} {'phase':5} {'n':>2} {'input':>6} {'cached':>6} "
          f"{'first out s':>11} {'max':>5} {'total s':>7} {'errors':>6}")
    order = list(CASES)
    for (target, case, phase), group in sorted(groups.items(), key=lambda item: (
            item[0][0], order.index(item[0][1]) if item[0][1] in order else 99, item[0][2])):
        ok = [row for row in group if not row.get("error")]
        first = [row.get("first_output_s") or row.get("first_event_s") for row in ok]
        print(f"{target:34} {case:22} {phase:5} {len(group):>2} {median([r.get('input') for r in ok]):>6} "
              f"{median([r.get('cached') for r in ok]):>6} {median(first):>11} "
              f"{max([f for f in first if f is not None], default=0):>5.1f} "
              f"{median([r.get('total_s') for r in ok]):>7} {len(group) - len(ok):>6}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", nargs="*", default=list(CASES), choices=list(CASES))
    parser.add_argument("--target", action="append", help="account:model, e.g. my-account:gpt-6.1-sol")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--out", type=Path, default=RESULTS)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()
    if args.summary_only:
        summarize(args.out)
        return
    target_specs = args.target or [t for t in os.environ.get("DF_BENCH_TARGETS", "").split(",") if t.strip()]
    if not target_specs:
        parser.error("give --target account:model (or set DF_BENCH_TARGETS)")
    targets = [tuple(target.strip().split(":", 1)) for target in target_specs]
    bodies = {case: CASES[case][1]() for case in args.cases}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    began, auth, auth_at = time.time(), _token(), time.time()
    with httpx.Client() as client, open(args.out, "a") as sink:
        for round_index in range(args.rounds):
            for (account, model), case in random.sample([(t, c) for t in targets for c in args.cases],
                                                         len(targets) * len(args.cases)):
                if time.time() - auth_at > 2400:
                    auth, auth_at = _token(), time.time()
                body = _prepare(bodies[case], model, uuid.uuid4().hex)
                for phase in ("cold", "warm"):
                    result = {"round": round_index, "case": case, "size": CASES[case][0], "phase": phase,
                              "target": f"{account}:{model}", "started": time.time(),
                              **call(client, auth, account, body)}
                    sink.write(json.dumps(result) + "\n")
                    sink.flush()
                    print(json.dumps({key: result.get(key) for key in (
                        "round", "case", "phase", "target", "status", "first_output_s", "total_s", "input",
                        "cached", "output", "tool", "error")}), flush=True)
    summarize(args.out, since=began)


if __name__ == "__main__":
    main()
