# ISSUE-002: 任意文件读取漏洞安全审计复核

> 状态：✅ 主要风险已修复，仍有 1 项配置型残余风险
> 初次审计日期：2026-04-24
> 复核日期：2026-04-28
> 影响范围：后端路由层、Agent 工具层、数据连接器层、Workspace 路径管理、Sandbox 部署配置

---

## 1. 复核结论

当前代码中未发现可直接利用的经典任意文件读取漏洞，例如通过 HTTP 参数传入 `/etc/passwd`、`C:\Windows\System32\...` 或 `../` 直接读取服务器文件。

原审计中的 FINDING-1 到 FINDING-4 已完成代码修复并有回归测试覆盖：

- 文件下载路由使用 `ConfinedDir.resolve()` 后的安全路径，并传给 `send_file()`。
- Agent 文件读取、目录列出、scratch 预览和写入工具已改用 `Workspace.confined_*` / `ConfinedDir`。
- `local_folder` 连接器在多用户 Workspace backend 下会从 `DATA_LOADERS` 移入 `DISABLED_LOADERS`，手工构造创建请求也无法得到 loader class。
- Workspace 路径校验不再使用字符串前缀比较，改为通过 `ConfinedDir` 约束 root 下的 safe identity。

FINDING-5 仍属于配置型残余风险：仓库中仍保留 `not_a_sandbox` 实现；如果多用户部署绕过 CLI 校验并以 `WORKSPACE_BACKEND != local`、`SANDBOX=not_a_sandbox` 启动，应用目前只输出 `logger.critical` 告警，不会拒绝启动。这不是默认路径，也不是直接 HTTP LFI，但生产部署必须避免该配置。

---

## 2. 当前防御体系

| 防线 | 当前实现 | 结论 |
|------|----------|------|
| 统一路径约束 | `py-src/data_formulator/security/path_safety.py` `ConfinedDir` | 拒绝空路径、绝对路径、`..` 段，并用 `Path.is_relative_to()` 终检符号链接逃逸 |
| Workspace 数据文件 | `Workspace.get_file_path()` | `safe_data_filename()` 提取 basename 后进入 `confined_data.resolve()` |
| Workspace 根/data/scratch | `Workspace.confined_root`、`confined_data`、`confined_scratch` | 统一暴露 `ConfinedDir`，供 route 和 Agent 复用 |
| 文件下载 | `routes/agents.py` `scratch_serve()` | `workspace.confined_scratch.resolve(filename)` 后 `send_file(target)` |
| 文件上传 | `routes/agents.py` `scratch_upload()` | `secure_filename()` + hash 生成文件名，再经 `confined_scratch.resolve()` |
| Agent 工具 | `agents/agent_data_loading_chat.py` | `_execute_tool()` 传入 `confined_root` / `confined_scratch`，工具内部不再手写路径校验 |
| 宿主文件系统 Loader | `data_loader/__init__.py` | 多用户模式禁用 `local_folder` |
| Workspace identity | `datalake/workspace.py` | `secure_filename()` 后使用 `ConfinedDir(root).resolve(safe_id)` 约束 |

---

## 3. Finding 复核表

| ID | 原风险 | 当前状态 | 复核依据 |
|----|--------|----------|----------|
| FINDING-1 | `scratch_serve` 检查路径与发送路径不一致，存在 TOCTOU 风险 | ✅ 已修复 | `scratch_serve()` 使用 `workspace.confined_scratch.resolve(filename)`，并直接 `send_file(target)` |
| FINDING-2 | `_tool_read_file` / `_tool_list_directory` / `_preview_scratch_files` 手写 `resolve() + relative_to()` | ✅ 已修复 | Agent 工具接收 `ConfinedDir`，通过 `workspace_jail.resolve()` 解析路径 |
| FINDING-3 | 多用户模式可手工创建 `local_folder` 连接器并读取服务器本机文件 | ✅ 已修复 | `WORKSPACE_BACKEND != "local"` 时 `_enforce_deployment_restrictions()` 禁用 `local_folder` |
| FINDING-4 | Workspace 路径检查使用字符串前缀比较 | ✅ 已修复 | legacy identity 路径通过 `ConfinedDir(self._root).resolve(self._safe_id)` 校验 |
| FINDING-5 | 多用户模式下无沙箱执行可绕过所有路径检查 | ⚠️ 部分缓解 | 默认/CLI 路径使用 `local` 或 `docker` sandbox；不安全组合会输出 critical 日志，但 module-level WSGI 配置不会硬阻断 |

---

## 4. 关键代码状态

### 4.1 `scratch_serve`

当前实现已消除“检查一个路径、发送另一个路径”的不一致：

```python
@agent_bp.route('/workspace/scratch/<path:filename>', methods=['GET'])
def scratch_serve(filename):
    from flask import send_file

    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)
    scratch_jail = workspace.confined_scratch

    try:
        target = scratch_jail.resolve(filename)
    except ValueError:
        return jsonify(status="error", message="Access denied")

    if not target.exists():
        return jsonify(status="error", message="File not found")

    return send_file(target)
```

测试覆盖：`tests/backend/security/test_scratch_serve.py`

### 4.2 Agent 文件工具

当前工具入口复用 Workspace 上的 `ConfinedDir`，不再把用户/LLM 路径片段直接拼到 `Path` 上：

```python
def _execute_tool(self, name, args):
    workspace_jail = self.workspace.confined_root
    scratch_jail = self.workspace.confined_scratch

    if name == "read_file":
        return self._tool_read_file(args, workspace_jail)
    elif name == "write_file":
        return self._tool_write_file(args, scratch_jail)
    elif name == "list_directory":
        return self._tool_list_directory(args, workspace_jail)
```

