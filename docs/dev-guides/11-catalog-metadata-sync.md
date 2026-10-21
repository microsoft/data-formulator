# 11. Catalog Metadata 同步

## 概述

本模块把远端数据源的 catalog（表列表 + 表/列 metadata）缓存到磁盘，
支撑 Agent 数据发现、前端目录浏览、以及未导入数据集的 metadata 预览。

## 架构

```
catalog_cache/<source>.json       — catalog 快照（listing + metadata），见「存储格式」
catalog_discovery/<source>.json   — 后台 discovery 状态（另有同名 .lock / .state.lock）
```

### 数据流

**展开连接器 / 连接后首次浏览（tree，后台 discovery）：**
1. 前端 `fetchConnectorCatalog()`（`src/app/utils.tsx`）以 `background: true` 调用 `POST /get-catalog-tree`
2. 有 cache 时，后端直接返回由 cache 构建的目录树（`discovery.status = "complete"`）
3. 无 cache、请求带 `refresh`、本地文件夹 loader、或上次 discovery 为 `failed` / `interrupted`（请求带 `retry`）时，`start_catalog_discovery()`（`datalake/catalog_refresh.py`）在后台线程执行 `loader.list_tables()` + `ensure_table_keys()`，结果以 `refresh_kind="listing"` 写入 cache，接口立即返回 `discovery.status = "running"`
4. 前端以 `poll: true` 轮询（指数退避，总时限 5 分钟），`complete` 后取树；`failed` / `interrupted` 时显示错误和「重试 discovery」

`POST /connect` 本身不读写 cache。

**非 background 的 `get-catalog-tree` 调用：** 优先读 cache；无 cache 时实时 `list_tables()` 且不写 cache。
例外：本地文件夹 loader 每次都重新扫描，无 filter 时以 `refresh_kind="listing"` 写回 cache。

**用户点击刷新（sync）：**
1. 前端调用 `POST /sync-catalog-metadata`
2. 后端调用 `loader.sync_catalog_metadata()` → 返回增强的表列表
3. 结果以 `mode="replace"`、`refresh_kind="full"` 写入 `catalog_cache/`
4. 目录树**直接返回给前端**（前端不再二次调用 `GET_CATALOG_TREE`）

**Agent 数据发现（按策略自动刷新）：**
1. `DataDiscoveryService`（`data_operations/discovery.py`）的 `summarize_data_sources` / `list_data` / `find_data` 先调用 `ensure_catalogs_current()`，对每个已启用且可用的 source 调用 `ensure_catalog_freshness()`；`describe_data` 经 `handle_read_catalog_metadata()` 也会触发同一流程
2. 按 loader 的 `CatalogCachePolicy` 计算 listing / metadata freshness；允许自动刷新且已过期时：无 snapshot 则同步刷新，有 snapshot 则先返回旧 snapshot、在后台线程池刷新
3. 刷新失败通过 `record_catalog_refresh_failure()` 记录错误，不覆盖上次成功的 tables；失败后在 `minimum_retry_seconds` 内不重试
4. `find_data` 为前几个未导入命中补 preview：cache 中无列信息时在 5 秒内实时调用 `loader.get_metadata()`，结果通过 `update_table_metadata()` 合并回 cache

### 身份隔离

`catalog_cache` 按 identity 隔离存储，遵循现有
`DataConnector` 身份模型（参见 dev-guide-3 §5）：

- **用户连接器**：`users/<identity>/catalog_cache/`
- 写入路径通过 `get_user_home(identity)` 获取；Agent 侧从 `workspace.user_home` 派生同一目录。
- 关闭外部连接器（`user_connectors_disabled()`）时，`load_catalog()` / `list_cached_sources()` 只暴露 admin source（如 `sample_datasets`）；被断开（disabled）的连接器也会从 `list_cached_sources()` 和 `find_catalog_cache()` 中过滤掉。

## 关键文件

