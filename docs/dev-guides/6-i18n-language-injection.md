# 多语言与 Agent 语言注入开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-10-13
> **适用范围**: Agent prompt、Agent 路由、后端用户可见消息、前端 UI 文案、i18n locale 文件

---

## 1. 架构概览

Data Formulator 的多语言处理分为两条链路：

1. **LLM 输出语言约束**：前端当前语言通过 `Accept-Language` 传给后端，后端构造
   `language_instruction` 注入 Agent prompt，让 LLM 生成用户界面语言的文本。
2. **固定文案翻译**：代码中的按钮、提示、错误等固定字符串不交给 LLM 翻译，必须通过
   前端 i18n 或 `message_code` / `content_code` 由前端翻译。

```text
frontend i18n.language
  -> fetchWithIdentity() sets Accept-Language
  -> routes/agents.py get_language_instruction()
  -> agents/agent_language.py build_language_instruction()
  -> Agent prompt
```

核心模块：

| 模块 | 职责 |
|------|------|
| `src/app/utils.tsx` | `getAgentLanguage()`、`fetchWithIdentity()`、`translateBackend()` |
| `src/app/App.tsx` | `LanguageSwitcher`（`LANGUAGE_LABELS`），基于 `SUPPORTED_UI_LANGUAGES` 切换语言 |
| `src/i18n/index.ts` | 注册 locale 资源，导出 `SUPPORTED_UI_LANGUAGES` |
| `py-src/data_formulator/routes/agents.py` | `_get_ui_lang()`、`get_language_instruction()` |
| `py-src/data_formulator/agents/agent_language.py` | `build_language_instruction()`、`inject_language_instruction()` |
| `py-src/data_formulator/analyst/agent.py` | `AnalystAgent` 在 `_build_system_prompt()` 末尾追加 `language_instruction` |
| `src/i18n/locales/{en,zh,hi,id,ja,de,fr,ko}/` | 前端翻译资源 |

### 1.1 当前代码对照状态

从原设计文档迁移时已按当前代码重新核对，不能再把早期计划里的状态原样视为事实：

| 项目 | 当前状态 | 说明 |
|------|----------|------|
| `AnalystAgent` | 已接入 | `analyst-streaming` route 使用 `full` 模式；`SkillContext.language_instruction` 向 skill 传递同一指令 |
| `SortDataAgent` | 已接入 | 构造函数接收 `language_instruction`，route 使用 `compact` 模式 |
| `workspace-name` | 已接入 | `SimpleAgents` 接收 `language_instruction`，生成 session/workspace 展示名使用 `full` |
| `WorkflowAgent` / `WorkflowDistillAgent` | 已接入（例外路径） | 不经过 `get_language_instruction()`，见 2.1 |
| `test-model` | 明确豁免 | 健康检查需要固定返回，不应被语言指令影响 |
| `rec_language_instruction` | 已清理 | 当前 `routes/agents.py` 未再保留该误导性参数 |
| `message_code` / `content_code` / `text_code` / `label_code` | 已落地 | Python 固定用户消息由前端翻译，后端保留英文 fallback |
| 前端 i18n | 已有 8 种 locale | en/zh/hi/id/ja/de/fr/ko，`LanguageSwitcher`、`fetchWithIdentity()`、locale 资源已接入 |
| 静态检查 / CI | 未落地 | 没有语言注入静态检查脚本或 pre-commit 强制检查 |

---

## 2. Agent Prompt 语言注入

新增或修改会调用 LLM 的 Agent route 时，先判断输出是否面向用户展示：

| 输出类型 | 是否注入 | 说明 |
|----------|----------|------|
| 用户可读解释、建议、报告、对话、自动命名 | 是 | 必须跟随 UI 语言 |
| 生成代码、JSON key、字段名、变量名 | 部分 | 使用 `compact`，只约束用户可见字段 |
| 纯健康检查 / 固定连通性测试 | 否 | 例如 `test-model`，保持固定英文更稳定 |
| 纯结构化 JSON 且不展示自然语言 | 通常否 | 未来若返回用户文案再接入 |

