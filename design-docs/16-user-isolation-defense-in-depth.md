# 用户隔离纵深防御

> **状态：部分完成** — 2026-05

## 已实现

### Workspace confined 属性（原方案三）

`Workspace` 已暴露 `confined_root`、`confined_data`、`confined_scratch` 三个 `ConfinedDir` 属性。外部调用方（routes、agents）已全部迁移到 `workspace.confined_*`，`workspace._path` 不再被外部直接访问。

- 实现位置：`workspace.py` L215-264
- 测试：`test_confined_dir_migration.py`、`test_tool_path_safety.py`

### 现有基线防御

| 层次 | 机制 | 防御了什么 |
|------|------|------------|
| 身份识别 | `get_identity_id()` | 确定"谁在操作" |
| 路径分配 | `get_user_home(id)` / `get_workspace(id)` | 确定"操作什么" |
| 路径约束 | `ConfinedDir.resolve()` 三层检查 | 路径不逃逸给定目录 |
| 文件名清洗 | `safe_data_filename()` / `secure_filename()` | 文件名不含危险字符 |
| Workspace confined 属性 | `workspace.confined_*` | 外部代码无法绕过 ConfinedDir 直接拼路径 |

---

## 待实现

### P0：全局围栏（原方案二）

在 `ConfinedDir.__init__` 中增加全局边界校验，所有 ConfinedDir 的 root 必须在 `DATA_FORMULATOR_HOME` 内。成本极低（~20 行），彻底杜绝 `ConfinedDir(Path("/"))` 类错误。

```python
_GLOBAL_FENCE: Path | None = None

def set_global_fence(path: Path):
    global _GLOBAL_FENCE
    _GLOBAL_FENCE = path.resolve()

# ConfinedDir.__init__ 中:
if _GLOBAL_FENCE is not None:
    if not self._root.is_relative_to(_GLOBAL_FENCE):
        raise ValueError(f"ConfinedDir root {self._root} outside fence {_GLOBAL_FENCE}")
```

在 `app.py` 启动时调用 `set_global_fence(get_data_formulator_home())`。

### P1：UserScope — 请求级用户上下文（原方案一）

引入请求级 `UserScope` 对象，封装当前用户的所有目录入口。开发者从 `UserScope` 取 ConfinedDir，而非自己调用 `get_user_home()` + `ConfinedDir()`。

防御目标：杜绝跨用户目录误用（root 层级正确但选了错误用户）。

### P2：审计日志（原方案四，可选）

在 `ConfinedDir.resolve()` 中增加审计回调，记录文件访问模式，辅助运行时检测异常。属于运维增强，优先级最低。

---

## 关联文档

- `dev-guides/8-path-safety.md` — 路径安全编码规范
- `.cursor/rules/path-safety.mdc` — ConfinedDir 编码规则
