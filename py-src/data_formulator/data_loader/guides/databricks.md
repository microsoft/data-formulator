**Example**

server_hostname: `dbc-a1b2c3d4-e5f6.cloud.databricks.com` · http_path: `/sql/1.0/warehouses/abc123`

**Connection**

In Databricks, open **SQL Warehouses**, choose your warehouse, and copy `server_hostname` and `http_path` from **Connection details**.

**Credentials**

Create a personal access token under **Settings → Developer → Access tokens**. It starts with `dapi`.

**Access**

The token's user needs `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the tables you want to read.

**Scope**

Leave `catalog` and `schema` empty to browse everything, or set them to open one schema directly.