| 文件 | 职责 |
|------|------|
| `py-src/.../data_loader/external_data_loader.py` | 基类 `sync_catalog_metadata()`、`ensure_table_keys()`、`search_catalog()`、`CatalogCachePolicy` |
| `py-src/.../data_loader/__init__.py` | 内置 loader 的 `_BUILTIN_CATALOG_POLICIES` |
| `py-src/.../data_loader/superset_data_loader.py` | Superset loader，`list_tables()` 包含并行列信息拉取 + `extra` JSON 铺平 |
| `py-src/.../data_loader/superset_client.py` | `get_dataset_columns()`，含 fallback 到完整详情接口 |
| `py-src/.../datalake/catalog_cache.py` | 磁盘缓存（schema v2，原子写入）、`find_catalog_cache()` 正则搜索、`list_path_children()` / `summarize_catalog_sources()` 层级浏览 |
| `py-src/.../datalake/catalog_refresh.py` | 后台 discovery、`ensure_catalog_freshness()` 自动刷新 |
| `py-src/.../data_connector.py` | API 端点：sync、catalog tree、search 等 |
| `py-src/.../data_operations/discovery.py` | `DataDiscoveryService`：Agent 数据发现工具的实现 |
| `py-src/.../agents/context.py` | `handle_read_catalog_metadata()`、`handle_inspect_source_data()` |
| `py-src/.../agents/agent_utils.py` | `build_catalog_metadata_lookups()`、`generate_data_summary()` — Agent 上下文自动注入 |
| `py-src/.../analyst/session_layer/layer.py` | `AnalystAgent` 会话视图中表的 description / 列 metadata 叠加 |
| `src/views/DataSourceSidebar.tsx` | 前端：sync API + 本地树渲染 |
| `src/components/VirtualizedCatalogTree.tsx` | 虚拟化树渲染 + hover card |
| `src/app/utils.tsx` | `CONNECTOR_ACTION_URLS`、`fetchConnectorCatalog()` |

## 缓存写入边界

`save_catalog()` 有两个维度的参数：

| 参数 | 取值 | 行为 |
|------|------|------|
| `mode` | `"replace"`（默认） | 写入新快照 |
| | `"seed_if_missing"` | 仅在文件不存在时写入（当前无调用方） |
| `refresh_kind` | `"full"`（默认） | 用新结果替换 tables，更新 `metadata_refreshed_at` |
| | `"listing"` | 与旧 tables 按 `table_key` / `path` / `name` 合并：新 listing 中非空的 metadata 覆盖旧值，旧的富 metadata（如 columns）保留；`metadata_refreshed_at` 不变 |

写入方：

| 场景 | 写入方式 |
|------|---------|
| `sync-catalog-metadata`（用户点击刷新） | `replace` + `full` |
| `get-catalog-tree` 后台 discovery | `listing` |
| `get-catalog-tree` 本地文件夹（非 background、无 filter） | `replace` + `listing` |
| `ensure_catalog_freshness()` 自动刷新 | 按策略的 `automatic_refresh_kind`（`listing` 调 `list_tables()`，`full` 调 `sync_catalog_metadata()`） |
| `find_data` preview 实时拉取 | `update_table_metadata()`，按 `table_key` 合并非空字段 |
| 刷新失败 | `record_catalog_refresh_failure()`，只更新状态字段 |

**核心原则：** 轻量的 listing 刷新不能降级 sync 拉到的富 metadata（由 `refresh_kind="listing"` 的合并保证）。
所有写入都是 best-effort，异常只记 debug 日志，不中断请求。

### CatalogCachePolicy

每个 loader 类通过 `CATALOG_CACHE_POLICY` / `catalog_cache_policy()` 声明缓存策略：

| 字段 | 默认值 | 说明 |
|------|-------|------|
| `listing_ttl_seconds` | 21600 | listing 新鲜期 |
| `metadata_ttl_seconds` | 86400 | metadata 新鲜期 |
| `refresh_cost` | `"expensive"` | `local` / `free` / `cheap` / `moderate` / `expensive` |
| `automatic_refresh` | `"never"` | `always` / `while_connected` / `never` |
| `automatic_refresh_kind` | `"listing"` | `listing` / `full` |
| `minimum_retry_seconds` | 300 | 刷新失败后的最短重试间隔 |

内置 loader 的策略在 `data_loader/__init__.py` 的 `_BUILTIN_CATALOG_POLICIES` 中覆盖（例如 `sample_datasets` 为 `always` + `full`，MySQL/PostgreSQL/MSSQL/ClickHouse/Cube 为 `while_connected` + `full`，本地文件夹 TTL 为 0）。

