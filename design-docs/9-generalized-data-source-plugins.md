# Generalized Data Source Plugins — Unifying DataLoader + Plugin into a Lifecycle-Managed Connection

## Status: Phase 3 complete (legacy data-loader endpoints removed)

## 1. Problem

We have **two separate abstractions** for loading external data:

| Abstraction | Example | Auth | Catalog Browsing | Refresh | Session Lifecycle |
|-------------|---------|------|-------------------|---------|-------------------|
| **ExternalDataLoader** | MySQL, PostgreSQL, Kusto, BigQuery, S3 | One-shot (params in request) | `list_tables()` per request | Manual re-import | None — stateless |
| **DataSourcePlugin** | Superset | Full (login/session/vault) | Rich catalog with caching | Not implemented | Full — session, token refresh |

This split causes problems:

1. **No persistent connections for databases.** A user who connects to PostgreSQL to browse tables must re-send credentials every time. There's no "logged into Postgres" state.
2. **No refresh.** Once a table is imported from MySQL, there's no way to re-pull the latest data without manually re-entering connection details.
3. **The Superset plugin is over-specialized.** It hard-codes dashboard/dataset concepts. Meanwhile, Kusto, PostgreSQL, MySQL all need the same pattern (auth → browse catalog → filter → import → refresh) but don't have it.
4. **Plugin naming is BI-centric.** `DataSourcePlugin` was designed for BI platforms (Superset, Metabase), but the real need is broader: any system you can authenticate into and continuously pull data from.

### The Key Insight

A DataLoader already knows *how* to talk to a data source (connect, list tables, fetch data). A Plugin knows *how* to manage a session (login, persist auth, browse, present UI). **Combining them gives us a lifecycle-managed data connection** — which is what users actually want.

## 2. Proposal: `DataConnector` — A Generalized Plugin Built from a DataLoader

### 2.1 Core Idea

Define a **generic plugin factory** that takes any `ExternalDataLoader` class and automatically wraps it with:

- **Session management** — persistent connection state (logged in / not)
- **Catalog browsing** — `list_tables()` exposed as a browsable tree
- **Filtered import** — column selection + row limits
- **Refresh** — re-fetch a previously imported table with the same parameters
- **Auto-discovery** — same env-var gating as existing plugins

This means: to add "PostgreSQL as a connected data source," you write **zero new plugin code**. The existing `PostgreSQLDataLoader` is automatically promoted to a full plugin with auth, catalog, refresh, and UI.

### 2.2 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DataConnector                       │
│              (generic plugin framework)                      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │  Auth Layer   │  │ Catalog Layer│  │  Data Layer       │ │
│  │              │  │              │  │                   │ │
│  │ • login()    │  │ • list()     │  │ • load()          │ │
│  │ • logout()   │  │ • detail()   │  │ • refresh()       │ │
│  │ • status()   │  │ • search()   │  │ • preview()       │ │
│  │ • refresh()  │  │ • tree()     │  │                   │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘ │
│         │                 │                    │            │
│         └─────────────────┼────────────────────┘            │
│                           │                                 │
│                   ┌───────▼────────┐                        │
│                   │ ExternalData   │                        │
│                   │ Loader         │                        │
│                   │ (existing)     │                        │
│                   └────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 The Unification: Databases and BI Tools Are Both Hierarchical Data Sources

From DF's perspective, **every external data source is the same thing**: an authenticated system with a hierarchical catalog whose leaf nodes are importable tables. The only difference is what the intermediate levels are called:

| Source Type | Hierarchy | Leaf Node |
|-------------|-----------|----------|
| MySQL | `server → database → table` | table |
| PostgreSQL | `server → database → schema → table` | table / view |
| BigQuery | `project → dataset → table` | table / view |
| Kusto | `cluster → database → table` | table |
| S3 | `bucket → prefix → object` | CSV/Parquet file |
| **Superset** | `instance → dashboard → dataset` | dataset (= filtered table) |
| **Metabase** | `instance → collection → question` | question (= query result) |
| **Grafana** | `instance → datasource → query` | query result |

The core user loop is always: **connect → browse tree → pick leaf → import → refresh.**

This means we don't need separate abstractions for "BI plugin" vs. "database plugin." We unify them:

| Component | Change |
|-----------|--------|
| `ExternalDataLoader` | **Evolves** into the universal data protocol. Gains `catalog_hierarchy()` + `ls()` + `effective_hierarchy()` for tree browsing with scope pinning. |
| `DataSourcePlugin` | **Stays** as the abstract base, but now primarily implemented via `DataConnector`. |
| **New: `DataConnector`** | Generic `DataSourcePlugin` subclass that wraps any `ExternalDataLoader`. Auto-generates auth/catalog/data routes. |
| **New: `DataConnectorPanel`** | Generic React component for all connected data sources (login → tree browser → import). |
| `SupersetPlugin` | **Migrates** to a `DataConnector` backed by a `SupersetLoader`. Dashboards are `"namespace"` nodes, datasets are `"table"` nodes — hierarchy labels provide the UI terminology. |

## 3. API Design

### 3.1 Backend: `DataConnector` Base

```python
class DataConnector(DataSourcePlugin):
    """A DataSourcePlugin auto-generated from an ExternalDataLoader.
    
    Provides lifecycle management: connection persistence, catalog browsing,
    filtered import, and refresh — all driven by the underlying loader.
    """
    
    # Subclass must set these (or override manifest())
    LOADER_CLASS: type[ExternalDataLoader]     # e.g., PostgreSQLDataLoader
    SOURCE_ID: str                              # e.g., "postgresql"
    SOURCE_NAME: str                            # e.g., "PostgreSQL"
    
    # ----- Auto-generated manifest from loader metadata -----
    
    @staticmethod
    def manifest() -> dict:
        """Built from LOADER_CLASS.list_params() + SOURCE_ID."""
        return {
            "id": cls.SOURCE_ID,
            "name": cls.SOURCE_NAME,
            "env_prefix": f"PLG_{cls.SOURCE_ID.upper()}",
            "required_env": [],   # DB plugins enabled by default (user provides creds at runtime)
            "auth_modes": ["password"],
            "capabilities": ["tables", "refresh"],
        }
    
    # ----- Auth Routes (auto-generated) -----
    # POST /api/plugins/{id}/auth/connect      — validate & persist connection
    # POST /api/plugins/{id}/auth/disconnect    — tear down connection
    # GET  /api/plugins/{id}/auth/status        — is connection alive?
    
    # ----- Catalog Routes (auto-generated) -----
    # POST /api/plugins/{id}/catalog/ls         — list children at a path (lazy)
    # POST /api/plugins/{id}/catalog/metadata   — get metadata for one node
    
    # ----- Data Routes (auto-generated) -----
    # POST /api/plugins/{id}/data/import        — fetch & import to workspace
    # POST /api/plugins/{id}/data/refresh       — re-import with stored params
    # POST /api/plugins/{id}/data/preview       — fetch first N rows for preview
```

### 3.2 The Full API Surface

#### 3.2.1 Auth / Connection Management

```
POST /api/plugins/{id}/auth/connect
  Body: { params: { host, port, user, password, database, ... } }
  Response: { status: "connected", user: "...", server: "...", database: "..." }
  Side-effect: Validates connection, stores params in session (+ vault if available)

POST /api/plugins/{id}/auth/disconnect
  Response: { status: "disconnected" }
  Side-effect: Clears session + vault

GET /api/plugins/{id}/auth/status
  Response: { 
    connected: true/false,
    user: "...",
    server: "...",
    database: "...",
    params_form: [...]   // list_params() for the login form if not connected
  }
  Side-effect: If session empty but vault has creds → auto-reconnect
```

**Note on auth diversity:** "Connecting" means different things for different sources. For traditional databases it's validating host/user/password (e.g., `SELECT 1`). For cloud databases it may be OAuth (Azure AD for Kusto, IAM for AWS RDS). For BI tools it's obtaining a JWT. The framework doesn't care — the loader's `list_params()` declares what it needs, and the `auth_mode()` (see §6.3) tells the framework whether to persist a connection object or a token. The generic connection form renders whatever params the loader declares (password fields, file pickers for service account keys, OAuth redirect buttons, etc.).

#### 3.2.2 Catalog Browsing (Tree-Based)

The catalog is a **lazy tree** that mirrors the data source's natural hierarchy (see §3.4 for full design). Each expand in the UI triggers one API call.

We use **POST** for catalog APIs (not GET) because:
- `path` is structured data (JSON array) that may contain special characters (dots, spaces in dashboard names)
- The request body will grow as we add filters, pagination, and import context
- Catalog results are not cacheable — the source data changes

