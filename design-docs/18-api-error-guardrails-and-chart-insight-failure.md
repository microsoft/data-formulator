# 18 - API 错误护栏与图表洞察静默失败治理方案

> 状态：Phase 1/2 错误契约迁移已完成；Insight 架构重构待启动；静态扫描/CI 护栏待做  
> 创建日期：2026-04-29  
> 相关规范：`dev-guides/7-unified-error-handling.md`（已重写）、`dev-guides/1-streaming-protocol.md`、`design-docs/12-unified-error-handling.md`  
> 实施进度（最近两次提交核对，2026-04-30）：  
> - ✅ `json_ok()` / `stream_preflight_error()` helper 已实现  
> - ✅ `AppError` + `ERROR_CODE_HTTP_STATUS` 映射已实现（**已修订为仅 auth 使用非 200**）  
> - ✅ 全局 Flask error handler 已更新（应用错误 HTTP 200，仅 auth → 401/403）  
> - ✅ 前端 `apiRequest()` 双层错误检测已实现  
> - ✅ `dev-guides/7` 已整体重写，`dev-guides/1` 已同步到流式 HTTP 200 策略  
> - ✅ 全部 route 已迁移（credentials / knowledge / sessions / tables / agents / data_connector / app）  
> - ✅ 前端 thunk 全部迁移到 `apiRequest()`  
> - ✅ HTTP 状态码策略修订完成（应用错误 200，auth 401/403）  
> - ✅ `parseApiResponse()` legacy 回退已移除（不再兼容裸 `{error}` / `error_message` / `message` / `result`）  
> - ✅ 流式错误事件的通用 `token` 字段已移除，前端主要手写 reader 已迁移到 `streamRequest()`  
> - ✅ 后端协议合约测试与前端 `apiClient` 测试已补充  
> - ❌ `fetchCodeExpl` / `fetchFieldSemanticType` 仍保留 20s 硬编码 timeout，尚未跟随 `formulateTimeoutSeconds`  
> - ❌ 静态扫描脚本和 CI 接入未完成  
> - ❌ Structured-first Insight / `ModelResolver` 未启动  
>  
> **HTTP 状态码策略修订（2026-04-30）**：原设计采用 HTTP 语义化状态码（4xx/5xx 映射全部 ErrorCode），
> 实施过程中修订为：**应用可控错误统一 HTTP 200**，仅认证/授权错误使用 401/403。
> 理由：(1) 与流式 API 行为一致（流始终 200）；(2) 避免代理/WAF 误判业务错误为基础设施故障；
> (3) 前端通过 body `status` 字段统一判断，简化逻辑。
>  
> 与 dev-guides/7 的关系：本文档定义了错误处理的核心设计。dev-guides/7 已重写以反映最新契约：
> 应用错误 HTTP 200 + `status: "error"`，认证错误 401/403，结构化 `error: {code, message, retry}`，
> 成功响应 `status: "success"` + `data` 包裹。

## 1. 背景

图表洞察功能在 Agent 生成数据表和图表后会自动触发一次额外分析：

1. Data Agent / chart recommendation 流程生成派生表和图表。
2. 前端延迟约 1.5 秒调用 `fetchChartInsight({ chartId, tableId })`。
3. `fetchChartInsight` 从 `chartCache` 读取已渲染 PNG，把图像、图表类型、字段和表数据发到 `/api/agent/chart-insight`。
4. 后端 `ChartInsightAgent` 调用 vision-capable 模型，要求返回 `{title, takeaways}` JSON。
5. 前端把结果写入 `chart.insight`。

用户反馈的现象是：洞察有时不出结果，loading 自动停止，前端没有提示，后端日志也看不到明确失败原因。

这不是单点 bug，而是前后端错误契约、自动流程依赖和编码规范 enforcement 不够强导致的系统性问题。

## 2. 具体问题定位

### 2.1 后端返回失败，但没有统一错误 envelope

当前 `/api/agent/chart-insight` 是普通 JSON endpoint，不是 NDJSON 流式 endpoint。失败路径存在三种非统一格式：

```python
return jsonify({'error': 'No insight generated'})
return jsonify({'error': classify_llm_error(e)})
return jsonify(result)  # result 可能是 {'status': 'other error', 'content': ...}
```

这些响应没有稳定使用：

```json
{
  "status": "error",
  "error": {
    "code": "AGENT_ERROR",
    "message": "No insight generated",
    "retry": false
  }
}
```

结果是前端无法用统一方式判断失败，也无法映射错误码、重试提示和 i18n 文案。

### 2.2 前端直接 `fetchWithIdentity()` 后只 `response.json()`

`fetchChartInsight` 当前读取响应后直接返回：

```ts
let response = await fetchWithIdentity(getUrls().CHART_INSIGHT_URL, { ...message, signal });
let result = await response.json();
return { ...result, chartId, insightKey };
```

它没有检查：

- `body.status === "error"`
- `body.error`
- `body.error_message`
- `body.status !== "ok"`
- 响应没有 `title` 和 `takeaways`

因此后端返回 `{error: "No insight generated"}` 时，Redux thunk 仍进入 `fulfilled`。

### 2.3 fulfilled reducer 清掉 loading，但不显示失败

> **核心问题不在 rejected reducer**（rejected 路径实际有 warning），而在：后端返回的错误响应（如 `{error: "No insight generated"}`）**没有触发 thunk reject**，走了 fulfilled 路径。完整故障链路：
>
> 1. 后端返回 `{error: "No insight generated"}`（无 `status: "error"`）
> 2. 前端 thunk 直接 `response.json()` 返回该对象，**不检查 body 内容**
> 3. thunk 以 fulfilled 结算（不抛异常 = fulfilled）
> 4. fulfilled reducer 检查 `title`/`takeaways`，不存在 → 不写入洞察
> 5. fulfilled reducer 清掉 `chartInsightInProgress` → loading 停止
> 6. **无任何用户提示**
>
> rejected 路径（如 AbortError、网络错误）会正确显示 warning，但本场景根本走不到 rejected。

`fetchChartInsight.fulfilled` 只在 `title` 或 `takeaways` 存在时写入 `chart.insight`。如果 payload 是错误对象，则不会写入洞察，但仍会清掉 `chartInsightInProgress`。

最终用户看到的是：

- 按钮 spinner 停止
- 洞察面板没有内容
- snackbar 没有提示
- 看起来像功能“自己死了”

### 2.4 AbortError 被完全静默

`fetchChartInsight` 内部对请求设置 30 秒 abort；rejected reducer 对 `AbortError` 不展示 message。对后台 best-effort 请求，静默 abort 可以接受；但图表洞察是用户可见的高价值功能，自动触发和手动触发都不应完全静默。

### 2.5 自动洞察依赖图表 PNG 缓存，但只用固定延迟

自动触发依赖 `ChartRenderService` 已经把图表渲染到 `chartCache`。但当前逻辑是固定 `setTimeout(..., 1500)`：

- 图表较多时 headless render 会排队。
- 图表合成仍在进行时 `ChartRenderService` 会跳过渲染。
- 非渲染型图表（`Auto`、`?`、`Table`）没有 PNG。

因此自动洞察可能在缓存未就绪时启动，触发 `No rendered chart image`。

更深层的问题是：当前洞察把 chart PNG 当成核心输入发给 vision model。这有三个缺点：

- **成本高**：图片输入通常比结构化文本摘要消耗更多 token / 计费单位，慢模型上延迟也更明显。
- **信息不完整**：图片只包含最终视觉结果，缺少原始字段类型、聚合方式、排序、过滤、采样、缺失值、分组统计和派生 lineage。
- **稳定性差**：依赖前端渲染缓存和浏览器 canvas，图表尚未渲染、渲染失败、缩放/裁剪、主题样式变化都会影响 Agent 输入。

因此长期方案不应默认把图片发送给大模型。图片最多作为可选辅助证据，而不是洞察的主数据源。

### 2.6 后端日志缺少结构化业务摘要

后端只有异常路径会 `logger.error("Error in chart-insight", exc_info=e)`。但以下业务失败不一定有清晰日志：

- agent 返回候选但 `status != "ok"`
- candidates 为空
- LLM 返回了文本但无法解析出 JSON

这些不一定是 Python exception，所以后端日志看起来“没报错”。

### 2.7 Chart Insight 没有使用统一前端超时配置

前端已有用户可配置的 `config.formulateTimeoutSeconds`，默认值为 180 秒，设置面板允许调整到更长时间。主 Data Agent、推荐问题等较慢的 LLM 路径已经使用这个配置。

但 `fetchChartInsight` 当前有两层硬编码超时：

```ts
const INSIGHT_TIMEOUT_MS = 60_000;                              // 外层 Promise.race
const timeoutId = setTimeout(() => controller.abort(), 30000);  // 内层 AbortController
```

