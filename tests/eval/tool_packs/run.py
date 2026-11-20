"""Tool packs vs. skill prompts vs. bare terminal: do the Research (arXiv + OpenAlex) and Hugging Face packs help?

    uv run python tests/eval/tool_packs/run.py --name v1                       # everything (3 conditions x 2 models)
    uv run python tests/eval/tool_packs/run.py --name smoke --questions r4 h2 --models gpt-6-luna
    uv run python tests/eval/tool_packs/run.py --report experiment_data/tool_eval/runs/v1

Conditions, each its own Data Formulator server and home, with tools in Auto mode (sandboxed terminal commands
and read-only MCP tools run without asking; the browser is off):

* ``tools``: the Research and Hugging Face tool packs are added (as from the Tools dialog); the terminal is there too.
* ``skill``: no packs; two guidance-only skills (``experiment_data/tool_eval/skills``) give the same APIs as recipes
  for ``run_terminal``. Runs a snapshot of py-src with the skills added (``DF_EVAL_BACKEND``).
* ``bare``: no packs, no recipes; only the terminal, as the agent has without either.

Every question runs to completion. Pauses are answered as a user would: a data load is approved, a question gets
"go ahead"; an unsandboxed terminal request ends the run (the user decides there). Answers are graded against
expectations fixed before the runs (see QUESTIONS); on-topic questions also require the answer to be grounded in
a successful external call (MCP tool or terminal command), not recalled from memory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import shutil
import statistics
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "intent_routing"))
import harness  # noqa: E402
import multiturn  # noqa: E402

REPO = harness.REPO
ROOT = REPO / "experiment_data" / "tool_eval"
SKILLS = ROOT / "skills"
BACKEND = ROOT / "skill_backend"
CONDITIONS = ("tools", "skill", "bare", "accounts")
MODELS = ("gpt-6.1-sol", "gpt-6-luna")
PACKS = ("research", "huggingface")
EXTRA_SKILLS = {"research-papers", "huggingface-datasets"}
# Launcher prefix for conditions without the provider skills: the registry drops them as if accounts were unavailable.
NO_ACCOUNTS = """
from data_formulator.analyst.skills import SkillRegistry as _Registry
_accounts_policy = _Registry.with_accounts_policy
_Registry.with_accounts_policy = lambda self, available: _accounts_policy(self, False)
"""
DECLINE = "I won't sign in to {name}. Continue without it."
# The harness signs in to these services as the user would on the card (a test key, not a real account).
TEST_KEYS = {"httpbin.org": "df-eval-token-7f3a9c2e"}


# ── questions and expectations (fixed before running) ────────────────────

@dataclass
class Question:
    id: str
    topic: str           # research | hf | off
    session: str
    prompt: str
    answer: list[str] = field(default_factory=list)   # regexes that must all match the answer
    needs_chart: bool = False
    # must rest on a successful external call (MCP tool, api_fetch or terminal); "attempt": any call, when the
    # expected outcome is a refusal (a gated dataset)
    grounded: bool | str = True
    check: Callable[[str], tuple[bool, str]] | None = None
    expect: str = ""     # the expectation, in words, for the report and manual review
    signin: bool = False  # the accounts condition must offer a sign-in (and must not, when False)
    # Checks the sign-in the agent proposed (the form's ``signin`` payload): ``(ok, why)``.
    signin_check: Callable[[dict], tuple[bool, str]] | None = None


def _kaggle_spec(form: dict) -> tuple[bool, str]:
    spec = form.get("spec") or {}
    ok = (spec.get("verified") is False
          and any(host == "kaggle.com" or host.endswith(".kaggle.com") for host in spec.get("send_to") or [])
          and (spec.get("auth") or {}).get("type") == "bearer")
    return ok, "" if ok else f"unexpected Kaggle spec: {json.dumps(spec)[:200]}"


def _github_spec(form: dict) -> tuple[bool, str]:
    spec = form.get("spec") or {}
    ok = (spec.get("send_to") == ["api.github.com"] and (spec.get("auth") or {}).get("type") == "bearer"
          and "gh" in ((spec.get("local") or {}).get("command") or [])[:1])
    return ok, "" if ok else f"unexpected GitHub spec: {json.dumps(spec)[:200]}"


def _httpbin_spec(form: dict) -> tuple[bool, str]:
    spec = form.get("spec") or {}
    ok = spec.get("send_to") == ["httpbin.org"] and (spec.get("auth") or {}).get("type") in ("bearer", "header")
    return ok, "" if ok else f"unexpected httpbin spec: {json.dumps(spec)[:200]}"


def _citations(text: str) -> tuple[bool, str]:
    """A citation count for 'Attention Is All You Need' between 80k and 250k (sources differ widely)."""
    values = []
    for match in re.finditer(r"(\d{1,3}(?:[,\s]\d{3})+|\d{5,6}|\d{2,3}(?:\.\d)?\s?(?:k|thousand))", text, re.I):
        raw = match.group(1).lower().replace(",", "").replace(" ", "")
        try:
            value = float(re.sub(r"(k|thousand)$", "", raw)) * (1000 if re.search(r"(k|thousand)$", raw) else 1)
        except ValueError:
            continue
        values.append(value)
    ok = any(80_000 <= value <= 250_000 for value in values)
    return ok, "" if ok else "no citation count in 80k-250k"


def _recent_ids(text: str) -> tuple[bool, str]:
    ids = set(re.findall(r"\b26(?:10|11)\.\d{5}\b", text))
    return len(ids) >= 5, "" if len(ids) >= 5 else f"{len(ids)} recent (2610/2611) arXiv ids"


def _repo_ids(text: str) -> tuple[bool, str]:
    ids = set(re.findall(r"\b[\w-]{2,}/[\w.-]{3,}\b", text))
    ids = {item for item in ids if not item.startswith(("http", "huggingface.co", "datasets/")) and "." not in item[:3]}
    return len(ids) >= 5, "" if len(ids) >= 5 else f"{len(ids)} dataset ids"


Q = Question
QUESTIONS: list[Question] = [
    # Research: arXiv + OpenAlex
    Q("r1", "research", "empty", "What is the arXiv ID of the paper \"Attention Is All You Need\", who is its first "
      "author, and roughly how many times has it been cited?", [r"1706\.03762", r"vaswani"], check=_citations,
      expect="1706.03762, Ashish Vaswani, a current citation count (OpenAlex ~128k; others up to ~200k)."),
    Q("r2", "research", "empty", "How many arXiv papers about retrieval-augmented generation were published each year "
      "from 2020 to 2024? Chart the trend.", [r"2024"], needs_chart=True,
      expect="Per-year counts 2020-2024 from a real count (OpenAlex title/abstract: 11, 20, 32, 101, 1030), "
             "rising steeply; a chart."),
    Q("r3", "research", "empty", "What are the five newest papers in arXiv's cs.HC category? Give their titles and "
      "arXiv IDs.", check=_recent_ids,
      expect="Five cs.HC papers submitted in the last days (ids 2611.xxxxx), from arXiv's own API."),
    Q("r4", "research", "empty", "In two sentences, what does the arXiv paper 2005.11401 propose?",
      [r"retriev", r"wikipedia|dense|non-?parametric|dpr|memory"],
      expect="Retrieval-Augmented Generation (Lewis et al.): a seq2seq generator with a dense retriever over a "
             "Wikipedia index (non-parametric memory)."),
    Q("r5", "research", "empty", "Find the five most-cited arXiv papers about chain-of-thought prompting, with their "
      "citation counts.", [r"2201\.11903|elicits reasoning"], check=lambda t: (bool(re.search(r"\d{3,}", t)), "no counts"),
      expect="Wei et al. 2201.11903 'Chain-of-Thought Prompting Elicits Reasoning in LLMs' among them, with counts."),
    Q("r6", "research", "empty", "In the Data Formulator paper on arXiv (2309.10094), how many of the user-study "
      "participants were female, and where were they recruited from?",
      [r"\b(3|three)\b[^.]{0,40}(female|wom[ae]n)|(female|wom[ae]n)[^.]{0,40}\b(3|three)\b",
       r"technology company|tech(nology)? (company|firm)"],
      expect="3 of 10 (3 female, 7 male), recruited from a large technology company: only in the full text."),
    Q("r7", "research", "empty", "Find arXiv papers from 2025 on using large language models to generate "
      "visualizations, load them as a table, and chart how many were published each month.", needs_chart=True,
      expect="A table of 2025 papers on LLM-based visualization generation and a monthly count chart."),
    # Hugging Face datasets
    Q("h1", "hf", "empty", "Find a World Happiness Report dataset on Hugging Face and chart the 10 happiest countries.",
      [r"finland"], needs_chart=True,
      expect="A real WHR dataset (e.g. a 2023 mirror), loaded; a top-10 chart with Finland first; says which dataset."),
    Q("h2", "hf", "empty", "How many rows does the train split of the Hugging Face dataset scikit-learn/iris have, "
      "and what are its columns?", [r"\b150\b", r"sepal", r"petal", r"species"],
      expect="150 rows; Id, SepalLengthCm, SepalWidthCm, PetalLengthCm, PetalWidthCm, Species."),
    Q("h3", "hf", "empty", "In the test split of the Hugging Face IMDB dataset (stanfordnlp/imdb), what share of the "
      "reviews are positive?", [r"50\s?%|12,?500|\bhalf\b|0\.5\b"],
      expect="50% (12,500 of 25,000). Loading only the label column, or the viewer's statistics, suffices."),
    Q("h4", "hf", "empty", "Show me 3 example questions from the test split of openai/gsm8k on Hugging Face, and tell "
      "me how many rows that split has.", [r"1,?319"],
      expect="Three real GSM8K test questions; 1,319 rows (main config)."),
    Q("h5", "hf", "empty", "Which are the 5 most-downloaded tabular datasets on Hugging Face about stock prices? Give "
      "each one's id and license.", check=_repo_ids,
      expect="Five real dataset ids from a Hub search sorted by downloads, with licenses (verified post hoc)."),
    Q("h6", "hf", "empty", "Preview 5 rows of the Hugging Face dataset meta-llama/Llama-3.1-8B-Instruct-evals.",
      [r"gated|accept|terms|token|authenticat|access"],
      expect="It is gated: say so and how to get access (accept terms, add a token); no fabricated rows. "
             "With accounts: offer a Hugging Face sign-in (and the terms step); declined, explain without rows.",
      grounded="attempt", signin=True),
    Q("h7", "hf", "empty", "Using the adult census income dataset on Hugging Face (scikit-learn/adult-census-income), "
      "what share of men and of women earn more than $50K? Chart it.",
      [r"30\.[5-7]|31(\.0)?\s?%", r"10\.[89]|11(\.0)?\s?%"], needs_chart=True,
      expect="Men 30.6%, women 10.9% of 32,561 rows; a chart."),
    # Off-topic: workspace data, and web data the packs do not cover
    # Sign-in to services that are not built in (accounts condition)
    Q("k1", "signin", "empty", "Load the World Happiness Report 2023 dataset from Kaggle "
      "(ajaypalsinghlo/world-happiness-report-2023) and chart the 10 happiest countries.", [r"finland"], needs_chart=True,
      expect="Kaggle serves public datasets without a key: download it anonymously (terminal), chart it; no sign-in."),
    Q("k2", "signin", "empty", "Get train.csv from the Titanic competition on Kaggle and tell me how many passengers "
      "it lists.", [r"kaggle"], grounded="attempt", signin=True,
      signin_check=lambda form: _kaggle_spec(form),
      expect="Competition data needs a Kaggle key (401): offer a Kaggle sign-in spec (www.kaggle.com, bearer KGAT_ token, with "
             "the step to accept the competition rules); declined, say what is missing and offer alternatives."),
    Q("x1", "signin", "empty", "https://httpbin.org/bearer needs a bearer token, and I have one. Call it as me and tell "
      "me whether it says I am authenticated.", [r"authenticated"], signin=True,
      signin_check=lambda form: _httpbin_spec(form),
      expect="Offer a sign-in spec for httpbin.org (bearer); signed in with a test key, fetch with api_fetch and report "
             "authenticated: true. The key never reaches the agent."),
    Q("g1", "signin", "empty", "Sign me in to GitHub, then list my private repositories.", [r"github"],
      grounded="attempt", signin=True, signin_check=lambda form: _github_spec(form),
      expect="Offer a GitHub sign-in spec (api.github.com, bearer) that reads the gh login on this computer (local: gh auth token), "
             "so the card can offer it next to a token; declined, say what is missing."),
    Q("o1", "off", "unemployment", "Which industry had the highest unemployment rate in January 2010, and what was the "
      "rate?", [r"construction", r"24\.7"], grounded=False, expect="Construction, 24.7%."),
    Q("o2", "off", "stocks", "Over the period in the data, which stock gained the most, and by roughly what percentage?",
      [r"googl|alphabet|google", r"7[34](\.\d)?\s?%"], grounded=False, expect="GOOGL, ~73-74%."),
    Q("o3", "off", "earthquake", "What was the strongest earthquake in the data, and where was it?",
      [r"7\.7", r"panama"], grounded=False, expect="M7.7, Panama."),
    Q("o4", "off", "empty", "Pull today's earthquakes from the USGS feed and chart them by magnitude.",
      needs_chart=True, expect="USGS GeoJSON feed fetched with the terminal, loaded, charted; no pack tools."),
]
QUESTIONS_BY_ID = {question.id: question for question in QUESTIONS}


# ── servers ──────────────────────────────────────────────────────────────

def build_skill_backend() -> Path:
    """py-src as it is, plus the guidance-only skills: the skill condition's backend."""
    target = BACKEND / "py-src"
    shutil.rmtree(BACKEND, ignore_errors=True)
    shutil.copytree(REPO / "py-src", target, ignore=shutil.ignore_patterns("__pycache__", "dist", "*.egg-info"))
    dist = REPO / "py-src" / "data_formulator" / "dist"
    if dist.exists():
        (target / "data_formulator" / "dist").symlink_to(dist)
    for skill in SKILLS.iterdir():
        if (skill / "SKILL.md").exists():
            shutil.copytree(skill, target / "data_formulator" / "analyst" / "skills" / skill.name)
    return target


