# 14 - 模型能力运行时降级架构

## 概述

所有 LLM 调用统一通过 LiteLLM，利用 `drop_params=True` 实现运行时自动降级。
前端和后端不再预判模型能力（vision、reasoning 等），而是让模型调用自然失败后自动重试。

## 核心设计原则

1. **唯一调用路径** — 所有 Agent 通过 `Client.get_completion()` 或 `Client.get_completion_with_tools()` 调用 LLM，两者内部均走 `litellm.completion()`。
2. **`drop_params=True`** — LiteLLM 自动丢弃模型不支持的参数（如 `reasoning_effort`、`parallel_tool_calls`），不会报错。
3. **图片降级** — 如果模型不支持图片，`_is_image_deserialize_error()` 捕获异常后自动剥离图片重试。
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

默认 `"low"`（安全、省 token）。需要高推理的 Agent 调用时显式传 `"high"`。

### LOW（走默认）

| Agent | 文件 |
|---|---|
| SortDataAgent | `agent_sort_data.py` |
| SimpleAgents（×3 方法） | `agent_simple.py` |
| CodeExplanationAgent | `agent_code_explanation.py` |
| DataLoadAgent | `agent_data_load.py` |
| ChartRestyleAgent | `agent_chart_restyle.py` |
| DataCleanAgentStream | `agent_data_clean_stream.py` |
| ChartInsightAgent | `agent_chart_insight.py` |

### HIGH（显式传参）

| Agent | 文件 |
|---|---|
| DataAgent | `data_agent.py` |
| DataLoadingAgent | `agent_data_loading_chat.py` |
| ReportGenAgent | `agent_report_gen.py` |
| ExperienceDistillAgent | `agent_experience_distill.py` |
| DataTransformationAgent | `agent_data_transform.py` |
| DataRecAgent | `agent_data_rec.py` |

### 混合模式

| Agent | LOW 路径 | HIGH 路径 |
|---|---|---|
| InteractiveExploreAgent | `run()` 主流 `get_completion()` | `_call_llm_with_tools()` 工具轮 `get_completion_with_tools(..., reasoning_effort="high")` |

### 查询方式

```bash
grep -r 'reasoning_effort="high"' py-src/data_formulator/agents/
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
- [ ] 简单任务 → 调用 `self.client.get_completion(messages)`（默认 low）
- [ ] 复杂 / 代码生成任务 → 调用时传 `reasoning_effort="high"`
- [ ] 需要 tools → 使用 `self.client.get_completion_with_tools(messages, tools, ...)`
- [ ] **不要** 直接 `import litellm` 或 `import openai` 调用 API
- [ ] **不要** 检查模型名来决定是否支持某功能

## 厂商映射

| 厂商 | `reasoning_effort` 效果 |
|---|---|
| OpenAI (o1/o3/gpt-5) | 直接透传 |
| Anthropic (Claude) | 映射为 `thinking.budget_tokens` |
| 其他（Gemini、Ollama 等） | `drop_params=True` 静默忽略 |
