# Data Formulator 多语言提示词注入分析

## 1. 问题概述

项目已接入多语言（i18n）支持，核心 Agent 提示词通过 `language_instruction` 参数注入语言指令。但仍有个别 LLM 调用点遗漏了语言注入，导致部分场景下输出语言与用户界面语言不一致。

---

## 2. 现有语言注入架构

### 2.1 整体流程

```
前端 i18n.language  ──►  Accept-Language header  ──►  get_language_instruction()
                                                           │
                                                           ▼
                                                   build_language_instruction()
                                                   (agent_language.py)
                                                           │
                                              ┌────────────┴────────────┐
                                              ▼                         ▼
                                        mode="full"               mode="compact"
                                    (文本型 Agent)             (代码生成 Agent)
```

**关键模块**：

| 模块 | 职责 |
|------|------|
| `src/app/utils.tsx` → `getAgentLanguage()` | 从 `i18n.language` 提取语言代码 |
| `src/app/utils.tsx` → `fetchWithIdentity()` | 在每个 API 请求的 `Accept-Language` header 中注入语言代码 |
| `py-src/.../agents/agent_language.py` | `build_language_instruction(lang, mode)` — 根据语言代码和模式生成提示词片段 |
| `py-src/.../agent_routes.py` → `get_language_instruction()` | 从 `Accept-Language` header 解析语言，调用 `build_language_instruction` |

### 2.2 已正确注入语言的 Agent

#### `agent_data_rec.py` 和 `agent_data_transform.py`

通过构造函数接收 `language_instruction`，注入到 system prompt 中：

```python
if language_instruction:
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

**注入位置策略**：在 `"**About the execution environment:**"` 标记之前插入，确保语言要求在技术细节之前被声明。如果找不到标记，则追加到末尾。

#### `data_agent.py`

通过 `self.language_instruction` 实例属性，在 `_build_system_prompt()` 中注入：

```python
def _build_system_prompt(self) -> str:
    # ... 构建 prompt ...
    if self.language_instruction:
        prompt = prompt + "\n\n" + self.language_instruction
    return prompt
```

#### 其他已注入的路由

`agent_routes.py` 中的大部分路由处理函数都已正确调用 `get_language_instruction(mode=...)` 并传入对应 Agent 构造函数。

### 2.3 `agent_language.py` 的两种模式

| 模式 | 适用场景 | 特点 |
|------|---------|------|
| `"full"` | 文本型 Agent（ChartInsight、InteractiveExplore、ReportGen 等） | 详细的逐字段规则，区分用户可见字段和内部字段 |
| `"compact"` | 代码生成 Agent（DataRec、DataTransformation、DataLoad） | 简短 3 句话指令，避免干扰模型生成代码 |

支持 20 种语言（en、zh、ja、ko、fr、de 等），当语言为 `"en"` 时返回空字符串（无需注入）。

---

## 3. 遗漏分析

### 3.1 `agent_routes.py` — 工作区命名（需修复）

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

**问题**：工作区名称直接展示在 UI 中，应跟随用户界面语言。当前未注入语言指令，中文用户会看到英文工作区名称。

**影响级别**：中 — 用户可见，体验不一致。

### 3.2 `agent_routes.py` — 健康检查（无需修复）

```python
# L227-230
messages=[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Respond 'I can hear you.' if you can hear me. Do not say anything other than 'I can hear you.'"},
]
```

**分析**：这是 `/test-model` 的连通性测试，期望固定返回 `"I can hear you."`。不应注入语言指令，原因：

- 返回内容不面向最终用户展示
- 注入语言指令会增加无意义的 token 消耗
- 如果 LLM 遵从语言指令返回中文，可能导致连通性判断逻辑异常

**影响级别**：无 — 无需修改。

### 3.3 `agent_utils.py` — 补充代码生成（无需修复）

```python
# L243-247
supp_resp = client.get_completion(messages=[
    *messages,
    {"role": "assistant", "content": assistant_content},
    {"role": "user", "content": prompt},
])
```

**分析**：`messages` 列表从上游 Agent 传入，上游 Agent 在构造 system prompt 时已注入了 `language_instruction`。因此补充生成继承了上游的语言指令，无需重复注入。

**影响级别**：无 — 无需修改。

---

## 4. 修复方案

### 4.1 修复工作区命名（唯一需要修改的地方）

复用现有的 `get_language_instruction()` 函数，使用 `mode="compact"` 模式（因为工作区名称是短文本）：

```python
# agent_routes.py — workspace_summary()

