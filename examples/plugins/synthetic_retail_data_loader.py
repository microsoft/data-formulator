# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Optional, reproducible retail demo source. See synthetic_retail.md for setup."""

from __future__ import annotations

import threading
from typing import Any

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa

try:
    from great_generator import generate_from_schema, parse_ddl
except ImportError as exc:
    raise ImportError("Install the example dependency: python -m pip install great-generator==0.1.8") from exc

from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.external_data_loader import (
    ExternalDataLoader,
    MAX_IMPORT_ROWS,
    apply_import_projection,
    build_where_clause,
)

# Embedded so installing the plugin requires copying just this Python file.
# Only this fixed contract is parsed; users cannot supply executable code or SQL.
RETAIL_DDL = """
CREATE TABLE dim_customer (
    customer_key BIGINT PRIMARY KEY,
    customer_name VARCHAR NOT NULL,
    customer_segment VARCHAR NOT NULL
);
CREATE TABLE dim_product (
    product_key BIGINT PRIMARY KEY,
    product_name VARCHAR NOT NULL,
    category VARCHAR NOT NULL,
    unit_price DOUBLE NOT NULL
);
CREATE TABLE dim_store (
    store_key BIGINT PRIMARY KEY,
    store_name VARCHAR NOT NULL,
    region VARCHAR NOT NULL
);
CREATE TABLE dim_date (
    date_key BIGINT PRIMARY KEY,
    calendar_date DATE NOT NULL,
    month_name VARCHAR NOT NULL
);
CREATE TABLE fact_sales (
    sales_key BIGINT PRIMARY KEY,
    customer_key BIGINT NOT NULL REFERENCES dim_customer(customer_key),
    product_key BIGINT NOT NULL REFERENCES dim_product(product_key),
    store_key BIGINT NOT NULL REFERENCES dim_store(store_key),
    date_key BIGINT NOT NULL REFERENCES dim_date(date_key),
    quantity BIGINT NOT NULL,
    gross_amount DOUBLE NOT NULL,
    discount_amount DOUBLE NOT NULL,
    net_amount DOUBLE NOT NULL
);
"""

MAX_SALES_ROWS = 100_000
_FILTER_OPERATORS = {
    "EQ": "=", "NEQ": "!=", "GT": ">", "GTE": ">=", "LT": "<", "LTE": "<=",
    "IN": "IN", "NOT_IN": "NOT IN", "LIKE": "LIKE", "ILIKE": "ILIKE",
    "IS_NULL": "IS NULL", "IS_NOT_NULL": "IS NOT NULL", "BETWEEN": "BETWEEN",
}


