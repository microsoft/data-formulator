import json
from datetime import timedelta
from unittest.mock import Mock, patch

import pandas as pd
import pytest
from azure.kusto.data._models import KustoResultTable
from azure.kusto.data.client_base import ExecuteRequestParams
from azure.kusto.data.exceptions import KustoApiError

from data_formulator.data_loader.kusto_data_loader import (
    KustoDataLoader,
    _KustoDelegatedCredential,
)
from data_formulator.data_loader.external_data_loader import ConnectorParamError
from data_formulator.data_connector import DataConnector


def _loader() -> KustoDataLoader:
    loader = object.__new__(KustoDataLoader)
    loader.client = Mock()
    loader.kusto_cluster = "https://example.kusto.windows.net"
    loader.kusto_database = "analytics"
    return loader


def test_materialized_aggregate_uses_native_query_without_probe_cap():
    loader = _loader()
    loader.query = Mock(return_value=pd.DataFrame({"users": [123]}))
    result = loader.query_data_as_arrow("Events", {
        "aggregates": [{"op": "count_distinct", "column": "user_id", "as": "users"}],
    }, 10001)
    assert result.to_pylist() == [{"users": 123}]
    kql = loader.query.call_args.args[0]
    assert "count_distinct(['user_id'])" in kql
    assert "take 10001" in kql
    assert loader.kusto_database == "analytics"


def test_materialized_query_restores_database_on_error():
    loader = _loader()
    loader.kusto_database = None
    loader.query = Mock(side_effect=RuntimeError("failed"))
    with pytest.raises(RuntimeError, match="failed"):
        loader.query_data_as_arrow("other.Events", {}, 10)
    assert loader.kusto_database is None


def test_native_kql_uses_query_endpoint_and_server_guards():
    loader = _loader()
    assert loader.query_capabilities()["native_query_languages"] == ["kql"]
    loader.client.execute_query.return_value = Mock(get_exceptions=Mock(return_value=[]), primary_results=[KustoResultTable({
        "Columns": [{"ColumnName": "pickups", "ColumnType": "long"}], "Rows": [[42]],
    })])
    text = "Events | summarize pickups=count() by bin(timestamp, 1h)"
    result = loader.query_data_as_arrow("Events", {"native": {"language": "kql", "text": text}}, 10001)
    assert result.to_pylist() == [{"pickups": 42}]
    database, query, properties = loader.client.execute_query.call_args.args
    assert database == "analytics"
    assert query == f"restrict access to (database().['Events']);\n{text}\n| take 10001"
    for option in ("request_readonly", "request_readonly_hardline", "request_callout_disabled",
                   "request_external_data_disabled", "request_external_table_disabled",
                   "request_impersonation_disabled", "request_remote_entities_disabled", "request_sandboxed_execution_disabled"):
        assert properties.get_option(option, None) is True
    request = ExecuteRequestParams._from_query(
        query=query, database=database, properties=properties, request_headers={},
        timeout=timedelta(minutes=4), mgmt_default_timeout=timedelta(hours=1),
        client_server_delta=timedelta(seconds=30),
        client_details=Mock(version_for_tracing=None, application_for_tracing=None, user_name_for_tracing=None),
    )
    assert request.timeout == timedelta(seconds=90)
    assert json.loads(request.json_payload["properties"])["Options"]["servertimeout"] == "0:01:00"
    assert properties.get_option("servertimeout", None) == timedelta(seconds=60)
    assert properties.get_option("truncationmaxsize", None) == 16 * 1024 * 1024
    assert properties.get_option("truncationmaxrecords", None) == 10001
    loader.client.execute.assert_not_called()
    loader.client.execute_mgmt.assert_not_called()


@pytest.mark.parametrize("text", [".drop table Events", "set notruncation; Events", "Events; Other", "Events // comment", "Events /* comment */", "", "x" * 16001])
def test_native_kql_rejects_statements_before_execution(text):
    loader = _loader()
    with pytest.raises(ValueError):
        loader.query_data_as_arrow("Events", {"native": {"language": "kql", "text": text}}, 10001)
    loader.client.execute_query.assert_not_called()


def test_native_kql_rejects_partial_failures():
    loader = _loader()
    loader.client.execute_query.return_value = Mock(get_exceptions=Mock(return_value=["truncated"]), primary_results=[])
    with pytest.raises(ValueError, match="incomplete"):
        loader.query_data_as_arrow("Events", {"native": {"language": "kql", "text": "Events"}}, 10001)


