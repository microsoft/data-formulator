import logging
import os
import time
import uuid

from flask import Blueprint, current_app, request

from data_formulator.auth.identity import get_auth_result, get_identity_id, is_local_mode
from data_formulator.configuration import ConfigurationConflict, LIMITS, connection_definitions, effective_limit, inline_connection_settings, is_managed_mode, public_connection_definition, read_configuration, save_configuration, user_connectors_disabled, user_connectors_locked, user_models_disabled, user_models_locked
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode

configuration_bp = Blueprint('configurations', __name__, url_prefix='/api/configurations')
logger = logging.getLogger(__name__)


def public_connector_params(definition: dict) -> dict:
    from data_formulator.data_loader import DATA_LOADERS
    loader = DATA_LOADERS.get(definition['type'])
    if loader is None:
        return {}
    return {param['name']: definition['params'][param['name']]
            for param in loader.list_params()
            if not param.get('sensitive') and param.get('type') != 'password'
            and param['name'] in definition['params']}


def public_model_definition(definition: dict) -> dict:
    return {key: value for key, value in definition.items()
            if key in ('endpoint', 'model', 'api_base', 'api_version', 'auth_mode', 'managed_identity_client_id')}


def can_configure() -> bool:
    if not is_managed_mode():
        return False
    try:
        identity = get_identity_id()
    except ValueError:
        return False
    if is_local_mode() and identity.startswith('local:'):
        return True
    if not identity.startswith('user:'):
        return False
    admins = {value.strip() for value in os.environ.get('DF_ADMIN_IDENTITIES', '').split(',') if value.strip()}
    if identity in admins:
        return True
    auth_result = get_auth_result()
    login_name = (auth_result.login_name or '').strip().casefold() if auth_result else ''
    if login_name.count('@') != 1 or any(character.isspace() for character in login_name):
        return False
    local_part, domain = login_name.split('@')
    if not local_part or not domain:
        return False
    emails = {value.strip().casefold() for value in os.environ.get('DF_ADMIN_EMAILS', '').split(',') if value.strip()}
    return login_name in emails


def snapshot() -> dict:
    from pathlib import Path
    from data_formulator.model_registry import model_registry
    from data_formulator.data_connector import DATA_CONNECTORS, _ADMIN_CONNECTOR_IDS
    from data_formulator.workflows.instances import parse_workflow
    from data_formulator.configuration import workflow_content
    from data_formulator.workflows import instances
    from data_formulator.data_loader import DATA_LOADERS

    document = read_configuration()
    overrides = inline_connection_settings(document['overrides'])
    overrides = dict(overrides)
    if user_connectors_locked():
        overrides['disable_user_connectors'] = True
    if user_models_locked():
        overrides['disable_user_models'] = True
    document = {**document, 'overrides': overrides}
    models = [{key: value for key, value in model.items() if key in ('id', 'model', 'endpoint')}
              for model in model_registry.list_public(configured=False)]
    connectors = [{'id': identifier, 'display_name': DATA_CONNECTORS[identifier]._display_name,
                   'description': '', 'type': DATA_CONNECTORS[identifier]._loader_class.__name__}
                  for identifier in sorted(_ADMIN_CONNECTOR_IDS) if identifier in DATA_CONNECTORS and not identifier.startswith('installation-')]
    for identifier, definition in connection_definitions('connectors').items():
        connectors.append({'id': identifier, 'display_name': definition['display_name'], 'type': definition['type'],
                   'params': public_connector_params(definition), 'source': 'Installation'})
    for model in models:
        model['source'] = 'Installation' if model['id'].startswith('installation-') else 'Environment'
        definition = model_registry.get_config(model['id'], configured=False)
        if definition:
            model['definition'] = public_model_definition(definition)
    workflows = []
    for path in sorted(Path(instances.__file__).parent.glob('*.yaml')):
        identifier = f'demo/{path.name}'
        content = workflow_content(identifier, overrides.get('workflows', {}).get(identifier, {}))
        workflow = parse_workflow(content)
        workflows.append({'id': identifier, 'name': workflow['name'], 'content': content, 'source': 'Built-in'})
    for identifier, options in overrides.get('workflows', {}).items():
        if identifier.startswith('server/') and ('content' in options or 'file' in options):
            content = workflow_content(identifier, options)
            workflow = parse_workflow(content)
            workflows.append({'id': identifier, 'name': workflow['name'], 'content': content, 'source': 'Saved'})
    return {**document, 'catalogs': {'models': models, 'connectors': connectors, 'workflows': workflows},
            'user_connectors': {'disabled': user_connectors_disabled(),
                                'locked': user_connectors_locked()},
            'user_models': {'disabled': user_models_disabled(), 'locked': user_models_locked()},
            'loader_types': [{'type': key, 'name': loader.DISPLAY_NAME or key, 'params': loader.list_params(), 'auth_mode': loader.auth_mode()}
                             for key, loader in DATA_LOADERS.items() if key != 'sample_datasets'
                             and (key != 'local_folder' or is_local_mode()) and loader.auth_mode() in ('credentials', 'connection')],
            'allowed_api_bases': {'locked': 'DF_ALLOWED_API_BASES' in os.environ,
                      'value': [pattern.strip() for pattern in os.environ.get('DF_ALLOWED_API_BASES', '').split(',') if pattern.strip()]
                      if 'DF_ALLOWED_API_BASES' in os.environ else overrides.get('allowed_api_bases')},
            'limits': {name: {'value': effective_limit(name), 'default': effective_limit(name, configured=False), 'locked': env in os.environ,
                              'source': 'Environment' if env in os.environ else 'Saved' if name in overrides.get('limits', {}) else 'Default'}
                       for name, (env, _, _, _) in LIMITS.items()}}


