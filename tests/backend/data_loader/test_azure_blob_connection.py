from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
import pyarrow as pa
import pyarrow.csv as pa_csv
import pyarrow.dataset as pa_dataset
import pyarrow.parquet as pq
from pyarrow import fs as pa_fs
import pytest

from data_formulator.data_loader.azure_blob_data_loader import AzureBlobDataLoader
from data_formulator.data_loader import probe_utils


@pytest.fixture
def local_blob_loader():
    def create(path):
        loader = object.__new__(AzureBlobDataLoader)
        loader.azure_fs = pa_fs.LocalFileSystem()
        loader._azure_path = Mock(return_value=str(path))
        loader._register_source = lambda connection, source, **options: probe_utils.register_file_scan(connection, str(path), **options)
        return loader
    return create


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


def test_blob_parquet_query_uses_native_duckdb_scan():
    with patch("data_formulator.data_loader.azure_blob_data_loader.pa_fs.AzureFileSystem"):
        loader = AzureBlobDataLoader({"account_name": "fixture", "container_name": "data"})
    with patch("duckdb.connect") as connect, \
            patch.object(loader, "_query_access_token", return_value="fixture-token"), \
         patch.object(pa_dataset, "dataset", side_effect=AssertionError("Parquet must use native DuckDB")):
        connection = connect.return_value.__enter__.return_value
        expected = pa.table({"score": [9]})
        connection.execute.return_value.fetch_arrow_table.return_value = expected
        result = loader.fetch_data_as_arrow("az://fixture.blob.core.windows.net/data/reviews.parquet", {"size": 1})
        assert result is expected
        connection.read_parquet.assert_called_once_with(
            "az://fixture.blob.core.windows.net/data/reviews.parquet", hive_partitioning=False,
        )
        connection.read_parquet.return_value.create_view.assert_called_once_with("t")


@pytest.mark.parametrize("endpoint", ["blob.core.windows.net", "https://fixture.blob.core.usgovcloudapi.net/"])
@pytest.mark.parametrize("auth", ["identity", "account_key", "sas_token", "connection_string"])
def test_blob_parquet_credentials_are_parameterized_and_scoped(endpoint, auth):
    params = {"account_name": "fixture", "container_name": "data", "endpoint": endpoint,
              "credential_chain": "env;cli"}
    if auth != "identity":
        params[auth] = "?test's-token" if auth == "sas_token" else "test's-credential"
    with patch("data_formulator.data_loader.azure_blob_data_loader.pa_fs.AzureFileSystem"):
        loader = AzureBlobDataLoader(params)
    connection = Mock()
    with patch.object(loader, "_query_access_token", return_value="test's-token") as acquire:
        loader._register_source(connection, "nested/reviews.parquet")
    assert acquire.call_count == (1 if auth == "identity" else 0)
    statement, values = connection.execute.call_args.args
    assert "CREATE SECRET" in statement
    assert "PERSISTENT" not in statement
    assert "test's" not in statement
    assert values[-1] == f"az://{loader.blob_host}/data/"
    if auth == "identity":
        assert "PROVIDER access_token" in statement
        assert values[:-1] == ["fixture", "test's-token", loader.blob_host.removeprefix("fixture.")]
    elif auth == "connection_string":
        assert values[0] == params[auth]
    else:
        credential = "AccountKey=test's-credential" if auth == "account_key" else "SharedAccessSignature=test's-token"
        assert values[0] == f"BlobEndpoint={loader.account_url};AccountName=fixture;{credential}"
    connection.read_parquet.assert_called_once_with(
        f"az://{loader.blob_host}/data/nested/reviews.parquet", hive_partitioning=False,
    )


@pytest.mark.parametrize("source", [
    "az://fixture.blob.core.windows.net/data/nested/events.parquet",
    "nested/events.parquet",
])
def test_blob_column_types_preserve_file_path(source):
    loader = object.__new__(AzureBlobDataLoader)
    columns = [{"name": "title", "type": "string"}]
    loader.get_metadata = Mock(return_value={"columns": columns, "row_count": 5})
    assert loader.get_column_types(source) == {"columns": columns}
    loader.get_metadata.assert_called_once_with([source])


def test_blob_parquet_error_does_not_fall_back_to_arrow():
    with patch("data_formulator.data_loader.azure_blob_data_loader.pa_fs.AzureFileSystem"):
        loader = AzureBlobDataLoader({"account_name": "fixture", "container_name": "data"})
    with patch("duckdb.connect") as connect, patch.object(pa_dataset, "dataset") as dataset, \
         patch.object(loader, "_query_access_token", return_value="fixture-token"):
        connect.return_value.__enter__.return_value.execute.side_effect = RuntimeError("extension unavailable")
        with pytest.raises(RuntimeError, match="extension unavailable"):
            loader.fetch_data_as_arrow("reviews.parquet")
        dataset.assert_not_called()
        connect.return_value.__exit__.assert_called_once()


