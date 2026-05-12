# 认证架构：OIDC + TokenStore + AUTH_MODE

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-28
> **适用范围**: `py-src/data_formulator/auth/` 下的认证模块、`oidc_gateway.py`、`token_store.py`
> **设计文档**: `design-docs/11-unified-auth-credential-architecture.md`

---

## 1. 概览

DF 支持两种认证模式，**自动根据 `OIDC_CLIENT_SECRET` 是否配置来推导**：

| 模式 | 触发条件 | Token 存储 | 适用场景 |
|------|---------|-----------|---------|
| Frontend (Public Client) | 未设置 `OIDC_CLIENT_SECRET` | Bearer header (浏览器) | 公开客户端、本地开发 |
| Backend (Confidential Client) | 设置了 `OIDC_CLIENT_SECRET` | Flask Session (cookie) | 机密客户端、生产部署 |

> `AUTH_MODE` 环境变量可强制覆盖自动推导（`frontend` / `backend`），但通常不需要设置。

两种模式共用回调地址 `/auth/callback`，SSO 侧只需注册一个 redirect URI。

---

## 2. 核心模块

### 2.1 TokenStore (`auth/token_store.py`)

Session-backed 凭证管理器，统一管理所有第三方系统的 token。

**六级解析链** (`get_access(system_id)`):

1. **Cached** — Session 中的未过期 token
2. **Refresh** — 使用 refresh_token 刷新
3. **SSO Exchange** — 用 DF 的 SSO token 换取目标系统 token
4. **Delegated** — 弹窗登录后存入 Session 的 token
5. **Vault** — 持久化凭证（加密存储）
6. **None** — 无可用凭证

**关键方法**:

| 方法 | 说明 |
|------|------|
| `get_access(system_id)` | 返回最佳可用凭证（str / dict / None） |
| `get_sso_token()` | 获取 DF 级 SSO token |
| `get_auth_status()` | 批量查询所有系统的认证状态，包含 `requires_user_action` 与 `available_strategies` |
| `store_service_token(system_id, ...)` | 存储弹窗/手动获取的 token |
| `store_sso_tokens(...)` | 存储后端 OIDC 回调获取的 SSO token |
| `clear_service_token(system_id)` | 清除 token（Session + Vault 同步清理） |
| `clear_session_tokens()` | 仅清除当前 Flask Session 中的 SSO/service token，不删除 Vault 凭据 |

`get_access(system_id)` 本身只返回凭证或 `None`。前端和 Agent 需要判断是否需要用户操作时，
应调用 `/api/auth/service-status`，不要假设 `get_access()` 会附带状态字段。

**手动断开与自动 SSO 重连:**

当用户手动断开 `mode="sso_exchange"` 的服务（例如 Superset）时，
`TokenStore.clear_service_token(system_id)` 会在当前 Flask Session 中记录
`sso_disconnected_services[system_id] = True`。之后自动 SSO exchange 会跳过该服务，
避免刚断开又被 DF 的 SSO token 自动换回目标系统 token。用户通过弹窗/显式登录重新保存
service token 后，`store_service_token()` 会清除此阻止标记。

OIDC logout 使用 `clear_session_tokens()`，只清当前浏览器会话中的 `sso`、
`service_tokens` 和 `sso_disconnected_services`，不删除按 `identity + source_id`
隔离保存的 Vault 凭据。

### 2.2 OIDC Gateway (`auth/gateways/oidc_gateway.py`)

后端 OIDC Confidential Client 网关。通过 `_get_oidc_config()` 从
`OIDCProvider` 实例获取已解析的端点（含自动发现结果），不再直接读取
`OIDC_*_URL` 环境变量。三个 Blueprint：

**`oidc_bp`** (`/api/auth/oidc/`):

| 路由 | 方法 | 说明 |
|------|------|------|
| `/login` | GET | 重定向到 IdP 授权页 |
| `/status` | GET | 检查 SSO 登录状态 |
| `/logout` | POST | 清除当前浏览器 Session 中的 SSO/service token，不删除 Vault 凭据 |

**`oidc_callback_bp`**（无前缀）:

