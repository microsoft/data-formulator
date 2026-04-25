---
name: path-safety
description: 服务端路径安全与文件访问编码规范。在编写文件下载路由、Agent 工具（文件读取/目录列出）、数据连接器/Loader、Workspace 路径操作、沙箱配置时使用。
---

# Path Safety — 服务端安全编码规范

> **来源**：`dev-guides/8-path-safety.md`（正式开发规范）+ `design-docs/issues/002-arbitrary-file-read-audit.md`（安全审计）。
> 本文档提炼了 5 条必须遵守的编码规范。违反任一条即可能引入路径穿越（LFI）漏洞。

---

## R1. 文件下载：用 `send_file`，禁用 `send_from_directory`

**原因**：`send_from_directory(dir, user_input)` 内部会对 `user_input` 二次解析路径，与前置安全检查形成 TOCTOU 不一致。

```python
# ❌ BAD — 安全检查用 resolved target，发送用原始 filename，两次解析不一致
target = (scratch_dir / filename).resolve()
target.relative_to(scratch_dir.resolve())  # 检查通过
return send_from_directory(str(scratch_dir), filename)  # 再次解析

# ✅ GOOD — 检查和发送用同一个 resolved path
target = (scratch_dir / filename).resolve()
target.relative_to(scratch_dir.resolve())  # 检查通过
return send_file(target)  # 直接用已验证的路径
```

`send_file(Path)` 会根据扩展名自动推断 MIME type，无需额外处理。

---

## R2. 路径安全检查：用 `is_relative_to`，禁止 `str.startswith`

**原因**：`str(path).startswith(str(root))` 存在前缀碰撞缺陷（如 `/workspace` vs `/workspace_evil`）。

```python
# ❌ BAD
if not str(resolved).startswith(str(root_resolved) + os.sep):
    raise ValueError("escape")

# ✅ GOOD（Python 3.9+）
if not resolved.is_relative_to(root_resolved):
    raise ValueError("escape")
```

---

## R3. Base 路径只 resolve 一次

**原因**：对 base 路径多次调用 `resolve()` 存在 TOCTOU 风险——如果 base 路径含符号链接，两次 resolve 之间链接可能被修改。

```python
# ❌ BAD — workspace_path 在不同地方分别 resolve
def _tool_read_file(self, args, workspace_path):
    target = (workspace_path / rel_path).resolve()
    target.relative_to(workspace_path.resolve())  # 又 resolve 一次

# ✅ GOOD — 在入口统一 resolve，后续直接使用
def _execute_tool(self, name, args):
    workspace_path = self.workspace._path.resolve()  # 一次
    # ...传给各工具函数

def _tool_read_file(self, args, workspace_path):
    target = (workspace_path / rel_path).resolve()
    target.relative_to(workspace_path)  # workspace_path 已是 resolved
```

---

## R4. 优先使用 `ConfinedDir`，禁止裸路径拼接

**原因**：`Path(root) / user_input` 是路径穿越的高频入口。`ConfinedDir` 封装了三层防御（拒绝绝对路径 → 拒绝 `..` 段 → `resolve` + `is_relative_to`）。

```python
from data_formulator.security.path_safety import ConfinedDir

# ❌ BAD — 手动拼接 + 手动校验，容易遗漏
local_file = tmp_path / blob_relative_name
local_file.parent.mkdir(parents=True, exist_ok=True)
local_file.write_bytes(data)

# ✅ GOOD — ConfinedDir 自动校验 + 创建父目录
jail = ConfinedDir(tmp_path, mkdir=False)
jail.write(blob_relative_name, data)  # 自动校验 + 写入
```

### 已有安全 API 的层次关系

```
用户输入（filename / relative_path / blob key）
    │
    ▼
safe_data_filename() / secure_filename()     ← 第一层：输入清洗
    │
    ▼
ConfinedDir.resolve()                        ← 第二层：路径约束
    │
    ▼
安全的 Path 对象
```

使用 `Workspace.get_file_path()` 的场景不需要手动调用 `ConfinedDir`，因为它内部已包含等价的校验。

---

## R5. 宿主文件系统访问必须设部署模式守卫

**原因**：桌面单用户模式允许访问本机文件系统（预期行为），但多用户/云部署下等于开放服务器读权限。

**规范**：任何新的 Loader / Connector 如果涉及直接读取宿主文件系统（不通过 Workspace API），必须：

1. 在 `data_loader/__init__.py` 的 `_enforce_deployment_restrictions()` 中注册禁用规则
2. 确保 `create_connector()` 会拒绝已禁用的类型

```python
# data_loader/__init__.py — 参考 local_folder 的处理方式
def _enforce_deployment_restrictions():
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend != "local":
        for key in ("local_folder", "your_new_local_loader"):
            if key in DATA_LOADERS:
                del DATA_LOADERS[key]
                DISABLED_LOADERS[key] = f"{key} disabled in multi-user mode"
```

**判断标准**：如果 Loader 的构造函数接受一个用户可控的本机路径（如 `root_dir`），它就需要部署守卫。

---

## R6. 多用户部署必须启用沙箱

**原因**：`not_a_sandbox` 模式下 LLM 生成的代码在宿主进程直接执行，可绕过所有路径检查。

`app.py` 已在启动时检测此配置并输出 `logger.critical` 警告。新增的沙箱模式或部署脚本应确保：

- `WORKSPACE_BACKEND != "local"` 时，`SANDBOX` 必须为 `docker` 或 `local`
- CI/CD 部署模板中默认设置 `SANDBOX=docker`

---

## 速查：新增代码时的安全检查清单

| 场景 | 必须做的事 |
|------|-----------|
| 新增文件下载路由 | 用 `send_file(resolved_path)`，不用 `send_from_directory` |
| 新增 Agent 工具（读文件/列目录） | base 路径在入口 `resolve()` 一次，用 `relative_to` 校验 |
| 路径包含判断 | 用 `Path.is_relative_to()`，不用 `str.startswith()` |
| `Path(root) / variable` 模式 | 改用 `ConfinedDir` 或 `Workspace.get_file_path()` |
| 新增本机文件系统 Loader | 在 `_enforce_deployment_restrictions()` 中注册多用户禁用 |
| 部署配置 | 多用户模式必须 `SANDBOX=docker` 或 `SANDBOX=local` |

---

## 参考文档

- `dev-guides/8-path-safety.md` — 服务端路径安全开发规范
- `design-docs/6-path-safety-confined-dir.md` — 剩余未完成实现项状态页
- `design-docs/issues/002-arbitrary-file-read-audit.md` — 完整安全审计报告
- `py-src/data_formulator/security/path_safety.py` — ConfinedDir 源码
