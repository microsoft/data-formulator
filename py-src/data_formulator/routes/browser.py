# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The browser's settings, its availability check, and bringing one of its tabs to the user."""

from __future__ import annotations

from flask import Blueprint, request

from data_formulator.auth.identity import get_identity_id
from data_formulator.browser.base import BrowserError
from data_formulator.configuration import BROWSER_CHOICES, ConfigurationConflict, browser_available, read_configuration, save_configuration
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode

browser_bp = Blueprint('browser', __name__, url_prefix='/api/browser')


def _local_request(*, configuration: bool = False) -> None:
    from data_formulator.analyst.skills.terminal.skill import require_local_terminal_request

    try:
        require_local_terminal_request(check_policy=False)
    except ValueError as exc:
        raise AppError(ErrorCode.ACCESS_DENIED, str(exc).replace('Terminal', 'The browser')) from exc
    if configuration and (not get_identity_id().startswith('local:') or request.headers.get('X-DF-Configuration') != '1'):
        raise AppError(ErrorCode.ACCESS_DENIED, 'Use the local application to change browser access.')


def _status(check: bool = False) -> dict:
    from data_formulator.browser.service import browser_status

    return {'revision': read_configuration()['revision'], **browser_status(check=check)}


@browser_bp.route('', methods=['GET', 'PUT'])
def browser_settings():
    try:
        if request.method == 'PUT':
            _local_request(configuration=True)
            body = request.get_json(silent=True)
            if (not isinstance(body, dict) or 'revision' not in body or not {'enabled', 'browser'} & set(body)
                    or set(body) - {'enabled', 'browser', 'revision'}
                    or not isinstance(body.get('enabled', True), bool) or body.get('browser', 'auto') not in BROWSER_CHOICES):
                raise ValueError(f'Provide revision and the browser switch (enabled) or browser ({", ".join(BROWSER_CHOICES)}).')
            if body.get('enabled') and not browser_available():
                raise ValueError('The browser is unavailable under the current deployment policy.')
            current = read_configuration()
            overrides = {**current['overrides'], **({'browser_enabled': body['enabled']} if 'enabled' in body else {}),
                         **({'browser_name': body['browser']} if 'browser' in body else {})}
            save_configuration(overrides, body['revision'])
            if body.get('enabled') is False:
                from data_formulator.browser.service import reset_service
                reset_service()
        return json_ok(_status())
    except ConfigurationConflict:
        return {'status': 'error', 'error': {'code': 'INVALID_REQUEST', 'message': 'Configuration changed. Reload before saving.', 'retry': False}}, 409
    except (ValueError, OSError) as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc


@browser_bp.route('/check', methods=['POST'])
def check_browser():
    """Try each step the agent needs (it may show macOS's permission prompt, so only on the user's click)."""
    _local_request()
    if not browser_available():
        raise AppError(ErrorCode.INVALID_REQUEST, 'The browser is unavailable under the current deployment policy.')
    return json_ok(_status(check=True))


@browser_bp.route('/focus', methods=['POST'])
def focus_tab():
    """Bring one of the agent's tabs to the front, e.g. a sign-in page the agent asked the user about."""
    from data_formulator.browser.service import get_service
    from data_formulator.configuration import browser_mode

    _local_request()
    body = request.get_json(silent=True) or {}
    if browser_mode() == 'off':
        raise AppError(ErrorCode.INVALID_REQUEST, 'The browser is turned off.')
    try:
        get_service().focus(str(body.get('tab') or ''))
    except BrowserError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    return json_ok({'tab': body.get('tab')})


@browser_bp.route('/open', methods=['POST'])
def open_for_user():
    """Open a page in the agent's browser for the user (e.g. to sign in to a site once) and bring it forward."""
    from data_formulator.browser.service import get_service

    _local_request()
    if not browser_available():
        raise AppError(ErrorCode.INVALID_REQUEST, 'The browser is unavailable under the current deployment policy.')
    body = request.get_json(silent=True) or {}
    try:
        service = get_service()
        page = service.open(str(body.get('url') or ''), timeout=30, focus_if_needed=False)
        service.focus(page['tab'])
    except BrowserError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    return json_ok({'tab': page['tab'], 'url': page.get('url'), 'title': page.get('title')})