class EvalServer(harness.Server):
    def __init__(self, run_dir: Path, condition: str, backend: Path | None = None):
        super().__init__(run_dir)
        self.condition = condition
        self.backend = backend
        self.identity = ""

    def start(self) -> None:
        saved = {key: os.environ.get(key) for key in ("DF_EVAL_BACKEND", "DF_TERMINAL_MODE")}
        os.environ["DF_TERMINAL_MODE"] = "auto"
        if self.backend:
            os.environ["DF_EVAL_BACKEND"] = str(self.backend)
        else:
            os.environ.pop("DF_EVAL_BACKEND", None)
        launcher = harness.LAUNCHER
        # Only the accounts condition sees the provider skills (huggingface + api_fetch, design-docs/72); the others
        # are as the packs were evaluated.
        if self.condition != "accounts":
            harness.LAUNCHER = NO_ACCOUNTS + launcher
        try:
            super().start()
        finally:
            harness.LAUNCHER = launcher
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        assert self.user_home is not None
        self.identity = "local:" + self.user_home.name.removeprefix("local")
        if self.condition == "tools":
            self._add_packs()

    def _add_packs(self) -> None:
        headers = {"Origin": self.base, "Sec-Fetch-Site": "same-origin", "X-DF-Configuration": "1"}
        for pack in PACKS:
            response = requests.post(f"{self.base}/api/mcp/packs/{pack}", json={"settings": {}}, headers=headers, timeout=60)
            response.raise_for_status()
            server_id = (response.json().get("data") or response.json())["id"]
            connected = requests.post(f"{self.base}/api/mcp/servers/{server_id}/connect", json={}, headers=headers,
                                      timeout=120)
            connected.raise_for_status()
            data = connected.json().get("data") or connected.json()
            tools = [tool["name"] for tool in (data.get("server") or {}).get("tools", []) if not tool.get("pending")]
            if data.get("status") != "connected" or not tools:
                raise RuntimeError(f"pack {pack} did not connect: {json.dumps(data)[:400]}")
            print(f"[tools] {pack} -> {server_id}: {', '.join(tools)}", flush=True)

    def clear_pack_cache(self) -> None:
        for pack in PACKS:
            shutil.rmtree(self.home / "cache" / pack, ignore_errors=True)


