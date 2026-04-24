# 12 - 统一错误处理机制

> **状态**: Draft  
> **创建日期**: 2026-04-23  
> **分支**: `feature/plugin-architecture`

## 1. 问题摘要

当前 DF 框架的错误处理存在 7 个核心问题，导致前端经常"突然没有响应"：

| # | 问题 | 严重度 |
|---|------|--------|
| P1 | 流式端点有 5 种互不兼容的错误协议 | 🔴 Critical |
| P2 | 非流式端点 JSON 错误字段名不统一 (`error_message` / `message` / `error` / `result`) | 🔴 Critical |
| P3 | 大量错误被静默吞掉，前端无反馈（17+ 处） | 🔴 Critical |
| P4 | 前端 30+ 处 `.catch(() => {})` 或无 `.catch` | 🟠 High |
| P5 | HTTP 状态码使用不规范（流式全 200，非流式混用） | 🟡 Medium |
| P6 | 安全策略不一致（部分端点 `str(e)` 直接暴露异常原文） | 🟠 High |
| P7 | 缺少错误分类体系，前端无法差异化处理 | 🟡 Medium |

## 2. 现状详细审计

### 2.1 后端：5 种流式错误格式

| 端点 | MIME | 行格式 | 错误体结构 |
|------|------|--------|------------|
| `/data-agent-streaming` | `application/json` | `{json}\n` | `{status:"error", error_message:..., result:null}` |
| `/get-recommendation-questions` | `application/json` | `error: {json}\n` | `{content:...}` |
| `/generate-report-chat` | `text/event-stream` | `data: {json}\n` | `{type:"error", content:...}` |
| `/data-loading-chat` | `application/x-ndjson` | `{json}\n` | `{type:"error", error: str(e)}` ⚠️ 暴露原文 |
| `/clean-data-stream` | `application/json` | `\n{json}\n` | `{status:"error", result:...}` |

### 2.2 后端：非流式错误格式不一致

```python
# agent_bp.errorhandler(Exception) — agents.py:84-89
{"status": "error", "error_message": "...", "results": [], "result": []}

# safe_error_response — sanitize.py:61
{"status": "error", "message": "..."}

# process-data-on-load — agents.py:264 — 没有 error_message！
{"token": "...", "status": "error", "result": []}

# tables.py
{"error": "...", "status": "error"}
```

### 2.3 后端：错误静默吞掉清单

| 文件:行 | 行为 | 后果 |
|---------|------|------|
| `agents.py:262-264` | `process-data-on-load` 无 `error_message` | 前端只知失败，不知原因 |
| `agents.py:1214` | `data-loading-chat` 用 `str(e)` | 暴露内部异常 |
| `app.py:238-244` | 配置 `except: pass` | 身份信息丢失无提示 |
| `app.py:260-270` | 连接器列表 `except: pass` | 连接器列表丢失无提示 |
| `data_connector.py:678-689` | 持久化失败仍 201 | 前端以为成功 |
| `sessions.py:310-319` | 清理失败返回 `ok` | 未真正清理 |
| `demo_stream.py` 多处 | 裸 `except:` | 数据静默变少 |
| `agent_utils.py` 多处 | 裸 `except:` | 细节丢失 |

### 2.4 前端：空 catch / 无反馈清单

| 文件 | 行 | 端点 | 后果 |
|------|-----|------|------|
| `App.tsx` | 957 | `APP_CONFIG` | 无 `.catch` → 永久 loading |
| `DataSourceSidebar.tsx` | 346 | `GET /api/connectors` | `.catch(() => {})` |
| `DataSourceSidebar.tsx` | 379 | `get-catalog-tree` | `catch { /* ignore */ }` |
| `DataSourceSidebar.tsx` | 571 | `refresh-data` | `.catch(() => {})` |
| `VisualizationView.tsx` | 556 | `sample-table` | 仅 `console.error` |
| `SelectableDataGrid.tsx` | 322 | `export-table-csv` | 仅 `console.error` |
| `SelectableDataGrid.tsx` | 367 | `sample-table` | 仅 `console.error` |
| `dfSlice.tsx` | 1570 | `fetchChartInsight.rejected` | 仅 `console.error` |
| `dfSlice.tsx` | — | `fetchFieldSemanticType` | 无 `rejected` 处理 |
| `dfSlice.tsx` | — | `fetchCodeExpl` | 无 `rejected` 处理 |
| `useWorkspaceAutoName.tsx` | 62 | `workspace-summary` | 仅 `console.warn` |
| `useDataRefresh.tsx` | 246 | `sync-table-data` | 仅 `console.warn` |
| `useDataRefresh.tsx` | 474 | `sample-table` | 仅 `console.error` |
| `SimpleChartRecBox.tsx` | 398 | `get-recommendation-questions` | 仅 `console.error` |
| `DataFormulator.tsx` | 100 | `GET /api/connectors` | `.catch(() => {})` |
| `UnifiedDataUploadDialog.tsx` | 706,929 | `GET /api/data-loaders`, connectors | `.catch(() => {})` |
| `UnifiedDataUploadDialog.tsx` | 995 | `example-datasets` | 无 `.catch` |
| `DataLoadingChat.tsx` | 671 | `scratch/upload` | 仅 `console.error` |
| `DBTableManager.tsx` | 966 | `get-status` | 仅 `console.warn` |
| `DBTableManager.tsx` | 1025 | `preview-data` | `.catch(() => {})` |
| `ModelSelectionDialog.tsx` | 296 | `test-model` | 裸 `fetch`（绕过 `fetchWithIdentity`）|

