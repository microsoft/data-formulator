# 数据加载器（ExternalDataLoader）开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-26
> **适用范围**: `py-src/data_formulator/data_loader/` 下的所有 Loader 实现

---

## 1. 架构概览

Data Loader 模块负责从外部数据源加载数据到 Workspace（parquet 文件）。所有 Loader 遵循统一的抽象基类 `ExternalDataLoader`。

`ExternalDataLoader` 是新增数据源时要实现的**数据源适配器接口**。`DataConnector`
是框架提供的**连接实例管理层**，一般不需要由具体数据源继承或重写。它负责把 loader
包装成可连接、可浏览、可预览、可导入、可刷新的 connector instance，并统一暴露
`/api/connectors/...` API。

### 数据流

```
外部数据源 → PyArrow Table → Parquet（Workspace）
```

- **存储格式**：数据以 **parquet** 写入 Workspace。DuckDB 仅作为计算引擎，不参与存储。
- **内存格式**：统一使用 **PyArrow** 作为中间表示。各 Loader 可按源系统 SDK 读取后转换为 `pyarrow.Table`；PostgreSQL、MySQL、MSSQL 当前分别使用 `psycopg2`、`pymysql`、`pyodbc`。
- **扩展边界**：新增数据源通常只实现 `ExternalDataLoader`，由
  `DataConnector.from_loader(...)` 自动包装；不要为每个数据源新增专有 Flask
  Blueprint 或 per-instance route。

---

## 2. 实现一个新的 Data Loader

### 2.1 继承基类

创建一个继承 `ExternalDataLoader` 的类。最小 loader 只需要声明连接表单、完成连接初始化、
列举可导入对象，并把选中的对象读取为 `pyarrow.Table`。其余连接生命周期由
`DataConnector` 自动处理。

**必须实现**：

| 方法 | 类型 | 说明 |
|------|------|------|
| `__init__(self, params)` | 实例 | 保存并验证连接参数；可建立客户端或延迟到首次调用时连接 |
| `list_params()` | static | 连接参数定义；用于 `/api/data-loaders` 和前端创建连接表单 |
| `auth_instructions()` | static | 获取凭证或配置连接的简要说明文本 |
| `list_tables(table_filter=None)` | 实例 | 返回当前 pinned scope 下可导入表/文件/数据集列表 |
| `fetch_data_as_arrow(source_table, import_options=None)` | 实例 | 从数据源获取数据，返回 `pyarrow.Table` |

**推荐实现**：

| 方法 | 类型 | 说明 |
|------|------|------|
| `catalog_hierarchy()` | static | 声明完整 catalog 层级，如 `database -> schema -> table` |
| `ls(path=None, filter=None, limit=None, offset=0)` | 实例 | 按层级懒加载 catalog 节点；大目录应支持源端分页 |
| `search_catalog(query, limit=100)` | 实例 | 跨层级搜索；默认回退到 `list_tables(table_filter=query)` |
| `get_metadata(path)` | 实例 | 返回指定 catalog 节点的表/列元数据和样例；源系统描述字段可选 |
| `get_column_types(source_table)` | 实例 | 返回源系统列类型，供预览和筛选控件使用 |
| `get_column_values(source_table, column_name, keyword, limit, offset)` | 实例 | 返回列值枚举，供智能筛选自动补全使用 |
| `test_connection()` | 实例 | 用轻量请求验证连接是否可用；默认会调用 `list_tables("__ping__")` |

**认证相关按需实现**：

| 方法 | 类型 | 说明 |
|------|------|------|
| `auth_config()` | static | 声明 credentials、sso_exchange、delegated、oauth2 等认证模式 |
| `auth_mode()` | static | 旧接口；新 loader 优先实现 `auth_config()` |
| `delegated_login_config()` | static | 声明 popup/delegated login 配置，如 Superset SSO bridge |

**注意事项**：

