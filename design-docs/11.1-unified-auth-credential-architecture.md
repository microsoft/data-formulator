# 12. 统一认证与凭证管理架构（融合方案）

> 状态：设计阶段  
> 创建日期：2026-04-23  
> 关联：`9-generalized-data-source-plugins.md`、`11-auth-architecture-frontend-vs-backend.md`  
> 取代：`docs-cn/5-datasource_plugin-development-guide.md`（已过时）

---

## 1. 设计原则

本方案融合两代架构的优势，形成统一的凭证管理体系：

| 来源 | 保留的设计思想 | 融合方式 |
|------|--------------|---------|
| 新架构 (DataConnector) | 统一接口 `get_access()`、声明式 `auth_config`、Agent 优先 | 作为主体框架 |
| 新架构 (文档 11) | TokenStore 分层、后端 Confidential Client、`auth_config` 声明式 | 作为凭证管理核心 |
| 旧架构 (Plugin) | 三模式协商优先级链 | 融入 TokenStore 的凭证解析策略 |
| 旧架构 (Plugin) | 核心代码零修改原则 | Loader 目录自动发现 |
| 旧架构 (Plugin) | PluginDataWriter 封装 | 保留为独立工具类 |
| 旧架构 (Plugin) | Vault 生命周期自动管理 | 融入 TokenStore 的 store/clear 逻辑 |
| 旧架构 (Plugin) | 弹窗 postMessage 委托登录 | 作为 TokenStore 的降级获取策略 |
| 旧架构 (Plugin) | 上线检查 Checklist | 适配新架构后保留 |

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            DF 前端                                      │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────────┐ │
│  │ AuthButton   │  │ DBTable      │  │ Agent Chat UI                  │ │
│  │ (SSO Login)  │  │ Manager      │  │ (授权提示 + 弹窗触发)           │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────────────┘ │
│         │                 │                       │                      │
│         │  ┌──────────────┴───────────────────────┘                      │
│         │  │                                                             │
│         ▼  ▼                                                             │
│  ┌────────────────────────────────────┐  ┌─────────────────────────────┐ │
│  │ fetchWithIdentity()               │  │ 弹窗委托登录                  │ │
│  │ → Session Cookie (后端模式)        │  │ window.open → postMessage    │ │
│  │ → Bearer Token (前端降级模式)      │  │ → POST /api/auth/tokens/save │ │
│  └──────────────┬─────────────────────┘  └──────────┬──────────────────┘ │
│                 │                                    │                    │
└─────────────────┼────────────────────────────────────┼────────────────────┘
                  │                                    │
                  ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            DF 后端                                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     TokenStore（统一凭证层）                      │    │