```
POST /api/plugins/{id}/catalog/ls
  Body: {
    path: [],                       // JSON array: [] = root, ["mydb"], ["mydb","public"]
    filter: "...",                  // optional name filter
  }
  Response: {
    hierarchy: ["database", "schema", "table"],  // source's level labels (from catalog_hierarchy)
    effective_hierarchy: ["schema", "table"],     // browsable levels (pinned levels removed)
    path: [],
    nodes: [
      { name: "analytics", node_type: "namespace", path: ["analytics"],
        metadata: { table_count: 42 } },
      { name: "production", node_type: "namespace", path: ["production"],
        metadata: { table_count: 15 } },
      ...
    ]
  }

POST /api/plugins/{id}/catalog/ls
  Body: { path: ["production", "public"] }
  Response: {
    hierarchy: ["database", "schema", "table"],
    effective_hierarchy: ["schema", "table"],
    path: ["production", "public"],
    nodes: [
      { name: "users", node_type: "table", path: ["production","public","users"],
        metadata: { row_count: 150000, columns: [...] } },
      ...
    ]
  }

POST /api/plugins/{id}/catalog/metadata
  Body: { path: ["production", "public", "users"] }
  Response: {
    name: "users",
    path: ["production", "public", "users"],
    node_type: "table",
    columns: [...],              // full column detail
    row_count: 150000,
    sample_rows: [...],          // first 5 rows for preview
    description: "...",          // table comment if available
  }
```

**How this maps to `ExternalDataLoader`:** The `ls(path)` method (§3.4) drives every tree expansion. `DataConnector` adds caching (per-session, with TTL) on top.

#### 3.2.3 Data Loading + Refresh

```
POST /api/plugins/{id}/data/import
  Body: {
    source_table: "public.users",
    table_name: "users",          // name in workspace (optional, auto-generated)
    size: 50000,                  // row limit
    sort_columns: ["created_at"],
    sort_order: "desc",
    columns: ["id", "email", "name"],  // column selection (optional)
  }
  Response: {
    table_id: "tbl_abc123",
    table_name: "users",
    row_count: 50000,
    columns: [...],
    refreshable: true,
    refresh_params: { ... }       // stored for later refresh
  }

POST /api/plugins/{id}/data/refresh
  Body: {
    table_id: "tbl_abc123",       // workspace table to refresh
  }
  Response: {
    table_id: "tbl_abc123",
    row_count: 52000,             // may differ from original
    refreshed_at: "2026-04-13T10:30:00Z"
  }
  Side-effect: Re-runs the same fetch with stored params, overwrites parquet

POST /api/plugins/{id}/data/preview
  Body: {
    source_table: "public.users",
    columns: ["id", "email"],     // optional column selection
    size: 10                      // small preview
  }
  Response: {
    columns: [...],
    rows: [...]                   // first N rows
  }
```

### 3.3 Refresh Mechanism

Refresh is a first-class concept. When a table is imported via a `DataConnector`, the workspace metadata stores:

```python
{
    "table_id": "tbl_abc123",
    "table_name": "users",
    "source": {
        "plugin_id": "postgresql",          # which plugin
        "source_table": "public.users",     # what was fetched
        "size": 50000,
        "sort_columns": ["created_at"],
        "sort_order": "desc",
        "columns": ["id", "email", "name"], # column selection
        "fetched_at": "2026-04-13T10:00:00Z"
    },
    "refreshable": True
}
```

On refresh:
1. Check if the plugin connection is still alive (auto-reconnect via vault if needed)
2. Re-run `loader.fetch_data_as_arrow()` with stored params
3. Overwrite the parquet file in workspace
4. Update `fetched_at` timestamp
5. Notify frontend of updated row count / schema changes

### 3.4 Hierarchical Catalog Exploration

#### The Problem with Single-Database Loaders

Current loaders are scoped to a single database at init time:

| Loader | Init Scope | `list_tables()` Sees | Natural Full Hierarchy |
|--------|-----------|---------------------|------------------------|
| MySQL | `host + database` | Tables in that one DB | `server → database → table` |
| PostgreSQL | `host + database` | Schemas + tables in one DB | `server → database → schema → table` |
| MSSQL | `server + database` | Schemas + tables in one DB | `server → database → schema → table` |
| Kusto | `cluster + database` | Tables in that one DB | `cluster → database → table` |
| BigQuery | `project (+ dataset)` | Datasets + tables | `project → dataset → table` |
| MongoDB | `host + database` | Collections in one DB | `server → database → collection` |
| S3 | `bucket` | Keys in that bucket | `bucket → prefix → object` |

This means a user exploring a MySQL server with 10 databases must disconnect and reconnect 10 times. That's friction we should eliminate.

#### Proposed: Tree-Based Catalog Model

Instead of the flat `list_tables()` → `[table, table, ...]` model, introduce a **tree-based catalog** where loaders declare their hierarchy and support lazy expansion at each level:

```python
@dataclass
class CatalogNode:
    """A node in the data source's catalog tree.
    
    Only two kinds of node:
    - "namespace" — expandable container (database, schema, bucket, dashboard, …).
      The hierarchy's "label" tells the UI what to call it.
    - "table" — importable leaf (table, file, dataset, …).
    
    The *level name* (e.g. "Database", "Schema") comes from
    catalog_hierarchy(), not from the node itself.
    """
    name: str                        # Display name ("public", "users", "events")
    node_type: str                   # "namespace" or "table"
    path: list[str]                  # Full path from root: ["mydb", "public", "users"]
    metadata: dict | None = None     # Row count, column info, description, etc.
```

This follows the **Iceberg REST / Unity Catalog convention**: every container is a `namespace`, every importable unit is a `table`. The hierarchy labels (what to call each level in the UI) come from `catalog_hierarchy()`, keeping the node model itself minimal and universal.

Each data source declares its hierarchy as a sequence of **level descriptors** — each with a type key and the display label users see:

```python
class ExternalDataLoader(ABC):
    
    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        """Declare the levels in this source's catalog tree.
        
        Returns ordered list from root to leaf. Each entry has:
          - "key":   internal identifier (used in params, APIs)
          - "label": user-facing display name
        
        The last level is always the importable unit (table/file/dataset).
        
        Examples:
            MySQL:
                [{"key": "database", "label": "Database"},
                 {"key": "table",    "label": "Table"}]
            
            PostgreSQL:
                [{"key": "database", "label": "Database"},
                 {"key": "schema",   "label": "Schema"},
                 {"key": "table",    "label": "Table"}]
            
            BigQuery:
                [{"key": "project",  "label": "Project"},
                 {"key": "dataset",  "label": "Dataset"},
                 {"key": "table",    "label": "Table"}]
            
            Superset:
                [{"key": "dashboard", "label": "Dashboard"},
                 {"key": "dataset",   "label": "Dataset"}]
            
            S3:
                [{"key": "bucket",  "label": "Bucket"},
                 {"key": "prefix",  "label": "Folder"},
                 {"key": "object",  "label": "File"}]
        
        Default: [{"key": "table", "label": "Table"}] (flat).
        """
        return [{"key": "table", "label": "Table"}]
```

The keys serve double duty: they match the parameter names in `list_params()` (see §3.4.2 Scope Pinning), and the labels are what users see in the tree UI — so each source presents its own natural terminology.

#### Lazy Expansion API

Browsing happens **one level at a time**, like expanding directories in a file browser. The loader only fetches children when the user expands a node:

```python
class ExternalDataLoader(ABC):
    
    def ls(
        self,
        path: list[str] | None = None,
        filter: str | None = None,
    ) -> list[CatalogNode]:
        """List children at a catalog path (like `ls` in a filesystem).
        
        path is relative to the *effective* (unpinned) hierarchy.
        
        * path=[] — list nodes at the first browsable level.
        * path=["public"] — expand that node one level deeper.
        
        Nodes are either "namespace" (expandable) or "table" (importable leaf).
        The hierarchy's label tells the UI what to call each level.
        
        Args:
            path: Path to list, as a list of names at each level.
                  None or [] = root level.
            filter: Optional name filter (substring match).
        
        Returns:
            Children at the given path.
        
        Examples:
            MySQL (database not pinned):
              ls([])                    → [CatalogNode("mydb", "namespace", ["mydb"])]
              ls(["mydb"])              → [CatalogNode("users", "table", ["mydb","users"])]
            
            PostgreSQL (database not pinned):
              ls([])                    → [CatalogNode("analytics", "namespace", ["analytics"])]
              ls(["analytics"])         → [CatalogNode("public", "namespace", ["analytics","public"])]
              ls(["analytics","public"])→ [CatalogNode("users", "table", ["analytics","public","users"])]
            
            PostgreSQL (database="analytics" pinned → effective hierarchy is schema→table):
              ls([])                    → [CatalogNode("public", "namespace", ["public"])]
              ls(["public"])            → [CatalogNode("users", "table", ["public","users"])]
            
            BigQuery (project pinned):
              ls([])                    → [CatalogNode("sales", "namespace", ["sales"])]
              ls(["sales"])             → [CatalogNode("orders", "table", ["sales","orders"])]
        """
        pass
```

