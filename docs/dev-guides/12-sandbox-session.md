# 12. Sandbox Session (Namespace Persistence)

> 关联 Issue: `design-docs/issues/001-data-agent-excessive-tool-calls.md` — 问题 D

## 背景

Sandbox worker 执行 `explore()` / `execute_python()` 代码时，默认每次创建全新的
Python namespace。在 DataAgent 和 DataLoadingAgent 的 agentic loop 中，LLM 可能
多次调用这些工具，但变量（DataFrame、中间计算结果）在调用之间全部丢失，迫使每次
重新 import 和重新读取数据，浪费 tool rounds。

`SandboxSession` 解决了这个问题：在同一个 agent turn 内，多次 sandbox 调用共享
同一个 Python namespace，变量在调用间存活（类似 Jupyter kernel）。

## 架构

```
_WarmWorkerPool
  └── Worker Process (pre-imported pandas/numpy/duckdb)
        └── namespace dict ← SandboxSession 让它在调用间保留

SandboxSession
  ├── __enter__()  → 从池中获取 worker，独占使用
  ├── execute()    → 发送 4-tuple (code, objs, path, persist=True)
  ├── execute()    → 同一 worker，namespace 保留
  └── __exit__()   → 发送 "__clear_ns__"，归还 worker 到池
```

## Worker 协议

| 消息 | 方向 | 说明 |
|---|---|---|
| `(code, allowed_objects, workspace_path)` | Host → Worker | 3-tuple: 传统模式，每次创建新 namespace |
| `(code, allowed_objects, workspace_path, True)` | Host → Worker | 4-tuple: 持久模式，namespace 在调用间保留 |
| `"__clear_ns__"` | Host → Worker | 清空持久化 namespace，回复 `{"status": "ok"}` |
| `None` | Host → Worker | 终止 worker 进程 |

3-tuple 调用完全向后兼容，不受影响。

## 使用方式

### 在 Agent 中使用（推荐）

```python
from data_formulator.sandbox.local_sandbox import SandboxSession

with SandboxSession() as session:
    # 第 1 次调用：定义变量
    r1 = session.execute(code1, {"_pack": None}, workspace_path)

    # 第 2 次调用：变量 df1, top10 等仍然存在
    r2 = session.execute(code2, {"_pack": None}, workspace_path)
# __exit__ 自动清空 namespace 并归还 worker
```

### 在非 agentic 场景中（传统方式，不受影响）

```python
from data_formulator.sandbox import create_sandbox

sandbox = create_sandbox("local")
result = sandbox.run_python_code(code, workspace, "output_df")
```

## 受影响的 Agent

| Agent | 接入方式 | 说明 |
|---|---|---|
| `DataAgent` | `_get_next_action` 创建 session，`_run_explore_code` 使用 `self._explore_session` | `explore()` 工具调用共享 namespace |
| `DataLoadingAgent` | `stream_chat` 创建 session，`_tool_execute_python` 使用 `self._sandbox_session` | `execute_python` 工具调用共享 namespace |
| `DataTransformationAgent` | 不受影响 | 重试模式，每次执行独立完整代码 |
| `DataRecAgent` | 不受影响 | 同上 |

## 跨 Turn 持久化 (Cross-turn Namespace Persistence)

在单次 agent turn 内，`SandboxSession` 的 context manager 保证了变量在多次
`execute()` 调用间存活。但 DataAgent 是逐 HTTP 请求创建的短生命对象，当 tool
rounds 耗尽用户点击"继续探索"时，新的请求会创建全新的 `DataAgent` 和全新的
`SandboxSession`，之前 turn 中计算的 DataFrame 和中间结果全部丢失。

### 解决方案：磁盘序列化 + 恢复

```
Turn N (tool_rounds_exhausted)          Turn N+1 (用户选择"继续探索")
─────────────────────────────           ──────────────────────────────
  SandboxSession                          SandboxSession (new)
    ├── explore() × 12                     ├── restore_namespace()
    └── save_namespace()                   │    ← 从磁盘读回 DataFrame + 标量
         ↓                                 ├── explore() ...
  scratch/_explore_ns/                     └── close()
    ├── df1.parquet                              ↓
    ├── df2.parquet                        scratch/_explore_ns/ (已清理)
    └── _manifest.json
```

### API

```python
# 保存（在 session 关闭前调用）
saved = session.save_namespace(save_dir, workspace_path)

# 恢复（在新 session 创建后立即调用）
ok = SandboxSession.restore_namespace(new_session, save_dir, workspace_path)
```

**`save_namespace(save_dir, workspace_path)`**:

1. 向 worker 发送一段 collect 代码，遍历 `globals()` 收集用户变量
2. 变量通过 multiprocessing Pipe（pickle 序列化）传回 host 进程
3. **host 端写入文件**——worker 的审计钩子禁止一切文件写入（`"open"` 事件 mode != `"r"`），
   所以必须由 host 接收 DataFrame 对象后写 parquet
4. 返回 `True` 表示成功保存，`False` 表示无用户变量可保存

变量过滤规则：