| 路由 | 方法 | 说明 |
|------|------|------|
| `/auth/callback` | GET | 接收授权码，换取 token，自动触发 SSO Exchange |

> 回调路径 `/auth/callback` 与前端 PKCE 模式共用，SSO 侧只需注册一个 redirect URI。

**`auth_tokens_bp`** (`/api/auth/`):

| 路由 | 方法 | 说明 |
|------|------|------|
| `/tokens/save` | POST | 接收弹窗登录获取的 token，并通过 `store_service_token()` 写入 TokenStore |
| `/tokens/<system_id>` | DELETE | 显式断开某个 service token，并清理对应 Vault 凭据 |
| `/service-status` | GET | 返回所有系统的认证状态 |

### 2.2.1 前端 `auth/info` 合约

前端不直接读取 `AUTH_MODE` 环境变量，而是调用 `/api/auth/info`。OIDC provider 返回：

| `action` | 前端行为 |
|----------|----------|
| `backend` | `AuthButton` 跳转到 `login_url`，登出时 POST `logout_url`，后续请求依赖 session cookie |
| `frontend` | 使用 `oidc-client-ts` 走浏览器 PKCE，并由 `fetchWithIdentity()` 附加 Bearer token |
| `transparent` | 平台已完成身份注入，前端不展示普通 OIDC 登录按钮 |
| `none` | 未启用外部认证 |

历史设计草案中的 `backend_redirect` 不是当前实现字段；新代码必须使用 `backend`。

### 2.3 Loader 的 `auth_config()` 声明

Loader 通过静态方法 `auth_config()` 声明认证需求：

```python
@staticmethod
def auth_config() -> dict:
    return {
        "mode": "sso_exchange",        # 认证模式
        "display_name": "Superset",
        "exchange_url": "https://superset/api/v1/df-token-exchange/",
        "login_url": "https://superset/df-sso-bridge/",
        "supports_refresh": True,
    }
```

**mode 枚举**:
- `credentials` — 用户名/密码（默认，不进入 TokenStore）
- `connection` — 连接串（同 credentials）
- `sso_exchange` — SSO token 自动交换
- `delegated` — 弹窗委托登录
- `oauth2` — OAuth2 重定向

### 2.4 Delegated popup 约定

支持弹窗委托登录的 loader 应同时提供：

- `auth_config()` 中的 `mode="delegated"` 或可降级的 `login_url`。
- `delegated_login_config()` 返回前端可打开的 `login_url` 和可选按钮 `label`。
- 弹窗页面通过 `window.opener.postMessage()` 发送 `type: "df-sso-auth"`、`access_token`、可选 `refresh_token` 和 `user`。
- 前端收到消息后调用 `POST /api/auth/tokens/save`，请求体包含 `system_id`、`access_token`、可选 `refresh_token`、`user`、`remember`。
- Loader 的 `__init__` 必须消费注入的 `access_token` 或 `sso_access_token`，否则声明 delegated/SSO 模式没有实际效果。

用户或运维侧 Superset 配置步骤见 `docs-cn/5.1-superset-sso-oauth-config-guide.md`。

---

## 3. 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `OIDC_ISSUER_URL` | IdP Issuer URL（自动发现 + JWT 验证） | 是 |
| `OIDC_CLIENT_ID` | OIDC Client ID | 是 |
| `OIDC_CLIENT_SECRET` | OIDC Client Secret（设置即启用 backend 模式） | 机密客户端必需 |
| `AUTH_MODE` | 强制覆盖模式（`frontend` / `backend`） | 否（自动推导） |
| `OIDC_AUTHORIZE_URL` | IdP 授权端点 | 否（自动发现） |
| `OIDC_TOKEN_URL` | IdP Token 端点 | 否（自动发现） |
| `OIDC_USERINFO_URL` | IdP UserInfo 端点 | 否（自动发现） |
| `OIDC_JWKS_URL` | IdP JWKS 端点 | 否（自动发现） |

