# 11. 认证架构分析：前端 vs 后端 OIDC 策略

> 状态：设计阶段  
> 创建日期：2026-04-23  
> 关联：`8-superset-token-passthrough-design.md`、`10-sso-portal-seamless-login.md`

---

## 1. 问题背景

### 1.1 当前架构

DF 目前使用 **前端 OIDC 模式**：

```
┌─ 浏览器 ────────────────────────────────────────────────────┐
│                                                              │
│  oidc-client-ts (Public Client + PKCE)                       │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ signinRedirect() → SSO /authorize?code_challenge=.. │     │
│  │ signinRedirectCallback() → SSO /token (带 verifier) │     │
│  │ access_token → localStorage                         │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  fetchWithIdentity()                                         │
│  ┌─────────────────────────────────────────┐                 │
│  │ 每次 /api/* 请求 → Authorization: Bearer │                │
│  └────────────────────┬────────────────────┘                 │
│                       │                                      │
└───────────────────────┼──────────────────────────────────────┘
                        │
                        ▼
┌─ DF 后端 (Flask) ─────────────────────────────────────┐
│                                                        │
│  OIDCProvider.authenticate(request)                    │
│  ├── 从 Authorization 头取 token                       │
│  ├── JWKS 验签 或 UserInfo 校验                        │
│  └── flask.g.df_auth_result = AuthResult(raw_token=..) │
│                                                        │
│  get_sso_token()                                       │
│  └── 从 flask.g 取 raw_token（请求级生命周期）          │
│                                                        │
│  _inject_sso_token() → Superset exchange               │
│  └── 从当前请求取 SSO token，给 Superset 换票           │
│                                                        │
│  ❌ 后端不持久化 token                                  │
│  ❌ 请求结束后 token 丢失                               │
│  ❌ Agent 异步执行时无 token 可用                       │
└────────────────────────────────────────────────────────┘
```

### 1.2 核心矛盾

| 需求场景 | 前端持有 token 的问题 |
|----------|-----------------------|
| **Agent 自动拉取 Superset 数据** | Agent 在后端运行，需要 SSO token 换取 Superset JWT。但后端没有持久化的 token，只能依赖"当前请求带过来的 Bearer" |
| **Agent 长时间运行** | 如果 Agent 执行超过 token 有效期（通常 5-30 分钟），token 过期后无法续期——`signinSilent()` 只在浏览器端有效 |
| **HTTPS 强制要求** | Public Client + PKCE 需要 `crypto.subtle`，只在安全上下文（HTTPS 或 localhost）可用。内网部署增加运维成本 |
| **多 Tab/多设备** | 用户在新标签页打开 DF 时，如果 SSO session 已过期，需要重新登录 |

### 1.3 需要回答的问题

1. **前端 OIDC vs 后端 OIDC**：认证集成应该放在哪一层？
2. **Token 透传给 Superset**：SSO → DF → Superset 的 token 链路如何设计？
3. **Agent 数据访问**：后端 Agent 如何获得访问 Superset 所需的凭证？
4. **安全性**：后端存储 token 是否引入新的安全风险？

---

## 2. 现有代码分析

### 2.1 Token 生命周期（当前）

```
时间线 →

浏览器端：
  t0  signinRedirect() 生成 code_verifier，存入 localStorage
  t1  SSO 返回 code，signinRedirectCallback() 用 code + verifier 换 token
  t2  access_token 存入 localStorage（有效期 5-30 分钟）
  t3  每次 fetch 从 localStorage 取 token 放 Authorization 头
  t4  token 快过期 → signinSilent() 刷新（需要 SSO session 未过期）
  t5  SSO session 过期 → signinSilent 失败 → 用户需重新登录

后端：
  t3  收到请求 → 从 Authorization 头取 token → flask.g（本次请求有效）
  t3+ 请求结束 → flask.g 清空 → token 丢失
  t3  下次请求 → 又从 Authorization 头取 → 又是临时的
```

### 2.2 Superset Token 换票（当前）

```python
# data_connector.py — 每次需要 Superset 数据时
def _inject_sso_token(self, params):
    sso_token = get_sso_token()  # 从 flask.g 取当前请求的 SSO token
    if sso_token:
        params["sso_access_token"] = sso_token

# superset_data_loader.py — 初始化时换票
def __init__(self, params):
    sso_token = params.get("sso_access_token")
    if sso_token:
        self._try_sso_exchange(sso_token)  # SSO token → Superset JWT
```

**问题**：这条链路只在"前端发起的请求"中有效。如果 Agent 在后端自主执行（如异步任务），没有前端请求 → 没有 Authorization 头 → 没有 SSO token → 换票失败。

### 2.3 Agent 当前的运行模式

```python
# 当前 Agent 执行由前端请求触发（同步请求-响应）
# routes/agents.py — POST /api/run-agent
def run_agent():
    # 此时 flask.g 中有 SSO token（来自前端的 Authorization 头）
    # 如果 Agent 需要 Superset 数据，可以在此请求内完成
    # 但如果 Agent 运行很长时间，或者需要多次访问 Superset，
    # 只有第一次请求的 token 可用
```

---

## 3. 架构方案对比

### 3.1 方案 A：保持前端 OIDC，后端增加 Token 缓存（渐进式改进）

维持当前的 Public Client + PKCE 前端 OIDC 架构不变，但在后端增加一层 **Session 级 Token 缓存**，解决 Agent 的 token 访问问题。

```
┌─ 浏览器 ────────────────────────────────────────┐
│  oidc-client-ts (Public Client + PKCE)           │
│  localStorage: access_token, refresh_token       │
│  fetchWithIdentity: Authorization: Bearer xxx    │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌─ DF 后端 ────────────────────────────────────────┐
│                                                   │
│  authenticate() → 验证 token → flask.g            │
│       │                                           │
│       ▼                                           │
│  Token Cache（新增）                               │
│  ┌─────────────────────────────────────────────┐  │
│  │ Flask Session 或 服务端缓存                   │  │
│  │ key: user_id                                │  │
│  │ value: {                                    │  │
│  │   sso_access_token: "...",                  │  │
│  │   sso_refresh_token: "...",  (如果有)        │  │
│  │   sso_token_expires: 1713900000,            │  │
│  │   superset_jwt: "...",                      │  │
│  │   superset_refresh: "...",                  │  │
│  │   superset_jwt_expires: 1713900000,         │  │
│  │ }                                           │  │
│  └─────────────────────────────────────────────┘  │
│       │                                           │
│       ▼                                           │
│  Agent 运行时                                      │
│  ├── 从 Token Cache 取 SSO token                  │
│  ├── 用 SSO token 换 Superset JWT                 │
│  └── Superset JWT 也缓存到 Token Cache            │
└───────────────────────────────────────────────────┘
```