lang_instruction = get_language_instruction(mode="compact")
lang_suffix = f"\n\n{lang_instruction}" if lang_instruction else ""

messages = [
    {
        "role": "system",
        "content": (
            "You are a helpful assistant. Generate a very short name (3-5 words) "
            "for a data analysis workspace based on the context below. "
            "Return ONLY the name, no quotes, no explanation."
            + lang_suffix
        ),
    },
    {"role": "user", "content": context_str},
]
```

**注意**：`get_language_instruction()` 在 `lang == "en"` 时返回空字符串，所以英文用户不会受影响。

### 4.2 不需要新建 `MessageBuilder` 或全局拦截

现有架构已经提供了完整的语言注入体系：

- `agent_language.py` 管理语言模板和生成逻辑
- `get_language_instruction()` 从请求 header 解析语言
- 各 Agent 构造函数接收 `language_instruction` 参数

**不建议**引入 `MessageBuilder` 工具类或 LLMClient 全局拦截，原因：

| 方案 | 问题 |
|------|------|
| `MessageBuilder` + 环境变量 | 语言来源从 per-request（`Accept-Language` header）退化为 per-process（环境变量），破坏多用户场景 |
| LLMClient 全局拦截 | 隐式修改 system prompt 导致调试困难；字符串检测 `"**Language Requirement:**"` 脆弱；无法区分 full/compact 模式 |

---

## 5. 防止未来遗漏的建议

### 5.1 开发规范

每次新增 LLM 调用点时，开发者应检查：

1. 该调用的输出是否面向用户展示？
2. 如果是，是否调用了 `get_language_instruction()` 并注入到 system prompt 中？
3. 选择正确的 mode：文本型用 `"full"`，短文本/代码型用 `"compact"`

### 5.2 测试验证

实施完成后验证以下场景：

- [ ] 新建工作区时生成的名称跟随 UI 语言
- [ ] 数据推荐 Agent 的代码注释和说明跟随 UI 语言
- [ ] 数据转换 Agent 的解释说明跟随 UI 语言
- [ ] 数据探索 Agent 的交互内容跟随 UI 语言
- [ ] 英文用户不受影响（`build_language_instruction("en")` 返回 `""`）

---

## 6. 相关文件

| 文件路径 | 说明 |
|---------|------|
| `py-src/data_formulator/agents/agent_language.py` | 语言指令构建核心模块（模板、模式、多语言支持） |
| `py-src/data_formulator/agent_routes.py` | 路由层：`get_language_instruction()` + 各端点调用 |
| `py-src/data_formulator/agents/data_agent.py` | 数据探索 Agent（已有语言注入） |
| `py-src/data_formulator/agents/agent_data_rec.py` | 数据推荐 Agent（已有语言注入） |
| `py-src/data_formulator/agents/agent_data_transform.py` | 数据转换 Agent（已有语言注入） |
| `py-src/data_formulator/agents/agent_utils.py` | 补充代码生成工具（继承上游语言指令） |
| `src/app/utils.tsx` | 前端：`getAgentLanguage()` + `fetchWithIdentity()` |
| `src/i18n/index.ts` | 前端 i18n 配置（i18next + LanguageDetector） |

---

## 7. 附录：`agent_language.py` 架构说明

### 语言注册表

`LANGUAGE_DISPLAY_NAMES` 定义了 20 种语言的显示名称，用于生成提示词中的语言标识。

### 特定语言的额外规则

`LANGUAGE_EXTRA_RULES` 为特定语言提供补充说明（如中文要求使用简体中文、日文要求使用敬体）。

### 输出逻辑

- 当 `language == "en"` 时，返回空字符串（不注入任何语言指令）
- 当 `language != "en"` 时，根据 `mode` 参数返回 full 或 compact 格式的语言指令
- full 模式详细列出哪些字段用目标语言、哪些字段保持英文
- compact 模式仅用 3 句话说明基本规则，适合代码生成场景
