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
from flask import request, Blueprint, current_app, Response, stream_with_context
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
from data_formulator.datalake.workspace import Workspace, get_user_home
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
from data_formulator.error_handler import json_ok, stream_preflight_error, classify_and_wrap_llm_error
from data_formulator.errors import AppError, ErrorCode

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
        if "type" not in obj:
            obj = {"type": "question", **obj}
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
    return json_ok(public_models)


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

    return json_ok(results)

@agent_bp.route('/test-model', methods=['GET', 'POST'])
def test_model():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    logger.info("# test-model request")
    content = request.get_json()

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
            return json_ok({"model": content['model'], "message": ""})
        else:
            raise AppError(ErrorCode.AGENT_ERROR, "Model responded but did not pass connectivity check")
    except AppError:
        raise
    except Exception as e:
        logger.exception(f"Error testing model {content['model'].get('id', '')}")
        raise classify_and_wrap_llm_error(e) from e

@agent_bp.route('/process-data-on-load', methods=['GET', 'POST'])
def process_data_on_load_request():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    logger.info("# process-data-on-load request")
    content = request.get_json()
    input_data = content["input_data"]

    client = get_client(content['model'])

    logger.debug(f" model: {content['model']}")

    try:
        identity_id = get_identity_id()
        workspace = get_workspace(identity_id)

        language_instruction = get_language_instruction(mode="compact")
        agent = DataLoadAgent(client=client, workspace=workspace, language_instruction=language_instruction)
        candidates = agent.run(content["input_data"])
        candidates = [c['content'] for c in candidates if c['status'] == 'ok']

        return json_ok({"result": candidates})
    except Exception as e:
        logger.exception(e)
        raise classify_and_wrap_llm_error(e) from e


@agent_bp.route('/clean-data-stream', methods=['GET', 'POST'])
def clean_data_stream_request():
    from data_formulator.error_handler import stream_error_event

    if not request.is_json:
        return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "Invalid request format"))

    content = request.get_json()
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
                stripped = chunk.strip()
                if stripped.startswith("{"):
                    try:
                        result = json.loads(stripped)
                    except (json.JSONDecodeError, ValueError):
                        result = None
                    if isinstance(result, dict):
                        if result.get("status") == "ok":
                            yield json.dumps({
                                "type": "result",
                                "data": result,
                            }, ensure_ascii=False) + "\n"
                        else:
                            yield stream_error_event(AppError(
                                ErrorCode.AGENT_ERROR,
                                sanitize_error_message(result.get("content", "Unable to extract tables")),
                            ))
                        continue
                yield json.dumps({"type": "text_delta", "text": chunk}, ensure_ascii=False) + "\n"
        except Exception as e:
            logger.error("clean-data-stream error", exc_info=e)
            if 'unable to download html from url' in str(e):
                yield stream_error_event(AppError(
                    ErrorCode.DATA_LOAD_ERROR,
                    "This website doesn't allow us to download HTML from URL",
                ))
            else:
                yield stream_error_event(classify_and_wrap_llm_error(e))

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )


@agent_bp.route('/sort-data', methods=['GET', 'POST'])
def sort_data_request():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    logger.info("# sort-data request")
    content = request.get_json()

    try:
        client = get_client(content['model'])

        language_instruction = get_language_instruction(mode="compact")
        agent = SortDataAgent(client=client, language_instruction=language_instruction)
        candidates = agent.run(content['field'], content['items'])

        candidates = candidates if candidates != None else []
        return json_ok({"result": candidates})
    except Exception as e:
        logger.error("Error in sort-data", exc_info=e)
        raise classify_and_wrap_llm_error(e) from e

