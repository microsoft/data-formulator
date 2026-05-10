# ISSUE-007: SSO 登录态前后端不一致 + 退出登录未清空状态 + 偶发未知错误

> 状态：待修复
> 日期：2026-05-11
> 影响范围：`src/app/AuthButton.tsx`、`src/app/App.tsx`、`src/app/utils.tsx`
> 关联：`py-src/data_formulator/auth/identity.py`、`py-src/data_formulator/auth/gateways/oidc_gateway.py`

---

## 1. 问题总述

Backend OIDC（SSO）模式下存在三个相互关联的身份/会话管理问题：

1. **前后端 identity 不一致** — 后端已通过 Flask session 识别到 SSO 用户并将数据存入
   用户文件夹，但前端仍显示"未登录"（browser identity）
2. **退出登录后旧数据残留** — 前用户的 tables、charts、messages 等留在浏览器中（安全问题）
3. **退出时偶尔报"未知错误"** — 刷新后恢复，但退出操作实际未完成

---

## 2. Bug 详情

### Bug A：前后端 Identity 不一致 — 后端是 SSO 用户，前端显示未登录

**现象**：用户通过 Superset SSO 弹窗完成授权后，拉取数据并分析。此时：
- 前端 UI 仍显示"未登录"状态（identity = `browser:<uuid>`）
- 但后端文件存储中，数据已写入 SSO 用户的文件夹（identity = `user:xxx`）

**根因**：前端和后端使用了**两套独立的 identity 判定机制**，且在某些场景下会产生分歧。

**后端** — `get_identity_id()`（`auth/identity.py:165`）的判定优先级：

```
1. OIDC Provider（Flask session cookie） → user:xxx   ← 最高优先级
2. 单机 localhost 模式                     → local:xxx
3. 匿名回退（X-Identity-Id header）       → browser:uuid  ← 最低优先级
```

**前端** — identity 只在页面加载时检查一次（`App.tsx:1018-1101`）：

```typescript
useEffect(() => {
    if (!configLoaded) return;
    (async () => {
        // ...
        if (info?.action === 'backend') {
            const { data: status } = await apiRequest('/api/auth/oidc/status');
            if (status.authenticated && status.user) {
                resolvedIdentity = { type: 'user', ... };
            }
        }
        // ...
        dispatch(dfActions.setIdentity(resolvedIdentity));
    })();
}, [configLoaded]);  // ← 只在 configLoaded 变化时运行，整个生命周期通常只执行一次
```

**分歧发生的场景**：

```
时间线：
t0  用户打开 DF 页面
t1  App.tsx useEffect 运行 → 调 /api/auth/oidc/status → 未认证
                            → 前端 identity = browser:uuid
t2  用户点击 Superset 连接器 → SSO 弹窗打开
t3  弹窗完成 → Superset token 保存到后端 Flask session
    （如果 DF 和 Superset 共享 IdP，此时 DF 的 OIDC session 也可能已建立）
t4  用户通过 Superset 连接器拉取数据
    → 前端发请求，header: X-Identity-Id: browser:uuid
    → 后端 get_identity_id() 先检查 OIDC provider（Flask session）
    → Flask session 中有有效的 SSO token → 返回 user:xxx（忽略 header）
    → 数据存入 user:xxx 的 workspace 文件夹
t5  前端 UI 仍显示 browser identity（"未登录"）
    → 状态不一致：后端认为是 user:xxx，前端认为是 browser:uuid
```

**核心问题**：前端 identity 检查是**一次性**的（页面加载时），之后不会再更新。
但后端 OIDC session 可能在页面生命周期中通过 Superset SSO 弹窗等间接途径建立。
一旦后端 session 建立，`get_identity_id()` 就优先返回 SSO 用户 identity，
而前端完全不知道这个变化。

**后果**：
- 用户困惑：UI 显示未登录，但操作却成功了
- 数据错位：前端以为是 browser workspace，后端实际是 user workspace
- workspace 列表不对：前端请求列表时发送 `browser:uuid`，但后端返回的是 `user:xxx` 的数据

---

### Bug B：退出登录未清空浏览器持久化状态

**现象**：SSO 用户点击退出后，页面跳转到首页，但前一个用户 session 的 tables、charts、
chat messages、connector 配置仍然残留。新用户登录后看到的是旧数据混合态。

**根因**：`handleSignOut` 中 Backend 模式使用了 `persistor.flush()` 而非 `persistor.purge()`。

当前代码（`AuthButton.tsx:63-72`）：

```typescript
const handleSignOut = useCallback(async () => {
    if (isBackend) {
        await apiRequest(authInfo?.logout_url || "/api/auth/oidc/logout", { method: "POST" });
        const browserId = getBrowserId();
        dispatch(dfActions.setIdentity({ type: "browser", id: browserId }));
        localStorage.setItem("df_identity_type", "browser");
        localStorage.setItem("df_browser_id", browserId);
        await persistor.flush();       // ← BUG：flush = 保存当前状态，不是清空
        window.location.href = "/";
        return;
    }
    // ...
```

**`flush()` vs `purge()` 的区别**：

| 方法 | 行为 |
|------|------|
| `persistor.flush()` | 把当前 Redux 内存状态**写入** IndexedDB（localforage），保留所有数据 |
| `persistor.purge()` | **删除** IndexedDB 中所有持久化数据，下次启动恢复到 initialState |

当前流程：

1. 后端清除了 session tokens（`clear_session_tokens`）✓
2. 前端 identity 改回 `browser` ✓
3. `persistor.flush()` 把 `{identity: "browser", tables: [旧数据], charts: [旧数据], ...}` 写入 IndexedDB ✗
4. 页面跳转到 `/`，redux-persist 从 IndexedDB 恢复 → **旧数据全部回来**

