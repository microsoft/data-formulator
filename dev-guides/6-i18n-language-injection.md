# 多语言与 Agent 语言注入开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-26
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
| `src/app/App.tsx` | `LanguageSwitcher`，基于 `AVAILABLE_LANGUAGES` 切换前端语言 |
| `py-src/data_formulator/routes/agents.py` | `_get_ui_lang()`、`get_language_instruction()` |
| `py-src/data_formulator/agents/agent_language.py` | `build_language_instruction()`、`inject_language_instruction()` |
| `src/i18n/locales/{en,zh}/` | 前端翻译资源 |

### 1.1 当前代码对照状态

从原设计文档迁移时已按当前代码重新核对，不能再把早期计划里的状态原样视为事实：

| 项目 | 当前状态 | 说明 |
|------|----------|------|
| `SortDataAgent` | 已接入 | 构造函数接收 `language_instruction`，route 使用 `compact` 模式 |
| `workspace-summary` | 已接入 | `SimpleAgents` 接收 `language_instruction`，生成短名称使用 `compact` |
| `nl-to-filter` | 暂不注入 | 当前返回结构化 JSON；未来若返回用户可见自然语言再接入 |
| `test-model` | 明确豁免 | 健康检查需要固定返回，不应被语言指令影响 |
| `rec_language_instruction` | 已清理 | 当前 `routes/agents.py` 未再保留该误导性参数 |
| `message_code` / `content_code` / `option_codes` | 已落地 | Python 固定用户消息由前端翻译，后端保留英文 fallback |
| 前端 i18n | 已有 en/zh 主链路 | `LanguageSwitcher`、`fetchWithIdentity()`、locale 资源已接入 |
| 静态检查 / CI | 未落地 | `scripts/check_language_injection.py`、pre-commit 强制检查仍是未来项 |

---

## 2. Agent Prompt 语言注入

新增或修改会调用 LLM 的 Agent route 时，先判断输出是否面向用户展示：

| 输出类型 | 是否注入 | 说明 |
|----------|----------|------|
| 用户可读解释、建议、报告、对话、自动命名 | 是 | 必须跟随 UI 语言 |
| 生成代码、JSON key、字段名、变量名 | 部分 | 使用 `compact`，只约束用户可见字段 |
| 纯健康检查 / 固定连通性测试 | 否 | 例如 `test-model`，保持固定英文更稳定 |
| 纯结构化 JSON 且不展示自然语言 | 通常否 | 例如当前 `nl-to-filter`，未来若返回用户文案再接入 |

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
| `full` | 文本型 Agent：探索、报告、解释、聊天、洞察、数据加载对话 |
| `compact` | 代码生成、数据转换、排序、自动命名、短文本生成、结构化输出 |

建议模式：

| 场景 | Mode |
|------|------|
| `DataAgent`、`ChartInsightAgent`、`InteractiveExploreAgent`、`ReportGenAgent` | `full` |
| `DataRecAgent`、`DataTransformationAgent`、`DataLoadAgent` | `compact` |
| `SortDataAgent`、`workspace-summary` | `compact` |
| `test-model`、模型列表、纯状态检查 | 不注入 |

### 2.2 Agent 层

Agent 构造函数应接收 `language_instruction: str = ""`，并用
`inject_language_instruction()` 注入 system prompt：

```python
from data_formulator.agents.agent_language import inject_language_instruction

system_prompt = inject_language_instruction(system_prompt, language_instruction)
```

复杂 prompt 可以指定 marker，把语言指令插入到技术细节之前：

```python
system_prompt = inject_language_instruction(
    system_prompt,
    language_instruction,
    marker="**About the execution environment:**",
)
```

规则：

