# Unified Data Source Panel — File-Directory Approach

## Status: Draft / Discussion

## 1. Problem

The current Superset plugin uses a two-tab layout (Dashboards tab + Datasets tab) that ultimately does the same thing: load a dataset into the workspace. As we add more data plugins (Superset, Metabase, databases, file uploads, etc.), users need a single, intuitive way to browse and import data from all sources.

Additionally, there's no clear starting experience — before any data is loaded, the user sees a landing page with upload options and demos, but no persistent "data browser" that encourages exploration.

## 2. Proposal

### 2.1 File-Directory Panel on Left Side of Data Thread

Add a collapsible **data source browser** on the left side, styled like a file system tree. Users can expand/collapse sources, browse their contents, and import data into the workspace with a single click.

```
DATA SOURCES (collapsible sidebar)
─────────────────────────────────
▸ 📂 Local Files
    upload.csv
    paste-data.tsv

▾ 📂 Superset (connected)
  ▾ 📊 Q3 Sales Dashboard
      orders_fact          (150k rows)  [⊕]
      product_dim          (2k rows)    [⊕]
      region_hierarchy     (500 rows)   [⊕]
  ▸ 📊 Customer Analytics
  ▸ 📁 Ungrouped Datasets
      raw_events           (1M rows)    [⊕]

▸ 📂 MySQL — analytics-db
    schema: public
      ▸ users
      ▸ events

▸ 📂 Metabase (not connected)
```

**[⊕] = one click to import** into workspace (adds table to data thread).

### 2.2 Hierarchy Design

```
Plugin (data source)
 └─ Group (optional: dashboard, schema, folder)
     └─ Table / Dataset
```

**Open question: should groups nest deeper?**

| Approach | Example | Pros | Cons |
|----------|---------|------|------|
| **Flat (2 levels)** | Plugin → Tables | Simple, fast to scan | Databases with many schemas may be overwhelming |
| **Grouped (3 levels)** | Plugin → Group → Tables | Natural for dashboards, schemas | Deeper nesting = more clicks |
| **Plugin-defined** | Plugins define their own depth (Superset uses groups, file upload is flat) | Each plugin presents data naturally; respects the source's native structure | Slightly inconsistent tree depth |

**Recommendation: Plugin-defined hierarchy.** The tree renders whatever structure the plugin provides — Data Formulator doesn't impose or flatten it. Each plugin knows its data best: Superset naturally groups by dashboard, a database plugin exposes schema → table, and file uploads are flat. This respects the source system's native organization and avoids lossy abstraction.

### 2.3 Interaction Model

| Action | Behavior |
|--------|----------|
| **Expand plugin** | If not connected, show login/connect prompt inline. If connected, fetch and show contents. |
| **Expand group (dashboard)** | Fetch datasets in that group. Shows row count and column info. |
| **Click [⊕] on a table** | If dataset fits within row limit → import directly. If it exceeds the limit → pop up a filter/column-selection dialog (see §2.5). |
| **Right-click / long-press** | Context menu: Force open filter dialog, custom table name. |
| **Drag table** | (Future) Drag into data thread to position in a specific chain. |
| **Search** | Filter tree by name across all sources. |
| **Switch plugin** | All plugins visible at once — no switching needed. Collapse ones you don't use. |

### 2.4 Plugin Switching

Since all plugins appear as top-level folders in one tree, there's **no need to switch** between them. Users just expand the source they want. This is better than tabs/dropdowns:
- No "which tab am I on?" confusion
- Easy to pull data from multiple sources in one session
- Collapsed plugins take minimal space

### 2.5 Progressive Import: Auto-Filter for Large Datasets

One button [⊕] handles both small and large datasets:

**Small dataset (within row limit):** Import happens immediately, no extra steps.

**Large dataset (exceeds row limit):** A filter dialog pops up automatically:

```
┌─ Import: orders_fact (1.2M rows) ──────────────────┐
│                                                     │
│  This dataset exceeds the row limit (2,000,000).    │
│  Select columns and filters to narrow the data.     │
│                                                     │
│  Columns (12 available):                            │
│  ☑ order_id    ☑ customer_id   ☑ amount            │
│  ☑ region      ☐ internal_id   ☐ updated_at        │
│  ☑ order_date  ☐ raw_payload   ☑ status            │
│                                                     │
│  Filters:                                           │
│  ┌─────────────┬────┬──────────────────────┐        │
│  │ region      │ =  │ US, EU               │        │
│  │ order_date  │ >= │ 2025-01-01           │        │
│  │             │    │ [+ Add filter]       │        │
│  └─────────────┴────┴──────────────────────┘        │
│                                                     │
│  Estimated rows after filter: ~38,000               │
│                                                     │
│              [Cancel]    [Import]                    │
└─────────────────────────────────────────────────────┘
```

**Design rationale:**
- **One button for everything** — no upfront decision about "raw vs filtered"
- **Zero friction for small data** — most imports are instant
- **Progressive disclosure** — filter UI only appears when actually needed
- **Column selection** — users can drop columns they don't need, reducing data size
- **Server-side filtering** — filters are applied as SQL WHERE clauses before download, so only the relevant subset crosses the wire
- Users can also right-click any dataset to force-open the filter dialog even for small datasets

### 2.6 Views vs Tables

Data sources can expose both **tables** (raw data) and **views** (pre-filtered/transformed data). The tree doesn't distinguish between them at the interaction level — both are leaf nodes with [⊕] to import. The difference is just metadata.

- A Superset dashboard's filtered dataset = a **view**
- A MySQL `CREATE VIEW` = a **view**
- A raw database table = a **table**

The plugin labels each leaf node with its type, and optionally shows the view definition as a code snippet:

```
▾ 📂 Superset
  ▾ 📊 Q3 Sales Dashboard
      orders_fact (view)     (150k rows)  [⊕]
        WHERE region IN ('US','EU') AND order_date >= '2025-01-01'
      product_dim (table)    (2k rows)    [⊕]

▾ 📂 MySQL — analytics-db
  ▾ 📁 public
      users (table)          (500k rows)  [⊕]
      active_users (view)    (50k rows)   [⊕]
        SELECT * FROM users WHERE status = 'active'
```

The `TreeNode` supports this simply:

```typescript
interface TreeNode {
  // ... existing fields ...
  metadata?: {
    rowCount?: number;
    columnCount?: number;
    nodeKind?: 'table' | 'view';  // Displayed as label
    viewDefinition?: string;       // Shown as code snippet if present
  };
}
```

Users click [⊕] on either — the import flow is identical. The view definition is informational so users understand what data they're getting.

## 3. Starting Panel (Empty State)

Before the user loads any data, the current landing page shows upload options + demo sessions. The question: **how should the data source panel appear here?**

### Landing Page (Before Data is Loaded)

The existing landing page is preserved — it shows quick-start actions, example sessions, and recent workspaces. The data source browser is embedded as a section within the landing page, giving users a preview of available sources and encouraging them to connect before entering the editor.

```
┌─────────────────────────────────────────────────────────┐
│  DATA FORMULATOR                                        │
│  AI-powered data visualization                          │
│                                                         │
│  ┌─ Quick Start ───────┐  ┌─ Data Sources ──────────┐  │
│  │ 📎 Upload CSV       │  │ ▸ Superset (Connect →)  │  │
│  │ 📋 Paste data       │  │ ▸ MySQL (Connect →)     │  │
│  │ 🔗 From URL         │  │ ▸ Metabase (Connect →)  │  │
│  └─────────────────────┘  └─────────────────────────┘  │
│                                                         │
│  ┌─ Examples ──────────────────────────────────────┐    │
│  │  [Stock Prices]  [Gas Prices]  [Movies]  [...]  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Recent Workspaces                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │ Sales Q3 │ │ Customer │ │ Survey   │                │
│  │ 3 tables │ │ 5 tables │ │ 2 tables │                │
│  └──────────┘ └──────────┘ └──────────┘                │
└─────────────────────────────────────────────────────────┘
```

- The "Data Sources" card lists configured plugins as collapsed entries
- Clicking "Connect →" opens the plugin's auth flow inline or in a dialog
- Once connected, the entry expands to show top-level groups/tables right on the landing page
- Clicking a dataset or uploading a file transitions into the **editor layout**

