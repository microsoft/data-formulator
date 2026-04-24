# 认证架构：OIDC + TokenStore + AUTH_MODE

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-25
> **适用范围**: `py-src/data_formulator/auth/` 下的认证模块、`oidc_gateway.py`、`token_store.py`
> **设计文档**: `design-docs/11-unified-auth-credential-architecture.md`

---

## 1. 概览

DF 支持两种认证模式，通过环境变量 `AUTH_MODE` 切换：

| AUTH_MODE | 说明 | Token 存储 | 适用场景 |
|-----------|------|-----------|---------|
| `frontend` (默认) | 前端通过 oidc-client-ts 完成 OIDC 流程，token 保存在浏览器 | Bearer header | 本地部署、开发环境 |
| `backend` | 后端作为 Confidential Client 完成 OIDC 授权码流程 | Flask Session (cookie) | 生产部署、多用户服务器 |

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
| `get_auth_status()` | 批量查询所有系统的认证状态 |
| `store_service_token(system_id, ...)` | 存储弹窗/手动获取的 token |
| `store_sso_tokens(...)` | 存储后端 OIDC 回调获取的 SSO token |
| `clear_service_token(system_id)` | 清除 token（Session + Vault 同步清理） |

### 2.2 OIDC Gateway (`auth/gateways/oidc_gateway.py`)

后端 OIDC Confidential Client 网关，两个 Blueprint：

**`oidc_bp`** (`/api/auth/oidc/`):

| 路由 | 方法 | 说明 |
|------|------|------|
| `/login` | GET | 重定向到 IdP 授权页 |
| `/callback` | GET | 接收授权码，换取 token，自动触发 SSO Exchange |
| `/status` | GET | 检查 SSO 登录状态 |
| `/logout` | POST | 清除所有 token（SSO + 所有服务） |

**`auth_tokens_bp`** (`/api/auth/`):

| 路由 | 方法 | 说明 |
|------|------|------|
| `/tokens/save` | POST | 接收弹窗登录获取的 token |
| `/service-status` | GET | 返回所有系统的认证状态 |

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

---

## 3. 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `AUTH_MODE` | `frontend` 或 `backend` | 否（默认 frontend） |
| `OIDC_CLIENT_ID` | OIDC Client ID | backend 模式必需 |
| `OIDC_CLIENT_SECRET` | OIDC Client Secret | backend 模式必需 |
| `OIDC_AUTHORIZE_URL` | IdP 授权端点 | backend 模式必需 |
| `OIDC_TOKEN_URL` | IdP Token 端点 | backend 模式必需 |
| `OIDC_USERINFO_URL` | IdP UserInfo 端点 | 可选 |
| `OIDC_ISSUER_URL` | IdP Issuer URL（前端模式 JWT 验证） | frontend 模式必需 |

---

## 4. DataConnector 的凭证注入

`DataConnector._inject_credentials()` 在每次建立连接时自动注入凭证：

1. 检查 `params` 是否已有 `access_token` / `sso_access_token`（用户手动提供）
2. 查询 Loader 的 `auth_config().mode`
3. 通过 `TokenStore.get_access(source_id)` 获取最佳凭证
4. 降级：通过 `auth.identity.get_sso_token()` 获取原始 SSO token

---

## 5. 安全要求

- **永远不要在日志中输出 token**：使用 `%s` 占位符记录 system_id，不记录 token 值
- **Session 安全**：生产环境必须配置 `SESSION_COOKIE_SECURE=True`、`SESSION_COOKIE_HTTPONLY=True`
- **client_secret 不暴露**：后端模式下 `client_secret` 仅在服务端使用，不传给前端
- **State 参数**：OIDC `/login` 生成随机 state，`/callback` 校验 state 防止 CSRF

---

## 6. 测试

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/backend/auth/test_token_store.py` | TokenStore 解析链、存储、过期、刷新、SSO Exchange |
| `tests/backend/auth/test_oidc_gateway.py` | OIDC 登录/回调/状态/登出、token 保存路由 |
| `tests/backend/auth/test_oidc_provider.py` | JWT 验证（前端模式） |

测试使用 Flask 测试客户端 + mocked HTTP，不需要真实 IdP。

---

## 7. 新模块检查清单

添加新的认证相关模块时：

- [ ] 确认 `AUTH_MODE` 行为：新代码在 frontend 和 backend 模式下是否都正确
- [ ] 检查 TokenStore 集成：新的 Loader 是否需要 `auth_config()` 声明
- [ ] 日志审查：新代码是否可能泄露 token 或 secret
- [ ] Session 依赖：新路由是否需要 Flask Session（仅 backend 模式有 session）
- [ ] 测试覆盖：新路由是否有对应的测试用例
