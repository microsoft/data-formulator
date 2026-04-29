# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import random
import sys
import os
import mimetypes
import re
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')

import flask
from flask import request, jsonify, Blueprint, current_app, Response, stream_with_context
import logging

import json
import html
import pandas as pd

from data_formulator.agents.agent_data_transform import DataTransformationAgent
from data_formulator.agents.agent_data_rec import DataRecAgent

from data_formulator.agents.agent_sort_data import SortDataAgent
from data_formulator.agents.agent_simple import SimpleAgents
from data_formulator.auth.identity import get_identity_id
from data_formulator.security.code_signing import sign_result, verify_code, MAX_CODE_SIZE
from data_formulator.datalake.workspace import Workspace
from data_formulator.workspace_factory import get_workspace
from data_formulator.agents.agent_data_load import DataLoadAgent
from data_formulator.agents.agent_data_clean_stream import DataCleanAgentStream
from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent
from data_formulator.agents.agent_code_explanation import CodeExplanationAgent
from data_formulator.agents.agent_chart_insight import ChartInsightAgent
from data_formulator.agents.agent_interactive_explore import InteractiveExploreAgent
from data_formulator.agents.agent_report_gen import ReportGenAgent
from data_formulator.agents.client_utils import Client
from data_formulator.model_registry import model_registry, model_supports_vision
from data_formulator.knowledge.store import KnowledgeStore

from data_formulator.agents.data_agent import DataAgent
from data_formulator.agents.agent_language import build_language_instruction
from data_formulator.security.sanitize import classify_llm_error, sanitize_error_message

# Get logger for this module (logging config done in app.py)
logger = logging.getLogger(__name__)


def _get_ui_lang() -> str:
    """Extract the primary language code from the Accept-Language header."""
    return request.headers.get('Accept-Language', 'en').split(',')[0].split('-')[0].strip().lower()


def get_language_instruction(*, mode: str = "full") -> str:
    """Read the UI language from the Accept-Language header and build the prompt instruction.

    mode: "full" for text-heavy agents, "compact" for code-generation agents.
    """
    return build_language_instruction(_get_ui_lang(), mode=mode)


def _format_clarification_responses(raw_responses) -> str:
    """Format structured clarification answers into text the LLM can read."""
    if not isinstance(raw_responses, list):
        return ""

    lines: list[str] = []
    for raw in raw_responses:
        if not isinstance(raw, dict):
            continue

        question_id = str(raw.get("question_id", "")).strip()
        answer = str(raw.get("answer", "")).strip()
        option_id = str(raw.get("option_id", "")).strip()
        source = str(raw.get("source", "")).strip()
        if not answer:
            continue

        if question_id == "__freeform__" or source == "freeform":
            lines.append(f"- Freeform clarification: {answer}")
            continue

        suffix = f" (option: {option_id})" if option_id else ""
        label = question_id or "clarification"
        lines.append(f"- {label}: {answer}{suffix}")

    return "\n".join(lines)


def _get_knowledge_store(identity_id: str) -> KnowledgeStore | None:
    """Create a KnowledgeStore for the given user, or None on failure."""
    try:
        from data_formulator.datalake.workspace import get_user_home
        return KnowledgeStore(get_user_home(identity_id))
    except Exception:
        logger.warning("Failed to create KnowledgeStore", exc_info=True)
        return None


agent_bp = Blueprint('agent', __name__, url_prefix='/api/agent')


def _try_parse_explore_line(raw_line: str) -> str | None:
    """Parse a single line from the exploration agent into an NDJSON line.

    The LLM is prompted to output one JSON object per line.  Older prompts
    used an SSE-style ``data: `` prefix which we strip for compatibility.
    Non-JSON lines (thinking text, blank lines) are silently dropped.
    """
    line = raw_line.strip()
    if not line:
        return None
    if line.startswith("data:"):
        line = line[5:].lstrip()
    if not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
        return json.dumps(obj, ensure_ascii=False) + "\n"
    except (json.JSONDecodeError, ValueError):
        return None


def _with_warnings(gen):
    """Wrap an NDJSON generator to flush accumulated stream warnings.

    Any code running during chunk generation (e.g. agent helpers) may
    call :func:`collect_stream_warning`.  This wrapper drains the
    accumulated warnings before each application chunk so the frontend
    receives them in chronological order.
    """
    from data_formulator.error_handler import flush_stream_warnings
    for chunk in gen:
        for w in flush_stream_warnings():
            yield w
        yield chunk
    for w in flush_stream_warnings():
        yield w


def _messages_include_image(messages: list[dict]) -> bool:
    """Return True when a chat payload contains user image attachments."""
    for msg in messages:
        for att in msg.get("attachments") or []:
            if att.get("type") == "image" and att.get("url"):
                return True
    return False


@agent_bp.after_request
def _set_cors(response):
    """Set CORS headers from server configuration.

    By default no ``Access-Control-Allow-Origin`` header is emitted
    (same-origin only).  To allow cross-origin requests set the
    ``CORS_ORIGIN`` env-var (e.g. ``CORS_ORIGIN=https://my-embed-host``).
    Use ``CORS_ORIGIN=*`` only for development / fully trusted networks.
    """
    origin = os.environ.get('CORS_ORIGIN', '')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

