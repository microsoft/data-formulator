# Data Formulator — SSO 认证 + 数据源插件 统一架构设计

## 目录

1. [概述与目标](#1-概述与目标)
2. [架构全景](#2-架构全景)
3. [Layer 1：可插拔认证体系 (AuthProvider)](#3-layer-1可插拔认证体系-authprovider)
   - 3.1~3.2b — AuthProvider 基类（含 `get_auth_info()` 自描述）、Provider 自动发现
   - 3.3~3.5 — Azure EasyAuth、OIDC（仅 2 个环境变量）、GitHub OAuth、auth.py 重构（基于自动发现）
   - 3.6~3.8 — 前端 OIDC 流程、回调页面、登录/登出 UI
   - 3.8b — Token 生命周期管理（静默刷新、401 重试、CORS/CSP、Phase 1 不含 refresh_token 的设计决策与局限性）
   - [3.9 多协议支持](#39-多协议支持从-oidc-扩展到-saml--ldap--cas--反向代理)
     - 3.9.1~3.9.2 协议全景对比、双轨模型设计
     - 3.9.3~3.9.8 Phase 2+ 扩展摘要（反向代理 / SAML / LDAP / CAS）
     - 3.9.9 前端适配（统一登录入口 + `/api/auth/info` 委托模式）
     - 3.9.10~3.9.11 模型图、Token 透传差异
     - 3.9.12~3.9.14 协议选择指南、依赖、优先级
4. [Layer 2：数据源插件系统 (DataSourcePlugin)](#4-layer-2数据源插件系统-datasourceplugin)
5. [Layer 3：凭证保险箱 (CredentialVault)](#5-layer-3凭证保险箱-credentialvault)
6. [SSO Token 透传机制](#6-sso-token-透传机制)
7. [现有 ExternalDataLoader 的演进路径](#7-现有-externaldataloader-的演进路径)
8. [身份管理：SSO 时代的简化](#8-身份管理sso-时代的简化)
9. [配置参考](#9-配置参考)
10. [目录结构](#10-目录结构)
11. [实施路径](#11-实施路径)
12. [安全模型](#12-安全模型)
13. [FAQ](#13-faq)

---

## 1. 概述与目标

### 1.1 背景

Data Formulator 0.7 的身份体系基于两种机制：
- **Azure App Service EasyAuth** — 部署到 Azure 时由平台注入 `X-MS-CLIENT-PRINCIPAL-ID`
- **浏览器 UUID** — 本地使用时 `localStorage` 中的随机 UUID

这套机制存在三个根本性限制：

| 限制 | 影响 |
|------|------|
| 仅绑定 Azure 生态 | 使用 Keycloak、Okta、Auth0、Google 等 IdP 的团队无法接入 |
| 无真实用户身份 | 无法实现跨设备数据同步、审计追踪、细粒度权限 |
| 无法透传认证 | 当外部系统（Superset、Metabase）也接了同一个 IdP 时，用户仍需重复登录 |

同时，数据源连接方面，现有的 `ExternalDataLoader` 体系面向数据库设计，无法覆盖 BI 报表系统的复杂认证、数据浏览和权限透传需求。

### 1.2 设计目标

构建一套 **SSO 认证 + 数据源插件 + 凭证管理** 的统一架构，实现：

1. **通用 SSO 登录** — 用户通过 OIDC、SAML、LDAP、CAS 或反向代理等任意方式登录 Data Formulator
2. **插件化数据源** — BI 报表系统（Superset、Metabase、Power BI 等）以插件形式接入，新增系统不修改核心代码
3. **SSO Token 透传** — 外部系统与 DF 共用同一 IdP 时，用户无需重复登录
4. **凭证保险箱** — 未接 SSO 的外部系统，凭证在服务端加密存储，跨设备可用
5. **向后兼容** — 本地个人使用场景下，匿名浏览器模式依然可用，零配置启动

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| **不自建用户管理** | 认证是 IdP 的事，DF 只做身份消费者，不管理密码和注册 |
| **插件自包含** | 每个外部系统的后端路由 + 前端 UI + 认证逻辑完全独立于核心代码 |
| **渐进式采纳** | 本地模式 → 加 SSO → 加插件 → 加凭证保险箱，每一步都可独立部署 |
| **安全纵深** | 认证链路上 OIDC JWT 验签、服务端凭证加密、Workspace 身份隔离 三层防护 |

---

## 2. 架构全景

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           用户浏览器                                         │
│                                                                              │
│   ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐  │
│   │ OIDC Login   │  │ Credential       │  │ Data Source Dialog           │  │
│   │ (PKCE flow)  │  │ Manager UI       │  │ ┌──────┐ ┌────────┐ ┌────┐  │  │
│   │              │  │ (per-source)     │  │ │Upload│ │Database│ │插件│  │  │
│   └──────┬───────┘  └────────┬─────────┘  │ │Paste │ │(现有)  │ │Tab │  │  │
│          │                   │            │ │URL   │ │        │ │    │  │  │
│          ▼                   ▼            │ └──────┘ └────────┘ └──┬─┘  │  │
│   ┌─────────────────────────────────────────────────────────────────┘     │
│   │         fetchWithIdentity (增强)                                      │
│   │    X-Identity-Id: user:alice@corp.com  (SSO 登录后)                   │
│   │    Authorization: Bearer <OIDC access_token>                         │
│   └──────────────────────────┬───────────────────────────────────────────┘
│                              │                                              │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │  HTTPS
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Flask 后端                                           │
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────────┐ │
│   │                    auth.py — get_identity_id()                          │ │
│   │                                                                         │ │
│   │   AUTH_PROVIDER (单选) + 匿名回退:                                       │ │
│   │   ┌─────────────────────────────────┐  ┌───────────────────────────┐   │ │
│   │   │ 主 Provider (由 AUTH_PROVIDER   │  │ Browser UUID              │   │ │
│   │   │ 指定: oidc / github / azure /  │→ │ (ALLOW_ANONYMOUS=true时)  │   │ │
│   │   │ proxy / saml / ldap / cas)     │  │                           │   │ │
│   │   └─────────────────────────────────┘  └───────────────────────────┘   │ │
│   └────────────────────────────────┬────────────────────────────────────────┘ │
│                                    │                                          │
│   ┌────────────────────────────────┼────────────────────────────────────────┐ │
│   │                 Plugin Registry + Credential Vault                      │ │
│   │                                                                         │ │
│   │   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐     │ │
│   │   │ Superset    │ │ Metabase    │ │ Power BI    │ │ Grafana     │     │ │
│   │   │ Plugin      │ │ Plugin      │ │ Plugin      │ │ Plugin      │ ... │ │
│   │   │             │ │             │ │             │ │             │     │ │
│   │   │ 认证: SSO透传│ │ 认证: 用户名 │ │ 认证: OAuth │ │ 认证: API Key│     │ │
│   │   │ 或 JWT登录  │ │ /密码+保险箱│ │ +SSO透传    │ │ +保险箱     │     │ │
│   │   └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘     │ │
│   │          │               │               │               │             │ │
│   │          ▼               ▼               ▼               ▼             │ │
│   │   ┌─────────────────────────────────────────────────────────────┐      │ │
│   │   │         Credential Vault (加密凭证存储)                      │      │ │
│   │   │    per-user, per-source 的服务端加密存储                     │      │ │
│   │   └─────────────────────────────────────────────────────────────┘      │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│   ┌────────────────────────────────┼────────────────────────────────────────┐ │
│   │              Data Layer (不变)                                          │ │
│   │   ExternalDataLoader (9种DB) + Workspace (Parquet) + Redux Store       │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                   ┌─────────────────────┐
                   │  外部系统             │
                   │  Superset / Metabase │
                   │  / Power BI / ...    │
                   └─────────────────────┘
```

**三层分工**：

| 层 | 职责 | 状态 |
|----|------|------|
| **Layer 1: AuthProvider** | 解决"谁在用 DF" — 单一认证源 + 匿名回退 | 扩展现有 `auth.py` |
| **Layer 2: DataSourcePlugin** | 解决"从哪拉数据" — 外部 BI 系统的插件化接入 | 新建插件框架 |
| **Layer 3: CredentialVault** | 解决"用什么身份访问外部系统" — 加密凭证存储 | 新建 |

**三层分层依赖、向上服务**：Layer 1 是地基，确定用户身份（`user:xxx` 或 `browser:xxx`）；Layer 3 依赖 Layer 1 的身份信息按用户存取凭证；Layer 2 同时依赖 Layer 1（获取 SSO token）和 Layer 3（获取已存凭证）来访问外部系统。依赖方向单向向下，不存在循环依赖。

```
Layer 2: DataSourcePlugin  ──依赖──→  Layer 1: AuthProvider (身份 + SSO token)
       │                                       ▲
       └──依赖──→  Layer 3: CredentialVault ────┘ (按用户身份存取)
```

### 统一的插件范式

三层虽然解决不同问题，但共享同一套 **"抽象基类 + 环境变量声明依赖 + 按需自动启用"** 的设计范式：

| 维度 | AuthProvider | DataSourcePlugin | CredentialVault |
|------|-------------|-----------------|-----------------|
| 抽象基类 | `AuthProvider(ABC)` | `DataSourcePlugin(ABC)` | `CredentialVault(ABC)` |
| 动态加载 | `importlib.import_module` | 目录自动扫描 (`pkgutil`) | 工厂函数 `get_credential_vault()` |
| 启用判定 | `AUTH_PROVIDER` 环境变量指定 | `manifest()` 中 `required_env`（`PLG_` 前缀）全部存在 | `CREDENTIAL_VAULT_KEY` 存在 |
| 按需启用 | 未指定则匿名模式 | 缺 `required_env` 则跳过 | 缺密钥则返回 None |
| 新增方式 | **在 `auth_providers/` 下创建 `.py` 即可**（自动发现） | **在 `plugins/` 下创建目录即可**（零改动） | 写一个 `.py` + 工厂加一个分支 |
| 生命周期钩子 | `on_configure(app)` | `on_enable(app)` | — |

**协作模式**：

```
AuthProvider — 单选 + 匿名回退 (Single Provider + Fallback)
  ┌──────────────────┐     ┌──────────────┐
  │ 主 Provider       │ ──→ │ Browser UUID │
  │ (由 AUTH_PROVIDER │ 未命中│ (匿名回退)   │
  │  环境变量指定)     │     │              │
  └──────────────────┘     └──────────────┘
  ▸ Phase 1: AUTH_PROVIDER=oidc / github / azure_easyauth
  ▸ Phase 2+: proxy_header / saml / ldap / cas
  ▸ 同一时间只有一个主 Provider 生效
  ▸ ALLOW_ANONYMOUS=true 时允许匿名回退，否则未认证请求被拒绝

DataSourcePlugin — 并行 (Registry)
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Superset │  │ Metabase │  │ Power BI │  ...
  │ Plugin   │  │ Plugin   │  │ Plugin   │
  └──────────┘  └──────────┘  └──────────┘
  ▸ 所有已启用插件同时存在（目录自动扫描，无需注册）
  ▸ 每个插件注册独立的 Blueprint 路由
  ▸ 前端为每个插件渲染一个独立 Tab
  ▸ 用户可以同时连多个系统

CredentialVault — 单例 (Strategy)
  ┌──────────┐ 或 ┌──────────────┐ 或 ┌──────────────┐
  │ Local    │    │ Azure        │    │ HashiCorp    │
  │ (SQLite) │    │ Key Vault    │    │ Vault        │  ...
  └──────────┘    └──────────────┘    └──────────────┘
  ▸ 同一时间只有一个实现生效
  ▸ 由 CREDENTIAL_VAULT 环境变量选择
  ▸ 所有插件和 DataLoader 共享同一个 Vault 实例
```

这套统一范式意味着：未来无论是新增认证方式、新增数据源（如 Grafana、Tableau）、还是新增凭证后端（如 HashiCorp Vault），步骤都是相同的 —— **写一个实现类，配置环境变量启用**。核心代码零修改。

认证体系进一步细分为两轨：
- **A 类（无状态）** — 直接实现 `AuthProvider.authenticate()`，无需额外路由（如 OIDC、Azure EasyAuth、反向代理头、GitHub OAuth）
- **B 类（有状态）** — 编写 Login Gateway Blueprint + 复用通用 `SessionProvider`（如 SAML、LDAP、CAS）

详见 [3.9 多协议支持](#39-多协议支持从-oidc-扩展到-saml--ldap--cas--反向代理)。

---

## 3. Layer 1：可插拔认证体系 (AuthProvider)

### 3.1 设计思路

将现有 `auth.py` 中硬编码的三级优先级，重构为 **单一 AuthProvider + 匿名回退** 模型。管理员通过 `AUTH_PROVIDER` 环境变量选择一种认证方式，框架自动加载对应的 Provider。支持无状态（OIDC/Header）和有状态（SAML/LDAP/CAS via Session）两种认证模型（详见 [3.9](#39-多协议支持从-oidc-扩展到-saml--ldap--cas--反向代理)）。

```
请求进入
  │
  ├─ 主 Provider (由 AUTH_PROVIDER 环境变量指定，Phase 1):
  │   ├─ oidc           → 检查 Authorization: Bearer     → 命中 → user:xxx
  │   ├─ azure_easyauth → 检查 X-MS-CLIENT-PRINCIPAL-ID  → 命中 → user:xxx
  │   └─ github         → 检查 Flask session (OAuth)      → 命中 → user:xxx
  │
  │   Phase 2+ 扩展:
  │   ├─ proxy_header   → 检查 X-Forwarded-User (可信IP) → 命中 → user:xxx
  │   ├─ saml           → 检查 Flask session (SAML ACS)   → 命中 → user:xxx
  │   ├─ ldap           → 检查 Flask session (LDAP bind)  → 命中 → user:xxx
  │   └─ cas            → 检查 Flask session (CAS ticket) → 命中 → user:xxx
  │
  ├─ 匿名回退 (ALLOW_ANONYMOUS=true 时):
  │   └─ BrowserIdentity → 检查 X-Identity-Id            → 命中 → browser:xxx
  │
  └─ 全部未命中 → 401 Unauthorized
```

### 3.2 AuthProvider 基类

```python
# py-src/data_formulator/auth_providers/base.py

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional
from flask import Request


@dataclass
class AuthResult:
    """认证结果（Phase 1 精简版，仅保留核心字段）。

    设计决策 — 不包含 refresh_token：
    Phase 1 采用纯前端（oidc-client-ts）管理 token 刷新，后端保持无状态。
    refresh_token 仅存在于前端 UserManager 内部，不经过后端，不在此结构中出现。
    局限性及未来扩展方向详见 3.8b 节"设计决策与局限性"。
    """
    user_id: str                           # 唯一标识 (sub claim / principal ID / UUID)
    display_name: Optional[str] = None     # 显示名称
    email: Optional[str] = None            # 邮箱
    raw_token: Optional[str] = None        # 原始 access_token (用于 SSO 透传，非 refresh_token)


class AuthProvider(ABC):
    """认证提供者基类。
    
    每个 Provider 从 HTTP 请求中尝试提取并验证用户身份。
    返回 None 表示此 Provider 不适用，交给链中的下一个。
    抛出异常表示认证信息存在但无效（如 token 过期）。
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider 名称，用于日志和调试。"""
        ...

    @abstractmethod
    def authenticate(self, request: Request) -> Optional[AuthResult]:
        """尝试从请求中提取用户身份。
        
        Returns:
            AuthResult — 认证成功
            None       — 此 Provider 不适用（请求中没有此 Provider 的认证信息）
        
        Raises:
            AuthenticationError — 认证信息存在但无效（token 过期、签名错误等）
        """
        ...

    @property
    def enabled(self) -> bool:
        """Provider 是否已正确配置（必需的环境变量等）。
        
        默认返回 True。子类可覆盖此属性，当必要配置缺失时返回 False，
        init_auth() 会据此拒绝激活该 Provider 并输出日志。
        """
        return True

    def on_configure(self, app) -> None:
        """Flask app 创建后调用，可用于初始化（如下载 JWKS）。"""
        pass

    def get_auth_info(self) -> dict[str, Any]:
        """返回前端所需的认证配置信息（供 /api/auth/info 端点使用）。
        
        每个 Provider 自描述其前端交互方式，消除 auth.py 中的 switch 语句。
        新增 Provider 时只需实现此方法，无需修改 auth.py。
        
        Returns:
            {
                "action": "frontend" | "redirect" | "form" | "transparent" | "none",
                "label": "显示名称",
                ... (Provider 特定的配置)
            }
        """
        return {"action": "none"}


class AuthenticationError(Exception):
    """认证信息存在但验证失败。"""
    def __init__(self, message: str, provider: str = ""):
        self.provider = provider
        super().__init__(message)
```

### 3.2b Provider 自动发现（auth_providers/__init__.py）

`auth_providers` 包在导入时自动扫描同目录下的所有模块，发现并注册所有 `AuthProvider` 子类。
新增 Provider 只需在 `auth_providers/` 下创建 `.py` 文件并实现 `AuthProvider` 子类，**无需修改任何注册表或配置文件**。

```python
# py-src/data_formulator/auth_providers/__init__.py

import importlib
import inspect
import logging
import pkgutil
from typing import Optional

from .base import AuthProvider

_log = logging.getLogger(__name__)

_PROVIDER_REGISTRY: dict[str, type[AuthProvider]] = {}

def _discover_providers() -> None:
    """扫描 auth_providers/ 目录，收集所有 AuthProvider 子类。"""
    for finder, module_name, ispkg in pkgutil.iter_modules(__path__):
        if module_name == "base":
            continue
        try:
            mod = importlib.import_module(f".{module_name}", __package__)
            for attr_name in dir(mod):
                cls = getattr(mod, attr_name)
                if (isinstance(cls, type)
                    and issubclass(cls, AuthProvider)
                    and cls is not AuthProvider):
                    instance = cls()
                    _PROVIDER_REGISTRY[instance.name] = cls
                    _log.debug("Discovered auth provider: '%s' from %s",
                               instance.name, module_name)
        except ImportError as e:
            _log.debug("Skipped '%s' (missing dep): %s", module_name, e)

_discover_providers()


def get_provider_class(name: str) -> Optional[type[AuthProvider]]:
    """根据 AUTH_PROVIDER 环境变量的值获取对应的 Provider 类。"""
    return _PROVIDER_REGISTRY.get(name)


def list_available_providers() -> list[str]:
    """返回所有已发现的 Provider 名称（用于日志和错误提示）。"""
    return sorted(_PROVIDER_REGISTRY.keys())
```

**工作原理**：

1. `pkgutil.iter_modules(__path__)` 扫描 `auth_providers/` 目录下的所有 `.py` 文件
2. 跳过 `base.py`（基类不是具体 Provider）
3. 对每个模块，用 `inspect` 逻辑找出所有 `AuthProvider` 子类
4. 实例化以获取 `name` 属性（来自子类的 `@property`），作为注册表的 key
5. 依赖缺失的模块（如 Phase 2 的 SAML 需要 `python3-saml`）会被静默跳过

**安全性保障**：自动发现只决定"有哪些 Provider 可用"，实际激活哪个仍由 `AUTH_PROVIDER` 环境变量**单选**控制。
未被选中的 Provider 不会执行 `on_configure()`，不会处理任何请求。

### 3.3 Azure EasyAuth Provider（迁移现有逻辑）

```python
# py-src/data_formulator/auth_providers/azure_easyauth.py

import logging
from flask import Request
from typing import Optional
from .base import AuthProvider, AuthResult

logger = logging.getLogger(__name__)


class AzureEasyAuthProvider(AuthProvider):
    """Azure App Service 内置认证 (EasyAuth)。
    
    当 DF 部署在 Azure App Service 并启用了身份验证时，
    Azure 会在请求到达 Flask 之前验证用户身份，并注入以下头：
    - X-MS-CLIENT-PRINCIPAL-ID: 用户的 Object ID
    - X-MS-CLIENT-PRINCIPAL-NAME: 用户名 (可选)
    
    这些头由 Azure 基础设施设置，客户端无法伪造。
    """

    @property
    def name(self) -> str:
        return "azure_easyauth"

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        principal_id = request.headers.get("X-MS-CLIENT-PRINCIPAL-ID")
        if not principal_id:
            return None

        principal_name = request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME", "")
        logger.debug("Azure EasyAuth: principal_id=%s...", principal_id[:8])

        return AuthResult(
            user_id=principal_id.strip(),
            display_name=principal_name.strip() or None,
        )
```

### 3.4 OIDC Provider（新增核心）

```python
# py-src/data_formulator/auth_providers/oidc.py

import logging
import os
import time
from typing import Optional

import jwt
from jwt import PyJWKClient
from flask import Request

from .base import AuthProvider, AuthResult, AuthenticationError

logger = logging.getLogger(__name__)


class OIDCProvider(AuthProvider):
    """通用 OIDC (OpenID Connect) 认证提供者。
    
    支持任何标准 OIDC 兼容的 Identity Provider：
    - Keycloak
    - Okta
    - Auth0
    - Azure AD / Entra ID
    - Google Identity Platform
    - Authelia / Authentik
    - Casdoor
    
    工作流程：
    1. 前端通过 PKCE Authorization Code Flow 从 IdP 获取 access_token
    2. 前端将 access_token 放在 Authorization: Bearer 头中发送
    3. 本 Provider 用 IdP 的 JWKS 公钥验证 token 签名和 claims
    4. 验证通过后提取 sub (用户唯一ID)、name、email 等信息
    
    配置（环境变量）— 仅需两项：
        OIDC_ISSUER_URL     — IdP 的 issuer URL
        OIDC_CLIENT_ID      — 注册的 client ID (同时用作 audience 校验)
    
    其余信息（JWKS URI、签名算法）从 OIDC Discovery 自动获取，
    claim 名称遵循 OIDC 标准 (sub / name / email)，无需配置。
    """

    def __init__(self):
        self._issuer = os.environ.get("OIDC_ISSUER_URL", "").strip().rstrip("/")
        self._client_id = os.environ.get("OIDC_CLIENT_ID", "").strip()

        self._jwks_client: Optional[PyJWKClient] = None
        self._jwks_uri: Optional[str] = None
        self._algorithms: list[str] = ["RS256"]

    @property
    def name(self) -> str:
        return "oidc"

    @property
    def enabled(self) -> bool:
        return bool(self._issuer and self._client_id)

    def on_configure(self, app) -> None:
        if not self.enabled:
            logger.info("OIDC provider not configured (OIDC_ISSUER_URL / OIDC_CLIENT_ID missing)")
            return

        # 从 OIDC Discovery 自动获取 JWKS URI 和签名算法
        try:
            import urllib.request, json
            discovery_url = f"{self._issuer}/.well-known/openid-configuration"
            with urllib.request.urlopen(discovery_url, timeout=10) as resp:
                discovery = json.loads(resp.read())

            self._jwks_uri = discovery["jwks_uri"]
            self._jwks_client = PyJWKClient(self._jwks_uri, cache_keys=True)

            if "id_token_signing_alg_values_supported" in discovery:
                self._algorithms = discovery["id_token_signing_alg_values_supported"]

            logger.info(
                "OIDC provider configured: issuer=%s, client_id=%s",
                self._issuer, self._client_id,
            )
        except Exception as e:
            logger.error("Failed to initialize OIDC provider: %s", e)

    def get_auth_info(self) -> dict:
        """返回 OIDC 前端配置，供 /api/auth/info 端点使用。"""
        return {
            "action": "frontend",
            "label": os.environ.get("AUTH_DISPLAY_NAME", "SSO Login"),
            "oidc": {
                "authority": self._issuer,
                "clientId": self._client_id,
                "scopes": "openid profile email",
            },
        }

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        if not self._jwks_client:
            return None

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None

        token = auth_header[7:].strip()
        if not token:
            return None

        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=self._algorithms,
                issuer=self._issuer,
                audience=self._client_id,
                options={
                    "verify_exp": True,
                    "verify_iss": True,
                    "verify_aud": True,
                },
            )
        except jwt.ExpiredSignatureError:
            raise AuthenticationError("OIDC token expired", provider=self.name)
        except jwt.InvalidTokenError as e:
            raise AuthenticationError(f"Invalid OIDC token: {e}", provider=self.name)

        user_id = payload.get("sub")
        if not user_id:
            raise AuthenticationError(
                "OIDC token missing 'sub' claim",
                provider=self.name,
            )

        return AuthResult(
            user_id=str(user_id),
            display_name=payload.get("name"),
            email=payload.get("email"),
            raw_token=token,
        )
```

### 3.4b GitHub OAuth Provider（新增 — 社交登录）

GitHub OAuth 是纯 OAuth2（不是 OIDC，没有 `id_token`），需要后端完成授权码交换，因此属于 **B 类有状态 Provider**。

```python
# py-src/data_formulator/auth_providers/github_oauth.py

import os
import logging
from typing import Optional
from flask import Request, session

from .base import AuthProvider, AuthResult

logger = logging.getLogger(__name__)


class GitHubOAuthProvider(AuthProvider):
    """GitHub OAuth 2.0 认证。
    
    配置（环境变量）：
        GITHUB_CLIENT_ID      — GitHub OAuth App 的 Client ID (必需)
        GITHUB_CLIENT_SECRET   — GitHub OAuth App 的 Client Secret (必需)
    
    工作流程（B 类有状态）：
    1. 前端重定向到 /api/auth/github/login → 302 到 GitHub 授权页
    2. 用户授权后 GitHub 回调到 /api/auth/github/callback
    3. 后端用 code 换取 access_token，查询 /user API 获取用户信息
    4. 写入 Flask session
    5. 后续请求由本 Provider 从 session 中读取身份
    """

    def __init__(self):
        self._client_id = os.environ.get("GITHUB_CLIENT_ID", "").strip()
        self._client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "").strip()

    @property
    def name(self) -> str:
        return "github"

    @property
    def enabled(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        """从 Flask session 中读取 GitHub OAuth 认证结果。"""
        user_data = session.get("df_user")
        if not user_data or user_data.get("provider") != "github":
            return None

        return AuthResult(
            user_id=user_data["user_id"],
            display_name=user_data.get("display_name"),
            email=user_data.get("email"),
            raw_token=user_data.get("raw_token"),
        )

    def get_auth_info(self) -> dict:
        """返回 GitHub OAuth 前端配置。"""
        return {
            "action": "redirect",
            "url": "/api/auth/github/login",
            "label": os.environ.get("AUTH_DISPLAY_NAME", "GitHub Login"),
        }
```

```python
# py-src/data_formulator/auth_gateways/github_gateway.py

import os
import logging
import urllib.parse
from flask import Blueprint, request, redirect, session, jsonify

from data_formulator.auth_providers.base import AuthResult

logger = logging.getLogger(__name__)

github_bp = Blueprint("github_auth", __name__, url_prefix="/api/auth/github")


@github_bp.route("/login")
def github_login():
    """重定向到 GitHub 授权页。"""
    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    redirect_uri = request.url_root.rstrip("/") + "/api/auth/github/callback"
    scope = "read:user user:email"
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
    })
    return redirect(f"https://github.com/login/oauth/authorize?{params}")


@github_bp.route("/callback")
def github_callback():
    """GitHub OAuth 回调 — 用授权码换取 access_token 并查询用户信息。"""
    import requests as http_requests

    code = request.args.get("code")
    if not code:
        return jsonify({"error": "Missing authorization code"}), 400

    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "")
    redirect_uri = request.url_root.rstrip("/") + "/api/auth/github/callback"

    # 用 code 换 access_token
    token_resp = http_requests.post(
        "https://github.com/login/oauth/access_token",
        json={"client_id": client_id, "client_secret": client_secret,
              "code": code, "redirect_uri": redirect_uri},
        headers={"Accept": "application/json"},
        timeout=10,
    )
    if not token_resp.ok:
        return jsonify({"error": "Failed to exchange code for token"}), 502

    access_token = token_resp.json().get("access_token")
    if not access_token:
        return jsonify({"error": "No access_token in response"}), 502

    # 查询 GitHub 用户信息
    user_resp = http_requests.get(
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        timeout=10,
    )
    if not user_resp.ok:
        return jsonify({"error": "Failed to fetch GitHub user info"}), 502

    user_info = user_resp.json()
    user_id = str(user_info.get("id", ""))
    login = user_info.get("login", "")

    session["df_user"] = {
        "user_id": f"github:{user_id}",
        "display_name": user_info.get("name") or login,
        "email": user_info.get("email"),
        "raw_token": access_token,
        "provider": "github",
    }
    logger.info("GitHub login successful: user=%s (%s)", login, user_id)

    return redirect("/")
```

### 3.5 重构后的 auth.py

```python
# py-src/data_formulator/auth.py (重构)

"""
Authentication and identity management for Data Formulator.

Single AuthProvider + anonymous fallback:
  AUTH_PROVIDER=oidc   → OIDCProvider → user:<id>
  ALLOW_ANONYMOUS=true → Browser UUID → browser:<id>
"""

import logging
import re
import os
from typing import Optional
from flask import request, g, Flask

from data_formulator.auth_providers.base import (
    AuthProvider, AuthResult, AuthenticationError,
)
from data_formulator.auth_providers import (
    get_provider_class, list_available_providers,
)

logger = logging.getLogger(__name__)

_MAX_IDENTITY_LENGTH = 256
_IDENTITY_RE = re.compile(r'^[\w@.\-+/: ]+$', re.ASCII)

# 主 Provider，由 init_auth() 初始化
_provider: Optional[AuthProvider] = None
_allow_anonymous: bool = True


def _validate_identity_value(value: str, source: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"Empty identity value from {source}")
    if len(value) > _MAX_IDENTITY_LENGTH:
        raise ValueError(f"Identity from {source} exceeds {_MAX_IDENTITY_LENGTH} chars")
    if not _IDENTITY_RE.match(value):
        raise ValueError(f"Identity from {source} contains disallowed characters")
    return value


def init_auth(app: Flask) -> None:
    """初始化认证。在 app 创建后调用一次。
    
    配置模型极简：
        AUTH_PROVIDER=oidc          ← 选一种（不设置 = 纯匿名模式）
        ALLOW_ANONYMOUS=false       ← 仅在需要强制登录时设置（默认 true，允许匿名回退）
    """
    global _provider, _allow_anonymous

    _allow_anonymous = os.environ.get("ALLOW_ANONYMOUS", "true").lower() in ("true", "1", "yes")
    provider_name = os.environ.get("AUTH_PROVIDER", "").strip().lower()

    if not provider_name or provider_name == "anonymous":
        logger.info("Auth mode: anonymous only (no AUTH_PROVIDER configured)")
        return

    provider_cls = get_provider_class(provider_name)
    if not provider_cls:
        logger.error("Unknown AUTH_PROVIDER: '%s'. Available: %s",
                      provider_name, ", ".join(list_available_providers()))
        return

    try:
        provider: AuthProvider = provider_cls()

        if not provider.enabled:
            logger.error(
                "AUTH_PROVIDER='%s' is set but required configuration is missing. "
                "Provider will NOT be activated. Check environment variables.",
                provider_name,
            )
            return

        provider.on_configure(app)
        _provider = provider
        logger.info("Auth provider '%s' activated", provider_name)
    except Exception as e:
        logger.error("Auth provider '%s' failed to init: %s", provider_name, e)

    logger.info(
        "Auth mode: %s%s",
        provider_name or "anonymous",
        " + anonymous fallback" if _allow_anonymous else " (login required)",
    )


def get_identity_id() -> str:
    """获取当前请求的命名空间身份 ID。
    
    逻辑：
      1. 主 Provider 认证成功 → user:<id>
      2. ALLOW_ANONYMOUS=true + X-Identity-Id 头 → browser:<id>
      3. 以上均无 → 401
    """
    # 尝试主 Provider
    if _provider:
        try:
            result = _provider.authenticate(request)
            if result is not None:
                validated = _validate_identity_value(result.user_id, _provider.name)
                logger.debug("Authenticated via %s: user:%s...", _provider.name, validated[:8])
                g.df_auth_result = result
                return f"user:{validated}"
        except AuthenticationError as e:
            logger.warning("Auth provider '%s' rejected request: %s", e.provider, e)
            raise ValueError(f"Authentication failed: {e}")

    # 匿名回退
    if _allow_anonymous:
        client_identity = request.headers.get("X-Identity-Id")
        if client_identity:
            if ":" in client_identity:
                identity_value = client_identity.split(":", 1)[1]
            else:
                identity_value = client_identity
            validated = _validate_identity_value(identity_value, "X-Identity-Id header")
            return f"browser:{validated}"

    raise ValueError("Authentication required. Please log in.")


def get_auth_result() -> Optional[AuthResult]:
    """获取当前请求的完整认证结果。
    
    仅在 get_identity_id() 通过主 Provider 认证成功后可用。
    browser 身份请求返回 None。
    
    用途：
    - 获取 raw_token 用于 SSO 透传
    - 获取 display_name / email 用于 UI 显示
    """
    return getattr(g, "df_auth_result", None)


def get_sso_token() -> Optional[str]:
    """获取当前用户的 SSO access token，用于透传给外部系统。
    
    Returns:
        access_token 字符串，或 None（匿名用户 / Provider 不提供 token）
    """
    result = get_auth_result()
    return result.raw_token if result else None
```

### 3.6 前端 OIDC 登录流程

前端使用 **PKCE (Proof Key for Code Exchange)** 流程 — 这是 SPA 的标准 OIDC 方式，不需要 client secret。

推荐使用 `oidc-client-ts` 库（轻量、标准兼容、维护活跃）。

```typescript
// src/app/oidcConfig.ts — 运行时从后端获取配置（简化版）

import { UserManager, WebStorageStateStore, User } from "oidc-client-ts";

let _userManager: UserManager | null = null;
let _configPromise: Promise<{authority: string; clientId: string; redirectUri: string} | null> | null = null;

// 从统一端点获取 OIDC 配置（无需前端编译时配置）
export async function getOidcConfig(): Promise<{authority: string; clientId: string; redirectUri: string} | null> {
    if (_configPromise) return _configPromise;
    
    _configPromise = fetch('/api/auth/info')
        .then(r => r.ok ? r.json() : null)
        .then(info => {
            if (info?.provider !== 'oidc' || !info?.oidc) return null;
            return {
                authority: info.oidc.authority,
                clientId: info.oidc.clientId,
                redirectUri: info.oidc.redirectUri || `${window.location.origin}/callback`,
            };
        })
        .catch(() => null);
    
    return _configPromise;
}

export async function getUserManager(): Promise<UserManager | null> {
    if (_userManager) return _userManager;
    const config = await getOidcConfig();
    if (!config) return null;

    _userManager = new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: "openid profile email",
        automaticSilentRenew: true,
        userStore: new WebStorageStateStore({ store: window.localStorage }),
    });

    return _userManager;
}

export async function getAccessToken(): Promise<string | null> {
    const mgr = await getUserManager();
    if (!mgr) return null;
    const user = await mgr.getUser();
    if (!user || user.expired) return null;
    return user.access_token;
}
```

前端认证初始化统一通过 `/api/auth/info` 端点驱动（详见 [3.9.9 节](#399-前端适配统一登录入口)），一次请求确定认证模式，无需串行回退。

修改 `fetchWithIdentity` 以自动携带 OIDC token：

```typescript
// src/app/utils.tsx — fetchWithIdentity 增强

export async function fetchWithIdentity(
    url: string | URL,
    options: RequestInit = {}
): Promise<Response> {
    const urlString = typeof url === "string" ? url : url.toString();

    if (urlString.startsWith("/api/")) {
        const headers = new Headers(options.headers);

        // 身份标识 (所有请求)
        const namespacedIdentity = await getCurrentNamespacedIdentity();
        headers.set("X-Identity-Id", namespacedIdentity);
        headers.set("Accept-Language", getAgentLanguage());

        // OIDC token (如果可用)
        const accessToken = await getAccessToken();  // 从 oidcConfig.ts
        if (accessToken) {
            headers.set("Authorization", `Bearer ${accessToken}`);
        }

        options = { ...options, headers };
    }

    return fetch(url, options);
}
```

### 3.7 OIDC 回调页面

> **国际化约定**：所有用户可见的文本使用 `react-i18next` 的 `useTranslation()` / `t()` 获取，
> 翻译 key 统一放在 `auth.*` 命名空间下（复用 0.6 已有的 i18n 基础设施）。
> UI 样式对齐 0.6 `LoginView.tsx` 的 MUI Paper 居中卡片风格。

```typescript
// src/app/OidcCallback.tsx

import { useEffect, useState } from "react";
import { Box, CircularProgress, Typography, Alert, Paper, alpha, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import { getUserManager } from "./oidcConfig";
import dfLogo from "../assets/df-logo.png";

export function OidcCallback() {
    const { t } = useTranslation();
    const theme = useTheme();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const mgr = await getUserManager();
                if (mgr) {
                    await mgr.signinRedirectCallback();
                    window.location.href = "/";
                }
            } catch (err: any) {
                setError(err?.message || "Unknown error");
            }
        })();
    }, []);

    return (
        <Box sx={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", height: "100%",
            background: `
                linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px),
                linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px)
            `,
            backgroundSize: "16px 16px",
        }}>
            <Paper elevation={0} sx={{
                display: "flex", flexDirection: "column", alignItems: "center",
                maxWidth: 420, width: "100%", mx: 2, p: 5,
                border: `1px solid ${alpha(theme.palette.divider, 0.12)}`, borderRadius: 2,
            }}>
                <Box component="img" sx={{ height: 28, mb: 2 }} alt="" src={dfLogo} />
                {error ? (
                    <Alert severity="error" sx={{ width: "100%" }}>
                        {t("auth.callbackFailed", { message: error })}
                    </Alert>
                ) : (
                    <>
                        <CircularProgress size={24} sx={{ mb: 2 }} />
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                            {t("auth.completingLogin")}
                        </Typography>
                    </>
                )}
            </Paper>
        </Box>
    );
}
```

在路由中注册回调路径（如使用 React Router）或在 `App.tsx` 中检测 URL path。

### 3.8 登录 / 登出 UI

登录 UI 由 `/api/auth/info` 返回的 `action` 字段驱动（见 3.9.9），
沿用 0.6 `LoginView.tsx` 的居中 Paper 卡片布局和 Fluent 配色。

```typescript
// src/app/AuthButton.tsx — AppBar 中的登录/登出按钮

import { useTranslation } from "react-i18next";

function AuthButton() {
    const { t } = useTranslation();
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const [mgr, setMgr] = useState<UserManager | null>(null);

    useEffect(() => { getUserManager().then(setMgr); }, []);

    if (identity?.type === "user") {
        return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2">
                    {t("auth.connectedAs", { name: identity.displayName || identity.id })}
                </Typography>
                <IconButton
                    onClick={() => mgr?.signoutRedirect()}
                    title={t("auth.signOut")}
                >
                    <LogoutIcon />
                </IconButton>
            </Box>
        );
    }

    if (mgr) {
        return (
            <Button variant="outlined" size="small" onClick={() => mgr.signinRedirect()}>
                {t("auth.signIn")}
            </Button>
        );
    }

    return null;
}
```

#### 3.8a 新增 i18n key

在 `src/i18n/locales/` 的 `en/common.json` 和 `zh/common.json` 的 `auth` 节点下新增（复用 0.6 现有 key，仅补充 OIDC 新增的）：

```json
// en/common.json — auth 节点新增
{
    "auth": {
        "completingLogin": "Completing login...",
        "callbackFailed": "Login callback failed: {{message}}",
        "oidcLogin": "SSO Login",
        "oidcLoggingIn": "Logging in via SSO...",
        "oidcDescription": "Login with your enterprise account via Single Sign-On",
        "sessionExpired": "Session expired. Please sign in again.",
        "silentRenewFailed": "Background token refresh failed. Redirecting to login..."
    }
}
```

```json
// zh/common.json — auth 节点新增
{
    "auth": {
        "completingLogin": "正在完成登录...",
        "callbackFailed": "登录回调失败：{{message}}",
        "oidcLogin": "SSO 单点登录",
        "oidcLoggingIn": "正在通过 SSO 登录...",
        "oidcDescription": "使用企业账号通过单点登录系统认证",
        "sessionExpired": "会话已过期，请重新登录。",
        "silentRenewFailed": "后台令牌刷新失败，正在跳转到登录页..."
    }
}
```

> **说明**：0.6 已有的 `auth.signIn`、`auth.signOut`、`auth.connectedAs`、`auth.continueAsGuest`、
> `auth.guestDescription`、`auth.ssoLogin`、`auth.ssoPopupBlocked` 等 key 原样复用，不重复定义。
> 新增 key 仅覆盖 OIDC PKCE 流程特有的场景（回调页、静默刷新失败等）。

### 3.8b Token 生命周期管理

OIDC access_token 有有限的有效期（通常 5~60 分钟）。前端必须妥善处理 token 过期和刷新，否则用户会在使用过程中突然收到 401 错误。

#### 静默刷新（Silent Renew）

前端 `oidc-client-ts` 配置了 `automaticSilentRenew: true`，会在 token 过期前自动通过 iframe 向 IdP 发起无感刷新：

```
Token 有效期: 3600s (1h)
                    │
    ┌───────────────┼─────────────────┐
    │               │                 │
    0s           3300s (55min)     3600s
    │               │                 │
  签发           自动触发           token
                signinSilent()     过期
                    │
                    ├─ 成功 → 无缝更新 access_token
                    └─ 失败 → 触发重新登录
```

#### 刷新失败的处理

静默刷新可能因以下原因失败：
- IdP session 已过期（用户在 IdP 端登出或 session 超时）
- iframe 被 CSP 策略阻止
- 网络错误

```typescript
// src/app/oidcConfig.ts — 刷新失败处理

const mgr = await getUserManager();
if (mgr) {
    mgr.events.addSilentRenewError(() => {
        console.warn("Silent renew failed, redirecting to login...");
        mgr.signinRedirect();
    });
}
```

#### 后端 401 响应与前端重试

当后端 `OIDCProvider` 检测到过期 token 时，抛出 `AuthenticationError`，`get_identity_id()` 将其转为 `ValueError`，API 层返回 `401`。前端 `fetchWithIdentity` 应拦截 401 并触发 token 刷新：

```typescript
// src/app/utils.tsx — fetchWithIdentity 增强：401 自动重试

export async function fetchWithIdentity(
    url: string | URL,
    options: RequestInit = {}
): Promise<Response> {
    const resp = await _doFetch(url, options);

    if (resp.status === 401) {
        const mgr = await getUserManager();
        if (mgr) {
            try {
                await mgr.signinSilent();
                return _doFetch(url, options);  // 用新 token 重试一次
            } catch {
                mgr.signinRedirect();           // 静默刷新失败，跳转登录
                return resp;
            }
        }
    }

    return resp;
}
```

#### CORS 和 CSP 注意事项

OIDC PKCE 流程涉及跨域交互，生产部署需确保：

| 配置项 | 说明 |
|-------|------|
| **CSP `frame-src`** | 允许 IdP 域名，`signinSilent()` 使用 iframe |
| **CORS** | 如果 DF 前端和后端不同源，后端需配置 `Access-Control-Allow-Origin` |
| **IdP redirect URI** | IdP 侧注册的 callback URL 必须与实际部署域名一致 |
| **HTTPS** | 生产环境必须全链路 HTTPS，否则 cookie / token 可能泄漏 |

#### 设计决策与局限性

**Phase 1 决策：后端不持有 refresh_token，token 刷新完全由前端负责。**

| 项目 | Phase 1 现状 |
|------|-------------|
| **access_token 存储** | 前端 `oidc-client-ts` UserManager 内存中 |
| **refresh_token 存储** | 前端 `oidc-client-ts` 内部管理，不传给后端 |
| **刷新方式** | 前端 `signinSilent()`（iframe 或 refresh_token grant） |
| **后端角色** | 纯无状态验证（每次请求校验 `Authorization: Bearer <access_token>`） |
| **`AuthResult.raw_token`** | 仅存当次请求的 access_token，用于 SSO 透传到下游 API |

**选择此方案的理由：**

1. **架构简单** — 后端无需管理 token 存储、加密、过期清理等有状态逻辑，完全无状态可水平扩展。
2. **安全边界清晰** — refresh_token 不经过 DF 后端，减少了服务端 token 泄漏的攻击面。SPA + PKCE 是 OIDC 推荐的公共客户端模式。
3. **与 Data Formulator 使用场景匹配** — DF 是交互式数据分析工具，用户操作间隔较短（通常不超过 token 有效期），前端静默刷新足以覆盖绝大多数场景。

**已知局限性：**

| 局限 | 影响 | 缓解措施 |
|------|------|---------|
| **长时间后台任务** | 如果 DF 未来支持长时间运行的后台任务（>token 有效期），后端持有的 access_token 会过期，下游 API 调用失败 | 目前不存在此场景；Phase 2 可引入后端 refresh_token 管理 |
| **IdP 不支持静默刷新** | 部分 IdP 禁用 iframe（X-Frame-Options）或不支持 `prompt=none`，导致前端 `signinSilent()` 失败 | 回退到 `signinRedirect()`（重新登录）；或在 IdP 侧配置允许 iframe |
| **短有效期 token + 高频操作** | 如果 IdP 签发的 access_token 有效期极短（<5 分钟），频繁的静默刷新可能产生明显延迟 | 建议 IdP 配置合理的 token 有效期（≥15 分钟） |
| **多标签页 token 同步** | 用户同时打开多个 DF 标签页时，各自独立持有 token，刷新时机不同步 | `oidc-client-ts` 支持 `monitorSession` 跨标签页同步；Phase 2 可评估 |

**Phase 2 可选扩展（仅规划，不在 Phase 1 实现）：**

如果未来出现后端需要长期持有 token 的场景（如后台定时任务、异步数据管道），可考虑：
- 后端 OIDC Confidential Client 模式（使用 `client_secret`），通过 Authorization Code Flow 获取 refresh_token
- 服务端加密存储 refresh_token（可复用 CredentialVault 基础设施）
- `AuthResult` 扩展 `refresh_token` 字段和 `token_expires_at` 时间戳

### 3.9 多协议支持：从 OIDC 扩展到 SAML / LDAP / CAS / 反向代理

#### 3.9.1 为什么不止 OIDC

OIDC 覆盖了大部分现代 IdP（Keycloak、Okta、Auth0、Azure AD、Google），但企业环境中仍广泛存在其他认证协议：

| 协议 | 验证模型 | 典型场景 | access_token 可透传 |
|------|---------|---------|:---:|
| **OAuth 2.0** | 无状态 (access_token per request) | 纯授权场景、旧系统 | **是** — access_token |
| **OIDC** | 无状态 (JWT per request，OAuth2 超集) | 现代 IdP、SaaS | **是** — access_token (同 OAuth2) |
| **Azure EasyAuth** | 无状态 (可信 Header) | Azure App Service | **是** — 通过 `/.auth/me` 获取 |
| **反向代理头** | 无状态 (可信 Header) | Authelia / Authentik / nginx / Traefik | 否 — 无 token |
| **SAML 2.0** | 有状态 (Assertion → Session) | ADFS、Shibboleth、PingFederate、OneLogin | 否 — 但可 Token Exchange 换取 |
| **LDAP / AD** | 有状态 (Bind → Session) | 无中心 IdP 的企业/高校 | 否 — 无 token |
| **CAS** | 有状态 (Ticket → Session) | 高校 (Apereo CAS) | 否 — ticket 一次性 |
| **Kerberos / SPNEGO** | 有状态 (Negotiate → Session) | Windows AD 域环境 | 否 — ticket 绑定特定服务 |

**核心矛盾**：当前 `AuthProvider.authenticate(request)` 假设每个请求自带可验证的凭据（JWT/Header），这对 OIDC 和反向代理头完美适用。但 SAML/LDAP/CAS 需要先完成一个登录流程（浏览器重定向或表单提交），然后用服务端会话（session）识别后续请求。

#### 3.9.2 设计方案：双轨模型（Stateless + Session Gateway）

解决思路是把认证协议分为两类，用不同的机制处理，但最终汇入同一条 AuthProvider 链：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AuthProvider 链 (per-request)                    │
│                                                                     │
│  ┌──────────────┐  ┌──────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Azure        │→ │ OIDC     │→ │ Proxy Header │→ │ Session    │ │
│  │ EasyAuth     │  │ (JWT)    │  │ (可信头)     │  │ (Cookie)   │ │
│  └──────────────┘  └──────────┘  └──────────────┘  └─────┬──────┘ │
│                                                          │        │
│    A类: 无状态                  A类: 无状态               B类       │
│    (每次请求自带凭据)           (每次请求自带凭据)        (查session)│
│                                                          │        │
│  ┌───────────────────────────────────────────────────────┘        │
│  │  Session 中的身份从哪来？ → Login Gateway 在登录时写入          │
│  │                                                                │
│  │  ┌──────────────────────────────────────────────────┐         │
│  │  │           Login Gateway (Flask routes)            │         │
│  │  │                                                    │         │
│  │  │  /api/auth/saml/login  ←→  SAML IdP               │         │
│  │  │  /api/auth/saml/acs    ←   SAML Assertion (POST)   │         │
│  │  │  /api/auth/ldap/login  ←   username + password     │         │
│  │  │  /api/auth/cas/login   ←→  CAS Server              │         │
│  │  │  /api/auth/cas/callback←   CAS ticket              │         │
│  │  │                                                    │         │
│  │  │  验证通过 → session["df_user"] = AuthResult         │         │
│  │  └──────────────────────────────────────────────────┘         │
│  └─────────────────────────────────────────────────────────────── │
│                                                                     │
│  最终 Fallback: Browser UUID                                        │
└─────────────────────────────────────────────────────────────────────┘
```

**A 类 — 无状态 Provider**（现有设计已覆盖）：
- 每个请求自带可独立验证的凭据（JWT Bearer / 可信 Header）
- 直接在 `authenticate(request)` 中完成验证
- 代表：OIDC、Azure EasyAuth、反向代理头

**B 类 — 有状态 Provider**（新增 Login Gateway + SessionProvider）：
- 登录时走协议特定的流程（SAML redirect、LDAP bind、CAS redirect）
- 登录成功后在 Flask session 中存储 `AuthResult`
- 后续请求由通用的 `SessionProvider` 从 session 中读取身份
- 代表：SAML、LDAP、CAS、Kerberos

**核心优势：Login Gateway 是协议特定的，但 SessionProvider 是通用的。** 新增一种有状态协议只需要写一个 Login Gateway blueprint，不需要修改 AuthProvider 链。

#### 3.9.3 ~ 3.9.8 Phase 2+ 扩展（反向代理 / SAML / LDAP / CAS / Login Gateway）

> **以下内容属于 Phase 2+ 规划，此处仅记录架构扩展点，不展开实现细节。**
> 具体实现代码将在需求明确时编写独立的协议扩展文档。

**架构预留的扩展点：**

1. **`AuthResult` 扩展** — 在 Phase 2 引入 `groups`、`auth_protocol`、`token_expiry`、`to_session_dict()` / `from_session_dict()` 等字段和方法，支持会话序列化。
2. **反向代理头 Provider** — A 类无状态，通过 `PROXY_TRUSTED_IPS` 校验可信 IP，从 `X-Forwarded-User` 等 header 提取身份。
3. **SessionProvider** — B 类通用读取端，从 Flask session 中读取 Login Gateway 写入的身份。
4. **Login Gateway Blueprint** — SAML ACS (`/api/auth/saml/acs`)、LDAP bind (`/api/auth/ldap/login`)、CAS ticket 验证 (`/api/auth/cas/callback`) 等协议特定的登录流程。
5. **通用登出** — 清除 session + 返回协议特定的 SLO URL。
6. **Gateway 注册** — `_register_login_gateways(app, provider_name)` 根据 `AUTH_PROVIDER` 值按需注册对应的 Blueprint。

**新增 B 类协议的步骤**：
1. 在 `auth_providers/` 下创建新的 `.py` 文件，实现 `AuthProvider` 子类（自动发现，无需修改注册表）
2. 实现 Login Gateway Blueprint（完成协议特定的登录流程，写入 `session["df_user"]`）
3. 在 Provider 类中实现 `get_auth_info()` 返回前端交互方式

核心代码零修改 — 自动发现机制会扫描到新 Provider，`AUTH_PROVIDER` 环境变量选择激活即可。

#### 3.9.9 前端适配：统一登录入口

前端通过单一的 `/api/auth/info` 端点获取当前认证模式和所需配置，一次请求搞定。

**后端统一认证信息 API — 委托 Provider 自描述（消除 switch 膨胀）：**

```python
# auth.py — 新增

@app.route("/api/auth/info")
def auth_info():
    """返回当前认证模式 + 前端所需的配置信息。
    
    通过调用 Provider 的 get_auth_info() 方法获取 Provider 特定配置，
    而非在此处 switch 每种协议。新增 Provider 无需修改此端点。
    """
    provider_name = os.environ.get("AUTH_PROVIDER", "anonymous").strip().lower()

    info = {
        "provider": provider_name,
        "allow_anonymous": _allow_anonymous,
    }

    if _provider:
        info.update(_provider.get_auth_info())
    else:
        info["action"] = "none"

    return jsonify(info)
```

每个 Provider 通过实现 `get_auth_info()` 声明前端交互方式（详见 3.2 节基类定义）。例如：
- `OIDCProvider.get_auth_info()` 返回 `{"action": "frontend", "oidc": {...}}`
- `GitHubOAuthProvider.get_auth_info()` 返回 `{"action": "redirect", "url": "/api/auth/github/login"}`
- `AzureEasyAuthProvider.get_auth_info()` 返回 `{"action": "transparent"}`

新增 Provider 只需在自己的类中实现此方法，`auth.py` 无需任何修改。

**前端统一登录组件：**

沿用 0.6 `LoginView.tsx` 的 Paper 居中卡片布局、Fluent 配色和 i18n 模式。
所有用户可见文本通过 `t('auth.*')` 获取，不硬编码任何语言。

```typescript
// src/app/LoginPanel.tsx — 根据 /api/auth/info 渲染对应的登录 UI

import React, { FC, useEffect, useState } from "react";
import {
    Box, Button, TextField, Typography, Divider,
    CircularProgress, Alert, Paper, alpha, useTheme,
} from "@mui/material";
import LoginIcon from "@mui/icons-material/Login";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import { useTranslation } from "react-i18next";
import { getUserManager } from "./oidcConfig";
import dfLogo from "../assets/df-logo.png";
import { toolName } from "./App";

interface AuthInfo {
    provider: string;
    allow_anonymous: boolean;
    action: "frontend" | "redirect" | "form" | "transparent" | "none";
    label?: string;
    url?: string;
    fields?: string[];
    oidc?: { authority: string; clientId: string; redirectUri: string; scopes: string };
}

interface LoginPanelProps {
    onGuestContinue: () => void;
}

export const LoginPanel: FC<LoginPanelProps> = ({ onGuestContinue }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
    const [formData, setFormData] = useState({ username: "", password: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/auth/info").then(r => r.json()).then(setAuthInfo).catch(() => null);
    }, []);

    if (!authInfo) return null;
    if (authInfo.action === "none" || authInfo.action === "transparent") return null;

    const renderAuthAction = () => {
        switch (authInfo.action) {
            case "frontend":
                return (
                    <>
                        <Button
                            variant="contained"
                            color="primary"
                            disabled={loading}
                            onClick={async () => {
                                setLoading(true);
                                const mgr = await getUserManager();
                                mgr?.signinRedirect();
                            }}
                            startIcon={loading
                                ? <CircularProgress size={16} color="inherit" />
                                : <OpenInNewIcon />}
                            sx={{ textTransform: "none" }}
                            fullWidth
                        >
                            {loading ? t("auth.oidcLoggingIn") : t("auth.oidcLogin")}
                        </Button>
                        <Typography variant="caption" sx={{ color: "text.secondary", mt: 1, textAlign: "center" }}>
                            {t("auth.oidcDescription")}
                        </Typography>
                    </>
                );

            case "redirect":
                return (
                    <>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => { window.location.href = authInfo.url!; }}
                            startIcon={<OpenInNewIcon />}
                            sx={{ textTransform: "none" }}
                            fullWidth
                        >
                            {authInfo.label || t("auth.ssoLogin")}
                        </Button>
                        <Typography variant="caption" sx={{ color: "text.secondary", mt: 1, textAlign: "center" }}>
                            {t("auth.ssoDescription")}
                        </Typography>
                    </>
                );

            case "form":
                return (
                    <Box
                        component="form"
                        onSubmit={async (e: React.FormEvent) => {
                            e.preventDefault();
                            if (!formData.username || !formData.password) return;
                            setLoading(true);
                            setError(null);
                            try {
                                const resp = await fetch(authInfo.url!, {
                                    method: "POST",
                                    credentials: "include",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify(formData),
                                });
                                const data = await resp.json();
                                if (resp.ok && data.status === "ok") {
                                    window.location.reload();
                                } else {
                                    setError(data.message || t("auth.loginFailed", { message: "Unknown error" }));
                                }
                            } catch (err: any) {
                                setError(err.message || "Network error");
                            } finally {
                                setLoading(false);
                            }
                        }}
                        sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}
                    >
                        <TextField
                            size="small"
                            label={t("auth.username")}
                            value={formData.username}
                            onChange={e => setFormData(f => ({ ...f, username: e.target.value }))}
                            autoComplete="username"
                            autoFocus
                            fullWidth
                        />
                        <TextField
                            size="small"
                            label={t("auth.password")}
                            type="password"
                            value={formData.password}
                            onChange={e => setFormData(f => ({ ...f, password: e.target.value }))}
                            autoComplete="current-password"
                            fullWidth
                        />
                        <Button
                            type="submit"
                            variant="contained"
                            color="primary"
                            disabled={loading || !formData.username || !formData.password}
                            startIcon={loading
                                ? <CircularProgress size={16} color="inherit" />
                                : <LoginIcon />}
                            sx={{ textTransform: "none" }}
                            fullWidth
                        >
                            {loading ? t("auth.signingIn") : t("auth.signIn")}
                        </Button>
                    </Box>
                );

            default:
                return null;
        }
    };

    return (
        <Box sx={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            width: "100%", height: "100%", overflowY: "auto",
            background: `
                linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px),
                linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px)
            `,
            backgroundSize: "16px 16px",
        }}>
            <Paper elevation={0} sx={{
                display: "flex", flexDirection: "column", alignItems: "center",
                maxWidth: 420, width: "100%", mx: 2, p: 5,
                border: `1px solid ${alpha(theme.palette.divider, 0.12)}`, borderRadius: 2,
            }}>
                <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <Box component="img" sx={{ height: 28, mr: 1 }} alt="" src={dfLogo} />
                    <Typography component="h1" sx={{ fontWeight: 300, letterSpacing: "0.03em", fontSize: 22 }}>
                        {toolName}
                    </Typography>
                </Box>

                <Typography variant="body2" sx={{ color: "text.secondary", mb: 3, textAlign: "center" }}>
                    {t("auth.loginSubtitle")}
                </Typography>

                {error && (
                    <Alert severity="error" sx={{ fontSize: 13, width: "100%", mb: 1 }}>
                        {t("auth.loginFailed", { message: error })}
                    </Alert>
                )}

                {renderAuthAction()}

                {authInfo.allow_anonymous && (
                    <>
                        <Divider sx={{ my: 3, width: "100%" }}>
                            <Typography variant="body2" sx={{ color: "text.secondary", px: 1 }}>
                                {t("auth.or")}
                            </Typography>
                        </Divider>

                        <Button
                            variant="outlined"
                            color="primary"
                            onClick={onGuestContinue}
                            startIcon={<PersonOutlineIcon />}
                            sx={{ textTransform: "none" }}
                            fullWidth
                        >
                            {t("auth.continueAsGuest")}
                        </Button>
                        <Typography variant="caption" sx={{ color: "text.secondary", mt: 1, textAlign: "center" }}>
                            {t("auth.guestDescription")}
                        </Typography>
                    </>
                )}
            </Paper>
        </Box>
    );
};
```

