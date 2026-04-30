# 20 - API 错误契约与 Insight 稳定性分期实施计划

> 状态：Phase 2 已完成（2c/2d 全量迁移 + HTTP 200 策略修订 + legacy 解析清理）；静态扫描/CI 与 Phase 3 待启动  
> 创建日期：2026-04-30  
> Phase 0 完成日期：2026-04-30  
> Phase 1 完成日期：2026-04-30  
> Phase 2a/2b 完成日期：2026-04-30  
> Phase 2c/2d 完成日期：2026-04-30  
> Phase 2c 进度：credentials ✅ | knowledge ✅ | sessions ✅ | tables ✅ | agents ✅ | data_connector ✅ | app ✅  
> Phase 2d 进度：前端 thunk 全部迁移到 apiRequest() ✅  
> HTTP 状态码修订：应用错误 HTTP 200，仅 auth 401/403 ✅  
> 待办：`fetchCodeExpl` / `fetchFieldSemanticType` 20s 硬编码 timeout 清理 | 前端全量 vitest/回归验证 | 静态扫描脚本与 CI 接入 | Phase 3 Structured-first Insight + ModelResolver  
> 前置文档：`design-docs/18-api-error-guardrails-and-chart-insight-failure.md`、`design-docs/18.2-insight-architecture-redesign.md`、`design-docs/19-multi-model-routing.md`  
> 相关规范：`dev-guides/1-streaming-protocol.md`、`dev-guides/7-unified-error-handling.md`
> 最近两次提交核对（2026-04-30）：  
> - `4455d3d`：完成 Phase 2 大批普通 JSON API 迁移、前端 `apiRequest()` 适配、credentials/knowledge 合约测试和文档归档。  
> - `59d09e1`：统一应用错误 HTTP 200 策略、补齐 streaming / auth / storage-full 等错误处理、移除 legacy response 解析和 stream error token、补充后端协议合约与前端 API client 测试。  
> - 未完成：`fetchCodeExpl` / `fetchFieldSemanticType` timeout 配置化、静态扫描脚本/CI、structured-first Insight、`ModelResolver`、per-agent `reasoning_effort` 参数化。

## 1. 背景

当前 Chart Insight 的主要问题不是单个异常，而是三类问题叠加：

1. `/api/agent/chart-insight` 失败响应格式不统一，前端可能把错误 body 当成成功 payload 处理。
2. `fetchChartInsight` 使用硬编码 timeout，实际 30 秒 abort，且没有跟随 `config.formulateTimeoutSeconds`。
3. 自动洞察依赖 chart PNG cache，但当前只用固定延迟触发，容易在图表尚未渲染完成时请求后端。

同时，`18.2` 的 structured-first Insight 和 `19` 的多模型路由都依赖更稳定的错误契约和失败反馈。因此实施顺序应先解决用户可见故障，再扩大到全量 API 契约迁移，最后进入 Insight 架构重构和模型路由。

## 2. 总体原则

- 先修用户可见故障，再做全量协议重构。
- 先盘点边界，再迁移 endpoint，避免普通 JSON、NDJSON、下载、redirect 混在一起改。
- 普通 JSON API 和 NDJSON streaming 统一：所有应用可控错误返回 HTTP 200 + `status: "error"`（仅 auth 错误使用 401/403）；已建立的 NDJSON 流通过流内 `type: "error"` 事件表达运行中错误。
- 第一阶段不抢跑 structured-first Insight，也不在前端做 vision capability 判断，为后续 `ModelResolver` 留出空间。
- 每个阶段都要有 focused tests，不把测试留到最后。

## 3. 分期总览

```text
Phase 0: API / timeout / streaming 盘点          ✅ 已完成 2026-04-30
    ↓
Phase 1: Chart Insight 可见故障修复               ✅ 已完成 2026-04-30
    ↓
Phase 2: 普通 JSON API 契约全量迁移              ✅ 已完成 2026-04-30（含 HTTP 200 策略修订）
    ↓
Phase 3: Structured-first Insight + 多模型路由    ⬜ 待启动
```

## 4. Phase 0：前后端 API 交互盘点 ✅

> **完成日期**: 2026-04-30  
> **产出**: 本文档附录 A（Endpoint Matrix）

### 4.1 目标

先整理一份 endpoint matrix，确认每个 API 当前的响应格式、前端消费位置和迁移风险。这个阶段以文档和审计为主，不做大规模业务代码修改。

