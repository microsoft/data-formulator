# 统一数据源元数据方案

> 状态：设计文档
> 最后更新：2026-04-26

## 目标

为外部数据源建立统一的源元数据链路。这里的元数据包括数据库表注释、字段注释、BI 数据集描述、报表或仪表盘描述，以及其他由源系统提供的语义提示。

元数据是 **best-effort 辅助信息**：

- 元数据读取失败不能阻断 catalog 浏览、preview、import、refresh 或源端筛选。
- 数据正确性仍由 `fetch_data_as_arrow()` 和持久化后的 parquet 内容决定。
- 元数据用于提升用户理解、AI 上下文质量和数据发现体验，但不是加载数据的必要依赖。

本文关注架构和未来实现形态。为避免篇幅过长，文中只使用伪代码，不放大段实现代码。

## 当前架构

数据源访问已经围绕以下组件完成标准化：

| 层 | 职责 |
|---|---|
| `ExternalDataLoader` | 每种数据源实现的适配器接口 |
| `DataConnector` | 统一连接实例生命周期、凭证、catalog、preview、import、refresh |
| `CatalogNode.metadata` | 挂在 catalog 树节点上的轻量元数据 |
| `get_metadata(path)` | 获取单个 catalog 节点的详细元数据 |
| `get_column_types(source_table)` | 为 preview 和筛选 UI 提供源系统列类型增强 |
| `WorkspaceMetadata` | 导入到 workspace 后的 parquet 表持久化元数据 |

数据从外部系统到用户 workspace 的流转路径如下：

```text
┌────────────────────┐
│   外部数据源         │  PostgreSQL / MySQL / Superset / BigQuery / S3 ...
└────────┬───────────┘
         │
         │  ExternalDataLoader 子类负责适配
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  ExternalDataLoader 实例                                       │
│                                                                │
│  连接参数 (loader.params)                                       │
│  ├── host, port, database, user, password ...                  │
│  └── get_safe_params() 过滤敏感字段后用于持久化                   │
│                                                                │
│  Catalog 层级 (catalog_hierarchy → ls / list_tables)            │
│  ├── Level 0: Database / Project / Bucket     ← namespace      │
│  ├── Level 1: Schema / Dataset                ← namespace      │
│  └── Level 2: Table / File / Dataset          ← 叶子节点        │
│                                                                │
│  每个叶子节点 = CatalogNode:                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  name: "orders"                                      │      │
│  │  node_type: "table"                                  │      │
│  │  path: ["analytics", "public", "orders"]             │      │
│  │  metadata: {                                         │      │
│  │    row_count: 50000                                  │      │
│  │    columns: [{name, type}, ...]                      │      │
│  │    sample_rows: [...]                                │      │
│  │    description: "..."       ← 未来从源系统拉取        │      │
│  │    columns[].description    ← 未来从源系统拉取        │      │
│  │  }                                                   │      │
│  └──────────────────────────────────────────────────────┘      │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            │  fetch_data_as_arrow() → 数据
                            │  get_metadata() / get_column_types() → 元数据
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  DataConnector (统一管理层)                                      │
│                                                                │
│  /api/connectors/get-catalog    → 调用 ls() / list_tables()    │
│  /api/connectors/preview-data   → 调用 fetch_data_as_arrow()   │
│  /api/connectors/import-data    → 调用 ingest_to_workspace()   │
│  /api/connectors/refresh-data   → 调用 refresh 流程             │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            │  ingest_to_workspace()
                            │  写入 parquet + workspace.yaml
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Workspace (用户工作空间)                                       │
│                                                                │
│  workspace.yaml  ← TableMetadata (name, columns, description)  │
│  data/*.parquet  ← 实际数据文件                                 │
└────────────────────────────────────────────────────────────────┘
```

当前设计已经具备大部分传输通道，但元数据还没有端到端打通：

- `TableMetadata.description` 已存在。
- `ColumnInfo` 还不能存储字段描述。
- `ExternalDataLoader.ingest_to_workspace()` 会写入源信息，但不会合并源系统表/列描述。
- `/api/tables/list-tables` 返回字段时只有 `{name, type}`。
- 大多数 SQL loader 只返回列名和类型，还没有读取数据库 comment。
- Superset 已返回 dataset 级 `description`，但列级描述还没有通过 preview/import 统一归一化。
- Agent 上下文可以包含表级 `attached_metadata`，但导入后的源系统描述还不会自动进入表/列摘要。

## 现有数据源插件主干

核心基类是 `ExternalDataLoader`，位于 `py-src/data_formulator/data_loader/external_data_loader.py`。具体数据源只应该继承它，例如 `PostgreSQLDataLoader`、`MySQLDataLoader`、`SupersetLoader`、`BigQueryDataLoader`。

`DataConnector` 不是给每个数据源继承的类，而是框架统一提供的连接实例管理层。它负责：

- connect / disconnect / status
- catalog 浏览和搜索
- preview / import / refresh
- credential vault
- identity 隔离
- 固定 `/api/connectors/...` action route 分发

当前内置 loader 注册在 `py-src/data_formulator/data_loader/__init__.py`，已有：

| Loader key | 数据源 |
|---|---|
| `mysql` | MySQL |
| `mssql` | SQL Server |
| `postgresql` | PostgreSQL |
| `kusto` | Azure Data Explorer / Kusto |
| `s3` | Amazon S3 |
| `azure_blob` | Azure Blob Storage |
| `mongodb` | MongoDB |
| `cosmosdb` | Azure Cosmos DB |
| `bigquery` | Google BigQuery |
| `athena` | AWS Athena |
| `superset` | Apache Superset |
| `local_folder` | 本机目录，仅桌面/本地模式 |

外部插件机制也已经存在：把 `*_data_loader.py` 放到 `DF_PLUGIN_DIR` 指向的目录，文件中定义公开的 `ExternalDataLoader` 子类，服务启动时会自动扫描并注册。外部插件 key 来自文件名，例如 `my_report_data_loader.py` 会注册为 `my_report`。

## Loader 方法约定

新增数据源时，通常只需要实现 `ExternalDataLoader` 子类。必须实现的方法包括：

| 方法 | 说明 |
|---|---|
| `__init__(self, params)` | 保存并校验连接参数；可初始化客户端，也可延迟到首次调用时连接 |
| `list_params()` | 声明连接表单字段 |
| `auth_instructions()` | 返回给前端展示的认证说明 |
| `list_tables(table_filter=None)` | 列出可导入的数据对象（轻量化改造后不再包含 sample_rows 和 COUNT，详见下方说明） |
| `fetch_data_as_arrow(source_table, import_options=None)` | 真正读取数据，返回 `pyarrow.Table` |

推荐实现的方法包括：

| 方法 | 说明 |
|---|---|
| `catalog_hierarchy()` | 声明 catalog 层级，例如 database -> schema -> table |
| `ls(path=None, filter=None, limit=None, offset=0)` | 懒加载 catalog 节点，大目录应支持分页 |
| `search_catalog(query, limit=100)` | 跨层级搜索 |
| `get_metadata(path)` | 返回表/列元数据、样例、描述 |
| `get_column_types(source_table)` | 返回源系统列类型和可选列描述 |
| `get_column_values(...)` | 返回列值候选，用于智能筛选 |
| `test_connection()` | 轻量连接测试 |
| `auth_config()` / `delegated_login_config()` | SSO、token、delegated login 时使用 |

## 已有标准化能力

当前数据源接入已经标准化了以下能力：

- 连接实例：`DataConnector` 统一包装 loader，不再为每个数据源写专属 API。
- catalog 浏览：`catalog_hierarchy()` + `ls()` + `/api/connectors/get-catalog`。
- 预览：`/api/connectors/preview-data` 调用 `fetch_data_as_arrow()`，并用 `get_column_types()` 补充 `source_type`。
- 导入：`ingest_to_workspace()` 写入 parquet，并保存 `source_info`。
- 刷新：workspace metadata 中保存 `source_table`、`import_options` 等信息。
- 凭证：敏感字段通过 credential vault，非敏感连接参数进入 `connectors.yaml`。
- 元数据基础通道：`CatalogNode.metadata`、`get_metadata(path)`、`get_column_types(source_table)` 已经存在。

元数据方案应沿用这些通道，而不是另起一套平行的数据源插件体系。

## 设计原则

1. 复用现有 loader contract。
   在当前 `ExternalDataLoader` 通道被证明不够用之前，不新增独立的 `MetadataPlugin` 层。

2. 元数据保持可选。
   缺失、部分缺失、过期或不可访问的元数据都必须优雅降级。

3. 优先使用源系统原生元数据。
   数据库 comment、BI 数据集描述、SDK 暴露的字段描述，通常比推断文本更可靠。

4. 避免昂贵的 catalog 扫描。
   大目录不应该在 root 浏览时为所有表拉取描述。详细元数据应在用户打开、选中或导入具体节点时再获取。

5. 不暴露敏感信息。
   元数据响应中不能包含凭证、连接串、内部文件路径、带密钥的原始 SQL 或隐藏服务标识。

6. 保持向后兼容。
   旧 workspace metadata 中没有描述字段时，仍然必须正常加载。

## 元数据模型

归一化后的 metadata 结构应尽量在 `CatalogNode.metadata`、`get_metadata(path)`、`get_column_types(source_table)`、preview 响应和 workspace table listing 中保持一致。

### 表级元数据

| 字段 | 类型 | 必需 | 含义 |
|---|---|---:|---|
| `description` | string | 否 | 表、数据集、报表或 collection 描述 |
| `row_count` | number | 否 | 获取成本足够低时返回的源端行数 |
| `sample_rows` | list | 否 | 已经可用时返回的小样本 |
| `_source_name` | string | 否 | 用于 preview/import/refresh 的稳定源标识符 |
| `_catalogName` | string | 否 | BI/报表 catalog 节点的显示名 |
| `source_metadata_status` | string | 否 | 诊断状态，例如 `ok`、`partial`、`unavailable`。需要暴露给前端，用于在 UI 中提示用户 metadata 拉取情况 |

### 列级元数据

| 字段 | 类型 | 必需 | 含义 |
|---|---|---:|---|
| `name` | string | 是 | 源系统列名 |
| `type` | string | 否 | 源系统原生类型或归一化类型 |
| `source_type` | string | 否 | 用于 UI 控件选择的归一化类型分类 |
| `description` | string | 否 | 源系统提供的字段 comment/description |
| `is_dttm` | boolean | 否 | BI 或日期时间提示，Superset 等系统会使用 |

### Workspace 持久化

用户 workspace 在磁盘上的目录结构：

```text
~/.data_formulator/                              ← DATA_FORMULATOR_HOME
└── users/
    └── <safe_identity_id>/                      ← 用户主目录 (get_user_home)
        ├── connectors/                          ← 连接实例状态 (DataConnector 管理)
        │   ├── pg_prod.json
        │   └── superset_bi.json
        │
        ├── catalog_cache/                       ← 数据源 catalog 元数据快照（用户级）
        │   ├── pg_prod.json                     ← 一个连接器一份，用户主动刷新时更新
        │   └── superset_bi.json
        │
        └── workspaces/                          ← 用户的所有 workspace
            └── <workspace_id>/                  ← 单个 workspace 目录
                │
                ├── workspace.yaml               ← 元数据注册表 (WorkspaceMetadata)
                ├── .workspace.lock              ← 并发锁文件
                │
                └── data/                        ← 所有数据文件存放目录
                    ├── orders.parquet           ← 从数据源导入的表
                    ├── sales_2024.parquet
                    ├── uploaded_file.csv         ← 用户上传的原始文件
                    └── scratch/                  ← Agent/代码执行的临时输出
```

其中 `workspace.yaml` 的内部结构：

```text
workspace.yaml
├── version: "1.1"
├── created_at: "2026-04-20T..."
├── updated_at: "2026-04-26T..."
│
└── tables:                                    ← dict[表名 → TableMetadata]
    │
    ├── orders:                                ← 一张表的 TableMetadata
    │   ├── source_type: "data_loader"
    │   ├── filename: "orders.parquet"
    │   ├── file_type: "parquet"
    │   ├── created_at: "2026-04-20T..."
    │   ├── content_hash: "a1b2c3..."
    │   ├── file_size: 1048576
    │   ├── loader_type: "PostgreSQLDataLoader"
    │   ├── loader_params: {host: "db.corp", database: "analytics"}
    │   ├── source_table: "public.orders"
    │   ├── import_options: {size: 100000}
    │   ├── last_synced: "2026-04-25T..."
    │   ├── row_count: 50000
    │   ├── columns:                           ← list[ColumnInfo]
    │   │   ├── {name: "order_id", dtype: "int64"}
    │   │   ├── {name: "created_at", dtype: "timestamp[ns]"}
    │   │   └── {name: "status", dtype: "object"}
    │   ├── original_name: null
    │   ├── description: "订单事实表"            ← 已有字段，目前没人写入
    │   │
    │   │   ┌───── 未来要加 ──────────────────────────────────┐
    │   │   │  columns[].description: "订单唯一标识" ...       │
    │   │   │  (ColumnInfo 需要扩展 description 字段)          │
    │   │   └─────────────────────────────────────────────────┘
    │   │
    │   └── source_file: null
    │
    └── uploaded_file:                          ← 用户上传的表
        ├── source_type: "upload"
        ├── filename: "uploaded_file.csv"
        ├── file_type: "csv"
        ├── ...
        └── description: null
```

