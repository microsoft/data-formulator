# ExternalDataLoader 演进方案

> **来源**：从早期数据源扩展设计拆分；旧插件机制已删除。
> 当前数据源扩展统一基于 `ExternalDataLoader + DataConnector`。
> 本文用于追踪 `ExternalDataLoader` 的后续增强；懒加载 catalog、连接实例和凭证持久化
> 已进入新架构，数据库表/列描述元数据仍需按本文计划补齐。

---

## 目录

1. [现有缺陷与演进方向](#1-现有缺陷与演进方向)
2. [改进方案一：数据库元数据拉取 (P0)](#2-改进方案一数据库元数据拉取-p0)
3. [改进方案二：SSO Token 透传到数据库 (P1)](#3-改进方案二sso-token-透传到数据库-p1)
4. [改进方案三：凭证持久化 (已落地)](#4-改进方案三凭证持久化-已落地)

---

## 1. 现有缺陷与演进方向

审查了全部 DataLoader 后，发现三类可改进的问题：

### 已落地补充：懒加载 Catalog 与大目录分页

当前统一连接器 UI 通过 `/api/connectors/get-catalog` 按层级懒加载数据源目录，而不是依赖一次性返回整棵树的 `/get-catalog-tree`。Loader 可以通过 `catalog_hierarchy()` 声明层级，通过 `ls(path, filter, limit, offset)` 返回当前层级节点。

约定如下：

- `path=[]` 返回第一层可浏览节点，展开节点时将该节点的 `path` 传回 `ls()` 加载下一层。
- `filter` 只作用于当前可见层级，避免为了搜索表名扫描所有数据库或 schema。
- `limit`/`offset` 用于大目录分页。前端默认按页加载，并用 `Load more...` 继续追加，避免 schema 下几千张表导致页面卡顿。
- table 节点如果需要稳定源引用，应在 `metadata["_source_name"]` 中返回源系统可识别的完整标识符。

PostgreSQL 已按上述方式实现 `database → schema → table` 的懒加载。当连接参数 `database` 为空时，刷新只加载可访问数据库；展开数据库加载 schema；展开 schema 分页加载 table。table 节点使用 `database.schema.table` 作为 `_source_name`，并且 catalog 查询隐藏 PostgreSQL 系统/临时 schema：`information_schema`、`pg_catalog`、`pg_toast`、`^pg_temp_[0-9]+$`、`^pg_toast_temp_[0-9]+$`。

### 缺陷一：数据库元数据（注释/描述）未拉取

所有 DataLoader 的 `list_tables()` 只查了 `information_schema` 的列名和数据类型，**完全忽略了数据库自带的注释系统**。这些注释是 DBA 维护的宝贵业务知识：

| DataLoader | 只查了 | 数据库有但没查的 | 查询方法 |
|---|---|---|---|
| **PostgreSQL** | `column_name`, `data_type` | 表/列注释 (`COMMENT ON`) | `SELECT obj_description(oid) FROM pg_class` + `SELECT col_description(attrelid, attnum) FROM pg_attribute` |
| **MSSQL** | `COLUMN_NAME`, `DATA_TYPE`, `IS_NULLABLE` | 扩展属性 (`MS_Description`) | `SELECT value FROM sys.extended_properties WHERE name='MS_Description'` |
| **BigQuery** | `field.name`, `field.field_type` | `table.description`, `field.description` | `table_ref.description`, `field.description`（已有 API，一行代码） |
| **MySQL** | (预估同样缺失) | `COLUMN_COMMENT` | `SELECT COLUMN_COMMENT FROM information_schema.COLUMNS` |
| **Kusto** | `Name`, `Type` | 表和列的 DocString | `.show table T schema` 返回的 `DocString` 字段 |

**改进方案**：扩展 `list_tables()` 返回的 `columns` 结构，增加 `description` 字段。以 PostgreSQL 为例：

```python
# postgresql_data_loader.py — list_tables() 增加注释查询

# 现有查询只拿了列名和类型：
columns_query = """
    SELECT column_name, data_type 
    FROM information_schema.columns ...
"""

# 改进后同时查询列注释：
columns_query = """
    SELECT 
        c.column_name,
        c.data_type,
        pgd.description AS column_comment
    FROM information_schema.columns c
    LEFT JOIN pg_catalog.pg_statio_all_tables st
        ON st.schemaname = c.table_schema AND st.relname = c.table_name
    LEFT JOIN pg_catalog.pg_description pgd
        ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
    WHERE c.table_schema = '{schema}' AND c.table_name = '{table_name}'
    ORDER BY c.ordinal_position
"""

# 表注释也一并查询：
table_comment_query = """
    SELECT obj_description(c.oid) AS table_comment
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '{schema}' AND c.relname = '{table_name}'
"""
```

BigQuery 改进更简单（已有现成属性，只是没用）：

```python
# bigquery_data_loader.py — list_tables() 中已经有 table_ref，只是没取 description

table_ref = self.client.get_table(table.reference)

# 现有代码：
columns = [{"name": field.name, "type": field.field_type} for field in table_ref.schema[:10]]

# 改进后：
columns = [{
    "name": field.name,
    "type": field.field_type,
    "description": field.description,  # ← 一行代码，BigQuery SDK 直接支持
} for field in table_ref.schema[:10]]

# 表描述也直接有：
table_description = table_ref.description  # ← 同样一行
```

**当前代码核对（2026-04-26）**：

- `get_metadata(path)`、`get_column_types(source_table)`、`CatalogNode.metadata` 通道已经存在。
- `TableMetadata.description` 已存在，但 `ColumnInfo` 还没有 `description` 字段。
- `ExternalDataLoader.ingest_to_workspace()` 当前只写入 Arrow 推断的列名/类型和 `source_info`，不会把源系统表/列描述写入 workspace。
- PostgreSQL、MySQL、MSSQL、BigQuery、Kusto 当前的 `list_tables()` / `get_metadata()` 基本只返回列名、类型、行数和 sample rows，尚未把数据库注释、BigQuery description 或 Kusto DocString 合并进 metadata。

**改进成本**：每个 DataLoader 改 5-30 行代码即可。注释不存在的列/表返回 `None` 或省略字段；对前端和 AI prompt 都有提升。

### 缺陷二：认证方式单一，缺少 SSO/集成认证

现有 DataLoader 的认证能力参差不齐。部分 loader 已经支持本地或服务器侧的集成认证
（例如 ADC、`DefaultAzureCredential`、Windows Auth），但它们大多还没有接入
Data Formulator 的用户级 TokenStore/SSO token 注入链路。

**当前代码核对（2026-04-26）**：

| DataLoader | 代码中已实现的一等认证 | 尚未实现的一等认证能力 | 设计差异 / 备注 |
|---|---|---|---|
| **PostgreSQL** | `user` + `password`（`password` 可空） | Kerberos/GSSAPI；Azure AD token；AWS IAM token | Azure AD / AWS IAM token 理论上可手动填入 `password`，但 loader 不负责获取、刷新或过期处理，也没有 Kerberos/GSSAPI 参数。 |
| **MSSQL** | SQL 用户密码；`user` 为空时使用 Windows Auth (`Trusted_Connection=yes`) | Azure AD access token (`Authentication=ActiveDirectoryAccessToken`) | 当前连接字符串没有 `Authentication=ActiveDirectoryAccessToken`，也没有 ODBC access-token 注入分支。 |
| **BigQuery** | Service Account JSON (`credentials_path`)；Application Default Credentials (ADC) | UI/loader 参数化的 OIDC Federation；Workforce Identity | ADC 在服务器环境配置正确时可能间接支持 federation，但 loader 只显式处理 service account 文件和默认 `bigquery.Client()`。 |
| **Kusto** | Service Principal；`DefaultAzureCredential`（可覆盖 `az login`、Managed Identity、VS Code、环境变量等） | 用户提供的 Azure AD token (`with_aad_user_token_authentication`) | 实际能力比早期设计中的 “App Key 或 `az login`” 更宽，但还不能把 DF/SSO access token 直接传给 Kusto SDK。 |
| **Snowflake** | 无内置 loader | OAuth 2.0 token (`authenticator='oauth'`, `token=<token>`) | `DATA_LOADERS` 注册表和项目依赖中都没有 Snowflake loader。 |
| **Databricks** | 无内置 loader | Azure AD token / PAT | `DATA_LOADERS` 注册表和项目依赖中都没有 Databricks loader。 |

Kusto 和 BigQuery 已经有服务器侧默认身份链路（`DefaultAzureCredential` / ADC），
但这通常依赖管理员在服务器环境预先登录或配置凭证；在多用户团队部署中，它不能表达
“当前浏览器用户自己的数据权限”。

**当前框架能力**：通用 token 注入已由 `ExternalDataLoader.auth_config()`、
`delegated_login_config()`、`TokenStore` 和 `DataConnector._inject_credentials()` 承担。
剩余工作不是新增基类方法，而是让具体数据库 loader 声明非默认 `auth_config()`，
并在 `__init__` 中支持 Azure AD token、OIDC federation、IAM token 等目标系统认证分支。

### 缺陷三：凭证不持久化

该问题在当前 `DataConnector + Credential Vault` 架构中已基本落地，但需要按实际代码区分
“连接卡片”和“凭证”两类持久化。

已实现：

- 连接卡片定义保存在全局 `connectors.yaml` / `DF_SOURCES__*`，或当前用户目录下的
  `connectors.yaml`。
- 用户创建连接时，`user` / `password` / token / access key / connection string 等认证或敏感参数
  不写入用户 `connectors.yaml`，只保留 host、database 等非敏感连接配置。
- `connect` 请求的 `persist` 对应“是否记住密码/凭证”。`persist: true` 会把本次连接参数写入
  Credential Vault；Vault 以 `identity + source_id` 为键保存，其中 `source_id` 就是前端看到的
  `connector_id`。
- `persist: false` 对应“取消记住密码”。本次连接仍然可以使用，但不会保存凭证；如果该用户之前
  已经在这个 connector 上保存过凭证，后端会把旧凭证一起删掉。
- 以后再次打开同一个连接卡片时，如果 Vault 里还有凭证，后端可以自动取回并重连；如果没有保存凭证，
  用户需要重新输入密码或 token。

需要注意：

- `persist` 不控制连接卡片是否写入用户 `connectors.yaml`；用户新建 connector 后，卡片仍会保存。
- Credential Vault 当前按单机部署场景实现为本地 SQLite + Fernet。该存储方式是当前预期设计，
  足以覆盖主要部署形态；云 Vault、KMS 或多机共享后端只是未来扩展点，目前没有实现计划。
- 管理员预配置的 `connectors.yaml` / `DF_SOURCES__*` 参数不会自动迁移到 Vault；如果管理员把密码写入
  这些配置，它仍属于服务端配置管理范畴，而不是用户 Vault 凭证。

### 综合改进路线图

| 改进项 | 复杂度 | 价值 | 优先级 | 前置依赖 |
|--------|:---:|:---:|:---:|------|
| **数据库注释拉取** | 低（5-20 行/loader） | 高（直接提升 AI 分析质量） | P0 | 无（现在可做） |
| **SSO Token 透传** | 中 | 高（团队部署必需） | P1 | SSO AuthProvider 上线 |
| **凭证持久化** | 中 | 中（用户体验提升） | 已落地 | `DataConnector` + Credential Vault |
| **外部 Loader 接入规范** | 低 | 中 | 已落地 | `DF_PLUGIN_DIR` + `ExternalDataLoader` |

---

## 2. 改进方案一：数据库元数据拉取 (P0)

**目标**：让 DataLoader 在浏览、预览和导入时尽量保留源系统表/列描述，写入
`TableMetadata.description` 和 `ColumnInfo.description`，最终可被前端和 AI prompt 使用。

**当前代码状态**：

| 能力 | 代码状态 |
|------|----------|
| 懒加载 catalog | 已落地：`catalog_hierarchy()` + `ls(path, filter, limit, offset)` |
| 当前节点元数据 | 已落地基础通道：`get_metadata(path)` |
| 预览列类型增强 | 已落地基础通道：`get_column_types(source_table)` |
| Workspace 表描述 | `TableMetadata.description` 已存在 |
| Workspace 列描述 | 未落地：`ColumnInfo` 只有 `name` / `dtype` |
| 导入时写入源描述 | 未落地：`ingest_to_workspace()` 未合并源 metadata |
| 数据库注释查询 | 未落地：主流 SQL loader 仍只取列名/类型 |

### 2.1 设计调整：复用现有 metadata 通道

不再新增 `fetch_table_description()` / `fetch_column_descriptions()` 两个基类方法。当前代码已经有
`get_metadata(path)` 和 `get_column_types(source_table)`，应扩展它们的返回结构：

```python
{
    "description": "表描述，可选",
    "row_count": 1234,
    "columns": [
        {
            "name": "created_at",
            "type": "timestamp",
            "description": "订单创建时间，UTC，可选",
            "is_dttm": True,
        }
    ],
    "sample_rows": [],
}
```

约定：

- `description` 是表/数据集级描述，可省略或为 `None`。
- `columns[*].description` 是列级描述，可省略或为 `None`。
- `get_metadata(path)` 用于 catalog 点击节点后的详细元数据。
- `get_column_types(source_table)` 用于 preview/import 按 `source_table` 获取源类型和列描述。
- `list_tables()` 可以在 eager tree 场景中返回同样结构，但大目录 loader 不应为了描述扫描全库。

### 2.2 Workspace metadata schema

`TableMetadata.description` 已存在，只需补 `ColumnInfo.description`：

```python
@dataclass
class ColumnInfo:
    name: str
    dtype: str
    description: str | None = None

    def to_dict(self) -> dict:
        result = {"name": self.name, "dtype": self.dtype}
        if self.description is not None:
            result["description"] = self.description
        return result

    @classmethod
    def from_dict(cls, data: dict) -> "ColumnInfo":
        return cls(
            name=data["name"],
            dtype=data["dtype"],
            description=data.get("description"),
        )
```

`parquet_utils.get_arrow_column_info()` 可继续只生成 name/dtype；源描述在
`ExternalDataLoader.ingest_to_workspace()` 后置合并。

### 2.3 导入时写入 Workspace

基于现有 `ingest_to_workspace()` 流程，在写入 parquet 后尝试合并源 metadata。失败不影响数据导入：

```python
def ingest_to_workspace(self, workspace, table_name, source_table, import_options=None):
    arrow_table = self.fetch_data_as_arrow(
        source_table=source_table,
        import_options=import_options,
    )

    source_info = {
        "loader_type": self.__class__.__name__,
        "loader_params": self.get_safe_params(),
        "source_table": source_table,
        "import_options": import_options,
    }

    table_metadata = workspace.write_parquet_from_arrow(
        table=arrow_table,
        table_name=table_name,
        source_info=source_info,
    )

    try:
        source_meta = self.get_column_types(source_table) or {}
        table_desc = source_meta.get("description")
        source_columns = {
            c.get("name"): c
            for c in source_meta.get("columns", [])
            if c.get("name")
        }

        changed = False
        if table_desc:
            table_metadata.description = table_desc
            changed = True

        for col in table_metadata.columns or []:
            src = source_columns.get(col.name)
            if src and src.get("description"):
                col.description = src["description"]
                changed = True

        if changed:
            workspace.add_table_metadata(table_metadata)
    except Exception as exc:
        logger.debug("Source metadata enrichment failed for %s", source_table, exc_info=exc)

    return table_metadata
```

同时更新 `ExternalDataLoader.get_column_types()` 默认实现：当 `get_metadata(path)` 返回
`description` 时，应保留该字段，而不是只返回 `columns`。

### 2.4 各 DataLoader 的具体实现

**PostgreSQL**：

```python
# postgresql_data_loader.py — get_metadata(path) 中增强 columns 查询
cols_query = f"""
    SELECT
        c.column_name,
        c.data_type,
        pgd.description AS column_description
    FROM information_schema.columns c
    LEFT JOIN pg_catalog.pg_statio_all_tables st
        ON st.schemaname = c.table_schema AND st.relname = c.table_name
    LEFT JOIN pg_catalog.pg_description pgd
        ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
    WHERE c.table_schema = '{_esc_str(schema)}'
      AND c.table_name = '{_esc_str(table_name)}'
    ORDER BY c.ordinal_position
"""

table_desc_query = f"""
    SELECT obj_description(c.oid) AS description
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '{_esc_str(schema)}'
      AND c.relname = '{_esc_str(table_name)}'
"""
```

**MSSQL**：

```python
# mssql_data_loader.py — get_metadata(path) / list_tables() 中增加 MS_Description
SELECT
    c.name AS column_name,
    ty.name AS data_type,
    CAST(ep.value AS NVARCHAR(MAX)) AS column_description
FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.types ty ON c.user_type_id = ty.user_type_id
LEFT JOIN sys.extended_properties ep
    ON ep.major_id = c.object_id
   AND ep.minor_id = c.column_id
   AND ep.name = 'MS_Description'
WHERE s.name = ? AND t.name = ?
```

**BigQuery**（最简单——SDK 已有属性，只需取出）：

```python
# bigquery_data_loader.py — get_metadata(path)
table_ref = self.client.get_table(full_table)
columns = [
    {
        "name": f.name,
        "type": f.field_type,
        "description": f.description or None,
    }
    for f in table_ref.schema
]
return {
    "description": table_ref.description or None,
    "row_count": table_ref.num_rows or 0,
    "columns": columns,
    "sample_rows": [],
}
```

**MySQL**：

```python
# mysql_data_loader.py — columns 查询增加 COLUMN_COMMENT
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
FROM information_schema.columns
WHERE TABLE_SCHEMA = '{_esc_str(db)}'
  AND TABLE_NAME = '{_esc_str(table_name)}'
ORDER BY ORDINAL_POSITION
```

**Kusto**：

- `.show table ['T'] schema as json` 的 `OrderedColumns` 中如果存在 `DocString`，映射到
  `columns[*].description`。
- 表级描述可从 `.show table ['T'] details` 或 schema 返回字段中按实际可用字段映射。

### 2.5 前端展示（自然兼容）

现有前端 `DBManagerPane` 已经渲染了 `columns` 列表。只需小幅调整，当 `column.description` 存在时显示 tooltip：

```
┌─────────────────────────────────────────────────┐
│  public.orders — 订单主表，记录所有用户订单         │  ← table description
│                                                   │
│  列名              类型        描述                │
│  ──────           ────        ────                │
│  id               integer     订单唯一标识          │
│  customer_id      integer     关联客户表 (FK)       │
│  created_at       timestamp   订单创建时间（UTC）    │
│  total_amount     numeric     订单总金额（含税）     │  ← column descriptions
│  status           varchar     pending/paid/shipped  │
│                                                   │
│  行数: 1,234,567    [ 加载 ▾ ]                     │
└─────────────────────────────────────────────────┘
```

### 2.6 改动文件清单

| 文件 | 改动 | 行数估计 |
|------|------|:---:|
| `workspace_metadata.py` | `ColumnInfo` 增加 `description` 字段并兼容 YAML 读写；`TableMetadata.description` 已存在 | ~10 行 |
| `external_data_loader.py` | `ingest_to_workspace()` 后置合并 `get_column_types()` 返回的表/列描述；默认 `get_column_types()` 保留 `description` | ~25 行 |
| `postgresql_data_loader.py` | `get_metadata()` / 必要的 `list_tables()` 查询增加 `pg_description` 和表注释 | ~25 行 |
| `mssql_data_loader.py` | `get_metadata()` / 必要的 `list_tables()` 查询增加 `MS_Description` | ~30 行 |
| `bigquery_data_loader.py` | `get_metadata()` 取 `table_ref.description` 和 `field.description` | ~10 行 |
| `mysql_data_loader.py` | `get_metadata()` / 必要的 `list_tables()` 取 `TABLE_COMMENT`、`COLUMN_COMMENT` | ~20 行 |
| `kusto_data_loader.py` | 从 schema JSON / details 中取 DocString 或等价描述字段 | ~15 行 |
| **前端连接器面板** | 表描述和列描述展示；preview columns 可显示 description tooltip | ~10 行 |
| **AI context/prompt** | 如需让导入后的描述进入 Agent，上下文组装时读取 `TableMetadata.description` / `ColumnInfo.description` | ~15 行 |
| **总计** | | **~160 行** |

---

## 3. 改进方案二：SSO Token 透传到数据库 (P1)

**目标**：当 DF 用户通过 OIDC SSO 登录后，如果目标数据源也信任同一 IdP，loader 可以自动使用
token 或 token exchange 完成连接，用户无需再输入目标系统密码。

**当前代码状态（2026-04-26）**：

| 能力 | 代码状态 |
|------|----------|
| 认证能力声明 | 已落地为 `ExternalDataLoader.auth_config()`，不是 `supported_auth_methods()` |
| delegated login | 已落地：`delegated_login_config()` |
| TokenStore 注入 | 已落地：`DataConnector._inject_credentials()` 会注入 `access_token` / `sso_access_token` |
| SSO 自动连接 | 已落地基础逻辑：`_try_sso_auto_connect()` 支持 `token`、`sso_exchange`、`delegated` |
| Superset SSO bridge | 已有实现：`SupersetLoader.auth_config(mode="sso_exchange")` |
| 数据库级 Azure AD / OIDC federation | 未逐个 loader 落地，仍是后续 P1 |

后续实现不应新增 `/api/data-loader/{type}/auth-methods`，也不应新增
`supported_auth_methods()`。应沿用当前接口：

```python
@staticmethod
def auth_config() -> dict:
    return {
        "mode": "sso_exchange",
        "display_name": "Example Source",
        "exchange_url": "...",
        "supports_refresh": True,
    }
```

数据库类 loader 如果要支持多种认证方式，可以先通过 `list_params()` 暴露 `auth_method`
字段，并在 `__init__` 中根据 `auth_method` 选择用户名密码、Azure AD token、IAM token 等分支。
当 `auth_config()["mode"]` 不是 `credentials` / `connection` 时，`DataConnector` 会在创建
loader 前尝试从 `TokenStore` 或当前 SSO identity 注入 token。

---

## 4. 改进方案三：凭证持久化 (已落地)

**目标**：用户连接数据库或外部系统后，可以选择保存凭证；后续打开同一个 connector instance
时无需重新输入密码或 token。

**当前代码状态（2026-04-26）**：

| 能力 | 代码状态 |
|------|----------|
| 连接实例配置 | 已落地：`connectors.yaml`、`DF_SOURCES__*`、用户 `connectors.yaml` |
| 用户创建连接 | 已落地：`POST /api/connectors` |
| 连接/断开/删除 | 已落地：`/api/connectors/connect`、`disconnect`、`DELETE /api/connectors/{id}` |
| 凭证保存 | 已落地：`DataConnector._vault_store(identity, source_id)`，其中 `source_id` 对应 API 的 `connector_id` |
| 自动重连 | 已落地：`_try_auto_reconnect()` 从 Vault 取回凭证并测试连接 |
| 用户卡片敏感字段过滤 | 已落地：用户创建 connector 时只把非认证、非敏感参数写入用户 `connectors.yaml` |
| Vault 后端 | 已落地：当前按单机部署设计，使用 `local`（SQLite + Fernet）实现 |

因此不再需要旧计划中的 `/data-loader/saved-connections` API。当前规范是：

- connector card 定义保存在全局 `connectors.yaml` / `DF_SOURCES__*`，或用户目录下的
  `connectors.yaml`。
- 用户连接时提交的密码、token、access key、connection string 等凭证由 Credential Vault 管理；
  管理员预配置参数仍来自服务端配置文件或环境变量。
- `connect` 请求的 `persist` 只控制是否“记住密码/凭证”，不控制连接卡片是否保存：
  `persist: true` 表示以后可从 Vault 自动重连，`persist: false` 表示不记住并清除旧凭证。
- `disconnect` 清除当前 live loader 和已保存服务凭证，但保留连接卡片。
- `delete` 删除用户连接卡片，同时清除 vault 凭证。
- 当前 Credential Vault 聚焦单机部署，使用本地 `credentials.db` 和 Fernet 密钥文件；
  多机共享、云 Vault 或 KMS 集成属于未来扩展点，当前没有实现计划。

安全边界：

| 措施 | 说明 |
|------|------|
| **加密存储** | 密码等敏感字段通过 Credential Vault 加密 |
| **per-identity 隔离** | Vault key 使用 `identity + connector_id` |
| **不回显密码** | 前端只接收 `get_safe_params()` 和 `params_form` |
| **管理员连接不可删除** | admin connector 对用户可见但不可删除 |

---

## 关联文档

| 文档 | 关系 |
|------|------|
| `9-generalized-data-source-plugins.md` | `ExternalDataLoader + DataConnector` 统一数据源架构 |
| `11-unified-auth-credential-architecture.md` | TokenStore、OIDC、CredentialVault 与 loader `auth_config()` |
| `dev-guides/3-data-loader-development.md` | 当前 Loader 开发规范 |
| `dev-guides/5-data-connector-api.md` | 当前 DataConnector API 与连接实例规范 |