def get_client(model_config):
    # For global models, resolve real credentials from the server-side registry.
    # The frontend only knows the model id; the api_key never leaves the server.
    if model_config.get("is_global"):
        real_config = model_registry.get_config(model_config["id"])
        if real_config:
            model_config = real_config

    for key in model_config:
        if isinstance(model_config[key], str):
            model_config[key] = model_config[key].strip()

    # Validate user-provided api_base against the allowlist (SSRF protection).
    # Global models are trusted (their api_base comes from server env vars).
    if not model_config.get("is_global"):
        from data_formulator.security.url_allowlist import validate_api_base
        validate_api_base(model_config.get("api_base"))

    client = Client(
        model_config["endpoint"],
        model_config["model"],
        model_config.get("api_key") or None,
        html.escape(model_config["api_base"]) if model_config.get("api_base") else None,
        model_config.get("api_version") or None,
    )

    return client


@agent_bp.route('/list-global-models', methods=['GET', 'POST'])
def list_global_models():
    """Return all globally configured models instantly, without connectivity checks.

    The frontend calls this first to render the model list immediately (with a
    'checking' status), then calls /check-available-models to get real statuses.
    """
    public_models = model_registry.list_public()
    return jsonify(public_models)


@agent_bp.route('/check-available-models', methods=['GET', 'POST'])
def check_available_models():
    """
    Return all globally configured models with their connectivity status.

    Connectivity checks run in parallel (ThreadPoolExecutor) so the total
    wall-clock time equals the slowest single model, not the sum of all.
    Sensitive credentials (api_key) are never sent to the client.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    all_public = model_registry.list_public()
    logger.info("=" * 60)
    logger.info(f"[check-available-models] Checking {len(all_public)} global models")
    from data_formulator.security.log_sanitizer import sanitize_url
    for p in all_public:
        logger.info("  -> %s  (endpoint=%s, model=%s, api_base=%s)",
                     p['id'], p['endpoint'], p['model'], sanitize_url(p.get('api_base', '')))
    overall_start = time.time()

    def _check_one(public_info: dict) -> dict:
        model_id = public_info["id"]
        t0 = time.time()
        full_config = model_registry.get_config(model_id)
        status = "disconnected"
        error = None

        try:
            client = get_client(full_config)
            logger.info(f"  [{model_id}] Sending connectivity ping (max_tokens=3)...")
            client.ping(timeout=10)
            status = "connected"
            logger.info(f"  [{model_id}] Connected ({time.time() - t0:.1f}s)")
        except Exception as e:
            elapsed = time.time() - t0
            logger.warning(f"  [{model_id}] Failed ({elapsed:.1f}s): {type(e).__name__}: {e}")
            error = classify_llm_error(e)

        return {**public_info, "status": status, "error": error}

    results = []
    if all_public:
        with ThreadPoolExecutor(max_workers=min(len(all_public), 8)) as executor:
            futures = {executor.submit(_check_one, p): p["id"] for p in all_public}
            for future in as_completed(futures):
                try:
                    results.append(future.result())
                except Exception as e:
                    model_id = futures[future]
                    logger.error(f"  [{model_id}] Thread exception: {e}")
                    pub = next(p for p in all_public if p["id"] == model_id)
                    results.append({**pub, "status": "disconnected", "error": "Check thread exception"})

    id_order = [p["id"] for p in all_public]
    results.sort(key=lambda r: id_order.index(r["id"]))

    total_elapsed = time.time() - overall_start
    connected = sum(1 for r in results if r["status"] == "connected")
    logger.info(f"[check-available-models] Done: {connected}/{len(results)} connected, total {total_elapsed:.1f}s")
    logger.info("=" * 60)

    return jsonify(results)

@agent_bp.route('/test-model', methods=['GET', 'POST'])
def test_model():
    if request.is_json:
        logger.info("# test-model request")
        content = request.get_json()

        # contains endpoint, key, model, api_base, api_version
        logger.debug("content------------------------------")
        logger.debug(content)

        client = get_client(content['model'])
        
        try:
            response = client.get_completion(
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "Respond 'I can hear you.' if you can hear me. Do not say anything other than 'I can hear you.'"},
                ]
            )

            logger.debug(f"model: {content['model']}")
            logger.debug(f"welcome message: {response.choices[0].message.content}")

            if "I can hear you." in response.choices[0].message.content:
                result = {
                    "model": content['model'],
                    "status": 'ok',
                    "message": ""
                }
            else:
                result = {
                    "model": content['model'],
                    "status": 'error',
                    "message": "Model responded but did not pass connectivity check",
                }
        except Exception as e:
            logger.exception(f"Error testing model {content['model'].get('id', '')}")
            result = {
                "model": content['model'],
                "status": 'error',
                "message": classify_llm_error(e),
            }
    else:
        result = {'status': 'error', 'message': 'Invalid request format'}
    
    return jsonify(result)

@agent_bp.route('/process-data-on-load', methods=['GET', 'POST'])
def process_data_on_load_request():

    if request.is_json:
        logger.info("# process-data-on-load request")
        content = request.get_json()
        token = content["token"]
        input_data = content["input_data"]

        client = get_client(content['model'])

        logger.debug(f" model: {content['model']}")

        try:
            # Get workspace (needed for both virtual and in-memory tables)
            identity_id = get_identity_id()
            workspace = get_workspace(identity_id)

            # Check if input table is in workspace, if not add as temp data
            input_tables = [{"name": input_data.get("name"), "rows": input_data.get("rows", [])}]
            
            language_instruction = get_language_instruction(mode="compact")
            agent = DataLoadAgent(client=client, workspace=workspace, language_instruction=language_instruction)
            candidates = agent.run(content["input_data"])
            candidates = [c['content'] for c in candidates if c['status'] == 'ok']

            response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
        except Exception as e:
            logger.exception(e)
            response = flask.jsonify({ "token": token, "status": "error", "result": [], "error_message": classify_llm_error(e) })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [], "error_message": "Invalid request format" })

    return response


@agent_bp.route('/clean-data-stream', methods=['GET', 'POST'])
def clean_data_stream_request():
    from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error
    from data_formulator.errors import AppError, ErrorCode

    if not request.is_json:
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.INVALID_REQUEST,
            "message": "Invalid request format",
            "retry": False,
        }})

    content = request.get_json()
    token = content["token"]
    client = get_client(content['model'])

    logger.info("# clean-data-stream request")
    logger.debug(f" model: {content['model']}")

    language_instruction = get_language_instruction()
    prompt = content.get('prompt', '')
    artifacts = content.get('artifacts', [])
    dialog = content.get('dialog', [])

    def generate():
        agent = DataCleanAgentStream(client=client, language_instruction=language_instruction)
        try:
            for chunk in agent.stream(prompt, artifacts, dialog):
                yield chunk
        except Exception as e:
            logger.error("clean-data-stream error", exc_info=e)
            if 'unable to download html from url' in str(e):
                yield stream_error_event(AppError(
                    ErrorCode.DATA_LOAD_ERROR,
                    "This website doesn't allow us to download HTML from URL",
                    status_code=400,
                ), token=token)
            else:
                yield stream_error_event(classify_and_wrap_llm_error(e), token=token)

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )


@agent_bp.route('/sort-data', methods=['GET', 'POST'])
def sort_data_request():

    if request.is_json:
        logger.info("# sort-data request")
        content = request.get_json()
        token = content["token"]

        try:
            client = get_client(content['model'])

            language_instruction = get_language_instruction(mode="compact")
            agent = SortDataAgent(client=client, language_instruction=language_instruction)
            candidates = agent.run(content['field'], content['items'])

            candidates = candidates if candidates != None else []
            response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
        except Exception as e:
            logger.error("Error in sort-data", exc_info=e)
            response = flask.jsonify({ "token": token, "status": "error", "result": [], "error_message": classify_llm_error(e) })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [], "error_message": "Invalid request format" })

    return response

@agent_bp.route('/derive-data', methods=['GET', 'POST'])
def derive_data():

    if request.is_json:
        logger.info("# derive-data request")
        content = request.get_json()        
        token = content["token"]

        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]

        instruction = content["extra_prompt"]
        
        max_repair_attempts = content["max_repair_attempts"] if "max_repair_attempts" in content else 1
        agent_coding_rules = content.get("agent_coding_rules", "")
        current_visualization = content.get("current_visualization", None)
        expected_visualization = content.get("expected_visualization", None)

        if "additional_messages" in content:
            prev_messages = content["additional_messages"]
        else:
            prev_messages = []

        logger.debug("== input tables ===>")
        for table in input_tables:
            logger.debug(f"===> Table: {table['name']} (first 5 rows)")
            logger.debug(table['rows'][:5])

        logger.debug("== user spec ===")
        logger.debug(instruction)

        # If user provided chart encodings (via visualization context), use transform mode; otherwise recommendation
        mode = "transform" if current_visualization or expected_visualization else "recommendation"
        primary_tables = content.get("primary_tables", None)

        try:
            identity_id = get_identity_id()
            workspace = get_workspace(identity_id)
            max_display_rows = current_app.config['CLI_ARGS']['max_display_rows']

            language_instruction = get_language_instruction(mode="compact")

            model_info = {
                "model": content['model'].get("model", ""),
                "endpoint": content['model'].get("endpoint", ""),
                "api_base": content['model'].get("api_base", ""),
            }

            knowledge_store = _get_knowledge_store(identity_id)

            if mode == "recommendation":
                agent = DataRecAgent(client=client, workspace=workspace, agent_coding_rules=agent_coding_rules, language_instruction=language_instruction, max_display_rows=max_display_rows, model_info=model_info, knowledge_store=knowledge_store)
                results = agent.run(input_tables, instruction, n=1, prev_messages=prev_messages, primary_tables=primary_tables)
            else:
                agent = DataTransformationAgent(client=client, workspace=workspace, agent_coding_rules=agent_coding_rules, language_instruction=language_instruction, max_display_rows=max_display_rows, model_info=model_info, knowledge_store=knowledge_store)
                results = agent.run(input_tables, instruction, prev_messages,
                                    current_visualization=current_visualization, expected_visualization=expected_visualization)

            repair_attempts = 0
            while (
                isinstance(results, list)
                and len(results) > 0
                and results[0].get('status') in ('error', 'other error')
                and repair_attempts < max_repair_attempts
            ):
                error_message = results[0].get('content', 'Unknown error')
                logger.warning(f"[derive-data] Code generation failed (attempt {repair_attempts + 1}/{max_repair_attempts}), mode={mode}. Error: {error_message}")
                new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."

                prev_dialog = results[0].get('dialog', [])

                try:
                    if mode == "transform":
                        results = agent.followup(input_tables, prev_dialog, [], new_instruction, n=1)
                    if mode == "recommendation":
                        results = agent.followup(input_tables, prev_dialog, [], new_instruction, n=1)
                except Exception as followup_exc:
                    logger.exception("derive_data followup failed")
                    results = [{
                        "status": "error",
                        "content": classify_llm_error(followup_exc),
                        "code": "",
                        "dialog": [],
                    }]
                    break

                repair_attempts += 1
                logger.warning(f"[derive-data] Repair attempt {repair_attempts}/{max_repair_attempts} result: {results[0].get('status', 'unknown')}")

            if repair_attempts > 0:
                logger.warning(f"[derive-data] Finished repair loop after {repair_attempts} attempt(s). Final status: {results[0].get('status', 'unknown')}")

            for r in results:
                if r.get("status") in ("error", "other error") and r.get("content"):
                    r["content"] = sanitize_error_message(r["content"])
                sign_result(r)

            response = flask.jsonify({ "token": token, "status": "ok", "results": results })
        except Exception as e:
            logger.error("Error in derive-data", exc_info=e)
            response = flask.jsonify({ "token": token, "status": "error", "results": [], "error_message": classify_llm_error(e) })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": [], "error_message": "Invalid request format" })

    return response

@agent_bp.route('/data-agent-streaming', methods=['GET', 'POST'])
def data_agent_streaming():
    """Streaming tool-calling data exploration agent endpoint.

    The agent streams events as newline-delimited JSON:
        text_delta  – streamed text from the agent (narration)
        tool_start  – agent is about to call a tool (explore/visualize/clarify)
        tool_result – tool execution result (visualize results match DataRecAgent format)
        clarify     – clarification question (loop pauses)
        done        – turn complete
        error       – error information

    To resume after a clarification, the client sends:
        - trajectory: the trajectory list returned in the clarify event
        - clarification_responses: structured user answers
    """
    from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error
    from data_formulator.errors import ErrorCode

    if not request.is_json:
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.INVALID_REQUEST,
            "message": "Invalid request format",
            "retry": False,
        }})

    content = request.get_json()
    token = content.get("token", "")

    identity_id = get_identity_id()
    if not identity_id:
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.AUTH_REQUIRED,
            "message": "Identity ID required",
            "retry": False,
        }})

    client = get_client(content['model'])
    workspace = get_workspace(identity_id)

    input_tables = content["input_tables"]
    user_question = content.get("user_question", "")
    max_iterations = content.get("max_iterations", 5)
    max_repair_attempts = content.get("max_repair_attempts", 1)
    agent_exploration_rules = content.get("agent_exploration_rules", "")
    agent_coding_rules = content.get("agent_coding_rules", "")
    focused_thread = content.get("focused_thread", None)
    other_threads = content.get("other_threads", None)
    primary_tables = content.get("primary_tables", None)
    attached_images = content.get("attached_images", None)
    resume_trajectory = content.get("trajectory", None)
    clarification_responses = content.get("clarification_responses", None)
    completed_step_count = content.get("completed_step_count", 0)

    if resume_trajectory is not None and not _format_clarification_responses(clarification_responses):
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.INVALID_REQUEST,
            "message": "clarification_responses is required to resume after clarification",
            "retry": False,
        }})

    logger.setLevel(logging.INFO)
    logger.info("# data-agent-streaming request")
    logger.debug("== input tables ===>")
    for table in input_tables:
        logger.debug(f"===> Table: {table['name']}")
    logger.debug(f"== user question ===> {user_question}")
    if attached_images:
        logger.info(f"== attached_images ===> {len(attached_images)} image(s), sizes: {[len(img) for img in attached_images]}")

    language_instruction = get_language_instruction(mode="full")

    def generate():
        try:
            from data_formulator.datalake.workspace import get_user_home
            user_home = get_user_home(identity_id)

            agent = DataAgent(
                client=client,
                workspace=workspace,
                agent_exploration_rules=agent_exploration_rules,
                agent_coding_rules=agent_coding_rules,
                language_instruction=language_instruction,
                max_iterations=max_iterations,
                max_repair_attempts=max_repair_attempts,
                user_home=user_home,
                identity_id=identity_id,
            )

            trajectory = None
            formatted_clarification = _format_clarification_responses(clarification_responses)
            if resume_trajectory and formatted_clarification:
                trajectory = list(resume_trajectory)
                trajectory.append({
                    "role": "user",
                    "content": f"[USER CLARIFICATION]\n\n{formatted_clarification}",
                })
                logger.debug("== resuming with structured clarification ===>")

            for event in agent.run(
                input_tables=input_tables,
                user_question=user_question,
                focused_thread=focused_thread,
                other_threads=other_threads,
                trajectory=trajectory,
                completed_step_count=completed_step_count,
                primary_tables=primary_tables,
                attached_images=attached_images,
            ):
                yield json.dumps({
                    "token": token,
                    "status": "ok",
                    "result": event,
                }, ensure_ascii=False) + '\n'

                if event.get("type") in ("completion", "clarify"):
                    break

        except Exception as e:
            logger.error("Error in data-agent-streaming", exc_info=e)
            yield stream_error_event(classify_and_wrap_llm_error(e), token=token)

        logger.setLevel(logging.WARNING)

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )


@agent_bp.route('/refine-data', methods=['GET', 'POST'])
def refine_data():

    if request.is_json:
        logger.info("# refine-data request")
        content = request.get_json()        
        token = content["token"]


        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        dialog = content["dialog"]

        new_instruction = content["new_instruction"]
        latest_data_sample = content["latest_data_sample"]
        max_repair_attempts = content.get("max_repair_attempts", 1)
        agent_coding_rules = content.get("agent_coding_rules", "")
        current_visualization = content.get("current_visualization", None)
        expected_visualization = content.get("expected_visualization", None)

        logger.debug("== input tables ===>")
        for table in input_tables:
            logger.debug(f"===> Table: {table['name']} (first 5 rows)")
            logger.debug(table['rows'][:5])
        
        logger.debug("== user spec ===>")
        logger.debug(new_instruction)

        try:
            identity_id = get_identity_id()
            workspace = get_workspace(identity_id)
            max_display_rows = current_app.config['CLI_ARGS']['max_display_rows']

            language_instruction = get_language_instruction(mode="compact")

            model_info = {
                "model": content['model'].get("model", ""),
                "endpoint": content['model'].get("endpoint", ""),
                "api_base": content['model'].get("api_base", ""),
            }

            knowledge_store = _get_knowledge_store(identity_id)
            agent = DataTransformationAgent(client=client, workspace=workspace, agent_coding_rules=agent_coding_rules, language_instruction=language_instruction, max_display_rows=max_display_rows, model_info=model_info, knowledge_store=knowledge_store)
            results = agent.followup(input_tables, dialog, latest_data_sample, new_instruction, n=1,
                                    current_visualization=current_visualization, expected_visualization=expected_visualization)

            repair_attempts = 0
            while (
                isinstance(results, list)
                and len(results) > 0
                and results[0].get('status') in ('error', 'other error')
                and repair_attempts < max_repair_attempts
            ):
                error_message = results[0].get('content', 'Unknown error')
                logger.info(f"[refine-data] Code generation failed (attempt {repair_attempts + 1}/{max_repair_attempts}). Error: {error_message}")
                new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."
                prev_dialog = results[0].get('dialog', [])

                try:
                    results = agent.followup(input_tables, prev_dialog, [], new_instruction, n=1)
                except Exception as followup_exc:
                    logger.exception("refine_data followup failed")
                    results = [{
                        "status": "error",
                        "content": classify_llm_error(followup_exc),
                        "code": "",
                        "dialog": [],
                    }]
                    break

                repair_attempts += 1
                logger.info(f"[refine-data] Repair attempt {repair_attempts}/{max_repair_attempts} result: {results[0].get('status', 'unknown')}")

            if repair_attempts > 0:
                logger.info(f"[refine-data] Finished repair loop after {repair_attempts} attempt(s). Final status: {results[0].get('status', 'unknown')}")

            for r in results:
                if r.get("status") in ("error", "other error") and r.get("content"):
                    r["content"] = sanitize_error_message(r["content"])
                sign_result(r)

            response = flask.jsonify({ "token": token, "status": "ok", "results": results})
        except Exception as e:
            logger.error("Error in refine-data", exc_info=e)
            response = flask.jsonify({ "token": token, "status": "error", "results": [], "error_message": classify_llm_error(e) })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": [], "error_message": "Invalid request format"})

    return response

@agent_bp.route('/code-expl', methods=['GET', 'POST'])
def request_code_expl():
    if request.is_json:
        logger.info("# code-expl request")
        content = request.get_json()
        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        code = content["code"]

        # Get workspace and mount temp data
        identity_id = get_identity_id()
        workspace = get_workspace(identity_id)

        language_instruction = get_language_instruction()

        try:
            code_expl_agent = CodeExplanationAgent(client=client, workspace=workspace, language_instruction=language_instruction)
            candidates = code_expl_agent.run(input_tables, code)

            if candidates and len(candidates) > 0:
                result = candidates[0]
                if result['status'] == 'ok':
                    return jsonify(result)
                else:
                    return jsonify(result)
            else:
                return jsonify({'error': 'No explanation generated'})
        except Exception as e:
            logger.error("Error in code-expl", exc_info=e)
            return jsonify({'error': classify_llm_error(e)})
    else:
        return jsonify({'error': 'Invalid request format'})

@agent_bp.route('/chart-insight', methods=['GET', 'POST'])
def request_chart_insight():
    if request.is_json:
        logger.info("# chart insight request")
        content = request.get_json()
        client = get_client(content['model'])

        chart_image = content.get("chart_image", "")
        chart_type = content.get("chart_type", "")
        field_names = content.get("field_names", [])
        input_tables = content.get("input_tables", [])

        # Get workspace
        identity_id = get_identity_id()
        workspace = get_workspace(identity_id)

        try:
            knowledge_store = _get_knowledge_store(identity_id)
            agent = ChartInsightAgent(client=client, workspace=workspace,
                                      language_instruction=get_language_instruction(),
                                      knowledge_store=knowledge_store)
            candidates = agent.run(chart_image, chart_type, field_names, input_tables)

            if candidates and len(candidates) > 0:
                result = candidates[0]
                if result['status'] == 'ok':
                    return jsonify(result)
                else:
                    return jsonify(result)
            else:
                return jsonify({'error': 'No insight generated'})
        except Exception as e:
            logger.error("Error in chart-insight", exc_info=e)
            return jsonify({'error': classify_llm_error(e)})
    else:
        return jsonify({'error': 'Invalid request format'})

@agent_bp.route('/get-recommendation-questions', methods=['GET', 'POST'])
def get_recommendation_questions():
    from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error
    from data_formulator.errors import ErrorCode

    if not request.is_json:
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.INVALID_REQUEST,
            "message": "Invalid request format",
            "retry": False,
        }})

    logger.info("# get recommendation questions request")
    content = request.get_json()
    token = content.get("token", "")

    client = get_client(content['model'])
    input_tables = content.get("input_tables", [])
    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)

    agent_exploration_rules = content.get("agent_exploration_rules", "")
    start_question = content.get("start_question", None)
    current_chart = content.get("current_chart", None)
    focused_thread = content.get("focused_thread", None)
    other_threads = content.get("other_threads", None)
    primary_tables = content.get("primary_tables", None)
    exploration_thread = content.get("exploration_thread", None)
    current_data_sample = content.get("current_data_sample", None)

    knowledge_store = _get_knowledge_store(identity_id)

    def generate():
        agent = InteractiveExploreAgent(client=client, workspace=workspace,
                                        agent_exploration_rules=agent_exploration_rules,
                                        language_instruction=get_language_instruction(),
                                        knowledge_store=knowledge_store)
        try:
            text_buf = ""
            for chunk in agent.run(
                input_tables,
                start_question=start_question,
                focused_thread=focused_thread,
                other_threads=other_threads,
                primary_tables=primary_tables,
                current_chart=current_chart,
                exploration_thread=exploration_thread,
                current_data_sample=current_data_sample,
            ):
                if isinstance(chunk, dict):
                    # Flush pending text before emitting structured event
                    while "\n" in text_buf:
                        line, text_buf = text_buf.split("\n", 1)
                        ndjson_line = _try_parse_explore_line(line)
                        if ndjson_line:
                            yield ndjson_line
                    yield json.dumps(chunk, ensure_ascii=False) + "\n"
                    continue
                text_buf += chunk
                while "\n" in text_buf:
                    line, text_buf = text_buf.split("\n", 1)
                    ndjson_line = _try_parse_explore_line(line)
                    if ndjson_line:
                        yield ndjson_line
            if text_buf.strip():
                ndjson_line = _try_parse_explore_line(text_buf)
                if ndjson_line:
                    yield ndjson_line
        except Exception as e:
            logger.exception("get-recommendation-questions failed")
            yield stream_error_event(classify_and_wrap_llm_error(e))

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )


@agent_bp.route('/generate-report-chat', methods=['POST'])
def generate_report_chat():
    """Chat-driven report generation via @report-agent.

    Accepts lightweight context + user prompt.  The agent inspects
    charts/data on demand via tool calls and streams the report with
    embed_chart / embed_table events.
    """
    from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error
    from data_formulator.errors import ErrorCode

    if not request.is_json:
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.INVALID_REQUEST,
            "message": "Invalid request format",
            "retry": False,
        }})

    logger.info("# generate report chat request")
    content = request.get_json()

    client = get_client(content['model'])
    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)

    input_tables = content.get("input_tables", [])
    charts = content.get("charts", [])
    user_prompt = content.get("user_prompt", "Create a report summarizing the exploration.")
    focused_thread = content.get("focused_thread", None)
    other_threads = content.get("other_threads", None)
    primary_tables = content.get("primary_tables", None)

    def generate():
        agent = ReportGenAgent(
            client=client,
            workspace=workspace,
            language_instruction=get_language_instruction(),
        )
        try:
            for event in agent.run(
                input_tables,
                charts,
                user_prompt=user_prompt,
                focused_thread=focused_thread,
                other_threads=other_threads,
                primary_tables=primary_tables,
            ):
                yield json.dumps(event, ensure_ascii=False) + '\n'
        except Exception as e:
            logger.exception("generate-report-chat failed")
            yield stream_error_event(classify_and_wrap_llm_error(e))

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )


@agent_bp.route('/refresh-derived-data', methods=['POST'])
def refresh_derived_data():
    """
    Re-run Python transformation code with updated input data to refresh a derived table.
    
    Security: The code must have been previously signed by the server (via
    ``code_signing.sign_result``) when it was first generated by an agent.
    The frontend must send the original ``code_signature`` back alongside
    the code.  This endpoint verifies the signature before executing,
    preventing execution of tampered or injected code.
    
    This endpoint:
    1. Verifies the code signature (HMAC-SHA256)
    2. Gets input tables from workspace (extending with temp data if needed)
    3. Re-runs the transformation code in workspace context
    4. Updates the derived table in workspace if virtual flag is true
    
    Request body:
    - input_tables: list of {name: string, rows: list} objects representing the parent tables
    - code: the Python transformation code to execute
    - code_signature: HMAC-SHA256 signature of the code (required)
    - output_variable: the variable name containing the result DataFrame (required)
    - output_table_name: the workspace table name to update with results (required if virtual=true)
    - virtual: boolean flag indicating whether to save result to workspace
    
    Returns:
    - status: 'ok' or 'error'
    - rows: the resulting rows if successful (limited to max_display_rows)
    - virtual: {table_name: string, row_count: number} if output was saved to workspace
    - message: error message if failed
    """
    try:
        from data_formulator.sandbox import create_sandbox
        from flask import current_app
        
        data = request.get_json()
        input_tables = data.get('input_tables', [])
        code = data.get('code', '')
        code_signature = data.get('code_signature', '')
        output_variable = data.get('output_variable')
        output_table_name = data.get('output_table_name')
        virtual = data.get('virtual', False)
        
        if not input_tables:
            return jsonify({
                "status": "error",
                "message": "No input tables provided"
            })
            
        if not code:
            return jsonify({
                "status": "error", 
                "message": "No transformation code provided"
            })

        # ---- Security: verify code signature --------------------------------
        # The code must have been signed by the server when the agent first
        # generated it.  Reject unsigned or tampered code.
        if not code_signature:
            logger.warning("[refresh-derived-data] Rejected request: missing code_signature")
            return jsonify({
                "status": "error",
                "message": "Missing code_signature — code must be signed by the server"
            })

        if len(code) > MAX_CODE_SIZE:
            logger.warning(f"[refresh-derived-data] Rejected request: code too large ({len(code)} bytes)")
            return jsonify({
                "status": "error",
                "message": f"Code exceeds maximum allowed size ({MAX_CODE_SIZE} bytes)"
            })

        if not verify_code(code, code_signature):
            logger.warning("[refresh-derived-data] Rejected request: invalid code_signature (code may have been tampered with)")
            return jsonify({
                "status": "error",
                "message": "Invalid code_signature — code may have been tampered with"
            })

        # ---- Input validation -----------------------------------------------
        if len(input_tables) > 50:
            return jsonify({
                "status": "error",
                "message": "Too many input tables (max 50)"
            })
            
        if not output_variable:
            return jsonify({
                "status": "error",
                "message": "No output_variable provided"
            })

        # output_variable is interpolated into generated Python code and used
        # to construct file paths inside the sandbox.  Restrict it to valid
        # Python identifiers to prevent code-injection and path-traversal.
        if not output_variable.isidentifier():
            return jsonify({
                "status": "error",
                "message": "output_variable must be a valid Python identifier"
            })
            
        if virtual and not output_table_name:
            return jsonify({
                "status": "error",
                "message": "output_table_name is required when virtual=true"
            })
        
        # Get workspace and mount temp data for tables not in workspace
        identity_id = get_identity_id()
        workspace = get_workspace(identity_id)
        
        # Get settings from app config
        cli_args = current_app.config.get('CLI_ARGS', {})
        max_display_rows = cli_args.get('max_display_rows', 5000)
        
        sandbox = create_sandbox(cli_args.get('sandbox', 'local'))
        
        # Run the transformation code in the sandbox
        result = sandbox.run_python_code(
            code=code,
            workspace=workspace,
            output_variable=output_variable,
        )

        if result['status'] == 'ok':
            result_df = result['content']
            row_count = len(result_df)

            response_data = {
                "status": "ok",
                "message": "Successfully refreshed derived data",
                "row_count": row_count
            }

            if virtual:
                # Virtual table: update workspace and return limited rows for display
                workspace.write_parquet(result_df, output_table_name)
                response_data["virtual"] = {
                    "table_name": output_table_name,
                    "row_count": row_count
                }
                # Limit rows for response payload since full data is in workspace
                if row_count > max_display_rows:
                    display_df = result_df.head(max_display_rows)
                else:
                    display_df = result_df
                # Remove duplicate columns to avoid orient='records' error
                display_df = display_df.loc[:, ~display_df.columns.duplicated()]
                response_data["rows"] = json.loads(display_df.to_json(orient='records', date_format='iso'))
            else:
                # Temp table: return full data since there's no workspace storage
                # Remove duplicate columns to avoid orient='records' error
                result_df = result_df.loc[:, ~result_df.columns.duplicated()]
                response_data["rows"] = json.loads(result_df.to_json(orient='records', date_format='iso'))

            return jsonify(response_data)
        else:
            return jsonify({
                "status": "error",
                "message": sanitize_error_message(
                    result.get('content', 'Unknown error during transformation')
                )
            })

    except Exception as e:
        logger.error("Error refreshing derived data", exc_info=e)
        return jsonify({
            "status": "error",
            "message": classify_llm_error(e)
        })


@agent_bp.route('/workspace-summary', methods=['POST'])
def workspace_summary():
    """Generate a short name/summary for the current workspace.

    Called after the first agent interaction to auto-name the workspace.
    Expects: { model: <model_config>, context: { tables: [...], userQuery: "..." } }
    Returns: { status: "ok", summary: "3-5 word name" }
    """
    if not request.is_json:
        return jsonify(status="error", summary="")

    content = request.get_json()

    try:
        client = get_client(content['model'])
        ctx = content.get('context', {})

        language_instruction = get_language_instruction(mode="compact")
        agent = SimpleAgents(client=client, language_instruction=language_instruction)
        summary = agent.workspace_summary(
            table_names=ctx.get('tables', []),
            user_query=ctx.get('userQuery', ''),
        )
        return jsonify(status="ok", summary=summary)

    except Exception as e:
        logger.warning("Failed to generate workspace summary", exc_info=e)
        return jsonify(status="error", summary="", error_message=classify_llm_error(e))


# ---------------------------------------------------------------------------
# NL → structured filter conditions
# ---------------------------------------------------------------------------

@agent_bp.route('/nl-to-filter', methods=['POST'])
def nl_to_filter():
    """Translate a natural language filter instruction to structured conditions.

    Request body:
        model: model config object (same as other agent routes)
        columns: [{name, type}, ...]  — the table's column schema
        instruction: str — the user's NL filter description

    Response:
        {status, conditions, sort_columns?, sort_order?, limit?}
    """
    try:
        content = request.get_json() or {}
        instruction = (content.get("instruction") or "").strip()
        columns = content.get("columns") or []
        model_config = content.get("model")

        if not instruction:
            return jsonify(status="ok", conditions=[], sort_columns=[], sort_order=None, limit=None)

        if not model_config:
            return jsonify(status="error", message="No model configured")

        client = get_client(model_config)
        agent = SimpleAgents(client=client)
        result = agent.nl_to_filter(columns=columns, instruction=instruction)

        return jsonify(status="ok", **result)

    except json.JSONDecodeError:
        return jsonify(status="error", message="Failed to parse LLM response as JSON")
    except Exception as e:
        logger.warning(f"NL-to-filter failed: {e}")
        safe_msg = classify_llm_error(e)
        return jsonify(status="error", message=safe_msg)


# ---------------------------------------------------------------------------
# Scratch folder APIs (for conversational data loading)
# ---------------------------------------------------------------------------

@agent_bp.route('/workspace/scratch/upload', methods=['POST'])
def scratch_upload():
    """Upload a file to the workspace scratch/ folder.

    Accepts multipart/form-data with a 'file' field.
    Returns: { path: "scratch/<filename>", url: "/api/workspace/scratch/<filename>" }
    """
    import hashlib
    from werkzeug.utils import secure_filename as _werkzeug_secure_filename

    if 'file' not in request.files:
        return jsonify(status="error", message="No file in request")

    file = request.files['file']
    if not file.filename:
        return jsonify(status="error", message="No filename")

    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)
    scratch_jail = workspace.confined_scratch

    raw = file.read()
    file_hash = hashlib.sha256(raw).hexdigest()[:8]
    safe_name = _werkzeug_secure_filename(file.filename)
    base, ext = os.path.splitext(safe_name)
    final_name = f"{base}_{file_hash}{ext}"

    try:
        dest = scratch_jail.resolve(final_name)
    except ValueError:
        return jsonify(status="error", message="Invalid filename")
    dest.write_bytes(raw)

    return jsonify(
        status="ok",
        path=f"scratch/{final_name}",
        url=f"/api/workspace/scratch/{final_name}",
    )


@agent_bp.route('/workspace/scratch/<path:filename>', methods=['GET'])
def scratch_serve(filename):
    """Serve a file from the workspace scratch/ folder."""
    from flask import send_file

    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)
    scratch_jail = workspace.confined_scratch

    try:
        target = scratch_jail.resolve(filename)
    except ValueError:
        return jsonify(status="error", message="Access denied")

    if not target.exists():
        return jsonify(status="error", message="File not found")

    return send_file(target)


# ---------------------------------------------------------------------------
# Conversational data loading agent (replaces old clean-data-stream)
# ---------------------------------------------------------------------------

@agent_bp.route('/data-loading-chat', methods=['POST'])
def data_loading_chat():
    """Conversational data loading agent endpoint.

    Streams newline-delimited JSON events (SSE-style).
    """
    from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error
    from data_formulator.errors import ErrorCode

    if not request.is_json:
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.INVALID_REQUEST,
            "message": "Invalid request format",
            "retry": False,
        }})

    content = request.get_json()
    logger.info("# data-loading-chat request")

    messages = content.get("messages", [])
    if _messages_include_image(messages) and not model_supports_vision(content.get("model")):
        return jsonify({"status": "error", "error": {
            "code": ErrorCode.INVALID_REQUEST,
            "message": "The selected model does not support image input. Please switch to a vision-capable model or remove the image.",
            "retry": False,
        }})

    client = get_client(content['model'])
    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)

    from data_formulator.example_datasets_config import EXAMPLE_DATASETS
    available_datasets = [
        {"name": ds["name"], "description": ds.get("description", "")}
        for ds in EXAMPLE_DATASETS
    ]

    language_instruction = get_language_instruction()
    knowledge_store = _get_knowledge_store(identity_id)

    def generate():
        try:
            agent = DataLoadingAgent(
                client=client,
                workspace=workspace,
                available_datasets=available_datasets,
                language_instruction=language_instruction,
                knowledge_store=knowledge_store,
            )

            for event in agent.stream(messages):
                raw = json.dumps(event, ensure_ascii=False, default=str)
                raw = raw.replace(': NaN,', ': null,').replace(': NaN}', ': null}').replace(':NaN,', ':null,').replace(':NaN}', ':null}')
                yield raw + "\n"

        except Exception as e:
            logger.exception("data-loading-chat error")
            yield stream_error_event(classify_and_wrap_llm_error(e))
            yield json.dumps({"type": "done", "full_text": f"Error: {classify_llm_error(e)}"}, ensure_ascii=False) + "\n"

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )
