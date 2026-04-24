# ISSUE-002: 任意文件读取漏洞安全审计

> 状态：审计完成，待修复
> 日期：2026-04-24
> 影响范围：路由层、Agent 工具层、数据连接器层

---

## 1. 审计范围

对 `py-src/data_formulator/` 全部后端代码进行任意文件读取（LFI / Path Traversal）漏洞扫描，覆盖：

| 审查维度 | 说明 |
|---------|------|
| HTTP 路由 | `routes/tables.py`、`routes/agents.py`、`routes/sessions.py`、`routes/credentials.py`、`data_connector.py`、`app.py` |
| 文件 I/O 原语 | `open()`、`Path.read_text()`、`read_bytes()`、`pd.read_*`、`send_from_directory`、`send_file` |
| 路径构造 | `os.path.join`、`Path()`、`ConfinedDir`、`safe_data_filename`、`secure_filename` |
| 用户输入追踪 | URL 参数、JSON body、`request.files`、连接器配置 `params`、LLM 工具参数 |

---

## 2. 总体结论

**未发现可直接利用的经典任意文件读取漏洞**（如 `GET /api/xxx?file=/etc/passwd`）。

框架已建立分层防御体系：

- `ConfinedDir`（`security/path_safety.py`）：拒绝绝对路径 → 拒绝 `..` 段 → `resolve()` + `is_relative_to()` 终检
- `safe_data_filename()`（`datalake/parquet_utils.py`）：提取 basename 防路径穿越，保留 Unicode
- `secure_filename()`（werkzeug）：在 identity_id、上传文件名、zip 导入等处使用
- `scratch_serve` / `_tool_read_file`：均有 `resolve()` + `relative_to()` 校验

但存在 **5 项残余风险**，按严重程度排列如下。

---

## 3. 发现列表

### FINDING-1（中风险）：`scratch_serve` 检查与实际发送路径不一致（TOCTOU）

**文件**：`routes/agents.py:1176-1195`

#### 背景：这段代码做什么

`scratch_serve` 是一个 HTTP 下载接口，用于提供 LLM 数据加载 Agent 在 scratch 目录里保存的文件（CSV、图片等）。前端通过 `GET /api/agent/workspace/scratch/report_3a2f1b9c.csv` 来下载。

`scratch_upload`（同文件第 1137 行）负责上传，文件名经 `secure_filename` + hash 处理后保存到 `workspace/scratch/`，然后返回 URL 给前端。`scratch_serve` 则根据 URL 中的 `<path:filename>` 参数找到对应文件并返回。

#### 现有代码

```python
@agent_bp.route('/workspace/scratch/<path:filename>', methods=['GET'])
def scratch_serve(filename):
    from flask import send_from_directory as _send

    identity_id = get_identity_id()
    workspace = get_workspace(identity_id)
    scratch_dir = workspace._path / "scratch"

    # 安全检查：用 resolve() 后的路径判断
    target = (scratch_dir / filename).resolve()
    try:
        target.relative_to(scratch_dir.resolve())
    except ValueError:
        return jsonify(status="error", message="Access denied"), 403

    if not target.exists():
        return jsonify(status="error", message="File not found"), 404

    # ⚠️ 实际发送：用原始的 filename（未经净化）
    return _send(str(scratch_dir), filename)
```

#### 问题

代码中存在**两次路径解析**：

1. **安全检查**（第 1186-1190 行）：`(scratch_dir / filename).resolve()` → `relative_to(scratch_dir.resolve())`，把 `filename` 解析为绝对路径后判断是否在 scratch 内
2. **实际发送**（第 1195 行）：`send_from_directory(str(scratch_dir), filename)`，Flask 内部**再次**用原始 `filename` 做路径拼接和解析

两次解析使用了不同的输入（一次用 resolve 后的 `target`，一次用原始 `filename`），形成 TOCTOU（Time of Check to Time of Use）不一致：

- 安全检查认为路径合法并放行
- 但 `send_from_directory` 用原始 `filename` 再次解析时，如果文件系统状态在两次解析之间发生变化（竞态条件），或者 Flask 内部的路径拼接逻辑与 `Path.resolve()` 行为不同，就可能读到检查时未预期的文件

#### 影响

理论上可通过竞态条件绕过路径限制，读取 scratch 目录之外的文件。实际利用难度较高，需要精确的时序窗口。

#### 修复方案

将 `send_from_directory(dir, filename)`（两参数，内部再解析）改为 `send_file(target)`（单参数，直接用已验证的绝对路径），消除二次解析：

```python
from flask import send_file
return send_file(target)
```

`send_file` 接收 `Path` 对象时会根据扩展名自动推断 `Content-Type`，行为与 `send_from_directory` 一致。

---

### FINDING-2（中风险）：`_tool_read_file` / `_tool_list_directory` 的 base 路径双重 resolve 不一致

**文件**：`agents/agent_data_loading_chat.py:436-500`

#### 背景：这段代码做什么

`agent_data_loading_chat.py` 是"对话式数据加载 Agent"——用户和 AI 对话，AI 可以调用多个工具来帮用户加载数据。其中：

- `_tool_read_file`（第 436 行）：AI 工具，读取工作区内的文件内容
- `_tool_list_directory`（第 479 行）：AI 工具，列出工作区内的目录结构
- `_preview_scratch_files`（第 649 行）：预览 scratch 目录里 AI 生成的 CSV 文件

这些工具的 `args`（如 `args["path"]`）由 LLM 生成，LLM 的输入来自用户消息，因此属于**间接用户可控输入**。

#### 现有代码

三个函数使用同一个模式做路径校验：

```python
# _tool_read_file（第 439、443 行）
target = (workspace_path / rel_path).resolve()       # ← workspace_path 未 resolve
target.relative_to(workspace_path.resolve())          # ← workspace_path 在这里才 resolve

# _tool_list_directory（第 482、485 行）— 同一模式
target = (workspace_path / rel_path).resolve()
target.relative_to(workspace_path.resolve())

# _preview_scratch_files（第 658、660 行）— 同一模式
target = (workspace_path / file_path).resolve()
target.relative_to(workspace_path.resolve())
```

#### 问题

`workspace_path` 被 `resolve()` 了两次，但**两次的上下文不同**：

1. **第一次**（拼接后 resolve）：`(workspace_path / rel_path).resolve()` — 先拼接相对路径，再整体 resolve
2. **第二次**（单独 resolve）：`workspace_path.resolve()` — 对 base 路径单独 resolve

如果 `workspace_path` 自身包含符号链接组件（例如 `/data/link_to_workspaces/user_xxx`，其中 `link_to_workspaces` 是符号链接），两次 `resolve()` 的结果理论上一致（都会把符号链接解析为真实路径），**但这个模式不安全**，原因是：

- 两次 `resolve()` 之间没有原子性保证——如果符号链接在两次调用之间被修改（TOCTOU），base 路径可能不一致
- 代码意图是"target 必须在 workspace 内"，但 base 每次临时计算而非固定，增加了出错的表面积

#### 修复方案

**核心思路**：base 路径只 resolve 一次，在 Agent 初始化时缓存，后续所有工具调用都用缓存后的值。

在 `_execute_tool`（第 415 行）入口处统一 resolve：

```python
def _execute_tool(self, name, args):
    workspace_path = self.workspace._path.resolve()  # ← 一次 resolve，后续复用
    scratch_dir = workspace_path / "scratch"
    scratch_dir.mkdir(exist_ok=True)
    # ...
```

各工具函数中去掉 `workspace_path.resolve()` 的重复调用：

```python
def _tool_read_file(self, args, workspace_path):
    # workspace_path 已由调用方 resolve 过，直接使用
    rel_path = args.get("path", "")
    target = (workspace_path / rel_path).resolve()
    try:
        target.relative_to(workspace_path)    # ← 不再 .resolve()
    except ValueError:
        return {"error": "Access denied: path outside workspace"}
```

**同一改动应用于三个函数**：`_tool_read_file`、`_tool_list_directory`、`_preview_scratch_files`。

---

### FINDING-3（中风险 ↑）：多用户模式必须禁用 `local_folder` 连接器

**风险等级上调**：经复核，该问题在多用户部署下属于**服务器端任意文件读取**，风险等级从低-中上调至**中**。

**文件**：`data_loader/local_folder_data_loader.py:81`

```python
def __init__(self, params: dict[str, Any]):
    self.params = params
    self.root_dir = Path(params.get("root_dir", "")).resolve()
```

**攻击路径**：

1. 攻击者通过 `POST /api/connectors` 创建本地文件夹连接器
2. 设置 `root_dir` 为 `/etc`、`C:\Windows\System32` 等敏感目录
3. 通过 `POST /api/connectors/get-catalog` 列出目录结构
4. 通过 `POST /api/connectors/preview-data` 或 `import-data` 读取任意 CSV/Parquet/Excel 文件

虽然 `ConfinedDir` 确保相对路径不会逃出 `root_dir`，但 `root_dir` 本身没有任何约束。

**适用场景**：

- **桌面单用户部署**：这是预期行为（用户选择本地目录），**无需修复**
- **多用户 / 云部署**：**严重问题**，等于给所有用户开放了服务器文件系统读权限

**决策：多用户模式下彻底禁用 `local_folder` 连接器。**

#### 现有架构分析

连接器注册链路如下：

```
data_loader/__init__.py          # _LOADER_SPECS → DATA_LOADERS / DISABLED_LOADERS 注册表
  ↓
data_connector.py                # register_data_connectors(app) — 启动时调用
  ↓ GET /api/data-loaders        # list_data_loaders() — 前端发现连接器类型
  ↓ POST /api/connectors         # create_connector() — 创建连接器实例
  ↓ POST /api/connectors/connect # 真正初始化 loader、调用 test_connection()
```

关键保护点：

- `pick_local_directory()`（`data_connector.py:460`）已有 `is_local_mode()` 守卫，非本地模式返回 404
- `list_data_loaders()`（`data_connector.py:431`）已跳过 `local_folder`（`if key == "local_folder": continue`）

**但 `POST /api/connectors` 创建连接器时没有对 `type=local_folder` 做模式守卫**——用户可直接构造请求绕过前端限制。

#### 修复方案

在 `data_loader/__init__.py` 的注册表构建阶段，根据运行模式将 `local_folder` 从 `DATA_LOADERS` 移入 `DISABLED_LOADERS`：

```python
# data_loader/__init__.py — 在现有注册循环之后追加

import os

def _enforce_deployment_restrictions():
    """多用户模式下禁用仅限本地的连接器类型。"""
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend != "local" and "local_folder" in DATA_LOADERS:
        del DATA_LOADERS["local_folder"]
        DISABLED_LOADERS["local_folder"] = (
            "local_folder connector is disabled in multi-user mode "
            "(WORKSPACE_BACKEND != 'local')"
        )

_enforce_deployment_restrictions()
```

同时在 `data_connector.py` 的 `create_connector()` 中添加防御性检查，防止注册表被绕过：

```python
# data_connector.py — create_connector() 内部
from data_formulator.data_loader import DATA_LOADERS

@connectors_bp.route("/api/connectors", methods=["POST"])
def create_connector():
    data = request.get_json(force=True)
    loader_type = data.get("type", "")
    # ...
    if loader_type not in DATA_LOADERS:
        return jsonify(status="error", message=f"Unknown or disabled loader type: {loader_type}"), 400
    # ...（现有逻辑）
```

#### 影响评估

| 部署模式 | `local_folder` 状态 | `pick-directory` API | 用户影响 |
|---------|---------------------|---------------------|---------|
| 桌面单用户（`WORKSPACE_BACKEND=local`） | **可用** | 可用 | 无变化，保持现有行为 |
| 多用户 / 云（`WORKSPACE_BACKEND=azure_blob` 等） | **禁用** | 已有 `is_local_mode()` 守卫 | 无法创建本地文件夹连接器 |

#### 验证清单

- [ ] 桌面模式启动 → `GET /api/data-loaders` 响应中 `disabled` 不包含 `local_folder`
- [ ] 多用户模式启动 → `GET /api/data-loaders` 响应中 `disabled` 包含 `local_folder`
- [ ] 多用户模式下 `POST /api/connectors { "type": "local_folder", ... }` 返回 400
- [ ] 多用户模式下 `POST /api/connectors/connect` 传入已有 `local_folder` 配置 → 返回错误
- [ ] 桌面模式下创建/使用 `local_folder` 连接器功能正常

---

### FINDING-4（低风险）：Workspace 路径检查使用字符串前缀比较

**文件**：`datalake/workspace.py:198-204`

```python
resolved = self._path.resolve()
root_resolved = self._root.resolve()
if not str(resolved).startswith(str(root_resolved) + os.sep) and resolved != root_resolved:
    raise ValueError("Path traversal detected: workspace path escapes root directory")
```

**问题**：

`str.startswith()` 做路径包含判断存在经典缺陷——如果根目录为 `/workspace` 而攻击路径为 `/workspace_evil/data`，`startswith("/workspace")` 返回 True 但实际已逃出根目录。

代码中加了 `+ os.sep` 缓解了多数情况，但在 `resolved == root_resolved` 分支（允许相等）和跨平台路径分隔符差异场景下仍有隐患。

**实际利用难度**：低。因为 `identity_id` 已经过 `secure_filename` 净化，难以构造恰好匹配前缀的路径。

**修复建议**：

```python
# Python 3.9+ 的 is_relative_to 更安全
if not resolved.is_relative_to(root_resolved):
    raise ValueError("Path traversal detected: workspace path escapes root directory")
if resolved == root_resolved:
    raise ValueError("identity_id must not resolve to the workspace root itself")
```

---

### FINDING-5（低风险）：无沙箱模式下 LLM 代码执行可间接读取任意文件

**文件**：`agents/agent_data_loading_chat.py` 的 `_tool_execute_python`

**问题**：

当沙箱配置为 `not_a_sandbox`（无隔离模式）时，LLM 生成的 Python 代码在宿主进程中直接执行，可以调用 `open('/etc/passwd').read()` 等任意文件读取操作，所有 `ConfinedDir` / 路径检查均被绕过。

**影响**：取决于部署配置。桌面模式下用户本就拥有本机权限；多用户模式下属于严重提权。

**修复建议**：

- 生产/多用户环境必须启用 `docker_sandbox` 或 `local_sandbox`
- 在应用启动时检测配置，若为多用户模式且沙箱为 `not_a_sandbox`，输出**强警告**或拒绝启动

---

## 4. 审计通过项（无风险）

| 组件 | 文件 | 结论 |
|------|------|------|
| SPA 兜底路由 | `app.py:180-183` | `path` 参数未用于 `send_from_directory`，固定返回 `index.html` |
| 文件上传解析 | `routes/tables.py` `parse_file` / `create_table` | 读取 `request.files` 上传流，非服务器路径 |
| 会话导出 | `routes/sessions.py` `export_session` | `send_file` 发送内存 buffer，下载名为服务端生成 |
| 会话导入 | `datalake/workspace.py` `import_session_zip` | `secure_filename` 分段处理每个路径组件，防止 zip-slip |
| 工作区文件路径 | `workspace.get_file_path()` | `safe_data_filename` 提取 basename + `resolve`/`relative_to` 双重检查 |
| ConfinedDir | `security/path_safety.py` | 三层防御：拒绝绝对路径 → 拒绝 `..` → `resolve` + `is_relative_to` |
| 打开工作区目录 | `routes/tables.py` `open_workspace` | 路径固定为 `get_data_formulator_home()`，不接受用户输入 |
| CSV 导出流 | `routes/tables.py` `_stream_csv_from_duckdb` | 使用 `tempfile.mkstemp` 临时路径 |
| 连接器删除 | `data_connector.py` `DELETE /api/connectors/<id>` | `connector_id` 为逻辑键，不用于 `open()` |
| 凭据存储 | `auth/vault/local_vault.py` | SQLite 路径固定在 `DATA_FORMULATOR_HOME` 下 |

---

## 5. 风险汇总矩阵

| ID | 风险等级 | 类型 | 位置 | 可利用性 | 修复优先级 |
|----|---------|------|------|---------|-----------|
| FINDING-1 | 中 | TOCTOU / 路径不一致 | `routes/agents.py:1195` | 需竞态条件或符号链接 | **P1** |
| FINDING-2 | 中 | 符号链接逃逸 | `agent_data_loading_chat.py:436+` | 需工作区内创建符号链接 | **P1** |
| FINDING-3 | 中 | 多用户模式未禁用本地连接器 | `data_loader/__init__.py` + `data_connector.py` | 可直接利用 | **P1**（多用户）/ 不适用（桌面） |
| FINDING-4 | 低 | 字符串前缀路径检查 | `workspace.py:201` | 极难，需绕过 `secure_filename` | **P3** |
| FINDING-5 | 低 | 沙箱旁路 | `agent_data_loading_chat.py` | 取决于沙箱配置 | **P2**（多用户）/ **P4**（桌面） |

