# 11. Catalog Metadata 同步与 Annotations

## 概述

本模块提供远端数据源的全量 catalog metadata 同步，以及用户自有的 annotation 存储。
支撑 Agent 搜索、前端目录浏览、以及未导入数据集的 metadata 预览。

## 架构

```
catalog_cache/<source>.json     — 从远端自动同步（刷新时覆盖）
catalog_annotations/<source>.json — 用户自有（同步时绝不覆盖）
catalog_merge.py                — 运行时合并（用户标注优先）
```

### 数据流

1. 用户连接或点击刷新 → 前端调用 `POST /sync-catalog-metadata`
2. 后端调用 `loader.sync_catalog_metadata()` → 返回增强的表列表
3. 结果写入 `catalog_cache/` 并作为完整树返回给前端
4. 前端将完整树存入 React state；节点展开为纯本地操作
5. Agent 通过 `search_data_tables` → `read_catalog_metadata` 进行数据发现

### 身份隔离

`catalog_cache` 和 `catalog_annotations` 按 identity 隔离存储，遵循现有
`DataConnector` 身份模型（参见 dev-guide-3 §5）：

- **用户连接器**：`users/<identity>/catalog_cache/` 和 `users/<identity>/catalog_annotations/`
- 写入路径通过 `get_user_home(identity)` 获取，与 `save_catalog()` 一致。
- 不同 identity 之间的 annotations 完全隔离。

## 关键文件

| 文件 | 职责 |
|------|------|
| `py-src/.../external_data_loader.py` | 基类 `sync_catalog_metadata()` + `ensure_table_keys()` |
| `py-src/.../superset_data_loader.py` | Superset override，并发拉取列信息 |
| `py-src/.../superset_client.py` | `get_dataset_columns()`，含 fallback 到完整详情接口 |
| `py-src/.../datalake/catalog_cache.py` | 磁盘缓存，含 `synced_at`、DuckDB/Python 双路径搜索 |
| `py-src/.../datalake/catalog_annotations.py` | 用户标注，文件锁 + 乐观版本控制 |
| `py-src/.../datalake/catalog_merge.py` | 运行时合并：`display_description = user \|\| source` |
| `py-src/.../data_connector.py` | API 端点：sync、PATCH/GET annotations |
| `py-src/.../agents/context.py` | `handle_read_catalog_metadata()` + `handle_search_data_tables()` |
| `src/views/DataSourceSidebar.tsx` | 前端：sync API + 本地树渲染 |
| `src/app/utils.tsx` | `CONNECTOR_ACTION_URLS.SYNC_CATALOG_METADATA` / `CATALOG_ANNOTATIONS` |

## API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/connectors/sync-catalog-metadata` | POST | 全量 metadata 同步 → 返回目录树 + 同步摘要 |
| `/api/connectors/catalog-annotations` | PATCH | 单表标注 patch，乐观并发控制 |
| `/api/connectors/catalog-annotations` | GET | 读取某个数据源的所有标注 |

### Sync API 响应

```json
{
    "status": "ok",
    "tree": [...],
    "sync_summary": { "synced": 10, "partial": 2, "failed": 1, "total": 13 }
}
```

### Annotation PATCH 请求

```json
{
    "connector_id": "superset_prod",
    "table_key": "uuid-...",
    "expected_version": 1,
    "description": "...",
    "notes": "...",
    "tags": ["..."],
    "columns": { "col_name": { "description": "..." } }
}
```

语义规则：
- `description: ""` → 删除该字段
- 所有标注字段为空 → 从 annotations 中移除该表条目
- `expected_version` 不匹配 → 返回 `ANNOTATION_CONFLICT` 错误
- 新建文件（无 version）：传 `expected_version: 0` 或 `null`

## 存储格式

### catalog_cache

