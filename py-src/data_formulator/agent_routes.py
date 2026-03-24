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
from flask import request, jsonify, Blueprint, current_app, Response, stream_with_context
import logging

import json
import html
import pandas as pd

from data_formulator.agents.agent_data_transform import DataTransformationAgent
from data_formulator.agents.agent_data_rec import DataRecAgent

from data_formulator.agents.agent_sort_data import SortDataAgent
from data_formulator.auth import get_identity_id
from data_formulator.code_signing import sign_result, verify_code, MAX_CODE_SIZE
from data_formulator.datalake.workspace import Workspace, WorkspaceWithTempData
from data_formulator.workspace_factory import get_workspace
from data_formulator.agents.agent_data_load import DataLoadAgent
from data_formulator.agents.agent_data_clean_stream import DataCleanAgentStream
from data_formulator.agents.agent_code_explanation import CodeExplanationAgent
from data_formulator.agents.agent_chart_insight import ChartInsightAgent
from data_formulator.agents.agent_interactive_explore import InteractiveExploreAgent
from data_formulator.agents.agent_report_gen import ReportGenAgent
from data_formulator.agents.client_utils import Client
from data_formulator.model_registry import model_registry

from data_formulator.agents.data_agent import DataAgent
from data_formulator.agents.agent_language import build_language_instruction

# Get logger for this module (logging config done in app.py)
logger = logging.getLogger(__name__)


def get_language_instruction(*, mode: str = "full") -> str:
    """Read the UI language from the Accept-Language header and build the prompt instruction.

    mode: "full" for text-heavy agents, "compact" for code-generation agents.
    """
    lang = request.headers.get('Accept-Language', 'en').split(',')[0].split('-')[0].strip().lower()
    return build_language_instruction(lang, mode=mode)


def get_temp_tables(workspace, input_tables: list[dict]) -> list[dict]:
    """
    Determine which input tables are temp tables (not persisted in the workspace datalake).
    
    Args:
        workspace: The user's workspace instance
        input_tables: List of table dicts with 'name' and 'rows' keys
        
    Returns:
        List of table dicts that don't exist in the workspace (temp tables)
    """
    existing_tables = set(workspace.list_tables())
    input_names = [t.get('name') for t in input_tables]
    temp_tables = [table for table in input_tables if table.get('name') not in existing_tables]
    temp_names = [t.get('name') for t in temp_tables]
    logger.info(f"[get_temp_tables] existing={existing_tables}, input={input_names}, temp={temp_names}")
    return temp_tables

agent_bp = Blueprint('agent', __name__, url_prefix='/api/agent')


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

@agent_bp.errorhandler(Exception)
def handle_agent_error(e):
    """Catch-all error handler to ensure JSON responses instead of HTML error pages."""
    logger.error(f"Unhandled error in agent route: {e}")
    logger.error(traceback.format_exc())
    response = flask.jsonify({
        "status": "error",
        "error_message": sanitize_model_error(str(e)),
        "results": [],
        "result": []
    })
    return response, 500

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
    return json.dumps(public_models, ensure_ascii=False)


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
    for p in all_public:
        logger.info(f"  -> {p['id']}  (endpoint={p['endpoint']}, model={p['model']}, api_base={p['api_base']})")
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
            raw_err = str(e)
            error = sanitize_model_error(raw_err) if raw_err else "Connection failed, please check server configuration"

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

    return json.dumps(results, ensure_ascii=False)

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
        except Exception as e:
            logger.warning(f"Error testing model {content['model'].get('id', '')}: {e}")
            is_global = content['model'].get('is_global', False)
            result = {
                "model": content['model'],
                "status": 'error',
                "message": "Connection failed, please check server configuration" if is_global
                           else sanitize_model_error(str(e)),
            }
    else:
        result = {'status': 'error'}
    
    return json.dumps(result, ensure_ascii=False)

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
            temp_data = get_temp_tables(workspace, input_tables)
            
            with WorkspaceWithTempData(workspace, temp_data) as workspace:
                language_instruction = get_language_instruction(mode="compact")
                agent = DataLoadAgent(client=client, workspace=workspace, language_instruction=language_instruction)
                candidates = agent.run(content["input_data"])
                candidates = [c['content'] for c in candidates if c['status'] == 'ok']

            response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
        except Exception as e:
            logger.exception(e)
            response = flask.jsonify({ "token": token, "status": "error", "result": [] })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    return response


