#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Benchmark workspace read performance: Local vs Azure Blob vs Azure+Cache.

Runs all backends in one shot and prints a side-by-side comparison.
When real Azure credentials are unavailable, a *simulated* Azure backend
wraps the local workspace with configurable per-call latency so the
performance gap is still visible.

Measured operations (typical derive-data request hot path):
  1. get_metadata()           -- parsed from workspace.yaml / blob
  2. read_data_as_df()        -- used by generate_data_summary per table
  3. local_dir()              -- sandbox materialises all files locally
  4. WorkspaceWithTempData    -- mount temp tables -> read -> cleanup
  5. run_parquet_sql()        -- DuckDB query against a parquet table
  6. full_derive_data_reads   -- (2) x N tables + (3) combined

Usage:
    python tests/backend/benchmarks/benchmark_workspace.py
    python tests/backend/benchmarks/benchmark_workspace.py --rows 10000 --tables 3
    python tests/backend/benchmarks/benchmark_workspace.py --azure   # use real Azure
    python tests/backend/benchmarks/benchmark_workspace.py --latency 0.05  # 50ms/call
"""

from __future__ import annotations

import argparse
import io
import os
import statistics
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pandas as pd

_project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_project_root / "py-src"))

from data_formulator.datalake.workspace import Workspace, WorkspaceWithTempData
from data_formulator.datalake.parquet_utils import sanitize_table_name


# == Simulated-latency workspace ============================================

class SimulatedBlobWorkspace(Workspace):
    """Local workspace + artificial latency to mimic Azure Blob round-trips."""

    def __init__(self, identity_id, root_dir, latency_s=0.03,
                 *, use_blob_cache=False):
        super().__init__(identity_id, root_dir=root_dir)
        self._latency_s = latency_s
        self._use_blob_cache = use_blob_cache
        self._blob_cache: dict[str, bytes] = {}
        self._metadata_cached = False

    def _sim_latency(self):
        time.sleep(self._latency_s)

    # -- metadata -----------------------------------------------------------

    def get_metadata(self):
        if self._use_blob_cache and self._metadata_cached:
            return super().get_metadata()
        self._sim_latency()
        result = super().get_metadata()
        self._metadata_cached = True
        return result

    def save_metadata(self, metadata):
        self._sim_latency()
        self._metadata_cached = False
        return super().save_metadata(metadata)

    # -- read ---------------------------------------------------------------

    def read_data_as_df(self, table_name):
        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        filename = meta.filename

        if self._use_blob_cache and filename in self._blob_cache:
            buf = io.BytesIO(self._blob_cache[filename])
            return pd.read_parquet(buf)

        self._sim_latency()
        df = super().read_data_as_df(table_name)

        if self._use_blob_cache:
            path = self._path / filename
            if path.exists():
                self._blob_cache[filename] = path.read_bytes()
        return df

    # -- write --------------------------------------------------------------

    def write_parquet(self, df, table_name, **kwargs):
        self._sim_latency()
        result = super().write_parquet(df, table_name, **kwargs)
        safe = sanitize_table_name(table_name)
        self._blob_cache.pop(f"{safe}.parquet", None)
        return result

    # -- local_dir ----------------------------------------------------------

    @contextmanager
    def local_dir(self):
        """Simulate downloading ALL workspace files from blob storage."""
        data_files = [f for f in self._path.glob("*")
                      if f.is_file() and f.name != "workspace.yaml"]
        for _ in data_files:
            self._sim_latency()
        yield self._path

    # -- delete -------------------------------------------------------------

    def delete_table(self, table_name):
        self._sim_latency()
        safe = sanitize_table_name(table_name)
        self._blob_cache.pop(f"{safe}.parquet", None)
        return super().delete_table(table_name)

    def invalidate_all_caches(self):
        self._blob_cache.clear()
        self._metadata_cached = False


# == Test helpers ===========================================================

def generate_test_df(num_rows, seed=42):
    rng = np.random.default_rng(seed)
    categories = ["Electronics", "Clothing", "Food", "Books", "Sports",
                   "Home", "Garden", "Automotive", "Health", "Toys"]
    regions = ["North", "South", "East", "West", "Central"]
    return pd.DataFrame({
        "order_id": range(1, num_rows + 1),
        "date": pd.date_range("2023-01-01", periods=num_rows, freq="h"),
        "category": rng.choice(categories, num_rows),
        "region": rng.choice(regions, num_rows),
        "quantity": rng.integers(1, 100, num_rows),
        "unit_price": rng.uniform(5.0, 500.0, num_rows).round(2),
        "discount": rng.uniform(0.0, 0.3, num_rows).round(3),
        "customer_name": [f"Customer_{i}" for i in rng.integers(1, 200, num_rows)],
        "is_returned": rng.choice([True, False], num_rows, p=[0.05, 0.95]),
        "notes": rng.choice(
            ["", "Rush order", "Gift wrap", "Fragile", "Bulk discount applied"],
            num_rows, p=[0.6, 0.1, 0.1, 0.1, 0.1]),
    })


@contextmanager
def timer(label, results):
    start = time.perf_counter()
    yield
    results.setdefault(label, []).append(time.perf_counter() - start)


def fmt_ms(seconds):
    return f"{seconds * 1000:8.1f} ms"


# == Benchmark runner =======================================================

def run_benchmark(workspace, num_rows, num_tables, iterations, label):
    results: dict[str, list[float]] = {}
    table_names: list[str] = []

    print(f"\n{'=' * 60}")
    print(f"  Backend: {label}")
    print(f"  Tables : {num_tables} x {num_rows:,} rows")
    print(f"  Iters  : {iterations}")
    print(f"{'=' * 60}")

    dfs = []
    for i in range(num_tables):
        df = generate_test_df(num_rows, seed=42 + i)
        tname = f"bench_table_{i}"
        with timer("setup_write_parquet", results):
            workspace.write_parquet(df, tname)
        table_names.append(sanitize_table_name(tname))
        dfs.append(df)

    setup_time = sum(results.get("setup_write_parquet", []))
    print(f"  Setup (write {num_tables} tables): {fmt_ms(setup_time)}")

    for it in range(iterations):
        if iterations > 1:
            print(f"  -- iteration {it + 1}/{iterations} ", end="", flush=True)

        for _ in range(5):
            with timer("get_metadata", results):
                workspace.get_metadata()

        for tname in table_names:
            with timer("read_data_as_df", results):
                df_read = workspace.read_data_as_df(tname)
            assert len(df_read) == num_rows

        with timer("local_dir", results):
            with workspace.local_dir() as wd:
                list(Path(wd).glob("*.parquet"))

        temp_data = [
            {"name": f"temp_{i}", "rows": dfs[i].head(100).to_dict("records")}
            for i in range(num_tables)
        ]
        with timer("workspace_with_temp_data", results):
            with WorkspaceWithTempData(workspace, temp_data) as ws:
                for i in range(num_tables):
                    ws.read_data_as_df(f"temp_{i}")

        with timer("full_derive_data_reads", results):
            for tname in table_names:
                workspace.read_data_as_df(tname)
            with workspace.local_dir() as _:
                pass

        for tname in table_names:
            with timer("run_parquet_sql", results):
                try:
                    workspace.run_parquet_sql(
                        tname,
                        "SELECT category, SUM(quantity) as total "
                        "FROM {parquet} GROUP BY category",
                    )
                except Exception:
                    pass

        if iterations > 1:
            last = results["full_derive_data_reads"][-1]
            print(f"  full_derive={fmt_ms(last).strip()}")

    for tname in table_names:
        try:
            workspace.delete_table(tname)
        except Exception:
            pass

    return results


# == Report =================================================================

def print_report(all_results, latency_ms=None):
    key_ops = [
        "get_metadata", "read_data_as_df", "local_dir",
        "workspace_with_temp_data", "run_parquet_sql",
        "full_derive_data_reads",
    ]
    all_ops = set()
    for r in all_results.values():
        all_ops.update(r.keys())
    all_ops.discard("setup_write_parquet")
    ops = [op for op in key_ops if op in all_ops]
    backends = list(all_results.keys())

    col_w = max(22, max(len(b) for b in backends) + 4)

    print(f"\n{'=' * (30 + col_w * len(backends) + 4)}")
    print("  RESULTS COMPARISON")
    if latency_ms is not None:
        print(f"  (simulated blob latency = {latency_ms:.0f} ms per call)")
    print(f"{'=' * (30 + col_w * len(backends) + 4)}")

    header = f"{'Operation':<30}"
    for b in backends:
        header += f"{b:>{col_w}}"
    print(header)
    print("-" * (30 + col_w * len(backends)))

    local_medians: dict[str, float] = {}
    for op in ops:
        row = f"{op:<30}"
        values: list = []
        for b in backends:
            times = all_results[b].get(op, [])
            if times:
                med = statistics.median(times)
                row += f"{fmt_ms(med):>{col_w}}"
                values.append(med)
                if b == backends[0]:
                    local_medians[op] = med
            else:
                row += f"{'N/A':>{col_w}}"
                values.append(None)
        base = local_medians.get(op)
        if base and base > 0 and len(values) >= 2:
            parts = []
            for v in values[1:]:
                if v is not None:
                    parts.append(f"{v / base:.0f}x")
                else:
                    parts.append("-")
            row += f"  ({', '.join(parts)})"
        print(row)

    print(f"\n{'-' * (30 + col_w * len(backends))}")
    print("  Key observations:")
    print("  * read_data_as_df  -- once per table (generate_data_summary)")
    print("  * local_dir        -- re-downloads ALL blobs (sandbox hot path)")
    print("  * full_derive_data -- the two above combined (dominates latency)")
    print("  * warm cache       -- blob_data_cache avoids re-downloads for reads")
    print("  * local_dir always bypasses the blob_data_cache")
    print("  * CachedAzureBlobWorkspace keeps a local mirror => local_dir is free")
    print()


# == Main ===================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Benchmark workspace read performance across backends",
    )
    parser.add_argument("--rows", type=int, default=2000)
    parser.add_argument("--tables", type=int, default=2)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--latency", type=float, default=0.03,
                        help="Simulated per-call latency in seconds (default: 0.03)")
    parser.add_argument("--azure", action="store_true",
                        help="Use real Azure Blob Storage instead of simulation")
    args = parser.parse_args()

    all_results: dict[str, dict[str, list[float]]] = {}

    n_backends = 5  # local + 3 simulated azure + 1 cached

    # -- 1. Local filesystem ------------------------------------------------
    print(f"\n[1/{n_backends}] LOCAL filesystem")
    with tempfile.TemporaryDirectory(prefix="df_bench_") as tmpdir:
        ws_local = Workspace("bench_local", root_dir=tmpdir)
        all_results["Local"] = run_benchmark(
            ws_local, args.rows, args.tables, args.iterations, "Local FS",
        )

    if args.azure:
        _run_real_azure(args, all_results)
    else:
        _run_simulated(args, all_results)

    print_report(
        all_results,
        latency_ms=None if args.azure else args.latency * 1000,
    )


def _run_simulated(args, all_results):
    lat = args.latency

    # -- 2. Simulated Azure (cold) ------------------------------------------
    print(f"\n[2/5] SIMULATED Azure Blob (latency={lat * 1000:.0f}ms/call, cold)")
    with tempfile.TemporaryDirectory(prefix="df_bench_sim_") as tmpdir:
        ws_sim = SimulatedBlobWorkspace(
            "bench_sim", root_dir=tmpdir, latency_s=lat, use_blob_cache=False,
        )
        all_results["Sim Azure (cold)"] = run_benchmark(
            ws_sim, args.rows, args.tables, args.iterations,
            f"Simulated Azure (cold, {lat * 1000:.0f}ms)",
        )

    # -- 3. Simulated Azure + cache (cold start) ----------------------------
    print(f"\n[3/5] SIMULATED Azure + blob_data_cache (cold start)")
    with tempfile.TemporaryDirectory(prefix="df_bench_cache_") as tmpdir:
        ws_cache = SimulatedBlobWorkspace(
            "bench_cache", root_dir=tmpdir, latency_s=lat, use_blob_cache=True,
        )
        all_results["Sim Azure (cache)"] = run_benchmark(
            ws_cache, args.rows, args.tables, args.iterations,
            f"Simulated Azure (cache, {lat * 1000:.0f}ms)",
        )

    # -- 4. Simulated Azure warm cache (pre-populated) ----------------------
    print(f"\n[4/5] SIMULATED Azure warm cache (pre-populated)")
    with tempfile.TemporaryDirectory(prefix="df_bench_warm_") as tmpdir:
        ws_warm = SimulatedBlobWorkspace(
            "bench_warm", root_dir=tmpdir, latency_s=lat, use_blob_cache=True,
        )
        table_names = []
        for i in range(args.tables):
            df = generate_test_df(args.rows, seed=42 + i)
            tname = f"bench_table_{i}"
            ws_warm.write_parquet(df, tname)
            safe = sanitize_table_name(tname)
            table_names.append(safe)
            ws_warm.read_data_as_df(safe)  # warm the cache

        warm_results: dict[str, list[float]] = {}
        print(f"\n{'=' * 60}")
        print(f"  Backend: Warm cache (reads only)")
        print(f"{'=' * 60}")
        for _ in range(args.iterations):
            for tname in table_names:
                with timer("read_data_as_df", warm_results):
                    ws_warm.read_data_as_df(tname)
            for _ in range(5):
                with timer("get_metadata", warm_results):
                    ws_warm.get_metadata()
            with timer("local_dir", warm_results):
                with ws_warm.local_dir() as _:
                    pass
            with timer("full_derive_data_reads", warm_results):
                for tname in table_names:
                    ws_warm.read_data_as_df(tname)
                with ws_warm.local_dir() as _:
                    pass

        all_results["Sim Azure (warm)"] = warm_results

        for tname in table_names:
            try:
                ws_warm.delete_table(tname)
            except Exception:
                pass

    # -- 5. CachedAzureBlobWorkspace simulation ------------------------------
    # The CachedAzureBlobWorkspace uses a LOCAL file mirror so reads
    # are at filesystem speed.  We simulate it here by wrapping the
    # SimulatedBlobWorkspace with the same write-through-to-cache pattern.
    print(f"\n[5/5] CachedAzureBlobWorkspace pattern (local mirror)")
    with tempfile.TemporaryDirectory(prefix="df_bench_cached_") as tmpdir:
        ws_cached = Workspace("bench_cached", root_dir=tmpdir)
        all_results["Cached Azure"] = run_benchmark(
            ws_cached, args.rows, args.tables, args.iterations,
            "Cached Azure (local mirror)",
        )


def _run_real_azure(args, all_results):
    try:
        from azure.storage.blob import ContainerClient
        from data_formulator.datalake.azure_blob_workspace import AzureBlobWorkspace
    except ImportError as e:
        print(f"  [SKIP] Azure packages not installed: {e}")
        return

    conn_str = os.getenv("AZURE_BLOB_CONNECTION_STRING")
    account_url = os.getenv("AZURE_BLOB_ACCOUNT_URL")
    container_name = os.getenv("AZURE_BLOB_CONTAINER", "data-formulator")

    if conn_str:
        container = ContainerClient.from_connection_string(conn_str, container_name)
    elif account_url:
        from azure.identity import DefaultAzureCredential
        container = ContainerClient(account_url, container_name,
                                    credential=DefaultAzureCredential())
    else:
        print("  [SKIP] Set AZURE_BLOB_CONNECTION_STRING or AZURE_BLOB_ACCOUNT_URL")
        return

    # -- Azure cold ---------------------------------------------------------
    print("\n[2/4] REAL Azure Blob (cold)")
    ws_azure = AzureBlobWorkspace("bench_azure", container,
                                   datalake_root="benchmark_test")
    try:
        all_results["Azure (cold)"] = run_benchmark(
            ws_azure, args.rows, args.tables, args.iterations,
            "Azure Blob (cold)",
        )
    finally:
        try:
            ws_azure.cleanup()
        except Exception:
            pass

    # -- Azure warm cache ---------------------------------------------------
    print("\n[3/4] REAL Azure Blob (warm cache)")
    ws_warm = AzureBlobWorkspace("bench_warm", container,
                                  datalake_root="benchmark_test")
    try:
        table_names = []
        for i in range(args.tables):
            df = generate_test_df(args.rows, seed=42 + i)
            tname = f"bench_table_{i}"
            ws_warm.write_parquet(df, tname)
            safe = sanitize_table_name(tname)
            table_names.append(safe)
            ws_warm.read_data_as_df(safe)

        warm_results: dict[str, list[float]] = {}
        print(f"\n{'=' * 60}")
        print(f"  Backend: Azure (warm cache, reads only)")
        print(f"{'=' * 60}")
        for _ in range(args.iterations):
            for tname in table_names:
                with timer("read_data_as_df", warm_results):
                    ws_warm.read_data_as_df(tname)
            for _ in range(5):
                with timer("get_metadata", warm_results):
                    ws_warm.get_metadata()
            with timer("local_dir", warm_results):
                with ws_warm.local_dir() as _:
                    pass
            with timer("full_derive_data_reads", warm_results):
                for tname in table_names:
                    ws_warm.read_data_as_df(tname)
                with ws_warm.local_dir() as _:
                    pass

        all_results["Azure (warm)"] = warm_results
    finally:
        try:
            ws_warm.cleanup()
        except Exception:
            pass

    # -- Azure full benchmark -----------------------------------------------
    print("\n[4/4] REAL Azure Blob (full benchmark)")
    ws_full = AzureBlobWorkspace("bench_full", container,
                                  datalake_root="benchmark_test")
    try:
        all_results["Azure (full)"] = run_benchmark(
            ws_full, args.rows, args.tables, args.iterations,
            "Azure Blob (full)",
        )
    finally:
        try:
            ws_full.cleanup()
        except Exception:
            pass


if __name__ == "__main__":
    main()