- `fetch_data_as_arrow` 只接受 `source_table`（表/集合/文件/数据集标识符），**不接受原始 SQL 查询**，以确保安全性和方言一致性。
- `list_tables` 返回轻量 catalog metadata；不要为了列表页或 Agent 缓存读取样本行或逐表计数。
- 新增或修改层级型 Loader 时，优先实现 `ls()`。`path=[]` 返回第一层，展开节点时返回下一层；`filter` 只作用于当前层级。
- 对可能返回大量节点的层级（例如 database/schema 下有几千张表），`ls()` 应支持 `limit`/`offset`，由 `/api/connectors/get-catalog` 透传。
- 大目录应覆盖 `search_catalog()`，只返回轻量搜索结果；前端只在 Enter/search button 时调用 `/api/connectors/search-catalog`。
- table 节点如果显示名不足以唯一定位源对象，应在 `metadata["_source_name"]` 中放入稳定源标识符。例如 PostgreSQL 使用 `database.schema.table`，用于 preview/import/refresh。
- 基类提供 `ingest_to_workspace(workspace, ...)`，自动调用 `fetch_data_as_arrow()` 并写入 Workspace。Loader 无需实现 ingest 逻辑。
- 表/列描述是接口层可承载的可选元数据。导入和 refresh 链路会 best-effort 合并 `get_column_types()` 返回的表/列描述到 Workspace。

能力映射：

| 产品能力 | Loader 接口 |
|----------|-------------|
| 列举所有表/文件/数据集 | `list_tables()` |
| 按层级浏览数据源 | `catalog_hierarchy()` + `ls(path, filter, limit, offset)` |
| 根据关键词筛选当前层级节点 | `ls(..., filter=...)` |
| 跨层级搜索表/数据集 | `search_catalog(query)` |
| 表/列元数据和样例；描述为可选扩展 | `get_metadata(path)`、`get_column_types(source_table)`、`CatalogNode.metadata` |
| 筛选控件的列值枚举 | `get_column_values(...)` |
| 预览、导入、刷新源数据 | `fetch_data_as_arrow()` + 基类 `ingest_to_workspace()` |

最小示例：

```python
from typing import Any

import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader


class MyReportDataLoader(ExternalDataLoader):
    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.url = params.get("url", "").rstrip("/")
        self.token = params.get("token", "")
        if not self.url:
            raise ValueError("url is required")

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "url", "type": "string", "required": True, "tier": "connection"},
            {"name": "token", "type": "password", "required": True, "sensitive": True, "tier": "auth"},
        ]

    @staticmethod
    def auth_instructions() -> str:
        return "Provide the report system URL and an API token with dataset read access."

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        return [
            {
                "name": "sales_report",
                "metadata": {
                    "_source_name": "sales_report",
                    "description": "Regional sales report",
                    "columns": [{"name": "region", "type": "STRING", "description": "Sales region"}],
                },
            }
        ]

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        # Call the source system API and convert the result to Arrow.
        return pa.table({"region": ["US", "EU"]})
```

### 2.1.1 源元数据与轻量 catalog 契约

源系统提供的表描述、字段注释、BI 数据集描述等都按 **best-effort metadata** 处理：

- 元数据读取失败不能阻断 catalog 浏览、preview、import、refresh 或源端筛选。
- 失败时返回 `{}`、缺省字段或部分 metadata；记录 debug/warning 日志，但不要把凭据、token、连接串或敏感路径写入日志或响应。
- `description` 字段表示源系统描述，只读进入 `TableMetadata.description` 或 `ColumnInfo.description`；不要用它覆盖前端用户可编辑的 `attachedMetadata`。
- 空字符串表示源系统明确清空描述；缺少 `description` key 表示保留已有描述。

`list_tables(table_filter=None)` 用于全量轻量 catalog 和 Agent 搜索缓存，必须避免昂贵的逐表数据查询：

- 返回表名、稳定源标识符、列名、列类型，以及源端低成本可得的表/列描述。
- 不要为了 catalog 列表执行 per-table `SELECT * LIMIT ...`、`COUNT(*)` 或读取大文件样本。
- `row_count` 和 `sample_rows` 只有在源系统已经低成本提供时才可返回；否则省略。
- SQL 类 Loader 应优先批量读取 `information_schema` / 系统 catalog / SDK metadata。