**实际执行流分析：**

1. 内层 30s 先到期 → `controller.abort()` → `fetchWithIdentity` 抛出 `AbortError`
2. `AbortError` 导致 thunk reject
3. rejected reducer 判断 `action.error?.name === 'AbortError'` → **静默**（不显示 warning）
4. 外层 60s `Promise.race` 永远不会触发（内层已结算）

因此**实际超时永远是 30s 且永远静默**——外层 60s 是不可达的死代码。用户看到的就是"30 秒后 spinner 停了，没有任何提示"。

因此即使用户把推理超时设置为 180 秒，图表洞察仍会在 30 秒被 `AbortController` 终止。由于 `AbortError` 又被 rejected reducer 静默过滤，慢模型会表现为：

- 洞察 loading 停止；
- 没有 snackbar；
- 后端没有业务错误日志；
- 用户误以为 Agent 或洞察“自动死了”。

这是本次现象的直接触发因素之一，尤其影响推理速度较慢的大模型和 vision model。

### 2.8 其他前端超时配置审计

对当前 `src/` 中 `AbortController` 和请求 timeout 的初步审计如下：

| 文件 / 功能 | 当前超时 | 是否使用 `formulateTimeoutSeconds` | 分类 | 建议 |
|-------------|----------|------------------------------------|------|------|
| `src/app/dfSlice.tsx` `fetchChartInsight` | 内层 30s，外层 60s | 否 | LLM / 用户可见自动任务 | 改为使用 `config.formulateTimeoutSeconds`，只保留一层 timeout，并显示超时提示 |
| `src/app/dfSlice.tsx` `fetchCodeExpl` | 20s | 否 | LLM / 用户可见辅助任务 | 改为使用 `config.formulateTimeoutSeconds` 或新增统一 LLM timeout helper |
| `src/app/dfSlice.tsx` `fetchFieldSemanticType` | 20s | 否 | LLM / 自动推断任务 | 建议使用 `config.formulateTimeoutSeconds`，或定义较短但可配置的 metadata timeout |
| `src/app/dfSlice.tsx` `fetchAvailableModels` | 30s | 否 | 模型连通性健康检查 | 可保留特例；后端单模型 ping 已是 10s，前端 30s 是健康检查预算，不应跟随长推理配置 |
| `src/app/useFormulateData.ts` 推荐问题 / formulate | `config.formulateTimeoutSeconds` | 是 | LLM 主流程 | 符合预期 |
| `src/views/SimpleChartRecBox.tsx` 推荐问题 | `config.formulateTimeoutSeconds` | 是 | LLM 推荐问题 | 符合预期 |
| `src/views/SimpleChartRecBox.tsx` Data Agent explore | `config.formulateTimeoutSeconds * 6` | 是 | 长链路 LLM + tools | 符合预期，但应记录为何乘 6 |
| `src/views/DataLoadingChat.tsx` data-loading chat | 无前端 timeout，仅用户 abort | 部分特例 | 长流式工具任务 | 可以接受，但应在规范中明确“长流式工具任务不使用短前端超时；由服务端/工具级 timeout 控制” |
| `src/views/SimpleChartRecBox.tsx` report generation | 无前端 timeout，仅用户 abort | 部分特例 | 长流式报告生成 | 可以接受，但应补充服务端 error 事件和用户取消语义 |
| `src/views/DBTableManager.tsx` connector connect | 30s | 否 | 数据连接 / 网络 I/O | 合理特例；使用独立连接超时和用户可见 `db.connectionTimeout` |
| `src/views/DBTableManager.tsx` preview sample rows | 300ms debounce，不是请求超时 | 不适用 | best-effort preview | 合理，已有静默注释 |

结论：同类问题主要集中在 `src/app/dfSlice.tsx` 的 LLM 辅助 thunk。凡是会调用 LLM 或 Agent 的用户可见任务，都不应硬编码 20/30/60 秒，而应使用统一配置或明确命名的派生配置。

补充审计确认：`formulateTimeoutSeconds` 仅在前端 Redux 和 `AbortController` 超时中使用，**后端不接收此值**。因此 timeout 迁移只涉及前端 thunk，不需要后端配合。

### 2.9 Settings 按钮在空会话时不显示

Settings 按钮（含 `formulateTimeoutSeconds` 配置入口）的渲染条件是 `focusedId !== undefined`（`src/app/App.tsx` 约 843 行）：

```tsx
{focusedId !== undefined && <React.Fragment>
    <ConfigDialog />
    ...
</React.Fragment>}
```

初始状态 `focusedId` 为 `undefined`（`dfSlice.tsx` 约 207 行）。自动 focus 仅在 `DataFormulator.tsx` 的 `useEffect` 中当 `tables.length > 0` 时触发。因此空会话时用户看不到 Settings 入口，无法在加载数据前调整超时等配置。

这意味着用户在首次使用慢模型时，必须先加载数据、等到自动洞察因超时静默失败、才能找到 Settings 面板去调整超时时间——但此时已经错过了。

建议在 Phase 1b 中修复：Settings 按钮的显示不应依赖 `focusedId`，在 `isAppPage` 条件下始终显示。

## 3. 根因总结

本次问题暴露的是三个层面的缺口：

1. **协议缺口**：后端仍有 endpoint 返回临时 `{error: ...}` 格式，未进入统一错误 envelope。
2. **消费缺口**：前端业务 thunk 直接使用 `fetchWithIdentity()`，没有统一解析应用层失败。
3. **护栏缺口**：现有规范写明了应该怎么做，但没有足够的自动检查阻止新增或遗留路径继续静默失败。

已有 `dev-guides/7-unified-error-handling.md` 解决了“正确模式是什么”，但还需要一套 guardrails 解决“开发者漏做时系统如何尽早拦住”。

## 4. 设计目标

1. 后端所有应用层失败都能被机器识别：`status: "error"` + `error.code`。
2. 前端所有 `/api/` JSON 调用默认通过统一解析器，业务失败自动 reject。
3. 用户触发或用户可见的自动任务失败必须有反馈；只有明确 best-effort 背景任务可静默。
4. 后端日志可以区分异常失败和业务失败，并带 endpoint、错误码、请求 ID、关键业务字段。
5. 新增代码默认走安全路径；绕过统一错误系统需要显式标注原因。
6. 通过测试、lint/static scan、review checklist 三层防线降低遗漏概率。
7. 所有 LLM / Agent 用户可见任务的前端 timeout 都来自统一配置或显式声明的派生策略，避免慢模型被短硬编码超时截断。
8. 洞察输入以结构化 chart spec、数据 profile 和统计摘要为主，避免默认发送高成本且信息不完整的 chart image。

## 5. 统一方案

### 5.1 后端：应用错误 HTTP 200 + 统一 JSON envelope

所有普通 `/api/` JSON endpoint 采用 **HTTP transport + body 业务状态双层信号**：

- HTTP 状态码只承载认证/授权和不可控基础设施语义：auth → 401/403，未捕获异常/404/413 等仍按 Flask handler 返回非 200。
- 应用可控错误统一 HTTP 200 + body `status:"error"`，与 NDJSON streaming 的 preflight 行为一致。
- body 内 `status` 字段是业务成功/失败的主信号：成功 → `status:"success"`，应用错误 → `status:"error"`。

**成功响应** — HTTP 200（业务数据必须包裹在 `data` 字段内，不允许扁平散布到顶层）：

```json
HTTP/1.1 200 OK

{
  "status": "success",
  "data": {
    "title": "...",
    "takeaways": []
  }
}
```

**应用错误** — HTTP 200（请求格式或业务条件不满足，前端通过 body 判断失败）：

```json
HTTP/1.1 200 OK

{
  "status": "error",
  "error": {
    "code": "AGENT_ERROR",
    "message": "Unable to generate chart insight",
    "retry": false
  }
}
```

**认证/授权错误** — HTTP 401/403（transport 层需要可拦截）：

```json
HTTP/1.1 401 Unauthorized

{
  "status": "error",
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Authentication required",
    "retry": false
  }
}
```

**ErrorCode → HTTP 状态码映射表（当前实现）：**

