# 多语言（i18n）规范化开发计划

> 编号：design-doc-7 | 创建：2026-04-12 | 更新：2026-04-23 | 状态：实施中 v3（Phase 1-5 已完成）

---

## 0. 背景与动机

项目已建立了 `agent_language.py` 作为 LLM 提示词多语言注入的核心模块，并在 `agent_routes.py` 中通过 `get_language_instruction()` 从 `Accept-Language` header 读取用户语言。然而：

1. **调用覆盖不完整** — 部分 Agent 路由遗漏了语言注入（如 `workspace-summary`、`sort-data`）
2. **注入方式不统一** — 各 Agent 以不同方式拼接 language_instruction（有的用 marker 定位插入、有的直接追加到末尾），没有统一的接口约束
3. **前端只支持 en/zh** — `agent_language.py` 注册了 20 种语言，但前端 i18n 翻译文件只有 `en` 和 `zh` 两组
4. **缺少自动化保障** — 没有 lint 规则或单元测试来防止新的 LLM 调用点遗漏语言注入
5. **已有规范文档分散** — Cursor rule、SKILL.md、design-doc-3 分别有一些约定，但开发者容易遗漏
6. **Agent 内部硬编码英文** — `language_instruction` 只能约束 LLM 生成内容，但 Agent 内部大量 Python 硬编码的用户可见消息（错误提示、clarify 选项、completion summary 等）始终为英文
7. **前端硬编码英文文案** — 约 20+ 个组件文件未接入 `useTranslation`，已接入的文件中也有遗漏
8. **后端 HTTP 响应英文** — `routes/tables.py`、`routes/agents.py` 中约 50+ 处 `jsonify(message="...")` 硬编码英文

本文档定义一个系统性的规范化方案，确保多语言处理有统一的模式、完整的覆盖和可持续的质量保障。

---

## 1. 现状审计

### 1.1 后端 Agent 语言注入覆盖表

| Agent 类 | 文件 | 接收 `language_instruction` | 路由注入 | mode | 状态 |
|----------|------|:---:|:---:|------|------|
| `DataRecAgent` | `agent_data_rec.py` | ✅ | ✅ `derive-data` | compact | **正常** |
| `DataTransformationAgent` | `agent_data_transform.py` | ✅ | ✅ `derive-data` / `refine-data` | compact | **正常** |
| `DataAgent` | `data_agent.py` | ✅ | ✅ `data-agent-streaming` | full + compact(rec) | **正常**（见 1.2.3） |
| `DataLoadAgent` | `agent_data_load.py` | ✅ | ✅ `process-data-on-load` | compact | **正常** |
| `DataCleanAgentStream` | `agent_data_clean_stream.py` | ✅ | ✅ `clean-data-stream` | full | **正常** |
| `CodeExplanationAgent` | `agent_code_explanation.py` | ✅ | ✅ `code-expl` | full | **正常** |
| `ChartInsightAgent` | `agent_chart_insight.py` | ✅ | ✅ `chart-insight` | full | **正常** |
| `InteractiveExploreAgent` | `agent_interactive_explore.py` | ✅ | ✅ `get-recommendation-questions` | full | **正常** |
| `ReportGenAgent` | `agent_report_gen.py` | ✅ | ✅ `generate-report-stream` | full | **正常** |
| `DataLoadingChatAgent` | `agent_data_loading_chat.py` | ✅ | ✅ `data-loading-chat` | full | **正常** |
| `SortDataAgent` | `agent_sort_data.py` | ❌ | ❌ `sort-data` | — | **⚠️ 遗漏** |
| `SimpleAgents.workspace_summary` | `agent_simple.py` | ❌ | ❌ `workspace-summary` | — | **⚠️ 遗漏** |
| `SimpleAgents.nl_to_filter` | `agent_simple.py` | ❌ | ❌ `nl-to-filter` | — | **⚠️ 遗漏（低优）** |
| *(inline)* test-model | `agents.py` L188-227 | — | ❌ | — | **无需注入** |

### 1.2 遗漏详情

#### 1.2.1 SortDataAgent（`sort-data` 路由）

`SortDataAgent.__init__()` 不接收 `language_instruction` 参数，路由处理也未调用 `get_language_instruction()`。虽然排序结果本身是数据值的重排列（不涉及翻译），但返回的 `reason` 字段是面向用户的自然语言文本，应该跟随 UI 语言。

**影响级别**：低 — `reason` 字段在 UI 中显示但不是核心功能文本。

#### 1.2.2 workspace-summary 路由

工作区名称直接展示在侧边栏，但 `_WORKSPACE_SUMMARY_SYSTEM_PROMPT` 中未注入语言指令，写死了 "Generate a very short name (3-5 words)"。中文用户会看到英文的工作区名称。

**影响级别**：高 — 用户每次打开应用都会看到，是最直观的遗漏。

#### 1.2.3 DataAgent `rec_language_instruction` 废代码

`data-agent-streaming` 路由同时构造 `language_instruction`（full）和 `rec_language_instruction`（compact），并传入 `DataAgent`。但 `DataAgent.__init__()` 的 `**kwargs` 直接吞掉了 `rec_language_instruction`，**未实际使用**。

```python
# agents.py L506-517
language_instruction = get_language_instruction(mode="full")
rec_language_instruction = get_language_instruction(mode="compact")
agent = DataAgent(
    ...
    language_instruction=language_instruction,
    rec_language_instruction=rec_language_instruction,  # 被 **kwargs 吞掉
)
```

**影响级别**：低 — 功能无影响，但造成代码误导和维护负担。应清理。

#### 1.2.4 SimpleAgents.nl_to_filter

`nl_to_filter` 的 system prompt 为纯英文，返回结构化 JSON。虽然输出主体是 JSON（不直接展示），但如果后续扩展为返回用户可见文案，缺少语言注入会成为隐患。

**影响级别**：低 — 当前输出为纯结构化数据。

### 1.3 注入方式一致性审计

| Agent | 注入方式 | 说明 |
|-------|---------|------|
| `DataRecAgent` | marker 定位插入 (`"You are a data scientist"` 之后) | 策略性插入到 role 声明之后 |
| `DataTransformationAgent` | marker 定位插入 (`"**About the execution environment:**"` 之前) | 策略性插入到技术细节之前 |
| `DataAgent` | `_build_system_prompt()` 末尾追加 | 动态构建 prompt，末尾追加 |
| `DataLoadAgent` | system prompt 末尾追加 | 简单追加 |
| `DataCleanAgentStream` | system prompt 末尾追加 | 简单追加 |
| `CodeExplanationAgent` | system prompt 末尾追加 | 简单追加 |
| `ChartInsightAgent` | system prompt 末尾追加 | 简单追加 |
| `InteractiveExploreAgent` | system prompt 末尾追加 | 简单追加 |
| `ReportGenAgent` | system prompt 末尾追加 | 简单追加 |
| `DataLoadingChatAgent` | 流式拼接到 prompt | 简单追加 |