测试覆盖：`tests/backend/agents/test_tool_path_safety.py`、`tests/backend/security/test_confined_dir_migration.py`

### 4.3 `local_folder` 部署限制

当前实现将本机文件系统连接器限制在桌面/本地模式：

```python
def _enforce_deployment_restrictions() -> None:
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend != "local" and "local_folder" in DATA_LOADERS:
        del DATA_LOADERS["local_folder"]
        DISABLED_LOADERS["local_folder"] = (
            "local_folder connector is disabled in multi-user mode "
            "(WORKSPACE_BACKEND != 'local')"
        )
```

`create_connector()` 会从 `DATA_LOADERS` 查找 `loader_type`。在多用户模式下 `local_folder` 已不在注册表内，因此会返回 `{"status": "error", "message": "Unknown loader type: local_folder"}`。按统一错误协议，该响应是 HTTP 200，而不是旧文档中写的 HTTP 400。

测试覆盖：`tests/backend/security/test_local_folder_deployment.py`

### 4.4 Workspace 路径校验

legacy identity 路径现在通过 `ConfinedDir` 约束：

```python
self._path = self._root / self._safe_id

root_jail = ConfinedDir(self._root, mkdir=False)
try:
    root_jail.resolve(self._safe_id)
except ValueError:
    raise ValueError(
        "Path traversal detected: workspace path escapes root directory"
    )
```

测试覆盖：`tests/backend/data/test_workspace_path_safety.py`

### 4.5 Sandbox 配置残余风险

当前启动检查：

```python
def _safety_checks():
    cli = app.config.get('CLI_ARGS', {})
    backend = cli.get('workspace_backend', 'local')
    sandbox = cli.get('sandbox', 'not_a_sandbox')
    multi_user = backend != 'local'

    if multi_user and sandbox == 'not_a_sandbox':
        logger.critical(
            "SECURITY WARNING: Multi-user mode with no sandbox is dangerous. "
            "LLM-generated code can read/write arbitrary files on the server. "
            "Set SANDBOX=docker or SANDBOX=local for production deployments."
        )
```

这能让不安全配置在日志中显式暴露，但不是硬性阻断。若后续要把 FINDING-5 完全关闭，应在 module-level 启动路径和 CLI 启动路径统一拒绝 `WORKSPACE_BACKEND != "local" and SANDBOX == "not_a_sandbox"`。

测试覆盖：`tests/backend/security/test_startup_safety.py`

---

## 5. 全局模式复核

本次复核还搜索了以下任意文件读取相关模式：

- `send_from_directory()` / `send_file()`
- `open()` / `Path.read_text()` / `Path.read_bytes()`
- `pd.read_csv()` / `pd.read_excel()` / `pd.read_parquet()`
- `request.args` / `request.form` / `request.files` 进入路径构造
- `relative_to()` / `is_relative_to()` / `str.startswith()` 路径包含判断
- `ConfinedDir` / `safe_data_filename()` / `secure_filename()` 使用点

未发现新的“HTTP 或 LLM 可控路径直接读取服务器任意文件”的入口。搜索结果中的剩余文件 I/O 均属于以下类别：

- 固定或服务端生成路径，例如会话导出、临时 CSV 流式导出、connector 配置文件。
- 上传内容解析，读取的是 `request.files` 或内存 buffer，不是服务器路径。
- Workspace 数据文件读取，经过 `Workspace.get_file_path()` / `ConfinedDir`。
- 沙箱代码执行路径，依赖 sandbox 模式隔离，见 FINDING-5。
- `local_folder` 桌面模式读取本机目录，这是产品预期；多用户模式已禁用。

---

## 6. 验证清单

建议复核命令：

```powershell
python -m pytest tests/backend/security/test_scratch_serve.py `
  tests/backend/agents/test_tool_path_safety.py `
  tests/backend/security/test_local_folder_deployment.py `
  tests/backend/data/test_workspace_path_safety.py `
  tests/backend/security/test_startup_safety.py `
  tests/backend/security/test_confined_dir_migration.py -q
```

已存在的关键测试：

| 测试文件 | 覆盖内容 |
|---------|----------|
| `tests/backend/security/test_scratch_serve.py` | scratch 下载正常路径、`../` 拒绝、缺失文件错误、使用 `send_file()` |
| `tests/backend/agents/test_tool_path_safety.py` | Agent 读文件、列目录、写 scratch、scratch 预览路径约束 |
| `tests/backend/security/test_local_folder_deployment.py` | 本地模式保留 `local_folder`，多用户/ephemeral 模式禁用，手工创建被拒绝 |
| `tests/backend/data/test_workspace_path_safety.py` | identity 路径清洗和 root 约束 |
| `tests/backend/security/test_startup_safety.py` | 多用户 + `not_a_sandbox` critical 日志 |
| `tests/backend/security/test_confined_dir_migration.py` | Workspace、Agent、scratch route、Azure cache 到 `ConfinedDir` 的迁移回归 |

---

## 7. 后续建议

短期不需要继续为 FINDING-1 到 FINDING-4 做代码修复。后续重点应放在部署防线和文档一致性：

- 将 FINDING-5 从“critical 日志告警”升级为“生产/多用户模式拒绝启动”，或者在部署模板中强制 `SANDBOX=local` / `SANDBOX=docker`。
- 保持 `dev-guides/8-path-safety.md` 作为新增路径相关代码的唯一规范入口，禁止重新引入手写 `resolve() + relative_to()`。
- 新增任何读取宿主文件系统的 Loader 时，必须同步更新 `_enforce_deployment_restrictions()` 和对应安全测试。
