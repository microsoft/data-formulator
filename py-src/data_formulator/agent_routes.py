# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import random
import sys
import os
import mimetypes
import re
import traceback
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')

import flask
from flask import request, session, jsonify, Blueprint, current_app, Response, stream_with_context
import logging

import json
import html
import time
import threading
import pandas as pd

from data_formulator.agents.agent_concept_derive import ConceptDeriveAgent
from data_formulator.agents.agent_py_concept_derive import PyConceptDeriveAgent

from data_formulator.agents.agent_py_data_transform import PythonDataTransformationAgent
from data_formulator.agents.agent_sql_data_transform import SQLDataTransformationAgent
from data_formulator.agents.agent_py_data_rec import PythonDataRecAgent
from data_formulator.agents.agent_sql_data_rec import SQLDataRecAgent

from data_formulator.agents.agent_sort_data import SortDataAgent
from data_formulator.agents.agent_data_load import DataLoadAgent
from data_formulator.agents.agent_data_clean import DataCleanAgent
from data_formulator.agents.agent_data_clean_stream import DataCleanAgentStream
from data_formulator.agents.agent_code_explanation import CodeExplanationAgent
from data_formulator.agents.agent_query_completion import QueryCompletionAgent
from data_formulator.agents.agent_report_gen import ReportGenAgent
from data_formulator.agents.agent_utils import log_prompt_to_clickhouse
from data_formulator.agents.prompt_guard_agent import extract_all_columns_from_input_tables
from data_formulator.agents.client_utils import Client
from data_formulator.agents.prompt_classifier import (
    PROMPT_CONCRETE,
)
from data_formulator.agents.agent_smart_chat import SmartChatAgent, SmartChatResult
from data_formulator.agents.chart_type_resolver import to_internal
from data_formulator.agents.drawable_catalog import build_drawable_catalog
from data_formulator.agents.field_metadata import compute_from_dataframe
from data_formulator.agents.qc_chart_config import is_qc_data

from data_formulator.db_manager import db_manager

# Get logger for this module (logging config done in app.py)
logger = logging.getLogger(__name__)
QC_SPECIAL_CHARTS = {"QC Trend Line", "QC Histogram", "QC Trend Bar"}


def _log_telemetry_event(event_name: str, payload: dict):
    """Best-effort telemetry sink via existing ClickHouse prompt log table."""
    try:
        safe_payload = json.dumps(payload, ensure_ascii=False)
        log_prompt_to_clickhouse(
            agent_name=f"telemetry_{event_name}",
            prompt_text=safe_payload,
            user_id=session.get("username") or session.get("user_id"),
        )
    except Exception as e:
        logger.warning(f"Telemetry logging failed for {event_name}: {e}")

# ─── Rate limiter (fixed-window, per session) ───────────────────────────────
_rl_lock = threading.Lock()
_rl_windows: dict = {}  # key -> {"count": int, "window_start": float}

def _is_rate_limited(key: str, max_requests: int, window_seconds: int = 60) -> bool:
    """Returns True if the caller has exceeded max_requests in the window."""
    now = time.monotonic()
    with _rl_lock:
        window = _rl_windows.get(key)
        if window is None or (now - window["window_start"]) > window_seconds:
            _rl_windows[key] = {"count": 1, "window_start": now}
            return False
        window["count"] += 1
        return window["count"] > max_requests

# Max conversation messages kept in repair-loop context (prevents token bloat)
MAX_DIALOG_HISTORY = 6
# ────────────────────────────────────────────────────────────────────────────

agent_bp = Blueprint('agent', __name__, url_prefix='/api/agent')

# Cache for check-available-models (TTL = 5 minutes)
_models_cache: dict = {"result": None, "timestamp": 0.0}
_MODELS_CACHE_TTL = 300  # seconds

def get_client(model_config):
    for key in model_config:
        if isinstance(model_config[key], str):
            model_config[key] = model_config[key].strip()

    # If api_key was stripped from frontend response for security,
    # fall back to env var based on provider endpoint
    api_key = model_config.get("api_key") or os.getenv(
        f"{model_config.get('endpoint', '').upper()}_API_KEY", ""
    ) or None

    client = Client(
        model_config["endpoint"],
        model_config["model"],
        api_key,
        html.escape(model_config["api_base"]) if "api_base" in model_config else None,
        model_config["api_version"] if "api_version" in model_config else None)

    return client


def get_lightweight_client(main_client) -> Client:
    """
    Returns a cheap/fast client for lightweight tasks (guard, idea generation).
    Reads AZURE_LIGHTWEIGHT_MODEL (or LIGHTWEIGHT_MODEL) env var.
    Falls back to main_client if not configured — safe default, zero-config required.
    """
    lightweight_model = (
        os.getenv("AZURE_LIGHTWEIGHT_MODEL")
        or os.getenv("LIGHTWEIGHT_MODEL")
    )
    if not lightweight_model:
        return main_client  # no tiering configured — use main model

    params = main_client.params
    return Client(
        main_client.endpoint,
        lightweight_model,
        params.get("api_key"),
        params.get("api_base"),
        params.get("api_version"),
    )


@agent_bp.route('/check-available-models', methods=['GET', 'POST'])
def check_available_models():
    # Return cached result if still fresh
    now = time.monotonic()
    if _models_cache["result"] is not None and (now - _models_cache["timestamp"]) < _MODELS_CACHE_TTL:
        return json.dumps(_models_cache["result"])

    results = []
    
    # Define configurations for different providers
    providers = ['openai', 'azure', 'anthropic', 'gemini', 'ollama']

    for provider in providers:
        # Skip if provider is not enabled
        if not os.getenv(f"{provider.upper()}_ENABLED", "").lower() == "true":
            continue
        
        api_key = os.getenv(f"{provider.upper()}_API_KEY", "")
        api_base = os.getenv(f"{provider.upper()}_API_BASE", "")
        api_version = os.getenv(f"{provider.upper()}_API_VERSION", "")
        models = os.getenv(f"{provider.upper()}_MODELS", "")

        if not (api_key or api_base):
            continue

        if not models:
            continue

        # Build config for each model
        for model in models.split(","):
            model = model.strip()
            if not model:
                continue

            model_config = {
                "id": f"{provider}-{model}-{api_base}-{api_version}",
                "endpoint": provider,
                "model": model,
                "api_key": api_key,
                "api_base": api_base,
                "api_version": api_version
            }
            
            try:
                client = get_client(model_config)
                response = client.get_completion(
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant."},
                        {"role": "user", "content": "Respond 'I can hear you.' if you can hear me."},
                    ]
                )
                
                if "I can hear you." in response.choices[0].message.content:
                    results.append(model_config)
            except Exception as e:
                print(f"Error testing {provider} model {model}: {e}")

    # Update cache (strip api_key before storing — safe to return to frontend)
    safe_results = [{k: v for k, v in m.items() if k != "api_key"} for m in results]
    _models_cache["result"] = safe_results
    _models_cache["timestamp"] = time.monotonic()
    return json.dumps(safe_results)