**核心改动**：

```python
# auth/token_cache.py（新增）

class TokenCache:
    """Per-user token cache backed by Flask session or Redis.

    Stores the latest SSO access_token and derived tokens (Superset JWT etc.)
    so that backend components (Agent, connectors) can access them
    without requiring a concurrent frontend request.
    """

    @staticmethod
    def store_sso_token(user_id: str, token: str, expires_at: float = None):
        """Called by authenticate() on every request that carries a Bearer token.
        Refreshes the cache with the latest token."""
        session[f"sso_token:{user_id}"] = {
            "access_token": token,
            "expires_at": expires_at,
            "updated_at": time.time(),
        }

    @staticmethod
    def get_sso_token(user_id: str) -> str | None:
        """Called by Agent/connectors when they need an SSO token."""
        cached = session.get(f"sso_token:{user_id}")
        if not cached:
            return None
        if cached.get("expires_at") and cached["expires_at"] < time.time():
            return None
        return cached["access_token"]

    @staticmethod
    def store_superset_jwt(user_id: str, jwt: str, refresh: str,
                           expires_at: float = None):
        session[f"superset_jwt:{user_id}"] = {
            "access_token": jwt,
            "refresh_token": refresh,
            "expires_at": expires_at,
        }

    @staticmethod
    def get_superset_jwt(user_id: str) -> dict | None:
        return session.get(f"superset_jwt:{user_id}")
```

**优点**：
- 改动最小，不影响现有前端 OIDC 流程
- 向后兼容：前端代码不需要任何修改
- Agent 可以从缓存获取 token，不再依赖"当前请求"
- Superset JWT 也可以缓存，避免每次请求都换票

**缺点**：
- 仍然需要 HTTPS（Public Client + PKCE 的 crypto.subtle 要求）
- Token 缓存依赖 Flask Session（默认是签名 cookie，大小有限）
  → 如果 token 较大，可能需要服务端 session（如 Redis）
- SSO token 过期后，后端无法自行续期——只能等前端下次请求带新 token
- 安全性：token 持久化到 session，增加了服务端被攻击时的暴露面

**安全措施**：
- Session cookie 设置 `HttpOnly`、`Secure`、`SameSite=Lax`（已配置）
- Token 缓存设置 TTL，过期自动清除
- 不在日志中记录 token 值

---

### 3.2 方案 B：后端 Confidential Client OIDC（架构升级）

将 OIDC 集成从前端迁移到后端。DF 后端作为 **Confidential Client**，直接与 SSO 交互完成授权码流程。前端不再直接参与 token 交换。

```
┌─ 浏览器 ────────────────────────────────────────────┐
│                                                      │
│  无 oidc-client-ts                                   │
│  无 PKCE（后端有 client_secret，不需要）               │
│  无 crypto.subtle 要求 → HTTP 可用                   │
│                                                      │
│  点击 "SSO Login"                                    │
│    → 跳转 DF 后端 /api/auth/login                    │
│    → 后端 302 到 SSO /authorize                      │
│                                                      │
│  SSO 登录完成后                                       │
│    → 302 回 DF 后端 /api/auth/callback               │
│    → 后端用 code + client_secret 换 token            │
│    → 后端存 token 到 session                         │
│    → 302 回 DF 首页                                  │
│                                                      │
│  fetchWithIdentity()                                 │
│    → 不再需要 Authorization: Bearer                  │
│    → 改为携带 session cookie 即可                     │
└──────────────────────┬───────────────────────────────┘
                       │ session cookie
                       ▼
┌─ DF 后端 ────────────────────────────────────────────┐
│                                                       │
│  /api/auth/login → 302 SSO /authorize                │
│  /api/auth/callback → code + client_secret 换 token  │
│                                                       │
│  Session（服务端）                                      │
│  ┌───────────────────────────────────────────────┐    │
│  │ sso_access_token:  "eyJ..."                   │    │
│  │ sso_refresh_token: "eyJ..."                   │    │
│  │ sso_token_expires: 1713900000                 │    │
│  │ superset_jwt:      "eyJ..."   (自动换票)       │    │
│  │ superset_refresh:  "eyJ..."                   │    │
│  │ user_info: { sub, name, email }               │    │
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  authenticate() → 从 session 读 token 并验证          │
│  get_sso_token() → 从 session 读 sso_access_token    │
│  Agent → 直接从 session 取 token，无需前端参与         │
│                                                       │
│  Token 续期：后端用 refresh_token 主动续期             │
│  → 不依赖浏览器的 signinSilent                        │
└───────────────────────────────────────────────────────┘
```

**核心改动（DF 后端新增路由）**：

```python
# auth/gateways/oidc_gateway.py（新增）

from flask import Blueprint, redirect, request, session, url_for
import secrets, hashlib, base64, urllib.parse, requests

oidc_bp = Blueprint("oidc_gateway", __name__, url_prefix="/api/auth/oidc")

@oidc_bp.route("/login")
def oidc_login():
    """Redirect user to SSO authorization page."""
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state

    params = {
        "response_type": "code",
        "client_id": OIDC_CLIENT_ID,
        "redirect_uri": request.url_root.rstrip("/") + "/api/auth/oidc/callback",
        "scope": "openid profile email offline_access",
        "state": state,
    }
    authorize_url = f"{OIDC_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"
    return redirect(authorize_url)


@oidc_bp.route("/callback")
def oidc_callback():
    """Exchange authorization code for tokens (server-side)."""
    code = request.args.get("code")
    state = request.args.get("state")

    if not code or state != session.pop("oauth_state", None):
        return {"error": "invalid_state"}, 400

    # Confidential client: use client_secret, no PKCE needed
    token_resp = requests.post(OIDC_TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": request.url_root.rstrip("/") + "/api/auth/oidc/callback",
        "client_id": OIDC_CLIENT_ID,
        "client_secret": OIDC_CLIENT_SECRET,
    }, timeout=10)
    token_resp.raise_for_status()
    tokens = token_resp.json()

    session["sso_access_token"] = tokens["access_token"]
    session["sso_refresh_token"] = tokens.get("refresh_token")
    session["sso_token_expires"] = time.time() + tokens.get("expires_in", 3600)

    # Fetch user info
    userinfo_resp = requests.get(OIDC_USERINFO_URL, headers={
        "Authorization": f"Bearer {tokens['access_token']}"
    }, timeout=10)
    if userinfo_resp.ok:
        session["sso_user"] = userinfo_resp.json()

    return redirect("/")
```

