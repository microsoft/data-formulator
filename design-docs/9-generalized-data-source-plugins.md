# Generalized Data Source Plugins — Remaining Design Notes

## Status: Slimmed (implementation complete, remaining work tracked separately)

This document used to be the full design for unifying `ExternalDataLoader`,
`DataSourcePlugin`, and Superset-specific plugin code. The implemented system has
now moved into official documentation:

- `dev-guides/3-data-loader-development.md` — `ExternalDataLoader` contract,
  catalog browsing, `source_filters`, column values, tests.
- `dev-guides/5-data-connector-api.md` — `DataConnector` API, connector
  instances, `connectors.yaml`, `DF_SOURCES__*`, identity isolation.
- `dev-guides/4-authentication-oidc-tokenstore.md` — OIDC, TokenStore, loader
  `auth_config()`, delegated token flow.
- `docs-cn/1-data-source-connections.md` — user-facing Load Data, Add
  Connection, preview/import/refresh, disconnect/delete.
- `docs-cn/6-credential-vault.md` — current Credential Vault behavior.
- `docs-cn/7-server-migration-guide.md` — migration checklist for connector
  config, credentials, plugin directories, and user workspaces.

The large historical design has been removed from this file to prevent drift.
Only the remaining decisions and sub-document status are kept here.

---

## Implemented Architecture

Current implementation:

```text
ExternalDataLoader
  - source-specific driver: connect, catalog, fetch Arrow data
  - lives in py-src/data_formulator/data_loader/

DataConnector
  - lifecycle/API wrapper: connect, status, catalog, preview, import, refresh
  - shared blueprint under /api/connectors/*
  - lives in py-src/data_formulator/data_connector.py

TokenStore + CredentialVault
  - resolves service tokens, SSO exchange, delegated login, static credentials
  - stores sensitive credentials outside connector metadata

Frontend Load Data UI
  - promoted data source cards
  - Add Connection flow
  - generic catalog browser and preview/import panels
```

Legacy `DataSourcePlugin` and the old `plugins/` directories have been removed.
Superset is now implemented as `SupersetLoader` and flows through the same
`DataConnector` APIs as database and file loaders.

---

## Migrated Sub-Docs

| Doc | Status | Where the content lives now |
|-----|--------|-----------------------------|
| 9.1 Connection Model | Migrated, deleted | `dev-guides/5-data-connector-api.md`, `docs-cn/6-credential-vault.md`, `docs-cn/7-server-migration-guide.md` |
| 9.3 Promoted Data Source Cards | Migrated, deleted | `dev-guides/5-data-connector-api.md`, `docs-cn/1-data-source-connections.md` |

---

## Active Sub-Docs

| Doc | Status | Notes |
|-----|--------|-------|
| [9.2 TableGroup Bundle Loading](9.2-table-group-bundle-loading.md) | Partially implemented | `table_group`, Superset dashboard groups, group import API, and frontend group panel exist. Shared dashboard filter UI is not fully wired. |

---

## Remaining Work

### TableGroup / BI Dashboard Imports

Already implemented:

- `CatalogNode.node_type="table_group"` exists in `ExternalDataLoader`.
- `SupersetLoader` emits dashboard nodes as `table_group`.
- `DBTableManager` renders a `GroupLoadPanel`.
- `/api/connectors/import-group` imports selected member datasets.
- `source_filters` can be applied per member table by backend when provided.

Still remaining:

- Extract and expose richer dashboard-native filter metadata in a stable UI
  contract.
- Let the frontend group import panel collect shared filter values and send
  `source_filters` to `/api/connectors/import-group`.
- Decide how group imports should show partial failures and filter provenance in
  workspace metadata.

### Source Filter Capabilities

The generic `source_filters` payload is partially implemented and tracked in
`13-unified-source-filters-plan.md`.

Already implemented:

- PostgreSQL and MySQL compile `source_filters`.
- Superset keeps a platform-specific compiler.
- `ConnectorTablePreview` sends `import_options.source_filters`.

Still remaining:

- Formal connector capability flag for source-side filters.
- Frontend gating of filter UI by connector capability.
- BigQuery, Athena, MSSQL, Kusto, MongoDB, and file-based loader strategies.

### Future Data Source Work

Candidate follow-ups:

- Scheduled refresh and incremental refresh.
- Connection sharing and admin-managed team policies beyond read-only admin
  connectors.
- Metabase, Grafana, Power BI, or Tableau loaders.
- Cross-database / cross-connector analysis flows.

---

## Current Source Of Truth

Use the official docs above for implementation and user behavior. Treat this
file only as the remaining roadmap for unfinished generalized data source work.
