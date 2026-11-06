from unittest.mock import Mock, patch

import pyarrow as pa
import pyarrow.csv as pa_csv
import pyarrow.dataset as pa_dataset
import pyarrow.parquet as pq
import pytest

from data_formulator.data_loader.s3_data_loader import S3DataLoader
from data_formulator.data_loader import probe_utils


@pytest.fixture
def loader():
    with patch("data_formulator.data_loader.s3_data_loader.pa_fs.S3FileSystem"):
        return S3DataLoader({"bucket": "fixture", "region_name": "us-west-2"})


@pytest.mark.parametrize("extension", ["parquet", "csv", "tsv", "json", "jsonl"])
def test_s3_import_filters_sorts_and_projects_before_limit(tmp_path, loader, extension):
    import json

    rows = [{"group": "other", "score": 100}, {"group": "target", "score": 2},
            {"group": "target", "score": 9}]
    path = tmp_path / f"reviews.{extension}"
    if extension == "parquet":
        pq.write_table(pa.Table.from_pylist(rows), path)
    elif extension in ("csv", "tsv"):
        pa_csv.write_csv(pa.Table.from_pylist(rows), path,
                         write_options=pa_csv.WriteOptions(delimiter="\t" if extension == "tsv" else ","))
    elif extension == "json":
        path.write_text(json.dumps(rows))
    else:
        path.write_text("\n".join(json.dumps(row) for row in rows))
    loader._register_source = lambda connection, source, **options: probe_utils.register_file_scan(connection, str(path), **options)
    with patch.object(pa_dataset, "dataset", side_effect=AssertionError("No Arrow scan")), \
         patch.object(pq, "read_table", side_effect=AssertionError("No whole-file materialization")):
        result = loader.fetch_data_as_arrow(path.name, {
            "size": 1, "columns": ["score"],
            "source_filters": [{"column": "group", "operator": "EQ", "value": "target"}],
            "sort_columns": ["score"], "sort_order": "desc",
        })
        assert result.to_pylist() == [{"score": 9}]
        probe = loader.probe([f"s3://fixture/{path.name}"], {
            "aggregates": [{"op": "sum", "column": "score", "as": "total"}], "limit": 1,
        })
        assert probe["rows"] == [{"total": 111}]
        assert probe["exact"] is True


@pytest.mark.parametrize("auth", ["keys", "ambient"])
def test_s3_native_scan_uses_temporary_parameterized_scoped_secret(loader, auth):
    if auth == "keys":
        loader.aws_access_key_id = "key'id"
        loader.aws_secret_access_key = "secret'value"
        loader.aws_session_token = "session'token"
    with patch("duckdb.connect") as connect, \
         patch.object(pa_dataset, "dataset", side_effect=AssertionError("No Arrow Parquet scan")):
        connection = connect.return_value.__enter__.return_value
        expected = pa.table({"value": [1]})
        connection.execute.return_value.fetch_arrow_table.return_value = expected
        assert loader.fetch_data_as_arrow("nested/reviews.parquet") is expected
        statement, values = connection.execute.call_args_list[0].args
        assert "CREATE SECRET" in statement and "PERSISTENT" not in statement
        assert "secret'value" not in statement
        assert values[-2:] == ["us-west-2", "s3://fixture/"]
        if auth == "keys":
            assert values[:3] == ["key'id", "secret'value", "session'token"]
        else:
            assert "PROVIDER credential_chain" in statement
        connection.read_parquet.assert_called_once_with(
            "s3://fixture/nested/reviews.parquet", hive_partitioning=False,
        )
        connection.read_parquet.return_value.create_view.assert_called_once_with("t")


def test_s3_catalog_is_paginated_and_metadata_only(loader):
    client = Mock()
    loader._s3_client = Mock(return_value=client)
    client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "first.parquet", "Size": 500}, {"Key": "folder/"}]},
        {"Contents": [{"Key": "nested/second.csv", "Size": 900}, {"Key": "notes.txt"}]},
    ]
    loader._read_sample_arrow = Mock(side_effect=AssertionError("Catalog must not read contents"))
    loader._estimate_row_count = Mock(side_effect=AssertionError("Catalog must not scan metadata"))
    tables = loader.list_tables()
    assert [table["name"] for table in tables] == ["s3://fixture/first.parquet", "s3://fixture/nested/second.csv"]
    assert tables[0]["metadata"] == {"size_bytes": 500}
    assert [node.name for node in loader.ls()] == ["first.parquet", "nested/second.csv"]
    assert loader.list_tables("SECOND") == [tables[1]]
    client.get_paginator.assert_called_with("list_objects_v2")
    client.get_paginator.return_value.paginate.assert_called_with(Bucket="fixture")


def test_s3_metadata_accepts_canonical_url(loader, tmp_path):
    from pyarrow import fs as pa_fs

    path = tmp_path / "reviews.parquet"
    pq.write_table(pa.table({"score": list(range(10))}), path)
    loader._read_sample_arrow = Mock(side_effect=AssertionError("Metadata must not sample Parquet"))
    source = "s3://fixture/nested/reviews.parquet"
    parquet_file = pq.ParquetFile
    with patch.object(pq, "ParquetFile", side_effect=lambda *args, **kwargs: parquet_file(path, filesystem=pa_fs.LocalFileSystem())) as opened:
        metadata = loader.get_metadata([source])
    assert metadata["row_count"] == 10
    assert metadata["columns"] == [{"name": "score", "type": "int64"}]
    assert "sample_rows" not in metadata
    opened.assert_called_once_with("fixture/nested/reviews.parquet", filesystem=loader.s3_fs)


def test_s3_rejects_foreign_bucket_and_invalid_filters(loader):
    with patch("duckdb.connect") as connect:
        with pytest.raises(ValueError, match="connected S3 bucket"):
            loader.fetch_data_as_arrow("s3://other/reviews.parquet")
        with pytest.raises(ValueError, match="Unsupported source filter"):
            loader.fetch_data_as_arrow("reviews.parquet", {"source_filters": [
                {"column": "score", "operator": "UNKNOWN", "value": 0},
            ]})
        connect.assert_not_called()


def test_s3_native_failure_does_not_fall_back(loader):
    with patch("duckdb.connect") as connect, patch.object(pa_dataset, "dataset") as dataset:
        connect.return_value.__enter__.return_value.execute.side_effect = RuntimeError("extension unavailable")
        with pytest.raises(RuntimeError, match="extension unavailable"):
            loader.fetch_data_as_arrow("reviews.parquet")
        dataset.assert_not_called()
        connect.return_value.__exit__.assert_called_once()