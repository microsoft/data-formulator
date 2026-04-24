# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Verification tests for all data loader catalog hierarchies and static methods.

Ensures every registered loader correctly implements:
- catalog_hierarchy() with valid level keys/labels
- effective_hierarchy() with scope pinning
- pinned_scope()
- auth_mode()
- list_params() / auth_instructions()

No database connections required — tests static/class methods only.
"""
from __future__ import annotations

import pytest

from data_formulator.data_loader.external_data_loader import ExternalDataLoader

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Test data: expected hierarchies per loader type
# ------------------------------------------------------------------

_EXPECTED_HIERARCHIES = {
    "mysql": ["database", "table"],
    "postgresql": ["database", "schema", "table"],
    "mssql": ["database", "schema", "table"],
    "bigquery": ["project_id", "dataset_id", "table"],
    "kusto": ["kusto_database", "table"],
    "athena": ["database", "table"],
    "mongodb": ["database", "collection"],
    "s3": ["bucket", "table"],
    "azure_blob": ["container_name", "table"],
    "superset": ["dashboard", "dataset"],
}


def _get_available_loaders() -> dict[str, type[ExternalDataLoader]]:
    """Import the DATA_LOADERS registry, which only includes loaders whose deps are installed."""
    from data_formulator.data_loader import DATA_LOADERS
    return DATA_LOADERS


# ==================================================================
# Tests: catalog_hierarchy
# ==================================================================

class TestAllLoaderCatalogHierarchies:

    def test_all_loaders_have_hierarchy(self):
        """Every registered loader must implement catalog_hierarchy()."""
        for key, cls in _get_available_loaders().items():
            h = cls.catalog_hierarchy()
            assert isinstance(h, list), f"{key}: catalog_hierarchy() must return a list"
            assert len(h) >= 1, f"{key}: hierarchy must have at least one level"
            for level in h:
                assert "key" in level, f"{key}: each level must have 'key'"
                assert "label" in level, f"{key}: each level must have 'label'"

    def test_hierarchies_match_expected(self):
        """Verify expected hierarchy keys for all available loaders."""
        for key, cls in _get_available_loaders().items():
            expected = _EXPECTED_HIERARCHIES.get(key)
            if expected is None:
                continue  # unknown loader, skip
            actual = [level["key"] for level in cls.catalog_hierarchy()]
            assert actual == expected, f"{key}: expected {expected}, got {actual}"

    def test_last_level_is_importable(self):
        """The last hierarchy level should be the importable leaf (table/file/dataset/etc.)."""
        importable_keys = {"table", "collection", "container", "dataset", "object", "blob"}
        for key, cls in _get_available_loaders().items():
            h = cls.catalog_hierarchy()
            last_key = h[-1]["key"]
            assert last_key in importable_keys, (
                f"{key}: last level '{last_key}' not in expected importable: {importable_keys}"
            )


# ==================================================================
# Tests: effective_hierarchy and pinned_scope
# ==================================================================

class TestScopePinningAllLoaders:

    @pytest.mark.parametrize("loader_key,pin_param,expected_removed", [
        ("mysql", "database", "database"),
        ("postgresql", "database", "database"),
        ("mssql", "database", "database"),
        ("athena", "database", "database"),
    ])
    def test_pinning_removes_level(self, loader_key, pin_param, expected_removed):
        """When a hierarchy-level param is provided, that level is pinned out."""
        loaders = _get_available_loaders()
        cls = loaders.get(loader_key)
        if cls is None:
            pytest.skip(f"{loader_key} not available")

        # Create a minimal stub that has params but doesn't connect
        # We need to test effective_hierarchy, which uses self.params
        class MockInstance:
            params = {pin_param: "test_value"}
            catalog_hierarchy = staticmethod(cls.catalog_hierarchy)
            effective_hierarchy = ExternalDataLoader.effective_hierarchy
            pinned_scope = ExternalDataLoader.pinned_scope

        inst = MockInstance()
        eff = inst.effective_hierarchy()
        eff_keys = [l["key"] for l in eff]
        assert expected_removed not in eff_keys

        pinned = inst.pinned_scope()
        assert pinned[pin_param] == "test_value"

    def test_no_pinning_returns_full_hierarchy(self):
        """With no scope params, effective_hierarchy == catalog_hierarchy."""
        loaders = _get_available_loaders()
        for key, cls in loaders.items():
            class MockInstance:
                params = {}
                catalog_hierarchy = staticmethod(cls.catalog_hierarchy)
                effective_hierarchy = ExternalDataLoader.effective_hierarchy
                pinned_scope = ExternalDataLoader.pinned_scope

            inst = MockInstance()
            full = cls.catalog_hierarchy()
            eff = inst.effective_hierarchy()
            assert eff == full, f"{key}: with no pinning, effective should match full"


# ==================================================================
# Tests: auth_mode
# ==================================================================

class TestAuthModes:

    def test_default_auth_mode_is_connection(self):
        """Most loaders use the default 'connection' auth mode."""
        connection_loaders = {"mysql", "postgresql", "mssql", "bigquery", "kusto",
                              "athena", "mongodb", "s3", "azure_blob"}
        for key, cls in _get_available_loaders().items():
            if key in connection_loaders:
                assert cls.auth_mode() == "connection", f"{key}: expected 'connection'"

    def test_superset_uses_token_mode(self):
        loaders = _get_available_loaders()
        if "superset" in loaders:
            assert loaders["superset"].auth_mode() == "token"


# ==================================================================
# Tests: list_params and auth_instructions
# ==================================================================

class TestStaticMethods:

    def test_all_loaders_have_list_params(self):
        for key, cls in _get_available_loaders().items():
            params = cls.list_params()
            assert isinstance(params, list), f"{key}: list_params() must return a list"
            assert len(params) > 0, f"{key}: must have at least one param"
            for p in params:
                assert "name" in p, f"{key}: each param must have 'name'"
                assert "type" in p, f"{key}: each param must have 'type'"

    def test_all_loaders_have_auth_instructions(self):
        for key, cls in _get_available_loaders().items():
            instructions = cls.auth_instructions()
            assert isinstance(instructions, str)
            assert len(instructions) > 10, f"{key}: auth_instructions should be helpful"

    def test_all_loaders_have_required_host_or_identifier(self):
        """Each loader should require at least one identifying connection param."""
        for key, cls in _get_available_loaders().items():
            params = cls.list_params()
            required = [p for p in params if p.get("required", False)]
            assert len(required) > 0, f"{key}: should have at least one required param"

    def test_rate_limit_returns_dict_or_none(self):
        for key, cls in _get_available_loaders().items():
            result = cls.rate_limit()
            assert result is None or isinstance(result, dict), (
                f"{key}: rate_limit() must return None or dict"
            )


# ==================================================================
# Tests: DataConnector wrapping for all loaders
# ==================================================================

class TestDataConnectorWrapping:

    def test_all_loaders_can_be_wrapped(self):
        """DataConnector.from_loader() works for every registered loader."""
        from data_formulator.data_connector import DataConnector
        for key, cls in _get_available_loaders().items():
            source = DataConnector.from_loader(cls, source_id=key)
            cfg = source.get_frontend_config()
            assert cfg["source_id"] == key
            assert len(cfg["hierarchy"]) > 0
            assert len(cfg["params_form"]) > 0

    def test_all_loaders_blueprints_have_all_routes(self):
        """The shared connectors blueprint should have all expected action routes."""
        import flask
        from data_formulator.data_connector import connectors_bp
        expected_routes = [
            "/api/connectors/connect",
            "/api/connectors/get-status",
            "/api/connectors/get-catalog",
            "/api/connectors/get-catalog-tree",
            "/api/connectors/import-data",
            "/api/connectors/refresh-data",
            "/api/connectors/preview-data",
            "/api/connectors/import-group",
        ]
        app = flask.Flask(__name__)
        app.config["TESTING"] = True
        app.register_blueprint(connectors_bp)
        rules = [rule.rule for rule in app.url_map.iter_rules()]
        for route in expected_routes:
            assert route in rules, f"missing shared route {route}"
