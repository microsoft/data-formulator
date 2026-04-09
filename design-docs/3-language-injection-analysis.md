# Data Formulator 多语言提示词注入问题分析

## 1. 问题概述

项目已接入多语言（i18n）支持，部分 Agent 提示词通过 `language_instruction` 参数注入语言指令，但仍有多个地方遗漏，导致 Agent 推理时输出语言不一致（有时英文、有时中文）。

---

## 2. 现状分析

### 2.1 已有语言注入的地方（✅ 正确）

#### `agent_data_rec.py` 和 `agent_data_transform.py`

这两个 Agent 类通过构造函数接收 `language_instruction` 参数，并在初始化时注入到 system prompt 中：

```python
def __init__(self, client, workspace, system_prompt=None, agent_coding_rules="", 
             language_instruction="", max_display_rows=10000, model_info=None):
    # ...
    if language_instruction:
        # 查找标记位置，将语言指令插入到该标记之前
        marker = "**About the execution environment:**"
        idx = self.system_prompt.find(marker)
        if idx > 0:
            self.system_prompt = (
                self.system_prompt[:idx]
                + language_instruction + "\n\n"
                + self.system_prompt[idx:]
            )
```

**注入位置策略**：在 `"**About the execution environment:**"` 标记之前插入语言指令，确保语言要求在技术细节之前被声明。

---

### 2.2 遗漏的地方（❌ 缺少语言注入）

| 文件 | 位置 | 问题描述 | 当前代码 |
|------|------|---------|---------|
| `agent_routes.py` | L227-230 | 健康检查消息，硬编码英文 | `{"role": "system", "content": "You are a helpful assistant."}` |
| `agent_routes.py` | L1073-1086 | 生成工作区名称，硬编码英文 | `{"role": "system", "content": "You are a helpful assistant. Generate a very short name..."}` |
| `data_agent.py` | L357-404 | `_build_system_prompt()` 方法，没有语言参数 | 返回标准 messages 列表，未处理语言 |
| `agent_utils.py` | L243-247 | 补充代码生成，直接传递 messages | 直接拼接 messages，未检查语言指令 |

---

## 3. 遗漏代码详情

### 3.1 `agent_routes.py` - 健康检查

```python
# L227-230
messages=[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Respond 'I can hear you.' if you can hear me. Do not say anything other than 'I can hear you.'"},
]
```

**问题**：这是一个简单的连通性测试，虽然返回内容固定，但 system prompt 未注入语言指令。

---

### 3.2 `agent_routes.py` - 工作区命名

```python
# L1073-1086
messages = [
    {
        "role": "system",
        "content": (
            "You are a helpful assistant. Generate a very short name (3-5 words) "
            "for a data analysis workspace based on the context below. "
            "Return ONLY the name, no quotes, no explanation."
        ),
    },
    {"role": "user", "content": context_str},
]
```

**问题**：生成工作区名称时，未指定输出语言，可能导致生成的名称是英文而非用户界面语言。

---

### 3.3 `data_agent.py` - 数据 Agent

```python
# L357-404
def _build_system_prompt(self) -> str:
    rules_block = ""
    if self.agent_exploration_rules and self.agent_exploration_rules.strip():
        rules_block = (
            "\n\n[EXPLORATION RULES]\n"
            + self.agent_exploration_rules.strip()
        )
    
    return f"""You are a data analysis assistant...{rules_block}"""

def run(self, user_content: str) -> List[Dict]:
    return [
        {"role": "system", "content": self._build_system_prompt()},
        {"role": "user", "content": user_content},
    ]
```

**问题**：`_build_system_prompt()` 和 `run()` 方法都没有语言参数，无法注入语言指令。

---

### 3.4 `agent_utils.py` - 代码补充

```python
# L243-247
supp_resp = client.get_completion(messages=[
    *messages,
    {"role": "assistant", "content": assistant_content},
    {"role": "user", "content": prompt},
])
```

**问题**：直接传递 messages 列表，如果传入的 messages 中没有语言指令，则补充生成的代码也可能语言不一致。

---

## 4. 解决方案

### 方案 1：创建统一的 MessageBuilder 工具类（推荐）

创建专门的工具类统一处理消息构建和语言注入：

