from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
import pyarrow as pa
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq
from pyarrow import fs as pa_fs
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


@pytest.mark.parametrize("extension", ["csv", "parquet", "jsonl"])
def test_blob_queries_filter_and_sort_before_limit_without_whole_file_materialization(tmp_path, extension):
    import json

    rows = [{"game": "other", "review": "wrong", "score": 100},
            {"game": "target", "review": "first", "score": 2},
            {"game": "target", "review": "best", "score": 9}]
    path = tmp_path / f"reviews.{extension}"
    table = pa.Table.from_pylist(rows)
    if extension == "csv":
        pa_csv.write_csv(table, path)
    elif extension == "parquet":
        pq.write_table(table, path)
    else:
        path.write_text('\n'.join(json.dumps(row) for row in rows))
    loader = object.__new__(AzureBlobDataLoader)
    loader.azure_fs = pa_fs.LocalFileSystem()
    loader._azure_path = Mock(return_value=str(path))
    source = f"az://fixture/container/reviews.{extension}"
    with patch.object(pq, "read_table", side_effect=AssertionError("No full-file read")), \
         patch.object(pa_csv, "read_csv", side_effect=AssertionError("No full-file read")):
        result = loader.fetch_data_as_arrow(source, {"size": 1, "columns": ["review"],
            "source_filters": [{"column": "game", "operator": "EQ", "value": "target"}],
            "sort_columns": ["score"], "sort_order": "desc"})
        assert result.to_pylist() == [{"review": "best"}]
        assert len(loader._read_sample(source, 1)) == 1
        probe = loader.probe([source], {"group_by": ["game"], "aggregates": [{"op": "count", "as": "reviews"}],
            "order_by": [{"column": "reviews", "dir": "desc"}], "limit": 1})
        assert probe["rows"] == [{"game": "target", "reviews": 2}]
        assert probe["exact"] is True
    with pytest.raises(ValueError, match="Unsupported source filter"):
        loader.fetch_data_as_arrow(source, {"source_filters": [{"column": "game", "operator": "UNKNOWN"}]})


def test_blob_csv_queries_preserve_multiline_reviews_across_blocks(tmp_path):
    review = 'First line, with a comma\nSecond line with "quoted" text\r\n' + 'review text ' * 100
    rows = [{"game": "other", "review": review} for _ in range(2000)]
    rows.append({"game": "target", "review": review})
    path = tmp_path / "reviews.csv"
    pa_csv.write_csv(pa.Table.from_pylist(rows), path)
    assert path.stat().st_size > 2 * 1024 * 1024
    loader = object.__new__(AzureBlobDataLoader)
    loader.azure_fs = pa_fs.LocalFileSystem()
    loader._azure_path = Mock(return_value=str(path))
    source = "az://fixture/container/reviews.csv"

    assert loader._read_sample(source, 5)["review"].tolist() == [review] * 5
    result = loader.fetch_data_as_arrow(source, {"size": 1, "columns": ["review"],
        "source_filters": [{"column": "game", "operator": "EQ", "value": "target"}]})
    assert result.to_pylist() == [{"review": review}]
    probe = loader.probe([source], {"aggregates": [{"op": "count", "as": "reviews"}], "limit": 1})
    assert probe["rows"] == [{"reviews": 2001}]
    assert probe["exact"] is True


@pytest.mark.parametrize("extension", ["csv", "parquet", "jsonl"])
def test_blob_repeated_preview_closes_partially_consumed_file_scan(tmp_path, extension):
    import json

    path = tmp_path / f"large.{extension}"
    row = {"review": "review text " * 100, "score": 5}
    table = pa.Table.from_pylist([row] * 30000)
    if extension == "csv":
        pa_csv.write_csv(table, path)
    elif extension == "parquet":
        pq.write_table(table, path, row_group_size=8192)
    else:
        path.write_text((json.dumps(row) + "\n") * 30000)
    loader = object.__new__(AzureBlobDataLoader)
    loader.azure_fs = pa_fs.LocalFileSystem()
    loader._azure_path = Mock(return_value=str(path))

    for attempt in range(5):
        result = loader.fetch_data_as_arrow(f"az://fixture/container/large.{extension}", {"size": 50})
        assert result.to_pylist() == [row] * 50, attempt


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


def test_blob_small_sample_stops_before_consuming_the_source():
    loader = object.__new__(AzureBlobDataLoader)
    loader.azure_fs = pa_fs.LocalFileSystem()
    loader._azure_path = Mock(return_value="fixture.csv")
    batch = pa.record_batch({"value": list(range(8192))})
    consumed = []

    def batches():
        for index in range(100):
            consumed.append(index)
            yield batch

    reader = pa.RecordBatchReader.from_batches(batch.schema, batches())
    with patch("data_formulator.data_loader.azure_blob_data_loader.pa_dataset.dataset") as dataset:
        dataset.return_value.scanner.return_value.to_reader.return_value = reader
        assert len(loader._read_sample("az://fixture/reviews.csv", 5)) == 5
    assert len(consumed) < 100


def test_blob_metadata_resolves_canonical_reference_url():
    loader = object.__new__(AzureBlobDataLoader)
    loader._read_sample = Mock(return_value=pd.DataFrame({"review": ["sample"]}))
    loader._estimate_row_count = Mock(side_effect=AssertionError("No count scan for metadata"))
    source = "az://account.blob.core.windows.net/container/nested/reviews.csv"
    metadata = loader.get_metadata([source])
    assert metadata["columns"] == [{"name": "review", "type": "object"}]
    assert metadata["sample_rows"] == [{"review": "sample"}]
    assert "row_count" not in metadata
    loader._read_sample.assert_called_once_with(source, 5)
    loader._estimate_row_count.assert_not_called()


def test_blob_parquet_metadata_uses_footer_count(tmp_path):
    path = tmp_path / "events.parquet"
    pq.write_table(pa.table({"value": list(range(20))}), path)
    loader = object.__new__(AzureBlobDataLoader)
    loader.azure_fs = pa_fs.LocalFileSystem()
    loader._azure_path = Mock(return_value=str(path))
    metadata = loader.get_metadata(["az://account/container/events.parquet"])
    assert metadata["row_count"] == 20
    assert len(metadata["sample_rows"]) == 5


@pytest.mark.parametrize("endpoint", ["http://example.com", "https://example.com/container",
    "https://user:password@example.com", "https://example.com?sig=secret", "https://example.com/#fragment"])
def test_blob_endpoint_rejects_non_account_urls(endpoint):
    with pytest.raises(ValueError, match="Blob endpoint must"):
        AzureBlobDataLoader({"account_name": "account", "container_name": "container", "endpoint": endpoint})