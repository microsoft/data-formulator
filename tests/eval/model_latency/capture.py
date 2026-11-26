"""Capture the first model request Data Formulator sends in realistic sessions, as benchmark fixtures.

Runs the app (an eval server with its own home) on a few sessions, records the HTTP body of the first Responses API
call each request makes, and writes it to ``experiment_data/model_latency/requests/<case>.json``. The bodies hold
the full system prompt, every tool definition and the conversation history, so the benchmark replays exactly what
the app sends. It also prints the app-level start time for each case: submit to the first streamed event (app
overhead) and to the agent's first model output (what the user waits for before anything shows).

    uv run python tests/eval/model_latency/capture.py                  # every case
    uv run python tests/eval/model_latency/capture.py uis-long         # one case
    uv run python tests/eval/model_latency/capture.py --repeat 3       # time the app start several times
"""
from __future__ import annotations

import json
import sys
import time
import uuid
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "intent_routing"))
sys.path.insert(0, str(HERE.parent / "agent_fs"))
import run  # noqa: E402  (tests/eval/agent_fs/run.py)
from run import harness, multiturn  # noqa: E402

OUT = harness.REPO / "experiment_data" / "model_latency" / "requests"
CASES = {
    # case: (session, question)
    "app-empty": ("empty", "What data can I work with here?"),
    "uis-first": ("uis-sdg4", "Which countries have the lowest upper-secondary completion rate in the latest year?"),
    "uis-long": ("uis-sdg4-long", "Now show the same comparison for lower-secondary completion."),
}
run.UIS.update({"uis-sdg4": "education-sdg4", "uis-sdg4-long": "sdg4-long"})

# Record every Responses API request body the server sends (into its home), in order.
HOOK = '''
import httpx as _httpx
_send, _seq = _httpx.Client.send, [0]
def _record(self, request, *args, **kwargs):
    if "/responses" in str(request.url):
        _seq[0] += 1
        folder = os.path.join(os.environ["DATA_FORMULATOR_HOME"], "requests")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, f"{_time.time():.6f}-{_seq[0]:04d}.json"), "wb") as out:
            out.write(request.content)
    return _send(self, request, *args, **kwargs)
_httpx.Client.send = _record
from data_formulator import run_app'''


def main() -> None:
    args = sys.argv[1:]
    repeat = 1
    if "--repeat" in args:
        at = args.index("--repeat")
        repeat = int(args[at + 1])
        del args[at:at + 2]
    wanted = [case for case in (args or list(CASES)) for _ in range(repeat)]
    harness.LAUNCHER = harness.LAUNCHER.replace("from data_formulator import run_app", HOOK, 1)
    root = harness.REPO / "experiment_data" / "model_latency" / "capture-run"
    (root / "traces").mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    server = run.FsServer(root)
    server.start()
    try:
        for case in wanted:
            session, question = CASES[case]
            folder = server.home / "requests"
            before = set(folder.glob("*.json")) if folder.exists() else set()
            workspace_id = f"lat-{case}-{uuid.uuid4().hex[:6]}"
            state = server.prepare(session, workspace_id)
            body = harness.request_body(multiturn._session_state(state), question, "")
            body["model"] = run._model("gpt-6.1-sol")
            submitted, first_event, first_output = time.time(), None, None
            with requests.post(f"{server.base}/api/agent/analyst-streaming", json=body, stream=True, timeout=300,
                               headers=run._headers(server, workspace_id)) as response:
                for line in response.iter_lines():
                    if not line:
                        continue
                    event = json.loads(line)
                    if first_event is None and event.get("type") != "heartbeat":
                        first_event = time.time() - submitted
                    # The first model call is done streaming its start once the agent writes a tool call or answer.
                    if event.get("type") == "status" and event.get("phase") != "thinking":
                        first_output = time.time() - submitted
                        break
            time.sleep(1)
            new = sorted(set(folder.glob("*.json")) - before)
            if not new:
                print(f"{case}: no model request captured")
                continue
            request = json.loads(new[0].read_text())
            request.pop("prompt_cache_key", None)
            request["_case"] = {"session": session, "question": question, "captured": time.strftime("%Y-%m-%d %H:%M")}
            (OUT / f"{case}.json").write_text(json.dumps(request, ensure_ascii=False))
            print(f"{case}: first event {first_event or 0:.2f}s, first model output {first_output or 0:.2f}s; "
                  f"{len(json.dumps(request)) // 1000} KB, {len(request.get('tools') or [])} tools, "
                  f"{len(request.get('input') or [])} input items, instructions {len(request.get('instructions') or '')} chars")
    finally:
        server.stop()


if __name__ == "__main__":
    main()