**结论**：有两种注入策略（marker 定位 vs 末尾追加），两种都是可接受的。marker 策略适用于需要精确控制指令位置的复杂 prompt，末尾追加适用于简单场景。**当前不需要强制统一**，但需要在规范中明确这两种模式的适用条件。

### 1.4 Agent 内部硬编码英文消息审计

> 这是 `language_instruction` **无法覆盖**的盲区。这些消息是 Python 代码中的固定字符串，不是 LLM 生成的内容，但会直接展示给用户。

#### 1.4.1 `data_agent.py` — 用户可见硬编码

| 行号 | 字符串 | 场景 | 严重程度 |
|------|--------|------|----------|
| ~301-304 | `"I've been exploring extensively but haven't reached a conclusion yet.\n\nCompleted steps so far:\n..."` + `"How would you like to proceed?"` | clarify.message（工具轮次耗尽） | **HIGH** |
| ~307-309 | `"Continue exploring"` / `"Simplify the task"` / `"Present what you have so far"` | clarify.options | **HIGH** |
| ~464 | `"Reached the maximum number of exploration steps."` | completion.summary（max_iterations） | **HIGH** |
| ~642-644 | `"Chart encoding fields not found in output DataFrame: {missing}. Available columns: {available}"` | error 事件 | **HIGH** |
| ~651 | `"Output DataFrame is empty (0 rows). Check filters or data loading."` | error 事件 | **HIGH** |
| ~320 | `"LLM API error"` | error 事件 message | **MEDIUM** |
| ~347 | `"Failed to parse agent action from LLM response"` | error 事件 message | **MEDIUM** |
| ~456 | `"Unknown action: {action_type}"` | error 事件 message | **MEDIUM** |
| ~940 | `"LLM returned empty response"` | error 事件 | **MEDIUM** |
| ~409 | `"Unknown error"` | 默认错误回退 | **MEDIUM** |

#### 1.4.2 `agent_data_rec.py` / `agent_data_transform.py` — 用户可见硬编码

| 文件 | 行号 | 字符串 | 严重程度 |
|------|------|--------|----------|
| `agent_data_rec.py` | ~350 | `"No code block found in the response. The model is unable to generate code to complete the task."` | **HIGH** |
| `agent_data_rec.py` | ~347 | `"Unexpected error: {error_message}"` | **MEDIUM** |
| `agent_data_transform.py` | ~250 | `"No code block found in the response. The model is unable to generate code to complete the task."` | **HIGH** |
| `agent_data_transform.py` | ~245 | `"An error occurred during code execution. Error type: {type}, message: {msg}"` | **MEDIUM** |

#### 1.4.3 `agent_data_clean_stream.py` — 用户可见硬编码

| 行号 | 字符串 | 严重程度 |
|------|--------|----------|
| ~233 | `"unable to extract tables from response"` | **HIGH** |

#### 1.4.4 `agent_data_load.py` — 用户可见硬编码

| 行号 | 字符串 | 严重程度 |
|------|--------|----------|
| ~218 | `"unable to extract VegaLite script from response"` | **MEDIUM** |

#### 1.4.5 `agent_data_loading_chat.py` — 用户可见硬编码

| 行号 | 字符串 | 严重程度 |
|------|--------|----------|
| ~261 | `"Error calling model: {e}"` | **HIGH** |

#### 1.4.6 `routes/agents.py` — 路由层用户可见硬编码

| 行号 | 字符串 | 严重程度 |
|------|--------|----------|
| ~82 | `"An unexpected error occurred"` | **HIGH** |
| ~291 | `"this website doesn't allow us to download html from url :("` | **MEDIUM** |
| ~297 | `"unable to process data clean request"` | **HIGH** |
| ~304 | `"Invalid request format"` | **MEDIUM** |
| ~406, ~634 | `"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step..."` | **HIGH**（注入 LLM 的修复指令，应跟随语言） |
| ~500 | `"Identity ID required"` | **MEDIUM** |
| ~568 | `"Invalid request format"` | **MEDIUM** |
| ~696 | `"No explanation generated"` | **MEDIUM** |
| ~701, ~736, ~788, ~847 | `"Invalid request format"`（多处重复） | **MEDIUM** |
| ~731 | `"No insight generated"` | **MEDIUM** |
| ~903-961 | `"No input tables provided"` / `"No transformation code provided"` / `"Missing code_signature"` / `"Code exceeds maximum allowed size"` / `"Invalid code_signature"` / `"Too many input tables (max 50)"` / `"No output_variable provided"` 等（约 10 条） | **MEDIUM** |
| ~987 | `"Successfully refreshed derived data"` | **LOW** |
| ~1016 | `"Unknown error during transformation"` | **MEDIUM** |
| ~1082 | `"No model configured"` | **HIGH** |
| ~1091 | `"Failed to parse LLM response as JSON"` | **MEDIUM** |
| ~1113, ~1117 | `"No file in request"` / `"No filename"` | **MEDIUM** |
| ~1155, ~1158 | `"Access denied"` / `"File not found"` | **MEDIUM** |

#### 1.4.7 `routes/tables.py` — 路由层用户可见硬编码

| 行号 | 字符串 | 严重程度 |
|------|--------|----------|
| ~166 | `"Workspace folder access is only available for local backend"` | **MEDIUM** |
| ~182 | `"Failed to open workspace"` | **MEDIUM** |
| ~376 | `"Table name is required"` | **HIGH** |
| ~417 | `"No file or raw data provided"` | **HIGH** |
| ~421 | `"No table name provided"` | **HIGH** |
| ~430 | `"Unsupported file format"` | **HIGH** |
| ~434 | `"Invalid filename"` | **MEDIUM** |
| ~474 | `"Invalid JSON data — it must be a JSON array of objects"` | **HIGH** |
| ~504, ~509 | `"No file provided"` / `"Unsupported file format"` | **HIGH** |
| ~543 | `"Server-side parsing not supported for {ext}"` | **MEDIUM** |
| ~547 | `"Failed to parse the uploaded file"` | **MEDIUM** |
| ~568-570 | `"table_name is required"` / `"rows is required"` | **HIGH** |
| ~597, ~601 | `"No table name provided"` / `"Table '{name}' does not exist"` | **MEDIUM** |
| ~694, ~697 | `"table_name is required"` / `"delimiter must be ',' or '\\t'"` | **MEDIUM** |
| ~756 | `"No table name provided"` | **HIGH** |
| ~838-853 | `sanitize_db_error_message` 中所有 safe_msg：`"The requested table does not exist"` / `"Query syntax error"` / `"Identity not found, please refresh the page"` / `"An unexpected error occurred"` 等 | **HIGH** |