### 2.5 遗漏细节补充

上一轮设计方案中未覆盖的细节：

#### 2.5.1 i18n 错误消息

- 后端所有错误消息当前为英文硬编码
- 前端 `MessageSnackbar` 对 `msg.value` 直接渲染，**未经 `t()` 翻译**
- 已有 `messages.json` 中定义了部分错误 key（如 `messages.agent.llmApiError`）
- 已有 `translateAgentMessage()` 函数（`utils.tsx:249-276`）做 agent 消息映射
- **策略**: 后端返回 `error.code`（机器可读），前端通过 `code → i18n key` 映射翻译

#### 2.5.2 Request ID 关联追踪

- 当前无跨前后端的 correlation ID
- 后端日志无法与前端特定请求关联
- **策略**: 后端 `before_request` 生成 `X-Request-Id`，前端在错误 `diagnostics` 中携带，方便调试

#### 2.5.3 向后兼容

- 改造不可能一次到位（79 个后端路由 + 60+ 前端调用点）
- **策略**: 前端 `apiClient` 兼容新旧格式，从 `error` / `error_message` / `message` 中提取

#### 2.5.4 token 字段保留

- 当前 `token` 用于前端请求-响应匹配（尤其并发场景）
- **策略**: 统一格式中保留 `token` 为可选顶级字段

#### 2.5.5 多通道错误展示

- 全局 Snackbar: `addMessages` → `MessageSnackbar`（适合非流式 API 错误）
- 组件内展示: 聊天消息、报告内容、对话框 `setError`（适合流式/上下文相关错误）
- **策略**: `handleApiError` 默认走 Snackbar，支持 `silent` 模式让组件自行处理

#### 2.5.6 已有 AuthenticationError

- `auth/providers/base.py:81-86` 已定义 `AuthenticationError`
- **策略**: 将其作为 `AppError` 子类，或在全局处理器中特殊处理

#### 2.5.7 ModelSelectionDialog 裸 fetch

- `ModelSelectionDialog.tsx:296` 用裸 `fetch` 调 `test-model`，绕过了 `fetchWithIdentity` 的身份头注入
- **策略**: 改为使用 `fetchWithIdentity`

## 3. 设计方案

### 3.1 统一错误响应协议

#### 非流式端点

```jsonc
// 成功
{
    "status": "ok",
    "data": { ... },           // 业务数据
    "token": "xxx"             // 可选
}

// 失败
{
    "status": "error",
    "error": {
        "code": "TABLE_NOT_FOUND",       // 机器可读错误码
        "message": "Table not found",     // 安全的用户可读消息（英文）
        "detail": "...",                  // 仅 DEBUG 模式
        "retry": false                    // 是否可重试
    },
    "token": "xxx",            // 可选
    "request_id": "uuid"       // 可选
}
```

#### 流式端点（统一 NDJSON）

所有流式端点统一使用 `application/x-ndjson`，每行一个 JSON：

```jsonc
// 正常事件
{"type": "text_delta", "data": {...}}
{"type": "tool_result", "data": {...}}

// 错误事件（可出现在流中任何位置）
{"type": "error", "error": {"code": "LLM_RATE_LIMIT", "message": "...", "retry": true}}

// 终止事件（必须是最后一行）
{"type": "done", "data": {...}}
```

> **重要**: `data-agent-streaming` 当前以 `{status, result}` 包装每个事件，改造时
> 需要同时调整前端的 `SimpleChartRecBox` 解析逻辑。但为了向后兼容，**Phase 1 先统一
> 错误事件格式，不改正常事件的包装结构**。

### 3.2 后端错误码体系