---

## 6. 修复方案

### 6.1 FINDING-1：`scratch_serve` 改用 `send_file`

将 `send_from_directory(dir, filename)`（二次解析）替换为 `send_file(target)`（已验证的绝对路径），消除 TOCTOU：

```python
# routes/agents.py — scratch_serve（第 1195 行）
# 修改前：
return _send(str(scratch_dir), filename)

# 修改后：
from flask import send_file
return send_file(target)
```

改动量：1 行 + import。其余安全检查逻辑不变。

### 6.2 FINDING-2：base 路径一次 resolve + 统一复用

在 `_execute_tool` 入口处统一 resolve，消除各工具函数中的重复 `resolve()` 调用：

```python
# agents/agent_data_loading_chat.py — _execute_tool（第 417 行）
# 修改前：
workspace_path = self.workspace._path

# 修改后：
workspace_path = self.workspace._path.resolve()
```

各工具函数中去掉 `.resolve()` 的重复调用（3 处，模式相同）：

```python
# 修改前（_tool_read_file 第 443 行、_tool_list_directory 第 485 行、_preview_scratch_files 第 660 行）：
target.relative_to(workspace_path.resolve())

# 修改后：
target.relative_to(workspace_path)
```

改动量：4 行。逻辑不变，只是确保 base 路径只 resolve 一次。

### 6.3 FINDING-4：`workspace.py` 改用 `is_relative_to`

```python
# datalake/workspace.py — Workspace.__init__
resolved = self._path.resolve()
root_resolved = self._root.resolve()
if not resolved.is_relative_to(root_resolved) or resolved == root_resolved:
    raise ValueError("Path traversal detected: workspace path escapes root directory")
```

### 6.4 FINDING-3：多用户模式禁用 `local_folder` 连接器

在 `data_loader/__init__.py` 注册表构建后，按运行模式裁剪：

```python
# data_loader/__init__.py — 追加到文件末尾（__all__ 之前）

import os

def _enforce_deployment_restrictions():
    """多用户模式下禁用仅限本地的连接器类型。"""
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend != "local" and "local_folder" in DATA_LOADERS:
        del DATA_LOADERS["local_folder"]
        DISABLED_LOADERS["local_folder"] = (
            "local_folder connector is disabled in multi-user mode "
            "(WORKSPACE_BACKEND != 'local')"
        )

_enforce_deployment_restrictions()
```

在 `data_connector.py` 的 `create_connector()` 中添加防御性校验：

```python
# data_connector.py — create_connector() 入口处
if loader_type not in DATA_LOADERS:
    return jsonify(status="error", message=f"Unknown or disabled loader type: {loader_type}"), 400
```

详细方案、影响评估、验证清单见 §3 FINDING-3。

### 6.5 FINDING-5：多用户模式下的沙箱启动守卫

在 `app.py` 启动阶段添加安全检查，输出强警告日志：

```python
# app.py — 启动时安全检查，在 _register_blueprints() 之后调用
def _safety_checks(app):
    backend = app.config.get('CLI_ARGS', {}).get('workspace_backend', 'local')
    sandbox = app.config.get('CLI_ARGS', {}).get('sandbox', 'not_a_sandbox')
    multi_user = backend != 'local'

    if multi_user and sandbox == 'not_a_sandbox':
        logger.critical(
            "SECURITY WARNING: Multi-user mode with no sandbox is dangerous. "
            "LLM-generated code can read/write arbitrary files on the server. "
            "Set SANDBOX=docker or SANDBOX=local for production deployments."
        )
```

决策：仅强警告（`logger.critical`），不阻止启动。理由是部分开发/测试环境可能需要此配置，强制阻断会增加运维负担。

---

## 7. 工作区隔离整体加固方案

### 7.1 现状分析

当前的用户→工作区隔离链路：