def sanitize_model_error(error_message: str) -> str:
    """Sanitize model API error messages before sending to client."""
    # HTML escape the message
    message = html.escape(error_message)
    
    # Remove any potential API keys that might be in the error
    message = re.sub(r'(api[-_]?key|api[-_]?token)[=:]\s*[^\s&]+', r'\1=<redacted>', message, flags=re.IGNORECASE)
    
    # Keep only the essential error info
    if len(message) > 500:  # Truncate very long messages
        message = message[:500] + "..."
        
    return message


MAX_SAMPLE_ROWS = 3
MAX_COLS_IN_SAMPLE = 8
MAX_CELL_LEN = 25


def _truncate_cell(val) -> str:
    s = str(val) if val is not None else ""
    return s if len(s) <= MAX_CELL_LEN else (s[:MAX_CELL_LEN] + "...")


def _build_field_metas_from_input_tables(input_tables) -> dict:
    """Build unified FieldMeta map from input tables using shared API."""
    metas = {}
    for table in input_tables:
        rows = table.get("rows", [])
        df = pd.DataFrame.from_records(rows)
        table_metas = compute_from_dataframe(df)
        for col_name, meta in table_metas.items():
            metas.setdefault(col_name, meta)
    return metas


def _extract_sample_rows(input_tables) -> list[dict]:
    for table in input_tables:
        rows = table.get("rows", [])
        if not rows:
            continue
        n = len(rows)
        if n == 1:
            idxs = [0]
        elif n == 2:
            idxs = [0, 1]
        else:
            idxs = [0, n // 2, n - 1]

        all_cols = list(rows[0].keys())
        qc_limit_cols = {"TARGET", "LL", "UL", "ARLL", "ARUL"}
        priority_cols = [c for c in all_cols if c.upper() not in qc_limit_cols]
        display_cols = (priority_cols + [c for c in all_cols if c not in priority_cols])[:MAX_COLS_IN_SAMPLE]

        sample = []
        for i in idxs[:MAX_SAMPLE_ROWS]:
            row = rows[i]
            sample.append({col: _truncate_cell(row.get(col, "")) for col in display_cols})
        return sample
    return []


def _run_derive_data_core(content):
    token = content["token"]
    client = get_client(content['model'])

    _sid = session.get('session_id', request.remote_addr or 'anon')
    if _is_rate_limited(f"derive:{_sid}", max_requests=20):
        return {"token": token, "status": "error", "results": [{"status": "error", "content": "Too many requests. Please wait a moment before trying again.", "dialog": [], "code": ""}]}, 429

    input_tables = content["input_tables"]
    chart_type = content.get("chart_type", "")
    chart_encodings = content.get("chart_encodings", {})
    user_preferred_chart_type = content.get("user_preferred_chart_type", "")
    instruction = content["extra_prompt"]
    language = content.get("language", "python")
    prompt_source = content.get("prompt_source", "user")
    max_repair_attempts = content.get("max_repair_attempts", 1)
    agent_coding_rules = content.get("agent_coding_rules", "")
    prev_messages = content.get("additional_messages", [])[-MAX_DIALOG_HISTORY:]

    mode = "transform"
    if chart_encodings == {}:
        mode = "recommendation"

    conn = db_manager.get_connection(session['session_id']) if language == "sql" else None
    if mode == "recommendation":
        _lw = get_lightweight_client(client)
        agent = SQLDataRecAgent(client=client, conn=conn, agent_coding_rules=agent_coding_rules, guard_client=_lw) if language == "sql" else PythonDataRecAgent(client=client, exec_python_in_subprocess=current_app.config['CLI_ARGS']['exec_python_in_subprocess'], agent_coding_rules=agent_coding_rules, guard_client=_lw)
        results = agent.run(input_tables, instruction, n=1, prev_messages=prev_messages, prompt_source=prompt_source, user_preferred_chart_type=user_preferred_chart_type)
    else:
        agent = SQLDataTransformationAgent(client=client, conn=conn, agent_coding_rules=agent_coding_rules) if language == "sql" else PythonDataTransformationAgent(client=client, exec_python_in_subprocess=current_app.config['CLI_ARGS']['exec_python_in_subprocess'], agent_coding_rules=agent_coding_rules)
        results = agent.run(input_tables, instruction, chart_type, chart_encodings, prev_messages)

    repair_attempts = 0
    while results and results[0]['status'] == 'error' and repair_attempts < max_repair_attempts:
        error_message = results[0]['content']
        new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."
        prev_dialog = results[0]['dialog'][-MAX_DIALOG_HISTORY:]
        if mode == "transform":
            results = agent.followup(input_tables, prev_dialog, [], chart_type, chart_encodings, new_instruction, n=1)
        if mode == "recommendation":
            results = agent.followup(input_tables, prev_dialog, [], new_instruction, n=1)
        repair_attempts += 1

    if conn:
        conn.close()
    return {"token": token, "status": "ok", "results": results}, 200


def _entry_to_dict(entry):
    if entry.chart_type in QC_SPECIAL_CHARTS:
        return {
            "chart_type": entry.chart_type,
            "encoding": entry.encoding,
            "confidence": entry.confidence,
            "rationale_vi": "",
            "sample_prompt_vi": "",
        }
    rationale_vi, sample_prompt_vi = _build_business_rationale(
        entry.chart_type, entry.encoding, entry.domain
    )
    return {
        "chart_type": entry.chart_type,
        "encoding": entry.encoding,
        "confidence": entry.confidence,
        "rationale_vi": rationale_vi or entry.rationale_vi,
        "sample_prompt_vi": sample_prompt_vi or entry.sample_prompt_vi,
    }


def _get_default_qc_entries():
    return [
        {
            "chart_type": "QC Trend Line",
            "encoding": {"x": "QCDATE", "y": "VALUE", "color": "QCSHIFT"},
            "confidence": 0.9,
            "rationale_vi": "Track VALUE trend over time in QC context to monitor process stability.",
            "sample_prompt_vi": "Draw a QC Trend Line for VALUE by QCDATE / QCSHIFT",
        },
        {
            "chart_type": "QC Histogram",
            "encoding": {"x": "VALUE"},
            "confidence": 0.9,
            "rationale_vi": "Inspect VALUE distribution and variation to evaluate QC behavior.",
            "sample_prompt_vi": "Draw a QC Histogram for VALUE distribution",
        },
        {
            "chart_type": "QC Trend Bar",
            "encoding": {"x": "QCDATE", "y": "VALUE", "color": "QCSHIFT"},
            "confidence": 0.88,
            "rationale_vi": "Compare VALUE trend across shifts/days in bar form.",
            "sample_prompt_vi": "Draw a QC Trend Bar for VALUE by QCDATE",
        },
    ]


def _filter_catalog_by_hint(drawable_catalog, hint: str, top_k: int = 3):
    if not drawable_catalog:
        return []
    if not hint:
        return drawable_catalog[:top_k]
    hint_lower = hint.strip().lower()
    exact = [e for e in drawable_catalog if e.chart_type.lower() == hint_lower]
    if exact:
        rest = [e for e in drawable_catalog if e.chart_type.lower() != hint_lower]
        return (exact + rest)[:top_k]
    fuzzy = [e for e in drawable_catalog if hint_lower in e.chart_type.lower()]
    if fuzzy:
        rest = [e for e in drawable_catalog if e not in fuzzy]
        return (fuzzy + rest)[:top_k]
    return drawable_catalog[:top_k]


def _normalize_chart_type_hint(chart_type_hint: str) -> str:
    return to_internal(chart_type_hint.strip()) if chart_type_hint else ""


def _build_business_rationale(chart_type: str, encoding: dict, domain: str) -> tuple[str, str]:
    def g(key: str, default: str = "") -> str:
        return str(encoding.get(key, default)).strip()

    ct = (chart_type or "").lower()
    x = g("x")
    y = g("y")
    color = g("color")
    theta = g("theta")

    if chart_type == "QC Trend Line":
        value = g("VALUE", "VALUE")
        qdate = g("QCDATE", "QCDATE")
        shift = g("QCSHIFT", "QCSHIFT")
        rationale = (
            f"Group by {shift} and track {value} over {qdate} to monitor quality trend over time "
            "and detect deviations from control behavior."
        )
        prompt = f"Draw a QC Trend Line to track {value} over {qdate}, split by {shift}"
        return rationale, prompt

    if chart_type == "QC Histogram":
        value = g("VALUE", "VALUE")
        rationale = (
            f"Analyze the distribution of {value} to assess spread, central tendency, and QC risk."
        )
        prompt = f"Draw a QC Histogram for {value} distribution to check process stability"
        return rationale, prompt

    if chart_type == "QC Trend Bar":
        value = g("VALUE", "VALUE")
        qdate = g("QCDATE", "QCDATE")
        shift = g("QCSHIFT", "QCSHIFT")
        rationale = (
            f"Aggregate {value} by {qdate} and group by {shift} to compare shift performance."
        )
        prompt = f"Draw a QC Trend Bar with average {value} by {qdate}, grouped by {shift}"
        return rationale, prompt

    if "linear regression" in ct:
        rationale = (
            f"Model {y} against {x} to estimate linear trend; "
            f"{'split by ' + color + ' to compare each group.' if color else 'use it to assess correlation and upward/downward tendency.'}"
        )
        prompt = (
            f"Draw a Linear Regression between {y} and {x}"
            + (f", split by {color}" if color else "")
        )
        return rationale, prompt

    if "loess regression" in ct:
        rationale = (
            f"Smooth the trend of {y} over {x}"
            + (f", split by {color}" if color else "")
            + " to reveal stable underlying trend and reduce point-level noise."
        )
        prompt = (
            f"Draw a Loess Regression to smooth {y} over {x}"
            + (f", split by {color}" if color else "")
        )
        return rationale, prompt

    if "line" in ct:
        rationale = (
            f"Aggregate {y} by {x}"
            + (f" and group by {color}" if color else "")
            + " to track change over sequence/time."
        )
        prompt = (
            f"Draw a Line Chart with average {y} by {x}"
            + (f", grouped by {color}" if color else "")
        )
        return rationale, prompt

    if "bar" in ct:
        rationale = (
            f"Aggregate {y} by {x}"
            + (f", split by {color}" if color else "")
            + " to compare differences across groups."
        )
        prompt = (
            f"Draw a Bar Chart with sum {y} by {x}"
            + (f", grouped by {color}" if color else "")
        )
        return rationale, prompt

    if "scatter" in ct:
        rationale = (
            f"Use {x} and {y} to examine relationship between two variables"
            + (f", and segment by {color}" if color else "")
            + " to detect clusters and outliers."
        )
        prompt = (
            f"Draw a Scatter Plot between {y} and {x}"
            + (f", colored by {color}" if color else "")
        )
        return rationale, prompt

    if "histogram" in ct:
        hx = x or g("VALUE", "VALUE")
        rationale = f"Analyze distribution of {hx} to evaluate spread, skew, and outliers."
        prompt = f"Draw a Histogram for {hx} distribution"
        return rationale, prompt

    if "pie" in ct:
        rationale = f"Compute share of {theta} by {color} to see contribution composition."
        prompt = f"Draw a Pie Chart for {theta} share by {color}"
        return rationale, prompt

    if "heat map" in ct:
        rationale = (
            f"Aggregate values at intersections of {x} and {y}, then use color to highlight high/low regions and anomalies."
        )
        prompt = f"Draw a Heat Map for {x} vs {y}, colored by aggregated value"
        return rationale, prompt

    # default
    keys = ", ".join(f"{k}={v}" for k, v in encoding.items())
    rationale = (
        f"Use fields {keys} to build a meaningful view; "
        "the goal is to summarize data into actionable trend/comparison insight."
    )
    prompt = f"Draw {chart_type} with encoding {keys}"
    if domain == "qc":
        prompt += " for QC analysis"
    return rationale, prompt


def _is_prompt_explicit_fields(prompt: str, columns: list[str]) -> bool:
    text = (prompt or "").lower()
    if not text or not columns:
        return False
    hit_count = 0
    for col in columns:
        c = (col or "").strip().lower()
        if len(c) < 2:
            continue
        if re.search(rf"(?<![a-z0-9_]){re.escape(c)}(?![a-z0-9_])", text):
            hit_count += 1
            if hit_count >= 1:
                return True
    return False


def _select_balanced_suggestions(drawable_catalog, domain: str, top_k: int = 6):
    if not drawable_catalog:
        return []

    def family_key(chart_type: str) -> str:
        c = (chart_type or "").lower()
        if c.startswith("qc"):
            return "qc"
        if "scatter" in c or "regression" in c or "dot" in c:
            return "relation"
        if "bar" in c or "box" in c:
            return "compare"
        if "line" in c or "area" in c or "rolling" in c:
            return "trend"
        if "histogram" in c:
            return "distribution"
        if "pie" in c or "radial" in c:
            return "composition"
        if "heat" in c:
            return "matrix"
        return "other"

    # Group suggestions by family while preserving confidence order.
    families: dict[str, list] = {}
    for e in drawable_catalog:
        k = family_key(getattr(e, "chart_type", ""))
        families.setdefault(k, []).append(e)

    # Domain-aware family priority: QC keeps QC-first, generic emphasizes diversity.
    if domain == "qc":
        family_order = ["qc", "trend", "compare", "distribution", "relation", "composition", "matrix", "other"]
    else:
        family_order = ["compare", "trend", "relation", "distribution", "composition", "matrix", "other"]

    # Round-robin across families for diversity, then fall back by confidence order.
    picks = []
    family_idx = {k: 0 for k in families.keys()}
    while len(picks) < top_k:
        made_progress = False
        for fam in family_order:
            arr = families.get(fam, [])
            idx = family_idx.get(fam, 0)
            if idx < len(arr):
                picks.append(arr[idx])
                family_idx[fam] = idx + 1
                made_progress = True
                if len(picks) >= top_k:
                    break
        if not made_progress:
            break

    if len(picks) < top_k:
        seen = {(p.chart_type, tuple(sorted((p.encoding or {}).items()))) for p in picks}
        for e in drawable_catalog:
            key = (e.chart_type, tuple(sorted((e.encoding or {}).items())))
            if key in seen:
                continue
            picks.append(e)
            seen.add(key)
            if len(picks) >= top_k:
                break

    return picks[:top_k]


def _select_chart_family_suggestions(
    drawable_catalog,
    chart_type_hint: str,
    domain: str,
    top_k: int = 4,
    user_prompt: str = "",
):
    if not chart_type_hint:
        return _select_balanced_suggestions(drawable_catalog, domain, top_k=top_k)
    hint_lower = chart_type_hint.lower()
    prompt_lower = (user_prompt or "").lower()
    explicit_exact_requested = (
        hint_lower in prompt_lower
        or ("bar chart" in prompt_lower and hint_lower == "bar chart")
        or ("line chart" in prompt_lower and hint_lower == "line chart")
        or ("pie chart" in prompt_lower and hint_lower == "pie chart")
    )
    # If user explicitly names an exact chart type that exists in catalog,
    # prioritize multiple encoding variants of that exact chart first.
    exact = [e for e in drawable_catalog if e.chart_type.lower() == hint_lower]
    if explicit_exact_requested and exact:
        if len(exact) >= top_k:
            return exact[:top_k]
        fill_exact = [e for e in drawable_catalog if e not in exact]
        return (exact + fill_exact)[:top_k]
    hint = hint_lower
    family = None
    if "bar" in hint:
        family = "bar"
    elif "line" in hint:
        family = "line"
    elif "box" in hint:
        family = "box"
    elif "scatter" in hint or "dot" in hint:
        family = "scatter"
    elif "histogram" in hint:
        family = "histogram"
    elif "regression" in hint:
        family = "regression"
    elif "pie" in hint:
        family = "pie"
    elif "area" in hint:
        family = "area"
    elif "heat" in hint:
        family = "heat"

    if not family:
        return _select_balanced_suggestions(drawable_catalog, domain, top_k=top_k)

    matched = [e for e in drawable_catalog if family in e.chart_type.lower()]
    if domain == "qc":
        matched = _select_balanced_suggestions(matched, domain, top_k=top_k)
    if len(matched) >= top_k:
        return matched[:top_k]
    fill = [e for e in _select_balanced_suggestions(drawable_catalog, domain, top_k=top_k * 2) if e not in matched]
    return (matched + fill)[:top_k]


def _enrich_suggestions_with_agent(client: Client, prompt: str, domain: str, suggestion_dicts: list[dict]) -> list[dict]:
    if not suggestion_dicts:
        return suggestion_dicts
    # QC special templates use fixed channel->field mappings.
    # Do not let LLM rewrite narrative/prompt for these charts.
    if any(str(s.get("chart_type", "")).strip() in QC_SPECIAL_CHARTS for s in suggestion_dicts):
        return suggestion_dicts
    payload = []
    for s in suggestion_dicts:
        payload.append({
            "chart_type": s.get("chart_type", ""),
            "encoding": s.get("encoding", {}),
        })

    system_prompt = (
        "You are a senior data analyst. For each chart suggestion, explain concretely what to compute and group by.\n"
        "Rules:\n"
        "1) Keep encoding unchanged.\n"
        "2) rationale_vi must state: metric to compute, grouping dimension, and why it is feasible.\n"
        "3) sample_prompt_vi must be executable and specific (mention concrete columns from encoding).\n"
        "4) Do not invent columns outside encoding.\n"
        "5) Return JSON only: {\"items\":[{\"chart_type\":\"...\",\"rationale_vi\":\"...\",\"sample_prompt_vi\":\"...\"}]}\n"
    )
    user_prompt = json.dumps(
        {"user_prompt": prompt, "domain": domain, "suggestions": payload},
        ensure_ascii=False,
    )
    try:
        response = client.get_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
        raw = response.choices[0].message.content.strip()
        parsed = json.loads(raw)
        items = parsed.get("items", []) if isinstance(parsed, dict) else []
        by_type = {str(i.get("chart_type", "")).strip(): i for i in items if isinstance(i, dict)}

        def _looks_like_code_text(text: str) -> bool:
            t = (text or "").strip().lower()
            if not t:
                return False
            code_markers = [
                " = ",
                "data[",
                ".groupby(",
                ".reset_index(",
                ".dropna(",
                ".describe(",
                "plt.",
                "pd.",
                "df[",
                "->",
                "lambda ",
            ]
            return any(m in t for m in code_markers)

        updated = []
        for s in suggestion_dicts:
            ct = s.get("chart_type", "")
            item = by_type.get(ct, {})
            next_s = dict(s)
            if item.get("rationale_vi") and not _looks_like_code_text(str(item.get("rationale_vi", ""))):
                next_s["rationale_vi"] = item["rationale_vi"]
            if item.get("sample_prompt_vi") and not _looks_like_code_text(str(item.get("sample_prompt_vi", ""))):
                next_s["sample_prompt_vi"] = item["sample_prompt_vi"]
            updated.append(next_s)
        return updated
    except Exception as e:
        logger.warning(f"Suggestion enrichment failed, keep defaults: {e}")
        return suggestion_dicts


def _fallback_suggestions_from_fields(field_metas: dict, chart_type_hint: str, domain: str, top_k: int = 4) -> list[dict]:
    if not field_metas:
        return []
    metas = list(field_metas.values())
    quantitative = [m.name for m in metas if getattr(m, "is_quantitative", False)]
    categorical = [m.name for m in metas if getattr(m, "is_categorical", False)]
    temporal = [m.name for m in metas if getattr(m, "is_temporal", False)]

    y = quantitative[0] if quantitative else (metas[0].name if metas else "")
    x_cat = categorical[0] if categorical else (temporal[0] if temporal else (metas[0].name if metas else ""))
    x_time = temporal[0] if temporal else (categorical[0] if categorical else (metas[0].name if metas else ""))

    hint = (chart_type_hint or "").lower()
    suggestions: list[dict] = []

    def add(chart_type: str, encoding: dict, rationale_vi: str, sample_prompt_vi: str):
        if not encoding:
            return
        suggestions.append({
            "chart_type": chart_type,
            "encoding": encoding,
            "confidence": 0.6,
            "rationale_vi": rationale_vi,
            "sample_prompt_vi": sample_prompt_vi,
        })

    if "bar" in hint or not hint:
        add(
            "Bar Chart",
            {"x": x_cat, "y": y},
            f"Aggregate {y} and group by {x_cat} to compare across categories.",
            f"Draw a Bar Chart with sum {y} by {x_cat}",
        )
        add(
            "Grouped Bar Chart",
            {"x": x_cat, "y": y, "color": (categorical[1] if len(categorical) > 1 else x_cat)},
            f"Group {y} by {x_cat} and split by {(categorical[1] if len(categorical) > 1 else x_cat)} for detailed comparison.",
            f"Draw a Grouped Bar Chart with sum {y} by {x_cat}, split by {(categorical[1] if len(categorical) > 1 else x_cat)}",
        )
    if "line" in hint or not hint:
        add(
            "Line Chart",
            {"x": x_time, "y": y},
            f"Track trend of {y} over sequence/time using {x_time}.",
            f"Draw a Line Chart of {y} by {x_time}",
        )
    if domain == "qc":
        add(
            "QC Trend Line",
            {"QCDATE": "QCDATE", "INDEX": "INDEX", "VALUE": "VALUE"},
            "Track VALUE over QC timeline to detect drift from control behavior.",
            "Draw a QC Trend Line for VALUE by QCDATE",
        )

    # dedupe by chart_type
    unique = {}
    for s in suggestions:
        unique[s["chart_type"]] = s
    return list(unique.values())[:top_k]

@agent_bp.route('/test-model', methods=['GET', 'POST'])
def test_model():
    if request.is_json:
        logger.info("# code query: ")
        content = request.get_json()

        # contains endpoint, key, model, api_base, api_version
        logger.info("content------------------------------")
        _safe = {k: ("<redacted>" if k == "api_key" else v) for k, v in content.items()}
        if isinstance(_safe.get("model"), dict):
            _safe["model"] = {k: ("<redacted>" if k == "api_key" else v) for k, v in _safe["model"].items()}
        logger.info(_safe)

        client = get_client(content['model'])
        
        try:
            response = client.get_completion(
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "Respond 'I can hear you.' if you can hear me. Do not say anything other than 'I can hear you.'"},
                ]
            )

            logger.info(f"model: {content['model']}")
            logger.info(f"welcome message: {response.choices[0].message.content}")

            if "I can hear you." in response.choices[0].message.content:
                result = {
                    "model": content['model'],
                    "status": 'ok',
                    "message": ""
                }
        except Exception as e:
            print(f"Error: {e}")
            logger.info(f"Error: {e}")
            result = {
                "model": content['model'],
                "status": 'error',
                "message": sanitize_model_error(str(e)),
            }
    else:
        result = {'status': 'error'}
    
    return json.dumps(result)

