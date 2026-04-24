# 日志敏感数据脱敏规范

> **维护者**: DF 核心团队  
> **最后更新**: 2026-04-24  
> **适用范围**: 所有 `py-src/data_formulator/` 下的 Python 后端代码

## 1. 背景

CodeQL 等安全扫描工具会标记日志中的敏感数据泄露（CWE-532: Insertion of Sensitive
Information into Log File）。本项目建立了纵深防御的日志脱敏体系，防止密码、token、
API key 等信息出现在服务端日志中。

## 2. 架构概览

```
                    ┌─────────────────────────┐
  开发者代码        │  Layer 1: 显式工具函数    │
  logger.info(...)  │  sanitize_url()          │  ← 主动调用（推荐）
                    │  sanitize_params()       │
                    │  redact_token()          │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  Layer 2: 全局 Filter     │
                    │  SensitiveDataFilter     │  ← 自动兜底
                    │  (注册在 configure_      │
                    │   logging 的 handler 上)  │
                    └────────────┬────────────┘
                                 │
                                 ▼
                           stdout / 日志
```

**关键文件:**

| 文件 | 作用 |
|------|------|
| `py-src/data_formulator/security/log_sanitizer.py` | 工具函数 + Filter 实现 |
| `py-src/data_formulator/app.py` `configure_logging()` | 注册 Filter |
| `tests/backend/security/test_log_sanitizer.py` | 单元测试 (38 cases) |
| `.cursor/rules/log-sanitization.mdc` | AI 编码规范 |

## 3. 使用指南

### 3.1 记录包含凭据的 dict

最常见的场景：DataLoader 初始化时的 `params` dict 包含 `password`。

```python
from data_formulator.security.log_sanitizer import sanitize_params

# BEFORE (泄露密码)
log.info(f"Init with: {params}")
# 输出: Init with: {'server': 'db01', 'password': 'P@ssw0rd!'}

# AFTER (安全)
log.info("Init with: %s", sanitize_params(params))
# 输出: Init with: {'server': 'db01', 'password': '***'}
```

`sanitize_params()` 自动识别以下 key（大小写不敏感）：
`password`, `passwd`, `pwd`, `secret`, `client_secret`, `token`,
`access_token`, `refresh_token`, `api_key`, `apikey`, `api-key`,
`access_key`, `secret_key`, `credential`, `connection_string` 等。

支持嵌套 dict，支持 `extra_keys` 参数添加自定义 key。

### 3.2 记录 URL

任何来自配置/环境变量的 URL 都可能包含嵌入式凭据。

```python
from data_formulator.security.log_sanitizer import sanitize_url

logger.info("Issuer: %s", sanitize_url(issuer_url))
# https://admin:secret@idp.example.com → https://admin:***@idp.example.com
# https://idp.example.com → https://idp.example.com (无凭据时不变)
```

### 3.3 记录 Token / API Key

```python
from data_formulator.security.log_sanitizer import redact_token

logger.debug("Access token: %s", redact_token(token))
# eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.xxx → eyJh...J9.x
```

### 3.4 记录异常信息

异常消息可能包含连接串、上游响应体等敏感信息。

```python
# WARNING/INFO 级别 — 只记录异常类型名
logger.warning("Discovery failed: %s", type(exc).__name__)

# ERROR 级别需要完整 traceback — 使用 exc_info=True (Filter 会扫描 exc_text)
logger.error("Unexpected failure in OIDC init", exc_info=True)
```

### 3.5 什么都不需要做

普通字符串（表名、模型名、文件路径等）无需任何处理：

```python
logger.info("Processing table %s with %d rows", table_name, row_count)
```

## 4. 全局 Filter 自动保护范围

即使开发者忘记使用工具函数，`SensitiveDataFilter` 会自动拦截以下模式：

| 模式 | 示例 | 脱敏结果 |
|------|------|----------|
| URL 嵌入凭据 | `://user:pass@host` | `://user:***@host` |
| Bearer token | `Bearer eyJxxx...` | `Bearer [REDACTED]` |
| key=value | `password=secret` | `password=***` |
| dict repr | `'password': 'val'` | `'password': '***'` |
| 裸 JWT 字符串 | `eyJhbGciOi...` | `[REDACTED]` |

**注意:** Filter 无法可靠地处理 dict 中任意密码值（因为密码本身可能是普通字符串），
所以 `sanitize_params()` 仍然是 dict 场景的必备手段。

## 5. 本地调试

需要查看完整日志信息时，设置环境变量关闭 Filter：

```bash
LOG_SANITIZE=false python -m data_formulator.app
```

**警告：** 此设置仅限本地调试，禁止在生产环境或 CI 中使用。

## 6. 新模块/新功能检查清单

每次新增模块或功能时，**必须检查以下事项**：

### 6.1 审计日志调用

- [ ] 搜索新增代码中所有 `logger.info`、`logger.warning`、`logger.error`、
      `logger.debug`、`logger.exception` 调用
- [ ] 确认没有明文记录密码、token、API key、连接串

### 6.2 应用脱敏措施

- [ ] dict/params 参数 → 使用 `sanitize_params()`
- [ ] URL（issuer URL, API base URL, 数据库 URL, 云存储 URL）→ 使用 `sanitize_url()`
- [ ] Token / API key → 使用 `redact_token()`
- [ ] 异常消息 → warning 级别用 `type(exc).__name__`，error 级别用 `exc_info=True`

### 6.3 扩展敏感 key 集合

- [ ] 如果引入了新的凭据字段名（如 `custom_auth_token`），将其添加到
      `log_sanitizer.py` 的 `SENSITIVE_KEYS` 集合中
- [ ] 如有需要，同时更新 `_SENSITIVE_KEY_NAMES` 正则模式

### 6.4 运行测试

```bash
conda activate data-formulator
python -m pytest tests/backend/security/test_log_sanitizer.py -v
```

## 7. 常见反模式

```python
# ❌ 直接记录包含密码的 dict
log.info(f"Connecting with {params}")

# ❌ 直接记录可能含凭据的 URL
logger.warning("Failed for %s", discovery_url)

# ❌ 直接记录完整 token
logger.info("Using token: %s", access_token)

# ❌ 异常消息可能含连接串
logger.warning("Error: %s", exc)

# ❌ 使用 f-string（无法被 Filter 拦截参数）
logger.info(f"password={self.password}")

# ✅ 使用 %-style 格式化（Filter 可以拦截）
logger.info("password=%s", self.password)
```

## 8. 与客户端错误消息脱敏的关系

| 模块 | 职责 | 面向 |
|------|------|------|
| `security/log_sanitizer.py` | 服务端日志脱敏 | 运维 / 开发者 |
| `security/sanitize.py` | 客户端响应消息脱敏 | 最终用户 |

两者独立运作，互不依赖。详见 `.cursor/rules/error-response-safety.mdc`。
