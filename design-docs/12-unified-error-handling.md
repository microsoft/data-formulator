# 12 - 统一错误处理剩余迁移 tracker

> **状态**: 仅保留未完成迁移项
> **创建日期**: 2026-04-23
> **最后瘦身**: 2026-04-28
> **规范源**: `../dev-guides/7-unified-error-handling.md`

统一错误处理的基础设施、HTTP 状态码策略、流式错误协议、错误码/i18n 流程、DB/connector 错误分类器、测试要求和特例边界已经迁入正式开发规范、rules 和 skill。

本文不再承载规范，只追踪还没有做完的迁移工作。若这些迁移项被拆到 issue / task tracker，本文即可删除。

## 1. 前端业务调用面迁移

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

## 2. 静默失败清理

已完成大部分高频空 catch 分类，但仍需按代码现状定期扫描：

- 用户触发的 delete / refresh / submit 失败必须通知用户。
- 后台 best-effort 加载可以静默，但必须有注释说明。
- RTK thunk rejected handler 必须过滤 `AbortError` 并给出合适反馈。
- `catch { /* ignore */ }` 需要确认是否真是可忽略降级。

这类问题不适合一次性机械替换，应结合调用语义处理。

## 3. 结构化 ErrorCode 覆盖增强

`{"status": "error", "message": "..."}` 是当前兼容规范，不再视为错误或阻塞项。

如果后续需要更强的 i18n、重试、分类处理，可以逐步把高价值路径迁到 `AppError`：

- 需要前端按错误类型分支处理的路径
- 用户高频触发的失败路径
- 涉及认证、连接器、表/工作区、LLM 调用的路径
- 需要本地化固定错误文案的路径

不建议为了形式统一而批量改动所有 legacy route。

## 4. 删除标准

本文可以删除的条件：

- 前端业务调用迁移已完成，或已拆到 issue / task tracker。
- 静默失败清理已完成，或已拆到 issue / task tracker。
- 结构化 `ErrorCode` 覆盖增强不再需要集中追踪。
