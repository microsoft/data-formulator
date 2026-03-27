# Data Formulator — SSO 认证 + 数据源插件 统一架构设计

## 目录

1. [概述与目标](#1-概述与目标)
2. [架构全景](#2-架构全景)
3. [Layer 1：可插拔认证体系 (AuthProvider)](#3-layer-1可插拔认证体系-authprovider)
   - 3.1~3.8 — AuthProvider 基类、OIDC、Azure EasyAuth、前端 OIDC 流程
   - [3.9 多协议支持：SAML / LDAP / CAS / 反向代理](#39-多协议支持从-oidc-扩展到-saml--ldap--cas--反向代理)
     - 3.9.1 协议全景对比
     - 3.9.2 双轨模型设计（Stateless + Session Gateway）
     - 3.9.3~3.9.5 AuthResult 扩展、ProxyHeader Provider、Session Provider
     - 3.9.6~3.9.7 Login Gateway（SAML / LDAP / CAS）、通用登出
     - 3.9.8 auth.py 更新（provider_registry + gateway 注册）
     - 3.9.9 前端适配（统一登录入口 + /api/auth/methods + /api/auth/whoami）
     - 3.9.10~3.9.14 完整链图、Token 透传差异、协议选择指南、依赖、优先级
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
│   │   AuthProvider Chain (优先级从高到低):                                    │ │
│   │   ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │ │
│   │   │ Azure       │ │ OIDC     │ │ Proxy    │ │ Session  │ │Browser │  │ │
│   │   │ EasyAuth    │ │ JWT      │ │ JWT      │ │ (匿名回退)            │  │ │
│   │   │ (现有)      │ │ (新增★)  │ │ (预留)   │ │ (现有)                │  │ │
│   │   └─────────────┘ └──────────┘ └──────────┘ └───────────────────────┘  │ │
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
| **Layer 1: AuthProvider** | 解决"谁在用 DF" — 可插拔的认证提供者链 | 扩展现有 `auth.py` |
| **Layer 2: DataSourcePlugin** | 解决"从哪拉数据" — 外部 BI 系统的插件化接入 | 新建插件框架 |
| **Layer 3: CredentialVault** | 解决"用什么身份访问外部系统" — 加密凭证存储 | 新建 |

三层独立但协作：AuthProvider 确定用户身份 → CredentialVault 按用户身份存取凭证 → Plugin 用凭证或 SSO token 访问外部系统。

### 统一的插件范式

三层虽然解决不同问题，但共享同一套 **"抽象基类 + 动态注册 + 环境变量启用"** 的插件设计范式：

| 维度 | AuthProvider | DataSourcePlugin | CredentialVault |
|------|-------------|-----------------|-----------------|
| 抽象基类 | `AuthProvider(ABC)` | `DataSourcePlugin(ABC)` | `CredentialVault(ABC)` |
| 动态加载 | `importlib.import_module` | `importlib.import_module` | 工厂函数 `get_credential_vault()` |
| 注册表 | `provider_registry` dict | `_PLUGIN_SPECS` list | `CREDENTIAL_VAULT` 环境变量 |
| 按需启用 | 缺配置则跳过 | 缺环境变量则跳过 | 缺密钥则返回 None |
| 新增方式 | 写一个 `.py` + 注册表加一行 | 写一个目录 + 注册表加一行 | 写一个 `.py` + 工厂加一个分支 |
| 生命周期钩子 | `on_configure(app)` | `on_enable(app)` | — |

**关键区别在于协作模式**：

```
AuthProvider — 链式 (Chain of Responsibility)
  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────────┐
  │ Azure    │ ──→ │ OIDC     │ ──→ │ Proxy    │ ──→ │ Session  │ ──→ │ Browser UUID │
  │ EasyAuth │ 没命中│ JWT      │ 没命中│ Header   │ 没命中│ (SAML/   │ 没命中│ (最终回退)   │
  │ (无状态) │     │ (无状态) │     │ (无状态) │     │ LDAP/CAS)│     │              │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────────┘
  ▸ 只有一个 Provider 生效（第一个命中的）
  ▸ 顺序由 AUTH_PROVIDERS 环境变量控制
  ▸ 每个请求走一遍链，直到命中

DataSourcePlugin — 并行 (Registry)
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Superset │  │ Metabase │  │ Power BI │  ...
  │ Plugin   │  │ Plugin   │  │ Plugin   │
  └──────────┘  └──────────┘  └──────────┘
  ▸ 所有已启用插件同时存在
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

这套统一范式意味着：未来无论是新增认证方式、新增数据源（如 Grafana、Tableau）、还是新增凭证后端（如 HashiCorp Vault），步骤都是相同的 —— **写一个实现类，在注册表加一行，配置环境变量启用**。核心代码零修改。

认证体系进一步细分为两轨：
- **A 类（无状态）** — 直接实现 `AuthProvider.authenticate()`，无需额外路由（如 OIDC、反向代理头）
- **B 类（有状态）** — 编写 Login Gateway Blueprint + 复用通用 `SessionProvider`（如 SAML、LDAP、CAS）

详见 [3.9 多协议支持](#39-多协议支持从-oidc-扩展到-saml--ldap--cas--反向代理)。

---

## 3. Layer 1：可插拔认证体系 (AuthProvider)

### 3.1 设计思路

将现有 `auth.py` 中硬编码的三级优先级，重构为 **AuthProvider 链**。每个 Provider 独立尝试从请求中提取身份，首个成功的即为最终身份。支持无状态（OIDC/Header）和有状态（SAML/LDAP/CAS via Session）两种认证模型（详见 [3.9](#39-多协议支持从-oidc-扩展到-saml--ldap--cas--反向代理)）。

```
请求进入
  │
  ├─ Provider 1: AzureEasyAuth    → 检查 X-MS-CLIENT-PRINCIPAL-ID  → 命中 → user:xxx
  ├─ Provider 2: OIDCProvider     → 检查 Authorization: Bearer     → 命中 → user:xxx
  ├─ Provider 3: ProxyHeaderProv. → 检查 X-Forwarded-User (可信IP) → 命中 → user:xxx
  ├─ Provider 4: SessionProvider  → 检查 Flask session cookie      → 命中 → user:xxx
  │                                 (session 由 SAML/LDAP/CAS Login Gateway 写入)
  └─ Fallback: BrowserIdentity   → 检查 X-Identity-Id             → 命中 → browser:xxx
      └─ 全部未命中 → ValueError
```

### 3.2 AuthProvider 基类

```python
# py-src/data_formulator/auth_providers/base.py

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from flask import Request


@dataclass
class AuthResult:
    """认证结果。"""
    user_id: str                           # 唯一标识 (sub claim / principal ID / UUID)
    display_name: Optional[str] = None     # 显示名称
    email: Optional[str] = None            # 邮箱
    groups: Optional[list[str]] = None     # 用户组 (未来 RBAC 可用)
    raw_token: Optional[str] = None        # 原始 token (用于 SSO 透传)
    provider_name: str = ""                # 来源 Provider 名称


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

    def on_configure(self, app) -> None:
        """Flask app 创建后调用，可用于初始化（如下载 JWKS）。"""
        pass


class AuthenticationError(Exception):
    """认证信息存在但验证失败。"""
    def __init__(self, message: str, provider: str = ""):
        self.provider = provider
        super().__init__(message)
```

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
            provider_name=self.name,
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
    
    配置（环境变量）：
        OIDC_ISSUER_URL     — IdP 的 issuer URL (必需)
        OIDC_CLIENT_ID      — 注册的 client ID (必需，用作 audience 校验)
        OIDC_AUDIENCE       — token 的 audience (可选，默认等于 CLIENT_ID)
        OIDC_ALGORITHMS     — 签名算法 (可选，默认 RS256)
        OIDC_USER_ID_CLAIM  — 用户 ID 取哪个 claim (可选，默认 sub)
        OIDC_NAME_CLAIM     — 显示名称取哪个 claim (可选，默认 name)
        OIDC_EMAIL_CLAIM    — 邮箱取哪个 claim (可选，默认 email)
        OIDC_GROUPS_CLAIM   — 用户组取哪个 claim (可选，默认 groups)
    """

    def __init__(self):
        self._issuer = os.environ.get("OIDC_ISSUER_URL", "").strip().rstrip("/")
        self._client_id = os.environ.get("OIDC_CLIENT_ID", "").strip()
        self._audience = os.environ.get("OIDC_AUDIENCE", "").strip() or self._client_id
        self._algorithms = [
            a.strip()
            for a in os.environ.get("OIDC_ALGORITHMS", "RS256").split(",")
        ]
        self._user_id_claim = os.environ.get("OIDC_USER_ID_CLAIM", "sub").strip()
        self._name_claim = os.environ.get("OIDC_NAME_CLAIM", "name").strip()
        self._email_claim = os.environ.get("OIDC_EMAIL_CLAIM", "email").strip()
        self._groups_claim = os.environ.get("OIDC_GROUPS_CLAIM", "groups").strip()

        self._jwks_client: Optional[PyJWKClient] = None
        self._jwks_uri: Optional[str] = None

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

        # 预加载 OIDC Discovery 和 JWKS
        try:
            import urllib.request, json
            discovery_url = f"{self._issuer}/.well-known/openid-configuration"
            with urllib.request.urlopen(discovery_url, timeout=10) as resp:
                discovery = json.loads(resp.read())

            self._jwks_uri = discovery["jwks_uri"]
            self._jwks_client = PyJWKClient(self._jwks_uri, cache_keys=True)
            logger.info(
                "OIDC provider configured: issuer=%s, client_id=%s",
                self._issuer, self._client_id,
            )
        except Exception as e:
            logger.error("Failed to initialize OIDC provider: %s", e)

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
                audience=self._audience,
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

        user_id = payload.get(self._user_id_claim)
        if not user_id:
            raise AuthenticationError(
                f"OIDC token missing '{self._user_id_claim}' claim",
                provider=self.name,
            )

        return AuthResult(
            user_id=str(user_id),
            display_name=payload.get(self._name_claim),
            email=payload.get(self._email_claim),
            groups=payload.get(self._groups_claim),
            raw_token=token,
            provider_name=self.name,
        )
```

### 3.5 重构后的 auth.py

```python
# py-src/data_formulator/auth.py (重构)

"""
Authentication and identity management for Data Formulator.

Pluggable AuthProvider chain:
  1. Configured providers (Azure EasyAuth, OIDC, etc.) → user:<id>
  2. Browser UUID fallback → browser:<id>
"""

import logging
import re
import os
from typing import Optional
from flask import request, Flask

from data_formulator.auth_providers.base import (
    AuthProvider, AuthResult, AuthenticationError,
)

logger = logging.getLogger(__name__)

_MAX_IDENTITY_LENGTH = 256
_IDENTITY_RE = re.compile(r'^[\w@.\-]+$', re.ASCII)

# Provider chain, populated by init_auth()
_providers: list[AuthProvider] = []
_current_auth_result: Optional[AuthResult] = None


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
    """初始化认证 Provider 链。在 app 创建后调用一次。
    
    Provider 的加载顺序由 AUTH_PROVIDERS 环境变量控制：
        AUTH_PROVIDERS=azure_easyauth,oidc,proxy_header,session    (默认)
    
    每个 Provider 只有在其必需的配置存在时才会被激活。
    """
    global _providers
    _providers = []

    provider_names = [
        p.strip()
        for p in os.environ.get("AUTH_PROVIDERS", "azure_easyauth,oidc,proxy_header,session").split(",")
        if p.strip()
    ]

    provider_registry = {
        "azure_easyauth": "data_formulator.auth_providers.azure_easyauth.AzureEasyAuthProvider",
        "oidc":           "data_formulator.auth_providers.oidc.OIDCProvider",
        "proxy_header":   "data_formulator.auth_providers.proxy_header.ProxyHeaderProvider",
        "session":        "data_formulator.auth_providers.session_provider.SessionProvider",
    }

    for name in provider_names:
        qualified = provider_registry.get(name)
        if not qualified:
            logger.warning("Unknown auth provider: %s", name)
            continue

        module_path, cls_name = qualified.rsplit(".", 1)
        try:
            import importlib
            mod = importlib.import_module(module_path)
            provider_cls = getattr(mod, cls_name)
            provider: AuthProvider = provider_cls()
            provider.on_configure(app)

            if hasattr(provider, "enabled") and not provider.enabled:
                logger.info("Auth provider '%s' skipped (not configured)", name)
                continue

            _providers.append(provider)
            logger.info("Auth provider '%s' registered", name)
        except ImportError as e:
            logger.warning("Auth provider '%s' unavailable: %s", name, e)
        except Exception as e:
            logger.error("Auth provider '%s' failed to init: %s", name, e)

    logger.info(
        "Auth chain: [%s] + browser fallback",
        ", ".join(p.name for p in _providers),
    )


def get_identity_id() -> str:
    """获取当前请求的命名空间身份 ID。
    
    优先级：
      1. AuthProvider 链中第一个成功的 → user:<id>
      2. X-Identity-Id 头 (浏览器 UUID) → browser:<id>
    """
    # 尝试 Provider 链
    for provider in _providers:
        try:
            result = provider.authenticate(request)
            if result is not None:
                validated = _validate_identity_value(result.user_id, provider.name)
                logger.debug("Authenticated via %s: user:%s...", provider.name, validated[:8])
                # 保存完整结果供其他模块使用（如 SSO token 透传）
                request._df_auth_result = result
                return f"user:{validated}"
        except AuthenticationError as e:
            logger.warning("Auth provider '%s' rejected request: %s", e.provider, e)
            # 认证信息存在但无效 → 不回退到 browser，直接拒绝
            raise ValueError(f"Authentication failed: {e}")

    # Fallback: 浏览器身份
    client_identity = request.headers.get("X-Identity-Id")
    if client_identity:
        if ":" in client_identity:
            identity_value = client_identity.split(":", 1)[1]
        else:
            identity_value = client_identity
        validated = _validate_identity_value(identity_value, "X-Identity-Id header")
        return f"browser:{validated}"

    raise ValueError("X-Identity-Id header is required. Please refresh the page.")


def get_auth_result() -> Optional[AuthResult]:
    """获取当前请求的完整认证结果。
    
    仅在 get_identity_id() 通过 Provider 链认证成功后可用。
    browser 身份请求返回 None。
    
    用途：
    - 获取 raw_token 用于 SSO 透传
    - 获取 display_name / email 用于 UI 显示
    """
    return getattr(request, "_df_auth_result", None)


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
// src/app/oidcConfig.ts

import { UserManager, WebStorageStateStore, User } from "oidc-client-ts";

let _userManager: UserManager | null = null;

export function getOidcConfig(): {authority: string; clientId: string; redirectUri: string} | null {
    const authority = import.meta.env.VITE_OIDC_AUTHORITY;
    const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
    if (!authority || !clientId) return null;
    return {
        authority,
        clientId,
        redirectUri: import.meta.env.VITE_OIDC_REDIRECT_URI || `${window.location.origin}/callback`,
    };
}

export function getUserManager(): UserManager | null {
    if (_userManager) return _userManager;
    const config = getOidcConfig();
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
    const mgr = getUserManager();
    if (!mgr) return null;
    const user = await mgr.getUser();
    if (!user || user.expired) return null;
    return user.access_token;
}
```

修改 `App.tsx` 中的认证初始化逻辑：

```typescript
// src/app/App.tsx — 认证初始化部分 (替换现有的 /.auth/me 逻辑)

useEffect(() => {
    async function initAuth() {
        // 优先级 1: OIDC
        const oidcManager = getUserManager();
        if (oidcManager) {
            try {
                let user = await oidcManager.getUser();
                if (!user || user.expired) {
                    // 尝试静默刷新
                    try { user = await oidcManager.signinSilent(); } catch { user = null; }
                }
                if (user) {
                    setUserInfo({
                        name: user.profile.name || user.profile.preferred_username || "",
                        userId: user.profile.sub,
                    });
                    setAuthChecked(true);
                    return;
                }
            } catch (e) {
                console.warn("OIDC silent auth failed, checking Azure EasyAuth...");
            }
        }

        // 优先级 2: Azure EasyAuth (保持现有逻辑)
        try {
            const response = await fetch("/.auth/me");
            const result = await response.json();
            if (Array.isArray(result) && result.length > 0) {
                const authInfo = result[0];
                setUserInfo({
                    name: authInfo.user_claims?.find((c: any) => c.typ === "name")?.val || "",
                    userId: authInfo.user_id,
                });
            }
        } catch {
            // 非 Azure 环境，正常
        }

        // 优先级 3: 匿名浏览器身份 (现有逻辑，在 authChecked 后处理)
        setAuthChecked(true);
    }

    initAuth();
}, []);
```

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

```typescript
// src/app/OidcCallback.tsx

import { useEffect } from "react";
import { getUserManager } from "./oidcConfig";

export function OidcCallback() {
    useEffect(() => {
        const mgr = getUserManager();
        if (mgr) {
            mgr.signinRedirectCallback().then(() => {
                window.location.href = "/";
            });
        }
    }, []);

    return <div>正在完成登录...</div>;
}
```

在路由中注册回调路径（如使用 React Router）或在 `App.tsx` 中检测 URL path。

### 3.8 登录 / 登出 UI

```typescript
// 在 App.tsx 的 AppBar 中

function AuthButton() {
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const oidcManager = getUserManager();

    if (identity?.type === "user") {
        return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2">{userInfo?.name || identity.id}</Typography>
                <IconButton onClick={() => {
                    oidcManager?.signoutRedirect();
                }}>
                    <LogoutIcon />
                </IconButton>
            </Box>
        );
    }

    if (oidcManager) {
        return (
            <Button variant="outlined" size="small" onClick={() => {
                oidcManager.signinRedirect();
            }}>
                登录
            </Button>
        );
    }

    // 无 OIDC 配置 → 匿名模式，不显示登录按钮
    return null;
}
```

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

#### 3.9.3 AuthResult 扩展

为支持会话管理，`AuthResult` 需要增加序列化能力和 token 刷新来源信息：

```python
# py-src/data_formulator/auth_providers/base.py (扩展)

@dataclass
class AuthResult:
    """认证结果。"""
    user_id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    groups: Optional[list[str]] = None
    raw_token: Optional[str] = None
    provider_name: str = ""
    # ↓ 新增字段
    auth_protocol: str = ""          # "oidc" | "saml" | "ldap" | "cas" | "proxy" | "easyauth"
    token_expiry: Optional[float] = None   # Unix timestamp，session 过期时间
    extra: Optional[dict] = None           # 协议特定的额外数据 (SAML NameID format 等)

    def to_session_dict(self) -> dict:
        """序列化为可存入 Flask session 的 dict。"""
        return {
            "user_id": self.user_id,
            "display_name": self.display_name,
            "email": self.email,
            "groups": self.groups,
            "provider_name": self.provider_name,
            "auth_protocol": self.auth_protocol,
            "token_expiry": self.token_expiry,
            "extra": self.extra,
            # raw_token 不存入 session（安全考虑，OIDC token 存 CredentialVault）
        }

    @classmethod
    def from_session_dict(cls, data: dict) -> "AuthResult":
        """从 Flask session dict 反序列化。"""
        return cls(
            user_id=data["user_id"],
            display_name=data.get("display_name"),
            email=data.get("email"),
            groups=data.get("groups"),
            provider_name=data.get("provider_name", "session"),
            auth_protocol=data.get("auth_protocol", ""),
            token_expiry=data.get("token_expiry"),
            extra=data.get("extra"),
        )
```

#### 3.9.4 反向代理头 Provider（A 类 — 无状态）

适用于 Authelia、Authentik、nginx `auth_request`、Traefik ForwardAuth 等场景。反向代理在请求到达 Flask 之前已验证用户，并注入可信 header。

```python
# py-src/data_formulator/auth_providers/proxy_header.py

import logging
import os
import ipaddress
from typing import Optional
from flask import Request

from .base import AuthProvider, AuthResult

logger = logging.getLogger(__name__)


class ProxyHeaderProvider(AuthProvider):
    """反向代理头认证。
    
    当 DF 部署在已验证用户的反向代理之后时，
    代理会在请求中注入包含用户身份的 header。
    
    支持的代理:
    - Authelia:    X-Forwarded-User / X-Forwarded-Email
    - Authentik:   X-authentik-username / X-authentik-email
    - nginx:       X-Remote-User (auth_request)
    - Traefik:     X-Forwarded-User (ForwardAuth)
    
    安全考虑:
    - 这些 header 可以被客户端伪造
    - 必须确保只信任来自可信代理 IP 的请求
    - 通过 PROXY_TRUSTED_IPS 环境变量配置可信 IP 范围
    """

    def __init__(self):
        self._user_header = os.environ.get("PROXY_HEADER_USER", "X-Forwarded-User").strip()
        self._email_header = os.environ.get("PROXY_HEADER_EMAIL", "X-Forwarded-Email").strip()
        self._name_header = os.environ.get("PROXY_HEADER_NAME", "X-Forwarded-Preferred-Username").strip()
        self._groups_header = os.environ.get("PROXY_HEADER_GROUPS", "X-Forwarded-Groups").strip()

        trusted_ips_str = os.environ.get("PROXY_TRUSTED_IPS", "127.0.0.1,::1").strip()
        self._trusted_networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
        for cidr in trusted_ips_str.split(","):
            cidr = cidr.strip()
            if cidr:
                try:
                    self._trusted_networks.append(ipaddress.ip_network(cidr, strict=False))
                except ValueError:
                    logger.warning("Invalid CIDR in PROXY_TRUSTED_IPS: %s", cidr)

    @property
    def name(self) -> str:
        return "proxy_header"

    @property
    def enabled(self) -> bool:
        return bool(self._user_header)

    def _is_trusted_ip(self, remote_addr: str) -> bool:
        try:
            addr = ipaddress.ip_address(remote_addr)
            return any(addr in net for net in self._trusted_networks)
        except ValueError:
            return False

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        user_id = request.headers.get(self._user_header)
        if not user_id:
            return None

        if not self._is_trusted_ip(request.remote_addr or ""):
            logger.warning(
                "Proxy header '%s' present but remote_addr '%s' not in trusted IPs — ignoring",
                self._user_header, request.remote_addr,
            )
            return None

        return AuthResult(
            user_id=user_id.strip(),
            display_name=request.headers.get(self._name_header, "").strip() or None,
            email=request.headers.get(self._email_header, "").strip() or None,
            groups=(
                [g.strip() for g in request.headers.get(self._groups_header, "").split(",") if g.strip()]
                if request.headers.get(self._groups_header) else None
            ),
            provider_name=self.name,
            auth_protocol="proxy",
        )
```

#### 3.9.5 Session Provider（B 类通用 — 从 session 中读取身份）

这是所有有状态协议的共用 "读取端"。SAML / LDAP / CAS 的 Login Gateway 在登录成功时将 `AuthResult` 写入 Flask session，后续所有请求由 `SessionProvider` 统一读取。

```python
# py-src/data_formulator/auth_providers/session_provider.py

import logging
import time
from typing import Optional
from flask import Request, session

from .base import AuthProvider, AuthResult

logger = logging.getLogger(__name__)


class SessionProvider(AuthProvider):
    """从 Flask session 中读取已认证的用户身份。
    
    本 Provider 不做协议级别的认证，而是信任 Login Gateway
    在登录时已完成验证并存入 session 的 AuthResult。
    
    Login Gateway 包括：
    - SAML ACS endpoint   → /api/auth/saml/acs
    - LDAP login endpoint → /api/auth/ldap/login
    - CAS callback        → /api/auth/cas/callback
    
    Session 安全:
    - Flask session 默认使用签名 cookie (SecureCookieSession)
    - 生产环境应配置 SECRET_KEY、SESSION_COOKIE_SECURE=True、SESSION_COOKIE_HTTPONLY=True
    - 可选配置 Flask-Session 使用 Redis/数据库存储 server-side session
    """

    @property
    def name(self) -> str:
        return "session"

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        user_data = session.get("df_user")
        if not user_data or not isinstance(user_data, dict):
            return None

        # 检查 session 过期
        token_expiry = user_data.get("token_expiry")
        if token_expiry and time.time() > token_expiry:
            logger.info("Session expired for user %s", user_data.get("user_id", "?"))
            session.pop("df_user", None)
            return None

        result = AuthResult.from_session_dict(user_data)
        logger.debug("Session auth: user=%s via %s", result.user_id, result.auth_protocol)
        return result
```

#### 3.9.6 Login Gateway 蓝图（SAML / LDAP / CAS 的登录端点）

Login Gateway 是一组 Flask Blueprint 路由，负责完成协议特定的登录流程，并将认证结果写入 session。它们是 `SessionProvider` 的 "写入端"。

**SAML 2.0 Login Gateway：**

```python
# py-src/data_formulator/auth_gateways/saml_gateway.py

import os
import logging
import time
from flask import Blueprint, request, redirect, session, current_app
from data_formulator.auth_providers.base import AuthResult

logger = logging.getLogger(__name__)

saml_bp = Blueprint("saml_auth", __name__, url_prefix="/api/auth/saml")


def _get_saml_auth():
    """创建 OneLogin SAML2 Auth 对象。
    
    依赖: python3-saml (onelogin)
    配置文件目录由 SAML_SETTINGS_DIR 环境变量指定，
    或者使用环境变量动态构建 settings dict。
    """
    from onelogin.saml2.auth import OneLogin_Saml2_Auth
    
    req = {
        "https": "on" if request.scheme == "https" else "off",
        "http_host": request.host,
        "script_name": request.path,
        "get_data": request.args.copy(),
        "post_data": request.form.copy(),
    }
    
    settings_dir = os.environ.get("SAML_SETTINGS_DIR")
    if settings_dir:
        return OneLogin_Saml2_Auth(req, custom_base_path=settings_dir)
    
    # 通过环境变量动态构建 settings
    settings = {
        "idp": {
            "entityId": os.environ.get("SAML_IDP_ENTITY_ID", ""),
            "singleSignOnService": {
                "url": os.environ.get("SAML_IDP_SSO_URL", ""),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": os.environ.get("SAML_IDP_X509_CERT", ""),
        },
        "sp": {
            "entityId": os.environ.get("SAML_SP_ENTITY_ID", "data-formulator"),
            "assertionConsumerService": {
                "url": os.environ.get("SAML_SP_ACS_URL", ""),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
        },
        "security": {
            "wantAssertionsSigned": True,
            "wantNameIdEncrypted": False,
        },
    }
    
    # 也可以通过 IDP Metadata URL 自动配置
    idp_metadata_url = os.environ.get("SAML_IDP_METADATA_URL")
    if idp_metadata_url:
        from onelogin.saml2.idp_metadata_parser import OneLogin_Saml2_IdPMetadataParser
        idp_data = OneLogin_Saml2_IdPMetadataParser.parse_remote(idp_metadata_url)
        settings = OneLogin_Saml2_IdPMetadataParser.merge_settings(settings, idp_data)
    
    return OneLogin_Saml2_Auth(req, old_settings=settings)


@saml_bp.route("/login")
def saml_login():
    """发起 SAML 登录请求 → 重定向到 IdP。"""
    auth = _get_saml_auth()
    return redirect(auth.login())


@saml_bp.route("/acs", methods=["POST"])
def saml_acs():
    """SAML Assertion Consumer Service — 接收 IdP 的 SAML Response。"""
    auth = _get_saml_auth()
    auth.process_response()
    errors = auth.get_errors()
    
    if errors:
        logger.error("SAML ACS errors: %s", errors)
        return {"error": "SAML authentication failed", "details": errors}, 401
    
    if not auth.is_authenticated():
        return {"error": "SAML authentication failed"}, 401
    
    attrs = auth.get_attributes()
    attr_map_user = os.environ.get("SAML_ATTRIBUTE_MAP_USER", "uid")
    attr_map_email = os.environ.get("SAML_ATTRIBUTE_MAP_EMAIL", "email")
    attr_map_name = os.environ.get("SAML_ATTRIBUTE_MAP_NAME", "displayName")
    attr_map_groups = os.environ.get("SAML_ATTRIBUTE_MAP_GROUPS", "memberOf")
    
    user_id = attrs.get(attr_map_user, [auth.get_nameid()])[0]
    
    result = AuthResult(
        user_id=user_id,
        display_name=(attrs.get(attr_map_name, [None]))[0],
        email=(attrs.get(attr_map_email, [None]))[0],
        groups=attrs.get(attr_map_groups),
        provider_name="saml",
        auth_protocol="saml",
        token_expiry=time.time() + int(os.environ.get("SESSION_LIFETIME", "28800")),
        extra={"name_id": auth.get_nameid(), "session_index": auth.get_session_index()},
    )
    
    session["df_user"] = result.to_session_dict()
    logger.info("SAML login successful: user=%s", user_id)
    
    relay_state = request.form.get("RelayState", "/")
    return redirect(relay_state)


@saml_bp.route("/metadata")
def saml_metadata():
    """SP Metadata — 提供给 IdP 管理员注册时使用。"""
    auth = _get_saml_auth()
    metadata = auth.get_settings().get_sp_metadata()
    return metadata, 200, {"Content-Type": "application/xml"}
```

**LDAP Login Gateway：**

```python
# py-src/data_formulator/auth_gateways/ldap_gateway.py

import os
import logging
import time
from flask import Blueprint, request, session, jsonify
from data_formulator.auth_providers.base import AuthResult

logger = logging.getLogger(__name__)

ldap_bp = Blueprint("ldap_auth", __name__, url_prefix="/api/auth/ldap")


@ldap_bp.route("/login", methods=["POST"])
def ldap_login():
    """LDAP 账号密码登录。
    
    请求体: {"username": "...", "password": "..."}
    成功后将身份信息写入 session。
    """
    import ldap3
    
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    password = body.get("password", "")
    
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
    
    ldap_url = os.environ.get("LDAP_URL", "")
    base_dn = os.environ.get("LDAP_BASE_DN", "")
    use_tls = os.environ.get("LDAP_TLS", "true").lower() in ("true", "1", "yes")
    
    # 两种 bind 模式
    dn_template = os.environ.get("LDAP_USER_DN_TEMPLATE")  # 直接 bind
    search_filter_tpl = os.environ.get("LDAP_SEARCH_FILTER")  # 先搜索再 bind
    bind_dn = os.environ.get("LDAP_BIND_DN")  # 搜索用只读账号
    bind_password = os.environ.get("LDAP_BIND_PASSWORD")
    
    try:
        server = ldap3.Server(ldap_url, use_ssl=use_tls, get_info=ldap3.ALL)
        
        if search_filter_tpl and bind_dn:
            # 模式 A: 先用只读账号搜索用户 DN，再用用户密码 bind
            conn = ldap3.Connection(server, user=bind_dn, password=bind_password, auto_bind=True)
            search_filter = search_filter_tpl.replace("{}", ldap3.utils.conv.escape_filter_chars(username))
            conn.search(base_dn, search_filter, attributes=["cn", "mail", "memberOf", "displayName"])
            
            if not conn.entries:
                return jsonify({"error": "User not found"}), 401
            
            user_entry = conn.entries[0]
            user_dn = str(user_entry.entry_dn)
            conn.unbind()
            
            # 用用户密码 bind 验证
            user_conn = ldap3.Connection(server, user=user_dn, password=password, auto_bind=True)
            user_conn.unbind()
            
        elif dn_template:
            # 模式 B: 直接用 DN 模板 bind
            user_dn = dn_template.replace("{}", username)
            conn = ldap3.Connection(server, user=user_dn, password=password, auto_bind=True)
            conn.search(base_dn, f"(distinguishedName={user_dn})",
                       attributes=["cn", "mail", "memberOf", "displayName"])
            user_entry = conn.entries[0] if conn.entries else None
            conn.unbind()
        else:
            return jsonify({"error": "LDAP not configured (missing DN_TEMPLATE or SEARCH_FILTER)"}), 500
        
    except ldap3.core.exceptions.LDAPBindError:
        return jsonify({"error": "Invalid credentials"}), 401
    except Exception as e:
        logger.error("LDAP error: %s", e)
        return jsonify({"error": "LDAP server error"}), 500
    
    display_name = str(getattr(user_entry, "displayName", "")) if user_entry else None
    email = str(getattr(user_entry, "mail", "")) if user_entry else None
    groups = [str(g) for g in getattr(user_entry, "memberOf", [])] if user_entry else None
    
    result = AuthResult(
        user_id=username,
        display_name=display_name or None,
        email=email or None,
        groups=groups,
        provider_name="ldap",
        auth_protocol="ldap",
        token_expiry=time.time() + int(os.environ.get("SESSION_LIFETIME", "28800")),
    )
    
    session["df_user"] = result.to_session_dict()
    logger.info("LDAP login successful: user=%s", username)
    
    return jsonify({"ok": True, "user_id": username, "display_name": display_name})
```

**CAS Login Gateway（示例骨架）：**

```python
# py-src/data_formulator/auth_gateways/cas_gateway.py

import os
import logging
import time
import urllib.request
import urllib.parse
from flask import Blueprint, request, redirect, session, jsonify
from data_formulator.auth_providers.base import AuthResult

logger = logging.getLogger(__name__)

cas_bp = Blueprint("cas_auth", __name__, url_prefix="/api/auth/cas")


@cas_bp.route("/login")
def cas_login():
    """重定向到 CAS 登录页。"""
    cas_url = os.environ.get("CAS_SERVER_URL", "").rstrip("/")
    service_url = os.environ.get("CAS_SERVICE_URL", request.url_root.rstrip("/") + "/api/auth/cas/callback")
    return redirect(f"{cas_url}/login?service={urllib.parse.quote(service_url)}")


@cas_bp.route("/callback")
def cas_callback():
    """CAS ticket 验证回调。"""
    ticket = request.args.get("ticket")
    if not ticket:
        return jsonify({"error": "No CAS ticket"}), 400
    
    cas_url = os.environ.get("CAS_SERVER_URL", "").rstrip("/")
    service_url = os.environ.get("CAS_SERVICE_URL", request.url_root.rstrip("/") + "/api/auth/cas/callback")
    validate_url = f"{cas_url}/serviceValidate?ticket={ticket}&service={urllib.parse.quote(service_url)}"
    
    # CAS 3.0 protocol — XML response
    from xml.etree import ElementTree
    with urllib.request.urlopen(validate_url, timeout=10) as resp:
        tree = ElementTree.parse(resp)
    
    ns = {"cas": "http://www.yale.edu/tp/cas"}
    success = tree.find(".//cas:authenticationSuccess", ns)
    if success is None:
        return jsonify({"error": "CAS ticket validation failed"}), 401
    
    user_id = success.findtext("cas:user", default="", namespaces=ns).strip()
    attrs_el = success.find("cas:attributes", ns)
    
    email = attrs_el.findtext("cas:email", namespaces=ns) if attrs_el is not None else None
    display_name = attrs_el.findtext("cas:displayName", namespaces=ns) if attrs_el is not None else None
    
    result = AuthResult(
        user_id=user_id,
        display_name=display_name,
        email=email,
        provider_name="cas",
        auth_protocol="cas",
        token_expiry=time.time() + int(os.environ.get("SESSION_LIFETIME", "28800")),
    )
    
    session["df_user"] = result.to_session_dict()
    logger.info("CAS login successful: user=%s", user_id)
    
    return redirect("/")
```

#### 3.9.7 通用登出端点

```python
# py-src/data_formulator/auth_gateways/logout.py

from flask import Blueprint, session, jsonify, redirect
import os

logout_bp = Blueprint("auth_logout", __name__, url_prefix="/api/auth")


@logout_bp.route("/logout", methods=["POST"])
def logout():
    """通用登出 — 清除 session，返回协议特定的 SLO URL（如有）。"""
    user_data = session.pop("df_user", None)
    protocol = user_data.get("auth_protocol", "") if user_data else ""
    
    slo_url = None
    if protocol == "saml":
        slo_url = os.environ.get("SAML_SLO_URL")
    elif protocol == "cas":
        cas_url = os.environ.get("CAS_SERVER_URL", "").rstrip("/")
        if cas_url:
            slo_url = f"{cas_url}/logout"
    
    return jsonify({"ok": True, "slo_url": slo_url})
```

#### 3.9.8 更新后的 auth.py — provider_registry 与 gateway 注册

```python
# auth.py — init_auth() 更新 (仅展示变化部分)

def init_auth(app: Flask) -> None:
    # ... 前面逻辑不变 ...

    provider_registry = {
        "azure_easyauth": "data_formulator.auth_providers.azure_easyauth.AzureEasyAuthProvider",
        "oidc":           "data_formulator.auth_providers.oidc.OIDCProvider",
        "proxy_header":   "data_formulator.auth_providers.proxy_header.ProxyHeaderProvider",     # ← 新增
        "session":        "data_formulator.auth_providers.session_provider.SessionProvider",      # ← 新增
    }
    
    # ... Provider 加载逻辑不变 ...
    
    # 注册 Login Gateway Blueprints（按需）
    _register_login_gateways(app)


def _register_login_gateways(app: Flask) -> None:
    """按环境变量按需注册有状态协议的登录端点。"""
    
    # 始终注册通用登出端点
    from data_formulator.auth_gateways.logout import logout_bp
    app.register_blueprint(logout_bp)
    
    # SAML — 当配置存在时
    if os.environ.get("SAML_ENABLED", "").lower() in ("true", "1", "yes"):
        try:
            from data_formulator.auth_gateways.saml_gateway import saml_bp
            app.register_blueprint(saml_bp)
            logger.info("SAML login gateway registered")
        except ImportError as e:
            logger.warning("SAML gateway unavailable (install python3-saml): %s", e)
    
    # LDAP — 当配置存在时
    if os.environ.get("LDAP_ENABLED", "").lower() in ("true", "1", "yes"):
        try:
            from data_formulator.auth_gateways.ldap_gateway import ldap_bp
            app.register_blueprint(ldap_bp)
            logger.info("LDAP login gateway registered")
        except ImportError as e:
            logger.warning("LDAP gateway unavailable (install ldap3): %s", e)
    
    # CAS — 当配置存在时
    if os.environ.get("CAS_ENABLED", "").lower() in ("true", "1", "yes"):
        try:
            from data_formulator.auth_gateways.cas_gateway import cas_bp
            app.register_blueprint(cas_bp)
            logger.info("CAS login gateway registered")
        except ImportError as e:
            logger.warning("CAS gateway unavailable: %s", e)
```

#### 3.9.9 前端适配：统一登录入口

前端需要知道当前可用的登录方式，并渲染对应的 UI（OIDC 按钮、LDAP 登录表单、SAML 重定向按钮等）。

**后端提供可用登录方式的 API：**

```python
# auth.py — 新增

@app.route("/api/auth/methods")
def auth_methods():
    """返回当前启用的登录方式，供前端渲染登录 UI。"""
    methods = []
    
    if os.environ.get("OIDC_ISSUER_URL"):
        methods.append({
            "type": "oidc",
            "label": os.environ.get("OIDC_DISPLAY_NAME", "SSO 登录"),
            "action": "frontend",  # 前端处理 PKCE 流程
        })
    
    if os.environ.get("SAML_ENABLED", "").lower() in ("true", "1", "yes"):
        methods.append({
            "type": "saml",
            "label": os.environ.get("SAML_DISPLAY_NAME", "企业 SSO (SAML)"),
            "action": "redirect",
            "url": "/api/auth/saml/login",
        })
    
    if os.environ.get("LDAP_ENABLED", "").lower() in ("true", "1", "yes"):
        methods.append({
            "type": "ldap",
            "label": os.environ.get("LDAP_DISPLAY_NAME", "域账号登录"),
            "action": "form",
            "url": "/api/auth/ldap/login",
            "fields": ["username", "password"],
        })
    
    if os.environ.get("CAS_ENABLED", "").lower() in ("true", "1", "yes"):
        methods.append({
            "type": "cas",
            "label": os.environ.get("CAS_DISPLAY_NAME", "CAS 登录"),
            "action": "redirect",
            "url": "/api/auth/cas/login",
        })
    
    return jsonify({"methods": methods})
```

**前端统一登录组件：**

```typescript
// src/app/LoginPanel.tsx

interface AuthMethod {
    type: string;
    label: string;
    action: "frontend" | "redirect" | "form";
    url?: string;
    fields?: string[];
}

function LoginPanel() {
    const [methods, setMethods] = useState<AuthMethod[]>([]);
    const [ldapForm, setLdapForm] = useState({ username: "", password: "" });
    const oidcManager = getUserManager();

    useEffect(() => {
        fetch("/api/auth/methods")
            .then(r => r.json())
            .then(data => setMethods(data.methods || []));
    }, []);

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, p: 3 }}>
            {methods.map(m => {
                switch (m.action) {
                    case "frontend":
                        // OIDC — 前端 PKCE 流程
                        return (
                            <Button key={m.type} variant="contained" onClick={() => {
                                oidcManager?.signinRedirect();
                            }}>
                                {m.label}
                            </Button>
                        );

                    case "redirect":
                        // SAML / CAS — 浏览器重定向
                        return (
                            <Button key={m.type} variant="outlined" onClick={() => {
                                window.location.href = m.url!;
                            }}>
                                {m.label}
                            </Button>
                        );

                    case "form":
                        // LDAP — 用户名密码表单
                        return (
                            <Box key={m.type} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                <Typography variant="subtitle2">{m.label}</Typography>
                                <TextField
                                    size="small" label="用户名"
                                    value={ldapForm.username}
                                    onChange={e => setLdapForm(f => ({...f, username: e.target.value}))}
                                />
                                <TextField
                                    size="small" label="密码" type="password"
                                    value={ldapForm.password}
                                    onChange={e => setLdapForm(f => ({...f, password: e.target.value}))}
                                />
                                <Button variant="outlined" onClick={async () => {
                                    const resp = await fetch(m.url!, {
                                        method: "POST",
                                        headers: {"Content-Type": "application/json"},
                                        body: JSON.stringify(ldapForm),
                                    });
                                    if (resp.ok) window.location.reload();
                                }}>
                                    登录
                                </Button>
                            </Box>
                        );
                }
            })}
        </Box>
    );
}
```

**前端 `initAuth` 增强（支持 session 认证）：**

```typescript
// src/app/App.tsx — initAuth 更新 (新增 session 检测)

useEffect(() => {
    async function initAuth() {
        // 优先级 1: OIDC (前端无状态 JWT)
        const oidcManager = getUserManager();
        if (oidcManager) {
            try {
                let user = await oidcManager.getUser();
                if (!user || user.expired) {
                    try { user = await oidcManager.signinSilent(); } catch { user = null; }
                }
                if (user) {
                    setUserInfo({ name: user.profile.name || "", userId: user.profile.sub });
                    setAuthChecked(true);
                    return;
                }
            } catch (e) {
                console.warn("OIDC silent auth failed");
            }
        }

        // 优先级 2: Azure EasyAuth
        try {
            const response = await fetch("/.auth/me");
            const result = await response.json();
            if (Array.isArray(result) && result.length > 0) {
                setUserInfo({ name: result[0].user_claims?.find((c: any) => c.typ === "name")?.val || "", userId: result[0].user_id });
                setAuthChecked(true);
                return;
            }
        } catch { /* 非 Azure 环境 */ }

        // 优先级 3: 检查 session (SAML/LDAP/CAS 登录后会有 session)   ← 新增
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
        } catch { /* 无 session */ }

        // 优先级 4: 匿名浏览器身份
        setAuthChecked(true);
    }
    initAuth();
}, []);
```

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
            "auth_protocol": user_data.get("auth_protocol"),
        })
    return jsonify({}), 401
```

#### 3.9.10 完整 AuthProvider 链图

更新后的 Provider 链支持无状态和有状态双轨：

```
AuthProvider 链 — 顺序由 AUTH_PROVIDERS 环境变量控制
AUTH_PROVIDERS=azure_easyauth,oidc,proxy_header,session

  ┌──────────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────────┐
  │ Azure        │ →  │ OIDC     │ →  │ Proxy Header │ →  │ Session  │ →  │ Browser UUID │
  │ EasyAuth     │    │ (JWT)    │    │ (可信头)     │    │ (Cookie) │    │ (最终回退)   │
  │              │    │          │    │              │    │          │    │              │
  │ 读: X-MS-*   │    │ 读: Auth │    │ 读: X-Fwd-* │    │ 读:      │    │ 读: X-Id-Id  │
  │ 头           │    │ Bearer   │    │ 头           │    │ session  │    │ 头           │
  │              │    │ 头       │    │              │    │ cookie   │    │              │
  │ 无状态       │    │ 无状态   │    │ 无状态       │    │ 有状态   │    │ 无状态       │
  └──────────────┘    └──────────┘    └──────────────┘    └──────┬───┘    └──────────────┘
                                                               │
                                              session 中的身份来自:
                                              ┌────────────────┐
                                              │ Login Gateway  │
                                              │ ├── SAML ACS   │
                                              │ ├── LDAP login  │
                                              │ ├── CAS callback│
                                              │ └── (未来...)   │
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
                "env_prefix": "SUPERSET",
                "required_env": ["SUPERSET_URL"],
                "optional_env": ["SUPERSET_TIMEOUT"],
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

> **注意**：AuthProvider 保持硬编码列表 + `AUTH_PROVIDERS` 环境变量控制顺序。
> 因为认证是**链式**的（顺序决定优先级，是安全关键），不适合自动扫描的不确定顺序。
> DataSourcePlugin 是**并行**的（所有插件同时存在，顺序无关），适合自动扫描。

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
│                          → manifest(): required_env=["SUPERSET_URL"]
│                          → os.environ["SUPERSET_URL"] 存在? 
│                            → 是 → 实例化 → 注册 Blueprint → ENABLED ✅
│                            → 否 → DISABLED (Not configured)
├── metabase/            ← ispkg=True
│   └── __init__.py      → plugin_class = MetabasePlugin
│                          → manifest(): required_env=["METABASE_URL"]
│                          → os.environ["METABASE_URL"] 不存在
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
GRAFANA_URL=http://grafana.example.com:3000
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
| 协作模式 | 并行（顺序无关） | 链式（顺序=优先级，安全关键） |
| 注册方式 | 目录自动扫描 | 硬编码 `provider_registry` + `AUTH_PROVIDERS` 环境变量 |
| 新增方式 | 创建目录即可 | 写代码 + 注册表加一行 + 环境变量声明顺序 |
| 理由 | 插件多、频繁新增、顺序不影响行为 | Provider 少、很少新增、顺序决定安全行为 |

这种差异化设计是有意为之：**并行的东西自动发现，链式的东西显式控制**。

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

export interface PluginPanelProps {
    pluginId: string;
    config: Record<string, any>;
    ssoToken: string | null;    // 用户的 SSO token (如果有)，插件可用于透传
    onDataLoaded: (result: {
        tableName: string;
        rowCount: number;
        columns: string[];
        source: "workspace" | "json";
        rows?: any[];
    }) => void;
}

export interface DataSourcePluginModule {
    manifest: PluginManifest;
    PanelComponent: React.ComponentType<PluginPanelProps>;
    LoginComponent?: React.ComponentType<{
        config: Record<string, any>;
        ssoToken: string | null;
        onLoginSuccess: () => void;
    }>;
}
```

```typescript
// src/plugins/registry.ts

import { DataSourcePluginModule } from "./types";

const pluginLoaders: Record<string, () => Promise<DataSourcePluginModule>> = {
    superset: () => import("./superset").then((m) => m.default),
    metabase: () => import("./metabase").then((m) => m.default),
    // powerbi: () => import("./powerbi").then((m) => m.default),
};

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
        return bool(os.environ.get("SUPERSET_SSO_ENABLED", "").lower() == "true")

    def _get_superset_token_via_sso(self, sso_token: str) -> Optional[str]:
        """用 DF 用户的 SSO token 获取 Superset 的 access token。"""
        superset_url = os.environ["SUPERSET_URL"]

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

### 8.3 简化后的 IdentityStore（可选，仅用于 browser → user 迁移）

当一个匿名用户（`browser:xxx`）首次通过 SSO 登录时，可能希望将之前匿名状态下创建的数据迁移到新的 `user:xxx` 身份下。这是一个**一次性迁移**，比原方案中的"多外部系统身份链接与合并"简单得多。

```python
# py-src/data_formulator/identity_migration.py

import logging
from typing import Optional

from data_formulator.workspace_factory import get_workspace

logger = logging.getLogger(__name__)


def migrate_browser_to_user(browser_id: str, user_id: str) -> dict:
    """将匿名浏览器身份的数据迁移到已认证用户身份。
    
    一次性操作：用户首次 SSO 登录时调用。
    
    Args:
        browser_id: "browser:xxx"
        user_id: "user:alice@corp.com"
    
    Returns:
        {"migrated_tables": [...], "status": "ok"}
    """
    browser_ws = get_workspace(browser_id)
    user_ws = get_workspace(user_id)

    browser_tables = browser_ws.list_tables()
    if not browser_tables:
        return {"migrated_tables": [], "status": "ok"}

    user_tables = set(user_ws.list_tables())
    migrated = []

    for table_name in browser_tables:
        target_name = table_name
        counter = 1
        while target_name in user_tables:
            target_name = f"{table_name}_{counter}"
            counter += 1

        # 复制 parquet 文件
        arrow_table = browser_ws.read_parquet_as_arrow(table_name)
        meta = browser_ws.get_table_metadata(table_name)
        user_ws.write_parquet_from_arrow(
            arrow_table, target_name,
            loader_metadata=meta.get("loader_metadata"),
        )
        user_tables.add(target_name)
        migrated.append({"from": table_name, "to": target_name})

    logger.info(
        "Migrated %d tables from %s to %s",
        len(migrated), browser_id, user_id,
    )
    return {"migrated_tables": migrated, "status": "ok"}
```

前端在 SSO 登录成功后检查：

```typescript
// App.tsx — SSO 登录后的数据迁移

useEffect(() => {
    if (!authChecked || !userInfo?.userId) return;

    const previousBrowserId = localStorage.getItem("df_browser_id");
    const migrationDone = localStorage.getItem(`df_migration_done_${userInfo.userId}`);

    if (previousBrowserId && !migrationDone) {
        // 首次 SSO 登录，询问是否迁移匿名数据
        fetchWithIdentity("/api/identity/check-migration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ browser_id: `browser:${previousBrowserId}` }),
        })
            .then((r) => r.json())
            .then((data) => {
                if (data.has_data) {
                    // 显示迁移对话框
                    setShowMigrationDialog(true);
                } else {
                    localStorage.setItem(`df_migration_done_${userInfo.userId}`, "true");
                }
            });
    }
}, [authChecked, userInfo?.userId]);
```

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
# 认证设置
# --------------------------------------------------------------
# 认证 Provider 链（逗号分隔，按优先级排列）
# 可选值: azure_easyauth, oidc, proxy_header, session
# 未配置的 Provider 会自动跳过
AUTH_PROVIDERS=azure_easyauth,oidc,session

# ─── OIDC 配置 ───
# 当 AUTH_PROVIDERS 包含 oidc 时生效
OIDC_ISSUER_URL=https://keycloak.example.com/realms/my-org
OIDC_CLIENT_ID=data-formulator
OIDC_AUDIENCE=data-formulator
# 可选：自定义 claim 映射
# OIDC_USER_ID_CLAIM=sub
# OIDC_NAME_CLAIM=name
# OIDC_EMAIL_CLAIM=email
# OIDC_GROUPS_CLAIM=groups

# 前端 OIDC 配置（Vite 编译时注入）
VITE_OIDC_AUTHORITY=https://keycloak.example.com/realms/my-org
VITE_OIDC_CLIENT_ID=data-formulator
VITE_OIDC_REDIRECT_URI=https://df.example.com/callback

# ─── 反向代理头认证 ───
# 当 AUTH_PROVIDERS 包含 proxy_header 时生效
# 适用于 Authelia / Authentik / nginx auth_request / Traefik ForwardAuth
# PROXY_HEADER_USER=X-Forwarded-User
# PROXY_HEADER_EMAIL=X-Forwarded-Email
# PROXY_HEADER_NAME=X-Forwarded-Preferred-Username
# PROXY_HEADER_GROUPS=X-Forwarded-Groups
# PROXY_TRUSTED_IPS=127.0.0.1,10.0.0.0/8    # 仅信任来自这些 IP 的头

# ─── SAML 2.0 配置 ───
# SAML 使用 session 机制：用户通过 SAML 登录后，后端建立内部会话
# 当 AUTH_PROVIDERS 包含 session 时，需要同时配置 SAML 登录网关
# SAML_ENABLED=true
# SAML_IDP_METADATA_URL=https://idp.example.com/metadata
# SAML_SP_ENTITY_ID=data-formulator
# SAML_SP_ACS_URL=https://df.example.com/api/auth/saml/acs
# SAML_ATTRIBUTE_MAP_USER=uid
# SAML_ATTRIBUTE_MAP_EMAIL=email
# SAML_ATTRIBUTE_MAP_NAME=displayName

# ─── LDAP 配置 ───
# LDAP 同样使用 session 机制：用户名密码登录后，后端 LDAP bind 验证，建立内部会话
# LDAP_ENABLED=true
# LDAP_URL=ldap://ldap.example.com:389
# LDAP_BASE_DN=dc=example,dc=com
# LDAP_USER_DN_TEMPLATE=uid={},ou=users,dc=example,dc=com
# LDAP_SEARCH_FILTER=(uid={})
# LDAP_TLS=true
# LDAP_BIND_DN=cn=readonly,dc=example,dc=com   # 搜索用的只读账号
# LDAP_BIND_PASSWORD=secret

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
# Superset (配置了 SUPERSET_URL 即自动启用)
SUPERSET_URL=http://superset.example.com:8088
SUPERSET_SSO_ENABLED=true     # 启用 SSO token 透传到 Superset
# SUPERSET_TIMEOUT=30          # API 超时秒数 (可选)

# Metabase (配置了 METABASE_URL 即自动启用)
# METABASE_URL=http://metabase.example.com:3000

# Power BI (配置了 POWERBI_TENANT_ID 即自动启用)
# POWERBI_TENANT_ID=your-tenant-id
# POWERBI_CLIENT_ID=your-client-id

# --------------------------------------------------------------
# Workspace 存储
# --------------------------------------------------------------
# WORKSPACE_BACKEND=local
# AZURE_BLOB_CONNECTION_STRING=
# AZURE_BLOB_ACCOUNT_URL=
```

### 9.2 最小配置（本地匿名使用）

```bash
# 最小配置 — 本地使用，无 SSO，无插件
DEEPSEEK_ENABLED=true
DEEPSEEK_ENDPOINT=openai
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODELS=deepseek-chat
```

### 9.3 团队部署配置（SSO + Superset）

```bash
# 团队部署 — SSO + Superset
AUTH_PROVIDERS=oidc
OIDC_ISSUER_URL=https://keycloak.internal:8443/realms/team
OIDC_CLIENT_ID=data-formulator
VITE_OIDC_AUTHORITY=https://keycloak.internal:8443/realms/team
VITE_OIDC_CLIENT_ID=data-formulator

CREDENTIAL_VAULT=local
CREDENTIAL_VAULT_KEY=<generated-fernet-key>

SUPERSET_URL=http://superset.internal:8088
SUPERSET_SSO_ENABLED=true

DEEPSEEK_ENABLED=true
DEEPSEEK_ENDPOINT=openai
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODELS=deepseek-chat
```

---

## 10. 目录结构

### 10.1 后端新增文件

```
py-src/data_formulator/
├── auth.py                              # 重构：AuthProvider 链
├── auth_providers/                      # 新增：认证提供者
│   ├── __init__.py
│   ├── base.py                          # AuthProvider / AuthResult 基类
│   ├── azure_easyauth.py               # Azure EasyAuth (迁移现有逻辑)
│   └── oidc.py                         # 通用 OIDC Provider ★
├── credential_vault/                    # 新增：凭证保险箱
│   ├── __init__.py                     # get_credential_vault() 工厂
│   ├── base.py                         # CredentialVault 抽象接口
│   └── local_vault.py                  # SQLite + Fernet 加密实现
├── credential_routes.py                 # 新增：凭证管理 API
├── identity_migration.py               # 新增：browser→user 数据迁移
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
│   └── App.tsx                         # 修改：OIDC 初始化 + 数据迁移 + 登录UI
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
| `py-src/.../auth.py` | 重构 | ~80 行 | AuthProvider 链替换硬编码优先级 |
| `py-src/.../app.py` | 修改 | ~25 行 | 调用 `init_auth()`、`discover_and_register()`、注册 credential/identity blueprint、`app-config` 返回 plugins |
| `src/app/App.tsx` | 修改 | ~40 行 | OIDC 初始化替换 `/.auth/me`、登录/登出 UI、数据迁移 |
| `src/app/utils.tsx` | 修改 | ~10 行 | `fetchWithIdentity` 携带 Bearer token |
| `src/app/dfSlice.tsx` | 修改 | ~5 行 | `ServerConfig` 增加 `plugins` 字段 |
| `src/app/identity.ts` | 修改 | ~5 行 | 增加 `setBrowserId()` |
| `src/views/UnifiedDataUploadDialog.tsx` | 修改 | ~20 行 | 导入 PluginHost，渲染插件 Tab |

---

## 11. 实施路径

### Phase 1：认证基础 (AuthProvider 链)

**目标**：将现有 `auth.py` 重构为可插拔的 Provider 链，激活 OIDC Provider。

**交付物**：
- `auth_providers/base.py` — 基类
- `auth_providers/azure_easyauth.py` — 迁移现有 Azure 逻辑
- `auth_providers/oidc.py` — 通用 OIDC 验签
- `auth.py` 重构 — Provider 链 + `init_auth()`
- `src/app/oidcConfig.ts` — 前端 OIDC 配置
- `src/app/OidcCallback.tsx` — 回调页面
- `App.tsx` 修改 — OIDC 登录流程
- `utils.tsx` 修改 — Bearer token

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
- 配置 `SUPERSET_URL` 后，前端自动显示 Superset Tab
- 用户可以登录 Superset、浏览数据集、加载数据
- SSO 模式下，用户无需再次输入 Superset 密码
- 不配置 `SUPERSET_URL` 时，无任何影响

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
- `_PLUGIN_SPECS` 加一行、`pluginLoaders` 加一行
- **核心代码零修改**

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

所有 BI 系统都有 REST API，插件通过 `requests` 库调用即可。不需要专用 SDK。如果某个系统需要特殊的 Python 包，在 `_PLUGIN_SPECS` 中声明依赖，缺失时自动降级为 `DISABLED_PLUGINS`（与 `ExternalDataLoader` 的机制一致）。

### Q5: 如何开发一个新的数据源插件？

**最小步骤**：

1. 创建 `py-src/data_formulator/plugins/your_system/` 目录
2. 实现 `DataSourcePlugin` 子类 (manifest + blueprint + frontend_config)
3. 在 blueprint 中实现 `auth/login`, `catalog/list`, `data/load` 三组路由
4. 创建 `src/plugins/your_system/` 目录
5. 实现 `PanelComponent` (列表浏览 + 加载按钮)
6. 在 `_PLUGIN_SPECS` 加一行，在 `pluginLoaders` 加一行
7. 在 `.env` 中设置环境变量启用

**核心代码改动：0 行。**

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
  □ plugins/your_system/__init__.py — 实现 DataSourcePlugin
  □ plugins/your_system/routes/ — auth, catalog, data 三组路由
  □ plugins/your_system/ — API client, auth bridge 等
  □ plugins/__init__.py — 在 _PLUGIN_SPECS 加一行
  □ 测试：启用/禁用切换正常

□ 前端
  □ src/plugins/your_system/index.ts — 导出 DataSourcePluginModule
  □ src/plugins/your_system/*Panel.tsx — 主面板组件
  □ src/plugins/your_system/*Login.tsx — 登录组件 (如需要)
  □ src/plugins/registry.ts — 在 pluginLoaders 加一行
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