@pytest.mark.parametrize("diagnostic", [
    "SYN0002: The operator cannot be the first operator in a query. [line:position=2:1]",
    "SEM0100: Failed to resolve table or column expression named 'missing'",
])
def test_native_kql_exposes_sanitized_query_diagnostics(diagnostic):
    loader = _loader()
    loader.client.execute_query.side_effect = KustoApiError({"error": {
        "code": "BadRequest", "message": "Request rejected", "@message":
        f"Request invalid: {diagnostic} password=secret-value https://private.example/query?token=secret-token\nServer stack details",
        "@context": {"token": "context-secret", "server": "private-server"},
    }})
    with pytest.raises(ValueError) as error:
        loader.query_data_as_arrow("Events", {"native": {"language": "kql", "text": "where value > 1"}}, 10)
    message = str(error.value)
    assert diagnostic.split(":")[0] in message
    assert "complete query starting from the selected table" in message
    for private in ("secret-value", "secret-token", "context-secret", "private-server", "private.example", "Server stack details"):
        assert private not in message
    loader.client.execute_query.assert_called_once()


def test_native_kql_does_not_expose_unrecognized_service_errors():
    loader = _loader()
    failure = KustoApiError({"error": {"code": "InternalError", "message": "Failed", "@message": "private-server details"}})
    loader.client.execute_query.side_effect = failure
    with pytest.raises(KustoApiError) as error:
        loader.query_data_as_arrow("Events", {"native": {"language": "kql", "text": "Events"}}, 10)
    assert error.value is failure


def test_native_kql_rejects_wildcard_scope():
    loader = _loader()
    with pytest.raises(ValueError, match="exact table"):
        loader.query_data_as_arrow("*", {"native": {"language": "kql", "text": "Events"}}, 10001)
    loader.client.execute_query.assert_not_called()


@pytest.mark.parametrize("column_type", ["float", "real", "double"])
def test_query_converts_floating_point_result_types(column_type: str) -> None:
    loader = _loader()
    loader.client.execute.return_value = Mock(primary_results=[KustoResultTable({
        "Columns": [
            {"ColumnName": "metric", "ColumnType": column_type},
            {"ColumnName": "label", "ColumnType": "string"},
        ],
        "Rows": [
            [1.25, "finite"],
            [None, "null"],
            ["NaN", "nan"],
            ["Infinity", "positive"],
            ["-Infinity", "negative"],
        ],
    })])

    frame = loader.query("Metrics | take 10")

    assert str(frame["metric"].dtype) == "Float64"
    assert frame["metric"].iloc[0] == 1.25
    assert pd.isna(frame["metric"].iloc[1])
    assert pd.isna(frame["metric"].iloc[2])
    assert frame["metric"].iloc[3] == float("inf")
    assert frame["metric"].iloc[4] == float("-inf")
    assert frame["label"].tolist() == ["finite", "null", "nan", "positive", "negative"]


@pytest.mark.parametrize("database,source,expected", [
    ("Athens-prod", "PlayfabDataConnectionMetadata_custom.ObjectiveLog",
     ("Athens-prod", "PlayfabDataConnectionMetadata_custom.ObjectiveLog")),
    ("Athens-prod", "Athens-prod.ObjectiveLog", ("Athens-prod", "Athens-prod.ObjectiveLog")),
    ("Athens-prod", "ObjectiveLog", ("Athens-prod", "ObjectiveLog")),
    (None, "Athens-prod.PlayfabDataConnectionMetadata_custom.ObjectiveLog",
     ("Athens-prod", "PlayfabDataConnectionMetadata_custom.ObjectiveLog")),
    (None, "ObjectiveLog", (None, "ObjectiveLog")),
])
def test_resolve_source_table_preserves_dots_in_pinned_database(database, source, expected) -> None:
    loader = _loader()
    loader.kusto_database = database

    assert loader._resolve_source_table(source) == expected