```python
# py-src/data_formulator/errors.py

class ErrorCode:
    """机器可读错误码 — 前端通过 code 做差异化处理和 i18n 映射"""

    # 认证/授权
    AUTH_REQUIRED = "AUTH_REQUIRED"
    AUTH_EXPIRED = "AUTH_EXPIRED"
    ACCESS_DENIED = "ACCESS_DENIED"

    # 输入/验证
    INVALID_REQUEST = "INVALID_REQUEST"
    TABLE_NOT_FOUND = "TABLE_NOT_FOUND"
    FILE_PARSE_ERROR = "FILE_PARSE_ERROR"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    VALIDATION_ERROR = "VALIDATION_ERROR"

    # LLM/模型
    LLM_AUTH_FAILED = "LLM_AUTH_FAILED"
    LLM_RATE_LIMIT = "LLM_RATE_LIMIT"
    LLM_CONTEXT_TOO_LONG = "LLM_CONTEXT_TOO_LONG"
    LLM_MODEL_NOT_FOUND = "LLM_MODEL_NOT_FOUND"
    LLM_TIMEOUT = "LLM_TIMEOUT"
    LLM_SERVICE_ERROR = "LLM_SERVICE_ERROR"
    LLM_CONTENT_FILTERED = "LLM_CONTENT_FILTERED"
    LLM_UNKNOWN_ERROR = "LLM_UNKNOWN_ERROR"

    # 数据/连接
    DB_CONNECTION_FAILED = "DB_CONNECTION_FAILED"
    DB_QUERY_ERROR = "DB_QUERY_ERROR"
    DATA_LOAD_ERROR = "DATA_LOAD_ERROR"
    CONNECTOR_ERROR = "CONNECTOR_ERROR"

    # 代码执行
    CODE_EXECUTION_ERROR = "CODE_EXECUTION_ERROR"
    AGENT_ERROR = "AGENT_ERROR"

    # 系统
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


class AppError(Exception):
    """统一业务异常基类"""

    def __init__(self, code: str, message: str, *,
                 status_code: int = 500,
                 detail: str | None = None,
                 retry: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.detail = detail
        self.retry = retry

    def to_dict(self, include_detail: bool = False) -> dict:
        d = {"code": self.code, "message": self.message, "retry": self.retry}
        if include_detail and self.detail:
            d["detail"] = self.detail
        return d
```

### 3.3 后端统一错误处理器

```python
# py-src/data_formulator/error_handler.py

def register_error_handlers(app):
    """在 app.py 中调用一次，注册全局错误处理"""

    @app.errorhandler(AppError)
    def handle_app_error(e): ...

    @app.errorhandler(413)
    def handle_413(e): ...

    @app.errorhandler(404)
    def handle_404(e):
        # /api/ 前缀 → JSON 错误；否则 SPA 回退
        ...

    @app.errorhandler(Exception)
    def handle_unexpected(e): ...


def classify_and_wrap_llm_error(exc: Exception) -> AppError:
    """复用 classify_llm_error 的安全过滤，转为 AppError"""
    ...

def stream_error_event(error: AppError | Exception, *, token: str = "") -> str:
    """格式化为 NDJSON 流中的统一错误事件行"""
    ...
```

### 3.4 Request ID 中间件

```python
# 在 error_handler.py 或独立 middleware.py 中

@app.before_request
def inject_request_id():
    g.request_id = request.headers.get('X-Request-Id', str(uuid4()))

@app.after_request
def attach_request_id(response):
    response.headers['X-Request-Id'] = g.request_id
    return response
```

### 3.5 前端 API 客户端

```typescript
// src/app/apiClient.ts

export interface ApiError {
    code: string;
    message: string;
    detail?: string;
    retry?: boolean;
}

export class ApiRequestError extends Error {
    constructor(public readonly apiError: ApiError, public readonly httpStatus: number) { ... }
    get isRetryable(): boolean { ... }
    get isAuthError(): boolean { ... }
}

// 非流式：自动解析 status:"error"，兼容新旧格式
export async function apiRequest<T>(url, options): Promise<{data: T, token?: string}> { ... }

// 流式：返回 AsyncGenerator，自动解析 NDJSON 行
export async function* streamRequest<T>(url, options, signal?): AsyncGenerator<StreamEvent<T>> { ... }
```

### 3.6 前端统一错误处理器

```typescript
// src/app/errorHandler.ts

export function handleApiError(error: unknown, context: string, options?: {
    silent?: boolean;        // 不弹 Snackbar
    onAuth?: () => void;     // 认证失败回调
    onRetryable?: () => void;// 可重试回调
}): void { ... }
```

### 3.7 前端错误码 → i18n 映射