@agent_bp.route('/derive-data', methods=['GET', 'POST'])
def derive_data():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    logger.info("# derive-data request")
    content = request.get_json()        

    client = get_client(content['model'])

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

        return json_ok({"results": results})
    except Exception as e:
        logger.error("Error in derive-data", exc_info=e)
        raise classify_and_wrap_llm_error(e) from e

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
        - user_question: the user's reply (selections + freeform), already
          assembled by the frontend (the same string shown in the timeline)
    """
    from data_formulator.error_handler import stream_error_event

    if not request.is_json:
        return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "Invalid request format"))

    content = request.get_json()

    identity_id = get_identity_id()
    if not identity_id:
        return stream_preflight_error(AppError(ErrorCode.AUTH_REQUIRED, "Identity ID required"))

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
    completed_step_count = content.get("completed_step_count", 0)

    if resume_trajectory is not None and not str(user_question or "").strip():
        return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "user_question is required to resume after clarification"))

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
            agent = DataAgent(
                client=client,
                workspace=workspace,
                agent_exploration_rules=agent_exploration_rules,
                agent_coding_rules=agent_coding_rules,
                language_instruction=language_instruction,
                max_iterations=max_iterations,
                max_repair_attempts=max_repair_attempts,
                identity_id=identity_id,
            )

            trajectory = None
            if resume_trajectory:
                # Append the user's reply (already assembled by the frontend
                # from option clicks + any typed instructions) as a normal
                # user message. The LLM correlates numbered selections back
                # to the questions in the immediately preceding assistant
                # message.
                trajectory = list(resume_trajectory)
                trajectory.append({
                    "role": "user",
                    "content": user_question,
                })
                logger.debug("== resuming after clarification ===>")

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
                yield json.dumps(event, ensure_ascii=False) + '\n'

                if event.get("type") in ("completion", "clarify", "explain"):
                    break

        except Exception as e:
            logger.error("Error in data-agent-streaming", exc_info=e)
            yield stream_error_event(classify_and_wrap_llm_error(e))

        logger.setLevel(logging.WARNING)

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )


@agent_bp.route('/refine-data', methods=['GET', 'POST'])
def refine_data():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    logger.info("# refine-data request")
    content = request.get_json()

    client = get_client(content['model'])

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

        return json_ok({"results": results})
    except Exception as e:
        logger.error("Error in refine-data", exc_info=e)
        raise classify_and_wrap_llm_error(e) from e

@agent_bp.route('/code-expl', methods=['GET', 'POST'])
def request_code_expl():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    logger.info("# code-expl request")
    content = request.get_json()
    client = get_client(content['model'])

    input_tables = content["input_tables"]
    code = content["code"]

    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)

    language_instruction = get_language_instruction()

    try:
        code_expl_agent = CodeExplanationAgent(client=client, workspace=workspace, language_instruction=language_instruction)
        candidates = code_expl_agent.run(input_tables, code)

        if candidates and len(candidates) > 0:
            result = candidates[0]
            return json_ok(result)
        else:
            raise AppError(ErrorCode.AGENT_ERROR, "No explanation generated")
    except AppError:
        raise
    except Exception as e:
        logger.error("Error in code-expl", exc_info=e)
        raise classify_and_wrap_llm_error(e) from e

@agent_bp.route('/chart-insight', methods=['GET', 'POST'])
def request_chart_insight():
    from data_formulator.error_handler import classify_and_wrap_llm_error
    from data_formulator.errors import AppError, ErrorCode

    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    logger.info("# chart insight request")
    content = request.get_json()

    chart_image = content.get("chart_image", "")
    chart_type = content.get("chart_type", "")
    field_names = content.get("field_names", [])
    input_tables = content.get("input_tables", [])

    if not chart_image:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Chart image not available. Please retry.")

    model_config = content.get("model")
    if not model_config:
        raise AppError(ErrorCode.INVALID_REQUEST, "Model configuration is required")

    if not model_supports_vision(model_config):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "The selected model does not support image input. Please switch to a vision-capable model.",
        )

    client = get_client(model_config)
    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)

    try:
        knowledge_store = _get_knowledge_store(identity_id)
        agent = ChartInsightAgent(client=client, workspace=workspace,
                                  language_instruction=get_language_instruction(),
                                  knowledge_store=knowledge_store)
        candidates = agent.run(chart_image, chart_type, field_names, input_tables)

        if not candidates or len(candidates) == 0:
            logger.warning("[chart-insight] failed request_id=%s reason=no_candidates",
                           getattr(flask.g, 'request_id', ''))
            raise AppError(ErrorCode.AGENT_ERROR, "Unable to generate chart insight")

        result = candidates[0]
        if result.get('status') != 'ok':
            reason = result.get('content', result.get('status', 'unknown'))
            logger.warning("[chart-insight] failed request_id=%s reason=candidate_error detail=%s",
                           getattr(flask.g, 'request_id', ''), reason)
            raise AppError(ErrorCode.AGENT_ERROR, "Unable to generate chart insight")

        logger.info("[chart-insight] done request_id=%s takeaway_count=%d",
                    getattr(flask.g, 'request_id', ''),
                    len(result.get('takeaways', [])))
        return json_ok({"title": result.get("title", ""),
                        "takeaways": result.get("takeaways", [])})

    except AppError:
        raise
    except Exception as e:
        logger.error("Error in chart-insight", exc_info=e)
        raise classify_and_wrap_llm_error(e) from e

@agent_bp.route('/get-recommendation-questions', methods=['GET', 'POST'])
def get_recommendation_questions():
    from data_formulator.error_handler import stream_error_event

    if not request.is_json:
        return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "Invalid request format"))

    logger.info("# get recommendation questions request")
    content = request.get_json()

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
                    if "type" not in chunk:
                        chunk = {"type": "question", **chunk}
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
    from data_formulator.error_handler import stream_error_event

    if not request.is_json:
        return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "Invalid request format"))

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
        raise AppError(ErrorCode.VALIDATION_ERROR, "No input tables provided")

    if not code:
        raise AppError(ErrorCode.VALIDATION_ERROR, "No transformation code provided")

    if not code_signature:
        logger.warning("[refresh-derived-data] Rejected request: missing code_signature")
        raise AppError(ErrorCode.VALIDATION_ERROR, "Missing code_signature — code must be signed by the server")

    if len(code) > MAX_CODE_SIZE:
        logger.warning(f"[refresh-derived-data] Rejected request: code too large ({len(code)} bytes)")
        raise AppError(ErrorCode.VALIDATION_ERROR, f"Code exceeds maximum allowed size ({MAX_CODE_SIZE} bytes)")

    if not verify_code(code, code_signature):
        logger.warning("[refresh-derived-data] Rejected request: invalid code_signature (code may have been tampered with)")
        raise AppError(ErrorCode.VALIDATION_ERROR, "Invalid code_signature — code may have been tampered with")

    if len(input_tables) > 50:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Too many input tables (max 50)")

    if not output_variable:
        raise AppError(ErrorCode.VALIDATION_ERROR, "No output_variable provided")

    if not output_variable.isidentifier():
        raise AppError(ErrorCode.VALIDATION_ERROR, "output_variable must be a valid Python identifier")

    if virtual and not output_table_name:
        raise AppError(ErrorCode.VALIDATION_ERROR, "output_table_name is required when virtual=true")

    try:
        identity_id = get_identity_id()
        workspace = get_workspace(identity_id)

        cli_args = current_app.config.get('CLI_ARGS', {})
        max_display_rows = cli_args.get('max_display_rows', 5000)

        sandbox = create_sandbox(cli_args.get('sandbox', 'local'))

        result = sandbox.run_python_code(
            code=code,
            workspace=workspace,
            output_variable=output_variable,
        )

        if result['status'] == 'ok':
            result_df = result['content']
            row_count = len(result_df)

            response_data = {
                "message": "Successfully refreshed derived data",
                "row_count": row_count,
            }

            if virtual:
                workspace.write_parquet(result_df, output_table_name)
                response_data["virtual"] = {
                    "table_name": output_table_name,
                    "row_count": row_count
                }
                if row_count > max_display_rows:
                    display_df = result_df.head(max_display_rows)
                else:
                    display_df = result_df
                display_df = display_df.loc[:, ~display_df.columns.duplicated()]
                response_data["rows"] = json.loads(display_df.to_json(orient='records', date_format='iso'))
            else:
                result_df = result_df.loc[:, ~result_df.columns.duplicated()]
                response_data["rows"] = json.loads(result_df.to_json(orient='records', date_format='iso'))

            return json_ok(response_data)
        else:
            raise AppError(
                ErrorCode.CODE_EXECUTION_ERROR,
                sanitize_error_message(
                    result.get('content', 'Unknown error during transformation')
                ),
            )

    except AppError:
        raise
    except Exception as e:
        logger.error("Error refreshing derived data", exc_info=e)
        raise classify_and_wrap_llm_error(e) from e


@agent_bp.route('/workspace-name', methods=['POST'])
def workspace_name():
    """Generate a short display name for the current workspace.

    Called after the first agent interaction to auto-name the workspace.
    Expects: { model: <model_config>, context: { tables: [...], userQuery: "..." } }
    Returns: { status: "success", data: { display_name: "short name" } }
    """
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")

    content = request.get_json() or {}
    model_config = content.get('model')
    if not model_config:
        raise AppError(ErrorCode.INVALID_REQUEST, "No model configured")

    try:
        client = get_client(model_config)
        ctx = content.get('context', {})

        language_instruction = get_language_instruction(mode="full")
        agent = SimpleAgents(client=client, language_instruction=language_instruction)
        display_name = agent.workspace_name(
            table_names=ctx.get('tables', []),
            user_query=ctx.get('userQuery', ''),
        )
        return json_ok({"display_name": display_name})

    except AppError:
        raise
    except Exception as e:
        logger.warning("Failed to generate workspace name", exc_info=e)
        raise classify_and_wrap_llm_error(e) from e


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
        {status: "success", data: {conditions, sort_columns?, sort_order?, limit?}}
    """
    try:
        content = request.get_json() or {}
        instruction = (content.get("instruction") or "").strip()
        columns = content.get("columns") or []
        model_config = content.get("model")

        if not instruction:
            return json_ok({"conditions": [], "sort_columns": [], "sort_order": None, "limit": None})

        if not model_config:
            raise AppError(ErrorCode.INVALID_REQUEST, "No model configured")

        client = get_client(model_config)
        agent = SimpleAgents(client=client)
        result = agent.nl_to_filter(columns=columns, instruction=instruction)

        return json_ok(result)

    except AppError:
        raise
    except json.JSONDecodeError:
        raise AppError(ErrorCode.AGENT_ERROR, "Failed to parse LLM response as JSON")
    except Exception as e:
        logger.warning(f"NL-to-filter failed: {e}")
        raise classify_and_wrap_llm_error(e) from e


