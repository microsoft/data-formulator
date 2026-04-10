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

### 2.1 数据存储模型

Data Formulator 的所有数据统一通过 **Workspace** 管理。Workspace 后端由 `WORKSPACE_BACKEND` 配置决定，支持多种部署形态：

```
┌────────────────────────────────────────────────────────┐
│               Workspace 统一存储模型                      │
│                                                          │
│  所有数据来源 (Upload/Paste/URL/DB/插件)                  │
│         ↓                                                │
│     loadTable → Workspace                                │
│         ↓                                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │ WORKSPACE_BACKEND = ?                            │    │
│  │                                                  │    │
│  │  local     → 本地磁盘 (~/.data_formulator/)      │    │
│  │  ephemeral → 仅内存（会话结束即消失）             │    │
│  │  cloud     → 远程对象存储（未来）                 │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  前端始终只拿 sample rows + 元数据                        │
└────────────────────────────────────────────────────────┘
```

> **历史说明**：早期版本中曾有 `storeOnServer` 用户开关和 `DISABLE_DATABASE` 环境变量，
> 分别用于让用户选择"浏览器临时存储 vs 磁盘持久化"和"禁用服务端存储"。
> 现在这些概念已被 `WORKSPACE_BACKEND` 统一取代——`ephemeral` 模式等价于旧的纯浏览器模式。

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

### 2.3 团队部署下仍存在的差异

Workspace 统一存储解决了数据持久化的问题，但个人与团队部署之间仍有两个需要关注的差异：

| 差异 | 个人模式 | 团队模式 |
|------|---------|---------|
| 数据库/BI 连接参数 | 前端填，自己用方便 | 应服务端集中管理（减少重复填写、防止 SSRF） |
| 模型 API Key | 前端填，自己的 Key | 服务端全局配置（0.7 已实现） |

> 0.7 版本已将模型管理升级为"服务端全局配置"。插件系统沿着同样的方向继续——连接端点由服务端配置，用户只需认证。

### 2.4 对插件系统的设计决策

由于所有数据统一走 Workspace，插件系统只需关注两个插件特有的问题：

**1. 插件配置（URL 等）：只在服务端配置，不在前端添加。**

- BI 系统的 URL 是**基础设施端点**，不是用户数据，由 IT 部门管理
- 用户只需**认证**（登录 Superset），而不是"添加一个 Superset 连接"
- 禁止前端输入任意 URL（防止 SSRF）

**2. 插件认证：per-user 凭据，服务端管理。**

- 用户对 BI 系统的登录凭据存储在服务端（CredentialVault），不暴露给前端
- 尊重 BI 系统自身的权限模型（RBAC / RLS）

```
┌──────────────────────────────────────────────────────────────┐
│                     Data Formulator                             │
│                                                                 │
│  数据来源                                                       │
│  ┌────────────────────────┐  ┌───────────────────────────┐     │
│  │ 内置来源                │  │ 插件来源                   │     │
│  │ Upload / Paste / URL   │  │ Superset / Metabase / ... │     │
│  │ Database / Extract     │  │                           │     │
│  └──────────┬─────────────┘  └─────────────┬─────────────┘     │
│             │                              │                    │
│             └──────────┬───────────────────┘                    │
│                        ↓                                        │
│              loadTable → Workspace                              │
│              (统一数据入口 → 统一存储)                           │
└──────────────────────────────────────────────────────────────┘
```

### 2.5 各层的配置与数据归属总结

| 层级 | 谁配置 | 存在哪里 | 示例 |
|------|--------|---------|------|
| **插件端点** | IT 管理员 | 服务端 `.env` | `PLG_SUPERSET_URL=http://...` |
| **用户认证** | 用户自己 | Flask Session（服务端内存） | Superset JWT Token |
| **用户数据** | 插件自动加载 | Workspace（由 `WORKSPACE_BACKEND` 决定存储位置） | 从 Superset 拉取的数据集 |
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

### 5.2 环境变量命名约定

系统中有三类环境变量驱动的自动发现机制，各自使用不同的命名空间以避免冲突：

