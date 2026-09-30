# Synthetic retail demo plugin

Use this optional source to practice multi-table analysis without connecting a
production database: compare monthly net sales across product categories, store
regions, and customer segments. It generates data locally with
[Great Generator](https://github.com/GreatDataLabs/great-generator), using a fixed
SQL contract with primary and foreign keys. No production records are read.
Generation needs neither a network connection nor model credentials; Data
Formulator's AI analysis still requires a configured model.

## Install

This example targets the plugin interface on Data Formulator's current `main`.
Use a source installation following [DEVELOPMENT.md](../../DEVELOPMENT.md), or a
build that includes that interface. In the **same Python environment** that runs
Data Formulator, install the optional dependency:

```sh
python -m pip install great-generator==0.1.8
# For a uv-managed environment: uv pip install great-generator==0.1.8
```

Copy [`synthetic_retail_data_loader.py`](synthetic_retail_data_loader.py) into
`~/.data_formulator/plugins/` (create the directory if needed), then restart Data
Formulator. If `DATA_FORMULATOR_HOME` is set, use its `plugins` subdirectory;
`DF_PLUGIN_DIR` overrides both. See the [plugin guide](README.md) for setup and
deployment restrictions. Only the Python file needs to be copied.

Add a **Synthetic Retail (example)** connector. Keep seed `42` and sales rows
`10000` for the walkthrough. No authentication fields are required. This package
is not added to Data Formulator's core requirements and Spark is not needed.

## Explore

Import all five tables from the same connector, with no filters and an import
limit of at least the configured sales-row count **and 365**:

| Table | Rows | Join key |
| --- | ---: | --- |
| `dim_customer` | 200 | `customer_key` |
| `dim_product` | 50 | `product_key` |
| `dim_store` | 10 | `store_key` |
| `dim_date` | 365 | `date_key` |
| `fact_sales` | Configurable, default 10,000 | References all four dimensions |

Try these analysis prompts:

1. “Join fact_sales to dim_date and dim_product using date_key and product_key.
   Plot monthly net_amount totals by category, sorting months chronologically.”
2. “Add dim_store using store_key and compare monthly sales by region.”
3. “Join dim_customer using customer_key. Compare gross_amount,
   discount_amount, and net_amount totals by customer_segment.”

All results are **synthetic demonstration data**, not evidence about retail
markets. Product prices vary by category; quantities range from one to five;
discount rates are 0%, 3%, 8%, and 12% for New, Standard, Loyal, and VIP customers.
Net amount equals gross amount minus discount amount. Dates cover 2025. These
rules make joins and aggregations meaningful without claiming statistical
fidelity to a real business.

## Repeatability and limits

The first fetch generates all tables together and retains immutable Arrow tables
on that connector instance. Browsing the catalog does not generate rows. Preview
limits, filters, sorting, and column selection apply to that shared dataset;
refresh does not advance the seed. A new instance with identical configuration
and dependency versions reconstructs the same data. Exact reproduction across
package upgrades is not promised; preserve the environment for repeatable demos.

Sales rows must be between 1 and 100,000; the dimensions stay fixed. This is an
in-memory demo source, not a large-scale benchmark. Filtering or truncating
dimension imports can exclude keys referenced by sales, so import complete
dimensions when exercising joins. To compare seeds or sizes, use separate
connectors/workspaces and import the complete table set from each.

## Test

From a source checkout with development dependencies and the optional package:

```sh
uv run --no-sync pytest tests/backend/data/test_synthetic_retail_plugin.py -q
```

Tests cover relational integrity, sales arithmetic, repeatable preview/import/
refresh, concurrent first fetches, configuration limits, and import options.
Without `great-generator` installed, this optional test module is skipped.
