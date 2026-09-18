from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
import pytest

from data_formulator.data_loader.azure_blob_data_loader import AzureBlobDataLoader


@pytest.mark.parametrize("endpoint", [None, "", "blob.core.windows.net",
    "stwedsmartprod.blob.core.windows.net", "https://stwedsmartprod.blob.core.windows.net/"])
@pytest.mark.parametrize("auth", ["identity", "sas_token", "account_key"])
def test_blob_endpoint_is_consistent_for_test_catalog_and_reads(endpoint, auth):
    params = {"account_name": "stwedsmartprod", "container_name": "materialized", "endpoint": endpoint}
    if auth != "identity":
        params[auth] = "test-credential"
    with patch("data_formulator.data_loader.azure_blob_data_loader.pa_fs.AzureFileSystem") as filesystem, \
         patch("data_formulator.data_loader.azure_blob_data_loader.BlobServiceClient") as service, \
         patch("data_formulator.data_loader.azure_blob_data_loader.DefaultAzureCredential") as identity:
        loader = AzureBlobDataLoader(params)
        container = service.return_value.get_container_client.return_value
        container.list_blobs.return_value = [Mock(name="blob", size=20)]
        container.list_blobs.return_value[0].name = "games.parquet"
        loader._read_sample = Mock(return_value=pd.DataFrame({"value": [1]}))
        loader._estimate_row_count = Mock(return_value=1)
        assert loader.test_connection()
        tables = loader.list_tables()
        assert loader.ls()[0].name == "games.parquet"
        loader.get_metadata(["games.parquet"])
        assert tables[0]["name"] == "az://stwedsmartprod.blob.core.windows.net/materialized/games.parquet"
        assert loader._azure_path(tables[0]["name"]) == "materialized/games.parquet"
        for call in service.call_args_list:
            assert call.kwargs["account_url"] == "https://stwedsmartprod.blob.core.windows.net"
            assert call.kwargs["credential"] == (identity.return_value if auth == "identity" else "test-credential")
            assert call.kwargs["connection_timeout"] == 5
            assert call.kwargs["read_timeout"] == 10
            assert call.kwargs["retry_policy"].total_retries == 2
        assert filesystem.call_args.kwargs["blob_storage_authority"] == ".blob.core.windows.net"
        assert filesystem.call_args.kwargs["dfs_storage_authority"] == ".dfs.core.windows.net"


def test_blob_connection_preserves_timeout_for_error_classification():
    loader = object.__new__(AzureBlobDataLoader)
    loader.container_name = "container"
    loader._blob_service_client = Mock()
    loader._blob_service_client.return_value.get_container_client.return_value.get_container_properties.side_effect = TimeoutError("timed out")
    with pytest.raises(TimeoutError):
        loader.test_connection()


def test_catalog_lists_blob_metadata_without_reading_files():
    loader = object.__new__(AzureBlobDataLoader)
    loader.container_name = "fxdata"
    loader.blob_host = "chenglong.blob.core.windows.net"
    client = Mock()
    loader._blob_service_client = Mock(return_value=client)
    container = client.get_container_client.return_value
    container.list_blobs.return_value = [
        SimpleNamespace(name="games.parquet", size=5769397),
        SimpleNamespace(name="games_reviews.csv", size=923098710),
        SimpleNamespace(name="nested/events.jsonl", size=100),
        SimpleNamespace(name="notes.txt", size=200),
        SimpleNamespace(name="folder/", size=0),
    ]
    loader._read_sample = Mock(side_effect=AssertionError("Catalog must not read blob contents"))
    loader._estimate_row_count = Mock(side_effect=AssertionError("Catalog must not scan for row counts"))

    tables = loader.list_tables()

    assert [table["name"].rsplit("/", 1)[-1] for table in tables] == ["games.parquet", "games_reviews.csv", "events.jsonl"]
    assert tables[1]["metadata"] == {"size_bytes": 923098710}
    assert tables[0]["path"] == [tables[0]["name"]]
    assert loader.list_tables("REVIEWS") == [tables[1]]
    loader._read_sample.assert_not_called()
    loader._estimate_row_count.assert_not_called()
    container.download_blob.assert_not_called()


@pytest.mark.parametrize("endpoint", ["http://example.com", "https://example.com/container",
    "https://user:password@example.com", "https://example.com?sig=secret", "https://example.com/#fragment"])
def test_blob_endpoint_rejects_non_account_urls(endpoint):
    with pytest.raises(ValueError, match="Blob endpoint must"):
        AzureBlobDataLoader({"account_name": "account", "container_name": "container", "endpoint": endpoint})