@agent_bp.route('/clean-data-stream', methods=['GET', 'POST'])
def clean_data_stream_request():
    def generate():
        if request.is_json:
            logger.info("# clean-data-stream request")
            content = request.get_json()
            token = content["token"]

            client = get_client(content['model'])

            logger.debug(f" model: {content['model']}")
            
            language_instruction = get_language_instruction()
            agent = DataCleanAgentStream(client=client, language_instruction=language_instruction)

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
                yield '\n' + json.dumps(error_data, ensure_ascii=False) + '\n'
        else:
            error_data = { 
                "token": -1, 
                "status": "error", 
                "result": "Invalid request format" 
            }
            yield '\n' + json.dumps(error_data, ensure_ascii=False) + '\n'

    response = Response(
        stream_with_context(generate()),
        mimetype='application/json',
    )
    return response


@agent_bp.route('/sort-data', methods=['GET', 'POST'])
def sort_data_request():

    if request.is_json:
        logger.info("# sort-data request")
        content = request.get_json()
        token = content["token"]

        try:
            client = get_client(content['model'])

            agent = SortDataAgent(client=client)
            candidates = agent.run(content['field'], content['items'])

            candidates = candidates if candidates != None else []
            response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
        except Exception as e:
            logger.error(f"Error in sort-data: {e}")
            logger.error(traceback.format_exc())
            response = flask.jsonify({ "token": token, "status": "error", "result": [], "error_message": sanitize_model_error(str(e)) })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

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

        try:
            identity_id = get_identity_id()
            workspace = get_workspace(identity_id)
            temp_data = get_temp_tables(workspace, input_tables)
            max_display_rows = current_app.config['CLI_ARGS']['max_display_rows']

            language_instruction = get_language_instruction(mode="compact")

            model_info = {
                "model": content['model'].get("model", ""),
                "endpoint": content['model'].get("endpoint", ""),
                "api_base": content['model'].get("api_base", ""),
            }

            with WorkspaceWithTempData(workspace, temp_data) as workspace:
                if mode == "recommendation":
                    agent = DataRecAgent(client=client, workspace=workspace, agent_coding_rules=agent_coding_rules, language_instruction=language_instruction, max_display_rows=max_display_rows, model_info=model_info)
                    results = agent.run(input_tables, instruction, n=1, prev_messages=prev_messages)
                else:
                    agent = DataTransformationAgent(client=client, workspace=workspace, agent_coding_rules=agent_coding_rules, language_instruction=language_instruction, max_display_rows=max_display_rows, model_info=model_info)
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
                            "content": sanitize_model_error(str(followup_exc)),
                            "code": "",
                            "dialog": [],
                        }]
                        break

                    repair_attempts += 1
                    logger.warning(f"[derive-data] Repair attempt {repair_attempts}/{max_repair_attempts} result: {results[0].get('status', 'unknown')}")

                if repair_attempts > 0:
                    logger.warning(f"[derive-data] Finished repair loop after {repair_attempts} attempt(s). Final status: {results[0].get('status', 'unknown')}")

            # Sign code in each result so the frontend can send it back
            # for re-execution during data refresh with proof of authenticity.
            for r in results:
                sign_result(r)

            response = flask.jsonify({ "token": token, "status": "ok", "results": results })
        except Exception as e:
            logger.error(f"Error in derive-data: {e}")
            logger.error(traceback.format_exc())
            response = flask.jsonify({ "token": token, "status": "error", "results": [], "error_message": sanitize_model_error(str(e)) })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": [] })

    return response

