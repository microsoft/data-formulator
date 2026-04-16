#!/usr/bin/env python3
"""Create sample tables and add native filters to the Sales Dashboard.

Runs inside the Superset container after ``superset load_examples``.
All operations use plain sqlite3 — no Superset imports needed.

Phase 1: Write df_test_* tables into the *examples* SQLite database.
Phase 2: Patch the Sales Dashboard's json_metadata in the *metadata*
         database so it has native filter definitions for testing.
"""

import json
import random
import datetime
import sqlite3
import os

# -- paths inside the container --
EXAMPLES_DB = "/app/superset_home/examples.db"
METADATA_DB = "/app/superset_home/superset.db"


def create_tables(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()

    # -- df_test_sales --
    cur.execute("DROP TABLE IF EXISTS df_test_sales")
    cur.execute("""
        CREATE TABLE df_test_sales (
            id INTEGER PRIMARY KEY,
            date TEXT,
            region TEXT,
            product TEXT,
            quantity INTEGER,
            unit_price REAL,
            revenue REAL
        )
    """)

    regions = ["North", "South", "East", "West"]
    products = ["Widget A", "Widget B", "Gadget X", "Gadget Y", "Gizmo Z"]
    rng = random.Random(42)

    rows = []
    base = datetime.date(2025, 1, 1)
    for i in range(1, 101):
        d = base + datetime.timedelta(days=rng.randint(0, 364))
        region = rng.choice(regions)
        product = rng.choice(products)
        qty = rng.randint(1, 50)
        price = round(rng.uniform(5.0, 100.0), 2)
        rows.append((i, d.isoformat(), region, product, qty, price, round(qty * price, 2)))

    cur.executemany(
        "INSERT INTO df_test_sales VALUES (?, ?, ?, ?, ?, ?, ?)", rows
    )

    # -- df_test_employees --
    cur.execute("DROP TABLE IF EXISTS df_test_employees")
    cur.execute("""
        CREATE TABLE df_test_employees (
            id INTEGER PRIMARY KEY,
            name TEXT,
            department TEXT,
            hire_date TEXT,
            salary REAL
        )
    """)

    departments = ["Engineering", "Marketing", "Sales", "HR", "Finance"]
    first_names = [
        "Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace",
        "Heidi", "Ivan", "Judy", "Karl", "Laura", "Mike", "Nina",
        "Oscar", "Pat", "Quinn", "Rose", "Steve", "Tina",
        "Uma", "Vic", "Wendy", "Xander", "Yuki", "Zara",
        "Amir", "Beth", "Chen", "Diana"
    ]

    emp_rows = []
    for i, name in enumerate(first_names, start=1):
        dept = departments[i % len(departments)]
        hire = (datetime.date(2018, 1, 1) + datetime.timedelta(days=rng.randint(0, 2500))).isoformat()
        salary = round(rng.uniform(50000, 150000), 2)
        emp_rows.append((i, name, dept, hire, salary))

    cur.executemany(
        "INSERT INTO df_test_employees VALUES (?, ?, ?, ?, ?)", emp_rows
    )

    # -- df_test_weather --
    cur.execute("DROP TABLE IF EXISTS df_test_weather")
    cur.execute("""
        CREATE TABLE df_test_weather (
            date TEXT PRIMARY KEY,
            city TEXT,
            temp_high REAL,
            temp_low REAL,
            precipitation REAL,
            condition TEXT
        )
    """)

    cities = ["Seattle", "New York", "Austin"]
    conditions = ["Sunny", "Cloudy", "Rainy", "Snowy", "Partly Cloudy"]

    weather_rows = []
    for day_offset in range(365):
        d = (datetime.date(2025, 1, 1) + datetime.timedelta(days=day_offset)).isoformat()
        city = cities[day_offset % len(cities)]
        month = (day_offset // 30) % 12
        # Rough seasonal variation
        base_temp = 40 + 30 * (1 - abs(month - 6) / 6.0)
        high = round(base_temp + rng.uniform(0, 15), 1)
        low = round(base_temp - rng.uniform(5, 15), 1)
        precip = round(max(0, rng.gauss(0.1, 0.3)), 2)
        cond = rng.choice(conditions)
        weather_rows.append((d, city, high, low, precip, cond))

    cur.executemany(
        "INSERT INTO df_test_weather VALUES (?, ?, ?, ?, ?, ?)", weather_rows
    )

    conn.commit()
    print(f"[sample_data] Created df_test_sales (100), df_test_employees (30), df_test_weather (365)")


def add_native_filters_to_sales_dashboard() -> None:
    """Inject native filter configuration into the Sales Dashboard.

    The built-in Sales Dashboard (slug='sales-dashboard') ships with no
    native filters. We patch its ``json_metadata`` to add select filters
    on the ``cleaned_sales_data`` dataset columns so the DF filter UI
    has something to work with.
    """
    if not os.path.exists(METADATA_DB):
        print("[sample_data] Metadata DB not found, skipping filter injection")
        return

    conn = sqlite3.connect(METADATA_DB)
    cur = conn.cursor()

    # Find the Sales Dashboard
    cur.execute(
        "SELECT id, json_metadata FROM dashboards "
        "WHERE dashboard_title = 'Sales Dashboard' OR slug = 'sales-dashboard' "
        "LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        print("[sample_data] Sales Dashboard not found, skipping filter injection")
        conn.close()
        return

    dash_id, raw_meta = row
    meta = json.loads(raw_meta) if raw_meta else {}

    # Already has filters? Skip.
    if meta.get("native_filter_configuration"):
        print(f"[sample_data] Sales Dashboard (id={dash_id}) already has native filters")
        conn.close()
        return

    # Find the cleaned_sales_data dataset id
    cur.execute(
        "SELECT id FROM tables WHERE table_name = 'cleaned_sales_data' LIMIT 1"
    )
    ds_row = cur.fetchone()
    if not ds_row:
        print("[sample_data] cleaned_sales_data dataset not found, skipping filter injection")
        conn.close()
        return
    ds_id = ds_row[0]

    # Build native filters
    native_filters = [
        {
            "id": "NATIVE_FILTER-status",
            "name": "Order Status",
            "filterType": "filter_select",
            "targets": [{"datasetId": ds_id, "column": {"name": "status"}}],
            "controlValues": {"multiSelect": True, "enableEmptyFilter": False},
            "defaultDataMask": {"filterState": {"value": ["Shipped", "In Progress"]}},
            "scope": {"rootPath": ["ROOT_ID"], "excluded": []},
            "type": "NATIVE_FILTER",
            "required": False,
        },
        {
            "id": "NATIVE_FILTER-product_line",
            "name": "Product Line",
            "filterType": "filter_select",
            "targets": [{"datasetId": ds_id, "column": {"name": "product_line"}}],
            "controlValues": {"multiSelect": True, "enableEmptyFilter": False},
            "defaultDataMask": {"filterState": {}},
            "scope": {"rootPath": ["ROOT_ID"], "excluded": []},
            "type": "NATIVE_FILTER",
            "required": False,
        },
        {
            "id": "NATIVE_FILTER-deal_size",
            "name": "Deal Size",
            "filterType": "filter_select",
            "targets": [{"datasetId": ds_id, "column": {"name": "deal_size"}}],
            "controlValues": {"multiSelect": False, "enableEmptyFilter": False},
            "defaultDataMask": {"filterState": {}},
            "scope": {"rootPath": ["ROOT_ID"], "excluded": []},
            "type": "NATIVE_FILTER",
            "required": False,
        },
    ]

    meta["native_filter_configuration"] = native_filters
    cur.execute(
        "UPDATE dashboards SET json_metadata = ? WHERE id = ?",
        (json.dumps(meta), dash_id),
    )
    conn.commit()
    conn.close()
    print(f"[sample_data] Added {len(native_filters)} native filters to Sales Dashboard (id={dash_id})")


if __name__ == "__main__":
    # 1. Create custom tables in the examples database
    if os.path.exists(EXAMPLES_DB):
        conn = sqlite3.connect(EXAMPLES_DB)
        create_tables(conn)
        conn.close()
    else:
        print(f"[sample_data] Warning: {EXAMPLES_DB} not found, skipping table creation")

    # 2. Add native filters to the Sales Dashboard
    add_native_filters_to_sales_dashboard()
