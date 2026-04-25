# 12 - 统一错误处理机制

> **状态**: 已瘦身，保留剩余迁移 tracker
> **创建日期**: 2026-04-23
> **瘦身日期**: 2026-04-26
> **规范源**: `../dev-guides/7-unified-error-handling.md`
> **分支**: `feature/plugin-architecture`

## 1. 当前结论

统一错误处理的基础设施和 HTTP 状态码策略已经落地。后续开发应以
`dev-guides/7-unified-error-handling.md` 为规范源，本文只保留尚未完成或仍需人工确认的迁移项。

已迁移到 dev guide 的内容：

- HTTP 状态码策略：应用层错误返回 HTTP `200`，传输层/框架层 `404`、`413`、未捕获 `500` 保持非 200。
- 后端 `AppError`、`ErrorCode`、`register_error_handlers()`、`classify_and_wrap_llm_error()`、`stream_error_event()` 使用规范。
- `{"status": "error", "message": "..."}` / `error_message` 作为已有 route 的兼容格式。
- 新代码推荐 `{"status": "error", "error": {code, message, retry}}`。
- 前端 `apiRequest()`、`streamRequest()`、`handleApiError()` 消费规范。
- 空 catch / 静默失败处理策略。
- 错误码 i18n 流程。
- DB / connector 错误分类器使用方式。
- 错误处理测试要求。

## 2. 已完成基线

### 2.1 后端基础设施

- `py-src/data_formulator/errors.py`: `ErrorCode`、`AppError`
- `py-src/data_formulator/error_handler.py`: 全局错误处理、`X-Request-Id`、LLM 错误分类、NDJSON error/warning 工具
- `py-src/data_formulator/app.py`: 注册全局错误处理器
- `py-src/data_formulator/routes/tables.py`: `classify_and_raise_db_error()`
- `py-src/data_formulator/data_connector.py`: `classify_and_raise_connector_error()`

### 2.2 前端基础设施

- `src/app/apiClient.ts`: `apiRequest()`、`streamRequest()`、`parseApiResponse()`、`parseStreamLine()`、`ApiRequestError`
- `src/app/errorHandler.ts`: `handleApiError()`
- `src/app/errorCodes.ts`: error code 到 i18n key 映射
- `src/i18n/locales/en/errors.json`
- `src/i18n/locales/zh/errors.json`

### 2.3 流式错误协议

高频流式端点已迁到 NDJSON 和统一 error event：

- `/data-agent-streaming`
- `/get-recommendation-questions`
- `/generate-report-chat`
- `/data-loading-chat`
- `/clean-data-stream`

流式协议细节已迁移到 `dev-guides/1-streaming-protocol.md` 和 `dev-guides/7-unified-error-handling.md`。

### 2.4 HTTP 状态码统一

`12.1-http-status-code-standardization.md` 的决策已落地：

- `AppError` 全局处理器返回 HTTP `200`。
- 应用层 route 错误已批量去掉显式 `, 4xx` / `, 5xx`。
- 测试已改为检查 `status_code == 200` 与 `body.status == "error"`。

`12.1` 现保留为历史索引，后续可删除。

## 3. 剩余迁移项

### 3.1 前端业务调用面迁移

统一客户端已经存在，但业务代码仍有大量直接 `fetchWithIdentity()` / 手写解析。后续逐步迁移即可，不阻塞当前规范沉淀。

优先级：

| 优先级 | 范围 | 目标 |
|--------|------|------|
| P1 | 用户主动操作失败 | 失败时必须有用户反馈 |
| P2 | 新增或重构中的 API 调用 | 使用 `apiRequest()` / `streamRequest()` / `handleApiError()` |
| P3 | 旧的稳定读取路径 | 保留兼容解析，按触碰时迁移 |

当前仍需关注的模式：

- 直接 `fetchWithIdentity()` 后只检查 `!response.ok`。
- 手动读取 `message` / `error_message`，没有统一到 `ApiRequestError`。
- 流式消费者手动处理 `{type: "error"}`，但未使用 `getErrorMessage()` 做错误码 i18n。

明确口径：`!response.ok` 可以保留，但只能兜底传输层/框架层错误；业务错误必须检查
`body.status === "error"`。

### 3.2 静默失败清理

已完成大部分高频空 catch 分类，但仍需按代码现状定期扫描：

- 用户触发的 delete / refresh / submit 失败必须通知用户。
- 后台 best-effort 加载可以静默，但必须有注释说明。
- RTK thunk rejected handler 必须过滤 `AbortError` 并给出合适反馈。
- `catch { /* ignore */ }` 需要确认是否真是可忽略降级。

这类问题不适合一次性机械替换，应结合调用语义处理。

### 3.3 结构化 ErrorCode 覆盖增强

`{"status": "error", "message": "..."}` 是当前兼容规范，不再视为错误或阻塞项。

如果后续需要更强的 i18n、重试、分类处理，可以逐步把高价值路径迁到 `AppError`：

- 需要前端按错误类型分支处理的路径
- 用户高频触发的失败路径
- 涉及认证、连接器、表/工作区、LLM 调用的路径
- 需要本地化固定错误文案的路径

不建议为了形式统一而批量改动所有 legacy route。

### 3.4 特例确认

以下路径不能简单套普通 JSON API 规范：

- 文件下载 / CSV streaming：可能返回文件流或下载响应。
- SPA fallback：非 `/api/` 404 仍应返回前端入口。
- OIDC redirect flow：部分错误通过 redirect query param 传给前端展示。
- 外部 URL fetch：例如前端对第三方 URL 的 `!response.ok` 判断不属于 DF API 规范。
- 流已建立后的运行时错误：只能通过 NDJSON `type: "error"` 事件传递，不能再改 HTTP 状态码。

## 4. 后续删除标准

本文可以删除的条件：

- 开发者规范完全由 `dev-guides/7-unified-error-handling.md`、`.cursor/skills/error-handling/SKILL.md` 和 `.cursor/rules/unified-error-protocol.mdc` 承接。
- 剩余迁移项被拆到 issue / task tracker，本文不再承担追踪作用。
- 旧设计引用已经更新到 dev guide。

`12.1-http-status-code-standardization.md` 可以更早删除；它只保留历史索引，不再包含独立规范。

## 5. 参考文件

| 文件 | 用途 |
|------|------|
| `dev-guides/7-unified-error-handling.md` | 正式错误处理开发规范 |
| `dev-guides/1-streaming-protocol.md` | 流式 NDJSON 协议 |
| `dev-guides/6-i18n-language-injection.md` | 后端用户可见消息和 i18n |
| `.cursor/skills/error-handling/SKILL.md` | Agent 执行错误处理任务时的操作指南 |
| `.cursor/rules/unified-error-protocol.mdc` | 代码编写约束 |
| `.cursor/rules/error-response-safety.mdc` | 响应体异常信息安全规则 |