决策树：

```text
新增 LLM 调用
  -> 输出是否面向用户展示？
     -> 否：健康检查、内部工具调用、日志，不注入
     -> 是：
        -> 独立 Agent 类：构造函数添加 language_instruction=""，用 inject_language_instruction()
        -> 内联 LLM 调用：route 中直接把 language_instruction 放入 system prompt
        -> 自然语言为主：mode="full"
        -> 代码 / 结构化 JSON / 短文本为主：mode="compact"
```

### 2.1 Route 层

在 route handler 中读取语言：

```python
language_instruction = get_language_instruction(mode="compact")
agent = SortDataAgent(client=client, language_instruction=language_instruction)
```

`mode` 选择：

| Mode | 适用场景 |
|------|----------|
| `full` | 文本型 Agent：探索、报告、解释、聊天、会话命名 |
| `compact` | 代码生成、数据清洗、排序、图表样式、短文本生成、结构化输出 |

当前各 Agent 的模式：

| Agent | Route | Mode |
|-------|-------|------|
| `AnalystAgent` | `/api/agent/analyst-streaming` | `full` |
| `CodeExplanationAgent` | `/api/agent/code-expl` | `full`（默认值） |
| `SimpleAgents.workspace_name()` | `/api/agent/workspace-name` | `full` |
| `DataLoadAgent` | `/api/agent/process-data-on-load` | `compact` |
| `SortDataAgent` | `/api/agent/sort-data` | `compact` |
| `StarterQuestionsAgent` | `/api/agent/derive-starter-questions` | `compact` |
| `ChartRestyleAgent` | `/api/agent/chart-restyle` | `compact` |
| `test-model`、模型列表、纯状态检查 | — | 不注入 |

以下两处不经过 `get_language_instruction()`：

- `WorkflowAgent`（`workflows/agent.py`）：`/api/workflows/run` 新建运行时把 `_get_ui_lang()` 存入 run state 的
  `language`；定时运行使用 schedule 配置中的 `language`（前端默认 `getAgentLanguage()`）。Agent 构造时调用
  `build_language_instruction(state["language"])`（`full` 模式）。运行状态会持久化并可能由调度器在无请求上下文时执行，因此保存语言代码。
- `WorkflowDistillAgent`（`/api/knowledge/distill-workflow`）：route 传入 `language_code=_get_ui_lang()`，Agent
  用自带的 `_LANG_NAMES` 生成语言块；不在该表中的语言回退为英文。

### 2.2 Agent 层

Agent 构造函数应接收 `language_instruction: str = ""`，并用
`inject_language_instruction()` 注入 system prompt：

```python
from data_formulator.agents.agent_language import inject_language_instruction

system_prompt = inject_language_instruction(system_prompt, language_instruction)
```

复杂 prompt 可以指定 marker，把语言指令插入到 marker 之前（找不到 marker 时回退为末尾追加）：

```python
system_prompt = inject_language_instruction(
    system_prompt,
    language_instruction,
    marker="<marker text in the prompt>",
)
```

当前 `agents/` 下的 Agent 均使用末尾追加；`AnalystAgent` 不调用 `inject_language_instruction()`，
直接在 `_build_system_prompt()` 末尾追加 `language_instruction`。

规则：

- 不要在 prompt 中硬编码 `"回答请使用中文"` 之类的语言要求。
- 不要用进程级环境变量决定语言；语言必须来自每个请求的 `Accept-Language`。
- 不要新增并行的 `MessageBuilder` 或 LLM client 全局拦截器。
- 不要跳过 `get_language_instruction()` 在 route 中直接调用 `build_language_instruction()`（上面的 Workflow 例外路径除外）。
- 不要把语言指令塞进 user message；语言约束应放在 system prompt。
- `build_language_instruction("en")` 返回空字符串，英文用户不需要额外 prompt。

注入位置策略：

