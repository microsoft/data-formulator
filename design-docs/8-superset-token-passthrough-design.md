# 8. Superset Token 透传与 Agent 数据源授权设计

> 状态：设计阶段  
> 创建日期：2026-04-15  
> 关联：`1-data-source-plugin-architecture.md`、`1-sso-plugin-architecture.md`

---

## 1. 背景与问题

### 1.1 当前架构

DF 与 Superset 的认证是两条独立的链路：

```
DF 认证链路：
  用户 → SSO (y-sso-system) → DF 获得 SSO access_token
  → 用于 DF 自身 API 的身份验证

Superset 认证链路：
  用户 → SSO Bridge 弹窗 → Superset OAuth → Superset 签发自己的 JWT
  → 用于 Superset API 的身份验证
```

两个 token 是不同系统签发的、格式不同、密钥不同：

| 属性 | SSO access_token | Superset JWT |
|------|-----------------|--------------|
| 签发方 | y-sso-system | Superset (flask_jwt_extended) |
| payload | `{ sub: "zhangsan", iss: "sso.example.com" }` | `{ identity: "42", fresh: true }` |
| 签名密钥 | SSO 的密钥 | Superset 的 `SECRET_KEY` |
| 用途 | DF API 认证 | Superset API 认证 |

**核心限制**：Superset 原生不支持外部 token 的直接使用。这是 OAuth2/OIDC 协议的标准设计——每个资源服务器只信任自己签发的凭证。Google、Microsoft 等所有系统都遵循同样的原则。

### 1.2 为什么需要 Token 透传

DF 未来将引入 **Agent 自动化数据分析** 功能：

```
用户提出分析需求
  → Agent 自动扫描所有数据源（包括 Superset 插件）
  → Agent 自动判断哪些数据集与分析目标相关
  → Agent 自动拉取数据
  → Agent 完成分析并生成可视化
```

在当前的 Bridge 弹窗方案下，Agent 无法自主完成 Superset 数据的读取：

```
Agent 要读 Superset 数据
  → DF 后端发现没有 Superset JWT
  → 返回 "未授权"
  → 前端需要弹窗让用户手动授权  ← Agent 被阻断
```

**目标**：设计一套机制，使 Agent 能够在最少人工干预的情况下访问 Superset 数据源。

---

## 2. 方案设计

采用**渐进式策略**：先实现"按需授权"（Phase 1），待 Agent 功能成熟后升级为"自动换票"（Phase 2）。两个阶段不冲突，Phase 2 是 Phase 1 的超集。

### 2.1 Phase 1：Agent 按需授权（推荐先实现）

#### 核心思路

Agent 运行时检测数据源授权状态，对未授权的数据源暂停并提示用户一次性授权，授权完成后继续执行。

#### 交互流程

```
用户：帮我分析上个月的销售数据

Agent：正在扫描可用数据源...
       ┌──────────────────────────────────────────┐
       │  Superset 数据源需要您的授权               │
       │                                          │
       │  Agent 需要读取 Superset 中的数据          │
       │  来完成本次分析。                          │
       │  授权后本次会话内不再需要重复操作。          │
       │                                          │
       │              [ 点击授权 ]                  │
       └──────────────────────────────────────────┘

用户：（点击 → SSO 弹窗秒过 → 关闭）

Agent：已获取 Superset 授权，继续分析...
       发现以下相关数据集：
       - sales_monthly（月度销售汇总）
       - product_catalog（产品目录）
       正在拉取数据...
```

#### 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                     DF 前端                              │
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  Agent   │───→│ DataSource   │───→│ Superset SSO  │  │
│  │  Runtime │    │ AuthGate     │    │ Bridge Popup  │  │
│  │          │←───│ (新增)       │←───│ (已有)        │  │
│  └──────────┘    └──────────────┘    └───────────────┘  │
│       │                                     │           │
│       ▼                                     ▼           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  fetchWithIdentity → DF Backend API              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                     DF 后端                              │
│                                                         │
│  ┌──────────────┐    ┌───────────────┐                  │
│  │ Plugin Auth  │───→│ Superset      │                  │
│  │ require_auth │    │ Client        │                  │
│  │ (已有)       │    │ Bearer JWT    │                  │
│  └──────────────┘    └───────────────┘                  │
│         │                    │                          │
│         ▼                    ▼                          │
│  ┌──────────────┐    ┌───────────────┐                  │
│  │ Flask Session │    │ Superset API  │                  │
│  │ JWT 存储      │    │ (外部)        │                  │
│  └──────────────┘    └───────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

#### 需要改动的代码

**前端新增：DataSource AuthGate 组件**

Agent 执行前，检查所有目标数据源的授权状态：

```typescript
interface DataSourceAuthStatus {
  pluginId: string;        // e.g. "superset"
  name: string;            // e.g. "Superset (生产)"
  authorized: boolean;
  authMethod: "sso" | "password" | "guest";
}

// Agent 运行时调用
async function ensureDataSourcesAuthorized(
  requiredSources: string[]
): Promise<{ allAuthorized: boolean; pending: DataSourceAuthStatus[] }> {
  const statuses = await Promise.all(
    requiredSources.map(id => checkPluginAuthStatus(id))
  );
  const pending = statuses.filter(s => !s.authorized);
  return { allAuthorized: pending.length === 0, pending };
}
```

