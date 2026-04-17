#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Benchmark sandbox execution speed across local and docker modes.

Usage:
    uv run python tests/backend/benchmarks/benchmark_sandbox.py
"""

import statistics
import subprocess
import tempfile
import time

from data_formulator.sandbox import LocalSandbox, DockerSandbox
from data_formulator.sandbox.not_a_sandbox import NotASandbox


class _MinimalWorkspace:
    """Lightweight workspace stand-in for benchmarks."""
    def __init__(self, path: str):
        self._path = path

# ---------------------------------------------------------------------------
# Realistic Data Formulator code snippets (typical AI-generated transforms)
# ---------------------------------------------------------------------------

# 1. Simple column rename + filter (small, fast)
CODE_SIMPLE = """\
import pandas as pd
df = pd.DataFrame({
    "Name": ["Alice", "Bob", "Charlie", "Diana", "Eve"],
    "Age": [25, 30, 35, 28, 22],
    "Salary": [50000, 60000, 70000, 55000, 45000],
    "Department": ["Eng", "Sales", "Eng", "Sales", "Eng"]
})
result_df = df.rename(columns={"Name": "Employee"}).query("Age > 24")
"""

# 2. Groupby + aggregation (medium complexity, typical chart prep)
CODE_GROUPBY = """\
import pandas as pd
import numpy as np
np.random.seed(42)
n = 1000
df = pd.DataFrame({
    "date": pd.date_range("2023-01-01", periods=n, freq="D"),
    "category": np.random.choice(["A", "B", "C", "D"], n),
    "value": np.random.normal(100, 25, n),
    "quantity": np.random.randint(1, 50, n),
})
result_df = (
    df.groupby([pd.Grouper(key="date", freq="M"), "category"])
      .agg(total_value=("value", "sum"), avg_quantity=("quantity", "mean"))
      .reset_index()
)
"""

# 3. Pivot + melt (reshape for visualization)
CODE_PIVOT = """\
import pandas as pd
import numpy as np
np.random.seed(42)
df = pd.DataFrame({
    "year": [2020, 2020, 2021, 2021, 2022, 2022] * 3,
    "region": (["North", "South"] * 3) * 3,
    "metric": ["revenue"] * 6 + ["profit"] * 6 + ["cost"] * 6,
    "value": np.random.randint(100, 1000, 18),
})
pivot = df.pivot_table(index=["year", "region"], columns="metric", values="value", aggfunc="sum").reset_index()
result_df = pivot.melt(id_vars=["year", "region"], var_name="metric", value_name="amount")
"""

# 4. Multi-table join + derived columns (common Data Formulator pattern)
CODE_JOIN = """\
import pandas as pd
import numpy as np
np.random.seed(42)
orders = pd.DataFrame({
    "order_id": range(1, 501),
    "customer_id": np.random.randint(1, 51, 500),
    "product_id": np.random.randint(1, 21, 500),
    "amount": np.random.uniform(10, 500, 500).round(2),
    "date": pd.date_range("2023-01-01", periods=500, freq="6h"),
})
customers = pd.DataFrame({
    "customer_id": range(1, 51),
    "name": [f"Customer_{i}" for i in range(1, 51)],
    "segment": np.random.choice(["Enterprise", "SMB", "Consumer"], 50),
})
products = pd.DataFrame({
    "product_id": range(1, 21),
    "product_name": [f"Product_{i}" for i in range(1, 21)],
    "category": np.random.choice(["Electronics", "Clothing", "Food"], 20),
})
merged = orders.merge(customers, on="customer_id").merge(products, on="product_id")
merged["month"] = merged["date"].dt.to_period("M").astype(str)
result_df = (
    merged.groupby(["month", "segment", "category"])
          .agg(total_sales=("amount", "sum"), order_count=("order_id", "count"))
          .reset_index()
          .sort_values("total_sales", ascending=False)
)
"""

# 5. DuckDB SQL query (Python+SQL unified execution)
CODE_DUCKDB = """\
import pandas as pd
import numpy as np
import duckdb
np.random.seed(42)
df = pd.DataFrame({
    "city": np.random.choice(["NYC", "LA", "Chicago", "Houston", "Phoenix"], 200),
    "temperature": np.random.normal(70, 15, 200).round(1),
    "humidity": np.random.uniform(20, 90, 200).round(1),
    "date": pd.date_range("2023-01-01", periods=200, freq="D"),
})
result_df = duckdb.sql(\"\"\"
    SELECT city,
           COUNT(*) as days,
           ROUND(AVG(temperature), 1) as avg_temp,
           ROUND(AVG(humidity), 1) as avg_humidity,
           ROUND(MIN(temperature), 1) as min_temp,
           ROUND(MAX(temperature), 1) as max_temp
    FROM df
    GROUP BY city
    ORDER BY avg_temp DESC
\"\"\").df()
"""

BENCHMARKS = [
    ("simple_rename_filter", CODE_SIMPLE),
    ("groupby_aggregation",  CODE_GROUPBY),
    ("pivot_melt_reshape",   CODE_PIVOT),
    ("multi_table_join",     CODE_JOIN),
    ("duckdb_sql_query",     CODE_DUCKDB),
]


def _docker_available() -> bool:
    try:
        proc = subprocess.run(["docker", "info"], capture_output=True, timeout=10)
        return proc.returncode == 0
    except Exception:
        return False


def bench(sandbox, workspace, name: str, code: str, warmup: int = 1, runs: int = 5) -> dict:
    """Run a benchmark and return timing stats."""
    # Warmup
    for _ in range(warmup):
        r = sandbox.run_python_code(code, workspace, "result_df")
        if r["status"] != "ok":
            return {"name": name, "error": r.get("content", r.get("error_message", "unknown"))}

    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        r = sandbox.run_python_code(code, workspace, "result_df")
        t1 = time.perf_counter()
        if r["status"] != "ok":
            return {"name": name, "error": r.get("content", r.get("error_message", "unknown"))}
        times.append(t1 - t0)

    return {
        "name": name,
        "mean_ms": statistics.mean(times) * 1000,
        "median_ms": statistics.median(times) * 1000,
        "stdev_ms": statistics.stdev(times) * 1000 if len(times) > 1 else 0,
        "min_ms": min(times) * 1000,
        "max_ms": max(times) * 1000,
        "runs": runs,
    }


def print_results(mode: str, results: list[dict]):
    print(f"\n{'=' * 72}")
    print(f"  {mode}")
    print(f"{'=' * 72}")
    print(f"  {'Benchmark':<25} {'Mean':>9} {'Median':>9} {'StDev':>9} {'Min':>9} {'Max':>9}")
    print(f"  {'-' * 25} {'-' * 9} {'-' * 9} {'-' * 9} {'-' * 9} {'-' * 9}")
    for r in results:
        if "error" in r:
            print(f"  {r['name']:<25} ERROR: {r['error'][:40]}")
        else:
            print(f"  {r['name']:<25} {r['mean_ms']:>8.1f}ms {r['median_ms']:>8.1f}ms "
                  f"{r['stdev_ms']:>8.1f}ms {r['min_ms']:>8.1f}ms {r['max_ms']:>8.1f}ms")


def main():
    print("Data Formulator Sandbox Benchmark")
    print(f"Running each benchmark: 1 warmup + 5 timed runs\n")

    # Create a temporary workspace directory
    tmpdir = tempfile.mkdtemp(prefix="df_bench_")
    workspace = _MinimalWorkspace(tmpdir)

    # --- Baseline (main-process, no isolation) ---
    sandbox = NotASandbox()
    results_baseline = [bench(sandbox, workspace, name, code) for name, code in BENCHMARKS]
    print_results("baseline (main-process, no isolation)", results_baseline)

    # --- Local (warm subprocess, audit hooks) ---
    sandbox = LocalSandbox()
    results_local = [bench(sandbox, workspace, name, code) for name, code in BENCHMARKS]
    print_results("local (warm subprocess, audit hooks)", results_local)

    # --- Docker ---
    if _docker_available():
        sandbox = DockerSandbox()
        results_docker = [bench(sandbox, workspace, name, code, warmup=1, runs=3) for name, code in BENCHMARKS]
        print_results("docker (container isolation)", results_docker)
    else:
        print("\n  [Docker not available -- skipping docker benchmark]")

    # --- Summary ---
    print(f"\n{'=' * 72}")
    print("  Overhead vs baseline (warm subprocess)")
    print(f"{'=' * 72}")
    for rb, rl in zip(results_baseline, results_local):
        if "error" in rb or "error" in rl:
            status = "N/A (error)"
        else:
            overhead = rl["mean_ms"] - rb["mean_ms"]
            status = f"+{overhead:.1f}ms overhead"
        print(f"  {rb['name']:<25} {status}")


if __name__ == "__main__":
    main()