**前端改动**：

```typescript
// AuthButton.tsx — 简化
const handleSignIn = useCallback(() => {
    // 不再调用 oidc-client-ts，直接跳转后端
    window.location.href = "/api/auth/oidc/login";
}, []);
```

```typescript
// utils.tsx — fetchWithIdentity 简化
async function _doFetch(url, options) {
    if (url.startsWith('/api/')) {
        // 不再需要手动附加 Bearer token
        // Session cookie 由浏览器自动携带
        // 只需设置 X-Identity-Id 等自定义头
    }
    return fetch(url, options);
}
```

**优点**：
- **不需要 HTTPS**：Confidential Client 用 `client_secret` 认证，不需要 PKCE/crypto.subtle
- **后端完整控制 token 生命周期**：可以主动 refresh，不依赖浏览器
- **Agent 直接可用**：token 在服务端 session 中，Agent 随时可取
- **Superset 换票更自然**：后端拿到 SSO token 后立即换票并缓存
- **SSO 门户一键登录更简单**：门户可以直接链接到 `/api/auth/oidc/login`
- **前端更简洁**：去掉 `oidc-client-ts` 依赖，减少 ~50KB JS

**缺点**：
- **较大的架构改动**：需要重写认证流程（前端 + 后端）
- **SSO 应用需重新注册为 Confidential Client**：或同时保留 Public + Confidential 双注册
- **client_secret 管理**：后端需要安全存储 `client_secret`（但已有 `OIDC_CLIENT_SECRET` 环境变量）
- **Session 管理**：默认 Flask session (cookie) 容量有限，可能需要 Redis 等服务端 session
- **单点故障**：Session 丢失 = 用户需要重新登录（可用 refresh_token 缓解）

**安全对比**：

| 安全维度 | Public Client (当前) | Confidential Client (方案 B) |
|----------|---------------------|------------------------------|
| client_secret | 无（靠 PKCE） | 有（存在服务端，不暴露给浏览器） |
| Token 存储 | 浏览器 localStorage（XSS 可读） | 服务端 session（XSS 不可读） |
| HTTPS 要求 | 强制（crypto.subtle） | 推荐但非强制 |
| Token 泄露风险 | 前端 XSS 可窃取 token | 需要攻破服务端才能窃取 |
| CSRF 风险 | 无（Bearer token 不自动发送） | 有（cookie 自动发送）→ 需要 CSRF token |
| Token 续期 | 浏览器 signinSilent | 服务端 refresh_token |

---

### 3.3 方案 C：混合模式——后端 Confidential + 前端 Session（推荐长期目标）

**核心思路**：后端作为 Confidential Client 完成 OAuth2 流程并管理 token，前端通过 session cookie 与后端通信。同时保留前端 OIDC 作为降级选项（如部署场景不允许后端存储 session 时）。

```
┌─ DF 后端 ──────────────────────────────────────────────────────┐
│                                                                 │
│  auth_mode=backend (默认)        auth_mode=frontend (降级)      │
│  ┌─────────────────────┐         ┌─────────────────────┐        │
│  │ Confidential Client │         │ 当前 Public Client  │        │
│  │ /auth/login         │         │ 逻辑不变            │        │
│  │ /auth/callback      │         │                     │        │
│  │ Session 存 token    │         │                     │        │
│  └──────────┬──────────┘         └─────────────────────┘        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ Token Store (统一接口)                                │        │
│  │                                                     │        │
│  │  get_sso_token(user_id) → str                       │        │
│  │  get_superset_jwt(user_id) → str                    │        │
│  │  refresh_if_needed(user_id) → str                   │        │
│  │                                                     │        │
│  │  backend_mode: 从 session 读                        │        │
│  │  frontend_mode: 从 flask.g 读 (请求级)              │        │
│  └──────────┬──────────────────────────────────────────┘        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ Agent / Connectors                                   │        │
│  │ 统一调用 Token Store，不关心 token 来源              │        │
│  └─────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

**Token Store 统一接口**：

```python
# auth/token_store.py

class TokenStore:
    """Unified token access for Agent and connectors.

    Abstracts the difference between backend-managed sessions
    (Confidential Client) and per-request Bearer tokens (Public Client).
    """

    def get_sso_token(self) -> str | None:
        """Get the current user's SSO access token."""
        mode = os.environ.get("AUTH_MODE", "backend")

        if mode == "backend":
            # Confidential Client: token in server session
            token = session.get("sso_access_token")
            expires = session.get("sso_token_expires", 0)
            if token and expires > time.time():
                return token
            # Try refresh
            return self._refresh_sso_token()

        else:
            # Public Client (frontend OIDC): token in current request
            from data_formulator.auth.identity import get_sso_token
            return get_sso_token()

    def get_superset_jwt(self) -> str | None:
        """Get or auto-exchange a Superset JWT."""
        # 1. Check cache
        cached = session.get("superset_jwt")
        if cached and cached["expires_at"] > time.time():
            return cached["access_token"]

        # 2. Try refresh
        if cached and cached.get("refresh_token"):
            refreshed = self._refresh_superset_jwt(cached["refresh_token"])
            if refreshed:
                return refreshed

        # 3. Try SSO token exchange
        sso_token = self.get_sso_token()
        if sso_token:
            return self._exchange_sso_for_superset(sso_token)

        return None

    def _refresh_sso_token(self) -> str | None:
        refresh = session.get("sso_refresh_token")
        if not refresh:
            return None
        # POST to SSO /token with grant_type=refresh_token
        resp = requests.post(OIDC_TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": OIDC_CLIENT_ID,
            "client_secret": OIDC_CLIENT_SECRET,
        }, timeout=10)
        if resp.ok:
            tokens = resp.json()
            session["sso_access_token"] = tokens["access_token"]
            session["sso_refresh_token"] = tokens.get("refresh_token", refresh)
            session["sso_token_expires"] = time.time() + tokens.get("expires_in", 3600)
            return tokens["access_token"]
        return None