@agent_bp.route('/data-agent-streaming', methods=['GET', 'POST'])
def data_agent_streaming():
    """Autonomous data exploration agent endpoint (SWE-agent style).

    Accepts a user question, runs the DataAgent observe-think-act loop,
    and streams events back as newline-delimited JSON.

    To resume after a clarification, the client sends:
        - trajectory: the trajectory list returned in the clarify event
        - clarification_response: the user's answer (string)
    The server appends the answer to the trajectory and continues the loop.
    """
    def generate():
        if request.is_json:
            logger.setLevel(logging.INFO)
            logger.info("# data-agent-streaming request")

            content = request.get_json()
            token = content.get("token", "")

            input_tables = content["input_tables"]
            user_question = content.get("user_question", "")
            max_iterations = content.get("max_iterations", 5)
            max_repair_attempts = content.get("max_repair_attempts", 1)
            agent_exploration_rules = content.get("agent_exploration_rules", "")
            agent_coding_rules = content.get("agent_coding_rules", "")
            conversation_history = content.get("conversation_history", None)

            # Stateless resume: client sends back the trajectory + user answer
            resume_trajectory = content.get("trajectory", None)
            clarification_response = content.get("clarification_response", None)
            completed_step_count = content.get("completed_step_count", 0)

            logger.debug("== input tables ===>")
            for table in input_tables:
                logger.debug(f"===> Table: {table['name']} (first 5 rows)")
                logger.debug(table['rows'][:5])

            logger.debug(f"== user question ===> {user_question}")

            client = get_client(content['model'])
            identity_id = get_identity_id()

            if not identity_id:
                yield json.dumps({
                    "token": token,
                    "status": "error",
                    "result": {"type": "error", "error_message": "Identity ID required"},
                }, ensure_ascii=False) + '\n'
                return

            workspace = get_workspace(identity_id)
            temp_data = get_temp_tables(workspace, input_tables) if input_tables else None

            language_instruction = get_language_instruction(mode="full")
            rec_language_instruction = get_language_instruction(mode="compact")

            try:
                with WorkspaceWithTempData(workspace, temp_data) as ws:
                    agent = DataAgent(
                        client=client,
                        workspace=ws,
                        agent_exploration_rules=agent_exploration_rules,
                        agent_coding_rules=agent_coding_rules,
                        language_instruction=language_instruction,
                        rec_language_instruction=rec_language_instruction,
                        max_iterations=max_iterations,
                        max_repair_attempts=max_repair_attempts,
                    )

                    # Build trajectory for resume or fresh start
                    trajectory = None
                    if resume_trajectory and clarification_response:
                        # Append the user's clarification to the saved trajectory
                        trajectory = list(resume_trajectory)
                        trajectory.append({
                            "role": "user",
                            "content": f"[USER CLARIFICATION]\n\n{clarification_response}",
                        })
                        logger.debug(f"== resuming with clarification ===> {clarification_response}")

                    for event in agent.run(
                        input_tables=input_tables,
                        user_question=user_question,
                        conversation_history=conversation_history,
                        trajectory=trajectory,
                        completed_step_count=completed_step_count,
                    ):
                        yield json.dumps({
                            "token": token,
                            "status": "ok",
                            "result": event,
                        }, ensure_ascii=False) + '\n'

                        # Stop streaming after terminal events
                        if event.get("type") in ("completion", "clarify"):
                            break

            except Exception as e:
                logger.error(f"Error in data-agent-streaming: {e}")
                logger.error(traceback.format_exc())
                yield json.dumps({
                    "token": token,
                    "status": "error",
                    "result": None,
                    "error_message": sanitize_model_error(str(e)),
                }, ensure_ascii=False) + '\n'

            logger.setLevel(logging.WARNING)

        else:
            yield json.dumps({
                "token": "",
                "status": "error",
                "result": None,
                "error_message": "Invalid request format",
            }, ensure_ascii=False) + '\n'

    response = Response(
        stream_with_context(generate()),
        mimetype='application/json',
    )
    return response


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
            temp_data = get_temp_tables(workspace, input_tables)
            max_display_rows = current_app.config['CLI_ARGS']['max_display_rows']

            language_instruction = get_language_instruction(mode="compact")

            model_info = {
                "model": content['model'].get("model", ""),
                "endpoint": content['model'].get("endpoint", ""),
                "api_base": content['model'].get("api_base", ""),
            }

            with WorkspaceWithTempData(workspace, temp_data) as workspace:
                agent = DataTransformationAgent(client=client, workspace=workspace, agent_coding_rules=agent_coding_rules, language_instruction=language_instruction, max_display_rows=max_display_rows, model_info=model_info)
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
                            "content": sanitize_model_error(str(followup_exc)),
                            "code": "",
                            "dialog": [],
                        }]
                        break

                    repair_attempts += 1
                    logger.info(f"[refine-data] Repair attempt {repair_attempts}/{max_repair_attempts} result: {results[0].get('status', 'unknown')}")

                if repair_attempts > 0:
                    logger.info(f"[refine-data] Finished repair loop after {repair_attempts} attempt(s). Final status: {results[0].get('status', 'unknown')}")

            # Sign code in each result for secure refresh later.
            for r in results:
                sign_result(r)

            response = flask.jsonify({ "token": token, "status": "ok", "results": results})
        except Exception as e:
            logger.error(f"Error in refine-data: {e}")
            logger.error(traceback.format_exc())
            response = flask.jsonify({ "token": token, "status": "error", "results": [], "error_message": sanitize_model_error(str(e)) })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": []})

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
        temp_data = get_temp_tables(workspace, input_tables)

        language_instruction = get_language_instruction()

        with WorkspaceWithTempData(workspace, temp_data) as workspace:
            try:
                code_expl_agent = CodeExplanationAgent(client=client, workspace=workspace, language_instruction=language_instruction)
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
            except Exception as e:
                logger.error(f"Error in code-expl: {e}")
                logger.error(traceback.format_exc())
                return jsonify({'error': sanitize_model_error(str(e))}), 400
    else:
        return jsonify({'error': 'Invalid request format'}), 400

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
        temp_data = get_temp_tables(workspace, input_tables)

        with WorkspaceWithTempData(workspace, temp_data) as workspace:
            try:
                agent = ChartInsightAgent(client=client, workspace=workspace,
                                          language_instruction=get_language_instruction())
                candidates = agent.run(chart_image, chart_type, field_names, input_tables)

                if candidates and len(candidates) > 0:
                    result = candidates[0]
                    if result['status'] == 'ok':
                        return jsonify(result)
                    else:
                        return jsonify(result), 400
                else:
                    return jsonify({'error': 'No insight generated'}), 400
            except Exception as e:
                logger.error(f"Error in chart-insight: {e}")
                logger.error(traceback.format_exc())
                return jsonify({'error': sanitize_model_error(str(e))}), 400
    else:
        return jsonify({'error': 'Invalid request format'}), 400

