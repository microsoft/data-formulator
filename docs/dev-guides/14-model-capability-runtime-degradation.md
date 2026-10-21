# 14 - 模型能力运行时降级架构

## 概述

所有 LLM 调用统一通过 `agents/client_utils.py` 的 `Client`，底层走 LiteLLM，并利用
`drop_params=True` 和失败后重试实现运行时降级。前端和后端都不按模型名预判模型能力
（vision、reasoning 等），而是让调用自然失败后自动降级重试。

## 核心设计原则

1. **唯一调用路径** — 所有 Agent 通过 `Client.get_completion()` 或 `Client.get_completion_with_tools()` 调用 LLM，两者内部均走 `Client._dispatch()` → `litellm.completion()`。
2. **`drop_params=True`** — LiteLLM 自动丢弃模型不支持的参数（如 `reasoning_effort`、`parallel_tool_calls`），不会报错。
3. **图片降级** — 如果模型不支持图片，`_is_image_deserialize_error()` 识别错误后用 `_strip_images_from_messages()` 剥离 `image_url` 块重试；对于信息不明确的错误（`upstream request failed`、`image ... not support/unsupported`），仅在原请求确实包含图片时降级。
4. **无前端预检查** — 前端（`src/views/SimpleChartRecBox.tsx` 的图片附件，经 `attached_images` 发到 `/analyst-streaming`）不检查模型是否支持图片；后端自动处理。代码中没有按模型名判断 vision 能力的函数，也没有 `supports_vision` 字段。

## Client API

```python
class Client:
    def get_completion(self, messages, stream=False,
                       reasoning_effort="low", **kwargs):
        """通用 completion 调用。**kwargs 合并进请求参数（如 response_format）。"""

    def get_completion_with_tools(self, messages, tools, stream=False,
                                  reasoning_effort="low", **kwargs):
        """带 tools 的 completion 调用。接受 tool_choice、
        parallel_tool_calls 等通过 **kwargs 传入。"""
```

两个方法共享相同的内部逻辑：
- 拷贝 `self.params`，注入 `reasoning_effort`
- 调用 `_dispatch()` → `litellm.completion(model=..., drop_params=True, ...)`
- 捕获错误后按下表降级重试一次，否则抛出

## 运行时降级一览

| 触发 | 处理 | 位置 |
|---|---|---|
| 图片相关错误（见原则 3） | 剥离 `image_url` 块后重试 | `get_completion` / `get_completion_with_tools` |
| 错误信息含 `reasoning_effort` / `reasoning.effort` / `does not support thinking` | 去掉 `reasoning_effort` 重试；若是 `unsupported parameter`，记入 `_NO_REASONING`，该路由之后不再发送 | 同上，`_drop_reasoning_after()` |
| OpenAI/Azure 且 LiteLLM 认为模型不支持 reasoning | 发送前移除 `reasoning_effort` | `_dispatch()` / `_supports_reasoning()` |
| OpenAI/Azure 一方 host，LiteLLM 不认识该模型（如自定义 Azure deployment 名） | 设置 `allowed_openai_params=["reasoning_effort"]`，避免被静默丢弃 | `_dispatch()` |
| `response_format` 相关错误 | 去掉 `response_format` 重试；非 OpenAI/Azure endpoint 发送前直接去掉 | 仅 `get_completion` |
| OpenAI/Azure 一方 host 默认走 Responses API，但该部署不可用（旧 api-version 等） | 回退 Chat Completions，并记入 `_CHAT_ONLY` | `_dispatch()` |
| OpenAI/Azure endpoint 未走 Responses（如第三方 host）时，报错要求 tools 走 `/v1/responses` | 改走 Responses API 重试，并记入 `_RESPONSES_FOR_TOOLS` | `get_completion_with_tools` |
| Ollama | 始终以非流式调用，再用 `_synthesize_stream()` 回放为流；从文本内容中补救工具调用（`_salvage_tool_calls_from_content()`） | `_dispatch()` |

`_NO_REASONING` / `_CHAT_ONLY` / `_RESPONSES_FOR_TOOLS` 是进程内集合，按
`(endpoint, api_base, api_version, model)` 记录路由。

## reasoning_effort 分层

每个 Agent 的默认 tier 在 `py-src/data_formulator/agent_config.py` 的
`AGENT_REASONING_EFFORT` 字典里统一维护。Agent 调用 LLM 时通过
`reasoning_effort_for(_AGENT_ID, self.client.model)` 解析最终值，自动按
目标模型做能力降级。

### 五档定义