Streaming endpoint 在 Phase 0 只做统计和边界确认，不做协议行为迁移。原因是当前前端仍有多个手写 reader 消费者，部分流式链路还依赖响应体里的 `token` 做请求匹配；如果和普通 JSON API 一起改，会把回归面扩大到 Data Agent、Report Agent 和 Data Loading Chat。

### 4.2 盘点范围

普通 JSON endpoint：

- 后端 route 文件和 endpoint 名称。
- 当前成功响应格式。
- 当前错误响应格式。
- 当前 HTTP status 使用方式。
- 是否读写 `token`。
- 前端消费位置。
- 是否直接调用 `fetchWithIdentity().json()`。
- 是否适合迁移到 `apiRequest()`。

NDJSON streaming endpoint：

- MIME 是否为 `application/x-ndjson`。
- 当前业务事件格式，例如纯 `{type: ...}`，还是 legacy `{token, status, result}`。
- 流内 error / warning 事件格式，是否使用 `stream_error_event()` 和 `_with_warnings()`。
- 是否在事件中携带 `token`，以及前端是否仍依赖 `data.token === token`。
- 流建立前校验失败当前如何返回：`200 application/json`、未来目标 `4xx application/json`，或其他格式。
- 前端消费代码是否处理 `type: "error"` 和 `type: "warning"`。
- 前端消费者是标准 `streamRequest()`，还是手写 `fetchWithIdentity()` + `ReadableStream` reader。

豁免类 endpoint：

- 文件下载、CSV、blob。
- OIDC redirect / auth callback。
- SPA fallback。
- 第三方 URL 代理或外部服务原样转发。

前端 timeout：

- LLM / Agent 用户可见请求。
- 自动任务。
- 模型健康检查。
- 数据连接器 / 网络 I/O。
- best-effort preview / debounce。

### 4.3 产出

- `design-docs/` 中补充 endpoint matrix，或在本文档后续追加表格。
- 明确 Phase 1 只修 Chart Insight，Phase 2 再做普通 JSON API 全量迁移。
- 明确 streaming 的迁移边界：流运行中错误不改 HTTP status；流建立前校验失败后续与普通 JSON error envelope 对齐，但不在 Phase 1 强制修改。
- 标记文档与现状不一致的位置。例如 `dev-guides/1-streaming-protocol.md` 把 `refine-data` 列为 NDJSON streaming，但当前实现仍是普通 JSON endpoint，应在 matrix 中单独标注。

### 4.4 验收标准

- 所有 `/api/` 普通 JSON endpoint 都能定位到后端 route 和前端消费者。
- 所有 NDJSON endpoint 都能定位到流内 error/warning 消费逻辑。
- 所有需要保留的非 JSON 特例都有原因。
- Chart Insight 所需的最小改动范围已经明确。
- Streaming endpoint 的“当前行为”和“未来目标行为”分开记录，避免实施时误把统计项当成 Phase 1 改造项。

## 5. Phase 1：Chart Insight 可见故障修复 ✅

> **完成日期**: 2026-04-30  
> **改动文件**: `routes/agents.py`、`dfSlice.tsx`、`App.tsx`、`useFormulateData.ts`、`SimpleChartRecBox.tsx`、`messages.json`(en/zh)  
> **测试**: `tests/backend/routes/test_chart_insight_route.py`(8 passed)、`tests/frontend/unit/app/chartInsight.test.ts`(5 passed)

### 5.1 目标

优先消除“loading 停止但没有洞察也没有提示”的用户可见故障。这个阶段不追求全量 API 契约迁移，只把 Chart Insight 链路修到稳定、可观察、可测试。

### 5.2 前端改动

`fetchChartInsight` timeout 改造：

- 删除 30 秒 `AbortController` 和 60 秒 `Promise.race` 双层 timeout。
- 使用 `state.config.formulateTimeoutSeconds`。
- 系统超时使用可区分的 `TimeoutError`。
- 用户主动取消仍可按 `AbortError` 静默处理。

伪代码：

```text
timeoutSeconds = state.config.formulateTimeoutSeconds
controller = createTimeoutAbort(timeoutSeconds, "Chart insight")
try:
    result = apiRequest(CHART_INSIGHT_URL, { signal: controller.signal })
finally:
    controller.clear()
```

错误反馈策略：

- 系统 timeout：显示 warning。
- 后端业务错误：显示 warning 或洞察面板 inline error。
- 用户取消：可静默。
- 自动洞察失败：不能完全静默，至少有轻量提示或可重试状态。

自动洞察触发：