#### Scope Pinning: Pre-Configuring the Starting Level

Not every user should browse from the top. An admin might restrict a deployment to one database, or a user might only care about one schema. **Scope pinning** lets connection params fix one or more hierarchy levels, so the tree starts deeper:

```
Full hierarchy (MySQL):     server → database → table
Pinned to database="mydb":  server → table           (user sees tables directly)

Full hierarchy (PostgreSQL): server → database → schema → table
Pinned to database="prod":   server → schema → table
Pinned to db+schema:         server → table
```

This works naturally because hierarchy level keys match parameter names in `list_params()`. When a connection param matches a hierarchy level key, that level is pinned and hidden from browsing:

```python
# MySQL — no pinning: user browses databases → tables
MySQLDataLoader({"host": "db.example.com", "user": "me", "password": "..."})
# ls([])          → [CatalogNode("mydb", "namespace", ["mydb"]), CatalogNode("other", "namespace", ["other"])]
# ls(["mydb"])    → [CatalogNode("users", "table", ["mydb","users"]), ...]

# MySQL — database pinned: user sees tables directly
MySQLDataLoader({"host": "db.example.com", "user": "me", "password": "...", "database": "mydb"})
# ls([])          → [CatalogNode("users", "table", ["users"]), ...]  (database level skipped)

# PostgreSQL — database pinned, schema free: user browses schemas → tables
PostgreSQLDataLoader({"host": "...", "user": "...", "password": "...", "database": "prod"})
# ls([])          → [CatalogNode("public", "namespace", ["public"]), CatalogNode("analytics", "namespace", ["analytics"])]
# ls(["public"])  → [CatalogNode("users", "table", ["public","users"]), ...]

# BigQuery — project pinned: user browses datasets → tables
BigQueryDataLoader({"project": "my-gcp-project"})
# ls([])          → [CatalogNode("sales", "namespace", ["sales"]), ...]
```

The loader determines the **effective hierarchy** at connection time:

```python
class ExternalDataLoader(ABC):
    def effective_hierarchy(self) -> list[dict[str, str]]:
        """Remove pinned levels from the catalog hierarchy.
        
        A level is pinned when the user provided a non-empty value for its
        key in the connection params (e.g., database="prod" pins the database level).
        """
        params = getattr(self, "params", {}) or {}
        full = self.catalog_hierarchy()
        return [level for level in full if not params.get(level["key"])]
    
    def pinned_scope(self) -> dict[str, str]:
        """Return {level_key: value} for every pinned hierarchy level."""
        params = getattr(self, "params", {}) or {}
        return {
            level["key"]: params[level["key"]]
            for level in self.catalog_hierarchy()
            if params.get(level["key"])
        }
```

**How pinning is configured:**

| Who | How | Example |
|-----|-----|---------|
| **Admin (env vars)** | Pre-fill params via `PLG_{ID}_{PARAM}` env vars. User never sees these fields. | `PLG_MYSQL_HOST=db.internal PLG_MYSQL_DATABASE=analytics` → users only see tables in `analytics` |
| **Admin (connection form)** | Mark params as `hidden` in `list_params()` when env var provides the value | Same as above, but the form shows remaining fields only |
| **User (connection form)** | Fill in or leave blank optional scope params | Leave `database` empty → browse all; fill it in → pinned to that DB |

#### How `list_params()` Supports Scope Pinning

```python
@staticmethod
def list_params() -> list[dict[str, Any]]:
    return [
        {"name": "host", "type": "string", "required": True, "description": "Database host"},
        {"name": "port", "type": "number", "required": True, "default": 3306},
        {"name": "user", "type": "string", "required": True},
        {"name": "password", "type": "password", "required": True},
        # Scope params: match hierarchy level keys. Optional = user can browse that level.
        {"name": "database", "type": "string", "required": False,
         "scope_level": True,   # <-- marks this as a hierarchy scope param
         "description": "Database (leave empty to browse all databases)"},
    ]
```

The `scope_level: True` flag tells the framework this param corresponds to a catalog hierarchy level. When provided, it pins that level. When empty, the user browses it.

#### Catalog API Endpoints (Revised)

All catalog endpoints use **POST** with JSON body (see §3.2.2 for rationale):

```
POST /api/plugins/{id}/catalog/ls
  Body: { path: ["mydb", "public"], filter: "..." }
  Response: {
    hierarchy: ["database", "schema", "table"],   // from catalog_hierarchy()
    effective_hierarchy: ["schema", "table"],      // browsable levels (pinned removed)
    path: ["mydb", "public"],
    nodes: [
      {
        name: "users",
        node_type: "table",
        path: ["mydb", "public", "users"],
        metadata: { row_count: 150000, columns: [...] }
      },
      {
        name: "orders",
        node_type: "table", 
        path: ["mydb", "public", "orders"],
        metadata: { row_count: 1200000, columns: [...] }
      }
    ]
  }
```

#### Tree Rendering with Scope Pinning

The same source looks different depending on what's pinned:

**Unpinned (user browses full hierarchy):**
```
▾ 📂 MySQL — db.example.com (connected)
  ▸ 📁 analytics                          ← database level
  ▾ 📁 production                         ← database level (expanded)
      users              (150k rows) [⊕]  ← table level (leaf)
      orders             (1.2M rows) [⊕]
      products           (5k rows)   [⊕]
  ▸ 📁 staging
```

**Pinned to `database=production` (admin or user pre-configured):**
```
▾ 📂 MySQL — db.example.com / production (connected)
      users              (150k rows) [⊕]  ← table level (leaf, top-level)
      orders             (1.2M rows) [⊕]
      products           (5k rows)   [⊕]
```

**PostgreSQL — pinned to `database=reporting`, schema browsable:**
```
▾ 📂 PostgreSQL — warehouse.corp / reporting (connected)
  ▾ 📁 public                           ← schema level (now top-level)
      monthly_revenue  (3k rows)   [⊕]
      customer_ltv     (50k rows)  [⊕]
  ▸ 📁 internal
```

**BigQuery — unpinned:**
```
▾ 📂 BigQuery — my-gcp-project (connected)
  ▾ 📁 sales_dataset                      ← dataset level
      transactions       (10M rows)  [⊕]
      returns            (500k rows) [⊕]
  ▸ 📁 analytics_dataset
```

**Superset — unpinned:**
```
▾ 📂 Superset — bi.company.com (connected)
  ▾ 📊 Q3 Sales Dashboard                 ← dashboard level
      orders_fact        (150k rows) [⊕]
      product_dim        (2k rows)   [⊕]
  ▸ 📊 Customer Analytics
  ▸ 📁 Ungrouped Datasets
```

Each expand click triggers a lazy `ls(path)` call — no upfront loading of the entire catalog. The framework computes `effective_hierarchy()` at connection time to know how many levels to render.

### 3.5 Revised `ExternalDataLoader` Interface

The full loader interface after the redesign. The catalog API methods (`catalog_hierarchy`, `ls`, `get_metadata`, `test_connection`) have **default implementations** on the base class so loaders can be upgraded incrementally — un-upgraded loaders still work via fallback to `list_tables()`.