`ColumnInfo` 应扩展为可携带可选描述：

```text
ColumnInfo:
  name
  dtype
  description?  # 可选；缺失时不写入
```

`TableMetadata.description` 已经存在，应在源系统可提供描述时填充。

## Loader Contract 中的元数据扩展

现有 loader 方法继续作为公开 contract。元数据方案只扩展这些方法的期望返回结构。

### `get_metadata(path)`

用途：

- 获取被选中 catalog 节点的详细元数据。
- 供 catalog 详情面板使用，并作为 `get_column_types()` 的 fallback 来源。

期望行为：

```text
get_metadata(path):
  try:
    根据 path 和 pinned scope 解析源对象
    拉取表/数据集描述
    拉取列名、类型、列描述
    按需拉取 row_count 和 sample_rows
    返回归一化 metadata
  except metadata_error:
    记录 debug/warning 日志，不能包含密钥
    返回 {}
```

失败策略：

- 返回 `{}` 或部分 metadata。
- 除非错误意味着源对象本身无效，并且 preview/import 也会失败，否则不要抛出异常。

### `get_column_types(source_table)`

用途：

- 根据稳定源标识符，为 preview/import 阶段提供列元数据增强。
- 继续支持智能筛选 UI。

期望行为：

```text
get_column_types(source_table):
  try:
    拉取或推导源 metadata
    return {
      description?,
      columns: [
        {name, type?, source_type?, description?, is_dttm?}
      ]
    }
  except metadata_error:
    return {}
```

需要调整的点：

- 默认实现应保留 `get_metadata(path)` 返回的表级 `description`，不能只返回 `columns`。

### `list_tables(table_filter=None)` 轻量化改造

当前问题：

PostgreSQL / MySQL 的 `list_tables()` 对每张表执行了三个重操作：查 `information_schema.columns` 拿列信息、`SELECT * LIMIT 10` 拿样本数据、`SELECT COUNT(*)` 拿行数。但分析发现这些数据在主流程中没有被使用：

- 前端 catalog 浏览走的是 `/api/connectors/get-catalog`（调 `ls()`），不走 `list_tables()`。
- 用户选中表后，前端单独调 `/api/connectors/preview-data` 重新拉数据，不使用 `list_tables()` 返回的 sample_rows。
- `/api/connectors/get-catalog-tree` 虽然调了 `list_tables()`，但前端没有任何地方调用这个端点。
- BigQuery 已经意识到了这个问题，其 `list_tables()` 中 `sample_rows` 直接写死 `[]`。

改造方案：

- 去掉 `list_tables()` 中的 `SELECT * LIMIT 10`（sample_rows）和 `SELECT COUNT(*)`（row_count）。
- `list_tables()` 只查 `information_schema`（或等效 API），返回表名、列名、列类型。
- 元数据方案落地后，同时返回表描述和列描述。
- 需要 sample_rows 或 row_count 的场景，通过 `get_metadata(path)` 按需获取。

改造后的 `list_tables()` 返回结构：

```text
list_tables(table_filter=None):
  只查 information_schema（一次批量查询）
  return [
    {
      name: "public.orders",
      path: ["public", "orders"],
      metadata: {
        columns: [{name, type, description?}, ...],
        description?
      }
    },
    ...
  ]
  # 不再包含 sample_rows 和 row_count
```

向后兼容：

- `list_tables()` 返回的 metadata 中不再有 `sample_rows` 和 `row_count`，但这些字段之前就是可选的。
- 外部插件如果仍然返回这些字段，不影响任何功能。
- `get-catalog-tree` 端点仍然可用，只是返回的 metadata 更轻。

### `ls(path, ...)` 不变

`ls()` 保持现有行为，仍然是前端 catalog 懒加载的主入口。

## 数据流

### Catalog 浏览

```text
前端展开 catalog 节点
  -> POST /api/connectors/get-catalog
  -> loader.ls(path)
  -> 返回带轻量 metadata 的子节点

前端选中具体表节点
  -> 同一 endpoint 可调用 loader.get_metadata(path)
  -> 如可用，返回详细 metadata
  -> 如果 metadata 读取失败，仍显示节点并允许 preview/import
```

### Preview

```text
前端预览表
  -> POST /api/connectors/preview-data
  -> loader.fetch_data_as_arrow(source_table)
  -> 构造 rows 和 pandas/arrow 列类型
  -> best-effort 调用 loader.get_column_types(source_table)
  -> 把 source_type 和 description 合并进 preview columns
```

只要数据读取成功，preview 就必须成功，即使 metadata 增强失败。

### Import

```text
前端导入表
  -> POST /api/connectors/import-data
  -> loader.ingest_to_workspace(...)
  -> fetch_data_as_arrow(...)
  -> 写入 parquet 和基础 TableMetadata
  -> best-effort 调用 get_column_types(source_table)
  -> 合并表描述和列描述
  -> 如 metadata 有变化，保存更新后的 workspace metadata
```

只要 parquet 写入成功，import 就必须成功，即使 metadata 增强失败。

### Refresh

Refresh 应优先保证数据刷新。metadata 刷新可以后续作为 best-effort 增强加入：

```text
refresh table
  -> 拉取最新数据
  -> 刷新 parquet
  -> 可选刷新源 metadata
  -> 如果新 metadata 不可用，保留已有描述
```

默认策略：

- 如果新的 metadata 可用，更新 `TableMetadata.description`。
- 如果 metadata 读取失败，保留已有持久化描述。
- 如果源系统明确返回空描述，清空 `TableMetadata.description`（以源系统为准）。
- **不论何种情况，都不触碰前端 `attachedMetadata`**。两个字段职责独立。

## 各数据源映射

