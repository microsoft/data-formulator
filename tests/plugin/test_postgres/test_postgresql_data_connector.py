# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""End-to-end integration tests for PostgreSQL via DataConnector routes.

Tests the full lifecycle: connect → browse hierarchy → scope pinning →
import → preview → refresh → disconnect → reconnect.

Requires PostgreSQL running (e.g. ./tests/run_test_dbs.sh start postgres).
Environment: PG_HOST, PG_PORT (default 5433), PG_USER, PG_PASSWORD, PG_DATABASE.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch

import flask
import pytest

pytestmark = [pytest.mark.backend, pytest.mark.plugin]

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def get_pg_config() -> Dict[str, Any]:
    return {
        "host": os.getenv("PG_HOST", "localhost"),
        "port": os.getenv("PG_PORT", "5433"),
        "user": os.getenv("PG_USER", "postgres"),
        "password": os.getenv("PG_PASSWORD", "postgres"),
        "database": os.getenv("PG_DATABASE", "testdb"),
    }


def postgres_available() -> bool:
    import socket
    cfg = get_pg_config()
    host = cfg.get("host", "localhost")
    port = int(cfg.get("port", "5433"))
    if host in ("localhost", "127.0.0.1"):
        host = "127.0.0.1"
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect((host, port))
        sock.close()
        return True
    except (socket.error, OSError):
        return False


def _make_app_and_client(source_id="postgresql", default_params=None):
    """Create a Flask test app with DataConnector for PostgreSQL."""
    from data_formulator.data_connector import DataConnector, DATA_CONNECTORS
    from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "test-secret-key"

    source = DataConnector.from_loader(
        PostgreSQLDataLoader,
        source_id=source_id,
        display_name="Test PostgreSQL",
        default_params=default_params or {},
    )
    bp = source.create_blueprint()
    app.register_blueprint(bp)
    return app, app.test_client(), source


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