```

---

## 4. 方案对比总表

| 维度 | A. 前端 OIDC + 缓存 | B. 后端 Confidential | C. 混合模式 |
|------|---------------------|---------------------|-------------|
| **改动量** | 小（加缓存层） | 大（重写认证流） | 中（渐进迁移） |
| **HTTPS 要求** | 必须 | 不必须 | 可选 |
| **Agent 可用性** | 受限（依赖缓存时效） | 完全可用 | 完全可用 |
| **Token 续期** | 依赖前端 signinSilent | 后端主动 refresh | 后端主动 refresh |
| **Superset 换票** | 每次请求临时换 | 登录时一次性换 + 缓存 | 登录时一次性换 + 缓存 |
| **安全性** | token 在前端 localStorage | token 在服务端 session | token 在服务端 session |
| **XSS 风险** | 高（localStorage 可读） | 低（HttpOnly cookie） | 低 |
| **CSRF 风险** | 无（Bearer 不自动发送） | 有（需 CSRF token） | 有 |
| **SSO 门户集成** | 需要 OidcCallback 改造 | 直接链接 /auth/login | 直接链接 /auth/login |
| **多 Provider 支持** | 每种 Provider 前端独立实现 | 后端统一处理 | 后端统一处理 |
| **离线/弱网** | 前端有 token 可用 | 依赖后端 session | 按模式区分 |

---

## 5. 对 Token 透传场景的影响

### 5.1 场景：SSO → DF → Superset → Agent 自动分析

```
完整链路：

用户登录 SSO
  → DF 获得 SSO access_token
  → DF 用 SSO token 向 Superset 换取 Superset JWT
  → Agent 用 Superset JWT 拉取数据
  → Agent 完成分析
```

**各方案表现**：

| 步骤 | 方案 A（前端缓存） | 方案 B/C（后端 Confidential） |
|------|-------------------|------------------------------|
| SSO → DF token | 前端拿到，每次请求传给后端 | 后端拿到，存 session |
| SSO token → Superset JWT | 每次请求临时换票 | 登录时换一次，缓存到 session |
| Agent 需要 Superset JWT | ⚠️ 依赖最近一次请求的缓存 | ✅ 直接从 session 取 |
| Token 过期续期 | ⚠️ 等前端 signinSilent | ✅ 后端 refresh_token 主动续 |
| 长时间 Agent 任务 | ❌ token 可能中途过期 | ✅ 后端自动续期 |

### 5.2 场景：SSO 门户一键进入 DF

| 步骤 | 方案 A + 文档 10 | 方案 B/C |
|------|-----------------|----------|
| 门户点击应用 | 跳 /callback → PKCE → SSO → 回 /callback | 跳 /api/auth/login → SSO → 回 /api/auth/callback |
| 需要 HTTPS | 是 | 否 |
| 用户感知 | 无感（~1s） | 无感（~1s） |

---

## 6. 推荐策略：分阶段迁移

### Phase 0（立即）：方案 A — 加缓存，解决 Agent 基本可用性

在当前架构上加 Token Cache 层，使 Agent 可以"搭便车"使用前端带过来的 token。

**改动**：
- `auth/token_cache.py`：新增 Token 缓存模块
- `identity.py`：`authenticate()` 成功后写入缓存
- `data_connector.py`：`_inject_sso_token()` 优先从缓存取
- 不改变前端任何代码

**限制**：
- Agent 仍然依赖"用户最近访问过 DF"才有缓存的 token
- Token 过期后只能等前端下次请求刷新

### Phase 1（短期）：文档 10 的方案 A — SSO 门户一键登录

解决 SSO 门户跳转到 DF 的用户体验问题（已在文档 10 中详细设计）。

### Phase 2（中期）：方案 B/C — 后端 Confidential Client

将 OIDC 集成迁移到后端，解决 HTTPS 强制要求、Token 续期、Agent 长时间运行等根本性问题。

**关键决策点**：
- 在 SSO 中为 DF 注册一个新的 Confidential Client（或将现有 Public Client 改为 Confidential）
- DF 后端新增 `/api/auth/oidc/login` 和 `/api/auth/oidc/callback`
- 前端从 `oidc-client-ts` 迁移到简单的 302 跳转
- `get_auth_info()` 返回 `{ action: "backend_redirect", loginUrl: "/api/auth/oidc/login" }`

**SSO 侧需要做的**：
- 确认 `POST /token` 端点支持 `client_secret_post` 认证方式
- DF 的 Confidential Client 使用 `client_id` + `client_secret`，不需要 PKCE
- 如果想同时支持两种模式（内网 HTTP 用 Confidential，外网 HTTPS 用 Public），可以在 SSO 中注册两个 Client

### Phase 3（长期）：Superset 自动换票

即文档 8 中的 Phase 2（Token Exchange），在后端 Confidential Client 架构下更容易实现：

```python
# 用户通过后端 OIDC 登录后自动执行
@oidc_bp.route("/callback")
def oidc_callback():
    # ... 换取 SSO token ...

    # 自动尝试 Superset 换票
    token_store = TokenStore()
    superset_jwt = token_store.get_superset_jwt()
    # 如果成功，Agent 后续可直接使用
