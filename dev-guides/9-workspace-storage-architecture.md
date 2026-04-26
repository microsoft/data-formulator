# 9 — Workspace Storage Architecture

> **Scope**: 磁盘目录结构、每个持久化文件的职责、WorkspaceManager 与 Workspace 的分工、
> 三种后端模式（local / azure_blob / ephemeral）的差异。

---

## 1. 整体目录结构

```
DATA_FORMULATOR_HOME/                        # 默认 ~/.data_formulator，可通过 --data-dir 覆盖
├── credentials.db                           # SQLite — 加密的 Data Connector 凭据
├── .vault_key                               # AES 密钥，用于加解密 credentials.db
├── connectors.yaml                          # 管理员级 Data Connector 配置（全局）
│
└── users/
    └── <identity_id>/                       # 每个用户一个目录
        ├── connectors.yaml                  # 用户级 Data Connector 配置
        └── workspaces/
            └── <workspace_id>/              # 每个 workspace 一个目录
                ├── workspace_meta.json      # 轻量索引 — 用于列表页快速展示
                ├── workspace.yaml           # 表元数据 — 后端数据层的核心索引
                ├── session_state.json       # 前端 Redux 状态快照
                ├── .workspace.lock          # 并发写锁（运行时产生）
                └── data/
                    ├── gapminder.parquet
                    ├── sales_data.parquet
                    └── query_1.xlsx        # 上传的原始文件
```

### identity_id 格式


| 来源      | 格式                | 示例                                             |
| ------- | ----------------- | ---------------------------------------------- |
| 匿名浏览器   | `browser:<uuid>`  | `browser:101fdf9b-6213-456d-8fa9-6b9adeb32b0a` |
| OIDC 登录 | `user:<sub>`      | `user:7`                                       |
| 本地开发    | `local:<os_user>` | `local:admin`                                  |


目录名经过 `secure_filename()` 清洗，例如 `browser:101fdf9b-...` → `browser101fdf9b-...`。

---

## 2. 每个文件的职责

### 2.1 `workspace_meta.json` — 列表页索引

**Owner**: `WorkspaceManager`（Python）
**大小**: ~150 bytes
**写入时机**: `create_workspace()`, `save_session_state()`, `update_display_name()`

```json
{
  "id": "session_20260426_212411_1503",
  "displayName": "全球发展洞察台",
  "updatedAt": "2026-04-26T14:48:43.037489+00:00",
  "tableCount": 6,
  "chartCount": 4
}
```

**用途**: `list_workspaces()` 只读这个文件，不读 session_state.json（几 MB），
实现 O(n × 150B) 的列表扫描。

### 2.2 `workspace.yaml` — 后端表元数据

**Owner**: `Workspace` 类（Python）
**大小**: 几 KB ~ 几十 KB（只存 schema，不存数据行）
**写入时机**: `Workspace.__init_`_（首次创建）、`write_parquet()`、`add_table_metadata()` 等表操作

```yaml
version: '1.1'
created_at: '2026-04-26T13:24:16+00:00'
updated_at: '2026-04-26T14:37:57+00:00'
tables:
  gapminder:
    source_type: data_loader       # upload | data_loader
    filename: gapminder.parquet    # data/ 下的物理文件名
    file_type: parquet
    content_hash: f4cca39e...      # 内容指纹，用于刷新去重
    file_size: 16211
    row_count: 682
    columns:
      - {name: year, dtype: int64}
      - {name: country, dtype: object}
    loader_type: superset          # Data Loader 来源信息（可选）
    source_table: gapminder        # 远程表名（可选）
```

**用途**:

- Agent 生成代码时获取表 schema（列名、类型）
- DuckDB SQL 查询通过 filename 定位 parquet 文件
- 刷新导入数据时通过 content_hash 判断是否变化
- Data Loader 记录数据来源溯源信息

**不存**: 数据行、图表配置、UI 状态。

### 2.3 `session_state.json` — 前端状态快照

**Owner**: 前端 Redux store → `WorkspaceManager.save_session_state()`
**大小**: 几百 KB ~ 几 MB（含表的全量行数据）
**写入时机**: 前端自动保存（定时 + 切换 workspace）

