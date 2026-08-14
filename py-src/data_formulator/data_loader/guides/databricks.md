**Connection**

In Databricks, open **SQL → SQL Warehouses → your warehouse → Connection details**. Copy `server_hostname` and `http_path`.

**Credentials**

Open **Settings → Developer → Access tokens** and create a personal access token. Tokens commonly start with `dapi`.

**Access**

The token's user needs `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the Unity Catalog objects you want to read. The SQL warehouse must be running or able to start.

**Scope**

Leave `catalog` and `schema` empty to browse everything you can access, or enter them to open a specific schema directly.
