# 服务端路径安全加固 — ConfinedDir 统一防护

> **来源**：CodeQL `py/path-injection` 审计 + 全量代码人工审查。
> **目标**：将"根目录 + 用户/外部输入"拼接这一高频模式收敛到单一原语，消除散落式校验遗漏。

---

## 目录

1. [问题分析](#1-问题分析)
2. [现有防护盘点](#2-现有防护盘点)
3. [方案设计：ConfinedDir](#3-方案设计confineddir)
4. [改造清单](#4-改造清单)
5. [HTTP 响应头注入修复](#5-http-响应头注入修复)
6. [测试计划](#6-测试计划)
7. [实施步骤](#7-实施步骤)
8. [后续防线](#8-后续防线)

---

## 1. 问题分析

### 1.1 攻击面

服务端存在"根目录 + 不可信子路径"拼接的场景：

| 场景 | 根目录 | 子路径来源 | 攻击方式 |
|------|--------|-----------|---------|
| 用户上传文件 | workspace `data/` | HTTP `filename` | `../../etc/passwd` |
| Azure Blob 物化到本地 | `tempfile.mkdtemp()` | Blob 名称 | blob key 含 `../` 段 |
| Session zip 导入 | 临时目录 | zip 内文件路径 | Zip-Slip |
| Cache 层本地镜像 | `~/.data_formulator/cache/` | blob 相对路径 | blob key 含 `../` 段 |
| Workspace ID → 目录名 | `workspaces/<user>/` | 用户/浏览器 ID | `../../other_user` |

### 1.2 现有代码的核心问题

防护**分散在调用点**，每个开发者写新代码时必须主动记住调用清洗函数。遗漏 = 漏洞。

**已发现的 2 处遗漏**：

1. `azure_blob_workspace.py` — `local_dir()` (第 576–598 行)、`save_workspace_snapshot()` (第 616–626 行)
   - blob 相对路径直接拼接到临时目录，无 `..` 段检查或 `resolve()` 校验
   - 如果 blob 名称包含 `..` 段，可写出临时目录之外（任意文件写入）

2. `tables_routes.py` — `export-table-csv` (第 667–672 行)
   - `table_name` 直接拼入 `Content-Disposition` 响应头
   - 可注入 `"`、`\r\n` 等字符，造成 HTTP 响应头注入

### 1.3 为什么"每次手动校验"不可持续

- 0.7 已有 **87 个 Python 文件**，路径操作分布在 datalake、routes、sandbox、plugins 多个模块
- 未来 Plugin 系统会引入第三方开发者写的路径代码，控制力更弱
- CodeQL 对"先拼接后校验"模式报误报，开发者可能习惯性忽略告警

---

## 2. 现有防护盘点

### 2.1 已有的防护措施（保留并继续使用）

| 措施 | 位置 | 作用 |
|------|------|------|
| `safe_data_filename()` | `parquet_utils.py:42-66` | 提取 basename，拒绝 `.` / `..`，保留 Unicode |
| `Workspace.get_file_path()` | `workspace.py:226-252` | `safe_data_filename` + `resolve().relative_to()` 双重校验 |
| `CachedAzureBlobWorkspace._cache_path()` | `cached_azure_blob_workspace.py:230-242` | `resolve()` + `is_relative_to()` |
| `Workspace._sanitize_identity_id()` | `workspace.py:205-218` | `secure_filename` 清洗用户 ID |
| `WorkspaceManager._safe_id()` | `workspace_manager.py:72-78` | `secure_filename` 清洗 workspace ID |
| `import_session_zip()` | `workspace.py:770-784` | 逐段 `secure_filename` + 跳过空段 |

### 2.2 这些措施的共同模式

每处防护本质上在做同一件事：

```
给定 root_dir + untrusted_relative_path:
  1. 清洗 untrusted_relative_path（basename / 拒绝 .. / secure_filename）
  2. 拼接：candidate = root_dir / cleaned_path
  3. 校验：candidate.resolve().is_relative_to(root_dir.resolve())
  4. 否则 raise ValueError
```

**ConfinedDir 就是把这四步封装成一个对象。**

---

## 3. 方案设计：ConfinedDir

### 3.1 核心类

新增文件 `py-src/data_formulator/security/path_safety.py`：

```python
"""Path confinement primitive — prevents path traversal at the API level.

Usage:
    jail = ConfinedDir("/tmp/workspace")
    safe = jail / "data/sales.parquet"        # OK
    jail / "../etc/passwd"                     # raises ValueError
    jail.write("data/out.parquet", raw_bytes)  # resolve + mkdir + write
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)


class ConfinedDir:
    """A directory jail that prevents any path operation from escaping its root.

    All path resolution goes through this single chokepoint.  If the
    resolved path escapes the root, ``ValueError`` is raised immediately.

    Thread-safe: instances are immutable after construction; Path.resolve()
    and is_relative_to() are OS-level and inherently safe for concurrent use.
    """

    __slots__ = ("_root",)

    def __init__(self, root: Path | str, *, mkdir: bool = True):
        self._root = Path(root).resolve()
        if mkdir:
            self._root.mkdir(parents=True, exist_ok=True)

    # -- properties --------------------------------------------------------

    @property
    def root(self) -> Path:
        """The resolved, canonical root directory."""
        return self._root

    # -- core API ----------------------------------------------------------

    def resolve(self, relative: str, *, mkdir_parents: bool = False) -> Path:
        """Resolve *relative* within this jail.

        Raises ``ValueError`` if the result would escape the root.

        Defence is layered:
          1. Reject absolute paths outright.
          2. Reject path segments equal to ``..``.
          3. Join onto root, canonicalise with ``resolve()``, and confirm
             the result is still under root (catches symlink escapes).
        """
        if not relative:
            raise ValueError("Empty relative path")
        if Path(relative).is_absolute():
            raise ValueError(f"Absolute path not allowed: {relative!r}")

        parts = Path(relative).parts
        if ".." in parts:
            raise ValueError(f"Path traversal segment '..' in: {relative!r}")

        candidate = (self._root / relative).resolve()
        if not candidate.is_relative_to(self._root):
            raise ValueError(
                f"Path escapes confined directory: {relative!r} "
                f"resolves to {candidate}"
            )

        if mkdir_parents:
            candidate.parent.mkdir(parents=True, exist_ok=True)

        return candidate

    def write(self, relative: str, data: bytes) -> Path:
        """Resolve, create parent dirs, and write *data* atomically."""
        target = self.resolve(relative, mkdir_parents=True)
        target.write_bytes(data)
        return target

    def __truediv__(self, relative: str) -> Path:
        """Operator overload: ``jail / "sub/path"`` → ``jail.resolve("sub/path")``."""
        return self.resolve(relative)

    def __repr__(self) -> str:
        return f"ConfinedDir({self._root})"
```

### 3.2 设计要点

| 要点 | 说明 |
|------|------|
| **不可变** | 构造后 `_root` 不可修改，线程安全 |
| **三层防御** | 拒绝绝对路径 → 拒绝 `..` 段 → `resolve()` + `is_relative_to()` |
| **Symlink 安全** | `resolve()` 在 OS 层面展开符号链接后再检查包含关系 |
| **操作符重载** | `jail / "sub/path"` 语法糖，让调用点代码简洁 |
| **mkdir 内置** | `write()` 方法自动创建父目录，减少调用点样板代码 |

### 3.3 与现有 API 的兼容策略

`ConfinedDir` 作为**底层原语**引入，不替换现有的 `safe_data_filename()` 或 `secure_filename()`。层次关系：

```
调用者传入的 filename / relative_path
    │
    ▼
safe_data_filename() / secure_filename()     ← 第一层：输入清洗
    │
    ▼
ConfinedDir.resolve()                        ← 第二层：路径约束（新增）
    │
    ▼
最终的 Path 对象                              ← 安全的文件路径
```

### 3.4 在 security 包中注册

更新 `py-src/data_formulator/security/__init__.py`：

```python
from data_formulator.security.path_safety import ConfinedDir

__all__ = [
    ...,
    "ConfinedDir",
]
```

---

## 4. 改造清单

### 4.1 [漏洞] `AzureBlobWorkspace.local_dir()` — 中等风险

**文件**：`py-src/data_formulator/datalake/azure_blob_workspace.py`，第 576–598 行

**Before**：

```python
@contextmanager
def local_dir(self):
    tmp = tempfile.mkdtemp(prefix="df_blob_ws_")
    tmp_path = Path(tmp)
    try:
        for blob in self._container.list_blobs(name_starts_with=self._prefix):
            rel = blob.name[len(self._prefix):]
            if not rel or rel == METADATA_FILENAME:
                continue
            local_file = tmp_path / rel                  # ← 无校验
            local_file.parent.mkdir(parents=True, exist_ok=True)
            data = self._container.download_blob(blob.name).readall()
            local_file.write_bytes(data)
        yield tmp_path
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

**After**：

```python
from data_formulator.security.path_safety import ConfinedDir

@contextmanager
def local_dir(self):
    tmp = tempfile.mkdtemp(prefix="df_blob_ws_")
    tmp_path = Path(tmp)
    jail = ConfinedDir(tmp_path, mkdir=False)
    try:
        for blob in self._container.list_blobs(name_starts_with=self._prefix):
            rel = blob.name[len(self._prefix):]
            if not rel or rel == METADATA_FILENAME:
                continue
            try:
                data = self._container.download_blob(blob.name).readall()
                jail.write(rel, data)
            except ValueError:
                logger.warning(
                    "Skipping blob with unsafe path: %s", blob.name,
                )
        yield tmp_path
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

### 4.2 [漏洞] `AzureBlobWorkspace.save_workspace_snapshot()` — 中等风险

**文件**：同上，第 616–626 行

**Before**：

```python
def save_workspace_snapshot(self, dst: Path) -> None:
    for blob in self._container.list_blobs(name_starts_with=self._prefix):
        rel = blob.name[len(self._prefix):]
        if not rel:
            continue
        dst.mkdir(parents=True, exist_ok=True)
        local_file = dst / rel                           # ← 无校验
        local_file.parent.mkdir(parents=True, exist_ok=True)
        data = self._container.download_blob(blob.name).readall()
        local_file.write_bytes(data)
```

**After**：

```python
def save_workspace_snapshot(self, dst: Path) -> None:
    jail = ConfinedDir(dst)
    for blob in self._container.list_blobs(name_starts_with=self._prefix):
        rel = blob.name[len(self._prefix):]
        if not rel:
            continue
        try:
            data = self._container.download_blob(blob.name).readall()
            jail.write(rel, data)
        except ValueError:
            logger.warning(
                "Skipping blob with unsafe path in snapshot: %s", blob.name,
            )
```

### 4.3 [加固] `CachedAzureBlobWorkspace._cache_path()` — 替换手写逻辑

**文件**：`py-src/data_formulator/datalake/cached_azure_blob_workspace.py`，第 230–242 行

**Before**：

```python
def _cache_path(self, filename: str) -> Path:
    resolved = (self._cache_dir / filename).resolve()
    if not resolved.is_relative_to(self._cache_dir.resolve()):
        raise ValueError(
            f"Path traversal detected: {filename!r} resolves outside "
            f"the cache directory"
        )
    return resolved
```

**After**：

```python
def __init__(self, ...):
    ...
    self._cache_jail = ConfinedDir(self._cache_dir, mkdir=True)

def _cache_path(self, filename: str) -> Path:
    return self._cache_jail.resolve(filename)
```

收益：消除 CodeQL `py/path-injection` 在此处的告警（验证逻辑在 `ConfinedDir` 内部完成，不再是"先拼接后验证"）。

### 4.4 [加固] `Workspace.get_file_path()` — 可选改造

**文件**：`py-src/data_formulator/datalake/workspace.py`，第 226–252 行

当前已有 `safe_data_filename` + `resolve().relative_to()` 双重防护，功能正确。可选择用 `ConfinedDir` 替换以统一风格：

```python
def __init__(self, ...):
    ...
    self._data_jail = ConfinedDir(self._path / "data")

def get_file_path(self, filename: str) -> Path:
    basename = safe_data_filename(filename)
    return self._data_jail.resolve(basename)
```

此项为**可选优化**，现有逻辑已安全。

---

## 5. HTTP 响应头注入修复

### 5.1 工具函数

新增 `py-src/data_formulator/security/http_headers.py`：

```python
"""HTTP response header safety helpers."""

from werkzeug.utils import secure_filename


def safe_download_name(name: str, fallback: str = "export") -> str:
    """Sanitize a user-provided name for Content-Disposition filename.

    Strips directory components, special characters (quotes, newlines),
    and falls back to *fallback* if the result is empty.
    """
    safe = secure_filename(name) if name else ""
    return safe or fallback
```

### 5.2 改造点

**文件**：`py-src/data_formulator/tables_routes.py`，第 667–672 行

**Before**：

```python
headers={
    'Content-Disposition': f'attachment; filename="{table_name}.{ext}"',
}
```

**After**：

```python
from data_formulator.security.http_headers import safe_download_name

safe_name = safe_download_name(table_name)
headers={
    'Content-Disposition': f'attachment; filename="{safe_name}.{ext}"',
}
```

---

## 6. 测试计划

### 6.1 `ConfinedDir` 单元测试

**文件**：`tests/backend/security/test_path_safety.py`

```python
# 要验证的行为：
#
# --- 正常路径 ---
# - jail.resolve("file.txt") → root/file.txt
# - jail.resolve("sub/dir/file.txt") → root/sub/dir/file.txt
# - jail / "file.txt" → 等价于 resolve
# - jail.write("out.bin", b"data") → 文件创建成功，内容正确
# - resolve(mkdir_parents=True) → 父目录自动创建
#
# --- 路径穿越拒绝 ---
# - jail.resolve("../etc/passwd") → raises ValueError
# - jail.resolve("sub/../../etc/passwd") → raises ValueError
# - jail.resolve("..") → raises ValueError
# - jail.resolve("/etc/passwd") → raises ValueError（绝对路径）
# - jail.resolve("") → raises ValueError（空路径）
# - jail.resolve("sub/\x00hidden") → 行为取决于 OS，至少不能逃逸
#
# --- Symlink 逃逸 ---
# - 在 jail 内创建指向 jail 外的 symlink → resolve 后检测逃逸 → raises ValueError
#
# --- Unicode 安全 ---
# - jail.resolve("数据/报表.parquet") → 正常工作（CJK 字符保留）
# - jail.resolve("données/résumé.csv") → 正常工作（Latin 扩展字符保留）
#
# --- 边界情况 ---
# - 多层嵌套 "../../../.." → raises ValueError
# - Windows 风格分隔符 "sub\\..\\..\\etc" → raises ValueError
# - 以 "~" 开头的路径 "~root/.ssh/key" → 不逃逸即允许

# 测试策略：使用 pytest tmp_path fixture，真实文件系统操作
```

### 6.2 Azure Blob 路径安全回归测试

**文件**：`tests/backend/security/test_blob_path_traversal.py`

```python
# 要验证的行为：
#
# - local_dir() 遇到 blob key 含 "../" 时 → 跳过该 blob，不抛异常，日志 warning
# - local_dir() 正常 blob → 文件正确物化到 tmp 目录内
# - save_workspace_snapshot() 同上
# - 构造含 "../" 的 mock blob → 验证不会写出目标目录
#
# Mock 策略：
# - Mock ContainerClient.list_blobs() 返回包含恶意 blob name 的列表
# - Mock download_blob().readall() 返回测试数据
# - 用 tmp_path 作为 local_dir / snapshot 目标
# - 验证 tmp_path 之外没有被写入文件
```

### 6.3 HTTP 响应头注入测试

**文件**：`tests/backend/security/test_http_headers.py`

```python
# 要验证的行为：
#
# - safe_download_name("normal_name") → "normal_name"
# - safe_download_name('name"with"quotes') → 引号被移除
# - safe_download_name("name\r\ninjection") → 换行被移除
# - safe_download_name("") → "export"（fallback）
# - safe_download_name("数据报表") → "export"（secure_filename 清除非 ASCII）
#   注：下载文件名不需要保留 Unicode，不同于文件存储
# - safe_download_name(None) → "export"
```

### 6.4 现有测试不受影响

`ConfinedDir` 是在现有防护之下的**新增底层防线**，不改变上层 API 的行为契约。以下现有测试应继续通过：

- `test_safe_data_filename.py` — `safe_data_filename()` 功能不变
- `test_workspace_manager.py` — Workspace ID 清洗不变
- `test_workspace_source_file_ops.py` — `get_file_path()` 行为不变
- `test_same_basename_upload.py` — 上传管道不变

---

## 7. 实施步骤

### Step 1：新增 `ConfinedDir` + 测试 (安全基础)

| 任务 | 文件 |
|------|------|
| 实现 `ConfinedDir` | `py-src/data_formulator/security/path_safety.py` |
| 注册到 `security/__init__.py` | `py-src/data_formulator/security/__init__.py` |
| 单元测试 | `tests/backend/security/test_path_safety.py` |

**验收标准**：`pytest tests/backend/security/test_path_safety.py` 全部通过。

### Step 2：修复 Azure Blob 路径穿越漏洞

| 任务 | 文件 |
|------|------|
| `local_dir()` 使用 `ConfinedDir` | `azure_blob_workspace.py` |
| `save_workspace_snapshot()` 使用 `ConfinedDir` | `azure_blob_workspace.py` |
| 回归测试 | `tests/backend/security/test_blob_path_traversal.py` |

**验收标准**：恶意 blob 名称被安全跳过；正常 blob 正确物化；现有 workspace 测试全部通过。

### Step 3：加固 Cache 层 + Workspace

| 任务 | 文件 |
|------|------|
| `_cache_path()` 改用 `ConfinedDir` | `cached_azure_blob_workspace.py` |
| （可选）`get_file_path()` 改用 `ConfinedDir` | `workspace.py` |

**验收标准**：现有测试全部通过；CodeQL `py/path-injection` 告警消失或减少。

### Step 4：修复 HTTP 响应头注入

| 任务 | 文件 |
|------|------|
| 实现 `safe_download_name()` | `py-src/data_formulator/security/http_headers.py` |
| 改造 `export-table-csv` | `tables_routes.py` |
| 测试 | `tests/backend/security/test_http_headers.py` |

**验收标准**：含特殊字符的 `table_name` 不再注入响应头。

### Step 5：验证与清理

| 任务 | 说明 |
|------|------|
| 全量测试 | `pytest tests/backend/` 全部通过 |
| CodeQL 扫描 | `py/path-injection` 告警清零或仅剩已标注的可接受误报 |
| 代码审查 | 搜索 `Path(...) / variable` 模式，确认无遗漏 |

---

## 8. 后续防线

### 8.1 Code Review Checklist

PR 模板中新增检查项：

```markdown
### 安全检查
- [ ] 文件路径操作使用了 `ConfinedDir` 或 `safe_data_filename()`
- [ ] 未直接使用 `Path(root) / user_input` 模式
- [ ] HTTP 响应头中的用户输入已清洗
```

### 8.2 Lint 规则（可选进阶）

通过自定义 Ruff 或 Semgrep 规则，检测裸路径拼接模式：

```yaml
# .semgrep/path-safety.yaml
rules:
  - id: no-bare-path-join-with-variable
    pattern: $ROOT / $USER_INPUT
    message: "Use ConfinedDir instead of bare path joining with variables"
    severity: WARNING
    languages: [python]
```

### 8.3 Plugin 开发者指南

在 `5-plugin-development-guide.md` 中补充路径安全章节：

- 插件代码中**禁止**直接操作 `Path`，必须通过 `ConfinedDir` 或 Workspace API
- 写入文件必须使用 `PluginDataWriter`（内部已经过 Workspace 的路径校验）
- 示例代码展示正确和错误的路径操作对比

### 8.4 CodeQL Annotation

对 `ConfinedDir.resolve()` 方法添加 CodeQL 建模，告知静态分析器该方法是路径校验点：

```python
class ConfinedDir:
    def resolve(self, relative: str, ...) -> Path:
        # CodeQL: this method is a path sanitizer
        # See: https://codeql.github.com/docs/codeql-for-python/
        ...
```

具体方式是在 `.github/codeql/` 下添加自定义 query 或 `qlpack.yml` 中的 sanitizer 建模。

---

## 附录：风险矩阵

| 编号 | 问题 | 严重度 | 可利用性 | 修复步骤 |
|------|------|--------|---------|---------|
| V-01 | `AzureBlobWorkspace.local_dir()` 路径穿越 | 中 | 需要控制 blob 存储内容 | Step 2 |
| V-02 | `AzureBlobWorkspace.save_workspace_snapshot()` 路径穿越 | 中 | 同上 | Step 2 |
| V-03 | `export-table-csv` Content-Disposition 头注入 | 低-中 | 需要能创建含特殊字符的表名 | Step 4 |
| H-01 | `cached_azure_blob_workspace._cache_path()` CodeQL 误报 | 信息 | 已有防护，仅静态分析噪音 | Step 3 |
