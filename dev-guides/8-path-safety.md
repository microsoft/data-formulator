# 服务端路径安全开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-27
> **适用范围**: 后端 route、Agent 工具、Workspace 文件访问、Data Loader、Sandbox、插件文件 I/O、知识库、推理日志

## 1. 核心原则

任何把“不可信路径片段”拼到“服务端根目录”上的代码，都必须先经过统一路径约束。

| 场景 | 规范 |
|------|------|
| Workspace data 文件 | `Workspace.get_file_path()`（内部使用 `ConfinedDir`） |
| Workspace 根/data/scratch 子目录 | `workspace.confined_root` / `confined_data` / `confined_scratch` 属性 |
| Agent 读文件/列目录工具 | `workspace.confined_root` / `workspace.confined_scratch`，传入各工具方法 |
| 文件下载 route | `workspace.confined_scratch.resolve(filename)` 后传给 `send_file()` |
| 文件上传 route | `secure_filename()` 清洗 + `workspace.confined_scratch.resolve()` 二次校验 |
| 任意 root + relative path | `ConfinedDir(root).resolve(relative)` |
| 知识库文件读写 | 通过 `KnowledgeStore` 内部的 `ConfinedDir` |
| 推理日志写入 | 通过 `ReasoningLogger` 内部的 `ConfinedDir` |
| 读取宿主文件系统的 Loader | 必须注册多用户部署禁用规则 |
| Sandbox 部署 | 多用户模式不得使用 `not_a_sandbox` |

**绝对禁止**手写 `resolve() + relative_to()` 或 `resolve() + is_relative_to()` 路径检查模式。这些逻辑已统一封装在 `ConfinedDir.resolve()` 中，手写会导致逻辑重复、不一致和遗漏风险。

禁止把用户、LLM、外部存储、HTTP body/query/path 参数直接用于裸路径拼接，例如 `Path(root) / user_input`、`root / filename`。

## 2. 路径约束原语

`ConfinedDir` 是服务端路径约束的默认原语，位于 `py-src/data_formulator/security/path_safety.py`。

```python
from data_formulator.security.path_safety import ConfinedDir

jail = ConfinedDir(tmp_path, mkdir=False)
target = jail.resolve("data/report.csv")
jail.write("scratch/output.csv", b"content")
```

`ConfinedDir.resolve()` 的防护层次：

1. 拒绝空路径。
2. 拒绝绝对路径。
3. 拒绝 `..` 路径段。
4. `resolve()` 展开符号链接后，用 `Path.is_relative_to()` 确认结果仍在 root 内。

捕获 `ValueError` 时，应返回应用层错误或跳过不可信外部对象，不要继续使用原始路径。

## 3. 文件名清洗

路径约束和文件名清洗是两层不同防线。

| API | 用途 |
|-----|------|
| `safe_data_filename()` | Workspace 数据文件名，保留 Unicode，去掉目录组件和控制字符 |
| `secure_filename()` | identity、URL/上传临时文件名等需要 ASCII 安全名的场景 |
| `ConfinedDir.resolve()` | 校验清洗后的相对路径不会逃出 root |

使用 `Workspace.get_file_path(filename)` 的场景不需要手动调用 `ConfinedDir`，因为它内部已通过 `safe_data_filename()` + `ConfinedDir.resolve()` 实现两层防御。

## 4. 文件下载 Route

下载接口必须让安全检查和实际发送使用同一个 resolved path。使用 `ConfinedDir`：

```python
from flask import send_file

scratch_jail = workspace.confined_scratch
try:
    target = scratch_jail.resolve(filename)
except ValueError:
    return jsonify(status="error", message="Access denied")

return send_file(target)
```

❌ **禁止**手写 resolve + relative_to 检查：

```python
# BAD — 手写检查，已弃用
target = (scratch_dir / filename).resolve()
if not target.is_relative_to(scratch_dir.resolve()):
    return jsonify(status="error", message="Access denied")
```

禁止在用户路径上使用 `send_from_directory(dir, filename)`。它会在 Flask 内部再次解析原始 `filename`，容易和前置安全检查形成 TOCTOU 不一致。

如果文件名来自用户输入并写入 `Content-Disposition`，不得直接插值原始字符串。新代码应先建立统一 helper，去除 CR/LF、引号和目录组件，并为非 ASCII 名称提供安全 fallback 或 `filename*` 编码。

## 5. Agent 工具

Agent 工具参数由 LLM 生成，LLM 输入又来自用户，因此路径参数一律视为不可信。

入口函数应使用 `Workspace.confined_*` 属性获取 `ConfinedDir` 实例，传入各工具方法：

```python
def _execute_tool(self, name, args):
    workspace_jail = self.workspace.confined_root
    scratch_jail = self.workspace.confined_scratch

    if name == "read_file":
        return self._tool_read_file(args, workspace_jail)
    elif name == "write_file":
        return self._tool_write_file(args, scratch_jail)
    ...
```

具体工具通过 `ConfinedDir.resolve()` 获取安全路径：

```python
def _tool_read_file(self, args, workspace_jail):
    rel_path = args.get("path", "")
    try:
        target = workspace_jail.resolve(rel_path)
    except ValueError:
        return {"error": "Access denied: path outside workspace"}
    ...
```

❌ **禁止**在工具方法中手写 `resolve() + relative_to()`：