```python
class ExternalDataLoader(ABC):
    """Universal data source driver.
    
    Required interface for all data sources (databases, BI tools, cloud storage).
    """
    
    # ----- Connection -----
    
    @abstractmethod
    def __init__(self, params: dict[str, Any]):
        """Initialize with connection parameters."""
        pass
    
    def test_connection(self) -> bool:
        """Validate the connection is alive. Used by auth/status.
        Default: tries list_tables(). Subclasses should override with
        something cheaper (e.g. SELECT 1)."""
        ...
    
    def get_safe_params(self) -> dict[str, Any]:
        """Connection params with secrets removed. For metadata storage."""
        ...  # existing implementation
    
    # ----- Catalog (new — all have defaults for backward compat) -----
    
    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        """Declare the *full* hierarchy of this data source.
        
        Each entry: {"key": "database", "label": "Database"}
        Last level is always the importable leaf (table/dataset/file).
        Default: [{"key": "table", "label": "Table"}] (flat).
        """
        return [{"key": "table", "label": "Table"}]
    
    def effective_hierarchy(self) -> list[dict[str, str]]:
        """Browsable hierarchy — full minus pinned levels.
        A level is pinned when its key matches a non-empty connection param."""
        ...
    
    def pinned_scope(self) -> dict[str, str]:
        """Return {level_key: value} for every pinned hierarchy level."""
        ...
    
    def ls(
        self,
        path: list[str] | None = None,
        filter: str | None = None,
    ) -> list[CatalogNode]:
        """List children at a catalog path (like `ls` in a filesystem).
        
        path is relative to the effective (unpinned) hierarchy.
        Returns CatalogNode with node_type "namespace" or "table".
        Default: falls back to list_tables() at the root level.
        """
        ...
    
    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        """Get detailed metadata for a node (columns, row count, sample rows).
        Default: finds the node via ls() and returns its metadata dict."""
        ...
    
    # ----- Flat listing (always available) -----
    
    @abstractmethod
    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List all accessible tables within the pinned scope (flat/eager).
        
        The simple, complete way to see everything the user can access.
        Potentially slow for large catalogs — ls() is the lazy alternative.
        Both coexist permanently; ls() falls back to this by default."""
        pass
    
    # ----- Data Fetching -----
    
    @abstractmethod
    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict | None = None,
    ) -> pa.Table:
        """Fetch data from the external source as a PyArrow Table.
        
        import_options is a single extensible dict:
            - size (int): row limit (default: 1000000)
            - columns (list[str]): column projection
            - sort_columns (list[str]): ordering
            - sort_order (str): 'asc' or 'desc'
            - filters (list[dict]): standard SPJ filters
            - source_filters (dict): BI-tool-specific filters (from CatalogNode.metadata)
        """
        pass
    
    def fetch_preview(
        self,
        source_table: str,
        import_options: dict | None = None,
    ) -> pa.Table:
        """Fetch a small preview. Default: delegates to fetch_data_as_arrow.
        
        Loaders can override for efficiency (e.g., TABLESAMPLE).
        """
        opts = {"size": 10, **(import_options or {})}
        return self.fetch_data_as_arrow(
            source_table=source_table, import_options=opts
        )
    
    def fetch_data_as_dataframe(self, source_table: str, import_options: dict | None = None) -> pd.DataFrame:
        """Convenience wrapper. Calls fetch_data_as_arrow().to_pandas()."""
        return self.fetch_data_as_arrow(source_table=source_table, import_options=import_options).to_pandas()
    
    def ingest_to_workspace(self, workspace, table_name, source_table, import_options=None):
        """Fetch → Arrow → Parquet in workspace."""
        ...  # existing implementation
    
    # ----- Metadata / Config -----
    
    @staticmethod
    @abstractmethod
    def list_params() -> list[dict[str, Any]]:
        """Connection parameters (for auto-generated connection form)."""
        pass
    
    @staticmethod
    @abstractmethod
    def auth_instructions() -> str:
        """Human-readable setup guide (markdown)."""
        pass
    
    @staticmethod
    def auth_mode() -> str:
        """'connection' (default) or 'token'. See §6.3."""
        return "connection"
    
    @staticmethod
    def rate_limit() -> dict | None:
        """Optional rate limit hints. See §6.3."""
        return None
    
    @staticmethod
    def import_options(table_metadata: dict) -> list[dict] | None:
        """Optional import-time options for the import dialog. See §6.3."""
        return None
```

**Key design decisions:**
- **`CatalogNode.node_type`** uses `"namespace"` / `"table"` (following the Iceberg REST / Unity Catalog convention), not per-source types like `"database"`, `"schema"`. The hierarchy labels provide the per-source terminology.
- **`list_tables()` is kept permanently** as the flat/eager complement to `ls()`. It returns every importable table in the pinned scope — simple and complete, but potentially slow. `ls()` is the lazy/hierarchical alternative. The default `ls()` falls back to `list_tables()` for loaders that haven't implemented hierarchical browsing.
- **`effective_hierarchy()` and `pinned_scope()`** live on the loader itself (not on `DataConnector`), since the loader has access to its own `params`.
- **`test_connection()`** has a default implementation, but loaders should override with something lightweight.
- **`import_options`** is a single extensible dict replacing the old scattered `size`/`sort_columns`/`sort_order`/`columns`/`import_context` params. All data-shaping options go through one bag: `size`, `columns`, `sort_columns`, `sort_order`, `filters`, `source_filters`. Loaders extract what they need; unknown keys are ignored.

## 4. Plugin Registration: Config-Driven, Zero Code

### 4.1 The Insight

Since every `ExternalDataLoader` is fully self-describing — `list_params()`, `catalog_hierarchy()`, `auth_instructions()`, `auth_mode()` — the framework can auto-register any installed loader as a plugin with **zero Python code**. Users and admins just need to say "enable this loader" and optionally pre-fill some connection params.

No one should need to touch DF's source code to add a data source.

### 4.2 Configuration Sources (Priority Order)

The framework reads plugin config from multiple sources, merged in priority order (higher overrides lower):

| Priority | Source | Who Uses It | Format |
|----------|--------|-------------|--------|
| 1 (highest) | **Environment variables** | Docker/K8s admins, CI | `DF_SOURCES__{id}__{key}=value` |
| 2 | **Config file** (`data-sources.yml`) | Admins, power users | YAML in project or `~/.data-formulator/` |
| 3 | **UI settings panel** | End users | Saved to workspace config |
| 4 (lowest) | **Auto-discovery** | Default | Any installed loader with deps available |

### 4.3 Config File: `data-sources.yml`

A single YAML file declares which data sources are available and how they're pre-configured:

```yaml
# ~/.data-formulator/data-sources.yml  (user-level)
# or ./data-sources.yml                (project-level)
# or /etc/data-formulator/data-sources.yml  (system-level)

sources:
  # Minimal: just enable a loader by its registry key
  - type: postgresql

  # With pre-filled connection params (scope pinning)
  - type: mysql
    name: "Analytics DB"              # custom display name (optional)
    icon: mysql                       # icon key (optional, defaults from loader)
    params:
      host: db.internal.corp
      port: 3306
      database: analytics             # pinned — user only sees tables in this DB

  # Multiple instances of the same loader type
  - type: postgresql
    name: "Production Warehouse"
    params:
      host: warehouse.corp
      port: 5432
      database: prod

  - type: postgresql
    name: "Staging"
    params:
      host: staging.corp
      database: staging

  # BI tool
  - type: superset
    name: "Company Superset"
    params:
      url: https://bi.company.com

  # Cloud
  - type: bigquery
    params:
      project: my-gcp-project

  # Kusto with Azure AD
  - type: kusto
    name: "Telemetry Cluster"
    params:
      kusto_cluster: https://telemetry.kusto.windows.net

# Optional: disable auto-discovery (only show explicitly configured sources)
auto_discover: false
```

**Key design decisions:**
- `type` maps to the loader registry key (e.g., `"postgresql"` → `PostgreSQLDataLoader`)
- Same `type` can appear multiple times → solves the multi-instance problem (Q2)
- `params` pre-fills connection fields — the user only sees what's left
- Sensitive params (`password`, `token`) should use env var references: `password: ${PG_PASSWORD}`

### 4.4 Environment Variables

For Docker / CI / Kubernetes deployments where YAML isn't convenient:

```bash
# Enable PostgreSQL with pre-configured host
DF_SOURCES__pg_prod__type=postgresql
DF_SOURCES__pg_prod__name="Production DB"
DF_SOURCES__pg_prod__params__host=db.internal.corp
DF_SOURCES__pg_prod__params__database=analytics
DF_SOURCES__pg_prod__params__port=5432

# Enable Superset
DF_SOURCES__superset__type=superset
DF_SOURCES__superset__params__url=https://bi.company.com

# Disable auto-discovery
DF_AUTO_DISCOVER_SOURCES=false
```

Convention: `DF_SOURCES__{instance_id}__{key}` with `__` as separator (avoids conflict with dots/dashes in names).

### 4.5 Auto-Discovery (Default Behavior)

When no config file or env vars are set, the framework **auto-discovers** all installed loaders:

```python
def discover_sources(app):
    """Auto-register every installed ExternalDataLoader as a DataConnector plugin."""
    for key, loader_class in DATA_LOADERS.items():
        # DATA_LOADERS is the existing registry from data_loader/__init__.py
        # Only contains loaders whose pip dependencies are installed
        plugin = DataConnector.from_loader(loader_class, source_id=key)
        register_plugin(app, plugin)
    
    # Log disabled loaders (missing deps)
    for key, reason in DISABLED_LOADERS.items():
        logger.info(f"Source '{key}' not available: {reason}")
```

With auto-discovery, a fresh DF install with `pymysql` installed automatically shows "MySQL" in the data source panel — no config needed. The user fills in host/user/password at connect time.

### 4.6 Auth: Admin-Configured vs. User-Provided