| ErrorCode | HTTP Status | 语义 |
|-----------|-------------|------|
| _(success)_ | 200 | 请求成功 |
| `INVALID_REQUEST` | 200 | 请求参数缺失/格式错误（应用可控错误） |
| `VALIDATION_ERROR` | 200 | 业务校验不通过（如图表不可分析） |
| `AGENT_ERROR` | 200 | LLM 输出解析失败、candidates 为空等业务失败 |
| `AUTH_REQUIRED` / `AUTH_EXPIRED` | 401 | 需要认证 |
| `ACCESS_DENIED` | 403 | 权限不足 |
| `RATE_LIMITED` / `LLM_RATE_LIMIT` | 200 | LLM 提供商限流（应用可识别错误，`retry` 标记是否可重试） |
| `CONNECTOR_ERROR` | 200 | 外部数据源连接失败 |
| `SERVICE_UNAVAILABLE` / `LLM_SERVICE_ERROR` | 200 | LLM 提供商不可达 |
| `INTERNAL_ERROR`（由 `AppError` 抛出） | 200 | 应用层已分类内部错误 |
| 未捕获异常 / 404 / 413 | 500 / 404 / 413 | Flask 全局兜底或框架级错误 |

**设计原则**：
- body `status` 是应用层成功/失败的权威信号。
- HTTP 非 200 只保留给 auth 和不可控 transport/framework 错误。
- `retry` 字段是前端重试判断的主信号，不能依赖 HTTP 5xx 推断。

所有 `/api/` JSON endpoint 不再返回以下任何格式：

```json
{"error": "..."}
{"error_message": "..."}
{"status": "error", "message": "..."}
{"status": "error", "error_message": "..."}
{"status": "other error", "content": "..."}
{"status": "ok", ...}
```

前五种错误格式（包括 `dev-guides/7` § 2.2 曾允许的 legacy 兼容格式）**全部废弃**，不再作为兼容目标。第六种 `"ok"` 需迁移为 `"success"`。迁移完成后：

- 前端 `apiRequest()` 使用双层检测：`!response.ok` 捕获 auth / transport 错误，`body.status === "error"` 捕获 HTTP 200 的应用错误。
- 前端 `parseApiResponse()` 已删除 `body.error_message ?? body.message` 回退分支和 `body.result` 回退分支。
- 前端不再为 `/api/` JSON endpoint 叠加任何 legacy 成功或错误解析分支。
- 如果仍出现裸 `{error: ...}`、扁平 `{status: "error", message: ...}` 或无 `status` 响应，应视为后端协议违规。

以下响应类型不属于普通 JSON endpoint，必须显式标记为豁免：

- NDJSON streaming：`application/x-ndjson`（流内错误通过 `{type:"error"}` 事件传递）
- 文件下载 / CSV / binary blob
- OIDC redirect / auth callback redirect
- SPA fallback
- 第三方 URL 代理或外部服务原样转发

豁免必须集中登记，不能在 route 中隐式绕过。

**Streaming 与 HTTP 状态码的关系**：

HTTP 协议的限制是：一旦服务端开始发送响应体（即流已建立），HTTP 状态码已经随第一个字节一起发出，无法再修改。因此流式 endpoint 分两种情况：

1. **流建立前校验失败**（参数缺失、格式错误、认证失败等）：此时还没开始 yield NDJSON 行，当前实现返回 HTTP 200 + 普通 JSON error body（`Content-Type: application/json`），与普通 JSON endpoint 的应用错误格式一致。前端通过 `Content-Type` 判断走普通错误解析还是 NDJSON 流解析。
2. **流运行中出错**（LLM 异常、工具执行失败等）：HTTP 200 已发出且 `Content-Type` 已是 `application/x-ndjson`，只能通过流内 `{type:"error"}` 事件传递。

> **与 dev-guides/1 和 dev-guides/7 的变更关系**：
>
> - `dev-guides/1-streaming-protocol.md` 已同步：流式端点和 preflight 应用错误均保持 HTTP 200。
> - `dev-guides/7-unified-error-handling.md` 已同步：应用错误 HTTP 200，仅 auth 使用 401/403。
> - 早期“pre-stream 校验失败改为 HTTP 4xx”的方案已取消。

### 5.2 后端：提供 `json_ok()` / `stream_preflight_error()` helper + 全局 error handler

当前实现已在 `py-src/data_formulator/error_handler.py` 中提供统一 helper：

```python
def json_ok(data: object = None, *, status_code: int = 200) -> tuple:
    """成功响应。业务数据包裹在 data 字段内。"""
    return jsonify({"status": "success", "data": data}), status_code

def stream_preflight_error(error: AppError) -> tuple:
    """流建立前的应用错误：HTTP 200 + JSON error envelope。"""
    return jsonify({"status": "error", "error": error.to_dict()}), 200
```

`json_ok()` 调用方必须显式构造 data payload，避免把业务字段散布到顶层：

```python
return json_ok({"title": title, "takeaways": takeaways})
```

`json_ok()` 的输出必须是 HTTP 200 + `{"status": "success", "data": {...}}`，**不能**把业务字段散布到顶层。

**全局 error handler（应用错误 HTTP 200，auth 例外）**：

```python
ERROR_CODE_HTTP_STATUS: dict[str, int] = {
    ErrorCode.AUTH_REQUIRED: 401,
    ErrorCode.AUTH_EXPIRED: 401,
    ErrorCode.ACCESS_DENIED: 403,
}

@app.errorhandler(AppError)
def handle_app_error(exc: AppError):
    http_status = ERROR_CODE_HTTP_STATUS.get(exc.code, 200)
    body = {"status": "error", "error": exc.to_dict(include_detail=current_app.debug)}
    return jsonify(body), http_status
```

`AppError.get_http_status()` 只对 `AUTH_REQUIRED` / `AUTH_EXPIRED` / `ACCESS_DENIED` 返回非 200；其余应用可控错误均返回 200。

推荐业务代码直接 `raise AppError(...)`，由全局 handler 处理。流式 endpoint 的 preflight 校验失败使用 `stream_preflight_error()`，流运行中错误使用 `stream_error_event()`。

### 5.3 后端：为 Agent route 增加业务失败分类

Agent endpoint 常见失败不一定是 exception，而是 candidate 为空或 candidate status 非 ok。统一映射：

| 场景 | ErrorCode | HTTP Status | retry |
|------|-----------|-------------|-------|
| candidates 为空 | `AGENT_ERROR` | 200 | false |
| LLM 输出无法解析 | `AGENT_ERROR` | 200 | false |
| LLM API timeout / rate limit / auth | `classify_and_wrap_llm_error()` | 200（auth 例外） | 按分类 |
| 缺少必要参数 | `INVALID_REQUEST` | 200 | false |
| 图表不可分析 / 无图像 | `VALIDATION_ERROR` | 200 | false |
| 模型不支持 vision 但请求包含图片 | `VALIDATION_ERROR` | 200 | false |
| `chart_image` 为空字符串 | `VALIDATION_ERROR` | 200 | false |

`/api/agent/chart-insight` 应变成：

1. 请求校验失败：raise `AppError(ErrorCode.INVALID_REQUEST, ...)`
2. **Vision 能力校验**：如果 `chart_image` 非空但 `model_supports_vision(model) == False`，raise `AppError(ErrorCode.VALIDATION_ERROR, "The selected model does not support image input. Please switch to a vision-capable model.")`
3. **图片有效性校验**：如果 `chart_image` 为空字符串（前端缓存未就绪），raise `AppError(ErrorCode.VALIDATION_ERROR, "Chart image not available. Please retry.")`
4. LLM 异常：raise `classify_and_wrap_llm_error(exc)`
5. candidates 空或 `status != "ok"`：raise `AppError(ErrorCode.AGENT_ERROR, safe_message)`
6. 成功：返回 `json_ok({"title": title, "takeaways": takeaways})`，即 `{"status": "success", "data": {"title": "...", "takeaways": [...]}}`

> **设计原则**：vision 能力判断**只在后端**完成。前端不应检查 `model.supports_vision` 来决定是否调用 insight API。这为未来多模型路由（后端自动为 insight 任务选择 vision model）留出空间。

### 5.4 后端：结构化日志事件

每个高价值 Agent endpoint 至少记录两类日志：

请求开始：

```text
[chart-insight] start request_id=... chart_type=... field_count=... table_count=...
```

请求结束：

```text
[chart-insight] done request_id=... status=ok takeaway_count=...
[chart-insight] failed request_id=... code=AGENT_ERROR reason=no_candidates
[chart-insight] failed request_id=... code=AGENT_ERROR reason=parse_failed
```

日志注意：

- 不记录完整表数据、chart image、API key、token。
- 对异常用 `logger.exception` 或 `exc_info=True`。
- 对业务失败用 `logger.info` 或 `logger.warning`，必须包含可搜索的 `reason`。

### 5.5 前端：禁止业务 thunk 直接消费 `fetchWithIdentity().json()`

所有 `/api/` JSON 调用必须使用统一客户端：

- 普通 JSON：`apiRequest()`
- 流式 NDJSON：`streamRequest()`
- 错误展示：`handleApiError()` 或 Redux `.rejected` handler

**禁止模式**（不再接受"暂时保留"）：