@pytest.mark.parametrize("operation", ["fetch", "probe"])
def test_dotted_table_queries_use_configured_database(operation) -> None:
    loader = _loader()
    loader.kusto_database = "Athens-prod"
    table = "PlayfabDataConnectionMetadata_custom.ObjectiveLog"
    loader.client.execute.return_value = Mock(primary_results=[KustoResultTable({
        "Columns": [{"ColumnName": "count", "ColumnType": "long"}],
        "Rows": [[1]],
    })])

    if operation == "fetch":
        result = loader.fetch_data_as_arrow(table, {"size": 10})
        assert result.num_rows == 1
    else:
        result = loader.probe([table], {"limit": 10})
        assert "error" not in result

    loader.client.execute.assert_called_once()
    database, kql = loader.client.execute.call_args.args[:2]
    assert database == "Athens-prod"
    assert kql.startswith(f"['{table}']\n| ")
    assert loader.kusto_database == "Athens-prod"


@pytest.mark.parametrize("ordered", [False, True])
def test_fetch_projects_columns_remotely_after_filtering_and_limiting(ordered) -> None:
    loader = _loader()
    loader.query = Mock(return_value=pd.DataFrame({"review text": ["sample"]}))
    options = {"size": 10, "columns": ["review text"],
               "source_filters": [{"column": "game", "operator": "EQ", "value": "target"}]}
    if ordered:
        options.update({"sort_columns": ["score"], "sort_order": "desc"})
    result = loader.fetch_data_as_arrow("Reviews", options)
    loader.query.assert_called_once()
    query = loader.query.call_args.args[0]
    assert "where" in query
    assert query.index("where") < query.index("top 10" if ordered else "take 10")
    assert query.endswith("| project ['review text']")
    assert result.column_names == ["review text"]


def test_connection_uses_direct_sdk_probe() -> None:
    loader = _loader()
    loader.query = Mock(side_effect=AssertionError("query conversion must not run"))

    assert loader.test_connection() is True
    loader.client.execute.assert_called_once_with(
        "analytics",
        ".show tables",
    )
    loader.query.assert_not_called()


def test_connection_returns_false_when_live_probe_fails() -> None:
    loader = _loader()
    loader.client.execute.side_effect = RuntimeError("credential unavailable")

    assert loader.test_connection() is False


def test_database_is_required() -> None:
    params = {
        "kusto_cluster": "https://example.kusto.windows.net",
        "kusto_database": "",
    }

    with pytest.raises(ConnectorParamError, match="kusto_database"):
        KustoDataLoader.validate_params(params)


def test_service_principal_path_requires_complete_credentials() -> None:
    params = {
        "kusto_cluster": "https://example.kusto.windows.net",
        "kusto_database": "analytics",
        "_auth_path": "service_principal",
        "client_id": "client",
    }

    with pytest.raises(ConnectorParamError) as exc_info:
        KustoDataLoader.validate_params(params)

    assert "client_secret" in str(exc_info.value)
    assert "tenant_id" in str(exc_info.value)


def test_ambient_path_does_not_require_service_principal_fields() -> None:
    params = {
        "kusto_cluster": "https://example.kusto.windows.net",
        "kusto_database": "analytics",
        "_auth_path": "ambient",
    }

    KustoDataLoader.validate_params(params)


def test_microsoft_sign_in_is_default_when_oauth_is_configured(monkeypatch) -> None:
    monkeypatch.setenv("KUSTO_OAUTH_CLIENT_ID", "client")

    paths = KustoDataLoader.auth_paths()

    assert paths[0]["id"] == "microsoft_sign_in"
    assert paths[0]["default"] is True
    assert KustoDataLoader.delegated_login_config() == {
        "login_url": "/api/auth/kusto/login",
        "label": "Sign in with Microsoft",
        "params": ["kusto_cluster"],
    }


def test_ambient_is_default_when_oauth_is_not_configured(monkeypatch) -> None:
    monkeypatch.delenv("KUSTO_OAUTH_CLIENT_ID", raising=False)

    paths = KustoDataLoader.auth_paths()

    assert paths[0]["id"] == "ambient"
    assert paths[0]["default"] is True
    assert KustoDataLoader.delegated_login_config() is None


def test_connector_manifest_preserves_root_oauth_url(monkeypatch) -> None:
    monkeypatch.setenv("KUSTO_OAUTH_CLIENT_ID", "client")
    connector = DataConnector.from_loader(
        KustoDataLoader,
        source_id="kusto:test",
        display_name="Kusto test",
    )

    config = connector.get_frontend_config()

    assert config["delegated_login"] == {
        "login_url": "/api/auth/kusto/login",
        "label": "Sign in with Microsoft",
        "params": ["kusto_cluster"],
    }


