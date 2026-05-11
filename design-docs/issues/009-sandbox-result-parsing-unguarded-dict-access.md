# ISSUE-009: Sandbox 返回值解析缺乏防御性 — 重复代码 + 不安全字典访问

> 状态：待修复
> 日期：2026-05-12
> 影响范围：`agent_data_loading_chat.py`、`data_agent.py`、`local_sandbox.py`
> 关联规范：`dev-guides/12-sandbox-session.md`

---

## 1. 问题总述

Sandbox worker 进程与主进程通过 multiprocessing Pipe 通信，返回值遵循以下协议：

```python
# 成功
{"status": "ok", "allowed_objects": {...}}
# 失败
{"status": "error", "error_message": "..."}
```

4 个调用点各自手写解析逻辑，存在两个问题：

1. **不安全的字典访问**：部分调用点使用 `raw["status"]`、`raw["allowed_objects"]` 直接访问，
   未做 `.get()` 防御。虽然当前协议保证 `status:"ok"` 时一定有 `allowed_objects`，
   但缺乏防御性编程。
2. **重复代码分叉**：上游在 `cd2afd4` 中修复了 `data_agent.py` 的不安全访问，
   但遗漏了 `agent_data_loading_chat.py` 和 `local_sandbox.py` 中完全相同的代码。

---

## 2. 问题来源

### 2.1 时间线

| 提交 | 日期 | 作者 | 内容 |
|------|------|------|------|
| `fc80f38` | 2026-04-16 | Chenglong Wang | 创建 `agent_data_loading_chat.py`，首次写入 `raw["status"]`、`raw["allowed_objects"]` 直接访问 |
| `53f8859` | 2026-05-01 | y-agent-ai | `feat(sandbox): SandboxSession`，将同样的不安全模式从 `agent_data_loading_chat.py` 复制到 `data_agent.py` |
| `cd2afd4` | 2026-05-10 | Chenglong Wang | `fixes`，修复了 `data_agent.py` 的不安全访问（改为 `.get()`），但**遗漏了** `agent_data_loading_chat.py` 和 `local_sandbox.py` |

### 2.2 根本原因

Sandbox 返回值的解析逻辑被**复制粘贴**在 4 个调用点中，没有提取为公共函数。
修复一处时无法自动覆盖其他处，属于典型的"复制粘贴代码分叉"问题。

---

## 3. 现状分析

### 3.1 各调用点安全性

| 调用点 | status 访问 | allowed_objects 访问 | 安全性 |
|--------|:-----------:|:-------------------:|:------:|
| `agent_data_loading_chat.py` L656-657 | `raw["status"]` | `raw["allowed_objects"]` | **不安全** |
| `data_agent.py` L1066-1070 | `raw.get("status")` | `raw.get("allowed_objects") or {}` | 已安全（`cd2afd4` 修复） |
| `local_sandbox.py` L399-403 (`save_namespace`) | `result.get("status")` | `result["allowed_objects"]` | **半安全** |
| `local_sandbox.py` L517-518 (`execute` 公共 API) | `result["status"]` | `result["allowed_objects"]` | **不安全** |

### 3.2 实际触发条件

在当前 sandbox 协议下，`status:"ok"` 时 `allowed_objects` **一定存在**（worker 在
`_warm_worker_loop` L215-216 原子性地构建后才 `conn.send()`），因此正常运行时不会触发
KeyError。

但以下边缘场景可能暴露此问题：
- 未来新增 sandbox 实现（如 Docker sandbox）且返回值格式略有不同
- Sandbox 协议版本变更
- 内部重构时意外改变返回值结构

### 3.3 当前影响

即使 KeyError 被触发，外层 `except Exception` 能兜底不崩溃，但：
- 用户看到无意义的 `"Code execution failed"` 而非真实错误
- 真实错误信息被 KeyError 掩盖，增加调试难度
- 与已修复的 `data_agent.py` 不一致，违反一致性原则

---

## 4. 解决方案

### 4.1 设计理念：谁定义协议，谁提供解析器

问题的根源不是某一行用了 `[]` 还是 `.get()`，而是 **sandbox 的返回值协议没有唯一解析入口**。
4 个调用点各自手写解析逻辑，修了一个漏了其他的。

最小且优雅的做法是：在 sandbox 模块中新增一个 `unpack_sandbox_result()` 函数，
作为**唯一的结果解析入口**，消除重复代码，从结构上杜绝未来再出现"修一漏一"的问题。

### 4.2 新增解析函数

在 `sandbox/__init__.py` 中导出：

```python
def unpack_sandbox_result(raw: dict) -> tuple[bool, dict, str]:
    """Parse sandbox execution result defensively.

    Returns:
        (success, allowed_objects, error_message)
    """
    if raw.get("status") == "ok":
        allowed = raw.get("allowed_objects")
        if not isinstance(allowed, dict):
            allowed = {}
        return True, allowed, ""
    error = raw.get("error_message", raw.get("content", "Unknown error"))
    return False, {}, error
```