#### 1.4.8 Agent 内部仅限模型可见的英文字符串（非用户直接可见）

以下字符串在 LLM 对话轨迹中使用，不直接展示给用户，但如果前端暴露了 Agent 日志面板则可能间接可见。当前**不需要国际化**，仅做记录。

| 文件 | 概述 |
|------|------|
| `data_agent.py` | `SYSTEM_PROMPT`（L129-206）、工具 description、`[SYSTEM]` 重试提示、`[FORMAT ERROR]`、`[CODE ERROR]`、`[OBSERVATION]`、`[AVAILABLE TABLES]`、`[USER QUESTION]` 等 |
| `agent_data_rec.py` | `SYSTEM_PROMPT`（L124-168）、`SHARED_*` 常量、`[AGENT CODING RULES]`、`[CONTEXT]`、`[GOAL]` |
| `agent_data_transform.py` | `SYSTEM_PROMPT`、`[CURRENT VISUALIZATION]`、`[EXPECTED VISUALIZATION]` |
| `agent_data_clean_stream.py` | `SYSTEM_PROMPT`（L59-125） |
| `agent_data_load.py` | `SYSTEM_PROMPT`（L17-74）、`EXAMPLES` 块 |
| `agent_data_loading_chat.py` | `SYSTEM_PROMPT`（L33-70）、`TOOLS` 中各 description |
| `agent_simple.py` | `_NL_FILTER_SYSTEM_PROMPT`、`_WORKSPACE_SUMMARY_SYSTEM_PROMPT` |
| `context.py` | `[FOCUSED THREAD]`、`[PRIMARY TABLE]`、`load_hint` 等标签与辅助文本 |

**结论**：这些模型侧英文字符串应保持英文（LLM 对英文指令理解最稳定），国际化通过 `language_instruction` 约束模型输出语言即可。

### 1.5 前端 i18n 覆盖审计

#### 1.5.1 i18n 基础设施

| 层面 | 状态 |
|------|------|
| 框架 | `i18next` + `react-i18next` + `i18next-browser-languagedetector` |
| UI 翻译文件 (locales) | 仅 `en` 和 `zh`（7 个 namespace：common/upload/chart/model/encoding/messages/navigation） |
| `agent_language.py` 语言注册表 | 20 种语言 |
| 前端语言切换器 | 从 Redux `availableLanguages` 动态读取 |
| `fetchWithIdentity()` header | ✅ 正确注入 `Accept-Language` |
| Plugin 翻译 (Superset) | 仅 `en` 和 `zh` |

#### 1.5.2 未接入 i18n 的组件（无 `useTranslation`）

| 优先级 | 文件 | 硬编码密度 | 约需 key 数 | 典型硬编码示例 |
|--------|------|-----------|------------|---------------|
| **HIGH** | `DataLoadingChat.tsx` | 很高 | 45-55 | `"Load table"` / `"Ran Python code"` / `"Data Loading Assistant"` / `"Describe data to extract..."` / `"Extract data from an image"` / 示例 prompt 等 |
| **HIGH** | `TableSelectionView.tsx` | 低 | 4-5 | `"No tables available."` / `"load dataset"` / `"load in new session"` |
| **HIGH** | `ExampleSessions.tsx` | 中 | ~10 | 回退 `exampleSessions` 数组的 title + description（5 组） |
| **MEDIUM** | `DataView.tsx` | 很低 | 2-3 | `"#"` 行号列标题 / `"table"` 回退名 |
| **MEDIUM** | `InteractionEntryCard.tsx` | 低 | 1-4 | `"asked for clarification"` |
| **MEDIUM** | `ChartGallery.tsx` | 很高 | 50+ | `"Copy Spec + VL"` / `"Vega-Lite Spec"` / 错误文案 / 整页画廊文案 |
| **MEDIUM** | `OperatorCard.tsx` | 无静态句 | 0 | — |
| **MEDIUM** | `GallerySidebar.tsx` | 数据驱动 | 0（数据另计） | — |
| **MEDIUM** | `CatalogTree.tsx` | 无 | 0 | — |
| **LOW** | `DataFrameTable.tsx` | — | — | — |
| **LOW** | `ReactTable.tsx` | — | — | — |
| **LOW** | `TiptapReportEditor.tsx` | — | — | — |
| **LOW** | `TestPanel.tsx` | — | — | — |

#### 1.5.3 已接入但仍有遗漏的组件（有 `useTranslation` 但混用硬编码）

| 优先级 | 文件 | 遗漏密度 | 约需补 key 数 | 典型遗漏示例 |
|--------|------|---------|-------------|--------------|
| **HIGH** | `App.tsx` | 中 | 18-22 | `"Failed to open workspace"` / `"Sessions"` / `"Refresh list"` / `"Delete session"` / `"+ New Session"` / `"Loading sessions..."` / `"Close"` / errorElement 长文案 |
| **LOW** | `DataFormulator.tsx` | 低 | 5-7 | `"Opening workspace..."` / `"default"` / `"Importing..."` |
| **LOW** | `UnifiedDataUploadDialog.tsx` | 中 | 12-15 | `CONNECTOR_TYPE_DESCRIPTIONS` 全英文 / `"Failed to create connector"` 等错误 |
| **LOW** | `EncodingBox.tsx` | 低 | 8-15 | DType tooltip（`"quantitative"` 等）/ 聚合函数 `"avg"` |
| **LOW** | `ChatDialog.tsx` | 极低 | 1 | `"SYSTEM"` 角色标签 |

#### 1.5.4 前端 i18n 覆盖率估算

- **已覆盖组件**：约 20 个文件（核心工作流：数据线程、上传、编码、模型选择、报表等）
- **未覆盖组件**：约 15 个文件（数据加载聊天、示例会话、图库、部分工具组件）
- **已覆盖但有缺口**：约 5 个文件
- **总计待补 key 数**：约 **150-200** 个（不含 ChartGallery 的 50+）

### 1.6 其他问题

#### context.py 的 load_hint

`context.py` L116-119 的 `load_hint` 为硬编码英文：
```
To load a table in code: pd.read_parquet('file.parquet') or
duckdb.sql("SELECT * FROM read_parquet('file.parquet')")
Use the exact filename shown above.
```
此文本仅注入 LLM 上下文（非用户可见），**不需要国际化**。

