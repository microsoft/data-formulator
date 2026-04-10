# ExternalDataLoader 演进方案

> **来源**：从 `1-data-source-plugin-architecture.md` Section 11.3~11.6 拆分。
> 这些改进针对现有的 ExternalDataLoader（数据库连接器），与 DataSourcePlugin（BI 系统插件）互不干扰。

---

## 目录

1. [现有缺陷与演进方向](#1-现有缺陷与演进方向)
2. [改进方案一：数据库元数据拉取 (P0)](#2-改进方案一数据库元数据拉取-p0)
3. [改进方案二：SSO Token 透传到数据库 (P1)](#3-改进方案二sso-token-透传到数据库-p1)
4. [改进方案三：凭证持久化 (P2)](#4-改进方案三凭证持久化-p2)

---

## 1. 现有缺陷与演进方向

审查了全部 9 个 DataLoader 后，发现两大类可改进的问题：

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

**改进成本**：每个 DataLoader 改 5-20 行代码即可。注释不存在的列/表返回 `None`，与 `ColumnInfo` 扩展字段完美对齐——对前端和 AI prompt 的提升效果与插件拉取的元数据一致。

### 缺陷二：认证方式单一，缺少 SSO/集成认证

现有 DataLoader 的认证能力参差不齐，很多数据库明明支持 SSO 或集成认证，但 DataLoader 只实现了用户名/密码模式：

| DataLoader | 现有认证 | 数据库支持但 DataLoader 未实现的 |
|---|---|---|
| **PostgreSQL** | user + password | Kerberos/GSSAPI; Azure AD token (`password=<token>`); AWS IAM token |
| **MSSQL** | user/password 或 Windows Auth | Azure AD token (`Authentication=ActiveDirectoryAccessToken`) |
| **BigQuery** | Service Account JSON 或 ADC | OIDC 联邦身份 (`google.auth.identity_pool`); Workforce Identity |
| **Kusto** | App Key 或 `az login` | Azure AD user token (`with_aad_user_token_authentication`) |
| **Snowflake** | (未实现) | OAuth 2.0 token (`authenticator='oauth'`, `token=<token>`) |
| **Databricks** | (未实现) | Azure AD token / PAT |

Kusto 和 BigQuery 已经有了 CLI 认证（`az login` / `gcloud auth`），但这要求用户**在服务器终端上手动执行命令**——在团队部署模式下不现实。

**改进方案**：在 `ExternalDataLoader` 基类中增加 SSO token 注入能力。

```python
class ExternalDataLoader(ABC):
    
    @staticmethod
    def supported_auth_methods() -> list[str]:
        """返回支持的认证方式列表。
        
        可选值:
        - "credentials"     — 用户名/密码（默认，所有 loader 都支持）
        - "sso_token"       — OIDC/OAuth access_token
        - "azure_ad_token"  — Azure AD access_token
        - "iam_token"       — AWS IAM 认证 token
        - "service_account" — 服务账号 JSON key
        - "cli"             — 本地 CLI 认证（az login / gcloud auth）
        """
        return ["credentials"]
    
    def set_auth_token(self, token: str, token_type: str = "bearer") -> None:
        """注入来自 DF SSO 层的认证 token（可选实现）。"""
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support token injection"
        )
```

### 缺陷三：凭证不持久化

当前 DataLoader 的连接参数（包括密码）存在**前端 Redux Store** 中，刷新页面即丢失。用户每次打开都要重新输入。接入 CredentialVault（`sso-plugin-architecture.md` 中设计）后可以提供"记住密码"能力。

### 综合改进路线图

| 改进项 | 复杂度 | 价值 | 优先级 | 前置依赖 |
|--------|:---:|:---:|:---:|------|
| **数据库注释拉取** | 低（5-20 行/loader） | 高（直接提升 AI 分析质量） | P0 | 无（现在可做） |
| **SSO Token 透传** | 中 | 高（团队部署必需） | P1 | SSO AuthProvider 上线 |
| **凭证持久化** | 中 | 中（用户体验提升） | P2 | CredentialVault 上线 |
| **升级为 Plugin** | 高 | 低 | P3 | 仅 Snowflake 等需要 |

---

## 2. 改进方案一：数据库元数据拉取 (P0)

**目标**：让 DataLoader 在 `list_tables()` 和 `ingest_to_workspace()` 时一并拉取数据库的表/列注释，写入 `ColumnInfo` 和 `TableMetadata`，最终流入前端 AI prompt。

**不修改基类接口**，仅在各 DataLoader 内部实现中增强查询逻辑。对前端无感，通过现有 `list-tables` API 自然下发。

### 2.1 基类增加可选方法

```python
# external_data_loader.py — 新增可选方法

class ExternalDataLoader(ABC):
    # ... 现有方法不变 ...

    def fetch_table_description(self, source_table: str) -> str | None:
        """获取表的描述/注释（可选实现）。"""
        return None

    def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
        """获取各列的描述/注释（可选实现）。
        
        Returns:
            {"column_name": "列描述", ...}，缺失注释的列不含在结果中。
        """
        return {}
```

这两个方法**不是 abstract 的**——默认返回空，对现有 loader 零影响。哪个 loader 想支持元数据就 override 即可。

### 2.2 各 DataLoader 的具体实现

**PostgreSQL**：

```python
# postgresql_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT obj_description(c.oid) AS comment
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '{schema}' AND c.relname = '{table}'
    """
    result = self._read_sql(query).to_pandas()
    if len(result) > 0 and result.iloc[0]['comment']:
        return str(result.iloc[0]['comment'])
    return None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT
            a.attname AS column_name,
            d.description AS comment
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_description d
            ON d.objoid = a.attrelid AND d.objsubid = a.attnum
        WHERE n.nspname = '{schema}'
          AND c.relname = '{table}'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND d.description IS NOT NULL
    """
    result = self._read_sql(query).to_pandas()
    return {row['column_name']: row['comment'] for _, row in result.iterrows()}
```

**MSSQL**：

```python
# mssql_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT CAST(ep.value AS NVARCHAR(MAX)) AS comment
        FROM sys.extended_properties ep
        JOIN sys.tables t ON ep.major_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = '{schema}' AND t.name = '{table}'
          AND ep.minor_id = 0 AND ep.name = 'MS_Description'
    """
    result = self._execute_query(query).to_pandas()
    if len(result) > 0 and result.iloc[0]['comment']:
        return str(result.iloc[0]['comment'])
    return None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT c.name AS column_name,
               CAST(ep.value AS NVARCHAR(MAX)) AS comment
        FROM sys.columns c
        JOIN sys.tables t ON c.object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN sys.extended_properties ep
            ON ep.major_id = c.object_id
           AND ep.minor_id = c.column_id
           AND ep.name = 'MS_Description'
        WHERE s.name = '{schema}' AND t.name = '{table}'
          AND ep.value IS NOT NULL
    """
    result = self._execute_query(query).to_pandas()
    return {row['column_name']: row['comment'] for _, row in result.iterrows()}
```

**BigQuery**（最简单——SDK 已有属性，只需取出）：

```python
# bigquery_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    table_ref = self.client.get_table(source_table)
    return table_ref.description or None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    table_ref = self.client.get_table(source_table)
    return {
        field.name: field.description
        for field in table_ref.schema
        if field.description
    }
```

**MySQL**：

```python
# mysql_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT TABLE_COMMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table}'
    """
    result = self._read_sql(query).to_pandas()
    comment = result.iloc[0]['TABLE_COMMENT'] if len(result) > 0 else None
    return comment if comment and comment.strip() else None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT COLUMN_NAME, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table}'
          AND COLUMN_COMMENT IS NOT NULL AND COLUMN_COMMENT != ''
    """
    result = self._read_sql(query).to_pandas()
    return {row['COLUMN_NAME']: row['COLUMN_COMMENT'] for _, row in result.iterrows()}
```

### 2.3 元数据如何写入 Workspace

在 `ingest_to_workspace()` 中调用这两个方法，将注释写入 `ColumnInfo` 和 `TableMetadata`：

```python
# external_data_loader.py — ingest_to_workspace 增强

def ingest_to_workspace(self, workspace, table_name, source_table, size=1000000, 
                         sort_columns=None, sort_order='asc'):
    arrow_table = self.fetch_data_as_arrow(source_table, size, sort_columns, sort_order)

    loader_metadata = {
        "loader_type": self.__class__.__name__,
        "loader_params": self.get_safe_params(),
        "source_table": source_table,
    }

    table_metadata = workspace.write_parquet_from_arrow(
        table=arrow_table, table_name=table_name, loader_metadata=loader_metadata,
    )

    # ---- 新增：拉取并写入元数据 ----
    try:
        table_desc = self.fetch_table_description(source_table)
        col_descs = self.fetch_column_descriptions(source_table)

        if table_desc or col_descs:
            from data_formulator.datalake.metadata import ColumnInfo, update_metadata

            def _enrich(meta):
                tbl = meta.get_table(table_name)
                if tbl is None:
                    return
                if table_desc:
                    tbl.description = table_desc
                if col_descs and tbl.columns:
                    for col in tbl.columns:
                        desc = col_descs.get(col.name)
                        if desc:
                            col.description = desc

            update_metadata(workspace._workspace_path, _enrich)
            logger.info("Enriched metadata for '%s': table_desc=%s, col_descs=%d",
                         table_name, bool(table_desc), len(col_descs))
    except Exception as e:
        logger.warning("Failed to fetch metadata for '%s': %s (data is still saved)", 
                        source_table, e)
    # ---- 元数据增强结束，失败不影响数据写入 ----

    return table_metadata
```

**关键设计决策**：元数据拉取在数据写入**之后**，用 try/except 包裹。即使元数据查询失败（权限不足、数据库不支持等），数据本身已经安全写入 workspace。

### 2.4 `list_tables()` 返回值增强

同时在 `list_tables()` 中也返回注释信息，让前端在浏览数据库表时就能看到描述：

```python
# postgresql_data_loader.py — list_tables 增强

def _list_tables(self, table_filter=None):
    # ... 现有的 tables 查询 ...
    
    for _, row in tables_df.iterrows():
        schema = row['schemaname']
        table_name = row['tablename']
        full_table_name = f"{schema}.{table_name}"

        # 列信息（现有）+ 列注释（新增）
        columns_query = f"""
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
        columns_df = self._read_sql(columns_query).to_pandas()
        columns = [{
            'name': r['column_name'],
            'type': r['data_type'],
            'description': r['column_comment'] or None,  # ← 新增
        } for _, r in columns_df.iterrows()]

        # 表注释（新增）
        table_comment = self.fetch_table_description(full_table_name)

        table_metadata = {
            "row_count": int(row_count),
            "columns": columns,
            "sample_rows": sample_rows,
            "description": table_comment,  # ← 新增
        }
        results.append({"name": full_table_name, "metadata": table_metadata})
```

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
| `external_data_loader.py` | 新增 `fetch_table_description()`、`fetch_column_descriptions()` 默认实现；`ingest_to_workspace()` 增加元数据写入 | ~30 行 |
| `postgresql_data_loader.py` | 实现两个描述方法 + `list_tables()` 查询增强 | ~25 行 |
| `mssql_data_loader.py` | 实现两个描述方法 + `list_tables()` 查询增强 | ~30 行 |
| `bigquery_data_loader.py` | 实现两个描述方法（各 3 行）+ `list_tables()` 取 description | ~10 行 |
| `mysql_data_loader.py` | 实现两个描述方法 + `list_tables()` 取 `COLUMN_COMMENT` | ~20 行 |
| `kusto_data_loader.py` | 实现两个描述方法（从 schema JSON 取 DocString） | ~15 行 |
| `metadata.py` | `ColumnInfo` 增加 `description` 字段；`TableMetadata` 增加 `description` 字段 | ~15 行 |
| **前端 `DBManagerPane`** | columns 列表显示 description tooltip | ~10 行 |
| **总计** | | **~155 行** |

---

## 3. 改进方案二：SSO Token 透传到数据库 (P1)

**目标**：当 DF 用户通过 OIDC SSO 登录后，如果目标数据库也信任同一 IdP，DataLoader 自动使用 SSO token 连接数据库，用户无需输入数据库密码。

**前置条件**：SSO AuthProvider 链已上线（`sso-plugin-architecture.md` Phase 1）。

### 3.1 基类增加认证能力声明

```python
# external_data_loader.py — 新增

class ExternalDataLoader(ABC):
    # ... 现有方法 ...

    @staticmethod
    def supported_auth_methods() -> list[dict]:
        """声明该 loader 支持哪些认证方式。
        
        框架据此在前端渲染不同的认证 UI（密码表单 vs SSO 按钮等）。
        """
        return [
            {"method": "credentials", "label": "Username & Password", "default": True},
        ]
```

各 DataLoader 按实际能力 override：

```python
# mssql_data_loader.py
@staticmethod
def supported_auth_methods():
    return [
        {"method": "credentials", "label": "SQL Server Authentication"},
        {"method": "windows_auth", "label": "Windows Integrated Authentication"},
        {"method": "azure_ad_token", "label": "Azure AD (SSO)", 
         "requires_sso": True, "token_audience": "https://database.windows.net/"},
    ]

# postgresql_data_loader.py
@staticmethod
def supported_auth_methods():
    return [
        {"method": "credentials", "label": "Username & Password", "default": True},
        {"method": "azure_ad_token", "label": "Azure AD (SSO)",
         "requires_sso": True, "token_audience": "https://ossrdbms-aad.database.windows.net"},
        {"method": "aws_iam_token", "label": "AWS IAM",
         "requires_env": ["AWS_REGION"]},
    ]

# bigquery_data_loader.py
@staticmethod
def supported_auth_methods():
    return [
        {"method": "service_account", "label": "Service Account JSON", "default": True},
        {"method": "cli", "label": "gcloud CLI (local dev)"},
        {"method": "oidc_federation", "label": "OIDC Federation (SSO)",
         "requires_sso": True},
    ]
```

### 3.2 Token 注入流程

```
用户通过 OIDC SSO 登录 DF
  → 获得 access_token（存在 AuthResult 中）
  → 用户打开数据库连接面板
  
前端渲染:
  GET /api/data-loader/postgresql/auth-methods
  → 返回 supported_auth_methods()
  → 发现有 "azure_ad_token"，且 requires_sso=true
  → DF 当前有 SSO 登录 → 显示「使用 SSO 连接」按钮
  
用户点击「使用 SSO 连接」:
  → 前端带上 auth_method: "azure_ad_token"
  → 后端从 auth.get_sso_token() 拿到 access_token
  → 如果 token_audience 不同，用 token exchange 获取目标 audience 的 token
  → 将 token 注入 DataLoader 的 params
  → DataLoader 用 token 连接数据库
```

### 3.3 各数据库的 Token 认证实现

**Azure SQL / MSSQL**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "credentials")

    if auth_method == "azure_ad_token":
        token = params["access_token"]
        conn_str = f"DRIVER={{{self.driver}}};SERVER={self.server},{self.port};DATABASE={self.database};"
        
        SQL_COPT_SS_ACCESS_TOKEN = 1256
        token_struct = struct.pack(
            f'<I{len(token)*2}s', len(token)*2, token.encode('utf-16-le')
        )
        self._conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct})
    else:
        # 现有逻辑不变
        ...
```

**Azure PostgreSQL**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "credentials")

    if auth_method == "azure_ad_token":
        token = params["access_token"]
        self._conn = psycopg2.connect(
            host=self.host, port=int(self.port),
            user=params.get("user", ""),
            password=token,
            dbname=self.database,
            sslmode="require",
        )
    else:
        # 现有逻辑不变
        ...
```

**BigQuery OIDC 联邦身份**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "service_account")

    if auth_method == "oidc_federation":
        from google.auth import identity_pool
        token = params["access_token"]
        credentials = identity_pool.Credentials(
            audience=f"//iam.googleapis.com/projects/{self.project_id}/locations/global/workloadIdentityPools/{pool_id}/providers/{provider_id}",
            subject_token_type="urn:ietf:params:oauth:token-type:jwt",
            token_url="https://sts.googleapis.com/v1/token",
            subject_token=token,
        )
        self.client = bigquery.Client(project=self.project_id, credentials=credentials)
    else:
        # 现有逻辑不变
        ...
