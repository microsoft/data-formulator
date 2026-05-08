# ISSUE-006: 错误处理缺口排查与统一防护架构

> 状态：规划中
> 日期：2026-05-09
> 影响范围：全栈（前端 UI 层、API 客户端层、后端路由层）
> 关联规范：`dev-guides/7-unified-error-handling.md`、`design-docs/12-unified-error-handling.md`

---

## 1. 问题总述

项目已有较完善的统一错误处理基础设施（`AppError` / `apiRequest` / `handleApiError` /
`streamRequest` / `stream_error_event`），但实际业务代码中存在大量**绕过或未接入**该体系
的调用点，导致部分错误未能传达给用户。

典型用户感知：

- 未选择模型就发起对话 → 无任何提示，后端 500
- 文件/数据加载失败 → 对话框关闭，数据消失，无解释
- 后端不可用 → 永久白屏
- 网络断线 → "Failed to fetch" 原始文本

---

## 2. 全景问题清单

### 2.1 应用级致命缺陷（A 类 — 用户完全卡死或无反馈）

| ID | 问题 | 位置 | 现象 |
|----|------|------|------|
| A1 | `APP_CONFIG` 加载无 `.catch()` | `App.tsx:987-992` | 后端不可用时永久白屏，无错误提示 |
| A2 | 未选模型发 Agent 请求 | `DataLoadingChat.tsx:735`、`SimpleChartRecBox.tsx:583`、`useFormulateData.ts:344` | `model: undefined` 传给后端 → `get_client(None)` → 500 |
| A3 | `loadTable` thunk 无全局 `rejected` handler | `dfSlice.tsx extraReducers` | 多处 `dispatch(loadTable(...))` 无 `.unwrap()` / `.catch()`，失败时静默 |
| A4 | `MessageSnackbar` 初始索引 `-1` | `dfSlice.tsx:205`、`MessageSnackbar.tsx:126-132` | `messages[-1]` 为 `undefined`，首条 Toast 可能异常 |
| A5 | 消息批量 dispatch 时 effect 只触发一次 | `MessageSnackbar.tsx:126-132` | `useEffect` 依赖仅 `[messages]`，缺少 `displayedMessageIdx`，连续到达的消息 Toast 可能丢失 |

### 2.2 错误被吞掉（B 类 — catch 只有 console 或空）

| ID | 问题 | 位置 | 场景 |
|----|------|------|------|
| B1 | 聊天中"加载表格"失败 → 只有 `console.error` | `DataLoadingChat.tsx:394` | 用户点"加载"无反馈 |
| B2 | 聊天中文件上传失败 → 只有 `console.error` | `DataLoadingChat.tsx:727` | 上传失败无提示 |
| B3 | LoadPlan onConfirm 无 try/catch | `DataLoadingChat.tsx:478-508` | Agent 推荐的表加载失败无反馈 |
| B4 | 示例数据集加载失败 → `console.error` + 关闭对话框 | `UnifiedDataUploadDialog.tsx:2208` | 用户以为加载了但没数据 |
| B5 | 粘贴数据解析失败 → 静默 noop | `UnifiedDataUploadDialog.tsx:1324-1354` | 粘贴后无任何反应 |
| B6 | 图表渲染失败 → 只有 `console.warn` | `VisualizationView.tsx:321` | 图表区域空白 |
| B7 | 数据表排序/分页加载失败 → 只有 `console.error` | `SelectableDataGrid.tsx:423` | 数据消失无解释 |
| B8 | 导出/导入 workspace 失败 → 只有 `console.warn` | `DataFormulator.tsx:173-198` | 操作无反馈 |
| B9 | TokenStore 保存 `.catch(() => {})` | `DBTableManager.tsx:854` | SSO token 保存失败静默 |
| B10 | 删除 session API 失败 → `catch { /* ignore */ }` | `App.tsx:318` | 确认框关闭但后端未删 |
| B11 | 数据同步到工作区失败 → 只有 `console.warn` | `useDataRefresh.tsx:233` | 刷新后派生表可能仍旧 |