```python
# py-src/data_formulator/agents/message_builder.py

from typing import List, Dict, Optional
import os


class MessageBuilder:
    """统一构建 LLM 消息，自动注入语言指令。"""
    
    # 从环境变量或配置读取当前语言
    DEFAULT_LANGUAGE = os.environ.get("DF_DEFAULT_LANGUAGE", "zh")
    
    # 语言指令模板
    LANGUAGE_INSTRUCTIONS = {
        "zh": "**Language Requirement:** All responses must be in Chinese (中文). This includes code comments, explanations, and any text output.",
        "en": "**Language Requirement:** All responses must be in English.",
        "ja": "**Language Requirement:** All responses must be in Japanese (日本語).",
        # 可扩展更多语言
    }
    
    @classmethod
    def build(
        cls,
        system_content: str,
        user_content: str,
        language: Optional[str] = None,
        additional_messages: Optional[List[Dict]] = None
    ) -> List[Dict]:
        """
        构建标准的消息列表，自动注入语言指令。
        
        Args:
            system_content: system 角色的 content
            user_content: user 角色的 content
            language: 语言代码，None 则使用环境变量配置
            additional_messages: 额外的消息（如历史对话）
        """
        lang = language or cls.DEFAULT_LANGUAGE
        lang_instruction = cls.LANGUAGE_INSTRUCTIONS.get(lang, cls.LANGUAGE_INSTRUCTIONS["en"])
        
        # 将语言指令追加到 system prompt
        full_system = f"{system_content}\n\n{lang_instruction}"
        
        messages = [
            {"role": "system", "content": full_system},
            *(additional_messages or []),
            {"role": "user", "content": user_content},
        ]
        
        return messages
    
    @classmethod
    def wrap_system_prompt(cls, system_prompt: str, language: Optional[str] = None) -> str:
        """
        为已有的 system prompt 包装语言指令。
        用于 Agent 类内部已经组装好 prompt 的情况。
        """
        lang = language or cls.DEFAULT_LANGUAGE
        lang_instruction = cls.LANGUAGE_INSTRUCTIONS.get(lang, cls.LANGUAGE_INSTRUCTIONS["en"])
        
        return f"{system_prompt}\n\n{lang_instruction}"
```

**优点**：
- 集中管理语言指令模板
- 统一注入逻辑，避免遗漏
- 易于扩展新语言
- 可配置默认语言

---

### 方案 2：全局拦截（快速修复）

在 `get_completion` 调用处统一注入语言指令：

```python
# py-src/data_formulator/agents/client.py 或 base client

class LLMClient:
    def get_completion(self, messages: List[Dict], **kwargs):
        # 自动为 system prompt 注入语言指令
        if messages and messages[0].get("role") == "system":
            messages = self._inject_language(messages)
        
        # ... 原有逻辑 ...
    
    def _inject_language(self, messages: List[Dict]) -> List[Dict]:
        """为 system prompt 注入语言指令（如果尚未注入）。"""
        system_msg = messages[0]
        content = system_msg["content"]
        
        # 检查是否已包含语言指令
        if "**Language Requirement:**" in content:
            return messages
        
        # 注入语言指令
        lang = os.environ.get("DF_DEFAULT_LANGUAGE", "zh")
        lang_instruction = {
            "zh": "**Language Requirement:** All responses must be in Chinese (中文).",
            "en": "**Language Requirement:** All responses must be in English.",
        }.get(lang, "")
        
        new_content = f"{content}\n\n{lang_instruction}"
        return [{"role": "system", "content": new_content}, *messages[1:]]
```

**优点**：
- 无需修改所有调用点
- 自动覆盖所有遗漏的地方
- 防止重复注入（检查标记）

**缺点**：
- 对已经注入的代码会重复检查
- 不够显式，可能让开发者困惑

---

## 5. 具体修改建议

### 5.1 修改 `agent_routes.py`

#### 健康检查（L227-230）

```python
# 修改前
messages=[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Respond 'I can hear you.' if you can hear me..."},
]

# 修改后
from data_formulator.agents.message_builder import MessageBuilder

messages = MessageBuilder.build(
    system_content="You are a helpful assistant.",
    user_content="Respond 'I can hear you.' if you can hear me...",
)
```

#### 工作区命名（L1073-1086）

```python
# 修改前
messages = [
    {
        "role": "system",
        "content": (
            "You are a helpful assistant. Generate a very short name (3-5 words) "
            "for a data analysis workspace based on the context below..."
        ),
    },
    {"role": "user", "content": context_str},
]

# 修改后
messages = MessageBuilder.build(
    system_content=(
        "You are a helpful assistant. Generate a very short name (3-5 words) "
        "for a data analysis workspace based on the context below..."
    ),
    user_content=context_str,
)
```

---

### 5.2 修改 `data_agent.py`

