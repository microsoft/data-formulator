## Data Loader Module

This module provides a framework for loading data from various external sources into DuckDB. It follows an abstract base class pattern to ensure consistent implementation across different data sources.

### Building a New Data Loader

The abstract class `ExternalDataLoader` defines the data loader interface. Each concrete implementation (e.g., `KustoDataLoader`, `MySQLDataLoader`) handles specific data source connections and data ingestion.

To create a new data loader:

1. Create a new class that inherits from `ExternalDataLoader`
2. Implement the required abstract methods:
   - `list_params()`: Define required connection parameters
   - `__init__()`: Initialize connection to data source
   - `list_tables()`: List available tables/views
   - `ingest_data()`: Load data from source
   - `view_query_sample()`: Preview query results
   - `ingest_data_from_query()`: Load data from custom query
3. Register the new class into `__init__.py` so that the front-end can automatically discover the new data loader.

The UI automatically provide the query completion option to help user generate queries for the given data loader (from NL or partial queries).

### Example Implementations

- `KustoDataLoader`: Azure Data Explorer (Kusto) integration
- `MySQLDataLoader`: MySQL database integration

### Testing

Ensure your implementation:
- Handles connection errors gracefully
- Properly sanitizes table names
- Respects size limits for data ingestion
- Returns consistent metadata format

Launch the front-end and test the data loader.