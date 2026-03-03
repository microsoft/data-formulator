## Data Loader Module

This module provides a framework for loading data from various external sources into the **workspace** (parquet files). It follows an abstract base class pattern so all loaders behave consistently.

### Design

- **Storage**: Ingested data is written as **parquet** in the workspace. DuckDB is **not** used for storage; it is only the computation engine elsewhere in the application.
- **Data flow**: **External source → PyArrow Table → Parquet (workspace)**.
- **Format**: Loaders use **PyArrow** as the standard in-memory format for speed and interoperability. Database loaders (PostgreSQL, MySQL, MSSQL) use **connectorx** for Arrow-native reads where applicable.

### Building a New Data Loader

The abstract class `ExternalDataLoader` defines the interface. Each concrete implementation (e.g., `MySQLDataLoader`, `S3DataLoader`) handles one data source.

To add a new data loader:

1. Create a class that inherits from `ExternalDataLoader`.
2. Implement the required pieces:
   - **`list_params()`** (static): Connection parameters (names, types, defaults, descriptions).
   - **`auth_instructions()`** (static): Short instructions for obtaining credentials/setup.
   - **`__init__(self, params)`**: Validate params and establish or verify connection to the source. No `duck_db_conn`; storage is workspace-only.
   - **`fetch_data_as_arrow(source_table, size=..., sort_columns=..., sort_order=...)`**: Fetch data from the source and return a `pyarrow.Table`. Only `source_table` (table/collection/file identifier) is supported; raw query strings are not accepted for security and dialect consistency.
   - **`list_tables(table_filter=None)`**: Return a list of `{"name": ..., "metadata": {...}}` for tables/files the user can select. Metadata typically includes `row_count`, `columns`, and `sample_rows`.
3. Register the new class in the package `__init__.py` so the front-end can discover it.

The base class provides **`ingest_to_workspace(workspace, ...)`**, which calls `fetch_data_as_arrow()` and writes the result to the workspace as parquet. You do not implement ingest logic in the loader.

The UI uses the same loaders for connection setup, table listing, and ingestion into the workspace.

### Example Implementations

- **`AthenaDataLoader`**: AWS Athena (SQL on S3 data lakes)
- **`BigQueryDataLoader`**: Google BigQuery
- **`KustoDataLoader`**: Azure Data Explorer (Kusto)
- **`MySQLDataLoader`**: MySQL (connectorx)
- **`PostgreSQLDataLoader`**: PostgreSQL (connectorx)
- **`MSSQLDataLoader`**: Microsoft SQL Server (connectorx)
- **`S3DataLoader`**: Amazon S3 files (CSV, Parquet, JSON) via PyArrow S3 filesystem
- **`AzureBlobDataLoader`**: Azure Blob Storage via PyArrow
- **`MongoDBDataLoader`**: MongoDB

### Testing

When implementing or changing a loader:

- Handle connection and read errors clearly (e.g., raise `ValueError` with a clear message).
- Sanitize or validate table/object names where appropriate.
- Respect the `size` limit (and optional sort) in `fetch_data_as_arrow`.
- Return the same metadata shape from `list_tables()` (e.g., `row_count`, `columns`, `sample_rows`) so the UI behaves consistently.

Test via the front-end: configure the loader, list tables, and run an ingest into the workspace; then confirm parquet appears in the workspace and DuckDB (or other engines) can read it for computation.