推荐的轻量返回形状：

```python
{
    "name": "public.orders",
    "metadata": {
        "_source_name": "public.orders",
        "description": "订单事实表",
        "columns": [
            {"name": "order_id", "type": "INTEGER", "description": "订单唯一标识"},
            {"name": "created_at", "type": "TIMESTAMP"},
        ],
    },
}
```

`get_metadata(path)` 用于单个 catalog 节点的详细元数据，`get_column_types(source_table)` 用于 preview/import/refresh 阶段的源类型和描述增强。二者应尽量保持字段一致：

```python
{
    "description": "订单事实表",
    "columns": [
        {
            "name": "created_at",
            "type": "TIMESTAMP",
            "source_type": "TEMPORAL",
            "description": "订单创建时间",
            "is_dttm": True,
        },
    ],
}
```

内置合并语义由 `ExternalDataLoader.ingest_to_workspace()` 和 refresh 路由统一处理：

- 导入和刷新会 best-effort 调用 `get_column_types(source_table)`。
- `description` 合并到 `TableMetadata.description`。
- `columns[].description` 按列名合并到 `ColumnInfo.description`。
- metadata 增强失败时保留数据导入/刷新结果。

### 2.1.2 Catalog 浏览规范

`DataConnector` 的 `/api/connectors/get-catalog` 是前端推荐使用的懒加载 catalog API。请求体：

```json
{
  "connector_id": "postgres:analytics",
  "path": ["mydb", "public"],
  "filter": "orders",
  "limit": 200,
  "offset": 0
}
```

返回体包含当前层级的节点和分页信息：

```json
{
  "path": ["mydb", "public"],
  "nodes": [
    {
      "name": "orders",
      "node_type": "table",
      "path": ["mydb", "public", "orders"],
      "metadata": {"_source_name": "mydb.public.orders"}
    }
  ],
  "has_more": false,
  "next_offset": null
}
```

实现建议：

- `node_type="namespace"` 表示可展开目录，如 database、schema、bucket。
- `node_type="table"` 表示可导入叶子节点。
- `limit`/`offset` 是可选参数；不支持分页的 Loader 可以忽略，框架会回退到内存切片，但大目录 Loader 应在数据源查询层分页。
- 过滤语义为当前层级本地过滤，不应为了搜索 table 而扫描所有数据库或 schema。

PostgreSQL 额外约定：

- 当连接参数 `database` 为空时，root 层返回可访问 database；展开 database 返回 schema；展开 schema 返回 table。
- table 节点必须携带 `metadata["_source_name"] = "database.schema.table"`，因为跨数据库 preview/import/refresh 需要完整源标识符。
- catalog 查询应隐藏系统/临时 schema，包括 `information_schema`、`pg_catalog`、`pg_toast`，以及正则匹配 `^pg_temp_[0-9]+$`、`^pg_toast_temp_[0-9]+$` 的 PostgreSQL 临时 schema。

### 2.2 注册

Loader type 注册后，`DataConnector` 会自动把它包装成 connector instance。注册方式有两种：

1. **内置 loader**：修改源码，在 `data_loader/__init__.py` 的 `_LOADER_SPECS`
   列表中添加 `(registry_key, module_path, class_name, pip_package)` 条目。
2. **外部 loader 插件**：不修改仓库源码，把 `*_data_loader.py` 放到
   `DF_PLUGIN_DIR` 指向的目录。默认目录是 `~/.data-formulator/plugins/`。

外部 loader 文件会在服务启动时被扫描。系统会导入每个匹配 `*_data_loader.py` 的文件，
找到其中公开的 `ExternalDataLoader` 子类，并注册到 `DATA_LOADERS`。注册 key 来自文件名：

```text
my_report_data_loader.py -> my_report
```

如果外部 loader 的 key 与内置 loader 相同，外部 loader 会覆盖内置实现。这个机制适合
管理员或部署方在不改源码的情况下接入新的报表系统、数据库或文件系统；它不是普通浏览器
终端用户上传任意代码的自助插件机制。