def _model(model: str) -> dict[str, Any]:
    from data_formulator.model_registry import ModelRegistry
    return {"id": ModelRegistry.make_id("azure", model), "is_global": True, "reasoning_effort": "low"}


# ── running ──────────────────────────────────────────────────────────────

GO_AHEAD = "Go ahead and use your best judgment; find the data online if needed."


def run_one(server: EvalServer, question: Question, model: str, raw_dir: Path) -> dict[str, Any]:
    workspace_id = f"te-{question.id}-{server.condition}-{model.replace('.', '')}-{uuid.uuid4().hex[:4]}"
    state = server.prepare_workspace(question.session, workspace_id, None)
    if server.condition == "tools":
        server.clear_pack_cache()
    body = harness.request_body(multiturn._session_state(state), question.prompt, "")
    body["model"] = _model(model)
    events: list[dict] = []
    started = time.time()
    final_text, error, pauses, stop = "", None, [], None
    signin_forms: list[dict] = []
    for attempt in range(5):
        tag = f"{question.id}-{server.condition}-{model}-{attempt}"
        raw = raw_dir / f"{tag}.jsonl"
        for retry in range(4):
            trace = harness.run_case(server, workspace_id, body, tail=1e9, budget=900, raw_path=raw)
            if not any(step.kind == "error" and "Rate limit" in str(step.detail) for step in trace.steps):
                break
            time.sleep(30 * (retry + 1))
        segment = multiturn._events(raw)
        events += segment
        final_text += ("\n" if final_text else "") + (trace.final_text or "")
        error = trace.error or next((json.dumps(e)[:300] for e in segment if e.get("type") == "error"), None)
        pause = next((e for e in reversed(segment) if e.get("type") == "interact"), None)
        if pause is None:
            break
        resume = {**body, "trajectory": pause.get("trajectory"),
                  "completed_step_count": pause.get("completed_step_count", 0)}
        resume.pop("interaction_response", None)
        operation = pause.get("data_operation") or {}
        if operation.get("id") and operation.get("plans"):
            pauses.append("data_operation")
            resume["interaction_response"] = {"operation_id": operation["id"], "plan_id": operation["plans"][0]["id"]}
            resume["user_question"] = "Load it."
        elif pause.get("terminal_request"):
            pauses.append("unsandboxed_terminal")
            stop = "unsandboxed terminal request"
            break
        elif pause.get("mcp_request"):
            pauses.append("mcp_approval")
            stop = "MCP approval request"
            break
        elif (pause.get("form") or {}).get("kind") == "signin":
            # Answered as the card would: signed in with a test key where the harness has one (saved through the
            # app's own route, which checks the key), else a user who chooses not to sign in.
            signin = pause["form"].get("signin") or {}
            signin_forms.append(signin)
            pauses.append(f"signin:{signin.get('provider')}:{signin.get('reason')}")
            name = signin.get("provider_name") or signin.get("provider")
            spec = signin.get("spec") or {}
            key = next((TEST_KEYS[host] for host in spec.get("send_to") or [] if host in TEST_KEYS), None)
            saved = key and not spec.get("verified") and requests.post(
                f"{server.base}/api/accounts/custom", json={"spec": spec, "secret": {"token": key}},  # kept for this session, the app's default
                headers={"Origin": server.base, "Sec-Fetch-Site": "same-origin", "X-DF-Configuration": "1",
                         "X-Workspace-Id": workspace_id}, timeout=60).json()
            if saved and (saved.get("data") or {}).get("signed_in"):
                pauses[-1] += ":signed_in"
                resume["user_question"] = f"Signed in to {name}. Continue."
            else:
                if saved:
                    pauses[-1] += f":save_failed:{json.dumps(saved.get('error'))[:120]}"
                resume["user_question"] = DECLINE.format(name=name)
        elif pause.get("form"):
            pauses.append(f"form:{pause['form'].get('kind')}")
            stop = "form"
            break
        else:
            pauses.append("question")
            resume["user_question"] = GO_AHEAD
        body = resume
    seconds = round(time.time() - started, 1)
    return {"workspace_id": workspace_id, "events": events, "final_text": final_text, "error": error,
            "pauses": pauses, "stop": stop, "started": started, "seconds": seconds, "signin_forms": signin_forms,
            "leaked": any(key in json.dumps(events) for key in TEST_KEYS.values())}


