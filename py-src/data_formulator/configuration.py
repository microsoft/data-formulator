from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path

from filelock import FileLock
from flask import current_app, has_app_context


LIMITS = {
    'max_display_rows': ('MAX_DISPLAY_ROWS', 10000, 1, 1000000),
    'scratch_max_bytes': ('SCRATCH_MAX_SIZE_MB', 1024 * 1024 * 1024, 1048576, 1024 ** 4),
    'scratch_max_file_bytes': ('SCRATCH_MAX_FILE_SIZE_MB', 20 * 1024 * 1024, 1048576, 1024 ** 3),
}


def configuration_path() -> Path:
    args = current_app.config.get('CLI_ARGS', {}) if has_app_context() else {}
    return Path(args.get('data_dir') or os.environ.get('DATA_FORMULATOR_HOME') or Path.home() / '.data_formulator') / 'configuration.json'


class ConfigurationConflict(ValueError):
    pass


def read_configuration() -> dict:
    path = configuration_path()
    if not path.exists():
        return {'version': 1, 'revision': 0, 'overrides': {}}
    if path.is_symlink():
        raise ValueError('Configuration cannot be a symlink.')
    document = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(document, dict) or document.get('version') != 1
            or type(document.get('revision')) is not int or document['revision'] < 0):
        raise ValueError('Unsupported application configuration.')
    validate_overrides(document.get('overrides'))
    return document


def is_managed_mode() -> bool:
    args = current_app.config.get('CLI_ARGS', {}) if has_app_context() else {}
    return bool(args.get('managed') or args.get('disable_database') or any(
        os.environ.get(name, 'false').lower() == 'true' for name in ('DF_MANAGED', 'DISABLE_DATABASE')))


def user_resource_policy(name: str) -> bool:
    document = read_configuration()
    return document['overrides'].get(name, is_managed_mode() and document['revision'] == 0)


def user_connectors_locked() -> bool:
    args = current_app.config.get('CLI_ARGS', {}) if has_app_context() else {}
    return bool(args.get('disable_data_connectors') or args.get('disable_database') or any(
        os.environ.get(name, 'false').lower() == 'true' for name in ('DISABLE_DATA_CONNECTORS', 'DISABLE_DATABASE')))


def user_connectors_disabled() -> bool:
    return user_connectors_locked() or user_resource_policy('disable_user_connectors')


def user_models_locked() -> bool:
    args = current_app.config.get('CLI_ARGS', {}) if has_app_context() else {}
    return bool(args.get('disable_custom_models') or args.get('disable_database') or any(
        os.environ.get(name, 'false').lower() == 'true' for name in ('DISABLE_CUSTOM_MODELS', 'DISABLE_DATABASE')))


def user_models_disabled() -> bool:
    return user_models_locked() or user_resource_policy('disable_user_models')


def resource_enabled(section: str, identifier: str) -> bool:
    return read_configuration()['overrides'].get(section, {}).get(identifier, {}).get('enabled', True)