| 条件 | 行为 |
|---|---|
| 变量名以 `_` 开头 | 跳过（内部变量 / 临时变量） |
| `__builtins__` | 跳过 |
| `isinstance(v, pd.DataFrame)` | 保存为 `<name>.parquet` |
| `isinstance(v, (int, float, str, bool))` | 保存到 `_manifest.json` 的 `scalars` 字段 |
| 其他类型（list, dict, numpy array, 自定义对象等） | **不保存** |

**`restore_namespace(session, save_dir, workspace_path)`**:

1. 读取 `_manifest.json` 获取 DataFrame 文件名列表和标量值
2. 生成 Python 代码：`pd.read_parquet()` + 标量赋值语句
3. 在 session 中执行该代码，将变量注入 worker namespace
4. worker 的审计钩子允许从 workspace 目录读取文件，所以 `pd.read_parquet()` 可以正常工作
5. 返回 `True`/`False`

**失败降级**：save 或 restore 失败时仅打 warning 日志，不中断 agent 流程。
下一个 turn 将从零开始（没有恢复的变量），行为退回到无跨 turn 持久化时的状态。

### DataAgent 接入点

| 位置 | 行为 |
|---|---|
| `run()` — `trajectory is None` | 新对话：清理 `scratch/_explore_ns/` 防止旧状态泄漏 |
| `_get_next_action()` 进入 | 如果 `_explore_ns/` 存在 → 恢复 namespace → 清理目录 |
| `_get_next_action()` 退出 | 如果 `tool_rounds_exhausted` → 保存 namespace 到 `_explore_ns/` |

save/restore 决策通过 `self._tool_loop_exit_reason` 标记实现：`_tool_loop` 在
耗尽 tool rounds 时设置该标记，`_get_next_action` 在 `yield from _tool_loop()`
返回后检查它，在 session `__exit__` 关闭 namespace 之前完成保存。

### 用户隔离

保存目录 `scratch/_explore_ns/` 位于每个用户的 workspace 下
（`workspace.confined_scratch.root / "_explore_ns"`），天然实现用户级隔离。

### 限制

- **类型覆盖有限**：仅保存 DataFrame 和 `int/float/str/bool` 标量。list、dict、numpy array、
  自定义类、函数等均不保存。实际使用中 agent explore 的中间结果绝大多数是 DataFrame 和简单标量，
  覆盖率足够（生产环境验证：20-23 个 DataFrame + 2 个标量被成功保存恢复）
- **Pipe 传输开销**：save 时 DataFrame 经 multiprocessing Pipe（pickle）从 worker 传回 host，
  然后 host 写 parquet。对于极大 DataFrame（>100MB）可能有秒级延迟，但远低于重新执行全部数据处理代码
- **parquet 磁盘开销**：临时文件写入 workspace `scratch/` 目录，restore 后立即清理。
  如果 agent 在 save 后进程崩溃导致未清理，新对话开始时 `run()` 也会清理
- DataLoadingAgent 不需要跨 turn 持久化（无 resume 机制），仅使用 within-turn 持久化

## 安全保证

- **作用域**: namespace 持久化严格限定在单次 agent turn（一次 `with SandboxSession()` 块）内
- **跨 turn 保存**: 仅在 `tool_rounds_exhausted` 时触发，保存到用户 workspace 的受限目录
- **自动清理**: context manager 的 `__exit__` 保证 turn 结束时清空 namespace 并归还 worker；新对话时自动清理 `_explore_ns/`
- **进程隔离**: 不同 session 使用不同 worker 进程，天然内存隔离
- **超时处理**: 执行超时后 worker 被 kill，session 标记为 closed，namespace 随进程消亡
- **错误恢复**: 单次执行报错（如 `NameError`）不会杀死 session，后续调用仍可使用已有变量

## 相关文件

| 文件 | 角色 |
|---|---|
| `py-src/data_formulator/sandbox/local_sandbox.py` | `SandboxSession` 类 + Worker 协议扩展 + `save_namespace` / `restore_namespace` |
| `py-src/data_formulator/sandbox/__init__.py` | 导出 `SandboxSession` |
| `py-src/data_formulator/agents/data_agent.py` | DataAgent 接入 session + 跨 turn save/restore |
| `py-src/data_formulator/agents/agent_data_loading_chat.py` | DataLoadingAgent 接入 session（within-turn only） |
| `tests/backend/security/test_sandbox.py` | `TestSandboxSession` + `TestSandboxSessionSaveRestore` 测试 |

## 新模块 Checklist

当修改 sandbox 或 agent 的代码执行路径时：

- [ ] 确认 `SandboxSession` 的 `close()` 在所有退出路径（正常/异常/超时）都会被调用
- [ ] 确认不会跨用户请求复用 session（session 的生命周期 = 一次 agent turn）
- [ ] 新增的 agent 如果有 agentic loop + 多次 sandbox 调用，应该接入 `SandboxSession`
- [ ] 如果 agent 支持 resume trajectory，考虑是否需要跨 turn 的 save/restore
- [ ] 运行 `python -m pytest tests/backend/security/test_sandbox.py -q` 验证
