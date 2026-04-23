# 10. SSO 门户一键无感登录设计

> 状态：设计阶段  
> 创建日期：2026-04-23  
> 关联：`1-sso-plugin-architecture.md`、`8-superset-token-passthrough-design.md`

---

## 1. 背景与问题

### 1.1 当前状况

DF 在 SSO (y-sso-system) 中注册为 **公开客户端 (Public Client)**，使用 **PKCE (Proof Key for Code Exchange)** 进行 OAuth2 授权码流程。PKCE 的安全模型要求：

- `code_verifier` 由**发起方 (DF 前端)** 生成并保留在本地
- `code_challenge = SHA256(code_verifier)` 发送给授权服务器
- Token 交换时 DF 用 `code_verifier` 证明自己是原始发起方

SSO 门户的 `SSOLogin.vue` 中 `handleAppClick` 存在两条路径：

```
路径 A（BUG）：uris.length <= 1 时，直接 POST /authorize，缺少 PKCE 参数 → 400
路径 B（正确）：uris.length > 1 时，window.open(uris[1]) 打开应用首页
```

### 1.2 临时修复

给 DF 配置两个 `redirect_uri`，使 `handleAppClick` 走路径 B（已完成）。
但用户体验是两步：SSO 门户 → DF 首页 → 点"SSO Login"。

### 1.3 目标

SSO 门户点击应用卡片后，用户**一键无感**进入 DF 并自动完成登录——无需在 DF 首页再点一次登录按钮。

---

## 2. 方案 A：Callback 触发自动登录（推荐先实现）

### 2.1 核心思路

SSO 门户不走 POST `/authorize`，而是将用户重定向到 DF 的 `/callback` 页面。
DF 的 `OidcCallback` 组件检测到无 `code`/`state` 参数后，自动发起标准 PKCE 登录流程。
由于用户已在 SSO 登录，授权服务器的 GET `/authorize` 检测到有效 cookie 后自动签发授权码，全程无感。

### 2.2 交互流程

```
用户在 SSO 门户点击 DF 应用卡片
  │
  ▼
handleAppClick 检测 app.is_public
  │
  ├── is_public = true
  │   ▼
  │   window.open("https://df-domain/callback?from=sso", "_blank")
  │   │
  │   ▼
  │   OidcCallback 组件加载
  │   检测 URL 参数：无 code，无 state
  │   │
  │   ▼
  │   mgr.signinRedirect()
  │   自动生成 code_verifier + code_challenge
  │   │
  │   ▼
  │   302 → SSO GET /authorize?...&code_challenge=xxx
  │   SSO 检测到用户已登录（JWT cookie 有效）
  │   │
  │   ▼
  │   自动签发 authorization_code
  │   302 → https://df-domain/callback?code=yyy&state=zzz
  │   │
  │   ▼
  │   OidcCallback: signinRedirectCallback()
  │   用 code + code_verifier 换取 access_token
  │   │
  │   ▼
  │   window.location.href = "/"
  │   进入 DF 首页，已登录 ✓
  │
  ├── is_public = false (机密客户端)
  │   ▼
  │   原有 POST /authorize 逻辑（不需要 PKCE）
```

### 2.3 需要改动的代码

#### SSO 端：`SSOLogin.vue` — `handleAppClick`

**文件**：`y-sso-system/frontend/src/pages/SSOLogin.vue`

**前提**：后端返回的应用列表需包含 `client_type` 或 `is_public` 字段。

```javascript
// 改造后的 handleAppClick
async function handleAppClick(app) {
  const uris = app.redirect_uris
  if (!uris || uris.length === 0) {
    ElMessage.warning('该应用未配置重定向地址')
    return
  }

  // 公开客户端 (SPA)：PKCE 只能由应用端发起，门户无法代劳
  // 直接跳转到应用的 callback 触发 SP-initiated 登录
  if (app.client_type === 'public') {
    const callbackUrl = new URL(uris[0])  // 第一个 URI 是 /callback
    callbackUrl.searchParams.set('from', 'sso')
    window.open(callbackUrl.toString(), '_blank')
    return
  }

  // 机密客户端或多 URI 情况：保持原有逻辑
  if (uris.length > 1) {
    window.open(uris[1], '_blank')
  } else {
    jumpingAppId.value = app.id
    try {
      const response = await oauth2Api.authorize({
        client_id: app.client_id,
        redirect_uri: uris[0],
        scope: 'openid profile email',
        state: null,
      })
      const redirectUrl = response.data?.redirect_url || response.redirect_url
      if (redirectUrl) {
        window.open(redirectUrl, '_blank')
      } else {
        ElMessage.error('授权失败：未获取到重定向地址')
      }
    } catch (error) {
      handleApiError(error, '授权失败')
    } finally {
      jumpingAppId.value = null
    }
  }
}
```

**改动量**：约 8 行新代码。

#### SSO 端：应用列表 API 返回 `client_type`

确认 `/api/v1/applications` 或门户使用的应用列表接口返回了 `client_type` 字段。
如果目前 DTO 中没有此字段，需要在序列化时加上。

#### DF 端：`OidcCallback.tsx` — 支持无参数触发

**文件**：`data-formulator/src/app/OidcCallback.tsx`