- 用 `waitForChartImage()` 替代固定 1.5 秒延迟。
- cache 未就绪时不调用后端。
- 将 `chart_image_not_ready` 和后端失败区分开。

伪代码：

```text
if autoInsight:
    image = waitForChartImage(chartId, timeout=8s, interval=250ms)
    if image missing:
        mark insight failed with reason chart_image_not_ready
        return
    request chart insight
```

Settings 入口：

- `ConfigDialog` / Settings 按钮不再依赖 `focusedId`。
- 空会话也允许用户调整 `formulateTimeoutSeconds`。

### 5.3 后端改动

`/api/agent/chart-insight` 先做局部稳定化：

- 缺少必要参数返回结构化错误。
- `chart_image` 为空或不可用返回明确错误。
- model 不支持 vision 且请求包含图片时返回明确错误。
- candidates 为空、`status != "ok"`、JSON 解析失败都映射到可识别的业务失败。
- LLM timeout / rate limit / auth 继续通过现有分类工具包装。
- 增加结构化日志，不记录完整表数据、图片、密钥或 token。

伪代码：

```text
validate request
validate image availability
validate model vision capability on backend
run ChartInsightAgent
if no candidate or candidate failed:
    raise structured agent error
return title and takeaways
```

### 5.4 测试

前端测试：

- 用户设置 `formulateTimeoutSeconds = 180` 时，不会 30 秒提前 abort。
- timeout 进入 rejected 并显示 warning。
- `AbortError` 不显示系统 timeout 文案。
- 无 chart image 时不发送后端请求。
- 后端错误响应不会进入 fulfilled 静默路径。

后端测试：

- 缺少 request body / 参数时返回结构化错误。
- `chart_image` 为空时返回结构化错误。
- candidates 为空时返回 `AGENT_ERROR`。
- candidate `status != "ok"` 时返回 `AGENT_ERROR`。
- 成功时返回 `title` 和 `takeaways`。

### 5.5 验收标准

- Chart Insight 不再被 30 秒硬编码 timeout 截断。
- 用户设置的 `formulateTimeoutSeconds` 对 Chart Insight 生效。
- 自动洞察在 chart image 未就绪时不会盲目请求后端。
- 所有 Chart Insight 失败路径都有用户可见反馈或 inline 状态。
- 后端日志能区分 `chart_image_not_ready`、`no_candidates`、`candidate_error`、`llm_exception`。

## 6. Phase 2：普通 JSON API 契约全量迁移

### 6.1 目标

将普通 `/api/` JSON endpoint 统一迁移到统一 response envelope（成功 `json_ok()`、错误 `raise AppError()`），所有应用错误返回 HTTP 200 + `status: "error"`（仅 auth 使用 401/403），避免未来 endpoint 再出现裸 `{error: ...}` 或扁平 `status: "ok"` 格式。

### 6.2 后端改动

新增统一 response helper：

- `json_ok(data)`：成功响应统一为 `{"status": "success", "data": {...}}`。
- `raise AppError(...)`：应用错误响应统一为 `{"status": "error", "error": {"code", "message", "retry"}}`。
- `stream_preflight_error(error)`：流建立前应用错误返回 HTTP 200 + JSON error envelope。
- `AppError` 根据 `ErrorCode` 映射 HTTP status：应用错误 200，auth 401/403。

迁移范围：

- `routes/credentials.py` credential endpoint。 ✅ 已完成 2026-04-30
- `routes/knowledge.py` knowledge endpoint。 ✅ 已完成 2026-04-30
- `routes/sessions.py` session endpoint。 ✅ 已完成 2026-04-30
- `routes/tables.py` 表 CRUD endpoint。 ✅ 已完成 2026-04-30（4 处豁免：文件下载端点）
- `routes/agents.py` 中所有非流式 JSON endpoint。 ✅ 已完成 2026-04-30
- `data_connector.py` connector endpoint。 ✅ 已完成 2026-04-30
- `app.py` 顶层路由（`/api/auth/info`、`/api/app-config`）。 ✅ 已完成 2026-04-30

`token` 处理：

- ✅ 响应 body 不再回传通用 `token`。
- ✅ 前端业务 thunk 不再发送通用 `token`。
- ✅ 后端 route 不再依赖通用请求 `token` 读取逻辑。

### 6.3 前端改动

`apiRequest()` 成为普通 JSON API 的标准入口：

- 先防御性检查 `response.ok`，捕获 auth / transport 错误。
- 成功时只返回 `body.data`。
- body `status:"error"` 时抛出 `ApiRequestError`（应用错误通常是 HTTP 200）。
- 不再兼容裸 `{error: ...}`、`error_message`、`message`、`body.result`。