```ts
// ❌ 禁止：直接 fetchWithIdentity + response.json() 无解析
const body = await response.json();
return body;

// ❌ 禁止：fetchWithIdentity + parseApiResponse 的中间态
// 全量迁移后不需要这种过渡写法
```

**唯一豁免**（必须写注释说明原因）：

- 文件下载 / blob / CSV stream
- 第三方 URL
- SPA fallback

`fetchWithIdentity()` 只允许在 `apiClient.ts`、`utils.tsx` 和上述豁免文件中直接调用。

### 5.6 前端：用户可见 async thunk 的失败反馈策略

所有 Redux thunk 按任务类型分类：

| 类型 | 示例 | 失败反馈 |
|------|------|----------|
| 用户主动操作 | 删除、保存、生成洞察、刷新连接 | 必须 snackbar 或 inline error |
| 用户可见自动任务 | 自动洞察、自动命名、字段类型推断 | 至少 warning；可降噪但不能完全静默 |
| 后台 best-effort | session 列表预取、connector 列表预热 | 可静默，但必须注释 |
| AbortError | 用户取消可静默；系统 timeout 不应静默 | 需要区分来源 |

对 `fetchChartInsight`：

- 手动点击洞察失败：显示 warning。
- 自动洞察失败：显示轻量 warning，或在洞察面板显示“生成失败，可重试”。
- 请求 timeout：显示“图表洞察请求超时，请重试”。
- 后端返回 `AGENT_ERROR`：显示后端 fallback 或本地 i18n 文案。

### 5.7 前端：自动洞察等待 chart cache 就绪（Phase 1b）

> **归属阶段**：Phase 1b。Phase 1 仍使用 image-based 洞察，因此必须在前端等待图片就绪后再发请求。Phase 2 改为 structured-first 后，此等待逻辑仅保留于 vision fallback 路径。

用“等待缓存就绪 + 有限重试”替代固定 1.5 秒：

```ts
await waitForChartImage(chartId, {
  timeoutMs: 8000,
  intervalMs: 250,
});
```

如果超时：

- 不调用后端。
- 进入 rejected 或返回明确 warning。
- 日志中标记 `reason=chart_image_not_ready`。

这可以把“图表还没渲染好”和“后端洞察失败”分开。

### 5.8 前端：统一 API 调用 wrapper 与 `parseApiResponse()` 最终形态

**`apiRequest()` 已采用 HTTP + body 双层判断**：

迁移完成后，`apiClient.ts` 中的 `apiRequest()` 先防御性处理 HTTP 非 2xx，再交给 `parseApiResponse()` 判断 body envelope：

```ts
export async function apiRequest<T = any>(
    url: string,
    options?: RequestInit,
): Promise<{ data: T }> {
    const response = await fetchWithIdentity(url, options);
    const body = await response.json();

    // parseApiResponse handles body-level success/error envelopes.
    return parseApiResponse<T>(body, response.status);
}
```

关键改进：
- `response.ok` 捕获 auth / transport 错误，body `status` 捕获 HTTP 200 的应用错误
- 返回类型简化为 `{ data: T }`，不再携带 `token`
- legacy 成功/错误格式不再兼容，协议违规会抛出 typed error

**面向 Redux thunk 的便捷 helper**：

```ts
async function requestJsonOrThrow<T>(url: string, options: RequestInit): Promise<T> {
  const { data } = await apiRequest<T>(url, options);
  return data;
}
```

前端 domain API 直接消费：

```ts
const insight = await requestJsonOrThrow<ChartInsightPayload>(url, options);
return { ...insight, chartId };
// insight 已经是纯业务 payload，不含 status/token/result 等协议字段
```

如果仍发现 endpoint 返回 `{status:"success", title, takeaways}` 或 `{error:"..."}`，应视为未完成迁移，而不是在前端继续叠兼容分支。

**`parseApiResponse()` 迁移后最终形态**：

`parseApiResponse()` 作为 `apiRequest()` 的低层辅助，只接受当前 envelope：

```ts
export function parseApiResponse<T = any>(
    body: any,
    httpStatus: number,
): { data: T } {
    if (body.status === 'error') {
        if (body.error && typeof body.error === 'object' && body.error.code) {
            throw new ApiRequestError(body.error as ApiError, httpStatus);
        }
        throw new ApiRequestError(
            { code: 'MALFORMED_ERROR', message: 'Malformed error response', retry: false },
            httpStatus,
        );
    }

    if (body.status !== 'success') {
        throw new ApiRequestError(
            { code: 'MALFORMED_RESPONSE', message: 'Malformed success response', retry: false },
            httpStatus,
        );
    }

    return { data: body.data as T };
}
```

删除的内容：

- `body.error_message ?? body.message ?? 'Unknown error'` 回退
- `body.result` 回退（只保留 `body.data`）
- `body.token` 返回（token 字段已移除）
- 对无 `code` 的 error 构造 `{ code: 'UNKNOWN', ... }` 的兜底

收到 legacy response shape 时，前端抛出 malformed/protocol 类错误，而不是静默降级为成功 payload。

### 5.9 前端：统一 LLM timeout 策略

新增一个统一 helper，避免每个 thunk 手写 `AbortController` 和硬编码毫秒数：

```ts
function createTimeoutAbort(
  seconds: number,
  label: string = 'Request',
): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException(
      `${label} timed out after ${seconds}s`,
      'TimeoutError',
    ));
  }, seconds * 1000);
  return {
    controller,
    clear: () => clearTimeout(timeoutId),
  };
}
```

系统超时抛出 `TimeoutError`，用户取消抛出 `AbortError`，reducer 通过 `action.error.name` 一行区分。

使用原则：

| 请求类型 | timeout 来源 |
|----------|--------------|
| LLM / Agent 用户可见请求 | `state.config.formulateTimeoutSeconds` |
| 长链路 Agent + 多工具循环 | `state.config.formulateTimeoutSeconds * N`，必须注释说明 |
| 模型连通性检查 | 独立健康检查 timeout，不跟随长推理设置 |
| 数据库 / connector connect | 独立连接 timeout，显示连接超时文案 |
| best-effort preview/debounce | 可短超时或无提示，但必须注释 |
| 用户主动取消 | 使用 `AbortController`，不等同于系统 timeout |

`fetchChartInsight` 应改为：

```ts
const timeoutSeconds = state.config.formulateTimeoutSeconds;
const controller = new AbortController();
const timeoutId = setTimeout(() => {
    controller.abort(new DOMException(
        `Chart insight timed out after ${timeoutSeconds}s`,
        'TimeoutError',
    ));
}, timeoutSeconds * 1000);
```

核心思路：`controller.abort(reason)` 接受一个自定义 reason 参数。系统超时时传入 `DOMException` 并指定 `name: 'TimeoutError'`；用户取消时调用无参 `controller.abort()`，默认抛出 `name: 'AbortError'`。

`fetch()` reject 时会使用 signal 上的 reason 作为错误对象。Redux Toolkit 的 `miniSerializeError` 保留 `name` 和 `message`，因此 rejected reducer 可以直接通过 `action.error.name` 区分，不需要额外的 flag 或 `rejectWithValue`：

```ts
.addCase(fetchChartInsight.rejected, (state, action) => {
    state.chartInsightInProgress = state.chartInsightInProgress.filter(id => id !== chartId);

    if (action.error?.name === 'TimeoutError') {
        state.messages.push({
            timestamp: Date.now(), type: 'warning',
            component: 'chart insight',
            value: t('messages.agent.insightTimedOut', { seconds: timeoutSeconds }),
        });
    } else if (action.error?.name !== 'AbortError') {
        state.messages.push({
            timestamp: Date.now(), type: 'warning',
            component: 'chart insight',
            value: getErrorMessage(action.error) || t('chart.insightFailed'),
        });
    }
    // AbortError（用户取消 / 组件卸载）→ 静默
})
```

三种情况的区分方式：

| `action.error.name` | 含义 | 处理 |
|---|---|---|
| `'TimeoutError'` | 系统超时 | 显示 warning，文案包含配置秒数 |
| `'AbortError'` | 用户取消或组件卸载 | 静默 |
| 其他（如 `'ApiRequestError'`） | 业务错误 | 显示 i18n 错误文案 |

**浏览器兼容性注意**：`AbortController.abort(reason)` 在 Chrome 98+、Firefox 100+、Safari 15.4+ 支持。旧浏览器会忽略 reason 参数，默认抛出 `AbortError`。实施前必须写一个兼容性验证测试，确认目标环境下 RTK `miniSerializeError` 保留 `DOMException.name === 'TimeoutError'`。若不支持，可改用自定义 `class TimeoutError extends Error { name = 'TimeoutError' }` 作为 polyfill。

