"""Auto-reconnect credential preservation regression tests."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from data_formulator.data_connector import DataConnector
from tests.backend.data.test_data_connector_vault import IDENTITY, InMemoryVault, MockLoader

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def vault():
    return InMemoryVault()


@pytest.fixture()
def source():
    return DataConnector.from_loader(
        MockLoader,
        source_id="test_db",
        display_name="Test DB",
        default_params={"host": "localhost"},
    )


def _store_credentials(vault: InMemoryVault) -> None:
    vault.store(
        IDENTITY,
        "test_db",
        {
            "user_params": {"password": "secret"},
            "source_id": "test_db",
        },
    )


@pytest.mark.parametrize("failure", [False, ConnectionError("temporary outage")])
def test_auto_reconnect_failure_preserves_credentials(source, vault, failure) -> None:
    _store_credentials(vault)
    loader = MagicMock(spec=MockLoader)
    if isinstance(failure, Exception):
        loader.test_connection.side_effect = failure
    else:
        loader.test_connection.return_value = failure

    with patch.object(DataConnector, "_get_vault", return_value=vault), \
         patch.object(source, "_loader_class", return_value=loader):
        result = source._try_auto_reconnect(IDENTITY)

    assert result is None
    assert vault.retrieve(IDENTITY, "test_db") is not None