def validate_overrides(overrides: dict) -> None:
    if not isinstance(overrides, dict) or set(overrides) - {'models', 'connectors', 'workflows', 'default_model', 'limits', 'allowed_api_bases', 'connections', 'disable_user_connectors', 'disable_user_models', 'app_name', 'app_tagline'}:
        raise ValueError('Unknown configuration fields.')
    for name, maximum in (('app_name', 80), ('app_tagline', 300)):
        if name in overrides and (not isinstance(overrides[name], str) or len(overrides[name]) > maximum):
            raise ValueError(f'{name} must be text of at most {maximum} characters.')
    if 'disable_user_connectors' in overrides and type(overrides['disable_user_connectors']) is not bool:
        raise ValueError('Disable user connectors must be a boolean.')
    if 'disable_user_models' in overrides and type(overrides['disable_user_models']) is not bool:
        raise ValueError('Disable user models must be a boolean.')
    connections = overrides.get('connections', {})
    if not isinstance(connections, dict) or set(connections) - {'models', 'connectors'}:
        raise ValueError('Invalid connection collections.')
    for section, entries in connections.items():
        if not isinstance(entries, dict) or len(entries) > 100:
            raise ValueError('Invalid connections.')
        for identifier, reference in entries.items():
            import re
            credential_ref = reference.get('credential_ref') if isinstance(reference, dict) else reference
            if (not re.fullmatch(r'installation-[a-f0-9]{32}', identifier)
                    or not isinstance(credential_ref, str) or not re.fullmatch(r'[a-f0-9]{32}', credential_ref)):
                raise ValueError('Invalid installation connection reference.')
            if isinstance(reference, dict):
                definition = {key: value for key, value in reference.items() if key != 'credential_ref'}
                if public_connection_definition(section, definition) != definition:
                    raise ValueError('Connection settings cannot contain credentials or unknown fields.')
    if 'allowed_api_bases' in overrides:
        patterns = overrides['allowed_api_bases']
        if (not isinstance(patterns, list) or len(patterns) > 100
                or any(not isinstance(pattern, str) or not pattern.strip() or len(pattern) > 1000 for pattern in patterns)):
            raise ValueError('Endpoint allowlist must contain URL patterns.')
    if len(json.dumps(overrides)) > 1000000:
        raise ValueError('Configuration exceeds 1 MB.')
    if 'default_model' in overrides and (not isinstance(overrides['default_model'], str) or len(overrides['default_model']) > 256):
        raise ValueError('Invalid default model.')
    for section in ('models', 'connectors', 'workflows'):
        entries = overrides.get(section, {})
        if not isinstance(entries, dict) or len(entries) > 500:
            raise ValueError(f'Invalid {section}.')
        for identifier, entry in entries.items():
            if not isinstance(identifier, str) or not identifier or len(identifier) > 256:
                raise ValueError('Invalid resource ID.')
            allowed = {'enabled', 'display_name', 'description'} if section == 'connectors' else {'enabled', 'display_name'}
            if section == 'workflows':
                allowed = {'enabled', 'content', 'file'}
            if not isinstance(entry, dict) or set(entry) - allowed:
                raise ValueError(f'Unknown {section} fields; credentials are not accepted.')
            if 'enabled' in entry and type(entry['enabled']) is not bool:
                raise ValueError('Enabled must be a boolean.')
            for field in ('display_name', 'description'):
                if field in entry and (not isinstance(entry[field], str) or len(entry[field]) > 1000):
                    raise ValueError(f'Invalid {field}.')
            if section == 'workflows':
                from data_formulator.workflows.instances import WorkflowStore, parse_workflow
                if not identifier.startswith(('demo/', 'server/')):
                    raise ValueError('Use a demo/ or server/ workflow ID.')
                WorkflowStore.validate_name(identifier.split('/', 1)[1])
                if 'file' in entry:
                    workflow_file_path(entry['file'])
                if 'content' in entry:
                    if not isinstance(entry['content'], str):
                        raise ValueError('Workflow content must be text.')
                    parse_workflow(entry['content'])
    limits = overrides.get('limits', {})
    if not isinstance(limits, dict) or set(limits) - LIMITS.keys():
        raise ValueError('Unknown limits.')
    for name, value in limits.items():
        _, _, minimum, maximum = LIMITS[name]
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError(f'{name} must be between {minimum} and {maximum}.')


def workflow_file_path(reference: str) -> Path:
    from data_formulator.workflows import instances
    from data_formulator.security.path_safety import ConfinedDir
    if not isinstance(reference, str):
        raise ValueError('Workflow file reference must be text.')
    if reference.startswith('builtin:'):
        filename = reference.removeprefix('builtin:')
        root = Path(instances.__file__).parent
    elif reference.startswith('workflows/'):
        filename = reference.removeprefix('workflows/')
        root = configuration_path().parent / 'workflows'
    else:
        raise ValueError('Use a workflows/ or builtin: file reference.')
    instances.WorkflowStore.validate_name(filename)
    if root.is_symlink() or (root / filename).is_symlink():
        raise ValueError('Workflow files cannot be symlinks.')
    return ConfinedDir(root, mkdir=False).resolve(filename)


def workflow_content(identifier: str, options: dict) -> str:
    from data_formulator.workflows.instances import parse_workflow
    if 'content' in options:
        content = options['content']
    else:
        reference = options.get('file')
        if reference is None and identifier.startswith('demo/'):
            reference = 'builtin:' + identifier.split('/', 1)[1]
        if reference is None:
            raise ValueError('Unknown server workflow.')
        path = workflow_file_path(reference)
        with path.open(encoding='utf-8') as stream:
            content = stream.read(48001)
    parse_workflow(content)
    return content


