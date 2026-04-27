# 17 - 用户自定义 Metadata 描述功能

## 背景

当前系统中 table/column 的描述信息来源单一：仅由 `ExternalDataLoader.list_tables()` 从远端数据源（如 Superset、PostgreSQL information_schema）自动拉取。如果数据源本身没有维护描述，前端展示 `source_metadata_status = unavailable`，但**用户无法主动为数据源补充描述**。

这意味着：
- CSV/Excel 上传的表永远没有列描述（除非 Agent 推测）
- 数据源缺少 comment 的情况下，catalog 搜索质量降低
- Agent 在分析数据时缺乏上下文

## 目标

让用户可以在前端为**已连接的数据源**或**已导入的表**手动添加/编辑 table 和 column 级别的描述。

---

## 核心设计原则

1. **远端拉取 vs 用户编辑严格分离存储** — 不混写同一个文件，避免刷新冲突
2. **按 table path 对应** — 用户标注通过 `source_id` + `table_path`（或 table name）与远端数据关联
3. **每用户独立** — 用户编辑的 metadata 属于该用户，不共享、不互相覆盖
4. **远端刷新安全** — 刷新 catalog 只覆盖 `catalog_cache/`，永远不动用户标注文件

---

## 设计方案

### 1. 存储层（后端）

#### 目录结构

```
<user_home>/                                     ← 每用户独立的根目录
  catalog_cache/<source_id>.json                 ← 远端自动拉取（只读缓存，刷新时覆盖）
  catalog_annotations/<source_id>.json           ← 用户手动编辑（独立文件，刷新不动）
```

**两者完全独立**：
- `catalog_cache/` — 系统管理，`save_catalog()` 写入，刷新时整体覆盖
- `catalog_annotations/` — 用户管理，仅通过编辑 API 写入，远端刷新**绝不触碰**

#### 对应关系

用户标注文件通过 **`source_id` 一致** + **table name/path 一致** 与远端数据对应：

```json
// catalog_annotations/my_pg_db.json
{
  "source_id": "my_pg_db",
  "updated_at": "2026-04-28T01:00:00Z",
  "tables": {
    "public/orders": {
      "description": "订单主表，记录所有电商交易",
      "columns": {
        "order_id": { "description": "订单唯一标识" },
        "status": { "description": "订单状态：pending/paid/shipped/cancelled" }
      }
    },
    "public/users": {
      "description": "用户信息表"
    }
  }
}
```

key 使用 `table_path.join('/')` 作为标识，与 catalog tree 中 `CatalogTreeNode.path` 对齐。如果远端表被重命名/删除，用户标注中的孤儿记录不影响系统运行（展示时找不到对应表则不显示）。

#### 已导入表的描述

已导入到 workspace 的表，描述直接写入 `WorkspaceMetadata.tables[name].description` 和 `ColumnInfo.description`。这属于 workspace 级别存储，也是 per-user 的（每用户有自己的 workspace）。

### 2. 读取时合并策略

在以下场景进行只读合并（不修改任何文件）：

```python
def get_merged_metadata(workspace_root, source_id, table_path):
    """读取时合并: annotation 覆盖 cache"""
    cache = load_catalog(workspace_root, source_id)  # 远端缓存
    annotations = load_annotations(workspace_root, source_id)  # 用户标注
    
    # 用户标注优先: 如果 annotation 有 description，使用它；否则用 cache 的
    merged_desc = annotations.get(table_path, {}).get("description") \
                  or cache_table.get("description")
    # 列级同理
```

合并仅发生在：
- `search_catalog_cache()` 搜索时
- 前端 `GET /api/connectors/catalog` 返回树节点时
- Agent context 构建时

### 3. API 层

#### `PATCH /api/connectors/catalog-annotations` — 编辑 catalog 表描述

```json
// Request
{
  "connector_id": "conn_abc123",
  "table_path": ["public", "orders"],
  "description": "订单主表",
  "columns": {
    "order_id": { "description": "订单唯一标识" },
    "status": { "description": "订单状态" }
  }
}

// Response
{ "status": "ok", "updated_at": "2026-04-28T01:00:00Z" }
```