The config `params` and the loader's `list_params()` together determine what the user sees at connect time. Each param falls into one of three categories:

| Category | Where it comes from | User sees it? | Example |
|----------|-------------------|--------------|---------|
| **Admin-fixed** | YAML `params` or env var | No — hidden, pre-filled | `host: db.internal.corp` |
| **Admin-defaulted** | YAML `params` with `user_editable: true` | Yes — pre-filled but editable | `port: 5432` |
| **User-provided** | Not in config; loader declares it in `list_params()` | Yes — empty, must fill in | `user`, `password` |

#### Scenario 1: Admin provides infra, user provides credentials

The most common enterprise setup. Admin locks down the server, user brings their own identity:

```yaml
# data-sources.yml
sources:
  - type: postgresql
    name: "Analytics DB"
    params:
      host: warehouse.corp
      port: 5432
      database: analytics
```

The user's connect form only shows what's **not** in config:

```
┌─ Connect to Analytics DB ──────────────────┐
│                                             │
│  ⓘ  Server: warehouse.corp:5432/analytics  │  ← info only, not editable
│                                             │
│  Username:  [                 ]             │  ← user fills in
│  Password:  [••••••••         ]             │  ← user fills in
│                                             │
│           [Cancel]    [Connect]             │
└─────────────────────────────────────────────┘
```

#### Scenario 2: Admin provides everything (shared service account)

For read-only dashboards or demo deployments. No user interaction needed:

```yaml
sources:
  - type: postgresql
    name: "Analytics DB"
    auto_connect: true              # connect on first access, no form
    params:
      host: warehouse.corp
      database: analytics
      user: readonly_svc
      password: ${ANALYTICS_DB_PASSWORD}   # env var reference — not stored in YAML
```

The user clicks "Analytics DB" in the tree → auto-connects immediately. No connect form shown. The password is resolved from the `ANALYTICS_DB_PASSWORD` environment variable at startup.

#### Scenario 3: User provides everything (auto-discovered)

No config file. The user sees the full connection form:

```
┌─ Connect to PostgreSQL ────────────────────┐
│  Host:     [                 ]              │
│  Port:     [5432             ]              │
│  Username: [                 ]              │
│  Password: [••••••••         ]              │
│  Database: [                 ]  (optional)  │
│                                             │
│           [Cancel]    [Connect]             │
└─────────────────────────────────────────────┘
```

#### Scenario 4: Token / OAuth sources

For Kusto (Azure AD), BigQuery (service account), Superset (JWT):

```yaml
sources:
  - type: kusto
    name: "Telemetry Cluster"
    params:
      kusto_cluster: https://telemetry.kusto.windows.net
      # No user/password — Kusto uses Azure AD
```

The connect form shows whatever the loader's `list_params()` declares — for Kusto that might be an "Authenticate with Azure AD" button that triggers an OAuth redirect.

#### How `list_params()` drives the form

The framework computes the connect form at startup:

```python
def compute_connect_form(loader_class, config_params):
    """Determine which params the user needs to fill in."""
    all_params = loader_class.list_params()
    form_fields = []
    pinned = {}
    
    for param in all_params:
        if param["name"] in config_params:
            # Admin provided this — don't show in form
            pinned[param["name"]] = config_params[param["name"]]
        else:
            # User must provide this
            form_fields.append(param)
    
    return form_fields, pinned
```

The result goes into `/api/app-config`:
- `params_form` — fields the user fills in (rendered as the connect form)
- `pinned_params` — values the user can see (as info) but not edit

#### Credential & Connection Persistence

Two-level storage, no in-memory tricks:

| Scope | Where | What | Who manages |
|-------|-------|------|-------------|
| **User connections** | Workspace directory (`workspace/connections/`) | Per-user saved connection params (encrypted) | User, via connect/disconnect |
| **Admin connections** | DF home (`~/.data-formulator/data-sources.yml` or `/etc/data-formulator/`) | Shared/pre-configured sources | Admin, via config file or env vars |

**User connections live in the workspace.** When a user connects to a source, their params (host, user, encrypted password) are saved to `workspace/connections/{source_id}.json`. On next session, the framework reads this file → re-instantiates the loader → user is auto-connected. No vault service, no in-memory pool, no Flask sessions.

```
workspace/
  connections/
    pg_prod.json          # {"type": "postgresql", "params": {"host": "...", "user": "...", "password": "<encrypted>"}}
    superset.json         # {"type": "superset", "params": {"url": "...", "username": "...", "token": "<encrypted>"}}
  tables/
    users.parquet
    orders.parquet
  metadata.json
```

**Admin connections live in DF home.** The `data-sources.yml` file (§4.3) is read-only for users. Admin-provided params are merged with user-provided params at connect time.

**Flow:**
1. User submits credentials via connect form
2. Framework validates (instantiate loader, call `test_connection()`)
3. On success: save encrypted params to `workspace/connections/{source_id}.json`, keep loader instance alive for the current process
4. On next session/restart: read saved connections → re-instantiate loaders on first access (lazy)
5. On disconnect: delete the connection file, close loader

**Loader instances** are created on-demand and cached in-process for the duration of the server process — this is just normal Python object lifecycle, not a special pool. If the process restarts, the saved connection file lets us recreate the loader transparently.