```

**Kusto (Azure Data Explorer)**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "app_key")

    if auth_method == "azure_ad_token":
        token = params["access_token"]
        kcsb = KustoConnectionStringBuilder.with_aad_user_token_authentication(
            self.kusto_cluster, token
        )
        self.client = KustoClient(kcsb)
    else:
        # 现有逻辑不变
        ...
```

### 3.4 前端认证 UI 适配

```typescript
// DBManagerPane.tsx — 连接表单根据 auth_methods 动态渲染

const authMethods = loaderConfig.auth_methods;
const hasSsoOption = authMethods.some(m => m.requires_sso);
const isSsoLoggedIn = !!serverConfig.auth_user;

{authMethods.length > 1 && (
  <RadioGroup value={selectedAuthMethod} onChange={setSelectedAuthMethod}>
    {authMethods.map(m => (
      <FormControlLabel
        key={m.method}
        value={m.method}
        label={m.label}
        disabled={m.requires_sso && !isSsoLoggedIn}
        control={<Radio />}
      />
    ))}
  </RadioGroup>
)}

{selectedAuthMethod === "credentials" && (
  <>
    <TextField label={t('db.username')} ... />
    <TextField label={t('db.password')} type="password" ... />
  </>
)}
{selectedAuthMethod === "azure_ad_token" && (
  <Alert severity="info">
    {t('db.ssoConnectInfo', { user: serverConfig.auth_user })}
  </Alert>
)}
```