| Tier | 适用范围 | 不支持的模型如何降级 |
|---|---|---|
| `none` | 仅 GPT-5 `codex` / `pro`（最轻档） | 其它模型回退到 `low` |
| `minimal` | 仅 OpenAI GPT-5 base / mini / nano / 5.x | GPT-5 codex/pro → `none`；其它 → `low` |
| `low` / `medium` / `high` | 所有支持 reasoning 的模型（LiteLLM 统一映射） | 不支持 reasoning 的模型由 `drop_params=True` 或上表的重试处理 |

> 选择原则：**挑能产出可接受质量的最低档**。重型代码生成 / 多步工具
> 调用使用 `low`；单轮抽取 / 分类 / 格式化使用 `minimal`。

### 当前配置（来源：`agent_config.py`）

| Agent ID | Tier | 调用方 |
|---|---|---|
| `analyst` | `low` | `AnalystAgent._open_stream()`（`WorkflowAgent` 继承同一调用） |
| `data_load` | `minimal` | `DataLoadAgent`（`agent_data_load.py`） |
| `workflow_distill` | `minimal` | `WorkflowDistillAgent`（`agent_workflow_distill.py`） |
| `chart_restyle` | `minimal` | `ChartRestyleAgent`（`agent_chart_restyle.py`） |
| `code_explanation` | `minimal` | `CodeExplanationAgent`（`agent_code_explanation.py`） |
| `sort_data` | `minimal` | `SortDataAgent`（`agent_sort_data.py`） |
| `simple` | `minimal` | `SimpleAgents`（`agent_simple.py`，workspace_name） |
| `data_transform`、`data_rec`、`interactive_explore` | `low` | 字典中仍有，当前无调用方 |
| `data_clean`、`chart_insight` | `minimal` | 字典中仍有，当前无调用方 |

`DEFAULT_REASONING_EFFORT = "low"` —— 未在表中列出的 agent id 走默认值
（例如 `StarterQuestionsAgent` 的 `starter_questions`）。

### 运行时覆盖

1. **模型配置的 Thinking 级别**：模型配置中的 `reasoning_effort`（只允许
   `MODEL_REASONING_LEVELS` = `low` / `medium` / `high`）由 `routes/agents.py`
   校验后写入 `client.reasoning_effort`。`AnalystAgent` 把它作为
   `reasoning_effort_for(..., preference)` 传入，优先于下面两种来源；其它 helper agent 不传。
2. **环境变量** `DF_REASONING_EFFORT_<AGENT_ID>`，不改代码即可临时调整某个 agent 的 tier：

```bash
DF_REASONING_EFFORT_ANALYST=medium
DF_REASONING_EFFORT_DATA_LOAD=low
```

合法取值：`none` / `minimal` / `low` / `medium` / `high`。

3. 否则使用 `AGENT_REASONING_EFFORT`，再否则 `DEFAULT_REASONING_EFFORT`。

### Agent 调用模板

```python
from data_formulator.agent_config import reasoning_effort_for

_AGENT_ID = "sort_data"

response = self.client.get_completion(
    messages=messages,
    reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model),
)
```

### 查询方式

```bash
# 当前所有 agent 的默认 tier
grep -nE '"\w+": +"' py-src/data_formulator/agent_config.py

# 所有调用点
grep -rn 'reasoning_effort_for' py-src/data_formulator/
```

## 新增 Agent 检查清单

- [ ] Agent 在构造函数中接收 `client` 并保存为 `self.client`（helper agent 没有公共基类）
- [ ] 在 `agent_config.py` 的 `AGENT_REASONING_EFFORT` 中为新 agent_id 设置默认 tier
- [ ] 调用 LLM 时使用 `reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model)`
- [ ] 需要 tools → 使用 `self.client.get_completion_with_tools(messages, tools, ...)`
- [ ] **不要** 直接 `import litellm` 或 `import openai` 调用 API
- [ ] **不要** 检查模型名来决定是否支持某功能（vision / reasoning 等）
- [ ] **不要** 在调用点硬编码 `reasoning_effort="high"`——统一通过 `agent_config.py` 维护

## 厂商映射

| 厂商 | `reasoning_effort` 效果 |
|---|---|
| OpenAI / Azure (o 系列 / gpt-5) | 透传；LiteLLM 判定不支持时移除，未知模型在一方 host 上强制透传 |
| Anthropic (Claude) | 由 LiteLLM 映射为 extended thinking |
| Ollama | LiteLLM 映射为 `think`；模型报 `does not support thinking` 时去掉后重试 |
| 其他（Gemini 等） | 由 LiteLLM 统一映射；不支持时 `drop_params=True` 静默忽略 |
