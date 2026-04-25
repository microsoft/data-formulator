# DataConnector API 与连接实例规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-26
> **适用范围**: `py-src/data_formulator/data_connector.py`、前端连接器调用、数据源实例配置

---

## 1. 定位

`DataConnector` 是外部数据源的统一生命周期层。它把 `ExternalDataLoader`
包装成可连接、可浏览、可预览、可导入、可刷新的连接实例。

当前架构不再为每个连接动态注册 Flask Blueprint。所有连接器 API 都挂在一个
共享 `connectors_bp` 上，通过请求体中的 `connector_id` 分发到具体实例。

职责边界：

- `ExternalDataLoader` 是具体数据源要实现的适配器接口。
- `DataConnector` 是框架提供的连接实例管理层，一般不由具体数据源继承。
- `DataConnector.from_loader(...)` 会把 loader class 包装成运行时 connector instance。
- 新增数据源时，优先扩展 loader 能力，不要为每个数据源新增专有 Flask route。

终端用户和部署方的扩展路径分两层：

- 如果报表系统、数据库或文件系统已有 loader type，用户只需要在 UI/API 中创建
  connector instance，填写 URL、token、账号等参数。
- 如果是全新的数据源类型，管理员可以实现一个 `ExternalDataLoader` 子类，并通过
  内置注册或 `DF_PLUGIN_DIR` 外部 loader 机制加入 `DATA_LOADERS`。之后用户仍然通过
  同一套 connector UI/API 创建和使用连接。

---

## 2. 核心概念

| 概念 | 说明 |
|------|------|
| Loader type | `DATA_LOADERS` 中的注册 key，如 `postgresql`、`mysql`、`superset` |
| Connector instance | 一个具体连接实例，如 `postgresql:analytics` |
| Admin connector | 管理员通过 `DATA_FORMULATOR_HOME/connectors.yaml` 或 `DF_SOURCES__*` 配置的全局连接 |
| User connector | 用户通过 `POST /api/connectors` 创建的个人连接 |
| Live loader | 当前 identity 下已连接的 `ExternalDataLoader` 实例，保存在内存中 |
| Credential vault | 按 `identity + connector_id` 加密保存密码、token 等敏感凭证 |
| External loader plugin | `DF_PLUGIN_DIR` 中的 `*_data_loader.py` 文件，用于不改源码注册新的 loader type |

一个用户可以创建多个同类型连接，例如 `mysql:prod` 和 `mysql:staging`。前端和 API
都以 connector instance 为单位工作，不再以 loader type 为单位存储连接状态。

---

## 3. 配置来源

运行时连接实例由三层配置合并而来：

```text
DATA_FORMULATOR_HOME/connectors.yaml        # admin，全局只读
DF_SOURCES__*                               # admin，环境变量覆盖/补充
DATA_FORMULATOR_HOME/users/<identity>/connectors.yaml  # user，可由用户 CRUD
```

敏感凭证不写入 `connectors.yaml`。用户名、密码、token、access key、connection
string 等只在连接时使用，并按 `identity + connector_id` 写入 vault。

注意：这些配置只创建 connector instance，不定义新的 loader type。新的 loader type
来自内置 `DATA_LOADERS` 注册表，或来自 `DF_PLUGIN_DIR` 扫描到的外部
`ExternalDataLoader` 子类。

`GET /api/connectors` 返回合并后的可见连接列表，并用字段区分来源：

```json
{
  "id": "postgresql:analytics",
  "source": "user",
  "deletable": true,
  "display_name": "PostgreSQL · analytics",
  "connected": true
}
```

Admin connector 对用户可见但不可删除，`deletable` 为 `false`。

---

## 4. `connectors.yaml`

Admin connector 和 user connector 使用同一种 YAML 结构：

```yaml
connectors:
  - id: postgresql_prod
    type: postgresql
    name: "PostgreSQL · prod"
    icon: postgresql
    params:
      host: db.example.com
      port: "5432"
      database: analytics
```

字段说明：

| 字段 | 说明 |
|------|------|
| `id` | connector instance ID。省略时用 loader type 派生，不建议省略 |
| `type` | `DATA_LOADERS` 注册 key，如 `postgresql`、`mysql`、`superset` |
| `name` | 前端显示名称 |
| `icon` | 可选，前端图标 key |
| `params` | 非敏感默认参数或 pinned 参数 |
| `auto_connect` | admin 配置可用；用于启动时自动建立连接的场景 |

`params` 支持 `${ENV_VAR}` 引用：