- 不要在 prompt 中硬编码 `"回答请使用中文"` 之类的语言要求。
- 不要用进程级环境变量决定语言；语言必须来自每个请求的 `Accept-Language`。
- 不要新增并行的 `MessageBuilder` 或 LLM client 全局拦截器。
- 不要跳过 `get_language_instruction()` 在 route 中直接调用 `build_language_instruction()`。
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
yield {
    "type": "error",
    "message": "Output DataFrame is empty (0 rows).",
    "message_code": "agent.emptyDataframe",
}
```

### 3.2 结果 content

```python
result = {
    "status": "error",
    "content": "No code block found in the response.",
    "content_code": "agent.noCodeBlock",
}
```

### 3.3 结构化澄清问题

```python
event = {
    "type": "clarify",
    "questions": [{
        "id": "continue_after_tool_rounds",
        "text": "How would you like to proceed?",
        "text_code": "agent.clarifyExhausted",
        "text_params": {"steps": steps_desc},
        "responseType": "single_choice",
        "options": [
            {
                "id": "continue",
                "label": "Continue exploring",
                "label_code": "agent.clarifyOptionContinue",
            },
            {
                "id": "simplify",
                "label": "Simplify the task",
                "label_code": "agent.clarifyOptionSimplify",
            },
        ],
    }],
}
```

命名规则：

- Agent 相关 key 放在 `messages.agent.*`。
- 后端字段中只写 `agent.emptyDataframe`，前端会拼成 `messages.agent.emptyDataframe`。
- 有参数时使用 `message_params`、`content_params`、`text_params`，例如 `{"missing": "...", "available": "..."}`。
- `clarify` 事件使用 `questions[].text_code` 和 `questions[].options[].label_code`，不要再新增顶层 `message/options/option_codes` 协议。
- LLM 根据当前 UI 语言生成的问题和选项通常只需要 `text` / `label`；固定后端文案才需要同时提供 fallback 文本和 code。
- `questions[].options[]` 的翻译只作用于当前问题的选项，不要把多个问题的选项合并到同一个数组。
- 不要新增 Python 侧翻译表或 `agent_messages.py`；早期设计中的该方案已由前端 `message_code` 翻译模式取代。

### 3.4 已迁移的 Agent 消息 key

当前第一批高频 Agent 固定消息已经在 `src/i18n/locales/{en,zh}/messages.json`
中提供翻译：

| Key | 来源 |
|-----|------|
| `agent.clarifyExhausted` | `DataAgent` clarify |
| `agent.clarifyOptionContinue` / `Simplify` / `Present` | `DataAgent` clarify options |
| `agent.maxIterationsSummary` | `DataAgent` completion summary |
| `agent.emptyDataframe` | `DataAgent` error event |
| `agent.fieldsNotFound` | `DataAgent` chart field validation |
| `agent.llmApiError` | `DataAgent` LLM error |
| `agent.llmEmptyResponse` | `DataAgent` empty model response |
| `agent.parseActionFailed` | `DataAgent` action parse failure |
| `agent.unknownAction` | `DataAgent` action dispatch |
| `agent.noCodeBlock` | `DataRecAgent` / `DataTransformationAgent` |
| `agent.unexpectedError` | `DataRecAgent` fallback |
| `agent.codeExecError` | code execution fallback |
| `agent.unableExtractTables` | `DataCleanAgentStream` |
| `agent.unableExtractScript` | `DataLoadAgent` / `SortDataAgent` |
| `agent.errorCallingModel` | `DataLoadingChatAgent` |

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

澄清面板自己的固定 UI 文案，例如标题、按钮、占位符和“直接说明”标签，放在
`src/i18n/locales/{en,zh}/common.json` 的 `chartRec` 下；不要从后端事件里下发这些前端壳层文案。

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
src/i18n/locales/en/
src/i18n/locales/zh/
```

新增 key 时必须同时更新 en 和 zh。命名空间按现有文件选择：`common`、`upload`、
`chart`、`model`、`encoding`、`messages`、`navigation`、`dataLoading`、`errors` 等。

### 5.1 翻译 key 命名

优先使用现有 namespace。大量独立功能文案可以新建 namespace，但必须同时添加 en/zh
资源并注册到 locale index。

```text
<namespace>.<component-or-feature>.<element>

dataLoading.toolLabels.readingFile
dataLoading.actions.loadTable
dataLoading.placeholder.describeData
common.actions.close
messages.error.failedToOpenWorkspace
```

设计文档中曾列出一批前端硬编码审计结果；迁移到本规范后，这些清单不再作为“当前待办事实”
维护。开发时以 `.cursor/rules/i18n-no-hardcoded-strings.mdc` 和本节规则为准，发现新增或修改
的用户可见文案时就地迁移到 i18n。

---

## 6. 新语言接入

1. 在 `agents/agent_language.py` 的 `LANGUAGE_DISPLAY_NAMES` 中添加语言代码和显示名。
2. 如有特殊要求，添加到 `LANGUAGE_EXTRA_RULES`。
3. 在 `src/i18n/locales/<lang>/` 添加完整翻译资源。
4. 在服务端配置 `AVAILABLE_LANGUAGES`，让前端语言切换器显示该语言。
5. 验证 `fetchWithIdentity()` 请求头、Agent 输出、固定 UI 文案都使用新语言。

每种新语言至少需要与 en/zh 等价的 locale 结构：

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

`agent_language.py` 支持的 20 种 LLM 输出语言不等于前端 UI 已完整翻译 20 种语言。只有
locale 文件和 `AVAILABLE_LANGUAGES` 都配置完成的语言，才应出现在前端语言切换器中。

---

## 7. 自动化现状

当前已有：

- 前端 `fetchWithIdentity` 测试覆盖身份和认证 header 行为。
- 前端 error code/i18n 映射测试覆盖结构化错误翻译。
- 后端 Agent 和 error handler 测试覆盖部分 `message_code` / warning 事件。

当前未作为已完成能力声明：

- 没有专门的 `scripts/check_language_injection.py` 静态检查脚本。
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
- [ ] `nl-to-filter` 这类纯结构化 JSON route 若新增自然语言输出，需要重新评估注入
- [ ] 流式事件中的错误、clarify、summary 使用 message code
- [ ] 前端消费路径调用 `translateBackend()`

### 新增前端组件

- [ ] 使用 `useTranslation()` 和 `t()`
- [ ] en/zh 都添加翻译 key
- [ ] 不翻译内部 sentinel value
- [ ] 后端 message code 用 `translateBackend()` 消费

### 新增后端固定消息

- [ ] 判断消息是否用户可见
- [ ] 用户可见则提供英文 fallback + code
- [ ] code 在 `src/i18n/locales/en/messages.json` 和 `zh/messages.json` 中都有翻译
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
- `dev-guides/1-streaming-protocol.md`
- `dev-guides/7-unified-error-handling.md`
