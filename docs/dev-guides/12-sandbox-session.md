# 12. Sandbox Session (Namespace Persistence)

> 关联 Issue: `design-docs/issues/001-data-agent-excessive-tool-calls.md` — 问题 D

## 背景

Sandbox worker 执行代码时，默认每次创建全新的 Python namespace。`AnalystAgent`
的 agentic loop 中，LLM 可能在一次 action 之前多次调用 Python 工具，如果变量
（DataFrame、中间计算结果）在调用之间全部丢失，就要每次重新 import 和重新读取数据，
浪费 tool rounds。

`SandboxSession` 解决了这个问题：在同一个 `_get_next_action()` 调用内，多次
sandbox 调用共享同一个 Python namespace，变量在调用间存活（类似 Jupyter kernel）。

## 架构

```
_WarmWorkerPool  (local_sandbox.py 模块级 _worker_pool)
  └── Worker Process (pre-imported pandas/numpy/duckdb/pyarrow, 可选 scipy/sklearn)
        └── namespace dict ← SandboxSession 让它在调用间保留

SandboxSession(workspace_path)
  ├── __init__()   → 给定 workspace_path 时立即从池中获取 worker；否则在首次 execute() 时获取
  ├── execute()    → 发送 4-tuple (code, objs, path, True)
  ├── execute()    → 同一 worker，namespace 保留
  └── close() / __exit__()
                   → 发送 "__clear_ns__"，5s 内收到 ack 则归还 worker，否则丢弃 worker
```

在 OS confinement 可用时（macOS seatbelt / Linux bwrap，见 `sandbox/confinement.py`），
worker 按 `worker_key(workspace_path)` 分池：Data Formulator 自己的 workspace 共享一个 key。
不可用时退回到仅有 audit hook 的 worker。

## Worker 协议

| 消息 | 方向 | 说明 |
|---|---|---|
| `(code, allowed_objects, workspace_path)` | Host → Worker | 3-tuple：每次创建新 namespace（`LocalSandbox` 非 session 路径） |
| `(code, allowed_objects, workspace_path, True)` | Host → Worker | 4-tuple：持久模式，namespace 在调用间保留（`SandboxSession.execute`） |
| `"__clear_ns__"` | Host → Worker | 清空持久化 namespace，回复 `{"status": "ok"}` |
| `None` | Host → Worker | 终止 worker 进程 |
| `{"status": "ok", "allowed_objects": {...}, "df_names": [...]}` | Worker → Host | 成功；`df_names` 为 namespace 中的用户 DataFrame 名（诊断用） |
| `{"status": "error", "error_message": "..."}` | Worker → Host | 代码抛异常；worker 和 namespace 保留 |
| `{"status": "interrupted", ...}` | Worker → Host | 收到 SIGINT（用户中断）；之后 worker 进程退出 |

## 使用方式

### 在 Agent 中使用

```python
from data_formulator.sandbox.local_sandbox import SandboxSession

with SandboxSession(workspace_path) as session:
    # 第 1 次调用：定义变量
    r1 = session.execute(code1, {"_pack": None}, workspace_path)

    # 第 2 次调用：变量 df1, top10 等仍然存在
    r2 = session.execute(code2, {"_pack": None}, workspace_path)
# __exit__ 自动清空 namespace 并归还 worker
```

### 非 session 场景（每次独立 namespace）

```python
from data_formulator.sandbox import create_sandbox

sandbox = create_sandbox(sandbox_mode)          # "local" 或 "docker"
result = sandbox.run_python_code(code, workspace, "output_df")
```

## 接入方

| 调用方 | 接入方式 | 说明 |
|---|---|---|
| `AnalystAgent` (`analyst/agent.py`) | `_get_next_action()` 用 `with SandboxSession(ws_path)` 包住 `_tool_loop()`，并设置 `self._explore_session`；`_run_explore_code()` 有 session 时调用 `session.execute()` | 一次 `_get_next_action()`（若干 inspection tool rounds，直到一个 committing action 或纯文本结束）内共享 namespace；下一次 action 会新建 session |
| 经 `_run_explore_code()` 的工具 | 循环中的 `execute_python_script`，以及 skill 通过 `ctx.runtime.run_explore_code()` 执行代码（`analysis` skill 的 `execute_python_script`；`workspace` skill 的 `create_data` / `update_data` / `create_file` / `edit_file` 带 `code` 时） | 共享同一 session namespace |
| `WorkflowAgent` (`workflows/agent.py`) | 继承 `AnalystAgent`，但用自己的 `run_workflow()` 循环，不进入 `_get_next_action()` | `_explore_session` 未设置，`execute_python_script` 回退到 `create_sandbox(mode)._run_in_warm_subprocess(...)`，每次新 namespace；支持 `execution_cancellation` 中断 |
| `_run_visualize_code()`、`materialize_memory_table()` | `create_sandbox(mode).run_python_code(...)` | 不使用 session |

注意：`_get_next_action()` 无条件使用 `SandboxSession`，即本地 warm worker pool，
与 `--sandbox` 配置无关；`create_sandbox(mode)` 只作用于非 session 路径。
发送给 worker 的代码会先经过 `sandbox/session_imports.py` 的 `with_session_imports()`，
使 agent 写入的 `files/lib/*.py` helper 和 `scratch/.packages` 中的包可被 import。