**对比**：同一文件中 Frontend OIDC 的 catch 分支（第 78-80 行）正确使用了 `persistor.purge()`，
证明 backend 路径用 `flush()` 是遗漏，而非设计意图。

---

### Bug C：退出时 `apiRequest` 失败导致"未知错误"

**现象**：点击退出按钮时偶尔弹出一个无意义的错误提示，刷新页面后恢复正常。

**根因**：`handleSignOut` 的 Backend 路径没有 try/catch 包裹 `apiRequest` 调用。

```typescript
const handleSignOut = useCallback(async () => {
    if (isBackend) {
        // ↓ 如果网络超时、后端不可用、或返回非 200，这里直接抛异常
        await apiRequest(authInfo?.logout_url || "/api/auth/oidc/logout", { method: "POST" });
        // ↓ 以下清理代码全部不执行
        const browserId = getBrowserId();
        dispatch(dfActions.setIdentity({ type: "browser", id: browserId }));
        // ...
```

`apiRequest` 内部对非 200 响应会抛出 `ApiRequestError`。异常中断后续清理逻辑（setIdentity、
localStorage、persistor、redirect 全部跳过），用户停留在当前页面，处于"点了退出但什么都没
发生"的状态。刷新页面后因为 Redux 持久化状态未改变，旧页面恢复正常。

---

## 3. 三个 Bug 的关联关系

```
Bug A（前后端 identity 分歧）
  │
  │  用户在不一致状态下操作一段时间后想退出
  ↓
Bug C（退出时 apiRequest 失败）──→ 清理逻辑被中断 ──→ 加重 Bug B
  │
  │  即使退出成功
  ↓
Bug B（persistor.flush 保存了脏状态）──→ 旧用户数据泄露给下一个登录者
```

---

## 4. 修复方案

### 4.1 Bug A：前端 identity 需要动态同步

当前 identity 只在页面加载时检查一次。需要增加一个机制，在 **delegated login（SSO 弹窗）
完成后** 重新检查后端 OIDC 状态并更新前端 identity。

方案：在 `/api/auth/tokens/save` 调用成功后（`DBTableManager.tsx` 或 `ConnectorTablePreview.tsx`
中的 popup 回调），追加一次 identity 刷新：

```typescript
// Superset SSO 弹窗登录成功后
await apiRequest("/api/auth/tokens/save", { method: "POST", body: ... });

// 重新检查 DF OIDC 状态，同步 identity
try {
    const { data: status } = await apiRequest("/api/auth/oidc/status");
    if (status.authenticated && status.user) {
        dispatch(dfActions.setIdentity({
            type: 'user',
            id: String(status.user.sub || status.user.id),
            displayName: status.user.name,
        }));
        localStorage.setItem('df_identity_type', 'user');
    }
} catch { /* best effort */ }
```

或者更通用地：将 identity 刷新逻辑提取为公共函数 `refreshIdentity()`，
在任何 delegated login 完成后统一调用。

### 4.2 Bug B + C：退出登录

修改 `AuthButton.tsx` 的 `handleSignOut`：

```typescript
const handleSignOut = useCallback(async () => {
    if (isBackend) {
        // 后端 logout 失败不应阻断前端清理
        try {
            await apiRequest(authInfo?.logout_url || "/api/auth/oidc/logout", { method: "POST" });
        } catch (err) {
            console.warn("[AuthButton] Backend logout request failed:", err);
        }

        const browserId = getBrowserId();
        dispatch(dfActions.setIdentity({ type: "browser", id: browserId }));
        localStorage.setItem("df_identity_type", "browser");
        localStorage.setItem("df_browser_id", browserId);

        await persistor.purge();     // ← flush → purge
        window.location.href = "/";
        return;
    }

    if (!mgr) return;
    try {
        await mgr.signoutRedirect();
    } catch {
        await mgr.removeUser();
        await persistor.purge();
        window.location.href = "/";
    }
}, [mgr, isBackend, authInfo, dispatch]);
```

---

## 5. 影响评估

| Bug | 严重程度 | 修复难度 | 回归风险 |
|-----|---------|---------|---------|
| A — 前后端 identity 分歧 | **高**（数据存错文件夹，workspace 混乱） | 中（需新增 identity 刷新机制） | 低 |
| B — 退出不清状态 | **高**（前用户数据泄露，安全问题） | 低（改一行 flush→purge） | 低 |
| C — 退出报未知错误 | 中（用户体验差，且中断清理加重 Bug B） | 低（加 try/catch） | 无 |

---

## 6. 测试要点

### Bug A — Identity 同步
- [ ] 以匿名状态打开 DF → 通过 Superset SSO 弹窗登录 → 前端 identity 自动刷新为 `user:xxx`
- [ ] 前端 UI 显示用户名 + 退出按钮
- [ ] 后续 API 请求的 `X-Identity-Id` header 与后端 `get_identity_id()` 返回值一致
- [ ] 数据存入的 workspace 路径与前端显示的 workspace 一致

### Bug B + C — 退出登录
- [ ] Backend OIDC 模式退出后，IndexedDB 中 `persist:root` 已被清空
- [ ] 退出后刷新页面，不出现前一用户的 tables / charts / messages
- [ ] 后端 logout 端点不可用时，前端仍能完成清理并跳转首页，无报错弹窗
- [ ] Frontend OIDC 模式的退出行为不受影响（原有 purge 逻辑保持不变）
- [ ] 退出后重新登录，进入全新 session（initialState），无旧数据残留