**后端新增：批量授权状态查询端点**

```python
# GET /api/plugins/auth-status
# 返回所有已启用插件的授权状态
@app.route("/api/plugins/auth-status")
def plugins_auth_status():
    results = {}
    for plugin_id, plugin in enabled_plugins.items():
        token, user = plugin.require_auth()
        results[plugin_id] = {
            "authorized": token is not None,
            "user": user,
            "expires_soon": is_token_expiring_soon(token),
        }
    return jsonify(results)
```

**Agent 层面：授权中断与恢复**

```python
class AgentDataSourceResolver:
    async def resolve_sources(self, query: str) -> list[DataSource]:
        sources = self.scan_available_sources()
        unauthorized = [s for s in sources if not s.is_authorized]

        if unauthorized:
            # 向前端发送授权请求，Agent 暂停
            await self.request_user_authorization(unauthorized)
            # 用户完成授权后，前端通知 Agent 恢复
            sources = self.scan_available_sources()

        return sources
```

#### 用户体验优化

1. **SSO 同源快速授权**：用户已登录 DF SSO，弹出 Superset OAuth 窗口时，由于同一 SSO，可能直接跳过登录页秒级完成
2. **Session 持久化**：一次授权后 JWT 存入 session（含 refresh_token），整个会话期间无需重复授权
3. **预检提示**：Agent 开始前就检测授权状态，而非执行到一半再中断
4. **批量授权**：如果有多个数据源未授权，一次性列出让用户逐个点击，不会反复中断

---

### 2.2 Phase 2：自动 Token Exchange（后续升级）

#### 核心思路

在 Superset 侧新增一个自定义端点，接受 SSO access_token 并返回 Superset JWT。DF 后端在用户登录时自动完成换票，Agent 全程无感知。

#### 交互流程

```
用户登录 DF (SSO)
  → DF 后端检测到用户有 SSO access_token
  → 自动调用 Superset 的 /api/v1/df-token-exchange/
  → Superset 验证 SSO token → 签发 Superset JWT → 返回
  → DF 后端存入 session
  → Agent 直接使用，无任何用户交互
```

#### Superset 侧：Token Exchange 端点

```python
# 部署在 Superset 的 oauth_config.py 中
from flask_appbuilder import BaseView, expose
from flask import request, jsonify, current_app
from flask_jwt_extended import create_access_token, create_refresh_token
import requests

class TokenExchangeView(BaseView):
    """
    接受外部 SSO access_token，验证后签发 Superset JWT。
    仅供受信任的内部系统（如 DF）调用。
    """
    route_base = "/api/v1/df-token-exchange"

    @expose("/", methods=["POST"])
    def exchange(self):
        data = request.get_json(force=True)
        sso_token = data.get("sso_access_token")
        if not sso_token:
            return jsonify({"error": "missing_token"}), 400

        # 1. 用 SSO token 获取用户信息
        sso_userinfo_url = current_app.config.get("SSO_USERINFO_URL")
        try:
            resp = requests.get(
                sso_userinfo_url,
                headers={"Authorization": f"Bearer {sso_token}"},
                timeout=5,
            )
            resp.raise_for_status()
            user_info = resp.json()
        except Exception:
            return jsonify({"error": "sso_token_invalid"}), 401

        username = user_info.get("preferred_username") or user_info.get("username")
        if not username:
            return jsonify({"error": "no_username_in_token"}), 401

        # 2. 在 Superset 中查找用户
        sm = current_app.appbuilder.sm
        user = sm.find_user(username=username)
        if not user or not user.is_active:
            return jsonify({"error": "user_not_in_superset"}), 403

        # 3. 签发 Superset JWT
        access_token = create_access_token(
            identity=str(user.id), fresh=True
        )
        refresh_token = create_refresh_token(identity=str(user.id))

        return jsonify({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": user.id,
                "username": user.username,
                "first_name": user.first_name,
                "last_name": user.last_name,
            },
        })
```

注册方式（在 `FLASK_APP_MUTATOR` 中）：

```python
def mutator(app):
    with app.app_context():
        appbuilder = app.extensions["appbuilder"]
        appbuilder.add_view_no_menu(TokenExchangeView())
```

#### DF 侧：自动换票逻辑

```python
# auth_bridge.py 新增
class SupersetAuthBridge:
    def exchange_sso_token(self, sso_access_token: str) -> dict:
        """用 SSO access_token 换取 Superset JWT。"""
        resp = requests.post(
            f"{self.superset_url}/api/v1/df-token-exchange/",
            json={"sso_access_token": sso_access_token},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
```