不建议继续保留 `Promise.race` + inner `AbortController` 两层 timeout。双层 timeout 容易产生“外层 60 秒看起来更长，但内层 30 秒先终止”的误导。

### 5.10 移除 `token` 字段，改用 `X-Request-Id` Header

**背景**：当前所有 Agent 类 thunk 在请求 body 中发送 `token: Date.now()`，后端原样回传在响应 body 中。最初目的是手动关联请求-响应对。

**问题**：
1. 引入 RTK `createAsyncThunk` 后，每个 thunk dispatch 返回独立 Promise，前端已通过 `meta.arg` / `meta.requestId` 自动关联，不再需要 echo token。
2. 实际前端 `fulfilled` reducer 从未读取或校验响应中的 `token` 字段。
3. `token` 字段污染了 request body 和 response body，增加了 envelope 的复杂度。

**方案**：

| 需求 | 新方案 |
|------|--------|
| 请求追踪/日志排查 | 后端 middleware 生成 `X-Request-Id`（UUID），写入响应 header，同时记录在日志中 |
| 前端 thunk 请求关联 | RTK `meta.arg` + `meta.requestId` 已内置，无需额外字段 |
| 并发去重/取消 | `AbortController` + RTK `condition` option |

**后端 middleware**：

```python
import uuid
from flask import request, g

@app.before_request
def set_request_id():
    g.request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())

@app.after_request
def add_request_id_header(response):
    response.headers["X-Request-Id"] = g.request_id
    return response
```

如果前端传入了 `X-Request-Id`（如用于端到端追踪），后端沿用；否则后端自动生成。日志中统一使用 `g.request_id` 作为关联键。

**迁移方式**：

- 后端先做兼容：忽略请求 body 中的 `token` 字段（不报错），响应 body 中不再回传 `token`。
- 前端逐步删除所有 `token: Date.now()` / `token: String(Date.now())` 的发送代码。
- Streaming endpoint 中的 `"token": token` 字段同样移除。
- `apiClient.ts` 的 `parseApiResponse()` 返回类型移除 `token?: string`。

**涉及文件（前端）**：

- `src/app/dfSlice.tsx`：`fetchFieldSemanticType`、`fetchCodeExpl`、`fetchChartInsight`、`fetchAvailableModels` 的请求 body
- `src/app/useFormulateData.ts`：streaming 请求 body
- `src/views/SimpleChartRecBox.tsx`：streaming 请求 body
- `src/app/apiClient.ts`：`parseApiResponse` 返回类型

**涉及文件（后端）**：

- `py-src/data_formulator/routes/agents.py`：所有 `token = content["token"]` 和响应中的 `"token": token`

### 5.10.1 流式 endpoint 的 token 移除方案

流式 endpoint（NDJSON）中的 `token` 字段承担两个职责：(1) 每行事件包含 `"token": token`，前端用它匹配是哪次请求的响应；(2) error 事件同样携带 `"token"` 供前端关联。

**token 在流式 endpoint 中可以安全移除的原因**：

1. **一对一连接**：每次 `fetch()` 调用对应一个独立的 `ReadableStream`。前端 `for await (const line of reader)` 本身就在消费这一次请求的数据流，不存在"多条流混在一起需要 token 区分"的场景。
2. **RTK thunk 匹配**：streaming 请求已通过 RTK `createAsyncThunk` 的 `meta.requestId` / `meta.arg` 关联。前端不需要额外的 body 内 token 来确定"这是哪次请求的回包"。
3. **请求追踪**：改用 `X-Request-Id` HTTP Header 实现。流式响应的 Header 在第一个字节前已发出，前端可在 `response.headers.get('X-Request-Id')` 获取。

**迁移方案**：

| 当前流式格式 | 迁移后格式 | 说明 |
|-------------|-----------|------|
| `{token, status, result}` （`data-agent-streaming`、`refine-data`） | `{status, result}` | 移除顶层 `token`。前端消费已绑定到单次 fetch 调用，不需要 token 匹配。 |
| `{type:"error", error:{...}, token:"..."}` | `{type:"error", error:{...}}` | error 事件移除 `token`。请求追踪用 `X-Request-Id` Header。 |
| `{type:"question", text:"...", token:"..."}` 等业务事件 | `{type:"question", text:"..."}` | 移除所有业务事件中的 `token` 字段。 |
| 请求 body 中 `token: String(Date.now())` | 移除 | 不再发送。后端也不再读取。 |

**影响的流式 endpoint 清单**：

| 端点 | 当前序列化结构 | token 位置 | 迁移要点 |
|------|--------------|-----------|----------|
| `/data-agent-streaming` | `{token, status, result}` | 每行顶层 | Route 层 `json.dumps()` 移除 `token` key；前端解析时不再解构 `token` |
| `/refine-data` | `{token, status, result}` | 每行顶层 | 同上 |
| `/get-recommendation-questions` | 碎片累积后解析 | 事件中可选 | 确认实际是否有 `token`，无则不需改 |
| `/generate-report-chat` | `{type:"...", ...}` | error 事件中 | 仅 `stream_error_event()` 的 `token` 参数移除 |
| `/data-loading-chat` | `{type:"...", ...}` | error 事件中 | 同上 |
| `/clean-data-stream` | agent 直接 yield | error 事件中 | 同上 |

**`stream_error_event()` 签名变更**：

```python
# 迁移前
def stream_error_event(exc: AppError, *, token: str = "") -> str: ...

# 迁移后
def stream_error_event(exc: AppError) -> str: ...
```

移除 `token` 参数。所有 route 中 `yield stream_error_event(..., token=token)` 改为 `yield stream_error_event(...)`。

**前端适配**：

- `useFormulateData.ts`、`SimpleChartRecBox.tsx` 等手动解析 NDJSON 的代码中，如果有 `parsed.token` 的读取或匹配逻辑，需要删除。
- `streamRequest()` 返回的事件类型定义中移除 `token?: string`。

**与 dev-guides/1 的关系**：Phase 1c 更新 `dev-guides/1-streaming-protocol.md` 时：
- § 2.2 error 事件格式中移除 `token` 字段
- § 5 端点格式对照表中的序列化方式描述更新（移除 `token`）
- 新增端点 Checklist 移除"error 事件包含 token"要求

### 5.11 洞察输入：结构化数据优先，图片可选（Phase 2）

> 详见独立设计文档 `design-docs/18.2-insight-architecture-redesign.md`。

**方向摘要**：将 `ChartInsightAgent` 从“vision-first”改为“structured-first”——前端/后端先生成 deterministic profile（chart spec + 数据统计 + lineage），LLM 只负责基于结构化事实生成自然语言标题和 takeaways，默认不发送图片。图片仅作为可选 fallback 用于自定义图表、地图等 profile 无法表达的场景。

### 5.12 洞察 Agent 拆分（Phase 2）

> 详见独立设计文档 `design-docs/18.2-insight-architecture-redesign.md`。

**方向摘要**：拆为 `InsightProfiler`（确定性代码，不调用 LLM）和 `InsightNarratorAgent`（调用 LLM 生成文案）两层。`InsightProfiler` 不放在 `agents/`，而是放到新包 `py-src/data_formulator/insights/`；`agents/` 只保留真正调用模型的 `InsightNarratorAgent` 和兼容旧入口的 `ChartInsightAgent`。进一步按输入类型区分 `TableInsightProfiler`、`ChartInsightProfiler` 和 `VisionInsightFallback`。

现有 `/chart-insight` API 不新增平行路由绕开，而是保留 `ChartInsightAgent` 作为兼容门面，内部迁移为：

```text
ChartInsightAgent.run(...)
├── ChartInsightProfiler / TableInsightProfiler
├── InsightNarratorAgent
└── VisionInsightFallback（仅必要时）
```

## 6. 自动拦截与工程护栏

### 6.1 后端测试护栏

新增 contract tests，覆盖所有 `/api/` 普通 JSON endpoint：

1. invalid request 应用错误必须返回 HTTP 200 + `status: "error"`（auth 例外）。
2. 业务失败必须返回 HTTP 200 + `status: "error"`。
3. 成功响应必须返回 HTTP 200 + `status: "success"` 和 `data`。
4. LLM / connector / DB 已分类异常必须返回 HTTP 200 + 结构化 `error.code`，不能暴露原始异常文本。
5. 所有响应必须包含 `X-Request-Id` header。
6. 响应 body 中不得包含 `token` 字段。

对 chart insight 的测试应至少覆盖：

- 缺少 JSON body → HTTP 200 + `INVALID_REQUEST`。
- `ChartInsightAgent.run()` 返回 `[]` → HTTP 200 + `AGENT_ERROR`。
- `ChartInsightAgent.run()` 返回 `{"status":"other error","content":"..."}` → HTTP 200 + `AGENT_ERROR`。
- `ChartInsightAgent.run()` 抛出 timeout/rate limit 类异常 → HTTP 200 + 对应 LLM error code。
- 成功返回 HTTP 200 + `status:"success"` + `data` 包含 `title/takeaways`。