```
HTTP 请求
  → get_identity_id()           # auth/identity.py — 提取当前用户身份
      Provider 成功 → user:<verified_id>
      localhost 模式 → local:<os_username>
      匿名模式     → browser:<X-Identity-Id header>
  → get_workspace(identity_id)  # workspace_factory.py — 映射到用户工作区
      → WorkspaceManager(users/<safe_id>/workspaces/)
      → open_workspace(X-Workspace-Id)  # 该用户下的命名工作区
```

**安全属性**：

- `identity_id` 决定用户级根目录，`X-Workspace-Id` 只在该用户根下选择子工作区
- 不能通过修改 `X-Workspace-Id` header 访问其他用户的工作区
- `identity_id` 经 `_sanitize_identity_id`（`secure_filename`）净化后用于目录名

**薄弱环节**：

- **无统一中间件**：每个路由各自调用 `get_identity_id()` + `get_workspace()`，全靠开发者记得调用。新增路由时忘了检查身份就可能暴露数据
- **匿名模式下 `X-Identity-Id` 可伪造**：知道/猜到别人的 `browser:uuid` 就能冒充该匿名用户，生产环境不应启用匿名模式

### 7.2 加固方案：`before_request` 集中式身份注入

在 `/api/*` 路由上统一完成身份提取和工作区解析，注入 Flask `g` 对象：

```python
# app.py 或新文件 middleware/identity.py

from flask import g, request

def register_identity_middleware(app):
    """在每个 /api/ 请求前自动提取身份并注入 g.identity_id。"""

    # 不需要身份的白名单路由
    _PUBLIC_ENDPOINTS = frozenset({
        "get_sample_datasets",     # GET /api/example-datasets
        "get_auth_info",           # GET /api/auth/info
        "get_app_config",          # GET /api/app-config
        "github_bp.login",         # GET /api/auth/github/login
        "github_bp.callback",      # GET /api/auth/github/callback
    })

    @app.before_request
    def inject_identity():
        if not request.path.startswith("/api/"):
            return  # 静态资源 / SPA 不需要身份
        if request.endpoint in _PUBLIC_ENDPOINTS:
            return

        from data_formulator.auth.identity import get_identity_id
        try:
            g.identity_id = get_identity_id()
        except ValueError as e:
            from flask import jsonify
            return jsonify(status="error", message=str(e)), 401
```

**优点**：

- 新增路由自动获得身份检查，不可能遗漏
- 路由函数可直接用 `g.identity_id`，代码更简洁
- 未认证请求在中间件层就被拦截，路由函数不需要处理认证异常

**迁移策略**：

- 第一阶段：添加 `before_request` 中间件，注入 `g.identity_id`
- 第二阶段：逐步将各路由中的 `get_identity_id()` 调用改为读 `g.identity_id`
- 过渡期两种方式并存，`get_identity_id()` 可在内部优先返回 `g.identity_id`（如果已注入）

### 7.3 可选增强：`@require_workspace` 装饰器

对需要工作区的路由，提供装饰器自动完成 `get_workspace(g.identity_id)` 并注入函数参数：

```python
from functools import wraps
from flask import g

def require_workspace(f):
    """装饰器：自动从 g.identity_id 获取工作区并注入 workspace 参数。"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        from data_formulator.workspace_factory import get_workspace
        kwargs['workspace'] = get_workspace(g.identity_id)
        return f(*args, **kwargs)
    return wrapper

# 使用示例
@tables_bp.route('/list-tables', methods=['GET'])
@require_workspace
def list_tables(workspace):
    # workspace 已经是当前用户的、已认证的工作区
    ...
```

### 7.4 实施优先级

| 阶段 | 内容 | 改动面 |
|------|------|--------|
| P0 | FINDING-1 ~ FINDING-5 的逐点修复 | 小（每个几行） |
| P1 | `before_request` 中间件注入 `g.identity_id` | 中（新增中间件 + 公共端点白名单） |
| P2 | 各路由迁移到 `g.identity_id` + `@require_workspace` | 大（涉及所有路由文件） |

---

## 8. 测试验证清单

### 8.0 FINDING vs 测试覆盖对照