@unittest.skipUnless(
    postgres_available(),
    "PostgreSQL not available (start with ./tests/run_test_dbs.sh start postgres).",
)
class TestPostgreSQLConnectedSourceE2E(unittest.TestCase):
    """End-to-end tests: DataConnector routes → real PostgreSQL."""

    def setUp(self):
        self._workspace_root = None
        self._identity = "test-user-pg-e2e"

    def tearDown(self):
        if self._workspace_root and Path(self._workspace_root).exists():
            shutil.rmtree(self._workspace_root, ignore_errors=True)

    def _workspace_root_path(self):
        if self._workspace_root is None:
            self._workspace_root = tempfile.mkdtemp(prefix="df_test_pg_e2e_")
        return self._workspace_root

    # ==============================================================
    # Auth lifecycle
    # ==============================================================

    def test_connect_and_status(self):
        """Connect → status shows connected with hierarchy."""
        app, client, source = _make_app_and_client()
        cfg = get_pg_config()
        with patch.object(type(source), "_get_identity", return_value=self._identity):
            resp = client.post("/api/connectors/postgresql/auth/connect", json={
                "params": cfg,
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data["status"], "connected")
            self.assertIn("hierarchy", data)
            # PostgreSQL: database → schema → table
            keys = [h["key"] for h in data["hierarchy"]]
            self.assertEqual(keys, ["database", "schema", "table"])

            # Status should show connected
            resp = client.get("/api/connectors/postgresql/auth/status")
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(resp.get_json()["connected"])

    def test_connect_bad_credentials(self):
        """Bad credentials return error without leaking secrets."""
        app, client, source = _make_app_and_client()
        cfg = get_pg_config()
        cfg["password"] = "wrong-password-xyz"
        with patch.object(type(source), "_get_identity", return_value=self._identity):
            resp = client.post("/api/connectors/postgresql/auth/connect", json={
                "params": cfg,
            })
            self.assertIn(resp.status_code, (400, 500, 502))
            data = resp.get_json()
            self.assertEqual(data["status"], "error")
            # Must NOT leak the password
            import json
            self.assertNotIn("wrong-password-xyz", json.dumps(data))

    def test_disconnect_and_reconnect(self):
        app, client, source = _make_app_and_client()
        cfg = get_pg_config()
        with patch.object(type(source), "_get_identity", return_value=self._identity):
            # Connect
            client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})

            # Disconnect
            resp = client.post("/api/connectors/postgresql/auth/disconnect")
            self.assertEqual(resp.get_json()["status"], "disconnected")

            # Status shows disconnected
            resp = client.get("/api/connectors/postgresql/auth/status")
            self.assertFalse(resp.get_json()["connected"])

            # Reconnect
            resp = client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})
            self.assertEqual(resp.get_json()["status"], "connected")

    # ==============================================================
    # Catalog browsing — full hierarchy
    # ==============================================================

    def test_browse_full_hierarchy(self):
        """Connect without database pinned → browse database → schema → table."""
        cfg = get_pg_config()
        unpinned_cfg = {k: v for k, v in cfg.items() if k != "database"}
        app, client, source = _make_app_and_client(default_params={})

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            # Connect without database pinned
            client.post("/api/connectors/postgresql/auth/connect", json={"params": unpinned_cfg})

            # Level 1: list databases
            resp = client.post("/api/connectors/postgresql/catalog/ls", json={"path": []})
            data = resp.get_json()
            self.assertEqual(resp.status_code, 200)
            db_names = [n["name"] for n in data["nodes"]]
            self.assertIn("testdb", db_names)
            for node in data["nodes"]:
                self.assertEqual(node["node_type"], "namespace")

            # Level 2: list schemas in testdb
            resp = client.post("/api/connectors/postgresql/catalog/ls", json={"path": ["testdb"]})
            schemas = resp.get_json()["nodes"]
            schema_names = [s["name"] for s in schemas]
            self.assertIn("sample", schema_names)
            self.assertIn("public", schema_names)

            # Level 3: list tables in sample schema
            resp = client.post("/api/connectors/postgresql/catalog/ls", json={
                "path": ["testdb", "sample"],
            })
            tables = resp.get_json()["nodes"]
            table_names = [t["name"] for t in tables]
            self.assertIn("products", table_names)
            self.assertIn("customers", table_names)
            for t in tables:
                self.assertEqual(t["node_type"], "table")

    # ==============================================================
    # Catalog browsing — scope pinning
    # ==============================================================

    def test_scope_pinning_database(self):
        """Connect with database pinned → ls([]) starts at schema level."""
        cfg = get_pg_config()
        app, client, source = _make_app_and_client(
            default_params={"host": cfg["host"], "port": cfg["port"], "database": cfg["database"]},
        )

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/postgresql/auth/connect", json={
                "params": {"user": cfg["user"], "password": cfg["password"]},
            })

            # Connect response should show pinned scope
            resp = client.get("/api/connectors/postgresql/auth/status")
            status = resp.get_json()
            eff_keys = [h["key"] for h in status["effective_hierarchy"]]
            self.assertNotIn("database", eff_keys)
            self.assertIn("schema", eff_keys)
            self.assertEqual(status["pinned_scope"]["database"], cfg["database"])

            # ls([]) should show schemas, not databases
            resp = client.post("/api/connectors/postgresql/catalog/ls", json={"path": []})
            nodes = resp.get_json()["nodes"]
            self.assertTrue(len(nodes) > 0)
            # These should be schemas (namespace) not databases
            for n in nodes:
                self.assertEqual(n["node_type"], "namespace")
            names = [n["name"] for n in nodes]
            self.assertIn("sample", names)

    # ==============================================================
    # Catalog metadata
    # ==============================================================

    def test_table_metadata(self):
        cfg = get_pg_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/postgresql/catalog/metadata", json={
                "path": ["sample", "products"],
            })
            data = resp.get_json()
            self.assertEqual(resp.status_code, 200)
            meta = data["metadata"]
            self.assertIn("columns", meta)
            col_names = [c["name"] for c in meta["columns"]]
            self.assertIn("name", col_names)
            self.assertIn("price", col_names)
            self.assertIn("category", col_names)

    # ==============================================================
    # Flat list_tables
    # ==============================================================

    def test_list_tables_flat(self):
        cfg = get_pg_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/postgresql/catalog/list_tables", json={})
            data = resp.get_json()
            self.assertEqual(resp.status_code, 200)
            names = [t["name"] for t in data["tables"]]
            self.assertTrue(any("products" in n for n in names))

    def test_list_tables_with_filter(self):
        cfg = get_pg_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/postgresql/catalog/list_tables", json={
                "filter": "product",
            })
            tables = resp.get_json()["tables"]
            for t in tables:
                self.assertIn("product", t["name"].lower())

    # ==============================================================
    # Data preview
    # ==============================================================

    def test_preview(self):
        cfg = get_pg_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/postgresql/data/preview", json={
                "source_table": "sample.products",
                "size": 5,
            })
            data = resp.get_json()
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(data["status"], "success")
            self.assertLessEqual(data["row_count"], 5)
            col_names = {c["name"] for c in data["columns"]}
            self.assertIn("name", col_names)
            self.assertIn("price", col_names)

    # ==============================================================
    # Data import + refresh
    # ==============================================================

    def test_import_and_refresh(self):
        """Import a table via connected source routes, then refresh it."""
        cfg = get_pg_config()
        app, client, source = _make_app_and_client()
        workspace_root = self._workspace_root_path()

        from data_formulator.datalake.workspace import Workspace
        workspace = Workspace(self._identity, root_dir=workspace_root)

        with patch.object(type(source), "_get_identity", return_value=self._identity), \
             patch("data_formulator.data_connector.get_identity_id", return_value=self._identity), \
             patch("data_formulator.data_connector.get_workspace", return_value=workspace):
            # Connect
            client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})

            # Import
            resp = client.post("/api/connectors/postgresql/data/import", json={
                "source_table": "sample.products",
                "table_name": "products",
                "import_options": {"size": 100},
            })
            data = resp.get_json()
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["table_name"], "products")
            self.assertGreater(data["row_count"], 0)
            self.assertTrue(data["refreshable"])

            # Verify table exists in workspace
            self.assertIn("products", workspace.list_tables())

            # Refresh
            resp = client.post("/api/connectors/postgresql/data/refresh", json={
                "table_name": "products",
            })
            data = resp.get_json()
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(data["status"], "success")
            self.assertIn("data_changed", data)

    # ==============================================================
    # ls() filter
    # ==============================================================

    def test_ls_filter(self):
        cfg = get_pg_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/postgresql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/postgresql/catalog/ls", json={
                "path": ["sample"],
                "filter": "product",
            })
            nodes = resp.get_json()["nodes"]
            for n in nodes:
                self.assertIn("product", n["name"].lower())

    # ==============================================================
    # Operations without connection return error
    # ==============================================================

    def test_ls_without_connect_returns_error(self):
        app, client, source = _make_app_and_client()
        with patch.object(type(source), "_get_identity", return_value="nobody"):
            resp = client.post("/api/connectors/postgresql/catalog/ls", json={"path": []})
        self.assertIn(resp.status_code, (400, 500))

    def test_import_without_connect_returns_error(self):
        app, client, source = _make_app_and_client()
        with patch.object(type(source), "_get_identity", return_value="nobody"):
            resp = client.post("/api/connectors/postgresql/data/import", json={
                "source_table": "sample.products",
            })
        self.assertIn(resp.status_code, (400, 500))


