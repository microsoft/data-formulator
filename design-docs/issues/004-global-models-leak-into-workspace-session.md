# ISSUE-004: globalModels 被冗余写入 workspace session_state.json

> 状态：待修复
> 日期：2026-04-26
> 影响范围：`useAutoSave`（`src/app/useAutoSave.tsx`）、`_SENSITIVE_FIELDS`（`py-src/data_formulator/datalake/workspace_manager.py`）

---

## 1. 问题现象

后端管理员通过 `.env` 配置的全局模型列表（`globalModels`）被完整写入每个 workspace 的 `session_state.json` 文件中。例如：

```
.local-db/users/user7/workspaces/session_20260425_171128_4c15/session_state.json
```

文件中包含了如下全局模型信息：

```json
{
  "globalModels": [
    {
      "id": "global-deepseek-deepseek-chat",
      "endpoint": "openai",
      "model": "deepseek-chat",
      "api_base": "https://api.deepseek.com",
      "is_global": true
    },
    {
      "id": "global-qwen-qwen3.6-35b-a3b",
      "endpoint": "openai",
      "model": "qwen3.6-35b-a3b",
      "api_base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "is_global": true
    }
  ]
}
```

这些数据属于服务端配置，每次应用启动时都会从后端 `/api/get_model_list` 重新拉取，持久化到 workspace session 中没有意义。

---

## 2. 根因分析

`globalModels` 在 **redux-persist** 层已正确排除，但在 **workspace auto-save** 的两道过滤中均遗漏：

### 2.1 前端 `EXCLUDED_FIELDS` 遗漏

`src/app/useAutoSave.tsx` 的排除列表中没有 `globalModels`：

```typescript
// useAutoSave.tsx:13-19
const EXCLUDED_FIELDS = new Set([
    'models', 'selectedModelId', 'testedModels',
    'dataLoaderConnectParams', 'identity', 'agentRules', 'serverConfig',
    'chartSynthesisInProgress', 'chartInsightInProgress',
    'cleanInProgress', 'sessionLoading', 'sessionLoadingLabel',
]);
// ← 缺少 'globalModels'
```

### 2.2 后端 `_SENSITIVE_FIELDS` 遗漏

`py-src/data_formulator/datalake/workspace_manager.py` 的后端过滤同样没有包含 `globalModels`：

```python
# workspace_manager.py:31-39
_SENSITIVE_FIELDS = frozenset([
    "models",
    "selectedModelId",
    "testedModels",
    "dataLoaderConnectParams",
    "identity",
    "agentRules",
    "serverConfig",
])
# ← 缺少 "globalModels"
```

### 2.3 数据流对比

| 过滤层 | 是否排除 `globalModels` | 位置 |
|--------|------------------------|------|
| redux-persist blacklist | ✅ 已排除 | `src/app/store.ts:19` |
| 前端 auto-save `EXCLUDED_FIELDS` | ❌ 遗漏 | `src/app/useAutoSave.tsx:13` |
| 后端 `_SENSITIVE_FIELDS` | ❌ 遗漏 | `workspace_manager.py:31` |

---

## 3. 影响

- **存储浪费**：每个 workspace session 文件都冗余保存了一份全局模型配置。
- **数据过期风险**：管理员修改了 `.env` 中的全局模型配置后，已有 workspace 的 `session_state.json` 中仍保留旧的模型列表。如果恢复 workspace 时处理不当，可能短暂显示过期配置。
- **信息泄漏**：`api_base` 等端点信息被写入了不必要的位置。workspace 导出/导入时，这些服务端配置可能随 zip 文件传播到其他环境。

---

## 4. 修复方案

需要在前后端各加一行，将 `globalModels` 加入排除列表。

### 4.1 前端修复

```typescript
// src/app/useAutoSave.tsx
const EXCLUDED_FIELDS = new Set([
    'models', 'selectedModelId', 'testedModels',
    'dataLoaderConnectParams', 'identity', 'agentRules', 'serverConfig',
    'chartSynthesisInProgress', 'chartInsightInProgress',
    'cleanInProgress', 'sessionLoading', 'sessionLoadingLabel',
    'globalModels',  // ← 新增
]);
```

同时 `workspaceService.ts:127` 中 `exportWorkspace` 内的硬编码 EXCLUDED 集合也需要同步更新。

### 4.2 后端修复

```python
# py-src/data_formulator/datalake/workspace_manager.py
_SENSITIVE_FIELDS = frozenset([
    "models",
    "selectedModelId",
    "testedModels",
    "dataLoaderConnectParams",
    "identity",
    "agentRules",
    "serverConfig",
    "globalModels",  # ← 新增
])
```

### 4.3 Azure Blob 后端

`azure_blob_workspace_manager.py` 的 `save_session_state` 也调用了 `_strip_sensitive()`，修复 `_SENSITIVE_FIELDS` 后会自动生效。

### 4.4 现有数据清理（可选）

已有 `session_state.json` 文件中的 `globalModels` 字段无需强制清理——恢复 workspace 后，`fetchGlobalModelList` 会用最新的服务端配置覆盖 Redux 中的值。但如果想减少文件体积，可以编写一个一次性迁移脚本：

```python
import json
from pathlib import Path

for state_file in Path(".local-db").rglob("session_state.json"):
    data = json.loads(state_file.read_text())
    if "globalModels" in data:
        del data["globalModels"]
        state_file.write_text(json.dumps(data))
```

---

## 5. 实施计划

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 前端 `EXCLUDED_FIELDS` 加入 `globalModels` | P1 | 极低 | 加一行字符串 |
| 前端 `exportWorkspace` EXCLUDED 同步 | P1 | 极低 | 加一行字符串 |
| 后端 `_SENSITIVE_FIELDS` 加入 `globalModels` | P1 | 极低 | 加一行字符串，双重保险 |
| 现有 session 数据清理 | P2 | 低 | 可选，不影响功能 |

---

## 6. 延伸思考

目前排除列表分散在三处（`store.ts` blacklist、`useAutoSave.tsx` EXCLUDED_FIELDS、`workspace_manager.py` _SENSITIVE_FIELDS），且 `workspaceService.ts` 中 export 时还硬编码了第四份副本。建议后续将前端的排除列表抽取为单一常量（如 `NON_PERSISTABLE_FIELDS`），在 auto-save 和 export 中共用，避免再次遗漏。