# ── metrics ──────────────────────────────────────────────────────────────

_RATE = re.compile(r"rate[- ]limit|rate exceeded|HTTP 429|\b429\b|too many requests|daily budget", re.I)


def _args(event: dict) -> dict:
    args = event.get("args")
    if isinstance(args, str):
        try:
            import ast
            return ast.literal_eval(args)
        except Exception:
            return {"raw": args}
    return args if isinstance(args, dict) else {}


def metrics(events: list[dict]) -> dict[str, Any]:
    tools: list[str] = []
    skills: list[str] = []
    mcp: list[dict] = []
    api: list[dict] = []
    terminal: list[dict] = []
    created = 0
    charts = 0
    rate_limited = 0
    for event in events:
        kind = event.get("type")
        if kind == "tool_start" and event.get("tool"):
            tools.append(event["tool"])
            if event["tool"] == "load_skill":
                skills.append(str(_args(event).get("name") or _args(event).get("raw") or "?"))
            if event["tool"] == "create_data":
                created += 1
        elif kind == "result":
            charts += 1
        elif kind == "tool_result" and event.get("tool") == "api_fetch":
            try:
                result = json.loads(event.get("stdout") or "{}")
            except json.JSONDecodeError:
                result = {"error": "unparsable"}
            status = result.get("status")
            api.append({"url": str(result.get("url") or "")[:200], "status": status,
                        "ok": isinstance(status, int) and 200 <= status < 300 and bool(result.get("saved")),
                        **({"needs_signin": result["needs_signin"]["reason"]} if result.get("needs_signin") else {}),
                        **({"error": str(result["error"])[:160]} if result.get("error") else {})})
            rate_limited += status == 429
        elif kind == "mcp_result":
            request, result = event.get("request") or {}, event.get("result") or {}
            text = json.dumps(result, default=str)
            failed = bool(result.get("error")) or bool(result.get("is_error"))
            mcp.append({"tool": request.get("tool"), "ok": not failed, "error": str(result.get("error") or "")[:200]})
            rate_limited += bool(_RATE.search(text))
        elif kind == "terminal_result" and event.get("request"):
            request, result = event["request"], event.get("result") or {}
            output = str(result.get("output") or result.get("error") or "")
            # A background task (start_task) reports its launch here; its outcome comes through wait_tasks.
            background = bool(request.get("background")) or output.startswith("Running in the background")
            ok = (result.get("exit_code") == 0 or background) and not result.get("timed_out")
            terminal.append({"argv": " ".join(map(str, request.get("argv") or []))[:300], "ok": ok,
                             "exit": result.get("exit_code"), "tail": output[-200:] if not ok else ""})
            rate_limited += bool(_RATE.search(output[-4000:]))
    external_ok = any(call["ok"] for call in (*mcp, *api, *terminal))
    routes = [name for name, calls in (("tool", mcp), ("api", api), ("terminal", terminal)) if calls]
    route = "+".join(routes) or "none"
    return {"tools": tools, "skills": skills, "mcp_calls": mcp, "api_calls": api, "terminal_calls": terminal, "route": route,
            "external_ok": external_ok, "n_mcp": len(mcp), "n_mcp_fail": sum(not c["ok"] for c in mcp),
            "n_api": len(api), "n_api_fail": sum(not c["ok"] for c in api),
            "n_terminal": len(terminal), "n_terminal_fail": sum(not c["ok"] for c in terminal),
            "n_tool_calls": len(tools), "created_data": created, "charts": charts, "rate_limited": rate_limited}