> **自动发现**: `OIDCProvider.on_configure()` 在启动时请求
> `{OIDC_ISSUER_URL}/.well-known/openid-configuration`，成功后自动填充
> 上述端点 URL。手动设置的值始终优先于自动发现。
>
> **最小配置**（公开客户端）：`OIDC_ISSUER_URL` + `OIDC_CLIENT_ID`
> **最小配置**（机密客户端）：上述两项 + `OIDC_CLIENT_SECRET`
>
> **模式自动推导** (`is_backend_oidc_mode()`):
> 有 `OIDC_CLIENT_SECRET` → backend；无 → frontend。
> `AUTH_MODE` 环境变量可强制覆盖（极少需要）。

---

## 4. DataConnector 的凭证注入

`DataConnector._inject_credentials()` 在每次建立连接时自动注入凭证：

1. 如果 `params` 已有 `access_token` / `sso_access_token`，保留调用方显式提供的 token，不再覆盖。
2. 查询 Loader 的 `auth_config().mode`（旧 loader 回退到 `auth_mode()`）。
3. 如果 mode 是 `credentials` 或 `connection`，直接返回；这类 loader 使用连接参数或 Vault 凭据，不走 TokenStore 的 SSO/service-token 注入链。
4. 对 `token` / `sso_exchange` / `delegated` 等非默认模式，通过 `TokenStore.get_access(source_id)` 获取最佳凭证。返回 dict 时合并进 `params`，返回字符串时写入 `params["access_token"]`。
5. 如果 TokenStore 不可用或没有可用凭证，降级尝试通过 `auth.identity.get_sso_token()` 注入原始 `sso_access_token`，供支持 SSO exchange 的 loader 使用。

注意：通用注入框架只负责把 token 放进 loader 参数。具体数据库是否能使用该 token，
仍取决于对应 loader 是否声明了非默认 `auth_config()`，并在 `__init__` 中把 token
接入目标 SDK 或连接字符串。多数内置数据库 loader 当前仍是默认 `credentials` 模式。

---

## 5. 安全要求

- **HTTPS 与 Frontend 模式**：Frontend (PKCE) 模式依赖浏览器的 `crypto.subtle` API，
  该 API 仅在安全上下文（HTTPS 或 localhost）下可用。纯 HTTP 部署使用 Frontend 模式
  会失败。如果无法配置 HTTPS，应使用 Backend（机密客户端）模式
- **永远不要在日志中输出 token**：使用 `%s` 占位符记录 system_id，不记录 token 值
- **Session 安全**：生产环境必须配置 `SESSION_COOKIE_SECURE=True`、`SESSION_COOKIE_HTTPONLY=True`
- **client_secret 不暴露**：后端模式下 `client_secret` 仅在服务端使用，不传给前端
- **State 参数**：OIDC `/login` 生成随机 state，`/callback` 校验 state 防止 CSRF
- **OAuth Redirect 安全**：非 OIDC redirect provider（例如 GitHub）也必须生成并校验 state
- **GitHub 私有邮箱**：`/user` 的 `email` 可能为空；已申请 `user:email` 时应通过 `/user/emails` 取 primary verified email

---

## 6. 测试

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/backend/auth/test_token_store.py` | TokenStore 解析链、存储、过期、刷新、SSO Exchange |
| `tests/backend/auth/test_oidc_gateway.py` | OIDC 登录/回调/状态/登出、token 保存路由 |
| `tests/backend/auth/test_oidc_provider.py` | JWT 验证（前端模式） |
| `tests/backend/auth/sso_provider_contracts/` | 无 Docker 的主流 SSO provider 契约模拟（Apple、Microsoft、Google、GitLab、Keycloak、Okta、Auth0、AWS Cognito、阿里云 IDaaS、腾讯云 IDaaS、华为云 OneAccess、GitHub） |

测试使用 Flask 测试客户端 + mocked HTTP，不需要真实 IdP。

---

## 7. 新模块检查清单

添加新的认证相关模块时：

- [ ] 确认 `AUTH_MODE` 行为：新代码在 frontend 和 backend 模式下是否都正确
- [ ] 检查 TokenStore 集成：新的 Loader 是否需要 `auth_config()` 声明
- [ ] 日志审查：新代码是否可能泄露 token 或 secret
- [ ] Session 依赖：新路由是否需要 Flask Session（仅 backend 模式有 session）
- [ ] 测试覆盖：新路由是否有对应的测试用例