@pytest.mark.parametrize("provider,class_name", [
    ("cli", "AzureCliCredential"), ("managed_identity", "ManagedIdentityCredential"),
    ("env", "EnvironmentCredential"), ("workload_identity", "WorkloadIdentityCredential"),
    ("default", "DefaultAzureCredential"),
])
def test_blob_query_token_uses_configured_provider_and_closes_it(provider, class_name, monkeypatch):
    import time

    monkeypatch.setenv("AZURE_TENANT_ID", "fixture-tenant")
    monkeypatch.setenv("AZURE_CLIENT_ID", "fixture-client")
    monkeypatch.setenv("AZURE_FEDERATED_TOKEN_FILE", "fixture-token-file")
    loader = object.__new__(AzureBlobDataLoader)
    loader.credential_chain = provider
    module = "data_formulator.data_loader.azure_blob_data_loader"
    with patch(f"{module}.{class_name}") as factory, patch(f"{module}.ChainedTokenCredential") as chain:
        chain.return_value.get_token.return_value = SimpleNamespace(token="test-token", expires_on=time.time() + 3600)
        assert loader._query_access_token() == "test-token"
        chain.assert_called_once_with(factory.return_value.__enter__.return_value)
        chain.return_value.get_token.assert_called_once_with("https://storage.azure.com/.default")
        factory.return_value.__exit__.assert_called_once()


@pytest.mark.parametrize("remaining", [-1, 0, 299])
def test_blob_query_token_rejects_expiring_credentials(remaining):
    from azure.core.exceptions import ClientAuthenticationError

    loader = object.__new__(AzureBlobDataLoader)
    loader.credential_chain = "cli"
    module = "data_formulator.data_loader.azure_blob_data_loader"
    with patch(f"{module}.AzureCliCredential") as factory, patch(f"{module}.ChainedTokenCredential") as chain, \
         patch(f"{module}.time.time", return_value=1000):
        chain.return_value.get_token.return_value = SimpleNamespace(token="never-log-this", expires_on=1000 + remaining)
        with pytest.raises(ClientAuthenticationError, match="expires too soon") as error:
            loader._query_access_token()
        assert "never-log-this" not in str(error.value)
        factory.return_value.__exit__.assert_called_once()


def test_blob_query_tokens_preserve_order_and_are_not_cached_between_queries():
    import time
    from azure.identity import CredentialUnavailableError

    loader = object.__new__(AzureBlobDataLoader)
    loader.credential_chain = " env ; cli "
    module = "data_formulator.data_loader.azure_blob_data_loader"
    with patch(f"{module}.EnvironmentCredential") as environment, patch(f"{module}.AzureCliCredential") as cli:
        env_credential = environment.return_value.__enter__.return_value
        cli_credential = cli.return_value.__enter__.return_value
        env_credential.get_token.side_effect = CredentialUnavailableError("Not configured")
        cli_credential.get_token.side_effect = [
            SimpleNamespace(token="first-query", expires_on=time.time() + 3600),
            SimpleNamespace(token="second-query", expires_on=time.time() + 3600),
        ]
        assert loader._query_access_token() == "first-query"
        assert loader._query_access_token() == "second-query"
        assert env_credential.get_token.call_count == 2
        assert cli_credential.get_token.call_count == 2
        assert environment.return_value.__exit__.call_count == 2
        assert cli.return_value.__exit__.call_count == 2
    assert not hasattr(loader, "_access_token")


def test_blob_query_authentication_failure_does_not_switch_identity():
    from azure.core.exceptions import ClientAuthenticationError

    loader = object.__new__(AzureBlobDataLoader)
    loader.credential_chain = "env;cli"
    module = "data_formulator.data_loader.azure_blob_data_loader"
    with patch(f"{module}.EnvironmentCredential") as environment, patch(f"{module}.AzureCliCredential") as cli:
        environment.return_value.__enter__.return_value.get_token.side_effect = ClientAuthenticationError("Denied")
        with pytest.raises(ClientAuthenticationError):
            loader._query_access_token()
        cli.return_value.__enter__.return_value.get_token.assert_not_called()
        environment.return_value.__exit__.assert_called_once()
        cli.return_value.__exit__.assert_called_once()


@pytest.mark.parametrize("chain", ["", "cli;unknown", "cli;"])
def test_blob_query_rejects_invalid_chain_before_acquiring_credentials(chain):
    loader = object.__new__(AzureBlobDataLoader)
    loader.credential_chain = chain
    with patch("data_formulator.data_loader.azure_blob_data_loader.AzureCliCredential") as cli:
        with pytest.raises(ValueError, match="credential_chain"):
            loader._query_access_token()
        cli.assert_not_called()