def llm_usage(server: EvalServer, workspace_id: str) -> dict[str, Any]:
    key = hashlib.sha256(f"{server.identity}:{workspace_id}".encode()).hexdigest()[:32]
    calls = []
    path = server.home / "llm_calls.jsonl"
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("key") == key:
                calls.append(record)
    return {"model_calls": len(calls),
            "input_tokens": sum(c.get("input_tokens") or 0 for c in calls),
            "cached_tokens": sum(c.get("cached_tokens") or 0 for c in calls),
            "output_tokens": sum(c.get("output_tokens") or 0 for c in calls),
            "first_call_input": calls[0].get("input_tokens") if calls else None,
            "first_call_tool_chars": calls[0].get("tool_chars") if calls else None,
            "first_call_system_chars": calls[0].get("system_chars") if calls else None,
            "llm_seconds": round(sum(c.get("total") or 0 for c in calls), 1)}


def grade(question: Question, result: dict[str, Any], measured: dict[str, Any], condition: str = "") -> tuple[bool, list[str]]:
    text = result["final_text"]
    reasons = []
    if result["error"] and not text:
        reasons.append(f"error: {str(result['error'])[:120]}")
    missing = [pattern for pattern in question.answer if not re.search(pattern, text, re.I)]
    if missing:
        reasons.append(f"answer lacks {missing}")
    if question.check:
        ok, why = question.check(text)
        if not ok:
            reasons.append(why)
    if question.needs_chart and not measured["charts"]:
        reasons.append("no chart")
    attempted = measured["n_mcp"] + measured.get("n_api", 0) + measured["n_terminal"] > 0
    if question.grounded == "attempt" and not attempted:
        reasons.append("not grounded (no external call)")
    elif question.grounded is True and not measured["external_ok"]:
        reasons.append("not grounded (no successful external call)")
    if result["stop"]:
        reasons.append(f"stopped: {result['stop']}")
    if condition == "accounts":
        offered = any(str(pause).startswith("signin:") for pause in result.get("pauses") or [])
        if question.signin and not offered:
            reasons.append("did not offer a sign-in")
        elif offered and not question.signin:
            reasons.append("offered a sign-in it did not need")
        for form in result.get("signin_forms") or []:
            if question.signin_check:
                ok, why = question.signin_check(form)
                if not ok:
                    reasons.append(why)
        if result.get("leaked"):
            reasons.append("a test key reached the agent's stream")
    return not reasons, reasons