```json
{
  "tables": [
    {
      "id": "gapminder",
      "names": ["year", "country", ...],
      "rows": [/* 682 行全量数据 */],
      "source": {"type": "example", "url": "..."}
    }
  ],
  "charts": [/* 图表配置 */],
  "draftNodes": [/* 编码面板 */],
  "conceptShelfItems": [/* 概念架 */],
  "messages": [/* 聊天记录 */],
  "config": {/* UI 配置 */},
  "activeWorkspace": {"displayName": "..."}
}
```

**用途**: 加载 workspace 时恢复完整前端状态（表数据 + 图表 + 对话 + 布局）。

**敏感字段自动剥离**（不持久化）:
`models`, `selectedModelId`, `testedModels`, `dataLoaderConnectParams`,
`identity`, `agentRules`, `serverConfig`。

### 2.4 `data/` 目录 — 物理数据文件

存放 parquet（Agent 衍生表、Data Loader 导入）和用户上传的原始文件（csv, xlsx 等）。
文件名由 `workspace.yaml` 中的 `filename` 字段索引。

### 2.5 `.workspace.lock` — 并发写锁

`WorkspaceLock` 上下文管理器使用的锁文件。Windows 用 `LockFileEx`，Unix 用 `fcntl.flock`。
保护 `workspace.yaml` 的读-改-写原子性。运行时产生，无需手动管理。

### 2.6 `connectors.yaml` — Data Connector 配置（用户级）

**位置**: `users/<identity>/connectors.yaml`（不在 workspace 内）
**用途**: 记录用户创建的 Data Connector 实例（类型、连接参数，不含密码）。
凭据存储在全局 `credentials.db` 中。

---

## 3. 两层架构：WorkspaceManager vs Workspace

```
WorkspaceManager                        Workspace
(管理 workspace 生命周期)               (管理单个 workspace 内的数据)
┌──────────────────────┐               ┌──────────────────────┐
│ create_workspace()   │               │ write_parquet()      │
│ list_workspaces()    │  open ──────► │ read_data_as_df()    │
│ delete_workspace()   │               │ add_table_metadata() │
│ save_session_state() │               │ get_metadata()       │
│ load_session_state() │               │ export_session_zip() │
│ workspace_exists()   │               │ run_parquet_sql()    │
└──────────────────────┘               └──────────────────────┘
     操作 workspace_meta.json               操作 workspace.yaml
     操作 session_state.json                操作 data/ 下的文件
```

**核心约定**:

- Session 路由（list, save, load, create, delete, rename）通过 `WorkspaceManager`
- 数据路由（upload, table CRUD, Agent）通过 `get_workspace()` → `Workspace`
- `get_workspace()` 包含懒创建逻辑：frontend 生成 ID，backend 首次使用时创建

---

## 4. Workspace 存在性判定（一致性规则）

Workspace 是否存在由 **目录是否存在** 唯一决定。
如果目录存在但缺少 `workspace_meta.json`（老版本遗留），自动补写修复。

```python
# workspace_manager.py

def workspace_exists(self, workspace_id: str) -> bool:
    """目录存在 = workspace 存在。"""
    return (self._root / self._safe_id(workspace_id)).is_dir()
```

`list_workspaces()` 遍历子目录时，对缺少 `workspace_meta.json` 的目录
调用 `_ensure_meta()` 自动补写，使其在列表中可见：

```python
def _ensure_meta(self, workspace_id: str) -> dict:
    """缺少 workspace_meta.json 时，从已有信息推断并补写。"""
    meta_file = self._root / self._safe_id(workspace_id) / WORKSPACE_META_FILENAME
    if meta_file.exists():
        return json.loads(meta_file.read_text(encoding="utf-8"))
    # 从 session_state.json 推断 displayName；缺失则用 ID
    self._write_meta(workspace_id, workspace_id)
    return json.loads(meta_file.read_text(encoding="utf-8"))
```

`create_workspace()` 的防重复检查也统一为目录检查（与 `workspace_exists` 语义一致）。

### 以前的问题（已修复）

旧代码中三个方法用不同标准判断 workspace 是否存在：