@pytest.mark.parametrize("chain", ["cli;workload_identity", "workload_identity;cli", "workload_identity"])
def test_blob_unconfigured_workload_identity_does_not_block_other_providers(chain, monkeypatch):
    import time
    from azure.identity import CredentialUnavailableError

    monkeypatch.delenv("AZURE_FEDERATED_TOKEN_FILE", raising=False)
    loader = object.__new__(AzureBlobDataLoader)
    loader.credential_chain = chain
    module = "data_formulator.data_loader.azure_blob_data_loader"
    with patch(f"{module}.WorkloadIdentityCredential") as workload, patch(f"{module}.AzureCliCredential") as cli:
        cli.return_value.__enter__.return_value.get_token.return_value = SimpleNamespace(
            token="fixture-token", expires_on=time.time() + 3600,
        )
        if chain == "workload_identity":
            with pytest.raises(CredentialUnavailableError):
                loader._query_access_token()
            cli.assert_not_called()
        else:
            assert loader._query_access_token() == "fixture-token"
            cli.return_value.__exit__.assert_called_once()
        workload.assert_not_called()


def test_blob_token_failure_prevents_native_read():
    from azure.core.exceptions import ClientAuthenticationError

    with patch("data_formulator.data_loader.azure_blob_data_loader.pa_fs.AzureFileSystem"):
        loader = AzureBlobDataLoader({"account_name": "fixture", "container_name": "data"})
    connection = Mock()
    with patch.object(loader, "_query_access_token", side_effect=ClientAuthenticationError("Expired")):
        with pytest.raises(ClientAuthenticationError):
            loader._register_source(connection, "reviews.parquet")
    connection.execute.assert_not_called()
    connection.read_parquet.assert_not_called()


def test_blob_parquet_aggregate_reads_beyond_output_limit(tmp_path, local_blob_loader):
    path = tmp_path / "reviews.parquet"
    pq.write_table(pa.table({"score": list(range(30000))}), path, row_group_size=8192)
    loader = local_blob_loader(path)
    result = loader.query_data_as_arrow(str(path), {
        "filters": [{"column": "score", "op": "GTE", "value": 20000}],
        "aggregates": [{"op": "sum", "column": "score", "as": "total"}],
    }, 1)
    assert result.to_pylist() == [{"total": sum(range(20000, 30000))}]


@pytest.mark.parametrize("filtered", [False, True])
def test_blob_parquet_pushdown_reduces_source_bytes(filtered):
    import io
    import random

    memory_fs = pytest.importorskip("fsspec.implementations.memory")
    read_sizes = []

    class CountedFile(io.BytesIO):
        def read(self, size=-1):
            content = super().read(size)
            read_sizes.append(len(content))
            return content

        def readinto(self, target):
            content = self.read(len(target))
            target[:len(content)] = content
            return len(content)

    class CountedFS(memory_fs.MemoryFileSystem):
        def _open(self, path, mode="rb", **kwargs):
            source = super()._open(path, mode=mode, **kwargs)
            return CountedFile(source.getvalue()) if mode == "rb" else source

    rng = random.Random(42)
    sink = pa.BufferOutputStream()
    pq.write_table(pa.table({
        "key": list(range(60000)),
        "unused": [rng.randbytes(64) for index in range(60000)],
    }), sink, row_group_size=3000)
    content = sink.getvalue().to_pybytes()
    filesystem = CountedFS(skip_instance_cache=True)
    path = f"/blob-pushdown-{filtered}.parquet"
    filesystem.pipe_file(path, content)

    def register(connection, source):
        connection.register_filesystem(filesystem)
        return connection.read_parquet(f"memory://{path}", hive_partitioning=False).create_view("t")

    loader = object.__new__(AzureBlobDataLoader)
    loader._register_source = register
    loader._azure_path = Mock(return_value=path)
    loader.azure_fs = pa_fs.PyFileSystem(pa_fs.FSSpecHandler(filesystem))
    try:
        result = loader.query_data_as_arrow(path, {
            "aggregates": [{"op": "sum", "column": "key", "as": "total"}],
            "filters": [{"column": "key", "op": "LT", "value": 1000}] if filtered else [],
        }, 1)
        assert result.to_pylist() == [{"total": sum(range(1000 if filtered else 60000))}]
        assert 0 < sum(read_sizes) < len(content) / (20 if filtered else 4)
    finally:
        filesystem.rm(path)


