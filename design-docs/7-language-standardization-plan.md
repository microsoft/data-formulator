# 多语言（i18n）规范化开发计划

> 编号：design-doc-7 | 创建：2026-04-12 | 状态：草案

---

## 0. 背景与动机

项目已建立了 `agent_language.py` 作为 LLM 提示词多语言注入的核心模块，并在 `agent_routes.py` 中通过 `get_language_instruction()` 从 `Accept-Language` header 读取用户语言。然而：

1. **调用覆盖不完整** — 部分 Agent 路由遗漏了语言注入（如 `workspace-summary`、`sort-data`）
2. **注入方式不统一** — 各 Agent 以不同方式拼接 language_instruction（有的用 marker 定位插入、有的直接追加到末尾），没有统一的接口约束
3. **前端只支持 en/zh** — `agent_language.py` 注册了 20 种语言，但前端 i18n 翻译文件只有 `en` 和 `zh` 两组
4. **缺少自动化保障** — 没有 lint 规则或单元测试来防止新的 LLM 调用点遗漏语言注入
5. **已有规范文档分散** — Cursor rule、SKILL.md、design-doc-3 分别有一些约定，但开发者容易遗漏

本文档定义一个系统性的规范化方案，确保多语言处理有统一的模式、完整的覆盖和可持续的质量保障。

---

## 1. 现状审计

### 1.1 后端 Agent 语言注入覆盖表

| Agent 类 | 文件 | 接收 `language_instruction` | 路由注入 | mode | 状态 |
|----------|------|:---:|:---:|------|------|
| `DataRecAgent` | `agent_data_rec.py` | ✅ | ✅ `derive-data` | compact | **正常** |
| `DataTransformationAgent` | `agent_data_transform.py` | ✅ | ✅ `derive-data` / `refine-data` | compact | **正常** |
| `DataAgent` | `data_agent.py` | ✅ | ✅ `data-agent-streaming` | full + compact(rec) | **正常** |
| `DataLoadAgent` | `agent_data_load.py` | ✅ | ✅ `process-data-on-load` | compact | **正常** |
| `DataCleanAgentStream` | `agent_data_clean_stream.py` | ✅ | ✅ `clean-data-stream` | full | **正常** |
| `CodeExplanationAgent` | `agent_code_explanation.py` | ✅ | ✅ `code-expl` | full | **正常** |
| `ChartInsightAgent` | `agent_chart_insight.py` | ✅ | ✅ `chart-insight` | full | **正常** |
| `InteractiveExploreAgent` | `agent_interactive_explore.py` | ✅ | ✅ `get-recommendation-questions` | full | **正常** |
| `ReportGenAgent` | `agent_report_gen.py` | ✅ | ✅ `generate-report-stream` | full | **正常** |
| `SortDataAgent` | `agent_sort_data.py` | ❌ | ❌ `sort-data` | — | **⚠️ 遗漏** |
| *(inline)* workspace-summary | `agent_routes.py` L992-1046 | — | ❌ | — | **⚠️ 遗漏** |
| *(inline)* test-model | `agent_routes.py` L188-227 | — | ❌ | — | **无需注入**（非用户可见） |

### 1.2 遗漏详情

#### SortDataAgent（`sort-data` 路由）

`SortDataAgent.__init__()` 不接收 `language_instruction` 参数，路由处理也未调用 `get_language_instruction()`。虽然排序结果本身是数据值的重排列（不涉及翻译），但返回的 `reason` 字段是面向用户的自然语言文本，应该跟随 UI 语言。

**影响级别**：低 — `reason` 字段在 UI 中显示但不是核心功能文本。

#### workspace-summary 路由

工作区名称直接展示在侧边栏，但 system prompt 中未注入语言指令。中文用户会看到英文的工作区名称。

**影响级别**：中 — 用户每次打开应用都会看到。

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

**结论**：有两种注入策略（marker 定位 vs 末尾追加），两种都是可接受的。marker 策略适用于需要精确控制指令位置的复杂 prompt，末尾追加适用于简单场景。**当前不需要强制统一**，但需要在规范中明确这两种模式的适用条件。

### 1.4 前端 i18n 覆盖

| 层面 | 状态 |
|------|------|
| UI 翻译文件 (locales) | 仅 `en` 和 `zh` |
| `agent_language.py` 语言注册表 | 20 种语言 |
| 前端语言切换器 | 从 Redux `availableLanguages` 动态读取 |
| `fetchWithIdentity()` header | ✅ 正确注入 `Accept-Language` |
| Plugin 翻译 (Superset) | 仅 `en` 和 `zh` |

---

## 2. 规范化目标