**Encryption:** Passwords and tokens are encrypted at rest using a per-workspace key (or a key derived from the user's session secret). The framework decrypts on read, never exposes in API responses.

For **admin-provided credentials** (`auto_connect: true`), the connection file is pre-populated from config at startup — the user never needs to connect manually.

### 4.7 UI Settings Panel (Future)

End users can add/remove sources from the DF UI:

```
┌─ Settings → Data Sources ───────────────────────────┐
│                                                      │
│  Configured Sources:                                 │
│  ┌──────────────────────┬────────────┬─────────┐    │
│  │ Name                 │ Type       │ Status  │    │
│  ├──────────────────────┼────────────┼─────────┤    │
│  │ Production DB        │ PostgreSQL │ ● Ready │    │
│  │ Company Superset     │ Superset   │ ● Ready │    │
│  │ Telemetry Cluster    │ Kusto      │ ○ No dep│    │
│  └──────────────────────┴────────────┴─────────┘    │
│                                                      │
│  [+ Add Source]                                      │
│                                                      │
│  Available Source Types:                             │
│  PostgreSQL, MySQL, BigQuery, Kusto, S3, MongoDB,   │
│  MSSQL, Azure Blob, Superset                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 4.8 How It Works Internally

At startup, the framework:

1. **Scan** `DATA_LOADERS` registry → all installed loader classes
2. **Read** config sources (env vars → YAML → UI settings) → merge
3. **For each configured source** (or auto-discovered loader):
   - Resolve the `ExternalDataLoader` class from `type`
   - Create a `DataConnector` instance with pre-filled `params`
   - Generate Flask Blueprint with auth/catalog/data routes
   - Register frontend module (generic `DataConnectorPanel`)
4. **Serve** `/api/app-config` with the list of enabled sources

```python
# Internal — no user code needed
def register_sources(app):
    config = load_source_config()  # merge env + yaml + UI settings
    
    for source_spec in config.sources:
        loader_class = DATA_LOADERS.get(source_spec.type)
        if not loader_class:
            logger.warn(f"Unknown source type: {source_spec.type}")
            continue
        
        plugin = DataConnector.from_loader(
            loader_class,
            source_id=source_spec.id,       # auto-generated or from config
            display_name=source_spec.name,  # optional custom name
            default_params=source_spec.params,  # pre-filled connection params
            icon=source_spec.icon,
        )
        register_plugin(app, plugin)
```

### 4.9 Frontend: No Per-Source Registration Needed

Since all `DataConnector` plugins use the same generic `DataConnectorPanel`, the frontend doesn't need per-source modules either. The backend's `/api/app-config` tells the frontend what sources are available:

```json
{
  "CONNECTORS": [
    {
      "id": "pg_prod",
      "type": "postgresql",
      "name": "Production DB",
      "icon": "postgresql",
      "params_form": [
        {"name": "user", "type": "string", "required": true},
        {"name": "password", "type": "password", "required": true}
      ],
      "pinned_params": {"host": "db.internal.corp", "database": "analytics"},
      "hierarchy": [{"key": "schema", "label": "Schema"}, {"key": "table", "label": "Table"}]
    },
    {
      "id": "superset",
      "type": "superset",
      "name": "Company Superset",
      "icon": "superset",
      "params_form": [
        {"name": "username", "type": "string", "required": true},
        {"name": "password", "type": "password", "required": true}
      ],
      "pinned_params": {"url": "https://bi.company.com"},
      "hierarchy": [{"key": "dashboard", "label": "Dashboard"}, {"key": "dataset", "label": "Dataset"}]
    }
  ]
}
```

The frontend renders one `DataConnectorPanel` per source in the `SOURCES` list — each with its own connection form, tree hierarchy, and icon. **Zero frontend code per source.**

## 5. Frontend: Generic `DataConnectorPanel`

### 5.1 Shared UI for All Database-Type Sources

Instead of writing a custom React panel per data source, `DataConnector` plugins share a single generic panel:

```typescript
// src/plugins/_shared/DataConnectorPanel.tsx

interface DataConnectorPanelProps {
  pluginId: string;
  config: PluginConfig;
  callbacks: PluginHostCallbacks;
}

function DataConnectorPanel({ pluginId, config, callbacks }: DataConnectorPanelProps) {
  // State machine: disconnected → connecting → connected → browsing → importing
  
  // 1. If not connected: show connection form (auto-generated from list_params)
  // 2. If connected: show table browser (tree view with groups/schemas)
  // 3. On table select: show detail + preview + import button
  // 4. On import: optional filter dialog (if large) → load → notify host
}
```

### 5.2 Auto-Generated Connection Form

The connection form is generated from `ExternalDataLoader.list_params()`:

```typescript
// list_params() returns:
[
  { name: "host", type: "string", required: true, default: "localhost", description: "Database host" },
  { name: "port", type: "number", required: true, default: 5432, description: "Port" },
  { name: "user", type: "string", required: true, description: "Username" },
  { name: "password", type: "password", required: true, description: "Password" },
  { name: "database", type: "string", required: true, description: "Database name" },
]

// Renders as:
┌─ Connect to PostgreSQL ────────────────┐
│  Host:     [localhost        ]          │
│  Port:     [5432             ]          │
│  User:     [                 ]          │
│  Password: [••••••••         ]          │
│  Database: [                 ]          │
│                                         │
│        [Cancel]    [Connect]            │
└─────────────────────────────────────────┘
```

### 5.3 Table Browser

Once connected, the table browser uses the unified tree from [design-doc #8](8-unified-data-source-panel.md):

```
▾ 📂 PostgreSQL — analytics-db (connected)
  ▾ 📁 public
      users              (150k rows)  [⊕] [↻]
      orders             (1.2M rows)  [⊕] [↻]
      products           (5k rows)    [⊕] [↻]
  ▸ 📁 staging
  ▸ 📁 analytics
```

- **[⊕]** = Import to workspace
- **[↻]** = Refresh (only shown for already-imported tables)

### 5.4 Frontend Plugin Registration

No per-source frontend code needed. The backend's `/api/app-config` response (see §4.9) tells the frontend what sources exist and what their connection forms / hierarchy look like. One generic `DataConnectorPanel` handles all of them.

The frontend factory is only needed once, in the shared module:

```typescript
// src/plugins/_shared/DataConnectorPanel.tsx
// Handles ALL connected data sources — databases, BI tools, cloud storage
// Reads source config from /api/app-config → SOURCES[]
// Renders: connection form (from params_form) → tree browser (from hierarchy) → import
```

## 6. Full Unification: BI Tools as Data Loaders

Since DF only **consumes** data, both databases and BI tools serve the same role: hierarchical sources of importable tables. We unify them under the same `DataConnector` model.

### 6.1 Architecture (Unified)

```
                  DataConnector (generic lifecycle wrapper)
                           |
              ┌────────────┼────────────────┐
              │            │                │
       Database Loaders   Cloud Loaders    BI Tool Loaders
       ┌────┬────┐       ┌────┬────┐      ┌─────────┬──────────┐
    MySQL  PG  MSSQL   BQ  Kusto  S3    Superset  Metabase  Grafana
```

**Everything is a loader.** Superset becomes a `SupersetLoader(ExternalDataLoader)` that:
- Connects via JWT instead of host/password
- Exposes `catalog_hierarchy() → [{"key":"dashboard","label":"Dashboard"}, {"key":"dataset","label":"Dataset"}]`
- Returns `CatalogNode(node_type="namespace", ...)` for dashboards (expandable containers)
- Returns datasets as `CatalogNode(node_type="table", ...)` leaf nodes with optional pre-applied filters

### 6.2 How Superset Migrates

```python
class SupersetLoader(ExternalDataLoader):
    """Treats Superset as a hierarchical data source."""
    
    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "dashboard", "label": "Dashboard"},
            {"key": "dataset", "label": "Dataset"},
        ]
    
    def ls(self, path=None, filter=None) -> list[CatalogNode]:
        path = path or []
        if not path:  # root → list dashboards + "Ungrouped Datasets"
            dashboards = self.client.list_dashboards(self.token)
            return [
                CatalogNode(name=d["title"], node_type="namespace",
                            path=[d["title"]])
                for d in dashboards
            ] + [CatalogNode(name="Ungrouped Datasets", node_type="namespace",
                             path=["Ungrouped Datasets"])]
        
        if len(path) == 1:  # dashboard → list its datasets
            datasets = self.client.get_dashboard_datasets(self.token, path[0])
            return [
                CatalogNode(
                    name=ds["name"], node_type="table",
                    path=[path[0], ds["name"]],
                    metadata={"row_count": ds["count"], "filters": ds.get("filters")},
                )
                for ds in datasets
            ]
        return []
    
    def fetch_data_as_arrow(self, source_table, size=100000, **kwargs) -> pa.Table:
        # source_table = dataset ID; executes SQL via Superset's SQL Lab
        return self.client.execute_sql_as_arrow(self.token, source_table, size)
    
    @staticmethod
    def list_params() -> list[dict]:
        return [
            {"name": "url", "type": "string", "required": True, "description": "Superset URL"},
            {"name": "username", "type": "string", "required": True},
            {"name": "password", "type": "password", "required": True},
        ]

# Plugin registration — same one-liner as databases:
plugin_class = create_connected_data_source(SupersetLoader, "superset", "Superset", icon="superset")
```

The rich Superset-specific features (dashboard filters, column metadata, etc.) are expressed as **metadata on `CatalogNode`** rather than as a separate plugin architecture.

### 6.3 Critical Differences to Be Aware Of

Unification is the right call, but these differences must be handled in the `DataConnector` framework:

#### 1. Auth Model Diversity

| Source Type | Auth Mechanism | Token Lifecycle |
|-------------|---------------|------------------|
| MySQL, PG, MSSQL | Connection params (host/user/password) | Connection object — alive until closed |
| Kusto, BigQuery | OAuth / service account token | Expires, needs refresh |
| Superset, Metabase | JWT (username/password → token) | Expires, needs refresh |
| Grafana | API key | Long-lived, no refresh |

**Solution:** The `DataConnector` auth layer must support both:
- **Persistent connection** mode (databases): store connection object in session, reconnect on failure
- **Token** mode (BI tools, cloud): store token in session, auto-refresh on expiry

The loader declares which mode it uses:
```python
class ExternalDataLoader(ABC):
    @staticmethod
    def auth_mode() -> str:
        """'connection' (default) or 'token'."""
        return "connection"
```

#### 2. Catalog Node Semantics: Import vs. Import-With-Context

Database tables are **context-free** — `SELECT * FROM users` means the same thing regardless of how you navigated to it. But BI tool datasets can carry **context from their parent**:

```
Superset:
  📊 Q3 Sales Dashboard
      orders_fact → import with dashboard's date filter pre-applied
  📁 Ungrouped Datasets
      orders_fact → import raw, no filters
```

The same leaf ("orders_fact") means different things depending on which parent you expanded from.

**Solution:** `CatalogNode.metadata` carries the context:
```python
@dataclass
class CatalogNode:
    name: str
    node_type: str       # "namespace" or "table"
    path: list[str]
    metadata: dict | None = None   # <-- includes import_context
    # e.g., metadata = {
    #   "filters": [{"column": "date", "op": ">=", "value": "2025-07-01"}],
    #   "description": "Filtered by Q3 Sales Dashboard",
    # }
```

When importing, the framework passes `metadata` to the loader, which can apply filters server-side. Databases ignore this (no filters in metadata). BI tools use it.

#### 3. Data Freshness & Caching

| Source | Data Freshness | Caching Behavior |
|--------|---------------|------------------|
| Database | Live — query returns current state | No source-side cache; DF caches catalog metadata only |
| BI tool | May have source-side cache (Superset caches query results) | Catalog may be stale; need cache-bust option |

**Solution:** `CatalogNode.metadata` can include `cached_at` / `cache_ttl` hints. The tree UI shows a staleness indicator and offers a "refresh catalog" action per source.

#### 4. Rate Limiting & Quotas

BI tools often have API rate limits (Superset: N requests/minute). Databases have connection limits but no per-query throttling.

**Solution:** Loaders can declare rate limit hints:
```python
class ExternalDataLoader(ABC):
    @staticmethod
    def rate_limit() -> dict | None:
        """Optional rate limit hints. None = no limit."""
        return None  # or {"requests_per_minute": 60, "concurrent": 5}