业务 thunk 改造：

- 不再直接 `fetchWithIdentity().json()`。
- fulfilled reducer 不再检查 `payload.status`。
- rejected reducer 负责用户反馈。
- 请求 body 移除 `token`。

### 6.4 Streaming 边界

> **决策变更 2026-04-30**：原计划最终将流预检失败从 HTTP 200 切到 4xx，现已取消——统一所有应用错误为 HTTP 200，流式和非流式行为一致。

NDJSON endpoint 与普通 JSON endpoint **统一**使用 HTTP 200：

- 流建立后：HTTP 200 + `application/x-ndjson`，运行中错误通过 `{type: "error"}`。
- 流建立前：返回 `200 application/json + status:"error"`（使用 `stream_preflight_error()`）。
- 流式错误事件中的通用 `token` 已移除；请求追踪使用 `X-Request-Id` header。

Streaming 剩余待办：

1. ~~先新增后端小 helper。~~ ✅ stream_preflight_error() 已实现。
2. ~~前端主要手写 reader 逐步迁到 streamRequest()。~~ ✅ 已完成主要 Agent/streaming 消费者迁移。
3. ~~确认前端不再依赖流事件中的 token 后，后端停止发送 stream token。~~ ✅ 已完成；`stream_error_event()` 不再携带通用 `token`。
4. ~~把流建立前校验失败从 200 切到 4xx。~~ ❌ **已取消**（统一 HTTP 200 策略）

伪代码：

```text
if preflight validation failed:
    return stream_preflight_error(error)  # HTTP 200 + application/json

return ndjson_response(generate)  # HTTP 200 + application/x-ndjson
```


### 6.5 测试与护栏

后端：

- ✅ contract tests 覆盖普通 JSON endpoint 成功和失败 shape。
- ✅ `X-Request-Id` header 测试。
- ✅ Chart Insight、code explanation、model list 等高风险 endpoint 单独覆盖。

前端：

- ✅ `apiRequest()` 对 2xx / 4xx / 5xx 和 HTTP 200 应用错误的解析测试已补充。
- ✅ legacy 格式不再静默兼容，触发 malformed/protocol 类错误。
- ✅ 业务 thunk 不再发送通用 `token`。

静态扫描：

- ❌ 检查裸 `jsonify({"error": ...})`。
- ❌ 检查扁平 `status: "ok"`。
- ❌ 检查业务代码直接 `fetchWithIdentity().json()`。
- ❌ 检查未说明的 LLM 硬编码 timeout。

### 6.6 文档更新

- ~~重写 `dev-guides/7-unified-error-handling.md`。~~ ✅ 已完成
- ~~更新 `dev-guides/1-streaming-protocol.md`：流建立后 200，流建立前校验失败可 4xx JSON。~~ ✅ 已按统一 HTTP 200 策略同步清理，早期 4xx 切换方案已取消
- ~~更新错误处理 skill 和相关 rule。~~ ✅ 已完成（`unified-error-protocol.mdc`、`error-response-safety.mdc`、`backend-test-conventions.mdc`）
- 将新增 endpoint checklist 改为要求 contract test。

### 6.7 验收标准

- ✅ 普通 JSON API 成功响应全部为 `status: "success"` + `data`。
- ✅ 普通 JSON API 失败响应全部为 `status: "error"` + `error.code/message/retry`。
- ✅ 前端业务代码不再直接消费未解析的 `response.json()`（文件下载、blob、auth 特例除外）。
- ✅ legacy response shape 不再被静默兼容。
- ❌ 静态扫描能发现新增违规。

## 7. Phase 3：Structured-first Insight 与多模型路由

> 状态：❌ 待启动。最近两次提交没有新增 `insights/` 包、`ModelResolver` 或 per-agent capabilities。

### 7.1 目标

在错误契约和用户反馈稳定后，将 Insight 从 vision-first 改为 structured-first，并引入后端任务级模型路由。

### 7.2 Insight 架构重构

新增 `py-src/data_formulator/insights/`：

- `profile_types.py`：定义 profile 和 diagnostics 类型。
- `table_profiler.py`：生成 table stats / schema / sample profile。
- `chart_profiler.py`：生成 chart spec / encoding / visual aggregate profile。
- `vision_fallback.py`：判断是否需要图片 fallback。

Agent 拆分：