### 6.2 前端测试护栏

对每个用户可见 thunk 增加失败路径测试：

1. 后端返回 HTTP 200 + `{status:"error", error:{...}}` 或 auth 401/403 时 thunk rejected 并携带结构化 `ApiRequestError`。
2. 后端若仍返回 HTTP 200 + 裸 `{error:"..."}`，测试应失败并暴露后端未迁移，而不是作为正常兼容路径通过。
3. 请求 body 中不包含 `token` 字段。
3. rejected reducer 必须写入 `state.messages` 或组件 inline error。
4. timeout 不能完全静默。

对 chart insight 的测试：

- `{status:"error", error:{...}}` → warning。
- `{status:"success", data:{title,takeaways}}` → 写入洞察。
- 裸 `{error:"No insight generated"}` → contract test 失败，提示后端未迁移。
- `{status:"other error", content:"unable..."}` → contract test 失败，提示后端未迁移。
- `{status:"success"}` 但无 `data.title/data.takeaways` → warning 或 schema validation failure。
- 无 chart image → warning，并且不发送后端请求。

### 6.3 静态扫描脚本

新增 `scripts/check_api_error_guardrails.py`，在 CI 或 pre-commit 中运行。

扫描规则：

后端：

- 在 `py-src/data_formulator/routes/**/*.py` 和 `py-src/data_formulator/data_connector.py` 中发现 `jsonify({'error': ...})`、`jsonify({"error": ...})`，提示改为 `AppError` 或 `status:"error"`。
- 发现 `return jsonify(...), 400/500`，提示违反 HTTP 200 应用错误协议。
- 发现 `except Exception: return jsonify(...)` 且没有 `logger` / `raise classify...`，提示风险。

前端：

- 在 `src/**/*.ts(x)` 中发现 `fetchWithIdentity(` 后若同一函数内直接 `response.json()` 且没有 `parseApiResponse` / `apiRequest` / `throwIfApiError`，提示风险。
- 发现 `.addCase(thunk.rejected` 中没有 `state.messages.push`、`addMessages`、或明确注释 `best-effort`，提示风险。
- 发现 `.catch(() => {})` 无注释，提示风险。
- 发现 LLM / Agent 相关 thunk 中硬编码 `20000`、`30000`、`60000` 或 `*_TIMEOUT_MS`，且没有使用 `config.formulateTimeoutSeconds` 或显式特例注释，提示风险。
- 发现 `setTimeout(() => controller.abort()` 后没有对应的 `clearTimeout(timeoutId)` 调用，提示资源泄漏。

初期建议 CI 对历史违规生成 report；全量迁移完成后，任何新增或残留违规都阻断。

### 6.4 ESLint / TypeScript 约束

中期可以增加自定义 ESLint rule：

- 禁止在 `src/app/**/*.ts` 中直接调用 `fetchWithIdentity`，除 allowlist 文件外。
- 允许文件：
  - `src/app/apiClient.ts`
  - `src/app/utils.tsx`
  - 文件下载或第三方 URL helper

业务代码必须通过 `apiRequest`、`streamRequest` 或封装后的 domain API。

### 6.5 Code review checklist 更新

在 `.cursor/rules/implementation-review-checklist.mdc` 或相关 dev-guide 中补充：

- 新增/修改 API route 是否返回统一错误 envelope。
- 前端是否通过统一 API client 解析应用层错误。
- rejected reducer 是否有用户反馈。
- 自动任务失败是否可见，且是否避免噪音。
- 后端是否有结构化业务失败日志。

## 7. 实施计划

### 部署方式

本次前后端同步修改、同步上线，不存在滚动部署的兼容性问题。Phase 1a/1b/1c 是开发顺序而非部署顺序——后端先改完、前端跟进、最后统一清理 legacy 代码，但最终作为一个整体发布。

### Phase 1：错误协议全量迁移 + Chart Insight 修复

目标：消除"静默停止"，全量迁移所有 `/api/` JSON endpoint 到应用错误 HTTP 200 + 统一 envelope，移除 `token` 字段，建立测试 + 静态扫描 + ESLint 三层护栏。

#### Phase 1a：后端全量迁移

- 新增 `json_ok()` / `stream_preflight_error()` helper。
- 新增全局 `ERROR_CODE_HTTP_STATUS` 映射表 + `handle_app_error` handler（参见 5.2），确保 `raise AppError(...)` 自动返回正确的 HTTP 状态码（应用错误 200，auth 401/403）。
- 新增 `X-Request-Id` middleware（`before_request` / `after_request`），为所有请求生成追踪 ID（参见 5.10）。
- **一次性迁移所有 `/api/` JSON endpoint**（完整清单如下）：
  - `routes/agents.py`（非流式）：`chart-insight`、`code-expl`、`list-global-models`、`check-available-models`、`test-model`、`process-data-on-load`、`refresh-derived-data`、`workspace-summary`、`nl-to-filter`、`scratch-upload`、`sort-data`、`derive-data`、`refine-data`。
  - `routes/tables.py`：所有 13 个表 CRUD endpoint（已用 `classify_and_raise_db_error()`，需确认成功路径也包裹 `data`）。
  - `data_connector.py`（位于 `py-src/data_formulator/data_connector.py`，非 `routes/` 目录）：所有连接器 endpoint（已用 `classify_and_raise_connector_error()`，需确认成功路径）。
  - `routes/sessions.py`：所有 11 个会话管理 endpoint（`save`、`list`、`load`、`delete`、`create`、`rename`、`update-meta`、`export`、`import`、`migrate`、`cleanup-anonymous`）。
  - `routes/knowledge.py`：`limits`、`list`、`read`、`write`、`delete`、`search`、`distill-experience`。
  - `routes/credentials.py`：`list`、`store`、`delete`。
  - `routes/demo_stream.py`（非流式 endpoint）：评估是否纳入迁移或加入豁免列表（仅用于 demo 数据获取，可视为特例）。
- 所有成功响应统一为 HTTP 200 + `{"status": "success", "data": {...}}`。注意：当前代码中大量使用 `"status": "ok"`（见 dev-guides/7 § 2.1），本次 **全部改为 `"success"`**，不做过渡兼容。前端 Phase 1b 同步适配。
- 所有应用错误响应统一为 HTTP 200 + `{"status": "error", "error": {"code": "...", "message": "...", "retry": false}}`，auth 错误 401/403（参见 5.1 映射表）。
- 流式 endpoint 移除所有 NDJSON 事件中的 `"token"` 字段（详见 5.10.1），`stream_error_event()` 签名移除 `token` 参数。
- 移除所有非流式响应 body 中的 `"token": token` 字段。后端仍接受请求中的 `token` 字段（向后兼容，不报错），但不再回传。
- `/chart-insight` 特别处理：
  - 新增 vision 能力校验：`model_supports_vision(model) == False` 且 `chart_image` 非空时返回 `VALIDATION_ERROR`（HTTP 200 + error envelope）+ 明确提示切换模型。
  - 新增图片有效性校验：`chart_image` 为空字符串时返回 `VALIDATION_ERROR`（HTTP 200 + error envelope）+ 提示重试。
  - candidates 空 / `status != "ok"` 映射为 `AGENT_ERROR`（HTTP 200 + error envelope）；exception 使用 `classify_and_wrap_llm_error()`。
- `/code-expl` 同样迁移：与 `chart-insight` 模式相同。
- `list-models` 当前返回裸列表，需改为 HTTP 200 + `{"status": "success", "data": {"models": [...]}}`。列表类 endpoint 的 `data` 应使用命名字段包裹数组，以便后续扩展分页等元信息。
- 增加结构化失败日志（参见 5.4），日志中使用 `g.request_id` 作为关联键。
- ❌ `client_utils.py` 中的 `reasoning_effort` 参数化尚未完成；当前仍硬编码 `"low"`，留到 `design-docs/19` 的 Phase 3a。

**未来兼容性约束（Phase 1a）**：

以下设计决策是为了不阻碍 Phase 2/3 的多模型路由和结构化洞察扩展：