### 2.3 网络/通信层缺陷（C 类）

| ID | 问题 | 影响 |
|----|------|------|
| C1 | 无全局网络离线检测 | 断网后所有操作各自失败各自报错，无统一提示 |
| C2 | `fetchWithIdentity` 不转译网络错误 | 用户看到 "Failed to fetch" 原始浏览器文本 |
| C3 | `errorHandler.ts` 对非 `ApiRequestError` 使用原始 `error.message` | 技术术语暴露给用户 |
| C4 | 流式请求断线 vs 业务错误未区分友好文案 | "Failed to fetch" 和 "LLM rate limit" 混在一起 |

### 2.4 后端安全/协议问题（D 类）

| ID | 问题 | 位置 |
|----|------|------|
| D1 | `knowledge.py` 用 `str(exc)` 作为 `AppError.message` | `routes/knowledge.py:86,109,127,252` |
| D2 | 多个 Agent 的 `collect_stream_warning` 含 `detail=str(e)` | `agents/context.py`、`agent_data_loading_chat.py`、`agent_report_gen.py`、`agent_interactive_explore.py` |
| D3 | 十多个路由对 `content['model']` 无 None 校验 → `KeyError`/`AttributeError` → 500 | `routes/agents.py` 几乎所有 Agent 端点 |
| D4 | `credentials.py` / `refresh_derived_data` 对 `get_json()` 无 None 防御 | `routes/credentials.py:46,65`、`routes/agents.py:967` |

### 2.5 状态不一致 / 竞态（E 类）

| ID | 问题 | 影响 |
|----|------|------|
| E1 | 删表乐观更新 + 后端删除失败无回滚 | UI 已删表但后端仍存在 |
| E2 | 报告流 `AbortError` 不更新 report status | report 永久停在 "generating" 状态 |
| E3 | `EncodingShelfCard` 发送制定请求无防抖 | 快速连点产生重复派生表 |
| E4 | IndexedDB save 无 try/catch → quota 满时拖垮整个 `loadTable` | ephemeral 模式下数据加载崩溃 |
| E5 | 多标签页无跨 tab workspace 同步 | 后写覆盖导致数据丢失 |

### 2.6 i18n 合规（F 类）

| ID | 位置 | 硬编码英文数量 |
|----|------|---------------|
| F1 | `useFormulateData.ts:392,406` | 2 处（"No result is returned..."、"Data formulation failed..."） |
| F2 | `dfSlice.tsx:1575,1583` | 2 处（rejected handler） |
| F3 | `useDataRefresh.tsx` 全文 | ~6 处 |
| F4 | `tableThunks.ts:111` | 1 处（重复数据提示） |
| F5 | `DataSourceSidebar.tsx:903` | 1 处（刷新失败提示） |

---

## 3. 根因分析：为什么基础设施完善但问题仍多

项目已经建立了完整的错误处理协议（`dev-guides/7`），但问题出在**调用面**：

```
已有基础设施（完善）         调用面（缺口密集）
─────────────────          ─────────────────
AppError / ErrorCode        ← 后端路由参数校验缺失（D3）
stream_error_event()        ← 已全面迁移
apiRequest() / streamRequest()  ← 部分调用点绕过（B 类）
handleApiError()            ← 大量 catch 块未调用（B 类）
getErrorMessage() / i18n    ← 硬编码英文（F 类）
MessageSnackbar             ← 自身有 bug（A4-A5）
```

核心矛盾：**基础设施是 opt-in（需要主动调用），没有 opt-out 机制（自动兜底）**。
每新增一个 API 调用，开发者需要记住：用 `apiRequest`、加 `try/catch`、调 `handleApiError`、
加 i18n key —— 任何一步遗漏就产生缺口。

---