```yaml
connectors:
  - id: superset_prod
    type: superset
    name: "Superset · prod"
    params:
      url: ${SUPERSET_URL}
```

不要在 user connector 的 `params` 中写入密码、token、access key、connection string
等敏感字段。创建用户连接时，后端会根据 loader 的参数定义过滤敏感字段，只把安全参数写入
`users/<identity>/connectors.yaml`。

---

## 5. `DF_SOURCES__*` 环境变量

管理员也可以通过环境变量创建全局连接。格式为：

```text
DF_SOURCES__<connector_id>__type=<loader_type>
DF_SOURCES__<connector_id>__name=<display_name>
DF_SOURCES__<connector_id>__icon=<icon>
DF_SOURCES__<connector_id>__params__<param_name>=<value>
```

示例：

```bash
DF_SOURCES__pg_prod__type=postgresql
DF_SOURCES__pg_prod__name="PostgreSQL · prod"
DF_SOURCES__pg_prod__params__host=db.example.com
DF_SOURCES__pg_prod__params__database=analytics
```

环境变量优先级高于 `DATA_FORMULATOR_HOME/connectors.yaml`。如果两者使用相同
`connector_id`，环境变量定义会覆盖 YAML 中的同名 admin connector。

兼容快捷方式：设置 `PLG_SUPERSET_URL` 时，如果没有显式配置 `superset` connector，
系统会自动注册一个 Superset admin connector。

---

## 6. Identity 与可见性隔离

User connector 在内存中使用 identity-scoped key 保存，避免不同用户的同名连接互相覆盖。
前端仍只看到公开 `connector_id`。

```text
Alice public id: postgresql:local
Alice registry key: user:alice::postgresql:local

Bob public id: postgresql:local
Bob registry key: user:bob::postgresql:local
```

解析规则：

- admin connector ID 全局唯一，并优先于 user connector。
- user connector 只对当前 identity 可见。
- `_resolve_connector(data)` 会根据当前 identity 解析公开 `connector_id` 到内部 registry key。
- 新 route 禁止直接读取 `DATA_CONNECTORS[connector_id]`，必须走 `_resolve_connector(data)`。

Vault 凭证同样按 `identity + connector_id` 隔离。两个用户连接同一个 admin connector 时，
可以拥有不同凭证和不同 live loader。

---