```

---

## 7. SSO 系统需要的配套改动

无论选择哪个方案，SSO 系统 (y-sso-system) 可能需要以下配套：

### 7.1 应用列表 API 返回 `client_type`

确保前端门户可以根据 `client_type` 做不同的跳转逻辑。

### 7.2 支持 Confidential Client 的 `/token` 端点

当前 SSO 的 `/token` 端点需要支持：
- `grant_type=authorization_code` + `client_secret`（Confidential Client 换 token）
- `grant_type=refresh_token` + `client_secret`（Confidential Client 续期）

### 7.3 SSO Session/Cookie 管理

SSO 需要在用户登录后设置跨子域或同域的 session cookie，使得从 SSO 门户跳转到 DF 后，GET `/authorize` 能识别用户已登录。

---

## 8. 多系统凭证管理：从 Superset 到 N 个第三方系统

前面的分析集中在 SSO → DF → Superset 这一条链路上。但实际场景中 DF 需要对接的第三方系统远不止 Superset——Metabase、Grafana、Power BI、Google Sheets 等 BI/数据平台，以及各种数据库和云存储。不同系统的认证模式差异巨大，需要一套**通用的凭证管理架构**。

### 8.1 第三方系统认证模式分类

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        第三方系统认证模式分类                                  │
├──────────────────────┬──────────────────────┬────────────────────────────────┤
│                      │                      │                                │
│  模式 1: 同 IdP      │  模式 2: 独立凭据    │  模式 3: 联邦认证               │
│  (SSO 互通)          │  (各自的凭据体系)     │  (不同 IdP 的 OAuth)           │
│                      │                      │                                │
│  Superset*           │  MySQL / MSSQL       │  Power BI (Azure AD)           │
│  Metabase*           │  PostgreSQL / MongoDB│  Tableau (Salesforce IdP)      │
│  Grafana*            │  S3 (AWS IAM)        │  Google Sheets (Google OAuth)  │
│  内部报表系统        │  Azure Blob          │  Snowflake (Okta)              │
│                      │  API Key 类服务      │                                │
│                      │                      │                                │
│  ✅ SSO token        │  ❌ SSO token 无用   │  ⚠️ 需独立 OAuth 流程           │
│    可自动换票        │    需独立凭据         │    token 来自不同 IdP           │
│                      │                      │                                │
│  后端自动完成        │  用户输入一次 → Vault │  用户授权一次 → 后端存储        │
│  用户零操作          │  后续自动使用         │  后端可自动 refresh             │
│                      │                      │                                │
│  * 前提：也接入了    │                      │                                │
│    同一个 y-sso      │                      │                                │
└──────────────────────┴──────────────────────┴────────────────────────────────┘
```

### 8.2 当前架构的局限性

当前 `ExternalDataLoader` 的认证抽象只有二元区分：

```python
# external_data_loader.py — 当前只有两种模式
@staticmethod
def auth_mode() -> str:
    """Return 'connection' (default) or 'token'."""
    return "connection"
```

12 种已注册 loader 中的认证分布：

| auth_mode | Loader | 当前认证方式 |
|-----------|--------|-------------|
| `connection` | MySQL, MSSQL, PostgreSQL, MongoDB, CosmosDB, BigQuery, Athena, Kusto, S3, Azure Blob, Local Folder | 用户名/密码、连接串、Service Account JSON 等 |
| `token` | **仅 Superset** | JWT（弹窗委托登录或 SSO 换票） |

SSO token 注入逻辑 (`_inject_sso_token`) 也**仅对 `auth_mode() == "token"` 生效**。
这意味着：

- 如果新接入一个 Metabase（也接了同一个 SSO），它也需要 `token` 模式 + SSO 换票，但当前代码里 SSO 换票是 Superset 专属逻辑（硬编码在 `superset_auth_bridge.py` 中）
- 如果接入 Power BI（Azure AD OAuth），当前没有任何模式能描述"需要独立 OAuth 流程"
- `connection` 和 `token` 的二元划分无法表达"SSO 换票"、"独立 OAuth"、"API Key"等更细的区分

### 8.3 多系统场景下前端 vs 后端的影响放大

当系统数量从 1（Superset）增长到 N 时，两种策略的差距急剧扩大：

**前端持有所有 token（现状方向）**：

```
浏览器 localStorage:
  ├── sso_token          (y-sso-system)        — oidc-client-ts 管理
  ├── superset_jwt       (弹窗获取)             — 手动管理
  ├── metabase_session   (弹窗获取)             — 手动管理
  ├── azure_ad_token     (弹窗获取)             — 需要新的 OAuth 流程
  ├── google_token       (弹窗获取)             — 需要新的 OAuth 流程
  └── grafana_token      (弹窗获取)             — 手动管理

问题：
  ❌ N 个系统 = N 次弹窗授权
  ❌ Agent 无法访问任何一个（都在浏览器里）
  ❌ N 套独立的 token 续期逻辑
  ❌ 前端代码复杂度随 N 线性增长
```

**后端统一管理所有 token（推荐方向）**：

```
后端 Token Store:
  ├── sso_token           → 后端 Confidential Client 获取
  │   ├→ Superset JWT     → SSO 换票，自动续期
  │   ├→ Metabase Session → SSO 换票，自动续期
  │   └→ Grafana token    → SSO 换票，自动续期
  ├── azure_ad_token      → 后端 OAuth2 Confidential Client
  │   └→ Power BI         → 直接使用 Azure AD token
  ├── google_token        → 后端 OAuth2 Confidential Client
  │   └→ Google Sheets    → 直接使用 Google token
  └── mysql_credentials   → Vault（已有机制）

优势：
  ✅ 同 IdP 系统：一次 SSO 登录自动换 N 个凭证
  ✅ Agent 从 Token Store 取任何系统的凭证
  ✅ 后端统一 refresh，N 个系统复用同一套续期机制
  ✅ 前端只需"触发授权"，不管 token 存储和续期
```

### 8.4 通用 Token Store 设计

将方案 C 中的 Token Store 扩展为支持任意第三方系统的**分层凭证管理器**：