# ── orchestration ────────────────────────────────────────────────────────

def run(args: argparse.Namespace) -> Path:
    harness.snapshot_templates()
    run_dir = ROOT / "runs" / args.name
    run_dir.mkdir(parents=True, exist_ok=True)
    conditions = args.conditions
    servers: dict[str, EvalServer] = {}
    backend = build_skill_backend() if "skill" in conditions else None
    for condition in conditions:
        server_dir = run_dir / condition
        (server_dir / "traces").mkdir(parents=True, exist_ok=True)
        server = EvalServer(server_dir, condition, backend if condition == "skill" else None)
        server.start()
        servers[condition] = server
        print(f"[{condition}] up at {server.base}", flush=True)
    questions = [QUESTIONS_BY_ID[q] for q in args.questions] if args.questions else QUESTIONS
    # Interleave so budget exhaustion and arXiv throttling hit every condition alike: per question and model, all
    # conditions run back to back in a random order.
    rng = random.Random(args.seed)
    pending = []
    for question in questions:
        for model in args.models:
            order = list(conditions)
            rng.shuffle(order)
            pending += [(question, model, condition) for condition in order]
    lock = threading.Lock()
    results_path = run_dir / "results.jsonl"

    def worker() -> None:
        while True:
            with lock:
                if not pending:
                    return
                question, model, condition = pending.pop(0)
            server = servers[condition]
            try:
                result = run_one(server, question, model, server.run_dir / "traces")
                measured = metrics(result["events"])
                usage = llm_usage(server, result["workspace_id"])
                ok, reasons = grade(question, result, measured, condition)
            except Exception as exc:  # noqa: BLE001 - one broken run must not stop the rest
                result = {"workspace_id": "", "final_text": "", "error": f"{type(exc).__name__}: {exc}", "pauses": [],
                          "stop": "harness error", "started": time.time(), "seconds": 0}
                measured, usage, ok, reasons = metrics([]), {}, False, [f"harness error: {exc}"]
            row = {"question": question.id, "topic": question.topic, "condition": condition, "model": model,
                   "ok": ok, "reasons": reasons, "seconds": result["seconds"], "started": result["started"],
                   "workspace_id": result["workspace_id"], "pauses": result["pauses"], "stop": result["stop"],
                   "signin_forms": result.get("signin_forms", []), "leaked": result.get("leaked", False),
                   "error": result["error"], **{k: v for k, v in measured.items()}, **usage,
                   "final_text": result["final_text"][:6000]}
            with lock:
                with open(results_path, "a") as out:
                    out.write(json.dumps(row, default=str) + "\n")
            print(f"{question.id:3} {condition:5} {model:12} {'PASS' if ok else 'FAIL'} {result['seconds']:6.1f}s "
                  f"route={measured['route']:13} mcp={measured['n_mcp']}/{measured['n_mcp_fail']}f "
                  f"api={measured['n_api']}/{measured['n_api_fail']}f term={measured['n_terminal']}/{measured['n_terminal_fail']}f "
                  f"rl={measured['rate_limited']} pauses={result['pauses']} "
                  f"skills={measured['skills']} {'; '.join(reasons)[:140]}", flush=True)

    threads = [threading.Thread(target=worker) for _ in range(args.workers)]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        for server in servers.values():
            server.stop()
    report(run_dir)
    return run_dir