| 类别 | 前缀 | 发现机制 | 示例 |
|------|------|---------|------|
| **系统配置** | 无（直接命名） | 固定读取 | `LOG_LEVEL`、`FLASK_SECRET_KEY`、`WORKSPACE_BACKEND` |
| **LLM 模型** | `{PROVIDER}_`（遗留命名） | 扫描 `*_ENABLED=true` | `DEEPSEEK_ENABLED`、`DEEPSEEK_API_KEY`、`QWEN_MODELS` |
| **数据源插件** | **`PLG_`** + `{PLUGIN}_` | manifest 中 `required_env` 全部存在 | `PLG_SUPERSET_URL`、`PLG_GRAFANA_TIMEOUT` |
| **认证 Provider** | `AUTH_PROVIDER` 单选 + Provider 自有前缀 | `AUTH_PROVIDER=xxx` 指定 | `AUTH_PROVIDER=oidc`、`OIDC_ISSUER_URL` |
| **凭证保险箱** | `CREDENTIAL_VAULT_` | `CREDENTIAL_VAULT_KEY` 存在 | `CREDENTIAL_VAULT=local`、`CREDENTIAL_VAULT_KEY=...` |

**为什么插件需要 `PLG_` 前缀？**

LLM 模型的自动发现靠扫描所有 `*_ENABLED=true` 的环境变量。如果插件也使用裸前缀（如 `SUPERSET_SSO_ENABLED=true`），会被模型注册器误识别为 model provider。加 `PLG_` 前缀后，命名空间彻底隔离：

```env
# =============================================================
# LLM 模型配置（遗留命名，{PROVIDER}_ 前缀）
# =============================================================
DEEPSEEK_ENABLED=true
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODELS=deepseek-chat

# =============================================================
# 数据源插件（PLG_{PLUGIN}_ 前缀）
# =============================================================
PLG_SUPERSET_URL=http://superset:8088
PLG_SUPERSET_SSO=true

PLG_GRAFANA_URL=http://grafana.example.com:3000
PLG_GRAFANA_TIMEOUT=10

# =============================================================
# 认证（无 PLG_ 前缀，单选机制不会冲突）
# =============================================================
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://login.microsoftonline.com/xxx/v2.0
OIDC_CLIENT_ID=abc123
```

> **注意**：LLM 模型的 `{PROVIDER}_` 命名是遗留约定，暂不添加 `MODEL_` 前缀以保持向后兼容。
> 未来如需统一，可分步迁移。当前只为新增的插件系统建立 `PLG_` 前缀规范。