- `ChartInsightAgent` 保留为兼容门面。
- `InsightNarratorAgent` 负责调用 LLM 生成自然语言 title / takeaways。
- 图片只在 fallback 场景使用，并记录 `image_used=true`。

### 7.3 多模型路由

新增 `ModelResolver`：

- 用户选择的模型作为主模型 / 偏好。
- 后端按任务类型选择实际模型。
- 不配置任务级模型时 fallback 到用户主模型。
- Insight 需要 vision fallback 时，后端确保实际模型支持 vision。

任务类型：

- `data_generation`
- `insight`
- `cheap`
- `chat`
- `explore`
- `report`

### 7.4 测试

- profile 大小裁剪。
- 数值 / 类别 / 时间字段统计正确性。
- table insight 不依赖 chart image。
- 普通 chart insight 默认不发送图片。
- vision fallback 只在明确场景触发。
- `ModelResolver` 覆盖 env override、fallback、vision capability 校验。

### 7.5 验收标准

- 普通 Chart Insight 默认基于结构化 profile。
- Table Insight 可以在没有 chart image 时生成。
- vision fallback 有明确 diagnostics。
- 前端不需要知道实际使用哪个模型。
- 后端日志能记录 task type、resolved model 和 fallback 原因。

## 8. 建议实施顺序

1. ~~完成 Phase 0 endpoint matrix。~~ ✅
2. ~~在 matrix 中把 NDJSON streaming 标成“只统计，不做 Phase 1 行为迁移”。~~ ✅
3. ~~实施 Phase 1 的 Chart Insight 修复，并先跑相关前后端测试。~~ ✅
4. ~~再启动 Phase 2 普通 JSON API 迁移，按 route 分批开发，但最终同步上线。~~ ✅ 已完成（7/7 route 全量迁移 + 前端 thunk 适配 + HTTP 200 策略修订）
5. Phase 2 收尾：~~移除 legacy 格式兼容、stream `token` 移除~~ ✅；前端全量 vitest/回归验证、静态扫描 CI ❌。
6. Phase 2 稳定后再进入 Phase 3 的 structured-first Insight 和 ModelResolver（尚未启动）。

## 9. 当前不建议做的事

- ~~不建议第一期直接实现 `InsightProfiler`，因为失败反馈和 API 契约尚未稳定。~~ ✅ 前置契约已稳定；`InsightProfiler` 可作为 Phase 3 启动项。
- ~~不建议第一期直接全量迁移所有 `/api/` JSON endpoint，除非同时安排完整前端适配和 contract tests。~~ ✅ 已全量迁移
- 不建议把 NDJSON streaming 运行中错误改成 HTTP 4xx/5xx，因为流建立后 HTTP status 已经无法改变。
- ~~不建议第一期移除 streaming `token` 或改 `data-agent-streaming` 的 legacy `{token, status, result}` 事件格式，因为当前前端仍有消费者依赖它。~~ ✅ 已在最近提交中完成主要 reader 迁移并移除通用 stream error `token`。
- ~~不建议第一期把 streaming 预检失败从 `200 application/json` 改为 `4xx application/json`。~~ ❌ 已永久取消（统一 HTTP 200 策略）
- 不建议前端通过 `model.supports_vision` 决定是否调用 Insight API，这会阻碍后续后端多模型路由。

## 10. 开放问题

1. 自动洞察失败时，默认显示 snackbar，还是只在洞察 tab 打开时显示 inline error？
2. 自动洞察是否继续默认开启，还是改为用户第一次打开洞察 tab 时 lazy generate？
3. `fetchFieldSemanticType` 是否完全跟随 `formulateTimeoutSeconds`，还是新增独立 metadata timeout？
4. 哪些图表类型必须保留 vision fallback？

---

## 附录 A：Phase 0 Endpoint Matrix

> 下表是对当前所有 `/api/` 路由的盘点结果。列说明见表头。  
> **Phase 1 只改了 `/api/agent/chart-insight`**，其余 endpoint 留待 Phase 2 迁移。
> **状态说明（2026-04-30）**：该 matrix 保留为 Phase 0 历史盘点快照；最近两次提交已经完成 Phase 2 全量迁移，表内大量 “当前响应格式 / 消费方式” 不再代表 HEAD 现状。

### A.1 Agent 路由（`routes/agents.py`，前缀 `/api/agent/`）

#### 普通 JSON endpoint