注册完成后：

- `GET /api/data-loaders` 会返回新的 loader type、参数表单、层级信息和认证说明。
- 用户可以通过 UI 或 `POST /api/connectors` 创建该类型的 connector instance。
- 管理员可以通过 `DATA_FORMULATOR_HOME/connectors.yaml` 或 `DF_SOURCES__*`
  预置全局 connector instance。

### 2.3 现有实现参考

| Loader | 数据源 | 特殊说明 |
|--------|--------|---------|
| `PostgreSQLDataLoader` | PostgreSQL | `psycopg2` |
| `MySQLDataLoader` | MySQL | `pymysql` |
| `MSSQLDataLoader` | SQL Server | `pyodbc` |
| `BigQueryDataLoader` | Google BigQuery | `google-cloud-bigquery`，查询结果可直接 `to_arrow()` |
| `AthenaDataLoader` | AWS Athena | SQL on S3 |
| `KustoDataLoader` | Azure Data Explorer | `azure-kusto-data`，KQL 结果转 Arrow |
| `S3DataLoader` | Amazon S3 文件 | PyArrow S3 filesystem |
| `AzureBlobDataLoader` | Azure Blob Storage | PyArrow |
| `MongoDBDataLoader` | MongoDB | |
| `LocalFolderDataLoader` | 本机目录 | 仅桌面模式可用，见 §3 |

---

## 3. 部署安全限制

如果 Loader 涉及**直接读取宿主文件系统**（不通过 Workspace API），则在多用户/云部署下构成任意文件读取风险。

**必须遵守的规范**（详见 `.cursor/skills/path-safety/SKILL.md` R5）：

- 在 `data_loader/__init__.py` 的 `_enforce_deployment_restrictions()` 中注册禁用规则
- 当 `WORKSPACE_BACKEND != "local"` 时，该 Loader 自动从 `DATA_LOADERS` 移入 `DISABLED_LOADERS`
- `create_connector()` 会拒绝已禁用的类型

**判断标准**：如果 Loader 的构造函数接受一个用户可控的本机路径（如 `root_dir`），它就需要部署守卫。

当前受此限制的 Loader：`local_folder`。

> 完整分析见 `design-docs/issues/002-arbitrary-file-read-audit.md` FINDING-3。

---

## 4. 智能筛选与列值 API

### 4.1 `get_column_types(source_table)` — 列类型与描述查询

当 Loader 能提供比 pandas dtype 更精确的列类型信息，或能读取源系统表/列描述时，应实现此方法。`DataConnector` 的 `preview-data` 路由会在返回预览数据时调用它，将 `source_type` 和 `description` 注入到列元数据中；导入和 refresh 流程也会用它更新 Workspace 中的只读源描述。

**返回格式**:
```python
{
    "description": "订单事实表",
    "columns": [
        {"name": "id", "type": "NUMERIC", "description": "订单 ID", "is_dttm": False},
        {"name": "created_at", "type": "TEMPORAL", "description": "创建时间", "is_dttm": True},
        {"name": "active", "type": "BOOLEAN", "is_dttm": False},
        {"name": "name", "type": "STRING", "is_dttm": False},
    ]
}
```

**标准化类型分类**: `TEMPORAL`、`NUMERIC`、`BOOLEAN`、`STRING`。前端根据 `source_type` 选择筛选控件（日期选择器、数值范围滑块、布尔开关、文本搜索框）。

基类 `ExternalDataLoader` 默认通过 `get_metadata` 返回列信息，并会保留表级 `description`。如果 Loader 有更精确的类型信息（如 Superset 的 `is_dttm` 标志），应覆盖此方法。

### 4.2 `get_column_values(source_table, column_name, keyword, limit, offset)` — 列值查询

此方法支持前端智能筛选的自动补全功能。当用户在数据源侧边栏添加筛选条件时，前端会调用 `/api/connectors/column-values` 获取列的可选值。

**返回格式**:
```python
{
    "options": [
        {"label": "Alice", "value": "Alice"},
        {"label": "Bob", "value": "Bob"},
    ],
    "has_more": False
}
```

