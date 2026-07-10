# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Bounded, single-use OAuth state storage in the Flask session."""

from __future__ import annotations

import hmac
import time

from flask import session

_MAX_PENDING_STATES = 8
_STATE_TTL_SECONDS = 10 * 60


def store_pending_state(namespace: str, state: str) -> None:
    now = time.time()
    states = session.get(namespace, {})
    if not isinstance(states, dict):
        states = {}
    states = {
        key: created
        for key, created in states.items()
        if isinstance(created, (int, float)) and now - created <= _STATE_TTL_SECONDS
    }
    states[state] = now
    if len(states) > _MAX_PENDING_STATES:
        states = dict(sorted(states.items(), key=lambda item: item[1])[-_MAX_PENDING_STATES:])
    session[namespace] = states


def consume_pending_state(namespace: str, state: str | None) -> bool:
    if not state:
        return False
    now = time.time()
    states = session.get(namespace, {})
    if not isinstance(states, dict):
        return False
    matched = next((key for key in states if hmac.compare_digest(key, state)), None)
    if matched is None:
        return False
    created = states.pop(matched, 0)
    session[namespace] = states
    return isinstance(created, (int, float)) and now - created <= _STATE_TTL_SECONDS


def clear_pending_states(namespace: str) -> None:
    session.pop(namespace, None)
