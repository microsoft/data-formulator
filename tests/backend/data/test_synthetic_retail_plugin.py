# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Exercise the optional retail example against the installed generator release.

Install great-generator==0.1.8 to run these tests; ordinary backend installations
skip them. No network, database server, or model credentials are used.
"""

from __future__ import annotations

import importlib.util
import builtins
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

pytestmark = [pytest.mark.backend]
pytest.importorskip("great_generator")

PLUGIN = Path(__file__).resolve().parents[3] / "examples/plugins/synthetic_retail_data_loader.py"
spec = importlib.util.spec_from_file_location("synthetic_retail_example", PLUGIN)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


@pytest.fixture
def loader():
    return plugin.SyntheticRetailDataLoader({"seed": 42, "sales_rows": 1000})


class TestRetailDataset:
    def test_catalog_does_not_generate_data(self, loader):
        with patch.object(plugin, "generate_from_schema", side_effect=AssertionError("unexpected generation")):
            catalog = loader.list_tables()
            assert len(catalog) == 5
            assert loader.test_connection()
            assert len(loader.ls([])) == 5
            assert loader.get_metadata(["fact_sales"])["row_count"] == 1000
            assert "references dim_product.product_key" in loader.get_column_types("fact_sales")["description"]
            assert [item["name"] for item in loader.list_tables("SALES")] == ["fact_sales"]

    def test_relational_integrity_and_sales_amounts(self, loader):
        data = {item["name"]: loader.fetch_data_as_arrow(item["name"]).to_pandas() for item in loader.list_tables()}
        sales = data["fact_sales"]
        for name, key in (("dim_customer", "customer_key"), ("dim_product", "product_key"),
                          ("dim_store", "store_key"), ("dim_date", "date_key"), ("fact_sales", "sales_key")):
            assert data[name][key].is_unique
            assert data[name][key].notna().all()
            if name != "fact_sales":
                assert sales[key].isin(data[name][key]).all()
        joined = sales.merge(data["dim_product"], on="product_key", validate="many_to_one")
        np.testing.assert_allclose(joined.gross_amount, joined.unit_price * joined.quantity, atol=0.005)
        np.testing.assert_allclose(sales.net_amount, sales.gross_amount - sales.discount_amount, atol=0.005)
        assert sales.net_amount.gt(0).all()
        assert data["dim_date"].calendar_date.nunique() == 365

    def test_preview_refresh_and_reconnection_are_repeatable(self, loader):
        preview = loader.fetch_data_as_arrow("fact_sales", {"size": 7})
        complete = loader.fetch_data_as_arrow("fact_sales")
        assert preview.equals(complete.slice(0, 7))
        assert complete.equals(loader.fetch_data_as_arrow("fact_sales"))
        other = plugin.SyntheticRetailDataLoader(loader.params)
        # Reverse fetch order to ensure table discovery order cannot change the data.
        for name in reversed(list(loader._rows)):
            assert other.fetch_data_as_arrow(name).equals(loader.fetch_data_as_arrow(name))
        changed = plugin.SyntheticRetailDataLoader({**loader.params, "seed": 43})
        assert not complete.equals(changed.fetch_data_as_arrow("fact_sales"))

    def test_concurrent_previews_generate_once(self, loader):
        with patch.object(plugin, "generate_from_schema", wraps=plugin.generate_from_schema) as generate:
            with ThreadPoolExecutor(max_workers=3) as pool:
                results = list(pool.map(lambda _: loader.fetch_data_as_arrow("fact_sales", {"size": 3}), range(3)))
            assert generate.call_count == 1
            assert all(results[0].equals(result) for result in results)


class TestImportOptions:
    def test_filter_sort_project_then_limit(self, loader):
        full = loader.fetch_data_as_arrow("dim_product").to_pandas()
        result = loader.fetch_data_as_arrow("dim_product", {
            "source_filters": [{"column": "category", "operator": "EQ", "value": "Electronics"}],
            "filters": [{"column": "unit_price", "op": "GT", "value": 190}],
            "sort_columns": ["unit_price"], "sort_order": "desc",
            "columns": ["product_key", "unit_price"], "size": 3,
        }).to_pandas()
        expected = full[(full.category == "Electronics") & (full.unit_price > 190)]
        expected = expected.sort_values("unit_price", ascending=False).head(3)
        assert result.to_dict("list") == expected[["product_key", "unit_price"]].to_dict("list")

    def test_filter_values_are_bound_parameters(self, loader):
        result = loader.fetch_data_as_arrow("dim_product", {
            "source_filters": [{"column": "category", "operator": "EQ", "value": "' OR 1=1 --"}],
        })
        assert result.num_rows == 0

    def test_zero_and_capped_limits(self, loader, monkeypatch):
        assert loader.fetch_data_as_arrow("fact_sales", {"size": 0}).num_rows == 0
        monkeypatch.setattr(plugin, "MAX_IMPORT_ROWS", 8)
        assert loader.fetch_data_as_arrow("fact_sales", {"size": 100}).num_rows == 8

    @pytest.mark.parametrize("options", [
        {"size": -1}, {"size": 1.5}, {"size": True},
        {"columns": ["missing"]}, {"sort_columns": ["missing"]},
        {"sort_order": "asc; drop table retail"},
        {"source_filters": [{"column": "missing", "operator": "EQ", "value": 1}]},
        {"source_filters": [{"column": "product_key", "operator": "bad", "value": 1}]},
        {"filters": [{"column": "product_key", "op": "BETWEEN", "value": [1]}]},
    ])
    def test_invalid_options_raise_value_error(self, loader, options):
        with pytest.raises(ValueError):
            loader.fetch_data_as_arrow("dim_product", options)

    def test_unknown_table_rejected_before_generation(self, loader):
        with patch.object(plugin, "generate_from_schema", side_effect=AssertionError("unexpected generation")):
            with pytest.raises(ValueError, match="Unknown synthetic retail table"):
                loader.fetch_data_as_arrow("missing")


class TestConfiguration:
    @pytest.mark.parametrize("params", [
        {"sales_rows": 0}, {"sales_rows": 100001}, {"sales_rows": "abc"},
        {"seed": -1}, {"seed": 2**32}, {"seed": 1.2}, {"seed": True},
    ])
    def test_invalid_configuration(self, params):
        with pytest.raises(ValueError):
            plugin.SyntheticRetailDataLoader(params)

    def test_string_configuration(self):
        loader = plugin.SyntheticRetailDataLoader({"sales_rows": "100", "seed": "0"})
        assert loader.params == {"sales_rows": 100, "seed": 0}


class TestPluginIntegration:
    def test_scanner_registers_example(self, monkeypatch):
        from data_formulator import data_loader as registry

        for name in ("DATA_LOADERS", "PLUGIN_LOADERS", "DISABLED_LOADERS"):
            monkeypatch.setattr(registry, name, {})
        with patch.dict(sys.modules):
            registry._load_plugin_file(PLUGIN)
            registered = registry.DATA_LOADERS["synthetic_retail"]({"sales_rows": 5})
            assert registered.fetch_data_as_arrow("fact_sales").num_rows == 5
            assert registry.DISABLED_LOADERS == {}

    def test_missing_dependency_disables_only_example(self, monkeypatch):
        from data_formulator import data_loader as registry

        for name in ("DATA_LOADERS", "PLUGIN_LOADERS", "DISABLED_LOADERS"):
            monkeypatch.setattr(registry, name, {})
        original_import = builtins.__import__

        def without_generator(name, *args, **kwargs):
            if name == "great_generator":
                raise ModuleNotFoundError("great_generator", name="great_generator")
            return original_import(name, *args, **kwargs)

        with patch.dict(sys.modules), patch("builtins.__import__", side_effect=without_generator):
            registry._load_plugin_file(PLUGIN)
        assert "synthetic_retail" not in registry.DATA_LOADERS
        assert "pip install great-generator==0.1.8" in registry.DISABLED_LOADERS["synthetic_retail"]

    def test_ingest_preserves_rows_and_synthetic_metadata(self, loader, tmp_path):
        from data_formulator.datalake.workspace import Workspace
        import pyarrow.parquet as pq

        workspace = Workspace("retail-example", root_dir=tmp_path)
        metadata = loader.ingest_to_workspace(workspace, "sales", "fact_sales")
        assert metadata.row_count == 1000
        assert "Synthetic demonstration data" in metadata.description
        assert "references dim_customer.customer_key" in metadata.description
        saved = list(tmp_path.rglob("sales.parquet"))
        assert len(saved) == 1
        assert pq.read_table(saved[0]).equals(loader.fetch_data_as_arrow("fact_sales"))

    def test_agent_probe_matches_filtered_import(self, loader):
        result = loader.probe(["dim_product"], {
            "filters": [{"column": "category", "op": "EQ", "value": "Electronics"}],
            "limit": 50,
        })
        assert "error" not in result
        assert result["exact"] is True
        assert len(result["rows"]) == 10
