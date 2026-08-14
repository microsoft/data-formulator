from unittest.mock import patch

import pytest

from data_formulator.data_loader.athena_data_loader import AthenaDataLoader
from data_formulator.data_loader.azure_blob_data_loader import AzureBlobDataLoader
from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader
from data_formulator.data_loader.external_data_loader import ConnectorParamError
from data_formulator.data_loader.mongodb_data_loader import MongoDBDataLoader
from data_formulator.data_loader.s3_data_loader import S3DataLoader
from data_formulator.data_loader.superset_data_loader import SupersetLoader

pytestmark = pytest.mark.backend


def _paths(loader):
    return {path["id"]: path for path in loader.auth_paths()}


@pytest.mark.parametrize(
    ("loader", "expected"),
    [
        (S3DataLoader, {"access_keys", "default_credentials"}),
        (AzureBlobDataLoader, {"azure_identity", "sas_token", "connection_string", "account_key"}),
        (MongoDBDataLoader, {"none", "credentials"}),
        (BigQueryDataLoader, {"default_credentials", "service_account_file"}),
        (AthenaDataLoader, {"profile", "access_keys"}),
    ],
)
def test_multi_auth_loaders_expose_expected_paths(loader, expected):
    paths = _paths(loader)
    assert set(paths) == expected
    assert sum(bool(path.get("default")) for path in paths.values()) == 1


@pytest.mark.parametrize("loader", [
    S3DataLoader,
    AzureBlobDataLoader,
    MongoDBDataLoader,
    BigQueryDataLoader,
    AthenaDataLoader,
])
def test_auth_path_fields_do_not_overlap(loader):
    field_sets = [set(path["fields"]) for path in loader.auth_paths()]
    for index, fields in enumerate(field_sets):
        for other in field_sets[index + 1:]:
            assert fields.isdisjoint(other)


def test_s3_default_credentials_do_not_require_access_keys():
    params = {
        "_auth_path": "default_credentials",
        "region_name": "us-east-1",
        "bucket": "example",
    }
    S3DataLoader.validate_params(params)


def test_s3_access_key_path_requires_both_keys():
    params = {
        "_auth_path": "access_keys",
        "region_name": "us-east-1",
        "bucket": "example",
        "aws_access_key_id": "key",
    }
    with pytest.raises(ConnectorParamError) as error:
        S3DataLoader.validate_params(params)
    assert error.value.missing == ["aws_secret_access_key"]


def test_superset_only_exposes_sso_when_configured():
    with patch.dict("os.environ", {}, clear=True):
        assert set(_paths(SupersetLoader)) == {"credentials"}
    with patch.dict("os.environ", {"PLG_SUPERSET_URL": "https://bi.example.com"}, clear=True):
        paths = _paths(SupersetLoader)
        assert set(paths) == {"sso", "credentials"}
        assert paths["sso"]["fields"] == []
        assert paths["credentials"]["fields"] == ["username", "password"]