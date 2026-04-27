# 用户隔离纵深防御

> 状态：设计文档
> 最后更新：2026-04-27

## 问题

`ConfinedDir` 解决了"不可信路径不逃逸给定目录"的问题，但它无法防御开发者犯的以下错误：

1. **root 选错了**：`ConfinedDir(Path("/"))` 或 `ConfinedDir(get_data_formulator_home())`——jail 太大，用户 A 可以读到用户 B 的数据。
2. **identity 混淆**：路由取了用户 A 的 identity_id，却传入了用户 B 的 workspace。
3. **工厂方法绕过**：开发者不走 `get_workspace(identity_id)` / `get_user_home(identity_id)`，直接拼路径 `Path("/home/app/data") / user_input`。
4. **共享路径泄露**：把用户级目录路径以字符串形式传给其他模块，其他模块又以此构建新的 `ConfinedDir`，但中间没有验证 identity 一致性。

这些都不是 ConfinedDir 的 bug，而是**调用方的使用错误**。本文档设计一套纵深防御机制，让系统在开发者犯错时仍能兜底。

## 当前架构（基线）

```text
~/.data_formulator/                          ← DATA_FORMULATOR_HOME
├── users/
│   ├── alice/                               ← get_user_home("alice")
│   │   ├── workspaces/
│   │   │   ├── ws-001/                      ← get_workspace("alice") 
│   │   │   │   ├── data/
│   │   │   │   ├── scratch/
│   │   │   │   └── workspace.yaml
│   │   │   └── ws-002/
│   │   ├── connectors/                      ← _connectors_dir("alice")
│   │   ├── catalog_cache/                   ← save_catalog / search_catalog_cache
│   │   ├── knowledge/                       ← [新] KnowledgeStore
│   │   └── agent-logs/                      ← [新] ReasoningLogger
│   └── bob/
│       └── ...
└── shared/                                  ← [未来] 组织级共享资源
```

**现有的隔离机制：**

| 层次 | 机制 | 防御了什么 |
|------|------|------------|
| 身份识别 | `get_identity_id()` 从请求中提取用户标识 | 确定"谁在操作" |
| 路径分配 | `get_user_home(id)` / `get_workspace(id)` 构建用户级路径 | 确定"操作什么" |
| 路径约束 | `ConfinedDir.resolve()` 三层检查 | 路径不逃逸给定目录 |
| 文件名清洗 | `safe_data_filename()` / `secure_filename()` | 文件名不含危险字符 |

**缺失的层次：**

- 没有机制验证"ConfinedDir 的 root 确实是当前用户的目录"
- 没有机制防止"开发者意外把一个用户的路径传给另一个用户的上下文"

---

## 方案一：UserScope — 请求级用户上下文

### 核心思想

引入一个请求级的 `UserScope` 对象，在每个请求入口创建一次，封装当前用户的所有目录入口。开发者从 `UserScope` 取 ConfinedDir 实例，而不是自己创建。

```python
class UserScope:
    """请求级用户目录作用域，所有用户目录的 ConfinedDir 从这里获取。"""

    def __init__(self, identity_id: str):
        self._identity_id = identity_id
        self._home = get_user_home(identity_id)

    @cached_property
    def home(self) -> ConfinedDir:
        """用户主目录 jail — 所有用户级存储的最外层边界。"""
        return ConfinedDir(self._home)

    @cached_property
    def knowledge(self) -> ConfinedDir:
        return ConfinedDir(self._home / "knowledge")

    @cached_property
    def agent_logs(self) -> ConfinedDir:
        return ConfinedDir(self._home / "agent-logs")

    @cached_property
    def connectors(self) -> ConfinedDir:
        return ConfinedDir(self._home / "connectors")

    @cached_property
    def catalog_cache(self) -> ConfinedDir:
        return ConfinedDir(self._home / "catalog_cache")

    @property
    def identity_id(self) -> str:
        return self._identity_id
```

### 使用方式

```python
# 路由层（入口）
from data_formulator.security.user_scope import get_user_scope

@agent_bp.route('/knowledge/list', methods=['POST'])
def knowledge_list():
    scope = get_user_scope()                    # 从 Flask request 自动提取 identity
    store = KnowledgeStore(scope.knowledge)     # 传入 ConfinedDir，不是 Path
    return jsonify(status="ok", data=store.list_all("rules"))

# Agent 内部
class DataAgent:
    def __init__(self, ..., user_scope: UserScope):
        self.reasoning_log = ReasoningLogger(user_scope.agent_logs, ...)
        self.knowledge = KnowledgeStore(user_scope.knowledge)
```

### get_user_scope() 实现

```python
from flask import g

def get_user_scope() -> UserScope:
    """获取当前请求的 UserScope（一个请求只创建一次）。"""
    if not hasattr(g, '_user_scope'):
        identity_id = get_identity_id()
        g._user_scope = UserScope(identity_id)
    return g._user_scope
```