#### web_utils.py 的 Accept-Language

`agents/web_utils.py` 对外请求写死 `'Accept-Language': 'en-US,en;q=0.5'`，与 UI 语言无关。此为爬取外部网页用的 header，**不需要修改**。

---

## 2. 规范化目标

### P0（必须完成）

1. 补齐遗漏的语言注入点（SortDataAgent、workspace-summary）
2. 建立 Agent 基类或 Mixin，统一 `language_instruction` 的接收和注入接口
3. **Agent 内部 HIGH 级别硬编码英文消息国际化**（clarify 选项、error 消息、completion summary）
4. **前端 HIGH 优先级组件 i18n**（DataLoadingChat、TableSelectionView、ExampleSessions、App.tsx 遗漏）
5. 添加单元测试，确保所有 Agent 构造函数支持 `language_instruction`
6. 更新开发者文档，合并分散的约定到一个权威参考文档

### P1（应该完成）

7. 添加 lint 或静态检查规则，检测新增的 LLM 调用点是否注入了语言指令
8. **添加前端 ESLint i18n 检查规则**（防止新代码硬编码文案）
9. 创建语言注入集成测试，模拟不同语言请求验证完整链路
10. 规范 `mode` 选择决策树，让新 Agent 开发者能快速判断
11. 清理 `rec_language_instruction` 废代码
12. **后端 HTTP 响应消息国际化策略**

### P2（锦上添花）

13. 前端 MEDIUM/LOW 优先级组件 i18n 补全
14. 扩展前端翻译覆盖（优先添加 ja、ko、fr、de 等高需求语言）
15. 将 `agent_language.py` 中的模板抽象为配置文件，支持运行时热加载
16. 建立翻译贡献流程（community translation）

---

## 3. 详细方案

### 3.1 Phase 1：补齐 Agent 语言注入遗漏（P0，预计 0.5 天）

#### 3.1.1 SortDataAgent 添加语言支持

```python
# agent_sort_data.py
class SortDataAgent(object):

    def __init__(self, client, language_instruction=""):
        self.client = client
        self.language_instruction = language_instruction

    def run(self, name, values, n=1):
        system_prompt = SYSTEM_PROMPT
        if self.language_instruction:
            system_prompt = system_prompt + "\n\n" + self.language_instruction

        # ... 其余不变 ...
```

```python
# agents.py — sort_data_request()
language_instruction = get_language_instruction(mode="compact")
agent = SortDataAgent(client=client, language_instruction=language_instruction)
```

**mode 选择**：`"compact"` — SortDataAgent 的输出是结构化 JSON，仅 `reason` 字段面向用户，用 compact 模式足够且不干扰排序逻辑。

#### 3.1.2 workspace-summary 添加语言注入

```python
# agent_simple.py — SimpleAgents 添加 language_instruction
class SimpleAgents:
    def __init__(self, client, language_instruction=""):
        self.client = client
        self.language_instruction = language_instruction

    def workspace_summary(self, table_names, user_query=""):
        system_prompt = _WORKSPACE_SUMMARY_SYSTEM_PROMPT
        if self.language_instruction:
            system_prompt = system_prompt + "\n\n" + self.language_instruction
        # ...
```

```python
# agents.py — workspace_summary()
language_instruction = get_language_instruction(mode="compact")
agent = SimpleAgents(client=client, language_instruction=language_instruction)
```

**mode 选择**：`"compact"` — 工作区名称为短文本。

#### 3.1.3 清理 rec_language_instruction 废代码

在 `agents.py` 的 `data_agent_streaming` 路由中移除 `rec_language_instruction` 的构造和传入。在 `DataAgent.__init__` 中移除 `**kwargs` 中的相关注释。

### 3.2 Phase 2：统一 Agent 接口约束（P0，预计 1 天）

#### 3.2.1 定义 Agent 协议（Protocol/ABC）

不强制所有 Agent 继承同一基类（避免大范围重构），而是采用 Python Protocol 约束：

```python
# agents/agent_protocol.py
from typing import Protocol, runtime_checkable

@runtime_checkable
class LanguageAwareAgent(Protocol):
    """Any Agent that receives LLM language instructions must expose this attribute."""
    language_instruction: str
```

#### 3.2.2 统一注入辅助函数

抽取重复的 "追加到 system prompt" 逻辑为公共函数：

```python
# agents/agent_language.py（在 build_language_instruction 之后添加）

def inject_language_instruction(
    system_prompt: str,
    language_instruction: str,
    *,
    marker: str | None = None,
) -> str:
    """Inject language instruction into a system prompt.

    Parameters
    ----------
    system_prompt : str
        The base system prompt.
    language_instruction : str
        The language instruction block (empty string = no-op).
    marker : str | None
        If provided, insert before this marker. Otherwise append.
    """
    if not language_instruction:
        return system_prompt

    if marker:
        idx = system_prompt.find(marker)
        if idx > 0:
            return (
                system_prompt[:idx]
                + language_instruction + "\n\n"
                + system_prompt[idx:]
            )

    return system_prompt + "\n\n" + language_instruction
```

然后各 Agent 统一调用：

```python
from data_formulator.agents.agent_language import inject_language_instruction

# DataTransformationAgent.__init__()
self.system_prompt = inject_language_instruction(
    self.system_prompt, language_instruction,
    marker="**About the execution environment:**"
)

# ChartInsightAgent.__init__()  (简单场景)
system_prompt = inject_language_instruction(system_prompt, self.language_instruction)
```

### 3.3 Phase 3：Agent 内部硬编码消息国际化（P0，预计 1 天）✅ 已完成

> 这是 v1 文档**未覆盖**的关键缺失。`language_instruction` 只能约束 LLM 输出，无法改变 Python 代码中写死的字符串。

#### 3.3.1 方案：message_code 模式（后端加码，前端翻译）

**设计决策**：不在后端做翻译（不建 `agent_messages.py`），而是让后端返回 `message_code` / `content_code` 字段，前端用 `translateBackend()` 统一翻译。

**优势**：
- 所有翻译集中在 `src/i18n/locales/` 目录，和现有前端 i18n 体系完全一致
- 未来加新语言零后端改动
- 后端保持英文 fallback，即使前端未翻译也不会空白

#### 3.3.2 后端模式

Python 侧保留英文字符串作为 fallback，额外添加 `*_code` 和可选的 `*_params` 字段：