#### `PATCH /api/tables/metadata` — 编辑已导入表的描述

```json
// Request
{
  "table_name": "orders",
  "description": "订单主表",
  "columns": {
    "order_id": { "description": "订单唯一标识" }
  }
}

// Response
{ "status": "ok" }
```

#### `GET /api/connectors/catalog-annotations?connector_id=xxx` — 读取用户标注

返回该用户对指定 connector 的所有标注，供前端 UI 回显。

### 4. 前端 UI

#### 入口 A：Preview 面板表/列描述编辑

在 `ConnectorTablePreview` 中，表级和列级描述变为可编辑：

```
┌─────────────────────────────────┐
│ orders (预览面板)                │
│ ┌────────────────────────────┐  │
│ │ 描述: [可编辑文本框]        │  │
│ │ "订单主表，记录所有..."     │  │
│ │ (来源: 用户编辑 ✏️)         │  │
│ └────────────────────────────┘  │
│ Columns (8)                     │
│  order_id  INT   ✏️ "订单ID"   │
│  status    TEXT  ✏️ "状态"     │
│  ...                            │
└─────────────────────────────────┘
```

- 编辑后调用 `PATCH /api/connectors/catalog-annotations`
- 来源标记区分"远端" vs "用户编辑"
- 如果远端已有描述，用户编辑后标注覆盖，显示"用户编辑"标记

#### 入口 B：Workspace 主 UI 列头编辑

在 `SelectableDataGrid` 列头 Tooltip 中添加编辑图标，点击后弹出 inline 编辑框：
- 编辑后调用 `PATCH /api/tables/metadata`
- 即时更新 `DictTable.metadata` → UI 立即反映

### 5. 数据流总览

```
远端数据源 ─── list_tables() ──→ catalog_cache/<source_id>.json
                                       ↓ (只读合并)
用户编辑 ─── PATCH API ──→ catalog_annotations/<source_id>.json
                                       ↓ (只读合并)
                               前端展示 merged description
                                       ↓
                               Agent 搜索 / context 注入

远端刷新时:
  catalog_cache/ → 覆盖写入（远端最新状态）
  catalog_annotations/ → 完全不动（用户数据安全）
  合并结果 → 自动反映最新状态 + 用户标注
```

### 6. 对应关系保障

| 场景 | 行为 |
|---|---|
| 远端表名未变 | annotation key = `table_path.join('/')` 完美匹配 |
| 远端表被删除 | annotation 中该 key 成为孤儿，不展示、不报错 |
| 远端表被重命名 | 旧 annotation 成为孤儿；用户可手动为新表编辑 |
| 远端新增列 | 该列无 annotation，展示远端描述（如果有）或空 |
| 远端删除列 | 该列 annotation 成为孤儿，不展示 |

孤儿清理：可选地提供"清理无效标注"功能，但不是必须的——孤儿不影响系统运行。

---

## 实施分期

### Phase 1：已导入表的描述编辑（最小 MVP）
- `PATCH /api/tables/metadata` API
- 前端 SelectableDataGrid 列头编辑按钮
- 更新 `WorkspaceMetadata` → 即时生效
- 已有 `list-tables` 返回 description，前端已消费

### Phase 2：Catalog 表描述编辑
- `catalog_annotations/` 存储模块
- `PATCH /api/connectors/catalog-annotations` API
- 读取时合并逻辑（search + get_catalog）
- ConnectorTablePreview 中的编辑 UI
- `source_metadata_status` 基于合并后结果动态计算

---

## 已决定

- **标注范围**：per-user（每用户 `user_home` 下独立存储，互不干扰）
- **冲突处理**：物理分离，不存在冲突（两个文件互不覆盖）
- **远端刷新**：只动 `catalog_cache/`，永不动 `catalog_annotations/`
- **对应方式**：`source_id` + `table_path` 作为关联 key