### Editor Layout (After Data is Loaded)

Once the user imports data, the UI transitions to the editor with the file-tree data source panel on the left:

```
┌─────────────────┬───────────────────────────────────────┐
│ DATA SOURCES    │                                       │
│                 │   Data Thread / Visualization          │
│ ▸ Upload Files  │                                       │
│ ▾ Superset      │   (editor content)                    │
│   ▾ Q3 Sales    │                                       │
│     orders_fact │                                       │
│     product_dim │                                       │
│   ▸ Analytics   │                                       │
│ ▸ MySQL         │                                       │
│ ───────────────│                                       │
│ WORKSPACE       │                                       │
│  orders_fact ✓  │                                       │
│  my_upload.csv  │                                       │
└─────────────────┴───────────────────────────────────────┘
```

- The file-tree panel is collapsible to save space
- Already-imported tables show a ✓ badge in the source tree
- The WORKSPACE section below shows tables currently in the workspace

## 4. Plugin-Provided Metadata Contract

The UI is **entirely metadata-driven**. Plugins have **no custom frontend code** — there are no per-plugin React components, no `SupersetPanel.tsx` or `MySQLPanel.tsx`. Instead, the frontend reads structured metadata from the plugin's backend API and renders one generic tree component for all plugins.

The flow:
1. Frontend calls `GET /api/plugins/` → gets list of registered plugins + their descriptors
2. Frontend calls `GET /api/plugins/{id}/children?parentId=...` → gets tree nodes
3. Frontend renders everything using the same generic tree component

### 4.1 Plugin Descriptor (Static Metadata)

Returned by the backend at plugin registration / discovery time. Tells the UI what this plugin looks like and what it can do:

```typescript
interface DataSourcePluginDescriptor {
  id: string;                    // e.g. "superset", "mysql"
  displayName: string;           // e.g. "Superset"
  icon: string;                  // Icon identifier or URL
  
  // Authentication
  requiresAuth: boolean;
  authType?: 'sso' | 'credentials' | 'connection-string';
  
  // Hierarchy declaration — tells the UI what levels to expect
  hierarchy: HierarchyLevel[];
  
  // Capabilities — tells the UI what actions to offer
  capabilities: {
    search?: boolean;            // Can this plugin handle server-side search?
    preview?: boolean;           // Can tables be previewed before import?
    serverSideFilter?: boolean;  // Can the plugin apply WHERE clauses before download?
    // NOTE: rowLimitOptions 已移除。行数限制统一由全局 Settings.frontendRowLimit 控制，
    // 后端硬上限 MAX_IMPORT_ROWS=2,000,000。详见 dev-guides/13-unified-row-limits.md
  };
}

// Each level describes one tier of the tree
interface HierarchyLevel {
  type: string;                  // e.g. "dashboard", "schema", "table"
  label: string;                 // Display name for this level, e.g. "Dashboards"
  icon?: string;                 // Default icon for nodes at this level
  expandable: boolean;           // Does this level have children?
  isLeaf?: boolean;              // Is this the importable data level?
}
```

**Example descriptors:**

```typescript
// Superset: 2 levels (dashboard → dataset)
{
  id: 'superset',
  hierarchy: [
    { type: 'dashboard', label: 'Dashboards', icon: '📊', expandable: true },
    { type: 'dataset',   label: 'Datasets',   icon: '📄', expandable: false, isLeaf: true }
  ],
  capabilities: { search: true, serverSideFilter: true }
}

// MySQL: 2 levels (schema → table)
{
  id: 'mysql',
  hierarchy: [
    { type: 'schema', label: 'Schemas', icon: '📁', expandable: true },
    { type: 'table',  label: 'Tables',  icon: '📄', expandable: false, isLeaf: true }
  ],
  capabilities: { search: true, preview: true }
}

// File upload: flat (just tables)
{
  id: 'local-files',
  hierarchy: [
    { type: 'file', label: 'Files', icon: '📄', expandable: false, isLeaf: true }
  ],
  capabilities: { search: false }
}
```