- **Vision 判断只在后端**：`/chart-insight` 的 vision 能力校验由后端 `model_supports_vision()` 完成。前端不做"如果 model 不支持 vision 就不调 insight API"的逻辑——未来后端 `ModelResolver` 会自动为 insight 任务选择 vision model。
- **`model` 字段语义为偏好**：request body 中的 `model` 字段保留为"用户偏好/主模型"。后端当前直接使用，但未来 `ModelResolver` 可在 `get_client()` 前替换实际使用的 model config。
- **`reasoning_effort` 参数化**：尚未完成。目标是让 `get_completion()` 接受 `reasoning_effort` 参数，Agent 调用时传入（如 `"low"` / `"medium"` / `"high"`），不在 `client_utils.py` 内按 model name 硬编码。
- **`chart_image` 允许为空**：API 接口不假设"永远有图片"。当 `chart_image` 为空时返回明确错误（而非静默失败），为 Phase 2 结构化输入留出空间。

**Response shape 变更明细（前后端配对修改清单）**：

以下 endpoint 的响应结构在迁移后会发生 breaking change，前端消费者必须同步修改：

| Endpoint | 当前后端响应 | 迁移后后端响应 | 前端消费位置 | 前端适配要点 |
|----------|-------------|---------------|-------------|-------------|
| `check-available-models` | 裸数组 `[{id, status, error, ...}]` | `{status:"success", data:{models:[...]}}` | `dfSlice.tsx` `fetchAvailableModels.fulfilled`: `action.payload` 当数组用 | `apiRequest()` 返回 `data`，reducer 改读 `action.payload.models` |
| `list-global-models` | 裸数组 `[{id, endpoint, ...}]` | `{status:"success", data:{models:[...]}}` | 初始化时获取模型列表 | 同上 |
| `test-model` | `{model, status:"ok"/"error", message}` 扁平 | `{status:"success", data:{model, test_status, message}}` | `ModelSelectionDialog.tsx`: `data["status"]`, `data["message"]` | 注意：外层 `status` 固定为 `"success"`（成功响应），模型测试结果移到 `data.test_status`。失败时用 `AppError` |
| `chart-insight` | 成功：`{status:"ok", title, takeaways, ...}` 扁平 | `{status:"success", data:{title, takeaways}}` | `dfSlice.tsx` `fetchChartInsight.fulfilled`: 解构 `action.payload` | 用 `apiRequest()` 后 payload 就是 `data` 内容，解构不变 |
| `code-expl` | 成功：`{status:"ok", explanation, ...}` 扁平 | `{status:"success", data:{explanation, ...}}` | `dfSlice.tsx` `fetchCodeExpl.fulfilled`: 整个 payload 赋给 `derive.explanation` | 用 `apiRequest()` 后 payload 是 `data`，可能需要调整字段读取 |
| `process-data-on-load` | `{status:"ok", result:[{fields:{...}}]}` | `{status:"success", data:{result:[...]}}` | `dfSlice.tsx` `fetchFieldSemanticType.fulfilled`: 检查 `data["status"]=="ok"` + `data["result"]` | 用 `apiRequest()` 后 payload 是 `data`（已去掉外层 status），直接读 `payload.result` |
| `refresh-derived-data` | 成功：`{status:"ok", rows:[...], row_count, message}` | `{status:"success", data:{rows, row_count, message}}` | `useDataRefresh.tsx`: `data.status === 'ok' && data.rows` | 用 `apiRequest()` 后 payload 是 `data`，改为 `payload.rows` |
| `workspace-summary` | `{status:"ok", summary:"..."}` 扁平 kwargs | `{status:"success", data:{summary:"..."}}` | `useWorkspaceAutoName.tsx`: `data.status === 'ok' && data.summary` | 用 `apiRequest()` 后 payload 是 `data`，改为 `payload.summary` |
| `nl-to-filter` | `{status:"ok", conditions, sort_columns, ...}` kwargs | `{status:"success", data:{conditions, sort_columns, ...}}` | 未找到直接前端消费（可能是组件内调用） | 确认消费位置后适配 |
| `scratch-upload` | `{status:"ok", filename, url}` kwargs | `{status:"success", data:{filename, url}}` | 报告生成流程中使用 | 确认消费位置后适配 |
| `tables/sample-table` | HTTP 200 + `{status:"success", rows:[...]}` 扁平 | HTTP 200 + `{status:"success", data:{rows:[...]}}` | `useDataRefresh.tsx`: `sampleData.status === 'success'` | 改为用 `apiRequest()`，payload 就是 `data` 内容，直接 `payload.rows` |
| `tables/*` (其余) | `{status:"success", ...}` 扁平 | `{status:"success", data:{...}}` | 各处直接 `response.json()` 后检查 `status` | 统一改用 `apiRequest()`，去掉 `status === 'success'` 检查 |

> **规则**：使用 `apiRequest()` 后，thunk 的 `action.payload` 就是 `body.data` 的内容（`parseApiResponse` 已提取），不再包含外层 `status`。所有 fulfilled reducer 中对 `action.payload.status` 的检查都需要删除。

#### Phase 1b：前端全量迁移

> **状态**：Phase 1b 已完成；Open Questions #1/#2 作为后续产品体验优化项保留，不再阻塞错误契约迁移。

- 所有 LLM / Agent 用户可见 thunk（`fetchChartInsight`、`fetchCodeExpl`、`fetchFieldSemanticType`）改用 `apiRequest()`。
- `apiRequest()` 改为 HTTP + body 双层判断（auth / transport 非 2xx 直接 throw，HTTP 200 应用错误由 `body.status === "error"` throw），fulfilled reducer 不再需要检查 `action.payload.status`。
- 移除所有请求 body 中的 `token: Date.now()` / `token: String(Date.now())` 字段（涉及 `dfSlice.tsx`、`useFormulateData.ts`、`SimpleChartRecBox.tsx`，参见 5.10）。
- `fetchChartInsight` timeout 改用 `state.config.formulateTimeoutSeconds`，删除 30s/60s 双层硬编码。
- ❌ `fetchCodeExpl` 和 `fetchFieldSemanticType` timeout 改用 `config.formulateTimeoutSeconds`（当前仍是 20s 硬编码）。
- ✅ 修复 `fetchCodeExpl` 和 `fetchFieldSemanticType` 中缺失的 `clearTimeout(timeoutId)` 调用。
- 系统超时通过 `controller.abort(new DOMException(..., 'TimeoutError'))` 传递给 reducer（参见 5.9），不需要 `rejectWithValue`。
- rejected reducer 通过 `action.error.name` 区分 `TimeoutError` / `AbortError` / 业务错误，显示对应 i18n warning。
- `fetchChartInsight` rejected reducer 区分系统超时（`TimeoutError`）、用户取消（`AbortError`）、业务错误三种情况。
- 实现 `waitForChartImage()` 替代自动洞察的固定 1500ms 延迟（参见 5.7）。
- Settings 按钮（`ConfigDialog`）的渲染条件从 `focusedId !== undefined` 改为 `isAppPage` 始终显示，确保空会话时用户也能调整超时配置（参见 2.9）。

**未来兼容性约束（Phase 1b）**：

- **不在前端做 vision 能力判断**：`fetchChartInsight` 始终调用后端 API，由后端返回 `VALIDATION_ERROR` 告知用户切换模型。前端 rejected reducer 展示后端错误消息即可。
- **不在 streaming 中引入与 `thinking_text` 矛盾的事件格式**：如果需要展示 Agent 推理过程，统一使用 `{type: "thinking_text", content: "..."}` 事件（参见 `dev-guides/1-streaming-protocol.md` § 2.4）。
- **insight 触发不依赖 model capability**：自动洞察的触发逻辑（`waitForChartImage` → call API）不检查 `model.supports_vision`。如果用户的模型不支持，后端会返回结构化错误，前端在 rejected reducer 中展示 warning。

#### Phase 1c：Legacy 清理与规范更新

- ✅ `parseApiResponse()` 删除 `body.error_message ?? body.message` 回退分支、`body.result` 回退、`token` 返回字段。
- ✅ 删除前端对裸 `{error: "..."}` 的兼容解析。
- ✅ 删除后端对请求 body / stream error 事件中通用 `token` 字段的依赖。
- ✅ **整体重写** `dev-guides/7-unified-error-handling.md`，当前契约为：应用错误 HTTP 200，仅 auth 使用 401/403。
- ✅ 同步更新 `dev-guides/1-streaming-protocol.md`：preflight 应用错误保持 HTTP 200，error 事件移除 `token` 字段。
- ✅ 更新 `.cursor/rules/unified-error-protocol.mdc`、相关 error-response / backend-test rules。
- ✅ 更新 `.cursor/skills/error-handling/SKILL.md`。
- ❌ 新增静态扫描脚本 `scripts/check_api_error_guardrails.py`。
- ❌ 把 guardrail 扫描接入 CI。

#### Phase 1 测试