## API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/connectors/sync-catalog-metadata` | POST | 全量 metadata 同步 → 写 cache，返回目录树 + 同步摘要 |
| `/api/connectors/get-catalog-tree` | POST | 浏览树；`background: true` 时走后台 discovery（见数据流） |
| `/api/connectors/get-catalog-progress` | POST | 非 background 的实时 listing 进度消息（前端当前未使用） |
| `/api/connectors/get-cached-catalog-tree` | POST | 纯读 cache，返回 `cache_hit` + 树 + `synced_at`（前端当前未使用） |
| `/api/connectors/search-catalog` | POST | 调用 `loader.search_catalog()` 实时搜索源端，不读写 cache |

### Sync API 响应

`json_ok()` 信封中的 `data`：

```json
{
    "message": "Catalog sync complete",
    "message_code": "catalog.syncComplete",
    "message_params": { "synced": 10, "failed": 1, "total": 13 },
    "hierarchy": [...],
    "effective_hierarchy": [...],
    "tree": [...],
    "sync_summary": { "synced": 10, "partial": 2, "failed": 1, "total": 13 }
}
```

存在 `partial` 或 `failed` 时 `message_code` 为 `catalog.syncPartial`。

## 存储格式

### catalog_cache

```json
{
    "schema_version": 2,
    "source_id": "superset_prod",
    "synced_at": "2026-04-28T10:00:00Z",
    "listing_refreshed_at": "2026-04-28T10:00:00Z",
    "metadata_refreshed_at": "2026-04-28T10:00:00Z",
    "refresh_kind": "full",
    "refresh_status": "complete",
    "last_refresh_attempt_at": "2026-04-28T10:00:00Z",
    "last_refresh_error": null,
    "tables": [
        {
            "table_key": "a1b2c3d4-...",
            "name": "42:monthly_orders",
            "path": ["Sales Dashboard", "monthly_orders"],
            "metadata": {
                "uuid": "a1b2c3d4-...",
                "dataset_id": 42,
                "row_count": 15000,
                "description": "Monthly order aggregation",
                "columns": [...],
                "source_metadata_status": "synced"
            }
        }
    ]
}
```

`load_catalog_snapshot()` 读取时按策略 TTL 计算 `listing_freshness` / `metadata_freshness`；没有新字段的旧文件回退到 `synced_at`。

### source_metadata_status 枚举

| 值 | 含义 | 典型场景 |
|----|------|---------|
| `"synced"` | 已完整同步（表描述 + 列信息） | SQL loader 从 info_schema 拿到列；Superset 列 API 返回数据；基类 `sync_catalog_metadata()` 对未设置状态的记录补 `synced` |
| `"partial"` | 部分成功（有描述但列信息为空或缺失） | Superset 列 API 返回空列表；SQL 表存在但无列 |
| `"unavailable"` | metadata 获取完全失败（API 错误） | 网络超时、认证失败 |
| `"not_synced"` | 记录未带状态 | `handle_read_catalog_metadata()` 在 metadata 无该字段时显示的默认值 |

未显式设置时，`infer_source_metadata_status()` 按是否有 columns / description 推断。

## table_key 契约

`list_tables()` 和 `sync_catalog_metadata()` 返回的每条 table 记录**必须**
包含 `table_key` 字段 — 该表在数据源中的稳定唯一标识。

| 数据源类型 | table_key 策略 | 原因 |
|-----------|---------------|------|
| Superset | dataset UUID | ID 可能因导入/导出变化，UUID 永久不变 |
| PostgreSQL/MySQL/MSSQL | `_source_name`（如 `mydb.public.orders`） | 稳定，除非表被 rename |
| 文件类（S3 等） | 文件路径或文件名 | 同上 |

基类 `ensure_table_keys()` 提供 fallback（`_source_name` → `name`）。

