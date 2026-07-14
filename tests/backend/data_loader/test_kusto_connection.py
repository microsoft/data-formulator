from unittest.mock import Mock, patch

import pandas as pd
import pytest

from data_formulator.data_loader.kusto_data_loader import KustoDataLoader
from data_formulator.data_loader.external_data_loader import ConnectorParamError


def _loader() -> KustoDataLoader:
    loader = object.__new__(KustoDataLoader)
    loader.client = Mock()
    loader.kusto_cluster = "https://example.kusto.windows.net"
    loader.kusto_database = "analytics"
    return loader


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