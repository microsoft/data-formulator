# 服务端路径安全开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-26
> **适用范围**: 后端 route、Agent 工具、Workspace 文件访问、Data Loader、Sandbox、插件文件 I/O

## 1. 核心原则

任何把“不可信路径片段”拼到“服务端根目录”上的代码，都必须先经过统一路径约束。

| 场景 | 规范 |
|------|------|
| Workspace data 文件 | 优先使用 `Workspace.get_file_path()` |
| 任意 root + relative path | 使用 `ConfinedDir` |
| 文件下载 route | 校验 resolved path 后传给 `send_file()` |
| Agent 读文件/列目录工具 | base path 在入口 `resolve()` 一次，后续复用 |
| 读取宿主文件系统的 Loader | 必须注册多用户部署禁用规则 |
| Sandbox 部署 | 多用户模式不得使用 `not_a_sandbox` |

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

使用 `Workspace.get_file_path(filename)` 的场景不需要手动调用 `ConfinedDir`，因为它已包含 `safe_data_filename()` 和路径包含校验。

## 4. 文件下载 Route

下载接口必须让安全检查和实际发送使用同一个 resolved path。

```python
from flask import send_file

scratch_root = scratch_dir.resolve()
target = (scratch_root / filename).resolve()
if not target.is_relative_to(scratch_root):
    return jsonify(status="error", message="Access denied")

return send_file(target)
```

禁止在用户路径上使用 `send_from_directory(dir, filename)`。它会在 Flask 内部再次解析原始 `filename`，容易和前置安全检查形成 TOCTOU 不一致。

如果文件名来自用户输入并写入 `Content-Disposition`，不得直接插值原始字符串。新代码应先建立统一 helper，去除 CR/LF、引号和目录组件，并为非 ASCII 名称提供安全 fallback 或 `filename*` 编码。

## 5. Agent 工具

Agent 工具参数由 LLM 生成，LLM 输入又来自用户，因此路径参数一律视为不可信。

入口函数应先固定 resolved base path：

```python
def _execute_tool(self, name, args):
    workspace_path = self.workspace._path.resolve()
    scratch_dir = workspace_path / "scratch"
    scratch_dir.mkdir(exist_ok=True)
    ...
```

具体工具只复用这个 resolved base：

```python
target = (workspace_path / rel_path).resolve()
try:
    target.relative_to(workspace_path)
except ValueError:
    return {"error": "Access denied: path outside workspace"}
```

不要在工具函数内部反复调用 `workspace_path.resolve()`。base 路径多次 resolve 会扩大 TOCTOU 表面积。

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

## 9. New Module Checklist

- [ ] 新模块是否接收用户、LLM、外部存储或 HTTP 传入的路径片段？
- [ ] 是否使用了 `ConfinedDir` 或 `Workspace.get_file_path()`？
- [ ] 是否避免了 `Path(root) / user_input` 裸拼接？
- [ ] 路径包含判断是否使用 `Path.is_relative_to()`，而不是 `str.startswith()`？
- [ ] 下载 route 是否用同一个 resolved path 做检查和 `send_file()`？
- [ ] 读取宿主文件系统的 Loader 是否注册了多用户禁用规则？
- [ ] 多用户部署是否启用了 `docker` 或 `local` sandbox？