```
┌─ Token Store（后端统一凭证层）─────────────────────────────────────────┐
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Tier 1: SSO Token（源头凭证）                                     │  │
│  │                                                                  │  │
│  │  获取：后端 Confidential Client 登录时换取并存储                    │  │
│  │  续期：后端用 refresh_token 主动续期                               │  │
│  │  用途：DF 自身 API 身份验证 + 下游系统换票的"原材料"               │  │
│  └──────────────┬───────────────────────────────────────────────────┘  │
│                 │ 自动换票                                              │
│                 ▼                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Tier 2: 同 IdP 衍生凭证（SSO 换票自动获取）                       │  │
│  │                                                                  │  │
│  │  适用：Superset、Metabase、Grafana 等也接入同一 SSO 的系统         │  │
│  │  流程：SSO token → 目标系统的 /token-exchange 端点 → 系统专属凭证  │  │
│  │  续期：系统专属 refresh_token，或重新用 SSO token 换票             │  │
│  │  用户操作：零（登录 DF 后全自动）                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Tier 3: 独立 OAuth 凭证（不同 IdP，用户授权一次）                  │  │
│  │                                                                  │  │
│  │  适用：Power BI (Azure AD)、Google Sheets、Tableau 等             │  │
│  │  流程：后端发起 OAuth2 → 用户在弹窗/重定向中授权 → 后端存 token    │  │
│  │  续期：后端用 refresh_token 主动续期（与 SSO refresh 同一套机制）   │  │
│  │  用户操作：首次使用时授权一次，后续自动                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Tier 4: 静态凭据（已有 Vault 机制）                                │  │
│  │                                                                  │  │
│  │  适用：MySQL、MSSQL、PostgreSQL、MongoDB、S3、Azure Blob 等       │  │
│  │  流程：用户输入一次 → 加密存入 Vault → 后续自动读取                │  │
│  │  续期：不适用（静态凭据不过期，或由管理员轮换）                     │  │
│  │  用户操作：首次连接时输入，后续自动                                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  统一接口：                                                             │
│                                                                        │
│    token_store.get_access(user_id, system_id) → str | dict | None      │
│    ├── 自动判断 Tier（同 IdP 换票 > 独立 OAuth > Vault > 无）          │
│    ├── 自动续期（refresh_token / 重新换票）                             │
│    └── 对调用方透明（Agent/Connector 不关心凭证来源）                   │
│                                                                        │
│  调用示例：                                                             │
│    token_store.get_access(user_id, "superset")  → Superset JWT         │
│    token_store.get_access(user_id, "metabase")  → Metabase Session     │
│    token_store.get_access(user_id, "powerbi")   → Azure AD token       │
│    token_store.get_access(user_id, "mysql")     → {"user": .., "pass"} │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 8.5 Token Store 接口设计

```python
# auth/token_store.py

class TokenStore:
    """Unified credential manager for all third-party systems.

    Provides a single interface for Agent and Connectors to obtain
    access credentials regardless of the underlying auth mechanism
    (SSO exchange, independent OAuth, static credentials via Vault).
    """

    def get_access(self, user_id: str, system_id: str) -> str | dict | None:
        """Get access credentials for a specific system.

        Automatically resolves the best available credential source:
        1. Cached valid token (session)
        2. Refresh expired token (refresh_token)
        3. SSO token exchange (same IdP systems)
        4. Vault stored credentials (static)
        5. None (user authorization required)
        """
        config = self._get_system_config(system_id)
        if not config:
            return None

        # Try cached token first
        cached = self._get_cached(user_id, system_id)
        if cached and not self._is_expired(cached):
            return cached["access_token"]

        # Try refresh
        if cached and cached.get("refresh_token"):
            refreshed = self._refresh(system_id, cached["refresh_token"], config)
            if refreshed:
                self._store(user_id, system_id, refreshed)
                return refreshed["access_token"]

        # Try SSO token exchange (Tier 2 systems)
        if config.get("auth_type") == "sso_exchange":
            sso_token = self.get_sso_token(user_id)
            if sso_token:
                exchanged = self._exchange(system_id, sso_token, config)
                if exchanged:
                    self._store(user_id, system_id, exchanged)
                    return exchanged["access_token"]

        # Try Vault (Tier 4 systems)
        if config.get("auth_type") == "credentials":
            return self._get_from_vault(user_id, system_id)

        return None

    def get_sso_token(self, user_id: str) -> str | None:
        """Get the SSO access token (Tier 1)."""
        mode = os.environ.get("AUTH_MODE", "backend")
        if mode == "backend":
            token = session.get("sso_access_token")
            expires = session.get("sso_token_expires", 0)
            if token and expires > time.time():
                return token
            return self._refresh_sso_token()
        else:
            from data_formulator.auth.identity import get_sso_token
            return get_sso_token()

    def get_auth_status(self, user_id: str) -> dict[str, dict]:
        """Batch check authorization status for all configured systems.

        Used by Agent pre-flight check to determine which systems
        need user authorization before starting analysis.
        """
        results = {}
        for system_id, config in self._all_system_configs().items():
            access = self.get_access(user_id, system_id)
            results[system_id] = {
                "authorized": access is not None,
                "auth_type": config.get("auth_type"),
                "display_name": config.get("display_name", system_id),
                "requires_user_action": access is None
                    and config.get("auth_type") != "sso_exchange",
            }
        return results

    def _exchange(self, system_id: str, sso_token: str,
                  config: dict) -> dict | None:
        """Exchange SSO token for a system-specific token."""
        exchange_url = config.get("exchange_url")
        if not exchange_url:
            return None
        try:
            resp = requests.post(exchange_url,
                json={"sso_access_token": sso_token},
                timeout=config.get("timeout", 10))
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token"),
                "expires_at": time.time() + data.get("expires_in", 3600),
            }
        except Exception:
            return None

    def _refresh(self, system_id: str, refresh_token: str,
                 config: dict) -> dict | None:
        """Refresh an expired token using its refresh_token."""
        token_url = config.get("token_url")
        if not token_url:
            return None
        try:
            resp = requests.post(token_url, data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": config.get("client_id", ""),
                "client_secret": config.get("client_secret", ""),
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token", refresh_token),
                "expires_at": time.time() + data.get("expires_in", 3600),
            }
        except Exception:
            return None
```

### 8.6 auth_mode 从二元扩展为声明式

当前 `auth_mode()` 的 `"connection"` / `"token"` 二元区分需要升级为更具表达力的声明式配置，使 Token Store 和 DataConnector 能够自动处理不同系统的认证：

```python
# external_data_loader.py — 新增 auth_config（替代 auth_mode 的长期方案）