| 策略 | 适用场景 |
|------|----------|
| marker 前插入 | 复杂 prompt，需要在技术细节前声明语言要求 |
| 末尾追加 | 简单 prompt，或者动态构建的 system prompt |

这两种策略都可以接受，不需要为了形式统一而重构所有 Agent。

---

## 3. 后端用户可见消息

Python 中固定的用户可见消息不能只靠 `language_instruction`，因为它们不是 LLM 生成内容。
后端应返回英文 fallback 和翻译 code，让前端翻译。

### 3.1 单条消息

```python
yield self._error_event(
    iteration, f"Unknown action: {action_type}",
    message_code="agent.unknownAction",
)
# → {"type": "error", "iteration": ..., "message": "Unknown action: ...", "message_code": "agent.unknownAction"}
```

### 3.2 结果 content

```python
result = {
    "status": "other error",
    "content": "unable to extract script from response",
    "content_code": "agent.unableExtractScript",
}
```

### 3.3 结构化澄清问题

```python
event = {
    "type": "interact",
    "questions": [{
        "text": "How would you like to proceed?",
        "text_code": "agent.clarifyExhausted",
        "text_params": {"steps": steps_desc},
        "responseType": "single_choice",
        "required": True,
        "options": [
            {
                "label": "Continue exploring",
                "label_code": "agent.clarifyOptionContinue",
            },
            {
                "label": "Simplify the task",
                "label_code": "agent.clarifyOptionSimplify",
            },
        ],
    }],
}
```

问题与选项均不带 ID，按数组位置对应。`MetaSkill._sanitize_clarification_questions()` 会保留
`text_code` / `text_params` / `label_code`。当前 `ask_user` 的问题都由 LLM 生成，只有 `text` / `label`；
上例只说明固定文案的格式。

命名规则：

- Agent 相关 key 放在 `messages.agent.*`。
- 后端字段中只写 `agent.emptyDataframe`，前端会拼成 `messages.agent.emptyDataframe`。
- 有参数时使用 `message_params`、`content_params`、`text_params`，例如 `{"missing": "...", "available": "..."}`。
- `interact` 事件使用 `questions[].text_code` 和 `questions[].options[].label_code`，不要再新增顶层 `message/options/option_codes` 协议。
- LLM 根据当前 UI 语言生成的问题和选项通常只需要 `text` / `label`；固定后端文案才需要同时提供 fallback 文本和 code。
- `questions[].options[]` 的翻译只作用于当前问题的选项，不要把多个问题的选项合并到同一个数组。
- 不要新增 Python 侧翻译表或 `agent_messages.py`；早期设计中的该方案已由前端 `message_code` 翻译模式取代。

### 3.4 当前后端使用的 Agent 消息 code

`messages.agent.*` 的翻译位于 `src/i18n/locales/<lang>/messages.json`。当前后端代码使用的 code：

| Code | 来源 | 是否到达前端 |
|------|------|--------------|
| `agent.llmApiError` | `AnalystAgent` LLM 调用失败且无已分类错误消息时的 error 事件 | 是，有翻译 |
| `agent.unknownAction` | `AnalystAgent` 未知 action 的 error 事件；各 skill `handle_action` | `AnalystAgent` 发出的到达前端，有翻译 |
| `agent.skillNoHandler` | `AnalystAgent`：skill 缺少 `handle_action` | 是，locale 中无翻译，显示英文 fallback |
| `agent.parseActionFailed` | visualization / report / html_app / meta skill | 否，skill error 事件被 `_route_skill_events` 丢弃 |
| `agent.invalidDataOperation` | workspace 数据加载 skill | 否（同上） |
| `agent.invalidConnector` / `agent.connectorsDisabled` | configure skill | 否（同上） |
| `agent.fieldsNotFound` / `agent.emptyDataframe` | `AnalystAgent` 可视化执行结果的 `error_code`（附 `error_params`） | 否，只作为工具结果返回给 LLM |
| `agent.unableExtractScript` | `DataLoadAgent` / `SortDataAgent` 结果的 `content_code` | 否，route 只返回 `status == "ok"` 的结果 |