**对 Loader 开发者的要求：**
- `list_tables()` 和 `sync_catalog_metadata()` 必须在每条记录中包含 `table_key`。
- `table_key` 不能为空。它作为 JSON 字典 key 使用（无文件系统路径风险）。
- 其他辅助标识（`uuid`、`dataset_id`、`_source_name`）保留在 `metadata` 中备查；`resolve_load_table()` 和 `build_catalog_metadata_lookups()` 也接受这些标识匹配。

## 搜索

`find_catalog_cache()`（`datalake/catalog_cache.py`）在 cache 中查找 folder / table 节点：

- `query` 为可选的大小写不敏感**正则**；省略时枚举 `path_prefix` 下的全部后代；非法正则抛 `CatalogSearchError`。
- 可用 `filter_by`（`folder` / `table`）、`fields`（`name` / `description` / `columns`）、`path_prefix`、`exclude_tables` 收窄；`limit` 上限 500，返回 `(results, truncated)`。
- 按 `score` 降序排序，打分如下：

| 匹配类型 | 分数 |
|---------|------|
| 表名（叶子名或 `name`）/ 文件夹名 | +10 |
| 远端描述 | +5 |
| 列名 | +2 |
| 远端列描述 | +1 |

`find_data` 未指定 `source_id` 时先搜索 workspace 已导入的表，再搜索 cache；整句无命中且 query 是普通短语时，会按词再搜一次（`_find_any_word()`）。

## Loader 实现

### 基类默认实现

```python
def sync_catalog_metadata(self, table_filter=None):
    """默认实现：直接返回 list_tables() 结果。对于 SQL loader（已从
    information_schema 获取完整列信息）来说足够。"""
    tables = self.list_tables(table_filter)
    self.ensure_table_keys(tables)
    for t in tables:
        meta = t.get("metadata")
        if meta and "source_metadata_status" not in meta:
            meta["source_metadata_status"] = SOURCE_METADATA_SYNCED
    return tables
```

### 各 Loader 是否需要 override

| Loader | list_tables 包含列信息？ | 需要 override？ | 原因 |
|--------|------------------------|----------------|------|
| MySQL | 是（information_schema） | **不需要** — 默认实现足够 | 单库 info_schema 是全局的 |
| PostgreSQL | 是（单库） | **需要** | info_schema 按库隔离；database 为空时需遍历所有库 |
| MSSQL | 是（单库） | **需要** | 同 PostgreSQL |
| BigQuery | 是 | **不需要** | — |
| S3/AzureBlob | 否（无列描述） | **不需要** | 无更多 metadata 可获取 |
| Superset | 是（`list_tables()` 内含并行列拉取） | **不需要** | `list_tables()` 已通过 `_enrich_columns()` 并行拉取列信息 |

### Superset 同步细节

- `list_tables()` 包含完整列信息拉取，无需单独的 `sync_catalog_metadata()` override。
- `list_datasets()` 默认响应已包含 `uuid` 和 `description`，无需修改请求参数。
- 列信息通过 `_enrich_columns()` 并行获取，调用 `/api/v1/dataset/{pk}/column`（轻量接口，避免完整详情接口的笛卡尔积）。
- `superset_client.get_dataset_columns()` 在专用列端点不可用时自动回退到完整详情接口。
- `ThreadPoolExecutor(max_workers=5)`，全局超时 120s。
- 单个 dataset 列拉取失败 → 标记 `source_metadata_status: "unavailable"`，不阻断其他。
- `_build_column_entry()` 通用铺平 Superset 列的 `extra` JSON 字段（如 `certification`、`warning_markdown`），追加到 `description` 供 Agent 消费。

## 连接生命周期

| 操作 | catalog_cache |
|------|--------------|
| 连接（`connect`） | 不读写；连接器重新标记为 enabled |
| 断开连接 | 文件保留；连接器标记为 disabled，Agent 发现工具和 `list_cached_sources()` 跳过它 |
| 删除连接器 | `cancel_catalog_discovery()` + `delete_catalog(user_home, source_id)` |
| 重新连接 | 复用已有 cache；之后按策略自动刷新或 sync 时更新 |
| 重新同步（刷新） | 覆盖 |

## 前端浏览模型

### 设计原则