```
The `DataConnector` framework uses this to throttle catalog expansion and data loads.

#### 5. Import Filtering: Standard SPJ + Source-Defined Filters

Large datasets need filtering before import. There are two layers:

**Layer 1: Standard SPJ (Select-Project-Join) — all sources get this for free**

The framework provides a built-in filter UI for every data source, regardless of type:

```
┌─ Import: orders (1.2M rows) ───────────────────────────┐
│                                                         │
│  Columns (select):                                      │
│  ☑ order_id    ☑ customer_id   ☑ amount                │
│  ☑ region      ☐ internal_id   ☐ updated_at            │
│                                                         │
│  Filters (where):                                       │
│  ┌──────────────┬─────┬──────────────────────┐          │
│  │ region       │ IN  │ [US, EU]             │          │
│  │ amount       │ >=  │ [100]                │          │
│  │ order_date   │ >=  │ [2025-01-01]         │          │
│  │              │     │ [+ Add filter]       │          │
│  └──────────────┴─────┴──────────────────────┘          │
│                                                         │
│  Sort by:  [order_date ▾]  [desc ▾]                    │
│  Row limit: [50000    ]                                 │
│                                                         │
│  Estimated rows: ~38,000                                │
│                                                         │
│                [Cancel]    [Import]                      │
└─────────────────────────────────────────────────────────┘
```

This UI is **auto-generated from column metadata** (`get_metadata()` returns column names and types). The framework builds the SQL WHERE clause server-side via a safe, parameterized filter DSL — no raw SQL from the user.

The filter DSL:
```python
# Sent in data/import request body
{
  "source_table": ["production", "public", "orders"],
  "columns": ["order_id", "customer_id", "amount", "region", "order_date"],
  "filters": [
    {"column": "region", "op": "in", "value": ["US", "EU"]},
    {"column": "amount", "op": ">=", "value": 100},
    {"column": "order_date", "op": ">=", "value": "2025-01-01"}
  ],
  "sort_columns": ["order_date"],
  "sort_order": "desc",
  "size": 50000
}
```

The loader receives this in `import_context` and translates to the source's query language (SQL WHERE, Kusto where, S3 Select, etc.). Each loader handles its own dialect safely.

**Layer 2: Source-defined filters — for BI tools and curated datasets**

Some sources provide **pre-defined filter sets** created by the data source owner (e.g., Superset dashboard native filters, Metabase question parameters). These appear as additional interactive controls above the standard SPJ filters:

```
┌─ Import: orders_fact (from Q3 Sales Dashboard) ────────┐
│                                                         │
│  Dashboard Filters (pre-defined by source):             │
│  ┌──────────────────────────────────────────────┐       │
│  │ Quarter:    [Q3 2025 ▾]                      │       │
│  │ Region:     [☑ US  ☑ EU  ☐ APAC  ☐ LATAM]  │       │
│  │ Product:    [All ▾]                          │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  Additional Filters (standard):                         │
│  ┌──────────────┬─────┬──────────────────────┐          │
│  │ amount       │ >=  │ [100]                │          │
│  │              │     │ [+ Add filter]       │          │
│  └──────────────┴─────┴──────────────────────┘          │
│                                                         │
│  Columns: ☑ order_id  ☑ customer_id  ☑ amount  ...     │
│  Row limit: [50000]                                     │
│                                                         │
│                [Cancel]    [Import]                      │
└─────────────────────────────────────────────────────────┘
```

Source-defined filters come from `CatalogNode.metadata`:
```python
# CatalogNode for "orders_fact" under "Q3 Sales Dashboard"
CatalogNode(
    name="orders_fact",
    node_type="table",
    path=["Q3 Sales Dashboard", "orders_fact"],
    metadata={
        "row_count": 150000,
        "source_filters": [
            {
                "name": "Quarter", "column": "quarter",
                "type": "select", "options": ["Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025"],
                "default": "Q3 2025"
            },
            {
                "name": "Region", "column": "region",
                "type": "multi_select", "options": ["US", "EU", "APAC", "LATAM"],
                "default": ["US", "EU"]
            },
            {
                "name": "Product", "column": "product_category",
                "type": "select", "options_endpoint": "/filter-values",  # lazy-loaded
                "default": "All"
            }
        ]
    }
)
```

The import dialog renders both layers. The combined request:
```python
{
  "source_table": ["Q3 Sales Dashboard", "orders_fact"],
  "columns": ["order_id", "customer_id", "amount"],
  "filters": [                              # standard SPJ filters (layer 1)
    {"column": "amount", "op": ">=", "value": 100}
  ],
  "import_context": {                       # source-defined filters (layer 2)
    "source_filters": [
      {"column": "quarter", "value": "Q3 2025"},
      {"column": "region", "value": ["US", "EU"]},
      {"column": "product_category", "value": "All"}
    ]
  },
  "size": 50000
}
```

The loader applies both: source-defined filters first (they define the base dataset), then standard SPJ filters on top (user refinement).

**How loaders declare filter support:**

```python
class ExternalDataLoader(ABC):
    @staticmethod
    def supports_standard_filters() -> bool:
        """Whether this loader can apply SPJ filters server-side.
        
        True  → framework sends filters in import_context, loader builds WHERE clause
        False → framework fetches all data, applies filters client-side (slower)
        Default: True for SQL databases, loaders can override.
        """
        return True