> **说明**：组件中所有用户可见文本均通过 `t('auth.*')` 获取。
> 复用的 0.6 已有 key：`auth.loginSubtitle`、`auth.username`、`auth.password`、`auth.signIn`、
> `auth.signingIn`、`auth.loginFailed`、`auth.or`、`auth.continueAsGuest`、`auth.guestDescription`、
> `auth.ssoLogin`、`auth.ssoDescription`。
> 0.7 新增 key（已在 3.8a 中定义）：`auth.oidcLogin`、`auth.oidcLoggingIn`、`auth.oidcDescription`。

**前端 `initAuth` — 纯 action 驱动（不按 provider 名称分支）：**

前端**只看 `action` 字段**，完全不看 `provider` 名称。这样新增 Provider 只要
复用已有的 action 类型，前端就不用改。

```typescript
// src/app/App.tsx — initAuth：纯 action 驱动，零 provider 分支

useEffect(() => {
    async function initAuth() {
        const authInfo = await fetch("/api/auth/info").then(r => r.json()).catch(() => null);
        if (!authInfo) { setAuthChecked(true); return; }

        switch (authInfo.action) {
            case "frontend": {
                // 前端管理的认证流程（OIDC PKCE 等）
                // authInfo 中携带了所需配置（如 oidc.authority, oidc.clientId）
                const mgr = await getUserManager();
                if (mgr) {
                    let user = await mgr.getUser();
                    if (!user || user.expired) {
                        try { user = await mgr.signinSilent(); } catch { user = null; }
                    }
                    if (user) {
                        setUserInfo({ name: user.profile.name || "", userId: user.profile.sub });
                        setAuthChecked(true);
                        return;
                    }
                }
                break;
            }

            case "transparent": {
                // 平台已完成认证（Azure EasyAuth、反向代理等），查询身份即可
                try {
                    const resp = await fetch("/api/auth/whoami");
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.user_id) {
                            setUserInfo({ name: data.display_name || "", userId: data.user_id });
                            setAuthChecked(true);
                            return;
                        }
                    }
                } catch { /* 未认证 */ }
                break;
            }

            case "redirect":
            case "form": {
                // 服务端管理的认证（GitHub OAuth、SAML、LDAP、CAS 等）
                // 用户尚未登录时由 LoginPanel 渲染按钮/表单，已登录则从 session 读取
                try {
                    const resp = await fetch("/api/auth/whoami");
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.user_id) {
                            setUserInfo({ name: data.display_name || "", userId: data.user_id });
                            setAuthChecked(true);
                            return;
                        }
                    }
                } catch { /* 未登录 */ }
                break;
            }

            case "none":
            default:
                break;
        }

        // 匿名模式（或 SSO 未登录 + 允许匿名）
        setAuthChecked(true);
    }
    initAuth();
}, []);
```