## 7. Discovery 与 CRUD API

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/data-loaders` | 返回可创建的 loader type、参数表单、层级信息、认证说明 |
| GET | `/api/connectors` | 返回当前 identity 可见的连接实例及状态 |
| POST | `/api/connectors` | 创建用户连接实例，并在提供参数时自动连接 |
| DELETE | `/api/connectors/{id}` | 删除用户连接实例，清除内存 loader、用户配置和 vault 凭证 |

`/api/data-loaders` 是创建连接表单的 discovery 入口。`local_folder` 有独立入口，
不会出现在 Add Connection 列表中。

Loader type discovery 来自 `DATA_LOADERS`：

- 内置 loader 在 `data_loader/__init__.py` 的 `_LOADER_SPECS` 中注册。
- 外部 loader 从 `DF_PLUGIN_DIR` 扫描，默认目录为 `~/.data-formulator/plugins/`。
- 文件名必须匹配 `*_data_loader.py`，例如 `my_report_data_loader.py` 会注册为
  `my_report`。
- 文件中需要定义公开的 `ExternalDataLoader` 子类；如果 key 与内置 loader 相同，
  外部 loader 会覆盖内置实现。

---

## 8. Action API

所有 action route 都是固定路径，`connector_id` 放在 JSON 请求体中：

| 方法 | 路径 | 请求要点 |
|------|------|----------|
| POST | `/api/connectors/connect` | `{connector_id, params?, mode?, persist?}` |
| POST | `/api/connectors/disconnect` | `{connector_id}` |
| POST | `/api/connectors/get-status` | `{connector_id}`，无自动重连副作用 |
| POST | `/api/connectors/get-catalog` | `{connector_id, path?, filter?, limit?, offset?}` |
| POST | `/api/connectors/get-catalog-tree` | `{connector_id, filter?}` |
| POST | `/api/connectors/search-catalog` | `{connector_id, query, limit?}` |
| POST | `/api/connectors/preview-data` | `{connector_id, source_table, import_options?}` |
| POST | `/api/connectors/import-data` | `{connector_id, source_table, table_name?, import_options?}` |
| POST | `/api/connectors/import-group` | `{connector_id, tables, row_limit?, source_filters?, group_name?}` |
| POST | `/api/connectors/refresh-data` | `{connector_id, table_name}` |
| POST | `/api/connectors/column-values` | `{connector_id, source_table, column_name, keyword?, limit?, offset?}` |

不要新增 `/api/connectors/{id}/...` 风格的 per-instance route。Flask blueprint
不能在首个请求后动态注册，固定 action route 能避免 ghost endpoint 和动态注册问题。

---

## 9. 连接与认证

`connect` 支持两类模式：

```json
{
  "connector_id": "mysql:prod",
  "params": {"host": "db.example.com", "database": "sales"},
  "persist": true
}
```

```json
{
  "connector_id": "superset:prod",
  "mode": "token",
  "access_token": "...",
  "refresh_token": "...",
  "params": {"url": "https://superset.example.com"},
  "persist": true
}
```

`DataConnector` 会把用户参数与 pinned/default params 合并，创建 loader，调用
`test_connection()`，然后按 `persist` 决定是否保存凭证。

`DataConnector` / `TokenStore` 提供的是通用凭证解析和 token 注入框架，不代表所有
数据库 loader 已经支持用户级 SSO token。只有 loader 声明了非默认 `auth_config()`，
并在 `__init__` 中把 `access_token` / `sso_access_token` 接入目标 SDK 或连接字符串时，
该数据源才真正具备 SSO/token 认证能力。内置数据库 loader 的当前认证落地状态见
`design-docs/2-external-dataloader-enhancements.md` 的“缺陷二：认证方式单一，
缺少 SSO/集成认证”。

认证相关细节见 `dev-guides/4-authentication-oidc-tokenstore.md`。

---

## 10. Catalog 与数据加载

推荐前端使用 `/api/connectors/get-catalog` 做懒加载浏览。它只返回当前层级：

```json
{
  "connector_id": "postgresql:analytics",
  "path": ["warehouse", "public"],
  "filter": "orders",
  "limit": 200,
  "offset": 0
}
```

返回体包含 `nodes`、`has_more`、`next_offset`。大目录 loader 应在 `ls()` 中实现
源端分页；框架只为不支持分页的 loader 做内存切片兜底。

导入和刷新统一通过 workspace parquet 元数据记录源信息：

- `import-data` 调用 `loader.ingest_to_workspace(...)`
- `refresh-data` 使用表元数据中的 `source_table` 和 `import_options` 重新拉取
- `preview-data` 调用 `fetch_data_as_arrow(...)`，并尽量用 `get_column_types()` 补充源类型

---

## 11. table_group

BI 类 loader 可以返回 `node_type="table_group"`，表示一个可批量导入的数据包，例如
Superset dashboard。成员表放在节点 `metadata["tables"]` 中。

`import-group` 会遍历请求中的 `tables`，为每个成员表单独写入 workspace。若传入
`source_filters`，只把 `applies_to` 命中的筛选条件传给对应成员表。

---

## 12. Disconnect vs Delete

| 操作 | 内存 loader | 用户配置 | Vault 凭证 | 卡片是否保留 |
|------|-------------|----------|------------|--------------|
| Disconnect | 清除 | 保留 | 清除当前服务 token/凭证 | 保留，可重新连接 |
| Delete | 清除 | 删除 | 删除 | 不保留 |

当前实现中 `disconnect` 会调用 connector 的 vault/token 清理逻辑。用户连接定义仍保留，
因此卡片继续显示；admin connector 不能 delete。

---

## 13. 开发注意事项

- 新增数据源时实现 `ExternalDataLoader`，不要继承 `DataConnector`。
- `DataConnector` 负责 connect、catalog、preview、import、refresh、credential vault
  等生命周期；具体数据源只暴露 loader 能力。
- 新 route 必须通过 `_resolve_connector(data)` 解析连接，不能直接信任客户端传入的 `connector_id`。
- 新 route 若访问 live loader，应使用 `_require_loader()`，让未连接状态统一报错。
- `get-status` 必须保持无副作用，不要在状态查询中自动创建 loader 或写 vault。
- 返回给前端的 params 必须来自 `get_safe_params()` 或 `params_form`，不能泄露敏感字段。
- 对大目录数据源优先实现 `ls(..., limit, offset)` 和 `search_catalog()`，避免展开 catalog 时全量扫描。
- 数据导入必须走 `ingest_to_workspace()`，不要绕过 workspace 的表名清洗和元数据记录。

---

## 14. 相关文档

- `dev-guides/3-data-loader-development.md`
- `dev-guides/4-authentication-oidc-tokenstore.md`
- `docs-cn/1-data-source-connections.md`
- `docs-cn/6-credential-vault.md`
- `docs-cn/7-server-migration-guide.md`
