# 12. 统一认证与凭证管理架构（归档索引）

> 状态：阶段 1-3 已实施；阶段 4 文档迁移已完成主体瘦身。  
> 创建日期：2026-04-23  
> 最近核对：2026-04-28  
> 关联：`9-generalized-data-source-plugins.md`、`11-auth-architecture-frontend-vs-backend.md`  
> 取代：`docs-cn/5-datasource_plugin-development-guide.md`（已过时）

本文曾作为统一认证、凭证管理、DataConnector、Loader 扩展、目录懒加载和导入筛选的融合设计文档。当前主体实现已经落地，开发者规范已迁移到 `dev-guides/` 和 `docs-cn/`。本文不再作为具体 API 或代码实现的权威来源，只保留历史决策、实现状态索引和未实现项。

---

## 1. 当前权威文档

| 主题 | 权威文档 |
|------|----------|
| OIDC、`AUTH_MODE`、TokenStore、后端 Confidential Client | `dev-guides/4-authentication-oidc-tokenstore.md` |
| DataConnector API、连接实例、action routes、identity/vault 边界 | `dev-guides/5-data-connector-api.md` |
| `ExternalDataLoader`、`auth_config()`、catalog、source filters、外部 loader 插件 | `dev-guides/3-data-loader-development.md` |
| 日志脱敏、token/secret 日志规范 | `dev-guides/2-log-sanitization.md` |
| API 错误契约、前端错误消费、OIDC redirect 错误边界 | `dev-guides/7-unified-error-handling.md` |
| 路径安全、文件访问、Loader 读取宿主文件限制 | `dev-guides/8-path-safety.md` |
| Credential Vault 用户/运维说明 | `docs-cn/6-credential-vault.md` |
| Superset SSO / delegated popup 用户配置 | `docs-cn/5.1-superset-sso-oauth-config-guide.md` |
| 数据源连接用户流程 | `docs-cn/1-data-source-connections.md` |

---

## 2. 已落地实现索引

### 2.1 OIDC + TokenStore

已实现内容：

- `OIDC_CLIENT_SECRET` 存在时默认启用 backend OIDC；`AUTH_MODE=frontend|backend` 可覆盖。
- Frontend/Public Client 模式继续使用浏览器 Bearer token。
- Backend/Confidential Client 模式使用 Flask Session 保存 SSO token，前端只持有 session cookie。
- `/auth/callback` 同时服务 frontend PKCE 和 backend OIDC，SSO 侧只需注册一个 redirect URI。
- `/api/auth/tokens/save` 接收 delegated popup 得到的 service token。
- `/api/auth/service-status` 返回各服务授权状态。

关键代码：

- `py-src/data_formulator/auth/providers/oidc.py`
- `py-src/data_formulator/auth/gateways/oidc_gateway.py`
- `py-src/data_formulator/auth/token_store.py`
- `py-src/data_formulator/app.py`

测试覆盖：

- `tests/backend/auth/test_token_store.py`
- `tests/backend/auth/test_oidc_gateway.py`
- `tests/backend/auth/test_oidc_provider.py`
- `tests/backend/auth/test_auth_info_endpoint.py`

实现差异记录：

- 前端 auth info 的真实字段是 `action: "backend"`，不是早期草案中的 `backend_redirect`。
- `TokenStore.get_access(system_id)` 只返回 `str | dict | None`；`requires_user_action` 和 `available_strategies` 由 `get_auth_status()` 提供。
- OIDC logout 调用 `clear_session_tokens()`，只清当前 session 中的 SSO/service token，不删除 vault 中按 identity 隔离保存的凭据。
- `clear_service_token(system_id)` 用于明确断开某个 service，会清 service token 与 vault 凭据；`sso_exchange` 服务还会在当前 session 中记录 `sso_disconnected_services`，避免自动换票立即重连。

### 2.2 DataConnector 与 Credential Vault

已实现内容：

- `DataConnector` 是连接实例生命周期层，具体数据源只实现 `ExternalDataLoader`。
- 所有 connector action route 使用固定 `/api/connectors/...` 路径，`connector_id` 放在请求体中。
- User connector 按当前 identity 隔离；前端仍使用公开 `connector_id`。
- Vault 凭据按 `identity + connector_id` 隔离，敏感字段不写入 `connectors.yaml`，也不返回给前端。
- `DataConnector._inject_credentials()` 对非默认认证模式调用 `TokenStore.get_access()`，并把返回 token 或 dict 注入 loader 参数。
- Connector disconnect 保留连接卡片，但清 in-memory loader、vault 凭据和 service token；delete 删除连接定义和凭据。

关键代码：

- `py-src/data_formulator/data_connector.py`
- `py-src/data_formulator/auth/vault/`
- `py-src/data_formulator/routes/credentials.py`

测试覆盖：

- `tests/backend/data/test_data_connector_framework.py`
- `tests/backend/data/test_data_connector_vault.py`
- `tests/backend/routes/test_credential_routes.py`
- `tests/backend/auth/test_credential_vault.py`
- `tests/backend/auth/test_credential_vault_factory.py`

实现差异记录：

- TokenStore 内部 `_try_vault()` 只负责 retrieve；凭据是否可用由 DataConnector 创建 loader 后通过 `test_connection()` 或连接流程验证。
- 早期草案中的显式 `vault_stale` 状态没有作为独立状态机落地；当前失败路径更接近清理陈旧 vault 凭据后要求用户重新连接。