```python
# DataAgent streaming events — clarify
yield {
    "type": "clarify",
    "message": "I've been exploring extensively...",
    "message_code": "agent.clarifyExhausted",
    "message_params": {"steps": steps_desc},
    "options": ["Continue exploring", "Simplify the task", "Present what you have so far"],
    "option_codes": ["agent.clarifyOptionContinue", "agent.clarifyOptionSimplify", "agent.clarifyOptionPresent"],
}

# DataAgent streaming events — error
yield self._error_event(
    iteration, "LLM API error",
    message_code="agent.llmApiError",
)

# DataRec/DataTransform results — content error
result = {
    'status': 'error',
    'content': "No code block found in the response...",
    'content_code': 'agent.noCodeBlock',
}
```

#### 3.3.3 前端消费

```typescript
import { translateBackend, translateBackendOptions } from '../app/utils';

// 翻译单条消息
const msg = translateBackend(event.message, event.message_code, event.message_params);

// 翻译选项列表
const options = translateBackendOptions(rawOptions, event.option_codes);
```

翻译 key 存放在 `src/i18n/locales/{en,zh}/messages.json` 的 `messages.agent.*` 下。

#### 3.3.4 已覆盖的 key（第一批 P0）

| Key | 来源 Agent |
|-----|-----------|
| `agent.clarifyExhausted` | DataAgent |
| `agent.clarifyOptionContinue/Simplify/Present` | DataAgent |
| `agent.maxIterationsSummary` | DataAgent |
| `agent.emptyDataframe` | DataAgent |
| `agent.fieldsNotFound` | DataAgent |
| `agent.llmApiError` | DataAgent |
| `agent.parseActionFailed` | DataAgent |
| `agent.unknownAction` | DataAgent |
| `agent.noCodeBlock` | DataRecAgent, DataTransformationAgent |
| `agent.unexpectedError` | DataRecAgent |
| `agent.unableExtractTables` | DataCleanAgentStream |
| `agent.unableExtractScript` | SortDataAgent, DataLoadAgent |

MEDIUM 级别的错误消息（如 `"Invalid request format"` 等）归入 Phase 8 的后端 HTTP 响应国际化。

### 3.4 Phase 4：前端高优先级组件 i18n（P0，预计 2 天）

#### 3.4.1 第一批（HIGH 影响）

| 文件 | 预估 key 数 | 工作内容 |
|------|------------|---------|
| `DataLoadingChat.tsx` | 45-55 | 接入 `useTranslation`，抽取按钮/placeholder/tooltip/示例 prompt/工具标签/错误消息；新建 `dataLoading` namespace 或并入 `messages` |
| `TableSelectionView.tsx` | 4-5 | 接入 `useTranslation`，翻译按钮和空状态 |
| `ExampleSessions.tsx` | ~10 | 示例数据的 title + description 走 i18n key |
| `App.tsx`（补缺口） | 18-22 | 补全未用 `t()` 的工作区对话框文案、错误消息、按钮 |

**新增 namespace 建议**：可新建 `src/i18n/locales/{en,zh}/dataLoading.json` 专门放 DataLoadingChat 的 key（数量多、逻辑独立）。

#### 3.4.2 翻译 key 命名规范

```
<namespace>.<component/feature>.<element>

示例：
dataLoading.toolLabels.readingFile    → "Reading file"
dataLoading.actions.loadTable         → "Load table"
dataLoading.placeholder.describeData  → "Describe data to extract, upload, or generate..."
common.actions.close                  → "Close"
messages.error.failedToOpenWorkspace  → "Failed to open workspace"
```

### 3.5 Phase 5：测试保障（P1，预计 1 天）

#### 3.5.1 单元测试：所有 Agent 支持 language_instruction

```python
# tests/test_language_injection.py
import pytest
from data_formulator.agents.agent_language import (
    build_language_instruction,
    inject_language_instruction,
    LANGUAGE_DISPLAY_NAMES,
)

ALL_AGENTS = [
    ("DataRecAgent", "data_formulator.agents.agent_data_rec", "DataRecAgent"),
    ("DataTransformationAgent", "data_formulator.agents.agent_data_transform", "DataTransformationAgent"),
    ("DataAgent", "data_formulator.agents.data_agent", "DataAgent"),
    ("DataLoadAgent", "data_formulator.agents.agent_data_load", "DataLoadAgent"),
    ("DataCleanAgentStream", "data_formulator.agents.agent_data_clean_stream", "DataCleanAgentStream"),
    ("CodeExplanationAgent", "data_formulator.agents.agent_code_explanation", "CodeExplanationAgent"),
    ("ChartInsightAgent", "data_formulator.agents.agent_chart_insight", "ChartInsightAgent"),
    ("InteractiveExploreAgent", "data_formulator.agents.agent_interactive_explore", "InteractiveExploreAgent"),
    ("ReportGenAgent", "data_formulator.agents.agent_report_gen", "ReportGenAgent"),
    ("SortDataAgent", "data_formulator.agents.agent_sort_data", "SortDataAgent"),
    ("SimpleAgents", "data_formulator.agents.agent_simple", "SimpleAgents"),
]


class TestBuildLanguageInstruction:
    def test_english_returns_empty(self):
        assert build_language_instruction("en") == ""

    def test_non_english_returns_instruction(self):
        result = build_language_instruction("zh")
        assert "[LANGUAGE INSTRUCTION]" in result
        assert "Simplified Chinese" in result

    def test_compact_mode(self):
        full = build_language_instruction("zh", mode="full")
        compact = build_language_instruction("zh", mode="compact")
        assert len(compact) < len(full)

    @pytest.mark.parametrize("lang", [k for k in LANGUAGE_DISPLAY_NAMES if k != "en"])
    def test_all_registered_languages(self, lang):
        result = build_language_instruction(lang)
        assert result != ""
        assert "[LANGUAGE INSTRUCTION]" in result


class TestInjectLanguageInstruction:
    def test_empty_instruction_noop(self):
        prompt = "You are a data scientist."
        assert inject_language_instruction(prompt, "") == prompt

    def test_append_without_marker(self):
        prompt = "You are a data scientist."
        result = inject_language_instruction(prompt, "[LANG]")
        assert result.endswith("[LANG]")

    def test_insert_before_marker(self):
        prompt = "Role description.\n\n**About the execution environment:**\nDetails."
        result = inject_language_instruction(
            prompt, "[LANG]",
            marker="**About the execution environment:**"
        )
        assert result.index("[LANG]") < result.index("**About the execution environment:**")


class TestAgentLanguageParam:
    """Verify each Agent constructor accepts language_instruction."""

    @pytest.mark.parametrize("label,module_path,class_name", ALL_AGENTS)
    def test_constructor_has_language_instruction(self, label, module_path, class_name):
        import importlib, inspect
        mod = importlib.import_module(module_path)
        cls = getattr(mod, class_name)
        sig = inspect.signature(cls.__init__)
        params = list(sig.parameters.keys())
        assert "language_instruction" in params, (
            f"{label}.__init__() missing language_instruction parameter"
        )
```