@agent_bp.route('/get-recommendation-questions', methods=['GET', 'POST'])
def get_recommendation_questions():
    def generate():
        if request.is_json:
            logger.info("# get recommendation questions request")
            content = request.get_json()
            token = content.get("token", "")

            client = get_client(content['model'])

            input_tables = content.get("input_tables", [])
            identity_id = get_identity_id()
            workspace = get_workspace(identity_id)

            agent_exploration_rules = content.get("agent_exploration_rules", "")
            mode = content.get("mode", "interactive")
            start_question = content.get("start_question", None)
            exploration_thread = content.get("exploration_thread", None)
            current_chart = content.get("current_chart", None)
            current_data_sample = content.get("current_data_sample", None)

            # Collect all tables that need to be in workspace:
            # both the input tables and any tables from the exploration thread
            all_tables = list(input_tables)
            if exploration_thread:
                all_tables.extend(exploration_thread)
            temp_data = get_temp_tables(workspace, all_tables) if all_tables else None

            with WorkspaceWithTempData(workspace, temp_data) as workspace:
                agent = InteractiveExploreAgent(client=client, workspace=workspace,
                                                agent_exploration_rules=agent_exploration_rules,
                                                language_instruction=get_language_instruction())
                try:
                    for chunk in agent.run(input_tables, start_question, exploration_thread, current_data_sample, current_chart, mode):
                        yield chunk
                except Exception as e:
                    logger.exception("get-recommendation-questions failed")
                    error_data = {
                        "content": sanitize_model_error(str(e))
                    }
                    yield 'error: ' + json.dumps(error_data, ensure_ascii=False) + '\n'
        else:
            error_data = { 
                "content": "Invalid request format" 
            }
            yield 'error: ' + json.dumps(error_data, ensure_ascii=False) + '\n'

    response = Response(
        stream_with_context(generate()),
        mimetype='application/json',
    )
    return response

