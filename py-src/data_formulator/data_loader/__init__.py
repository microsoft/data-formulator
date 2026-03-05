"""
Modular data-loader registry.

Each loader is independently imported via try/except so that a missing
dependency only disables that one loader instead of crashing the whole
application.  All loader deps are included in the default install; the
safety net here catches edge cases (broken native packages, minimal
environments, cross-platform deploy issues, etc.).

``DATA_LOADERS``  — loaders that imported successfully.
``DISABLED_LOADERS`` — loaders that failed, with a human-readable install hint.
"""

import importlib
import logging

from data_formulator.data_loader.external_data_loader import ExternalDataLoader

_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Declarative loader specs: (registry_key, module_path, class_name, pip_package)
# To add a new loader, just append a tuple here.
# ---------------------------------------------------------------------------
_LOADER_SPECS: list[tuple[str, str, str, str]] = [
    ("mysql",      "data_formulator.data_loader.mysql_data_loader",      "MySQLDataLoader",      "pymysql"),
    ("mssql",      "data_formulator.data_loader.mssql_data_loader",      "MSSQLDataLoader",      "pyodbc"),
    ("postgresql", "data_formulator.data_loader.postgresql_data_loader",  "PostgreSQLDataLoader", "psycopg2-binary"),
    ("kusto",      "data_formulator.data_loader.kusto_data_loader",      "KustoDataLoader",      "azure-kusto-data"),
    ("s3",         "data_formulator.data_loader.s3_data_loader",         "S3DataLoader",         "boto3"),
    ("azure_blob", "data_formulator.data_loader.azure_blob_data_loader", "AzureBlobDataLoader",  "azure-storage-blob"),
    ("mongodb",    "data_formulator.data_loader.mongodb_data_loader",    "MongoDBDataLoader",    "pymongo"),
    ("bigquery",   "data_formulator.data_loader.bigquery_data_loader",   "BigQueryDataLoader",   "google-cloud-bigquery"),
    ("athena",     "data_formulator.data_loader.athena_data_loader",     "AthenaDataLoader",     "boto3"),
]

# ---------------------------------------------------------------------------
# Build registries
# ---------------------------------------------------------------------------

DATA_LOADERS: dict[str, type[ExternalDataLoader]] = {}
DISABLED_LOADERS: dict[str, str] = {}  # key -> install instruction

for _key, _module_path, _cls_name, _pip_pkg in _LOADER_SPECS:
    try:
        _mod = importlib.import_module(_module_path)
        DATA_LOADERS[_key] = getattr(_mod, _cls_name)
    except ImportError as exc:
        _install_hint = f"pip install {_pip_pkg}"
        DISABLED_LOADERS[_key] = _install_hint
        _log.info(
            "Data loader '%s' disabled (missing: %s). Install with: %s",
            _key, exc.name, _install_hint,
        )

__all__ = ["ExternalDataLoader", "DATA_LOADERS", "DISABLED_LOADERS"]