### 5.3 概念模型

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
    3. get_frontend_config() — 声明前端需要的信息（组件标识、配置）
    4. on_enable() / on_disable() — 生命周期钩子
    """
    
    @staticmethod
    @abstractmethod
    def manifest() -> dict[str, Any]:
        """返回插件的自我描述。
        
        manifest() 只包含后端框架需要的声明性信息。
        UI 相关配置（catalog_entry_types 等）由 get_frontend_config() 返回。
        
        Returns:
            {
                "id": "superset",              # 唯一标识符，用作路由前缀和前端标识
                "name": "Apache Superset",     # 显示名称
                "icon": "superset",            # 前端图标标识
                "description": "...",          # 简短描述
                "version": "1.0.0",
                "env_prefix": "PLG_SUPERSET",      # 环境变量前缀（PLG_SUPERSET_URL, etc.）
                "required_env": ["PLG_SUPERSET_URL"],  # 必需的环境变量（缺失则不启用）
                "optional_env": ["PLG_SUPERSET_TIMEOUT"],
                "auth_modes": ["sso", "jwt", "password"],  # 支持的认证方式（数组）
                "capabilities": [              # 框架识别的标准能力标识
                    "datasets",                # 可以列出数据集
                    "dashboards",              # 可以列出仪表盘
                    "filters",                 # 支持数据筛选
                    "preview",                 # 支持预览（GET /data/preview）
                    "refresh",                 # 支持带参数刷新（POST /data/refresh）
                    "batch_load",              # 支持分批流式加载（NDJSON）
                    "metadata",                # 可提供列描述、表描述等外部元数据
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
        UI 相关的声明（如 catalog_entry_types）应放在这里而非 manifest()。
        
        Returns:
            {
                "enabled": True,
                "sso_login_url": "http://superset:8088/df-sso-bridge/",
                "catalog_entry_types": [
                    {
                        "type": "dataset",
                        "label": "Datasets",
                        "icon": "table_chart",
                        "supports_filters": True,
                    },
                    {
                        "type": "dashboard_chart",
                        "label": "Dashboard Charts",
                        "icon": "dashboard",
                        "supports_filters": True,
                    },
                ],
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

    def supports_sso_passthrough(self) -> bool:
        """此插件是否支持 SSO token 透传。
        
        如果返回 True，插件可以从 auth.get_sso_token() 获取用户的
        OIDC access token，直接用于调用外部系统 API，无需用户单独登录。
        默认 False。子类按需覆盖。
        """
        return False
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

#### 5.2.4 数据溯源描述：结构化条件 + 模板拼接

从外部系统加载数据时，用户通常会选择筛选条件（如地区、日期范围）。这些信息需要记录到数据上，以便后续明确"这份数据到底包含什么"。

**设计决策：不用 AI 生成描述，用模板拼接。**

| | AI 生成描述 | 模板拼接 + 原始条件 |
|--|-----------|---------------------|
| 准确性 | 可能编造细节 | 100% 准确 |
| 成本 | 每次加载消耗 token | 零成本 |
| 可刷新 | 描述是文本，无法回放 | `loadParams` 原样回传即可刷新 |

数据写入时**两层信息同时存储**，各司其职：

```
loader_metadata
├── loadParams          ← 原始筛选条件（机器用：精确刷新）
│   {"filters": [{"col":"region","op":"==","val":"Asia"}], "row_limit": 50000}
│
└── description         ← 模板拼接的可读摘要（人/AI 用：理解数据内容）
    "来源: superset · sales_data\n筛选: region = Asia, order_date >= 2025-01-01\n行数: 12,345"
```

`description` 会流向前端 `attachedMetadata`，AI Agent 分析数据时自动进入 prompt，帮助 AI 理解数据的子集范围。

**实现位置：`PluginDataWriter.write_dataframe()` 内部自动生成**，所有插件无需额外代码：

```python
# plugins/data_writer.py — write_dataframe 内部

def _build_description(self, source_metadata: dict) -> str:
    """从 source_metadata 模板拼接可读描述。"""
    parts = [f"来源: {self.plugin_id} · {source_metadata.get('source_name', '')}"]
    
    load_params = source_metadata.get("load_params", {})
    
    # 筛选条件（各插件格式不同，尝试通用提取）
    filters = load_params.get("filters", [])
    if filters:
        filter_strs = []
        for f in filters:
            if isinstance(f, dict) and "col" in f:
                filter_strs.append(f"{f['col']} {f.get('op', '=')} {f['val']}")
        if filter_strs:
            parts.append(f"筛选: {', '.join(filter_strs)}")
    
    # 时间范围（常见于仪表盘数据）
    time_range = load_params.get("time_range")
    if time_range:
        parts.append(f"时间范围: {time_range}")
    
    row_limit = load_params.get("row_limit")
    if row_limit:
        parts.append(f"行限制: {row_limit}")
    
    return "\n".join(parts)
```

调用时机：`write_dataframe()` / `write_arrow()` 在写入 Parquet 后，自动调用 `_build_description()` 将结果存入 `loader_metadata["description"]`。插件也可通过参数覆盖自动生成的描述。此描述与外部系统自带的表/列描述（[§ 7.7](#77-外部系统元数据拉取) 中的 `table_description`、`column_metadata`）互不覆盖——前者记录"加载时用了什么条件"，后者记录"这张表/列本身是什么含义"，两者并存于 metadata 中。

> **各平台的 `filters` 格式差异很大**（见 [§ 7.5 各 BI 平台查询参数兼容性分析](#75-各-bi-平台查询参数兼容性分析)）。
> `_build_description()` 只做"尽力提取"：能解析的条件拼成可读文本，无法解析的保留在 `loadParams` 中。
> 插件也可覆盖 `_build_description()` 来提供更精确的描述。

#### 5.2.5 两种写入路径对比

| | 直接写入 Workspace（推荐） | 返回 JSON 由前端处理 |
|---|---|---|
| **流向** | 插件后端 → Workspace Parquet | 插件后端 → JSON → 前端 → loadTable → Workspace |
| **适用数据量** | 任意大小 | < 5 万行（受 HTTP 响应大小和前端内存限制） |
| **性能** | 高（Parquet 压缩存储，无 JSON 序列化开销） | 低（JSON 序列化 + 网络传输 + 前端解析） |
| **进度反馈** | 通过 NDJSON 流式响应 | 无（等待完整响应） |
| **前端通知** | 返回 `table_name` → 前端刷新 `list-tables` | 前端收到数据后走 `loadTable` thunk |
| **刷新支持** | 有（`loader_metadata` 记录来源信息，可用于 `refresh-table`） | 无 |

**结论**：插件应默认使用"直接写入 Workspace"路径。仅在特殊场景（如用户只想预览但不保存、或 `WORKSPACE_BACKEND=ephemeral`）时才返回 JSON。

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
      → dispatch(loadTable({ table }))
      → 走常规 loadTable 流程（自动写入 Workspace）
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

#### 7.7.2 设计：不透明 blob + 文本描述（简化方案）

> **设计决策**：不扩展 `ColumnInfo` 和 `TableMetadata` 的结构化字段。
> 理由与 `loadParams` 保持不透明（[§ 7.5](#75-各-bi-平台查询参数兼容性分析)）相同——各平台元数据格式差异极大，强行统一到 `semantic_type`、`is_metric` 等字段是有损抽象。
> 
> 外部元数据的主要消费者是 **AI prompt**（文本）和 **UI tooltip**（文本），不需要结构化查询。
> 如果未来确实出现结构化需求（如"列出所有 certified 的表"），再从 blob 中提取，成本很低。

**后端改动最小化**：仅在 `TableMetadata` 新增 1 个可选字段：

```python
@dataclass
class TableMetadata:
    # ... 现有字段全部不动 ...
    description: str | None = None          # ← 已有，复用
    
    # 新增：来自外部系统的原始元数据（插件写入，框架不解析）
    external_metadata: dict | None = None
```

`ColumnInfo` **不改**。`list-tables` API **不改**。前端 `DictTable` 类型 **不改**。

#### 7.7.3 插件如何提供元数据

插件在调用 `PluginDataWriter.write_dataframe()` 时，将外部系统的原始元数据塞入 `external_metadata`：

```python
# plugins/superset/routes/data.py

result = writer.write_dataframe(
    df, table_name, overwrite=True,
    source_metadata={...},           # 用于刷新的 loadParams（不变）
    external_metadata={              # 外部系统的原始元数据（新增，blob）
        "source": "superset",
        "dataset_description": dataset_info.get("description"),
        "owners": [o["username"] for o in dataset_info.get("owners", [])],
        "certified": dataset_info.get("is_certified", False),
        "columns": {
            col["column_name"]: {
                "description": col.get("description"),
                "is_dttm": col.get("is_dttm"),
                "filterable": col.get("filterable"),
            }
            for col in dataset_info.get("columns", [])
        },
        "metrics": {
            m["metric_name"]: {
                "description": m.get("description"),
                "expression": m.get("expression"),
            }
            for m in dataset_info.get("metrics", [])
        },
    },
)
```

Metabase 插件塞的结构完全不同也没关系——框架不解析它。

#### 7.7.4 元数据如何流向 AI

`PluginDataWriter` 自动将 `external_metadata` 拼成可读文本，写入 `TableMetadata.description`（已有字段）：

```
来源: superset · sales_data
描述: 公司季度销售数据，按区域和产品线划分
所有者: alice@corp.com
筛选: region = Asia, order_date >= 2025-01-01
列: region (销售区域), order_date (订单日期, 时间类型), amount (订单金额, SUM(amount))
行数: 12,345
```

这段文本通过现有的 `description` → `attachedMetadata` 链路自动进入 AI prompt，**无需修改任何前端代码**。

```
外部 BI 系统 API                    后端                          前端
─────────────────                  ─────                         ─────
dataset + columns + metrics  →  external_metadata (blob)
                                     ↓ PluginDataWriter 拼接
                                 description (文本)        →  attachedMetadata → AI prompt
                                 loader_params (结构化)     →  source_metadata → 刷新按钮
```

#### 7.7.5 渐进增强

| 层次 | 场景 | 效果 |
|------|------|------|
| 0 | Upload/Paste/Database（现有行为） | `external_metadata=None`，AI 自行推断，完全不受影响 |
| 1 | 插件只传数据，不传元数据 | 与 Upload 行为一致 |
| 2 | 插件传了 `external_metadata` | `description` 自动丰富，AI prompt 质量提升 |

插件开发者把能拿到的元数据原样塞进 `external_metadata` 即可。拼接逻辑在 `PluginDataWriter` 中统一处理，尽力提取可读信息；无法解析的字段静默忽略。

---

## 8. 插件注册与发现

> **权威定义**：插件自动发现与注册（`discover_and_register()`）的完整实现、
> 插件约定、安全措施、发现流程图、`app.py` 集成方式、`/api/app-config` 暴露方式、
> 以及前端 `import.meta.glob` 自动发现，均定义在 `1-sso-plugin-architecture.md` § 4.4。
>
> 本文档不再重复这些内容。以下仅补充 Plugin 文档特有的上下文说明。

### 8.1 `/api/app-config` 中的插件字段组装

在 `get_app_config()` 中将 `manifest()` 和 `get_frontend_config()` 合并下发：

```python
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
        "auth_modes": manifest.get("auth_modes", ["none"]),
        "capabilities": manifest.get("capabilities", []),
        **frontend_config,  # catalog_entry_types 等 UI 配置在此注入
    }
config["PLUGINS"] = plugins_config
```

注意 `auth_modes`（数组）取代了旧的 `auth_type`（单字符串），且 `catalog_entry_types` 由 `get_frontend_config()` 提供而非 `manifest()`。

---

## 9. 数据流设计

### 9.1 端到端流程

```
┌─────────────────────────────────────────────────────────────────┐
│                         启动阶段                                 │
│                                                                  │
│  1. 环境变量设置 PLG_SUPERSET_URL=http://superset:8088           │
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
            "description": "Load data from Superset dashboards and datasets",
            "version": "1.0.0",
            "env_prefix": "PLG_SUPERSET",
            "required_env": ["PLG_SUPERSET_URL"],
            "auth_modes": ["sso", "jwt", "password"],
            "capabilities": [
                "datasets", "dashboards", "filters",
                "preview", "refresh", "batch_load", "metadata",
            ],
        }
    
    def create_blueprint(self):
        from data_formulator.plugins.superset.routes import create_superset_blueprint
        return create_superset_blueprint(self._client, self._catalog, self._bridge)
    
    def get_frontend_config(self):
        url = os.environ.get("PLG_SUPERSET_URL", "")
        return {
            "enabled": True,
            "sso_login_url": f"{url.rstrip('/')}/df-sso-bridge/" if url else None,
            "catalog_entry_types": [
                {
                    "type": "dataset",
                    "label": "Datasets",
                    "icon": "table_chart",
                    "supports_filters": True,
                },
                {
                    "type": "dashboard_chart",
                    "label": "Dashboard Charts",
                    "icon": "dashboard",
                    "supports_filters": True,
                },
            ],
        }
    
    def on_enable(self, app):
        url = os.environ["PLG_SUPERSET_URL"]
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

### 11.3 ExternalDataLoader 演进方向（已拆分）

> ExternalDataLoader 的现有缺陷分析和三个改进方案（数据库元数据拉取 P0、SSO Token 透传 P1、凭证持久化 P2）
> 已拆分为独立文档：**`2-external-dataloader-enhancements.md`**。
>
> 这些改进针对数据库连接器，与 DataSourcePlugin（BI 系统插件）互不干扰，
> 可以独立于插件框架按优先级逐步实施。