**关键设计约束**：`initAuth` 中没有任何 `authInfo.provider === "xxx"` 的判断。
新增一个 Provider（如 SAML）时，只要其 `get_auth_info()` 返回已有的 action 类型
（如 `"redirect"`），前端代码零修改。

**后端 `/api/auth/whoami` 端点：**

```python
# auth.py — 新增

@app.route("/api/auth/whoami")
def whoami():
    """返回当前 session 中的用户信息（如有）。"""
    user_data = session.get("df_user")
    if user_data:
        return jsonify({
            "user_id": user_data.get("user_id"),
            "display_name": user_data.get("display_name"),
            "email": user_data.get("email"),
        })
    return jsonify({}), 401
```

#### 3.9.10 AuthProvider 模型图

单一 Provider + 匿名回退的认证模型：

```
AUTH_PROVIDER=oidc (由管理员选一种)

  ┌──────────────────────┐     ┌──────────────┐
  │ 主 Provider           │     │ Browser UUID │
  │ (OIDC / GitHub /     │ ──→ │ (匿名回退)   │
  │  Azure / SAML / LDAP │ 未命中│              │
  │  / CAS / proxy_header)│     │ 仅在          │
  │                       │     │ ALLOW_ANONYMOUS│
  │  A类: 每次请求验证     │     │ =true 时生效  │
  │  B类: 从 session 读取  │     └──────────────┘
  └───────────┬───────────┘
              │
    B 类的 session 来自:
    ┌────────────────┐
    │ Login Gateway  │
    │ ├── GitHub OAuth│
    │ ├── SAML ACS   │
    │ ├── LDAP login  │
    │ └── CAS callback│
    └────────────────┘
```