### P0（必须完成）
1. 补齐遗漏的语言注入点（SortDataAgent、workspace-summary）
2. 建立 Agent 基类或 Mixin，统一 `language_instruction` 的接收和注入接口
3. 添加单元测试，确保所有 Agent 构造函数支持 `language_instruction`
4. 更新开发者文档，合并分散的约定到一个权威参考文档

### P1（应该完成）
5. 添加 lint 或静态检查规则，检测新增的 LLM 调用点是否注入了语言指令
6. 创建语言注入集成测试，模拟不同语言请求验证完整链路
7. 规范 `mode` 选择决策树，让新 Agent 开发者能快速判断

### P2（锦上添花）
8. 扩展前端翻译覆盖（优先添加 ja、ko、fr、de 等高需求语言）
9. 将 `agent_language.py` 中的模板抽象为配置文件，支持运行时热加载
10. 建立翻译贡献流程（community translation）

---

## 3. 详细方案

### 3.1 Phase 1：补齐遗漏（P0，预计 0.5 天）

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
# agent_routes.py — sort_data_request()
language_instruction = get_language_instruction(mode="compact")
agent = SortDataAgent(client=client, language_instruction=language_instruction)
```

**mode 选择**：`"compact"` — SortDataAgent 的输出是结构化 JSON，仅 `reason` 字段面向用户，用 compact 模式足够且不干扰排序逻辑。

#### 3.1.2 workspace-summary 添加语言注入

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

### 3.3 Phase 3：测试保障（P1，预计 1 天）

#### 3.3.1 单元测试：所有 Agent 支持 language_instruction

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

#### 3.3.2 路由层集成测试

```python
# tests/test_route_language_injection.py
"""Verify that all user-facing agent routes call get_language_instruction()."""