- 后端：所有 `/api/` JSON endpoint 的 contract tests（成功路径断言 HTTP 200 + `status:"success"` + `data`；应用失败路径断言 HTTP 200 + `status:"error"` + `error.code`；auth 断言 401/403）。
- 后端：chart insight 特定测试（缺少 body、candidates 为空、候选 status 非 ok、LLM 已分类异常均返回统一 error envelope；成功路径 → 200）。
- 后端：`X-Request-Id` header 出现在所有响应中。
- 前端：`apiRequest()` 对 HTTP 200 应用错误、auth 401/403 和 transport 4xx/5xx 正确 throw `ApiRequestError`。
- 前端：`fetchChartInsight` error parsing tests。
- 前端：用户设置 180s 时不会被短硬编码超时截断。
- 前端：`parseApiResponse()` 对 legacy 格式抛出 malformed/protocol 类错误。
- 前端：请求 body 中不再包含 `token` 字段。

### Phase 2：Insight 架构重构 + 自动触发稳定性

> 详见独立设计文档 `design-docs/18.2-insight-architecture-redesign.md`。

目标：降低图片 token 成本，提高洞察事实质量，减少自动触发的偶发失败。具体设计包括新增 `py-src/data_formulator/insights/` 包、`TableInsightProfiler` / `ChartInsightProfiler`、`InsightNarratorAgent`、vision fallback 降级等。

### Phase 3：规范固化与长期护栏

目标：让未来开发默认遵循，防止同类问题复发。

- Code review checklist 更新（参见 6.4）。
- 为新增 API endpoint checklist 加上 "contract test required"。
- ESLint rule：禁止业务代码直接调用 `fetchWithIdentity()`（参见 6.4）。

## 8. 对“表格洞察”的产品边界建议

> 详见 `design-docs/18.2-insight-architecture-redesign.md`。

摘要：建议明确拆成 Chart Insight（输入 chart spec + profile，默认不传图片）和 Table Insight（输入 table schema + statistics，不依赖 PNG）两类产品能力，共享同一套 profile 生成基础设施。

## 9. 成功标准

修复后应满足：

- ✅ 所有 `/api/` 普通 JSON endpoint 都已补充合约测试；❌ 静态扫描待接入。
- ✅ 所有 `/api/` 普通 JSON 成功响应都是 `status:"success"` + `data`。
- ✅ 所有 `/api/` 普通 JSON 应用失败响应都是 HTTP 200 + `status:"error"` + `error.code/message/retry`（auth 401/403）。
- ✅ 文件下载、NDJSON、redirect 等特例已在规范中明确。
- ✅ chart insight 后端所有失败响应都有 `status:"error"` 和 `error.code`。
- ✅ 前端收到任何失败响应都不会进入 fulfilled 静默路径。
- ✅ 自动洞察因图表未渲染好失败时，用户可见且日志可定位。
- ✅ timeout 不再完全静默。
- ✅ 用户把 `formulateTimeoutSeconds` 设置为 180 秒时，chart insight 不会被 30 秒硬编码超时提前 abort。
- ❌ LLM / Agent 用户可见任务仍存在未说明的 20 秒硬编码前端超时（`fetchCodeExpl`、`fetchFieldSemanticType`）；Chart Insight 的 30/60 秒问题已修复。
- ❌ （Phase 2/3）普通 chart insight 默认不发送 chart image；LLM 输入以结构化 profile 为主。
- ❌ （Phase 2/3）只有明确 fallback 场景会发送低分辨率图片，并在日志/diagnostics 中标记 `image_used=true`。
- ✅ 后端日志能区分 `no_candidates`、`candidate_error`、`parse_failed`、`llm_exception`。
- ✅ 新增测试覆盖本次复现路径。
- ❌ 静态扫描能发现新增的裸 `{error: ...}`、未解析 `fetchWithIdentity().json()` 和未说明的 LLM 硬编码 timeout。
- ✅ 前端 `parseApiResponse()` 不再包含 `body.error_message`、`body.message`、`body.result` 回退分支。
- ✅ 收到 legacy / malformed response shape 时前端抛出错误，而不是静默降级。
- ✅ `dev-guides/7-unified-error-handling.md` 已删除 legacy 兼容格式，不再只标记 deprecated。
- ✅ 所有 `/api/` JSON 成功响应的 `body.status === "success"` 且业务数据在 `body.data` 中，无扁平散布。

## 10. Open Questions

1. 自动洞察失败是否应该长期保持 snackbar，还是在 Phase 2/3 改为洞察 tab 内 inline error？
2. 自动洞察是否继续默认开启，还是在 structured-first Insight 后改为用户第一次打开洞察 tab 时 lazy generate？
3. ~~Table insight 是否纳入本次修复，还是作为 Phase 2.5 单独实现？~~ **已决定**：Phase 2/2.5 合并，Table insight 纳入 Phase 2。
4. ~~全局 `after_request` guard 在 production 初始阶段是否先 `warn`，还是迁移完成后直接 `error`？~~ **已决定**：不使用运行时 guard，依赖合约测试 + 静态扫描 + ESLint 三层防线。
5. ~~全量迁移时哪些 endpoint 必须进入豁免列表？~~ **已决定**：不使用运行时 guard，豁免列表不再需要。NDJSON/文件下载/redirect 等仅在静态扫描脚本中作为排除项处理。
6. `fetchFieldSemanticType` 这类自动 metadata 推断是否完全跟随 `formulateTimeoutSeconds`，还是单独增加可配置的 metadata timeout？
7. 哪些图表类型必须保留 vision fallback，例如地图、自定义 mark、复杂组合图？

## 11. 已确定的设计决策

| 决策项 | 结论 |
|--------|------|
| HTTP 状态码 | ~~原设计：HTTP 语义化 4xx/5xx~~ **修订为**：应用错误 HTTP 200，仅 auth 401/403（2026-04-30 修订） |
| 成功响应格式 | HTTP 200 + `{"status": "success", "data": {...}}`，不允许扁平散布 |
| 错误响应格式 | HTTP 200 + `{"status": "error", "error": {"code", "message", "retry"}}`（auth 错误 401/403），废弃扁平 `message` / `error_message` |
| `status` 字段 | 保留。与 HTTP 状态码冗余但有独立价值：body 自描述、日志可搜、合约断言可用 |
| `token` 字段 | 移除（含非流式和流式）。请求追踪改用 `X-Request-Id` HTTP Header（非流式参见 5.10，流式参见 5.10.1） |
| Legacy 兼容 | 全量迁移完成后删除。前端 `parseApiResponse()` 不再保留 legacy 回退分支 |
| `status` 值 | 成功响应统一为 `"success"`，废弃 `"ok"`。Phase 1a 后端全量改写，Phase 1b 前端同步适配 |
| 与 dev-guides/7 关系 | dev-guides/7 已重写，反映最终策略：应用错误 HTTP 200 + body error，auth 401/403 ✅ |
| 与 dev-guides/1 关系 | dev-guides/1 已无冲突（"始终返回 200" 与新策略一致）。stream `token` 已移除 ✅ |
| 迁移范围 | 本次全量迁移所有 `/api/` JSON endpoint，不分批 |
| Phase 2 / 2.5 | 合并为 Phase 2（Insight 架构重构 + 自动触发稳定性） |
| `InsightProfiler` 模块位置 | 放在新包 `py-src/data_formulator/insights/`，不放在 `agents/`；它是数据画像/结构化事实生成器，不是 LLM Agent |
| 运行时 Guard | 不使用。依赖合约测试 + 静态扫描 + ESLint 三层防线 |
| 部署方式 | 前后端同步修改、同步上线。1a/1b/1c 是开发顺序，最终作为整体发布 |

## 12. 推荐实施顺序

1. ~~**Phase 1a**：后端基础设施 + endpoint 迁移~~ **✅ 全部完成**（`json_ok`、`stream_preflight_error`、全局 handler、7/7 route 全量迁移、HTTP 200 策略修订）
2. ~~**Phase 1b**：前端 `apiRequest()` + thunk 适配~~ **✅ 全部完成**（`apiRequest()` 双层检测、所有 thunk 迁移到 `apiRequest()`、请求 body 移除 `token`）
3. **Phase 1c 收尾**：~~删除前端 legacy 兼容分支 + 后端清理 `token` 读取代码 + 更新 dev-guides/7、dev-guides/1、rules、skill~~ **✅ 已完成**；静态扫描脚本 + CI 接入 **❌ 待做**。
4. **Phase 2**（独立设计文档 `18.2-insight-architecture-redesign.md` + `19-multi-model-routing.md`）：InsightProfiler + TableInsightProfiler + ModelResolver + 多模型路由 + 自动触发稳定性 + vision fallback 降级 + `reasoning_content` 提取。
5. **Phase 3**：ESLint rule + review checklist + per-agent reasoning config + 规范固化。

这样不再依赖开发者记住协议细节，而是由测试、静态扫描和 CI 三层防线防止回归。
