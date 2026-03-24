# Backend Integration Tests

This directory contains backend integration tests.

Good candidates for this layer:

- Flask route tests
- table create / ingest / refresh flows
- real workspace and datalake interactions

Recommended first scenarios:

1. Create a table using a Chinese table name.
2. Verify the returned `table_name` after creation.
3. Verify that Chinese column names are preserved across stats, preview, and refresh flows.