## 跨 Turn 持久化（save / restore）

`SandboxSession` 提供把 namespace 序列化到磁盘并在新 session 中恢复的 API：

```python
# 保存（在 session 关闭前调用）
saved = session.save_namespace(save_dir, workspace_path)

# 恢复（在新 session 创建后立即调用）
ok = SandboxSession.restore_namespace(new_session, save_dir, workspace_path)
```

**`save_namespace(save_dir, workspace_path)`**:

1. 在 session 中执行一段 collect 代码，遍历 `globals()` 收集用户变量
2. 变量通过 Pipe（pickle）传回 host 进程
3. **host 端写文件**——worker 的审计钩子禁止以 `"r"` / `"rb"` 以外的模式 open，
   所以由 host 收到 DataFrame 后写 parquet 和 `_manifest.json`
4. 返回 `True` 表示已保存，`False` 表示 collect 失败或无用户变量

变量过滤规则：

| 条件 | 行为 |
|---|---|
| 变量名以 `_` 开头（含 `__builtins__`） | 跳过 |
| `isinstance(v, pd.DataFrame)` | 保存为 `<name>.parquet` |
| `isinstance(v, (int, float, str, bool))` | 保存到 `_manifest.json` 的 `scalars` 字段 |
| 其他类型（list, dict, numpy array, 自定义对象等） | **不保存** |

**`restore_namespace(session, save_dir, workspace_path)`**:

1. 读取 `_manifest.json`（不存在则返回 `False`）
2. 生成 `pd.read_parquet()` + 标量赋值代码并在 session 中执行
3. 成功返回 `True`；执行失败只打 warning 并返回 `False`

### AnalystAgent 中的现状

| 位置 | 行为 |
|---|---|
| `run()` — 新对话（无 trajectory 且 `SessionHistory.continuable()` 无可继续历史） | 删除 `scratch/_explore_ns/`，防止旧状态泄漏 |
| `_get_next_action()` 进入 | 如果 `_explore_ns/` 存在 → `restore_namespace()` → 删除目录 |

目前产品代码中**没有调用 `save_namespace()`**（旧的 "tool rounds 耗尽时保存" 触发点已不存在；
`AnalystExecutionConfig.max_tool_rounds_per_action` 仅为兼容保留，不再限制执行）。因此
`_explore_ns/` 正常情况下不会被写入，Python 变量不会跨 action 或跨请求保留；会话续接
（`analyst/history.py` 的 `SessionHistory`）只保留消息，不保留 namespace。
save/restore API 本身由 `TestSandboxSessionSaveRestore` 覆盖。

保存目录位于每个 workspace 的受限 scratch 下（`workspace.confined_scratch.root / "_explore_ns"`），
天然按用户/workspace 隔离，并且不会出现在 agent 可见的 scratch 文件列表中。

## 安全与生命周期

- **作用域**: namespace 持久化限定在一次 `with SandboxSession()` 块（一次 `_get_next_action()`）内
- **自动清理**: `__exit__` 发送 `"__clear_ns__"` 后归还 worker；ack 超时或通信失败则丢弃 worker
- **进程隔离**: 同一时刻一个 session 独占一个 worker 进程
- **超时处理**: `EXECUTION_TIMEOUT`（环境变量 `DF_SANDBOX_TIMEOUT`，默认 120s）到期后 worker 被丢弃，session 标记为 closed，之后的 `execute()` 返回 `"Session is closed"` 错误
- **错误恢复**: 单次执行报错（如 `NameError`）不会杀死 session，后续调用仍可使用已有变量
- **中断**: `SandboxSession.execute()` 不检查 `execution_cancellation`；用户中断只在 `LocalSandbox._run_in_warm_subprocess()` 路径生效

## 相关文件

| 文件 | 角色 |
|---|---|
| `py-src/data_formulator/sandbox/local_sandbox.py` | `_warm_worker_loop` 协议、`_WarmWorkerPool`、`SandboxSession`（含 `save_namespace` / `restore_namespace`）、`LocalSandbox` |
| `py-src/data_formulator/sandbox/confinement.py` | OS confinement 与 worker 分池 key |
| `py-src/data_formulator/sandbox/session_imports.py` | `with_session_imports()`：helper 模块与已安装包的导入 |
| `py-src/data_formulator/sandbox/__init__.py` | 导出 `SandboxSession`、`create_sandbox` |
| `py-src/data_formulator/analyst/agent.py` | `AnalystAgent._get_next_action` / `_run_explore_code` 接入 session，`_explore_ns` 恢复与清理 |
| `tests/backend/security/test_sandbox.py` | `TestSandboxSession` + `TestSandboxSessionSaveRestore` 测试 |

## 新模块 Checklist

当修改 sandbox 或 agent 的代码执行路径时：

- [ ] 确认 `SandboxSession` 的 `close()` 在所有退出路径（正常/异常/超时）都会被调用（优先用 `with`）
- [ ] 确认不会跨用户请求复用 session（生命周期 ≤ 一次 agent 请求）
- [ ] 有 agentic loop + 多次 sandbox 调用的新路径，考虑接入 `SandboxSession`，并经 `_run_explore_code()` 执行
- [ ] 如需跨 action 保留变量，需要显式调用 `save_namespace()`（当前没有调用方）
- [ ] 运行 `uv run pytest tests/backend/security/test_sandbox.py -q` 验证
