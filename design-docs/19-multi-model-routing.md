# 19 - 多模型路由：后端按任务类型自动选择模型

> 状态：方向已定，Phase 2/3 实施  
> 创建日期：2026-04-30  
> 前置依赖：`design-docs/18-api-error-guardrails-and-chart-insight-failure.md` Phase 1 完成  
> 相关文档：`design-docs/18.2-insight-architecture-redesign.md`

## 1. 动机

当前所有 Agent endpoint 使用同一个用户选择的模型：

```
前端 getActiveModel() → request body: model={...} → 后端 get_client(content['model'])
```

问题：
- 用户选了 `deepseek-chat`（不支持 vision）→ chart insight 必定失败
- 用户选了 `gpt-4o`（贵）→ 即使是简单的 field type 推断也用贵模型
- 所有 Agent 的 `reasoning_effort` 被硬编码为 `"low"`，无法按任务复杂度调整
- 无法为特定任务类型强制使用高质量模型（如数据生成用强推理模型）

## 2. 设计目标

1. 用户只选"主模型"，后端按 agent/task 类型自动决定实际使用的模型
2. 服务端管理员可通过 `.env` 配置任务级模型覆盖（前端不感知）
3. 不配置覆盖时，所有任务 fallback 到用户选择的主模型（行为不变）
4. 每个 Agent 可声明自己的 `reasoning_effort` 和 `requires_vision` 等能力需求

## 3. 任务类型分类

| 任务类型标识 | 对应 Agent / Endpoint | 模型要求 | reasoning_effort |
|-------------|----------------------|----------|-----------------|
| `data_generation` | `DataAgent`、`data-agent-streaming` | 强推理能力 | medium~high |
| `insight` | `ChartInsightAgent`、`chart-insight` | 可能需要 vision | low |
| `cheap` | `fetchFieldSemanticType`、`code-expl`、`workspace-summary` | 无特殊要求，速度优先 | low |
| `chat` | `data-loading-chat` | 对话能力 + 工具调用 | medium |
| `explore` | `get-recommendation-questions`、interactive explore | 中等推理 | medium |
| `report` | `generate-report-chat` | 长文本生成 | low~medium |

## 4. ModelResolver 设计

```python
import os
from typing import Optional

class ModelResolver:
    """根据任务类型决定实际使用的模型配置。
    
    优先级：
    1. 服务端 .env 中配置的任务级覆盖（DF_XXX_MODEL）
    2. 用户选择的主模型
    """
    
    TASK_ENV_MAP = {
        "data_generation": "DF_DATA_GENERATION_MODEL",
        "insight": "DF_INSIGHT_MODEL",
        "cheap": "DF_CHEAP_MODEL",
        "chat": "DF_CHAT_MODEL",
        "explore": "DF_EXPLORE_MODEL",
        "report": "DF_REPORT_MODEL",
    }
    
    def resolve(self, user_model: dict, task_type: str) -> dict:
        """根据任务类型决定实际使用的模型"""
        override = self._get_override(task_type)
        if override:
            return override
        return user_model
    
    def _get_override(self, task_type: str) -> Optional[dict]:
        env_key = self.TASK_ENV_MAP.get(task_type)
        if not env_key:
            return None
        model_id = os.getenv(env_key, "").strip()
        if not model_id:
            return None
        config = model_registry.get_config(model_id)
        if not config:
            logger.warning(f"ModelResolver: {env_key}={model_id} not found in registry, falling back to user model")
            return None
        return config
    
    def resolve_insight(self, user_model: dict, needs_image: bool) -> dict:
        """Insight 任务的特殊解析：需要图片时确保 vision 能力"""
        resolved = self.resolve(user_model, "insight")
        if needs_image and not model_supports_vision(resolved):
            # 尝试 fallback 到用户选的主模型
            if model_supports_vision(user_model):
                return user_model
            raise AppError(ErrorCode.VALIDATION_ERROR, 
                          "No vision-capable model available for image-based insight")
        return resolved
```

## 5. 服务端配置示例

