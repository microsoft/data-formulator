#!/usr/bin/env python3
"""Load sample datasets into the Superset test instance's default SQLite DB.

This runs inside the Superset container after `superset init`.
It creates small, self-contained tables useful for testing the DF plugin:
  - df_test_sales       (100 rows, mixed types)
  - df_test_employees   (30  rows, names and departments)
  - df_test_weather     (365 rows, daily temps)
"""

import random
import datetime
import sqlite3
import os

DB_PATH = os.path.expanduser("~/.superset/superset.db")
# Fallback: newer Superset images may use a different path
if not os.path.exists(DB_PATH):
    DB_PATH = "/app/superset_home/superset.db"


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


def register_datasets_in_superset() -> None:
    """Register our tables as Superset datasets via the Superset Python API.

    This runs inside the Superset process context so we can use
    superset's own SQLAlchemy models.
    """
    try:
        from superset.app import create_app
        from superset.connectors.sqla.models import SqlaTable
        from superset.extensions import db as superset_db

        app = create_app()
        with app.app_context():
            # Find the default "examples" database
            from superset.models.core import Database
            examples_db = superset_db.session.query(Database).filter_by(
                database_name="examples"
            ).first()

            if not examples_db:
                print("[sample_data] Warning: 'examples' database not found, skipping dataset registration")
                return

            for table_name in ["df_test_sales", "df_test_employees", "df_test_weather"]:
                existing = superset_db.session.query(SqlaTable).filter_by(
                    table_name=table_name, database_id=examples_db.id
                ).first()
                if existing:
                    print(f"[sample_data] Dataset '{table_name}' already registered")
                    continue

                dataset = SqlaTable(
                    table_name=table_name,
                    database_id=examples_db.id,
                    schema=None,
                )
                superset_db.session.add(dataset)
                print(f"[sample_data] Registered dataset '{table_name}'")

            superset_db.session.commit()

    except Exception as e:
        print(f"[sample_data] Dataset registration failed (non-fatal): {e}")
        print("[sample_data] Tables exist in SQLite but may need manual registration in Superset UI")


if __name__ == "__main__":
    # Step 1: Create the tables in the examples SQLite database
    conn = sqlite3.connect(DB_PATH)
    create_tables(conn)
    conn.close()

    # Step 2: Register as Superset datasets
    register_datasets_in_superset()