| Loader | 表级描述 | 列级描述 | 备注 |
|---|---|---|---|
| PostgreSQL | `obj_description` / `pg_description` | `col_description` / `pg_description` | 只查询选中的表，不扫描全 schema |
| MySQL | `information_schema.TABLES.TABLE_COMMENT` | `information_schema.COLUMNS.COLUMN_COMMENT` | 空字符串应归一化为 `None` |
| MSSQL | 表级 `MS_Description` 扩展属性 | 列级 `MS_Description` 扩展属性 | 优先使用参数化查询 |
| BigQuery | `table.description` | `field.description` | SDK 已直接暴露这些字段 |
| Kusto | 表 DocString/details | schema 中的列 DocString | 具体字段取决于命令输出 |
| Superset | Dataset/report/dashboard description | Dataset column verbose name/description，如可用 | 保留 `is_dttm` 和类型归一化。多层描述（dataset、chart、dashboard、report）统一拍平成一个 `description`，通过 markdown 章节区分 |
| Athena/Glue | Glue table description/parameters | Glue column comments | 可能需要 Athena 之外的 Glue API |
| MongoDB/CosmosDB | 如可用，使用 collection 级 metadata | 通常只能推断 schema | 可以保持没有 description |
| S3/Azure Blob/Local Folder | 成本低且安全时使用文件/object metadata | 文件 schema | 不应为了 metadata 读取大文件 |

## API 变化

### `/api/connectors/get-catalog`

不需要新增 endpoint。扩展 `metadata`，允许携带：

- 表级描述
- 列级描述
- metadata 状态诊断

现有客户端应忽略未知字段。

### `/api/connectors/preview-data`

扩展 `columns` 项：

```text
column:
  name
  type
  source_type?
  description?
```

### `/api/tables/list-tables`

扩展 workspace table listing：

```text
table:
  name
  description?
  columns:
    - name
      type
      description?
```

这样导入后的源描述可以在页面刷新后继续存在，并进入前端状态和 Agent 上下文。

## 前端行为

前端应把 metadata 当作可选信息。

Catalog tree：

- 当存在表/数据集描述时，在 tooltip 或详情面板中展示。
- metadata 加载中不能阻塞 preview/import。
- 不要强制为所有可见节点拉取详细 metadata。

Preview panel：

- 当存在表描述时，在 preview 标题附近展示。
- 当存在列描述时，用 tooltip 或紧凑描述列展示。
- 保持现有筛选和 row limit 行为不变。

已导入 workspace 表：

后端持久态 `TableMetadata`（存在 `workspace.yaml` 中）与前端内存态 `DictTable`（存在 Redux Store 中）的对应关系：

后端 `TableMetadata`（持久态）与前端 `DictTable`（内存态）的字段映射：

```text
后端 TableMetadata (workspace.yaml)          前端 DictTable (Redux Store)
═══════════════════════════════════          ═══════════════════════════════

name                                ──→     id (= name)

columns: [ColumnInfo]               ──→     names: string[]
  └── {name, dtype, description?}           metadata: {[字段名]: {type, semanticType, ...}}

row_count                           ──→     virtual: {tableId, rowCount}

                                            rows: any[]  (前端加载的实际数据行)

loader_type                         ──→     source: DataSourceConfig  (refresh 用)
loader_params
source_table
import_options

content_hash                        ──→     contentHash
```

两个独立的描述字段：

```text
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  ① 系统描述 — TableMetadata.description (后端 workspace.yaml)          │
│     来源：源系统（数据库表注释 / BI 数据集描述）                         │
│     写入：导入时自动拉取，refresh 时自动更新                             │
│     权限：只读，用户不可编辑                                            │
│                                                                       │
│  ② 用户描述 — DictTable.attachedMetadata (前端 Redux Store)            │
│     来源：用户手动填写                                                  │
│     写入：用户主动编辑时                                                │
│     权限：仅用户可编辑                                                  │
│                                                                       │
│  核心规则：两者互不覆盖。源系统永远不碰用户描述，用户编辑不影响系统描述。  │
│                                                                       │
│  前端展示：同时展示两个描述。系统描述只读标签 + 用户描述可编辑文本框。    │
│  Agent 上下文：两者都传入。用户描述优先表达意图，系统描述提供客观信息。    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

规则：

- 导入时，`ingest_to_workspace()` 从源系统拉取描述，写入 `TableMetadata.description`。
- Refresh 时，重新从源系统拉取描述，更新 `TableMetadata.description`。
- **任何时候都不用源系统描述覆盖用户手写的 `attachedMetadata`**。
- Agent 上下文中两者都可以使用：`attachedMetadata` 优先作为用户意图描述，`TableMetadata.description` 作为源系统客观描述。

## Agent 上下文

元数据对 Agent 有两大用途：辅助分析理解和驱动数据选择。

### 用途一：分析 Agent 读取表/列描述

分析 Agent（`data_agent`、`agent_interactive_explore` 等）在构建数据摘要时需要表和列描述来理解业务含义。

当前状态：

- `generate_data_summary()` 通过 `table.get("attached_metadata", "")` 拿表级描述。这个值来自前端 `DictTable.attachedMetadata`，不是 workspace 持久化的 `TableMetadata.description`。
- `get_field_summary()` 只输出 `field_name -- type: xxx, values: xxx`，没有列描述。
- `inspect_source_data` 工具内部调 `generate_data_summary()`，同样缺少源系统 metadata。

需要改进：

- `generate_data_summary()` 应同时使用两个描述源：`attached_metadata`（用户意图）和 `TableMetadata.description`（源系统客观描述），两者都有值时都输出。
- `get_field_summary()` 当 `ColumnInfo.description` 存在时，应输出 `field_name -- type: xxx -- desc: xxx, values: xxx`。
- `inspect_source_data` 自动受益，无需额外改动。

建议 Agent 摘要格式：

```text
Table: orders
Description: 生产数仓中的订单事实表。
Schema:
  - order_id -- type: int64 -- desc: 订单唯一标识
  - created_at -- type: timestamp -- desc: 订单创建时间，UTC
  - status -- type: object, values: pending, paid, shipped
```

Prompt 大小控制：

- 只有存在描述时才写入。
- 过长的表/列描述需要截断。
- 上下文较大时优先包含 primary tables。
- 不要在多个 section 中重复相同描述。

### 用途二：数据选择 Agent 两层搜索

未来会增加一个专门的"数据选择 Agent"，在用户发起任务时，由该 Agent 自动搜索、挑选最相关的数据集，然后交给分析 Agent。

搜索范围不能局限于 workspace 中已导入的表。很多数据库有几千张表，UI 懒加载只展示一部分，如果 Agent 只搜已导入的表，会漏掉有价值的数据源。因此需要两层搜索：

```text
Agent 发起搜索(query="订单")
│
├─ 第一层：Workspace 本地搜索（毫秒级）
│  搜索 workspace.yaml 中所有已导入表的：
│  表名、TableMetadata.description、列名、ColumnInfo.description
│  返回：已在 workspace 中的匹配表，标记 status="已导入"
│
└─ 第二层：磁盘 catalog 缓存搜索（亚秒级）
   从磁盘加载缓存文件，搜索全量 catalog 元数据：
   表名、表描述、列名、列类型、列描述
   返回：尚未导入但匹配的表，标记 status="未导入"