## 4. 统一架构方案

### 4.1 设计原则

> **"错误处理不该是开发者需要记住的事，而是忘不了的事。"**

| 原则 | 含义 |
|------|------|
| **默认安全** | 不主动处理的错误必须有一个合理的兜底展示，而非静默 |
| **单一职责** | 每个层只做一件事，不重复 |
| **最少改动** | 复用现有 `apiRequest` / `handleApiError` 体系，不另起炉灶 |
| **渐进迁移** | 新方案向下兼容，旧代码逐步接入 |

### 4.2 统一方案：两个 Guard + 两个 Fix

整个方案归结为 **4 个独立、正交的改动**，不需要复杂的分层体系：

```
┌─────────────────────────────────────────────────────────┐
│                    用户操作                               │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │ 前端 Guard      │  ← 改动 ①              │
│              │ (apiGuard.ts)   │                          │
│              │ - 模型校验       │                          │
│              │ - 网络错误转译   │                          │
│              └───────┬────────┘                          │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │ 后端 Guard      │  ← 改动 ②              │
│              │ (get_client)    │                          │
│              │ - 参数 None 校验 │                          │
│              │ - str(e) 清理   │                          │
│              └───────┬────────┘                          │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │ 全局兜底        │  ← 改动 ③              │
│              │ - loadTable.rej │                          │
│              │ - Snackbar fix  │                          │
│              └───────┬────────┘                          │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │ 逐点修复        │  ← 改动 ④              │
│              │ - catch 升级    │                          │
│              │ - i18n 补全     │                          │
│              └────────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

---

#### 改动 ① 前端 Guard（`src/app/apiGuard.ts` — 新建 1 个文件）

**核心思路**：不改 `apiRequest`/`streamRequest` 的签名和行为，而是提供一组
**前置校验工具** + **错误转译增强**，供调用点按需引入。

```typescript
// src/app/apiGuard.ts

import { store } from './store';
import { dfActions, dfSelectors } from './dfSlice';
import type { ModelConfig } from './dfSlice';
import i18n from '../i18n';

// ── 1. 模型校验 guard ──────────────────────────────────────────

/**
 * 校验 activeModel 是否已配置。
 * 返回 type guard，调用后 TypeScript 自动收窄为 ModelConfig。
 *
 * 用法：
 *   const activeModel = useSelector(dfSelectors.getActiveModel);
 *   if (!requireModel(activeModel, 'DataLoadingChat')) return;
 *   // activeModel 此处已确定为 ModelConfig
 */
export function requireModel(
    model: ModelConfig | undefined,
    component: string,
): model is ModelConfig {
    if (model) return true;
    store.dispatch(dfActions.addMessages({
        timestamp: Date.now(),
        type: 'error',
        component,
        value: i18n.t('errors.noModelSelected'),
    }));
    return false;
}

// ── 2. 网络错误转译 ────────────────────────────────────────────

/**
 * 判断是否为浏览器网络层错误（非业务错误）。
 * 网络错误的特征：TypeError + 'Failed to fetch' 或 'NetworkError'
 */
export function isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) {
        const msg = error.message.toLowerCase();
        return msg.includes('failed to fetch')
            || msg.includes('networkerror')
            || msg.includes('network request failed');
    }
    return false;
}

/**
 * 获取用户友好的错误消息。
 * 网络错误 → i18n；其他保持原有逻辑。
 */