# ---------------------------------------------------------------------------
# Scratch folder APIs (for conversational data loading)
# ---------------------------------------------------------------------------

@agent_bp.route('/workspace/scratch/upload', methods=['POST'])
def scratch_upload():
    """Upload a file to the workspace scratch/ folder.

    Accepts multipart/form-data with a 'file' field.
    Returns: { status: "success", data: { path, url } }
    """
    import hashlib
    from werkzeug.utils import secure_filename as _werkzeug_secure_filename

    if 'file' not in request.files:
        raise AppError(ErrorCode.INVALID_REQUEST, "No file in request")

    file = request.files['file']
    if not file.filename:
        raise AppError(ErrorCode.INVALID_REQUEST, "No filename")

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
        raise AppError(ErrorCode.VALIDATION_ERROR, "Invalid filename")
    dest.write_bytes(raw)

    return json_ok({
        "path": f"scratch/{final_name}",
        "url": f"/api/workspace/scratch/{final_name}",
    })


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
        raise AppError(ErrorCode.ACCESS_DENIED, "Access denied")

    if not target.exists():
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found")

    return send_file(target)


# ---------------------------------------------------------------------------
# Conversational data loading agent (replaces old clean-data-stream)
# ---------------------------------------------------------------------------

@agent_bp.route('/data-loading-chat', methods=['POST'])
def data_loading_chat():
    """Conversational data loading agent endpoint.

    Streams newline-delimited JSON events (SSE-style).
    """
    from data_formulator.error_handler import stream_error_event

    if not request.is_json:
        return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "Invalid request format"))

    content = request.get_json()
    logger.info("# data-loading-chat request")

    messages = content.get("messages", [])
    if _messages_include_image(messages) and not model_supports_vision(content.get("model")):
        return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "The selected model does not support image input. Please switch to a vision-capable model or remove the image."))

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
                row_limit=content.get("row_limit"),
            )

            for event in agent.stream(messages):
                raw = json.dumps(event, ensure_ascii=False, default=str)
                raw = raw.replace(': NaN,', ': null,').replace(': NaN}', ': null}').replace(':NaN,', ':null,').replace(':NaN}', ':null}')
                yield raw + "\n"

        except Exception as e:
            logger.exception("data-loading-chat error")
            yield stream_error_event(classify_and_wrap_llm_error(e))

    return Response(
        stream_with_context(_with_warnings(generate())),
        mimetype='application/x-ndjson',
    )