```

第一层为纯内存操作（毫秒级），第二层由 DuckDB 流式解析 JSON 文件并执行 SQL 查询，典型耗时 100–200ms。两层合计总延迟在亚秒级。

#### Catalog 缓存机制

之前前端没有全量加载 catalog 是因为渲染几千个 DOM 节点会卡顿。但 catalog 元数据本身的数据量很小——5000 张表的表名 + 描述 + 列信息全部加起来也就几 MB，从数据库查 `information_schema` 通常只需要 1-2 秒。

因此：**全量拉取轻量 catalog 元数据，持久化到用户目录下的磁盘文件。**

```text
用户连接数据源
  │
  ├── 前端：仍然懒加载渲染（Phase 4 实现虚拟化后可全量渲染）
  │
  └── 后端：调用轻量化后的 list_tables() 全量拉取
      持久化到 <user_home>/catalog_cache/<source_id>.json
      只含轻量信息：表名、描述、列名、列类型、列描述
      不含 sample_rows、row_count（已在轻量化改造中去掉）
      拉取完成后释放内存，不常驻
```

轻量化后的 `list_tables()` 只查 `information_schema`（一次批量查询），5000 张表也只需 1-2 秒，可以直接用于全量缓存，不需要单独的方法。

存储位置：

```text
~/.data_formulator/users/<safe_identity_id>/
├── connectors/              ← 已有，连接器凭证（用户级）
├── catalog_cache/           ← 新增，catalog 元数据快照（用户级）
│   ├── pg_prod.json         ← 一个连接器一份文件
│   └── my_mysql.json
└── workspaces/
    └── <ws_id>/
        ├── workspace.yaml   ← 只存已导入表的元数据（不变）
        └── data/
```

catalog cache 放在用户级别（和 `connectors/` 平级），不放在 workspace 下，因为 connector 是用户级别资源，跨 workspace 共享。一个 connector 只存一份 catalog cache，不因 workspace 数量而重复。

缓存生命周期：

- **何时拉取**：首次连接数据源时从远程拉取，写入 `catalog_cache/<source_id>.json`。
- **存在哪**：磁盘文件（JSON），不常驻内存。Agent 搜索时按需加载到内存，搜索完毕后释放。
- **何时刷新**：用户主动点击"刷新 catalog"时，重新从远程拉取并覆盖磁盘文件。不自动刷新，由用户决定数据新鲜度。
- **缓存不存在时**：首次连接尚未完成拉取期间，或磁盘文件被清理后，第二层搜索返回空结果。不做远程 fallback，避免增加复杂度。
- **服务器重启后**：磁盘文件仍在，无需重新从远程拉取。
- **用户断开连接时**：删除对应的 `catalog_cache/<source_id>.json`。断开意味着用户不再使用该数据源，缓存失去意义，应及时清理磁盘空间。
- **用户删除连接器时**：同样删除对应的缓存文件。`_delete_credentials()` 已有清理 loader 和 vault 的逻辑，应同步清理 catalog cache 文件。

为何不用内存常驻：

当数据源有 5,000–10,000 张表时，每个用户的 catalog cache 约 30 MB 原始数据（Python 运行时 ~60 MB）。内存常驻在多用户场景下不可控——100 个用户 × 1 个数据源 = ~6 GB 内存。当前 `DataConnector._loaders` 没有空闲超时或自动清理机制，空闲用户的 loader（及其内存缓存）会永久驻留。磁盘持久化方案将内存占用降为几乎为零（仅搜索时短暂加载），且自动获得跨重启存活能力。

#### Agent 如何拿到 catalog 缓存

catalog cache 以 JSON 文件形式存储在用户目录下。搜索时使用 DuckDB 的 `read_json_auto()` 直接对文件发 SQL 查询，无需将整个 JSON 加载到 Python 对象中：

```text
import duckdb

identity_id = get_identity_id()
cache_dir = get_user_home(identity_id) / "catalog_cache"

conn = duckdb.connect(":memory:")
for cache_file in cache_dir.glob("*.json"):
  source_id = cache_file.stem
  path = str(cache_file)

  results = conn.execute("""
    SELECT name, description[:120] AS description,
           len(columns) AS column_count
    FROM read_json_auto(?)
    WHERE name LIKE ? OR description LIKE ?
    LIMIT 20
  """, [path, f"%{query}%", f"%{query}%"]).fetchall()

  # DuckDB 流式解析，不需要全量加载到 Python 内存
  # 支持正则：regexp_matches(name, ?)
  # 支持结构化过滤：UNNEST(columns) 后按列类型/列名筛选
```

DuckDB 已是项目现有依赖（用于 parquet 查询和 Agent 数据分析），不引入新包。

只搜索磁盘上已有缓存文件的数据源。没有缓存文件（用户从未拉取过 catalog 或已手动清理）则跳过该源。Agent 不应该代替用户去建立新连接或触发远程拉取。

#### 搜索工具伪代码

```text
search_data_tables(query, scope="all"):
  """
  scope: "workspace" | "connected" | "all"

  返回 Level 0 摘要：每条结果只含表名、一行描述和匹配的列名。
  不含全部列 schema，避免大规模 catalog 搜索时撑爆 Agent 上下文。
  Agent 需要 schema 细节时，通过 inspect_source_data 按需获取。

  搜索引擎为 DuckDB，支持子串匹配、正则、结构化过滤。
  """
  import duckdb
  conn = duckdb.connect(":memory:")
  results = []

  # ── 第一层：workspace 本地搜索 ──
  if scope in ("workspace", "all"):
    workspace = self.workspace
    for table_name, meta in workspace.get_metadata().tables:
      if query 匹配 table_name 或 meta.description 或任一列名/列描述:
        results.append({
          source: "workspace",
          table_name,
          description: meta.description 的前 120 字符,
          matched_columns: [匹配到的列名列表],
          column_count: len(meta.columns),
          row_count,
          status: "已导入"
        })

  # ── 第二层：DuckDB 查询磁盘 catalog 缓存 ──
  if scope in ("connected", "all"):
    imported_sources = {已导入表的 source_table 集合}
    cache_dir = get_user_home(identity_id) / "catalog_cache"

    for cache_file in cache_dir.glob("*.json"):
      source_id = cache_file.stem
      path = str(cache_file)

      try:
        # 基础关键字搜索：匹配表名和表描述
        rows = conn.execute("""
          SELECT name,
                 description[:120] AS description,
                 len(columns) AS column_count
          FROM read_json_auto(?)
          WHERE name NOT IN (SELECT unnest(?::VARCHAR[]))
            AND (name LIKE ? OR description LIKE ?)
          ORDER BY CASE
            WHEN name LIKE ? THEN 1
            WHEN description LIKE ? THEN 2
            ELSE 3
          END
          LIMIT 20
        """, [path, list(imported_sources),
              f"%{query}%", f"%{query}%",
              f"%{query}%", f"%{query}%"]).fetchall()

        # 列级匹配：展开嵌套 columns 数组
        col_rows = conn.execute("""
          SELECT DISTINCT t.name,
                 t.description[:120] AS description,
                 c.name AS matched_column,
                 len(t.columns) AS column_count
          FROM read_json_auto(?) t, UNNEST(t.columns) AS c
          WHERE t.name NOT IN (SELECT unnest(?::VARCHAR[]))
            AND (c.name LIKE ? OR c.description LIKE ?)
          LIMIT 20
        """, [path, list(imported_sources),
              f"%{query}%", f"%{query}%"]).fetchall()

        # 合并表级和列级匹配结果
        for row in 合并去重(rows, col_rows):
          results.append({
            source: source_id,
            table_name: row.name,
            description: row.description,
            matched_columns: [匹配到的列名],
            column_count: row.column_count,
            status: "未导入，可通过该连接导入"
          })
      except Exception:
        continue  # best-effort，文件损坏或格式异常时跳过

  return results（去重，按匹配度排序，限制返回数量）
