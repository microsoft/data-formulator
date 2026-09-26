from __future__ import annotations

import json
import hashlib
import threading
from pathlib import Path
from uuid import UUID, uuid4

from filelock import FileLock, Timeout
from flask import Blueprint, Response, request, stream_with_context, send_file, current_app

from data_formulator.auth.identity import get_identity_id, is_local_mode
from data_formulator.configuration import is_managed_mode
from data_formulator.datalake.workspace import get_user_home
from data_formulator.error_handler import json_ok, stream_error_event, classify_and_wrap_llm_error
from data_formulator.errors import AppError, ErrorCode
from data_formulator.workspace_factory import get_workspace, get_active_workspace_id
from data_formulator.workflows.instances import WorkflowStore, parse_definition
from data_formulator.workflows.agent import WorkflowAgent, new_run, public_run

workflow_bp = Blueprint("workflows", __name__, url_prefix="/api/workflows")
_cancellations: dict[str, threading.Event] = {}
_lock = threading.Lock()


def context(require_workspace: bool = True):
    if not (is_local_mode() or is_managed_mode()):
        raise AppError(ErrorCode.ACCESS_DENIED, "Workflows require local or managed mode.")
    identity = get_identity_id()
    if not identity:
        raise AppError(ErrorCode.AUTH_REQUIRED, "Sign in to run workflows.")
    if require_workspace and not get_active_workspace_id():
        raise AppError(ErrorCode.INVALID_REQUEST, "Start a session before executing a workflow.")
    workspace = get_workspace(identity) if get_active_workspace_id() else None
    return identity, WorkflowStore(get_user_home(identity)), workspace


def run_path(workspace, identifier: str) -> Path:
    try:
        identifier = UUID(identifier).hex
    except (ValueError, TypeError, AttributeError) as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid workflow run ID.") from exc
    try:
        directory = workspace.confined_scratch.resolve("_workflow_runs")
        directory.mkdir(exist_ok=True)
        path = directory / f"{identifier}.json"
        for candidate in (path, path.with_suffix(".tmp"), path.with_suffix(".pause"), Path(str(path) + ".lock"),
                  path.with_suffix(".messages"), path.with_suffix(".messages.tmp"), path.with_suffix(".messages.lock")):
            if candidate.is_symlink():
                raise ValueError("Workflow checkpoint files cannot be symlinks.")
        return path
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workflow checkpoint path is unavailable.") from exc


def save_run(path: Path, state: dict):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def read_messages(path: Path) -> list[dict]:
    inbox = path.with_suffix(".messages")
    return json.loads(inbox.read_text()) if inbox.exists() else []


@workflow_bp.route("/message", methods=["POST"])
def steer_run():
    _, _, workspace = context()
    body = request.get_json() or {}
    path = run_path(workspace, body.get("run_id"))
    text = body.get("message")
    if not isinstance(text, str) or not text.strip() or len(text) > 8000:
        raise AppError(ErrorCode.INVALID_REQUEST, "Provide a workflow message of 1-8,000 characters.")
    try:
        identifier = UUID(body.get("message_id")).hex
    except (ValueError, TypeError, AttributeError) as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, "Provide a unique message ID.") from exc
    with FileLock(str(path.with_suffix(".messages.lock"))):
        if not path.exists():
            raise AppError(ErrorCode.INVALID_REQUEST, "Workflow run not found in this session.")
        messages = read_messages(path)
        existing = next((message for message in messages if message["id"] == identifier), None)
        if existing:
            if existing["text"] != text.strip():
                raise AppError(ErrorCode.INVALID_REQUEST, "Message ID already used for different text.")
            return json_ok({"message": existing})
        state = json.loads(path.read_text())
        if state["status"] not in {"running", "paused"}:
            raise AppError(ErrorCode.INVALID_REQUEST, "This workflow is complete. Start a new run for a new request.")
        if len(messages) >= 100:
            raise AppError(ErrorCode.INVALID_REQUEST, "This workflow has reached its 100-message limit.")
        message = {"id": identifier, "text": text.strip()}
        messages.append(message)
        temporary = path.with_suffix(".messages.tmp")
        temporary.write_text(json.dumps(messages, ensure_ascii=False), encoding="utf-8")
        temporary.replace(path.with_suffix(".messages"))
    return json_ok({"message": message})