**参数说明**:
- `source_table`: 数据源表标识符
- `column_name`: 列名
- `keyword`: 可选搜索关键词（用于前端输入时过滤）
- `limit`: 返回结果数量上限（1–200）
- `offset`: 分页偏移

基类默认返回 `{"options": [], "has_more": False}`，表示不支持列值查询。Loader 实现时应尽可能提供有效数据。

### 4.3 Connector 路由

`DataConnector` 框架自动注册以下筛选相关路由：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/connectors/preview-data` | POST | 返回预览数据，自动附带 `source_type`、表描述和列描述 |
| `/api/connectors/column-values` | POST | 返回列的可选值（智能筛选自动补全） |
| `/api/connectors/import-group` | POST | 批量导入，支持 `source_filters` 参数 |
| `/api/connectors/disconnect` | POST | 断开当前 identity 下的 connector，清除该连接的 in-memory loader、vault 凭据和 session service token，但保留 connector 定义 |

### 4.4 `source_filters` 格式

`import-group` 和 `fetch_data_as_arrow` 通过 `import_options.source_filters` 传递筛选条件：

```python
[
    {"column": "status", "operator": "EQ", "value": "active"},
    {"column": "age", "operator": "BETWEEN", "value": [18, 65]},
    {"column": "region", "operator": "IN", "value": ["US", "EU"]},
]
```

**合法运算符**: `EQ`, `NEQ`, `GT`, `GTE`, `LT`, `LTE`, `IN`, `NOT_IN`, `LIKE`, `ILIKE`, `IS_NULL`, `IS_NOT_NULL`, `BETWEEN`。

Loader 应在 SQL 构建时使用参数化或白名单校验运算符（参考 `SupersetLoader._build_source_filter_clauses`）。

---

## 5. Connector 身份隔离与凭据边界

用户创建的 connector 实例属于当前 identity（`browser:*` / `user:*` / `local:*`）。
后端内部 registry 必须通过 identity-scoped key 保存 user connector；前端和 API
仍使用公开 `source_id`。新增或修改 connector 路由时必须通过 `DataConnector`
框架提供的可见性解析逻辑查找 connector，禁止直接用客户端传入的 `connector_id`
读取全局 `DATA_CONNECTORS`。

连接参数分为两类：

- **Connector metadata**：可持久化到 `users/<identity>/connectors.yaml`，例如 host、
  port、database、bucket、root_dir 等非敏感、非 auth-tier 参数。
- **Credentials**：用户名、密码、token、access key、connection string、auth-tier 参数等。
  这些只能用于本次连接并通过 vault 按 `identity + source_id` 保存，不能写入
  `connectors.yaml`，也不能作为 `pinned_params` 返回前端。

匿名用户登录后不会自动继承匿名 identity 下的 connector 或 vault 凭据。若产品需要
迁移匿名 connector，必须像 workspace migration 一样提供显式确认流程。

---

## 6. 测试要求

实现或修改 Loader 时：

- 连接和读取错误必须抛出清晰的 `ValueError`
- 表名/对象名需校验或清洗
- `fetch_data_as_arrow` 必须尊重 `import_options` 中的 `size`、`columns`、`sort_columns`、`sort_order`、`filters`、`source_filters`
- `list_tables()` 返回值必须包含统一的轻量 metadata 字段（至少稳定源标识、列名/类型；有低成本来源时包含表/列描述）
- 覆盖 `get_column_types()` 或 `get_metadata()` 时，测试表级 `description`、列级 `description`、空描述清空、缺 key 保留和 metadata 失败不阻断导入/预览

数据库类 Loader 的集成测试使用 Docker 容器，位于 `tests/database-dockers/`：

```bash
./tests/database-dockers/run_test_dbs.sh start    # 启动所有测试数据库
./tests/database-dockers/run_test_dbs.sh test      # 运行全部 Loader 测试
./tests/database-dockers/run_test_dbs.sh test mysql # 单独测试 MySQL
./tests/database-dockers/run_test_dbs.sh stop      # 关闭
```
