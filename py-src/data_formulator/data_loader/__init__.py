"""
Modular data-loader registry.

Two loader sources:

1. **Built-in** — declared in ``_LOADER_SPECS`` (this file).  Each loader
   is independently imported via try/except so that a missing dependency
   only disables that one loader.

2. **External plugins** — Python files matching ``*_data_loader.py`` found
   in the directory pointed to by ``DF_PLUGIN_DIR`` (default:
   ``~/.data-formulator/plugins/``).  Any ``ExternalDataLoader`` subclass
   found in such a file is auto-registered.  If a plugin key collides with
   a built-in key the plugin wins (override).

``DATA_LOADERS``     — loaders that imported successfully.
``DISABLED_LOADERS`` — loaders that failed, with a human-readable install hint.
"""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import logging
import os
import sys
from pathlib import Path

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode

_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Declarative built-in loader specs
# (registry_key, module_path, class_name, pip_package)
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
    ("cosmosdb",   "data_formulator.data_loader.cosmosdb_data_loader",  "CosmosDBDataLoader",   "azure-cosmos"),
    ("bigquery",   "data_formulator.data_loader.bigquery_data_loader",   "BigQueryDataLoader",   "google-cloud-bigquery"),
    ("athena",     "data_formulator.data_loader.athena_data_loader",     "AthenaDataLoader",     "boto3"),
    ("superset",   "data_formulator.data_loader.superset_data_loader",   "SupersetLoader",       "requests"),
    ("local_folder", "data_formulator.data_loader.local_folder_data_loader", "LocalFolderDataLoader", "pyarrow"),
]

# ---------------------------------------------------------------------------
# Phase 1: load built-in loaders
# ---------------------------------------------------------------------------

DATA_LOADERS: dict[str, type[ExternalDataLoader]] = {}
DISABLED_LOADERS: dict[str, str] = {}  # key -> install instruction

def _scan_package_loaders() -> None:
    """Import built-in loaders from ``_LOADER_SPECS``."""
    for key, module_path, cls_name, pip_pkg in _LOADER_SPECS:
        try:
            mod = importlib.import_module(module_path)
            DATA_LOADERS[key] = getattr(mod, cls_name)
        except ImportError as exc:
            hint = f"pip install {pip_pkg}"
            DISABLED_LOADERS[key] = hint
            _log.info(
                "Data loader '%s' disabled (missing: %s). Install with: %s",
                key, exc.name, hint,
            )

_scan_package_loaders()

# ---------------------------------------------------------------------------
# Phase 2: scan external plugin directory
# ---------------------------------------------------------------------------

_DEFAULT_PLUGIN_DIR = str(Path.home() / ".data-formulator" / "plugins")
PLUGIN_DIR: str = os.environ.get("DF_PLUGIN_DIR", _DEFAULT_PLUGIN_DIR)


def _scan_plugin_dir() -> None:
    """Scan ``PLUGIN_DIR`` for ``*_data_loader.py`` files.

    Each file is loaded as a standalone module.  Every public class that
    subclasses ``ExternalDataLoader`` is registered.  The registry key is
    derived from the filename: ``my_custom_data_loader.py`` → ``my_custom``.

    Plugins override built-ins with the same key.
    """
    plugin_path = Path(PLUGIN_DIR)
    if not plugin_path.is_dir():
        return

    for py_file in sorted(plugin_path.glob("*_data_loader.py")):
        key = py_file.stem.removesuffix("_data_loader")
        module_name = f"df_plugin_{key}"
        try:
            spec = importlib.util.spec_from_file_location(module_name, py_file)
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = mod
            spec.loader.exec_module(mod)  # type: ignore[union-attr]

            found = False
            for name, obj in inspect.getmembers(mod, inspect.isclass):
                if (
                    issubclass(obj, ExternalDataLoader)
                    and obj is not ExternalDataLoader
                    and obj.__module__ == module_name
                ):
                    if key in DATA_LOADERS:
                        _log.info(
                            "Plugin '%s' overrides built-in loader '%s'",
                            py_file.name, key,
                        )
                    DATA_LOADERS[key] = obj
                    found = True
                    _log.info("Plugin loader '%s' registered from %s", key, py_file.name)
                    break  # one class per file

            if not found:
                _log.warning(
                    "Plugin file %s has no ExternalDataLoader subclass", py_file.name,
                )
        except Exception as exc:
            _log.warning("Failed to load plugin %s: %s", py_file.name, exc)

_scan_plugin_dir()

# ---------------------------------------------------------------------------
# Deployment restrictions
# ---------------------------------------------------------------------------

def _enforce_deployment_restrictions() -> None:
    """Disable local-only loaders in multi-user mode."""
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend != "local" and "local_folder" in DATA_LOADERS:
        del DATA_LOADERS["local_folder"]
        DISABLED_LOADERS["local_folder"] = (
            "local_folder connector is disabled in multi-user mode "
            "(WORKSPACE_BACKEND != 'local')"
        )
        _log.info("local_folder loader disabled: WORKSPACE_BACKEND=%s", backend)

_enforce_deployment_restrictions()

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_available_loaders() -> dict[str, type[ExternalDataLoader]]:
    """Return all registered loaders (built-in + plugins)."""
    return dict(DATA_LOADERS)

__all__ = [
    "ExternalDataLoader",
    "CatalogNode",
    "DATA_LOADERS",
    "DISABLED_LOADERS",
    "PLUGIN_DIR",
    "get_available_loaders",
]
