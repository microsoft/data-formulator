from unittest.mock import Mock, patch

import pandas as pd
import pytest
from azure.kusto.data._models import KustoResultTable

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