def test_ambient_credential_reuses_token_until_refresh_margin(monkeypatch):
    from azure.core.credentials import AccessToken
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    clock = Mock(return_value=1000)
    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", clock)
    source = Mock()
    source.get_token.side_effect = [AccessToken("first", 1600), AccessToken("refreshed", 2500)]
    credential = _KustoCachedCredential(source)
    assert credential.get_token("scope").token == "first"
    clock.return_value = 1299
    assert credential.get_token("scope").token == "first"
    source.get_token.assert_called_once_with("scope")
    clock.return_value = 1300
    assert credential.get_token("scope").token == "refreshed"
    assert source.get_token.call_count == 2


@pytest.mark.parametrize("scopes,options", [
    (("other-scope",), {}), (("scope", "second-scope"), {}),
    (("scope",), {"tenant_id": "other-tenant"}),
    (("scope",), {"claims": "challenge"}), (("scope",), {"enable_cae": True}),
])
def test_ambient_credential_separates_token_requests(monkeypatch, scopes, options):
    from azure.core.credentials import AccessToken
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", lambda: 1000)
    source = Mock()
    source.get_token.side_effect = [AccessToken("first", 2000), AccessToken("second", 2000)]
    credential = _KustoCachedCredential(source)
    assert credential.get_token("scope").token == "first"
    assert credential.get_token(*scopes, **options).token == "second"
    assert credential.get_token(*scopes, **options).token == "second"
    assert source.get_token.call_count == 2
    source.get_token.assert_called_with(*scopes, **options)


@pytest.mark.parametrize("expires_on", [900, 1000, 1300])
def test_ambient_credential_does_not_retain_short_lived_tokens(monkeypatch, expires_on):
    from azure.core.credentials import AccessToken
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", lambda: 1000)
    source = Mock()
    source.get_token.return_value = AccessToken("short-lived", expires_on)
    credential = _KustoCachedCredential(source)
    credential.get_token("scope")
    credential.get_token("scope")
    assert source.get_token.call_count == 2
    assert credential._token is None


def test_ambient_credential_refresh_failure_does_not_return_old_token(monkeypatch):
    from azure.core.credentials import AccessToken
    from azure.core.exceptions import ClientAuthenticationError
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    clock = Mock(return_value=1000)
    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", clock)
    source = Mock()
    source.get_token.side_effect = [AccessToken("old", 1600), ClientAuthenticationError("Denied"),
                                   AccessToken("new", 2500)]
    credential = _KustoCachedCredential(source)
    credential.get_token("scope")
    clock.return_value = 1300
    with pytest.raises(ClientAuthenticationError):
        credential.get_token("scope")
    assert credential._token is None
    assert credential.get_token("scope").token == "new"


def test_ambient_credential_does_not_share_cache_and_clears_on_close(monkeypatch):
    from azure.core.credentials import AccessToken
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", lambda: 1000)
    first_source, second_source = Mock(), Mock()
    first_source.get_token.return_value = AccessToken("first-user", 2000)
    second_source.get_token.return_value = AccessToken("second-user", 2000)
    first, second = _KustoCachedCredential(first_source), _KustoCachedCredential(second_source)
    assert first.get_token("scope").token == "first-user"
    assert second.get_token("scope").token == "second-user"
    first.close()
    first.close()
    assert first._token is None
    first_source.close.assert_called_once()
    with pytest.raises(RuntimeError, match="closed"):
        first.get_token("scope")
    assert second.get_token("scope").token == "second-user"
    second_source.get_token.assert_called_once()
    second_source.close.assert_not_called()


def test_ambient_credential_unknown_options_bypass_and_clear_cache(monkeypatch):
    from azure.core.credentials import AccessToken
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", lambda: 1000)
    source = Mock()
    source.get_token.return_value = AccessToken("fixture", 2000)
    credential = _KustoCachedCredential(source)
    credential.get_token("scope")
    credential.get_token("scope", force_refresh=True)
    credential.get_token("scope", force_refresh=True)
    source.get_token.assert_called_with("scope", force_refresh=True)
    assert credential._token is None
    credential.get_token("scope")
    assert source.get_token.call_count == 4


