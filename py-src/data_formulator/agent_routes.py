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
from data_formulator.agents.agent_interactive_explore import InteractiveExploreAgent
from data_formulator.agents.agent_report_gen import ReportGenAgent
from data_formulator.agents.agent_utils import log_prompt_to_clickhouse
from data_formulator.agents.prompt_guard_agent import PromptGuardAgent, extract_all_columns_from_input_tables
from data_formulator.agents.client_utils import Client
from data_formulator.agents.prompt_classifier import (
    classify_prompt,
    PROMPT_CONCRETE,
    PROMPT_PARTIAL,
    PROMPT_VAGUE,
    PROMPT_OFF_TOPIC,
)
from data_formulator.agents.drawable_catalog import build_drawable_catalog
from data_formulator.agents.sample_prompts import SAMPLE_PROMPT_TEMPLATES_VI
from data_formulator.agents.field_metadata import FieldMeta
from data_formulator.agents.qc_chart_config import is_qc_data

from data_formulator.db_manager import db_manager

# Get logger for this module (logging config done in app.py)
logger = logging.getLogger(__name__)

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


def _classify_cardinality(cardinality: int) -> str:
    if cardinality <= 12:
        return "low"
    if cardinality <= 50:
        return "mid"
    if cardinality <= 500:
        return "high"
    return "huge"


def _build_field_metas_from_input_tables(input_tables) -> dict:
    metas = {}
    for table in input_tables:
        rows = table.get("rows", [])
        df = pd.DataFrame.from_records(rows)
        row_count = len(df.index)
        if row_count == 0:
            continue
        for col in df.columns:
            if col in metas:
                continue
            series = df[col]
            non_null = int(series.notna().sum())
            cardinality = int(series.nunique(dropna=True))
            null_ratio = 0.0 if row_count == 0 else float((row_count - non_null) / row_count)
            cardinality_class = _classify_cardinality(cardinality)
            is_temporal = pd.api.types.is_datetime64_any_dtype(series)
            is_numeric = pd.api.types.is_numeric_dtype(series)
            is_integer = pd.api.types.is_integer_dtype(series)
            stddev = float(series.std()) if is_numeric and pd.notna(series.std()) else None
            min_val = float(series.min()) if is_numeric and pd.notna(series.min()) else None
            max_val = float(series.max()) if is_numeric and pd.notna(series.max()) else None
            is_sequential = (
                bool(is_integer)
                and non_null == row_count
                and cardinality == row_count
                and min_val is not None
                and max_val is not None
                and int(max_val - min_val + 1) == cardinality
            )
            is_quantitative = bool(is_numeric and (not is_sequential) and stddev is not None and stddev > 0 and cardinality >= 10)
            is_categorical = cardinality_class in ("low", "mid") and (not is_temporal) and (not is_sequential) and (not is_quantitative)
            metas[col] = FieldMeta(
                name=col,
                sql_type=str(series.dtype),
                cardinality=cardinality,
                null_ratio=null_ratio,
                cardinality_class=cardinality_class,
                is_temporal=is_temporal,
                is_sequential=is_sequential,
                is_quantitative=is_quantitative,
                is_categorical=is_categorical,
                qc_role=None,
                looks_like_id=False,
                row_count=row_count,
                stddev=stddev,
                min_value=min_val,
                max_value=max_val,
            )
    return metas


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
    classification = classify_prompt(instruction, data_columns)

    if classification.category == PROMPT_OFF_TOPIC:
        samples = list(SAMPLE_PROMPT_TEMPLATES_VI.values())[:5]
        response = flask.jsonify({
            "token": token,
            "status": "ok",
            "category": classification.category,
            "action": "info",
            "message": "Prompt không liên quan tới vẽ biểu đồ/phân tích dữ liệu.",
            "sample_prompts": samples,
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    if classification.category in (PROMPT_VAGUE, PROMPT_PARTIAL):
        field_metas = _build_field_metas_from_input_tables(input_tables)
        domain = "qc" if is_qc_data(data_columns) else "generic"
        top_k = 6 if classification.category == PROMPT_VAGUE else 3
        suggestions = build_drawable_catalog(field_metas, domain, top_k=top_k)
        response = flask.jsonify({
            "token": token,
            "status": "ok",
            "category": classification.category,
            "action": "suggestion" if classification.category == PROMPT_VAGUE else "confirm",
            "missing_info": classification.missing_info,
            "suggestions": [
                {
                    "chart_type": s.chart_type,
                    "encoding": s.encoding,
                    "confidence": s.confidence,
                    "rationale_vi": s.rationale_vi,
                    "sample_prompt_vi": s.sample_prompt_vi,
                }
                for s in suggestions
            ],
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    payload, status_code = _run_derive_data_core(content)
    payload["category"] = classification.category
    payload["action"] = "derive"
    response = flask.jsonify(payload)
    response.status_code = status_code
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


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

@agent_bp.route('/get-recommendation-questions', methods=['GET', 'POST'])
def get_recommendation_questions():
    def generate():
        if request.is_json:
            logger.info("# get recommendation questions request")
            content = request.get_json()
            token = content.get("token", "")

            client = get_client(content['model'])

            language = content.get("language", "python")
            if language == "sql":
                db_conn = db_manager.get_connection(session['session_id'])
            else:
                db_conn = None

            agent_exploration_rules = content.get("agent_exploration_rules", "")
            _lw = get_lightweight_client(client)
            agent = InteractiveExploreAgent(client=_lw, agent_exploration_rules=agent_exploration_rules, db_conn=db_conn)

            # Get input tables from the request
            input_tables = content.get("input_tables", [])
            
            # Get exploration thread if provided (for context from previous explorations)
            mode = content.get("mode", "interactive")
            start_question = content.get("start_question", None)
            exploration_thread = content.get("exploration_thread", None)
            current_chart = content.get("current_chart", None)
            current_data_sample = content.get("current_data_sample", None)

            # 🛡️ Guard: validate user-typed input in agent mode to prevent token waste
            raw_user_input = content.get("raw_user_input", None)
            prompt_source = content.get("prompt_source", "system")
            if mode == "agent" and raw_user_input and prompt_source == "user":
                data_columns = extract_all_columns_from_input_tables(input_tables)
                guard = PromptGuardAgent(client=_lw)
                guard_result = guard.validate(raw_user_input, data_columns=data_columns)
                if not guard_result["ok"]:
                    logger.info(f"🚫 [Agent mode] Prompt blocked: {guard_result['reason']}")
                    blocked_data = {
                        "type": "guard_blocked",
                        "user_message": guard_result.get("user_message", "Please enter a data visualization request."),
                        "reason": guard_result.get("reason", ""),
                    }
                    yield 'data: ' + json.dumps(blocked_data) + '\n'
                    return

            try:
                for chunk in agent.run(input_tables, start_question, exploration_thread, current_data_sample, current_chart, mode):
                    yield chunk
            except Exception as e:
                import traceback
                logger.error(f"[get_recommendation_questions] Exception: {type(e).__name__}: {e}")
                logger.error(traceback.format_exc())
                error_data = { 
                    "content": "unable to process recommendation questions request" 
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

            client = get_client(content['model'])

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

            try:
                for chunk in agent.stream(input_tables, charts, style, report_language):
                    yield chunk
            except Exception as e:
                logger.error(e)
                error_data = { 
                    "content": "unable to process report generation request" 
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