### 4.3 调用点改造

**`agent_data_loading_chat.py` L656-657（当前最危险的点）：**

```python
# 之前
if raw["status"] == "ok":
    pack = raw["allowed_objects"].get("_pack", {})
    ...
else:
    return {"stdout": "", "error": raw.get("error_message", raw.get("content", "Unknown error"))}

# 之后
ok, allowed, err = unpack_sandbox_result(raw)
if ok:
    pack = allowed.get("_pack", {})
    ...
else:
    return {"stdout": "", "error": err}
```

**`data_agent.py` L1066-1070（已安全但内联硬编码 4 行 → 1 行）：**

```python
# 之前（cd2afd4 修复后，4 行内联防御）
if raw.get("status") == "ok":
    allowed = raw.get("allowed_objects") or {}
    if not isinstance(allowed, dict):
        allowed = {}
    pack = allowed.get("_pack", {})

# 之后
ok, allowed, err = unpack_sandbox_result(raw)
if ok:
    pack = allowed.get("_pack", {})
```

**`local_sandbox.py` L399-403（`save_namespace`）：**

```python
# 之前
if result.get("status") != "ok":
    logger.warning("save_namespace: collect failed: %s", result.get("error_message"))
    return False
pack = result["allowed_objects"].get("_pack")     # ← 不安全

# 之后
ok, allowed, err = unpack_sandbox_result(result)
if not ok:
    logger.warning("save_namespace: collect failed: %s", err)
    return False
pack = allowed.get("_pack")
```

**`local_sandbox.py` L517-518（公共 `execute` 方法）：**

```python
# 之前
if result["status"] == "ok":                              # ← 不安全
    output_df = result["allowed_objects"][output_variable] # ← 不安全

# 之后
ok, allowed, err = unpack_sandbox_result(result)
if ok:
    output_df = allowed.get(output_variable)
```

---

## 5. 为什么这么解决

| 维度 | 评价 |
|------|------|
| **改动量** | 新增 1 个函数（~10 行），修改 4 个调用点（每个改 2-3 行） |
| **侵入性** | 不改 sandbox worker 协议、不改返回值结构、不改外层业务逻辑 |
| **防御性** | 所有防御逻辑收敛到一个函数，未来不可能再"修一漏一" |
| **可发现性** | 新开发者搜 `sandbox result` 就能找到这个函数，比散落的 `.get()` 更容易理解协议 |
| **向前兼容** | 如果未来新增 Docker sandbox，只要返回值走同一个 `unpack_sandbox_result()`，调用方无需改动 |

与替代方案的对比：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **仅修改不安全的调用点**（逐个加 `.get()`） | 改动最小 | 不解决代码重复，未来仍会"修一漏一" |
| **改 worker 协议保证字段一定存在** | 从源头解决 | 侵入性高，需改 IPC 协议和所有 worker 返回路径 |
| **✅ 统一解析函数**（本方案） | 最小改动 + 消除重复 + 防御未来 | 无明显缺点 |

---

## 6. 涉及文件

### 6.1 代码文件

| 文件 | 改动 |
|------|------|
| `py-src/data_formulator/sandbox/__init__.py` | 新增 `unpack_sandbox_result()` 并导出 |
| `py-src/data_formulator/agents/agent_data_loading_chat.py` | L656-657 改用 `unpack_sandbox_result()` |
| `py-src/data_formulator/agents/data_agent.py` | L1066-1070 改用 `unpack_sandbox_result()` |
| `py-src/data_formulator/sandbox/local_sandbox.py` | L399-403、L517-518 改用 `unpack_sandbox_result()` |

### 6.2 开发者文档

| 文档 | 更新内容 |
|------|---------|
| `dev-guides/12-sandbox-session.md` | 新增"结果解析"章节，说明必须使用 `unpack_sandbox_result()`，禁止直接 `raw["status"]` / `raw["allowed_objects"]` |

---

## 7. 测试要点

- [ ] `unpack_sandbox_result` 对 `{"status": "ok", "allowed_objects": {...}}` 返回 `(True, {...}, "")`
- [ ] `unpack_sandbox_result` 对 `{"status": "error", "error_message": "..."}` 返回 `(False, {}, "...")`
- [ ] `unpack_sandbox_result` 对 `{"status": "error", "content": "..."}` 返回 `(False, {}, "...")`（兼容旧格式）
- [ ] `unpack_sandbox_result` 对 `{}` 空字典返回 `(False, {}, "Unknown error")`
- [ ] `unpack_sandbox_result` 对 `{"status": "ok"}` 缺失 `allowed_objects` 返回 `(True, {}, "")`
- [ ] 现有 sandbox 测试全部通过：`python -m pytest tests/backend/security/test_sandbox.py -q`
- [ ] `data_agent.py` 的 explore 工具正常执行代码并返回 stdout
- [ ] `agent_data_loading_chat.py` 的 execute_python 工具正常执行代码并保存 DataFrame