### 3.5 改动文件清单

| 文件 | 改动 | 行数估计 |
|------|------|:---:|
| `external_data_loader.py` | 新增 `supported_auth_methods()` 默认实现 | ~10 行 |
| `mssql_data_loader.py` | override `supported_auth_methods()`；`__init__` 增加 `azure_ad_token` 分支 | ~25 行 |
| `postgresql_data_loader.py` | 同上 | ~20 行 |
| `bigquery_data_loader.py` | 同上（OIDC federation） | ~20 行 |
| `kusto_data_loader.py` | 同上（`with_aad_user_token_authentication`） | ~15 行 |
| `tables_routes.py` | 新增 `/api/data-loader/{type}/auth-methods` 路由 | ~15 行 |
| **前端** `DBManagerPane.tsx` | 动态渲染认证方式选择 UI | ~40 行 |
| **总计** | | **~145 行** |

---

## 4. 改进方案三：凭证持久化 (P2)

**目标**：用户连接数据库后，可以选择"记住连接"，凭证加密存入 CredentialVault，下次打开 DF 无需重新输入。

**前置条件**：CredentialVault 已上线（`sso-plugin-architecture.md` Layer 3）。

### 4.1 用户体验流程

```
首次连接:
  用户填写 host/port/user/password → 连接成功
  → 弹出「保存此连接？」提示
  → 用户确认 → 凭证加密存入 CredentialVault
     键: credential:dataloader:postgresql:{user_id}:{host}:{database}
     值: AES 加密的 {"user": "...", "password": "...", "host": "...", ...}

再次打开 DF:
  → 前端请求 GET /api/data-loader/saved-connections
  → 返回已保存的连接列表（不含明文密码，只有名称和类型）
  → 用户点击已保存的连接 → 一键连接
  → 后端从 CredentialVault 解密取出凭证 → 创建 DataLoader

管理:
  → 用户可以查看、删除已保存的连接
  → 删除操作同时清除 CredentialVault 中的加密凭证
```

