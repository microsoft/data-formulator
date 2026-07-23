# 14 - 模型能力运行时降级架构

## 概述

所有 LLM 调用统一通过 LiteLLM，利用 `drop_params=True` 实现运行时自动降级。
前端和后端不再预判模型能力（vision、reasoning 等），而是让模型调用自然失败后自动重试。

## 核心设计原则

1. **唯一调用路径** — 所有 Agent 通过 `Client.get_completion()` 或 `Client.get_completion_with_tools()` 调用 LLM，两者内部均走 `litellm.completion()`。
2. **`drop_params=True`** — LiteLLM 自动丢弃模型不支持的参数（如 `reasoning_effort`、`parallel_tool_calls`），不会报错。
3. **图片降级** — 如果模型不支持图片，`_is_image_deserialize_error()` 捕获异常后自动剥离图片重试；对于信息不明确的上游请求失败，仅在原请求确实包含图片时降级。
4. **无前端预检查** — 前端始终允许用户上传图片；后端自动处理。

## Client API

```python
class Client:
    def get_completion(self, messages, stream=False,
                       reasoning_effort="low", **kwargs):
        """通用 completion 调用。"""

    def get_completion_with_tools(self, messages, tools, stream=False,
                                  reasoning_effort="low", **kwargs):
        """带 tools 的 completion 调用。接受 tool_choice、
        parallel_tool_calls 等通过 **kwargs 传入。"""
```

两个方法共享相同的内部逻辑：
- 拷贝 `self.params`，注入 `reasoning_effort`
- 调用 `litellm.completion(model=..., drop_params=True, ...)`
- 捕获 image deserialize 错误 → 剥离图片 → 重试

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
| `low` / `medium` / `high` | 所有支持 reasoning 的模型（LiteLLM 统一映射） | 不支持 reasoning 的模型由 `drop_params=True` 静默忽略 |

> 选择原则：**挑能产出可接受质量的最低档**。重型代码生成 / 多步工具
> 调用使用 `low`；单轮抽取 / 分类 / 格式化使用 `minimal`。

### 当前配置（来源：`agent_config.py`）

| Agent ID | Tier | 备注 |
|---|---|---|
| `data_transform` | `low` | 生成 Python 转换脚本 |
| `data_rec` | `low` | 图表 / 转换推荐 |
| `data_agent` | `low` | 多步探索 agent |
| `report_gen` | `low` | 叙述 + inspect/embed 工具 |
| `interactive_explore` | `low` | 探索想法 agent |
| `data_loading_chat` | `low` | 会话式数据加载（带工具） |
| `data_load` | `minimal` | 一次性类型推断 |
| `experience_distill` | `minimal` | 总结分析上下文 |
| `chart_insight` | `minimal` | 图表标题 + 1–3 个 takeaway |
| `chart_restyle` | `minimal` | 对 Vega-Lite spec 做样式编辑 |
| `code_explanation` | `minimal` | 解释衍生字段 |
| `sort_data` | `minimal` | 小列表的自然顺序排序 |
| `simple` | `minimal` | nl_to_filter / workspace_name / intent |

`DEFAULT_REASONING_EFFORT = "low"` —— 未在表中列出的 agent id 走默认值。

### 运行时覆盖

通过环境变量 `DF_REASONING_EFFORT_<AGENT_ID>` 可在不改代码的情况下临时
调整某个 agent 的 tier：

```bash
DF_REASONING_EFFORT_DATA_TRANSFORM=medium
DF_REASONING_EFFORT_REPORT_GEN=high
```

合法取值：`none` / `minimal` / `low` / `medium` / `high`。

### Agent 调用模板

```python
from data_formulator.agent_config import reasoning_effort_for

_AGENT_ID = "data_transform"

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
grep -rn 'reasoning_effort_for' py-src/data_formulator/agents/
```

## 已删除的机制

| 删除项 | 原位置 | 理由 |
|---|---|---|
| `import openai` + 直连分支 | `client_utils.py`、5 个 Agent | 统一走 LiteLLM |
| `get_response()` | `client_utils.py` | 死代码 |
| `is_likely_text_only_model()` | `model_registry.py` | 硬编码模型名检查 |
| `model_supports_vision()` | `model_registry.py` | 前端/路由不再预检查 |
| `supports_vision` 字段 | `ModelConfig` (dfSlice)、`_reload`/`list_public` | 前端不消费 |
| `checkIsLikelyTextOnlyModel()` | `DataLoadingChat.tsx` | 前端不预检查 |
| `checkModelSupportsImageInput()` | `DataLoadingChat.tsx` | 前端不预检查 |
| vision 路由预检查 | `routes/agents.py` chart-insight、data-loading-chat | 改为运行时降级 |

## 新增 Agent 检查清单

- [ ] Agent 继承正确的 base class 并使用 `self.client`
- [ ] 在 `agent_config.py` 的 `AGENT_REASONING_EFFORT` 中为新 agent_id 设置默认 tier
- [ ] 调用 LLM 时使用 `reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model)`
- [ ] 需要 tools → 使用 `self.client.get_completion_with_tools(messages, tools, ...)`
- [ ] **不要** 直接 `import litellm` 或 `import openai` 调用 API
- [ ] **不要** 检查模型名来决定是否支持某功能（vision / reasoning 等）
- [ ] **不要** 在调用点硬编码 `reasoning_effort="high"`——统一通过 `agent_config.py` 维护

## 厂商映射

| 厂商 | `reasoning_effort` 效果 |
|---|---|
| OpenAI (o1/o3/gpt-5) | 直接透传 |
| Anthropic (Claude) | 映射为 `thinking.budget_tokens` |
| 其他（Gemini、Ollama 等） | `drop_params=True` 静默忽略 |