| Endpoint | Method | 成功响应格式 | 错误响应格式 | 读 body `token` | 回传 `token` | 前端消费者 | 消费方式 | Phase 1 改动 |
|---|---|---|---|---|---|---|---|---|
| `/list-global-models` | GET/POST | `[{...model}]` 裸数组 | N/A | 否 | 否 | `dfSlice.tsx` fetchGlobalModelList | `fetchWithIdentity().json()` | 无 |
| `/check-available-models` | GET/POST | `[{...model}]` 裸数组 | N/A | 否 | 否 | `dfSlice.tsx` fetchAvailableModels | `fetchWithIdentity().json()` | 无 |
| `/test-model` | GET/POST | `{status:"ok",model_info:{}}` | `{error:"..."}` | 否 | 否 | `dfSlice.tsx` testModel | `fetchWithIdentity().json()` | 无 |
| `/process-data-on-load` | GET/POST | `{status:"ok",result:{candidates:[]}}` | `{status:"error",...}` | 是 | 是 | `dfSlice.tsx` fetchFieldSemanticType | `fetchWithIdentity().json()` | 无 |
| `/sort-data` | GET/POST | `{status:"ok",content:[]}` | `{status:"error",...}` | 否 | 否 | `dfSlice.tsx` | `fetchWithIdentity().json()` | 无 |
| `/derive-data` | GET/POST | `{status,token,result:{candidates:[]}}` | `{status:"error",error_message}` | 是 | 是 | `useFormulateData.ts` formulateData | `fetchWithIdentity().json()` | 无 |
| `/refine-data` | GET/POST | `{status,token,result:{candidates:[]}}` | `{status:"error",error_message}` | 是 | 是 | `useFormulateData.ts` formulateData | `fetchWithIdentity().json()` | 无（⚠️ `dev-guides/1-streaming-protocol.md` 误列为 NDJSON） |
| `/code-expl` | GET/POST | `{status:"ok",content:"..."}` | `{error:"..."}` | 是 | 否 | `EncodingBox.tsx` | `fetchWithIdentity().json()` | 无 |
| `/chart-insight` | POST | `{status:"ok",title,takeaways}` | **AppError → unified envelope** | ~~是~~ → **否** | ~~是~~ → **否** | `dfSlice.tsx` fetchChartInsight | `fetchWithIdentity().json()` | **已完成** |
| `/refresh-derived-data` | POST | `{status:"ok",result:{candidates:[]}}` | `{status:"error",...}` | 是 | 是 | `dfSlice.tsx` | `fetchWithIdentity().json()` | 无 |
| `/workspace-summary` | POST | `{status:"ok",summary:"..."}` | `{status:"error",...}` | 否 | 否 | `workspaceService.ts` | `apiRequest()` / `fetchWithIdentity` | 无 |
| `/nl-to-filter` | POST | `{status:"ok",result:{...}}` | `{status:"error",...}` | 否 | 否 | 前端 filter 面板 | `fetchWithIdentity().json()` | 无 |
| `/workspace/scratch/upload` | POST | `{status:"ok",url:"..."}` | `{status:"error",...}` | 否 | 否 | DataLoadingChat | `fetchWithIdentity().json()` | 无 |
| `/workspace/scratch/<path>` | GET | binary file / 图片 | 404 | 否 | 否 | `<img src>` | 浏览器 GET | 豁免 |

#### NDJSON Streaming endpoint

| Endpoint | Method | MIME | 业务事件格式 | error/warning 处理 | 携带 token | 前端 token 匹配 | pre-stream 校验失败 | 前端消费者 | 消费方式 |
|---|---|---|---|---|---|---|---|---|---|
| `/data-agent-streaming` | GET/POST | `application/x-ndjson` | legacy `{token,status,result:{type,...}}` | `stream_error_event()` + `_with_warnings()` | 是 | 是 (`data.token === token`) | `200 application/json` + `status:"error"` | `SimpleChartRecBox.tsx` exploreFromChat / `useFormulateData.ts` exploreFromChat | 手写 reader |
| `/clean-data-stream` | GET/POST | `application/x-ndjson` | `{type,data,...}` | `stream_error_event()` + `_with_warnings()` | 是 | 否 | `200 application/json` + `status:"error"` | `dfSlice.tsx` | 手写 reader |
| `/get-recommendation-questions` | GET/POST | `application/x-ndjson` | legacy `{token,status,result:{type,...}}` | `stream_error_event()` + `_with_warnings()` | 是 | 是 | `200 application/json` + `status:"error"` | `SimpleChartRecBox.tsx` | 手写 reader |
| `/generate-report-chat` | POST | `application/x-ndjson` | pure `{type,...}` | `stream_error_event()` + `_with_warnings()` | 否 | 否 | `200 application/json` + `status:"error"` | `SimpleChartRecBox.tsx` reportFromChat | 手写 reader |
| `/data-loading-chat` | POST | `application/x-ndjson` | pure `{type,...}` | `stream_error_event()` + `_with_warnings()` | 否 | 否 | `200 application/json` + `status:"error"` | `DataLoadingChat.tsx` | 手写 reader |

