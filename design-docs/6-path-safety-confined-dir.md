# 服务端路径安全加固 — ConfinedDir 状态页

> **状态**：部分完成，不能删除。
> **最后核对**：2026-04-28
> **正式开发规范**：`dev-guides/8-path-safety.md`
> **历史审计背景**：`design-docs/issues/002-arbitrary-file-read-audit.md`

这份文档原本记录 `ConfinedDir` 的完整设计、问题分析、Before/After 示例和实施计划。
已落地的开发规范已经迁移到 `dev-guides/8-path-safety.md`，本文件只保留尚未完成的实现项和删除条件。

## 1. 已迁移到开发者规范

以下内容已经从 design doc 迁移到 `dev-guides/8-path-safety.md`，后续维护以 dev-guide 为准：

- `ConfinedDir` 的使用场景和防护层次。
- `safe_data_filename()`、`secure_filename()`、`ConfinedDir` 的职责边界。
- 文件下载 route 使用 `send_file(resolved_path)`，禁止用 `send_from_directory(dir, user_input)` 发送用户路径。
- Agent 文件工具通过 `workspace.confined_root` / `workspace.confined_scratch` 复用 `ConfinedDir`。
- 读取宿主文件系统的 Loader 必须注册多用户部署禁用规则。
- 多用户部署不得使用 `not_a_sandbox`。
- 新模块路径安全检查清单和测试要求。

## 2. 已实现项

| 项目 | 当前实现 |
|------|----------|
| `ConfinedDir` 原语 | `py-src/data_formulator/security/path_safety.py` |
| `ConfinedDir` 单元测试 | `tests/backend/data/test_local_folder_loader.py`、`tests/backend/security/test_confined_dir_extended.py`、`tests/backend/security/test_confined_dir_migration.py` |
| `LocalFolderDataLoader` 路径约束 | 使用 `ConfinedDir` 约束 `root_dir` 下的相对访问 |
| `local_folder` 多用户禁用 | `py-src/data_formulator/data_loader/__init__.py::_enforce_deployment_restrictions()` |
| Agent `read_file` / `list_directory` 路径校验 | `py-src/data_formulator/agents/agent_data_loading_chat.py` 使用 `workspace.confined_*` |
| `scratch_serve` 下载 TOCTOU 修复 | `py-src/data_formulator/routes/agents.py` 使用 `send_file(target)` |
| `CachedAzureBlobWorkspace._cache_path()` | 使用 `self._cache_jail.resolve(filename)` |
| `Workspace.get_file_path()` | 使用 `safe_data_filename()` + `self._confined_data.resolve(basename)` |
| 多用户无沙箱启动告警 | `py-src/data_formulator/app.py::_safety_checks()` |
| Cursor 自动提醒规则 | `.cursor/rules/path-safety.mdc` |
| Agent skill | `.cursor/skills/path-safety/SKILL.md` |

## 3. 未完成项

这些项仍来自原设计文档，完成前不要删除本文件。

### 3.1 `AzureBlobWorkspace.local_dir()` 路径穿越

**文件**：`py-src/data_formulator/datalake/azure_blob_workspace.py`

当前仍存在裸拼接：

```python
local_file = tmp_path / rel
```

期望改造：

- 在临时目录上创建 `ConfinedDir(tmp_path, mkdir=False)`。
- 对每个 blob 的相对路径使用 `jail.write(rel, data)`。
- 对非法 blob key 捕获 `ValueError`，记录 warning 并跳过。
- 增加回归测试，验证含 `../` 的 blob 不会写出临时目录。

### 3.2 `AzureBlobWorkspace.save_workspace_snapshot()` 路径穿越

**文件**：`py-src/data_formulator/datalake/azure_blob_workspace.py`

当前仍存在裸拼接：

```python
local_file = dst / rel
```

期望改造：

- 使用 `ConfinedDir(dst)` 管理 snapshot 目标目录。
- 对非法 blob key 捕获 `ValueError`，记录 warning 并跳过。
- 和 `local_dir()` 共用或复用同一组 blob path traversal 回归测试。

### 3.3 `ConfinedDir` 包导出

**文件**：`py-src/data_formulator/security/__init__.py`

当前文件没有导出 `ConfinedDir`。如果希望外部统一从 `data_formulator.security` 导入安全工具，应补充导出：

```python
from data_formulator.security.path_safety import ConfinedDir
```

是否必须导出取决于项目导入风格；当前代码直接从 `data_formulator.security.path_safety` 导入，不影响运行。

### 3.4 `Content-Disposition` 下载名清洗

**文件**：`py-src/data_formulator/routes/tables.py`

当前 `export-table-csv` 仍直接基于 `table_name` 构造 `Content-Disposition`。需要补一个统一 helper，避免引号、CR/LF、目录组件等进入响应头。

建议落地：

- 新增 `py-src/data_formulator/security/http_headers.py`。
- 提供 `safe_download_name(name, fallback="export")` 或等价函数。
- 改造 `export-table-csv`。
- 增加 `tests/backend/security/test_http_headers.py`，覆盖引号、换行、空值、非 ASCII 名称。

## 4. 删除条件

满足以下条件后，本 design doc 可以删除：

- `AzureBlobWorkspace.local_dir()` 使用 `ConfinedDir` 并有回归测试。
- `AzureBlobWorkspace.save_workspace_snapshot()` 使用 `ConfinedDir` 并有回归测试。
- `Content-Disposition` 下载名清洗 helper 和 route 改造完成，并有测试。
- `dev-guides/8-path-safety.md`、`.cursor/skills/path-safety/SKILL.md`、`.cursor/rules/path-safety.mdc` 均不再引用本 design doc 作为规范来源。

## 5. 参考

- `dev-guides/8-path-safety.md` — 当前正式开发者规范。
- `.cursor/skills/path-safety/SKILL.md` — Agent 执行路径安全任务时的操作规范。
- `.cursor/rules/path-safety.mdc` — 编辑相关 Python 文件时的自动提醒规则。
- `design-docs/issues/002-arbitrary-file-read-audit.md` — 安全审计复核与 FINDING-1 至 FINDING-5 当前状态。