@workflow_bp.route("/list", methods=["POST"])
def list_instances():
    _, store, workspace = context(False)
    runs = []
    try:
        directory = workspace.confined_scratch.resolve("_workflow_runs") if workspace else None
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workflow checkpoint path is unavailable.") from exc
    if directory and directory.exists():
        for path in sorted(directory.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[:20]:
            if path.is_symlink():
                continue
            try:
                state = json.loads(path.read_text())
                runs.append({key: state[key] for key in ("id", "status", "started_at", "step_id", "message")}
                            | {"name": state["instance"]["name"]})
            except (ValueError, KeyError):
                continue
    items = store.list_all()
    return json_ok({"items": items, "runs": runs})


def read_definition(store, path):
    content = store.read(path)
    return content, hashlib.sha256(content.encode("utf-8")).hexdigest()


@workflow_bp.route("/read", methods=["POST"])
def read_instance():
    _, store, workspace = context(False)
    try:
        content, content_hash = read_definition(store, (request.get_json() or {}).get("path"))
        return json_ok({"content": content, "content_hash": content_hash})
    except (ValueError, FileNotFoundError) as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc


@workflow_bp.route("/save", methods=["POST"])
def save_instance():
    _, store, workspace = context(False)
    body = request.get_json() or {}
    content_hash = None
    try:
        if not isinstance(body.get("content"), str):
            raise ValueError("Workflow content must be YAML text.")
        parse_definition(body["content"])
        path = body.get("path")
        store.validate_name(path)
        with FileLock(str(store.files.resolve(".library.lock"))):
            existing_hash = hashlib.sha256(store.read(path).encode("utf-8")).hexdigest() if store.files.exists(path) else None
            if existing_hash != body.get("content_hash"):
                raise ValueError("Workflow changed or already exists; read it again before saving.")
            store.save(path, body["content"])
        content_hash = hashlib.sha256(body["content"].encode("utf-8")).hexdigest()
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    return json_ok({"path": body["path"], "content_hash": content_hash})


@workflow_bp.route("/delete", methods=["POST"])
def delete_instance():
    _, store, _ = context(False)
    path = (request.get_json() or {}).get("path")
    try:
        store.delete(path)
    except (ValueError, OSError) as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    return json_ok({"path": path})


@workflow_bp.route("/run-state", methods=["POST"])
def get_run():
    _, _, workspace = context()
    path = run_path(workspace, (request.get_json() or {}).get("run_id"))
    if not path.exists():
        raise AppError(ErrorCode.INVALID_REQUEST, "Workflow run not found in this session.")
    state = json.loads(path.read_text())
    if state["status"] == "running":
        execution_lock = FileLock(str(path) + ".lock")
        try:
            execution_lock.acquire(timeout=0)
        except Timeout:
            pass
        else:
            try:
                state = json.loads(path.read_text())
                if state["status"] == "running":
                    state.update(status="paused", message="Execution interrupted: the workflow executor stopped. Review and resume the checkpoint.")
                    save_run(path, state)
            finally:
                execution_lock.release()
    return json_ok({"run": public_run(state)})


@workflow_bp.route("/pause", methods=["POST"])
def pause_run():
    _, _, workspace = context()
    path = run_path(workspace, (request.get_json() or {}).get("run_id"))
    with _lock:
        cancellation = _cancellations.get(str(path))
        if cancellation:
            cancellation.set()
    path.with_suffix(".pause").touch()
    return json_ok({"requested": True})


@workflow_bp.route("/artifact", methods=["POST"])
def download_artifact():
    _, _, workspace = context()
    body = request.get_json() or {}
    path = run_path(workspace, body.get("run_id"))
    if not path.exists():
        raise AppError(ErrorCode.INVALID_REQUEST, "Run not found.")
    state = json.loads(path.read_text())
    filename = body.get("filename")
    if not isinstance(filename, str) or filename not in state.get("artifacts", []) or Path(filename).name != filename:
        raise AppError(ErrorCode.INVALID_REQUEST, "Unknown run artifact.")
    directory = workspace.confined_scratch.root / ("workflow-" + path.stem)
    artifact = directory / filename
    if directory.is_symlink() or artifact.is_symlink() or not artifact.is_file():
        raise AppError(ErrorCode.INVALID_REQUEST, "Artifact is unavailable.")
    return send_file(artifact, as_attachment=True, download_name=filename)


@workflow_bp.route("/run", methods=["POST"])
def run_instance():
    identity, store, workspace = context()
    body = request.get_json() or {}
    if not isinstance(body.get("model"), dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "Select a model to execute the workflow.")
    identifier = body.get("run_id") or uuid4().hex
    path = run_path(workspace, identifier)
    lock = FileLock(str(path) + ".lock")
    try:
        lock.acquire(timeout=0)
    except Timeout as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, "This workflow is already running.") from exc
    try:
        terminal_proposal = None
        operation_repository = None
        execution_operation = None
        resolved_interaction = None
        if body.get("run_id"):
            if "setup" in body:
                raise ValueError("Setup is only accepted for new runs. Use steering to revise an existing run.")
            if not path.exists():
                raise ValueError("Run not found in this session.")
            state = json.loads(path.read_text())
            if state["status"] == "completed":
                raise ValueError("This run is complete. Start a new run for fresh data.")
            terminal_response = body.get("terminal_response")
            interaction_response = body.get("interaction_response")
            pending_terminal = state.get("terminal_request")
            pending_interaction = state.get("interaction")
            if terminal_response is not None:
                from data_formulator.analyst.skills.terminal.skill import require_local_terminal_request
                require_local_terminal_request()
                if (not isinstance(terminal_response, dict) or not pending_terminal
                        or terminal_response.get("request_id") != pending_terminal["id"]
                        or terminal_response.get("decision") not in ("approve", "reject")):
                    raise ValueError("Terminal response must match this workflow's pending command.")
                if terminal_response["decision"] == "approve":
                    if pending_terminal.get("execution_started"):
                        raise ValueError("This command was already started. Reject the pending request and inspect its outputs.")
                    broker = current_app.extensions.get("terminal_requests")
                    if broker is None:
                        raise ValueError("Terminal request expired. Reject it and request a new command.")
                    terminal_proposal = broker.consume(pending_terminal["id"], identity, state["id"],
                                                       workspace_id=get_active_workspace_id() or "")
                else:
                    broker = current_app.extensions.get("terminal_requests")
                    if broker is not None:
                        try:
                            broker.consume(pending_terminal["id"], identity, state["id"],
                                           workspace_id=get_active_workspace_id() or "")
                        except ValueError:
                            pass
                    resolved_interaction = {"rejected": True, "output": "User rejected this command. Do not retry it."}
            elif pending_terminal:
                raise ValueError("Approve or reject the pending terminal command before resuming.")
            elif interaction_response is not None:
                from data_formulator.data_operations import DataOperationRepository, resolve_interaction_response
                pending_operation = (pending_interaction or {}).get("data_operation", {})
                if (not isinstance(interaction_response, dict)
                        or interaction_response.get("operation_id") != pending_operation.get("id")
                        or not pending_operation.get("id")):
                    raise ValueError("Loading response must match this workflow's pending proposal.")
                operation_repository = DataOperationRepository.for_workspace(workspace)
                response_text = resolve_interaction_response(operation_repository, interaction_response)
                if interaction_response.get("action") == "elaborate":
                    resolved_interaction = {"reply": response_text}
                else:
                    execution_operation = operation_repository.get(pending_operation["id"])
            elif pending_interaction:
                if not str(body.get("reply", "")).strip():
                    raise ValueError("Respond to the pending interaction before resuming.")
                resolved_interaction = {"user_reply": str(body["reply"]),
                                        "instruction": "Verify source availability with discovery tools before using it."}
            state.update(status="running", message="")
            reply = body.get("reply", "")
            if reply:
                state["trajectory"].append({"role": "user", "content": str(reply)})
        else:
            if body.get("terminal_response") is not None or body.get("interaction_response") is not None:
                raise ValueError("An interaction response requires an existing workflow run.")
            content = body.get("content") if "content" in body else read_definition(store, body.get("path"))[0]
            state = new_run(parse_definition(content), UUID(identifier).hex, body.get("setup"))
        if "external_references" in body:
            from data_formulator.analyst.workspace_inputs import normalize_external_references

            references = {item["id"]: item for item in normalize_external_references(state.get("external_references"))}
            references.update({item["id"]: item for item in normalize_external_references(body["external_references"])})
            state["external_references"] = list(references.values())
        from data_formulator.routes.agents import get_client

        client = get_client(body["model"])
        save_run(path, state)
    except (ValueError, FileNotFoundError) as exc:
        lock.release()
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    except Exception:
        lock.release()
        raise
    cancellation = threading.Event()
    path.with_suffix(".pause").unlink(missing_ok=True)
    with _lock:
        _cancellations[str(path)] = cancellation

    def checkpoint(current):
        if path.with_suffix(".pause").exists():
            cancellation.set()
        with FileLock(str(path.with_suffix(".messages.lock"))):
            if current["status"] == "completed" and any(
                message["id"] not in current.get("applied_message_ids", []) for message in read_messages(path)
            ):
                current.update(status="running", message="Considering the latest user message before completing.")
            save_run(path, current)

    def generate():
        try:
            yield json.dumps({"type": "workflow_state", "run": public_run(state)}) + "\n"
            agent = WorkflowAgent(client, workspace, state, checkpoint, cancellation, identity)
            agent.read_messages = lambda: read_messages(path)
            if terminal_proposal is not None:
                from data_formulator.analyst.skills.terminal.skill import run_command
                state["terminal_request"]["execution_started"] = True
                checkpoint(state)
                execution = run_command(terminal_proposal, scratch_dir=workspace.confined_scratch.root)
                terminal_result = {"interrupted": True, "output": "Command interrupted; inspect scratch before retrying."}
                try:
                    for event in execution:
                        if event["type"] == "terminal_result":
                            terminal_result = event["result"]
                        checkpoint(state)
                        if cancellation.is_set():
                            break
                        yield json.dumps(event, ensure_ascii=False) + "\n"
                except OSError as exc:
                    terminal_result = {"error": str(exc), "exit_code": None}
                finally:
                    execution.close()
                    agent.resolve_pending(terminal_result)
                    checkpoint(state)
            elif execution_operation is not None:
                from data_formulator.data_operations import DataOperationExecutor, OperationError
                try:
                    result = DataOperationExecutor(
                        workspace, external_references=state.get("external_references", []),
                    ).execute(execution_operation)
                    completed = operation_repository.finish(execution_operation.id, result.result_table_ids, result.failed_steps, result.result_references)
                except Exception as exc:
                    completed = operation_repository.fail(execution_operation.id, OperationError(code="IMPORT_FAILED", message=str(exc)))
                agent.resolve_pending({"operation": completed.to_public_dict()})
                for table_id in completed.result_table_ids:
                    state["outputs"].append({"id": f"import-{completed.id}-{table_id}", "type": "tool_result",
                                             "tool": "create_data", "stdout": json.dumps({"table_name": table_id})})
                checkpoint(state)
            elif resolved_interaction is not None:
                agent.resolve_pending(resolved_interaction)
                checkpoint(state)
            for event in agent.run_workflow():
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except GeneratorExit:
            state.update(status="paused", message="Connection interrupted. Review and resume the checkpoint.")
            save_run(path, state)
            raise
        except Exception as exc:
            state.update(status="paused", message="Execution failed. Check source access and model configuration, then resume.")
            save_run(path, state)
            yield json.dumps({"type": "workflow_state", "run": public_run(state)}) + "\n"
            yield stream_error_event(classify_and_wrap_llm_error(exc))
        finally:
            with _lock:
                _cancellations.pop(str(path), None)
            lock.release()

    return Response(stream_with_context(generate()), mimetype="application/x-ndjson")