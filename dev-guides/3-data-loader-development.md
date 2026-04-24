# 数据加载器（ExternalDataLoader）开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-24
> **适用范围**: `py-src/data_formulator/data_loader/` 下的所有 Loader 实现

---

## 1. 架构概览

Data Loader 模块负责从外部数据源加载数据到 Workspace（parquet 文件）。所有 Loader 遵循统一的抽象基类 `ExternalDataLoader`。

### 数据流

```
外部数据源 → PyArrow Table → Parquet（Workspace）
```

- **存储格式**：数据以 **parquet** 写入 Workspace。DuckDB 仅作为计算引擎，不参与存储。
- **内存格式**：统一使用 **PyArrow** 作为中间表示。数据库类 Loader（PostgreSQL、MySQL、MSSQL）优先使用 **connectorx** 实现 Arrow-native 读取。

---

## 2. 实现一个新的 Data Loader

### 2.1 继承基类

创建一个继承 `ExternalDataLoader` 的类，实现以下方法：

| 方法 | 类型 | 说明 |
|------|------|------|
| `list_params()` | static | 连接参数定义（名称、类型、默认值、描述） |
| `auth_instructions()` | static | 获取凭证的简要说明文本 |
| `__init__(self, params)` | 实例 | 验证参数并建立/验证连接 |
| `fetch_data_as_arrow(source_table, size=..., sort_columns=..., sort_order=...)` | 实例 | 从数据源获取数据，返回 `pyarrow.Table` |
| `list_tables(table_filter=None)` | 实例 | 返回可选表/文件列表，格式为 `[{"name": ..., "metadata": {...}}]` |

**注意事项**：

- `fetch_data_as_arrow` 只接受 `source_table`（表/集合/文件标识符），**不接受原始 SQL 查询**，以确保安全性和方言一致性。
- `list_tables` 返回的 metadata 应包含 `row_count`、`columns`、`sample_rows`，保证前端行为一致。
- 基类提供 `ingest_to_workspace(workspace, ...)`，自动调用 `fetch_data_as_arrow()` 并写入 Workspace。Loader 无需实现 ingest 逻辑。

### 2.2 注册

在 `data_loader/__init__.py` 的 `_LOADER_SPECS` 列表中添加条目，框架会自动构建注册表。

### 2.3 现有实现参考

| Loader | 数据源 | 特殊说明 |
|--------|--------|---------|
| `PostgreSQLDataLoader` | PostgreSQL | connectorx |
| `MySQLDataLoader` | MySQL | connectorx |
| `MSSQLDataLoader` | SQL Server | connectorx |
| `BigQueryDataLoader` | Google BigQuery | |
| `AthenaDataLoader` | AWS Athena | SQL on S3 |
| `KustoDataLoader` | Azure Data Explorer | KQL |
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

### 4.1 `get_column_types(source_table)` — 列类型查询

当 Loader 能提供比 pandas dtype 更精确的列类型信息时，应实现此方法。`DataConnector` 的 `preview-data` 路由会在返回预览数据时调用它，将 `source_type` 注入到列元数据中。

**返回格式**:
```python
{
    "columns": [
        {"name": "id", "type": "NUMERIC", "is_dttm": False},
        {"name": "created_at", "type": "TEMPORAL", "is_dttm": True},
        {"name": "active", "type": "BOOLEAN", "is_dttm": False},
        {"name": "name", "type": "STRING", "is_dttm": False},
    ]
}
```

**标准化类型分类**: `TEMPORAL`、`NUMERIC`、`BOOLEAN`、`STRING`。前端根据 `source_type` 选择筛选控件（日期选择器、数值范围滑块、布尔开关、文本搜索框）。

基类 `ExternalDataLoader` 默认通过 `get_metadata` 返回列信息。如果 Loader 有更精确的类型信息（如 Superset 的 `is_dttm` 标志），应覆盖此方法。

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
| `/api/connectors/preview-data` | POST | 返回预览数据，自动附带 `source_type` |
| `/api/connectors/column-values` | POST | 返回列的可选值（智能筛选自动补全） |
| `/api/connectors/import-group` | POST | 批量导入，支持 `source_filters` 参数 |

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

## 5. 测试要求

实现或修改 Loader 时：

- 连接和读取错误必须抛出清晰的 `ValueError`
- 表名/对象名需校验或清洗
- `fetch_data_as_arrow` 必须尊重 `size` 限制和排序参数
- `list_tables()` 返回值必须包含统一的 metadata 字段（`row_count`、`columns`、`sample_rows`）

数据库类 Loader 的集成测试使用 Docker 容器，位于 `tests/database-dockers/`：

```bash
./tests/database-dockers/run_test_dbs.sh start    # 启动所有测试数据库
./tests/database-dockers/run_test_dbs.sh test      # 运行全部 Loader 测试
./tests/database-dockers/run_test_dbs.sh test mysql # 单独测试 MySQL
./tests/database-dockers/run_test_dbs.sh stop      # 关闭
```

---

## 6. Data Loader vs Plugin（DataSourcePlugin）的区别

| 维度 | ExternalDataLoader | DataSourcePlugin |
|------|-------------------|-----------------|
| 注册方式 | `data_loader/__init__.py` | `plugins/` 目录自动发现 |
| 前端 | 框架内置的连接器 UI | 自带独立面板（Panel 组件） |
| 认证 | 参数式（用户名/密码/连接串） | 支持 SSO、OAuth、Vault |
| 典型场景 | 数据库连接 | 第三方平台（Superset、Metabase） |
| 开发指南 | 本文档 | `docs-cn/5-datasource_plugin-development-guide.md` |