### A.2 Table 路由（`routes/tables.py`，前缀 `/api/`）

| Endpoint | Method | 成功响应格式 | 错误响应格式 | token | 备注 |
|---|---|---|---|---|---|
| `/open-workspace` | POST | `{status:"ok",tables:[],session:{}}` | `{status:"error",...}` | 否 | |
| `/list-tables` | GET | `{status:"ok",tables:[]}` | `{status:"error",...}` | 否 | |
| `/sample-table` | POST | `{status:"ok",table:{}}` | `{status:"error",...}` | 否 | |
| `/get-table` | GET | `{status:"ok",table:{}}` | `{status:"error",...}` | 否 | |
| `/create-table` | POST | `{status:"ok",table:{}}` | `{status:"error",...}` | 否 | 含文件上传 |
| `/parse-file` | POST | `{status:"ok",result:{}}` | `{status:"error",...}` | 否 | |
| `/sync-table-data` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |
| `/delete-table` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/upload-db-file` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/download-db-file` | GET | binary blob | 404/500 | 否 | 豁免（文件下载） |
| `/export-table-csv` | POST | CSV text/plain | `{status:"error",...}` | 否 | 豁免（CSV 下载） |
| `/reset-db-file` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/analyze` | POST | `{status:"ok",result:{}}` | `{status:"error",...}` | 否 | |

### A.3 Session 路由（`routes/sessions.py`，前缀 `/api/session/`）

| Endpoint | Method | 成功响应格式 | 错误响应格式 | token | 备注 |
|---|---|---|---|---|---|
| `/save` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/list` | GET | `{status:"ok",sessions:[]}` | `{status:"error",...}` | 否 | |
| `/load` | POST | `{status:"ok",session:{}}` | `{status:"error",...}` | 否 | |
| `/delete` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/create` | POST | `{status:"ok",session:{}}` | `{status:"error",...}` | 否 | |
| `/rename` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/update-meta` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/export` | POST | JSON blob | `{status:"error",...}` | 否 | |
| `/import` | POST | `{status:"ok",session:{}}` | `{status:"error",...}` | 否 | |
| `/migrate` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |
| `/cleanup-anonymous` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |

### A.4 Connector 路由（`data_connector.py`，前缀 `/api/`）

| Endpoint | Method | 成功响应格式 | 错误响应格式 | token | 备注 |
|---|---|---|---|---|---|
| `/data-loaders` | GET | `[{...loader}]` 裸数组 | `{error:"..."}` | 否 | |
| `/local/pick-directory` | POST | `{status:"ok",path:"..."}` | `{status:"error",...}` | 否 | |
| `/connectors` | GET | `[{...connector}]` | `{error:"..."}` | 否 | |
| `/connectors` | POST | `{status:"ok",connector:{}}` | `{status:"error",...}` | 否 | 创建 connector |
| `/connectors/<id>` | DELETE | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/connectors/connect` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |
| `/connectors/disconnect` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/connectors/get-status` | POST | `{status:"ok",status:"..."}` | `{status:"error",...}` | 否 | |
| `/connectors/get-catalog` | POST | `{status:"ok",catalog:[]}` | `{status:"error",...}` | 否 | |
| `/connectors/get-catalog-tree` | POST | `{status:"ok",tree:{}}` | `{status:"error",...}` | 否 | |
| `/connectors/get-cached-catalog-tree` | POST | `{status:"ok",tree:{}}` | `{status:"error",...}` | 否 | |
| `/connectors/sync-catalog-metadata` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |
| `/connectors/catalog-annotations` | PATCH | `{status:"ok",...}` | `{status:"error",...}` | 否 | |
| `/connectors/catalog-annotations` | GET | `{status:"ok",annotations:{}}` | `{status:"error",...}` | 否 | |
| `/connectors/search-catalog` | POST | `{status:"ok",results:[]}` | `{status:"error",...}` | 否 | |
| `/connectors/import-data` | POST | `{status:"ok",table:{}}` | `{status:"error",...}` | 否 | |
| `/connectors/refresh-data` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |
| `/connectors/preview-data` | POST | `{status:"ok",preview:{}}` | `{status:"error",...}` | 否 | |
| `/connectors/column-values` | POST | `{status:"ok",values:[]}` | `{status:"error",...}` | 否 | |
| `/connectors/import-group` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |

### A.5 Knowledge 路由（`routes/knowledge.py`，前缀 `/api/knowledge/`）

| Endpoint | Method | 成功响应格式 | 错误响应格式 | token | 备注 |
|---|---|---|---|---|---|
| `/limits` | POST | `{status:"ok",limits:{}}` | `{status:"error",...}` | 否 | |
| `/list` | POST | `{status:"ok",entries:[]}` | `{status:"error",...}` | 否 | |
| `/read` | POST | `{status:"ok",entry:{}}` | `{status:"error",...}` | 否 | |
| `/write` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/delete` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/search` | POST | `{status:"ok",results:[]}` | `{status:"error",...}` | 否 | |
| `/distill-experience` | POST | `{status:"ok",...}` | `{status:"error",...}` | 否 | |

### A.6 Credential 路由（`routes/credentials.py`，前缀 `/api/credentials/`）

| Endpoint | Method | 成功响应格式 | 错误响应格式 | token | 备注 |
|---|---|---|---|---|---|
| `/list` | GET | `{status:"ok",credentials:[]}` | `{status:"error",...}` | 否 | |
| `/store` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |
| `/delete` | POST | `{status:"ok"}` | `{status:"error",...}` | 否 | |

### A.7 App 顶层路由（`app.py`）

| Endpoint | Method | 成功响应格式 | 错误响应格式 | token | 备注 |
|---|---|---|---|---|---|
| `/api/example-datasets` | GET | `[...]` 裸数组 | N/A | 否 | 静态数据 |
| `/api/auth/info` | GET | `{auth_mode,identity,...}` | N/A | 否 | |
| `/api/app-config` | GET | `{...config}` | N/A | 否 | |
| `/` | GET | HTML | N/A | 否 | 豁免（SPA fallback） |

### A.8 豁免类 endpoint 汇总

以下 endpoint 不适用于 JSON error envelope 迁移：

- `/api/agent/workspace/scratch/<path>` — 静态文件 serve
- `/download-db-file` — 二进制文件下载
- `/export-table-csv` — CSV 文本下载
- `/` — SPA HTML fallback
- `/api/example-datasets` — 静态 JSON 数据

### A.9 前端 Timeout 盘点

| 前端调用 | 超时机制 | 超时值 | 备注 |
|---|---|---|---|
| `fetchChartInsight` | `AbortController` + `DOMException('TimeoutError')` | `config.formulateTimeoutSeconds` (默认 180s) | **Phase 1 已修复** |
| `formulateData` (derive/refine) | `setTimeout` → `controller.abort()` | `config.formulateTimeoutSeconds` | 已使用统一配置 |
| `exploreFromChat` (data-agent-streaming) | `setTimeout` → `controller.abort()` | `config.formulateTimeoutSeconds` | 已使用统一配置 |
| `reportFromChat` (generate-report-chat) | 无 | 无 | ⚠️ Phase 2 应补上 |
| `DataLoadingChat` (data-loading-chat) | `setTimeout` → `controller.abort()` | 硬编码 120s | ⚠️ Phase 2 应改为统一配置 |
| `fetchGlobalModelList` / `fetchAvailableModels` | 无 | 无 | 低优先级 |
| `testModel` | 无 | 无 | 低优先级 |
| `fetchFieldSemanticType` | `AbortController` | 硬编码 20s | ❌ 待改为统一配置或独立 metadata timeout |
| `fetchCodeExpl` | `AbortController` | 硬编码 20s | ❌ 待改为 `formulateTimeoutSeconds` 或明确短超时策略 |

### A.10 文档不一致标记

| 项目 | 现状 | 文档说法 | 建议 |
|---|---|---|---|
| `/refine-data` | 普通 JSON endpoint（`json_ok` envelope） | 旧版 `dev-guides/1-streaming-protocol.md` 曾列为 NDJSON streaming | ✅ 已从规范中按当前实现校正 |
| streaming pre-stream error | 全部返回 `200 application/json` | 早期 `design-docs/18` 建议改为 `4xx` | ✅ 4xx 方案已取消，统一 HTTP 200 |
| `token` 字段 | 通用 API/stream error token 已移除 | `design-docs/18` 建议移除 | ✅ 已完成主要清理；鉴权/连接器私有 token 不在此范围 |
