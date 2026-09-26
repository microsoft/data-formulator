import json

import pytest

from data_formulator.configuration import read_configuration, save_configuration, effective_limit

pytestmark = [pytest.mark.backend]


@pytest.fixture(autouse=True)
def configuration_home(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_FORMULATOR_HOME', str(tmp_path))
    monkeypatch.delenv('DF_MANAGED', raising=False)
    monkeypatch.delenv('DISABLE_DATABASE', raising=False)


@pytest.mark.parametrize('principal_id,login_name,allowlist,managed,authenticated,allowed', [
    ('object-id', 'alice@example.com', 'alice@example.com', True, True, True),
    ('object-id', ' Alice@Example.COM ', ' bob@example.com, ALICE@example.com ', True, True, True),
    ('object-id', 'alice@example.com', 'bob@example.com', True, True, False),
    ('object-id', 'alice@example.com', '', True, True, False),
    ('object-id', '', 'alice@example.com', True, True, False),
    ('object-id', 'alice', 'alice', True, True, False),
    ('object-id', 'Alice Example', 'Alice Example', True, True, False),
    ('object-id', 'alice@example.com', '*@example.com', True, True, False),
    ('object-id', 'alice@example.com', 'alice@example.com', False, True, False),
    ('', 'alice@example.com', 'alice@example.com', True, True, False),
    ('object-id', 'alice@example.com', 'alice@example.com', True, False, False),
])
def test_admin_email_allowlist(monkeypatch, principal_id, login_name, allowlist, managed, authenticated, allowed):
    from flask import Flask
    from data_formulator.auth import identity
    from data_formulator.auth.providers.azure_easyauth import AzureEasyAuthProvider
    from data_formulator.routes import configurations

    monkeypatch.setenv('DF_MANAGED', str(managed).lower())
    monkeypatch.setenv('DF_ADMIN_EMAILS', allowlist)
    monkeypatch.delenv('DF_ADMIN_IDENTITIES', raising=False)
    monkeypatch.setattr(identity, '_provider', AzureEasyAuthProvider() if authenticated else None)
    monkeypatch.setattr(identity, '_localhost_identity', None)
    monkeypatch.setattr(identity, '_allow_anonymous', True)
    app = Flask(__name__)
    with app.test_request_context(headers={
        'X-MS-CLIENT-PRINCIPAL-ID': principal_id,
        'X-MS-CLIENT-PRINCIPAL-NAME': login_name,
        'X-Identity-Id': 'user:alice@example.com',
    }):
        assert configurations.can_configure() is allowed
        expected_identity = f'user:{principal_id}' if authenticated and principal_id else 'browser:alice@example.com'
        assert identity.get_identity_id() == expected_identity


def test_admin_email_does_not_use_display_name_or_unverified_email(monkeypatch):
    from flask import Flask, g
    from data_formulator.auth.providers.base import AuthResult
    from data_formulator.routes import configurations

    monkeypatch.setenv('DF_MANAGED', 'true')
    monkeypatch.setenv('DF_ADMIN_EMAILS', 'alice@example.com')
    monkeypatch.delenv('DF_ADMIN_IDENTITIES', raising=False)
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:object-id')
    with Flask(__name__).test_request_context():
        g.df_auth_result = AuthResult(user_id='object-id', display_name='alice@example.com', email='alice@example.com')
        assert not configurations.can_configure()


def test_configuration_save_reload_and_conflict():
    assert read_configuration()['overrides'] == {}
    saved = save_configuration({'models': {'server-model': {'enabled': False}}}, 0)
    assert read_configuration() == saved
    with pytest.raises(ValueError, match='Reload'):
        save_configuration({}, 0)
    assert read_configuration() == saved
    assert save_configuration({}, 1)['overrides'] == {}


@pytest.mark.parametrize('overrides', [
    {'app_name': 42}, {'app_tagline': None}, {'app_name': 'x' * 81}, {'app_tagline': 'x' * 301},
])
def test_invalid_app_branding_is_rejected(overrides):
    with pytest.raises(ValueError):
        save_configuration(overrides, 0)
    assert read_configuration()['revision'] == 0


@pytest.mark.parametrize('environment,flag,policy', [
    ('DISABLE_DATA_CONNECTORS', 'disable_data_connectors', 'disable_user_connectors'),
    ('DISABLE_CUSTOM_MODELS', 'disable_custom_models', 'disable_user_models'),
    ('DISABLE_DATABASE', 'disable_database', 'disable_user_connectors'),
    ('DISABLE_DATABASE', 'disable_database', 'disable_user_models'),
])
@pytest.mark.parametrize('from_flag', [False, True])
def test_deployment_policy_cannot_be_overridden(monkeypatch, environment, flag, policy, from_flag):
    from flask import Flask
    from data_formulator.configuration import user_connectors_disabled, user_connectors_locked, user_models_disabled, user_models_locked
    save_configuration({policy: False}, 0)
    app = Flask(__name__)
    if from_flag:
        app.config['CLI_ARGS'] = {flag: True}
    else:
        monkeypatch.setenv(environment, 'true')
    with app.app_context():
        locked, disabled = ((user_connectors_locked, user_connectors_disabled)
                            if policy == 'disable_user_connectors' else (user_models_locked, user_models_disabled))
        assert locked() and disabled()
        with pytest.raises(ValueError, match='controlled by the deployment'):
            save_configuration({policy: False}, 1)
        assert read_configuration()['revision'] == 1
        save_configuration({}, 1)
        assert locked() and disabled()


@pytest.mark.parametrize('from_flag', [False, True])
def test_configured_only_connectors_block_creation_and_personal_lookup(monkeypatch, from_flag):
    from flask import Flask
    from data_formulator import data_connector
    from data_formulator.errors import AppError, ErrorCode
    app = Flask(__name__)
    app.config['CLI_ARGS'] = {'disable_data_connectors': from_flag}
    if not from_flag:
        save_configuration({'disable_user_connectors': True}, 0)
    admin = object()
    personal = object()
    monkeypatch.setattr(data_connector, 'DATA_CONNECTORS', {'admin': admin, 'personal': personal})
    monkeypatch.setattr(data_connector, '_ADMIN_CONNECTOR_IDS', {'admin'})
    monkeypatch.setattr(data_connector, '_sync_installation_connectors', lambda: None)
    monkeypatch.setattr(data_connector.DataConnector, '_get_identity', staticmethod(lambda: 'user:test'))
    with app.test_request_context(json={'loader_type': 'mysql'}):
        with pytest.raises(AppError) as caught:
            data_connector.create_connector()
        assert caught.value.code == ErrorCode.ACCESS_DENIED
        assert data_connector._resolve_connector_with_key({'connector_id': 'admin'}) == ('admin', admin)
        with pytest.raises(AppError) as caught:
            data_connector._resolve_connector_with_key({'connector_id': 'personal'})
        assert caught.value.code == ErrorCode.ACCESS_DENIED
        assert data_connector._visible_connector_items('user:test') == [('admin', admin, True)]


@pytest.mark.parametrize('overrides', [
    {'api_key': 'secret'}, {'models': {'model': {'api_key': 'secret'}}},
    {'limits': {'max_display_rows': -1}}, {'limits': {'max_display_rows': True}},
    {'limits': {'external_table_max_rows': -1}}, {'limits': {'external_table_max_rows': 1.5}},
    {'limits': {'external_table_max_bytes': True}}, {'limits': {'external_table_max_bytes': 1024 ** 4 + 1}},
    {'models': {'model': {'enabled': 'false'}}}, {'disable_user_connectors': 'false'}, {'disable_user_models': 'false'},
    {'workflows': {'server/../../escape.yaml': {'content': 'invalid'}}},
])
def test_invalid_configuration_is_not_saved(overrides):
    with pytest.raises(ValueError):
        save_configuration(overrides, 0)
    assert read_configuration()['revision'] == 0


@pytest.mark.parametrize('name,environment,default,multiplier', [
    ('max_display_rows', 'MAX_DISPLAY_ROWS', 10000, 1),
    ('external_table_max_rows', 'EXTERNAL_TABLE_MAX_ROWS', 1000000, 1),
    ('external_table_max_bytes', 'EXTERNAL_TABLE_MAX_SIZE_MB', 512 * 1048576, 1048576),
])
def test_environment_limit_wins_and_reset_restores_default(monkeypatch, name, environment, default, multiplier):
    monkeypatch.delenv(environment, raising=False)
    save_configuration({'limits': {name: 200}}, 0)
    assert effective_limit(name) == 200
    monkeypatch.setenv(environment, '50')
    assert effective_limit(name) == 50 * multiplier
    monkeypatch.delenv(environment)
    save_configuration({}, 1)
    assert effective_limit(name) == default


@pytest.mark.parametrize('identifier', ['configured', 'installation-' + 'a' * 32])
def test_disabled_models_cannot_be_resolved_or_used(monkeypatch, identifier):
    from flask import Flask
    from unittest.mock import Mock
    from data_formulator import configuration
    from data_formulator.routes import agents
    from data_formulator.errors import AppError, ErrorCode

    model = {'id': identifier, 'endpoint': 'openai', 'model': 'test', 'api_key': 'server-key', 'api_base': '', 'api_version': ''}
    monkeypatch.setattr(agents.model_registry, '_models', {identifier: model})
    monkeypatch.setattr(configuration, 'connection_definitions', lambda section: {identifier: model})
    client = Mock()
    monkeypatch.setattr(agents, 'Client', client)
    with Flask(__name__).test_request_context():
        assert agents.model_registry.get_config(identifier) == model
        save_configuration({'models': {identifier: {'enabled': False}}}, 0)
        assert agents.model_registry.get_config(identifier) is None
        assert not agents.model_registry.is_global(identifier)
        assert agents.model_registry.list_public() == []
        assert agents.model_registry.get_config(identifier, configured=False) == model
        with pytest.raises(AppError) as caught:
            agents.get_client({'id': identifier, 'is_global': True})
        assert caught.value.code == ErrorCode.ACCESS_DENIED
        client.assert_not_called()
        save_configuration({'models': {identifier: {'enabled': True}}}, 1)
        agents.get_client({'id': identifier, 'is_global': True})
        client.assert_called_once()


@pytest.mark.parametrize('identifier', ['configured', 'installation-' + 'a' * 32])
def test_disabled_connectors_block_lookup_and_cached_loader(monkeypatch, tmp_path, identifier):
    from flask import Flask
    from unittest.mock import Mock
    from data_formulator import data_connector
    from data_formulator.datalake import workspace
    from data_formulator.errors import AppError, ErrorCode

    source = data_connector.DataConnector(Mock(), identifier)
    loader = Mock()
    source._loaders['user:test'] = loader
    monkeypatch.setattr(data_connector, 'DATA_CONNECTORS', {identifier: source})
    monkeypatch.setattr(data_connector, '_ADMIN_CONNECTOR_IDS', {identifier})
    monkeypatch.setattr(data_connector, '_sync_installation_connectors', lambda: None)
    monkeypatch.setattr(data_connector, 'load_connectors', lambda identity: None)
    monkeypatch.setattr(source, '_get_identity', lambda: 'user:test')
    monkeypatch.setattr(data_connector.DataConnector, '_get_identity', staticmethod(lambda: 'user:test'))
    monkeypatch.setattr(workspace, 'get_user_home', lambda identity: tmp_path)
    with Flask(__name__).test_request_context():
        assert source._require_loader() is loader
        save_configuration({'connectors': {identifier: {'enabled': False}}}, 0)
        assert data_connector._visible_connector_items('user:test') == []
        for operation in (lambda: data_connector._resolve_connector_with_key({'connector_id': identifier}),
                  lambda: data_connector.resolve_live_loader(identifier),
                  lambda: data_connector.resolve_catalog_refresh_target(identifier), source._require_loader):
            with pytest.raises(AppError) as caught:
                operation()
            assert caught.value.code == ErrorCode.ACCESS_DENIED
        save_configuration({'connectors': {identifier: {'enabled': True}}}, 1)
        assert data_connector._resolve_connector_with_key({'connector_id': identifier}) == (identifier, source)
        assert source._require_loader() is loader


def test_saved_user_model_policy_allows_configured_models_and_can_be_reset(monkeypatch):
    from flask import Flask
    from unittest.mock import Mock
    from data_formulator.routes import agents
    from data_formulator.errors import AppError, ErrorCode
    from data_formulator.configuration import user_models_disabled
    monkeypatch.delenv('DISABLE_CUSTOM_MODELS', raising=False)
    monkeypatch.delenv('DISABLE_DATABASE', raising=False)
    config = {'id': 'configured', 'endpoint': 'openai', 'model': 'test', 'api_key': 'server-key'}
    monkeypatch.setattr(agents.model_registry, 'get_config', lambda identifier: config if identifier == 'configured' else None)
    client = Mock()
    monkeypatch.setattr(agents, 'Client', client)
    app = Flask(__name__)
    with app.app_context():
        save_configuration({'disable_user_models': True}, 0)
        with pytest.raises(AppError) as caught:
            agents.get_client({'endpoint': 'openai', 'model': 'personal', 'api_key': 'user-key'})
        assert caught.value.code == ErrorCode.ACCESS_DENIED
        client.assert_not_called()
        agents.get_client({'id': 'configured', 'is_global': True, 'api_key': 'untrusted-key'})
        assert client.call_args.args[2] == 'server-key'
        save_configuration({'disable_user_models': False}, 1)
        assert not user_models_disabled()
        app.config['CLI_ARGS'] = {'disable_custom_models': True}
        assert user_models_disabled()


@pytest.mark.parametrize('from_flag', [False, True])
def test_configured_sources_remain_registered_and_targets_are_fixed(monkeypatch, from_flag):
    from flask import Flask
    from types import SimpleNamespace
    from unittest.mock import Mock
    from data_formulator import data_connector
    from data_formulator.data_loader import DATA_LOADERS
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config['CLI_ARGS'] = {'disable_data_connectors': from_flag}
    save_configuration({'disable_user_connectors': not from_flag}, 0)
    loader_class = Mock()
    loader_class.discover_param_options.return_value = ['configured-database']
    monkeypatch.setitem(DATA_LOADERS, 'policy_test', loader_class)
    monkeypatch.setattr(data_connector, 'DATA_CONNECTORS', {})
    monkeypatch.setattr(data_connector, '_ADMIN_CONNECTOR_IDS', set())
    monkeypatch.setattr(data_connector, '_sync_installation_connectors', lambda: None)
    monkeypatch.setattr(data_connector, '_load_admin_specs', lambda: [SimpleNamespace(
        loader_type='policy_test', source_id='admin', display_name='Warehouse', icon=None,
        default_params={'host': 'configured-host', 'password': 'configured-secret'})])
    monkeypatch.setattr(data_connector.DataConnector, '_get_identity', staticmethod(lambda: 'user:test'))
    monkeypatch.setattr(data_connector.DataConnector, '_inject_credentials', lambda self, params: None)
    data_connector.register_data_connectors(app)
    register_error_handlers(app)
    source = data_connector.DATA_CONNECTORS['admin']
    monkeypatch.setattr(source, '_vault_retrieve', lambda identity: {'host': 'previous-personal-host'})
    with app.test_request_context():
        source._connect({'host': 'untrusted-host'})
        loader_class.assert_called_with({'host': 'configured-host', 'password': 'configured-secret'})
        source._loaders.clear()
        assert source._try_auto_reconnect('user:test') is loader_class.return_value
        loader_class.assert_called_with({'host': 'configured-host', 'password': 'configured-secret'})
    client = app.test_client()
    assert client.post('/api/connectors', json={'loader_type': 'policy_test'}).status_code == 403
    payload = {'loader_type': 'policy_test', 'param_name': 'database', 'params': {'host': 'untrusted-host'}}
    assert client.post('/api/data-loaders/discover-options', json=payload).status_code == 403
    loader_class.discover_param_options.assert_not_called()
    response = client.post('/api/data-loaders/discover-options', json={**payload, 'connector_id': 'admin'})
    assert response.status_code == 200
    loader_class.discover_param_options.assert_called_once_with('database',
        {'host': 'configured-host', 'password': 'configured-secret'})


def test_enabling_configured_only_access_discards_existing_user_overrides(monkeypatch):
    from flask import Flask
    from unittest.mock import Mock
    from data_formulator import data_connector
    loader_class = Mock()
    source = data_connector.DataConnector(loader_class, 'admin', default_params={'host': 'configured-host'})
    monkeypatch.setattr(data_connector, '_ADMIN_CONNECTOR_IDS', {'admin'})
    monkeypatch.setattr(source, '_get_identity', lambda: 'user:test')
    monkeypatch.setattr(source, '_inject_credentials', lambda params: None)
    with Flask(__name__).test_request_context():
        source._connect({'host': 'personal-host'})
        assert source._get_loader() is loader_class.return_value
        save_configuration({'disable_user_connectors': True}, 0)
        assert source._get_loader() is None
        source._connect({'host': 'personal-host'})
        assert source._get_loader() is loader_class.return_value
        loader_class.assert_called_with({'host': 'configured-host'})


@pytest.mark.parametrize('identity,local,allowed', [
    ('browser:admin', False, False), ('user:other', False, False),
    ('user:admin', False, True), ('local:owner', True, True),
    ('local:owner', False, False),
])
def test_configuration_access_boundary(monkeypatch, identity, local, allowed):
    from flask import Flask
    from data_formulator.routes import configurations
    monkeypatch.setenv('DF_ADMIN_IDENTITIES', 'user:admin,browser:admin')
    monkeypatch.setenv('DF_MANAGED', 'true')
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: identity)
    monkeypatch.setattr(configurations, 'is_local_mode', lambda: local)
    with Flask(__name__).test_request_context():
        assert configurations.can_configure() is allowed