`messages.json` 中还保留部分当前没有后端使用方的 `agent.*` key（如 `clarifyExhausted`、`clarifyOption*`、
`maxIterationsSummary`、`noCodeBlock`）。

后端普通 HTTP 响应优先走统一错误处理的 `ErrorCode` / `AppError`；还未纳入统一错误体系的
`jsonify(message="...")` 不应在本文档中宣称已经全部完成国际化。

---

## 4. 前端消费后端消息

前端使用 `translateBackend()`。普通后端消息直接翻译；结构化澄清问题逐题翻译 `text_code`
和 `label_code`：

```tsx
import { translateBackend } from '../app/utils';

const message = translateBackend(
    event.message,
    event.message_code,
    event.message_params,
);

const questionText = translateBackend(
    question.text,
    question.text_code,
    question.text_params,
);

const optionLabel = translateBackend(option.label, option.label_code);
```

如果没有 code 或没有翻译，函数会回退到后端英文 fallback。

结构化问题的逐题翻译由 `src/app/clarification.ts` 的 `normalizeClarifyEvent()` 完成。

澄清面板自己的固定 UI 文案，例如标题、按钮、占位符和“直接说明”标签，放在
`src/i18n/locales/<lang>/common.json` 的 `chartRec` 下；不要从后端事件里下发这些前端壳层文案。

---

## 5. 前端 UI 文案

所有用户可见 UI 字符串必须走 i18n：

```tsx
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();
return <Button>{t('common.save')}</Button>;
```

必须翻译：

- 按钮、菜单、tooltip、placeholder、dialog 标题
- toast/snackbar 文案
- 空状态、加载状态、错误提示
- 表格列头、面板标题、说明文字

可以不翻译：

- `console.log` / debug 日志
- CSS class、test id、内部常量
- 跨前后端共享的 sentinel value，例如内部状态 marker

翻译文件：

```text
src/i18n/locales/{en,zh,hi,id,ja,de,fr,ko}/
```

新增 key 时必须同时更新所有已注册 locale：`tests/frontend/unit/app/i18nLocales.test.ts` 要求每种
locale 的 key 集合与 en 一致。命名空间按现有文件选择：`common`、`upload`、
`chart`、`model`、`encoding`、`messages`、`navigation`、`dataLoading`、`loader`、`errors`。

### 5.1 翻译 key 命名

优先使用现有 namespace。大量独立功能文案可以新建 namespace，但必须为所有已注册 locale
添加资源并在各自的 `src/i18n/locales/<lang>/index.ts` 中合并。

```text
<namespace>.<component-or-feature>.<element>

dataLoading.toolLabels.readingFile
chartRec.skipAnswer
config.localRowLimit
messages.agent.llmApiError
```

设计文档中曾列出一批前端硬编码审计结果；迁移到本规范后，这些清单不再作为“当前待办事实”
维护。开发时以 `.cursor/rules/i18n-no-hardcoded-strings.mdc` 和本节规则为准，发现新增或修改
的用户可见文案时就地迁移到 i18n。

---

## 6. 新语言接入

1. 在 `agents/agent_language.py` 的 `LANGUAGE_DISPLAY_NAMES` 中添加语言代码和显示名。
2. 如有特殊要求，添加到 `LANGUAGE_EXTRA_RULES`。
3. 在 `src/i18n/locales/<lang>/` 添加完整翻译资源。
4. 在 `src/i18n/locales/index.ts` 导出，并在 `src/i18n/index.ts` 的 `resources` 中注册；`SUPPORTED_UI_LANGUAGES`
   由此派生，语言切换器随之显示该语言。可在 `App.tsx` 的 `LANGUAGE_LABELS` 中添加显示名。
5. 在 `tests/frontend/unit/app/i18nLocales.test.ts` 中加入 key 对齐检查。
6. 验证 `fetchWithIdentity()` 请求头、Agent 输出、固定 UI 文案都使用新语言。

每种新语言需要与 en 等价的 locale 结构：