| FINDING | 现有测试覆盖 | 缺口 |
|---------|-------------|------|
| FINDING-1 `scratch_serve` TOCTOU | **无**。没有任何测试针对 `scratch_serve` 的路径穿越 | 需新增 |
| FINDING-2 Agent 工具路径安全 | **部分**。`test_local_folder_loader.py` 有 `test_symlink_escape_rejected` 测试了 `ConfinedDir`，但 `_tool_read_file` / `_tool_list_directory` / `_preview_scratch_files` 没有测试 | 需新增 |
| FINDING-3 `local_folder` 禁用 | **无**。没有测试验证多用户模式下连接器类型被禁用 | 需新增 |
| FINDING-4 字符串前缀检查 | **无**。`Workspace.__init__` 的路径校验没有专门测试 | 需新增 |
| FINDING-5 沙箱启动守卫 | **无**。沙箱测试覆盖了执行限制，但没有测试"配置不安全时的启动行为" | 需新增 |

### 8.1 现有测试覆盖情况（详细）

以下现有测试与本次审计相关，**已覆盖**：

| 测试文件 | 覆盖内容 |
|---------|---------|
| `tests/backend/data/test_local_folder_loader.py` `TestConfinedDir` | `ConfinedDir` 的路径穿越拒绝、符号链接逃逸拒绝（6 个用例） |
| `tests/backend/data/test_safe_data_filename.py` | `safe_data_filename` 提取 basename 防穿越 |
| `tests/backend/auth/test_auth.py` `TestValidateIdentityValue` | `identity_id` 中 `../`、路径分隔符等恶意字符被拒绝 |
| `tests/backend/auth/test_auth_provider_chain.py` | 防止 `user:` 前缀伪造、匿名 fallback 链路 |
| `tests/backend/security/test_sandbox_security.py` | 沙箱内文件写入/进程执行被阻止 |
| `tests/backend/routes/test_credential_routes.py` `TestUserIsolation` | 凭据按用户隔离 |
| `tests/backend/data/test_data_connector_framework.py` `TestIdentityIsolation` | 连接器按用户隔离 |

### 8.2 缺失测试（需新增）

以下按 FINDING 编号列出需要新增的测试用例：

**FINDING-1：`scratch_serve` 路径安全**（建议文件：`tests/backend/security/test_scratch_serve.py`）

- [ ] `test_path_traversal_returns_403`：`GET /api/agent/workspace/scratch/../../../etc/passwd` → 403
- [ ] `test_absolute_path_returns_403`：URL 中嵌入绝对路径 → 403
- [ ] `test_normal_file_served_correctly`：上传文件后正常下载 → 200 + 正确内容
- [ ] `test_nonexistent_file_returns_404`：请求不存在的文件 → 404

**FINDING-2：Agent 工具路径安全**（建议文件：`tests/backend/agents/test_tool_path_safety.py`）

- [ ] `test_read_file_traversal_blocked`：`_tool_read_file({"path": "../../etc/passwd"})` → error
- [ ] `test_list_directory_traversal_blocked`：`_tool_list_directory({"path": "../../"})` → error
- [ ] `test_read_file_normal_path_works`：工作区内合法文件 → 正常返回内容
- [ ] `test_preview_scratch_traversal_blocked`：`_preview_scratch_files` 传入越界路径 → error

**FINDING-3：`local_folder` 部署模式限制**（建议文件：`tests/backend/security/test_local_folder_deployment.py`）

- [ ] `test_multi_user_mode_disables_local_folder`：设置 `WORKSPACE_BACKEND=azure_blob` → `local_folder` 在 `DISABLED_LOADERS` 中
- [ ] `test_local_mode_keeps_local_folder`：设置 `WORKSPACE_BACKEND=local` → `local_folder` 在 `DATA_LOADERS` 中
- [ ] `test_create_connector_rejects_disabled_type`：多用户模式下 `POST /api/connectors { type: "local_folder" }` → 400

**FINDING-4：Workspace 路径检查**（建议文件：`tests/backend/data/test_workspace_path_safety.py`）

- [ ] `test_workspace_init_rejects_traversal_identity`：`identity_id="../admin"` → `ValueError`
- [ ] `test_workspace_path_must_be_under_root`：构造让 `startswith` 通过但 `is_relative_to` 失败的路径 → `ValueError`

**FINDING-5：沙箱启动守卫**（建议文件：`tests/backend/security/test_startup_safety.py`）

- [ ] `test_multi_user_no_sandbox_logs_critical`：`WORKSPACE_BACKEND=azure_blob` + `SANDBOX=not_a_sandbox` → `logger.critical` 被调用