```

#### 性能对比

| | 之前（实时远程搜索） | 升级后（DuckDB + 磁盘缓存） |
|---|---|---|
| 搜索引擎 | 源系统 SQL（只能 LIKE） | DuckDB `read_json_auto()` — 子串、正则、结构化过滤、列级展开 |
| 搜索速度 | 秒级（远程查询） | 100–200ms（DuckDB 流式解析 JSON，谓词下推） |
| 搜索范围 | 全量（每次查远程） | 全量（缓存了全部 catalog） |
| 结构化过滤 | 不支持 | 支持（`UNNEST(columns)` 按列类型/列名筛选） |
| 正则搜索 | 不支持 | 支持（`regexp_matches()`） |
| 连接断开后 | 搜不了 | 磁盘文件仍在，可搜索 |
| 服务器重启后 | 需重新拉取 | 磁盘文件仍在，无需重新拉取 |
| 常驻内存 | 无 | 无（DuckDB 按需读取文件，不加载到 Python 内存） |
| 额外开销 | 无 | 首次连接时一次性拉取，1-2 秒 |
| 多用户 100 人 | 不适用 | 100 × ~30 MB 磁盘（内存 ≈ 0） |
| 新增依赖 | — | 无（DuckDB 已是项目现有依赖） |

#### 元数据在搜索中的关键作用

没有 metadata 时，搜索只能匹配表名。有了 metadata 后：

- 源系统的 `description`（表注释 / 字段注释）让 Agent 能通过业务关键字找到技术命名不直观的表（如搜"订单"能匹配到 `fact_order` 的 comment "订单事实表"）。
- `ColumnInfo.description` 让 Agent 能通过字段含义找到表（如搜"收货地址"匹配到某表的 `ship_addr` 列描述）。
- 这正是本文档元数据方案的核心价值之一。

#### 大规模 Catalog 的存储分层与上下文管理

当数据源有 5,000–10,000 张表时，需要明确元数据在各层的存储边界，并防止 Agent 上下文溢出。

**存储分层**

10,000 张表的全量 catalog 元数据**不会**进入 `workspace.yaml`。两者职责、规模和存储位置完全不同：

| 存储位置 | 存什么 | 典型规模 | 持久化 | 内存占用 |
|---|---|---|---|---|
| `<user_home>/catalog_cache/<source_id>.json` | 数据源全部表的轻量元数据（表名 + 描述 + 列名 + 类型 + 列描述） | 5,000–10,000 张表，磁盘 ~30 MB | 是，用户主动刷新时更新 | 仅搜索时短暂加载 |
| `workspace.yaml` | 用户主动导入的表的完整 TableMetadata | 通常几十到几百张，~100–600 KB | 是，跨会话保留 | 按需读取 |

`workspace.yaml` 不存储未导入表的元数据。全量 catalog 元数据持久化在用户级 `catalog_cache/` 目录下，搜索时按需加载到内存，用完释放。

**体量估算**

以 10,000 张表、平均每表 20 列为例：

| 项目 | 单表估算 | 10,000 表合计 |
|---|---|---|
| 表名 + 描述 + 源信息开销 | ~300 字节 | ~3 MB |
| 20 列 × (列名 + 类型 + 列描述) | ~2,600 字节 | ~26 MB |
| **合计** | ~3 KB | **~29 MB** |

Python dict/list 运行时开销约 1.5–2 倍，实际内存 ~50–60 MB。对服务端进程可忽略，子串搜索遍历 10,000 条仍在毫秒级。

`workspace.yaml` 方面，200 张已导入表约 600 KB，YAML 解析 < 500ms，不构成瓶颈。

**Agent 上下文是真正的瓶颈**

10,000 张表即使只传表名（~30 chars/表）也需要 ~100K tokens，远超单次 Agent 上下文预算。因此 Agent **不可能**一次看到全部 catalog，必须依赖搜索过滤。

搜索过滤后，结果本身的粒度也需要控制：

| 搜索结果粒度 | 单条大小 | 50 条结果 token 估算 |
|---|---|---|
| 表名 + 一行描述 | ~200 chars | ~3K tokens |
| 表名 + 描述 + 全部列名 | ~800 chars | ~13K tokens |
| 表名 + 描述 + 全部列名 + 列描述 | ~2,000 chars | ~33K tokens |

如果搜索结果直接包含全部列描述，50 条结果就可能消耗 30K+ tokens——加上系统提示、对话历史和代码输出，上下文很容易被挤满。

**渐进式上下文策略**

搜索结果应采用渐进式分层返回，Agent 通过多轮工具调用逐步获取更多细节：

```text
Level 0 – 搜索摘要（search_data_tables 返回）
  每条结果只含：表名、一行描述、匹配的列名（如有）
  50 条 ≈ 3K tokens
  用途：Agent 快速扫描候选，排除无关表

Level 1 – Schema 概览（inspect_source_data 返回）
  Agent 选中 5–10 张表，请求 schema
  每表：表名 + 描述 + 全部列名 + 类型
  10 张 ≈ 3K tokens
  用途：确认 schema 是否匹配分析需求