```text
src/i18n/locales/<lang>/
├── common.json
├── upload.json
├── chart.json
├── model.json
├── encoding.json
├── messages.json
├── navigation.json
├── dataLoading.json
├── errors.json
├── loader.json
└── index.ts
```

`agent_language.py` 支持的 20 种 LLM 输出语言不等于前端 UI 已完整翻译 20 种语言（当前前端注册 8 种）。只有
locale 文件完整并在 `src/i18n/index.ts` 注册的语言，才应出现在前端语言切换器中。

---

## 7. 自动化现状

当前已有：

- 前端 `fetchWithIdentity` 测试覆盖身份和认证 header 行为。
- 前端 error code/i18n 映射测试（`errorCodes.test.ts`、`errorHandler.test.ts`）覆盖结构化错误翻译；`clarification.test.ts` 覆盖 `text_code` / `label_code` 翻译。
- 前端 `i18nLocales.test.ts` 检查所有已注册 locale 的 key 与 en 对齐。
- 后端 `tests/backend/agents/test_agent_language.py` 覆盖 `build_language_instruction()` / `inject_language_instruction()`。
- 后端 `tests/backend/errors/test_error_handler.py` 覆盖 warning 事件的 `message_code`。

当前未作为已完成能力声明：

- 没有专门的语言注入静态检查脚本。
- 没有 pre-commit/CI 强制扫描所有新增 LLM 调用点。
- 普通后端 HTTP 响应消息仍在逐步迁移到 error code / message code 体系。

如果后续实现自动化检查，应更新本文档和相关 Cursor rules。

建议的未来自动化：

- 后端 AST 检查：扫描新增用户可见 Agent route 是否调用 `get_language_instruction()`。
- 前端 ESLint：启用 `i18next/no-literal-string`，初期可设为 `warn`，逐步提高到 `error`。
- PR checklist：要求新增 Agent、route、后端 message code、前端文案都按本文档检查。

这些内容是未来约束，不是当前已完成能力。

---

## 8. 新模块 Checklist

### 新增 Agent

- [ ] 构造函数接收 `language_instruction: str = ""`
- [ ] system prompt 使用 `inject_language_instruction()`
- [ ] route 层调用 `get_language_instruction()`
- [ ] 正确选择 `full` 或 `compact`
- [ ] Python 固定用户消息带 `message_code` / `content_code`

### 新增 Agent Route

- [ ] 读取 `Accept-Language` 派生语言指令
- [ ] `test-model` 这类健康检查明确记录为不注入
- [ ] 纯结构化 JSON route 若新增自然语言输出，需要重新评估注入
- [ ] 流式事件中的固定错误、问题、summary 文案使用 message code
- [ ] 前端消费路径调用 `translateBackend()`

### 新增前端组件

- [ ] 使用 `useTranslation()` 和 `t()`
- [ ] 所有已注册 locale 都添加翻译 key
- [ ] 不翻译内部 sentinel value
- [ ] 后端 message code 用 `translateBackend()` 消费

### 新增后端固定消息

- [ ] 判断消息是否用户可见
- [ ] 用户可见则提供英文 fallback + code
- [ ] code 在所有 `src/i18n/locales/<lang>/messages.json` 中都有翻译
- [ ] 如属于错误处理体系，优先使用统一 `ErrorCode` / `AppError`

### Review Checklist

- [ ] 没有进程级默认语言或硬编码中文/英文 prompt 约束
- [ ] 没有新增 Python 侧翻译字典
- [ ] 没有在 user message 中注入语言要求
- [ ] 没有新增未翻译的用户可见 TSX 字符串
- [ ] 英文 fallback 存在，缺翻译时不会空白

---

## 9. 相关规范

- `.cursor/skills/language-injection/SKILL.md`
- `.cursor/rules/language-injection-conventions.mdc`
- `.cursor/rules/i18n-no-hardcoded-strings.mdc`
- `docs/dev-guides/1-streaming-protocol.md`
- `docs/dev-guides/7-unified-error-handling.md`