#### 3.5.2 Agent 消息 i18n 测试

```python
# tests/test_agent_messages.py
from data_formulator.agents.agent_messages import get_msg, _MESSAGES

class TestAgentMessages:
    def test_all_keys_have_en(self):
        for key, translations in _MESSAGES.items():
            assert "en" in translations, f"Key '{key}' missing English translation"

    def test_all_keys_have_zh(self):
        for key, translations in _MESSAGES.items():
            assert "zh" in translations, f"Key '{key}' missing Chinese translation"

    def test_fallback_to_english(self):
        result = get_msg("clarify_option_continue", "fr")
        assert result == "Continue exploring"

    def test_parameterized_message(self):
        result = get_msg("fields_not_found", "en", missing="a, b", available="x, y, z")
        assert "a, b" in result
        assert "x, y, z" in result
```

#### 3.5.3 路由层集成测试

```python
# tests/test_route_language_injection.py
"""Verify that all user-facing agent routes call get_language_instruction()."""

ROUTES_NEEDING_LANGUAGE = [
    "process-data-on-load",
    "clean-data-stream",
    "derive-data",
    "refine-data",
    "data-agent-streaming",
    "data-loading-chat",
    "code-expl",
    "chart-insight",
    "get-recommendation-questions",
    "generate-report-stream",
    "sort-data",
    "workspace-summary",
]

ROUTES_EXEMPT = [
    "test-model",
    "list-global-models",
    "check-available-models",
    "refresh-derived-data",
]
```

### 3.6 Phase 6：自动化约束与 CI 保障（P1，预计 1 天）

> 这是**约束其他开发者**的核心机制。

#### 3.6.1 后端：自定义 lint 脚本

```python
# scripts/check_language_injection.py
"""CI check: verify all user-facing LLM calls in agent routes inject language."""

import ast, sys

EXEMPT_FUNCTIONS = {"test_model", "check_available_models", "list_global_models"}

# 解析 AST，对每个路由函数检查是否包含 get_language_instruction 调用
# ...
```

#### 3.6.2 前端：ESLint i18n 规则

安装 `eslint-plugin-i18next`，在前端 ESLint 配置中添加规则：

```json
{
  "plugins": ["i18next"],
  "rules": {
    "i18next/no-literal-string": ["warn", {
      "ignoreAttribute": [
        "data-testid", "className", "style", "sx", "key",
        "variant", "color", "size", "component", "role",
        "aria-label", "href", "src", "alt"
      ],
      "ignoreCallee": [
        "console.log", "console.warn", "console.error",
        "logger.info", "logger.warn", "logger.error"
      ],
      "ignoreProperty": [
        "fontFamily", "fontWeight", "display", "position"
      ]
    }]
  }
}
```

**说明**：初始设为 `warn`（避免阻断现有代码提交），逐步修复后升级为 `error`。新文件建议立即启用 `error`。

#### 3.6.3 Pre-commit Hook

```yaml
# .pre-commit-config.yaml (追加)
- repo: local
  hooks:
    - id: check-language-injection
      name: Check language injection in agent routes
      entry: python scripts/check_language_injection.py
      language: python
      files: agent_routes\.py$

    - id: check-i18n-strings
      name: Check frontend i18n strings
      entry: npx eslint --rule '{"i18next/no-literal-string": "error"}'
      language: node
      files: src/.*\.(tsx|ts)$
      pass_filenames: true
```

#### 3.6.4 PR Review 检查清单（纳入 PR 模板）

```markdown
## i18n 检查清单

### 后端
- [ ] 新增 Agent 构造函数是否接收 `language_instruction` 参数？
- [ ] 路由是否调用 `get_language_instruction(mode=...)` 并传入 Agent？
- [ ] mode 选择是否正确（full vs compact）？
- [ ] 是否使用了 `inject_language_instruction()` 辅助函数？
- [ ] 用户可见的固定消息是否使用 `get_msg()` 而非硬编码？
- [ ] 是否有硬编码的语言字符串（如 `"回答请使用中文"`）？

### 前端
- [ ] 新增用户可见文案是否使用 `t()`？
- [ ] 新增 key 是否同步添加到 en + zh 翻译文件？
- [ ] 是否避免了在组件中硬编码 Chinese/English 字符串？
```

### 3.7 Phase 7：开发者规范文档整合（P1，预计 0.5 天）

将 `design-docs/3-language-injection-analysis.md`、`.cursor/rules/language-injection-conventions.mdc`、`.cursor/skills/language-injection/SKILL.md` 的核心约定整合为一个权威参考，避免信息分散。

#### 3.7.1 核心决策树：新增 LLM 调用点

```
新增 LLM 调用 → 输出是否面向用户展示？
    │
    ├── 否（健康检查、内部工具调用、日志）
    │   └── ✅ 不需要注入语言指令
    │
    └── 是
        ├── 是否为独立 Agent 类？
        │   ├── 是 → 构造函数添加 language_instruction="" 参数
        │   │       使用 inject_language_instruction() 注入到 system prompt
        │   │       在路由中调用 get_language_instruction(mode=?) 传入
        │   │
        │   └── 否（内联 LLM 调用）
        │       └── 直接在路由中拼接到 system prompt
        │
        └── mode 选择：
            ├── 输出主要是自然语言文本 → mode="full"
            │   （ChartInsight、Report、Explore、CodeExplanation、DataClean、DataLoadingChat）
            │
            └── 输出主要是代码/结构化 JSON → mode="compact"
                （DataRec、DataTransform、DataLoad、Sort、workspace-summary）
```

#### 3.7.2 核心决策树：新增 Python 固定消息

```
新增 Python 固定字符串 → 是否展示给用户？
    │
    ├── 否（日志、LLM 轨迹、内部标签）
    │   └── ✅ 保持英文
    │
    └── 是（error message、clarify 选项、summary、toast 等）
        └── 使用 get_msg(key, lang) 从 agent_messages.py 获取
            在路由/Agent 中传入 ui_lang = _get_ui_lang()
```

#### 3.7.3 核心决策树：新增前端文案