```typescript
useEffect(() => {
    (async () => {
        try {
            const mgr = await getUserManager();
            if (!mgr) return;

            const params = new URLSearchParams(window.location.search);

            // Case 1: SSO 门户直接跳转过来（无 code、无 state）
            // 发起标准 PKCE 登录，用户已在 SSO 登录则全程无感
            if (!params.get("code") && !params.get("state")) {
                setRedirecting(true);
                await mgr.signinRedirect();
                return;
            }

            // Case 2: IdP-initiated（有 code 无 state）
            // 丢弃此 code，重新发起 SP 流程
            if (!params.get("state") && params.get("code")) {
                setRedirecting(true);
                await mgr.signinRedirect();
                return;
            }

            // Case 3: 正常 SP-initiated 回调（有 code + state）
            await mgr.signinRedirectCallback();
            window.location.href = "/";
        } catch (err: any) {
            setError(err?.message || "Unknown error");
        }
    })();
}, []);
```

**改动量**：约 6 行新代码。

### 2.4 边界情况处理

| 场景 | 行为 |
|------|------|
| 用户已在 SSO 登录 | SSO GET /authorize 自动签发 code，全程无感 (~1s) |
| 用户未在 SSO 登录 | signinRedirect 跳转到 SSO 登录页，用户输入密码后回到 DF |
| DF 已有有效登录态 | OidcCallback 可在 signinRedirect 前检查，如已登录直接跳首页 |
| 用户在 SSO 门户但 token 已过期 | SSO 的 GET /authorize 会引导到登录页 |
| 非 HTTPS 环境 | `getUserManager()` 抛出 crypto.subtle 错误，OidcCallback 显示错误信息 |

### 2.5 安全性分析

| 关注点 | 分析 |
|--------|------|
| PKCE 完整性 | 完全由 `oidc-client-ts` 的 `signinRedirect` 生成，与正常登录流程一致 |
| CSRF | oidc-client-ts 自动生成 `state` 参数并校验 |
| 开放重定向 | `/callback` 本身不接受外部 redirect 参数，只触发 signinRedirect |
| 恶意跳转到 `/callback` | 只会触发 SSO 登录流程，无安全风险 |

---

## 3. 方案 B：`initiate_login_uri` 标准化（长期方案）

### 3.1 核心思路

在 SSO 的应用模型中新增 `initiate_login_uri` 字段（源自 OpenID Connect 规范），专门用于"从外部触发应用登录"的场景。这是 OIDC 标准推荐的做法。

### 3.2 应用模型变更

**文件**：`y-sso-system/app/domain/application/entities.py`

```python
class Application(Base):
    # ... 已有字段 ...

    initiate_login_uri: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True,
        comment="OIDC 第三方登录入口 URI（门户点击后跳转到此地址触发应用登录）"
    )
```

### 3.3 SSO 门户改动

```javascript
async function handleAppClick(app) {
  const uris = app.redirect_uris
  if (!uris || uris.length === 0) {
    ElMessage.warning('该应用未配置重定向地址')
    return
  }

  // 优先使用 initiate_login_uri（OIDC 标准）
  if (app.initiate_login_uri) {
    window.open(app.initiate_login_uri, '_blank')
    return
  }

  // 公开客户端回退：跳转 callback
  if (app.client_type === 'public') {
    const callbackUrl = new URL(uris[0])
    callbackUrl.searchParams.set('from', 'sso')
    window.open(callbackUrl.toString(), '_blank')
    return
  }

  // 机密客户端：原有逻辑
  // ...
}
```

### 3.4 DF 侧配置

在 SSO 管理后台中，为 DF 应用设置：

```
initiate_login_uri = https://df-domain/callback
```

DF 端 `OidcCallback.tsx` 的改动与方案 A 完全相同。

### 3.5 数据库迁移

```python
# alembic revision
def upgrade():
    op.add_column(
        'application',
        sa.Column('initiate_login_uri', sa.String(500), nullable=True,
                  comment='OIDC 第三方登录入口 URI')
    )

def downgrade():
    op.drop_column('application', 'initiate_login_uri')
```

### 3.6 适用场景扩展

`initiate_login_uri` 不仅适用于 DF，未来任何接入 SSO 的 SPA 应用都可以使用：

```
initiate_login_uri 示例：
  DF:       https://df.example.com/callback
  Grafana:  https://grafana.example.com/login/generic_oauth
  Wiki:     https://wiki.example.com/auth/oidc/callback
```

---

## 4. 方案对比与建议

| | 方案 A：Callback 触发 | 方案 B：initiate_login_uri |
|---|---|---|
| 改动范围 | SSO 前端 + DF 前端 | SSO 全栈 + DF 前端 |
| 改动量 | ~15 行 | ~40 行 + DB 迁移 |
| 标准性 | 合理但非标准 | OIDC 标准推荐 |
| 灵活性 | 依赖 redirect_uri 推导 | 每个应用独立配置 |
| 对其他应用 | 需按 client_type 判断 | 通用，任何应用都可配 |

**建议**：

1. **立即实施方案 A**——改动最小，立即解决用户体验问题
2. **后续迭代中实施方案 B**——作为 SSO 平台的标准化升级，增加 `initiate_login_uri` 字段

两个方案在 DF 端的改动完全相同（`OidcCallback.tsx`），不存在冲突。

---

## 5. 实施清单

### Phase 1：方案 A（立即）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| SSO 应用列表 API 返回 `client_type` | SSO 后端 DTO | 小 |
| `handleAppClick` 公开客户端分支 | `SSOLogin.vue` | 小 |
| `OidcCallback` 无参数触发 | `OidcCallback.tsx` | 小 |
| 端到端测试 | - | 小 |

### Phase 2：方案 B（后续迭代）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| Application 模型新增字段 | `entities.py` | 小 |
| Alembic 迁移 | migration | 小 |
| 应用管理 UI 新增字段 | SSO 前端 | 小 |
| `handleAppClick` 优先使用 `initiate_login_uri` | `SSOLogin.vue` | 小 |
| 为 DF 应用配置 `initiate_login_uri` | SSO 管理后台 | 小 |