```python
# 修改 _build_system_prompt 方法，添加 language 参数
def _build_system_prompt(self, language: Optional[str] = None) -> str:
    # ... 原有逻辑构建 prompt ...
    prompt = f"""You are a data analysis assistant..."""
    
    # 注入语言指令
    from data_formulator.agents.message_builder import MessageBuilder
    return MessageBuilder.wrap_system_prompt(prompt, language)

# 修改 run 方法
def run(self, user_content: str, language: Optional[str] = None) -> List[Dict]:
    return [
        {"role": "system", "content": self._build_system_prompt(language)},
        {"role": "user", "content": user_content},
    ]
```

---

### 5.3 修改 `agent_utils.py`

```python
# 修改前
supp_resp = client.get_completion(messages=[
    *messages,
    {"role": "assistant", "content": assistant_content},
    {"role": "user", "content": prompt},
])

# 修改后
from data_formulator.agents.message_builder import MessageBuilder

# 确保 messages[0] 包含语言指令
if messages and messages[0].get("role") == "system":
    wrapped_system = MessageBuilder.wrap_system_prompt(messages[0]["content"])
    messages = [{"role": "system", "content": wrapped_system}, *messages[1:]]

supp_resp = client.get_completion(messages=[
    *messages,
    {"role": "assistant", "content": assistant_content},
    {"role": "user", "content": prompt},
])
```

---

## 6. 推荐实施步骤

### Phase 1：快速修复（立即）

1. 在 LLMClient 的 `get_completion` 方法中添加全局拦截逻辑（方案 2）
2. 设置环境变量 `DF_DEFAULT_LANGUAGE=zh`
3. 验证所有 Agent 输出语言一致性

### Phase 2：规范化（后续）

1. 创建 `MessageBuilder` 工具类（方案 1）
2. 逐步替换所有硬编码的 messages 构建逻辑
3. 移除 Phase 1 的全局拦截（或保留作为兜底）

### Phase 3：配置化（可选）

1. 将语言配置添加到应用配置系统（而非仅环境变量）
2. 支持用户级语言偏好设置
3. 支持动态语言切换

---

## 7. 语言指令模板参考

```python
LANGUAGE_INSTRUCTIONS = {
    "zh": """**Language Requirement:** 
All responses must be in Chinese (中文). 
This includes:
- Code comments should be in Chinese
- Variable names can be in English (Python convention)
- Explanations and descriptions must be in Chinese
- Error messages should be in Chinese""",

    "en": """**Language Requirement:** 
All responses must be in English.""",

    "ja": """**Language Requirement:** 
All responses must be in Japanese (日本語).
This includes code comments, explanations, and any text output.""",
    
    # 可继续扩展...
}
```

---

## 8. 验证清单

实施完成后，验证以下场景的语言一致性：

- [ ] 健康检查接口返回中文
- [ ] 新建工作区时生成的名称是中文
- [ ] 数据推荐 Agent 的代码注释是中文
- [ ] 数据转换 Agent 的解释说明是中文
- [ ] 代码补充生成的注释是中文
- [ ] 错误提示信息是中文

---

## 9. 相关文件

| 文件路径 | 说明 |
|---------|------|
| `py-src/data_formulator/agent_routes.py` | 健康检查、工作区命名 |
| `py-src/data_formulator/agents/data_agent.py` | 数据 Agent 基类 |
| `py-src/data_formulator/agents/agent_utils.py` | 代码补充工具 |
| `py-src/data_formulator/agents/agent_data_rec.py` | 数据推荐 Agent（已有语言注入） |
| `py-src/data_formulator/agents/agent_data_transform.py` | 数据转换 Agent（已有语言注入） |

---

## 10. 附录：当前语言注入实现参考

### `agent_data_rec.py` 中的注入逻辑

```python
def __init__(self, client, workspace, system_prompt=None, agent_coding_rules="", 
             language_instruction="", max_display_rows=10000, model_info=None):
    # ...
    if language_instruction:
        # Insert early (after role definition, before technical sections)
        # Find a good insertion point
        marker = "**About the execution environment:**"
        idx = self.system_prompt.find(marker)
        if idx > 0:
            self.system_prompt = (
                self.system_prompt[:idx]
                + language_instruction + "\n\n"
                + self.system_prompt[idx:]
            )
        else:
            self.system_prompt = self.system_prompt + "\n\n" + language_instruction
```

**关键点**：
- 通过 `marker` 定位插入位置，确保语言指令在技术细节之前
- 如果找不到标记，则追加到末尾
- 保持向后兼容（`language_instruction` 默认为空字符串）