### 好处

1. **开发者不需要自己创建 ConfinedDir** — 从 `UserScope` 拿到的都是正确的、已绑定到当前用户的 ConfinedDir。
2. **根目录不可能选错** — `UserScope` 内部调用 `get_user_home(identity_id)` 构建所有路径，开发者无法传入 `/` 或其他用户的目录。
3. **lazy 创建** — `@cached_property` 只在首次访问时创建目录，不访问的目录不创建。
4. **审计友好** — `UserScope.identity_id` 始终可追溯到具体用户。

---

## 方案二：ConfinedDir 祖先校验

### 核心思想

在 `ConfinedDir.__init__` 中增加一个可选的祖先校验：当设置了全局安全边界时，所有 `ConfinedDir` 实例的 root 必须在该边界内。

```python
_GLOBAL_FENCE: Path | None = None

def set_global_fence(path: Path):
    """应用启动时设置全局安全围栏。所有 ConfinedDir 的 root 必须在此路径内。"""
    global _GLOBAL_FENCE
    _GLOBAL_FENCE = path.resolve()

class ConfinedDir:
    def __init__(self, root, *, mkdir=True):
        self._root = Path(root).resolve()

        # 全局围栏：ConfinedDir 的 root 不能太宽
        if _GLOBAL_FENCE is not None:
            if not self._root.is_relative_to(_GLOBAL_FENCE):
                raise ValueError(
                    f"ConfinedDir root {self._root} is outside the "
                    f"global fence {_GLOBAL_FENCE}"
                )

        if mkdir:
            self._root.mkdir(parents=True, exist_ok=True)
```

### 使用方式

```python
# app.py 启动时
from data_formulator.security.path_safety import set_global_fence

app = Flask(__name__)
set_global_fence(get_data_formulator_home())
```

之后，任何尝试创建 `ConfinedDir(Path("/"))` 或 `ConfinedDir(Path("/etc"))` 都会立即报错，因为它们不在 `~/.data_formulator/` 之内。

### 好处

1. **兜底防御** — 即使开发者手动创建 ConfinedDir，root 也不可能超出应用数据目录。
2. **零改动成本** — 现有代码不需要任何修改，只要在 app 启动时调用一次 `set_global_fence()`。
3. **fail-fast** — 问题在 ConfinedDir 创建时就暴露，不是在运行一段时间后才发现。

### 局限

- 不能防止"root 选对了目录层级，但选了错误用户"（比如 `ConfinedDir(get_user_home("bob"))` 被用在 alice 的请求中）。
- 这就是方案一要解决的问题。

---

## 方案三：Workspace 隐藏内部路径

### 核心思想

当前代码中大量使用 `workspace._path` 来直接访问 workspace 的物理路径：

```python
# 当前 — 路由层和 Agent 直接读取 _path
scratch_dir = workspace._path / "scratch"
workspace_path = self.workspace._path.resolve()
```

`_path` 是一个 `Path` 对象，一旦暴露出来，调用者可以用它做任何事。改为通过 Workspace 暴露 ConfinedDir 属性：

```python
class Workspace:
    @cached_property
    def confined_root(self) -> ConfinedDir:
        return ConfinedDir(self._path, mkdir=False)

    @cached_property
    def confined_scratch(self) -> ConfinedDir:
        return ConfinedDir(self._path / "scratch")

    @cached_property
    def confined_data(self) -> ConfinedDir:
        return ConfinedDir(self._path / "data")
```

Agent 和路由通过这些属性获取 ConfinedDir：

```python
# BEFORE
scratch_dir = workspace._path / "scratch"

# AFTER
scratch_jail = workspace.confined_scratch
target = scratch_jail.resolve(filename)
```

逐步用 `confined_*` 属性替代 `_path` 的直接访问，最终将 `_path` 设为真正的私有（不再被外部引用）。

---

## 方案四：文件访问审计日志

### 核心思想

在 `ConfinedDir.resolve()` 中增加可选的审计回调：记录哪个用户、通过哪个 ConfinedDir、访问了什么路径。

```python
_AUDIT_CALLBACK: Callable | None = None

def set_audit_callback(callback):
    global _AUDIT_CALLBACK
    _AUDIT_CALLBACK = callback

class ConfinedDir:
    def resolve(self, relative, *, mkdir_parents=False):
        # ... 现有的三层安全检查 ...
        
        if _AUDIT_CALLBACK:
            _AUDIT_CALLBACK(
                root=str(self._root),
                relative=relative,
                resolved=str(candidate),
            )
        
        return candidate
```

生产环境可以只采样记录；开发和测试环境可以全量记录并分析是否有跨用户访问。

---

## 推荐实施路径