#### 3.9.11 SSO Token 透传的协议差异

不同协议对 "token 透传到下游数据源" 的支持差异很大。关键区分点是 **协议是否产出一个可作为 Bearer token 的 access_token**：

> **OIDC 与 OAuth2 的关系**：OIDC 是 OAuth2 的超集（OIDC = OAuth2 + 身份层）。
> OIDC 在 OAuth2 的 access_token 之上额外给出一个 id_token (JWT) 以标识"谁在用"。
> **透传给下游 API 的始终是 OAuth2 的 access_token**，与 OIDC 的 id_token 无关。
> 因此只要是基于 OAuth2 的流程（无论是否带 OIDC），access_token 都可以透传。

| 协议 | 产出物 | 能否透传 | 说明 |
|------|--------|:---:|------|
| **OAuth 2.0 / OIDC** | access_token（opaque 或 JWT） | **能** | `AuthResult.raw_token` 存储 access_token，直接作为下游 API 的 Bearer token |
| **Azure EasyAuth** | 平台托管的 token | **能** | 通过 `/.auth/me` 或 `X-MS-TOKEN-*` 头获取 access_token；本质仍是 OAuth2 |
| **反向代理头** | 无 token（仅 header） | **不能** | 代理已消费了原始 token，DF 只拿到用户名等纯文本 header |
| **SAML 2.0** | XML Assertion | **不能直接用** | Assertion 是 XML 格式且有 Audience 限制；但可通过 RFC 8693 Token Exchange 或 SAML Bearer Assertion Grant (RFC 7522) 向 IdP 换取 OAuth2 access_token |
| **LDAP / AD** | 无（仅验证密码） | **不能** | 没有任何 token 产出 |
| **CAS** | Service Ticket（一次性） | **不能** | Ticket 验证后即失效，不可复用 |
| **Kerberos** | Service Ticket | **不能直接用** | Kerberos ticket 绑定到特定服务，无法代用；但 Windows 域中 Kerberos → OAuth2 的桥接方案存在 |