### 4.2 后端 API

```python
# tables_routes.py — 新增路由

@tables_bp.route('/data-loader/saved-connections', methods=['GET'])
def list_saved_connections():
    """列出当前用户保存的数据库连接（不含明文密码）。"""
    user_id = get_identity_id()
    vault = get_credential_vault()
    connections = vault.list_credentials(user_id, prefix="dataloader:")
    return jsonify([{
        "id": conn.credential_id,
        "loader_type": conn.metadata.get("loader_type"),
        "display_name": conn.metadata.get("display_name"),
        "host": conn.metadata.get("host"),
        "database": conn.metadata.get("database"),
        "saved_at": conn.metadata.get("saved_at"),
    } for conn in connections])

@tables_bp.route('/data-loader/saved-connections', methods=['POST'])
def save_connection():
    """保存一个数据库连接（凭证加密存储）。"""
    data = request.get_json()
    user_id = get_identity_id()
    vault = get_credential_vault()
    
    loader_type = data["loader_type"]
    params = data["params"]
    display_name = data.get("display_name", f"{loader_type}:{params.get('host','')}/{params.get('database','')}")
    
    credential_id = f"dataloader:{loader_type}:{params.get('host','')}:{params.get('database','')}"
    
    vault.store_credential(
        user_id=user_id,
        credential_id=credential_id,
        secret_data=params,
        metadata={
            "loader_type": loader_type,
            "display_name": display_name,
            "host": params.get("host"),
            "database": params.get("database"),
            "saved_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return jsonify({"status": "ok", "credential_id": credential_id})

@tables_bp.route('/data-loader/saved-connections/<credential_id>/connect', methods=['POST'])
def connect_saved():
    """使用已保存的凭证连接数据库。"""
    user_id = get_identity_id()
    vault = get_credential_vault()
    
    cred = vault.get_credential(user_id, credential_id)
    if cred is None:
        return jsonify({"status": "error", "message": "Connection not found"}), 404
    
    loader_type = cred.metadata["loader_type"]
    params = cred.secret_data  # 自动解密
    
    loader_cls = DATA_LOADERS.get(loader_type)
    loader = loader_cls(params)
    # ... 后续逻辑与手动连接相同 ...
```