│  │                                                                 │    │
│  │  get_access(user_id, system_id) → str | dict | None             │    │
│  │                                                                 │    │
│  │  凭证解析优先级链：                                              │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │ ① 缓存命中     Session 中有未过期的目标系统 token         │   │    │
│  │  │ ② 自动续期     用目标系统的 refresh_token 续期            │   │    │
│  │  │ ③ SSO 换票     用 SSO token 调目标系统 token-exchange    │   │    │
│  │  │ ④ 弹窗委托     前端已通过弹窗获取并存入的 token           │   │    │
│  │  │ ⑤ Vault 凭据   从 CredentialVault 取静态凭据并登录       │   │    │
│  │  │ ⑥ 无凭证       返回 None → 通知前端需要用户操作           │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  └──────────┬──────────────────────────────────────────────────────┘    │
│             │                                                           │
│  ┌──────────┴──────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │    │
│  │  │ DataConnector │  │ Agent        │  │ /api/auth/* 路由      │  │    │
│  │  │ (数据连接)     │  │ (自动分析)    │  │ (登录/回调/状态)      │  │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘  │    │
│  │         │                 │                                     │    │
│  │         ▼                 ▼                                     │    │
│  │  ┌──────────────────────────────────────────────────────────┐  │    │
│  │  │ ExternalDataLoader (各系统实现)                            │  │    │
│  │  │ SupersetLoader / MetabaseLoader / MySQLLoader / ...       │  │    │
│  │  └──────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────┐   │
│  │ CredentialVault  │  │ Flask Session   │  │ SSO (y-sso-system)    │   │
│  │ (静态凭据加密)    │  │ (动态 token)    │  │ (Confidential Client) │   │
│  └─────────────────┘  └─────────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. TokenStore 详细设计

### 3.1 凭证解析优先级链

融合旧架构的三模式协商与新架构的分层 Tier，形成六级优先级链：

```
get_access(user_id, "superset") 被调用
  │
  ├─ ① 缓存命中
  │   Session 中有 service_tokens.superset，且未过期
  │   → 直接返回 access_token
  │
  ├─ ② 自动续期
  │   Session 中有 service_tokens.superset.refresh_token
  │   → POST 目标系统的 token_url (grant_type=refresh_token)
  │   → 成功：更新缓存，返回新 access_token
  │   → 失败：继续
  │
  ├─ ③ SSO 换票（auth_config.mode == "sso_exchange" 时）
  │   从 Session 取 SSO access_token
  │   → POST 目标系统的 exchange_url
  │   → 成功：缓存结果，返回 access_token
  │   → 失败：继续
  │
  ├─ ④ 弹窗委托凭证（auth_config.mode == "delegated" 时）
  │   Session 中有前端通过弹窗 postMessage 存入的 token
  │   → 检查是否过期
  │   → 未过期：返回 access_token
  │   → 已过期：尝试 refresh（回到 ②），失败则继续
  │
  ├─ ⑤ Vault 静态凭据（auth_config.mode == "credentials" 时）
  │   从 CredentialVault 取加密存储的凭据
  │   → 调用 Loader 的 test_connection() 验证
  │   → 有效：返回凭据 dict
  │   → 失效：标记 vault_stale，继续
  │
  └─ ⑥ 无凭证
      返回 None
      附带 requires_user_action=True 和 available_strategies
      → 前端据此决定弹窗/表单/提示
```

### 3.2 TokenStore 接口

```python
# auth/token_store.py

from __future__ import annotations
import os, time, logging
from typing import Any, Optional
from flask import session

logger = logging.getLogger(__name__)

# Session 中的命名空间
_SSO_NS = "sso"
_SVC_NS = "service_tokens"


class TokenStore:
    """Unified credential manager for all third-party systems.

    Resolves credentials through a priority chain:
    cached → refresh → sso_exchange → delegated → vault → none.

    All callers (Agent, DataConnector, routes) use the same interface.
    """

    # ── 核心接口 ──────────────────────────────────────────────

    def get_access(self, system_id: str) -> str | dict | None:
        """Get the best available credential for a system.

        Returns an access_token string, a credentials dict, or None.
        """
        config = self._get_auth_config(system_id)
        if not config:
            return None

        # ① Cached token
        cached = self._get_cached(system_id)
        if cached and not self._is_expired(cached):
            return cached["access_token"]

        # ② Refresh
        if cached and cached.get("refresh_token"):
            refreshed = self._do_refresh(system_id, cached, config)
            if refreshed:
                return refreshed

        # ③ SSO Exchange
        if config.get("mode") == "sso_exchange":
            exchanged = self._do_sso_exchange(system_id, config)
            if exchanged:
                return exchanged

        # ④ Delegated (popup-acquired token already stored)
        if config.get("mode") == "delegated":
            delegated = self._get_cached(system_id)
            if delegated and not self._is_expired(delegated):
                return delegated["access_token"]

        # ⑤ Vault credentials
        vault_result = self._try_vault(system_id, config)
        if vault_result:
            return vault_result

        # ⑥ None
        return None

    def get_sso_token(self) -> str | None:
        """Get the DF SSO access token (Tier 1 source credential)."""
        mode = os.environ.get("AUTH_MODE", "backend")
        if mode == "backend":
            sso = session.get(_SSO_NS)
            if not sso:
                return None
            if sso.get("expires_at", 0) < time.time():
                return self._refresh_sso()
            return sso.get("access_token")
        else:
            from data_formulator.auth.identity import get_sso_token
            return get_sso_token()

    def get_auth_status(self) -> dict[str, dict]:
        """Batch status check for all configured systems.

        Used by Agent pre-flight and frontend status display.
        """
        results = {}
        for system_id, config in self._all_auth_configs().items():
            access = self.get_access(system_id)
            results[system_id] = {
                "authorized": access is not None,
                "mode": config.get("mode"),
                "display_name": config.get("display_name", system_id),
                "requires_user_action": access is None,
                "available_strategies": self._available_strategies(
                    system_id, config),
            }
        return results

    # ── 凭证存入（前端弹窗/手动登录后调用）────────────────────

    def store_service_token(self, system_id: str,
                            access_token: str,
                            refresh_token: str = None,
                            expires_in: int = 3600,
                            user: dict = None) -> None:
        """Store a token acquired via popup or manual login."""
        tokens = session.get(_SVC_NS, {})
        tokens[system_id] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": time.time() + expires_in,
            "user": user,
            "stored_at": time.time(),
        }
        session[_SVC_NS] = tokens

    def clear_service_token(self, system_id: str) -> None:
        """Clear cached token AND vault credentials for a system.

        Mirrors the old PluginAuthHandler's logout guarantee:
        session + vault are always cleared together.
        """
        # Clear session
        tokens = session.get(_SVC_NS, {})
        tokens.pop(system_id, None)
        session[_SVC_NS] = tokens

        # Clear vault
        self._vault_delete(system_id)

    def store_sso_tokens(self, access_token: str,
                         refresh_token: str = None,
                         expires_in: int = 3600,
                         user_info: dict = None) -> None:
        """Store SSO tokens after backend OIDC callback."""
        session[_SSO_NS] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": time.time() + expires_in,
            "user": user_info,
        }

    # ── 内部方法 ──────────────────────────────────────────────

    def _get_cached(self, system_id: str) -> dict | None:
        tokens = session.get(_SVC_NS, {})
        return tokens.get(system_id)

    def _is_expired(self, cached: dict) -> bool:
        return cached.get("expires_at", 0) < time.time()

    def _do_refresh(self, system_id: str, cached: dict,
                    config: dict) -> str | None:
        """Refresh an expired token. Returns new access_token or None."""
        import requests as http
        token_url = config.get("token_url")
        if not token_url:
            return None
        try:
            resp = http.post(token_url, data={
                "grant_type": "refresh_token",
                "refresh_token": cached["refresh_token"],
                "client_id": self._resolve_env(config.get("client_id_env", "")),
                "client_secret": self._resolve_env(
                    config.get("client_secret_env", "")),
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            self.store_service_token(
                system_id,
                access_token=data["access_token"],
                refresh_token=data.get(
                    "refresh_token", cached["refresh_token"]),
                expires_in=data.get("expires_in", 3600),
                user=cached.get("user"),
            )
            return data["access_token"]
        except Exception as exc:
            logger.debug("Refresh failed for %s: %s", system_id, exc)
            return None

    def _do_sso_exchange(self, system_id: str,
                         config: dict) -> str | None:
        """Exchange SSO token for a system-specific token."""
        import requests as http
        sso_token = self.get_sso_token()
        if not sso_token:
            return None
        exchange_url = config.get("exchange_url")
        if not exchange_url:
            return None
        try:
            resp = http.post(exchange_url,
                json={"sso_access_token": sso_token},
                timeout=config.get("timeout", 10))
            resp.raise_for_status()
            data = resp.json()
            self.store_service_token(
                system_id,
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token"),
                expires_in=data.get("expires_in", 3600),
                user=data.get("user"),
            )
            return data["access_token"]
        except Exception as exc:
            logger.debug("SSO exchange failed for %s: %s", system_id, exc)
            return None

    def _try_vault(self, system_id: str, config: dict) -> dict | None:
        """Try vault credentials. Returns credentials dict or None.

        Mirrors old PluginAuthHandler.try_vault_login():
        credentials are retrieved AND validated against the external system.
        Stale credentials are marked but NOT automatically deleted.
        """
        creds = self._vault_retrieve(system_id)
        if not creds:
            return None
        # Vault credentials need validation — delegated to DataConnector
        return creds

    def _vault_retrieve(self, system_id: str) -> dict | None:
        try:
            from data_formulator.auth.identity import get_identity_id
            from data_formulator.credential_vault import get_credential_vault
            vault = get_credential_vault()
            if not vault:
                return None
            identity = get_identity_id()
            return vault.retrieve(identity, system_id)
        except Exception:
            return None

    def _vault_store(self, system_id: str, credentials: dict) -> None:
        try:
            from data_formulator.auth.identity import get_identity_id
            from data_formulator.credential_vault import get_credential_vault
            vault = get_credential_vault()
            if not vault:
                return
            identity = get_identity_id()
            vault.store(identity, system_id, credentials)
        except Exception:
            pass

    def _vault_delete(self, system_id: str) -> None:
        try:
            from data_formulator.auth.identity import get_identity_id
            from data_formulator.credential_vault import get_credential_vault
            vault = get_credential_vault()
            if not vault:
                return
            identity = get_identity_id()
            vault.delete(identity, system_id)
        except Exception:
            pass

    def _refresh_sso(self) -> str | None:
        """Refresh the SSO token using refresh_token."""
        import requests as http
        sso = session.get(_SSO_NS, {})
        refresh = sso.get("refresh_token")
        if not refresh:
            return None
        token_url = os.environ.get("OIDC_TOKEN_URL", "")
        if not token_url:
            return None
        try:
            resp = http.post(token_url, data={
                "grant_type": "refresh_token",
                "refresh_token": refresh,
                "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
                "client_secret": os.environ.get("OIDC_CLIENT_SECRET", ""),
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            self.store_sso_tokens(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", refresh),
                expires_in=data.get("expires_in", 3600),
            )
            return data["access_token"]
        except Exception as exc:
            logger.debug("SSO refresh failed: %s", exc)
            return None

    def _get_auth_config(self, system_id: str) -> dict | None:
        """Get auth_config for a system from its Loader class."""
        configs = self._all_auth_configs()
        return configs.get(system_id)

    def _all_auth_configs(self) -> dict[str, dict]:
        """Collect auth_config from all registered Loaders."""
        from data_formulator.data_loader import get_available_loaders
        result = {}
        for loader_type, loader_class in get_available_loaders().items():
            if hasattr(loader_class, 'auth_config'):
                result[loader_type] = loader_class.auth_config()
            else:
                result[loader_type] = {
                    "mode": loader_class.auth_mode(),
                    "display_name": loader_type,
                }
        return result

    def _available_strategies(self, system_id: str,
                              config: dict) -> list[str]:
        """What can the user do to authenticate this system?"""
        strategies = []
        mode = config.get("mode", "credentials")
        if mode == "sso_exchange" and self.get_sso_token():
            strategies.append("sso_exchange")
        if config.get("login_url"):
            strategies.append("delegated_popup")
        if mode == "oauth2":
            strategies.append("oauth2_redirect")
        if mode in ("credentials", "connection"):
            strategies.append("manual_credentials")
        return strategies

    @staticmethod
    def _resolve_env(env_key: str) -> str:
        return os.environ.get(env_key, "") if env_key else ""
```

### 3.3 Session 结构

```python
# Flask session 中的数据结构

session = {
    # SSO 凭证（Tier 1）
    "sso": {
        "access_token": "eyJ...",
        "refresh_token": "eyJ...",
        "expires_at": 1713900000,
        "user": {"sub": "zhangsan", "name": "张三", "email": "..."},
    },

    # 各系统凭证（Tier 2/3/4 的缓存）
    "service_tokens": {
        "superset": {
            "access_token": "eyJ...",          # Superset JWT
            "refresh_token": "eyJ...",
            "expires_at": 1713900000,
            "user": {"id": 42, "username": "zhangsan"},
            "stored_at": 1713896400,
        },
        "metabase": {
            "access_token": "mb_session_xxx",
            "refresh_token": None,
            "expires_at": 1713900000,
            "user": {"id": 7},
            "stored_at": 1713896400,
        },
    },
}
```

---

## 4. auth_config 声明式接口

### 4.1 ExternalDataLoader 基类扩展

```python
# external_data_loader.py — 新增方法（与 auth_mode 共存）

class ExternalDataLoader(ABC):

    @staticmethod
    def auth_config() -> dict:
        """Declare how this loader authenticates with its target system.

        The TokenStore reads this config to determine which credential
        acquisition strategies to attempt and in what order.

        Supported modes and their required keys:

        mode="credentials" (default):
            Static username/password via Vault.
            No additional keys required.

        mode="sso_exchange":
            SSO token → target system token, backend-to-backend.
            Required: exchange_url
            Optional: token_url (for refresh), timeout

        mode="delegated":
            Popup window → target system login → postMessage back.
            Required: login_url
            Optional: token_url (for refresh)

        mode="oauth2":
            Independent OAuth2 flow (different IdP).
            Required: authorize_url, token_url
            Optional: scopes, client_id_env, client_secret_env

        Common optional keys:
            display_name: str — Human-readable name
            supports_refresh: bool — Whether refresh_token is available
        """
        return {"mode": "credentials"}

    @staticmethod
    def auth_mode() -> str:
        """Legacy interface. Kept for backward compatibility.

        New loaders should implement auth_config() instead.
        DataConnector checks auth_config() first, falls back to auth_mode().
        """
        return "connection"
```

### 4.2 各系统声明示例

```python
# ── 同 IdP 换票 + 弹窗降级（Superset）──────────────────

class SupersetLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        url = os.environ.get("PLG_SUPERSET_URL", "").rstrip("/")
        login_url = os.environ.get(
            "PLG_SUPERSET_SSO_LOGIN_URL",
            f"{url}/df-sso-bridge/" if url else "",
        )
        return {
            "mode": "sso_exchange",
            "display_name": "Superset",
            "exchange_url": f"{url}/api/v1/df-token-exchange/",
            "login_url": login_url,       # 弹窗降级
            "supports_refresh": True,
        }


# ── 同 IdP 换票（Metabase，未来）──────────────────────

class MetabaseLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        url = os.environ.get("PLG_METABASE_URL", "").rstrip("/")
        return {
            "mode": "sso_exchange",
            "display_name": "Metabase",
            "exchange_url": f"{url}/api/df-token-exchange/",
            "supports_refresh": False,
        }


# ── 独立 OAuth（Power BI，未来）────────────────────────

class PowerBILoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        tenant = os.environ.get("PLG_POWERBI_TENANT_ID", "common")
        return {
            "mode": "oauth2",
            "display_name": "Power BI",
            "authorize_url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
            "token_url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            "scopes": "https://analysis.windows.net/powerbi/api/.default offline_access",
            "client_id_env": "PLG_POWERBI_CLIENT_ID",
            "client_secret_env": "PLG_POWERBI_CLIENT_SECRET",
        }


# ── 纯弹窗委托（无 token-exchange 端点的系统）──────────

class GrafanaLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        url = os.environ.get("PLG_GRAFANA_URL", "").rstrip("/")
        return {
            "mode": "delegated",
            "display_name": "Grafana",
            "login_url": f"{url}/df-sso-bridge/",
            "supports_refresh": False,
        }


# ── 静态凭据（数据库类，不变）─────────────────────────

class MySQLDataLoader(ExternalDataLoader):
    @staticmethod
    def auth_config() -> dict:
        return {
            "mode": "credentials",
            "display_name": "MySQL",
        }
```

---

## 5. DataConnector 集成

### 5.1 凭证注入改造

将 `_inject_sso_token` 升级为通用的 `_inject_credentials`：

```python
# data_connector.py

def _inject_credentials(self, params: dict[str, Any]) -> None:
    """Inject the best available credentials via TokenStore."""
    if params.get("access_token") or params.get("sso_access_token"):
        return  # caller already provided credentials

    config = self._loader_class.auth_config() \
        if hasattr(self._loader_class, 'auth_config') else None
    mode = config.get("mode") if config else self._loader_class.auth_mode()

    if mode == "credentials" or mode == "connection":
        return  # Vault handled separately in _try_auto_reconnect

    token_store = TokenStore()
    access = token_store.get_access(self._source_id)
    if access:
        if isinstance(access, dict):
            params.update(access)
        else:
            params["access_token"] = access
```

### 5.2 弹窗凭证接收路由

前端弹窗 postMessage 获取的 token 需要一个后端入口存入 TokenStore：

```python
# 新增路由：/api/auth/tokens/save

@connectors_bp.route("/api/auth/tokens/save", methods=["POST"])
def save_delegated_token():
    """Receive token from frontend popup and store in TokenStore.

    Called after the popup postMessage flow completes.
    Replaces the old /api/plugins/<id>/auth/sso/save-tokens pattern.
    """
    data = request.get_json(force=True)
    system_id = data.get("system_id")
    access_token = data.get("access_token")
    if not system_id or not access_token:
        return {"error": "system_id and access_token required"}, 400

    token_store = TokenStore()
    token_store.store_service_token(
        system_id=system_id,
        access_token=access_token,
        refresh_token=data.get("refresh_token"),
        expires_in=data.get("expires_in", 3600),
        user=data.get("user"),
    )

    # Optionally store to Vault if user chose "remember"
    if data.get("remember"):
        token_store._vault_store(system_id, {
            "access_token": access_token,
            "refresh_token": data.get("refresh_token"),
        })

    return {"status": "ok"}
```

### 5.3 认证状态查询路由

Agent 预检和前端状态显示的统一入口：

```python
# 新增路由：/api/auth/service-status

@connectors_bp.route("/api/auth/service-status", methods=["GET"])
def auth_service_status():
    """Return authorization status for all configured systems.

    Agent calls this before starting analysis.
    Frontend calls this to show connection indicators.
    """
    token_store = TokenStore()
    return jsonify(token_store.get_auth_status())
```

### 5.4 Vault 生命周期保证

融合旧架构 PluginAuthHandler 的核心规则：

```python
# 断开连接时：Session + Vault 同时清除
@connectors_bp.route("/api/connectors/disconnect", methods=["POST"])
def connector_disconnect():
    data = request.get_json(force=True)
    connector = _resolve_connector(data)

    # TokenStore 的 clear 方法同时清除 Session 和 Vault
    token_store = TokenStore()
    token_store.clear_service_token(connector._source_id)

    # 原有的 loader 清理
    connector.disconnect()
    return {"status": "ok"}
```

**Vault 生命周期规则**（继承自旧架构）：

| 规则 | 说明 | 强制方式 |
|------|------|---------|
| 登出必须清 Session + Vault | 防止"退出后 Vault 自动登录回来"的死循环 | `clear_service_token()` 同时操作 |
| Vault 凭证必须实测验证 | 从 Vault 取出后必须实际连接外部系统 | DataConnector `test_connection()` |
| 失效凭证标记 vault_stale | 外部系统密码已改时通知前端 | `get_auth_status()` 返回状态 |
| remember=true 才存 Vault | 用户主动勾选后才写入 | `/api/auth/tokens/save` 检查 remember 参数 |
| Vault 操作 best-effort | 存/删/取失败时静默跳过 | `_vault_*` 方法全部 try/except |

---

## 6. Loader 自动发现

### 6.1 当前方式（显式注册）

```python
# data_loader/__init__.py — 需要手动加一行
_LOADER_SPECS = [
    ("mysql", "...mysql_data_loader", "MySQLDataLoader", "pymysql"),
    ("superset", "...superset_data_loader", "SupersetLoader", "requests"),
]
```

### 6.2 改进：目录自动发现 + 显式注册共存

```python
# data_loader/__init__.py — 自动扫描 + 手动注册

import importlib, pkgutil, logging

logger = logging.getLogger(__name__)

# 显式注册（优先级高，用于控制加载顺序或覆盖）
_EXPLICIT_SPECS: list[tuple[str, str, str, str]] = [
    # (loader_type, module_path, class_name, required_package)
    # 留空即可，所有 Loader 均可通过自动发现加载
]

# 约定：文件名 *_data_loader.py，类名 *DataLoader 或 *Loader
_AUTO_DISCOVER_PATTERN = "_data_loader"


def _auto_discover() -> dict[str, type]:
    """Scan data_loader/ for ExternalDataLoader subclasses."""
    discovered = {}
    package = importlib.import_module("data_formulator.data_loader")
    for importer, modname, ispkg in pkgutil.iter_modules(package.__path__):
        if _AUTO_DISCOVER_PATTERN not in modname:
            continue
        try:
            mod = importlib.import_module(
                f"data_formulator.data_loader.{modname}")
            for attr_name in dir(mod):
                cls = getattr(mod, attr_name)
                if (isinstance(cls, type)
                        and issubclass(cls, ExternalDataLoader)
                        and cls is not ExternalDataLoader):
                    loader_type = modname.replace(_AUTO_DISCOVER_PATTERN, "")
                    discovered[loader_type] = cls
                    logger.info("Auto-discovered loader: %s → %s",
                                loader_type, cls.__name__)
        except ImportError as exc:
            logger.debug("Skipping %s (missing dependency: %s)",
                         modname, exc)
    return discovered
```

**零修改原则**：新增一个 `xxx_data_loader.py` 文件，框架自动发现并注册，不需要改 `__init__.py` 或任何其他文件。

---

## 7. 后端 OIDC Gateway

DF 作为 Confidential Client 与 SSO 交互（替代前端 oidc-client-ts）：

```python
# auth/gateways/oidc_gateway.py

import os, secrets, time, urllib.parse, logging
import requests as http
from flask import Blueprint, redirect, request, session

from data_formulator.auth.token_store import TokenStore

logger = logging.getLogger(__name__)
oidc_bp = Blueprint("oidc_gateway", __name__, url_prefix="/api/auth/oidc")


@oidc_bp.route("/login")
def oidc_login():
    """Redirect user to SSO authorization page."""
    state = secrets.token_urlsafe(32)
    session["_oauth_state"] = state

    params = {
        "response_type": "code",
        "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
        "redirect_uri": _callback_url(),
        "scope": "openid profile email offline_access",
        "state": state,
    }
    authorize_url = os.environ.get("OIDC_AUTHORIZE_URL", "")
    return redirect(f"{authorize_url}?{urllib.parse.urlencode(params)}")


@oidc_bp.route("/callback")
def oidc_callback():
    """Exchange authorization code for tokens."""
    code = request.args.get("code")
    state = request.args.get("state")

    if not code or state != session.pop("_oauth_state", None):
        return {"error": "invalid_state"}, 400

    resp = http.post(os.environ.get("OIDC_TOKEN_URL", ""), data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _callback_url(),
        "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
        "client_secret": os.environ.get("OIDC_CLIENT_SECRET", ""),
    }, timeout=10)
    resp.raise_for_status()
    tokens = resp.json()

    # Store SSO tokens
    token_store = TokenStore()
    user_info = _fetch_userinfo(tokens["access_token"])
    token_store.store_sso_tokens(
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token"),
        expires_in=tokens.get("expires_in", 3600),
        user_info=user_info,
    )

    # Auto-exchange for all sso_exchange systems
    for system_id, config in token_store._all_auth_configs().items():
        if config.get("mode") == "sso_exchange":
            token_store._do_sso_exchange(system_id, config)

    return redirect("/")


@oidc_bp.route("/status")
def oidc_status():
    """Check SSO login status."""
    token_store = TokenStore()
    sso_token = token_store.get_sso_token()
    sso_data = session.get("sso", {})
    if sso_token:
        return {
            "authenticated": True,
            "user": sso_data.get("user"),
        }
    return {"authenticated": False}


@oidc_bp.route("/logout", methods=["POST"])
def oidc_logout():
    """Clear all tokens (SSO + all services)."""
    token_store = TokenStore()
    for system_id in list(session.get("service_tokens", {}).keys()):
        token_store.clear_service_token(system_id)
    session.pop("sso", None)
    session.pop("service_tokens", None)
    return {"status": "ok"}


def _callback_url() -> str:
    return request.url_root.rstrip("/") + "/api/auth/oidc/callback"


def _fetch_userinfo(access_token: str) -> dict | None:
    url = os.environ.get("OIDC_USERINFO_URL", "")
    if not url:
        return None
    try:
        resp = http.get(url, headers={
            "Authorization": f"Bearer {access_token}",
        }, timeout=10)
        return resp.json() if resp.ok else None
    except Exception:
        return None
```

**SSO 登录后自动换票**：`oidc_callback` 在存储 SSO token 后，自动遍历所有 `sso_exchange` 模式的系统并尝试换票。用户一次 SSO 登录，所有同 IdP 系统全部就绪。

---

## 8. 前端适配

### 8.1 get_auth_info 返回后端模式标识

```python
# auth/providers/oidc.py — get_auth_info 扩展

def get_auth_info(self) -> dict:
    mode = os.environ.get("AUTH_MODE", "backend")
    if mode == "backend":
        return {
            "action": "backend_redirect",
            "label": os.environ.get("AUTH_DISPLAY_NAME", "SSO Login"),
            "loginUrl": "/api/auth/oidc/login",
            "statusUrl": "/api/auth/oidc/status",
            "logoutUrl": "/api/auth/oidc/logout",
        }
    else:
        # 保持现有前端 OIDC 行为
        return {
            "action": "frontend",
            "oidc": { ... },
        }
```

### 8.2 AuthButton 适配

```typescript
// AuthButton.tsx — 支持两种模式

const handleSignIn = useCallback(async () => {
    const info = await getAuthInfo();
    if (info?.action === 'backend_redirect') {
        window.location.href = info.loginUrl;
    } else if (info?.action === 'frontend' && mgr) {
        await mgr.signinRedirect();
    }
}, [mgr]);
```

### 8.3 弹窗委托存入统一路由

```typescript
// DBTableManager.tsx — postMessage handler 改造

const handler = async (event: MessageEvent) => {
    if (event.data?.type !== 'df-sso-auth') return;
    const { access_token, refresh_token, user } = event.data;

    // 统一存入 TokenStore（替代旧的 plugin-specific 路由）
    await fetchWithIdentity('/api/auth/tokens/save', {
        method: 'POST',
        body: JSON.stringify({
            system_id: connectorId,    // e.g. "superset"
            access_token,
            refresh_token,
            user,
            remember: persistCredentials,
        }),
    });
};
```

---

## 9. 新增 Loader 开发 Checklist

适配自旧架构的 Checklist，基于新架构更新：

### 后端

- [ ] 文件命名符合 `<type>_data_loader.py` 约定（自动发现依赖此命名）
- [ ] 继承 `ExternalDataLoader`
- [ ] 实现 `auth_config()` 声明认证方式
- [ ] `auth_config()` 中不包含任何明文密钥（密钥通过 `*_env` 指向环境变量）
- [ ] 实现 `list_params()`，敏感参数标记 `sensitive=True`
- [ ] 实现 `test_connection()` 用于 Vault 凭据验证
- [ ] 外部 API 调用有合理的 timeout
- [ ] 缺少必须依赖时 `ImportError` 被框架捕获，不崩溃
- [ ] 缺少必须环境变量时不注册，不报错

### 配置

- [ ] `.env.template` 中有本 Loader 的环境变量说明
- [ ] 环境变量使用 `PLG_<ID>_` 前缀
- [ ] 如果是 `sso_exchange` 模式，目标系统侧已部署 token-exchange 端点
- [ ] 如果是 `delegated` 模式，目标系统侧已部署 Bridge 页面

### 测试

- [ ] 认证流程测试（含 SSO 换票成功/失败、Vault 取用/过期）
- [ ] 数据加载测试
- [ ] fixture 文件从真实系统录制
- [ ] **核心文件 git diff 为空**（验证零修改原则）

---

## 10. 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| TokenStore 是否取代 PluginAuthHandler | 是 | 统一接口，Agent 可用，减少 N 个 Plugin 的重复代码 |
| 弹窗 postMessage 是否保留 | 是，作为降级策略 | 适用于无 token-exchange 端点或不同 IdP 的系统 |
| auth_config 是否取代 auth_mode | 共存，auth_config 优先 | 向后兼容，渐进迁移 |
| Loader 发现方式 | 自动发现 + 显式注册共存 | 满足零修改原则，同时保留手动控制能力 |
| Session vs Redis | 初期 Session，后续可迁 Redis | Flask Session 足够起步，TokenStore 接口不依赖具体存储 |
| OIDC Gateway 是否取代前端 oidc-client-ts | `AUTH_MODE=backend` 时取代 | 通过环境变量切换，两种模式共存 |
| 前端独立 Plugin UI | 暂不保留 | 统一 UI 满足当前需求，未来按需扩展 |
| Vault 生命周期规则 | 完整保留旧架构规则 | logout 必须同时清 Session + Vault 是经过验证的设计 |

---

## 11. 与现有代码的兼容映射

| 当前代码 | 融合方案中的对应 | 改动方式 |
|----------|-----------------|---------|
| `identity.py: get_sso_token()` | `TokenStore.get_sso_token()` | 内部调用 TokenStore，接口不变 |
| `data_connector.py: _inject_sso_token()` | `_inject_credentials()` | 逻辑扩展，向后兼容 |
| `data_connector.py: _try_sso_auto_connect()` | TokenStore 自动换票 | 逻辑迁入 TokenStore |
| `superset_auth_bridge.py: exchange_sso_token()` | `TokenStore._do_sso_exchange()` | 迁入但保留原模块供直接调用 |
| `superset_data_loader.py: auth_mode()` | `auth_config()` 新增，`auth_mode()` 保留 | 共存 |
| `external_data_loader.py: auth_mode()` | 保留，新增 `auth_config()` | 共存 |
| `oidcConfig.ts / AuthButton.tsx` | 按 `AUTH_MODE` 切换行为 | 条件分支 |
| `OidcCallback.tsx` | backend 模式下不再使用 | 保留供 frontend 模式降级 |
| `DBTableManager.tsx: handleDelegatedLogin` | 改为存入 `/api/auth/tokens/save` | 路由变更 |
| `credential_vault/*` | 不变，TokenStore 内部调用 | 零改动 |