class ExternalDataLoader(ABC):

    @staticmethod
    def auth_config() -> dict:
        """Declare authentication requirements for this loader.

        Returned dict describes how the system authenticates, enabling
        the Token Store and DataConnector to handle token acquisition,
        exchange, refresh, and storage automatically.

        Keys:
            mode:          "credentials" | "sso_exchange" | "oauth2"
                           | "api_key" | "delegated"
            exchange_url:  (sso_exchange) Token exchange endpoint URL
            authorize_url: (oauth2) OAuth2 authorization endpoint
            token_url:     (oauth2) OAuth2 token endpoint
            scopes:        (oauth2) Required OAuth2 scopes
            client_id:     (oauth2) OAuth2 client ID (from env)
            login_url:     (delegated) Popup login URL
        """
        return {"mode": "credentials"}  # default: username/password via Vault
```

各类 Loader 的声明示例：

```python
# superset_data_loader.py — 同 IdP 换票
class SupersetLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        superset_url = os.environ.get("PLG_SUPERSET_URL", "")
        return {
            "mode": "sso_exchange",
            "exchange_url": f"{superset_url}/api/v1/df-token-exchange/",
            "display_name": "Superset",
            "login_url": f"{superset_url}/df-sso-bridge/",
            "supports_refresh": True,
        }

# (未来) metabase_data_loader.py — 同 IdP 换票
class MetabaseLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        metabase_url = os.environ.get("PLG_METABASE_URL", "")
        return {
            "mode": "sso_exchange",
            "exchange_url": f"{metabase_url}/api/df-token-exchange/",
            "display_name": "Metabase",
            "supports_refresh": False,
        }

# (未来) powerbi_data_loader.py — 独立 OAuth (Azure AD)
class PowerBILoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        tenant = os.environ.get("PLG_POWERBI_TENANT_ID", "common")
        return {
            "mode": "oauth2",
            "authorize_url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
            "token_url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            "scopes": "https://analysis.windows.net/powerbi/api/.default offline_access",
            "client_id_env": "PLG_POWERBI_CLIENT_ID",
            "client_secret_env": "PLG_POWERBI_CLIENT_SECRET",
            "display_name": "Power BI",
        }

# (未来) google_sheets_data_loader.py — 独立 OAuth (Google)
class GoogleSheetsLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        return {
            "mode": "oauth2",
            "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "scopes": "https://www.googleapis.com/auth/spreadsheets.readonly",
            "client_id_env": "PLG_GOOGLE_CLIENT_ID",
            "client_secret_env": "PLG_GOOGLE_CLIENT_SECRET",
            "display_name": "Google Sheets",
        }

# mysql_data_loader.py — 静态凭据（现有方式不变）
class MySQLDataLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        return {
            "mode": "credentials",
            "display_name": "MySQL",
        }
```

### 8.7 DataConnector 的配套改造

Token Store 和 auth_config 需要 DataConnector 做相应调整：

```python
# data_connector.py — 改造 _inject_sso_token 为通用的 _inject_credentials

def _inject_credentials(self, params: dict[str, Any]) -> None:
    """Inject the best available credentials based on auth_config."""
    config = self._loader_class.auth_config()
    mode = config.get("mode", "credentials")

    if mode == "credentials":
        # Tier 4: Vault — 现有逻辑不变
        return

    if mode == "sso_exchange":
        # Tier 2: 同 IdP 换票
        if params.get("access_token") or params.get("sso_access_token"):
            return
        token_store = TokenStore()
        access = token_store.get_access(self._get_identity(), self._source_id)
        if access:
            params["access_token"] = access

    elif mode == "oauth2":
        # Tier 3: 独立 OAuth
        if params.get("access_token"):
            return
        token_store = TokenStore()
        access = token_store.get_access(self._get_identity(), self._source_id)
        if access:
            params["access_token"] = access
```

### 8.8 Agent 与 Token Store 的交互

Agent 在执行数据分析任务时，通过 Token Store 统一获取所有系统的凭证：

```python
# Agent 执行前的预检（对应文档 8 的 Phase 1 设计）
class AgentDataSourceResolver:

    def __init__(self, token_store: TokenStore, user_id: str):
        self._store = token_store
        self._user_id = user_id

    def check_all_sources(self) -> dict:
        """Pre-flight check: which systems are accessible?"""
        status = self._store.get_auth_status(self._user_id)

        accessible = {k: v for k, v in status.items() if v["authorized"]}
        needs_action = {k: v for k, v in status.items()
                       if not v["authorized"] and v["requires_user_action"]}
        auto_retry = {k: v for k, v in status.items()
                     if not v["authorized"] and not v["requires_user_action"]}

        return {
            "accessible": accessible,        # Agent 可直接使用
            "needs_user_action": needs_action,# 需要用户弹窗授权
            "auto_retry_failed": auto_retry,  # SSO 换票失败（token 过期?）
        }