**设计应对**：

- **OAuth2/OIDC 用户**：`AuthResult.raw_token` 持有 access_token，DataSourcePlugin 和 DataLoader 可直接用它调用共享同一 IdP 的下游 API（零额外登录）。
- **SAML 用户（高级）**：如果 IdP 同时支持 OAuth2（如 ADFS、PingFederate 通常都支持），可在 Login Gateway 中用 SAML Assertion 通过 Token Exchange 换取 OAuth2 access_token，再存入 `AuthResult.raw_token`，从而获得透传能力。这种情况下建议直接走 OIDC 而非 SAML。
- **LDAP / CAS / 反向代理头用户**：需要走 CredentialVault 路线 —— 用户手动配置下游数据源的凭证（或 API Key），由 CredentialVault 加密存储后供 Plugin 使用。

这也是为什么 **Layer 3 CredentialVault 是整个架构不可缺少的一层** —— 它为无法 token 透传的认证协议提供了凭证存储的兜底方案。同时这也说明 **OIDC 是首选协议**（P0 优先级），因为它是唯一能同时解决"身份识别"和"下游透传"两个问题的方案。

#### 3.9.12 协议选择指南

为方便运维人员选择，提供以下决策树：

```
你的组织使用什么身份系统？
  │
  ├─ Azure AD / Entra ID
  │   ├─ 部署在 Azure App Service？ → 用 azure_easyauth (零配置)
  │   └─ 其他部署 → 用 oidc (Azure AD 支持 OIDC)
  │
  ├─ Keycloak / Okta / Auth0 / Google Workspace → 用 oidc
  │
  ├─ ADFS / Shibboleth / PingFederate (仅 SAML)
  │   ├─ 能配 OIDC 吗？ → 优先 oidc (ADFS/Ping 一般都支持)
  │   └─ 只有 SAML → 用 saml (session 模式)
  │
  ├─ IC 卡 / 智能卡 / PKI 证书
  │   ├─ IdP 能签发 OAuth2 token？ → 用 oidc/saml + Token Exchange (未来扩展，见 3.9.12)
  │   └─ 否 → 暂不支持，建议升级 IdP 或使用 API Key + CredentialVault
  │
  ├─ Authelia / Authentik / nginx / Traefik (反向代理已认证)
  │   └─ 用 proxy_header
  │
  ├─ 只有 LDAP / Active Directory (无 SSO 中心)
  │   └─ 用 ldap (session 模式)
  │
  ├─ CAS (高校)
  │   └─ 用 cas (session 模式)
  │
  └─ 无任何身份系统
      └─ 默认 Browser UUID (匿名模式)
```

#### 3.9.13 新增依赖说明

各协议的 Python 依赖作为 **可选依赖** 安装，基础安装不引入：

```toml
# pyproject.toml — optional dependencies
[project.optional-dependencies]
oidc = ["PyJWT>=2.8", "cryptography>=41.0"]
saml = ["python3-saml>=1.16"]
ldap = ["ldap3>=2.9"]
cas  = []  # 纯标准库实现，无额外依赖

# 快捷安装全部认证协议
auth-all = ["PyJWT>=2.8", "cryptography>=41.0", "python3-saml>=1.16", "ldap3>=2.9"]
```

#### 3.9.14 优先级建议

| 优先级 | 协议 | 理由 |
|:---:|------|------|
| **P0** | OIDC | 覆盖面最广，现代 IdP 基本都支持，且是唯一支持 token 透传的协议 |
| **P0** | Browser UUID | 保持向后兼容的匿名模式 |
| **P1** | 反向代理头 | 自建部署最常见的方式，实现简单 |
| **P1** | LDAP | 覆盖没有 SSO 中心的传统企业/高校 |
| **P2** | SAML | 大型企业有时只提供 SAML，但 ADFS/PingFederate 通常也支持 OIDC |
| **P3** | CAS | 受众窄（主要是高校），需求出现时再实现 |

---

## 4. Layer 2：数据源插件系统 (DataSourcePlugin)

### 4.1 设计思路

BI 报表系统（Superset、Metabase、Power BI 等）的集成需求远超现有 `ExternalDataLoader` 的能力：

| 能力 | ExternalDataLoader | BI 系统需要 |
|------|:--:|:--:|
| 连接参数 | 简单 key-value 表单 | URL + 认证流程 (JWT/OAuth/SSO) |
| 数据浏览 | `list_tables()` → 表名列表 | 数据集 + 仪表盘 + 报表 + 筛选条件 |
| 权限模型 | 无 (用数据库账号的权限) | 需尊重 BI 系统自身的 RBAC/RLS |
| 前端 UI | 通用字段表单 | 需要专用目录浏览、搜索、筛选等交互 |
| 独立 API 路由 | 无 | 需要注册 Blueprint |

因此，BI 系统使用独立的 **DataSourcePlugin** 机制，与 `ExternalDataLoader` **并行存在**。

### 4.2 Plugin 基类

```python
# py-src/data_formulator/plugins/base.py

from abc import ABC, abstractmethod
from typing import Any, Optional
from flask import Blueprint


class DataSourcePlugin(ABC):
    """外部数据源插件基类。
    
    每个插件实现以下契约：
    1. manifest()           — 自我描述（ID、名称、配置需求）
    2. create_blueprint()   — Flask 路由（认证 + 目录 + 数据拉取）
    3. get_frontend_config() — 传给前端的非敏感配置
    4. on_enable() / on_disable() — 生命周期钩子
    """

    @staticmethod
    @abstractmethod
    def manifest() -> dict[str, Any]:
        """插件元数据。
        
        Returns:
            {
                "id": "superset",
                "name": "Apache Superset",
                "icon": "superset",
                "description": "从 Superset 加载数据集和仪表盘数据",
                "version": "1.0.0",
                "env_prefix": "PLG_SUPERSET",
                "required_env": ["PLG_SUPERSET_URL"],
                "optional_env": ["PLG_SUPERSET_TIMEOUT"],
                "auth_modes": ["sso", "jwt", "password"],
                "capabilities": ["datasets", "dashboards", "filters"],
            }
        """
        ...

    @abstractmethod
    def create_blueprint(self) -> Blueprint:
        """创建 Flask Blueprint。
        
        路由前缀: /api/plugins/<plugin_id>/
        示例路由:
            /api/plugins/superset/auth/login
            /api/plugins/superset/auth/status
            /api/plugins/superset/catalog/datasets
            /api/plugins/superset/data/load-dataset
        """
        ...

    @abstractmethod
    def get_frontend_config(self) -> dict[str, Any]:
        """返回传给前端的配置（不包含敏感信息）。
        
        Returns:
            {
                "auth_modes": ["sso", "jwt", "password"],
                "sso_login_url": "http://superset:8088/df-sso-bridge/",
                "capabilities": ["datasets", "dashboards", "filters"],
            }
        """
        ...

    def on_enable(self, app) -> None:
        """插件启用时调用。可初始化连接池、缓存等。"""
        pass

    def on_disable(self) -> None:
        """插件禁用时调用。"""
        pass

    def get_auth_status(self, session: dict) -> Optional[dict[str, Any]]:
        """返回当前用户在此插件中的认证状态。
        
        Returns:
            {"authenticated": True, "user": "john", ...} 或 None
        """
        return None

    def supports_sso_passthrough(self) -> bool:
        """此插件是否支持 SSO token 透传。
        
        如果返回 True，插件可以从 auth.get_sso_token() 获取用户的
        OIDC access token，直接用于调用外部系统 API。
        """
        return False
```

### 4.3 插件与 SSO 的集成模式

每个插件可以支持多种认证方式，根据部署环境自动选择：

```
┌──────────────────────────────────────────────────────────────────┐
│                    插件认证模式选择                                  │
│                                                                   │
│  场景 A: DF 有 SSO + 外部系统也接了同一 IdP                        │
│  ─────────────────────────────────────────                        │
│  → 自动使用 SSO Token 透传                                        │
│  → 用户无需额外登录                                               │
│  → 外部系统通过 token 识别用户，应用自身 RBAC                      │
│                                                                   │
│  场景 B: DF 有 SSO + 外部系统没有接 SSO                            │
│  ─────────────────────────────────────                            │
│  → 首次使用时，用户在插件 UI 中输入外部系统的账号/密码/API Key      │
│  → 凭证存入 CredentialVault（按 SSO user_id 关联）                 │
│  → 后续自动从 Vault 取出，无需重复输入                              │
│  → 换设备后只要 SSO 登录，凭证自动可用                              │
│                                                                   │
│  场景 C: DF 无 SSO（本地匿名模式）                                 │
│  ──────────────────────────────                                   │
│  → 用户在插件 UI 中输入外部系统的账号密码                           │
│  → Token 存在 Flask Session 中（仅当次会话有效）                    │
│  → 行为与 0.6 版本一致                                             │
└──────────────────────────────────────────────────────────────────┘
```

插件内部的认证路由应检查这三种模式：

```python
# 插件认证路由模板

@bp.route("/auth/login", methods=["POST"])
def plugin_login():
    """处理插件认证。自动选择最佳模式。"""
    
    # 模式 1: SSO Token 透传
    sso_token = get_sso_token()
    if sso_token and plugin.supports_sso_passthrough():
        # 用 SSO token 直接调用外部系统的 token exchange / introspection
        external_token = exchange_sso_token(sso_token)
        if external_token:
            store_plugin_session(plugin_id, external_token)
            return jsonify({"status": "ok", "auth_mode": "sso"})
    
    # 模式 2: 从 Credential Vault 取已存储的凭证
    vault = get_credential_vault()
    identity = get_identity_id()
    stored = vault.retrieve(identity, plugin_id) if vault else None
    if stored:
        external_token = authenticate_with_stored_credentials(stored)
        if external_token:
            store_plugin_session(plugin_id, external_token)
            return jsonify({"status": "ok", "auth_mode": "vault"})
    
    # 模式 3: 用户手动输入
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    if username and password:
        external_token = authenticate_with_credentials(username, password)
        # 可选：存入 Vault 以便下次自动使用
        if vault and data.get("remember", True):
            vault.store(identity, plugin_id, {"username": username, "password": password})
        store_plugin_session(plugin_id, external_token)
        return jsonify({"status": "ok", "auth_mode": "credentials"})
    
    return jsonify({"status": "needs_login", "available_modes": get_available_modes()})
```

### 4.4 插件注册与发现

#### 4.4.1 注册机制方案选型

新增一个数据源插件时，注册表是否需要改代码？有三种方案：

| 方案 | 新增插件要改代码吗 | 复杂度 | 安全性 | 适合场景 |
|------|:---:|:---:|:---:|------|
| **A. 硬编码列表** | 要，改注册表一行 | 最低 | 最高（只加载白名单） | 插件由同一团队开发，随主项目发布 |
| **B. 目录自动扫描** | 不要，放进目录就生效 | 低 | 中（需约定和校验） | 插件持续增加，希望"拖入即用" |
| **C. setuptools entry_points** | 不要，`pip install` 后自动注册 | 中 | 中 | 插件作为独立 pip 包发布 |

**方案 A（硬编码列表）** 是现有 `ExternalDataLoader` 的做法（`_LOADER_SPECS` 列表），也是 0.7 系统的成熟模式。优点是简单透明，缺点是每加一个插件都要改 `__init__.py`。

**方案 C（entry_points）** 适合有第三方插件生态的平台（如 pytest、Flask 扩展），对当前项目来说过于重型，且前端部分无法通过 pip 安装（仍需编译到主 bundle）。

**选择方案 B（目录自动扫描）** — 理由：

1. **插件会持续增长** — 未来对接的报表系统只会越来越多，每次加一个都改注册表是无意义的样板修改
2. **插件都是内部开发** — 不需要跨包的 entry_points 机制
3. **manifest 自描述** — 插件的 ID、必需环境变量等信息已经在 `manifest()` 中声明，不需要在注册表中重复
4. **安全保底** — 通过 `PLUGIN_BLOCKLIST` 环境变量提供黑名单能力

> **统一范式**：AuthProvider 与 DataSourcePlugin 采用相同的目录自动扫描机制。
> 区别仅在于激活策略 — 认证是**单选**的（`AUTH_PROVIDER` 环境变量指定唯一活跃 Provider），
> DataSourcePlugin 是**并行**的（所有已发现的插件同时存在）。详见 4.4.8 对比表。

#### 4.4.2 插件约定

每个插件是 `plugins/` 目录下的一个 Python 子包，必须满足以下约定：

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

框架通过 `plugin_class` 变量找到插件类，再调用 `plugin_class.manifest()` 获取自描述信息（ID、必需环境变量等）。不需要在任何注册表中手动登记。

#### 4.4.3 自动扫描实现

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
            _log.info(
                "Plugin '%s' disabled: missing env %s",
                plugin_id, ", ".join(missing_env),
            )
            continue

        # 实例化、注册 Blueprint、启用
        try:
            plugin: DataSourcePlugin = plugin_cls()
            bp = plugin.create_blueprint()
            app.register_blueprint(bp)
            plugin.on_enable(app)

            ENABLED_PLUGINS[plugin_id] = plugin
            _log.info(
                "Plugin '%s' enabled (auto-discovered from plugins/%s/)",
                plugin_id, pkg_name,
            )
        except Exception as exc:
            DISABLED_PLUGINS[plugin_id] = str(exc)
            _log.error(
                "Plugin '%s' failed to initialize: %s",
                plugin_id, exc, exc_info=True,
            )
