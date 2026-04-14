# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""ConnectedDataSource — generic lifecycle wrapper for ExternalDataLoader.

Takes any ``ExternalDataLoader`` class and auto-generates a Flask Blueprint
with auth / catalog / data routes.  No per-source code needed.

Usage::

    from data_formulator.connected_source import ConnectedDataSource

    plugin = ConnectedDataSource.from_loader(
        PostgreSQLDataLoader,
        source_id="pg_prod",
        display_name="Production DB",
        default_params={"host": "db.corp", "database": "prod"},
    )
    app.register_blueprint(plugin.create_blueprint())
"""

import dataclasses
import json as _json
import logging
from typing import Any

from flask import Blueprint, Flask, jsonify, request

from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
)
from data_formulator.plugins.base import DataSourcePlugin

logger = logging.getLogger(__name__)

# Registry of enabled ConnectedDataSource instances (populated at startup).
CONNECTED_SOURCES: dict[str, "ConnectedDataSource"] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_error(error: Exception) -> tuple[str, int]:
    """Return a safe error message + HTTP status code.

    Never leaks internal details to the client.
    """
    logger.error("ConnectedDataSource error", exc_info=error)
    msg = str(error).lower()
    if "required" in msg or "invalid" in msg:
        return "Invalid connection parameters", 400
    if "permission" in msg or "access" in msg:
        return "Access denied", 403
    if "connect" in msg or "refused" in msg:
        return "Connection failed", 502
    return "An unexpected error occurred", 500


def _node_to_dict(node: CatalogNode) -> dict[str, Any]:
    return {
        "name": node.name,
        "node_type": node.node_type,
        "path": node.path,
        "metadata": node.metadata,
    }


def _hierarchy_dicts(levels: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{"key": l["key"], "label": l["label"]} for l in levels]


# ---------------------------------------------------------------------------
# ConnectedDataSource
# ---------------------------------------------------------------------------

class ConnectedDataSource(DataSourcePlugin):
    """A DataSourcePlugin auto-generated from an ExternalDataLoader.

    Provides:
    - **Auth routes**: connect / disconnect / status
    - **Catalog routes**: ls / metadata
    - **Data routes**: import / refresh / preview

    All driven by the underlying loader's existing methods.
    """

    def __init__(
        self,
        loader_class: type[ExternalDataLoader],
        source_id: str,
        display_name: str | None = None,
        default_params: dict[str, Any] | None = None,
        icon: str | None = None,
    ) -> None:
        self._loader_class = loader_class
        self._source_id = source_id
        self._display_name = display_name or source_id
        self._default_params = default_params or {}
        self._icon = icon or source_id

        # Per-identity loader instances: identity_id → ExternalDataLoader
        # In-process cache; cleared on disconnect.
        self._loaders: dict[str, ExternalDataLoader] = {}

    # -- Factory -----------------------------------------------------------

    @classmethod
    def from_loader(
        cls,
        loader_class: type[ExternalDataLoader],
        source_id: str,
        display_name: str | None = None,
        default_params: dict[str, Any] | None = None,
        icon: str | None = None,
    ) -> "ConnectedDataSource":
        return cls(
            loader_class=loader_class,
            source_id=source_id,
            display_name=display_name,
            default_params=default_params,
            icon=icon,
        )

    # -- DataSourcePlugin interface ----------------------------------------

    @staticmethod
    def manifest() -> dict[str, Any]:
        # Static stub; per-instance config is in _manifest().
        return {}

    def _manifest(self) -> dict[str, Any]:
        return {
            "id": self._source_id,
            "name": self._display_name,
            "icon": self._icon,
            "env_prefix": f"DF_{self._source_id.upper()}",
            "required_env": [],
            "auth_modes": [self._loader_class.auth_mode()],
            "capabilities": ["tables", "catalog", "refresh"],
        }

    def get_frontend_config(self) -> dict[str, Any]:
        all_params = self._loader_class.list_params()
        form_fields: list[dict] = []
        pinned_params: dict[str, Any] = {}

        for param in all_params:
            if param["name"] in self._default_params:
                pinned_params[param["name"]] = self._default_params[param["name"]]
            else:
                form_fields.append(param)

        full_hierarchy = self._loader_class.catalog_hierarchy()
        effective = [
            level for level in full_hierarchy
            if not self._default_params.get(level["key"])
        ]

        return {
            "source_id": self._source_id,
            "source_type": self._source_id,
            "name": self._display_name,
            "icon": self._icon,
            "params_form": form_fields,
            "pinned_params": pinned_params,
            "hierarchy": _hierarchy_dicts(full_hierarchy),
            "effective_hierarchy": _hierarchy_dicts(effective),
            "auth_instructions": self._loader_class.auth_instructions(),
        }

    def create_blueprint(self) -> Blueprint:
        bp = Blueprint(
            f"source_{self._source_id}",
            __name__,
            url_prefix=f"/api/sources/{self._source_id}",
        )
        self._register_auth_routes(bp)
        self._register_catalog_routes(bp)
        self._register_data_routes(bp)
        return bp

    def on_enable(self, app: Flask) -> None:
        logger.info("ConnectedDataSource '%s' enabled", self._source_id)

    # -- Identity + Loader Management --------------------------------------

    @staticmethod
    def _get_identity() -> str:
        from data_formulator.security.auth import get_identity_id
        return get_identity_id()

    def _get_loader(self, identity: str | None = None) -> ExternalDataLoader | None:
        identity = identity or self._get_identity()
        return self._loaders.get(identity)

    def _connect(self, user_params: dict[str, Any]) -> ExternalDataLoader:
        """Instantiate a loader with merged params (default + user)."""
        merged = {**self._default_params, **user_params}
        loader = self._loader_class(merged)
        identity = self._get_identity()
        self._loaders[identity] = loader
        return loader

    def _disconnect(self) -> None:
        identity = self._get_identity()
        self._loaders.pop(identity, None)

    def _require_loader(self) -> ExternalDataLoader:
        loader = self._get_loader()
        if loader is None:
            raise ValueError("Not connected. Please connect first.")
        return loader

    # -- Auth Routes -------------------------------------------------------

    def _register_auth_routes(self, bp: Blueprint) -> None:
        source = self

        @bp.route("/auth/connect", methods=["POST"])
        def auth_connect():
            try:
                data = request.get_json() or {}
                user_params = data.get("params", {})
                loader = source._connect(user_params)

                if not loader.test_connection():
                    source._disconnect()
                    return jsonify({"status": "error", "message": "Connection test failed"}), 400

                safe = loader.get_safe_params()
                return jsonify({
                    "status": "connected",
                    "params": safe,
                    "hierarchy": _hierarchy_dicts(loader.catalog_hierarchy()),
                    "effective_hierarchy": _hierarchy_dicts(loader.effective_hierarchy()),
                    "pinned_scope": loader.pinned_scope(),
                })
            except Exception as e:
                source._disconnect()
                safe_msg, status_code = _sanitize_error(e)
                return jsonify({"status": "error", "message": safe_msg}), status_code

        @bp.route("/auth/disconnect", methods=["POST"])
        def auth_disconnect():
            source._disconnect()
            return jsonify({"status": "disconnected"})

        @bp.route("/auth/status", methods=["GET"])
        def auth_status():
            loader = source._get_loader()
            if loader is None:
                return jsonify({
                    "connected": False,
                    "params_form": source.get_frontend_config()["params_form"],
                })
            try:
                alive = loader.test_connection()
            except Exception:
                alive = False
            if not alive:
                source._disconnect()
                return jsonify({
                    "connected": False,
                    "params_form": source.get_frontend_config()["params_form"],
                })
            return jsonify({
                "connected": True,
                "params": loader.get_safe_params(),
                "hierarchy": _hierarchy_dicts(loader.catalog_hierarchy()),
                "effective_hierarchy": _hierarchy_dicts(loader.effective_hierarchy()),
                "pinned_scope": loader.pinned_scope(),
            })

    # -- Catalog Routes ----------------------------------------------------

    def _register_catalog_routes(self, bp: Blueprint) -> None:
        source = self

        @bp.route("/catalog/ls", methods=["POST"])
        def catalog_ls():
            try:
                loader = source._require_loader()
                data = request.get_json() or {}
                path = data.get("path", [])
                name_filter = data.get("filter")

                nodes = loader.ls(path=path, filter=name_filter)
                return jsonify({
                    "hierarchy": _hierarchy_dicts(loader.catalog_hierarchy()),
                    "effective_hierarchy": _hierarchy_dicts(loader.effective_hierarchy()),
                    "path": path,
                    "nodes": [_node_to_dict(n) for n in nodes],
                })
            except Exception as e:
                safe_msg, status_code = _sanitize_error(e)
                return jsonify({"status": "error", "message": safe_msg}), status_code

        @bp.route("/catalog/metadata", methods=["POST"])
        def catalog_metadata():
            try:
                loader = source._require_loader()
                data = request.get_json() or {}
                path = data.get("path", [])

                metadata = loader.get_metadata(path)
                return jsonify({"path": path, "metadata": metadata})
            except Exception as e:
                safe_msg, status_code = _sanitize_error(e)
                return jsonify({"status": "error", "message": safe_msg}), status_code

        @bp.route("/catalog/list_tables", methods=["POST"])
        def catalog_list_tables():
            """Flat/eager listing of all tables in pinned scope."""
            try:
                loader = source._require_loader()
                data = request.get_json() or {}
                table_filter = data.get("filter")

                tables = loader.list_tables(table_filter=table_filter)
                return jsonify({"tables": tables})
            except Exception as e:
                safe_msg, status_code = _sanitize_error(e)
                return jsonify({"status": "error", "message": safe_msg}), status_code

    # -- Data Routes -------------------------------------------------------

    def _register_data_routes(self, bp: Blueprint) -> None:
        source = self

        @bp.route("/data/import", methods=["POST"])
        def data_import():
            try:
                loader = source._require_loader()
                data = request.get_json() or {}

                source_table = data.get("source_table")
                if not source_table:
                    return jsonify({"status": "error", "message": "source_table is required"}), 400

                table_name = data.get("table_name")
                import_options = data.get("import_options", {})

                from data_formulator.security.auth import get_identity_id
                from data_formulator.workspace_factory import get_workspace
                from data_formulator.datalake.parquet_utils import sanitize_table_name

                workspace = get_workspace(get_identity_id())

                if not table_name:
                    raw = source_table.split(".")[-1] if "." in source_table else source_table
                    table_name = raw
                safe_name = sanitize_table_name(table_name)

                meta = loader.ingest_to_workspace(
                    workspace=workspace,
                    table_name=safe_name,
                    source_table=source_table,
                    import_options=import_options or None,
                )
                return jsonify({
                    "status": "success",
                    "table_name": meta.name,
                    "row_count": meta.row_count,
                    "refreshable": True,
                })
            except Exception as e:
                safe_msg, status_code = _sanitize_error(e)
                return jsonify({"status": "error", "message": safe_msg}), status_code

        @bp.route("/data/refresh", methods=["POST"])
        def data_refresh():
            try:
                loader = source._require_loader()
                data = request.get_json() or {}
                table_name = data.get("table_name")
                if not table_name:
                    return jsonify({"status": "error", "message": "table_name is required"}), 400

                from data_formulator.security.auth import get_identity_id
                from data_formulator.workspace_factory import get_workspace

                workspace = get_workspace(get_identity_id())
                meta = workspace.get_table_metadata(table_name)
                if meta is None or not meta.source_table:
                    return jsonify({"status": "error", "message": f"No refreshable source for '{table_name}'"}), 400

                arrow_table = loader.fetch_data_as_arrow(
                    source_table=meta.source_table,
                    import_options=meta.import_options,
                )
                new_meta, data_changed = workspace.refresh_parquet_from_arrow(table_name, arrow_table)
                return jsonify({
                    "status": "success",
                    "table_name": table_name,
                    "row_count": new_meta.row_count,
                    "data_changed": data_changed,
                })
            except Exception as e:
                safe_msg, status_code = _sanitize_error(e)
                return jsonify({"status": "error", "message": safe_msg}), status_code

        @bp.route("/data/preview", methods=["POST"])
        def data_preview():
            try:
                loader = source._require_loader()
                data = request.get_json() or {}
                source_table = data.get("source_table")
                if not source_table:
                    return jsonify({"status": "error", "message": "source_table is required"}), 400

                size = data.get("size", 10)
                arrow_table = loader.fetch_data_as_arrow(
                    source_table=source_table,
                    import_options={"size": size},
                )
                df = arrow_table.to_pandas()
                rows = _json.loads(df.to_json(orient="records", date_format="iso"))
                columns = [{"name": col, "type": str(df[col].dtype)} for col in df.columns]

                return jsonify({
                    "status": "success",
                    "columns": columns,
                    "rows": rows,
                    "row_count": len(rows),
                })
            except Exception as e:
                safe_msg, status_code = _sanitize_error(e)
                return jsonify({"status": "error", "message": safe_msg}), status_code


# ---------------------------------------------------------------------------
# Configuration loading
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class SourceSpec:
    """A single data source entry from config (YAML, env vars, or auto-discovery)."""
    source_id: str
    loader_type: str          # registry key in DATA_LOADERS (e.g. "postgresql")
    display_name: str
    default_params: dict[str, Any] = dataclasses.field(default_factory=dict)
    icon: str = ""
    auto_connect: bool = False


def _resolve_env_refs(params: dict[str, Any]) -> dict[str, Any]:
    """Resolve ``${ENV_VAR}`` references in param values."""
    import os
    resolved = {}
    for k, v in params.items():
        if isinstance(v, str) and v.startswith("${") and v.endswith("}"):
            env_name = v[2:-1]
            resolved[k] = os.environ.get(env_name, "")
        else:
            resolved[k] = v
    return resolved


def _load_yaml_config() -> dict | None:
    """Search for ``data-sources.yml`` in standard locations and return parsed content."""
    import os
    from pathlib import Path

    search_paths = [
        Path.cwd() / "data-sources.yml",
        Path.home() / ".data-formulator" / "data-sources.yml",
        Path("/etc/data-formulator/data-sources.yml"),
    ]
    # Also check DATA_FORMULATOR_HOME
    df_home = os.environ.get("DATA_FORMULATOR_HOME")
    if df_home:
        search_paths.insert(0, Path(df_home) / "data-sources.yml")

    for p in search_paths:
        if p.is_file():
            try:
                import yaml
                with open(p) as f:
                    data = yaml.safe_load(f)
                logger.info("Loaded data source config from %s", p)
                return data
            except Exception as e:
                logger.warning("Failed to parse %s: %s", p, e)
    return None


def _parse_env_sources() -> list[SourceSpec]:
    """Parse ``DF_SOURCES__<id>__<key>=<value>`` environment variables."""
    import os
    prefix = "DF_SOURCES__"
    # Collect: {instance_id: {key: value}}
    raw: dict[str, dict[str, str]] = {}
    for env_key, env_val in os.environ.items():
        if not env_key.startswith(prefix):
            continue
        rest = env_key[len(prefix):]
        parts = rest.split("__", 1)
        if len(parts) != 2:
            continue
        instance_id, field = parts[0], parts[1].lower()
        raw.setdefault(instance_id, {})[field] = env_val

    specs = []
    for instance_id, fields in raw.items():
        loader_type = fields.pop("type", "")
        if not loader_type:
            logger.warning("DF_SOURCES__%s has no 'type' field, skipping", instance_id)
            continue
        name = fields.pop("name", loader_type.replace("_", " ").title())
        icon = fields.pop("icon", "")
        # Remaining fields with "params__" prefix → params dict
        params: dict[str, str] = {}
        other: dict[str, str] = {}
        for k, v in fields.items():
            if k.startswith("params__"):
                params[k[len("params__"):]] = v
            else:
                other[k] = v
        # Also treat top-level non-reserved keys as params
        params.update(other)
        specs.append(SourceSpec(
            source_id=instance_id,
            loader_type=loader_type,
            display_name=name,
            default_params=params,
            icon=icon,
        ))
    return specs


def _build_source_specs() -> tuple[list[SourceSpec], bool]:
    """Build the list of source specs from config (env + YAML + auto-discovery).

    Returns ``(specs, auto_discover)`` where ``auto_discover`` indicates
    whether unconfigured loaders should also be registered.
    """
    import os
    from data_formulator.data_loader import DATA_LOADERS

    # 1. Env vars (highest priority)
    env_specs = _parse_env_sources()

    # 2. YAML config
    yaml_config = _load_yaml_config()
    yaml_specs: list[SourceSpec] = []
    auto_discover = True
    if yaml_config:
        auto_discover = yaml_config.get("auto_discover", True)
        for i, entry in enumerate(yaml_config.get("sources", [])):
            loader_type = entry.get("type", "")
            if not loader_type:
                continue
            sid = entry.get("id") or f"{loader_type}_{i}" if i > 0 else loader_type
            yaml_specs.append(SourceSpec(
                source_id=sid,
                loader_type=loader_type,
                display_name=entry.get("name", loader_type.replace("_", " ").title()),
                default_params=_resolve_env_refs(entry.get("params", {})),
                icon=entry.get("icon", ""),
                auto_connect=entry.get("auto_connect", False),
            ))

    # Also respect DF_AUTO_DISCOVER_SOURCES env var
    if os.environ.get("DF_AUTO_DISCOVER_SOURCES", "").lower() == "false":
        auto_discover = False

    # Merge: env specs override yaml specs with same source_id
    env_ids = {s.source_id for s in env_specs}
    merged = list(env_specs) + [s for s in yaml_specs if s.source_id not in env_ids]

    # 3. Auto-discovery: add any installed loader not already configured
    if auto_discover:
        configured_types = {s.loader_type for s in merged}
        for key in DATA_LOADERS:
            if key not in configured_types:
                merged.append(SourceSpec(
                    source_id=key,
                    loader_type=key,
                    display_name=key.replace("_", " ").title(),
                ))

    return merged, auto_discover


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_connected_sources(app: Flask) -> None:
    """Register ConnectedDataSource plugins from config + auto-discovery.

    Called from ``app.py`` during startup.
    """
    from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS

    specs, _auto_discover = _build_source_specs()

    for spec in specs:
        loader_class = DATA_LOADERS.get(spec.loader_type)
        if not loader_class:
            if spec.loader_type in DISABLED_LOADERS:
                logger.info(
                    "Source '%s' (type=%s) not available: %s",
                    spec.source_id, spec.loader_type, DISABLED_LOADERS[spec.loader_type],
                )
            else:
                logger.warning("Unknown source type '%s' for '%s'", spec.loader_type, spec.source_id)
            continue

        source = ConnectedDataSource.from_loader(
            loader_class,
            source_id=spec.source_id,
            display_name=spec.display_name,
            default_params=spec.default_params,
            icon=spec.icon or spec.loader_type,
        )
        bp = source.create_blueprint()
        app.register_blueprint(bp)
        source.on_enable(app)
        CONNECTED_SOURCES[spec.source_id] = source
        logger.info(
            "Registered ConnectedDataSource '%s' (type=%s%s)",
            spec.source_id,
            spec.loader_type,
            f", pinned={list(spec.default_params.keys())}" if spec.default_params else "",
        )

    for key, reason in DISABLED_LOADERS.items():
        if key not in CONNECTED_SOURCES:
            logger.info("Source '%s' not available: %s", key, reason)