1. **一次全量取轻量树** — 展开连接器时通过 `GET_CATALOG_TREE` 一次获取完整嵌套树（所有层级），不做逐级懒加载
2. **虚拟化渲染** — 侧栏使用 `react-virtuoso`（`customScrollParent`），无 `scrollParent` 时回退到 `react-window` 的 `FixedSizeList`，即使 6000+ 节点也只渲染可视区域
3. **本地过滤** — 用户输入时在内存中的轻量树上做客户端过滤，零网络请求
4. **后端搜索** — 回车/按钮触发 `SEARCH_CATALOG`，由 loader 在源端搜索，结果替换显示树
5. **节点展开/收起完全由 React state 控制** — 搜索模式下也允许用户自由操作

### 前后端交互流程

```
┌───────────────────────────────────────────────────────────────────────┐
│                         用户操作 → API 调用                           │
├───────────────────────────────────────────────────────────────────────┤
│ 首次展开连接器    → POST /api/connectors/get-catalog-tree             │
│                    (background: true；discovery 运行中则轮询)          │
│                    返回: { tree, hierarchy, effective_hierarchy }     │
│                    前端: 完整树存入 catalogByConnector state           │
│                    顶层 namespace ≤ 10 个时自动展开                    │
│                                                                       │
│ 点击刷新按钮      → POST /api/connectors/sync-catalog-metadata        │
│                    (全量拉取远端 metadata，更新磁盘缓存)               │
│                    后端直接返回目录树（不再二次调 tree 接口）           │
│                    前端: 直接将返回的 tree 存入 state                  │
│                    （服务端搜索激活时，刷新按钮改为重新搜索）          │
│                                                                       │
│ 展开/收起文件夹   → 纯前端操作，更新 treeExpanded state，零网络请求    │
│                                                                       │
│ 搜索框输入        → 本地 filterTree() 在内存树上过滤                  │
│                    命中结果自动展开所有 namespace 节点                 │
│                    用户仍可手动收起/展开                               │
│                                                                       │
│ 搜索框回车/按钮   → POST /api/connectors/search-catalog               │
│                    返回: { tree: [...], truncated }                    │
│                    前端: 结果存入 searchCatalogCache，自动全展开       │
│                                                                       │
│ 清空搜索          → 回到原始 catalogByConnector 树，恢复之前展开状态   │
└───────────────────────────────────────────────────────────────────────┘
```

### 关键 API 端点（浏览相关）

| 端点 | 用途 | 返回数据量 |
|------|------|-----------|
| `GET_CATALOG_TREE` | 获取完整嵌套轻量树 | 轻量（经 `_lightweight_tree_for_response()` 裁剪） |
| `SYNC_CATALOG_METADATA` | 全量 metadata 同步（含列信息） | 磁盘 cache 为完整 metadata；响应树同样裁剪为轻量 |
| `SEARCH_CATALOG` | 服务端搜索 | 轻量（匹配结果的嵌套树） |
| `GET_CATALOG` | 单级 ls()（保留用于特殊场景，前端当前未使用） | 轻量（单级扁平节点） |

### 数据结构

`GET_CATALOG_TREE` 和 `SYNC_CATALOG_METADATA` 返回的树节点（`CatalogTreeNode`，定义在 `src/components/CatalogTree.tsx`）：

```typescript
{
    name: string;           // 显示名
    node_type: 'namespace' | 'table' | 'table_group' | 'load_more';
    path: string[];         // 从根到当前节点的路径
    metadata: {             // 轻量 metadata（_lightweight_tree_for_response 裁剪后）
        _source_name?: string;
        dataset_id?: number;
        row_count?: number;
        description?: string;
        source_metadata_status?: string;
        columns?: { name: string; type?: string }[];  // 最多 50 列，仅 name/type
        column_count?: number;
        // semantic model（query_model === "semantic"）保留完整 columns
    } | null;
    children?: CatalogTreeNode[];  // namespace 节点含子节点（递归嵌套）
}
```

### 虚拟化渲染（`VirtualizedCatalogTree.tsx`）

- 传入 `scrollParent` 时使用 `react-virtuoso` 的 `customScrollParent`（侧栏即如此，避免嵌套滚动条）；否则使用 `react-window` 的 `FixedSizeList`
- 将嵌套树 flatten 为一维行列表，根据展开状态动态计算
- `FixedSizeList` 在 `maxHeight="none"` 时，高度上限取 `max(400, window.innerHeight - 200)`（确保虚拟化生效）
- 少于 100 行时不启用虚拟化，直接 DOM 渲染
- 默认行高 `px(24)`