```

#### 4.4.4 发现流程图

```
plugins/
├── __init__.py          ← discover_and_register() 在这里
├── base.py              ← DataSourcePlugin 基类 (ispkg=False, 跳过)
├── data_writer.py       ← 工具模块 (ispkg=False, 跳过)
├── superset/            ← ispkg=True
│   └── __init__.py      → plugin_class = SupersetPlugin
│                          → manifest(): required_env=["PLG_SUPERSET_URL"]
│                          → os.environ["PLG_SUPERSET_URL"] 存在? 
│                            → 是 → 实例化 → 注册 Blueprint → ENABLED ✅
│                            → 否 → DISABLED (Not configured)
├── metabase/            ← ispkg=True
│   └── __init__.py      → plugin_class = MetabasePlugin
│                          → manifest(): required_env=["PLG_METABASE_URL"]
│                          → os.environ["PLG_METABASE_URL"] 不存在
│                            → DISABLED (Not configured)
└── _helpers/            ← ispkg=True, 但无 plugin_class → 静默跳过
    └── __init__.py      → (没有 plugin_class 变量)
```

#### 4.4.5 新增插件的完整步骤

以新增一个 Grafana 插件为例：

**步骤 1**：创建插件目录和代码

```
plugins/grafana/
├── __init__.py          # plugin_class = GrafanaPlugin
├── plugin.py            # GrafanaPlugin(DataSourcePlugin) 实现
├── grafana_client.py    # Grafana REST API 封装
└── routes/
    ├── auth.py          # /api/plugins/grafana/auth/*
    ├── catalog.py       # /api/plugins/grafana/catalog/*
    └── data.py          # /api/plugins/grafana/data/*
```

**步骤 2**：在 `.env` 中设置环境变量

```bash
PLG_GRAFANA_URL=http://grafana.example.com:3000
```

**步骤 3**：重启服务

```
  Loading data source plugins...
  Plugin 'grafana' enabled (auto-discovered from plugins/grafana/)
```

**核心代码改动：0 行。** 不需要修改 `__init__.py`、`app.py` 或任何其他文件。

#### 4.4.6 安全措施

| 措施 | 说明 |
|------|------|
| **类型校验** | `plugin_class` 必须是 `DataSourcePlugin` 的子类，否则跳过 |
| **环境变量门控** | `required_env` 中的变量缺失则不启用，防止未配置的插件意外加载 |
| **显式黑名单** | `PLUGIN_BLOCKLIST=powerbi,grafana` 可以禁用特定插件 |
| **Blueprint 前缀隔离** | 插件路由强制在 `/api/plugins/<id>/` 下，无法覆盖核心路由 |
| **错误隔离** | 单个插件加载失败不影响其他插件和核心系统 |

#### 4.4.7 前端的对应扫描机制

前端由于 Vite/Webpack 的编译时限制，无法做到运行时自动扫描。但可以用 **Vite 的 `import.meta.glob`** 实现编译时自动发现：

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

这样前端也做到了"创建 `src/plugins/grafana/index.ts` 即自动纳入编译"，不需要手动维护 `pluginLoaders` 映射表。

> **后端自动扫描 + 前端 `import.meta.glob` = 全栈零注册新增插件。**

#### 4.4.8 与 AuthProvider 注册机制的对比

| 维度 | DataSourcePlugin | AuthProvider |
|------|-----------------|-------------|
| 协作模式 | 并行（所有插件同时存在） | 单选（同一时间只有一个主 Provider） |
| 注册方式 | `plugins/` 目录自动扫描 | `auth_providers/` 目录自动扫描 |
| 激活方式 | 所有已发现的插件同时启用 | `AUTH_PROVIDER` 环境变量**单选**激活一个 |
| 新增方式 | 在 `plugins/` 下创建目录即可 | 在 `auth_providers/` 下创建 `.py` 即可 |
| 安全控制 | `PLUGIN_BLOCKLIST` 黑名单 | 仅被选中的 Provider 执行 `on_configure()` |

**统一的设计哲学**：发现与激活分离 — 两者都通过目录扫描自动发现，但激活策略不同（插件全量启用，Provider 单选启用）。新增组件时核心代码零修改。

### 4.5 插件数据写入工具

插件从外部系统拉取到数据后，通过 `PluginDataWriter` 写入 Workspace：

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
    """插件专用的数据写入工具。"""

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
        """将 DataFrame 写入当前用户的 Workspace。"""
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

        meta = workspace.write_parquet(df, final_name, loader_metadata=loader_metadata)

        logger.info(
            "Plugin '%s' wrote '%s': %d rows, %d cols",
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
        """将 Arrow Table 写入 Workspace（跳过 pandas 转换，更高效）。"""
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

        meta = workspace.write_parquet_from_arrow(table, final_name, loader_metadata=loader_metadata)

        return {
            "table_name": meta.name,
            "row_count": meta.row_count,
            "columns": [c.name for c in (meta.columns or [])],
            "is_renamed": is_renamed,
        }
```

### 4.6 前端插件接口

```typescript
// src/plugins/types.ts

export interface PluginManifest {
    id: string;
    name: string;
    icon: string;
    description: string;
    authModes: Array<"sso" | "jwt" | "password" | "api_key" | "none">;
    capabilities: string[];
}

// PluginPanelProps、DataProvenance、DataSourcePluginModule 的完整定义
// 见 1-data-source-plugin-architecture.md § 7.1
//
// 要点：
//   - 前端组件不接收 ssoToken prop。SSO token 由插件后端通过
//     auth.get_sso_token() 从 Flask session 获取，前端无需感知。
//   - onDataLoaded 回调必须包含 DataProvenance（数据溯源），
//     以支持"用同样的参数刷新"和 UI 显示数据来源。
//   - onPreviewLoaded（可选）支持"先预览再加载"的交互。
//   - LoginComponent 不接收 ssoToken，认证流程走插件自身后端。
```

前端插件注册使用 `import.meta.glob` 自动扫描（详见 4.4.7 节），此处不再重复。新增插件只需在 `src/plugins/` 下创建子目录并导出 `index.ts`，无需手动维护注册表。

---

## 5. Layer 3：凭证保险箱 (CredentialVault)

### 5.1 设计思路

用户连接未接 SSO 的外部系统时，需要输入该系统的账号密码。这些凭证应该：

| 需求 | 现状 (0.7) | 目标 |
|------|-----------|------|
| 持久化 | 浏览器 IndexedDB (redux-persist)，换浏览器丢失 | 服务端加密存储，跟随用户身份 |
| 安全性 | 前端明文存储 | 服务端 Fernet 对称加密 |
| 跨设备 | 不支持 | SSO 登录后自动可用 |
| 按用户隔离 | 基于 browser UUID | 基于 SSO user_id 或 browser UUID |

### 5.2 CredentialVault 接口

```python
# py-src/data_formulator/credential_vault/base.py

from abc import ABC, abstractmethod
from typing import Optional


class CredentialVault(ABC):
    """凭证保险箱抽象接口。
    
    按 (user_identity, source_key) 二元组存取加密凭证。
    - user_identity: 来自 auth.get_identity_id()，如 "user:alice@corp.com"
    - source_key: 外部系统标识，如 "superset"、"metabase-prod"
    """

    @abstractmethod
    def store(self, user_id: str, source_key: str, credentials: dict) -> None:
        """存储凭证。已存在则覆盖。"""
        ...

    @abstractmethod
    def retrieve(self, user_id: str, source_key: str) -> Optional[dict]:
        """取出凭证。不存在返回 None。"""
        ...

    @abstractmethod
    def delete(self, user_id: str, source_key: str) -> None:
        """删除凭证。"""
        ...

    @abstractmethod
    def list_sources(self, user_id: str) -> list[str]:
        """列出该用户所有已存储凭证的 source_key。"""
        ...
```

### 5.3 本地加密实现

```python
# py-src/data_formulator/credential_vault/local_vault.py

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet

from .base import CredentialVault

logger = logging.getLogger(__name__)


class LocalCredentialVault(CredentialVault):
    """基于 SQLite + Fernet 的本地加密凭证存储。
    
    存储位置: DATA_FORMULATOR_HOME/credentials.db
    加密密钥: CREDENTIAL_VAULT_KEY 环境变量 (Fernet key)
    
    生成密钥:
        python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    """

    def __init__(self, db_path: str | Path, encryption_key: str):
        self._db_path = str(db_path)
        self._fernet = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self._db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS credentials (
                    user_id TEXT NOT NULL,
                    source_key TEXT NOT NULL,
                    encrypted_data BLOB NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, source_key)
                )
            """)

    def store(self, user_id: str, source_key: str, credentials: dict) -> None:
        encrypted = self._fernet.encrypt(json.dumps(credentials).encode("utf-8"))
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO credentials (user_id, source_key, encrypted_data, updated_at) "
                "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (user_id, source_key, encrypted),
            )
        logger.debug("Stored credentials for %s / %s", user_id[:16], source_key)

    def retrieve(self, user_id: str, source_key: str) -> Optional[dict]:
        with sqlite3.connect(self._db_path) as conn:
            row = conn.execute(
                "SELECT encrypted_data FROM credentials WHERE user_id = ? AND source_key = ?",
                (user_id, source_key),
            ).fetchone()
        if not row:
            return None
        try:
            decrypted = self._fernet.decrypt(row[0])
            return json.loads(decrypted.decode("utf-8"))
        except Exception as e:
            logger.warning("Failed to decrypt credentials for %s / %s: %s", user_id[:16], source_key, e)
            return None

    def delete(self, user_id: str, source_key: str) -> None:
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "DELETE FROM credentials WHERE user_id = ? AND source_key = ?",
                (user_id, source_key),
            )

    def list_sources(self, user_id: str) -> list[str]:
        with sqlite3.connect(self._db_path) as conn:
            rows = conn.execute(
                "SELECT source_key FROM credentials WHERE user_id = ?",
                (user_id,),
            ).fetchall()
        return [r[0] for r in rows]
```

### 5.4 Vault 工厂

```python
# py-src/data_formulator/credential_vault/__init__.py

import os
import logging
from typing import Optional

from .base import CredentialVault

logger = logging.getLogger(__name__)

_vault: Optional[CredentialVault] = None
_initialized = False


def get_credential_vault() -> Optional[CredentialVault]:
    """获取全局 CredentialVault 实例。
    
    返回 None 表示 Vault 未配置（CREDENTIAL_VAULT_KEY 未设置）。
    此时插件应回退到仅 Session 级别的凭证存储。
    """
    global _vault, _initialized
    if _initialized:
        return _vault

    _initialized = True
    key = os.environ.get("CREDENTIAL_VAULT_KEY", "").strip()
    if not key:
        logger.info("Credential vault not configured (CREDENTIAL_VAULT_KEY not set)")
        return None

    vault_type = os.environ.get("CREDENTIAL_VAULT", "local").strip().lower()

    if vault_type == "local":
        from data_formulator.credential_vault.local_vault import LocalCredentialVault
        from data_formulator.datalake.workspace import get_data_formulator_home

        db_path = get_data_formulator_home() / "credentials.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _vault = LocalCredentialVault(db_path, key)
        logger.info("Credential vault initialized: local (%s)", db_path)
    else:
        logger.warning("Unknown credential vault type: %s", vault_type)

    return _vault
```

### 5.5 凭证管理 API

```python
# py-src/data_formulator/credential_routes.py

import flask
from flask import Blueprint, request, jsonify
from data_formulator.auth import get_identity_id
from data_formulator.credential_vault import get_credential_vault

credential_bp = Blueprint("credentials", __name__, url_prefix="/api/credentials")


@credential_bp.route("/list", methods=["GET"])
def list_credentials():
    """列出当前用户已存储凭证的外部系统。不返回凭证内容。"""
    vault = get_credential_vault()
    if not vault:
        return jsonify({"sources": []})

    identity = get_identity_id()
    sources = vault.list_sources(identity)
    return jsonify({"sources": sources})


@credential_bp.route("/store", methods=["POST"])
def store_credential():
    """存储或更新凭证。"""
    vault = get_credential_vault()
    if not vault:
        return jsonify({"error": "Credential vault not configured"}), 503

    data = request.get_json()
    source_key = data.get("source_key")
    credentials = data.get("credentials")
    if not source_key or not credentials:
        return jsonify({"error": "source_key and credentials required"}), 400

    identity = get_identity_id()
    vault.store(identity, source_key, credentials)
    return jsonify({"status": "stored", "source_key": source_key})


@credential_bp.route("/delete", methods=["POST"])
def delete_credential():
    """删除凭证。"""
    vault = get_credential_vault()
    if not vault:
        return jsonify({"error": "Credential vault not configured"}), 503

    data = request.get_json()
    source_key = data.get("source_key")
    if not source_key:
        return jsonify({"error": "source_key required"}), 400

    identity = get_identity_id()
    vault.delete(identity, source_key)
    return jsonify({"status": "deleted", "source_key": source_key})
```

---

## 6. SSO Token 透传机制

### 6.1 原理

当 Data Formulator 和外部 BI 系统（如 Superset）共用同一个 OIDC IdP 时，用户登录 DF 获得的 `access_token` 可以**直接用于调用外部系统的 API**，前提是外部系统信任同一个 Issuer。

```
             同一个 IdP (Keycloak / Okta / ...)
                     │
          ┌──────────┼──────────┐
          │                     │
          ▼                     ▼
   Data Formulator          Superset
   (client_id: df)     (client_id: superset)
          │                     │
          │  用户的 access_token │
          │  (audience: df)     │
          │                     │
          └──────── ? ──────────┘
                   
两种方式让 Superset 接受 DF 的 token:

方式 A: Token Exchange (标准, 推荐)
  DF 后端 → IdP token exchange endpoint
  → 用 df 的 token 换取 superset audience 的 token
  → 用新 token 调用 Superset API

方式 B: 共享 Audience (简单, 适合内部系统)
  IdP 中将 df 和 superset 配置为同一个 audience
  → DF 的 token 直接被 Superset 接受
```

### 6.2 插件中的 SSO 透传实现

```python
# 在 Superset 插件中

class SupersetPlugin(DataSourcePlugin):

    def supports_sso_passthrough(self) -> bool:
        return bool(os.environ.get("PLG_SUPERSET_SSO", "").lower() == "true")

    def _get_superset_token_via_sso(self, sso_token: str) -> Optional[str]:
        """用 DF 用户的 SSO token 获取 Superset 的 access token。"""
        superset_url = os.environ["PLG_SUPERSET_URL"]

        # 方式 A: 如果 Superset 支持 OAuth token introspection / exchange
        # 用 SSO token 调用 Superset 的 OAuth 端点换取 Superset session
        try:
            resp = requests.post(
                f"{superset_url}/api/v1/security/login",
                json={"token": sso_token, "provider": "oidc"},
                timeout=10,
            )
            if resp.status_code == 200:
                return resp.json().get("access_token")
        except Exception as e:
            logger.warning("SSO passthrough to Superset failed: %s", e)

        # 方式 B: 直接用 SSO token 作为 Bearer (如果 Superset 配置了同一 IdP)
        try:
            resp = requests.get(
                f"{superset_url}/api/v1/me/",
                headers={"Authorization": f"Bearer {sso_token}"},
                timeout=10,
            )
            if resp.status_code == 200:
                return sso_token  # token 直接可用
        except Exception:
            pass

        return None
```

### 6.3 认证模式自动协商

```
用户打开插件面板
    │
    ▼
前端: POST /api/plugins/superset/auth/status
    │
    ▼
后端检查:
    ├─ Session 中已有有效 token? → {"authenticated": true}
    │
    ├─ SSO token 可用 + 插件支持透传?
    │   → 尝试透传 → 成功 → {"authenticated": true, "mode": "sso"}
    │   → 失败 → 继续检查
    │
    ├─ Credential Vault 中有已存凭证?
    │   → 尝试登录 → 成功 → {"authenticated": true, "mode": "vault"}
    │   → 失败 (密码已改) → {"authenticated": false, "vault_stale": true}
    │
    └─ 以上均无 → {"authenticated": false, "available_modes": ["password", "api_key"]}
    
前端根据响应:
    ├─ authenticated=true → 直接显示数据目录
    ├─ authenticated=false + SSO 可用 → "正在通过 SSO 登录..." (自动重试)
    └─ authenticated=false + 需手动 → 显示登录表单
```

