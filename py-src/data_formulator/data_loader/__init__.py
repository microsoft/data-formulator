import logging

from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.kusto_data_loader import KustoDataLoader
from data_formulator.data_loader.s3_data_loader import S3DataLoader
from data_formulator.data_loader.azure_blob_data_loader import AzureBlobDataLoader
from data_formulator.data_loader.mongodb_data_loader import MongoDBDataLoader
from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader
from data_formulator.data_loader.athena_data_loader import AthenaDataLoader

_log = logging.getLogger(__name__)

# --- Loaders that require connectorx (optional) ----------------------------
# These are conditionally imported because connectorx is a native Rust
# extension that may not be available on all deployment platforms.

_HAS_CONNECTORX = False
try:
    from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
    from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader
    from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader
    _HAS_CONNECTORX = True
except ImportError:
    MySQLDataLoader = None  # type: ignore[assignment,misc]
    MSSQLDataLoader = None  # type: ignore[assignment,misc]
    PostgreSQLDataLoader = None  # type: ignore[assignment,misc]
    _log.warning(
        "connectorx is not installed — MySQL, MSSQL and PostgreSQL data "
        "loaders are disabled.  Install connectorx to enable them."
    )

# --- Build registry ---------------------------------------------------------

DATA_LOADERS: dict[str, type[ExternalDataLoader]] = {
    "kusto": KustoDataLoader,
    "s3": S3DataLoader,
    "azure_blob": AzureBlobDataLoader,
    "mongodb": MongoDBDataLoader,
    "bigquery": BigQueryDataLoader,
    "athena": AthenaDataLoader,
}

if _HAS_CONNECTORX:
    DATA_LOADERS["mysql"] = MySQLDataLoader
    DATA_LOADERS["mssql"] = MSSQLDataLoader
    DATA_LOADERS["postgresql"] = PostgreSQLDataLoader

__all__ = [
    "ExternalDataLoader",
    "KustoDataLoader",
    "S3DataLoader",
    "AzureBlobDataLoader",
    "MongoDBDataLoader",
    "BigQueryDataLoader",
    "AthenaDataLoader",
    "DATA_LOADERS",
]

if _HAS_CONNECTORX:
    __all__ += ["MySQLDataLoader", "MSSQLDataLoader", "PostgreSQLDataLoader"]