ROUTES_NEEDING_LANGUAGE = [
    "process-data-on-load",
    "clean-data-stream",
    "derive-data",
    "refine-data",
    "data-agent-streaming",
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

### 3.4 Phase 4：开发者规范文档整合（P0，预计 0.5 天）

将 `design-docs/3-language-injection-analysis.md`、`.cursor/rules/language-injection-conventions.mdc`、`.cursor/skills/language-injection/SKILL.md` 的核心约定整合为一个权威参考，避免信息分散。

#### 3.4.1 核心决策树：新增 LLM 调用点

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
            │   （ChartInsight、Report、Explore、CodeExplanation、DataClean）
            │
            └── 输出主要是代码/结构化 JSON → mode="compact"
                （DataRec、DataTransform、DataLoad、Sort、workspace-summary）
```

#### 3.4.2 开发者检查清单

新增或修改 Agent/LLM 调用时，PR reviewer 应检查：

- [ ] Agent 构造函数是否接收 `language_instruction` 参数？
- [ ] 路由是否调用 `get_language_instruction(mode=...)` 并传入 Agent？
- [ ] mode 选择是否正确（full vs compact）？
- [ ] 是否使用了 `inject_language_instruction()` 辅助函数？
- [ ] 是否有硬编码的语言字符串（如 `"回答请使用中文"`）？
- [ ] `agent_diagnostics.py` 是否记录了 language_instruction？
- [ ] 是否有对应的单元测试验证 language_instruction 参数存在？

### 3.5 Phase 5：静态检查与 CI 保障（P1，预计 0.5 天）

#### 3.5.1 自定义 lint 脚本

创建一个简单的 Python 脚本检测 `agent_routes.py` 中所有调用 `client.get_completion()` 或实例化 Agent 类的地方，验证上下文中是否有 `get_language_instruction` 调用：

```python
# scripts/check_language_injection.py
"""CI check: verify all user-facing LLM calls in agent_routes.py inject language."""

import ast, sys

EXEMPT_FUNCTIONS = {"test_model", "check_available_models", "list_global_models"}

# 解析 AST，对每个路由函数检查是否包含 get_language_instruction 调用
# ...
```

#### 3.5.2 Pre-commit hook

```yaml
# .pre-commit-config.yaml (追加)
- repo: local
  hooks:
    - id: check-language-injection
      name: Check language injection in agent routes
      entry: python scripts/check_language_injection.py
      language: python
      files: agent_routes\.py$
```

### 3.6 Phase 6：前端翻译扩展（P2，按需）

#### 3.6.1 优先扩展的语言

根据 `agent_language.py` 注册表和用户需求，推荐优先级：

| 优先级 | 语言 | 理由 |
|--------|------|------|
| 1 | ja (日语) | 东亚高活跃用户群 |
| 2 | ko (韩语) | 东亚高活跃用户群 |
| 3 | fr (法语) | 欧洲及非洲广泛使用 |
| 4 | de (德语) | 欧洲技术社区活跃 |
| 5 | es (西班牙语) | 全球第二大母语人口 |

#### 3.6.2 翻译文件结构

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
└── index.ts
```

加上 `i18n/index.ts` 和 `i18n/locales/index.ts` 的注册。

---

## 4. 实施计划

| Phase | 内容 | 优先级 | 预估工期 | 前置依赖 |
|-------|------|--------|---------|---------|
| **Phase 1** | 补齐 SortDataAgent、workspace-summary 的语言注入 | P0 | 0.5 天 | 无 |
| **Phase 2** | 定义 `inject_language_instruction()` 辅助函数；重构各 Agent 统一调用 | P0 | 1 天 | Phase 1 |
| **Phase 3** | 单元测试 + 路由集成测试 | P1 | 1 天 | Phase 2 |
| **Phase 4** | 整合开发者规范文档，更新 Cursor rule 和 SKILL | P0 | 0.5 天 | Phase 2 |
| **Phase 5** | 静态检查脚本 + pre-commit hook | P1 | 0.5 天 | Phase 4 |
| **Phase 6** | 前端翻译扩展（ja、ko、fr 等） | P2 | 按需 | Phase 1 |

**总计 Phase 1-5**：约 3.5 个开发日

---

## 5. 反模式清单（明确禁止）

| 反模式 | 为什么不行 | 正确做法 |
|--------|-----------|---------|
| 使用环境变量 `os.environ.get("DF_DEFAULT_LANGUAGE")` | 退化为 per-process 语言，破坏多用户场景 | 始终从 `Accept-Language` header 读取 |
| 在 LLM client 层做全局拦截注入 | 隐式行为、无法区分 full/compact mode、调试困难 | 在路由层显式注入 |
| 硬编码语言字符串 `"回答请使用中文"` | 不可配置、不支持其他语言 | 使用 `build_language_instruction()` |
| 新建 `MessageBuilder` 工具类 | 与 `agent_language.py` 形成并行抽象，增加维护成本 | 复用现有 `inject_language_instruction()` |
| 在 user message 中注入语言指令 | 与 OpenAI 最佳实践相悖（系统指令应在 system prompt） | 只在 system prompt 中注入 |
| 跳过 `get_language_instruction()` 直接调用 `build_language_instruction()` | 绕过了从 request header 读取语言的标准链路 | 在路由中使用 `get_language_instruction(mode=...)` |

---

## 6. 风险与注意事项

| 风险 | 缓解措施 |
|------|---------|
| Phase 2 重构可能引入 system prompt 格式变化 | 通过对比测试确保重构前后生成的 prompt 内容一致 |
| 新增语言翻译质量难以保证 | 建立 community review 流程，先覆盖高需求语言 |
| compact mode 下语言指令过简导致 LLM 不遵从 | 对各语言进行 A/B 测试，必要时调整 compact 模板 |
| SortDataAgent 注入语言后 LLM 排序行为变化 | 排序测试用例覆盖中文、日文等非拉丁文字数据 |

---

## 7. 相关文件索引

| 文件 | 角色 |
|------|------|
| `py-src/data_formulator/agents/agent_language.py` | 语言指令构建核心模块 |
| `py-src/data_formulator/agent_routes.py` | 路由层：`get_language_instruction()` + 各端点调用 |
| `py-src/data_formulator/agents/agent_sort_data.py` | **待修复**：缺少 language_instruction |
| `src/app/utils.tsx` | 前端：`getAgentLanguage()` + `fetchWithIdentity()` |
| `src/i18n/index.ts` | 前端 i18n 配置 |
| `src/i18n/locales/` | 前端翻译文件（当前仅 en/zh） |
| `.cursor/rules/language-injection-conventions.mdc` | Cursor 开发规范 |
| `.cursor/skills/language-injection/SKILL.md` | 详细架构说明 |
| `design-docs/3-language-injection-analysis.md` | 早期分析文档（本文档是其后续） |

---

## 8. 验收标准

Phase 1-4 完成后，以下测试全部通过：

- [ ] `build_language_instruction()` 对所有 20 种注册语言返回非空指令
- [ ] 所有 Agent 构造函数均接受 `language_instruction` 参数
- [ ] 所有面向用户的路由端点均调用 `get_language_instruction()`
- [ ] SortDataAgent 返回的 `reason` 字段跟随 UI 语言
- [ ] workspace-summary 返回的名称跟随 UI 语言
- [ ] 英文用户不受影响（`build_language_instruction("en")` 返回 `""`）
- [ ] `inject_language_instruction()` 辅助函数被所有 Agent 使用
- [ ] PR review 检查清单已纳入团队流程
- [ ] 静态检查脚本能检测到新增的未注入语言的 LLM 调用点