### 展开/收起 state 管理

```typescript
// treeExpanded: Record<connectorId, expandedNodeIds[]>
// expandedNodeIds 是 node.path.join('/') 组成的字符串数组

// 搜索触发时：自动设置所有 namespace 为展开
setTreeExpanded(prev => ({
    ...prev,
    [connId]: collectNamespaceIds(filteredTree),
}));

// 用户手动操作：直接更新（搜索模式下也允许）
onExpandedChange={(newIds) => {
    setTreeExpanded(prev => ({ ...prev, [connector.id]: newIds }));
}}
```

### 性能保证（禁止回退的设计决策）

| 决策 | 原因 | 禁止的做法 |
|------|------|-----------|
| 一次取全树 | 避免逐级拉取的竞态、badge 闪烁、多级嵌套支持 | ❌ 用 `GET_CATALOG` 逐级 fetch + mergeChildrenAtPath |
| 轻量树用于浏览 | 树响应经 `_lightweight_tree_for_response()` 裁剪，完整 metadata 只留在磁盘 cache | ❌ 在树响应或浏览 state 中放入完整 columns / sample_rows |
| 有界高度 / 外部滚动容器 | 确保只渲染可视行 | ❌ height=totalHeight 导致所有行都被渲染 |
| 搜索不锁定展开状态 | 用户需要收起不关心的文件夹 | ❌ 搜索时强制 expanded=collectNamespaceIds() 覆盖用户操作 |

### 回归风险清单

如果修改以下逻辑，必须验证：

- [ ] 展开有 6000+ 表的 namespace → 不卡顿（虚拟化生效）
- [ ] 展开后 namespace 右侧的数量 badge 立即显示正确数字
- [ ] 搜索时可以收起文件夹
- [ ] 清空搜索后恢复原始树和展开状态
- [ ] 刷新按钮触发远端同步后树正确刷新
- [ ] 无 cache 的连接器展开时显示 discovery 进度，失败后可重试

## Agent 工具链

`AnalystAgent` 通过 skill 暴露数据发现工具（声明在 `analyst/skills/*/tools.json`，使用指引见 `connected_data` skill 的 `SKILL.md`）：

| 工具 | 所属 skill | 层级 | 输入 | 输出 |
|------|-----------|------|------|------|
| `summarize_data_sources` | workspace | Overview | — | 每个已连接 source 的层级统计、顶层条目、样例表、freshness |
| `list_data` | workspace | Browse | source_id + path + filter_by | 当前路径下的直接子节点（类似 `ls`） |
| `find_data` | workspace | Search | query（正则）+ source_id/path + filter_by/fields | workspace 已导入表 + cache 命中（`source_id`/`table_key`、匹配列、preview） |
| `describe_data` | workspace | Read | source_id + table_key（+ 列分页/过滤） | 完整 metadata：列、类型、描述、schema、row_count、sample rows |
| `probe_data` | workspace | Probe | source_id + table_key + query | 对源端执行有界只读查询（每轮有 probe 预算） |
| `inspect_source_data` | analysis | Data | table_names（仅已导入） | `generate_data_summary()`：schema、字段统计、样例行 |

工作流：概览/浏览/搜索 → 读取 metadata →（需要时 probe）→ `propose_data_operation` 导入 → 检查数据。
`workspace` skill 中的这些工具由 `analyst/skills/workspace/data_loading.py` 分发到 `DataDiscoveryService`。

### Agent 上下文自动注入

`build_catalog_metadata_lookups(workspace)`（`agent_utils.py`）把 catalog cache 元数据叠加到已导入表上，
被 `generate_data_summary()` 和 `AnalystAgent` 会话视图（`session_layer/layer.py` 的 `_descriptions()`）使用。该函数：