```python
# BAD — 手写检查，已弃用
target = (workspace_path / rel_path).resolve()
try:
    target.relative_to(workspace_path)
except ValueError:
    return {"error": "Access denied: path outside workspace"}
```

不要在工具函数内部反复创建 `ConfinedDir` 或反复调用 `resolve()`。在 `_execute_tool` 入口创建一次，所有工具方法复用同一个实例。

## 6. Data Loader 与宿主文件系统

如果 Loader 的构造参数包含用户可控的本机路径，例如 `root_dir`，它只能在本地单用户模式使用。

必须在 `data_loader/__init__.py` 的 `_enforce_deployment_restrictions()` 中注册禁用规则：

```python
def _enforce_deployment_restrictions():
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend != "local" and "your_local_loader" in DATA_LOADERS:
        del DATA_LOADERS["your_local_loader"]
        DISABLED_LOADERS["your_local_loader"] = (
            "your_local_loader connector is disabled in multi-user mode "
            "(WORKSPACE_BACKEND != 'local')"
        )
```

`local_folder` 是当前参考实现。Data Loader 通用开发规范见 `dev-guides/3-data-loader-development.md`。

## 7. Sandbox 部署

多用户或云部署中，`not_a_sandbox` 会让 LLM 生成的 Python 代码在宿主进程直接执行，可能绕过所有路径检查。

部署要求：

- `WORKSPACE_BACKEND == "local"` 时允许桌面单用户模式使用 `not_a_sandbox`。
- `WORKSPACE_BACKEND != "local"` 时必须使用 `SANDBOX=docker` 或 `SANDBOX=local`。
- 新部署模板应默认选择隔离沙箱。

应用启动时已有安全检查：多用户模式搭配 `not_a_sandbox` 会输出 critical 日志。

## 8. 测试要求

新增路径相关代码时，至少覆盖：

- 正常相对路径可以访问。
- `../`、绝对路径、空路径被拒绝。
- symlink escape 被拒绝，适用时用真实文件系统测试。
- 文件下载 route 使用 `send_file(resolved_path)`。
- 多用户部署下宿主文件系统 Loader 被禁用。

已有参考测试：

- `tests/backend/data/test_local_folder_loader.py`
- `tests/backend/security/test_scratch_serve.py`
- `tests/backend/agents/test_tool_path_safety.py`
- `tests/backend/security/test_local_folder_deployment.py`
- `tests/backend/security/test_startup_safety.py`
- `tests/backend/security/test_confined_dir_extended.py`
- `tests/backend/security/test_confined_dir_migration.py`

## 9. New Module Checklist

- [ ] 新模块是否接收用户、LLM、外部存储或 HTTP 传入的路径片段？
- [ ] 是否使用了 `ConfinedDir` 或 `Workspace.get_file_path()`？
- [ ] 是否避免了 `Path(root) / user_input` 裸拼接？
- [ ] 是否避免了手写 `resolve() + relative_to()` / `is_relative_to()` 模式？（必须用 `ConfinedDir`）
- [ ] 下载 route 是否用 `ConfinedDir.resolve()` 做检查并传给 `send_file()`？
- [ ] 上传 route 是否同时使用 `secure_filename()` 和 `ConfinedDir.resolve()`？
- [ ] 读取宿主文件系统的 Loader 是否注册了多用户禁用规则？
- [ ] 多用户部署是否启用了 `docker` 或 `local` sandbox？

## 10. 已迁移清单

以下位置已从手写 `resolve() + relative_to()` 迁移到 `ConfinedDir`：

| 文件 | 方法 | 迁移方式 |
|------|------|----------|
| `datalake/workspace.py` | `__init__` | 创建 `_confined_root` / `_confined_data` / `_confined_scratch`，暴露属性 |
| `datalake/workspace.py` | `get_file_path` | `self._confined_data.resolve(basename)` |
| `datalake/workspace.py` | `__init__` (legacy root) | `ConfinedDir(root).resolve(safe_id)` |
| `agent_data_loading_chat.py` | `_execute_tool` | `workspace.confined_root` + `workspace.confined_scratch` |
| `agent_data_loading_chat.py` | `_tool_read_file` | `workspace_jail.resolve(rel_path)` |
| `agent_data_loading_chat.py` | `_tool_list_directory` | `workspace_jail.resolve(rel_path)` |
| `agent_data_loading_chat.py` | `_tool_write_file` | `scratch_jail.resolve(filename)` |
| `agent_data_loading_chat.py` | `_tool_execute_python` | `workspace.confined_scratch.resolve(safe_name + ".csv")` |
| `agent_data_loading_chat.py` | `_preview_scratch_files` | `workspace.confined_root.resolve(file_path)` |
| `routes/agents.py` | `scratch_serve` | `workspace.confined_scratch.resolve(filename)` |
| `routes/agents.py` | `scratch_upload` | `workspace.confined_scratch.resolve(final_name)` |
| `cached_azure_blob_workspace.py` | `_cache_path` | `self._cache_jail.resolve(filename)` |
| `knowledge/store.py` | CRUD | `ConfinedDir(user_home / "knowledge" / category)` |
| `agents/reasoning_log.py` | log | `ConfinedDir(DATA_FORMULATOR_HOME / "agent-logs" / date / safe_identity_id)` |
| `local_folder_data_loader.py` | 全文件 | 已使用 `ConfinedDir`（原始采用者） |