def _integer(value: Any, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{name} must be an integer between {minimum} and {maximum}")
    try:
        result = int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer between {minimum} and {maximum}") from exc
    if not minimum <= result <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return result


class SyntheticRetailDataLoader(ExternalDataLoader):
    """Generate a bounded star schema without reading production records."""

    DISPLAY_NAME = "Synthetic Retail (example)"

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "seed", "type": "int", "default": 42, "required": False,
             "tier": "connection", "description": "Reproducible seed (0–4294967295)"},
            {"name": "sales_rows", "type": "int", "default": 10_000, "required": False,
             "tier": "connection", "description": "Sales rows (1–100000); dimensions stay fixed"},
        ]

    @staticmethod
    def auth_config() -> dict:
        # Keep the normal connection form for seed/size, without any auth fields.
        return {"mode": "credentials"}

    @staticmethod
    def auth_instructions() -> str:
        return (
            "Locally generated **synthetic demonstration data**, not actual retail results. "
            "No database credentials or production records are needed. Import all five tables "
            "without limiting dimension rows to preserve joins. Refresh repeats the same "
            "dataset for the same seed, size, and installed dependency versions."
        )

    def __init__(self, params: dict[str, Any] | None = None):
        params = params or {}
        self.seed = _integer(params.get("seed", 42), "seed", 0, 2**32 - 1)
        self.sales_rows = _integer(params.get("sales_rows", 10_000), "sales_rows", 1, MAX_SALES_ROWS)
        self.params = {"seed": self.seed, "sales_rows": self.sales_rows}
        self._contract = parse_ddl(RETAIL_DDL, strict=True, name="synthetic_retail")
        self._rows = {"dim_customer": 200, "dim_product": 50, "dim_store": 10,
                      "dim_date": 365, "fact_sales": self.sales_rows}
        self._tables: dict[str, pa.Table] | None = None
        self._lock = threading.Lock()

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        if source_table not in self._contract.tables:
            raise ValueError(f"Unknown synthetic retail table: {source_table!r}")
        schema = self._contract.tables[source_table]
        relationships = "; ".join(
            f"{fk.column} references {fk.parent_table}.{fk.parent_column}"
            for fk in schema.foreign_keys
        )
        return {
            "description": (
                f"Synthetic demonstration data. Primary key: {schema.primary_key}. "
                f"Seed: {self.seed}; sales rows: {self.sales_rows}. {relationships}"
            ),
            "columns": [
                {"name": col.name, "type": col.original_type,
                 "is_dttm": col.dtype == "date"}
                for col in schema.columns
            ],
        }

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        # Catalog discovery reads only the contract, never generates data.
        return [
            {"name": name, "table_key": name,
             "metadata": {**self.get_column_types(name), "_source_name": name, "row_count": count}}
            for name, count in self._rows.items()
            if not table_filter or table_filter.lower() in name.lower()
        ]

    def _generate_tables(self) -> dict[str, pa.Table]:
        frames = generate_from_schema(self._contract, rows=self._rows, seed=self.seed)
        rng = np.random.default_rng(self.seed)
        customers = frames["dim_customer"]
        customers["customer_segment"] = rng.choice(["New", "Standard", "Loyal", "VIP"], len(customers))
        products = frames["dim_product"]
        categories = np.array(["Grocery", "Home", "Electronics", "Sports", "Clothing"])
        category_index = np.arange(len(products)) % len(categories)
        products["category"] = categories[category_index]
        products["product_name"] = [
            f"{category} item {key}" for category, key in zip(products["category"], products["product_key"])
        ]
        products["unit_price"] = np.round(
            np.array([5, 30, 200, 50, 25])[category_index] * rng.uniform(0.8, 1.2, len(products)), 2
        )
        stores = frames["dim_store"]
        stores["region"] = np.resize(["Northeast", "Southeast", "Midwest", "Southwest", "West"], len(stores))
        stores["store_name"] = [f"Demo store {key}" for key in stores["store_key"]]
        dates = frames["dim_date"]
        calendar = pd.date_range("2025-01-01", periods=365)
        dates["calendar_date"] = calendar.date
        dates["month_name"] = calendar.month_name()

        # Keep the generator's PK/FK assignments. Derive related measures explicitly
        # so group-by/join exercises have coherent amounts, not independent noise.
        sales = frames["fact_sales"]
        prices = sales["product_key"].map(products.set_index("product_key")["unit_price"])
        segments = sales["customer_key"].map(customers.set_index("customer_key")["customer_segment"])
        sales["quantity"] = rng.integers(1, 6, len(sales))
        sales["gross_amount"] = (prices * sales["quantity"]).round(2)
        rates = segments.map({"New": 0.0, "Standard": 0.03, "Loyal": 0.08, "VIP": 0.12})
        sales["discount_amount"] = (sales["gross_amount"] * rates).round(2)
        sales["net_amount"] = (sales["gross_amount"] - sales["discount_amount"]).round(2)
        return {name: pa.Table.from_pandas(frame, preserve_index=False) for name, frame in frames.items()}

    def fetch_data_as_arrow(
        self, source_table: str, import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        self.get_column_types(source_table)  # Validate before generating anything.
        opts = import_options or {}
        raw_size = opts.get("size", MAX_IMPORT_ROWS)
        # Validate before clamping so negative/fractional limits cannot slip through.
        size = min(_integer(raw_size, "size", 0, 2**63 - 1), MAX_IMPORT_ROWS)
        with self._lock:
            if self._tables is None:
                self._tables = self._generate_tables()
            table = self._tables[source_table]

        sort_columns = opts.get("sort_columns") or []
        if not isinstance(sort_columns, list) or any(c not in table.column_names for c in sort_columns):
            raise ValueError("sort_columns must be a list of known column names")
        order = str(opts.get("sort_order", "asc")).upper()
        if order not in {"ASC", "DESC"}:
            raise ValueError("sort_order must be asc or desc")
        conditions = []
        for key in ("filters", "source_filters"):
            filters = opts.get(key) or []
            if not isinstance(filters, list):
                raise ValueError(f"{key} must be a list of filters")
            for item in filters:
                if not isinstance(item, dict) or item.get("column") not in table.column_names:
                    raise ValueError("Filters must reference known column names")
                op = str(item.get("operator") or item.get("op") or "").upper()
                sql_op = _FILTER_OPERATORS.get(op, op)
                if sql_op not in set(_FILTER_OPERATORS.values()):
                    raise ValueError(f"Unsupported filter operator: {op}")
                value = item.get("value")
                if sql_op in {"IN", "NOT IN"} and (not isinstance(value, list) or not value):
                    raise ValueError("IN/NOT IN requires a non-empty list")
                if sql_op == "BETWEEN" and (not isinstance(value, list) or len(value) != 2):
                    raise ValueError("BETWEEN requires two values")
                if op == "ILIKE":
                    value = f"%{value}%"  # Match the connector's contains-search convention.
                conditions.append({"column": item["column"], "operator": sql_op, "value": value})
        where, parameters = build_where_clause(conditions, quote_char='"')
        sort = ", ".join(f'"{column}" {order}' for column in sort_columns)
        query = f"SELECT * FROM retail {where}"
        if sort:
            query += f" ORDER BY {sort}"
        query += " LIMIT ?"
        # Each fetch has its own connection; the cached Arrow tables are immutable.
        with duckdb.connect() as connection:
            connection.register("retail", table)
            result = connection.execute(query, [*parameters, size]).fetch_arrow_table()
        return apply_import_projection(result, opts)

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        return probe_utils.run_probe_on_duckdb(self, path, query, scan_size=MAX_IMPORT_ROWS)