```env
# 可选配置：不配则所有任务用用户选择的主模型

# 洞察用 vision model（可处理图片 fallback）
DF_INSIGHT_MODEL=global-openai-gpt-4o

# 简单任务用便宜快速 model
DF_CHEAP_MODEL=global-deepseek-deepseek-chat

# 复杂数据生成用强推理 model
DF_DATA_GENERATION_MODEL=global-openai-o3-mini

# 对话用平衡型 model
DF_CHAT_MODEL=global-anthropic-claude-sonnet-4-5
```

## 6. Agent 能力声明

每个 Agent 类声明自己的能力需求，`ModelResolver` 据此做额外校验：

```python
AGENT_CAPABILITIES = {
    "data_agent": {
        "task_type": "data_generation",
        "reasoning_effort": "medium",
        "requires_vision": False,
        "requires_tool_use": True,
    },
    "chart_insight": {
        "task_type": "insight",
        "reasoning_effort": "low",
        "requires_vision": "optional",  # 结构化优先，vision 为 fallback
        "requires_tool_use": False,
    },
    "field_semantic_type": {
        "task_type": "cheap",
        "reasoning_effort": "low",
        "requires_vision": False,
        "requires_tool_use": False,
    },
    "code_explanation": {
        "task_type": "cheap",
        "reasoning_effort": "low",
        "requires_vision": False,
        "requires_tool_use": False,
    },
    "data_loading_chat": {
        "task_type": "chat",
        "reasoning_effort": "medium",
        "requires_vision": False,
        "requires_tool_use": True,
    },
    "interactive_explore": {
        "task_type": "explore",
        "reasoning_effort": "medium",
        "requires_vision": False,
        "requires_tool_use": True,
    },
}
```

## 7. 与 Streaming / Thinking 的关系

多模型路由影响 reasoning 输出：

- `reasoning_effort` 按 agent 能力声明传入 `get_completion()`，不再硬编码
- 如果 resolved model 支持 extended thinking（如 Claude Opus 4），`client_utils.py` 应提取 `reasoning_content` 字段并 yield 为 `thinking_text` 事件
- 如果 resolved model 不支持 reasoning（如 GPT-4o-mini），`reasoning_effort` 参数被 `drop_params=True` 自动忽略

## 8. 与 Insight 架构重构的关系

Phase 2 的 `InsightProfiler`（`18.2` 文档）与 `ModelResolver` 协同：

1. `InsightProfiler` 位于 `py-src/data_formulator/insights/`，生成结构化 profile（不需要模型）
2. `ModelResolver` 决定 `InsightNarratorAgent` 使用哪个模型：
   - 纯结构化输入 → 可用 `DF_CHEAP_MODEL`
   - 需要 vision fallback → 必须用 `DF_INSIGHT_MODEL`（vision capable）
3. 前端不感知模型选择细节，只知道"洞察成功/失败"

## 9. 前端影响

前端 **无需** 为多模型路由做任何改动：

- `model` 字段继续发送用户选择的主模型（作为 hint/preference）
- 后端透明地完成模型路由
- 如果后端使用了不同的模型，可在响应 header 或 body meta 中标记（可选，用于 debug）

唯一的 UI 变更（可选，Phase 3）：
- Settings 中增加"高级"选项，让用户看到后端配置的任务级模型
- insight 失败时的 error message 中提示"可联系管理员配置 vision model"

## 10. 实施顺序

1. **Phase 1（已规划）**：`reasoning_effort` 参数化，`get_completion()` 接受参数
2. **Phase 2**：新增 `ModelResolver` 类 + `.env` 配置 + `AGENT_CAPABILITIES` 声明
3. **Phase 3**：前端可选 UI（显示实际使用的模型、高级配置面板）

## 11. Open Questions

1. 当配置的覆盖模型不可用（connectivity check 失败）时，是否自动 fallback 到用户主模型？
2. 是否需要在响应中告知前端"实际使用了哪个模型"（用于 debug 或用户信任）？
3. 多模型路由是否需要考虑成本预算（如每日 token 上限触发自动降级）？