@pytest.mark.parametrize('identity,local', [('local:owner', True), ('user:admin', False)])
def test_administration_requires_managed_mode(monkeypatch, identity, local):
    from flask import Flask
    from data_formulator.routes import configurations
    from data_formulator.error_handler import register_error_handlers
    monkeypatch.setenv('DF_ADMIN_IDENTITIES', 'user:admin')
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: identity)
    monkeypatch.setattr(configurations, 'is_local_mode', lambda: local)
    app = Flask(__name__)
    app.register_blueprint(configurations.configuration_bp)
    register_error_handlers(app)
    client = app.test_client()
    assert client.get('/api/configurations').status_code == 403
    assert client.put('/api/configurations', json={'revision': 0, 'overrides': {}},
                      headers={'X-DF-Configuration': '1'}).status_code == 403
    assert client.post('/api/configurations/test-connection', json={},
                       headers={'X-DF-Configuration': '1'}).status_code == 403


def test_managed_defaults_are_editable_and_persist_on_first_save(monkeypatch):
    from data_formulator.configuration import is_managed_mode, user_connectors_disabled, user_models_disabled
    assert not is_managed_mode()
    assert not user_connectors_disabled()
    assert not user_models_disabled()
    monkeypatch.setenv('DF_MANAGED', 'true')
    assert is_managed_mode()
    assert user_connectors_disabled()
    assert user_models_disabled()
    saved = save_configuration({'limits': {'max_display_rows': 500}}, 0)
    assert saved['overrides']['disable_user_connectors'] is True
    assert saved['overrides']['disable_user_models'] is True
    save_configuration({'disable_user_connectors': False, 'disable_user_models': False}, 1)
    assert not user_connectors_disabled()
    assert not user_models_disabled()
    monkeypatch.setenv('DISABLE_DATABASE', 'true')
    assert user_connectors_disabled()
    assert user_models_disabled()