---

## 7. 现有 ExternalDataLoader 的演进路径

### 7.1 短期：两套机制并行

```
数据源类型          │  使用机制              │  原因
───────────────────┼───────────────────────┼─────────────────────────
MySQL/PG/MSSQL     │  ExternalDataLoader   │  标准数据库，通用表单即可
MongoDB/BigQuery   │  ExternalDataLoader   │  同上
S3/Azure Blob      │  ExternalDataLoader   │  文件存储
───────────────────┼───────────────────────┼─────────────────────────
Superset           │  DataSourcePlugin     │  有认证/目录/筛选/RBAC
Metabase           │  DataSourcePlugin     │  同上
Power BI           │  DataSourcePlugin     │  同上
```

**判断标准**：如果只需要 `连接参数 → list_tables → fetch_data`，用 DataLoader；如果需要自己的认证流程、数据浏览 UI、权限模型，用 Plugin。

### 7.2 中期：DataLoader 接入 CredentialVault

现有 DataLoader 的连接参数（数据库密码等）可以选择性地存入 CredentialVault，而不是留在浏览器 IndexedDB 中：

```python
# tables_routes.py 增强

@tables_bp.route("/data-loader/connect", methods=["POST"])
def connect_data_loader():
    data = request.get_json()
    data_loader_type = data["data_loader_type"]
    data_loader_params = data["data_loader_params"]
    remember = data.get("remember_credentials", False)

    # 正常连接逻辑...
    loader = DATA_LOADERS[data_loader_type](data_loader_params)
    tables = loader.list_tables()

    # 如果用户选择"记住凭证"，存入 Vault
    if remember:
        vault = get_credential_vault()
        if vault:
            identity = get_identity_id()
            vault.store(identity, f"dataloader:{data_loader_type}", data_loader_params)

    return jsonify({"tables": tables})
```

### 7.3 长期：统一为插件体系（可选）

如果未来需要给数据库连接器也加上专用 UI（如 schema 浏览、SQL 编辑器），可以将其包装为 Plugin。但这不是必须的 — 现有的通用表单 UI 对数据库连接器已经够用。

```
未来可能的架构:

DataSourcePlugin (统一基类)
├── BI Plugin (Superset, Metabase, ...)
│   └── 自带完整 UI + 认证流程
├── Database Plugin (PG, MySQL, ...)  ← 可选迁移
│   └── 复用 DBManagerPane 的通用表单
└── Storage Plugin (S3, Azure Blob, ...)  ← 可选迁移
    └── 复用 DBManagerPane 的通用表单

ExternalDataLoader 可以作为 Database/Storage Plugin 的内部实现被保留，
外面包一层 Plugin 壳即可。
```

---

## 8. 身份管理：SSO 时代的简化

### 8.1 有 SSO vs 无 SSO 的身份模型对比

```
┌─────────────────────────────────────────────────────────────┐
│  无 SSO (现有模式)                                           │
│                                                              │
│  电脑A: browser:aaa-111                                      │
│  电脑B: browser:bbb-222   ← 完全不同的身份，数据不通          │
│                                                              │
│  需要 IdentityStore + 身份合并 才能跨设备 (复杂)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  有 SSO (新增)                                               │
│                                                              │
│  电脑A: user:alice@corp.com   (SSO 登录)                     │
│  电脑B: user:alice@corp.com   (SSO 登录) ← 同一身份!         │
│                                                              │
│  天然跨设备，无需身份合并。Workspace 按 user:xxx 隔离即可。    │
│  CredentialVault 也按 user:xxx 存取，自动跨设备可用。         │
└─────────────────────────────────────────────────────────────┘
```

**SSO 从根本上解决了身份漫游问题**。原有文档中复杂的 `IdentityStore` + 身份链接 + 合并对话框，在 SSO 模式下完全不需要。

### 8.2 身份管理策略

| 部署模式 | 身份来源 | Workspace 键 | Credential Vault 键 | 跨设备 |
|---------|---------|-------------|--------------------|----|
| 本地匿名 | 浏览器 UUID | `browser:xxx` | `browser:xxx` (不可靠) | 不支持 |
| SSO 登录 | OIDC sub claim | `user:alice@corp.com` | `user:alice@corp.com` | 自动支持 |
| Azure EasyAuth | Azure Principal | `user:guid` | `user:guid` | 自动支持 |

### 8.3 身份迁移（不在本架构中实现）

当匿名用户（`browser:xxx`）首次通过 SSO 登录后，之前的匿名数据与新的 `user:xxx` 身份分属不同 Workspace。本架构**不提供自动迁移机制** —— 这是一个极低频场景（仅发生在用户从匿名模式升级到 SSO 的一瞬间），且数据量通常很小。

如果未来确实需要，可以通过管理员命令行工具离线完成，不影响核心架构。

---

## 9. 配置参考

### 9.1 完整 .env 配置示例

```bash
# ==============================================================
# Data Formulator — 完整配置示例
# ==============================================================

# --------------------------------------------------------------
# 基础设置
# --------------------------------------------------------------
LOG_LEVEL=INFO
SANDBOX=local
DATA_FORMULATOR_HOME=/data/data-formulator

# --------------------------------------------------------------
# 认证设置（主认证 + 可选匿名回退）
# --------------------------------------------------------------
# 主认证模式（选一种）：
#   anonymous（默认）| oidc | github | azure_easyauth | proxy_header | saml | ldap | cas
AUTH_PROVIDER=oidc

# 是否允许匿名访问（默认 true，无需配置）
# 仅在需要强制登录时设为 false：
# ALLOW_ANONYMOUS=false

# ─── GitHub OAuth 配置 ───
# GITHUB_CLIENT_ID=xxx
# GITHUB_CLIENT_SECRET=xxx

# ─── OIDC 配置（仅需两项，其余从 Discovery 自动获取）───
OIDC_ISSUER_URL=https://keycloak.example.com/realms/my-org
OIDC_CLIENT_ID=data-formulator

# --------------------------------------------------------------
# 凭证保险箱
# --------------------------------------------------------------
# 存储类型: local (默认)
CREDENTIAL_VAULT=local
# 加密密钥 (Fernet)
# 生成: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
CREDENTIAL_VAULT_KEY=your-fernet-key-here

# --------------------------------------------------------------
# LLM 模型配置
# --------------------------------------------------------------
DEEPSEEK_ENABLED=true
DEEPSEEK_ENDPOINT=openai
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODELS=deepseek-chat

QWEN_ENABLED=true
QWEN_ENDPOINT=openai
QWEN_API_KEY=sk-xxx
QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODELS=qwen3-omni-flash

# --------------------------------------------------------------
# 数据源插件
# --------------------------------------------------------------
# Superset (配置了 PLG_SUPERSET_URL 即自动启用)
PLG_SUPERSET_URL=http://superset.example.com:8088
PLG_SUPERSET_SSO=true          # 启用 SSO token 透传到 Superset
# PLG_SUPERSET_TIMEOUT=30      # API 超时秒数 (可选)

# Metabase (配置了 PLG_METABASE_URL 即自动启用)
# PLG_METABASE_URL=http://metabase.example.com:3000

# Power BI (配置了 PLG_POWERBI_TENANT_ID 即自动启用)
# PLG_POWERBI_TENANT_ID=your-tenant-id
# PLG_POWERBI_CLIENT_ID=your-client-id

# --------------------------------------------------------------
# Workspace 存储
# --------------------------------------------------------------
# WORKSPACE_BACKEND=local
# AZURE_BLOB_CONNECTION_STRING=
# AZURE_BLOB_ACCOUNT_URL=
```

### 9.2 免费 IdP 方案（生产可用）

如果组织没有 Google Workspace、Microsoft 365 或 AWS 等企业订阅，以下免费方案可用于生产环境：

| 方案 | 费用 | 适用场景 | 特点 |
|------|------|---------|------|
| **Keycloak** | 免费（自托管） | 中大型企业 | 功能最全，支持 OIDC/SAML/LDAP，需自行运维 |
| **Authelia** | 免费（自托管） | 个人/小团队 | 轻量级，与反向代理集成好，配置简单 |
| **Authentik** | 免费（自托管） | 中小团队 | 界面友好，功能丰富，支持 OIDC/SAML/LDAP |
| **Auth0 免费版** | 免费（7,500用户限制） | 小团队/初创公司 | 托管服务，无需运维，有用户数量限制 |

#### Keycloak 配置示例

```bash
# 使用 Docker 运行 Keycloak
docker run -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:22.0 start-dev

# Data Formulator 配置（仅需后端配置，前端自动获取）
OIDC_ISSUER_URL=http://localhost:8080/realms/master
OIDC_CLIENT_ID=df-client
# Keycloak 中创建 client 时获取
OIDC_CLIENT_SECRET=xxx
```

#### Authelia 配置示例

```bash
# docker-compose.yml 示例
version: '3'
services:
  authelia:
    image: authelia/authelia:latest
    ports:
      - "9091:9091"
    volumes:
      - ./authelia:/config

# Data Formulator 使用反向代理头认证
AUTH_PROVIDER=proxy_header
PROXY_HEADER_USER=Remote-User
PROXY_HEADER_EMAIL=Remote-Email
PROXY_TRUSTED_IPS=127.0.0.1,172.16.0.0/12
```

#### Auth0 免费版配置示例

```bash
# 在 https://auth0.com/ 注册免费账号，创建 Application
# 仅需后端配置，前端自动获取
OIDC_ISSUER_URL=https://your-tenant.auth0.com/
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

**注意**：Google、Microsoft、Amazon 的 OIDC 服务都需要付费的企业订阅（Workspace、M365、AWS），个人账号无法作为 IdP 使用。

#### 社交登录集成（无需企业账号）

如果不想部署自托管 IdP，可以使用社交登录平台。这些平台**不需要企业账号**，个人开发者账号即可免费使用：

| 平台 | 需要企业账号？ | 费用 | 用户群体 | 推荐度 |
|------|--------------|------|---------|--------|
| **GitHub** | ❌ 不需要 | 免费 | 开发者 | ⭐⭐⭐⭐⭐ |
| **Google** | ❌ 不需要 | 免费 | 大众用户 | ⭐⭐⭐⭐ |
| **Microsoft** | ❌ 不需要 | 免费 | 企业/个人 | ⭐⭐⭐ |

**GitHub OAuth 配置示例**（最简单）：

```bash
# 1. 在 GitHub 注册 OAuth App
# 访问 https://github.com/settings/developers
# 点击 "New OAuth App"
# 填写：
#   - Application name: Data Formulator
#   - Homepage URL: https://your-domain.com
#   - Authorization callback URL: https://your-domain.com/api/auth/callback

# 2. Data Formulator 配置（仅需后端配置，前端自动获取）
AUTH_PROVIDER=github
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

**简化配置模式**（主认证 + 匿名回退）：

```bash
# 模式 1：仅匿名（本地个人使用）
AUTH_PROVIDER=anonymous

# 模式 2：GitHub OAuth + 匿名回退
AUTH_PROVIDER=github
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
# ALLOW_ANONYMOUS 默认 true，匿名用户可正常使用

# 模式 3：企业 SSO + 匿名回退
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://keycloak.company.com/realms/main
OIDC_CLIENT_ID=data-formulator
# ALLOW_ANONYMOUS 默认 true，匿名用户可正常使用
```

**说明**：
- 主认证方式（github/oidc）提供完整功能（数据同步、跨设备、SSO 透传）
- 匿名模式作为回退，方便临时使用或快速体验
- 如需强制登录，设置 `ALLOW_ANONYMOUS=false`

#### 一键 Docker 部署方案

为降低配置门槛，提供开箱即用的 Docker Compose 配置：

**方案 A：Keycloak + Data Formulator（完整 SSO）**

```yaml
# docker-compose.sso.yml
version: '3.8'

services:
  keycloak:
    image: quay.io/keycloak/keycloak:22.0
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: keycloak
      KC_HOSTNAME: localhost
    ports:
      - "8080:8080"
    command: start-dev
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: keycloak
    volumes:
      - postgres_data:/var/lib/postgresql/data

  data-formulator:
    image: data-formulator:latest
    environment:
      # 仅需后端配置，前端运行时自动获取
      AUTH_PROVIDER: oidc
      OIDC_ISSUER_URL: http://keycloak:8080/realms/master
      OIDC_CLIENT_ID: df-client
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      ALLOW_ANONYMOUS: "true"
      CREDENTIAL_VAULT: local
      CREDENTIAL_VAULT_KEY: ${VAULT_KEY}
    ports:
      - "5000:5000"
    depends_on:
      - keycloak

volumes:
  postgres_data:
```

启动命令：
```bash
# 1. 生成加密密钥
export VAULT_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

# 2. 在 Keycloak 中创建 client，获取 secret
# 访问 http://localhost:8080 (admin/admin)
# 创建 realm → 创建 client → 获取 secret

# 3. 启动服务
export OIDC_CLIENT_SECRET=your-client-secret
docker-compose -f docker-compose.sso.yml up
```

**方案 B：Authelia + Data Formulator（轻量级）**

```yaml
# docker-compose.authelia.yml
version: '3.8'

services:
  authelia:
    image: authelia/authelia:latest
    ports:
      - "9091:9091"
    volumes:
      - ./authelia:/config
    environment:
      AUTHELIA_JWT_SECRET_FILE: /config/jwt_secret
      AUTHELIA_SESSION_SECRET_FILE: /config/session_secret

  redis:
    image: redis:alpine

  data-formulator:
    image: data-formulator:latest
    environment:
      AUTH_PROVIDER: proxy_header
      PROXY_HEADER_USER: Remote-User
      PROXY_HEADER_EMAIL: Remote-Email
      PROXY_TRUSTED_IPS: 172.16.0.0/12
    ports:
      - "5000:5000"
```

**方案 C：仅 Data Formulator（匿名模式，零配置）**

```yaml
# docker-compose.minimal.yml
version: '3.8'

services:
  data-formulator:
    image: data-formulator:latest
    environment:
      # 无 SSO 配置，自动使用匿名模式
      DEEPSEEK_ENABLED: "true"
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
    ports:
      - "5000:5000"
    volumes:
      - df_data:/data/data-formulator

volumes:
  df_data:
```

启动命令：
```bash
export DEEPSEEK_API_KEY=sk-xxx
docker-compose -f docker-compose.minimal.yml up
```

### 9.3 最小配置（本地匿名使用）

```bash
# 最小配置 — 本地使用，无 SSO，无插件
DEEPSEEK_ENABLED=true
DEEPSEEK_ENDPOINT=openai
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODELS=deepseek-chat
```

### 9.4 团队部署配置（SSO + Superset）

```bash
# 团队部署 — SSO + Superset（精简版）
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://keycloak.internal:8443/realms/team
OIDC_CLIENT_ID=data-formulator

PLG_SUPERSET_URL=http://superset.internal:8088
PLG_SUPERSET_SSO=true

DEEPSEEK_ENABLED=true
DEEPSEEK_API_KEY=sk-xxx
```

---

## 10. 目录结构

### 10.1 后端新增文件