@configuration_bp.route('', methods=['GET', 'PUT'])
def configurations():
    if not can_configure():
        raise AppError(ErrorCode.ACCESS_DENIED, 'Administration requires managed mode and installation administrator access.')
    try:
        if request.method == 'PUT':
            if (not request.is_json or request.headers.get('X-DF-Configuration') != '1'
                    or request.headers.get('Sec-Fetch-Site') == 'cross-site'):
                raise AppError(ErrorCode.ACCESS_DENIED, 'Use a same-origin configuration request.')
            if request.content_length and request.content_length > 1100000:
                raise ValueError('Configuration exceeds 1 MB.')
            body = request.get_json()
            if not isinstance(body, dict) or set(body) != {'revision', 'overrides'}:
                raise ValueError('Provide revision and overrides.')
            from data_formulator.configuration import validate_overrides
            validate_overrides(body['overrides'])
            current = snapshot()
            if type(body['revision']) is not int or body['revision'] != current['revision']:
                raise ConfigurationConflict('Configuration changed. Reload before saving.')
            from data_formulator.auth.vault import get_credential_vault
            body['overrides'] = inline_connection_settings(body['overrides'])
            proposed = body['overrides'].get('connections', {})
            existing = current['overrides'].get('connections', {})
            for section, entries in proposed.items():
                for identifier, entry in entries.items():
                    if existing.get(section, {}).get(identifier) == entry:
                        continue
                    vault = get_credential_vault()
                    staged = vault.retrieve('installation:configuration', entry['credential_ref']) if vault else None
                    if (not staged or staged.get('id') != identifier or staged.get('section') != section
                            or staged.get('owner') != get_identity_id() or staged.get('expires', 0) < time.time()
                            or staged.get('revision') != current['revision'] or 'definition' not in staged
                            or public_connection_definition(section, staged['definition']) != {
                                key: value for key, value in entry.items() if key != 'credential_ref'}):
                        raise ValueError('Connection test expired or configuration changed. Test again before saving.')
            if ('allowed_api_bases' in body['overrides'] and current['allowed_api_bases']['locked']
                    and body['overrides']['allowed_api_bases'] != current['allowed_api_bases']['value']):
                raise ValueError('Endpoint allowlist is controlled by the environment.')
            for section in ('models', 'connectors'):
                known = {item['id'] for item in current['catalogs'][section]}
                known.update(proposed.get(section, {}))
                if set(body['overrides'].get(section, {})) - known:
                    raise ValueError(f'Unknown {section}; provision resources externally first.')
            default = body['overrides'].get('default_model')
            available_models = {item['id'] for item in current['catalogs']['models'] if not item['id'].startswith('installation-')} | set(proposed.get('models', {}))
            if default and (default not in available_models
                            or not body['overrides'].get('models', {}).get(default, {}).get('enabled', True)):
                raise ValueError('Default model must be an enabled server model.')
            for name, value in body['overrides'].get('limits', {}).items():
                if current['limits'][name]['locked'] and value != current['limits'][name]['value']:
                    raise ValueError(f'{name} is controlled by the environment.')
            actor = get_identity_id()
            saved = save_configuration(body['overrides'], body['revision'])
            changed_sections = sorted(key for key in current['overrides'].keys() | saved['overrides'].keys()
                                      if current['overrides'].get(key) != saved['overrides'].get(key))
            logger.info('Application configuration saved: actor=%s revision=%s changed_sections=%s',
                        actor, saved['revision'], ','.join(changed_sections))
        return json_ok(snapshot())
    except ConfigurationConflict as exc:
        return {'status': 'error', 'error': {'code': 'INVALID_REQUEST', 'message': str(exc), 'retry': False}}, 409
    except (ValueError, OSError) as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc


@configuration_bp.route('/test-connection', methods=['POST'])
def test_connection():
    if (not can_configure() or not request.is_json or request.headers.get('X-DF-Configuration') != '1'
            or request.headers.get('Sec-Fetch-Site') == 'cross-site'):
        raise AppError(ErrorCode.ACCESS_DENIED, 'Administrator access and a same-origin request are required.')
    if request.content_length and request.content_length > 100000:
        raise AppError(ErrorCode.INVALID_REQUEST, 'Connection definition is too large.')
    body = request.get_json()
    if isinstance(body, dict) and set(body) == {'section', 'id'}:
        identifier = body['id']
        if not isinstance(identifier, str) or identifier.startswith('installation-'):
            raise AppError(ErrorCode.INVALID_REQUEST, 'Select an environment-managed connection.')
        try:
            if body['section'] == 'models':
                from data_formulator.model_registry import model_registry
                from data_formulator.routes.agents import get_client
                definition = model_registry.get_config(identifier, configured=False)
                if definition is None:
                    raise ValueError('Unknown model.')
                get_client(definition, trusted=True).ping(timeout=20)
            elif body['section'] == 'connectors':
                from data_formulator.data_connector import DATA_CONNECTORS, _ADMIN_CONNECTOR_IDS
                if identifier not in _ADMIN_CONNECTOR_IDS or identifier not in DATA_CONNECTORS:
                    raise ValueError('Unknown configured source.')
                source = DATA_CONNECTORS[identifier]
                loader = source._loader_class(dict(source._default_params))
                try:
                    if not loader.test_connection():
                        raise ValueError('Connection test failed.')
                finally:
                    close = getattr(loader, 'close', None)
                    if callable(close):
                        close()
            else:
                raise ValueError('Unknown connection section.')
            return json_ok({'id': identifier})
        except Exception:
            raise AppError(ErrorCode.INVALID_REQUEST, 'Connection test failed. Check the server connection configuration.', detail=None) from None
    if not is_local_mode() and not os.environ.get('CREDENTIAL_VAULT_KEY', '').strip():
        raise AppError(ErrorCode.INVALID_REQUEST, 'Set CREDENTIAL_VAULT_KEY before saving shared connections on a remote server.')
    from data_formulator.auth.vault import get_credential_vault
    vault = get_credential_vault()
    if vault is None:
        raise AppError(ErrorCode.INVALID_REQUEST, 'Protected connection storage is unavailable.')
    body = request.get_json()
    if (not isinstance(body, dict) or set(body) - {'section', 'definition', 'id', 'reference'}
            or not {'section', 'definition'} <= set(body) or not isinstance(body['definition'], dict)):
        raise AppError(ErrorCode.INVALID_REQUEST, 'Provide a connection definition.')
    section, definition = body['section'], dict(body['definition'])
    revision = read_configuration()['revision']
    identifier = 'installation-' + uuid.uuid4().hex
    try:
        previous_definition = None
        if 'id' in body:
            if section not in ('connectors', 'models') or not isinstance(body['id'], str) or not isinstance(body.get('reference'), str):
                raise ValueError('Invalid connector edit.')
            previous = vault.retrieve('installation:configuration', body['reference'])
            published = read_configuration()['overrides'].get('connections', {}).get(section, {}).get(body['id'])
            published_reference = published.get('credential_ref') if isinstance(published, dict) else published
            if (not previous or previous.get('id') != body['id'] or previous.get('section') != section
                    or (published_reference != body['reference'] and (previous.get('owner') != get_identity_id()
                        or previous.get('revision') != revision or previous.get('expires', 0) < time.time()))):
                raise ValueError('Connection edit expired or unavailable.')
            identifier = body['id']
            previous_definition = (previous['definition'] if 'definition' in previous
                                   else connection_definitions(section)[identifier])
            if section == 'connectors' and definition.get('type') != previous_definition['type']:
                raise ValueError('Connector type cannot change during editing.')
        if section == 'models':
            allowed = {'endpoint', 'model', 'api_key', 'api_base', 'api_version', 'auth_mode', 'managed_identity_client_id'}
            if set(definition) - allowed or any(not isinstance(value, str) for value in definition.values()):
                raise ValueError('Unsupported model connection fields.')
            if previous_definition:
                if definition.get('endpoint') != previous_definition['endpoint']:
                    raise ValueError('Model provider cannot change during editing.')
                if not definition.get('api_key') and definition.get('auth_mode') not in ('azure_identity', 'managed_identity'):
                    definition['api_key'] = previous_definition.get('api_key', '')
            if definition.get('endpoint') not in ('openai', 'azure', 'anthropic', 'gemini', 'ollama', 'orcarouter', 'cheaperinference') or not definition.get('model', '').strip():
                raise ValueError('Select an API provider and model.')
            if definition.get('auth_mode') not in (None, 'key', 'azure_identity', 'managed_identity'):
                raise ValueError('Interactive model authentication is not supported here.')
            if definition.get('auth_mode') in ('azure_identity', 'managed_identity') and (definition.get('endpoint') != 'azure' or definition.get('api_key')):
                raise ValueError('Entra authentication requires an Azure endpoint without an API key.')
            if definition.get('endpoint') == 'azure' and not definition.get('api_key'):
                if definition.get('auth_mode') not in ('azure_identity', 'managed_identity'):
                    raise ValueError('Select an API key or Entra authentication for Azure.')
            from data_formulator.security.url_allowlist import validate_api_base
            validate_api_base(definition.get('api_base'))
            from data_formulator.routes.agents import get_client
            client = get_client(definition, trusted=True)
            client.ping(timeout=20)
            public = {key: definition[key] for key in ('endpoint', 'model')}
            public['definition'] = public_model_definition(definition)
        elif section == 'connectors':
            from data_formulator.data_loader import DATA_LOADERS
            if set(definition) != {'type', 'display_name', 'params'} or not isinstance(definition['params'], dict):
                raise ValueError('Provide connector type, name, and parameters.')
            if not isinstance(definition['display_name'], str) or not 1 <= len(definition['display_name'].strip()) <= 200:
                raise ValueError('Provide a connector name.')
            loader_class = DATA_LOADERS.get(definition['type'])
            if loader_class is None or definition['type'] == 'sample_datasets':
                raise ValueError('Unsupported connector type.')
            if definition['type'] == 'local_folder' and not is_local_mode():
                raise ValueError('Local folders are only available in local mode.')
            if loader_class.auth_mode() not in ('credentials', 'connection'):
                raise ValueError('This connector requires per-user authentication; use the personal connection form.')
            params = definition['params']
            if previous_definition:
                secret_names = {param['name'] for param in loader_class.list_params()
                                if param.get('sensitive') or param.get('type') == 'password'}
                params = {key: value for key, value in params.items() if key not in secret_names or value}
                params = {**previous_definition['params'], **params}
                definition['params'] = params
            declared = {param['name'] for param in loader_class.list_params()}
            if set(params) - declared:
                raise ValueError('Unsupported connector parameters.')
            if definition['type'] == 'kusto' and not all(params.get(field) for field in ('client_id', 'client_secret', 'tenant_id')):
                raise ValueError('Shared Kusto connections require service-principal credentials.')
            loader_class.validate_params(params)
            loader = loader_class(params)
            try:
                if not loader.test_connection():
                    raise ValueError('Connection test failed.')
            finally:
                close = getattr(loader, 'close', None)
                if callable(close):
                    close()
            public = {key: definition[key] for key in ('type', 'display_name')}
            public['params'] = public_connector_params(definition)
        else:
            raise ValueError('Unknown connection section.')
        reference = uuid.uuid4().hex
        vault.store('installation:configuration', reference, {'section': section, 'id': identifier,
                    'definition': definition, 'owner': get_identity_id(), 'revision': revision, 'expires': time.time() + 1800})
        return json_ok({'id': identifier, 'reference': reference, **public, 'source': 'Installation'})
    except Exception:
        raise AppError(ErrorCode.INVALID_REQUEST, 'Connection test failed. Check the endpoint, credentials, and server access.',
                       detail=None) from None