1. 从 `workspace.user_home` 自动解析用户目录（无需外部传参）
2. 加载 `list_cached_sources()` 返回的所有 source 的 `catalog_cache`
3. 用 workspace 中表的 `TableMetadata.source_table` 匹配 catalog 条目的 `table_key` / `name` / `_source_name` / `dataset_id` / `uuid`
4. 提取表描述、列描述（`source_description` 优先）以及列的 `verbose_name`、`expression`

表描述在两个入口中都以 workspace metadata 优先、catalog 只补缺失；列描述在 `generate_data_summary()` 中由 catalog 覆盖同名列，在会话视图中仍以 workspace 优先。

**设计原则：** `user_home` 不通过函数参数传播。`Workspace` 对象持有 `_identity_id`，
通过 `user_home` property 自动派生用户目录。所有需要 catalog 数据的函数从
workspace 内部获取，调用方无需关心存储路径。

### import_options 加载口径注入

当表通过数据连接器导入时，用户选择的过滤条件、列、排序和行数限制
（统称 `import_options`）会存储在 `TableMetadata.import_options` 中。
Agent 在构建数据摘要时会自动读取该字段并生成人类可读的 provenance 描述，
例如：`Data subset: filters [...], selected columns ["id", "amount"], sorted by created_at desc, row limit 2,000,000`。

**传递路径：**

1. **数据导入** — `write_parquet_from_arrow(source_info={'import_options': ...})`
   将 `import_options` 持久化到 workspace metadata。
2. **数据刷新** — `refresh_parquet_from_arrow()` 自动从旧 metadata 复制
   `import_options` 到新 metadata，确保刷新不丢失加载口径。
3. **API 暴露** — `GET /api/tables/list-tables` 在 `source_metadata` 中返回
   `import_options`，前端可展示或传递。
4. **Agent 上下文** — `generate_data_summary()` 和 `_get_workspace_metadata_lookups()`（`context.py`，
   供会话视图的 `loaded_with` 字段使用）通过 `_format_import_options()` 将 `import_options` 格式化后注入表描述。

**格式化函数** `_format_import_options(opts)` 位于 `agent_utils.py`，
依次拼接 `filters <json>`、`selected columns <json>`、`sorted by ... asc|desc`、`row limit N`，
以 `Data subset: ` 开头。空 opts 或无可识别字段时返回空字符串。

## 错误码

| 错误码 | 触发场景 |
|--------|---------|
| `CATALOG_SYNC_TIMEOUT` | `sync-catalog-metadata` 中 loader 抛出 `TimeoutError`（如 Superset 列拉取超过 120s），`retry=True` |
| `CATALOG_NOT_FOUND` | 已在 `ErrorCode` 和前端 `errorCodes.ts` 中定义，后端当前未抛出 |

其余连接器错误通过 `classify_and_raise_connector_error(e, operation="catalog")` 分类。

## i18n Keys

- 同步结果：后端 `message_code` 为 `catalog.syncComplete` / `catalog.syncPartial`（`messages.json`），前端通过 `translateBackend()` 显示；`dataLoading.syncPartial` 用作同步/discovery 失败时的兜底文本。
- `dataLoading` namespace 中另有 `syncInProgress`、`syncComplete`、`metadataStatusSynced`、`metadataStatusPartial`、`metadataStatusUnavailable`、`metadataStatusNotSynced`，当前没有组件引用。
- 错误翻译在 `errors` namespace：`catalogSyncTimeout`、`catalogNotFound`（映射见 `src/app/errorCodes.ts`）。
- 侧栏刷新按钮使用 `sidebar.refreshCatalog`（`common.json`）；discovery 失败文案 `sidebar.discoveryIncomplete`、`sidebar.retryDiscovery` 目前只依赖代码中的 `defaultValue`，locale 文件中尚无这两个 key。

## 新 Loader 检查清单

创建新的 `ExternalDataLoader` 子类时：