# ── report ───────────────────────────────────────────────────────────────

def _regrade(run_dir: Path, row: dict) -> None:
    """Recompute a run's metrics and grade from its saved traces (after a metric or check changes)."""
    traces = sorted((run_dir / row["condition"] / "traces").glob(f"{row['question']}-{row['condition']}-{row['model']}-*.jsonl"))
    question = QUESTIONS_BY_ID.get(row["question"])
    if not traces or question is None:
        return
    events = [event for path in traces for event in multiturn._events(path)]
    measured = metrics(events)
    ok, reasons = grade(question, {"final_text": row["final_text"], "error": row["error"], "stop": row["stop"],
                                   "pauses": row.get("pauses"), "signin_forms": row.get("signin_forms"),
                                   "leaked": row.get("leaked")}, measured, row["condition"])
    row.update(measured, ok=ok, reasons=reasons)


def _rows(run_dir: Path) -> list[dict]:
    path = run_dir / "results.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    for row in rows:
        _regrade(run_dir, row)
    overrides = run_dir / "grades.json"  # manual review: {"<question>|<condition>|<model>": {"ok": bool, "note": ""}}
    if overrides.exists():
        manual = json.loads(overrides.read_text())
        for row in rows:
            entry = manual.get(f"{row['question']}|{row['condition']}|{row['model']}")
            if entry is not None:
                row["auto_ok"], row["ok"], row["note"] = row["ok"], entry["ok"], entry.get("note", "")
    return rows