```python
# session_helpers.py 中 require_auth() 增加优先级
def require_auth() -> tuple[Optional[str], Optional[dict]]:
    token = get_token()
    user = get_user()

    # 优先级 1：已有有效 Superset JWT
    if token and not is_token_expired(token):
        return token, user

    # 优先级 2：JWT 过期，尝试 refresh
    if token and is_token_expired(token):
        token = try_refresh()
        if token:
            return token, get_user()

    # 优先级 3（Phase 2 新增）：用 OIDC token 自动换票
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        sso_token = auth_header[7:]
        try:
            result = _bridge.exchange_sso_token(sso_token)
            superset_token = result["access_token"]
            user_info = result.get("user", {})
            save_session(
                superset_token, user_info, result.get("refresh_token")
            )
            return superset_token, user_info
        except Exception:
            pass  # 换票失败，降级到下一优先级

    # 优先级 4：访客模式
    return None, user
```

#### 安全措施

| 安全关注点 | 应对措施 |
|-----------|---------|
| Token Exchange 端点被外部调用 | 配置 IP 白名单，只允许 DF 服务器 IP 访问 |
| SSO token 泄露导致 Superset 越权 | token 有效期短（通常 5-30 分钟），且权限受限于该用户在 Superset 中的角色 |
| 中间人攻击 | DF → Superset 通信走内网或 HTTPS |
| 用户在 Superset 中不存在 | 返回 403，降级为 Phase 1 的弹窗授权流程 |

---

## 3. 数据源授权优先级（完整策略）

```
┌──────────────────────────────────────────────────────┐
│              DF 访问 Superset 数据策略                 │
├──────────────────────────────────────────────────────┤
│                                                      │
│  优先级 1：Session 中已有有效 Superset JWT             │
│    → 直接使用（当前已实现）                            │
│                                                      │
│  优先级 2：JWT 过期 + 存在 refresh_token              │
│    → 调 Superset /api/v1/security/refresh 续期        │
│    → 更新 Session（当前已实现）                        │
│                                                      │
│  优先级 3：用户有 SSO Token（Phase 2）                 │
│    → 后端自动调 Token Exchange 端点                    │
│    → 换取 Superset JWT，存入 Session                  │
│                                                      │
│  优先级 4：上述均无 → 提示用户授权（Phase 1）           │
│    → Agent 暂停，前端弹出授权提示                      │
│    → 用户点击 → Bridge 弹窗 → 拿到 JWT                │
│    → Agent 恢复执行                                   │
│                                                      │
│  优先级 5：用户拒绝授权或无账号                        │
│    → 访客模式（仅公开数据）                            │
│    → Agent 在受限范围内尽力分析                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 4. 实施路线图

### Phase 1（与 Agent 功能同步开发）

| 任务 | 改动范围 | 工作量 |
|------|---------|--------|
| 新增 `/api/plugins/auth-status` 端点 | DF 后端 | 小 |
| Agent 前置授权检查 (`ensureDataSourcesAuthorized`) | DF 前端 | 中 |
| Agent 暂停/恢复机制 | Agent Runtime | 中 |
| 授权提示 UI 组件 | DF 前端 | 小 |

**改动文件**：
- `py-src/data_formulator/plugins/superset/routes/auth.py` — 新增 auth-status
- `src/plugins/superset/SupersetLogin.tsx` — 供 Agent 调用的授权入口
- Agent Runtime（待开发）— 暂停/恢复逻辑

**不需要改动 Superset**。

### Phase 2（Agent 功能成熟后按需升级）

| 任务 | 改动范围 | 工作量 |
|------|---------|--------|
| Superset 新增 `TokenExchangeView` | Superset oauth_config.py | 中 |
| DF `auth_bridge.py` 新增 `exchange_sso_token` | DF 后端 | 小 |
| DF `session_helpers.py` 增加优先级 3 逻辑 | DF 后端 | 小 |
| 安全配置（IP 白名单等） | Superset 部署配置 | 小 |

**需要改动 Superset 配置**（`oauth_config.py`、`FLASK_APP_MUTATOR`）。

---

## 5. 对其他数据源插件的通用性

此设计模式不限于 Superset，可推广到任何需要独立认证的数据源插件：

```typescript
interface DataSourcePlugin {
  id: string;
  checkAuthStatus(): Promise<AuthStatus>;

  // Phase 1: 交互式授权
  requestInteractiveAuth(): Promise<void>;

  // Phase 2: 自动换票（可选实现）
  exchangeToken?(ssoToken: string): Promise<void>;
}
```

未来如果接入 Grafana、Metabase、PowerBI 等数据源，同样可以复用这套：

1. Agent 前置检查所有数据源的授权状态
2. 未授权的先暂停提示用户点击
3. 如果该数据源支持 Token Exchange，则自动完成

---

## 6. 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 是否用 Service Account 全局访问 | 否 | 多用户环境需要尊重个人数据权限 |
| Phase 1 vs 直接做 Phase 2 | 先 Phase 1 | Agent 功能尚未开发，过早做 Token Exchange 意义不大；Phase 1 零 Superset 改动成本 |
| 按需授权是否阻断 Agent | 仅暂停 | Agent 暂停等待授权后自动恢复，不终止整个分析流程 |
| Token Exchange 是否标准协议 | 自定义端点 | OAuth2 Token Exchange (RFC 8693) Superset 不支持，自建端点更可控 |
| 授权提示时机 | Agent 执行前预检 | 避免分析进行到一半再中断，体验更好 |