```
新增 JSX/TSX 中的字符串 → 是否用户可见？
    │
    ├── 否（console.log、data-testid、CSS 类名）
    │   └── ✅ 保持硬编码
    │
    └── 是（按钮、tooltip、placeholder、错误、标题、空状态等）
        └── 使用 t('namespace.key') 翻译
            新 key 同步添加到 en + zh JSON
```

### 3.8 Phase 8：后端 HTTP 响应消息国际化（P2，预计 1 天）

#### 3.8.1 方案选择

**方案 A（推荐）：前端根据 error code 翻译**

后端返回结构化错误码 + 默认英文 message，前端根据 code 查找翻译：

```python
# 后端
return jsonify({"status": "error", "code": "TABLE_NAME_REQUIRED", "message": "No table name provided"}), 400
```

```tsx
// 前端
const errorMsg = t(`errors.${response.code}`, { defaultValue: response.message });
```

**方案 B：后端直接返回翻译后消息**

后端读取 `Accept-Language` 后用 `get_msg()` 返回对应语言消息。

**推荐方案 A**——HTTP 错误消息的国际化通常由前端负责更合理：避免后端 `jsonify` 处处传 `lang`；前端已有完整的 i18n 框架。只有在 streaming 事件（无法二次处理）的场景才需要后端直接返回翻译消息。

#### 3.8.2 实施步骤

1. 在后端错误响应中统一添加 `code` 字段（语义化英文常量）
2. 前端创建 `src/i18n/locales/{en,zh}/errors.json`
3. 前端 `fetchWithIdentity` 的错误处理逻辑中自动翻译

### 3.9 Phase 9：前端中低优先级组件 i18n（P2，按需）

| 文件 | 预估 key 数 | 说明 |
|------|------------|------|
| `DataFormulator.tsx` | 5-7 | 加载状态、默认名等 |
| `UnifiedDataUploadDialog.tsx` | 12-15 | 连接器描述、错误消息 |
| `EncodingBox.tsx` | 8-15 | DType tooltip、聚合函数 |
| `InteractionEntryCard.tsx` | 1-4 | clarify 标签 |
| `DataView.tsx` | 2-3 | 行号/回退名 |
| `ChartGallery.tsx` | 50+ | 整页画廊（建议单独里程碑） |
| `ChatDialog.tsx` | 1 | `"SYSTEM"` 角色标签 |

### 3.10 Phase 10：前端翻译扩展（P2，按需）

#### 3.10.1 优先扩展的语言

根据 `agent_language.py` 注册表和用户需求，推荐优先级：

| 优先级 | 语言 | 理由 |
|--------|------|------|
| 1 | ja (日语) | 东亚高活跃用户群 |
| 2 | ko (韩语) | 东亚高活跃用户群 |
| 3 | fr (法语) | 欧洲及非洲广泛使用 |
| 4 | de (德语) | 欧洲技术社区活跃 |
| 5 | es (西班牙语) | 全球第二大母语人口 |

#### 3.10.2 翻译文件结构

每种新语言需要：

```
src/i18n/locales/<lang>/
├── common.json
├── upload.json
├── chart.json
├── model.json
├── encoding.json
├── messages.json
├── navigation.json
├── dataLoading.json      ← Phase 4 新增
├── errors.json           ← Phase 8 新增
└── index.ts
```

加上 `i18n/index.ts` 和 `i18n/locales/index.ts` 的注册。

---

## 4. 实施计划

| Phase | 内容 | 优先级 | 预估工期 | 前置依赖 |
|-------|------|--------|---------|---------|
| **Phase 1** | 补齐 SortDataAgent、workspace-summary、清理 rec_language_instruction 废代码 | P0 | 0.5 天 | 无 |
| **Phase 2** | 定义 `inject_language_instruction()` 辅助函数；重构各 Agent 统一调用 | P0 | 1 天 | Phase 1 |
| **Phase 3** | Agent 内部硬编码消息国际化（`agent_messages.py`，HIGH 级别约 15-20 key） | P0 | 1.5 天 | Phase 1 |
| **Phase 4** | 前端高优先级组件 i18n（DataLoadingChat、TableSelectionView、ExampleSessions、App.tsx 补缺口） | P0 | 2 天 | 无 |
| **Phase 5** | 单元测试 + Agent 消息测试 + 路由集成测试 | P1 | 1 天 | Phase 2, 3 |
| **Phase 6** | 自动化约束：ESLint i18n 规则 + CI 脚本 + pre-commit hook + PR 模板 | P1 | 1 天 | Phase 4, 5 |
| **Phase 7** | 整合开发者规范文档，更新 Cursor rule 和 SKILL | P1 | 0.5 天 | Phase 2, 3 |
| **Phase 8** | 后端 HTTP 响应消息国际化（error code + 前端翻译） | P2 | 1 天 | Phase 4 |
| **Phase 9** | 前端中低优先级组件 i18n | P2 | 2 天 | Phase 4 |
| **Phase 10** | 前端翻译扩展（ja、ko、fr 等） | P2 | 按需 | Phase 4 |

**总计 P0**：约 5 天 | **P1**：约 2.5 天 | **P2**：约 3+ 天

---

## 5. 三层防御体系

```
┌─────────────────────────────────────────────────┐
│  第 1 层：开发时 — Cursor Rules + SKILL         │
│  · language-injection-conventions.mdc           │
│  · i18n-no-hardcoded-strings.mdc                │
│  · AI 协作者自动遵循规范                          │
├─────────────────────────────────────────────────┤
│  第 2 层：提交时 — Pre-commit Hooks              │
│  · ESLint i18next/no-literal-string             │
│  · scripts/check_language_injection.py          │
│  · 阻止不合规代码进入仓库                         │
├─────────────────────────────────────────────────┤
│  第 3 层：合并时 — CI + PR Review                │
│  · GitHub Actions 运行静态检查                   │
│  · PR 模板强制 i18n 检查清单                     │
│  · 单元测试验证所有 Agent 支持 language_instruction│
└─────────────────────────────────────────────────┘
```

---

## 6. 反模式清单（明确禁止）

| 反模式 | 为什么不行 | 正确做法 |
|--------|-----------|---------|
| 使用环境变量 `os.environ.get("DF_DEFAULT_LANGUAGE")` | 退化为 per-process 语言，破坏多用户场景 | 始终从 `Accept-Language` header 读取 |
| 在 LLM client 层做全局拦截注入 | 隐式行为、无法区分 full/compact mode、调试困难 | 在路由层显式注入 |
| 硬编码语言字符串 `"回答请使用中文"` | 不可配置、不支持其他语言 | 使用 `build_language_instruction()` |
| 新建 `MessageBuilder` 工具类 | 与 `agent_language.py` 形成并行抽象，增加维护成本 | 复用现有 `inject_language_instruction()` |
| 在 user message 中注入语言指令 | 与 OpenAI 最佳实践相悖（系统指令应在 system prompt） | 只在 system prompt 中注入 |
| 跳过 `get_language_instruction()` 直接调用 `build_language_instruction()` | 绕过了从 request header 读取语言的标准链路 | 在路由中使用 `get_language_instruction(mode=...)` |
| 前端组件中直接写中文或英文文案 | 不可切换语言 | 使用 `t('namespace.key')` |
| Agent 内部用户可见消息写死英文 | 非英文用户看到混合语言界面 | 使用 `get_msg(key, lang)` |