```json
{
    "source_id": "superset_prod",
    "synced_at": "2026-04-28T10:00:00Z",
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

### catalog_annotations

```json
{
    "source_id": "superset_prod",
    "updated_at": "2026-04-28T10:00:00Z",
    "version": 3,
    "tables": {
        "<table_key>": {
            "description": "...",
            "notes": "...",
            "tags": ["..."],
            "columns": {
                "<col_name>": { "description": "..." }
            }
        }
    }
}
```

### source_metadata_status 枚举

| 值 | 含义 |
|----|------|
| `"synced"` | 已完整同步（表描述 + 列信息） |
| `"partial"` | 部分成功（如表描述有但列信息拉取失败） |
| `"unavailable"` | metadata 获取完全失败，仅有 `list_tables` 级别的基础信息 |
| `"not_synced"` | 从未执行过全量同步（仅有轻量 `list_tables` 结果） |

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
- 其他辅助标识（`uuid`、`dataset_id`、`_source_name`）保留在 `metadata` 中备查。

## Metadata 合并策略

读取时生成运行时 **merged metadata view**，不直接修改任何文件。

- 表级：`display_description = user.description || source.description`
- 列级：`display_column_description = user.columns[col].description || source.columns[col].description`
- `source_description` 和 `user_description` 同时保留，供 Agent 搜索分别加权。
- tags 和 notes 仅来自 annotations。

合并调用点：
- `merge_catalog()` / `merge_table_metadata()`（`catalog_merge.py`）
- Agent `search_data_tables` 通过 `search_catalog_cache()` 的 annotation overlay
- Agent `read_catalog_metadata` 产出供 LLM 消费的 merged view

## 搜索与 Annotations

`search_catalog_cache()` 接受 `annotations_by_source` 参数。
用户标注命中权重更高：

| 匹配类型 | 分数 |
|---------|------|
| 表名 | +10 |
| 用户描述 | +8 |
| 远端描述 | +5 |
| 用户备注 | +3 |
| 用户列描述 | +3 |
| 列名 | +2 |
| 远端列描述 | +1 |

无 annotation 时使用 DuckDB 初步检索；有 annotation 时走 Python 路径叠加标注。
DuckDB 失败时自动回退到 Python。

**已知限制：** 当提供 `annotations_by_source` 时，搜索始终走 Python 路径
（DuckDB 无法在同一查询中读取 annotation JSON）。当前规模下足够；
后续可优化为 DuckDB 联合读取 cache 和 annotation 两个 JSON 文件。

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
            meta["source_metadata_status"] = "synced"
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
| Superset | 否（仅 id/name/row_count） | **需要** | 需并发调用 `get_dataset_columns` |

### Superset 同步细节

- `list_datasets()` 默认响应已包含 `uuid` 和 `description`，无需修改请求参数。
- 列信息通过 `/api/v1/dataset/{pk}/column` 获取（轻量接口，避免完整详情接口的笛卡尔积）。
- `superset_client.get_dataset_columns()` 在专用列端点不可用时自动回退到完整详情接口。
- `ThreadPoolExecutor(max_workers=5)`，全局超时 120s。
- 单个 dataset 列拉取失败 → 标记 `source_metadata_status: "unavailable"`，不阻断其他。

## Annotation 写入策略

### 并发控制

- 文件锁复用 `workspace_metadata.py` 的 `_lock_file` / `_unlock_file`。
- 非阻塞获取 + 10s 超时重试。
- 乐观并发控制：客户端发送 `expected_version`；不匹配 → `ANNOTATION_CONFLICT`。

### 清理语义

- `description: ""` → 删除该 key
- 空的列标注 → 删除该列 key；空的 columns 字典 → 删除 `columns`
- 表标注完全为空 → 从 `tables` 中移除该表 key
- 原子写入：`tempfile.mkstemp` + `os.replace`

### 路径安全

- `source_id` 从已注册的 connector 中解析（白名单），不使用客户端原始输入。
- 文件路径使用 `datalake.naming` 的 `safe_source_id()`。
- `table_key` 仅作为 JSON 字典 key，不参与文件系统路径构造。

## 连接生命周期

| 操作 | catalog_cache | catalog_annotations |
|------|--------------|-------------------|
| 断开连接 | 保留 | 保留 |
| 删除连接器 | 删除 | 保留 |
| 重新连接 | 下次 sync 时覆盖 | 不变 |
| 重新同步（刷新） | 覆盖 | 不变 |

- 删除连接器调用 `delete_catalog(user_home, source_id)`。
- Annotations 在连接器删除后仍保留 — 若重建同名连接器，旧标注自动生效。

## 前端浏览模型

### 设计原则

1. **一次全量取轻量树** — 展开连接器时通过 `GET_CATALOG_TREE` 一次获取完整嵌套树（所有层级），不做逐级懒加载
2. **虚拟化渲染** — 使用 `react-window` 的 `FixedSizeList`，即使 6000+ 节点也只渲染可视区域
3. **本地过滤** — 用户输入时在内存中的轻量树上做客户端过滤，零网络请求
4. **后端搜索** — 回车/按钮触发 `SEARCH_CATALOG` 服务端全文检索，结果替换显示树
5. **节点展开/收起完全由 React state 控制** — 搜索模式下也允许用户自由操作

### 前后端交互流程

```
┌───────────────────────────────────────────────────────────────────────┐
│                         用户操作 → API 调用                           │
├───────────────────────────────────────────────────────────────────────┤
│ 首次展开连接器    → POST /api/connectors/get-catalog-tree             │
│                    返回: { tree: [...nested...], hierarchy: [...] }   │
│                    前端: 完整树存入 catalogByConnector state           │
│                                                                       │
│ 点击刷新按钮      → POST /api/connectors/sync-catalog-metadata        │
│                    (全量拉取远端 metadata，更新磁盘缓存)               │
│                    完成后 → POST /api/connectors/get-catalog-tree      │
│                    前端: 重新加载轻量树到 state                        │
│                                                                       │
│ 展开/收起文件夹   → 纯前端操作，更新 treeExpanded state，零网络请求    │
│                                                                       │
│ 搜索框输入        → 本地 filterTree() 在内存树上过滤                  │
│                    命中结果自动展开所有 namespace 节点                 │
│                    用户仍可手动收起/展开                               │
│                                                                       │
│ 搜索框回车/按钮   → POST /api/connectors/search-catalog               │
│                    返回: { tree: [...] }                               │
│                    前端: 结果存入 searchCatalogCache，自动全展开       │
│                                                                       │
│ 清空搜索          → 回到原始 catalogByConnector 树，恢复之前展开状态   │
└───────────────────────────────────────────────────────────────────────┘
```

### 关键 API 端点（浏览相关）

| 端点 | 用途 | 返回数据量 |
|------|------|-----------|
| `GET_CATALOG_TREE` | 获取完整嵌套轻量树 | 轻量（name/path/基础metadata，含 children 嵌套） |
| `SYNC_CATALOG_METADATA` | 全量 metadata 同步（含列信息） | 重量（完整 columns/row_count 等） |
| `SEARCH_CATALOG` | 服务端全文搜索 | 轻量（匹配结果的嵌套树） |
| `GET_CATALOG` | 单级 ls()（保留用于特殊场景） | 轻量（单级扁平节点） |

### 数据结构

`GET_CATALOG_TREE` 返回的树节点（`CatalogTreeNode`）：

```typescript
{
    name: string;           // 显示名
    node_type: 'namespace' | 'table' | 'table_group';
    path: string[];         // 从根到当前节点的路径
    metadata: {             // 轻量 metadata
        _source_name?: string;
        dataset_id?: number;
        row_count?: number;
        description?: string;
        source_metadata_status?: string;
        // 注意：不含 columns（轻量版）
    } | null;
    children?: CatalogTreeNode[];  // namespace 节点含子节点（递归嵌套）
}
```

### 虚拟化渲染（`VirtualizedCatalogTree.tsx`）

- 使用 `react-window` 的 `FixedSizeList`
- 将嵌套树 flatten 为一维行列表，根据展开状态动态计算
- 当 `maxHeight="none"` 时，高度上限取 `window.innerHeight - 200`（确保虚拟化生效）
- 少于 100 行时不启用虚拟化，直接 DOM 渲染
- 每行高度固定 28px

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
| 轻量树用于浏览 | `GET_CATALOG_TREE` 调 `list_tables()` 不含列信息，数据量小 | ❌ 把 `SYNC_CATALOG_METADATA` 的重数据存入浏览 state |
| FixedSizeList 有界高度 | 确保 react-window 只渲染可视行 | ❌ height=totalHeight 导致所有行都被渲染 |
| 搜索不锁定展开状态 | 用户需要收起不关心的文件夹 | ❌ 搜索时强制 expanded=collectNamespaceIds() 覆盖用户操作 |

### 回归风险清单

如果修改以下逻辑，必须验证：

- [ ] 展开有 6000+ 表的 namespace → 不卡顿（虚拟化生效）
- [ ] 展开后 namespace 右侧的数量 badge 立即显示正确数字
- [ ] 搜索时可以收起文件夹
- [ ] 清空搜索后恢复原始树和展开状态
- [ ] 刷新按钮触发远端同步后树正确刷新

## Agent 工具链

| 工具 | 层级 | 输入 | 输出 |
|------|------|------|------|
| `search_data_tables` | Search | keyword + scope | 候选列表：名称、描述、匹配列、分数、匹配原因 |
| `read_catalog_metadata` | Read | source_id + table_key | 完整 merged metadata：列、类型、描述、schema、row_count |
| `inspect_source_data` | Data | table_names（仅已导入） | Parquet schema、样例行、统计信息 |

工作流：搜索 → 读取 metadata → （需要时导入） → 检查数据。

## 错误码

| 错误码 | 触发场景 |
|--------|---------|
| `CATALOG_SYNC_TIMEOUT` | sync_catalog_metadata 超时（>120s） |
| `CATALOG_NOT_FOUND` | connector_id 不存在或未连接 |
| `ANNOTATION_CONFLICT` | PATCH 时 version 不匹配 |
| `ANNOTATION_INVALID_PATCH` | 缺少 table_key 或无标注字段 |

## i18n Keys

前端字符串在 `dataLoading` namespace：
- 同步状态：`syncInProgress`、`syncComplete`、`syncPartial`
- 标注：`annotationSaved`、`annotationConflict`
- Metadata 状态徽章：`metadataStatusSynced`、`metadataStatusPartial`、`metadataStatusUnavailable`、`metadataStatusNotSynced`

错误翻译在 `errors` namespace：
- `catalogNotFound`、`annotationConflict`、`annotationInvalidPatch`

### 后端 message_code（TODO）

设计文档原计划后端响应携带 `message_code` 字段供前端 `translateBackend()` 消费。
当前状态：

| message_code | 状态 | 说明 |
|-------------|------|------|
| `annotation_conflict` | ✅ 已覆盖 | 通过 `AppError(ErrorCode.ANNOTATION_CONFLICT)` → 前端错误处理器 |
| `catalog_sync_timeout` | ❌ 缺失 | Sync API 未显式捕获超时；应 raise `AppError(ErrorCode.CATALOG_SYNC_TIMEOUT)` |
| `annotation_saved` | ❌ 缺失 | PATCH 返回 `{"status": "ok"}` 无 `message_code`；前端本地显示 toast |

`annotation_saved` 优先级低（前端驱动的 toast 已足够）。
`catalog_sync_timeout` 应在同步超时处理加固时一并解决。

## 新 Loader 检查清单

创建新的 `ExternalDataLoader` 子类时：

- [ ] 确保 `list_tables()` 在每条记录上设置 `table_key`（或依赖 `ensure_table_keys()` fallback）
- [ ] 若 `list_tables()` 缺少列详情，override `sync_catalog_metadata()`
- [ ] 逐表详情拉取使用 `ThreadPoolExecutor` 并限制并发数
- [ ] 为每张表设置 `source_metadata_status`：`"synced"`、`"partial"` 或 `"unavailable"`
- [ ] 在 `sync_catalog_metadata()` 返回前调用 `self.ensure_table_keys(tables)`
- [ ] 对于 info_schema 按库隔离的 SQL loader，在 `sync_catalog_metadata()` 中遍历所有可访问数据库