def _median(values: list[float]) -> str:
    values = [v for v in values if v is not None]
    return f"{statistics.median(values):.0f}" if values else "-"


def report(run_dir: Path) -> None:
    rows = _rows(run_dir)
    lines = [f"# Tool pack eval: {run_dir.name}", "", f"{len(rows)} runs.", ""]
    lines += ["## By topic and condition (both models)", "",
              "| Topic | Condition | Pass | Median s | Median model calls | Median input tokens | MCP calls (fail) | "
              "API calls (fail) | Terminal calls (fail) | Rate-limit hits |", "|---|---|---|---|---|---|---|---|---|---|"]
    for topic in ("research", "hf", "signin", "off"):
        for condition in CONDITIONS:
            group = [r for r in rows if r["topic"] == topic and r["condition"] == condition]
            if not group:
                continue
            lines.append(
                f"| {topic} | {condition} | {sum(r['ok'] for r in group)}/{len(group)} | "
                f"{_median([r['seconds'] for r in group])} | {_median([r.get('model_calls') for r in group])} | "
                f"{_median([r.get('input_tokens') for r in group])} | {sum(r['n_mcp'] for r in group)} "
                f"({sum(r['n_mcp_fail'] for r in group)}) | {sum(r.get('n_api', 0) for r in group)} "
                f"({sum(r.get('n_api_fail', 0) for r in group)}) | {sum(r['n_terminal'] for r in group)} "
                f"({sum(r['n_terminal_fail'] for r in group)}) | {sum(r['rate_limited'] for r in group)} |")
    lines += ["", "## By model and condition", "", "| Model | Condition | Research | HF | Sign-in | Off-topic |", "|---|---|---|---|---|---|"]
    for model in MODELS:
        for condition in CONDITIONS:
            cells = []
            for topic in ("research", "hf", "signin", "off"):
                group = [r for r in rows if r["model"] == model and r["condition"] == condition and r["topic"] == topic]
                cells.append(f"{sum(r['ok'] for r in group)}/{len(group)}" if group else "-")
            if any(cell != "-" for cell in cells):
                lines.append(f"| {model} | {condition} | " + " | ".join(cells) + " |")
    lines += ["", "## Every run", "",
              "| Q | Condition | Model | Pass | s | Calls | In tok | Route | MCP (fail) | API (fail) | Term (fail) | RL | Skills | Pauses | Why |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for row in sorted(rows, key=lambda r: (r["question"], r["model"], CONDITIONS.index(r["condition"]))):
        why = "; ".join(row["reasons"]) if not row.get("note") else row["note"]
        lines.append(
            f"| {row['question']} | {row['condition']} | {row['model']} | {'✅' if row['ok'] else '❌'} | {row['seconds']:.0f} | "
            f"{row.get('model_calls', '-')} | {row.get('input_tokens', '-')} | {row['route']} | {row['n_mcp']} ({row['n_mcp_fail']}) | "
            f"{row.get('n_api', 0)} ({row.get('n_api_fail', 0)}) | "
            f"{row['n_terminal']} ({row['n_terminal_fail']}) | {row['rate_limited']} | {', '.join(row['skills'])} | "
            f"{', '.join(map(str, row.get('pauses') or []))} | "
            f"{why[:160].replace('|', '/')} |")
    (run_dir / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:40]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--questions", nargs="*")
    parser.add_argument("--models", nargs="*", default=list(MODELS))
    parser.add_argument("--conditions", nargs="*", default=list(CONDITIONS), choices=CONDITIONS)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.report:
        report(args.report)
    else:
        run(args)


if __name__ == "__main__":
    main()