```typescript
// src/app/errorCodes.ts

const ERROR_CODE_I18N_MAP: Record<string, string> = {
    AUTH_REQUIRED: 'errors.authRequired',
    AUTH_EXPIRED: 'errors.authExpired',
    TABLE_NOT_FOUND: 'errors.tableNotFound',
    LLM_AUTH_FAILED: 'errors.llmAuthFailed',
    LLM_RATE_LIMIT: 'errors.llmRateLimit',
    LLM_TIMEOUT: 'errors.llmTimeout',
    // ...
    INTERNAL_ERROR: 'errors.internalError',
};

export function getErrorMessage(apiError: ApiError): string {
    const i18nKey = ERROR_CODE_I18N_MAP[apiError.code];
    if (i18nKey) {
        const translated = i18n.t(i18nKey);
        if (translated !== i18nKey) return translated;
    }
    return apiError.message; // 回退到后端英文消息
}
```

```jsonc
// src/i18n/locales/zh/errors.json
{
    "errors": {
        "authRequired": "需要登录",
        "authExpired": "登录已过期，请重新登录",
        "tableNotFound": "未找到数据表",
        "llmAuthFailed": "API Key 无效，请检查配置",
        "llmRateLimit": "请求过于频繁，请稍后再试",
        "llmTimeout": "请求超时，请检查网络后重试",
        "internalError": "服务器内部错误",
        // ...
    }
}
```