### 4.3 前端 UI

```
┌─────────────────────────────────────────────────────┐
│  数据库连接                                           │
│                                                       │
│  ┌─── 已保存的连接 ─────────────────────────────────┐ │
│  │  🔗 生产 PostgreSQL (pg.company.com/analytics)    │ │
│  │     上次连接: 2025-03-20   [ 连接 ] [ 🗑 删除 ]   │ │
│  │                                                   │ │
│  │  🔗 测试 MSSQL (sql-test/reporting)               │ │
│  │     上次连接: 2025-03-18   [ 连接 ] [ 🗑 删除 ]   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─── 新建连接 ─────────────────────────────────────┐ │
│  │  类型: [PostgreSQL ▾]                             │ │
│  │  认证: ● 用户名密码  ○ SSO (Azure AD)             │ │
│  │  Host: [________________]                         │ │
│  │  ...                                              │ │
│  │  ☑ 记住此连接                                     │ │
│  │                                                   │ │
│  │  [ 连接 ]                                         │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 4.4 安全性

| 措施 | 说明 |
|------|------|
| **加密存储** | 密码等敏感字段通过 CredentialVault 使用 Fernet (AES-128-CBC) 加密 |
| **per-user 隔离** | 每个用户只能访问自己保存的连接（通过 `user_id` 隔离） |
| **不回显密码** | `list_saved_connections` 只返回元数据，不返回明文密码 |
| **手动删除** | 用户随时可以删除已保存的连接和对应的加密凭证 |
| **SSO 优先** | 如果数据库支持 SSO 且 DF 已 SSO 登录，优先推荐 SSO（无需存密码） |

---

## 关联文档

| 文档 | 关系 |
|------|------|
| `1-data-source-plugin-architecture.md` § 11.1~11.2 | ExternalDataLoader vs DataSourcePlugin 的分工定义 |
| `1-sso-plugin-architecture.md` | SSO AuthProvider（P1 前置）、CredentialVault（P2 前置） |