```

Token Store 的 `get_auth_status()` 方法为 Agent 提供批量预检能力，使 Agent 能在执行前一次性了解所有数据源的可用状态，而不是执行到一半再中断。

### 8.9 安全性分析

后端统一存储多系统 token 确实增加了服务端的安全责任，需要针对性防护：

| 安全关注点 | 风险 | 缓解措施 |
|-----------|------|---------|
| 服务端被攻破泄露所有 token | 高 | Session 加密存储；token 有 TTL 自动过期；不存长期有效的静态 token |
| 单个 token 泄露影响范围 | 中 | 每个系统的 token scope 最小化；Superset token 只有数据读取权限 |
| 跨系统权限提升 | 低 | SSO 换票时目标系统独立验证用户权限；DF 不能给用户增加目标系统中没有的权限 |
| Session 劫持 | 中 | HttpOnly + Secure + SameSite cookie；Session 绑定 IP（可选） |
| Vault 凭据与 OAuth token 混存 | 低 | Vault（长期静态）与 Token Store（短期动态）物理分离 |
| 后端 OAuth client_secret 管理 | 中 | 环境变量存储（已有模式）；生产环境用 Secret Manager |

**与前端存储的安全性对比**：

| 维度 | 前端 localStorage (N 个 token) | 后端 Token Store (N 个 token) |
|------|-------------------------------|-------------------------------|
| XSS 攻击 | ❌ 一次 XSS 可窃取所有 N 个 token | ✅ XSS 无法读取服务端 session |
| CSRF 攻击 | ✅ Bearer 不自动发送 | ⚠️ Cookie 自动发送，需要 CSRF 防护 |
| 物理攻击（设备丢失） | ❌ localStorage 可被提取 | ✅ 服务端 session 不在设备上 |
| 审计能力 | ❌ 前端 token 使用无法追踪 | ✅ 后端每次取 token 可记录审计日志 |
| Token 吊销 | ❌ 前端无法强制失效 | ✅ 服务端可立即清除所有 token |

**结论**：多系统场景下，后端统一管理 token 在安全性上**显著优于**前端分散存储，尤其是：
- 管理员可以一键吊销某用户的所有第三方系统凭证
- 审计日志可以追踪"谁在什么时候用了哪个系统的 token"
- XSS 攻击面从 N 个 token 缩减到零

### 8.10 与现有架构的兼容性

Token Store 的引入不需要一次性重写所有 Loader：

| Loader | 当前 auth_mode | 改造策略 |
|--------|---------------|---------|
| Superset | `token` | Phase 1：加 `auth_config(mode="sso_exchange")`，Token Store 接管换票 |
| MySQL, MSSQL 等 | `connection` | 不改动：继续用 Vault，auth_config 默认返回 `mode="credentials"` |
| (未来) Metabase | 新增 | 新 Loader + `auth_config(mode="sso_exchange")` |
| (未来) Power BI | 新增 | 新 Loader + `auth_config(mode="oauth2")` |

**向后兼容保证**：
- `auth_mode()` 保留不删，`auth_config()` 作为增强版共存
- 未声明 `auth_config` 的 Loader 按 `auth_mode` 回退
- DataConnector 优先读 `auth_config`，没有则用 `auth_mode` 旧逻辑
- Vault 机制完全不变

---

## 9. 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 是否立即迁移到 Confidential Client | 否（Phase 2） | 当前可用方案 A 快速解决 Agent 问题，大重构需充分测试 |
| 后端 token 存储方式 | Flask Session → Redis | 初期用 Flask Session 足够，token 量大后迁移 Redis |
| 是否保留前端 OIDC 作为降级 | 是 | 方案 C 混合模式支持两种部署场景 |
| CSRF 防护（Confidential Client 模式） | Flask-WTF / 双重 cookie | Session-based 认证必须防 CSRF |
| SSO 注册策略 | 新建 Confidential Client | 不影响现有 Public Client，可并行运行 |
| Token Store 是否通用化 | 是 | 从设计阶段就支持多系统，避免后续重构 |
| auth_mode 扩展方式 | 新增 auth_config 共存 | 向后兼容，不破坏现有 Loader |
| 安全策略 | 后端统一存储 + 审计日志 | 多系统场景下后端存储安全性远优于前端分散存储 |

---

## 10. 实施路线图（更新版）

结合多系统凭证管理需求，更新分阶段实施计划：

### Phase 0（立即）：Token Cache + SSO 门户修复

- 后端加 Token Cache 层（方案 A），Agent 可"搭便车"
- SSO 门户 `handleAppClick` 修复公开客户端跳转（文档 10）
- **不改 auth_mode 抽象，不改 Loader 接口**

### Phase 1（短期）：后端 Confidential Client

- DF 后端新增 OIDC Gateway (`/api/auth/oidc/login`, `/callback`)
- 前端从 `oidc-client-ts` 迁移到 302 跳转
- Session 持久化 SSO token + refresh_token
- 去除 HTTPS 强制要求
- **解锁后端主动续期能力**

### Phase 2（中期）：Token Store + auth_config

- 新增 `TokenStore` 统一凭证管理器
- 新增 `auth_config()` 声明式接口（与 `auth_mode()` 共存）
- SupersetLoader 改用 `auth_config(mode="sso_exchange")`
- DataConnector 的 `_inject_sso_token` 升级为 `_inject_credentials`
- Agent 预检接口 `/api/auth/service-status`
- **此阶段完成后，新增同 IdP 系统只需写 Loader + auth_config**

### Phase 3（长期）：多 IdP OAuth + 新系统接入

- 后端 OAuth2 代理（支持 Azure AD、Google 等独立 IdP）
- `/api/auth/oauth/{system_id}/login` 和 `/callback` 通用路由
- Power BI、Google Sheets 等新 Loader
- Agent 全自动数据访问（Phase 1 设计的 AuthGate 完整实现）

---

## 11. 附录：当前代码中的关键位置

| 组件 | 文件路径 | 说明 |
|------|----------|------|
| OIDC 配置 | `src/app/oidcConfig.ts` | 前端 UserManager, PKCE |
| Bearer 附加 | `src/app/utils.tsx:147-238` | fetchWithIdentity |
| 后端验证 | `py-src/.../auth/providers/oidc.py` | JWKS/UserInfo 验证 |
| Auth 入口 | `py-src/.../auth/identity.py` | get_identity_id, get_sso_token |
| SSO Token 注入 | `py-src/.../data_connector.py:336-349` | _inject_sso_token |
| SSO 自动连接 | `py-src/.../data_connector.py:351-376` | _try_sso_auto_connect |
| Superset 换票 | `py-src/.../data_loader/superset_auth_bridge.py` | exchange_sso_token |
| Superset 加载器 | `py-src/.../data_loader/superset_data_loader.py` | _try_sso_exchange |
| auth_mode 基类 | `py-src/.../data_loader/external_data_loader.py:659-663` | `"connection"` / `"token"` 二元 |
| Loader 注册表 | `py-src/.../data_loader/__init__.py:25-38` | 12 种已注册 loader |
| Vault 存取 | `py-src/.../data_connector.py:220-276` | 静态凭据加密存储 |
| 前端登录按钮 | `src/app/AuthButton.tsx` | handleSignIn → signinRedirect |
| 回调处理 | `src/app/OidcCallback.tsx` | signinRedirectCallback |
| SSO 门户 | `y-sso-system/.../SSOLogin.vue:290-320` | handleAppClick (BUG) |
| SSO 授权端点 | `y-sso-system/.../oauth2.py:121-300` | GET/POST /authorize |