| 方法                 | 旧判断依据                           | 问题              |
| ------------------ | ------------------------------- | --------------- |
| `list_workspaces`  | 只看 `workspace_meta.json`        | 老 workspace 不可见 |
| `workspace_exists` | meta.json OR yaml OR state.json | 和 list 不一致      |
| `create_workspace` | 目录是否存在                          | 和 exists 不一致    |


导致"幽灵 workspace"：存在但在列表中看不见，也无法用同 ID 创建新的。

---

## 5. 三种后端模式

通过 `--workspace-backend` 或 `WORKSPACE_BACKEND` 环境变量选择。

### 5.1 local（默认）

- 文件存本地磁盘 `DATA_FORMULATOR_HOME/users/<id>/workspaces/<ws_id>/`
- `WorkspaceManager` → `Workspace`
- 适用于单机部署

### 5.2 azure_blob

- 文件存 Azure Blob Storage，容器内按 `users/<id>/workspaces/<ws_id>/` 组织
- `AzureBlobWorkspaceManager` → `AzureBlobWorkspace`（自带下载缓存）
- workspace.yaml 和 data/ 都作为 blob 存储
- 凭据通过 connection string 或 DefaultAzureCredential（Entra ID）
- 适用于多用户云部署

### 5.3 ephemeral

- 前端 IndexedDB 为唯一数据源
- 每次请求通过 `_workspace_tables` 发送全量表数据
- 后端创建临时目录，写 parquet 供 Agent/DuckDB 使用
- Session 路由全部返回 no-op
- 进程退出时 `atexit` 清理临时目录
- 适用于 `--disable-database` 模式（无服务端持久化）

---

## 6. 数据流概览

### 上传文件

```
用户拖入 Excel
  → POST /api/upload-data
    → get_workspace() → Workspace
      → save_uploaded_file() → data/sales.xlsx
      → 转 parquet → data/sales_xlsx_sheet1.parquet
      → workspace.yaml 新增 table entry
  → 前端收到 rows/schema → Redux → 自动保存
    → POST /api/sessions/save
      → WorkspaceManager.save_session_state()
        → session_state.json（含 rows）
        → workspace_meta.json（tableCount++）
```

### Agent 生成衍生表

```
用户提交 prompt
  → POST /api/data-agent-streaming
    → get_workspace() → Workspace
      → Agent 生成 Python 代码
      → sandbox 执行 → 产出 DataFrame
      → write_parquet() → data/d_result.parquet
      → workspace.yaml 新增 table entry
```

### 加载 workspace

```
用户点击 workspace 列表项
  → POST /api/sessions/load {id: "session_xxx"}
    → WorkspaceManager.load_session_state()
      → 读 session_state.json → 返回完整前端状态
  → 前端 Redux hydrate → 恢复表/图表/对话
```

---

## 7. workspace.yaml vs session_state.json 对比


| 维度        | workspace.yaml        | session_state.json            |
| --------- | --------------------- | ----------------------------- |
| **Owner** | 后端 `Workspace`        | 前端 Redux → `WorkspaceManager` |
| **存什么**   | 表的 schema + 物理文件索引    | 完整 UI 状态（含全量行数据）              |
| **表数据行**  | 不存                    | 存（`rows[]`）                   |
| **图表/对话** | 不存                    | 存                             |
| **谁读**    | Agent, DuckDB, 上传逻辑   | 前端加载 workspace 时              |
| **典型大小**  | 几 KB                  | 几百 KB ~ 几 MB                  |
| **并发保护**  | `.workspace.lock` 文件锁 | 无（单次完整覆写）                     |


两者在 schema 信息上有有意冗余：后端独立于前端状态就能知道表结构。

---

## 8. New Module Checklist

当修改 workspace 相关代码时：

- 确认新文件操作在 `data/` 子目录内（不在 workspace 根目录写数据文件）
- 表元数据变更通过 `_atomic_update_metadata()` 而非直接 `save_metadata()`
- `workspace_exists` 语义 = 目录存在，不要引入新的文件检查条件
- 新增表字段同时更新 `TableMetadata.to_dict()` 和 `from_dict()`
- 敏感字段加入 `_SENSITIVE_FIELDS` 集合，禁止持久化到 session_state.json
- Azure blob 后端的 `AzureBlobWorkspaceManager` 需同步修改
- 考虑 ephemeral 模式是否需要适配（通常 session 路由返回 no-op 即可）