def test_ambient_credential_concurrent_requests_acquire_once(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event
    from azure.core.credentials import AccessToken
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", lambda: 1000)
    ready = Barrier(8)
    acquiring, release = Event(), Event()

    def acquire(*scopes):
        acquiring.set()
        assert release.wait(5)
        return AccessToken("fixture", 2000)

    source = Mock()
    source.get_token.side_effect = acquire
    credential = _KustoCachedCredential(source)

    def request_token():
        ready.wait(timeout=5)
        return credential.get_token("scope")

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(request_token) for index in range(8)]
        try:
            assert acquiring.wait(5)
        finally:
            release.set()
        assert all(future.result(timeout=5).token == "fixture" for future in futures)
    source.get_token.assert_called_once_with("scope")


def test_ambient_loader_wraps_its_own_credential(monkeypatch):
    from azure.core.credentials import AccessToken
    from data_formulator.data_loader.kusto_data_loader import _KustoCachedCredential

    monkeypatch.setattr("data_formulator.data_loader.kusto_data_loader.time.time", lambda: 1000)
    module = "data_formulator.data_loader.kusto_data_loader"
    source = Mock()
    source.get_token.return_value = AccessToken("fixture", 2000)
    with patch("azure.identity.DefaultAzureCredential", return_value=source), \
         patch(f"{module}.KustoClient"), \
         patch(f"{module}.KustoConnectionStringBuilder.with_azure_token_credential") as build:
        KustoDataLoader({"kusto_cluster": "https://example.kusto.windows.net", "kusto_database": "analytics"})
        credential = build.call_args.args[1]
        assert isinstance(credential, _KustoCachedCredential)
        credential.get_token("scope")
        credential.get_token("scope")
        source.get_token.assert_called_once_with("scope")


@pytest.mark.parametrize("auth", [
    {"access_token": "delegated"},
    {"access_token": "delegated", "refresh_token": "refresh", "token_expires_at": 2000},
    {"client_id": "client", "client_secret": "secret", "tenant_id": "tenant"},
])
def test_nonambient_auth_does_not_use_ambient_cache(auth):
    module = "data_formulator.data_loader.kusto_data_loader"
    with patch(f"{module}.KustoClient"), patch(f"{module}._KustoCachedCredential") as cache, \
         patch("azure.identity.DefaultAzureCredential") as ambient:
        KustoDataLoader({"kusto_cluster": "https://example.kusto.windows.net", "kusto_database": "analytics", **auth})
        cache.assert_not_called()
        ambient.assert_not_called()


def test_delegated_credential_refreshes_expired_token(monkeypatch) -> None:
    monkeypatch.setenv("KUSTO_OAUTH_CLIENT_ID", "client")
    monkeypatch.setenv("KUSTO_OAUTH_TENANT_ID", "tenant")
    response = Mock(ok=True)
    response.json.return_value = {
        "access_token": "new-access",
        "refresh_token": "new-refresh",
        "expires_in": 3600,
    }
    credential = _KustoDelegatedCredential(
        "https://help.kusto.windows.net",
        "expired-access",
        "refresh",
        0,
    )

    with patch(
        "data_formulator.data_loader.kusto_data_loader.http.post",
        return_value=response,
    ) as post:
        token = credential.get_token("https://help.kusto.windows.net/.default")

    assert token.token == "new-access"
    assert credential.refresh_token == "new-refresh"
    assert post.call_args.kwargs["data"]["grant_type"] == "refresh_token"


def test_legacy_complete_service_principal_infers_path() -> None:
    params = {
        "kusto_cluster": "https://example.kusto.windows.net",
        "kusto_database": "analytics",
        "client_id": "client",
        "client_secret": "secret",
        "tenant_id": "tenant",
    }

    KustoDataLoader.validate_params(params)

    assert params["_auth_path"] == "service_principal"


def test_database_options_are_loaded_only_on_demand() -> None:
    loader = _loader()
    result = Mock()
    result.primary_results = [Mock()]
    loader.client.execute.return_value = result

    with patch.object(KustoDataLoader, "__init__", return_value=None), \
         patch.object(KustoDataLoader, "client", loader.client, create=True), \
         patch(
             "data_formulator.data_loader.kusto_data_loader.dataframe_from_result_table",
             return_value=pd.DataFrame({
                 "DatabaseName": ["Sales", "analytics", "Sales", None],
             }),
         ):
        options = KustoDataLoader.discover_param_options(
            "kusto_database",
            {"kusto_cluster": "https://example.kusto.windows.net"},
        )

    assert options == ["analytics", "Sales"]
    loader.client.execute.assert_called_once_with(None, ".show databases")