def test_mode_changes_preserve_existing_saved_policies(monkeypatch):
    from data_formulator.configuration import user_connectors_disabled, user_models_disabled
    save_configuration({'disable_user_models': True}, 0)
    monkeypatch.setenv('DF_MANAGED', 'true')
    assert user_models_disabled()
    assert not user_connectors_disabled()
    monkeypatch.delenv('DF_MANAGED')
    assert user_models_disabled()
    assert not user_connectors_disabled()


@pytest.mark.parametrize('environment,arguments,managed,legacy', [
    ({}, [], False, False), ({}, ['--managed'], True, False),
    ({'DF_MANAGED': 'true'}, [], True, False),
    ({'DISABLE_DATABASE': 'true'}, [], True, True), ({}, ['--disable-database'], True, True),
])
def test_managed_startup_flags_do_not_select_other_deployment_settings(monkeypatch, environment, arguments, managed, legacy):
    import importlib
    from flask import Flask
    from data_formulator.configuration import is_managed_mode
    for name in ('WORKSPACE_BACKEND', 'SANDBOX', 'DISABLE_CUSTOM_MODELS', 'DISABLE_DATA_CONNECTORS', 'DISABLE_DISPLAY_KEYS'):
        monkeypatch.delenv(name, raising=False)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr('sys.argv', ['data_formulator', *arguments])
    args = importlib.import_module('data_formulator.app').parse_args()
    app = Flask(__name__)
    app.config['CLI_ARGS'] = vars(args)
    with app.app_context():
        assert is_managed_mode() is managed
    assert args.disable_database is legacy
    assert args.workspace_backend == 'local'
    assert args.sandbox == 'local'
    assert not args.disable_custom_models
    assert not args.disable_data_connectors
    assert not args.disable_display_keys