```

For sources that can't filter server-side (e.g., some REST APIs), the framework falls back to client-side filtering after fetch — less efficient but still works.

## 7. Migration Plan

### Phase 1: Core Framework + Loader Upgrade

1. ✅ Add `CatalogNode` dataclass (`"namespace"` / `"table"`) and new base methods on `ExternalDataLoader`: `catalog_hierarchy()`, `effective_hierarchy()`, `pinned_scope()`, `ls()`, `get_metadata()`, `test_connection()`, `auth_mode()`, `rate_limit()` — all with default implementations so existing loaders keep working
2. ✅ **Upgrade all 9 loaders** to override the new methods:
   - MySQL, PostgreSQL, MSSQL: `catalog_hierarchy()`, `ls()`, `get_metadata()`, `test_connection()` — database param made optional for scope pinning
   - BigQuery: project always pinned (required), dataset_id optional — 3-level hierarchy
   - Kusto: kusto_database made optional — 2-level hierarchy
   - Athena: database already optional — 2-level hierarchy
   - MongoDB: database required, collection is scope param — 2-level hierarchy
   - S3, Azure Blob: bucket/container required (can't list safely) — 2-level hierarchy
3. ✅ Unify `fetch_data_as_arrow()` signature: replace `size`/`sort_columns`/`sort_order` positional params with single `import_options: dict` — extensible for `columns`, `filters`, `source_filters`. All 9 loaders, callers, and tests updated. Renamed `loader_metadata` → `source_info`. Removed pandas from PG/MySQL/MSSQL query path (cursor + `pa.table()` directly). `import_options` stored in workspace metadata for refresh replay.
4. ✅ Implement `DataConnector` base class with generic auth/catalog/data routes — auto-registers all 10 loaders at startup (90 routes under `/api/connectors/{id}/`), exposes `SOURCES` in `/api/app-config`
5. ✅ Implement `SupersetLoader(ExternalDataLoader)` — JWT-based auth (`auth_mode="token"`), dashboard→dataset hierarchy, SQL Lab data fetch. Registered as 10th loader, auto-wrapped by `DataConnector` with 9 routes.
6. ✅ Implement config-driven registration — `data-sources.yml` (searched in `DATA_FORMULATOR_HOME`, cwd, `~/.data-formulator/`, `/etc/`), env vars (`DF_SOURCES__id__key`), `${ENV_REF}` resolution, `auto_discover: false` to restrict to configured sources only. Multiple instances of same type supported.
7. ✅ Integrate `DataConnector` into frontend — `SOURCES` from `/api/app-config` rendered in `DBManagerPane` sidebar alongside legacy loaders. `DataLoaderForm` accepts optional `connectorId` to route through `/api/connectors/{id}/*`. `loadTable` thunk updated to support connected source import. Zero new components — reuses existing form/table UI.

### Phase 2: Integration Testing

7. ✅ Test database loaders end-to-end: PostgreSQL, MySQL via auto-discovery and `data-sources.yml` config
   - Connect → browse hierarchy → scope pinning → import with SPJ filters → refresh → disconnect → reconnect from saved credentials
   - 40 unit tests for DataConnector framework (mock loader), 17 config tests, E2E route tests for PG + MySQL (Docker-gated)
8. ✅ Test `SupersetLoader` end-to-end: dashboard → dataset hierarchy, source-defined filters, SSO auth
   - 16 integration tests with mocked Superset API (JWT auth, catalog browsing, data preview/import, token refresh)
9. ✅ Deprecate old hand-written `SupersetPlugin(DataSourcePlugin)` — deprecation warnings added, docstrings updated
10. ✅ Verify remaining loaders via auto-discovery: Kusto, BigQuery, MSSQL, MongoDB, S3, Azure Blob
    - 16 verification tests confirm catalog_hierarchy, effective_hierarchy, scope pinning, auth_mode, list_params, blueprint generation for all 10 loaders
    - Also found and fixed operator-precedence bug in `_build_source_specs` YAML ID assignment

### Phase 3: Cleanup + Unified Panel ✅ (partial)

- ✅ Removed 8 legacy `/api/tables/data-loader/*` backend routes from `tables_routes.py`
- ✅ Removed 9 `DATA_LOADER_*` URL constants from frontend `utils.tsx`
- ✅ `DBTableManager` now uses only `serverConfig.SOURCES` (DataConnector) for data source discovery
- ✅ `DataLoaderForm` uses only connected source auth/catalog/import routes (no legacy branches)
- ✅ `loadTable` thunk uses only connected source routes for both store-on-server and ephemeral paths
- ✅ `useDataRefresh` uses connected source `DATA_REFRESH` endpoint (requires active connection)
- ✅ Added `connectorId` to `DataSourceConfig` so tables remember their source
- ✅ Added `DISABLED_SOURCES` to app-config for greyed-out UI entries
- ✅ Enhanced `data/preview` route to support full `import_options` (sort, limit)
- [ ] Remove `DataSourcePlugin` base class, `plugins/` directory, and per-plugin `__init__.py` files
- [ ] Integrate with unified data source panel ([doc #8](8-unified-data-source-panel.md))

### Phase 4: Advanced Features

13. Scheduled refresh (periodic re-fetch)
14. Incremental refresh (append-only for time-series data)
15. Connection sharing in team deployments (admin-managed connections)
16. Cross-database queries (join tables from different databases in tree)
17. Metabase / Grafana loaders

## 8. Open Questions

### Q1: What happens to `DataSourcePlugin` and the `plugins/` directory?

They go away after migration. The auth and lifecycle components move into DF core:

```
py-src/data_formulator/
  auth/                              ← NEW: DF's auth layer (extracted from plugins/)
    __init__.py
    credentials.py                   ← encrypt/decrypt passwords & tokens at rest
    connection_store.py              ← read/write workspace/connections/{id}.json
    token_manager.py                 ← token refresh, expiry checking (for token-mode sources)
    sso.py                           ← SSO/OIDC provider (AuthProvider, extracted from plugins/)
  data_loader/                       ← EXISTING: all ExternalDataLoader subclasses
    external_data_loader.py          ← revised interface (§3.5)
    mysql_data_loader.py
    postgresql_data_loader.py
    ...
  data_connector.py                ← NEW: DataConnector framework
                                       (route generation, form computation, lifecycle)
  plugins/                           ← REMOVED after Phase 3
```

Post-migration architecture:

```
ExternalDataLoader (driver)       ← each source type implements this
        ↓
DataConnector (framework)   ← generic lifecycle wrapper, one implementation
        ↓                            uses auth/ for credentials, tokens, SSO
data-sources.yml / auto-discovery ← config, not code
```

There are no "plugins" anymore — just **loaders** (the driver layer) and the **framework** (the lifecycle layer). The `plugins/` directory, `DataSourcePlugin` base class, and per-plugin `__init__.py` files are all removed.

**What's reused** from the current plugin system (relocated to `auth/`):
- Credential encryption patterns → `auth/credentials.py`
- Session helpers, token refresh logic → `auth/token_manager.py`
- SSO bridge patterns (for token passthrough) → `auth/sso.py`
- Workspace connection persistence → `auth/connection_store.py` (new)
- Error isolation (one source failure doesn't crash others) — stays in framework
- Frontend error boundaries — stays in frontend

### Q2: Multiple connections to the same source type?

**Solved by config.** Users list multiple entries with the same `type` in `data-sources.yml`:

```yaml
sources:
  - type: postgresql
    name: "Production"
    params: { host: prod.corp, database: prod }
  - type: postgresql
    name: "Staging"
    params: { host: staging.corp, database: staging }
```

Each becomes a separate entry in the data source tree. No code changes needed.

### Q3: How deep should hierarchical browsing go?

Different sources have different depths:

| Source | Levels | Example |
|--------|--------|---------|
| MySQL | 2 | `database → table` |
| PostgreSQL | 3 | `database → schema → table` |
| BigQuery | 3 | `project → dataset → table` |
| Kusto | 2 | `database → table` |
| S3 | 2+ | `bucket → prefix → ... → object` (variable depth) |

**Recommendation:** Each loader declares its hierarchy via `catalog_hierarchy()`. The tree UI renders whatever depth the loader declares. S3-style variable depth can be handled by repeating level types (e.g., `["bucket", "prefix", "prefix", "object"]` or a special "recursive" marker).

### Q4: How do column selection and filtering interact with the loader?

The current `fetch_data_as_arrow(source_table, size, ...)` doesn't support column selection or arbitrary WHERE clauses. Options:

- **Column selection:** Add `columns` param to `fetch_data_as_arrow()` — loaders build `SELECT col1, col2 FROM ...`
- **Server-side filtering:** More complex. Would need a filter DSL or raw SQL passthrough.

**Recommendation:** Phase 1 supports column selection + size limit only. Server-side filtering (like Superset has) is Phase 4 for database plugins — it requires building SQL WHERE clauses safely, which varies per database dialect.

### Q5: What about token-based auth (Kusto, BigQuery)?

Some data sources use OAuth/service accounts, not username/password. The `list_params()` already handles this — BigQuery asks for a service account JSON, Kusto uses Azure AD tokens.

The `DataConnector` auth layer should support:
- **Password mode** (MySQL, PostgreSQL, MSSQL): user/password fields
- **Token/key mode** (BigQuery, Kusto): API key or token file
- **OAuth mode** (future): redirect-based auth flow

`list_params()` already declares the param types — the generic connection form renders whatever the loader needs.

### Q6: Should the old `db-manager` endpoints remain?

The existing `POST /api/db-manager/load-table` is a stateless, one-shot endpoint. Once `DataConnector` plugins exist, it's redundant. But we should keep it for backward compatibility and deprecate it gradually.

```
Phase 1-2: Both endpoints work
Phase 3:   /api/db-manager/* shows deprecation warning in logs
Phase 4:   Remove (or keep as thin wrapper that delegates to plugin)
```

## 9. Summary

**The generalized plugin library unifies databases and BI tools into one model:**

```
ExternalDataLoader  (data protocol: how to connect, browse, fetch)
        +
DataConnector (lifecycle mgmt: session, caching, refresh, UI)
        =
A full plugin — for databases AND BI tools — for free
```

All data sources are **hierarchical trees of `namespace` → `table` nodes**:
- MySQL: `database (namespace) → table`
- PostgreSQL: `database (namespace) → schema (namespace) → table`
- Superset: `dashboard (namespace) → dataset (table)`
- S3: `bucket (namespace) → file (table)`

The hierarchy labels (what to call each namespace level) come from `catalog_hierarchy()`. **Scope pinning** lets users skip levels they don't need to browse — if you provide `database="prod"` in your connection params, that level is hidden and browsing starts at the next level.

The five critical differences between databases and BI tools (auth model, contextual import, caching, rate limits, import options) are handled as **optional capabilities** on `ExternalDataLoader` and `CatalogNode.metadata` — not as separate plugin architectures.

**What plugin authors / admins write:**

| Scenario | What to do |
|----------|------------|
| Enable an already-installed loader | Add one entry to `data-sources.yml` or set env var |
| Pre-configure a database for all users | Add entry with `params` (host, database, etc.) in YAML or env |
| Multiple connections to same DB type | Add multiple entries with same `type`, different `name` and `params` |
| New loader not yet in DF | Implement `ExternalDataLoader` subclass (~100 lines), `pip install` it |
| BI platform with custom hierarchy | Same as above, implement `ls()` with custom hierarchy (~200 lines) |

**What users get:**

- Log into PostgreSQL / Kusto / MySQL / BigQuery / **Superset / Metabase** once → browse hierarchy → import → refresh
- All data sources visible in one unified tree panel
- Consistent experience: same connect → browse → import → refresh loop everywhere
- No re-entering credentials for every data pull
