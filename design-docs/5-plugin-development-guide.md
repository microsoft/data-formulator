# 数据源插件开发指南

> **目标读者**：要为 Data Formulator 开发新数据源插件的开发者。
>
> **前置阅读**：[1-data-source-plugin-architecture.md](1-data-source-plugin-architecture.md)（设计原理）、[1-sso-plugin-architecture.md](1-sso-plugin-architecture.md)（SSO + 凭证架构）。
>
> **参考实现**：`plugins/superset/`（后端）+ `src/plugins/superset/`（前端）。

---

## 目录

1. [快速上手：新增一个插件](#1-快速上手新增一个插件)
2. [后端：目录结构与约定](#2-后端目录结构与约定)
3. [后端：基类契约](#3-后端基类契约)
4. [后端：路由设计](#4-后端路由设计)
5. [后端：PluginDataWriter](#5-后端plugindatawriter)
6. [后端：认证路由规范（三模式协商）](#6-后端认证路由规范三模式协商)
7. [后端：CredentialVault 集成](#7-后端credentialvault-集成)
8. [前端：目录结构与约定](#8-前端目录结构与约定)
9. [前端：模块契约](#9-前端模块契约)
10. [前端：国际化](#10-前端国际化)
11. [环境变量命名规范](#11-环境变量命名规范)
12. [测试规范](#12-测试规范)
13. [核心代码零修改原则](#13-核心代码零修改原则)
14. [Checklist：插件上线前检查](#14-checklist插件上线前检查)

---

## 1. 快速上手：新增一个插件

假设要接入 Metabase，只需两步：

**后端**：在 `py-src/data_formulator/plugins/` 下创建 `metabase/` 目录。

```
plugins/
├── base.py               # 框架，不要修改
├── data_writer.py        # 框架，不要修改
├── __init__.py           # 框架，不要修改
└── metabase/             # ← 新增
    ├── __init__.py       # plugin_class = MetabasePlugin
    ├── metabase_client.py
    └── routes/
        ├── __init__.py
        ├── auth.py
        ├── catalog.py
        └── data.py
```

**前端**：在 `src/plugins/` 下创建 `metabase/` 目录。

```
src/plugins/
├── types.ts              # 框架，不要修改
├── registry.ts           # 框架，不要修改
├── PluginHost.tsx         # 框架，不要修改
├── index.ts              # 框架，不要修改
└── metabase/             # ← 新增
    ├── index.ts          # default export: DataSourcePluginModule
    ├── MetabasePanel.tsx
    └── locales/
        ├── en.json
        └── zh.json
```

**配置**：在 `.env` 中设置必须环境变量：

```bash
PLG_METABASE_URL=https://metabase.example.com
```

**启动**：重启 Data Formulator → 框架自动发现并启用 → 前端数据上传对话框中出现 Metabase Tab。

**核心原则：不修改任何框架文件。** 如果需要改 `plugins/__init__.py`、`registry.ts`、`app.py` 才能让新插件工作，说明框架有 bug，应该修框架。

---

## 2. 后端：目录结构与约定

```
plugins/<plugin_id>/
├── __init__.py           # 必须：暴露 plugin_class 属性
├── <plugin>_client.py    # 建议：封装外部系统 HTTP API
├── auth_bridge.py        # 可选：SSO 透传桥接
├── catalog.py            # 可选：目录浏览逻辑
├── session_helpers.py    # 建议：Plugin-namespaced session 操作
└── routes/
    ├── __init__.py
    ├── auth.py           # 必须：认证路由
    ├── catalog.py        # 建议：目录路由
    └── data.py           # 必须：数据加载路由
```

### 关键约定

- `__init__.py` 必须有一个模块级属性 `plugin_class`，指向 `DataSourcePlugin` 的具体子类。
- 如果插件有重量级依赖（如某个 SDK），应在 `__init__.py` 的顶层 import 中引入。框架会 `try/except ImportError`，缺依赖时优雅跳过并记录原因。
- Session key 必须用 `plugin_<id>_` 前缀隔离（如 `plugin_superset_token`、`plugin_metabase_token`），防止多插件间状态冲突。

---

## 3. 后端：基类契约

```python
from data_formulator.plugins.base import DataSourcePlugin

class MetabasePlugin(DataSourcePlugin):

    @staticmethod
    def manifest() -> dict:
        return {
            # ── 必须 ──
            "id": "metabase",                    # 全局唯一 slug
            "name": "Metabase",                  # 显示名
            "env_prefix": "PLG_METABASE",        # 环境变量前缀
            "required_env": ["PLG_METABASE_URL"], # 全部存在才启用

            # ── 可选 ──
            "icon": "metabase",
            "description": "Connect to Metabase to browse and load questions.",
            "auth_modes": ["password", "sso"],    # 支持的认证方式
            "capabilities": ["questions", "dashboards"],
        }

    def create_blueprint(self) -> Blueprint:
        """组装路由。url_prefix 必须是 /api/plugins/<id>/"""
        ...

    def get_frontend_config(self) -> dict:
        """返回给前端的非敏感配置。绝对不能包含密钥。"""
        ...

    def on_enable(self, app) -> None:
        """初始化共享服务（client、catalog 等），存到 app.extensions。"""
        ...

    def supports_sso_passthrough(self) -> bool:
        """外部系统与 DF 共享 IdP 时返回 True。"""
        return False
```

### manifest 字段说明

| 字段 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `id` | `str` | 是 | 全局唯一 slug，用作路由前缀、session key 前缀、前端匹配 key |
| `name` | `str` | 是 | 人类可读名称，显示在 UI |
| `env_prefix` | `str` | 是 | 环境变量命名前缀（如 `PLG_METABASE`） |
| `required_env` | `list[str]` | 是 | 必须环境变量列表，缺任一则插件不启用 |
| `icon` | `str` | 否 | 图标标识，前端 Icon 组件使用 |
| `description` | `str` | 否 | 简短描述 |
| `auth_modes` | `list[str]` | 否 | 支持的认证方式：`"password"` / `"sso"` / `"api_key"` |
| `capabilities` | `list[str]` | 否 | 能力声明，前端可据此决定 UI |
| `version` | `str` | 否 | 插件版本号 |
| `optional_env` | `list[str]` | 否 | 可选环境变量（缺失不影响启用） |

---

## 4. 后端：路由设计

### URL 前缀

所有路由都在 `/api/plugins/<plugin_id>/` 下：

```
/api/plugins/<plugin_id>/auth/login       POST   登录
/api/plugins/<plugin_id>/auth/status      GET    认证状态
/api/plugins/<plugin_id>/auth/logout      POST   登出
/api/plugins/<plugin_id>/catalog/...      GET    数据目录
/api/plugins/<plugin_id>/data/load-*      POST   数据加载
```

### 响应格式

统一 JSON 格式：

```json
// 成功
{"status": "ok", ...payload}

// 错误
{"status": "error", "message": "Human-readable error description"}
```

HTTP 状态码语义：
- `200` — 成功
- `400` — 请求参数错误（插件负责校验）
- `401` — 未认证或认证过期
- `502` — 外部系统不可达或返回错误
- `503` — 插件依赖的服务不可用（如 Vault 未配置）

---

## 5. 后端：PluginDataWriter

插件加载的数据通过 `PluginDataWriter` 写入用户 Workspace：

```python
from data_formulator.plugins.data_writer import PluginDataWriter

writer = PluginDataWriter("metabase")  # plugin_id

result = writer.write_dataframe(
    df,                          # pandas DataFrame
    "sales_data",                # 表名
    overwrite=True,              # True=覆盖同名, False=自动加后缀
    source_metadata={            # 记录来源，供刷新使用
        "plugin": "metabase",
        "question_id": 42,
    },
)
# result = {"table_name": "sales_data", "row_count": 1234, "columns": [...], "is_renamed": False}
```

**不要直接调用 `workspace.write_parquet()`**。`PluginDataWriter` 封装了身份解析、表名清洗、元数据打标等逻辑。

---

## 6. 后端：认证路由规范（三模式协商）

**这是插件开发中最重要的规范。** 每个插件的认证路由必须实现三层认证协商：

```
用户打开插件面板 → GET /api/plugins/<id>/auth/status
    │
    ▼
后端按优先级依次尝试:
    │
    ├─ ① Session 中已有有效 token?
    │   → {"authenticated": true, "mode": "session"}
    │
    ├─ ② SSO token 可用 + 插件 supports_sso_passthrough()?
    │   → 尝试 SSO 透传登录
    │   → 成功 → {"authenticated": true, "mode": "sso"}
    │   → 失败 → 继续
    │
    ├─ ③ CredentialVault 中有已存凭证?
    │   → 尝试用已存凭证登录外部系统
    │   → 成功 → {"authenticated": true, "mode": "vault"}
    │   → 失败 → {"authenticated": false, "vault_stale": true}
    │
    └─ 全部未命中
        → {"authenticated": false, "available_modes": ["password", "api_key"]}

前端根据响应:
    ├─ authenticated=true → 直接显示数据目录
    ├─ vault_stale=true  → 显示登录表单 + 提示"已保存的凭证已失效"
    └─ authenticated=false → 显示登录表单
```

### auth/login 路由（带 Vault 存储）

```python
@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(force=True)
    username = data.get("username", "")
    password = data.get("password", "")
    remember = data.get("remember", False)   # 前端传入的"记住凭证"标志

    if not username or not password:
        return jsonify({"status": "error", "message": "Missing credentials"}), 400

    try:
        result = _do_login(username, password)
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 401

    # ── Vault 存储 ──
    if remember:
        _vault_store({"username": username, "password": password})
    else:
        # 用户未勾选记住 → 如果 Vault 中有旧凭证（vault_stale），也应清除
        _vault_delete()

    return jsonify(result)
```

### auth/status 路由（带 Vault 自动取用）

```python
@auth_bp.route("/status", methods=["GET"])
def auth_status():
    plugin_id = "metabase"

    # ① 已有 Session
    token, user = require_auth()
    if token and user:
        return jsonify({"authenticated": True, "mode": "session", "user": _user_info(user)})

    # ② SSO 透传（如果插件支持）
    sso_token = _try_sso_passthrough()
    if sso_token:
        return jsonify({"authenticated": True, "mode": "sso", "user": ...})

    # ③ Credential Vault 自动取用
    vault_result = _try_vault_login(plugin_id)
    if vault_result is not None:
        return jsonify(vault_result)
    # vault_result 可能是:
    #   {"authenticated": True, "mode": "vault", "user": ...}   — 成功
    #   {"authenticated": False, "vault_stale": True}            — 凭证过期

    # 全部未命中
    return jsonify({"authenticated": False})
```

### _try_vault_login 实现模式

```python
def _try_vault_login(plugin_id: str) -> dict | None:
    """尝试用 Vault 中的已存凭证登录。

    Returns:
        None           — Vault 未配置或无凭证
        dict           — 登录结果（成功或 vault_stale）
    """
    from data_formulator.credential_vault import get_credential_vault
    from data_formulator.security.auth import get_identity_id

    vault = get_credential_vault()
    if not vault:
        return None

    identity = get_identity_id()
    stored = vault.retrieve(identity, plugin_id)
    if not stored:
        return None

    try:
        result = _do_login(stored["username"], stored["password"])
        # 登录成功 → Session 已写入
        return {"authenticated": True, "mode": "vault", "user": result.get("user")}
    except Exception:
        # 凭证失效（密码已改、账号已禁等）
        return {"authenticated": False, "vault_stale": True}
```

### 核心规则总结

| 规则 | 说明 |
|------|------|
| **先 Session → 再 SSO → 再 Vault → 最后手动** | 严格按优先级链，不跳步 |
| **Vault 凭证必须实测验证** | 从 Vault 取出后必须用它去**实际登录**外部系统，不能直接信任 |
| **失效凭证返回 vault_stale** | 外部系统密码已改时，不崩溃，而是返回 `vault_stale: true` 提示前端 |
| **remember=true 才存 Vault** | 用户主动勾选"记住凭证"后才写入 Vault |
| **remember=false 要清理 Vault** | 用户重新输入密码但不勾选记住 → 删除 Vault 中的旧凭证 |
| **凭证只在服务端流转** | 前端只知道"有没有已存凭证"（authenticated + mode），绝不接触明文 |
| **_vault_store / _vault_delete 辅助函数** | 每个插件用自己的 `plugin_id` 作为 `source_key` |

---

## 7. 后端：CredentialVault 集成

### 概述

CredentialVault 是一个可选组件（通过 `CREDENTIAL_VAULT_KEY` 环境变量启用）。插件**不应假设** Vault 一定存在——`get_credential_vault()` 返回 `None` 时，应优雅回退到纯 Session 模式。

### 插件内的 Vault 辅助函数模板

每个需要凭证存储的插件应在 `routes/auth.py` 或 `session_helpers.py` 中实现以下辅助函数：

```python
from data_formulator.credential_vault import get_credential_vault
from data_formulator.security.auth import get_identity_id

PLUGIN_ID = "metabase"

def _vault_store(credentials: dict) -> None:
    """将凭证存入 Vault（如果可用）。"""
    vault = get_credential_vault()
    if not vault:
        return
    identity = get_identity_id()
    vault.store(identity, PLUGIN_ID, credentials)

def _vault_delete() -> None:
    """从 Vault 中删除当前用户在本插件的凭证。"""
    vault = get_credential_vault()
    if not vault:
        return
    identity = get_identity_id()
    vault.delete(identity, PLUGIN_ID)

def _vault_retrieve() -> dict | None:
    """从 Vault 中取出凭证。返回 None 表示无存储或 Vault 不可用。"""
    vault = get_credential_vault()
    if not vault:
        return None
    identity = get_identity_id()
    return vault.retrieve(identity, PLUGIN_ID)
```

### Vault source_key 命名

`source_key` 统一使用 `manifest()["id"]`（即插件 ID），如 `"superset"`、`"metabase"`。一个插件只有一个 source_key，不需要更细粒度的区分。

### 匿名用户与 Vault

Vault 按 `get_identity_id()` 的返回值隔离凭证。匿名用户的 identity 是 `browser:xxx`（来自浏览器 localStorage UUID），因此：

- 匿名用户**可以**使用 Vault 保存凭证
- 但凭证绑定的是浏览器 UUID，**不跨设备、不跨浏览器**
- 清除 localStorage 即失去关联
- 这是可接受的行为——需要可靠凭证存储的用户应配置 SSO

### Vault 不可用时的行为

| Vault 状态 | 插件行为 |
|------------|---------|
| 未配置（`CREDENTIAL_VAULT_KEY` 未设置） | `get_credential_vault()` 返回 None，插件跳过 Vault 步骤，直接展示登录表单 |
| 已配置但无凭证 | `vault.retrieve()` 返回 None，跳过 Vault 步骤 |
| 已配置且有凭证 | 取出并验证，成功则自动登录，失败则返回 vault_stale |
| 密钥已更换（旧凭证无法解密） | `vault.retrieve()` 返回 None（解密失败静默返回 None，不崩溃） |

---

## 8. 前端：目录结构与约定

```
src/plugins/<plugin_id>/
├── index.ts              # 必须：default export DataSourcePluginModule
├── <Plugin>Panel.tsx     # 必须：主面板组件
├── <Plugin>Login.tsx     # 建议：登录组件
├── <Plugin>Catalog.tsx   # 建议：数据目录组件
├── api.ts                # 建议：封装后端 API 调用
└── locales/
    ├── en.json           # 建议：英文翻译
    └── zh.json           # 建议：中文翻译
```

### 发现机制

前端使用 Vite 的 `import.meta.glob` 在**构建时**扫描 `src/plugins/*/index.{ts,tsx}`。你只需要在正确的位置创建文件，无需手动注册。

---

## 9. 前端：模块契约

```typescript
// src/plugins/metabase/index.ts

import type { DataSourcePluginModule } from '../types';
import { MetabasePanel } from './MetabasePanel';
import en from './locales/en.json';
import zh from './locales/zh.json';

const MetabaseIcon: React.FC<{ sx?: object }> = (props) => (/* SVG icon */);

const metabasePlugin: DataSourcePluginModule = {
    id: 'metabase',           // 必须与后端 manifest.id 一致
    Icon: MetabaseIcon,        // 数据源菜单中的图标
    Panel: MetabasePanel,      // 主面板组件
    locales: { en, zh },       // 可选：国际化
};

export default metabasePlugin;
```

### Panel 组件接口

```typescript
interface PluginPanelProps {
    config: PluginConfig;            // 后端 get_frontend_config() 的内容
    callbacks: PluginHostCallbacks;   // 框架提供的回调
}

interface PluginHostCallbacks {
    onDataLoaded: (info: DataLoadedInfo) => void;  // 数据加载完成后调用
    onClose: () => void;                           // 关闭对话框
}
```

**数据加载完成后必须调用 `callbacks.onDataLoaded()`**，框架会据此刷新 Workspace 表列表。

### 登录面板中的"记住凭证"

如果插件支持密码登录，登录表单中应提供"记住凭证"（Remember credentials）复选框：

```typescript
const [remember, setRemember] = useState(false);

// 登录请求中传递 remember 标志
const loginPayload = { username, password, remember };
```

当 `auth/status` 返回 `vault_stale: true` 时，应显示明确的提示：

```typescript
if (authStatus.vault_stale) {
    showWarning("已保存的凭证已失效，请重新输入");
}
```

---

## 10. 前端：国际化

每个插件自带翻译文件，通过 `locales` 字段导出。框架在启动时自动合并到全局 i18n。

```json
// locales/en.json
{
    "plugin.metabase.name": "Metabase",
    "plugin.metabase.login.title": "Connect to Metabase",
    "plugin.metabase.login.remember": "Remember credentials"
}
```

**命名规范**：`plugin.<plugin_id>.<namespace>.<key>`，避免与其他插件或核心翻译冲突。

---

## 11. 环境变量命名规范

| 前缀 | 用途 | 示例 |
|------|------|------|
| `PLG_<ID>_` | 插件专属 | `PLG_SUPERSET_URL`、`PLG_METABASE_URL` |
| `PLG_<ID>_SSO_*` | SSO 透传相关 | `PLG_SUPERSET_SSO_LOGIN_URL` |

- `required_env` 中列出的变量全部存在时，插件才启用
- 管理员通过 `.env` 文件或 Docker environment 配置
- `get_frontend_config()` 可以暴露 URL 等非敏感值，但**绝不暴露密钥**

---

## 12. 测试规范

### 测试文件位置

```
tests/backend/unit/test_<plugin_id>_*.py        # 单元测试
tests/backend/integration/test_<plugin_id>_*.py  # 集成测试
tests/backend/fixtures/<plugin_id>/              # API 响应 fixture
tests/frontend/unit/plugins/<plugin_id>/         # 前端测试
```

### 外部 API Mock 策略

不要直接调用真实外部系统。使用 fixture JSON（从真实系统录制）+ `unittest.mock.patch`：

```python
@pytest.fixture
def mock_responses(fixture_dir):
    def _load(name):
        return json.loads((fixture_dir / "metabase" / name).read_text())
    return _load
```

### Vault 测试

测试 Vault 集成时使用 `tmp_path` 下的**真实 SQLite 文件 + 真实 Fernet 密钥**，不 mock 加密逻辑：

```python
@pytest.fixture
def vault(tmp_path):
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    return LocalCredentialVault(tmp_path / "test.db", key)
```

---

## 13. 核心代码零修改原则

添加新插件时，以下文件**不得修改**：

| 文件 | 职责 |
|------|------|
| `plugins/__init__.py` | 自动发现逻辑 |
| `plugins/base.py` | 基类定义 |
| `plugins/data_writer.py` | 数据写入工具 |
| `src/plugins/types.ts` | 前端类型 |
| `src/plugins/registry.ts` | 前端注册表 |
| `src/plugins/PluginHost.tsx` | 前端容器 |
| `src/plugins/index.ts` | 前端导出 |
| `app.py` | 应用入口 |
| `credential_vault/*` | 凭证保险箱框架 |
| `credential_routes.py` | 凭证管理 API |

如果你发现必须修改以上文件才能完成新插件，请先提 issue 讨论框架层面的修复方案。

---

## 14. Checklist：插件上线前检查

### 后端

- [ ] `plugin_class` 是 `DataSourcePlugin` 子类
- [ ] `manifest()` 包含 `id`、`name`、`env_prefix`、`required_env`
- [ ] `create_blueprint()` 的 `url_prefix` 是 `/api/plugins/<id>/`
- [ ] `get_frontend_config()` 不包含任何密钥
- [ ] Session key 使用 `plugin_<id>_` 前缀
- [ ] 数据写入使用 `PluginDataWriter`，不直接调用 workspace
- [ ] 认证路由实现三模式协商（Session → SSO → Vault → 手动）
- [ ] Vault 不可用时优雅降级（`get_credential_vault()` 返回 None 时跳过）
- [ ] Vault 凭证取出后**实际验证**，不盲目信任
- [ ] 失效凭证返回 `vault_stale: true`
- [ ] `remember=true` 时存入 Vault，`remember=false` 时清除旧凭证
- [ ] HTTP 错误有意义的错误信息和正确的状态码
- [ ] 缺少必须环境变量时不启用，不报错

### 前端

- [ ] `index.ts` default export 包含 `id`、`Icon`、`Panel`
- [ ] `id` 与后端 `manifest.id` 一致
- [ ] 数据加载成功后调用 `callbacks.onDataLoaded()`
- [ ] 登录表单包含"记住凭证"复选框
- [ ] `vault_stale` 时显示"凭证已失效"提示
- [ ] 翻译 key 使用 `plugin.<id>.*` 前缀
- [ ] 不引用其他插件的代码

### 配置

- [ ] `.env.template` 中有本插件的环境变量说明
- [ ] `required_env` 中的变量缺失时，插件自动跳过

### 测试

- [ ] 认证路由测试（含 Vault 自动取用、vault_stale、remember）
- [ ] 目录路由测试
- [ ] 数据加载路由测试
- [ ] fixture 文件从真实系统录制
- [ ] 核心文件 git diff 为空（零修改验证）