```
py-src/data_formulator/
├── auth.py                              # 重构：Provider 自动发现 + /api/auth/info 委托
├── auth_providers/                      # 新增：认证提供者（自动发现）
│   ├── __init__.py                     # Provider 自动扫描 + get_provider_class() API
│   ├── base.py                          # AuthProvider（含 get_auth_info()）/ AuthResult 基类
│   ├── azure_easyauth.py               # Azure EasyAuth (迁移现有逻辑)
│   ├── oidc.py                         # 通用 OIDC Provider ★（仅需 2 个环境变量）
│   └── github_oauth.py                 # GitHub OAuth Provider
├── auth_gateways/                       # 新增：有状态协议的登录网关
│   ├── github_gateway.py               # GitHub OAuth 授权码交换
│   └── logout.py                       # 通用登出
├── credential_vault/                    # 新增：凭证保险箱
│   ├── __init__.py                     # get_credential_vault() 工厂
│   ├── base.py                         # CredentialVault 抽象接口
│   └── local_vault.py                  # SQLite + Fernet 加密实现
├── credential_routes.py                 # 新增：凭证管理 API
├── plugins/                             # 新增：插件系统
│   ├── __init__.py                     # 插件注册中心 (discover_and_register)
│   ├── base.py                         # DataSourcePlugin 基类
│   ├── data_writer.py                  # PluginDataWriter 写入工具
│   ├── superset/                       # Superset 插件
│   │   ├── __init__.py                # SupersetPlugin 实现
│   │   ├── superset_client.py         # Superset REST API 封装
│   │   ├── auth_bridge.py            # JWT/SSO 认证桥接
│   │   ├── catalog.py                # 带缓存的数据目录
│   │   └── routes/
│   │       ├── __init__.py
│   │       ├── auth.py               # /api/plugins/superset/auth/*
│   │       ├── catalog.py            # /api/plugins/superset/catalog/*
│   │       └── data.py              # /api/plugins/superset/data/*
│   └── metabase/                       # Metabase 插件 (未来)
│       └── ...
├── data_loader/                         # 现有 ExternalDataLoader 体系 (不变)
│   └── ...
└── app.py                               # 修改：集成 init_auth() + 插件发现
```

### 10.2 前端新增文件

```
src/
├── app/
│   ├── oidcConfig.ts                   # 新增：OIDC 配置和 UserManager
│   ├── OidcCallback.tsx                # 新增：OIDC 回调页面
│   ├── identity.ts                     # 修改：增加 setBrowserId()
│   ├── utils.tsx                       # 修改：fetchWithIdentity 携带 Bearer token
│   ├── dfSlice.tsx                     # 修改：ServerConfig 增加 plugins 字段
│   └── App.tsx                         # 修改：OIDC 初始化 + 登录UI
├── plugins/                             # 新增：插件前端
│   ├── types.ts                        # PluginManifest, PluginPanelProps 类型
│   ├── registry.ts                     # 插件动态加载
│   ├── PluginHost.tsx                  # 插件容器组件
│   ├── CredentialManager.tsx           # 凭证管理 UI
│   ├── superset/                       # Superset 前端插件
│   │   ├── index.ts
│   │   ├── SupersetPanel.tsx
│   │   ├── SupersetCatalog.tsx
│   │   ├── SupersetDashboards.tsx
│   │   ├── SupersetFilterDialog.tsx
│   │   ├── SupersetLogin.tsx
│   │   └── api.ts
│   └── metabase/                       # Metabase 前端插件 (未来)
│       └── ...
└── views/
    └── UnifiedDataUploadDialog.tsx      # 修改：增加 PluginHost 渲染
```

### 10.3 对现有文件的改动清单

| 文件 | 改动类型 | 改动量 | 说明 |
|------|---------|--------|------|
| `py-src/.../auth.py` | 重构 | ~60 行 | 基于自动发现的 `init_auth()` + `/api/auth/info` 委托给 Provider 自描述 |
| `py-src/.../app.py` | 修改 | ~25 行 | 调用 `init_auth()`、`discover_and_register()`、注册 credential/identity blueprint、`app-config` 返回 plugins |
| `src/app/App.tsx` | 修改 | ~35 行 | 统一 initAuth（`/api/auth/info` 驱动，纯 action 分支）、登录/登出 UI |
| `src/app/utils.tsx` | 修改 | ~15 行 | `fetchWithIdentity` 携带 Bearer token + 401 自动重试 |
| `src/app/dfSlice.tsx` | 修改 | ~5 行 | `ServerConfig` 增加 `plugins` 字段 |
| `src/app/identity.ts` | 修改 | ~5 行 | 增加 `setBrowserId()` |
| `src/views/UnifiedDataUploadDialog.tsx` | 修改 | ~20 行 | 导入 PluginHost，渲染插件 Tab |

---

## 11. 实施路径

### Phase 1：认证基础 (AuthProvider 链)

**目标**：将现有 `auth.py` 重构为可插拔的 Provider 链，激活 OIDC Provider。

**交付物**：
- `auth_providers/__init__.py` — Provider 自动发现（`pkgutil` 扫描 + `get_provider_class()` API）
- `auth_providers/base.py` — 基类（含 `get_auth_info()` 自描述接口）
- `auth_providers/azure_easyauth.py` — 迁移现有 Azure 逻辑
- `auth_providers/oidc.py` — 通用 OIDC 验签（仅需 `OIDC_ISSUER_URL` + `OIDC_CLIENT_ID`）
- `auth_providers/github_oauth.py` — GitHub OAuth Provider
- `auth_gateways/github_gateway.py` — GitHub 授权码交换
- `auth.py` 重构 — 基于自动发现的 `init_auth()` + `/api/auth/info` 委托
- `src/app/oidcConfig.ts` — 前端 OIDC 配置
- `src/app/OidcCallback.tsx` — 回调页面
- `src/app/LoginPanel.tsx` — 统一登录组件（由 `/api/auth/info` 驱动）
- `App.tsx` 修改 — 统一 initAuth（单端点驱动）+ 401 自动重试
- `utils.tsx` 修改 — Bearer token + 401 重试逻辑

**验证标准**：
- 配置 Keycloak + OIDC 环境变量后，用户可以通过浏览器登录
- 后端正确从 JWT 中提取 `sub` 作为 `user:xxx` 身份
- 不配置 OIDC 时，行为与现有版本完全一致（浏览器 UUID）
- `get_sso_token()` 可以返回当前用户的 access token

**依赖**：`pip install PyJWT cryptography`，`npm install oidc-client-ts`

### Phase 2：插件框架 + Superset 插件

**目标**：建立插件框架，将 0.6 版本 Superset 集成迁移为第一个插件。

**交付物**：
- `plugins/__init__.py` — 插件注册中心
- `plugins/base.py` — DataSourcePlugin 基类
- `plugins/data_writer.py` — PluginDataWriter
- `plugins/superset/` — 完整的 Superset 插件
- `src/plugins/` — 前端插件框架
- `app.py` 修改 — 调用 `discover_and_register()`
- `UnifiedDataUploadDialog.tsx` 修改 — PluginHost

**验证标准**：
- 配置 `PLG_SUPERSET_URL` 后，前端自动显示 Superset Tab
- 用户可以登录 Superset、浏览数据集、加载数据
- SSO 模式下，用户无需再次输入 Superset 密码
- 不配置 `PLG_SUPERSET_URL` 时，无任何影响

### Phase 3：凭证保险箱

**目标**：服务端加密凭证存储，替代浏览器 IndexedDB 的不安全存储。

**交付物**：
- `credential_vault/` — Vault 接口 + 本地加密实现
- `credential_routes.py` — 凭证管理 API
- `src/plugins/CredentialManager.tsx` — 凭证管理 UI
- 插件认证路由增强 — 自动从 Vault 取凭证

**验证标准**：
- 凭证加密存储在服务端 SQLite
- SSO 用户换设备后，已存凭证自动可用
- Vault 未配置时，回退到 Session 级别存储（现有行为）

### Phase 4：第二个插件 (Metabase)

**目标**：验证插件框架的通用性 —— 新增插件是否真的不需要修改核心代码。

**交付物**：
- `plugins/metabase/` — 完整的 Metabase 插件

**验证标准**：
- 仅新增 `plugins/metabase/` 目录和 `src/plugins/metabase/` 目录
- **核心代码零修改**（目录自动扫描 + `import.meta.glob` 自动发现）

### Phase 5：完善

- DataLoader 凭证接入 Vault（可选记住密码）
- 插件国际化 (i18n)
- 插件错误边界和降级处理
- 管理员配置 UI
- 审计日志（谁在什么时候访问了哪些数据）
- 单元测试和集成测试

---

## 12. 安全模型

### 12.1 认证链路安全

```
前端 OIDC PKCE 流程 (无 client secret 暴露)
    │
    ▼
IdP 签发 access_token (RS256 签名)
    │
    ▼
前端在 Authorization: Bearer 头中携带
    │
    ▼
后端 OIDCProvider 用 JWKS 公钥验签
  ├─ 验证签名 (RS256)
  ├─ 验证 issuer (防止跨 IdP 攻击)
  ├─ 验证 audience (防止 token 被其他应用滥用)
  ├─ 验证 exp (防止过期 token)
  └─ 提取 sub → user:xxx
```

### 12.2 凭证存储安全

| 层次 | 措施 |
|------|------|
| 传输 | HTTPS (生产环境必须) |
| 存储加密 | Fernet 对称加密 (AES-128-CBC + HMAC-SHA256) |
| 密钥管理 | `CREDENTIAL_VAULT_KEY` 环境变量，不存在代码中 |
| 访问隔离 | 凭证按 `(user_identity, source_key)` 隔离，用户只能访问自己的 |
| 前端不触碰 | 凭证仅在服务端存取，前端只知道"有没有已存凭证"，不知道内容 |

### 12.3 插件隔离安全

| 风险 | 缓解 |
|------|------|
| 插件 A 访问插件 B 的 Session | Session key 按 `plugin_{id}_` 前缀隔离 |
| 插件窃取 SSO token | `get_sso_token()` 是只读的，插件不能修改；且 token 本来就是要透传的 |
| 恶意插件注册危险路由 | 插件 Blueprint 强制 prefix `/api/plugins/<id>/`，无法覆盖核心路由 |
| SSRF (前端输入任意 URL) | 插件端点 URL 在 `.env` 中由管理员配置，不接受前端输入 |

### 12.4 匿名模式的安全限制

当无 SSO 时（`browser:` 身份），系统不对安全性做强保证：

- 同一浏览器的所有 Tab 共享同一 `browser:xxx` 身份
- 清除 localStorage 即可获得新身份
- Credential Vault 中按 `browser:xxx` 存储的凭证仅在同一浏览器可用
- 这与现有行为一致，且与"个人本地工具"的定位匹配

---

## 13. FAQ

### Q1: 为什么不自建用户注册/登录系统？

密码存储、哈希、重置、邮件验证、安全审计 —— 这些都是沉重的安全负担。Data Formulator 的核心价值是数据可视化，不是身份管理。OIDC 把这些责任交给专业的 IdP (Keycloak 一个 Docker 容器就能跑)，更安全、维护成本更低。

### Q2: 小团队不想搭建 IdP 怎么办？

有几个极轻量的选择：
- **Keycloak**: `docker run -p 8080:8080 quay.io/keycloak/keycloak start-dev`
- **Authelia**: 支持 OIDC 的轻量级认证网关
- **Authentik**: 现代化的开源 IdP
- 或者直接使用 SaaS: Auth0 免费版支持 7000 月活用户

不搭 IdP 也没关系 —— 不配置 `OIDC_ISSUER_URL`，系统自动回退到匿名浏览器模式，与现在完全一致。

### Q3: 如果外部 BI 系统既没接 SSO，也不想让用户输密码？

插件支持多种认证模式，包括 **API Key**。例如 Superset 和 Metabase 都支持生成 API Token：
- 管理员在 BI 系统中为每个用户生成 long-lived API token
- 用户在 DF 中输入一次 API token，存入 Credential Vault
- 后续自动使用

### Q4: 如果某个外部系统的 SDK 没有 Python 包怎么办？

所有 BI 系统都有 REST API，插件通过 `requests` 库调用即可。不需要专用 SDK。如果某个系统需要特殊的 Python 包，在 `__init__.py` 中 `import` 即可——导入失败时插件自动扫描机制会将其标记为 `DISABLED_PLUGINS`（与 `ExternalDataLoader` 的降级机制一致）。

### Q5: 如何开发一个新的数据源插件？

**最小步骤**：

1. 创建 `py-src/data_formulator/plugins/your_system/` 目录
2. 实现 `DataSourcePlugin` 子类 (manifest + blueprint + frontend_config)
3. 在 blueprint 中实现 `auth/login`, `catalog/list`, `data/load` 三组路由
4. 创建 `src/plugins/your_system/` 目录，导出 `index.ts`
5. 实现 `PanelComponent` (列表浏览 + 加载按钮)
6. 在 `.env` 中设置环境变量启用
7. 重启服务 → 后端自动扫描发现，前端 `import.meta.glob` 自动编译

**核心代码改动：0 行。** 无需修改任何注册表或配置文件。

### Q6: 现有的 ExternalDataLoader (数据库连接器) 会被废弃吗？

不会。数据库连接器的需求（连接参数 → 列表 → 拉取）与插件不同，`ExternalDataLoader` 的通用表单 UI 完全够用。两套机制长期并行。如果未来需要给某个数据库加专用 UI，可以考虑包装为 Plugin，但不是必须的。

### Q7: 多个 IdP 可以同时配置吗？

当前设计每次只有一个 OIDC issuer。如果需要支持多个 IdP（如同时支持 Google 和 Okta），有两种路径：
- **推荐**：用一个 IdP (如 Keycloak) 作为联合身份代理，配置多个上游 IdP
- **扩展**：修改 `OIDCProvider` 支持多 issuer（需在 `_providers` 中注册多个实例）

### Q8: 这套架构对上游 Data Formulator 的兼容性如何？

`auth.py` 的重构是最大的改动，但保持了 `get_identity_id()` 的签名和返回值格式（`user:xxx` / `browser:xxx`）不变。所有调用 `get_identity_id()` 的代码无需修改。插件系统和凭证保险箱是纯新增代码，不修改任何现有模块。

---

## 附录 A：开发新插件的检查清单

```
□ 后端
  □ plugins/your_system/__init__.py — 暴露 plugin_class = YourPlugin
  □ plugins/your_system/plugin.py — 实现 DataSourcePlugin (manifest + blueprint)
  □ plugins/your_system/routes/ — auth, catalog, data 三组路由
  □ plugins/your_system/ — API client, auth bridge 等
  □ 无需修改 plugins/__init__.py（目录自动扫描）
  □ 测试：启用/禁用切换正常

□ 前端
  □ src/plugins/your_system/index.ts — 导出 DataSourcePluginModule
  □ src/plugins/your_system/*Panel.tsx — 主面板组件
  □ src/plugins/your_system/*Login.tsx — 登录组件 (如需要)
  □ 无需修改 registry.ts（import.meta.glob 自动发现）
  □ 测试：Tab 显示/隐藏正常

□ 配置
  □ .env.template 增加环境变量说明
  □ 文档更新

□ 认证模式
  □ SSO 透传测试 (如果外部系统支持)
  □ Credential Vault 存取测试
  □ 手动登录测试
  □ Session 过期 / Token 刷新测试
```

## 附录 B：关键依赖

| 包 | 用途 | 安装 |
|-----|------|------|
| `PyJWT` | OIDC JWT 验签 | `pip install PyJWT` |
| `cryptography` | Fernet 加密 (Vault + JWT) | `pip install cryptography` |
| `oidc-client-ts` | 前端 OIDC PKCE 流程 | `npm install oidc-client-ts` |
| `requests` | 插件 HTTP 调用 (已有) | — |

## 附录 C：与原有插件架构文档的关系

本文档是 `data-source-plugin-architecture.md` 的**上层补充**。原文档详细描述了：
- 插件基类和前端接口的完整设计
- Superset 0.6→0.7 迁移的具体方案
- PluginDataWriter 和 BatchWriter 的完整实现
- 身份链接表 (IdentityStore) 的详细设计

本文档新增的内容：
- **AuthProvider 可插拔认证层** — 原文档假设浏览器 UUID 为主要身份，本文档用 OIDC 替代
- **CredentialVault 凭证保险箱** — 原文档中插件凭证存在 Flask Session，本文档增加持久化加密存储
- **SSO Token 透传** — 原文档中每个插件独立认证，本文档增加 SSO 自动透传
- **身份模型简化** — 有了 SSO，原文档中复杂的 IdentityStore + 身份合并被简化为一次性 browser→user 迁移

两份文档互补使用：本文档定义整体架构和集成方式，原文档提供插件内部的详细实现指导。