### 3.8 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│  前端 React                                                       │
│                                                                    │
│  apiClient.ts                                                      │
│  ├── apiRequest()      非流式：解析 JSON → ApiRequestError        │
│  └── streamRequest()   流式：解析 NDJSON → StreamEvent 生成器     │
│           │                                                        │
│  errorCodes.ts                                                     │
│  └── getErrorMessage()   code → i18n key → 翻译文案               │
│           │                                                        │
│  errorHandler.ts                                                   │
│  └── handleApiError()    统一入口：Snackbar / 组件回调 / 静默     │
│           │                                                        │
│  MessageSnackbar ◄── dfSlice.messages（已有基础设施）              │
└────────────────────┬─────────────────────────────────────────────┘
                     │  HTTP JSON / NDJSON
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│  后端 Flask                                                        │
│                                                                    │
│  errors.py          ErrorCode 枚举 + AppError 异常类               │
│                                                                    │
│  error_handler.py                                                  │
│  ├── register_error_handlers(app)   全局 404/413/AppError/500     │
│  ├── classify_and_wrap_llm_error()  LLM 异常 → AppError          │
│  ├── stream_error_event()           流式统一错误行                 │
│  └── request_id middleware          X-Request-Id 注入              │
│                                                                    │
│  security/sanitize.py  保留，被 classify_and_wrap_llm_error 调用   │
│                                                                    │
│  各路由:                                                            │
│    非流式: raise AppError(...) → 全局处理器                        │
│    流式:   yield stream_error_event(...)                           │
└──────────────────────────────────────────────────────────────────┘
```

## 4. 可测试性分析

### 4.1 适合 TDD（先写测试）的模块

这些模块是**纯逻辑/纯函数**，无外部依赖，非常适合 TDD：

| 模块 | 测试文件 | 测试内容 | 框架 |
|------|----------|----------|------|
| `errors.py` | `tests/backend/test_errors.py` | `AppError` 构造、`to_dict()` 序列化、`ErrorCode` 完整性 | pytest |
| `error_handler.py` — `classify_and_wrap_llm_error` | `tests/backend/test_error_handler.py` | 各类 LLM 异常 → 正确 ErrorCode + 安全消息 + retry 标志 | pytest |
| `error_handler.py` — `stream_error_event` | 同上 | 输出为合法 NDJSON 行、包含正确结构 | pytest |
| `error_handler.py` — `register_error_handlers` | 同上 | Flask test_client 验证各 HTTP 状态码返回统一格式 | pytest + Flask test_client |
| 前端 `apiClient.ts` — `apiRequest` | `tests/frontend/unit/app/apiClient.test.ts` | 解析成功/错误/旧格式兼容 | vitest |
| 前端 `apiClient.ts` — `streamRequest` | 同上 | NDJSON 逐行解析、错误事件识别、异常行跳过 | vitest |
| 前端 `errorHandler.ts` | `tests/frontend/unit/app/errorHandler.test.ts` | `ApiRequestError` / 普通 Error / AbortError 分支 | vitest |
| 前端 `errorCodes.ts` | `tests/frontend/unit/app/errorCodes.test.ts` | code → i18n 映射、回退到英文消息 | vitest |

### 4.2 适合集成测试（后写）的模块

| 模块 | 测试内容 |
|------|----------|
| 各路由端点改造 | Flask test_client 发请求，验证错误响应格式符合新协议 |
| 流式端点改造 | Flask test_client 模拟错误，验证 NDJSON 错误行格式 |
| 前端各组件 `.catch` 改造 | 需要 mock API 返回错误，验证 Snackbar 弹出 |

### 4.3 不适合自动化测试的部分

| 模块 | 原因 |
|------|------|
| 消除裸 `except:` | 需要人工审查哪些 `except` 应该传播、哪些是合理降级 |
| i18n 翻译文案质量 | 翻译内容需人工审校 |

## 5. 开发计划

### Phase 1: 基础设施（后端 + 前端核心模块）— TDD

**目标**: 建立新的错误处理基础设施，全部先写测试。

#### Step 1.1: 后端 `errors.py`
- [ ] 编写 `tests/backend/errors/test_errors.py`
  - `AppError` 构造与属性
  - `to_dict()` 包含/不包含 detail
  - 子类化行为
- [ ] 实现 `py-src/data_formulator/errors.py`
  - `ErrorCode` 枚举
  - `AppError` 异常类
- [ ] 运行测试确认通过

#### Step 1.2: 后端 `error_handler.py`
- [ ] 编写 `tests/backend/errors/test_error_handler.py`
  - `classify_and_wrap_llm_error`: 覆盖全部 LLM 错误模式（auth、rate limit、timeout 等）
  - `stream_error_event`: 输出格式验证
  - `register_error_handlers`: Flask test_client 验证 404/413/500/AppError 响应格式
  - Request ID 中间件: 验证生成和传递
- [ ] 实现 `py-src/data_formulator/error_handler.py`
- [ ] 运行测试确认通过

#### Step 1.3: 在 `app.py` 中注册
- [ ] 在 `_register_blueprints()` 中调用 `register_error_handlers(app)`
- [ ] 移除 `app.py` 中已有的 `@app.errorhandler(413)` 和 `@app.errorhandler(404)`（由新模块接管）
- [ ] 运行现有测试套件确认无回归

#### Step 1.4: 前端 `apiClient.ts`
- [ ] 编写 `tests/frontend/unit/app/apiClient.test.ts`
  - `apiRequest`: 成功解析、错误解析、旧格式兼容、网络错误
  - `streamRequest`: NDJSON 解析、错误事件、malformed 行跳过、AbortError
  - `ApiRequestError`: 属性、`isRetryable`、`isAuthError`
- [ ] 实现 `src/app/apiClient.ts`
- [ ] 运行测试确认通过

#### Step 1.5: 前端 `errorHandler.ts` + `errorCodes.ts`
- [ ] 编写 `tests/frontend/unit/app/errorHandler.test.ts`
  - `ApiRequestError` → 正确 dispatch `addMessages`
  - `AbortError` → 不处理
  - `silent` 选项 → 不 dispatch
  - `onAuth` / `onRetryable` 回调
- [ ] 编写 `tests/frontend/unit/app/errorCodes.test.ts`
  - code → i18n key 映射
  - 未知 code → 回退英文
- [ ] 实现 `src/app/errorHandler.ts` + `src/app/errorCodes.ts`
- [ ] 运行测试确认通过

#### Step 1.6: i18n 错误翻译表
- [ ] 新增 `src/i18n/locales/en/errors.json` + `src/i18n/locales/zh/errors.json`
- [ ] 在 `src/i18n/locales/en/index.ts` 和 `zh/index.ts` 中注册

**Phase 1 预计文件变更**:
- 新增 4 个后端文件（2 源码 + 2 测试）
- 新增 6 个前端文件（3 源码 + 3 测试）
- 修改 2 个文件（`app.py`、i18n index）
- 新增 2 个 i18n JSON

#### Step 1.7: 更新 Cursor Rules & Skills

Phase 1 完成后，必须更新以下 Cursor 配置，确保后续开发遵循新规范：

**更新已有 Rule:**

- [ ] `.cursor/rules/error-response-safety.mdc` — 更新为引用新的 `AppError` + `error_handler.py`
  - `safe_error_response` → `raise AppError(...)` 或 `stream_error_event()`
  - 添加流式端点错误处理示例
  - 添加 `classify_and_wrap_llm_error()` 用法

- [ ] `.cursor/rules/i18n-no-hardcoded-strings.mdc` — 追加 `errors` namespace
  - 在 Namespaces 列表中添加 `errors`
  - 添加 `getErrorMessage(apiError)` 用法示例

**新增 Rule:**

- [ ] `.cursor/rules/unified-error-protocol.mdc` — 统一错误协议规范
  - `globs: py-src/**/*.py, src/**/*.{ts,tsx}`
  - 非流式 JSON 响应格式（`status` + `error` 结构）
  - 流式 NDJSON 事件格式（`type: "error"` + `error` 结构）
  - `ErrorCode` 枚举使用规范
  - 前端必须使用 `apiRequest()` / `streamRequest()` / `handleApiError()`
  - 禁止新代码出现空 `.catch(() => {})` 或裸 `except:`

**新增 Skill:**

- [ ] `.cursor/skills/error-handling/SKILL.md` — 错误处理开发技能
  - 描述: "DF 统一错误处理体系。在新增 API 端点、修改错误处理、添加前端 API 调用时使用。"
  - 包含完整的错误处理流程指南
  - 后端：何时用 `raise AppError` vs `stream_error_event`
  - 前端：何时用 `apiRequest` vs `streamRequest`，何时 `silent`
  - 新增 ErrorCode 的流程
  - 新增 i18n 错误翻译的流程

---

### Phase 2: 后端路由改造 — 高优先级端点 ✅ 已完成

**目标**: 改造最常触发错误的流式端点和关键非流式端点。

#### Step 2.1: 流式端点统一（5 个）
- [x] `/data-agent-streaming` → 错误行用 `stream_error_event()`，mimetype → `application/x-ndjson`
- [x] `/get-recommendation-questions` → 去掉 `error: ` 前缀，用 `stream_error_event()`
- [x] `/generate-report-chat` → 去掉 `data: ` 前缀，统一为 NDJSON，mimetype → `application/x-ndjson`
- [x] `/data-loading-chat` → 用 `classify_llm_error()` 替换 `str(e)`
- [x] `/clean-data-stream` → 用 `stream_error_event()`，mimetype → `application/x-ndjson`

#### Step 2.2: 关键非流式端点
- [x] `/process-data-on-load` → 增加 `error_message` 字段
- [x] `/sort-data` → 补充 `error_message`
- [x] `/derive-data` + `/refine-data` → 补充 `error_message`
- [x] `/test-model` → 修复未赋值 bug + 补充 `message`
- [x] `/workspace-summary` → 补充 `error_message`

#### Step 2.3: 移除 `agent_bp.errorhandler(Exception)`
- [x] 已移除，由全局 `register_error_handlers` 接管

#### Step 2.4: 修复安全漏洞
- [x] `data-loading-chat` 的 `str(e)` → `classify_llm_error(e)`
- [x] `agent_utils.py` 的 `assemble_table_summary` 添加 `FileNotFoundError` 保护
- [ ] `data_connector.py` 中 `str(e)` → `sanitize_error_message`（待 Phase 4）

#### Step 2.5: 前端流式消费者同步改造
- [x] `SimpleChartRecBox.tsx` — `data-agent-streaming` 消费者：兼容新旧格式 + 添加全局 `addMessages` 通知
- [x] `SimpleChartRecBox.tsx` — `generate-report-chat` 消费者：兼容 NDJSON + SSE 回退 + 添加全局 `addMessages` 通知
- [x] `SimpleChartRecBox.tsx` — `get-recommendation-questions` 消费者：已改为 NDJSON 解析
- [x] `useFormulateData.ts` — `get-recommendation-questions` 消费者：已改为 NDJSON 解析

#### Step 2.6: 更新 Cursor Rules
- [x] `.cursor/rules/error-response-safety.mdc` — 补充已改造端点的真实代码示例
- [x] `.cursor/rules/unified-error-protocol.mdc` — 补充迁移端点表、蓝图处理器移除说明
- [x] `.cursor/skills/error-handling/SKILL.md` — 补充已迁移端点参考、前端双格式解析模式

---

### Phase 3: 前端调用点改造 ✅ 已完成

**目标**: 逐步将现有 fetch 调用迁移到 `apiClient`，消灭空 catch。

#### Step 3.1: 流式调用点（Phase 2 中已完成）
- [x] `SimpleChartRecBox.tsx` — `data-agent-streaming` 解析逻辑
- [x] `SimpleChartRecBox.tsx` — `get-recommendation-questions` 解析逻辑
- [x] `SimpleChartRecBox.tsx` — `generate-report-chat` 解析逻辑
- [x] `DataLoadingChat.tsx` — `data-loading-chat` 解析逻辑（已有 `error` 事件处理）
- [x] `useFormulateData.ts` — `get-recommendation-questions` + `derive-data`

#### Step 3.2: 高频空 catch（分类处理）
- [x] `DataFormulator.tsx:100` — connectors 空 catch → 添加注释（best-effort）
- [x] `DataFormulator.tsx:125` — fetchWorkspaces 空 catch → 添加注释（best-effort）
- [x] `DataFormulator.tsx:153` — deleteWorkspace 空 catch → 改为 `addMessages` 通知用户
- [x] `DataSourceSidebar.tsx:257` — sessions 空 catch → 添加注释（best-effort）
- [x] `DataSourceSidebar.tsx:352` — connectors 空 catch → 添加注释（best-effort）
- [x] `DataSourceSidebar.tsx:401` — catalog tree 空 catch → 添加注释（best-effort）
- [x] `DataSourceSidebar.tsx:591` — refresh data 空 catch → 改为 `addMessages` 通知用户
- [x] `VisualizationView.tsx:556` — `sample-table` console.error → 改为 `setSystemMessage` 通知用户
- [x] `UnifiedDataUploadDialog.tsx:716` — data loaders 空 catch → 添加注释（best-effort）
- [x] `UnifiedDataUploadDialog.tsx:932` — connectors 空 catch → 添加注释（best-effort）
- [x] `UnifiedDataUploadDialog.tsx:1898` — reset console.error → 改为 `addMessages` 通知用户
- [x] `DBTableManager.tsx:1049` — preview 空 catch → 添加注释（best-effort + debounced）

#### Step 3.3: RTK thunk rejected 处理
- [x] `fetchFieldSemanticType.rejected` → `addMessages` (type: warning)
- [x] `fetchCodeExpl.rejected` → `addMessages` (type: warning)
- [x] `fetchChartInsight.rejected` → `addMessages` 替换 `console.error` (type: warning)
- [x] 所有 rejected handler 过滤 `AbortError`

#### Step 3.4: 裸 fetch 修复
- [x] `ModelSelectionDialog.tsx:296` → 改用 `fetchWithIdentity`

#### Step 3.5: 更新 Cursor Rules
- [x] `.cursor/rules/unified-error-protocol.mdc` — 添加 RTK thunk rejected 标准写法、更新禁止事项
- [x] `.cursor/skills/error-handling/SKILL.md` — 添加空 catch 策略决策树

---

### Phase 4: 后端全面收尾 ✅ COMPLETED

**目标**: 覆盖所有剩余路由和静默错误。

#### Step 4.1: `tables.py` 路由改造 ✅
- [x] 新增 `classify_and_raise_db_error()` 替换 `sanitize_db_error_message` 的 tuple 返回方式
- [x] 所有 9 处调用点改为直接 `classify_and_raise_db_error(e)`（利用全局处理器自动生成统一 JSON）
- [x] `list-tables` 内部 6 处降级逻辑全部补充 `logger.warning`
- [x] 保留 `sanitize_db_error_message` 作为 legacy wrapper

#### Step 4.2: `sessions.py` 改造 ✅
- [x] `cleanup-anonymous` 失败时返回 `status: "warning"` 而非 `status: "ok"`

#### Step 4.3: `data_connector.py` 改造 ✅
- [x] 新增 `classify_and_raise_connector_error()` 替换 `_sanitize_error` 的 tuple 返回方式
- [x] 所有 7 处 `_sanitize_error(e)` 调用改为 `classify_and_raise_connector_error(e)`
- [x] 持久化失败 → 在 response 中添加 `persist_warning` 字段
- [x] `str(e)` 暴露修复：auto-connect 错误改用 `_sanitize_error` 安全消息
- [x] dialog picker 的 `str(exc)` 改为固定消息
- [x] 所有 `except Exception: pass` 补充 `logger.debug` / `logger.warning`
- [x] 保留 `_sanitize_error` 作为 legacy wrapper

#### Step 4.4: 消除裸 `except:` / `except: pass` ✅
- [x] `agent_utils.py`: 2 处裸 `except:` → `except (ValueError, TypeError):` / `except Exception:`
- [x] `agent_data_load.py`: 1 处裸 `except:` → `except (json.JSONDecodeError, ValueError, TypeError):`
- [x] `agent_sort_data.py`: 1 处裸 `except:` → `except (json.JSONDecodeError, ValueError, TypeError):`
- [x] `demo_stream.py`: 4 处裸 `except:` → 各自改为具体异常类型
- [x] `agent_data_loading_chat.py`: 1 处 `except Exception: pass` → 添加 `logger.warning`
- [x] `workspace_manager.py`: 1 处 `except Exception: pass` → 添加 `logger.debug`
- [x] data_loader 的 `test_connection()`、sandbox 进程清理等已判定为合理降级，保持不变

#### Step 4.5: 更新 Cursor Rules & Skills — 最终版 ✅

- [x] `.cursor/rules/error-response-safety.mdc` — **最终版**
  - 添加 DB/connector 错误分类器文档
  - 标记所有 legacy 函数为 deprecated
  - 新增 Bare except Policy 章节
  - Common Mistakes 扩充：naked except、silent swallow、specific types

- [x] `.cursor/rules/unified-error-protocol.mdc` — **最终版**
  - 完整 ErrorCode 清单
  - 新增"Migrated Non-streaming Endpoints"表格
  - 新增"New Endpoint Checklist"

- [x] `.cursor/skills/error-handling/SKILL.md` — **最终版**
  - 新增 DB/connector 错误处理指南
  - 新增"Debugging Error Propagation"排查指南（6 步定位法）
  - Key Files 表格补充 `tables.py`、`data_connector.py`

- [x] `.cursor/rules/backend-test-conventions.mdc` — 补充错误测试约定
  - AppError 测试模板
  - 意外异常 500 测试模板
  - 流式端点 NDJSON 错误事件测试模板

---

### Phase 5: 可选增强

- [ ] Request ID 中间件上线
- [ ] 前端 Error Boundary 组件（React 级别）
- [ ] 错误重试按钮（`retry: true` 时自动出现重试选项）
- [ ] 前端网络离线检测 + 提示
- [ ] 后端结构化日志（JSON 格式 + request_id）

## 6. 依赖与风险

| 风险 | 缓解 |
|------|------|
| 改造涉及面广，可能引入回归 | Phase 1 建好基础设施 + 测试后再逐步改造；每个 Phase 独立可合并 |
| 流式端点格式变更需前后端同步 | Phase 2 + Phase 3.1 在同一 PR 中完成 |
| 向后兼容：旧前端 + 新后端 | `apiClient` 兼容旧格式（提取 `error_message` / `message` / `error`） |
| i18n 翻译工作量 | Phase 1 先建机制，翻译可后续增量补充 |

## 7. 文件清单预估

### 新增文件

| 文件 | 用途 |
|------|------|
| `py-src/data_formulator/errors.py` | ErrorCode + AppError |
| `py-src/data_formulator/error_handler.py` | 全局处理器 + 工具函数 |
| `tests/backend/errors/__init__.py` | 测试包 |
| `tests/backend/errors/test_errors.py` | AppError 单元测试 |
| `tests/backend/errors/test_error_handler.py` | 错误处理器单元/集成测试 |
| `src/app/apiClient.ts` | 统一 API 请求封装 |
| `src/app/errorHandler.ts` | 统一错误处理函数 |
| `src/app/errorCodes.ts` | 错误码 → i18n 映射 |
| `tests/frontend/unit/app/apiClient.test.ts` | apiClient 测试 |
| `tests/frontend/unit/app/errorHandler.test.ts` | errorHandler 测试 |
| `tests/frontend/unit/app/errorCodes.test.ts` | errorCodes 测试 |
| `src/i18n/locales/en/errors.json` | 英文错误翻译 |
| `src/i18n/locales/zh/errors.json` | 中文错误翻译 |

### Cursor Rules & Skills 文件

| 文件 | 操作 | Phase |
|------|------|-------|
| `.cursor/rules/error-response-safety.mdc` | 更新 — 引用 `AppError` + `stream_error_event` | P1, P4 |
| `.cursor/rules/i18n-no-hardcoded-strings.mdc` | 更新 — 追加 `errors` namespace | P1 |
| `.cursor/rules/unified-error-protocol.mdc` | **新增** — 统一错误协议规范 | P1, P2, P3, P4 |
| `.cursor/rules/backend-test-conventions.mdc` | 更新 — 补充错误测试约定 | P4 |
| `.cursor/rules/frontend-test-conventions.mdc` | 更新 — 补充 API 错误测试模式 | P3 |
| `.cursor/skills/error-handling/SKILL.md` | **新增** — 错误处理开发技能 | P1, P4 |

> **原则**: 每个 Phase 完成后，同步更新对应的 rules/skills 并纳入同一 PR。
> 这样保证后续开发者（包括 AI Agent）从第一天就遵循新规范，不会写出旧风格的代码。

### 修改文件（Phase 1-2 核心）

| 文件 | 变更 |
|------|------|
| `py-src/data_formulator/app.py` | 注册 `register_error_handlers`，移除旧 errorhandler |
| `py-src/data_formulator/routes/agents.py` | 流式端点错误格式统一，非流式端点使用 AppError |
| `src/i18n/locales/en/index.ts` | 注册 errors namespace |
| `src/i18n/locales/zh/index.ts` | 注册 errors namespace |