- [ ] 确保 `list_tables()` 在每条记录上设置 `table_key`（或依赖 `ensure_table_keys()` fallback）
- [ ] 若 `list_tables()` 缺少列详情，在 `list_tables()` 内添加并行列拉取（参考 `SupersetLoader._enrich_columns()`），或 override `sync_catalog_metadata()`
- [ ] 逐表详情拉取使用 `ThreadPoolExecutor` 并限制并发数
- [ ] 为每张表设置 `source_metadata_status`：`"synced"`、`"partial"` 或 `"unavailable"`
- [ ] 在 `list_tables()` 或 `sync_catalog_metadata()` 返回前调用 `self.ensure_table_keys(tables)`
- [ ] 对于 info_schema 按库隔离的 SQL loader，在 `sync_catalog_metadata()` 中遍历所有可访问数据库
- [ ] 按刷新成本设置 `CATALOG_CACHE_POLICY`（内置 loader 在 `_BUILTIN_CATALOG_POLICIES` 中登记）；昂贵的源保持 `automatic_refresh="never"`
- [ ] 长时间 listing 可通过 `_report_progress()` 上报进度，供后台 discovery 显示

## Agent 元数据传递审计表

下表列出每个元数据字段在 Agent 上下文管线中的传递状态。

### 元数据字段说明

| 字段 | 来源 | 说明 |
|------|------|------|
| `description` / `source_description` | Loader → catalog_cache | 来自源系统的表/列描述 |
| `verbose_name` | Loader（如 Superset） | 列的显示别名（如中文名） |
| `expression` | Loader（如 Superset） | 计算列公式（如 `SUM(line_items.amount)`） |
| `extra` | Loader（Superset） | Superset 列的 `extra` JSON 字段，包含 `certification`、`warning_markdown` 等信息。`_build_column_entry()` 自动铺平到 `description` |
| `import_options` | 数据导入/刷新 | 用户选择的过滤/列/排序/行限制条件（与本次分析相关） |

### 管线节点传递矩阵

| 管线节点 | description | verbose_name | expression | import_options |
|----------|:-----------:|:------------:|:----------:|:--------------:|
| **Loader** (`list_tables` / `sync_catalog_metadata`) | ✅ | ✅ (Superset) | ✅ (Superset) | — |
| **catalog_cache** (`save_catalog` / `load_catalog`) | ✅ | ✅ | ✅ | — |
| **`write_parquet_from_arrow`** (`workspace.py`) | — | — | — | ✅ 持久化 |
| **`refresh_parquet_from_arrow`** (`workspace.py`) | — | — | — | ✅ 保留 |
| **`_table_metadata_to_source_metadata`** (`tables.py`) | — | — | — | ✅ API 暴露 |
| **`build_catalog_metadata_lookups`** (`agent_utils.py`) | ✅ `col_desc_cache` | ✅ `col_meta_cache` | ✅ `col_meta_cache` | — |
| **`_format_import_options`** (`agent_utils.py`) | — | — | — | ✅ 格式化 |
| **`get_field_summary`** (`agent_utils.py`) | ✅ `(description)` | ✅ `[verbose_name]` | ✅ `[calc: expr]` | — |
| **`generate_data_summary`** (`agent_utils.py`) | ✅ | ✅ | ✅ | ✅ |
| **`_get_workspace_metadata_lookups`** (`context.py`) | ✅（workspace metadata） | — | — | ✅ |
| **`SessionLayer._data_profile`** (`session_layer/layer.py`) | ✅ | ✅ 列字段 | ✅ 列字段 | ✅ `loaded_with` |
| **`handle_read_catalog_metadata`** (`context.py`) | ✅ | ✅ `[verbose_name]` | ✅ `[calc: expr]` | — |

### Agent 受益矩阵

| Agent / 入口 | 上下文入口 | description | verbose_name | expression | import_options |
|-------|-----------|:-----------:|:------------:|:----------:|:--------------:|
| AnalystAgent 会话视图（`session/tables/<name>.json`，焦点表内联到初始上下文） | `SessionLayer._data_profile` | ✅ | ✅ | ✅ | ✅ |
| AnalystAgent `inspect_source_data` | `generate_data_summary` | ✅ | ✅ | ✅ | ✅ |
| AnalystAgent `describe_data` | `handle_read_catalog_metadata` | ✅ | ✅ | ✅ | — |
| DataLoadAgent（`/api/agent/process-data-on-load`） | `generate_data_summary` | ✅ | ✅ | ✅ | ✅ |
| CodeExplanationAgent（`/api/agent/code-expl`） | `generate_data_summary` | ✅ | ✅ | ✅ | ✅ |