### 4.2 Backend API Endpoints (Dynamic Metadata)

Each plugin backend exposes a standard set of REST endpoints. The frontend fetches tree content lazily as the user expands nodes — all through the same generic API shape:

```
# All plugins expose the same endpoint pattern:
GET  /api/plugins/{plugin_id}/auth/status
POST /api/plugins/{plugin_id}/auth/login
GET  /api/plugins/{plugin_id}/children?parentId=<id|null>
POST /api/plugins/{plugin_id}/load
```

The backend plugin implements a standard Python interface:

```python
class DataSourcePlugin:
    descriptor: DataSourcePluginDescriptor
    
    def get_auth_status(self, session) -> AuthStatus: ...
    def authenticate(self, session, credentials) -> AuthResult: ...
    
    # Tree content — generic node fetching
    # parent_id=None → root-level nodes (dashboards, schemas, etc.)
    # parent_id=<id> → children of that node
    def get_children(self, session, parent_id: str | None) -> list[TreeNode]: ...
    
    # Import a leaf node into workspace
    # options may include column selection, filters, row limit (from the generic filter dialog)
    def load_table(self, session, node_id: str, options: LoadOptions) -> LoadResult: ...
```

interface TreeNode {
  id: string;
  name: string;
  type: string;                  // Matches a HierarchyLevel.type
  icon?: string;                 // Override default icon
  metadata?: {                   // Displayed as secondary info
    rowCount?: number;
    columnCount?: number;
    [key: string]: any;          // Plugin can add custom display fields
  };
  hasChildren: boolean;          // Whether expand arrow is shown
}
```

### 4.3 How the UI Uses This

The tree renderer is **one generic React component** (`<DataSourceTree />`) shared across all plugins:

1. On startup, fetches `GET /api/plugins/` → gets all plugin descriptors
2. Reads `descriptor.hierarchy` to know what levels to expect, what icons/labels to use
3. Calls `GET /api/plugins/{id}/children?parentId=` to populate root nodes when plugin is expanded
4. Calls the same endpoint with `parentId=<nodeId>` when a non-leaf node is expanded
5. Shows [⊕] import button on leaf nodes (`isLeaf: true`)
6. On [⊕] click: if dataset fits within row limit, imports directly; if it exceeds the limit, opens the generic filter/column-selection dialog (§2.5)
7. If plugin declares `serverSideFilter: true`, the filter dialog sends column/filter selections to the plugin backend for server-side execution

**No plugin-specific frontend code exists.** Adding a new data source means writing only a backend plugin that implements the standard Python interface — the UI picks it up automatically.

## 5. Migration from Current Design

| Current | New |
|---------|-----|
| SupersetPanel with 2 tabs | Single tree under "Superset" folder, datasets grouped by dashboard |
| DataLoadMenu (upload/paste/URL) | "Local Files" / "Upload" top-level folder in tree |
| Separate plugin panels | All plugins in one tree |
| Landing page with demos | Main area welcome when workspace is empty (Option C) |

## 6. Design Decisions

1. **Search scope**: Global search across all plugins with source badges.
2. **Lazy loading**: Load on expand, cache aggressively.
3. **Workspace section in tree**: A "Recently Imported Tables" section appears in the tree, showing tables the user has previously imported across sessions. This makes it easy to reuse the same data for new analysis. For v1, this can simply display tables from existing sessions rather than maintaining a separate copy.
4. **Multi-instance plugins**: Supported. Users can connect multiple instances of the same plugin type (e.g., two MySQL databases). Each instance gets a unique plugin instance ID and appears as a separate top-level folder.
5. **Drag-and-drop**: Click-to-import only for v1. Drag-and-drop from source tree to data thread is a future enhancement.

## 7. Open Questions

(None — all resolved.)

## 7. Related Docs

- ~~1-data-source-plugin-architecture.md~~ — 已删除，Plugin 架构已被 DataConnector 取代
- ~~1-sso-plugin-architecture.md~~ — 已删除，SSO 架构已合并到 TokenStore + OIDC
- [2-external-dataloader-enhancements.md](2-external-dataloader-enhancements.md) — Data loading improvements
