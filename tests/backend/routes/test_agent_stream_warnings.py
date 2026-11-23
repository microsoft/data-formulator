"""Warnings collected while an agent stream is silent reach the client without waiting for its next event."""

from __future__ import annotations

import json
import time
from threading import Event

import flask

from data_formulator.error_handler import collect_stream_warning
from data_formulator.routes.agents import _cancellable_agent_stream


def test_a_warning_collected_during_a_long_wait_is_sent_at_the_next_heartbeat():
    release = Event()

    def events():
        collect_stream_warning("The AI model is busy. Retrying in 10 seconds…", message_code="LLM_RATE_LIMIT_RETRY")
        release.wait(5)
        yield json.dumps({"type": "completion"}) + "\n"

    with flask.Flask(__name__).test_request_context():
        stream = _cancellable_agent_stream(events())
        started = time.monotonic()
        try:
            first = json.loads(next(stream))
            waited = time.monotonic() - started
        finally:
            release.set()
            rest = [json.loads(line) for line in stream]
    assert first["type"] == "warning"
    assert first["warning"]["message_code"] == "LLM_RATE_LIMIT_RETRY"
    assert waited < 2
    assert rest[-1]["type"] == "completion"
    assert not any(event["type"] == "warning" for event in rest)