def save_configuration(overrides: dict, revision: int) -> dict:
    validate_overrides(overrides)
    for name, locked in (('disable_user_connectors', user_connectors_locked()),
                         ('disable_user_models', user_models_locked())):
        if locked and overrides.get(name) is False:
            raise ValueError(f'{name} is controlled by the deployment and cannot be disabled.')
    path = configuration_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(str(path) + '.lock', timeout=10):
        current = read_configuration()
        if type(revision) is not int or revision != current['revision']:
            raise ConfigurationConflict('Configuration changed. Reload before saving.')
        if is_managed_mode() and current['revision'] == 0:
            overrides = {'disable_user_connectors': True, 'disable_user_models': True, **overrides}
        if 'connections' in overrides:
            from data_formulator.auth.vault import get_credential_vault
            overrides = inline_connection_settings(overrides)
            vault = get_credential_vault()
            for section, entries in overrides['connections'].items():
                for identifier, entry in entries.items():
                    stored = vault.retrieve('installation:configuration', entry['credential_ref'])
                    if 'definition' in stored:
                        definition = stored['definition']
                        reference = uuid.uuid4().hex
                        vault.store('installation:configuration', reference,
                                    {'section': section, 'id': identifier, 'secrets': connection_secrets(section, definition)})
                        entry['credential_ref'] = reference
        if 'workflows' in overrides:
            workflows = {identifier: dict(options) for identifier, options in overrides['workflows'].items()}
            contents = {identifier: workflow_content(identifier, options) for identifier, options in workflows.items()}
            for identifier, options in workflows.items():
                if identifier.startswith('demo/') and contents[identifier] == workflow_content(identifier, {}):
                    options.pop('content', None)
                    options['file'] = 'builtin:' + identifier.split('/', 1)[1]
                elif 'content' in options:
                    filename = f"{Path(identifier).stem[:80]}-{uuid.uuid4().hex}.yaml"
                    reference = 'workflows/' + filename
                    target = workflow_file_path(reference)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('x', encoding='utf-8') as stream:
                        stream.write(options.pop('content'))
                        stream.flush()
                        os.fsync(stream.fileno())
                    options['file'] = reference
            overrides = {**overrides, 'workflows': workflows}
        document = {'version': 1, 'revision': revision + 1, 'overrides': overrides}
        descriptor, temporary = tempfile.mkstemp(prefix='.configuration-', dir=path.parent)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
                json.dump(document, stream, indent=2, ensure_ascii=False, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return document


def resource_options(section: str, identifier: str) -> dict:
    return read_configuration()['overrides'].get(section, {}).get(identifier, {})


def public_connection_definition(section: str, definition: dict) -> dict:
    if section == 'models':
        allowed = {'endpoint', 'model', 'api_base', 'api_version', 'auth_mode', 'managed_identity_client_id'}
        if (not isinstance(definition.get('endpoint'), str) or not isinstance(definition.get('model'), str)
                or not definition['endpoint'].strip() or not definition['model'].strip()
                or any(not isinstance(value, str) for value in definition.values())):
            raise ValueError('Invalid model connection settings.')
        return {key: value for key, value in definition.items() if key in allowed}
    from data_formulator.data_loader import DATA_LOADERS
    loader = DATA_LOADERS.get(definition.get('type')) if isinstance(definition.get('type'), str) else None
    if (loader is None or not isinstance(definition.get('display_name'), str)
            or not isinstance(definition.get('params'), dict)):
        raise ValueError('Invalid connector settings.')
    public_names = {param['name'] for param in loader.list_params()
                    if not param.get('sensitive') and param.get('type') != 'password'}
    return {'type': definition['type'], 'display_name': definition['display_name'],
            'params': {key: value for key, value in definition['params'].items() if key in public_names}}


def connection_secrets(section: str, definition: dict) -> dict:
    if section == 'models':
        return {'api_key': definition['api_key']} if definition.get('api_key') else {}
    public = public_connection_definition(section, definition)
    return {key: value for key, value in definition['params'].items() if key not in public['params']}


def inline_connection_settings(overrides: dict) -> dict:
    connections = {}
    for section, entries in overrides.get('connections', {}).items():
        definitions = connection_definitions(section, overrides)
        connections[section] = {identifier: {**public_connection_definition(section, definitions[identifier]),
            'credential_ref': entry if isinstance(entry, str) else entry['credential_ref']}
            for identifier, entry in entries.items()}
    return {**overrides, 'connections': connections} if 'connections' in overrides else overrides


def connection_definitions(section: str, overrides: dict | None = None) -> dict:
    from data_formulator.auth.vault import get_credential_vault
    references = (overrides if overrides is not None else read_configuration()['overrides']).get('connections', {}).get(section, {})
    if not references:
        return {}
    vault = get_credential_vault()
    if vault is None:
        raise ValueError('Protected connection storage is unavailable.')
    definitions = {}
    for identifier, entry in references.items():
        reference = entry if isinstance(entry, str) else entry['credential_ref']
        stored = vault.retrieve('installation:configuration', reference)
        if not stored or stored.get('section') != section or stored.get('id') != identifier:
            raise ValueError('Saved connection is unavailable; test the connection again.')
        if isinstance(entry, str):
            if 'definition' not in stored:
                raise ValueError('Connection settings are missing; test the connection again.')
            definitions[identifier] = stored['definition']
        else:
            definition = {key: value for key, value in entry.items() if key != 'credential_ref'}
            if 'definition' in stored:
                secrets = connection_secrets(section, stored['definition'])
            else:
                secrets = stored['secrets']
            definitions[identifier] = ({**definition, 'params': {**definition['params'], **secrets}}
                                       if section == 'connectors' else {**definition, **secrets})
    return definitions


def effective_limit(name: str, configured: bool = True) -> int:
    env, fallback, _, _ = LIMITS[name]
    args = current_app.config.get('CLI_ARGS', {}) if has_app_context() else {}
    baseline = args.get(name, fallback)
    if env in os.environ:
        return baseline if name in args else int(os.environ[env]) * (1048576 if env.endswith('_MB') else 1)
    return read_configuration()['overrides'].get('limits', {}).get(name, baseline) if configured else baseline