export function friendlyErrorMessage(error: unknown): string {
    if (isNetworkError(error)) {
        return i18n.t('errors.networkError');
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
```

**应用方式**（改动量极小，在现有代码中加 2-3 行）：

```typescript
// DataLoadingChat.tsx — sendMessage 开头加一行
if (!requireModel(activeModel, t('dataLoading.title'))) return;

// useFormulateData.ts — formulateData 开头加一行
if (!requireModel(activeModel, 'chart builder')) return;

// SimpleChartRecBox.tsx — exploreFromChat 开头加一行
if (!requireModel(activeModel, 'exploration')) return;
```

**网络错误转译** — 在 `errorHandler.ts` 的 `handleApiError` 中集成：

```typescript
// errorHandler.ts — 现有 else if (error instanceof Error) 分支改为：
} else if (error instanceof Error) {
    message = friendlyErrorMessage(error);  // 替换 error.message
}
```

这样**一处修改**就让所有已接入 `handleApiError` 的调用点自动获得网络错误友好文案。

**新增 i18n key**：

```json
// en/errors.json
{ "noModelSelected": "Please select a model before proceeding.",
  "networkError": "Network connection failed. Please check your internet connection and try again." }

// zh/errors.json
{ "noModelSelected": "请先选择一个模型再继续操作。",
  "networkError": "网络连接失败，请检查网络后重试。" }
```

---

#### 改动 ② 后端 Guard（改 1 个函数 + 逐点清理）

**`get_client()` 加 None 守卫**（1 行代码解决 D3 全部 11 个端点）：

```python
# routes/agents.py — get_client() 开头加 2 行
def get_client(model_config):
    if not model_config or not isinstance(model_config, dict):
        raise AppError(ErrorCode.INVALID_REQUEST,
                        "No model configured. Please select a model first.",
                        message_code="agent.noModelConfigured")
    # ... 现有逻辑不变
```

**`str(exc)` 清理**（D1-D2，约 8 处）：

```python
# knowledge.py — 改 raise AppError(ErrorCode.INVALID_REQUEST, str(exc))
# 改为：
raise AppError(ErrorCode.INVALID_REQUEST,
               "Knowledge operation failed") from exc

# agents/context.py 等 — 改 detail=str(e)
# 改为：
collect_stream_warning("...", detail=type(e).__name__)
```

---

#### 改动 ③ 全局兜底（改 2 个文件）

**`loadTable.rejected` handler**（`dfSlice.tsx`）：

```typescript
// dfSlice.tsx extraReducers 中添加
.addCase(loadTable.rejected, (state, action) => {
    if (action.error?.name !== 'AbortError') {
        state.messages.push({
            timestamp: Date.now(),
            type: 'error',
            component: 'data loader',
            value: i18n.t('errors.tableLoadFailed'),
            detail: action.error?.message,
        });
    }
})
```

**MessageSnackbar 修复**（`dfSlice.tsx` + `MessageSnackbar.tsx`）：

```typescript
// dfSlice.tsx — 初始值改为 0
displayedMessageIdx: 0,  // 原为 -1

// MessageSnackbar.tsx — effect 依赖加上 displayedMessageIdx
useEffect(() => {
    if (displayedMessageIdx < messages.length) {
        setOpenLastMessage(true);
        setLatestMessage(messages[displayedMessageIdx]);
        dispatch(dfActions.setDisplayedMessageIndex(displayedMessageIdx + 1));
    }
}, [messages, displayedMessageIdx]);  // 原为 [messages]
```

**APP_CONFIG 加 catch**（`App.tsx`）：

```typescript
useEffect(() => {
    apiRequest(getUrls().APP_CONFIG)
        .then(({ data }) => {
            dispatch(dfActions.setServerConfig(data));
            setConfigLoaded(true);
        })
        .catch((error) => {
            handleApiError(error, 'app-init');
        });
}, []);
```

---

#### 改动 ④ 逐点修复（按优先级批量处理）

逐点修复的核心模式统一为：**`console.error` → `handleApiError` 或 `addMessages`**。

##### 第一批（用户主动操作的失败必须通知）：

| 文件 | 修改 |
|------|------|
| `DataLoadingChat.tsx:394` | `catch(err) { handleApiError(err, 'DataLoadingChat'); }` |
| `DataLoadingChat.tsx:727` | 同上 |
| `DataLoadingChat.tsx:478-508` | 外层加 `try/catch` + `handleApiError` |
| `UnifiedDataUploadDialog.tsx:2208,2261` | `console.error` → `handleApiError` |
| `UnifiedDataUploadDialog.tsx:1324-1354` | 解析失败时 `addMessages` 提示"无法解析粘贴内容" |
| `App.tsx:318` | 删除 session 失败 → `addMessages` warning |

##### 第二批（渲染/展示类降级提示）：

| 文件 | 修改 |
|------|------|
| `VisualizationView.tsx:321` | 渲染失败时在图表区域显示错误占位符 |
| `SelectableDataGrid.tsx:423` | 添加 `addMessages` warning |
| `DataFormulator.tsx:173-198` | 导出/导入失败 → `addMessages` error |

##### 第三批（i18n 合规）：

| 文件 | 修改 |
|------|------|
| `useFormulateData.ts:392,406` | 硬编码 → `t('errors.xxx')` |
| `dfSlice.tsx:1575,1583` | 硬编码 → `i18n.t('errors.xxx')` |
| `useDataRefresh.tsx` 全文 | 硬编码 → `i18n.t('...')` |
| `tableThunks.ts:111` | 硬编码 → `i18n.t('...')` |

##### 第四批（状态一致性 / 防御性改进）：

| 文件 | 修改 |
|------|------|
| `SimpleChartRecBox.tsx:1210-1217` | `AbortError` 时也标记 report `status: 'cancelled'` |
| `tableThunks.ts:289-299` | IndexedDB save 加 `try/catch`，失败降级不阻塞 |
| `EncodingShelfCard.tsx:666-671` | 发送按钮绑定 `chartSynthesisInProgress` 禁用状态 |

---

## 5. 为什么这个方案足够简单

对比之前提出的"五层防御体系"，本方案简化为 **4 个正交改动**：

| 维度 | 原方案 | 简化方案 |
|------|--------|----------|
| 新文件数 | 3 个新模块 | **1 个**（`apiGuard.ts`） |
| 架构复杂度 | 5 层嵌套 + 中间件 | **4 个独立改动**，互不依赖 |
| 对现有代码的侵入 | 修改 `apiClient.ts`、新建 `networkGuard.ts` | **不改** `apiClient.ts`，`handleApiError` 改 1 行 |
| 迁移成本 | 所有调用点必须迁移 | 渐进式：加 guard 的加 guard，不加也有全局兜底 |

关键简化点：

1. **不新建网络监听模块** — 网络错误转译直接集成到已有的 `handleApiError` 中（改 1 行）
2. **不改 `apiRequest`/`streamRequest` 签名** — 模型校验在调用侧用 `requireModel()` 一行搞定
3. **不新建 ErrorBoundary 体系** — React Router 已有顶层兜底，图表渲染错误用组件内占位符处理
4. **后端只改 1 个函数** — `get_client()` 加 2 行代码覆盖全部 11 个端点

---

## 6. 实施计划

### Phase 1（必须修 — 阻塞用户核心流程）

| 任务 | 涉及文件 | 预计改动量 |
|------|----------|-----------|
| 创建 `apiGuard.ts`（`requireModel` + `friendlyErrorMessage`） | 新建 1 个文件 | ~40 行 |
| 前端 3 个 Agent 入口加 `requireModel` | `DataLoadingChat.tsx`、`SimpleChartRecBox.tsx`、`useFormulateData.ts` | 每处 +2 行 |
| 后端 `get_client()` 加 None 守卫 | `routes/agents.py` | +3 行 |
| `handleApiError` 集成网络错误转译 | `errorHandler.ts` | 改 1 行 |
| `APP_CONFIG` 加 `.catch()` | `App.tsx` | +3 行 |
| `loadTable.rejected` 全局 handler | `dfSlice.tsx` | +8 行 |
| MessageSnackbar 索引修复 | `dfSlice.tsx` + `MessageSnackbar.tsx` | 改 2 行 |
| i18n key 新增 | `en/errors.json` + `zh/errors.json` | +4 key |

### Phase 2（用户可感知的错误吞没修复）

| 任务 | 涉及文件 | 预计改动量 |
|------|----------|-----------|
| B1-B3: DataLoadingChat catch 升级 | `DataLoadingChat.tsx` | 3 处 |
| B4-B5: UnifiedDataUploadDialog 错误提示 | `UnifiedDataUploadDialog.tsx` | 3 处 |
| B6: 图表渲染错误占位符 | `VisualizationView.tsx` | 1 处 |
| B8: workspace 导出导入错误提示 | `DataFormulator.tsx` | 2 处 |
| B10: 删除 session 失败提示 | `App.tsx` | 1 处 |
| E2: 报告 AbortError 状态修复 | `SimpleChartRecBox.tsx` | 1 处 |
| E3: EncodingShelfCard 防抖 | `EncodingShelfCard.tsx` | 1 处 |

### Phase 3（安全合规 + 体验细节）

| 任务 | 涉及文件 | 预计改动量 |
|------|----------|-----------|
| D1-D2: 后端 `str(exc)` 清理 | `knowledge.py`、`agents/*.py` | ~8 处 |
| D4: `get_json()` None 防御 | `credentials.py`、`agents.py` | 2 处 |
| F1-F5: 硬编码英文 → i18n | 5 个文件 | ~12 处 |
| E4: IndexedDB quota 降级 | `tableThunks.ts` | 1 处 |
| B7,B9,B11: 其余 catch 升级 | 3 个文件 | 3 处 |

### Phase 4（架构优化 — 可选）

| 任务 | 说明 |
|------|------|
| E1: 删表改为后端确认后删除 | 需要改 deleteTable 流程，影响较大 |
| E5: 跨 tab workspace 同步 | 需要 BroadcastChannel API，独立 feature |
| messages 队列自动裁剪 | 超过 200 条自动淘汰最旧消息 |
| `apiRequest` 内置 retry（网络瞬断） | 可选，需评估幂等性 |

---

## 7. 验收标准

### Phase 1 完成后

- [ ] 未选模型点击发送 → 弹出"请先选择模型"错误提示
- [ ] 后端不可用时 → 首页显示网络/服务错误，非永久白屏
- [ ] 网络断线时 → 错误提示为中文/英文友好文案，非 "Failed to fetch"
- [ ] 任意 `loadTable` 失败 → Snackbar 显示错误
- [ ] 首条系统消息 Toast 内容正确（非 undefined）

### Phase 2 完成后

- [ ] 聊天中加载表格失败 → 用户收到错误提示
- [ ] 粘贴不可解析数据 → 提示"无法解析"
- [ ] 图表渲染失败 → 显示错误占位符而非空白
- [ ] 报告生成取消后 → 不再显示 "generating" 状态

### Phase 3 完成后

- [ ] 后端错误响应不包含 `str(exc)` 原始文本
- [ ] 所有用户可见错误消息支持中英文切换
- [ ] IndexedDB 存储满时 → 降级提示而非崩溃

---

## 8. 与现有规范的关系

本 issue 的修复**不修改**已有的错误处理协议（`dev-guides/7`），而是：

1. **填补调用面缺口** — 让业务代码正确使用已有基础设施
2. **添加前置防护** — `requireModel()` 在请求前拦截
3. **加强全局兜底** — `loadTable.rejected` + MessageSnackbar 修复
4. **逐点清理** — 硬编码、空 catch、`str(exc)`

完成后应更新：
- `dev-guides/7-unified-error-handling.md` — 添加 `requireModel` 和网络错误转译的说明
- `design-docs/12-unified-error-handling.md` — 标记已完成的迁移项
- `.cursor/skills/error-handling/SKILL.md` — 添加 `apiGuard.ts` 用法