# ------------------------------------------------------------------
# Static tests (no DB required)
# ------------------------------------------------------------------

class TestPostgreSQLConnectedSourceStatic(unittest.TestCase):

    def test_frontend_config(self):
        from data_formulator.data_connector import DataConnector
        from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader

        source = DataConnector.from_loader(
            PostgreSQLDataLoader,
            source_id="pg_test",
            display_name="PG Test",
            default_params={"host": "db.corp", "database": "prod"},
        )
        cfg = source.get_frontend_config()

        # Pinned params should show host and database
        self.assertEqual(cfg["pinned_params"]["host"], "db.corp")
        self.assertEqual(cfg["pinned_params"]["database"], "prod")

        # Form should not include pinned params
        form_names = {f["name"] for f in cfg["params_form"]}
        self.assertNotIn("host", form_names)
        self.assertNotIn("database", form_names)
        self.assertIn("user", form_names)
        self.assertIn("password", form_names)

        # Effective hierarchy should exclude database
        eff_keys = [h["key"] for h in cfg["effective_hierarchy"]]
        self.assertNotIn("database", eff_keys)
        self.assertIn("schema", eff_keys)
        self.assertIn("table", eff_keys)

    def test_hierarchy(self):
        from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader
        h = PostgreSQLDataLoader.catalog_hierarchy()
        keys = [l["key"] for l in h]
        self.assertEqual(keys, ["database", "schema", "table"])