@agent_bp.route('/generate-report-stream', methods=['GET', 'POST'])
def generate_report_stream():
    def generate():
        if request.is_json:
            logger.info("# generate report stream request")
            content = request.get_json()
            token = content.get("token", "")

            client = get_client(content['model'])

            input_tables = content.get("input_tables", [])
            charts = content.get("charts", [])
            style = content.get("style", "blog post")
            identity_id = get_identity_id()
            workspace = get_workspace(identity_id)
            temp_data = get_temp_tables(workspace, input_tables) if input_tables else None

            with WorkspaceWithTempData(workspace, temp_data) as workspace:
                agent = ReportGenAgent(client=client, workspace=workspace,
                                       language_instruction=get_language_instruction())
                try:
                    for chunk in agent.stream(input_tables, charts, style):
                        yield chunk
                except Exception as e:
                    logger.error(e)
                    error_data = { 
                        "content": "unable to process report generation request" 
                    }
                    yield 'error: ' + json.dumps(error_data, ensure_ascii=False) + '\n'
        else:
            error_data = { 
                "content": "Invalid request format" 
            }
            yield 'error: ' + json.dumps(error_data, ensure_ascii=False) + '\n'

    response = Response(
        stream_with_context(generate()),
        mimetype='application/json',
    )
    return response


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
            }), 400
            
        if not code:
            return jsonify({
                "status": "error", 
                "message": "No transformation code provided"
            }), 400

        # ---- Security: verify code signature --------------------------------
        # The code must have been signed by the server when the agent first
        # generated it.  Reject unsigned or tampered code.
        if not code_signature:
            logger.warning("[refresh-derived-data] Rejected request: missing code_signature")
            return jsonify({
                "status": "error",
                "message": "Missing code_signature — code must be signed by the server"
            }), 403

        if len(code) > MAX_CODE_SIZE:
            logger.warning(f"[refresh-derived-data] Rejected request: code too large ({len(code)} bytes)")
            return jsonify({
                "status": "error",
                "message": f"Code exceeds maximum allowed size ({MAX_CODE_SIZE} bytes)"
            }), 400

        if not verify_code(code, code_signature):
            logger.warning("[refresh-derived-data] Rejected request: invalid code_signature (code may have been tampered with)")
            return jsonify({
                "status": "error",
                "message": "Invalid code_signature — code may have been tampered with"
            }), 403

        # ---- Input validation -----------------------------------------------
        if len(input_tables) > 50:
            return jsonify({
                "status": "error",
                "message": "Too many input tables (max 50)"
            }), 400
            
        if not output_variable:
            return jsonify({
                "status": "error",
                "message": "No output_variable provided"
            }), 400

        # output_variable is interpolated into generated Python code and used
        # to construct file paths inside the sandbox.  Restrict it to valid
        # Python identifiers to prevent code-injection and path-traversal.
        if not output_variable.isidentifier():
            return jsonify({
                "status": "error",
                "message": "output_variable must be a valid Python identifier"
            }), 400
            
        if virtual and not output_table_name:
            return jsonify({
                "status": "error",
                "message": "output_table_name is required when virtual=true"
            }), 400
        
        # Get workspace and mount temp data for tables not in workspace
        identity_id = get_identity_id()
        workspace = get_workspace(identity_id)
        temp_data = get_temp_tables(workspace, input_tables)
        
        # Get settings from app config
        cli_args = current_app.config.get('CLI_ARGS', {})
        max_display_rows = cli_args.get('max_display_rows', 5000)
        
        sandbox = create_sandbox(cli_args.get('sandbox', 'local'))
        
        with WorkspaceWithTempData(workspace, temp_data) as workspace:
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
                    "message": result.get('content', 'Unknown error during transformation')
                }), 400
            
    except Exception as e:
        logger.error(f"Error refreshing derived data: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 400
