# SSO + 数据源插件 开发路线图

> **定位**：本文档是开发实施计划，不重复设计细节。每个步骤链接到设计文档的对应章节。
>
> **设计文档**：
> - `1-sso-plugin-architecture.md` — SSO 认证 + 统一架构（以下简称 **SSO 文档**）
> - `1-data-source-plugin-architecture.md` — 数据源插件详细设计（以下简称 **Plugin 文档**）
> - `2-external-dataloader-enhancements.md` — ExternalDataLoader 改进（独立推进，不在本路线图中）

---

## 测试策略

### 工作流：测试先行

每个 Step 遵循 **测试 → 实现 → 通过** 的节奏：

1. 先写测试 — 基于设计文档中的接口契约和预期行为
2. 运行测试 — 确认全部失败（红）
3. 实现功能 — 写到测试通过为止（绿）
4. 重构 — 在测试保护下清理代码

### 测试分层与现有基础设施对齐

项目已有完善的测试体系（见 `tests/test_plan.md`），新增测试沿用现有分层和约定：

| 层级 | 目录 | 运行方式 | 特征 |
|------|------|---------|------|
| 后端单元 | `tests/backend/unit/` | `pytest`（默认运行） | 纯函数、无网络、无 Docker |
| 后端安全 | `tests/backend/security/` | `pytest`（默认运行） | 认证、隔离、防伪造 |
| 后端集成 | `tests/backend/integration/` | `pytest`（默认运行） | Flask test_client、Workspace 交互 |
| 后端契约 | `tests/backend/contract/` | `pytest`（默认运行） | API 边界保证 |
| 前端单元 | `tests/frontend/unit/` | `vitest` | React 组件、工具函数 |

新增标记（追加到 `pytest.ini`）：

```ini
markers =
    ...existing...
    auth: authentication provider tests
    plugin: data source plugin framework tests
    vault: credential vault tests
```

### Mock 设计原则

**只 mock 外部边界，不 mock 自己的代码**：

| 边界 | Mock 方式 | 说明 |
|------|----------|------|
| OIDC IdP（JWKS 端点） | 测试时生成 RSA 密钥对 → 用私钥签 JWT → 用公钥构造 JWKS 响应 | 验证真实的 JWT 验签逻辑，而不是跳过验签 |
| GitHub API | `unittest.mock.patch("requests.get")` | 返回录制的 GitHub `/user` 响应 |
| Superset REST API | `unittest.mock.patch` on `requests.Session` in SupersetClient | 返回录制的 Superset API 响应 fixture |
| Workspace 文件系统 | `tmp_path` fixture（pytest 内置） | 真实 Parquet 读写，但在临时目录 |
| SQLite（Vault） | `tmp_path` 下的临时 DB 文件 | 真实加密/解密，无需 mock |
| 前端 OIDC UserManager | vitest mock module | 模拟登录状态和 token |

**不要 mock 的东西**：
- Workspace 内部逻辑（`write_parquet` / `list_tables`）— 用真实 temp workspace
- Fernet 加密 — 用真实密钥，验证端到端加密/解密
- Flask 路由注册 — 用真实 `app.test_client()`

### Superset API Mock Fixture 设计

Superset 插件的测试需要模拟 Superset REST API 的响应。在 `tests/backend/fixtures/superset/` 下存放录制的 JSON 响应：

```
tests/backend/fixtures/superset/
├── auth_login_200.json          # POST /api/v1/security/login 成功响应
├── auth_login_401.json          # 登录失败响应
├── me_200.json                  # GET /api/v1/me/ 当前用户信息
├── datasets_list_200.json       # GET /api/v1/dataset/ 数据集列表
├── dataset_detail_42.json       # GET /api/v1/dataset/42 单个数据集详情
├── dashboard_list_200.json      # GET /api/v1/dashboard/ 仪表盘列表
├── sqllab_execute_200.json      # POST /api/v1/sqllab/execute/ 查询结果
└── csrf_token_200.json          # GET /api/v1/security/csrf_token/
```

这些 fixture 从真实 Superset 实例录制（`curl` 输出保存），保证字段结构与实际 API 一致。测试中通过 `patch` 注入：

```python
@pytest.fixture
def superset_responses(fixture_dir):
    """加载 Superset API fixture 响应。"""
    def _load(name):
        return json.loads((fixture_dir / "superset" / name).read_text())
    return _load
```

### 什么不测

- **不测 IdP 本身**：Keycloak/Auth0 的行为不是我们的代码，集成测试只验证我们的对接逻辑
- **不测前端 UI 样式**：不做截图对比或像素级验证
- **不测第三方库内部**：不测 PyJWT 能不能解码、Fernet 加不加密——只测我们**调用**这些库的逻辑
- **不重复已有测试**：`test_auth.py` 中已有的 `_validate_identity_value` 测试不重复，只扩展 Provider 链部分

---

## 开发顺序与依据

```
Layer 1: AuthProvider (SSO)       ← 地基，确定"你是谁"
    │
    ├── Layer 3: CredentialVault  ← 依赖身份，按用户存取凭证
    │
    └── Layer 2: DataSourcePlugin ← 依赖 Layer 1 获取 SSO token
                                     依赖 Layer 3 获取已存凭证
```

**先做 SSO，后做插件**。理由：

1. **单向依赖**：插件系统的 SSO 透传、凭证保险箱、Workspace 身份隔离，全部依赖 AuthProvider 提供的用户身份（[SSO 文档 § 2 架构全景](1-sso-plugin-architecture.md#2-架构全景)）
2. **插件不改 auth 代码**：先把认证层稳定下来，后续插件开发只在 `plugins/` 目录内工作，不触碰核心
3. **渐进可验证**：每个 Phase 完成后都有独立可测试的交付物，不需要等到全部完成才能验证

> **注意**：Plugin 框架本身*可以*在无 SSO 时工作（匿名模式），但 SSO 透传是核心价值之一。先做 SSO 避免后期回头改 auth 代码。

---

## Phase 1：认证基础 — AuthProvider 链

> 对应：[SSO 文档 § 3 Layer 1](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider)、[SSO 文档 § 11 Phase 1](1-sso-plugin-architecture.md#11-实施路径)

**目标**：将 `auth.py` 重构为可插拔 Provider，激活 OIDC + GitHub OAuth。

### Step 1.0 先写测试

在写任何实现代码之前，先创建以下测试文件。测试基于设计文档中的接口契约，此时运行应**全部失败**。

#### 后端测试

**`tests/backend/security/test_auth_provider_chain.py`** — Provider 链集成（扩展现有 `test_auth.py` 的思路）

```python
# 要验证的行为（基于 SSO 文档 § 3.1 的优先级链）：
# - AUTH_PROVIDER=oidc 时，合法 JWT → user:sub_claim
# - AUTH_PROVIDER=oidc 时，无 JWT + ALLOW_ANONYMOUS=true → browser:xxx
# - AUTH_PROVIDER=oidc 时，无 JWT + ALLOW_ANONYMOUS=false → 401
# - AUTH_PROVIDER 未设置 → 匿名模式（与现有行为一致）
# - init_auth() 加载指定 Provider，忽略其他
# - get_sso_token() 在 OIDC 认证后返回 access_token
# - get_sso_token() 在匿名模式下返回 None

# mock 策略：用 cryptography 生成 RSA 密钥对，
# 用私钥签发测试 JWT，patch JWKS 端点返回对应公钥。
```

**`tests/backend/unit/test_oidc_provider.py`** — OIDC Provider 单元测试

```python
# 要验证的行为（基于 SSO 文档 § 3.4）：
# - 合法 JWT（正确 issuer + audience + 未过期）→ AuthResult(user_id=sub)
# - 过期 JWT → 抛 AuthenticationError
# - 错误 issuer → 抛 AuthenticationError
# - 错误 audience → 抛 AuthenticationError
# - 签名不匹配（用错误密钥签名）→ 抛 AuthenticationError
# - 请求无 Authorization 头 → 返回 None（此 Provider 不适用）
# - Authorization 头非 Bearer → 返回 None
# - get_auth_info() 返回 {action: "frontend", ...} 包含 OIDC 配置
# - enabled 属性：OIDC_ISSUER_URL 缺失时返回 False

# mock 策略：fixture 中生成 RSA 密钥对，
# 用 PyJWT 签发各种测试 JWT，monkeypatch JWKS HTTP 请求。
```

**`tests/backend/unit/test_github_oauth_provider.py`** — GitHub OAuth Provider

```python
# 要验证的行为（基于 SSO 文档 § 3.5）：
# - Flask session 中有 github_user → AuthResult(user_id=github_login)
# - Flask session 为空 → 返回 None
# - get_auth_info() 返回 {action: "redirect", url: "/api/auth/github/login"}
# - enabled 属性：GITHUB_CLIENT_ID 缺失时返回 False

# mock 策略：Flask test_request_context + session mock，无需真实 GitHub。
```

**`tests/backend/unit/test_azure_easyauth_provider.py`** — Azure EasyAuth Provider（迁移验证）

```python
# 从现有 test_auth.py 中的 Azure 测试用例迁移验证：
# - X-MS-CLIENT-PRINCIPAL-ID 存在 → AuthResult(user_id=principal_id)
# - 头不存在 → 返回 None
# - 确保迁移后行为与原 get_identity_id() 中的 Azure 逻辑一致
```

**`tests/backend/integration/test_auth_info_endpoint.py`** — `/api/auth/info` 端点

```python
# 要验证的行为（基于 SSO 文档 § 3.2 get_auth_info 自描述）：
# - OIDC Provider 激活时，返回 {action: "frontend", authority, client_id, ...}
# - GitHub Provider 激活时，返回 {action: "redirect", url: ...}
# - 匿名模式时，返回 {action: "none"}
# - 前端据此决定登录交互方式

# mock 策略：Flask test_client + 环境变量 patch。
```

#### 前端测试

**`tests/frontend/unit/app/fetchWithIdentity.test.ts`** — Bearer token 附加 + 401 重试

```typescript
// 要验证的行为（基于 SSO 文档 § 3.8b）：
// - 有 OIDC token 时，请求携带 Authorization: Bearer <token>
// - 无 token 时（匿名模式），只携带 X-Identity-Id（现有行为）
// - 收到 401 时，触发 token 刷新后重试一次
// - 重试后仍 401 → 不再重试，返回错误
// - 非 401 错误不触发重试

// mock 策略：vitest mock fetch，模拟各种响应状态码。
```

### Step 1.1 后端 AuthProvider 框架

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| 定义基类 `AuthProvider` + `AuthResult` | `auth_providers/base.py` | [SSO § 3.2](1-sso-plugin-architecture.md#32-authprovider-基类) |
| Provider 自动发现（`pkgutil` 扫描） | `auth_providers/__init__.py` | [SSO § 3.2b](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| 迁移 Azure EasyAuth 为 Provider | `auth_providers/azure_easyauth.py` | [SSO § 3.3](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| 实现 OIDC Provider（JWT 验签） | `auth_providers/oidc.py` | [SSO § 3.4](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| 实现 GitHub OAuth Provider | `auth_providers/github_oauth.py` | [SSO § 3.5](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| GitHub 授权码交换网关 | `auth_gateways/github_gateway.py` | [SSO § 3.5](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| 重构 `auth.py` — `init_auth()` + `get_sso_token()` | `auth.py` 修改 | [SSO § 3.2](1-sso-plugin-architecture.md#32-authprovider-基类) |

**核心逻辑**：`AUTH_PROVIDER` 环境变量选择主 Provider → 匿名回退（`ALLOW_ANONYMOUS=true`）→ `get_identity_id()` 返回值格式不变（`user:xxx` / `browser:xxx`）。

### Step 1.2 前端 OIDC 集成

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| OIDC 配置 + UserManager | `src/app/oidcConfig.ts` | [SSO § 3.6](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| OIDC 回调页面 | `src/app/OidcCallback.tsx` | [SSO § 3.7](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| 统一登录面板（`/api/auth/info` 驱动） | `src/app/LoginPanel.tsx` | [SSO § 3.8](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| `fetchWithIdentity` 携带 Bearer token + 401 重试 | `src/app/utils.tsx` 修改 | [SSO § 3.8b](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |
| `App.tsx` 统一 initAuth | `src/app/App.tsx` 修改 | [SSO § 3.8](1-sso-plugin-architecture.md#3-layer-1可插拔认证体系-authprovider) |

**依赖安装**：`pip install PyJWT cryptography`，`npm install oidc-client-ts`

### Step 1.3 验证

- [ ] 配置 Keycloak → OIDC 登录成功，`get_identity_id()` 返回 `user:sub_claim`
- [ ] 配置 GitHub OAuth → OAuth 登录成功
- [ ] 不配置任何 Provider → 匿名模式，行为与 0.7 现版本一致
- [ ] `get_sso_token()` 返回当前用户的 OIDC access_token

---

## Phase 2：插件框架 + Superset 插件

> 对应：[Plugin 文档 § 5~10](1-data-source-plugin-architecture.md#5-插件架构总体设计)、[SSO 文档 § 4 Layer 2](1-sso-plugin-architecture.md#4-layer-2数据源插件系统-datasourceplugin)、[SSO 文档 § 11 Phase 2](1-sso-plugin-architecture.md#11-实施路径)

**目标**：建立插件框架，将 0.6 Superset 集成迁移为第一个插件。

### Step 2.0 先写测试

#### 2.0.1 插件框架测试（实现 Step 2.1 之前写）

**`tests/backend/unit/test_plugin_discovery.py`** — 插件自动发现

```python
# 要验证的行为（基于 SSO 文档 § 4.4）：
# - plugins/ 下有合法子包（含 plugin_class）→ 被发现并注册
# - plugins/ 下有子包但缺 plugin_class → 跳过，记录警告
# - plugin_class.manifest() 中 required_env 全满足 → 启用
# - required_env 缺一个 → 跳过，记入 DISABLED_PLUGINS
# - PLUGIN_BLOCKLIST 中列出的 plugin_id → 强制跳过
# - 导入异常（如缺依赖）→ 优雅降级，不影响其他插件

# mock 策略：在 tmp_path 下构造包含 __init__.py 的 dummy plugin 包，
# monkeypatch plugins 包的 __path__ 指向 tmp_path。
```

**`tests/backend/unit/test_plugin_data_writer.py`** — PluginDataWriter 写入工具

```python
# 要验证的行为（基于 Plugin 文档 § 6.2）：
# - write_dataframe(df, name, overwrite=True) → 写入 Parquet，返回正确元数据
# - write_dataframe(df, name, overwrite=True) 第二次 → 覆盖同名表
# - write_dataframe(df, name, overwrite=False) 同名已存在 → 自动加后缀 _1
# - write_arrow(arrow_table, name) → 跳过 pandas 转换，直接写入
# - write_batches → append → finish → 合并为一个 Parquet 文件
# - source_metadata 完整写入 loader_metadata
# - 表名 sanitize（特殊字符替换）

# mock 策略：Workspace 使用 tmp_path 下的真实临时目录，验证实际 Parquet 文件。
# 使用 Flask test_request_context 提供 identity（PluginDataWriter 内部调用 get_identity_id）。
```

**`tests/backend/integration/test_plugin_app_config.py`** — `/api/app-config` 插件字段

```python
# 要验证的行为（基于 Plugin 文档 § 8.1）：
# - 有插件启用时，/api/app-config 响应包含 PLUGINS 字段
# - PLUGINS 字段合并了 manifest() 和 get_frontend_config() 的内容
# - 无插件启用时，PLUGINS 为空 dict 或不存在
# - 插件的敏感配置（如 SUPERSET_URL 原始值）不暴露给前端

# mock 策略：注册一个 DummyPlugin 到 ENABLED_PLUGINS，用 Flask test_client 请求。
```

#### 2.0.2 Superset 插件测试（实现 Step 2.2 之前写）

先准备 Superset API 的 fixture 文件（从真实 Superset 录制或按 API 文档构造）：

```
tests/backend/fixtures/superset/
├── auth_login_200.json          # {"access_token": "eyJ...", "refresh_token": "..."}
├── auth_login_401.json          # {"message": "Invalid credentials"}
├── me_200.json                  # {"result": {"username": "alice", ...}}
├── datasets_list_200.json       # {"result": [{"id": 42, "table_name": "sales", ...}]}
├── dataset_detail_42.json       # {"result": {"id": 42, "columns": [...], ...}}
├── dashboard_list_200.json      # {"result": [{"id": 7, "dashboard_title": "Sales", ...}]}
├── sqllab_execute_200.json      # {"data": [{"region": "Asia", "amount": 100}, ...]}
└── csrf_token_200.json          # {"result": "abc123"}
```

**`tests/backend/integration/test_superset_plugin.py`** — Superset 插件路由集成测试

```python
# 要验证的行为（基于 Plugin 文档 § 9.1 端到端流程）：
#
# 认证路由：
# - POST /api/plugins/superset/auth/login {username, password}
#   → mock SupersetClient 返回 auth_login_200 → 200 + session 中存入 token
# - POST /api/plugins/superset/auth/login 密码错误
#   → mock 返回 auth_login_401 → 401
# - GET /api/plugins/superset/auth/status
#   → session 无 token → {"authenticated": false}
#   → session 有 token → {"authenticated": true, "user": "alice"}
#
# 目录路由：
# - GET /api/plugins/superset/catalog/datasets
#   → mock 返回 datasets_list_200 → 200 + 数据集列表
# - 未认证时访问目录 → 401
#
# 数据加载路由：
# - POST /api/plugins/superset/data/load-dataset {dataset_id: 42}
#   → mock SQL Lab 返回 sqllab_execute_200
#   → 验证 Workspace 中生成了 Parquet 文件
#   → 响应包含 {table_name, row_count, columns}
# - POST /api/plugins/superset/data/refresh
#   → 用 stored load_params 重新加载 → 覆盖同名表

# mock 策略：
# - SupersetClient 的所有 HTTP 调用通过 patch("requests.Session.get/post") 拦截
# - 返回 fixture 目录中对应的 JSON
# - Workspace 使用 tmp_path 真实临时目录
# - Flask session 通过 test_client 的 session_transaction 注入 token
```

**`tests/backend/unit/test_superset_client.py`** — SupersetClient 单元测试

```python
# 要验证的行为（基于 0.6 superset_client.py 已有逻辑）：
# - get_datasets() → 正确解析 /api/v1/dataset/ 响应
# - get_dataset(42) → 正确解析单个数据集详情
# - execute_sql() → 正确调用 SQL Lab API，返回数据行
# - get_dashboards() → 正确解析仪表盘列表
# - HTTP 错误（500/超时）→ 抛出有意义的异常
# - CSRF token 在需要时自动获取

# mock 策略：patch requests.Session，返回 fixture JSON。
```

#### 2.0.3 前端插件框架测试（实现 Step 2.3 之前写）

**`tests/frontend/unit/plugins/registry.test.ts`** — 插件动态加载

```typescript
// 要验证的行为（基于 Plugin 文档 § 7.2 + SSO 文档 § 4.4）：
// - 从 /api/app-config 获取的 plugins 列表 → 动态加载对应模块
// - 插件模块导出 manifest + PanelComponent → 注册成功
// - 插件模块导出不完整 → 跳过，console.warn
// - 空 plugins 列表 → 返回空数组，无报错
```

**`tests/frontend/unit/plugins/PluginHost.test.tsx`** — 插件容器组件

```tsx
// 要验证的行为（基于 Plugin 文档 § 7.2）：
// - 有 2 个已注册插件 → 渲染 2 个 Tab
// - 点击 Tab → 切换到对应插件面板
// - 0 个插件 → 不渲染插件区域
// - 插件面板调用 onDataLoaded → 触发表列表刷新
```

### Step 2.1 后端插件框架

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| 插件基类 `DataSourcePlugin` | `plugins/base.py` | [Plugin § 6.1](1-data-source-plugin-architecture.md#61-插件基类)、[SSO § 4.2](1-sso-plugin-architecture.md#4-layer-2数据源插件系统-datasourceplugin) |
| 插件自动发现 `discover_and_register()` | `plugins/__init__.py` | [SSO § 4.4](1-sso-plugin-architecture.md#44-插件注册与发现) |
| 插件数据写入工具 `PluginDataWriter` | `plugins/data_writer.py` | [Plugin § 6.2](1-data-source-plugin-architecture.md#62-插件加载的数据怎么进入-workspace) |
| `app.py` 集成 — 调用 `discover_and_register()` | `app.py` 修改 | [SSO § 4.4](1-sso-plugin-architecture.md#44-插件注册与发现) |
| `/api/app-config` 返回 plugins 字段 | `app.py` 修改 | [Plugin § 8.1](1-data-source-plugin-architecture.md#81-apiapp-config-中的插件字段组装) |

### Step 2.2 Superset 插件后端

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| `SupersetPlugin` 实现（manifest + blueprint） | `plugins/superset/__init__.py` | [Plugin § 10.4](1-data-source-plugin-architecture.md#104-supersetplugin-实现) |
| 迁移 `superset_client.py` | `plugins/superset/superset_client.py` | [Plugin § 4.2](1-data-source-plugin-architecture.md#42-后端模块) |
| 迁移 `auth_bridge.py` | `plugins/superset/auth_bridge.py` | 同上 |
| 迁移 `catalog.py` | `plugins/superset/catalog.py` | 同上 |
| 迁移认证路由（+ SSO 透传） | `plugins/superset/routes/auth.py` | [SSO § 4.3](1-sso-plugin-architecture.md#43-插件与-sso-的集成模式)、[SSO § 6](1-sso-plugin-architecture.md#6-sso-token-透传机制) |
| 迁移目录路由 | `plugins/superset/routes/catalog.py` | [Plugin § 4.2](1-data-source-plugin-architecture.md#42-后端模块) |
| 迁移数据加载路由（DuckDB → Workspace Parquet） | `plugins/superset/routes/data.py` | [Plugin § 10.2](1-data-source-plugin-architecture.md#102-核心改动) |

**关键改动**：`data_routes.py` 从 0.6 的 DuckDB 写入改为 0.7 的 Workspace Parquet 写入（[Plugin § 10.2](1-data-source-plugin-architecture.md#102-核心改动)）。

> **注**：0.6 Superset 集成代码在独立的定制分支中（`data-formulator-0.6`），0.7 上游代码库不含任何 Superset 残留。此处是将 0.6 代码**迁入**0.7 插件框架，无需清理。

### Step 2.3 前端插件框架

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| 插件类型定义 | `src/plugins/types.ts` | [Plugin § 7.1](1-data-source-plugin-architecture.md#71-插件面板契约) |
| 插件动态加载（`import.meta.glob`） | `src/plugins/registry.ts` | [SSO § 4.4](1-sso-plugin-architecture.md#44-插件注册与发现) |
| 插件容器组件 `PluginHost` | `src/plugins/PluginHost.tsx` | [Plugin § 7.2](1-data-source-plugin-architecture.md#72-plugin-host前端插件容器) |
| `dfSlice.tsx` 增加 `plugins` 字段 | `src/app/dfSlice.tsx` 修改 | [SSO § 10.2](1-sso-plugin-architecture.md#102-前端新增文件) |
| `UnifiedDataUploadDialog.tsx` 渲染插件 Tab | 修改 | [Plugin § 7.2](1-data-source-plugin-architecture.md#72-plugin-host前端插件容器) |
| `onDataLoaded` 回调 → 刷新表列表 / loadTable | 修改 | [Plugin § 7.3](1-data-source-plugin-architecture.md#73-数据加载完成后的流程) |

### Step 2.4 Superset 插件前端

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| 插件入口 + manifest | `src/plugins/superset/index.ts` | [Plugin § 10.3](1-data-source-plugin-architecture.md#103-前端) |
| 迁移 SupersetPanel | `src/plugins/superset/SupersetPanel.tsx` | [Plugin § 4.3](1-data-source-plugin-architecture.md#43-前端组件) |
| 迁移 SupersetCatalog | `src/plugins/superset/SupersetCatalog.tsx` | 同上 |
| 迁移 SupersetDashboards | `src/plugins/superset/SupersetDashboards.tsx` | 同上 |
| 迁移 SupersetFilterDialog | `src/plugins/superset/SupersetFilterDialog.tsx` | 同上 |
| 迁移 SupersetLogin | `src/plugins/superset/SupersetLogin.tsx` | 同上 |
| API 封装 | `src/plugins/superset/api.ts` | 同上 |

### Step 2.5 验证

- [ ] 设置 `SUPERSET_URL` → 前端自动出现 Superset Tab
- [ ] 手动登录 Superset → 浏览数据集 → 加载数据到 Workspace
- [ ] SSO 模式（Phase 1 已完成）→ 无需输入 Superset 密码即可访问
- [ ] 不设置 `SUPERSET_URL` → 无任何影响，行为与现版本一致
- [ ] 数据刷新：加载后点刷新按钮 → 重新拉取最新数据（[Plugin § 7.4](1-data-source-plugin-architecture.md#74-数据刷新协议)）

---

## Phase 3：凭证保险箱

> 对应：[SSO 文档 § 5 Layer 3](1-sso-plugin-architecture.md#5-layer-3凭证保险箱-credentialvault)、[SSO 文档 § 11 Phase 3](1-sso-plugin-architecture.md#11-实施路径)

**目标**：服务端加密凭证存储，替代 Session 级别的临时存储。

### Step 3.0 先写测试

**`tests/backend/unit/test_credential_vault.py`** — LocalCredentialVault 单元测试

```python
# 要验证的行为（基于 SSO 文档 § 5.2~5.3）：
# - store(user_a, "superset", {username, password}) → 成功存入
# - retrieve(user_a, "superset") → 返回明文 {username, password}
# - retrieve(user_b, "superset") → 返回 None（用户隔离）
# - store 同一 (user, source) 两次 → 后者覆盖前者
# - delete(user_a, "superset") → 删除后 retrieve 返回 None
# - list_sources(user_a) → ["superset"]，delete 后为 []
# - 换一个 CREDENTIAL_VAULT_KEY 实例化 → 之前存的凭证解密失败，返回 None（非崩溃）
# - 空密钥 → 初始化时报错

# mock 策略：全部使用 tmp_path 下的真实 SQLite 文件 + 真实 Fernet 密钥。
# 不需要 mock 任何东西——这个模块足够独立。
```

**`tests/backend/unit/test_credential_vault_factory.py`** — Vault 工厂

```python
# 要验证的行为（基于 SSO 文档 § 5.4）：
# - CREDENTIAL_VAULT_KEY 已设置 → get_credential_vault() 返回 LocalCredentialVault 实例
# - CREDENTIAL_VAULT_KEY 未设置 → 返回 None
# - CREDENTIAL_VAULT=local → 使用 LocalCredentialVault
# - CREDENTIAL_VAULT=unknown → 返回 None，记录警告
# - 多次调用 get_credential_vault() → 返回同一个单例

# mock 策略：monkeypatch 环境变量 + tmp_path。
```

**`tests/backend/integration/test_credential_routes.py`** — 凭证 API 端点

```python
# 要验证的行为（基于 SSO 文档 § 5.5）：
# - POST /api/credentials/store → 存储成功
# - GET /api/credentials/list → 返回已存储的 source_key 列表（不含凭证内容）
# - POST /api/credentials/delete → 删除后 list 不再包含
# - Vault 未配置时 → /store 和 /delete 返回 503
# - 不同用户（不同 X-Identity-Id）之间凭证隔离

# mock 策略：Flask test_client + 真实 tmp_path Vault + X-Identity-Id 头切换身份。
```

**`tests/backend/integration/test_plugin_auth_with_vault.py`** — 插件认证 + Vault 联动

```python
# 要验证的行为（基于 SSO 文档 § 4.3 三种认证模式）：
# - Vault 中有已存凭证 → 插件 auth/login 自动取出，无需用户输入
# - Vault 中凭证已过期（外部系统密码已改）→ 返回 vault_stale 提示
# - 用户手动输入 + remember=true → 凭证存入 Vault
# - SSO token 可用 + 插件 supports_sso_passthrough → 自动透传

# mock 策略：patch SupersetClient 的认证调用 + 真实 Vault。
```

### Step 3.1 后端

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| Vault 抽象接口 | `credential_vault/base.py` | [SSO § 5.2](1-sso-plugin-architecture.md#52-credentialvault-接口) |
| 本地加密实现（SQLite + Fernet） | `credential_vault/local_vault.py` | [SSO § 5.3](1-sso-plugin-architecture.md#53-本地加密实现) |
| Vault 工厂 | `credential_vault/__init__.py` | [SSO § 5.4](1-sso-plugin-architecture.md#54-vault-工厂) |
| 凭证管理 API | `credential_routes.py` | [SSO § 5.5](1-sso-plugin-architecture.md#55-凭证管理-api) |
| 插件认证路由增强 — 自动从 Vault 取凭证 | `plugins/superset/routes/auth.py` 修改 | [SSO § 4.3](1-sso-plugin-architecture.md#43-插件与-sso-的集成模式) |

### Step 3.2 前端

| 任务 | 产出文件 | 参考 |
|------|---------|------|
| 凭证管理 UI | `src/plugins/CredentialManager.tsx` | [SSO § 10.2](1-sso-plugin-architecture.md#102-前端新增文件) |

### Step 3.3 验证

- [ ] 设置 `CREDENTIAL_VAULT_KEY` → 用户输入 Superset 密码后加密存储
- [ ] 换浏览器 → SSO 登录 → 已存凭证自动可用，无需重新输入
- [ ] 不设置 `CREDENTIAL_VAULT_KEY` → 回退到 Session 存储（现有行为）

---

## Phase 4：第二个插件验证

> 对应：[SSO 文档 § 11 Phase 4](1-sso-plugin-architecture.md#11-实施路径)

**目标**：用 Metabase 插件验证框架通用性 — **核心代码零修改**。

### Step 4.0 先写测试 — 框架通用性验证

Phase 4 的测试本身就是核心交付物。它验证的不是 Metabase 的业务逻辑，而是**插件框架的扩展性承诺**。

**`tests/backend/contract/test_plugin_zero_core_change.py`** — 核心代码零修改契约

```python
# 这个测试在 Metabase 插件代码写完后运行：
# - 检查 plugins/__init__.py 的 git diff → 无修改
# - 检查 app.py 的 git diff → 无修改
# - 检查 src/plugins/registry.ts 的 git diff → 无修改
# - Metabase plugin 仅存在于 plugins/metabase/ 和 src/plugins/metabase/
# - discover_and_register() 能发现 Metabase 插件
# - /api/app-config 返回的 PLUGINS 中包含 metabase
#
# 这是一个**契约测试**：如果未来框架改动导致新增插件需要改核心代码，
# 这个测试应当失败，提醒开发者修复框架的扩展性。
```

**`tests/backend/integration/test_metabase_plugin.py`** — Metabase 插件路由

```python
# 与 Superset 插件测试同结构，mock Metabase REST API：
# - /api/plugins/metabase/auth/login → mock Metabase session API
# - /api/plugins/metabase/catalog/questions → mock /api/card/ 列表
# - /api/plugins/metabase/data/load-question → mock 查询结果 + 写入 Workspace
```

| 任务 | 产出文件 |
|------|---------|
| Metabase 插件后端 | `plugins/metabase/` |
| Metabase 插件前端 | `src/plugins/metabase/` |

**验证标准**：仅新增目录，无需修改 `plugins/__init__.py`、`registry.ts`、`app.py` 等任何现有文件。

---

## Phase 5：完善与增强

> 对应：[SSO 文档 § 11 Phase 5](1-sso-plugin-architecture.md#11-实施路径)、[Plugin 文档 § 7.7](1-data-source-plugin-architecture.md#77-外部系统元数据拉取)

| 任务 | 优先级 | 参考 |
|------|--------|------|
| 外部元数据拉取（列描述、语义类型） | P0 | [Plugin § 7.7](1-data-source-plugin-architecture.md#77-外部系统元数据拉取) |
| 多协议 SSO 支持（SAML / LDAP / CAS） | P1 | [SSO § 3.9](1-sso-plugin-architecture.md#39-多协议支持从-oidc-扩展到-saml--ldap--cas--反向代理) |
| ExternalDataLoader 改进 | P1 | [2-external-dataloader-enhancements.md](2-external-dataloader-enhancements.md) |
| 插件错误边界和降级处理 | P1 | — |
| 管理员配置 UI | P2 | — |
| 审计日志 | P2 | — |

> 注：单元测试和集成测试已嵌入 Phase 1~4 的每个 Step 中，不再单独列为待办。

---

## 全局依赖清单

| 包 | 用途 | 引入阶段 | 安装 |
|----|------|---------|------|
| `PyJWT` | OIDC JWT 验签 | Phase 1 | `pip install PyJWT` |
| `cryptography` | Fernet 加密 + JWT 验签 + 测试密钥生成 | Phase 1 | `pip install cryptography` |
| `oidc-client-ts` | 前端 OIDC PKCE | Phase 1 | `npm install oidc-client-ts` |
| `requests` | 插件 HTTP 调用 | Phase 2 | 已有 |

`cryptography` 同时用于生产代码（Fernet 加密、JWT RS256 验签）和测试（生成 RSA 密钥对签发测试 JWT），不需要额外的测试专用依赖。

现有 `pytest`、`vitest`、`unittest.mock`、`flask.testing` 已满足所有测试需求，**不需要引入新的测试框架或 mock 库**。

> 参考：[SSO 文档 附录 B](1-sso-plugin-architecture.md#附录-b关键依赖)

---

## 核心代码改动范围（一次性）

以下文件在 Phase 1~2 中需要修改。Phase 3+ 不再触碰核心代码。

| 文件 | 改动阶段 | 改动量 | 说明 |
|------|---------|--------|------|
| `py-src/.../auth.py` | Phase 1 | ~60 行 | Provider 自动发现 + `get_sso_token()` |
| `py-src/.../app.py` | Phase 1+2 | ~25 行 | `init_auth()` + `discover_and_register()` + app-config |
| `src/app/App.tsx` | Phase 1 | ~35 行 | 统一 initAuth + 登录 UI |
| `src/app/utils.tsx` | Phase 1 | ~15 行 | Bearer token + 401 重试 |
| `src/app/dfSlice.tsx` | Phase 2 | ~5 行 | `ServerConfig.plugins` |
| `src/views/UnifiedDataUploadDialog.tsx` | Phase 2 | ~20 行 | PluginHost 渲染 |

> 参考：[SSO 文档 § 10.3](1-sso-plugin-architecture.md#103-对现有文件的改动清单)

---

## 文件结构总览

完成全部 Phase 后的新增文件结构（含测试）：

```
py-src/data_formulator/
├── auth_providers/          ← Phase 1
│   ├── base.py
│   ├── azure_easyauth.py
│   ├── oidc.py
│   └── github_oauth.py
├── auth_gateways/           ← Phase 1
│   ├── github_gateway.py
│   └── logout.py
├── credential_vault/        ← Phase 3
│   ├── base.py
│   └── local_vault.py
├── credential_routes.py     ← Phase 3
├── plugins/                 ← Phase 2
│   ├── base.py
│   ├── data_writer.py
│   └── superset/
│       ├── __init__.py
│       ├── superset_client.py
│       ├── auth_bridge.py
│       ├── catalog.py
│       └── routes/

src/
├── app/
│   ├── oidcConfig.ts        ← Phase 1
│   └── OidcCallback.tsx     ← Phase 1
├── plugins/                 ← Phase 2
│   ├── types.ts
│   ├── registry.ts
│   ├── PluginHost.tsx
│   ├── CredentialManager.tsx ← Phase 3
│   └── superset/
│       ├── index.ts
│       ├── SupersetPanel.tsx
│       └── ...

tests/
├── backend/
│   ├── unit/
│   │   ├── test_oidc_provider.py              ← Phase 1
│   │   ├── test_github_oauth_provider.py      ← Phase 1
│   │   ├── test_azure_easyauth_provider.py    ← Phase 1
│   │   ├── test_plugin_discovery.py           ← Phase 2
│   │   ├── test_plugin_data_writer.py         ← Phase 2
│   │   ├── test_superset_client.py            ← Phase 2
│   │   ├── test_credential_vault.py           ← Phase 3
│   │   └── test_credential_vault_factory.py   ← Phase 3
│   ├── security/
│   │   └── test_auth_provider_chain.py        ← Phase 1
│   ├── integration/
│   │   ├── test_auth_info_endpoint.py         ← Phase 1
│   │   ├── test_plugin_app_config.py          ← Phase 2
│   │   ├── test_superset_plugin.py            ← Phase 2
│   │   ├── test_credential_routes.py          ← Phase 3
│   │   ├── test_plugin_auth_with_vault.py     ← Phase 3
│   │   └── test_metabase_plugin.py            ← Phase 4
│   ├── contract/
│   │   └── test_plugin_zero_core_change.py    ← Phase 4
│   └── fixtures/
│       └── superset/                          ← Phase 2
│           ├── auth_login_200.json
│           ├── datasets_list_200.json
│           ├── dataset_detail_42.json
│           ├── sqllab_execute_200.json
│           └── ...
├── frontend/
│   └── unit/
│       ├── app/
│       │   └── fetchWithIdentity.test.ts      ← Phase 1
│       └── plugins/
│           ├── registry.test.ts               ← Phase 2
│           └── PluginHost.test.tsx             ← Phase 2
```

> 参考：[SSO 文档 § 10](1-sso-plugin-architecture.md#10-目录结构)

---

## 文档交付要求

每个 Phase 完成时，除代码和测试外，还需交付或更新以下文档：

| Phase | 必须交付的文档 | 说明 |
|-------|-------------|------|
| Phase 1 | `auth_providers/README.md` | 如何新增一个 AuthProvider：基类契约、环境变量约定、`get_auth_info()` 返回格式、测试方法 |
| Phase 2 | `plugins/README.md` | **插件开发指南**：目录约定、`plugin_class` 暴露方式、manifest 字段说明、路由前缀规则、PluginDataWriter 用法、前端 `index.ts` 导出规范、fixture 录制方法 |
| Phase 2 | `.env.template` 更新 | 新增 `SUPERSET_URL` 等插件环境变量的说明 |
| Phase 3 | `credential_vault/README.md` | Vault 配置方式、密钥生成命令、插件如何调用 Vault API |
| Phase 4 | `plugins/README.md` 更新 | 用 Metabase 插件作为实际案例补充到指南中，验证文档的可操作性 |
| 每个 Phase | `CHANGELOG.md` 追加 | 简要记录本阶段新增的能力和配置变更 |

**核心原则**：文档写给"下一个要开发新插件的人"看。如果按照 `plugins/README.md` 的步骤无法从零完成一个新插件，说明文档不合格。Phase 4（Metabase）就是对这份文档的实战验证。