@pytest.mark.parametrize('legacy', [False, True])
def test_managed_runtime_preserves_storage_except_for_legacy_preset(monkeypatch, legacy):
    import importlib
    from unittest.mock import Mock
    application = importlib.import_module('data_formulator.app')
    for name in ('WORKSPACE_BACKEND', 'SANDBOX', 'DISABLE_CUSTOM_MODELS', 'DISABLE_DATA_CONNECTORS', 'DISABLE_DISPLAY_KEYS'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr('sys.argv', ['data_formulator', '--dev', '--disable-database' if legacy else '--managed'])
    monkeypatch.setitem(application.app.config, 'CLI_ARGS', {})
    for name in ('configure_logging', 'configure_file_logging', '_register_blueprints'):
        monkeypatch.setattr(application, name, lambda: None)
    checks = Mock()
    runner = Mock()
    monkeypatch.setattr(application, '_safety_checks', checks)
    monkeypatch.setattr(application.app, 'run', runner)
    application.run_app()
    args = application.app.config['CLI_ARGS']
    assert args['managed'] is True
    assert args['workspace_backend'] == ('ephemeral' if legacy else 'local')
    assert args['sandbox'] == 'local'
    assert args['disable_data_connectors'] is legacy
    assert args['disable_custom_models'] is legacy
    assert args['disable_display_keys'] is legacy
    checks.assert_called_once()
    runner.assert_called_once()


@pytest.mark.parametrize('local,provider_name,emails,identities,host,azure_host,expected', [
    (False, 'azure_easyauth', '', '', '0.0.0.0', '', 'no usable administrator'),
    (False, 'oidc', 'admin@example.com', '', '0.0.0.0', '', 'requires active Azure EasyAuth'),
    (False, 'azure_easyauth', 'alias', '', '0.0.0.0', '', 'invalid sign-in addresses'),
    (True, None, '', '', '127.0.0.1', 'app.azurewebsites.net', 'local-owner administrator identity'),
    (True, None, '', '', '0.0.0.0', '', 'local-owner administrator identity'),
    (False, None, '', 'user:admin', '0.0.0.0', '', 'no usable administrator'),
    (True, None, '', '', '127.0.0.1', '', None),
    (False, 'azure_easyauth', 'admin@example.com', '', '0.0.0.0', '', None),
    (False, 'oidc', '', 'user:admin', '0.0.0.0', '', None),
])
def test_managed_startup_admin_warnings(monkeypatch, caplog, local, provider_name, emails, identities, host, azure_host, expected):
    import importlib
    from types import SimpleNamespace
    from data_formulator.auth import identity
    application = importlib.import_module('data_formulator.app')
    monkeypatch.setitem(application.app.config, 'CLI_ARGS', {'managed': True, 'host': host, 'sandbox': 'local'})
    monkeypatch.setattr(identity, 'is_local_mode', lambda: local)
    monkeypatch.setattr(identity, 'get_active_provider', lambda: SimpleNamespace(name=provider_name) if provider_name else None)
    monkeypatch.setenv('DF_ADMIN_EMAILS', emails)
    monkeypatch.setenv('DF_ADMIN_IDENTITIES', identities)
    monkeypatch.setenv('WEBSITE_HOSTNAME', azure_host)
    monkeypatch.delenv('WEBSITE_INSTANCE_ID', raising=False)
    caplog.clear()
    application._safety_checks()
    if expected:
        assert expected in caplog.text
    else:
        assert not caplog.records
    caplog.clear()
    application.app.config['CLI_ARGS']['managed'] = False
    application._safety_checks()
    assert not caplog.records


def test_managed_app_config_reports_mode_separately_from_admin_permission(monkeypatch):
    import importlib
    from data_formulator.routes import configurations
    from data_formulator import data_connector
    from data_formulator.auth import identity, vault
    application = importlib.import_module('data_formulator.app')
    monkeypatch.setitem(application.app.config, 'CLI_ARGS', {'managed': True, 'sandbox': 'local',
        'disable_display_keys': False, 'workspace_backend': 'local'})
    monkeypatch.setattr(identity, 'get_active_provider', lambda: None)
    monkeypatch.setattr(identity, 'get_identity_id', lambda: 'user:member')
    monkeypatch.setattr(vault, 'get_credential_vault', lambda: None)
    monkeypatch.setattr(data_connector, '_visible_connector_items', lambda identity: [])
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:member')
    monkeypatch.setattr(configurations, 'is_local_mode', lambda: False)
    monkeypatch.setenv('DF_ADMIN_IDENTITIES', 'user:admin')
    with application.app.test_request_context():
        config = application.app.make_response(application.get_app_config()).get_json()['data']
        assert config['APP_NAME'] == ''
        assert config['APP_TAGLINE'] == ''
        assert config['MANAGED_MODE'] is True
        assert config['CAN_CONFIGURE'] is False
        assert config['EXTERNAL_TABLE_MAX_ROWS'] == 1000000
        assert config['EXTERNAL_TABLE_MAX_BYTES'] == 512 * 1048576
        save_configuration({'app_name': '  Team Analytics  ', 'app_tagline': '  Explore our data.  ',
                    'limits': {'external_table_max_rows': 200, 'external_table_max_bytes': 64 * 1048576}}, 0)
        branded = application.app.make_response(application.get_app_config()).get_json()['data']
        assert branded['APP_NAME'] == 'Team Analytics'
        assert branded['APP_TAGLINE'] == 'Explore our data.'
        assert branded['EXTERNAL_TABLE_MAX_ROWS'] == 200
        assert branded['EXTERNAL_TABLE_MAX_BYTES'] == 64 * 1048576
        monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:admin')
        assert application.app.make_response(application.get_app_config()).get_json()['data']['CAN_CONFIGURE'] is True
        application.app.config['CLI_ARGS']['managed'] = False
        config = application.app.make_response(application.get_app_config()).get_json()['data']
        assert config['MANAGED_MODE'] is False
        assert config['CAN_CONFIGURE'] is False


def test_admin_branding_save_and_reset(config_client):
    headers = {'X-DF-Configuration': '1'}
    overrides = {'app_name': 'Team Analytics', 'app_tagline': 'Explore our data.'}
    response = config_client.put('/api/configurations', json={'revision': 0, 'overrides': overrides}, headers=headers)
    assert response.get_json()['status'] == 'success'
    assert read_configuration()['overrides'] == overrides
    assert config_client.get('/api/configurations').get_json()['data']['overrides'] == overrides
    response = config_client.put('/api/configurations', json={'revision': 1, 'overrides': {}}, headers=headers)
    assert response.get_json()['status'] == 'success'
    assert read_configuration()['overrides'] == {}


def test_model_catalog_overrides_do_not_change_credentials(monkeypatch):
    from data_formulator.model_registry import ModelRegistry
    monkeypatch.setenv('OPENAI_API_KEY', 'private-test-key')
    monkeypatch.setenv('OPENAI_MODELS', 'first,second')
    registry = ModelRegistry()
    save_configuration({'models': {'global-openai-first': {'enabled': False},
                                  'global-openai-second': {'display_name': 'Preferred'}},
                        'default_model': 'global-openai-second'}, 0)
    models = [model for model in registry.list_public() if model['endpoint'] == 'openai']
    assert [model['model'] for model in models] == ['second']
    assert models[0]['display_name'] == 'Preferred'
    assert 'private-test-key' not in str(models)
    assert registry.get_config('global-openai-first') is None
    assert registry.get_config('global-openai-first', configured=False)['api_key'] == 'private-test-key'


def test_published_workflow_lifecycle(tmp_path):
    from data_formulator.workflows.instances import WorkflowStore
    store = WorkflowStore(tmp_path / 'user')
    content = 'version: 1\nname: Team review\noverview: Review data\ndeliverables: [Report]\nsteps:\n  - id: review\n    instructions: Review the data\n'
    save_configuration({'workflows': {'server/team.yaml': {'content': content, 'enabled': True}}}, 0)
    assert store.read('server/team.yaml') == content
    assert any(item['path'] == 'server/team.yaml' for item in store.list_all())
    save_configuration({'workflows': {'server/team.yaml': {'content': content, 'enabled': False}}}, 1)
    assert not any(item['path'] == 'server/team.yaml' for item in store.list_all())
    with pytest.raises(ValueError, match='not published'):
        store.read('server/team.yaml')


def test_workflow_files_round_trip_and_reference_removal(tmp_path, config_client):
    from data_formulator.workflows.instances import WorkflowStore
    content = 'version: 1\nname: Team review\noverview: Review data\ndeliverables: [Report]\nsteps:\n  - id: review\n    instructions: Review the data\n'
    saved = save_configuration({'workflows': {'server/team.yaml': {'content': content, 'enabled': True}}}, 0)
    options = saved['overrides']['workflows']['server/team.yaml']
    assert 'content' not in options
    assert options['file'].startswith('workflows/')
    path = tmp_path / options['file']
    assert path.read_text() == content
    assert WorkflowStore(tmp_path / 'user').read('server/team.yaml') == content
    snapshot = config_client.get('/api/configurations').get_json()['data']
    assert next(item for item in snapshot['catalogs']['workflows'] if item['id'] == 'server/team.yaml')['content'] == content
    assert snapshot['overrides'] == saved['overrides']
    save_configuration({}, 1)
    assert path.read_text() == content
    assert not any(item['path'] == 'server/team.yaml' for item in WorkflowStore(tmp_path / 'user').list_all())


@pytest.fixture
def config_client(monkeypatch):
    from flask import Flask
    from data_formulator.routes import configurations
    from data_formulator.error_handler import register_error_handlers
    app = Flask(__name__)
    app.register_blueprint(configurations.configuration_bp)
    register_error_handlers(app)
    monkeypatch.setattr(configurations, 'can_configure', lambda: True)
    monkeypatch.setattr(configurations, 'is_local_mode', lambda: True)
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:admin')
    return app.test_client()


@pytest.mark.parametrize('environment,policy,section', [
    ('DISABLE_DATA_CONNECTORS', 'disable_user_connectors', 'user_connectors'),
    ('DISABLE_CUSTOM_MODELS', 'disable_user_models', 'user_models'),
])
def test_admin_api_cannot_unlock_deployment_policy(config_client, monkeypatch, environment, policy, section):
    save_configuration({policy: False}, 0)
    monkeypatch.setenv(environment, 'true')
    current = config_client.get('/api/configurations').get_json()['data']
    assert current[section] == {'disabled': True, 'locked': True}
    assert current['overrides'][policy] is True
    response = config_client.put('/api/configurations',
        json={'revision': current['revision'], 'overrides': {policy: False}},
        headers={'X-DF-Configuration': '1'})
    assert response.get_json()['status'] == 'error'
    assert 'controlled by the deployment' in response.get_json()['error']['message']
    assert read_configuration()['revision'] == current['revision']
    response = config_client.put('/api/configurations',
        json={'revision': current['revision'], 'overrides': current['overrides']},
        headers={'X-DF-Configuration': '1'})
    assert response.get_json()['status'] == 'success'


def test_workflow_builtin_references_and_customized_defaults(tmp_path):
    from pathlib import Path
    from data_formulator.workflows import instances
    path = next(Path(instances.__file__).parent.glob('*.yaml'))
    identifier = f'demo/{path.name}'
    content = path.read_text()
    saved = save_configuration({'workflows': {identifier: {'enabled': False}}}, 0)
    assert saved['overrides']['workflows'][identifier] == {'enabled': False, 'file': f'builtin:{path.name}'}
    assert not (tmp_path / 'workflows').exists()
    customized = content + '\n'
    saved = save_configuration({'workflows': {identifier: {'content': customized}}}, 1)
    assert saved['overrides']['workflows'][identifier]['file'].startswith('workflows/')
    assert instances.WorkflowStore(tmp_path / 'user').read(identifier) == customized
    assert path.read_text() == content
    save_configuration({}, 2)
    assert instances.WorkflowStore(tmp_path / 'user').read(identifier) == content


def test_workflow_legacy_content_migrates_only_on_save(tmp_path):
    from data_formulator.workflows.instances import WorkflowStore
    content = 'version: 1\nname: Legacy\noverview: Review data\ndeliverables: [Report]\nsteps:\n  - id: review\n    instructions: Review data\n'
    document = {'version': 1, 'revision': 4, 'overrides': {'workflows': {'server/legacy.yaml': {'content': content}}}}
    path = tmp_path / 'configuration.json'
    path.write_text(json.dumps(document))
    assert WorkflowStore(tmp_path / 'user').read('server/legacy.yaml') == content
    assert read_configuration() == document
    saved = save_configuration(document['overrides'], 4)
    assert 'file' in saved['overrides']['workflows']['server/legacy.yaml']
    assert 'content' in document['overrides']['workflows']['server/legacy.yaml']


@pytest.mark.parametrize('reference', ['../escape.yaml', '/tmp/escape.yaml', 'workflows/../escape.yaml',
                                        'workflows/nested/escape.yaml', 'builtin:../escape.yaml', 42])
def test_workflow_file_references_reject_unsafe_paths(reference):
    with pytest.raises(ValueError):
        save_configuration({'workflows': {'server/team.yaml': {'file': reference}}}, 0)
    assert read_configuration()['revision'] == 0


@pytest.mark.parametrize('directory_link', [False, True])
def test_workflow_file_references_reject_symlinks(tmp_path, directory_link):
    root = tmp_path / 'workflows'
    outside = tmp_path / 'outside'
    outside.mkdir()
    if directory_link:
        root.symlink_to(outside, target_is_directory=True)
    else:
        root.mkdir()
        (root / 'team.yaml').symlink_to(outside / 'team.yaml')
    with pytest.raises(ValueError, match='symlinks'):
        save_configuration({'workflows': {'server/team.yaml': {'file': 'workflows/team.yaml'}}}, 0)


def test_workflow_external_file_reference_and_missing_file(tmp_path):
    from data_formulator.workflows.instances import WorkflowStore
    root = tmp_path / 'workflows'
    root.mkdir()
    content = 'version: 1\nname: External\noverview: Review data\ndeliverables: [Report]\nsteps:\n  - id: review\n    instructions: Review data\n'
    (root / 'team.yaml').write_text(content)
    overrides = {'workflows': {'server/team.yaml': {'file': 'workflows/team.yaml'}}}
    assert save_configuration(overrides, 0)['overrides'] == overrides
    assert WorkflowStore(tmp_path / 'user').read('server/team.yaml') == content
    with pytest.raises(OSError):
        save_configuration({'workflows': {'server/missing.yaml': {'file': 'workflows/missing.yaml'}}}, 1)
    assert read_configuration()['revision'] == 1


def test_workflow_failed_save_and_conflict_preserve_previous_file(tmp_path, monkeypatch):
    from data_formulator import configuration
    from data_formulator.workflows.instances import WorkflowStore
    content = 'version: 1\nname: Original\noverview: Review data\ndeliverables: [Report]\nsteps:\n  - id: review\n    instructions: Review data\n'
    saved = save_configuration({'workflows': {'server/team.yaml': {'content': content}}}, 0)
    updated = {'workflows': {'server/team.yaml': {'content': content.replace('Original', 'Changed')}}}
    files = list((tmp_path / 'workflows').iterdir())
    with pytest.raises(ValueError, match='Reload'):
        save_configuration(updated, 0)
    assert list((tmp_path / 'workflows').iterdir()) == files
    def fail_replace(*args):
        raise OSError('Cannot replace configuration')
    monkeypatch.setattr(configuration.os, 'replace', fail_replace)
    with pytest.raises(OSError, match='Cannot replace'):
        save_configuration(updated, 1)
    assert read_configuration() == saved
    assert WorkflowStore(tmp_path / 'user').read('server/team.yaml') == content


def test_configuration_api_save_conflict_and_environment_lock(config_client, monkeypatch):
    headers = {'X-DF-Configuration': '1'}
    initial = config_client.get('/api/configurations').get_json()['data']
    assert initial['revision'] == 0
    assert 'default' in initial['limits']['max_display_rows']
    body = {'revision': 0, 'overrides': {'limits': {'max_display_rows': 200}}}
    assert config_client.put('/api/configurations', json=body).status_code == 403
    assert config_client.put('/api/configurations', json=body,
                             headers={**headers, 'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    saved = config_client.put('/api/configurations', json=body, headers=headers).get_json()['data']
    assert saved['revision'] == 1
    assert saved['limits']['max_display_rows']['value'] == 200
    assert config_client.put('/api/configurations', json=body, headers=headers).status_code == 409
    monkeypatch.setenv('MAX_DISPLAY_ROWS', '50')
    body['revision'] = 1
    assert config_client.put('/api/configurations', json=body, headers=headers).get_json()['status'] == 'error'
    assert read_configuration()['revision'] == 1


def test_configuration_save_audit_records_actor_without_values(config_client, caplog):
    import logging
    caplog.set_level(logging.INFO, logger='data_formulator.routes.configurations')
    body = {'revision': 0, 'overrides': {'allowed_api_bases': ['https://private-endpoint.example.com']}}
    response = config_client.put('/api/configurations', json=body, headers={'X-DF-Configuration': '1'})
    assert response.get_json()['status'] == 'success'
    assert 'actor=user:admin revision=1 changed_sections=allowed_api_bases' in caplog.text
    assert 'private-endpoint' not in caplog.text
    caplog.clear()
    assert config_client.put('/api/configurations', json=body, headers={'X-DF-Configuration': '1'}).status_code == 409
    assert 'Application configuration saved' not in caplog.text


def test_model_policy_snapshot_tracks_saved_and_deployment_values(config_client, monkeypatch):
    monkeypatch.delenv('DISABLE_CUSTOM_MODELS', raising=False)
    monkeypatch.delenv('DISABLE_DATABASE', raising=False)
    assert config_client.get('/api/configurations').get_json()['data']['user_models'] == {'disabled': False, 'locked': False}
    save_configuration({'disable_user_models': True}, 0)
    assert config_client.get('/api/configurations').get_json()['data']['user_models'] == {'disabled': True, 'locked': False}
    save_configuration({'disable_user_models': False}, 1)
    monkeypatch.setenv('DISABLE_CUSTOM_MODELS', 'true')
    assert config_client.get('/api/configurations').get_json()['data']['user_models'] == {'disabled': True, 'locked': True}


@pytest.mark.parametrize('method,path', [
    ('POST', ''), ('POST', '/connections/github_copilot/start'), ('POST', '/connections/github_copilot/poll'),
    ('POST', '/connections/chatgpt/start'), ('POST', '/connections/chatgpt/poll'),
    ('POST', '/connections/openrouter/start'), ('GET', '/connections/openrouter/callback'),
])
def test_saved_model_policy_blocks_personal_connection_creation(config_client, monkeypatch, method, path):
    from data_formulator.routes import model_endpoints
    from unittest.mock import Mock
    config_client.application.register_blueprint(model_endpoints.model_endpoints_bp)
    save_configuration({'disable_user_models': True}, 0)
    vault = Mock()
    monkeypatch.setattr(model_endpoints, '_connection_vault', vault)
    response = config_client.open('/api/model-endpoints' + path, method=method, json={})
    assert response.status_code == 403
    vault.assert_not_called()



def test_configuration_api_denies_reads_and_writes(config_client, monkeypatch):
    from data_formulator.routes import configurations
    monkeypatch.setattr(configurations, 'can_configure', lambda: False)
    assert config_client.get('/api/configurations').status_code == 403
    assert config_client.put('/api/configurations', json={'revision': 0, 'overrides': {}},
                             headers={'X-DF-Configuration': '1'}).status_code == 403
    assert read_configuration()['revision'] == 0


def test_staged_model_requires_save_and_never_returns_credentials(config_client, monkeypatch):
    from types import SimpleNamespace
    from data_formulator.auth import vault
    from data_formulator.auth.vault.local_vault import LocalCredentialVault
    from cryptography.fernet import Fernet
    from data_formulator.configuration import configuration_path
    from data_formulator.routes import configurations, agents
    from data_formulator.model_registry import model_registry
    protected = LocalCredentialVault(configuration_path().parent / 'test-credentials.db', Fernet.generate_key().decode())
    monkeypatch.setattr(vault, 'get_credential_vault', lambda: protected)
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:admin')
    monkeypatch.delenv('DF_ALLOWED_API_BASES', raising=False)
    monkeypatch.setattr(agents, 'get_client', lambda *args, **kwargs: SimpleNamespace(
        ping=lambda **kwargs: None))
    headers = {'X-DF-Configuration': '1'}
    tested = config_client.post('/api/configurations/test-connection', headers=headers, json={'section': 'models',
        'definition': {'endpoint': 'openai', 'model': 'test-model', 'api_key': 'private-key'}}).get_json()['data']
    assert 'private-key' not in str(tested)
    assert model_registry.get_config(tested['id']) is None
    staged_settings = {**tested['definition'], 'credential_ref': tested['reference']}
    for changes in ({'model': 'untested-model'}, {'api_base': 'https://untested.example'}, {'api_key': 'plaintext-key'}):
        rejected = config_client.put('/api/configurations', headers=headers, json={'revision': 0,
            'overrides': {'connections': {'models': {tested['id']: {**staged_settings, **changes}}}}}).get_json()
        assert rejected['status'] == 'error'
        assert read_configuration()['revision'] == 0
    body = {'revision': 0, 'overrides': {'connections': {'models': {tested['id']: staged_settings}}}}
    saved = config_client.put('/api/configurations', headers=headers, json=body).get_json()
    assert saved['status'] == 'success'
    assert 'private-key' not in str(saved)
    assert 'private-key' not in configuration_path().read_text()
    assert model_registry.get_config(tested['id'])['api_key'] == 'private-key'
    connection = saved['data']['overrides']['connections']['models'][tested['id']]
    assert connection['endpoint'] == 'openai'
    assert connection['model'] == 'test-model'
    assert protected.retrieve('installation:configuration', connection['credential_ref']) == {
        'id': tested['id'], 'section': 'models', 'secrets': {'api_key': 'private-key'}}
    for changes in ({'model': 'untested-model'}, {'api_base': 'https://untested.example'}):
        assert config_client.put('/api/configurations', headers=headers, json={'revision': 1,
            'overrides': {'connections': {'models': {tested['id']: {**connection, **changes}}}}}).get_json()['status'] == 'error'
    body['revision'] = 1
    body['overrides']['connections']['models'][tested['id']] = '0' * 32
    assert config_client.put('/api/configurations', headers=headers, json=body).get_json()['status'] == 'error'
    assert read_configuration()['revision'] == 1

    edited = config_client.post('/api/configurations/test-connection', headers=headers, json={
        'section': 'models', 'id': tested['id'], 'reference': connection['credential_ref'],
        'definition': {'endpoint': 'openai', 'model': 'updated-model', 'api_key': '', 'auth_mode': 'key'},
    }).get_json()['data']
    assert edited['id'] == tested['id']
    assert 'api_key' not in edited['definition']
    assert model_registry.get_config(tested['id'])['model'] == 'test-model'
    body['overrides']['connections']['models'][tested['id']] = edited['reference']
    assert config_client.put('/api/configurations', headers=headers, json=body).get_json()['status'] == 'success'
    assert model_registry.get_config(tested['id'])['api_key'] == 'private-key'
    assert model_registry.get_config(tested['id'])['model'] == 'updated-model'


def test_legacy_connection_is_expanded_and_migrated_without_changing_credentials(config_client, monkeypatch):
    from cryptography.fernet import Fernet
    from data_formulator.auth import vault
    from data_formulator.auth.vault.local_vault import LocalCredentialVault
    from data_formulator.configuration import configuration_path, connection_definitions
    identifier = 'installation-' + '1' * 32
    reference = '2' * 32
    definition = {'endpoint': 'openai', 'model': 'legacy-model', 'api_base': 'https://legacy.example/v1', 'api_key': 'legacy-secret'}
    protected = LocalCredentialVault(configuration_path().parent / 'test-credentials.db', Fernet.generate_key().decode())
    monkeypatch.setattr(vault, 'get_credential_vault', lambda: protected)
    protected.store('installation:configuration', reference, {'section': 'models', 'id': identifier, 'definition': definition})
    document = {'version': 1, 'revision': 3, 'overrides': {'connections': {'models': {identifier: reference}}}}
    configuration_path().write_text(json.dumps(document))
    response = config_client.get('/api/configurations').get_json()['data']
    connection = response['overrides']['connections']['models'][identifier]
    assert connection == {'endpoint': 'openai', 'model': 'legacy-model', 'api_base': 'https://legacy.example/v1', 'credential_ref': reference}
    assert read_configuration() == document
    assert 'legacy-secret' not in str(response)
    assert connection_definitions('models')[identifier] == definition
    saved = config_client.put('/api/configurations', headers={'X-DF-Configuration': '1'},
        json={'revision': 3, 'overrides': response['overrides']}).get_json()
    assert saved['status'] == 'success'
    persisted = read_configuration()['overrides']['connections']['models'][identifier]
    assert persisted['model'] == 'legacy-model'
    assert persisted['credential_ref'] != reference
    assert protected.retrieve('installation:configuration', persisted['credential_ref']) == {
        'section': 'models', 'id': identifier, 'secrets': {'api_key': 'legacy-secret'}}
    assert connection_definitions('models')[identifier] == definition
    assert 'legacy-secret' not in configuration_path().read_text()


@pytest.mark.parametrize('auth_mode', ['azure_identity', 'managed_identity'])
def test_azure_installation_credentials_and_switching_from_api_key(config_client, monkeypatch, auth_mode):
    from unittest.mock import Mock
    from cryptography.fernet import Fernet
    from azure import identity
    from data_formulator.auth import vault
    from data_formulator.auth.vault.local_vault import LocalCredentialVault
    from data_formulator.configuration import configuration_path, connection_definitions
    from data_formulator.routes import configurations
    from data_formulator.agents import client_utils
    protected = LocalCredentialVault(configuration_path().parent / 'test-credentials.db', Fernet.generate_key().decode())
    monkeypatch.setattr(vault, 'get_credential_vault', lambda: protected)
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:admin')
    monkeypatch.delenv('DF_ALLOWED_API_BASES', raising=False)
    monkeypatch.delenv('DATA_FORMULATOR_DESKTOP', raising=False)
    default_credential = Mock()
    managed_credential = Mock()
    token_provider = Mock()
    monkeypatch.setattr(client_utils, 'DefaultAzureCredential', default_credential)
    monkeypatch.setattr(identity, 'ManagedIdentityCredential', managed_credential)
    monkeypatch.setattr(client_utils, 'get_bearer_token_provider', token_provider)
    monkeypatch.setattr(client_utils.Client, 'ping', lambda self, **kwargs: None)
    headers = {'X-DF-Configuration': '1'}
    definition = {'endpoint': 'azure', 'model': 'deployment', 'api_base': 'https://example.openai.azure.com',
                  'api_key': 'previous-key', 'auth_mode': 'key'}
    tested = config_client.post('/api/configurations/test-connection', headers=headers, json={
        'section': 'models', 'definition': definition}).get_json()['data']
    definition.update(api_key='', auth_mode=auth_mode, managed_identity_client_id='identity-client' if auth_mode == 'managed_identity' else '')
    response = config_client.post('/api/configurations/test-connection', headers=headers, json={
        'section': 'models', 'id': tested['id'], 'reference': tested['reference'], 'definition': definition}).get_json()
    assert response['status'] == 'success'
    edited = response['data']
    assert edited['definition']['auth_mode'] == auth_mode
    if auth_mode == 'azure_identity':
        default_credential.assert_called_once_with()
        managed_credential.assert_not_called()
        credential = default_credential.return_value
    else:
        managed_credential.assert_called_once_with(client_id='identity-client')
        default_credential.assert_not_called()
        credential = managed_credential.return_value
    token_provider.assert_called_once_with(credential, 'https://cognitiveservices.azure.com/.default')
    saved = config_client.put('/api/configurations', headers=headers, json={'revision': 0,
        'overrides': {'connections': {'models': {edited['id']: edited['reference']}}}}).get_json()
    assert saved['status'] == 'success'
    stored = connection_definitions('models')[edited['id']]
    assert stored['auth_mode'] == auth_mode
    assert not stored.get('api_key')


def test_environment_model_test_uses_server_definition_without_vault(config_client, monkeypatch):
    from unittest.mock import Mock
    from data_formulator.routes import agents
    from data_formulator.model_registry import model_registry
    from data_formulator.auth import vault
    definition = {'endpoint': 'azure', 'model': 'server-model', 'api_key': 'server-key'}
    lookup = Mock(side_effect=lambda identifier, **kwargs: definition if identifier == 'environment-model' else None)
    monkeypatch.setattr(model_registry, 'get_config', lookup)
    client = Mock()
    monkeypatch.setattr(agents, 'get_client', client)
    protected = Mock(side_effect=AssertionError('No vault needed for an environment model'))
    monkeypatch.setattr(vault, 'get_credential_vault', protected)
    headers = {'X-DF-Configuration': '1'}
    response = config_client.post('/api/configurations/test-connection', headers=headers,
        json={'section': 'models', 'id': 'environment-model'})
    assert response.get_json()['status'] == 'success'
    assert 'server-key' not in response.get_data(as_text=True)
    client.assert_called_once_with(definition, trusted=True)
    lookup.assert_called_once_with('environment-model', configured=False)
    client.return_value.ping.assert_called_once_with(timeout=20)
    protected.assert_not_called()
    assert read_configuration()['revision'] == 0
    assert config_client.post('/api/configurations/test-connection', headers=headers,
        json={'section': 'models', 'id': 'unknown'}).get_json()['status'] == 'error'
    assert config_client.post('/api/configurations/test-connection',
        json={'section': 'models', 'id': 'environment-model'}).status_code == 403


def test_saved_endpoint_allowlist_and_environment_precedence(monkeypatch):
    from data_formulator.security.url_allowlist import validate_api_base
    monkeypatch.delenv('DF_ALLOWED_API_BASES', raising=False)
    save_configuration({'allowed_api_bases': ['https://gateway.example/*']}, 0)
    validate_api_base('https://gateway.example/v1')
    with pytest.raises(ValueError):
        validate_api_base('https://other.example/v1')
    save_configuration({'allowed_api_bases': []}, 1)
    validate_api_base(None)
    with pytest.raises(ValueError):
        validate_api_base('https://gateway.example/v1')
    monkeypatch.setenv('DF_ALLOWED_API_BASES', 'https://environment.example/*')
    validate_api_base('https://environment.example/v1')
    with pytest.raises(ValueError):
        validate_api_base('https://gateway.example/v1')


def test_staged_gateway_model_validates_default_api_base(config_client, monkeypatch):
    from types import SimpleNamespace
    from data_formulator.auth import vault
    from data_formulator.auth.vault.local_vault import LocalCredentialVault
    from cryptography.fernet import Fernet
    from data_formulator.configuration import configuration_path
    from data_formulator.routes import configurations, agents
    protected = LocalCredentialVault(configuration_path().parent / 'test-credentials.db', Fernet.generate_key().decode())
    monkeypatch.setattr(vault, 'get_credential_vault', lambda: protected)
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:admin')
    monkeypatch.setattr(agents, 'get_client', lambda *args, **kwargs: SimpleNamespace(ping=lambda **kwargs: None))
    request = {'section': 'models', 'definition': {'endpoint': 'cheaperinference', 'model': 'm', 'api_key': 'k'}}
    headers = {'X-DF-Configuration': '1'}
    monkeypatch.setenv('DF_ALLOWED_API_BASES', 'https://api.openai.com/*')
    assert config_client.post('/api/configurations/test-connection', headers=headers, json=request).get_json()['status'] == 'error'
    monkeypatch.setenv('DF_ALLOWED_API_BASES', 'https://api.cheaperinference.com/*')
    assert config_client.post('/api/configurations/test-connection', headers=headers, json=request).get_json()['status'] == 'success'


def test_shared_connector_staging_and_fixed_runtime_parameters(config_client, monkeypatch):
    from data_formulator.auth import vault
    from data_formulator.auth.vault.local_vault import LocalCredentialVault
    from cryptography.fernet import Fernet
    from data_formulator.configuration import configuration_path
    from data_formulator.routes import configurations
    from data_formulator import data_connector
    from data_formulator.data_loader import DATA_LOADERS
    from data_formulator.data_loader.external_data_loader import ExternalDataLoader

    class TestLoader(ExternalDataLoader):
        def __init__(self, params):
            self.params = params

        def list_tables(self, table_filter=None):
            return []

        def fetch_data_as_arrow(self, source_table, import_options=None):
            raise NotImplementedError()

        @staticmethod
        def list_params():
            return [{'name': 'host', 'type': 'string', 'required': True},
                    {'name': 'password', 'type': 'password', 'required': True}]

        def test_connection(self):
            return True

    protected = LocalCredentialVault(configuration_path().parent / 'test-credentials.db', Fernet.generate_key().decode())
    monkeypatch.setattr(vault, 'get_credential_vault', lambda: protected)
    monkeypatch.setattr(configurations, 'get_identity_id', lambda: 'user:admin')
    monkeypatch.setattr(data_connector.DataConnector, '_get_identity', staticmethod(lambda: 'user:other'))
    monkeypatch.setattr(data_connector, 'DATA_CONNECTORS', {})
    monkeypatch.setattr(data_connector, '_ADMIN_CONNECTOR_IDS', set())
    monkeypatch.setitem(DATA_LOADERS, 'test_configuration', TestLoader)
    headers = {'X-DF-Configuration': '1'}
    tested = config_client.post('/api/configurations/test-connection', headers=headers, json={'section': 'connectors',
        'definition': {'type': 'test_configuration', 'display_name': 'Warehouse',
                       'params': {'host': 'warehouse', 'password': 'private-key'}}}).get_json()['data']
    data_connector._sync_installation_connectors()
    assert tested['id'] not in data_connector.DATA_CONNECTORS
    saved = config_client.put('/api/configurations', headers=headers, json={'revision': 0,
        'overrides': {'connections': {'connectors': {tested['id']: tested['reference']}}}}).get_json()
    assert saved['status'] == 'success'
    assert 'private-key' not in str(saved)
    connection = saved['data']['overrides']['connections']['connectors'][tested['id']]
    assert connection['type'] == 'test_configuration'
    assert connection['display_name'] == 'Warehouse'
    assert connection['params'] == {'host': 'warehouse'}
    assert isinstance(connection['credential_ref'], str)
    stored = protected.retrieve('installation:configuration', connection['credential_ref'])
    assert 'definition' not in stored
    assert stored['secrets'] == {'password': 'private-key'}
    data_connector._sync_installation_connectors()
    connector = data_connector.DATA_CONNECTORS[tested['id']]
    assert connector.get_frontend_config()['icon'] == 'test_configuration'
    assert connector.get_frontend_config()['configured_params'] == {'host': 'warehouse', 'password': '********'}
    assert connector.get_frontend_config()['params_form'] == [data_connector.DataConnector._TABLE_FILTER_PARAM]
    assert 'private-key' not in str(connector.get_frontend_config())
    assert connector._connect({'host': 'attacker', 'password': 'replacement'}).params == {'host': 'warehouse', 'password': 'private-key'}
    from data_formulator.auth import identity
    monkeypatch.setattr(identity, 'get_identity_id', lambda: 'user:other')
    monkeypatch.setattr(identity, 'get_sso_token', lambda: None)
    monkeypatch.setattr(data_connector, 'load_connectors', lambda identity: None)
    personal = data_connector.DataConnector.from_loader(TestLoader, 'personal-warehouse', display_name='Personal warehouse')
    monkeypatch.setitem(data_connector.DATA_CONNECTORS, data_connector._user_connector_key('user:other', 'personal-warehouse'), personal)
    with config_client.application.test_request_context('/api/connectors'):
        listed = config_client.application.make_response(data_connector.list_connectors()).get_json()['data']['connectors']
    assert {entry['id'] for entry in listed} == {tested['id'], 'personal-warehouse'}
    assert next(entry for entry in listed if entry['id'] == tested['id'])['connection_identity'] == ''
    assert 'private-key' not in str(listed)
    assert tested['params'] == {'host': 'warehouse'}
    edit_request = {'section': 'connectors', 'id': tested['id'], 'reference': connection['credential_ref'],
                    'definition': {'type': 'test_configuration', 'display_name': 'Updated warehouse',
                                   'params': {'host': 'updated-warehouse'}}}
    edited = config_client.post('/api/configurations/test-connection', headers=headers, json=edit_request).get_json()['data']
    assert edited['id'] == tested['id']
    assert edited['reference'] != tested['reference']
    assert edited['params'] == {'host': 'updated-warehouse'}
    assert 'private-key' not in str(edited)
    data_connector._sync_installation_connectors()
    assert data_connector.DATA_CONNECTORS[tested['id']]._connect({}).params['host'] == 'warehouse'
    saved_edit = config_client.put('/api/configurations', headers=headers, json={'revision': 1,
        'overrides': {'connections': {'connectors': {edited['id']: edited['reference']}}}}).get_json()
    assert saved_edit['status'] == 'success'
    assert 'private-key' not in str(saved_edit)
    data_connector._sync_installation_connectors()
    assert data_connector.DATA_CONNECTORS[tested['id']]._connect({}).params == {'host': 'updated-warehouse', 'password': 'private-key'}
    edit_request['id'] = 'installation-' + '0' * 32
    assert config_client.post('/api/configurations/test-connection', headers=headers, json=edit_request).get_json()['status'] == 'error'