Level 2 – 完整细节（inspect_source_data 返回）
  Agent 选中 1–3 张表，请求详细信息
  每表：描述 + 列名 + 类型 + 列描述 + 样本值
  3 张 ≈ 3K tokens
  用途：开始实际分析
```

典型的 Agent 工作流：

```text
Agent 收到用户任务 "分析订单趋势"
  │
  ├─ 第 1 步：search_data_tables("订单")
  │  返回 Level 0 摘要（50 条，~3K tokens）
  │  Agent 判断 fact_order、dim_product、order_payments 可能相关
  │
  ├─ 第 2 步：inspect_source_data(["fact_order", "dim_product", "order_payments"])
  │  返回 Level 1 schema（3 张表，~1.5K tokens）
  │  Agent 确认 fact_order 有 order_date 和 amount，可以做趋势分析
  │
  └─ 第 3 步：inspect_source_data(["fact_order"])  ← 深入
     返回 Level 2 完整细节（1 张表，~1K tokens）
     Agent 开始生成分析代码
```

每一步的上下文消耗都在几 K tokens，即使加上对话历史也不会超出上下文窗口。

**实现要点**

- `search_data_tables()` 的返回结构应默认只含 Level 0 信息（表名 + 描述 + 匹配列名），不含全部列 schema。
- `inspect_source_data` 已有 3000 字符截断保护，Level 1/Level 2 的区分可通过参数控制或自动根据请求表数量调整详细度。
- 当请求表数量 > 5 时，自动降级为 Level 1（只含 schema，不含样本值）；≤ 3 时返回 Level 2（含样本值和列描述）。
- 多轮对话中，已经出现过的表摘要不需要在后续轮次重复输出。Agent 历史中已有该信息。

### 安全边界：Agent 工具的 workspace 隔离

数据选择 Agent 的搜索工具必须严格限制在当前用户的权限范围内，包括 workspace 和已连接数据源两层。

当前代码中的隔离机制：

- 所有 Agent 路由入口通过 `get_identity_id()` + `get_workspace(identity_id)` 创建 workspace，目录绑定到 `users/<safe_id>/workspaces/<ws_id>/`。
- `data_agent.py` 中 `self.workspace` 是在路由入口创建的，已经是 identity-scoped。
- `agent_data_loading_chat.py` 中文件操作工具有 `relative_to(workspace_path)` 路径安全守卫。
- `DataConnector._loaders` 按 `identity_id` 隔离，每个用户只能访问自己的 loader 实例。

两层搜索各自的安全规范：

第一层（workspace 搜索）：

- workspace 实例必须来自 Agent 初始化时绑定的 `self.workspace`，禁止工具内部自行构造。
- 搜索范围只能是 `workspace.get_metadata().tables`。
- 搜索结果不能包含 `loader_params`、凭证、连接串。

第二层（磁盘 catalog 缓存搜索）：

- 只能遍历当前用户目录下 `catalog_cache/` 中的缓存文件（`get_user_home(identity_id) / "catalog_cache"`）。
- 只能搜索磁盘文件中的缓存数据。缓存文件不存在时跳过该源，不做远程 fallback。
- 禁止工具内部自行创建连接或接受用户传入的连接参数。
- 搜索结果只返回表名、描述、列信息等安全字段，不泄露连接串、凭证或内部路径。

通用规范：

- 工具不能用搜索结果中的表名去读取非当前 workspace 内的文件。
- 如果未来需要跨用户或跨 workspace 搜索（例如管理员视角），必须单独设计权限模型，不能复用数据选择 Agent 的工具。

安全检查清单：

| 场景 | 必须满足 |
|---|---|
| workspace 搜索 | 只能用 Agent 绑定的 `self.workspace` |
| catalog 缓存搜索 | 只能读取当前用户 `catalog_cache/` 目录下的文件 |
| 建立新连接 | 禁止；Agent 不能代替用户创建连接或触发远程 catalog 拉取 |
| 返回内容 | 不包含凭证、连接串、内部路径、`loader_params` |
| 文件访问 | 不通过搜索结果路径访问 workspace 外的文件 |
| 跨用户 | 禁止；跨 workspace/跨用户搜索需独立权限设计 |

## 错误处理

metadata 失败应遵循以下策略：

| 操作 | 数据读取失败 | metadata 读取失败 |
|---|---|---|
| Catalog browse | 可以使操作失败 | 返回没有 metadata 的节点 |
| Preview | 可以使操作失败 | 返回没有描述的 preview |
| Import | 可以使操作失败 | 导入没有描述的表 |
| Refresh | 可以使操作失败 | 保留旧 metadata |
| Agent summary | 如果表不可读，可以失败 | 省略描述 |

日志规则：

- 根据源系统行为使用 debug 或 warning 日志。
- 向用户暴露错误时必须经过清洗。
- 日志和响应中不能包含凭证、token、连接串或敏感路径。

## 实施计划

### Phase 1：Schema 与通用流程

- 为 `ColumnInfo` 增加可选 `description`。
- 保持 workspace metadata 序列化向后兼容。
- **轻量化 `list_tables()`**：去掉 PostgreSQL / MySQL 等 Loader 中 per-table 的 `SELECT * LIMIT 10` 和 `SELECT COUNT(*)`，只保留 `information_schema` 批量查询。sample_rows 和 row_count 改由 `get_metadata(path)` 按需提供。
- 更新 `ExternalDataLoader.get_column_types()` 默认行为，保留表级 `description`。
- 在 `ingest_to_workspace()` 中加入 best-effort metadata 合并。
- 扩展 `/api/tables/list-tables`，返回表描述和列描述。

### Phase 2：高价值 Loader

- PostgreSQL 表/列 comment。
- MySQL 表/列 comment。
- BigQuery table/field descriptions。
- Superset dataset 和列级描述字段。

### Phase 3：其他 Loader

- MSSQL `MS_Description`。
- Kusto DocString。
- Athena/Glue comments。
- 对 object-storage loader，在成本低且安全时读取文件/object metadata。

### Phase 4：UX 展示与 Catalog 虚拟化

- 在 catalog 和 preview UI 中展示描述。
- 把导入后的描述持久进入前端 table state。
- **Catalog 树虚拟化**：当前使用 MUI `SimpleTreeView` + `TreeItem`，不支持虚拟滚动，5000+ 节点时 DOM 全量渲染导致页面卡顿。替换为虚拟化树组件：
  - 推荐方案：`react-arborist`（专为大型树设计，底层 `react-window`，内置虚拟滚动，10 万节点仍流畅）。
  - 备选方案：`@tanstack/react-virtual` + 手动树拍平（灵活度更高，但实现量更大）。
  - 虚拟化后前端可以全量渲染后端返回的 catalog，不再强依赖 UI 侧分页懒加载。

### Phase 5：Agent 数据理解与发现

- 修改 `generate_data_summary()`：同时使用 `attached_metadata` 和 `TableMetadata.description`。
- 修改 `get_field_summary()`：当 `ColumnInfo.description` 存在时输出列描述。
- 首次连接数据源时调用 Phase 1 已轻量化的 `list_tables()`，结果持久化到 `<user_home>/catalog_cache/<source_id>.json`。
- 在 `WorkspaceMetadata` 上实现 `search_tables(query)` 方法（第一层本地搜索）。
- 实现第二层搜索：使用 DuckDB `read_json_auto()` 查询磁盘 `catalog_cache/*.json`，支持子串匹配、正则和结构化过滤（`UNNEST(columns)` 按列类型/列名筛选）。缓存文件不存在时跳过该源。
- 定义 `search_data_tables(query, scope)` Agent 工具，整合两层搜索，返回去重排序后的 Level 0 摘要。
- 确保搜索结果不泄露凭证、连接串或 `loader_params`。
- 增加 best-effort 失败行为测试。

## 测试策略

单元测试：

- `ColumnInfo` 反序列化旧 metadata 时没有 description 也能成功。
- `ColumnInfo` 只有存在 description 时才序列化该字段。
- `ingest_to_workspace()` 在 metadata 增强抛错时仍然成功。
- `get_column_types()` 默认实现保留 `get_metadata()` 返回的 `description`。
- `/api/tables/list-tables` 在 workspace 已存描述时返回表/列描述。

Loader 测试：

- PostgreSQL/MySQL 测试数据库包含表和列 comment。
- metadata 查询失败不影响 preview/import。
- 空 comment 归一化为缺失或 `None`。

前端测试：

- 没有列描述时 preview 仍正常渲染。
- 有描述时 tooltip 或详情展示出现。
- 用户手写的 `attachedMetadata` 不会被源 metadata 覆盖。

Agent 测试：

- 有描述时，表摘要包含描述。
- 长描述会被截断。
- 缺失描述不改变现有摘要行为。
- `get_field_summary()` 在 `ColumnInfo.description` 存在时输出列描述。
- `generate_data_summary()` 在 `attached_metadata` 为空时回退到 `TableMetadata.description`。

数据选择 Agent 搜索测试：

第一层（workspace）：

- `search_tables(query)` 按关键字匹配表名返回正确结果。
- `search_tables(query)` 按关键字匹配表描述返回正确结果。
- `search_tables(query)` 按关键字匹配列名或列描述返回正确结果。
- 搜索工具只能访问 `self.workspace`，不能跨用户或跨 workspace 搜索。

第二层（磁盘 catalog 缓存）：

- 当 `catalog_cache/<source_id>.json` 文件存在时，加载并搜索返回结果。
- 当缓存文件不存在（用户从未拉取过 catalog）时，安全跳过，不做远程 fallback。
- 已导入到 workspace 的表在缓存搜索结果中被去重。

通用安全：

- 搜索结果不包含 `loader_params`、凭证或连接串。
- Agent 不能通过搜索工具建立新的数据源连接。

## 已决策问题

1. ~~导入后的源表描述是否应自动初始化 attachedMetadata？~~ **不初始化**。TableMetadata.description（源系统描述）和 attachedMetadata（用户描述）是两个独立字段，职责分开，互不覆盖。
2. ~~refresh 后源描述变化时如何处理？~~ TableMetadata.description 以源系统为准，每次 refresh 自动更新（源系统返回空则清空）。attachedMetadata 任何时候都不受影响。
3. ~~用户是否需要分别编辑两种描述？~~ 源系统描述（TableMetadata.description）只读不可编辑；用户描述（attachedMetadata）可编辑。前端同时展示两者。
4. ~~CatalogNode.metadata 是否暴露 source_metadata_status？~~ 需要向前端暴露，用于在 UI 中提示用户 metadata 拉取情况。
5. ~~BI 系统是否区分 dataset/chart/dashboard/report 描述？~~ 第一阶段统一拍平成一个 description，通过 markdown 做简单章节区分。
6. ~~数据选择 Agent 的搜索工具是走 HTTP 还是 Python 直调？~~ **Python 直调 + DuckDB**。Agent 运行在同一进程，第一层直接访问 workspace.get_metadata()，第二层使用 DuckDB `read_json_auto()` 查询磁盘上的 `catalog_cache/<source_id>.json`。不需要 HTTP API，也不需要远程搜索调用。DuckDB 已是项目现有依赖，不引入新包。
7. ~~搜索需要支持哪些匹配方式？~~ **DuckDB 原生支持子串匹配（`LIKE`）、正则（`regexp_matches()`）和结构化过滤（`UNNEST(columns)` 按列类型/列名筛选）**。搜索工具默认使用子串匹配，Agent 可根据需要构造更复杂的 SQL 条件。语义理解交给 Agent 自己处理——Agent 可以把用户意图拆成多个关键字多轮搜索，然后自己评估结果相关性。
8. ~~搜索结果排序策略？~~ **按匹配度排序**。表名匹配 > 表描述匹配 > 列名/列描述匹配；同层级内匹配字段越多排越前。单次搜索结果限制为 workspace 层最多 50 条，每个已连接数据源（磁盘缓存）最多 20 条。
9. ~~10,000 张表的元数据存在哪？会不会让 workspace.yaml 或 Agent 上下文过大？~~ **全量 catalog 元数据持久化到用户级磁盘文件 `<user_home>/catalog_cache/<source_id>.json`（~30 MB/数据源），不进入 `workspace.yaml`，不常驻内存。** `workspace.yaml` 仅存储用户已导入的表（通常几十到几百张）。搜索时按需从磁盘加载，用完释放。Agent 上下文通过渐进式分层控制：搜索结果只返回 Level 0 摘要（表名 + 一行描述 + 匹配列名），Agent 需要 schema 细节时通过 `inspect_source_data` 逐步深入到 Level 1（schema 概览）和 Level 2（完整细节含样本值）。每步上下文消耗控制在几 K tokens 以内。用户主动点击"刷新 catalog"时从远程重新拉取并覆盖磁盘文件。

## 关联文档

- `design-docs/2-external-dataloader-enhancements.md`
- `design-docs/9-generalized-data-source-plugins.md`
- `design-docs/13-unified-source-filters-plan.md`
- `dev-guides/3-data-loader-development.md`
- `dev-guides/5-data-connector-api.md`


