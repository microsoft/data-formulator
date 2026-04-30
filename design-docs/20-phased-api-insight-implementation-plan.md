# 20 - API 错误契约与 Insight 稳定性分期计划（归档）

> 状态：Phase 0/1/2 已完成；Phase 3 未启动。
> 创建日期：2026-04-30
> 瘦身日期：2026-04-30
> 权威开发规范：`dev-guides/7-unified-error-handling.md`、`dev-guides/1-streaming-protocol.md`

## 1. 当前阶段结论

| 阶段 | 状态 | 归档结论 |
|------|------|----------|
| Phase 0：API / timeout / streaming 盘点 | 已完成 | 历史 endpoint matrix 不再代表 HEAD 现状，已从本文移除 |
| Phase 1：Chart Insight 可见故障修复 | 已完成 | Chart Insight 已使用统一错误 envelope、可见失败反馈、可配置 timeout 和 chart image 就绪等待 |
| Phase 2：普通 JSON API 契约全量迁移 | 已完成 | 普通 JSON API、主要前端 thunk、stream preflight/error token 清理已完成 |
| Phase 3：Structured-first Insight + 多模型路由 | 未启动 | 继续保留在 `design-docs/18.2-insight-architecture-redesign.md` 和 `design-docs/19-multi-model-routing.md` |

## 2. 已迁移到开发者规范的内容

这些内容不再在本分期计划中重复维护：

- HTTP 200 应用错误策略、auth 401/403 例外、不可控 404/413/500 边界。
- `json_ok()` / `AppError` / `stream_preflight_error()` / `stream_error_event()` 用法。
- `apiRequest()` / `streamRequest()` 消费规范和 legacy response shape 拒绝策略。
- NDJSON error / warning / `thinking_text` 事件格式。
- 通用 `token` 字段移除和 `X-Request-Id` 请求追踪。
- 新 endpoint checklist、错误码/i18n、错误相关测试要求。
- LLM / Agent 前端 timeout 规则和当前剩余硬编码 timeout 待办。

对应规范见：

- `dev-guides/7-unified-error-handling.md`
- `dev-guides/1-streaming-protocol.md`
- `.cursor/rules/unified-error-protocol.mdc`
- `.cursor/rules/error-response-safety.mdc`
- `.cursor/skills/error-handling/SKILL.md`

## 3. 剩余待办

| 项目 | 状态 | 备注 |
|------|------|------|
| `fetchCodeExpl` / `fetchFieldSemanticType` timeout 配置化 | 未完成 | 当前仍为 20s 硬编码；不要复制该模式 |
| 前端全量 vitest / 回归验证 | 未确认 | 本文不再把它标记为完成 |
| API error guardrail 静态扫描脚本 | 未完成 | `scripts/check_api_error_guardrails.py` 不存在 |
| 静态扫描接入 CI / pre-commit | 未完成 | 需在脚本实现后再接入 |
| ESLint 自定义规则限制业务代码直接 `fetchWithIdentity()` | 未完成 | 可作为长期护栏 |
| Structured-first Insight | 未启动 | 见 `design-docs/18.2-insight-architecture-redesign.md` |
| 多模型路由 / `ModelResolver` | 未启动 | 见 `design-docs/19-multi-model-routing.md` |
| per-agent `reasoning_effort` 参数化 | 未完成 | `client_utils.py` 仍硬编码 `"low"` |

## 4. 后续建议顺序

1. 先清理 `fetchCodeExpl` / `fetchFieldSemanticType` 的硬编码 timeout，并补 focused tests。
2. 实现 API error guardrail 静态扫描脚本，先 report-only，再接入 CI。
3. 启动 `18.2` 的 structured-first Insight，新增 `py-src/data_formulator/insights/` 和 profiler 单元测试。
4. 启动 `19` 的 `ModelResolver`、任务级 env override、agent capabilities 和 per-agent `reasoning_effort`。

## 5. 移除的历史内容

原文附录 A 的 endpoint matrix 是 Phase 0 历史快照，已经与 HEAD 现状不一致；逐 endpoint 迁移表、Phase 1/2 伪代码、完成标准和旧 streaming 迁移边界也已由开发者规范取代。需要追溯历史时请查看 git 历史，不要把旧 matrix 当作当前实现依据。