### 2.3 Loader 扩展、外部插件与认证声明

已实现内容：

- `ExternalDataLoader.auth_config()` 声明 `credentials`、`connection`、`sso_exchange`、`delegated`、`oauth2` 等认证模式。
- `auth_mode()` 作为旧接口保留，新 loader 应优先实现 `auth_config()`。
- `delegated_login_config()` 声明 popup 登录入口。
- 外部 loader 插件通过 `DF_PLUGIN_DIR` 扫描，文件名必须匹配 `*_data_loader.py`。
- 外部插件 key 与内置 key 冲突时，外部插件覆盖内置实现。
- 内置 loader 仍通过 `data_loader/__init__.py` 中 `_LOADER_SPECS` 显式注册。

关键代码：

- `py-src/data_formulator/data_loader/__init__.py`
- `py-src/data_formulator/data_loader/external_data_loader.py`
- `py-src/data_formulator/data_loader/superset_data_loader.py`

实现差异记录：

- 早期草案中的“包内 loader 自动发现、核心代码零修改”未按原方案落地。当前真实规则是：内置 loader 修改 `_LOADER_SPECS`；外部插件使用 `DF_PLUGIN_DIR` 零源码修改接入。

### 2.4 Catalog、source filters 与前端数据源 UI

已实现内容：

- 推荐使用 `/api/connectors/get-catalog` 做懒加载目录浏览。
- `path=[]` 返回当前 connector 的根层级；展开节点时传入节点 path。
- 请求支持 `filter`、`limit`、`offset`；大目录 loader 应在 `ls()` 中实现源端分页。
- 当请求 path 非空时，`get-catalog` 会 best-effort 返回当前节点 `metadata`。
- `/api/connectors/search-catalog` 用于跨层级搜索。
- `/api/connectors/column-values` 支持智能筛选的列值枚举。
- `source_filters` 通过 `import_options.source_filters` 传给 loader；`import-group` 会按 `applies_to` 分发给对应成员表。
- `VirtualizedCatalogTree` 已用于大 catalog 树渲染。

关键代码：

- `py-src/data_formulator/data_connector.py`
- `src/components/VirtualizedCatalogTree.tsx`
- `src/views/DataSourceSidebar.tsx`
- `src/views/DBTableManager.tsx`
- `src/components/ConnectorTablePreview.tsx`

实现差异记录：

- 早期草案中的 `/api/connectors/get-node-detail` 路由未落地；实际实现用 `/api/connectors/get-catalog` 的非空 path metadata 覆盖该需求。
- 独立 `FilterBuilder` 组件草图未按原形态落地；当前实现侧重 source filters、预览筛选和导入参数传递。
- `get-catalog-tree` 后端保留，但前端主路径以 `get-catalog` 懒加载为准。

---

## 3. 未实现或未来项

以下内容仍是设计参考或 backlog，不应迁入开发者规范作为已支持能力：

- Metabase、Power BI、Grafana 等未来系统的 `auth_config()` 示例。
- 更完整的 Agent 自动授权 UX。
- 跨系统 token exchange 策略。
- TokenStore 存储后端迁移到 Redis。
- 包内 loader 自动发现。
- 独立 `/api/connectors/get-node-detail` 路由。
- 独立 `FilterBuilder` 组件形态。

如果后续决定实现这些能力，应新建独立设计或 issue，并在实现完成后再同步到对应 `dev-guides/`。

---

## 4. 历史决策记录

| 决策 | 当前状态 | 说明 |
|------|----------|------|
| TokenStore 取代 PluginAuthHandler 的认证职责 | 已采用 | 统一 Agent、DataConnector、路由的凭证入口 |
| `auth_config()` 与 `auth_mode()` 共存 | 已采用 | `auth_config()` 优先，`auth_mode()` 保留兼容 |
| Backend OIDC 与 Frontend PKCE 共存 | 已采用 | 由 `OIDC_CLIENT_SECRET` 和 `AUTH_MODE` 决定 |
| 弹窗 delegated login 作为降级策略 | 已采用 | 前端 postMessage 后调用 `/api/auth/tokens/save` |
| Connector action routes 固定化 | 已采用 | 避免 per-instance Flask Blueprint 动态注册 |
| 外部插件目录 `DF_PLUGIN_DIR` | 已采用 | 外部 loader 可不改源码接入 |
| 内置 loader 包内自动发现 | 未采用 | 当前仍用 `_LOADER_SPECS` 显式注册 |
| Vault 凭据按 identity + connector 隔离 | 已采用 | 敏感凭据不写入 connector config |
| Disconnect 与 Delete 分离 | 已采用 | Disconnect 保留卡片，Delete 删除定义 |
| Superset 目录懒加载 | 已采用 | 以 `ls()`、`get-catalog`、`get_metadata()` 为主 |

---

## 5. 后续处理建议

本文已经完成主体瘦身，后续维护原则：

1. 新开发工作应优先更新 `dev-guides/` 或 `docs-cn/`，不要继续往本文添加实现细节。
2. 本文仅记录历史决策、实现状态索引和未实现项。
3. 当未实现项全部转移到 backlog 或明确弃用后，可以删除本文。
4. 若代码行为与本文不一致，以源码和对应 `dev-guides/` 为准，并同步修正本文的索引描述。