---

## 7. 风险与注意事项

| 风险 | 缓解措施 |
|------|---------|
| Phase 2 重构可能引入 system prompt 格式变化 | 通过对比测试确保重构前后生成的 prompt 内容一致 |
| Phase 3 `agent_messages.py` 增加维护负担 | 仅收纳 HIGH 级别消息，总数控制在 20-30 key |
| Phase 4 前端大量 key 需要中文翻译 | 可借助 LLM 辅助翻译初稿，人工 review |
| ESLint i18n 规则对现有代码产生大量 warning | 初始设为 warn，只对新文件/修改行 enforce |
| 新增语言翻译质量难以保证 | 建立 community review 流程，先覆盖高需求语言 |
| compact mode 下语言指令过简导致 LLM 不遵从 | 对各语言进行 A/B 测试，必要时调整 compact 模板 |
| SortDataAgent 注入语言后 LLM 排序行为变化 | 排序测试用例覆盖中文、日文等非拉丁文字数据 |
| `agent_messages.py` 与前端 i18n 翻译不一致 | 在规范中明确：两者独立维护，不共享 key；用自动化测试验证双语完整性 |

---

## 8. 相关文件索引

| 文件 | 角色 |
|------|------|
| `py-src/data_formulator/agents/agent_language.py` | 语言指令构建核心模块 |
| `py-src/data_formulator/agents/agent_messages.py` | **待创建**：Agent 内部用户可见消息 i18n |
| `py-src/data_formulator/routes/agents.py` | 路由层：`get_language_instruction()` + 各端点调用 |
| `py-src/data_formulator/routes/tables.py` | 路由层：表操作端点（大量待国际化错误消息） |
| `py-src/data_formulator/agents/agent_sort_data.py` | **待修复**：缺少 language_instruction |
| `py-src/data_formulator/agents/agent_simple.py` | **待修复**：workspace-summary 缺少语言注入 |
| `py-src/data_formulator/agents/data_agent.py` | 含最多 HIGH 级别硬编码英文消息 |
| `py-src/data_formulator/agents/agent_data_rec.py` | 含 "No code block found" 等硬编码 |
| `py-src/data_formulator/agents/agent_data_transform.py` | 含 "No code block found" 等硬编码 |
| `py-src/data_formulator/agents/agent_data_clean_stream.py` | 含 "unable to extract tables" 硬编码 |
| `src/app/utils.tsx` | 前端：`getAgentLanguage()` + `fetchWithIdentity()` |
| `src/i18n/index.ts` | 前端 i18n 配置 |
| `src/i18n/locales/` | 前端翻译文件（当前仅 en/zh） |
| `src/views/DataLoadingChat.tsx` | **待国际化**：最大硬编码密度的前端组件 |
| `src/views/TableSelectionView.tsx` | **待国际化** |
| `src/views/ExampleSessions.tsx` | **待国际化** |
| `src/app/App.tsx` | **待补缺口**：已部分国际化 |
| `.cursor/rules/language-injection-conventions.mdc` | Cursor 开发规范（后端） |
| `.cursor/rules/i18n-no-hardcoded-strings.mdc` | Cursor 开发规范（前端） |
| `.cursor/skills/language-injection/SKILL.md` | 详细架构说明 |
| `design-docs/3-language-injection-analysis.md` | 早期分析文档（本文档是其后续） |
| `scripts/check_language_injection.py` | **待创建**：CI 静态检查脚本 |

---

## 9. 验收标准

### Phase 1-4（P0）完成后

- [ ] `build_language_instruction()` 对所有 20 种注册语言返回非空指令
- [ ] 所有 Agent 构造函数均接受 `language_instruction` 参数
- [ ] 所有面向用户的路由端点均调用 `get_language_instruction()`
- [ ] SortDataAgent 返回的 `reason` 字段跟随 UI 语言
- [ ] workspace-summary 返回的名称跟随 UI 语言
- [ ] 英文用户不受影响（`build_language_instruction("en")` 返回 `""`）
- [ ] `inject_language_instruction()` 辅助函数被所有 Agent 使用
- [ ] `rec_language_instruction` 废代码已清理
- [ ] DataAgent 的 clarify 选项、completion summary 跟随 UI 语言
- [ ] "No code block found" 等高频错误消息跟随 UI 语言
- [ ] DataLoadingChat、TableSelectionView、ExampleSessions 全面使用 `t()`
- [ ] App.tsx 工作区对话框文案全面使用 `t()`
- [ ] `agent_messages.py` 的所有 key 均有 en + zh 翻译

### Phase 5-7（P1）完成后

- [ ] 所有 Agent 有 `language_instruction` 参数的单元测试
- [ ] `agent_messages.py` 所有 key 有双语完整性测试
- [ ] ESLint `i18next/no-literal-string` 规则已启用（warn 级别）
- [ ] `scripts/check_language_injection.py` 能检测新增未注入语言的 LLM 调用点
- [ ] Pre-commit hook 已配置
- [ ] PR review 检查清单已纳入团队流程
- [ ] 开发者规范文档已整合，Cursor rule 和 SKILL 已更新
- [ ] 静态检查脚本能检测到新增的未注入语言的 LLM 调用点

---

## 附录 A：变更历史

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-04-12 | v1 草案 | 初始版本：Agent 语言注入审计 + 统一接口 + 测试保障 |
| 2026-04-23 | v2 草案 | 全面扩展：新增 Agent 内部硬编码消息审计（§1.4）；新增前端组件级 i18n 审计（§1.5）；新增后端 HTTP 响应审计（§1.4.6-1.4.7）；新增 `agent_messages.py` 方案（§3.3）；新增前端组件 i18n 计划（§3.4/3.9）；新增 ESLint i18n 规则（§3.6.2）；新增三层防御体系（§5）；新增后端 HTTP 响应国际化方案（§3.8）；更新实施计划为 10 个 Phase；补充 DataLoadingChatAgent 和 nl_to_filter 到覆盖表 |
