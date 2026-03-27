# Data Formulator 数据源插件架构设计方案

## 目录

1. [背景与动机](#1-背景与动机)
2. [部署模型分析：个人工具 vs 团队平台](#2-部署模型分析个人工具-vs-团队平台)
3. [现状分析](#3-现状分析)
4. [0.6 版本 Superset 集成回顾](#4-06-版本-superset-集成回顾)
5. [插件架构总体设计](#5-插件架构总体设计)
6. [后端插件接口](#6-后端插件接口)
7. [前端插件接口](#7-前端插件接口)
8. [插件注册与发现](#8-插件注册与发现)
9. [数据流设计](#9-数据流设计)
10. [Superset 插件迁移示例](#10-superset-插件迁移示例)
11. [与现有 ExternalDataLoader 的关系](#11-与现有-externaldataloader-的关系)
12. [目录结构](#12-目录结构)
13. [实施路径](#13-实施路径)
14. [关键设计难点：外部系统配置与用户身份](#14-关键设计难点外部系统配置与用户身份)
15. [FAQ](#15-faq)
16. [附录 A：核心代码改动清单](#附录-a核心代码改动清单)
17. [附录 B：新增插件的完整步骤](#附录-b新增插件的完整步骤零核心改动)
18. [附录 C：关联文档](#附录-c关联文档)

---

## 1. 背景与动机

### 1.1 核心需求

Data Formulator 需要对接外部 BI/报表系统（如 Apache Superset、Metabase、Power BI 等）作为数据源，让用户可以：

- 用外部系统的**账号权限**登录
- 浏览该用户**有权访问**的数据集、仪表盘、报表
- 将数据拉取到 Data Formulator 中进行可视化分析

### 1.2 为什么需要插件机制

在 0.6 版本中，我们已经实现了 Superset 集成，但存在以下问题：

| 问题 | 说明 |
|------|------|
| **对核心代码侵入较高** | 修改了 `app.py`、`dfSlice.tsx`、`App.tsx`、`utils.tsx`、`UnifiedDataUploadDialog.tsx` 等多个核心文件 |
| **不可复用** | 如果再集成一个 Metabase，需要重复修改同一批核心文件 |
| **耦合认证逻辑** | Superset 的 JWT 认证直接嵌入 Flask session，与应用认证逻辑耦合 |
| **升级困难** | 上游 Data Formulator 版本更新时，合并冲突概率高 |

**插件机制的价值**：每个外部系统的集成代码自成一体（后端 + 前端），对核心代码的修改只需一次性地建立插件框架即可。后续新增任何 BI 系统，只需编写一个新插件，**不再需要修改核心代码**。

---

## 2. 部署模型分析：个人工具 vs 团队平台

### 2.1 原始设计哲学

Data Formulator 最初被设计为**个人本地工具**——用户在自己的笔记本上运行，"服务器"和"用户"是同一个人、同一台机器。在这个前提下，很多设计决策是合理的：

```
个人模式（原始设计假设）:

  用户的笔记本 = 服务器 = 数据存储
  ┌─────────────────────────────┐
  │  浏览器 ←→ Flask 后端       │  同一台机器
  │           ↕                 │
  │     ~/.data_formulator/     │  "服务端存储"就是自己硬盘
  └─────────────────────────────┘
  
  在这个模型下：
  - "存服务端"就是存自己硬盘，隐私不是问题
  - 前端填数据库密码、模型 API Key 是合理的（只有自己用）
  - Browser/Disk 选择 = 要不要持久化
```

这个假设催生了以下设计：
- `storeOnServer` 开关：用户可以选择数据放浏览器（临时）还是放硬盘（持久化）
- `dataLoaderConnectParams`：数据库连接参数在前端 Redux 中管理，不持久化
- `DISABLE_DATABASE`：可以完全禁用服务端存储，强制纯浏览器模式
- `frontendRowLimit = 50000`：浏览器模式下的行数上限

### 2.2 接入 BI 系统后的模型变化

当需要集成 Superset 等 BI 系统时，部署模型发生了根本变化：

```
团队部署模式（插件场景的实际部署）:

  ┌───────────┐     ┌──────────────┐     ┌────────────┐
  │ 用户A浏览器│────→│              │────→│            │
  │ 用户B浏览器│────→│  DF 服务器    │────→│  Superset  │
  │ 用户C浏览器│────→│  (IT部署管理) │────→│  (IT管理)  │
  └───────────┘     └──────────────┘     └────────────┘
  
  在这个模型下：
  - "服务器"不再是用户自己的电脑
  - 数据必然经过服务器（插件后端调 Superset API）
  - 隐私关注点变成了"谁控制服务器"，而不是"数据在不在服务器上"
  - BI 系统的连接地址是基础设施，由 IT 管理，不是用户自行添加
```

### 2.3 现有设计中的张力

原始设计假设与团队部署需求之间存在明显的张力：

| 现象 | 个人模式下为什么合理 | 团队模式下的问题 |
|------|---------------------|-----------------|
| 数据库连接参数前端填，刷新即丢 | 只有自己用，填一次就够 | 多人使用，每次打开都要重填 |
| `storeOnServer` 让用户选 Browser/Disk | 个人偏好，要不要持久化 | BI 数据已经过服务器，"不存服务器"没有意义 |
| `frontendRowLimit = 50000` 截断 | 个人浏览够用 | BI 报表动辄百万行，截断后失去分析价值 |
| 模型 API Key 前端填 | 自己的 Key 自己管 | 团队共享时 Key 不应暴露给前端 |

> **值得注意的是**，项目已经开始向正确方向演进：0.7 版本新增的"服务端全局模型配置"功能，正是把模型管理从"前端填"升级为"服务端集中管理"。插件系统应该沿着同样的方向继续。

### 2.4 对插件系统的设计决策

基于以上分析，插件系统采取以下设计立场：

**插件配置（URL 等）：只在服务端配置，不在前端添加。**

理由：
1. BI 系统的 URL 是**基础设施端点**，不是用户数据，由 IT 部门管理
2. 用户需要做的只是**认证**（登录 Superset），而不是"添加一个 Superset 连接"
3. 允许前端输入任意 URL 存在安全风险（SSRF——让后端去请求用户指定的任意地址）

**插件数据存储：强制走 Workspace，`storeOnServer` 开关不适用于插件数据。**

理由：
1. 数据从 Superset → DF 后端 → 写入 Workspace，数据**已经在服务器上经过了**
2. 浏览器 5 万行截断会让 BI 数据失去实际分析价值
3. 写入 Workspace 后，前端只拿 sample rows（与现有的"Disk 模式"行为完全一致）

**但不改变现有功能的行为。** 原有的 Upload/Paste/URL/Database 对个人模式依然适用，两种模式自然并行：

```
┌─────────────────────────────────────────────────────────────────┐
│                       Data Formulator                            │
│                                                                  │
│  ┌────────────────────────────────┐  ┌────────────────────────┐  │
│  │ 原有数据加载 (Upload/Paste等) │  │ 插件数据加载            │  │
│  │                                │  │ (Superset/Metabase)    │  │
│  │ ✅ 支持 Browser/Disk 切换     │  │ ✅ 强制 Workspace      │  │
│  │ ✅ 连接参数前端填              │  │ ✅ 端点 URL 服务端配置 │  │
│  │ ✅ 适合个人本地使用            │  │ ✅ 认证凭据 per-user   │  │
│  │ ✅ 保持向后兼容                │  │ ✅ 适合团队部署        │  │
│  └────────────────────────────────┘  └────────────────────────┘  │
│                                                                  │
│  共用底层: loadTable / Workspace / Redux Store                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.5 各层的配置与数据归属总结

| 层级 | 谁配置 | 存在哪里 | 示例 |
|------|--------|---------|------|
| **插件端点** | IT 管理员 | 服务端 `.env` | `SUPERSET_URL=http://...` |
| **用户认证** | 用户自己 | Flask Session（服务端内存） | Superset JWT Token |
| **用户数据** | 插件自动加载 | Workspace Parquet（服务端磁盘） | 从 Superset 拉取的数据集 |
| **前端状态** | 自动管理 | Redux Store（浏览器内存） | sample rows、表元数据 |

---

## 3. 现状分析

### 3.1 当前数据加载架构（0.7 版本）

```
用户操作
  ├─ Upload (本地文件)  ──→ 解析 → DictTable
  ├─ Paste (粘贴数据)   ──→ 解析 → DictTable
  ├─ URL (远程文件)     ──→ fetch → 解析 → DictTable
  ├─ Explore (示例数据) ──→ fetch → 解析 → DictTable
  ├─ Extract (AI 提取)  ──→ Agent → 解析 → DictTable
  └─ Database (外部数据库) ──→ ExternalDataLoader → Arrow → Parquet
                                                           │
                        所有路径最终 → loadTable thunk → Redux Store
```

### 3.2 后端现有扩展点

**ExternalDataLoader** — 面向数据库的抽象基类：

```python
class ExternalDataLoader(ABC):
    def __init__(self, params: dict)           # 连接参数
    def list_tables(...)                       # 列出表
    def fetch_data_as_arrow(...)               # 拉取数据（→ Arrow）
    def ingest_to_workspace(...)               # 写入 workspace（→ Parquet）
    def list_params()                          # 声明所需参数
    def auth_instructions()                    # 认证说明
```

注册方式（`data_loader/__init__.py`）：

```python
_LOADER_SPECS = [
    ("mysql",      "...mysql_data_loader",      "MySQLDataLoader",      "pymysql"),
    ("postgresql", "...postgresql_data_loader",  "PostgreSQLDataLoader", "psycopg2-binary"),
    # ... 共 9 种
]
```

**这套机制适合数据库连接器**，但 **不适合 BI 系统集成**，因为 BI 系统需要：

| 能力 | ExternalDataLoader | BI 系统需要 |
|------|:--:|:--:|
| 连接参数 | ✅ 简单 key-value | 需要 URL + 认证流程 |
| 认证 | ✅ 用户名/密码/密钥 | JWT / OAuth / SSO |
| 列出数据 | ✅ `list_tables()` | 数据集 + 仪表盘 + 报表 + 筛选条件 |
| 拉取数据 | ✅ `fetch_data_as_arrow()` | 通过 BI 系统的 SQL Lab / API 拉取（尊重 RBAC/RLS） |
| 前端 UI | ❌ 无（通用表单） | 需要专用的目录浏览、筛选、登录等 UI |
| 自有 API 路由 | ❌ 无 | 需要注册独立的 Blueprint |

### 3.3 前端现有扩展点

数据加载入口统一在 `UnifiedDataUploadDialog.tsx`，支持 6 种 Tab：

```typescript
type UploadTabType = 'menu' | 'upload' | 'paste' | 'url' | 'database' | 'extract' | 'explore';
```

数据库入口由 `DBManagerPane` 组件处理，支持上述 9 种 ExternalDataLoader。

所有数据加载最终通过 `loadTable` thunk 进入 Redux Store。

---

## 4. 0.6 版本 Superset 集成回顾

### 4.1 架构概览

```
前端                              后端                         Superset
┌─────────────┐   HTTP    ┌────────────────┐    REST    ┌──────────┐
│ LoginView   │──────────→│ auth_routes    │───────────→│ JWT 登录 │
│ SupersetPanel│──────────→│ catalog_routes │───────────→│ 数据集API│
│ SupersetCatalog│────────→│ data_routes    │───────────→│ SQL Lab  │
│ SupersetDashboards│─────→│ auth_bridge    │           └──────────┘
└─────────────┘           │ superset_client│
                          │ catalog        │
                          └────────────────┘
                                 │
                                 ↓
                          写入 DuckDB（0.6）
                          / Workspace Parquet（0.7 目标）
```

### 4.2 后端模块

| 文件 | 职责 |
|------|------|
| `superset_client.py` | Superset REST API 封装（数据集列表、详情、仪表盘、SQL Lab 执行） |
| `auth_bridge.py` | JWT 登录/刷新/验证 |
| `auth_routes.py` | `/api/superset/auth/*` 认证 API |
| `catalog_routes.py` | `/api/superset/catalog/*` 数据集/仪表盘目录 API |
| `data_routes.py` | `/api/superset/data/*` 数据加载 API（含筛选条件） |
| `catalog.py` | 带 TTL 缓存的数据目录（两级：摘要/详情） |

### 4.3 前端组件

| 组件 | 职责 |
|------|------|
| `LoginView.tsx` | 登录页（用户名密码 / SSO 弹窗） |
| `SupersetPanel.tsx` | Tab 容器（仪表盘 + 数据集） |
| `SupersetCatalog.tsx` | 数据集目录浏览（搜索、预览、加载） |
| `SupersetDashboards.tsx` | 仪表盘列表（展开查看数据集） |
| `SupersetDashboardFilterDialog.tsx` | 仪表盘筛选条件对话框 |

### 4.4 对核心代码的改动

```
app.py                      +50 行  (配置、Blueprint 注册、app-config 扩展)
dfSlice.tsx                  +3 字段 (SUPERSET_ENABLED、SSO_LOGIN_URL、AUTH_USER)
App.tsx                      +20 行  (登录逻辑、LoginView)
utils.tsx                    +6 URL  (Superset API 地址)
UnifiedDataUploadDialog.tsx  +30 行  (SplitDatabasePane + SupersetPanel)
DBTableManager.tsx           +4 行   (监听 superset-dataset-loaded 事件)
```

### 4.5 可以复用的部分

核心的业务逻辑（SupersetClient、AuthBridge、Catalog、FilterBuilder）可以直接迁移为 Superset 插件的实现。

---

## 5. 插件架构总体设计

### 5.1 设计原则

1. **最小侵入**：核心代码只需一次性改动来建立插件框架，后续新增插件不再修改核心
2. **自包含**：每个插件独立提供后端路由 + 前端组件 + 配置声明
3. **自动发现**：后端通过目录扫描、前端通过 `import.meta.glob` 自动发现插件，新增插件无需修改任何注册表
4. **可选加载**：插件通过环境变量启用，未启用的插件不加载任何代码
5. **统一出口**：插件加载的数据最终通过现有的 `loadTable` 进入系统
6. **权限透传**：尊重外部系统自身的权限模型（RBAC / RLS）
7. **统一范式**：与 AuthProvider（认证）、CredentialVault（凭证）共享"抽象基类 + 动态注册 + 环境变量启用"的插件设计范式（详见 `sso-plugin-architecture.md`）

### 5.2 概念模型

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Data Formulator 核心                              │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Layer 1: AuthProvider 链 (SSO / Azure EasyAuth / 浏览器 UUID)   │ │
│  │  → 确定"你是谁"                                                 │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌──────────────────┐  ┌───────────────┐  ┌──────────────┐          │
│  │ 前端 Plugin Host │  │ loadTable     │  │ Workspace    │          │
│  │ (渲染插件面板)    │  │ (统一数据入口)│  │ (Parquet存储)│          │
│  └────────┬─────────┘  └───────┬───────┘  └──────┬───────┘          │
│           │                    │                  │                   │
│  ┌────────┴────────────────────┴──────────────────┴───────┐          │
│  │  Layer 2: Plugin Registry (自动扫描 + 环境变量门控)     │          │
│  └────────┬──────────────┬──────────────┬─────────────────┘          │
│           │              │              │                             │
│  ┌────────┴─────┐ ┌──────┴─────┐ ┌──────┴──────┐                    │
│  │ Superset     │ │ Metabase   │ │ Power BI    │  ...                │
│  │ Plugin       │ │ Plugin     │ │ Plugin      │                    │
│  │              │ │            │ │             │                    │
│  │ ┌──────────┐ │ │ ┌────────┐ │ │ ┌─────────┐ │                    │
│  │ │ 后端路由 │ │ │ │ 后端   │ │ │ │ 后端    │ │                    │
│  │ │ 前端面板 │ │ │ │ 前端   │ │ │ │ 前端    │ │                    │
│  │ │ 认证逻辑 │ │ │ │ 认证   │ │ │ │ 认证    │ │                    │
│  │ │ 目录缓存 │ │ │ │ 目录   │ │ │ │ 目录    │ │                    │
│  │ └──────────┘ │ │ └────────┘ │ │ └─────────┘ │                    │
│  └──────────────┘ └────────────┘ └─────────────┘                    │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Layer 3: CredentialVault (加密凭证存储，per-user per-source)     │ │
│  │  → 插件认证时自动存/取凭证                                       │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  → 三层统一范式: 抽象基类 + 动态注册 + 环境变量启用                   │
│  → 详见 sso-plugin-architecture.md                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.3 核心概念

| 概念 | 说明 |
|------|------|
| **DataSourcePlugin** | 一个外部 BI 系统的完整集成，包含后端和前端 |
| **Plugin Manifest** | 插件的自我描述（ID、名称、图标、配置需求、启用条件） |
| **Plugin Backend** | Flask Blueprint + 认证 + 目录 + 数据拉取 |
| **Plugin Frontend** | React 组件（面板 UI），在 `UnifiedDataUploadDialog` 中以 Tab 形式呈现 |
| **Plugin Registry** | 后端的插件发现与注册中心 |
| **Plugin Host** | 前端的插件容器，负责渲染已启用插件的面板 |

---

## 6. 后端插件接口

### 6.1 插件基类

```python
# py-src/data_formulator/plugins/base.py

from abc import ABC, abstractmethod
from typing import Any
from flask import Blueprint


class DataSourcePlugin(ABC):
    """外部数据源插件的基类。
    
    每个插件需要实现以下内容：
    1. manifest() — 描述插件自身的元数据
    2. create_blueprint() — 提供 Flask Blueprint（后端 API 路由）
    3. get_frontend_bundle() — 声明前端需要的信息（组件标识、配置）
    4. on_enable() / on_disable() — 生命周期钩子
    """
    
    @staticmethod
    @abstractmethod
    def manifest() -> dict[str, Any]:
        """返回插件的自我描述。
        
        Returns:
            {
                "id": "superset",              # 唯一标识符，用作路由前缀和前端标识
                "name": "Apache Superset",     # 显示名称
                "icon": "superset",            # 前端图标标识
                "description": "...",          # 简短描述
                "version": "1.0.0",
                "env_prefix": "SUPERSET",      # 环境变量前缀（SUPERSET_URL, etc.）
                "required_env": ["SUPERSET_URL"],  # 必需的环境变量（缺失则不启用）
                "optional_env": ["SUPERSET_TIMEOUT"],
                "auth_type": "jwt",            # 认证类型: "jwt" | "oauth" | "api_key" | "none"
                "capabilities": [              # 框架识别的标准能力标识
                    "datasets",                # 可以列出数据集
                    "dashboards",              # 可以列出仪表盘
                    "filters",                 # 支持数据筛选
                    "preview",                 # 支持预览（GET /data/preview）
                    "refresh",                 # 支持带参数刷新（POST /data/refresh）
                    "batch_load",              # 支持分批流式加载（NDJSON）
                    "metadata",                # 可提供列描述、表描述等外部元数据
                ],
                "catalog_entry_types": [       # 插件支持的数据入口类型（UI 展示用）
                    {
                        "type": "dataset",
                        "label": "数据集",
                        "icon": "table_chart",
                        "supports_filters": True,
                    },
                    {
                        "type": "dashboard_chart",
                        "label": "仪表盘图表",
                        "icon": "dashboard",
                        "supports_filters": True,
                    },
                ],
            }
        """
        pass
    
    @abstractmethod
    def create_blueprint(self) -> Blueprint:
        """创建 Flask Blueprint。
        
        Blueprint 的 url_prefix 应为 /api/plugins/<plugin_id>/
        插件内部路由自行组织，例如：
            /api/plugins/superset/auth/login
            /api/plugins/superset/catalog/datasets
            /api/plugins/superset/data/load-dataset
        
        Returns:
            配置好路由的 Flask Blueprint
        """
        pass
    
    @abstractmethod
    def get_frontend_config(self) -> dict[str, Any]:
        """返回传递给前端的配置信息。
        
        这些信息会通过 /api/app-config 的 plugins 字段下发到前端，
        前端据此决定显示哪些插件面板、如何配置。
        
        Returns:
            {
                "enabled": True,
                "auth_type": "jwt",
                "sso_login_url": "http://superset:8088/df-sso-bridge/",
                "capabilities": ["datasets", "dashboards", "filters"],
                # ... 其他前端需要的配置
            }
        注意：不要返回密钥等敏感信息。
        """
        pass
    
    def on_enable(self, app) -> None:
        """插件被启用时调用（可选）。
        
        可以用来：
        - 注册 Flask extensions
        - 初始化连接池或缓存
        - 设置定时任务
        - 获取 CredentialVault 引用（用于 SSO token 或用户凭证的存取）
        """
        pass
    
    def on_disable(self) -> None:
        """插件被禁用时调用（可选）。"""
        pass
    
    def get_auth_status(self, session: dict) -> dict[str, Any] | None:
        """返回当前用户的认证状态（可选）。
        
        如果插件有自己的认证逻辑，实现此方法来返回当前用户信息。
        返回 None 表示未认证。
        """
        return None
```

### 6.2 插件加载的数据怎么进入 Workspace

插件从外部系统拉取到数据后，需要将数据写入 DF 的 Workspace。这个过程参考了 0.6 版本 Superset 集成中的实际经验，需要解决三个问题：**表名管理**、**大数据量写入性能**、**写入方式选择**。

#### 5.2.1 表名管理：覆盖 vs 新建

0.6 版本的 Superset 集成支持两种表名策略，这个设计在实际使用中被证明非常实用：

| 操作 | 行为 | 使用场景 |
|------|------|---------|
| **覆盖（默认）** | 用数据集原名写入，已存在则替换 | 刷新数据，获取最新版本 |
| **新建（加后缀）** | 用户指定后缀，生成 `name_suffix` 形式的新表名 | 保留历史快照，对比不同时间点的数据 |

0.6 前端的实现方式是在每个数据集条目上提供两个按钮：
- 下载图标 → 直接覆盖加载（使用默认表名）
- 加号图标 → 弹出后缀对话框（用户输入后缀，如日期 `20250322`，生成 `sales_20250322`）

后端通过 `table_name` 参数控制：
- 不传 `table_name`：使用数据集原名，覆盖同名表
- 传 `table_name`：使用指定名称写入

在 0.7 的 Workspace 中，这映射到现有 API：

```python
from data_formulator.workspace_factory import get_workspace
from data_formulator.datalake.parquet_utils import sanitize_table_name
from data_formulator.auth import get_identity_id

workspace = get_workspace(get_identity_id())
safe_name = sanitize_table_name(table_name_override or original_name)

# write_parquet / write_parquet_from_arrow 已有覆盖逻辑：
# 如果 safe_name 已存在 → 删除旧 parquet → 写入新 parquet
workspace.write_parquet(df, safe_name, loader_metadata={
    "loader_type": "SupersetPlugin",
    "loader_params": {"dataset_id": dataset_id, "filters": filters},
    "source_table": original_name,
})
```

如果需要"不覆盖、自动加后缀"的行为（类似 `tables_routes.py` 中 `create_table` 的去重逻辑），可以这样处理：

```python
# 自动去重表名（确保不覆盖已有表）
base_name = sanitize_table_name(table_name)
final_name = base_name
counter = 1
existing_tables = workspace.list_tables()
while final_name in existing_tables:
    final_name = f"{base_name}_{counter}"
    counter += 1
workspace.write_parquet(df, final_name)
```

#### 5.2.2 大数据量写入：插件专用写入工具函数

0.6 版本中，Superset 数据通过 SQL Lab 查询返回 JSON → 转 DataFrame → 写入存储。对于大数据量（10 万+ 行），有两个性能瓶颈：
1. 从外部系统拉取数据时的网络传输
2. 写入 Workspace 时的序列化开销

为了让所有插件都能高效写入，我们提供一个**插件专用的写入工具函数**，封装常见的写入模式：

```python
# py-src/data_formulator/plugins/data_writer.py

import logging
import pandas as pd
import pyarrow as pa
from typing import Any, Optional

from data_formulator.auth import get_identity_id
from data_formulator.workspace_factory import get_workspace
from data_formulator.datalake.parquet_utils import sanitize_table_name

logger = logging.getLogger(__name__)


class PluginDataWriter:
    """插件专用的数据写入工具。
    
    封装了表名管理、覆盖/新建策略、大数据量写入等常用逻辑，
    让插件开发者不需要直接操作 Workspace 底层 API。
    """
    
    def __init__(self, plugin_id: str):
        self.plugin_id = plugin_id
    
    def _get_workspace(self):
        return get_workspace(get_identity_id())
    
    def write_dataframe(
        self,
        df: pd.DataFrame,
        table_name: str,
        *,
        overwrite: bool = True,
        source_metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """将 DataFrame 写入 Workspace。
        
        Args:
            df: 要写入的数据
            table_name: 目标表名（会自动 sanitize）
            overwrite: True=覆盖同名表, False=自动加后缀避免冲突
            source_metadata: 来源元数据（用于刷新等场景）
        
        Returns:
            {"table_name": str, "row_count": int, "columns": list, "is_renamed": bool}
        """
        workspace = self._get_workspace()
        base_name = sanitize_table_name(table_name)
        final_name = base_name
        is_renamed = False
        
        if not overwrite:
            counter = 1
            existing = set(workspace.list_tables())
            while final_name in existing:
                final_name = f"{base_name}_{counter}"
                counter += 1
                is_renamed = True
        
        loader_metadata = {
            "loader_type": f"plugin:{self.plugin_id}",
            **(source_metadata or {}),
        }
        
        meta = workspace.write_parquet(
            df, final_name, loader_metadata=loader_metadata
        )
        
        logger.info(
            "Plugin '%s' wrote table '%s': %d rows, %d cols",
            self.plugin_id, final_name, len(df), len(df.columns),
        )
        
        return {
            "table_name": meta.name,
            "row_count": meta.row_count,
            "columns": [c.name for c in (meta.columns or [])],
            "is_renamed": is_renamed,
        }
    
    def write_arrow(
        self,
        table: pa.Table,
        table_name: str,
        *,
        overwrite: bool = True,
        source_metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """将 Arrow Table 写入 Workspace（更高效，跳过 pandas 转换）。"""
        workspace = self._get_workspace()
        base_name = sanitize_table_name(table_name)
        final_name = base_name
        is_renamed = False
        
        if not overwrite:
            counter = 1
            existing = set(workspace.list_tables())
            while final_name in existing:
                final_name = f"{base_name}_{counter}"
                counter += 1
                is_renamed = True
        
        loader_metadata = {
            "loader_type": f"plugin:{self.plugin_id}",
            **(source_metadata or {}),
        }
        
        meta = workspace.write_parquet_from_arrow(
            table, final_name, loader_metadata=loader_metadata
        )
        
        return {
            "table_name": meta.name,
            "row_count": meta.row_count,
            "columns": [c.name for c in (meta.columns or [])],
            "is_renamed": is_renamed,
        }
    
    def write_batches(
        self,
        first_batch: pd.DataFrame,
        table_name: str,
        *,
        overwrite: bool = True,
        source_metadata: Optional[dict[str, Any]] = None,
    ) -> "BatchWriter":
        """创建一个批量写入器，适用于数据需要分批拉取的场景。
        
        用法:
            writer = data_writer.write_batches(first_df, "my_table")
            writer.append(second_df)
            writer.append(third_df)
            result = writer.finish()
        
        内部机制: 先将第一批数据写入临时文件，后续批次追加，
        最后合并为一个完整的 Parquet 文件。
        """
        return BatchWriter(
            self, first_batch, table_name,
            overwrite=overwrite,
            source_metadata=source_metadata,
        )


class BatchWriter:
    """支持分批追加写入的写入器。
    
    适用于外部系统的数据需要分页/分批拉取的场景（如 Superset SQL Lab
    有行数限制，或网络传输需要分批）。
    
    内部使用 PyArrow 的 RecordBatch 累积数据，最终一次性写入 Parquet，
    避免多次写入的 I/O 开销。
    """
    
    def __init__(
        self,
        writer: PluginDataWriter,
        first_batch: pd.DataFrame,
        table_name: str,
        *,
        overwrite: bool,
        source_metadata: Optional[dict[str, Any]],
    ):
        self._writer = writer
        self._table_name = table_name
        self._overwrite = overwrite
        self._source_metadata = source_metadata
        self._batches: list[pa.RecordBatch] = []
        self._total_rows = 0
        self.append(first_batch)
    
    def append(self, df: pd.DataFrame) -> int:
        """追加一批数据。返回目前累积的总行数。"""
        if len(df) == 0:
            return self._total_rows
        batch = pa.RecordBatch.from_pandas(df)
        self._batches.append(batch)
        self._total_rows += len(df)
        return self._total_rows
    
    def finish(self) -> dict[str, Any]:
        """将所有批次合并写入 Workspace，返回写入结果。"""
        if not self._batches:
            raise ValueError("No data batches to write")
        
        combined = pa.Table.from_batches(self._batches)
        result = self._writer.write_arrow(
            combined,
            self._table_name,
            overwrite=self._overwrite,
            source_metadata=self._source_metadata,
        )
        
        logger.info(
            "BatchWriter finished: %d batches, %d total rows → '%s'",
            len(self._batches), self._total_rows, result["table_name"],
        )
        self._batches.clear()
        return result
```

#### 5.2.3 插件如何使用写入工具

以 Superset 插件的数据加载路由为例：

```python
# plugins/superset/routes/data.py

from data_formulator.plugins.data_writer import PluginDataWriter

writer = PluginDataWriter("superset")

@bp.route("/data/load-dataset", methods=["POST"])
def load_dataset():
    # ... 认证、参数解析 ...
    
    # 从 Superset SQL Lab 拉取数据
    result = superset_client.execute_sql_with_session(
        sql_session, db_id, full_sql, schema, row_limit
    )
    all_rows = result.get("data", []) or []
    
    if not all_rows:
        return jsonify({"status": "error", "message": "No data returned"}), 404
    
    df = pd.DataFrame(all_rows)
    
    # 使用写入工具：table_name_override 支持用户自定义表名
    # overwrite=True 表示覆盖同名表（0.6 中的默认下载行为）
    #
    # source_metadata 结构与前端 DataProvenance 对齐，
    # 框架会将其完整存入 loader_metadata，用于后续刷新。
    write_result = writer.write_dataframe(
        df,
        table_name=table_name_override or original_table_name,
        overwrite=True,
        source_metadata={
            "source_type": "dataset",
            "source_id": str(dataset_id),
            "source_name": original_table_name,
            "load_params": {
                "entry_type": "dataset",
                "dataset_id": dataset_id,
                "database_id": database_id,
                "schema": schema,
                "filters": filters,
                "row_limit": row_limit,
            },
            "refreshable": True,
        },
    )
    
    return jsonify({
        "status": "ok",
        **write_result,  # table_name, row_count, columns, is_renamed
    })
```

对于需要分批拉取的大数据场景：

```python
@bp.route("/data/load-dataset-batched", methods=["POST"])
def load_dataset_batched():
    """分批拉取并写入，支持流式进度报告。"""
    # ... 认证、参数解析 ...
    
    def _generate():
        batch_writer = None
        offset = 0
        
        while offset < row_limit:
            batch_sql = f"{base_sql} LIMIT {batch_size} OFFSET {offset}"
            result = superset_client.execute_sql_with_session(
                sql_session, db_id, batch_sql, schema, batch_size
            )
            rows = result.get("data", []) or []
            if not rows:
                break
            
            df = pd.DataFrame(rows)
            
            if batch_writer is None:
                batch_writer = writer.write_batches(
                    df, table_name,
                    overwrite=True,
                    source_metadata={...},
                )
            else:
                batch_writer.append(df)
            
            offset += len(rows)
            
            # 流式报告进度
            yield json.dumps({
                "type": "progress",
                "loaded_rows": offset,
                "batch_size": len(rows),
            }, ensure_ascii=False) + "\n"
            
            if len(rows) < batch_size:
                break
        
        # 合并所有批次，写入 Parquet
        if batch_writer:
            result = batch_writer.finish()
            yield json.dumps({
                "type": "done",
                "status": "ok",
                **result,
            }, ensure_ascii=False) + "\n"
        else:
            yield json.dumps({
                "type": "done",
                "status": "ok",
                "row_count": 0,
            }, ensure_ascii=False) + "\n"
    
    return Response(
        stream_with_context(_generate()),
        content_type="text/x-ndjson; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )
```

#### 5.2.4 两种写入路径对比

| | 直接写入 Workspace（推荐） | 返回 JSON 由前端处理 |
|---|---|---|
| **流向** | 插件后端 → Workspace Parquet | 插件后端 → JSON → 前端 → loadTable → Workspace |
| **适用数据量** | 任意大小 | < 5 万行（受 HTTP 响应大小和前端内存限制） |
| **性能** | 高（Parquet 压缩存储，无 JSON 序列化开销） | 低（JSON 序列化 + 网络传输 + 前端解析） |
| **进度反馈** | 通过 NDJSON 流式响应 | 无（等待完整响应） |
| **前端通知** | 返回 `table_name` → 前端刷新 `list-tables` | 前端收到数据后走 `loadTable` thunk |
| **刷新支持** | 有（`loader_metadata` 记录来源信息，可用于 `refresh-table`） | 无 |

**结论**：插件应默认使用"直接写入 Workspace"路径。仅在特殊场景（如用户只想预览但不保存、或 workspace 被禁用 `DISABLE_DATABASE=true`）时才返回 JSON。

---

## 7. 前端插件接口

### 7.1 插件面板契约

每个插件需要提供一个 React 组件，该组件遵循以下接口：

```typescript
// src/plugins/types.ts

export interface PluginManifest {
  id: string;                 // 与后端 manifest.id 一致
  name: string;               // 显示名称
  icon: string;               // MUI 图标名或 SVG 路径
  description: string;
  authType: 'jwt' | 'oauth' | 'api_key' | 'none';
  capabilities: string[];
}

// ───── 数据溯源：记录数据从哪来、用了什么参数 ─────

/**
 * 每次插件加载数据后，随 onDataLoaded 一起返回。
 * 核心框架会将其序列化到 loader_metadata，用于刷新/重放。
 * 
 * 各 BI 平台的 loadParams 差异极大（见下方"兼容性分析"），
 * 因此 loadParams 设计为 Record<string, any>——框架不解析，
 * 只原样存储，刷新时原样回传给插件后端。
 */
export interface DataProvenance {
  pluginId: string;           // "superset" | "metabase" | ...
  sourceType: string;         // 插件自定义的来源类型，如 "dataset" | "dashboard_chart" | "question"
  sourceId: string;           // 外部系统中的唯一标识（dataset_id、card_id 等）
  sourceName: string;         // 人类可读的名称（用于 UI 显示"来自 xxx"）
  loadParams: Record<string, any>;  // 加载时使用的完整参数（过滤器、行限制、时间范围等）
  loadedAt: string;           // ISO 8601 时间戳
  refreshable: boolean;       // 是否支持用同样的参数刷新
}

export interface PluginPanelProps {
  pluginId: string;
  config: Record<string, any>;     // 从 /api/app-config 获取的插件配置
  onDataLoaded: (result: {         // 数据加载完成后的回调
    tableName: string;
    rowCount: number;
    columns: string[];
    source: 'workspace' | 'json';  // 数据在 workspace 中还是在响应 JSON 中
    rows?: any[];                  // source === 'json' 时提供
    provenance: DataProvenance;    // 数据溯源信息（用于刷新和 UI 显示）
  }) => void;
  onPreviewLoaded?: (result: {     // 预览数据回调（可选，框架支持但不强制）
    columns: string[];
    sampleRows: any[];             // 预览行（通常 50-100 行）
    totalRowEstimate?: number;     // 总行数估计
    provenance: DataProvenance;
  }) => void;
}

export interface DataSourcePluginModule {
  manifest: PluginManifest;
  
  // 主面板组件（显示在 UnifiedDataUploadDialog 的 Tab 中）
  PanelComponent: React.ComponentType<PluginPanelProps>;
  
  // 登录组件（可选，如果插件有自己的认证流程）
  LoginComponent?: React.ComponentType<{
    config: Record<string, any>;
    onLoginSuccess: () => void;
  }>;
}
```

### 7.2 Plugin Host（前端插件容器）

在 `UnifiedDataUploadDialog.tsx` 中增加一个通用的插件 Tab 渲染逻辑：

```typescript
// 伪代码：插件面板的渲染

// 1. 从 /api/app-config 拿到已启用插件列表
const enabledPlugins = serverConfig.plugins; // [{ id: "superset", ... }, ...]

// 2. 动态导入对应的插件模块
const pluginModules = usePluginModules(enabledPlugins);

// 3. 在数据加载对话框中，为每个插件渲染一个 Tab
{pluginModules.map(plugin => (
  <TabPanel key={plugin.manifest.id} index={plugin.manifest.id} value={currentTab}>
    <plugin.PanelComponent
      pluginId={plugin.manifest.id}
      config={enabledPlugins.find(p => p.id === plugin.manifest.id)}
      onDataLoaded={handlePluginDataLoaded}
    />
  </TabPanel>
))}
```

### 7.3 数据加载完成后的流程

插件面板通过 `onDataLoaded` 回调通知宿主。宿主根据 `source` 字段决定下一步：

```
onDataLoaded({ tableName, source, provenance })
  │
  ├─ source === 'workspace'
  │   → 调用 GET /api/tables/list-tables 刷新表列表
  │   → 新表自动出现在左侧面板
  │   → provenance 序列化到 loader_metadata（用于刷新）
  │
  └─ source === 'json'
      → 构建 DictTable
      → dispatch(loadTable({ table, storeOnServer: true }))
      → 走常规 loadTable 流程
      → provenance 同样保存
```

### 7.4 数据刷新协议

当一个表的 `loader_metadata` 中包含 `provenance`（即通过插件加载的数据），前端可以在表上显示"刷新"按钮。刷新时将 `provenance` 回传给插件后端：

```
用户点击表上的「刷新」按钮
  → 框架取出 loader_metadata.provenance
  → POST /api/plugins/{provenance.pluginId}/data/refresh
    Body: {
      source_type: provenance.sourceType,
      source_id: provenance.sourceId,
      load_params: provenance.loadParams,  ← 完整的原始查询参数
      table_name: 当前表名                  ← 覆盖写入
    }
  → 插件后端用同样的参数重新拉取数据
  → 写入同名表（覆盖）
  → 前端刷新表列表
```

后端实现：每个插件可选实现 `/data/refresh` 路由。由于 `load_params` 是插件自己定义和存储的，刷新时原样取出即可：

```python
# plugins/superset/routes/data.py 中的 refresh 路由

@bp.route("/data/refresh", methods=["POST"])
def refresh_dataset():
    data = request.get_json()
    source_type = data["source_type"]   # "dataset"
    source_id = data["source_id"]       # "42"
    load_params = data["load_params"]   # { "filters": [...], "row_limit": 10000, ... }
    table_name = data["table_name"]     # 覆盖同名表

    # 用 load_params 中的参数重新执行查询——与首次加载逻辑复用
    df = _fetch_dataset(source_id, **load_params)

    return jsonify(writer.write_dataframe(df, table_name, overwrite=True,
        source_metadata={"source_type": source_type, "source_id": source_id,
                         "loader_params": load_params}))
```

**关键设计决策**：`load_params` 是个**不透明的 JSON 对象**。框架只负责存储和回传，不解析其内部结构。这样每个 BI 平台都可以在里面放自己特有的参数，框架完全不需要知道各平台的参数细节。

### 7.5 各 BI 平台查询参数兼容性分析

这是选择"参数不透明"设计的核心原因——各平台的参数差异太大，无法统一：

#### Superset 的 `load_params` 示例

```json
{
  "entry_type": "dataset",
  "dataset_id": 42,
  "database_id": 1,
  "schema": "public",
  "filters": [
    { "col": "region", "op": "==", "val": "Asia" },
    { "col": "order_date", "op": ">=", "val": "2025-01-01" }
  ],
  "row_limit": 50000,
  "sql_override": null
}
```

从仪表盘图表加载时：

```json
{
  "entry_type": "dashboard_chart",
  "dashboard_id": 7,
  "chart_id": 123,
  "dataset_id": 42,
  "native_filters": {
    "NATIVE_FILTER-abc": { "col": "country", "op": "IN", "val": ["CN", "JP"] }
  },
  "time_range": "Last 90 days",
  "granularity": "P1D",
  "row_limit": 10000
}
```

#### Metabase 的 `load_params` 示例

```json
{
  "entry_type": "question",
  "card_id": 156,
  "parameters": [
    { "type": "date/range", "target": ["variable", ["template-tag", "date_range"]], "value": "2025-01-01~2025-03-31" },
    { "type": "category", "target": ["dimension", ["field", 23, null]], "value": ["Active"] }
  ]
}
```

从 Dashboard 加载时：

```json
{
  "entry_type": "dashboard",
  "dashboard_id": 8,
  "card_id": 156,
  "dashboard_filters": {
    "Status": "Active",
    "Date Range": "past30days"
  }
}
```

#### Power BI 的 `load_params` 示例

```json
{
  "entry_type": "report_visual",
  "workspace_id": "aaa-bbb-ccc",
  "report_id": "ddd-eee-fff",
  "page_name": "ReportSection1",
  "visual_name": "SalesChart",
  "dax_query": "EVALUATE TOPN(10000, Sales, Sales[Date], DESC)",
  "slicer_state": {
    "Region": ["Asia", "Europe"],
    "Year": [2024, 2025]
  }
}
```

#### Grafana 的 `load_params` 示例

```json
{
  "entry_type": "panel",
  "dashboard_uid": "abc123",
  "panel_id": 4,
  "datasource_uid": "prometheus-1",
  "time_range": { "from": "now-24h", "to": "now" },
  "interval": "5m",
  "variables": {
    "host": "server-01",
    "env": "production"
  },
  "max_data_points": 1000
}
```

#### Looker 的 `load_params` 示例

```json
{
  "entry_type": "explore",
  "model_name": "ecommerce",
  "explore_name": "orders",
  "fields": ["orders.id", "orders.total", "users.name"],
  "filters": {
    "orders.created_date": "90 days",
    "orders.status": "complete"
  },
  "sorts": ["orders.total desc"],
  "limit": 5000,
  "pivots": ["orders.created_month"]
}
```

#### 为什么不尝试统一过滤器格式

可以看到，每个平台的过滤器语义完全不同：

| 平台 | 过滤器模型 | 特点 |
|------|----------|------|
| Superset | `col + op + val` + SQL WHERE | 列级过滤 + 原生 SQL |
| Metabase | Template Tag + Dimension Target | 绑定到查询模板的参数化变量 |
| Power BI | Slicer State + DAX Expression | 交互式切片器 + 查询语言 |
| Grafana | Template Variable + Ad-hoc Filter | 变量替换 + 即席过滤 |
| Looker | LookML Filter Expression | 模型驱动的过滤表达式语言 |

如果强行定义 `UnifiedFilter = { column, operator, value }` 这样的通用格式，会导致：
1. 丢失平台特有能力（如 Metabase 的 Template Tag、Grafana 的 Variable）
2. 每个插件需要做双向转换（通用格式 ↔ 平台原生格式），增加复杂度
3. 通用格式不可避免地变成"最大公约数"，表达力反而最弱

**因此，`load_params` 保持为不透明 JSON 是正确的设计**：框架只负责"存储 → 回传 → 刷新"，不试图理解参数内容。

### 7.6 预览协议（可选能力）

部分 BI 平台支持在全量加载前预览少量数据。插件可以通过 `onPreviewLoaded` 回调返回预览结果：

```
用户在 Superset 数据集上点击「预览」
  → 插件前端调用 GET /api/plugins/superset/data/preview?dataset_id=42&limit=50
  → 后端拉取 50 行样本数据
  → 返回 JSON（不写入 Workspace）
  → 插件前端调用 onPreviewLoaded({ columns, sampleRows, totalRowEstimate })
  → 框架在对话框中渲染预览表格
  → 用户确认后点「加载」→ 走完整的 onDataLoaded 流程
```

预览是可选能力。后端路由约定为 `/data/preview`，前端通过 `manifest.capabilities` 中是否包含 `"preview"` 来判断是否显示预览按钮。

### 7.7 外部系统元数据拉取

很多 BI 平台为数据集和字段维护了丰富的元数据（描述信息、语义标签、认证状态等）。将这些元数据随数据一起拉取到 DF 有极高价值——它们可以直接填入 DF 已有的 `semanticType` 和 `attachedMetadata` 字段，大幅提升 AI Agent 的分析质量。

#### 7.7.1 各 BI 平台提供的元数据对比

| 元数据类型 | Superset | Metabase | Power BI | Looker |
|-----------|----------|----------|----------|--------|
| **表级描述** | `dataset.description` | `table.description` | `table.description` | `explore.description` |
| **表级标签** | `dataset.owners`, `is_certified` | `table.visibility_type` | — | `explore.tags` |
| **列名** | `column.column_name` | `field.name` | `column.name` | `field.name` |
| **列描述** | `column.description` | `field.description` | `column.description` | `field.description` |
| **列数据类型** | `column.type` | `field.base_type` | `column.dataType` | `field.type` |
| **列语义类型** | `column.is_dttm`, `filterable`, `groupby` | `field.semantic_type` (如 `type/Email`, `type/FK`) | `column.formatString` | `field.tags` (如 `email`, `currency`) |
| **计算列/度量** | `metric.expression`, `metric.description` | `field.formula` | `measure.expression` | `measure.sql` |
| **值域统计** | — | `field.fingerprint` (分布统计) | — | `field.enumerations` |

#### 7.7.2 设计：扩展 ColumnInfo 和 TableMetadata

**后端**：在现有的 `ColumnInfo` 和 `TableMetadata` 中增加可选字段承载外部元数据。

```python
# py-src/data_formulator/datalake/metadata.py — 扩展

@dataclass
class ColumnInfo:
    """Information about a single column in a table."""
    name: str
    dtype: str
    # ↓ 新增：来自外部系统的元数据（可选）
    description: str | None = None       # 列描述（"订单创建日期"）
    semantic_type: str | None = None     # 语义类型（"datetime", "email", "currency", "foreign_key"）
    is_metric: bool = False              # 是否为度量/计算字段
    expression: str | None = None        # 计算表达式（如 Superset metric 的 SQL 表达式）
    tags: list[str] | None = None        # 标签（如 ["filterable", "groupby", "certified"]）

    def to_dict(self) -> dict:
        d = {"name": self.name, "dtype": self.dtype}
        if self.description:     d["description"] = self.description
        if self.semantic_type:   d["semantic_type"] = self.semantic_type
        if self.is_metric:       d["is_metric"] = self.is_metric
        if self.expression:      d["expression"] = self.expression
        if self.tags:            d["tags"] = self.tags
        return d


@dataclass
class TableMetadata:
    """Metadata for a single table/file in the workspace."""
    name: str
    source_type: Literal["upload", "data_loader"]
    # ... 现有字段 ...
    columns: list[ColumnInfo] | None = None
    # ↓ 新增：来自外部系统的表级元数据（可选）
    description: str | None = None       # 表/数据集描述
    tags: list[str] | None = None        # 表级标签（如 ["certified", "production"]）
    owners: list[str] | None = None      # 数据所有者
```

这些字段全部是**可选的**（默认 `None`），对现有的 Upload/Paste/Database 数据加载路径零影响。只有通过插件加载的数据才会填充这些字段。

#### 7.7.3 插件如何提供元数据

`PluginDataWriter.write_dataframe()` 的 `source_metadata` 已经支持任意结构。新增一个专用的 `column_metadata` 参数让插件传入列级信息：

```python
# plugins/data_writer.py — 扩展 write_dataframe

def write_dataframe(
    self,
    df: pd.DataFrame,
    table_name: str,
    *,
    overwrite: bool = True,
    source_metadata: dict[str, Any] | None = None,
    column_metadata: dict[str, dict] | None = None,   # ← 新增
    table_description: str | None = None,              # ← 新增
    table_tags: list[str] | None = None,               # ← 新增
) -> dict[str, Any]:
    # ...写入 Parquet（不变）...

    # 如果插件提供了外部元数据，合并到 ColumnInfo 中
    if column_metadata:
        enriched_columns = []
        for col in (meta.columns or []):
            ext = column_metadata.get(col.name, {})
            enriched_columns.append(ColumnInfo(
                name=col.name,
                dtype=col.dtype,
                description=ext.get("description"),
                semantic_type=ext.get("semantic_type"),
                is_metric=ext.get("is_metric", False),
                expression=ext.get("expression"),
                tags=ext.get("tags"),
            ))
        # 更新 workspace metadata 中的 columns
        meta.columns = enriched_columns

    if table_description:
        meta.description = table_description
    if table_tags:
        meta.tags = table_tags
    # ... 保存 metadata ...
```

Superset 插件的调用示例：

```python
# plugins/superset/routes/data.py

def load_dataset():
    # ...从 Superset API 拉取数据集详情...
    dataset_info = superset_client.get_dataset(dataset_id)

    # 提取 Superset 提供的列元数据
    col_meta = {}
    for col in dataset_info.get("columns", []):
        col_meta[col["column_name"]] = {
            "description": col.get("description"),
            "semantic_type": "datetime" if col.get("is_dttm") else None,
            "tags": [t for t in ["filterable", "groupby"]
                     if col.get(t)],
        }
    # Superset 的 metric 也作为列
    for metric in dataset_info.get("metrics", []):
        col_meta[metric["metric_name"]] = {
            "description": metric.get("description"),
            "is_metric": True,
            "expression": metric.get("expression"),  # 如 "SUM(order_amount)"
        }

    # 写入时同时传入元数据
    result = writer.write_dataframe(
        df, table_name, overwrite=True,
        source_metadata={...},
        column_metadata=col_meta,
        table_description=dataset_info.get("description"),
        table_tags=(["certified"] if dataset_info.get("is_certified") else []),
    )
```

#### 7.7.4 元数据如何流向前端 AI 分析

```
Superset API                  后端 Workspace                前端 DictTable
────────────                  ─────────────                ──────────────
dataset.description     →  TableMetadata.description  →  DictTable.attachedMetadata
                                                          (AI prompt 的表描述)

column.description      →  ColumnInfo.description     →  DictTable.metadata[col].description
column.is_dttm          →  ColumnInfo.semantic_type   →  DictTable.metadata[col].semanticType
                                                          (跳过 AI 推断，直接使用)

metric.expression       →  ColumnInfo.expression      →  (AI 可据此理解度量含义)
```

**关键价值**：DF 现有的 `fetchFieldSemanticType` 调用 AI Agent 来推断列的语义类型（日期、货币、邮箱等）。如果 BI 系统已经标注了这些信息，可以**直接填入，跳过 AI 推断**——既快又准：

```typescript
// list-tables 响应 → 构建 DictTable 时
const metadata: Record<string, FieldMetadata> = {};
for (const col of serverColumns) {
    metadata[col.name] = {
        type: inferTypeFromDtype(col.dtype),
        semanticType: col.semantic_type || "",  // 优先使用外部元数据
        levels: [],
        unit: undefined,
    };
    // 如果有外部描述，附加到 column 级别
    if (col.description) {
        metadata[col.name].description = col.description;
    }
}

// 表描述 → attachedMetadata（AI prompt 使用）
const attachedMetadata = serverMeta.description
    ? `来源: ${serverMeta.source_type}. ${serverMeta.description}`
    : "";
```

当 AI Agent 生成分析建议或可视化代码时，`attachedMetadata` 中的表描述和列描述会自动进入 prompt，让 AI 更好地理解数据含义。

#### 7.7.5 各平台元数据映射表

| DF 目标字段 | Superset 来源 | Metabase 来源 | Power BI 来源 | Looker 来源 |
|------------|--------------|--------------|--------------|-------------|
| `TableMetadata.description` | `dataset.description` | `table.description` | `table.description` | `explore.description` |
| `TableMetadata.tags` | `["certified"]` if `is_certified` | `[visibility_type]` | — | `explore.tags` |
| `TableMetadata.owners` | `dataset.owners[].username` | — | `dataset.configuredBy` | `explore.owner` |
| `ColumnInfo.description` | `column.description` | `field.description` | `column.description` | `field.description` |
| `ColumnInfo.semantic_type` | `"datetime"` if `is_dttm` | `field.semantic_type` | 从 `formatString` 推断 | `field.tags` |
| `ColumnInfo.is_metric` | — (metrics 单独) | — | `measure` 类型列 | `field.category == "measure"` |
| `ColumnInfo.expression` | `metric.expression` | — | `measure.expression` (DAX) | `measure.sql` |
| `ColumnInfo.tags` | `["filterable","groupby"]` | `["has_field_values"]` | — | `field.tags` |

#### 7.7.6 元数据是"有则更好"，非强制

整个元数据拉取机制遵循**渐进增强**原则：

```
层次 0: 无外部元数据（Upload/Paste/Database 的现有行为）
  → DF 通过 AI Agent 推断 semanticType
  → attachedMetadata 为空
  → 完全不受影响

层次 1: 只有列名和数据类型（插件最低要求）
  → 与 Upload 行为一致
  → AI Agent 自动推断语义类型

层次 2: 有列描述和表描述（大多数 BI 平台可以提供）
  → 跳过 AI 语义推断，直接使用
  → AI 分析 prompt 质量显著提高

层次 3: 有完整元数据（语义类型、度量表达式、标签、所有者等）
  → 前端可显示丰富的列信息（tooltip、图标标注）
  → AI 可以理解计算逻辑（"SUM(order_amount)" 表示总金额）
  → 认证/可信标签帮助用户选择正确的数据集
```

插件开发者只需要在 `column_metadata` 中填入能获取到的字段即可，缺失的字段框架自动忽略。

---

## 8. 插件注册与发现

### 8.1 注册机制：目录自动扫描

现有 `ExternalDataLoader` 使用硬编码的 `_LOADER_SPECS` 列表注册，每新增一个 loader 需要改 `__init__.py` 加一行。对于数据源插件，我们选择**目录自动扫描**：

| 方案 | 新增插件要改代码吗 | 适合场景 |
|------|:---:|------|
| ~~硬编码列表~~ (`_LOADER_SPECS` 风格) | 要，改注册表一行 | 种类固定、很少新增 |
| **目录自动扫描** (选用) | 不要，创建目录即可 | 种类持续增长，希望"拖入即用" |
| ~~setuptools entry_points~~ | 不要，pip install 后自动注册 | 插件作为独立 pip 包发布（过重） |

**选择自动扫描的理由**：
1. 对接的报表系统只会越来越多，每次加一个都改注册表是无意义的样板修改
2. 插件的 `manifest()` 已经包含了 ID、必需环境变量等元数据，不需要在注册表中重复声明
3. 通过 `PLUGIN_BLOCKLIST` 环境变量提供安全黑名单能力

#### 插件约定

每个插件是 `plugins/` 目录下的一个 Python 子包，必须满足：

```
plugins/superset/
├── __init__.py         ← 必须暴露 plugin_class = SupersetPlugin
├── superset_client.py
├── auth_bridge.py
├── catalog.py
└── routes/
    ├── auth.py
    ├── catalog.py
    └── data.py
```

`__init__.py` 的最低要求：

```python
# plugins/superset/__init__.py
from .plugin import SupersetPlugin

# 框架通过此变量发现插件类
plugin_class = SupersetPlugin
```

#### 自动扫描实现

```python
# py-src/data_formulator/plugins/__init__.py

"""
数据源插件自动发现与注册。

扫描 plugins/ 目录下所有子包，查找暴露 plugin_class 变量的模块。
通过 manifest() 中的 required_env 判断是否启用。
通过 PLUGIN_BLOCKLIST 环境变量支持显式禁用。

新增插件步骤：
  1. 在 plugins/ 下创建子目录
  2. __init__.py 中暴露 plugin_class = YourPlugin
  3. .env 中设置必需环境变量
  4. 重启服务 → 自动发现、自动注册
  无需修改任何现有代码。
"""

import importlib
import logging
import os
import pkgutil
from typing import Any

from data_formulator.plugins.base import DataSourcePlugin

_log = logging.getLogger(__name__)

ENABLED_PLUGINS: dict[str, DataSourcePlugin] = {}
DISABLED_PLUGINS: dict[str, str] = {}

# 显式黑名单：PLUGIN_BLOCKLIST=powerbi,grafana
_BLOCKLIST = set(
    p.strip()
    for p in os.environ.get("PLUGIN_BLOCKLIST", "").split(",")
    if p.strip()
)


def discover_and_register(app) -> None:
    """扫描 plugins/ 子包，发现并注册所有已启用的插件。

    在 app.py 的 _register_blueprints() 中调用一次。
    """
    for finder, pkg_name, ispkg in pkgutil.iter_modules(__path__):
        # 跳过非包（如 base.py, data_writer.py）和黑名单
        if not ispkg:
            continue
        if pkg_name in _BLOCKLIST:
            DISABLED_PLUGINS[pkg_name] = "Blocked by PLUGIN_BLOCKLIST"
            _log.info("Plugin '%s' blocked by PLUGIN_BLOCKLIST", pkg_name)
            continue

        try:
            mod = importlib.import_module(f"data_formulator.plugins.{pkg_name}")
        except ImportError as exc:
            DISABLED_PLUGINS[pkg_name] = f"Missing dependency: {exc.name}"
            _log.info("Plugin '%s' disabled (import error): %s", pkg_name, exc)
            continue

        # 检查是否暴露了 plugin_class
        plugin_cls = getattr(mod, "plugin_class", None)
        if plugin_cls is None:
            continue  # 不是插件目录（可能是工具模块），静默跳过
        if not (isinstance(plugin_cls, type) and issubclass(plugin_cls, DataSourcePlugin)):
            _log.warning(
                "Plugin '%s': plugin_class is not a DataSourcePlugin subclass, skipped",
                pkg_name,
            )
            continue

        # 从 manifest 获取元数据
        try:
            manifest = plugin_cls.manifest()
        except Exception as exc:
            DISABLED_PLUGINS[pkg_name] = f"manifest() failed: {exc}"
            _log.error("Plugin '%s' manifest() failed: %s", pkg_name, exc)
            continue

        plugin_id = manifest["id"]
        required_env = manifest.get("required_env", [])

        # 检查必需环境变量
        missing_env = [e for e in required_env if not os.environ.get(e)]
        if missing_env:
            DISABLED_PLUGINS[plugin_id] = f"Not configured: {', '.join(missing_env)}"
            _log.info("Plugin '%s' disabled: missing env %s", plugin_id, ", ".join(missing_env))
            continue

        # 实例化、注册 Blueprint、启用
        try:
            plugin: DataSourcePlugin = plugin_cls()
            bp = plugin.create_blueprint()
            app.register_blueprint(bp)
            plugin.on_enable(app)

            ENABLED_PLUGINS[plugin_id] = plugin
            _log.info("Plugin '%s' enabled (auto-discovered from plugins/%s/)", plugin_id, pkg_name)
        except Exception as exc:
            DISABLED_PLUGINS[plugin_id] = str(exc)
            _log.error("Plugin '%s' failed to initialize: %s", plugin_id, exc, exc_info=True)
```

#### 发现流程图

```
plugins/
├── __init__.py          ← discover_and_register() 在这里
├── base.py              ← DataSourcePlugin 基类 (ispkg=False, 跳过)
├── data_writer.py       ← 工具模块 (ispkg=False, 跳过)
├── superset/            ← ispkg=True → 检查 plugin_class
│   └── __init__.py      → plugin_class = SupersetPlugin
│                          → manifest(): required_env=["SUPERSET_URL"]
│                          → SUPERSET_URL 存在? → 是 → ENABLED ✅
│                                               → 否 → DISABLED
├── metabase/            ← ispkg=True → 检查 plugin_class
│   └── __init__.py      → plugin_class = MetabasePlugin
│                          → METABASE_URL 不存在 → DISABLED
└── _helpers/            ← ispkg=True, 但无 plugin_class → 静默跳过
```

#### 安全措施

| 措施 | 说明 |
|------|------|
| **类型校验** | `plugin_class` 必须是 `DataSourcePlugin` 的子类 |
| **环境变量门控** | `required_env` 中的变量缺失则不启用 |
| **显式黑名单** | `PLUGIN_BLOCKLIST=powerbi,grafana` 可以禁用特定插件 |
| **Blueprint 前缀隔离** | 路由强制在 `/api/plugins/<id>/` 下 |
| **错误隔离** | 单个插件加载失败不影响其他插件和核心系统 |

### 8.2 在 app.py 中集成（一次性改动）

```python
# app.py 的 _register_blueprints() 中增加：

def _register_blueprints():
    # ... 现有的 Blueprint 注册 ...
    
    # 新增：加载数据源插件
    print("  Loading data source plugins...", flush=True)
    from data_formulator.plugins import discover_and_register
    discover_and_register(app)
```

### 8.3 在 /api/app-config 中暴露插件信息

```python
# app.py 的 get_app_config() 中增加：

@app.route('/api/app-config', methods=['GET'])
def get_app_config():
    config = {
        # ... 现有配置 ...
    }
    
    # 新增：插件信息
    from data_formulator.plugins import ENABLED_PLUGINS
    plugins_config = {}
    for plugin_id, plugin in ENABLED_PLUGINS.items():
        manifest = plugin.manifest()
        frontend_config = plugin.get_frontend_config()
        plugins_config[plugin_id] = {
            "id": plugin_id,
            "name": manifest["name"],
            "icon": manifest.get("icon"),
            "description": manifest.get("description"),
            "auth_type": manifest.get("auth_type", "none"),
            "capabilities": manifest.get("capabilities", []),
            **frontend_config,
        }
    config["PLUGINS"] = plugins_config
    
    return flask.jsonify(config)
```

### 8.4 前端自动发现

利用 Vite 的 `import.meta.glob` 实现编译时自动扫描，与后端的目录自动扫描对称：

```typescript
// src/plugins/registry.ts

import { DataSourcePluginModule } from "./types";

// Vite 编译时自动扫描 src/plugins/*/index.ts
// 返回 { "./superset/index.ts": () => import(...), "./metabase/index.ts": () => import(...) }
const pluginModules = import.meta.glob<{ default: DataSourcePluginModule }>(
    "./*/index.ts"
);

// 提取插件 ID → 懒加载函数的映射
const pluginLoaders: Record<string, () => Promise<DataSourcePluginModule>> = {};
for (const [path, loader] of Object.entries(pluginModules)) {
    // "./superset/index.ts" → "superset"
    const match = path.match(/^\.\/([^/]+)\/index\.ts$/);
    if (match) {
        const pluginId = match[1];
        pluginLoaders[pluginId] = () => loader().then((m) => m.default);
    }
}

export async function loadEnabledPlugins(
    enabledPluginIds: string[]
): Promise<DataSourcePluginModule[]> {
    const modules: DataSourcePluginModule[] = [];
    for (const id of enabledPluginIds) {
        const loader = pluginLoaders[id];
        if (loader) {
            try {
                modules.push(await loader());
            } catch (e) {
                console.warn(`Failed to load plugin: ${id}`, e);
            }
        }
    }
    return modules;
}
```

`import.meta.glob` 在编译时扫描 `src/plugins/*/index.ts`，新增插件只需在 `src/plugins/` 下创建目录并导出 `index.ts`，无需手动维护 `pluginLoaders` 映射表。未启用的插件虽然会被打包为独立 chunk，但不会被加载到浏览器中（懒加载，按需触发）。

> **后端 `pkgutil.iter_modules` + 前端 `import.meta.glob` = 全栈零注册新增插件。**

---

## 9. 数据流设计

### 9.1 端到端流程

```
┌─────────────────────────────────────────────────────────────────┐
│                         启动阶段                                 │
│                                                                  │
│  1. 环境变量设置 SUPERSET_URL=http://superset:8088              │
│  2. app.py → _register_blueprints() → discover_and_register()  │
│  3. SupersetPlugin 被实例化，Blueprint 被注册                    │
│  4. /api/app-config 返回 PLUGINS: { superset: { enabled, ... }}  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        前端初始化                                │
│                                                                  │
│  1. App.tsx 请求 /api/app-config                                 │
│  2. 解析 PLUGINS 字段 → 存入 Redux (serverConfig.plugins)       │
│  3. 动态加载对应的前端插件模块                                    │
│  4. 如果插件需要认证且未登录 → 显示登录入口                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     认证阶段（以 Superset 为例）                  │
│                                                                  │
│  用户点击「连接 Superset」                                       │
│    → 显示 Superset 登录组件                                      │
│    → POST /api/plugins/superset/auth/login                       │
│    → 后端转发到 Superset JWT 登录                                │
│    → Token 存入 Flask Session                                    │
│    → 返回用户信息给前端                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     浏览阶段                                     │
│                                                                  │
│  用户打开「数据源」对话框 → 看到 Superset Tab                    │
│    → 请求 /api/plugins/superset/catalog/datasets                 │
│    → 后端用 JWT 调用 Superset API                                │
│    → 返回用户有权限看到的数据集列表                               │
│    → 前端渲染数据集目录（搜索、预览等）                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     数据加载阶段                                  │
│                                                                  │
│  用户选中一个数据集，点击「加载」                                 │
│    → POST /api/plugins/superset/data/load-dataset                │
│    → 后端通过 Superset SQL Lab 执行查询（尊重 RBAC + RLS）       │
│    → pd.DataFrame → workspace.write_parquet()                    │
│    → 返回 { table_name, row_count, columns }                     │
│                                                                  │
│  前端收到响应：                                                   │
│    → onDataLoaded({ tableName, source: 'workspace' })            │
│    → 触发 list-tables 刷新                                       │
│    → 新表出现在左侧面板                                          │
│    → 用户可以开始数据分析                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 认证会话管理

每个插件的认证信息独立存储在 Flask Session 中，以 `plugin_id` 为前缀隔离：

```python
# 存储
session[f"plugin_{plugin_id}_token"] = access_token
session[f"plugin_{plugin_id}_user"] = user_info

# 读取
token = session.get(f"plugin_{plugin_id}_token")
```

前端通过 `/api/plugins/{plugin_id}/auth/status` 查询当前认证状态。

#### 与 SSO 的集成（详见 `sso-plugin-architecture.md`）

当系统配置了 OIDC SSO 后，插件的认证有三种模式自动协商：

```
场景 A: DF 有 SSO + 外部系统也接了同一 IdP
  → 自动 SSO Token 透传（用户零交互）

场景 B: DF 有 SSO + 外部系统没有接 SSO
  → 用户首次输入凭证 → 存入 CredentialVault → 后续自动取出

场景 C: DF 无 SSO（本地匿名模式）
  → 手动登录 → Token 存 Flask Session（现有行为）
```

---

## 10. Superset 插件迁移示例

将 0.6 版本的 Superset 集成迁移为插件：

### 10.1 后端

```
py-src/data_formulator/plugins/superset/
├── __init__.py               # SupersetPlugin 类（实现 DataSourcePlugin）
├── superset_client.py        # ← 直接迁移自 0.6
├── auth_bridge.py            # ← 直接迁移自 0.6
├── catalog.py                # ← 直接迁移自 0.6
├── routes/
│   ├── __init__.py
│   ├── auth.py               # ← 迁移自 0.6 auth_routes.py
│   ├── catalog.py            # ← 迁移自 0.6 catalog_routes.py
│   └── data.py               # ← 迁移自 0.6 data_routes.py（改用 workspace）
└── requirements.txt          # requests（已内置，无额外依赖）
```

### 10.2 核心改动

**data_routes.py 的变化**：0.6 用 DuckDB，0.7 用 Workspace Parquet

```python
# 0.6 版本：写入 DuckDB
with db_manager.connection(sid) as conn:
    conn.execute(f'DROP TABLE IF EXISTS "{safe_name}"')
    conn.execute(f'CREATE TABLE "{safe_name}" AS SELECT * FROM df')

# 0.7 插件版本：写入 Workspace Parquet
from data_formulator.workspace_factory import get_workspace
from data_formulator.auth import get_identity_id

workspace = get_workspace(get_identity_id())
workspace.write_parquet(df, safe_name)
```

### 10.3 前端

```
src/plugins/superset/
├── index.ts                  # 导出 DataSourcePluginModule
├── SupersetPanel.tsx         # ← 迁移自 0.6（Tab 容器）
├── SupersetCatalog.tsx       # ← 迁移自 0.6（数据集目录）
├── SupersetDashboards.tsx    # ← 迁移自 0.6（仪表盘列表）
├── SupersetFilterDialog.tsx  # ← 迁移自 0.6（筛选条件对话框）
├── SupersetLogin.tsx         # ← 迁移自 0.6 LoginView（Superset 部分）
└── api.ts                    # API 调用封装
```

### 10.4 SupersetPlugin 实现

```python
class SupersetPlugin(DataSourcePlugin):
    
    @staticmethod
    def manifest():
        return {
            "id": "superset",
            "name": "Apache Superset",
            "icon": "superset",
            "description": "从 Superset 仪表盘和数据集加载数据",
            "version": "1.0.0",
            "env_prefix": "SUPERSET",
            "required_env": ["SUPERSET_URL"],
            "auth_type": "jwt",
            "capabilities": [
                "datasets", "dashboards", "filters",
                "preview", "refresh", "batch_load", "metadata",
            ],
            "catalog_entry_types": [
                {
                    "type": "dataset",
                    "label": "数据集",
                    "icon": "table_chart",
                    "supports_filters": True,
                },
                {
                    "type": "dashboard_chart",
                    "label": "仪表盘图表",
                    "icon": "dashboard",
                    "supports_filters": True,
                },
            ],
        }
    
    def create_blueprint(self):
        from data_formulator.plugins.superset.routes import create_superset_blueprint
        return create_superset_blueprint(self._client, self._catalog, self._bridge)
    
    def get_frontend_config(self):
        url = os.environ.get("SUPERSET_URL", "")
        return {
            "enabled": True,
            "sso_login_url": f"{url.rstrip('/')}/df-sso-bridge/" if url else None,
        }
    
    def on_enable(self, app):
        url = os.environ["SUPERSET_URL"]
        self._client = SupersetClient(url)
        self._bridge = SupersetAuthBridge(url)
        self._catalog = SupersetCatalog(self._client)
        app.extensions["superset_client"] = self._client
        app.extensions["superset_bridge"] = self._bridge
        app.extensions["superset_catalog"] = self._catalog
```

---

## 11. 与现有 ExternalDataLoader 的关系

### 11.1 两套机制并行

```
数据源类型        │  适用机制            │  原因
─────────────────┼─────────────────────┼──────────────────────
MySQL/PG/MSSQL   │  ExternalDataLoader │  标准数据库连接，无需额外认证/UI
MongoDB/BigQuery │  ExternalDataLoader │  同上
S3/Azure Blob    │  ExternalDataLoader │  文件存储，list+fetch 即可
─────────────────┼─────────────────────┼──────────────────────
Superset         │  DataSourcePlugin   │  需要认证流程、目录浏览、筛选、RBAC
Metabase         │  DataSourcePlugin   │  同上
Power BI         │  DataSourcePlugin   │  同上
Grafana          │  DataSourcePlugin   │  同上
```

### 11.2 判断依据

使用 **ExternalDataLoader** 的场景：
- 只需要连接参数 → 列出表 → 拉取数据
- 前端用通用的 `DBManagerPane` 表单即可

使用 **DataSourcePlugin** 的场景：
- 有自己的认证体系（JWT / OAuth / SSO）
- 有自己的数据组织方式（仪表盘、报表、数据集等概念）
- 需要尊重外部系统的权限模型
- 需要专用的 UI（目录浏览、筛选条件等）

两套机制互不干扰，共存于系统中。

### 11.3 ExternalDataLoader 的现有缺陷与演进方向

审查了全部 9 个 DataLoader 后，发现两大类可改进的问题：

#### 缺陷一：数据库元数据（注释/描述）未拉取

所有 DataLoader 的 `list_tables()` 只查了 `information_schema` 的列名和数据类型，**完全忽略了数据库自带的注释系统**。这些注释是 DBA 维护的宝贵业务知识：

| DataLoader | 只查了 | 数据库有但没查的 | 查询方法 |
|---|---|---|---|
| **PostgreSQL** | `column_name`, `data_type` | 表/列注释 (`COMMENT ON`) | `SELECT obj_description(oid) FROM pg_class` + `SELECT col_description(attrelid, attnum) FROM pg_attribute` |
| **MSSQL** | `COLUMN_NAME`, `DATA_TYPE`, `IS_NULLABLE` | 扩展属性 (`MS_Description`) | `SELECT value FROM sys.extended_properties WHERE name='MS_Description'` |
| **BigQuery** | `field.name`, `field.field_type` | `table.description`, `field.description` | `table_ref.description`, `field.description`（已有 API，一行代码） |
| **MySQL** | (预估同样缺失) | `COLUMN_COMMENT` | `SELECT COLUMN_COMMENT FROM information_schema.COLUMNS` |
| **Kusto** | `Name`, `Type` | 表和列的 DocString | `.show table T schema` 返回的 `DocString` 字段 |

**改进方案**：扩展 `list_tables()` 返回的 `columns` 结构，增加 `description` 字段。以 PostgreSQL 为例：

```python
# postgresql_data_loader.py — list_tables() 增加注释查询

# 现有查询只拿了列名和类型：
columns_query = """
    SELECT column_name, data_type 
    FROM information_schema.columns ...
"""

# 改进后同时查询列注释：
columns_query = """
    SELECT 
        c.column_name,
        c.data_type,
        pgd.description AS column_comment
    FROM information_schema.columns c
    LEFT JOIN pg_catalog.pg_statio_all_tables st
        ON st.schemaname = c.table_schema AND st.relname = c.table_name
    LEFT JOIN pg_catalog.pg_description pgd
        ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
    WHERE c.table_schema = '{schema}' AND c.table_name = '{table_name}'
    ORDER BY c.ordinal_position
"""

# 表注释也一并查询：
table_comment_query = """
    SELECT obj_description(c.oid) AS table_comment
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '{schema}' AND c.relname = '{table_name}'
"""
```

BigQuery 改进更简单（已有现成属性，只是没用）：

```python
# bigquery_data_loader.py — list_tables() 中已经有 table_ref，只是没取 description

table_ref = self.client.get_table(table.reference)

# 现有代码：
columns = [{"name": field.name, "type": field.field_type} for field in table_ref.schema[:10]]

# 改进后：
columns = [{
    "name": field.name,
    "type": field.field_type,
    "description": field.description,  # ← 一行代码，BigQuery SDK 直接支持
} for field in table_ref.schema[:10]]

# 表描述也直接有：
table_description = table_ref.description  # ← 同样一行
```

**改进成本**：每个 DataLoader 改 5-20 行代码即可。注释不存在的列/表返回 `None`，与 7.7 节的 `ColumnInfo` 扩展字段完美对齐——对前端和 AI prompt 的提升效果与插件拉取的元数据一致。

#### 缺陷二：认证方式单一，缺少 SSO/集成认证

现有 DataLoader 的认证能力参差不齐，很多数据库明明支持 SSO 或集成认证，但 DataLoader 只实现了用户名/密码模式：

| DataLoader | 现有认证 | 数据库支持但 DataLoader 未实现的 |
|---|---|---|
| **PostgreSQL** | user + password | Kerberos/GSSAPI; Azure AD token (`password=<token>`); AWS IAM token |
| **MSSQL** | user/password 或 Windows Auth | Azure AD token (`Authentication=ActiveDirectoryAccessToken`) |
| **BigQuery** | Service Account JSON 或 ADC | OIDC 联邦身份 (`google.auth.identity_pool`); Workforce Identity |
| **Kusto** | App Key 或 `az login` | Azure AD user token (`with_aad_user_token_authentication`) |
| **Snowflake** | (未实现) | OAuth 2.0 token (`authenticator='oauth'`, `token=<token>`) |
| **Databricks** | (未实现) | Azure AD token / PAT |

Kusto 和 BigQuery 已经有了 CLI 认证（`az login` / `gcloud auth`），但这要求用户**在服务器终端上手动执行命令**——在团队部署模式下不现实。

**改进方案**：在 `ExternalDataLoader` 基类中增加 SSO token 注入能力。

```python
# external_data_loader.py — 基类扩展

class ExternalDataLoader(ABC):
    
    # 新增：声明该 loader 支持的认证方式
    @staticmethod
    def supported_auth_methods() -> list[str]:
        """返回支持的认证方式列表。
        
        可选值:
        - "credentials"     — 用户名/密码（默认，所有 loader 都支持）
        - "sso_token"       — OIDC/OAuth access_token
        - "azure_ad_token"  — Azure AD access_token
        - "iam_token"       — AWS IAM 认证 token
        - "service_account" — 服务账号 JSON key
        - "cli"             — 本地 CLI 认证（az login / gcloud auth）
        """
        return ["credentials"]
    
    # 新增：接受外部注入的 SSO token
    def set_auth_token(self, token: str, token_type: str = "bearer") -> None:
        """注入来自 DF SSO 层的认证 token（可选实现）。
        
        当 DF 用户通过 OIDC SSO 登录后，框架可以将 access_token
        传递给支持 token 认证的 DataLoader，替代用户手动输入密码。
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support token injection"
        )
```

以 Azure SQL 为例的具体实现：

```python
# mssql_data_loader.py — 扩展

class MSSQLDataLoader(ExternalDataLoader):

    @staticmethod
    def supported_auth_methods() -> list[str]:
        return ["credentials", "windows_auth", "azure_ad_token"]

    def __init__(self, params: dict[str, Any]):
        self.params = params
        auth_method = params.get("auth_method", "credentials")
        
        if auth_method == "azure_ad_token":
            # 使用来自 SSO 的 Azure AD token 连接
            token = params.get("access_token")
            if not token:
                raise ValueError("access_token required for Azure AD authentication")
            
            conn_str = (
                f"DRIVER={{{self.driver}}};"
                f"SERVER={self.server},{self.port};"
                f"DATABASE={self.database};"
            )
            # pyodbc 支持 attrs_before 传入 access token
            SQL_COPT_SS_ACCESS_TOKEN = 1256
            token_bytes = self._pack_access_token(token)
            self._conn = pyodbc.connect(
                conn_str,
                attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_bytes}
            )
        elif auth_method == "windows_auth":
            # 现有 Trusted_Connection 逻辑
            ...
        else:
            # 现有 user/password 逻辑
            ...
```

**前端配合**：当 DF 有 SSO 且 DataLoader 声明了 `"sso_token"` 能力时，前端可以显示"使用 SSO 登录连接"按钮，替代用户名/密码表单：

```
┌────────────────────────────────────────────────┐
│  连接到 Azure SQL                                │
│                                                  │
│  ● 使用 SSO 登录（推荐）  ← 有 SSO 时优先显示    │
│  ○ 输入用户名和密码                               │
│  ○ Windows 集成认证                               │
│                                                  │
│  服务器: sql.company.com                          │
│  数据库: analytics                                │
│                                                  │
│  [ 连接 ]                                         │
└────────────────────────────────────────────────┘
```

#### 缺陷三：凭证不持久化

当前 DataLoader 的连接参数（包括密码）存在**前端 Redux Store** 中，刷新页面即丢失。用户每次打开都要重新输入。接入 CredentialVault（`sso-plugin-architecture.md` 中设计）后可以提供"记住密码"能力。

#### 综合改进路线图

| 改进项 | 复杂度 | 价值 | 优先级 | 前置依赖 |
|--------|:---:|:---:|:---:|------|
| **数据库注释拉取** | 低（5-20 行/loader） | 高（直接提升 AI 分析质量） | P0 | 无（现在可做） |
| **SSO Token 透传** | 中 | 高（团队部署必需） | P1 | SSO AuthProvider 上线 |
| **凭证持久化** | 中 | 中（用户体验提升） | P2 | CredentialVault 上线 |
| **升级为 Plugin** | 高 | 低 | P3 | 仅 Snowflake 等需要 |

---

### 11.4 改进方案一：数据库元数据拉取 (P0)

**目标**：让 DataLoader 在 `list_tables()` 和 `ingest_to_workspace()` 时一并拉取数据库的表/列注释，写入 `ColumnInfo` 和 `TableMetadata`，最终流入前端 AI prompt。

**不修改基类接口**，仅在各 DataLoader 内部实现中增强查询逻辑。对前端无感，通过现有 `list-tables` API 自然下发。

#### 11.4.1 基类增加可选方法

```python
# external_data_loader.py — 新增可选方法

class ExternalDataLoader(ABC):
    # ... 现有方法不变 ...

    def fetch_table_description(self, source_table: str) -> str | None:
        """获取表的描述/注释（可选实现）。"""
        return None

    def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
        """获取各列的描述/注释（可选实现）。
        
        Returns:
            {"column_name": "列描述", ...}，缺失注释的列不含在结果中。
        """
        return {}
```

这两个方法**不是 abstract 的**——默认返回空，对现有 loader 零影响。哪个 loader 想支持元数据就 override 即可。

#### 11.4.2 各 DataLoader 的具体实现

**PostgreSQL**：

```python
# postgresql_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT obj_description(c.oid) AS comment
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '{schema}' AND c.relname = '{table}'
    """
    result = self._read_sql(query).to_pandas()
    if len(result) > 0 and result.iloc[0]['comment']:
        return str(result.iloc[0]['comment'])
    return None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT
            a.attname AS column_name,
            d.description AS comment
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_description d
            ON d.objoid = a.attrelid AND d.objsubid = a.attnum
        WHERE n.nspname = '{schema}'
          AND c.relname = '{table}'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND d.description IS NOT NULL
    """
    result = self._read_sql(query).to_pandas()
    return {row['column_name']: row['comment'] for _, row in result.iterrows()}
```

**MSSQL**：

```python
# mssql_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT CAST(ep.value AS NVARCHAR(MAX)) AS comment
        FROM sys.extended_properties ep
        JOIN sys.tables t ON ep.major_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = '{schema}' AND t.name = '{table}'
          AND ep.minor_id = 0 AND ep.name = 'MS_Description'
    """
    result = self._execute_query(query).to_pandas()
    if len(result) > 0 and result.iloc[0]['comment']:
        return str(result.iloc[0]['comment'])
    return None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT c.name AS column_name,
               CAST(ep.value AS NVARCHAR(MAX)) AS comment
        FROM sys.columns c
        JOIN sys.tables t ON c.object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN sys.extended_properties ep
            ON ep.major_id = c.object_id
           AND ep.minor_id = c.column_id
           AND ep.name = 'MS_Description'
        WHERE s.name = '{schema}' AND t.name = '{table}'
          AND ep.value IS NOT NULL
    """
    result = self._execute_query(query).to_pandas()
    return {row['column_name']: row['comment'] for _, row in result.iterrows()}
```

**BigQuery**（最简单——SDK 已有属性，只需取出）：

```python
# bigquery_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    table_ref = self.client.get_table(source_table)
    return table_ref.description or None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    table_ref = self.client.get_table(source_table)
    return {
        field.name: field.description
        for field in table_ref.schema
        if field.description
    }
```

**MySQL**：

```python
# mysql_data_loader.py — 新增方法

def fetch_table_description(self, source_table: str) -> str | None:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT TABLE_COMMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table}'
    """
    result = self._read_sql(query).to_pandas()
    comment = result.iloc[0]['TABLE_COMMENT'] if len(result) > 0 else None
    return comment if comment and comment.strip() else None

def fetch_column_descriptions(self, source_table: str) -> dict[str, str]:
    schema, table = self._parse_table_name(source_table)
    query = f"""
        SELECT COLUMN_NAME, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table}'
          AND COLUMN_COMMENT IS NOT NULL AND COLUMN_COMMENT != ''
    """
    result = self._read_sql(query).to_pandas()
    return {row['COLUMN_NAME']: row['COLUMN_COMMENT'] for _, row in result.iterrows()}
```

#### 11.4.3 元数据如何写入 Workspace

在 `ingest_to_workspace()` 中调用这两个方法，将注释写入 `ColumnInfo` 和 `TableMetadata`：

```python
# external_data_loader.py — ingest_to_workspace 增强

def ingest_to_workspace(self, workspace, table_name, source_table, size=1000000, 
                         sort_columns=None, sort_order='asc'):
    arrow_table = self.fetch_data_as_arrow(source_table, size, sort_columns, sort_order)

    loader_metadata = {
        "loader_type": self.__class__.__name__,
        "loader_params": self.get_safe_params(),
        "source_table": source_table,
    }

    table_metadata = workspace.write_parquet_from_arrow(
        table=arrow_table, table_name=table_name, loader_metadata=loader_metadata,
    )

    # ---- 新增：拉取并写入元数据 ----
    try:
        table_desc = self.fetch_table_description(source_table)
        col_descs = self.fetch_column_descriptions(source_table)

        if table_desc or col_descs:
            from data_formulator.datalake.metadata import ColumnInfo, update_metadata

            def _enrich(meta):
                tbl = meta.get_table(table_name)
                if tbl is None:
                    return
                if table_desc:
                    tbl.description = table_desc
                if col_descs and tbl.columns:
                    for col in tbl.columns:
                        desc = col_descs.get(col.name)
                        if desc:
                            col.description = desc

            update_metadata(workspace._workspace_path, _enrich)
            logger.info("Enriched metadata for '%s': table_desc=%s, col_descs=%d",
                         table_name, bool(table_desc), len(col_descs))
    except Exception as e:
        logger.warning("Failed to fetch metadata for '%s': %s (data is still saved)", 
                        source_table, e)
    # ---- 元数据增强结束，失败不影响数据写入 ----

    return table_metadata
```

**关键设计决策**：元数据拉取在数据写入**之后**，用 try/except 包裹。即使元数据查询失败（权限不足、数据库不支持等），数据本身已经安全写入 workspace。

#### 11.4.4 `list_tables()` 返回值增强

同时在 `list_tables()` 中也返回注释信息，让前端在浏览数据库表时就能看到描述：

```python
# postgresql_data_loader.py — list_tables 增强

def _list_tables(self, table_filter=None):
    # ... 现有的 tables 查询 ...
    
    for _, row in tables_df.iterrows():
        schema = row['schemaname']
        table_name = row['tablename']
        full_table_name = f"{schema}.{table_name}"

        # 列信息（现有）+ 列注释（新增）
        columns_query = f"""
            SELECT
                c.column_name,
                c.data_type,
                pgd.description AS column_comment
            FROM information_schema.columns c
            LEFT JOIN pg_catalog.pg_statio_all_tables st
                ON st.schemaname = c.table_schema AND st.relname = c.table_name
            LEFT JOIN pg_catalog.pg_description pgd
                ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
            WHERE c.table_schema = '{schema}' AND c.table_name = '{table_name}'
            ORDER BY c.ordinal_position
        """
        columns_df = self._read_sql(columns_query).to_pandas()
        columns = [{
            'name': r['column_name'],
            'type': r['data_type'],
            'description': r['column_comment'] or None,  # ← 新增
        } for _, r in columns_df.iterrows()]

        # 表注释（新增）
        table_comment = self.fetch_table_description(full_table_name)

        table_metadata = {
            "row_count": int(row_count),
            "columns": columns,
            "sample_rows": sample_rows,
            "description": table_comment,  # ← 新增
        }
        results.append({"name": full_table_name, "metadata": table_metadata})
```

#### 11.4.5 前端展示（自然兼容）

现有前端 `DBManagerPane` 已经渲染了 `columns` 列表。只需小幅调整，当 `column.description` 存在时显示 tooltip：

```
┌─────────────────────────────────────────────────┐
│  public.orders — 订单主表，记录所有用户订单         │  ← table description
│                                                   │
│  列名              类型        描述                │
│  ──────           ────        ────                │
│  id               integer     订单唯一标识          │
│  customer_id      integer     关联客户表 (FK)       │
│  created_at       timestamp   订单创建时间（UTC）    │
│  total_amount     numeric     订单总金额（含税）     │  ← column descriptions
│  status           varchar     pending/paid/shipped  │
│                                                   │
│  行数: 1,234,567    [ 加载 ▾ ]                     │
└─────────────────────────────────────────────────┘
```

#### 11.4.6 改动文件清单

| 文件 | 改动 | 行数估计 |
|------|------|:---:|
| `external_data_loader.py` | 新增 `fetch_table_description()`、`fetch_column_descriptions()` 默认实现；`ingest_to_workspace()` 增加元数据写入 | ~30 行 |
| `postgresql_data_loader.py` | 实现两个描述方法 + `list_tables()` 查询增强 | ~25 行 |
| `mssql_data_loader.py` | 实现两个描述方法 + `list_tables()` 查询增强 | ~30 行 |
| `bigquery_data_loader.py` | 实现两个描述方法（各 3 行）+ `list_tables()` 取 description | ~10 行 |
| `mysql_data_loader.py` | 实现两个描述方法 + `list_tables()` 取 `COLUMN_COMMENT` | ~20 行 |
| `kusto_data_loader.py` | 实现两个描述方法（从 schema JSON 取 DocString） | ~15 行 |
| `metadata.py` | `ColumnInfo` 增加 `description` 字段；`TableMetadata` 增加 `description` 字段 | ~15 行 |
| **前端 `DBManagerPane`** | columns 列表显示 description tooltip | ~10 行 |
| **总计** | | **~155 行** |

---

### 11.5 改进方案二：SSO Token 透传到数据库 (P1)

**目标**：当 DF 用户通过 OIDC SSO 登录后，如果目标数据库也信任同一 IdP，DataLoader 自动使用 SSO token 连接数据库，用户无需输入数据库密码。

**前置条件**：SSO AuthProvider 链已上线（`sso-plugin-architecture.md` Phase 1）。

#### 11.5.1 基类增加认证能力声明

```python
# external_data_loader.py — 新增

class ExternalDataLoader(ABC):
    # ... 现有方法 ...

    @staticmethod
    def supported_auth_methods() -> list[dict]:
        """声明该 loader 支持哪些认证方式。
        
        框架据此在前端渲染不同的认证 UI（密码表单 vs SSO 按钮等）。
        """
        return [
            {"method": "credentials", "label": "用户名 & 密码", "default": True},
        ]
```

各 DataLoader 按实际能力 override：

```python
# mssql_data_loader.py
@staticmethod
def supported_auth_methods():
    return [
        {"method": "credentials", "label": "SQL Server 认证"},
        {"method": "windows_auth", "label": "Windows 集成认证"},
        {"method": "azure_ad_token", "label": "Azure AD (SSO)", 
         "requires_sso": True, "token_audience": "https://database.windows.net/"},
    ]

# postgresql_data_loader.py
@staticmethod
def supported_auth_methods():
    return [
        {"method": "credentials", "label": "用户名 & 密码", "default": True},
        {"method": "azure_ad_token", "label": "Azure AD (SSO)",
         "requires_sso": True, "token_audience": "https://ossrdbms-aad.database.windows.net"},
        {"method": "aws_iam_token", "label": "AWS IAM",
         "requires_env": ["AWS_REGION"]},
    ]

# bigquery_data_loader.py
@staticmethod
def supported_auth_methods():
    return [
        {"method": "service_account", "label": "服务账号 JSON", "default": True},
        {"method": "cli", "label": "gcloud CLI (本地开发)"},
        {"method": "oidc_federation", "label": "OIDC 联邦身份 (SSO)",
         "requires_sso": True},
    ]
```

#### 11.5.2 Token 注入流程

```
用户通过 OIDC SSO 登录 DF
  → 获得 access_token（存在 AuthResult 中）
  → 用户打开数据库连接面板
  
前端渲染:
  GET /api/data-loader/postgresql/auth-methods
  → 返回 supported_auth_methods()
  → 发现有 "azure_ad_token"，且 requires_sso=true
  → DF 当前有 SSO 登录 → 显示「使用 SSO 连接」按钮
  
用户点击「使用 SSO 连接」:
  → 前端带上 auth_method: "azure_ad_token"
  → 后端从 auth.get_sso_token() 拿到 access_token
  → 如果 token_audience 不同，用 token exchange 获取目标 audience 的 token
  → 将 token 注入 DataLoader 的 params
  → DataLoader 用 token 连接数据库
```

#### 11.5.3 各数据库的 Token 认证实现

**Azure SQL / MSSQL**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "credentials")

    if auth_method == "azure_ad_token":
        token = params["access_token"]
        conn_str = f"DRIVER={{{self.driver}}};SERVER={self.server},{self.port};DATABASE={self.database};"
        
        # pyodbc Azure AD token 认证
        SQL_COPT_SS_ACCESS_TOKEN = 1256
        token_struct = struct.pack(
            f'<I{len(token)*2}s', len(token)*2, token.encode('utf-16-le')
        )
        self._conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct})
    else:
        # 现有逻辑不变
        ...
```

**Azure PostgreSQL**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "credentials")

    if auth_method == "azure_ad_token":
        token = params["access_token"]
        # Azure DB for PostgreSQL 支持用 token 作为密码
        self._conn = psycopg2.connect(
            host=self.host, port=int(self.port),
            user=params.get("user", ""),  # Azure AD 用户名
            password=token,                # token 作为密码
            dbname=self.database,
            sslmode="require",
        )
    else:
        # 现有逻辑不变
        ...
```

**BigQuery OIDC 联邦身份**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "service_account")

    if auth_method == "oidc_federation":
        from google.auth import identity_pool
        token = params["access_token"]
        # 用 OIDC token 换取 Google credential
        credentials = identity_pool.Credentials(
            audience=f"//iam.googleapis.com/projects/{self.project_id}/locations/global/workloadIdentityPools/{pool_id}/providers/{provider_id}",
            subject_token_type="urn:ietf:params:oauth:token-type:jwt",
            token_url="https://sts.googleapis.com/v1/token",
            subject_token=token,
        )
        self.client = bigquery.Client(project=self.project_id, credentials=credentials)
    else:
        # 现有逻辑不变
        ...
```

**Kusto (Azure Data Explorer)**：

```python
def __init__(self, params):
    auth_method = params.get("auth_method", "app_key")

    if auth_method == "azure_ad_token":
        token = params["access_token"]
        kcsb = KustoConnectionStringBuilder.with_aad_user_token_authentication(
            self.kusto_cluster, token
        )
        self.client = KustoClient(kcsb)
    else:
        # 现有逻辑不变
        ...
```

#### 11.5.4 前端认证 UI 适配

```typescript
// DBManagerPane.tsx — 连接表单根据 auth_methods 动态渲染

const authMethods = loaderConfig.auth_methods; // 从 /api/data-loader/{type}/auth-methods 获取
const hasSsoOption = authMethods.some(m => m.requires_sso);
const isSsoLoggedIn = !!serverConfig.auth_user; // DF 用户已通过 SSO 登录

// 渲染认证方式选择
{authMethods.length > 1 && (
  <RadioGroup value={selectedAuthMethod} onChange={setSelectedAuthMethod}>
    {authMethods.map(m => (
      <FormControlLabel
        key={m.method}
        value={m.method}
        label={m.label}
        disabled={m.requires_sso && !isSsoLoggedIn}  // SSO 未登录则禁用
        control={<Radio />}
      />
    ))}
  </RadioGroup>
)}

// 根据选择渲染不同的表单字段
{selectedAuthMethod === "credentials" && (
  <>
    <TextField label="用户名" ... />
    <TextField label="密码" type="password" ... />
  </>
)}
{selectedAuthMethod === "azure_ad_token" && (
  <Alert severity="info">
    将使用您的 SSO 登录身份 ({serverConfig.auth_user}) 连接数据库
  </Alert>
)}
```

#### 11.5.5 改动文件清单

| 文件 | 改动 | 行数估计 |
|------|------|:---:|
| `external_data_loader.py` | 新增 `supported_auth_methods()` 默认实现 | ~10 行 |
| `mssql_data_loader.py` | override `supported_auth_methods()`；`__init__` 增加 `azure_ad_token` 分支 | ~25 行 |
| `postgresql_data_loader.py` | 同上 | ~20 行 |
| `bigquery_data_loader.py` | 同上（OIDC federation） | ~20 行 |
| `kusto_data_loader.py` | 同上（`with_aad_user_token_authentication`） | ~15 行 |
| `tables_routes.py` | 新增 `/api/data-loader/{type}/auth-methods` 路由 | ~15 行 |
| **前端** `DBManagerPane.tsx` | 动态渲染认证方式选择 UI | ~40 行 |
| **总计** | | **~145 行** |

---

### 11.6 改进方案三：凭证持久化 (P2)

**目标**：用户连接数据库后，可以选择"记住连接"，凭证加密存入 CredentialVault，下次打开 DF 无需重新输入。

**前置条件**：CredentialVault 已上线（`sso-plugin-architecture.md` Layer 3）。

#### 11.6.1 用户体验流程

```
首次连接:
  用户填写 host/port/user/password → 连接成功
  → 弹出「保存此连接？」提示
  → 用户确认 → 凭证加密存入 CredentialVault
     键: credential:dataloader:postgresql:{user_id}:{host}:{database}
     值: AES 加密的 {"user": "...", "password": "...", "host": "...", ...}

再次打开 DF:
  → 前端请求 GET /api/data-loader/saved-connections
  → 返回已保存的连接列表（不含明文密码，只有名称和类型）
  → 用户点击已保存的连接 → 一键连接
  → 后端从 CredentialVault 解密取出凭证 → 创建 DataLoader

管理:
  → 用户可以查看、删除已保存的连接
  → 删除操作同时清除 CredentialVault 中的加密凭证
```

#### 11.6.2 后端 API

```python
# tables_routes.py — 新增路由

@tables_bp.route('/data-loader/saved-connections', methods=['GET'])
def list_saved_connections():
    """列出当前用户保存的数据库连接（不含明文密码）。"""
    user_id = get_identity_id()
    vault = get_credential_vault()
    connections = vault.list_credentials(user_id, prefix="dataloader:")
    return jsonify([{
        "id": conn.credential_id,
        "loader_type": conn.metadata.get("loader_type"),
        "display_name": conn.metadata.get("display_name"),
        "host": conn.metadata.get("host"),
        "database": conn.metadata.get("database"),
        "saved_at": conn.metadata.get("saved_at"),
    } for conn in connections])

@tables_bp.route('/data-loader/saved-connections', methods=['POST'])
def save_connection():
    """保存一个数据库连接（凭证加密存储）。"""
    data = request.get_json()
    user_id = get_identity_id()
    vault = get_credential_vault()
    
    loader_type = data["loader_type"]
    params = data["params"]
    display_name = data.get("display_name", f"{loader_type}:{params.get('host','')}/{params.get('database','')}")
    
    credential_id = f"dataloader:{loader_type}:{params.get('host','')}:{params.get('database','')}"
    
    vault.store_credential(
        user_id=user_id,
        credential_id=credential_id,
        secret_data=params,  # 包含密码，会被加密存储
        metadata={
            "loader_type": loader_type,
            "display_name": display_name,
            "host": params.get("host"),
            "database": params.get("database"),
            "saved_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return jsonify({"status": "ok", "credential_id": credential_id})

@tables_bp.route('/data-loader/saved-connections/<credential_id>/connect', methods=['POST'])
def connect_saved():
    """使用已保存的凭证连接数据库。"""
    user_id = get_identity_id()
    vault = get_credential_vault()
    
    cred = vault.get_credential(user_id, credential_id)
    if cred is None:
        return jsonify({"status": "error", "message": "Connection not found"}), 404
    
    loader_type = cred.metadata["loader_type"]
    params = cred.secret_data  # 自动解密
    
    # 创建 DataLoader 实例并连接（复用现有逻辑）
    loader_cls = DATA_LOADERS.get(loader_type)
    loader = loader_cls(params)
    # ... 后续逻辑与手动连接相同 ...
```

#### 11.6.3 前端 UI

```
┌─────────────────────────────────────────────────────┐
│  数据库连接                                           │
│                                                       │
│  ┌─── 已保存的连接 ─────────────────────────────────┐ │
│  │  🔗 生产 PostgreSQL (pg.company.com/analytics)    │ │
│  │     上次连接: 2025-03-20   [ 连接 ] [ 🗑 删除 ]   │ │
│  │                                                   │ │
│  │  🔗 测试 MSSQL (sql-test/reporting)               │ │
│  │     上次连接: 2025-03-18   [ 连接 ] [ 🗑 删除 ]   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─── 新建连接 ─────────────────────────────────────┐ │
│  │  类型: [PostgreSQL ▾]                             │ │
│  │  认证: ● 用户名密码  ○ SSO (Azure AD)             │ │
│  │  Host: [________________]                         │ │
│  │  ...                                              │ │
│  │  ☑ 记住此连接                                     │ │
│  │                                                   │ │
│  │  [ 连接 ]                                         │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### 11.6.4 安全性

| 措施 | 说明 |
|------|------|
| **加密存储** | 密码等敏感字段通过 CredentialVault 使用 Fernet (AES-128-CBC) 加密 |
| **per-user 隔离** | 每个用户只能访问自己保存的连接（通过 `user_id` 隔离） |
| **不回显密码** | `list_saved_connections` 只返回元数据，不返回明文密码 |
| **手动删除** | 用户随时可以删除已保存的连接和对应的加密凭证 |
| **SSO 优先** | 如果数据库支持 SSO 且 DF 已 SSO 登录，优先推荐 SSO（无需存密码） |

---

## 12. 目录结构

### 12.1 后端

```
py-src/data_formulator/
├── plugins/
│   ├── __init__.py              # 插件自动扫描与注册 (discover_and_register)
│   ├── base.py                  # DataSourcePlugin 基类
│   ├── data_writer.py           # PluginDataWriter 写入工具
│   ├── superset/
│   │   ├── __init__.py          # SupersetPlugin 实现
│   │   ├── superset_client.py   # Superset REST API 封装
│   │   ├── auth_bridge.py       # JWT 认证桥接
│   │   ├── catalog.py           # 带缓存的数据目录
│   │   └── routes/
│   │       ├── __init__.py
│   │       ├── auth.py          # /api/plugins/superset/auth/*
│   │       ├── catalog.py       # /api/plugins/superset/catalog/*
│   │       └── data.py          # /api/plugins/superset/data/*
│   └── metabase/                # （未来）
│       ├── __init__.py
│       └── ...
├── data_loader/                 # 现有 ExternalDataLoader 体系（不变）
│   ├── __init__.py
│   ├── external_data_loader.py
│   └── *_data_loader.py
└── ...
```

### 12.2 前端

```
src/
├── plugins/
│   ├── types.ts                 # PluginManifest, PluginPanelProps 等类型
│   ├── registry.ts              # 插件自动发现 (import.meta.glob)
│   ├── PluginHost.tsx           # 插件容器组件（在 UnifiedDataUploadDialog 中使用）
│   ├── superset/
│   │   ├── index.ts             # 导出 DataSourcePluginModule
│   │   ├── SupersetPanel.tsx
│   │   ├── SupersetCatalog.tsx
│   │   ├── SupersetDashboards.tsx
│   │   ├── SupersetFilterDialog.tsx
│   │   ├── SupersetLogin.tsx
│   │   └── api.ts
│   └── metabase/                # （未来）
│       ├── index.ts
│       └── ...
└── views/
    └── UnifiedDataUploadDialog.tsx  # 改动：增加 PluginHost 渲染
```

---

## 13. 实施路径

### Phase 1：建立插件框架（对核心代码的一次性改动）

**后端改动**：

| 文件 | 改动 |
|------|------|
| `plugins/__init__.py` | 新增：插件注册中心 |
| `plugins/base.py` | 新增：DataSourcePlugin 基类 |
| `app.py` | 修改：`_register_blueprints()` 中调用 `discover_and_register(app)`；`get_app_config()` 中返回 `PLUGINS` |

**前端改动**：

| 文件 | 改动 |
|------|------|
| `plugins/types.ts` | 新增：类型定义 |
| `plugins/registry.ts` | 新增：插件加载 |
| `plugins/PluginHost.tsx` | 新增：插件容器组件 |
| `dfSlice.tsx` | 修改：`ServerConfig` 增加 `plugins` 字段 |
| `UnifiedDataUploadDialog.tsx` | 修改：增加 PluginHost 渲染（约 20 行） |

### Phase 2：迁移 Superset 为插件

将 0.6 版本的 Superset 代码迁移到 `plugins/superset/` 目录中，核心业务逻辑（SupersetClient、AuthBridge、Catalog）直接复用，主要改动：

1. 数据存储从 DuckDB 切换为 Workspace Parquet
2. 路由前缀从 `/api/superset/` 改为 `/api/plugins/superset/`
3. 前端组件迁移到 `src/plugins/superset/` 并适配 `PluginPanelProps` 接口

### Phase 3：SSO 认证层 + 凭证保险箱

引入 OIDC SSO 认证（可插拔 AuthProvider 链）和服务端加密凭证存储（CredentialVault），实现：
- 用户通过 SSO 登录后获得真实身份 (`user:alice@corp.com`)
- SSO token 可透传给同一 IdP 下的外部系统，用户无需重复登录
- 未接 SSO 的外部系统凭证加密存入服务端，跨设备可用

> 完整设计见 `sso-plugin-architecture.md`

### Phase 4：编写第二个插件（验证框架通用性）

例如 Metabase 插件，验证插件框架是否真的能做到"新增插件不修改核心代码"。

由于采用了目录自动扫描，新增 Metabase 插件的步骤是：
1. 创建 `plugins/metabase/` 目录和 `src/plugins/metabase/` 目录
2. 在 `.env` 中设置 `METABASE_URL=...`
3. 重启服务

**核心代码改动：0 行。**

### Phase 5：完善

- 插件的国际化支持
- 插件的错误边界处理
- 插件的配置 UI（管理员面板）
- DataLoader 凭证接入 CredentialVault（可选记住密码）
- 插件的单元测试和集成测试

---

## 14. 关键设计难点：外部系统配置与用户身份

### 14.1 难点一：外部系统的连接配置放在哪里

外部 BI 系统的连接地址（如 `SUPERSET_URL`）应该由谁来配置？有三种方案：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **A：服务端 ENV 统一配置** | 管理员在 `.env` 中配 `SUPERSET_URL` 等 | 简单；用户无需关心；适合团队/企业部署 | 灵活性低，不同用户无法连不同实例 |
| **B：前端用户自行添加** | 用户在浏览器中输入 URL 并连接 | 灵活，用户自主 | 配置不持久（换浏览器丢失）；安全风险（恶意 URL） |
| **C：混合模式** | 服务端提供"预置实例"，用户也可自行添加 | 两全其美 | 实现复杂度稍高 |

**推荐方案：C（混合模式），分阶段实施**

- **Phase 1**：只支持 ENV 配置（覆盖 80% 的团队部署场景），管理员在服务端配好 `SUPERSET_URL` 等环境变量，所有用户共享同一组可用的外部系统端点
- **Phase 2**：允许用户自行添加外部系统实例，配置持久化在用户的 Workspace 元数据中（`workspace.yaml` 中增加 `plugin_connections` 字段），这样即使换浏览器，只要身份能恢复（见下文），连接配置也不会丢失

Phase 1 的配置示例（`.env`）：

```bash
# 外部 BI 系统连接
SUPERSET_URL=http://superset.company.com:8088
# METABASE_URL=http://metabase.company.com:3000
# POWERBI_TENANT_ID=your-tenant-id
```

Phase 2 用户自定义连接的存储（`workspace.yaml`）：

```yaml
plugin_connections:
  - plugin_id: superset
    instance_name: "生产环境 Superset"
    url: "http://superset-prod:8088"
    added_at: "2025-03-22T10:00:00Z"
  - plugin_id: superset
    instance_name: "测试环境 Superset"
    url: "http://superset-test:8088"
    added_at: "2025-03-22T10:05:00Z"
```

---

### 14.2 难点二：用户身份映射

> **重要更新**：在 `sso-plugin-architecture.md` 中，我们引入了 OIDC SSO 认证层。
> 有了 SSO 后，用户在任何设备上都是 `user:alice@corp.com`，天然跨设备，
> 下面描述的 IdentityStore + 身份合并机制**大幅简化为一次性 browser→user 迁移**。
> 完整的 SSO 方案见 `sso-plugin-architecture.md` 第 8 节。
>
> 以下保留无 SSO 场景的完整设计，作为匿名模式下的降级方案。

#### 问题本质

Data Formulator 当前没有自己的用户管理系统。身份机制如下：

```
前端: localStorage 存储 browser UUID (df_browser_id)
  → 每次 API 请求带 X-Identity-Id: browser:<uuid>
    → 后端据此定位 Workspace: ~/.data_formulator/workspaces/browser:<uuid>/
```

这意味着：
- 每个浏览器/设备会生成独立的 UUID
- 换浏览器 = 新用户（看不到之前的数据）
- 换电脑 = 新用户

而外部 BI 系统（Superset、Metabase）有真实的用户体系。当用户通过 DF 登录这些系统时，我们能获得他在外部系统中的真实身份。**这是唯一可靠的"身份锚点"**。

#### 核心场景

```
时刻1: 用户在电脑A打开 DF → 生成 browser:aaa-111
时刻2: 在电脑A登录 Superset → 得知他是 superset:john (id=42)
时刻3: 用户换电脑B → 生成 browser:bbb-222（全新身份！数据丢失！）
时刻4: 在电脑B登录 Metabase → 得知他是 metabase:john_doe (id=7)
时刻5: 在电脑B再登录 Superset → 又是 superset:john (id=42)

问题:
  - 时刻3后，DF 完全不知道这跟电脑A是同一个人
  - 时刻4后，DF 不知道 metabase:john_doe 和 superset:john 是同一个人
  - 时刻5是唯一的线索 — superset:john 出现了第二次，可以关联回电脑A
```

#### 解决方案：身份链接表 (Identity Linking)

在 Workspace 存储层之上，建立一个全局的身份映射表：

```
~/.data_formulator/identity.db (SQLite)

表: identity_links
┌──────────────────┬────────────┬──────────────────┬─────────────────────┐
│ df_primary_id    │ provider   │ external_id      │ linked_at           │
├──────────────────┼────────────┼──────────────────┼─────────────────────┤
│ browser:aaa-111  │ superset   │ john_42          │ 2025-03-22 10:00:00 │
│ browser:aaa-111  │ metabase   │ john_doe_7       │ 2025-03-22 14:00:00 │
└──────────────────┴────────────┴──────────────────┴─────────────────────┘

表: identity_links_reverse (反向索引)
┌────────────┬──────────────────┬──────────────────┐
│ provider   │ external_id      │ df_primary_id    │
├────────────┼──────────────────┼──────────────────┤
│ superset   │ john_42          │ browser:aaa-111  │
│ metabase   │ john_doe_7       │ browser:aaa-111  │
└────────────┴──────────────────┴──────────────────┘
```

> 使用 SQLite 而非 YAML，因为需要反向索引查询和事务保护（合并操作要原子性）。

#### 完整时序流程

```
时刻1: 电脑A, 新用户
  → browser:aaa-111 (新建)
  → 链接表: (空)

时刻2: 电脑A, 登录 Superset
  → 插件调用: identity_store.link("browser:aaa-111", "superset", "john_42")
  → 查反向索引: superset:john_42 → 不存在
  → 写入新记录: browser:aaa-111 ↔ superset:john_42
  → ✅ 正常关联

时刻3: 电脑B, 新浏览器
  → browser:bbb-222 (新建)
  → 链接表中无 bbb-222 的任何记录
  → 用户看到空的 workspace

时刻4: 电脑B, 登录 Metabase
  → 插件调用: identity_store.link("browser:bbb-222", "metabase", "john_doe_7")
  → 查反向索引: metabase:john_doe_7 → 不存在
  → 写入新记录: browser:bbb-222 ↔ metabase:john_doe_7
  → ✅ 正常关联（但此时两台电脑的数据仍然分开）

时刻5: 电脑B, 再登录 Superset ⚡ 关键时刻
  → 插件调用: identity_store.link("browser:bbb-222", "superset", "john_42")
  → 查反向索引: superset:john_42 → browser:aaa-111 ← 已存在!
  → 发现冲突: 当前 bbb-222 ≠ 已关联的 aaa-111
  → 🔗 触发身份合并流程（见下文）

合并完成后的最终状态:
  browser:aaa-111 ↔ superset:john_42
  browser:aaa-111 ↔ metabase:john_doe_7   ← metabase 关联也迁移过来了
  browser:bbb-222 → (已合并到 aaa-111)
```

#### 身份合并流程

当检测到身份冲突时（当前浏览器身份 ≠ 外部系统已关联的 DF 身份），触发合并：

```
后端返回冲突响应
    │
    ↓
前端弹出确认对话框
┌─────────────────────────────────────────────────────────────┐
│  检测到您之前在另一台设备上使用过 Data Formulator            │
│                                                              │
│  已有数据: 5 个表, 最后使用: 2025-03-20                      │
│  当前设备数据: 2 个表                                        │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐    │
│  │ 恢复并合并    │ │ 仅恢复       │ │ 保持当前(独立)    │    │
│  └──────────────┘ └──────────────┘ └───────────────────┘    │
│                                                              │
│  恢复并合并: 恢复之前的数据，并将当前设备数据合并进去         │
│  仅恢复: 恢复之前的数据，丢弃当前设备数据                    │
│  保持当前: 不恢复，作为独立用户继续使用                       │
└─────────────────────────────────────────────────────────────┘
    │
    ↓ 用户选择「恢复并合并」
    │
后端合并操作 (原子性):
    1. 将 bbb-222 的所有链接记录迁移到 aaa-111
    2. 将 bbb-222 的 workspace 数据文件复制到 aaa-111
       （表名冲突时自动加后缀: sales → sales_1）
    3. 更新 workspace.yaml 元数据
    4. 标记 bbb-222 为"已合并" (软删除)
    │
    ↓
前端收到合并成功响应:
    1. localStorage.setItem('df_browser_id', 'aaa-111')  // 切换身份
    2. window.location.reload()                           // 用新身份重新加载
    │
    ↓
用户看到完整的数据（来自两台设备的合并结果）
```

#### 后端接口设计

```python
# py-src/data_formulator/identity_store.py

import sqlite3
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class LinkResult:
    status: str  # "linked" | "already_linked" | "conflict"
    existing_df_identity: Optional[str] = None  # 冲突时，已关联到的 DF 身份


class IdentityStore:
    """管理 DF 本地身份与外部系统身份的映射关系。
    
    使用 SQLite 存储，支持反向索引查询和事务保护。
    存储位置: ~/.data_formulator/identity.db
    """
    
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self._init_db()
    
    def _init_db(self):
        """初始化数据库表结构。"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS identity_links (
                    df_primary_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (provider, external_id)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_df_primary
                ON identity_links(df_primary_id)
            """)
    
    def link(
        self, df_identity: str, provider: str, external_id: str
    ) -> LinkResult:
        """将外部身份关联到 DF 身份。
        
        如果该外部身份已关联到其他 DF 身份，返回冲突信息。
        """
        with sqlite3.connect(self.db_path) as conn:
            # 检查是否已存在
            row = conn.execute(
                "SELECT df_primary_id FROM identity_links "
                "WHERE provider = ? AND external_id = ?",
                (provider, external_id),
            ).fetchone()
            
            if row:
                existing = row[0]
                if existing == df_identity:
                    return LinkResult(status="already_linked")
                return LinkResult(
                    status="conflict",
                    existing_df_identity=existing,
                )
            
            conn.execute(
                "INSERT INTO identity_links "
                "(df_primary_id, provider, external_id) VALUES (?, ?, ?)",
                (df_identity, provider, external_id),
            )
            return LinkResult(status="linked")
    
    def resolve(self, provider: str, external_id: str) -> Optional[str]:
        """根据外部身份查找已关联的 DF 身份。"""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT df_primary_id FROM identity_links "
                "WHERE provider = ? AND external_id = ?",
                (provider, external_id),
            ).fetchone()
            return row[0] if row else None
    
    def list_links(self, df_identity: str) -> list[dict]:
        """列出某个 DF 身份关联的所有外部账号。"""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT provider, external_id, linked_at "
                "FROM identity_links WHERE df_primary_id = ?",
                (df_identity,),
            ).fetchall()
            return [
                {"provider": r[0], "external_id": r[1], "linked_at": r[2]}
                for r in rows
            ]
    
    def migrate(self, from_id: str, to_id: str) -> int:
        """将一个 DF 身份的所有关联迁移到另一个。
        
        Returns: 迁移的记录数
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "UPDATE identity_links SET df_primary_id = ? "
                "WHERE df_primary_id = ?",
                (to_id, from_id),
            )
            count = cursor.rowcount
            if count > 0:
                logger.info(
                    "Migrated %d identity links from %s to %s",
                    count, from_id, to_id,
                )
            return count


# 单例
_store: Optional[IdentityStore] = None

def get_identity_store() -> IdentityStore:
    """获取全局 IdentityStore 单例。"""
    global _store
    if _store is None:
        from data_formulator.datalake.workspace import get_data_formulator_home
        db_path = get_data_formulator_home() / "identity.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _store = IdentityStore(db_path)
    return _store
```

#### 插件调用方式

插件在用户登录成功后调用身份链接：

```python
# 在 Superset 插件的 auth 路由中
@bp.route('/auth/login', methods=['POST'])
def login():
    # ... 验证 Superset 登录，得到 user 信息 ...
    superset_user_id = f"{user['username']}_{user['id']}"
    
    # 关联身份
    from data_formulator.identity_store import get_identity_store
    from data_formulator.auth import get_identity_id
    
    store = get_identity_store()
    current_df_id = get_identity_id()  # 如 "browser:bbb-222"
    result = store.link(current_df_id, "superset", superset_user_id)
    
    response = {"status": "success", "user": user_info}
    
    if result.status == "conflict":
        # 该 Superset 用户已关联到另一个 DF 身份
        response["identity_conflict"] = {
            "action": "merge_available",
            "existing_df_identity": result.existing_df_identity,
            "current_df_identity": current_df_id,
        }
    
    return jsonify(response)
```

#### 身份合并 API

```python
# py-src/data_formulator/identity_routes.py（新增）

@identity_bp.route('/merge', methods=['POST'])
def merge_identities():
    """合并两个 DF 身份（将 from_id 合并到 to_id）。"""
    data = request.get_json()
    from_id = data.get('from_identity')
    to_id = data.get('to_identity')
    merge_data = data.get('merge_workspace_data', True)
    
    current = get_identity_id()
    # 安全检查: 调用者必须是 from_id 或 to_id
    if current not in (from_id, to_id):
        return jsonify({"status": "error", "message": "Unauthorized"}), 403
    
    store = get_identity_store()
    
    # 1. 迁移身份链接
    store.migrate(from_id, to_id)
    
    # 2. 合并 workspace 数据 (可选)
    if merge_data:
        from_ws = get_workspace(from_id)
        to_ws = get_workspace(to_id)
        merged_tables = _merge_workspace_data(from_ws, to_ws)
    
    return jsonify({
        "status": "success",
        "target_identity": to_id,
        "merged_tables": merged_tables if merge_data else [],
    })
```

#### 前端处理

```typescript
// 前端收到登录响应后检查是否有身份冲突
async function handlePluginLoginResponse(response: any) {
    if (response.identity_conflict?.action === 'merge_available') {
        const { existing_df_identity, current_df_identity } = response.identity_conflict;
        
        // 查询已有身份的 workspace 概要
        const summary = await fetchWorkspaceSummary(existing_df_identity);
        
        // 弹出合并确认对话框
        const choice = await showIdentityMergeDialog({
            existingIdentity: existing_df_identity,
            existingInfo: summary,  // { tableCount: 5, lastUsed: "2025-03-20" }
            currentIdentity: current_df_identity,
        });
        
        switch (choice) {
            case 'merge':
                // 恢复并合并
                await fetchWithIdentity('/api/identity/merge', {
                    method: 'POST',
                    body: JSON.stringify({
                        from_identity: current_df_identity,
                        to_identity: existing_df_identity,
                        merge_workspace_data: true,
                    }),
                });
                // 切换浏览器身份
                const targetId = existing_df_identity.split(':')[1];
                localStorage.setItem('df_browser_id', targetId);
                window.location.reload();
                break;
                
            case 'restore_only':
                // 仅恢复，不迁移当前数据
                await fetchWithIdentity('/api/identity/merge', {
                    method: 'POST',
                    body: JSON.stringify({
                        from_identity: current_df_identity,
                        to_identity: existing_df_identity,
                        merge_workspace_data: false,
                    }),
                });
                const id = existing_df_identity.split(':')[1];
                localStorage.setItem('df_browser_id', id);
                window.location.reload();
                break;
                
            case 'keep_current':
                // 不合并，作为独立用户
                // 此时需要为当前身份也创建一条新的关联记录
                // （覆盖旧关联，或创建并行关联 — 需要策略选择）
                break;
        }
    }
}
```

#### 安全注意事项

| 风险 | 说明 | 缓解措施 |
|------|------|---------|
| **身份窃取** | 用户B用用户A的外部系统密码登录，触发合并，看到用户A的数据 | 合并操作必须经过前端确认弹窗，显示目标 workspace 概要信息（表数量、最后使用时间）；记录审计日志 |
| **误合并** | 两个不同的人恰好共用一个外部系统账号 | 前端弹窗明确提示"即将恢复来自另一台设备的数据"，用户可选择"保持当前" |
| **数据丢失** | 合并过程中断导致数据不一致 | 使用 SQLite 事务保护链接迁移；workspace 数据合并采用"复制而非移动"策略，失败可重试 |
| **未来升级** | DF 将来引入自己的用户认证系统 | 身份链接表的设计天然支持 — 只需增加 `provider="df_native"` 的记录，`user:xxx` 类型的 identity 会自动获得最高优先级 |

#### 存储选择

| 方案 | 存储介质 | 适用场景 | 说明 |
|------|---------|---------|------|
| **SQLite（推荐）** | `~/.data_formulator/identity.db` | 单机部署 | 支持事务、反向索引、原子操作 |
| Azure Table / Cosmos | 云端 | Azure 部署 | 需要远程存储时，可替换 IdentityStore 的底层实现 |
| 同一个 Workspace Backend | 随 workspace 走 | 通用 | 作为 IdentityStore 的可选 backend |

#### 身份系统与插件框架的关系

```
                    IdentityStore (全局，跨插件)
                         │
              ┌──────────┼──────────┐
              │          │          │
         Superset    Metabase    Power BI
         Plugin      Plugin      Plugin
              │          │          │
         登录时调用   登录时调用   登录时调用
         store.link  store.link  store.link
              │          │          │
              └──────────┼──────────┘
                         │
                    所有插件共享同一个 IdentityStore
                    → 任何一个插件的登录都可能触发身份关联
                    → 跨插件的登录可以串联身份
```

这意味着：即使用户在电脑B上先登录了 Metabase（此时无法关联到电脑A），但后来又登录了 Superset，系统就能把 Metabase 的关联也一起合并过去。**每多登录一个外部系统，身份网络就多一条边，关联恢复的可能性就越大。**

---

## 15. FAQ

### Q1：为什么不把 BI 系统集成做成 ExternalDataLoader？

ExternalDataLoader 的接口是 `list_tables()` + `fetch_data_as_arrow()`，这对数据库连接器来说足够了。但 Superset 需要：
- 独立的认证流程（JWT 登录、Token 刷新、SSO）
- 丰富的数据浏览（数据集 + 仪表盘 + 筛选条件）
- 通过 SQL Lab 间接查询（尊重 RBAC + RLS）
- 专用的前端 UI

如果硬塞进 ExternalDataLoader，要么接口会变得过于臃肿，要么实现会充满 hack。

### Q2：插件的前端代码不是也要编译到主 bundle 里吗？

是的，插件的前端代码通过 `import()` 实现代码分割（code splitting）。未启用的插件虽然会被打包（Webpack chunk），但 **不会被加载到浏览器中**，因为 `import()` 只在 `loadEnabledPlugins()` 遍历已启用插件时才触发。

如果未来插件数量很多，也可以考虑更激进的方案（如运行时加载远程 JS），但目前编译时 code splitting 已经足够好。

### Q3：插件如何做国际化？

插件可以在自己的目录中提供翻译 JSON：

```
plugins/superset/locales/
├── en.json
└── zh.json
```

插件加载时合并到全局 i18n 资源中，key 以 `plugin.superset.` 为前缀避免冲突。

### Q4：多个插件可以同时启用吗？

可以。每个插件有独立的 Blueprint 路由、独立的 Session 键、独立的前端 Tab。用户可以同时连接 Superset 和 Metabase，从两个系统中分别加载数据。

### Q5：这个方案对上游 Data Formulator 的兼容性如何？

核心改动很小（约 5 个文件，每个改动 < 30 行），且全部是增量修改（不修改现有逻辑，只增加插件加载入口）。未来上游版本更新时，合并冲突的可能性很低。

---

## 附录 A：核心代码改动清单

以下是实施 Phase 1（插件框架）时需要修改的现有核心文件（不含新增文件）：

| 文件 | 改动类型 | 改动量 | 说明 |
|------|---------|--------|------|
| `py-src/data_formulator/app.py` | 修改 | ~15 行 | `_register_blueprints()` 调用 `discover_and_register(app)`；`get_app_config()` 返回 PLUGINS |
| `src/app/dfSlice.tsx` | 修改 | ~5 行 | `ServerConfig` 增加 `plugins` 字段 |
| `src/views/UnifiedDataUploadDialog.tsx` | 修改 | ~20 行 | 导入 PluginHost，在数据源菜单中渲染插件 Tab |
| `src/app/utils.tsx` | 修改 | ~5 行 | 增加 `getPluginApiUrl(pluginId, path)` 辅助函数 |
| `src/app/identity.ts` | 修改 | ~10 行 | 增加 `setBrowserId()` 方法，支持身份合并时切换 |

需要新增的核心框架文件：

| 文件 | 说明 |
|------|------|
| `py-src/data_formulator/plugins/__init__.py` | 插件自动扫描与注册中心 (目录扫描，非硬编码列表) |
| `py-src/data_formulator/plugins/base.py` | DataSourcePlugin 基类 |
| `py-src/data_formulator/plugins/data_writer.py` | PluginDataWriter 写入工具 |
| `py-src/data_formulator/identity_store.py` | IdentityStore（SQLite 身份链接表，无 SSO 时使用） |
| `py-src/data_formulator/identity_routes.py` | 身份管理 API（合并、查询关联） |
| `src/plugins/types.ts` | 前端插件类型定义 |
| `src/plugins/registry.ts` | 前端插件自动发现 (`import.meta.glob`) |
| `src/plugins/PluginHost.tsx` | 前端插件容器组件 |

**对现有文件的总改动量**：约 55 行修改。

## 附录 B：新增插件的完整步骤（零核心改动）

以新增一个 Grafana 插件为例：

**步骤 1**：创建后端插件目录

```
py-src/data_formulator/plugins/grafana/
├── __init__.py          # plugin_class = GrafanaPlugin
├── plugin.py            # GrafanaPlugin(DataSourcePlugin) 实现
├── grafana_client.py    # Grafana REST API 封装
└── routes/
    ├── auth.py          # /api/plugins/grafana/auth/*
    ├── catalog.py       # /api/plugins/grafana/catalog/*
    └── data.py          # /api/plugins/grafana/data/*
```

**步骤 2**：创建前端插件目录

```
src/plugins/grafana/
├── index.ts             # export default: DataSourcePluginModule
├── GrafanaPanel.tsx     # 主面板
├── GrafanaLogin.tsx     # 登录组件
└── api.ts               # API 封装
```

**步骤 3**：在 `.env` 中启用

```bash
GRAFANA_URL=http://grafana.example.com:3000
```

**步骤 4**：重启服务

后端日志：`Plugin 'grafana' enabled (auto-discovered from plugins/grafana/)`

**核心代码改动：0 行。** 不需要修改 `__init__.py`、`app.py`、`registry.ts` 或任何其他文件。

## 附录 C：关联文档

| 文档 | 内容 | 关系 |
|------|------|------|
| **本文档** (`data-source-plugin-architecture.md`) | 数据源插件的完整设计：基类、数据写入、前端接口、Superset 迁移、身份链接 | 插件内部实现指导 |
| `sso-plugin-architecture.md` | SSO 认证 + 插件 + 凭证保险箱的统一架构 | 上层架构，定义三层如何协作 |

两份文档互补使用：本文档提供插件内部的详细实现指导，`sso-plugin-architecture.md` 定义整体架构和三层（AuthProvider + Plugin + CredentialVault）的集成方式。