以上四个方案是互补的，不冲突。按价值/成本排序：

| 优先级 | 方案 | 防御目标 | 实施成本 | 效果 |
|--------|------|----------|----------|------|
| **P0** | 方案二：全局围栏 | ConfinedDir root 不超出应用目录 | 极低（~20 行代码） | 彻底杜绝 `ConfinedDir(Path("/"))` 类错误 |
| **P1** | 方案三：Workspace confined 属性 | 消除 `_path` 裸暴露 | 中（渐进式迁移） | 让 Workspace 外部无法绕过 ConfinedDir |
| **P1** | 方案一：UserScope | identity 和路径绑定 | 中（新增一个类 + 路由层适配） | 杜绝跨用户目录误用 |
| **P2** | 方案四：审计日志 | 运行时检测异常访问 | 低（~30 行代码） | 发现问题而非阻止问题 |

### 分阶段实施

**阶段 A（随 ConfinedDir 迁移一起做，成本几乎为零）：**

- `set_global_fence(get_data_formulator_home())` — 在 `app.py` 启动时调用
- 增加单元测试验证 `ConfinedDir(Path("/"))` 被拒绝

**阶段 B（随知识系统 Phase 2 一起做）：**

- 实现 `UserScope` 类
- 新的知识系统 API 路由使用 `get_user_scope()` 而非手动 `get_user_home(get_identity_id())`
- `KnowledgeStore` 和 `ReasoningLogger` 接受 `ConfinedDir` 而非 `Path`

**阶段 C（渐进式迁移，可跨多个 PR）：**

- `Workspace` 增加 `confined_root` / `confined_scratch` / `confined_data` 属性
- 现有路由和 Agent 逐步从 `workspace._path` 迁移到 `workspace.confined_*`
- 迁移完成后 `_path` 不再被外部直接访问

**阶段 D（可选，运维需求）：**

- 实现审计回调
- CI 中的集成测试检查跨用户访问

---

## 完整防御层次图

```text
请求进入
    │
    ├── 第 1 层：身份识别 ────────────────────────────────
    │   get_identity_id() 从请求头/Session/OIDC 提取用户
    │   → 确定"谁在操作"
    │
    ├── 第 2 层：UserScope 绑定 ──────────────────────────  [新]
    │   get_user_scope() 创建请求级上下文
    │   → 所有用户目录 ConfinedDir 从这里获取
    │   → 杜绝跨用户目录误用
    │
    ├── 第 3 层：全局围栏 ────────────────────────────────  [新]
    │   set_global_fence(DATA_FORMULATOR_HOME)
    │   → ConfinedDir root 不可能超出应用数据目录
    │   → 杜绝 ConfinedDir(Path("/")) 类错误
    │
    ├── 第 4 层：ConfinedDir 路径约束 ───────────────────
    │   resolve() 三层防御：拒绝绝对路径、拒绝 ..、resolve + is_relative_to
    │   → 路径不逃逸给定目录
    │
    ├── 第 5 层：文件名清洗 ─────────────────────────────
    │   safe_data_filename() / secure_filename()
    │   → 文件名不含危险字符
    │
    ├── 第 6 层：Workspace confined 属性 ────────────────  [新]
    │   workspace.confined_scratch / confined_data
    │   → 外部代码无法绕过 ConfinedDir 直接拼路径
    │
    ├── 第 7 层：代码执行隔离 ───────────────────────────
    │   SANDBOX=docker / SANDBOX=local
    │   → LLM 生成的代码在沙箱中执行
    │
    └── 第 8 层：审计日志 ───────────────────────────────  [新]
        ConfinedDir.resolve() 审计回调
        → 运行时检测异常文件访问模式
```

---

## 测试策略

### 全局围栏测试

- 设置围栏后，`ConfinedDir(Path("/"))` 抛 ValueError
- 设置围栏后，`ConfinedDir(fence / "users/alice")` 成功
- 不设围栏时，行为不变（向后兼容）

### UserScope 测试

- `get_user_scope()` 返回正确的 identity_id
- 同一请求内多次调用返回同一实例
- `scope.knowledge.root` 在 `get_user_home(identity)/knowledge/` 内
- 不同用户的 UserScope 目录互不相交

### 跨用户隔离集成测试

- 模拟用户 A 的请求上下文，验证无法通过任何 API 读取用户 B 的知识文件
- 模拟用户 A 的请求上下文，验证无法通过任何 API 读取用户 B 的推理日志
- 验证 ConfinedDir root 始终在当前用户的 home 目录内

---

## 关联文档

- `design-docs/15-agent-knowledge-reasoning-log.md` — Part 5 统一路径安全策略
- `dev-guides/8-path-safety.md` — 路径安全编码规范
- `.cursor/rules/path-safety.mdc` — ConfinedDir 编码规则