@pytest.mark.parametrize("extension", ["csv", "tsv", "parquet", "json", "jsonl"])
def test_blob_queries_filter_and_sort_before_limit_without_whole_file_materialization(tmp_path, extension, local_blob_loader):
    import json

    rows = [{"game": "other", "review": "wrong", "score": 100},
            {"game": "target", "review": "first", "score": 2},
            {"game": "target", "review": "best", "score": 9}]
    path = tmp_path / f"reviews.{extension}"
    table = pa.Table.from_pylist(rows)
    if extension in ("csv", "tsv"):
        pa_csv.write_csv(table, path, write_options=pa_csv.WriteOptions(delimiter="\t" if extension == "tsv" else ","))
    elif extension == "parquet":
        pq.write_table(table, path)
    elif extension == "json":
        path.write_text(json.dumps(rows))
    else:
        path.write_text('\n'.join(json.dumps(row) for row in rows))
    loader = local_blob_loader(path)
    source = f"az://fixture/container/reviews.{extension}"
    with patch.object(pa_dataset, "dataset", side_effect=AssertionError("No Arrow scan")), \
         patch.object(pq, "read_table", side_effect=AssertionError("No full-file read")), \
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


def test_blob_csv_queries_preserve_multiline_reviews_across_blocks(tmp_path, local_blob_loader):
    review = 'First line, with a comma\nSecond line with "quoted" text\r\n' + 'review text ' * 100
    rows = [{"game": "other", "review": review} for _ in range(2000)]
    rows.append({"game": "target", "review": review})
    path = tmp_path / "reviews.csv"
    pa_csv.write_csv(pa.Table.from_pylist(rows), path)
    assert path.stat().st_size > 2 * 1024 * 1024
    loader = local_blob_loader(path)
    source = "az://fixture/container/reviews.csv"

    assert loader._read_sample(source, 5)["review"].tolist() == [review] * 5
    result = loader.fetch_data_as_arrow(source, {"size": 1, "columns": ["review"],
        "source_filters": [{"column": "game", "operator": "EQ", "value": "target"}]})
    assert result.to_pylist() == [{"review": review}]
    probe = loader.probe([source], {"aggregates": [{"op": "count", "as": "reviews"}], "limit": 1})
    assert probe["rows"] == [{"reviews": 2001}]
    assert probe["exact"] is True


@pytest.mark.parametrize("extension", ["csv", "parquet", "jsonl"])
def test_blob_repeated_preview_closes_partially_consumed_file_scan(tmp_path, extension, local_blob_loader):
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
    loader = local_blob_loader(path)

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


def test_blob_small_sample_uses_native_csv_limit(tmp_path, local_blob_loader):
    path = tmp_path / "reviews.csv"
    pa_csv.write_csv(pa.table({"value": list(range(30000))}), path)
    loader = local_blob_loader(path)
    with patch.object(pa_dataset, "dataset", side_effect=AssertionError("No Arrow scan")):
        assert loader._read_sample("az://fixture/reviews.csv", 5)["value"].tolist() == list(range(5))


def test_blob_metadata_resolves_canonical_reference_url():
    loader = object.__new__(AzureBlobDataLoader)
    loader.preview_data = Mock(return_value={"columns": [{"name": "review", "type": "string"}],
        "rows": [{"review": "sample"}], "inspection": {"schema_source": "inferred"}})
    loader._estimate_row_count = Mock(side_effect=AssertionError("No count scan for metadata"))
    source = "az://account.blob.core.windows.net/container/nested/reviews.csv"
    metadata = loader.get_metadata([source])
    assert metadata["columns"] == [{"name": "review", "type": "string"}]
    assert metadata["sample_rows"] == [{"review": "sample"}]
    assert "row_count" not in metadata
    loader.preview_data.assert_called_once_with(source, purpose="agent")
    loader._estimate_row_count.assert_not_called()


def test_blob_parquet_metadata_uses_footer_count(tmp_path, local_blob_loader):
    path = tmp_path / "events.parquet"
    pq.write_table(pa.table({"value": list(range(20))}), path)
    loader = local_blob_loader(path)
    loader._read_sample = Mock(side_effect=AssertionError("Metadata must not sample Parquet"))
    metadata = loader.get_metadata(["az://account/container/events.parquet"])
    assert metadata["row_count"] == 20
    assert metadata["columns"] == [{"name": "value", "type": "int64"}]
    assert metadata["inspection"]["sample_status"] == "not_requested"
    assert "sample_rows" not in metadata


@pytest.mark.parametrize("endpoint", ["http://example.com", "https://example.com/container",
    "https://user:password@example.com", "https://example.com?sig=secret", "https://example.com/#fragment"])
def test_blob_endpoint_rejects_non_account_urls(endpoint):
    with pytest.raises(ValueError, match="Blob endpoint must"):
        AzureBlobDataLoader({"account_name": "account", "container_name": "container", "endpoint": endpoint})