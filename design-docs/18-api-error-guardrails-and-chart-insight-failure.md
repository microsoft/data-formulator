# 18 - API 错误护栏与 Chart Insight 静默失败治理（归档）

> 状态：Phase 1/2 错误契约迁移与 Chart Insight 可见失败治理已完成；本文只保留归档结论和未完成项。
> 创建日期：2026-04-29
> 瘦身日期：2026-04-30
> 权威开发规范：`dev-guides/7-unified-error-handling.md`、`dev-guides/1-streaming-protocol.md`、`.cursor/skills/error-handling/SKILL.md`

## 1. 归档结论

原文的大部分内容已经落地并迁移到开发者规范中，不再在设计文档里重复维护：

- 普通 JSON API：成功统一为 `{"status": "success", "data": ...}`，应用错误统一为 HTTP 200 + `{"status": "error", "error": ...}`，仅 auth 使用 401/403。
- Streaming API：预检错误使用 HTTP 200 + JSON error envelope；流建立后的错误使用 NDJSON `{"type":"error","error":...}`。
- `json_ok()`、`stream_preflight_error()`、全局 `AppError` handler、`X-Request-Id` 已落地。
- 前端 `apiRequest()` / `streamRequest()` 已作为标准入口，`parseApiResponse()` 不再兼容 legacy shape。
- 通用 `token` 请求/响应字段和 stream error token 已移除，请求追踪改用 `X-Request-Id`。
- Chart Insight 的静默失败链路已修复：后端结构化错误、前端 rejected reducer 用户反馈、Chart image 未就绪等待、Settings 空会话入口、Chart Insight timeout 跟随 `formulateTimeoutSeconds`。
- 后端协议合约测试和前端 `apiClient` / Chart Insight 相关测试已补充。

这些规则以后以 `dev-guides/7`、`dev-guides/1`、相关 Cursor rules 和 error-handling skill 为准。

## 2. 仍需保留的未完成项

以下内容尚未完成，不能从路线图中删除：

| 项目 | 当前状态 | 后续落点 |
|------|----------|----------|
| `fetchCodeExpl` / `fetchFieldSemanticType` timeout 配置化 | 已移除前端 20s 硬编码 timeout；后端未要求 timeout 参数时使用后端默认 | 已完成 |
| `scripts/check_api_error_guardrails.py` | 暂不实现 | 如误用反复出现再做窄扫描 |
| CI 接入 API error guardrail 扫描 | 暂不实现 | 等本地规则稳定、误报低后再评估 |
| ESLint 禁止业务代码直接 `fetchWithIdentity().json()` | 已通过轻量 `no-restricted-syntax` 护栏限制直接链式调用 | 前端 lint |
| Structured-first Insight | 未启动 | `design-docs/18.2-insight-architecture-redesign.md` |
| 多模型路由 / `ModelResolver` / per-agent `reasoning_effort` | 未启动 | `design-docs/19-multi-model-routing.md` |

## 3. 保留的产品问题

这些不是错误契约迁移的阻塞项，但仍影响后续 Insight 体验设计：

1. 自动洞察失败长期使用 snackbar，还是改为洞察面板内 inline error？
2. 自动洞察是否继续默认生成，还是在用户第一次打开洞察面板时 lazy generate？ 确定：自动洞察是否继续默认生成
3. 后台 metadata / explanation 请求是否需要独立后端 timeout 配置？当前前端不再设置短 timeout。
4. 哪些图表类型必须保留 vision fallback？

## 4. 移除的历史内容

原文中的问题定位、逐 endpoint 迁移清单、response shape breaking-change 表、Phase 1a/1b/1c 实施细节和成功标准已经完成或被 `dev-guides/7` / `dev-guides/1` 取代。为避免设计文档与实现分叉，这些历史细节不再在本文维护。