@agent_bp.route('/process-data-on-load', methods=['GET', 'POST'])
def process_data_on_load_request():

    if request.is_json:
        logger.info("# process data query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")

        try:
            conn = db_manager.get_connection(session['session_id'])
        except Exception as e:
            conn = None

        agent = DataLoadAgent(client=client, conn=conn)
        
        candidates = agent.run(content["input_data"])
        
        candidates = [c['content'] for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@agent_bp.route('/derive-concept-request', methods=['GET', 'POST'])
def derive_concept_request():

    if request.is_json:
        logger.info("# code query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")
        agent = ConceptDeriveAgent(client=client)

        candidates = agent.run(content["input_data"], [f['name'] for f in content["input_fields"]], 
                                       content["output_name"], content["description"])
        
        candidates = [c['code'] for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@agent_bp.route('/derive-py-concept', methods=['GET', 'POST'])
def derive_py_concept():

    if request.is_json:
        logger.info("# code query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")
        agent = PyConceptDeriveAgent(client=client)

        results = agent.run(content["input_data"], [f['name'] for f in content["input_fields"]], 
                                       content["output_name"], content["description"])
        
        response = flask.jsonify({ "status": "ok", "token": token, "results": results })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "results": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/clean-data', methods=['GET', 'POST'])
def clean_data_request():

    if request.is_json:
        logger.info("# data clean request")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")
        
        agent = DataCleanAgent(client=client)

        try:
            candidates = agent.run(content.get('prompt', ''), content.get('artifacts', []), content.get('dialog', []))
        except Exception as e:
            logger.error(e)
            if 'unable to download html from url' in str(e):
                return flask.jsonify({ "token": token, "status": "error", "result":  'this website doesn\'t allow us to download html from url :(' })
            else:
                return flask.jsonify({ "token": token, "status": "error", "result": 'unable to process data clean request' })

        
        candidates = [c for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@agent_bp.route('/clean-data-stream', methods=['GET', 'POST'])
def clean_data_stream_request():
    def generate():
        if request.is_json:
            logger.info("# data clean stream request")
            content = request.get_json()
            token = content["token"]

            client = get_client(content['model'])

            logger.info(f" model: {content['model']}")
            
            agent = DataCleanAgentStream(client=client)

            try:
                for chunk in agent.stream(content.get('prompt', ''), content.get('artifacts', []), content.get('dialog', [])):
                    yield chunk
            except Exception as e:
                logger.error(e)
                if 'unable to download html from url' in str(e):
                    error_data = { 
                        "token": token, 
                        "status": "error", 
                        "result": 'this website doesn\'t allow us to download html from url :(' 
                    }
                else:
                    error_data = { 
                        "token": token, 
                        "status": "error", 
                        "result": 'unable to process data clean request' 
                    }
                yield '\n' + json.dumps(error_data) + '\n'
        else:
            error_data = { 
                "token": -1, 
                "status": "error", 
                "result": "Invalid request format" 
            }
            yield '\n' + json.dumps(error_data) + '\n'

    response = Response(
        stream_with_context(generate()),
        mimetype='application/json',
        headers={
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    )
    return response


@agent_bp.route('/sort-data', methods=['GET', 'POST'])
def sort_data_request():

    if request.is_json:
        logger.info("# sort query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        agent = SortDataAgent(client=client)
        candidates = agent.run(content['field'], content['items'])

        candidates = candidates if candidates != None else []
        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/derive-data', methods=['GET', 'POST'])
def derive_data():

    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()
        payload, status_code = _run_derive_data_core(content)
        response = flask.jsonify(payload)
        response.status_code = status_code
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@agent_bp.route('/smart-chat', methods=['GET', 'POST'])
def smart_chat():
    if not request.is_json:
        response = flask.jsonify({"token": "", "status": "error", "message": "Invalid request format"})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    content = request.get_json()
    token = content.get("token", "")
    input_tables = content.get("input_tables", [])
    instruction = content.get("extra_prompt", "")
    data_columns = extract_all_columns_from_input_tables(input_tables)
    domain = "qc" if is_qc_data(data_columns) else "generic"
    field_metas = _build_field_metas_from_input_tables(input_tables)
    sample_rows = _extract_sample_rows(input_tables)
    # Build full drawable catalog first; action-specific branches will slice later.
    # This prevents early truncation from hiding relevant family variants
    # (e.g., Line Chart / Dotted Line Chart when user asks for line).
    drawable_catalog = build_drawable_catalog(field_metas, domain, top_k=None)

    model_config = content.get("model")
    if not model_config:
        response = flask.jsonify({
            "token": token,
            "status": "ok",
            "category": "VAGUE",
            "action": "suggest",
            "message_vi": "Choose a chart suitable for your current data.",
            "suggestions": [_entry_to_dict(e) for e in drawable_catalog[:6]],
            "sample_prompts": [e.sample_prompt_vi for e in drawable_catalog[:5]],
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    main_client = get_client(model_config)

    # Fast path: when UI already selected a chart type (e.g., suggestion click),
    # skip intent classification and go straight to derive-data.
    selected_chart_type = str(content.get("user_preferred_chart_type", "")).strip()
    if selected_chart_type:
        payload, status_code = _run_derive_data_core(content)
        payload["category"] = PROMPT_CONCRETE
        payload["action"] = "draw"
        payload["message_vi"] = ""
        payload["classifier_hints"] = {
            "chart_type_hint": selected_chart_type,
            "detected_fields": [],
        }
        response = flask.jsonify(payload)
        response.status_code = status_code
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    lw_client = get_lightweight_client(main_client)
    agent = SmartChatAgent(client=lw_client)
    result = agent.run(
        instruction,
        data_columns,
        domain,
        drawable_catalog,
        field_metas=field_metas,
        sample_rows=sample_rows,
    )

    qc_chart_names = {"QC Trend Line", "QC Histogram", "QC Trend Bar"}
    if (
        result.action in {"draw", "confirm"}
        and result.chart_type_hint in qc_chart_names
        and domain == "generic"
    ):
        result = SmartChatResult(
            action="info",
            message_vi=(
                "QC charts require columns such as TARGET, LL, UL, QCDATE, and QCSHIFT, "
                "which are missing in the current data. You can choose alternative charts below."
            ),
            chart_type_hint=result.chart_type_hint,
            detected_fields=result.detected_fields,
            confidence=0.95,
            rationale=f"safety override for generic domain qc chart: {result.chart_type_hint}",
        )

    category_map = {
        "draw": PROMPT_CONCRETE,
        "confirm": "PARTIAL",
        "suggest": "VAGUE",
        "qc_suggest": "VAGUE",
        "info": "OFF_TOPIC",
    }
    category = category_map.get(result.action, "VAGUE")

    _log_telemetry_event(
        "prompt_classified",
        {
            "category": category,
            "confidence": result.confidence,
            "missing_info": [],
            "domain": domain,
            "table_count": len(input_tables),
            "column_count": len(data_columns),
        },
    )

    if result.action == "draw":
        # Guard: chart type only (e.g. "draw bar chart") should trigger guided confirm,
        # not immediate draw, unless prompt contains explicit fields.
        # Exception: QC chart names on QC domain can draw directly — their templates
        # have fixed field mappings so the user doesn't need to spell out column names.
        is_qc_chart_direct = result.chart_type_hint in qc_chart_names and domain == "qc"
        has_user_selected_chart = bool(str(content.get("user_preferred_chart_type", "")).strip())
        if (
            result.chart_type_hint
            and not is_qc_chart_direct
            and not has_user_selected_chart
            and not _is_prompt_explicit_fields(instruction, data_columns)
        ):
            result = SmartChatResult(
                action="confirm",
                message_vi=(
                    "I understand the chart type you want. "
                    "Choose a suggestion below to specify metric and fields."
                ),
                chart_type_hint=result.chart_type_hint,
                detected_fields=result.detected_fields,
                confidence=result.confidence,
                rationale="draw downgraded to confirm due to missing explicit fields",
            )
        else:
            if result.chart_type_hint and not content.get("user_preferred_chart_type"):
                content["user_preferred_chart_type"] = _normalize_chart_type_hint(result.chart_type_hint)
            payload, status_code = _run_derive_data_core(content)
            payload["category"] = category
            payload["action"] = "draw"
            payload["message_vi"] = result.message_vi
            payload["classifier_hints"] = {
                "chart_type_hint": result.chart_type_hint,
                "detected_fields": result.detected_fields,
            }
            response = flask.jsonify(payload)
            response.status_code = status_code
            response.headers.add('Access-Control-Allow-Origin', '*')
            return response

    if result.action == "qc_suggest":
        qc_entries = [e for e in drawable_catalog if e.chart_type.startswith("QC")]
        generic_entries = [e for e in drawable_catalog if not e.chart_type.startswith("QC")]
        mixed_entries = (qc_entries[:3] + generic_entries[:3]) if generic_entries else qc_entries[:3]
        suggestions = [_entry_to_dict(e) for e in mixed_entries] if mixed_entries else _get_default_qc_entries()
        suggestions = _enrich_suggestions_with_agent(main_client, instruction, domain, suggestions)
        response = flask.jsonify({
            "token": token,
            "status": "ok",
            "category": category,
            "action": "qc_suggest",
            "message_vi": result.message_vi,
            "suggestions": suggestions,
            "classifier_hints": {"chart_type_hint": result.chart_type_hint},
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    if result.action == "confirm":
        suggestions_entries = _select_chart_family_suggestions(
            drawable_catalog, result.chart_type_hint, domain, top_k=4, user_prompt=instruction
        )
        suggestions = [_entry_to_dict(s) for s in suggestions_entries]
        if not suggestions:
            suggestions = _fallback_suggestions_from_fields(field_metas, result.chart_type_hint, domain, top_k=4)
        suggestions = _enrich_suggestions_with_agent(main_client, instruction, domain, suggestions)
        response = flask.jsonify({
            "token": token,
            "status": "ok",
            "category": category,
            "action": "confirm",
            "message_vi": result.message_vi,
            "suggestions": suggestions,
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    if result.action == "suggest":
        suggestions_entries = _select_balanced_suggestions(drawable_catalog, domain, top_k=6)
        suggestions = [_entry_to_dict(e) for e in suggestions_entries]
        if not suggestions:
            suggestions = _fallback_suggestions_from_fields(field_metas, result.chart_type_hint, domain, top_k=6)
        suggestions = _enrich_suggestions_with_agent(main_client, instruction, domain, suggestions)
        response = flask.jsonify({
            "token": token,
            "status": "ok",
            "category": category,
            "action": "suggest",
            "message_vi": result.message_vi,
            "suggestions": suggestions,
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    response = flask.jsonify({
        "token": token,
        "status": "ok",
        "category": category,
        "action": "info",
        "message_vi": result.message_vi,
        "sample_prompts": [e.sample_prompt_vi for e in drawable_catalog[:5]],
        "suggestions": [_entry_to_dict(e) for e in drawable_catalog[:6]],
    })
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@agent_bp.route('/log-telemetry', methods=['POST'])
def log_telemetry():
    if not request.is_json:
        return jsonify({"status": "error", "message": "Invalid request format"}), 400

    content = request.get_json() or {}
    event_name = str(content.get("event_name", "")).strip()
    payload = content.get("payload", {})
    if not event_name:
        return jsonify({"status": "error", "message": "event_name is required"}), 400

    if not isinstance(payload, dict):
        payload = {"value": payload}

    _log_telemetry_event(event_name, payload)
    return jsonify({"status": "ok"})


@agent_bp.route('/refine-data', methods=['GET', 'POST'])
def refine_data():

    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()        
        token = content["token"]


        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        dialog = content["dialog"]

        chart_type = content.get("chart_type", "")
        chart_encodings = content.get("chart_encodings", {})

        new_instruction = content["new_instruction"]
        latest_data_sample = content["latest_data_sample"]
        max_repair_attempts = content.get("max_repair_attempts", 1)
        agent_coding_rules = content.get("agent_coding_rules", "")
        
        language = content.get("language", "python") # whether to use sql or python, default to python

        logger.info("== input tables ===>")
        for table in input_tables:
            logger.info(f"===> Table: {table['name']} (first 5 rows)")
            logger.info(table['rows'][:5])
        
        logger.info("== user spec ===>")
        logger.info(chart_type)
        logger.info(chart_encodings)
        logger.info(new_instruction)

        conn = db_manager.get_connection(session['session_id']) if language == "sql" else None

        # always resort to the data transform agent       
        agent = SQLDataTransformationAgent(client=client, conn=conn, agent_coding_rules=agent_coding_rules) if language == "sql" else PythonDataTransformationAgent(client=client, exec_python_in_subprocess=current_app.config['CLI_ARGS']['exec_python_in_subprocess'], agent_coding_rules=agent_coding_rules)
        results = agent.followup(input_tables, dialog, latest_data_sample, chart_type, chart_encodings, new_instruction, n=1)

        repair_attempts = 0
        while results and results[0]['status'] == 'error' and repair_attempts < max_repair_attempts: # only try once
            error_message = results[0]['content']
            new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."
            prev_dialog = results[0]['dialog'][-MAX_DIALOG_HISTORY:]  # cap to prevent token bloat

            results = agent.followup(input_tables, prev_dialog, [], chart_type, chart_encodings, new_instruction, n=1)
            repair_attempts += 1

        if conn:
            conn.close()

        response = flask.jsonify({ "token": token, "status": "ok", "results": results})
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": []})

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/code-expl', methods=['GET', 'POST'])
def request_code_expl():
    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()        
        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        code = content["code"]
        
        code_expl_agent = CodeExplanationAgent(client=client)
        candidates = code_expl_agent.run(input_tables, code)
        
        # Return the first candidate's content as JSON
        if candidates and len(candidates) > 0:
            result = candidates[0]
            if result['status'] == 'ok':
                return jsonify(result)
            else:
                return jsonify(result), 400
        else:
            return jsonify({'error': 'No explanation generated'}), 400
    else:
        return jsonify({'error': 'Invalid request format'}), 400

@agent_bp.route('/query-completion', methods=['POST'])
def query_completion():
    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()        

        client = get_client(content['model'])

        data_source_metadata = content["data_source_metadata"]
        query = content["query"]

        query_completion_agent = QueryCompletionAgent(client=client)
        reasoning, query = query_completion_agent.run(data_source_metadata, query)
        response = flask.jsonify({ "token": "", "status": "ok", "reasoning": reasoning, "query": query })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "reasoning": "unable to complete query", "query": "" })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/log-user-prompt', methods=['POST'])
def log_user_prompt_endpoint():
    """
    Endpoint to log user prompt from frontend
    Expected body: {
        "user_prompt": "user's question or instruction",
        "agent_name": "name of the agent/component calling this",
        "mode": "interactive or agent or other mode"
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        user_prompt = data.get("user_prompt", "")
        agent_name = data.get("agent_name", "UnknownAgent")
        mode = data.get("mode", "unknown")
        
        if not user_prompt or user_prompt.strip() == "":
            return jsonify({"error": "user_prompt cannot be empty"}), 400
        
        # Get user_id from session if available
        user_id = session.get("username")
        if not user_id:
            user_id = os.environ.get("USER_ID", os.environ.get("USERNAME", "SYSTEM"))
        
        # Log prompt to ClickHouse with agent name and mode
        log_prompt_to_clickhouse(
            agent_name=f"{agent_name}_{mode}",
            prompt_text=user_prompt,
            user_id=user_id
        )
        
        logger.info(f"✅ Logged user prompt - Agent: {agent_name}, Mode: {mode}, User: {user_id}")
        
        return jsonify({"status": "success", "message": "Prompt logged successfully"}), 200
        
    except Exception as e:
        logger.error(f"❌ Error logging user prompt: {e}")
        return jsonify({"error": str(e)}), 500

@agent_bp.route('/generate-report-stream', methods=['GET', 'POST'])
def generate_report_stream():
    def generate():
        if request.is_json:
            logger.info("# generate report stream request")
            content = request.get_json()
            token = content.get("token", "")
            model_cfg = content.get("model", {})
            client = get_client(model_cfg)

            language = content.get("language", "python")
            if language == "sql":
                db_conn = db_manager.get_connection(session['session_id'])
            else:
                db_conn = None

            agent = ReportGenAgent(client=client, conn=db_conn)

            # Get input tables and charts from the request
            input_tables = content.get("input_tables", [])
            charts = content.get("charts", [])
            style = content.get("style", "blog post")
            report_language = content.get("report_language", "en")

            # Debug metadata for failure analysis
            chart_url_stats = []
            for c in charts:
                url = c.get("chart_url") or ""
                if not url:
                    kind = "empty"
                    length = 0
                elif isinstance(url, str) and url.startswith("data:image/"):
                    kind = "data_url_image"
                    length = len(url)
                elif isinstance(url, str) and url.startswith("blob:"):
                    kind = "blob_url"
                    length = len(url)
                elif isinstance(url, str) and url.startswith("http"):
                    kind = "http_url"
                    length = len(url)
                else:
                    kind = "other"
                    length = len(url) if isinstance(url, str) else 0
                chart_url_stats.append({
                    "chart_id": c.get("chart_id", ""),
                    "url_kind": kind,
                    "url_len": length,
                })

            logger.info(
                "report_stream meta endpoint=%s model=%s input_tables=%d charts=%d style=%s report_language=%s chart_url_stats=%s",
                model_cfg.get("endpoint", ""),
                model_cfg.get("model", ""),
                len(input_tables),
                len(charts),
                style,
                report_language,
                json.dumps(chart_url_stats, ensure_ascii=False),
            )

            try:
                for chunk in agent.stream(input_tables, charts, style, report_language):
                    yield chunk
            except Exception as e:
                logger.exception(
                    "generate_report_stream failed endpoint=%s model=%s style=%s report_language=%s",
                    model_cfg.get("endpoint", ""),
                    model_cfg.get("model", ""),
                    style,
                    report_language,
                )
                error_data = { 
                    "content": "unable to process report generation request",
                    "debug_hint": str(e)[:500],
                }
                yield 'error: ' + json.dumps(error_data) + '\n'
        else:
            error_data = { 
                "content": "Invalid request format" 
            }
            yield 'error: ' + json.dumps(error_data) + '\n'

    response = Response(
        stream_with_context(generate()),
        mimetype='application/json',
        headers={ 'Access-Control-Allow-Origin': '*',  }
    )
    return response
