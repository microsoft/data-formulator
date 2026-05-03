"""
Superset OAuth + Data Formulator 桥接配置

本文件部署在 Superset 服务端（PYTHONPATH 下），包含四部分：
  1. SsoHandler            — 从 SSO userinfo 端点解析用户信息
  2. CustomSsoSecurityManager — 用户创建/更新 + 角色同步
  3. SSOBridgeView         — DF 通过弹窗获取 Superset JWT（委托模式）
  4. TokenExchangeView     — DF 后端静默换票获取 Superset JWT（SSO Exchange 模式）

使用方法：
  1. 复制本文件到 Superset 的 PYTHONPATH 下，命名为 oauth_config.py
  2. 将所有 <PLACEHOLDER> 替换为你的实际值
  3. 在 superset_config.py 中导入（见同目录下的 superset_config.py 示例）

对接文档：docs-cn/5.1-superset-sso-oauth-config-guide.md
"""

import logging
import os
import secrets
import requests
from urllib.parse import quote, urlparse

from flask_appbuilder.security.manager import AUTH_OAUTH
from flask_appbuilder import BaseView, expose
from flask import g, request, Response, redirect, render_template_string, session
from flask_login import current_user
from superset.security import SupersetSecurityManager
from superset import db

logger = logging.getLogger(__name__)


# =============================================================================
# 第一部分：SSO 用户信息解析
# =============================================================================

class SsoHandler:
    """从 SSO userinfo 端点解析用户信息。"""

    # ── 需要修改 ──────────────────────────────────────────────
    userinfo_url = '<YOUR_SSO_USERINFO_URL>'

    role_mapping = {
        'admin': 'Admin',
        'analyst': 'Alpha',
        'viewer': 'Gamma',
    }
    # ─────────────────────────────────────────────────────────

    @classmethod
    def parse_user_details(cls, access_token):
        resp = requests.get(
            cls.userinfo_url,
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info("SSO userinfo: %s", data)

        username = data.get('preferred_username') or data.get('sub')
        if not username:
            logger.error("SSO userinfo 缺少 username")
            return None

        full_name = data.get('name') or username
        email = data.get('email') or f"{username}@example.com"
        name_parts = full_name.split(' ', 1)

        return {
            'username': username,
            'email': email,
            'first_name': name_parts[0],
            'last_name': name_parts[1] if len(name_parts) > 1 else '',
            'sso_roles': data.get('sso_roles', []),
        }


# =============================================================================
# 第二部分：自定义 Security Manager
# =============================================================================

class CustomSsoSecurityManager(SupersetSecurityManager):

    def oauth_user_info(self, provider, response=None):
        access_token = response.get('access_token') if response else None
        if not access_token:
            logger.error("OAuth 响应中缺少 access_token")
            return super().oauth_user_info(provider, response)
        try:
            user_details = SsoHandler.parse_user_details(access_token)
            if user_details:
                user_details['active_provider'] = provider
            return user_details
        except Exception as e:
            logger.error("OAuth 用户信息获取失败: %s", e, exc_info=True)
            return None

    def auth_user_oauth(self, userinfo):
        if not userinfo or not userinfo.get('username'):
            return None

        sso_roles = userinfo.get('sso_roles', [])
        has_mapped_role = any(r in SsoHandler.role_mapping for r in sso_roles)
        if not has_mapped_role:
            from flask import flash
            flash("登录失败：您的账号尚未被分配 Superset 访问权限，请联系管理员。", "danger")
            return None

        username = userinfo['username']
        user = self.find_user(username=username)

        if not user:
            if self.auth_user_registration:
                user = super().auth_user_oauth(userinfo)
            else:
                return None
        else:
            user.first_name = userinfo.get('first_name', user.first_name)
            user.last_name = userinfo.get('last_name', user.last_name)
            user.email = userinfo.get('email', user.email)

        if sso_roles:
            self._sync_roles(user, sso_roles)

        return user

    def _sync_roles(self, user, sso_roles):
        """将 SSO 角色映射为 Superset 角色。本地 Admin 身份始终保留。"""
        target_names = set()
        for sr in sso_roles:
            mapped = SsoHandler.role_mapping.get(sr)
            if mapped:
                target_names.add(mapped)

        if any(r.name == 'Admin' for r in user.roles):
            target_names.add('Admin')

        new_roles = []
        for name in target_names:
            role = self.find_role(name)
            if role:
                new_roles.append(role)
            else:
                logger.warning("Superset 中找不到角色: %s", name)

        if not new_roles:
            return
        try:
            user.roles = new_roles
            db.session.merge(user)
            db.session.commit()
            logger.info("用户 %s 角色已同步: %s", user.username, [r.name for r in new_roles])
        except Exception as e:
            db.session.rollback()
            logger.error("角色同步失败: %s", e)


# =============================================================================
# 第三部分：Data Formulator SSO 桥接端点
#
# 流程：
#   1. DF 前端 window.open(/df-sso-bridge/?df_origin=http://df-host:5567)
#   2. 未登录 → 重定向到 /login/?next=... → SSO → 回到此端点
#   3. 已登录 → 签发 JWT → postMessage 传给 DF → 关闭弹窗
#
# DF 前端 (DBTableManager.tsx) 监听 type === 'df-sso-auth' 的 postMessage，
# 收到后将 token 发送到:
#   - /api/connectors/connect (连接 Superset DataConnector)
#   - /api/auth/tokens/save   (持久化到 TokenStore，供 Agent 使用)
# =============================================================================

_SSO_BRIDGE_TEMPLATE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SSO Bridge</title></head>
<body>
<p>正在同步登录状态...</p>
<script nonce="{{ csp_nonce }}">
(function() {
    var payload = {{ payload | tojson }};
    var targetOrigin = {{ target_origin | tojson }};
    if (window.opener) {
        window.opener.postMessage(payload, targetOrigin);
        setTimeout(function() { window.close(); }, 500);
    } else {
        document.body.textContent = '登录成功，请关闭此窗口并返回 Data Formulator。';
    }
})();
</script>
</body></html>"""


class SSOBridgeView(BaseView):
    route_base = "/df-sso-bridge"

    # 只允许这些 DF 前端 origin 接收 Superset JWT。生产部署必须添加自己的 HTTPS origin，
    # 也可以通过环境变量 DF_ALLOWED_ORIGINS 追加多个逗号分隔的 origin。
    allowed_df_origins = {
        "http://localhost:5567",
        "http://127.0.0.1:5567",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # "https://data-formulator.example.com",
    }

    @staticmethod
    def _is_real_logged_in_user():
        """区分真实登录用户和 Public 匿名用户。

        当 Superset 启用 PUBLIC_ROLE_LIKE 时，current_user.is_authenticated
        对匿名用户也可能返回 True，必须检查 session._user_id。
        """
        if not session.get("_user_id"):
            return False
        if getattr(current_user, "is_anonymous", True):
            return False
        if not getattr(current_user, "is_authenticated", False):
            return False
        if not getattr(current_user, "id", None):
            return False
        username = getattr(current_user, "username", "") or ""
        if username.lower() in ("public", "anonymous", "guest", ""):
            return False
        return True

    @staticmethod
    def _normalise_origin(raw):
        """规范化浏览器 origin；非法或非 origin 输入返回空字符串。"""
        raw = (raw or "").strip()
        parsed = urlparse(raw)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return ""
        if parsed.username or parsed.password:
            return ""
        if parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
            return ""
        return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"

    @classmethod
    def _allowed_origins(cls):
        origins = {cls._normalise_origin(o) for o in cls.allowed_df_origins}
        for raw in os.environ.get("DF_ALLOWED_ORIGINS", "").split(","):
            origin = cls._normalise_origin(raw)
            if origin:
                origins.add(origin)
        origins.discard("")
        return origins

    @classmethod
    def _validate_origin(cls, raw):
        origin = cls._normalise_origin(raw)
        return origin if origin in cls._allowed_origins() else ""

    @staticmethod
    def _safe_next_path(raw_path):
        """只允许站内相对路径进入 login next 参数。"""
        next_path = (raw_path or "/").rstrip("?").replace("\\", "/")
        parsed = urlparse(next_path)
        if (
            not next_path.startswith("/")
            or next_path.startswith("//")
            or parsed.scheme
            or parsed.netloc
        ):
            return "/"
        return next_path

    @expose("/", methods=["GET"])
    def df_sso_bridge(self):
        if not self._is_real_logged_in_user():
            next_url = self._safe_next_path(request.full_path)
            return redirect(f"/login/?next={quote(next_url)}")

        df_origin = self._validate_origin(request.args.get("df_origin"))
        if not df_origin:
            return Response("Invalid df_origin", status=400, mimetype="text/plain")

        from flask_jwt_extended import create_access_token, create_refresh_token

        user_id_str = str(current_user.id)
        additional_claims = {
            "user": {
                "id": current_user.id,
                "username": current_user.username,
                "first_name": getattr(current_user, "first_name", "") or "",
                "last_name": getattr(current_user, "last_name", "") or "",
            }
        }

        access_token = create_access_token(
            identity=user_id_str, fresh=True, additional_claims=additional_claims,
        )
        refresh_token = create_refresh_token(
            identity=user_id_str, additional_claims=additional_claims,
        )

        user_data = additional_claims["user"]
        csp_nonce = getattr(g, "csp_nonce", "") or secrets.token_urlsafe(16)

        payload = {
            "type": "df-sso-auth",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": user_data,
        }

        html = render_template_string(
            _SSO_BRIDGE_TEMPLATE,
            payload=payload,
            target_origin=df_origin,
            csp_nonce=csp_nonce,
        )
        return Response(html, mimetype="text/html")


# =============================================================================
# 第四部分：Data Formulator SSO 换票端点（可选）
#
# 当 DF 和 Superset 接入同一个 SSO IdP 时，启用此端点可实现后端静默换票，
# 用户无需弹窗登录即可访问 Superset 数据。
#
# 流程：
#   1. 用户在 DF 完成 SSO 登录，DF 后端获得 IdP 颁发的 access_token
#   2. DF 后端 POST /api/v1/df-token-exchange/ {sso_access_token: "..."}
#   3. 本端点用该 token 向 IdP userinfo 验证身份
#   4. 查找 Superset 中对应用户，签发 Superset JWT 返回
#   5. DF 自动存储 JWT，后续 API 调用使用 Bearer token
#
# 安全说明：
#   - 仅接受服务端到服务端调用，不直接暴露给浏览器
#   - 通过 DF_EXCHANGE_SHARED_SECRET 验证调用方（可选但推荐）
#   - SSO token 通过实际调用 IdP userinfo 验证，不仅仅解码 JWT
# =============================================================================

from flask import Blueprint, jsonify

df_exchange_bp = Blueprint("df_token_exchange", __name__)


def _verify_exchange_secret():
    """Verify the shared secret header if DF_EXCHANGE_SHARED_SECRET is set.

    When the env var is empty or unset, all requests are allowed (for
    development). In production, set the same secret on both DF and Superset
    to prevent unauthorized token exchange.
    """
    expected = os.environ.get("DF_EXCHANGE_SHARED_SECRET", "").strip()
    if not expected:
        return True
    provided = (request.headers.get("X-DF-Exchange-Secret") or "").strip()
    return secrets.compare_digest(expected, provided)


@df_exchange_bp.route("/api/v1/df-token-exchange/", methods=["POST"])
def df_token_exchange():
    """Exchange an SSO access token for a Superset JWT.

    Request body: {"sso_access_token": "<IdP access token>"}
    Response:     {"access_token": "...", "refresh_token": "...",
                   "expires_in": 3600, "user": {...}}
    """
    if not _verify_exchange_secret():
        return jsonify({"error": "unauthorized", "message": "Invalid exchange secret"}), 403

    data = request.get_json(silent=True) or {}
    sso_token = data.get("sso_access_token")
    if not sso_token:
        return jsonify({"error": "bad_request", "message": "Missing sso_access_token"}), 400

    # ① Validate SSO token against the IdP userinfo endpoint
    try:
        user_details = SsoHandler.parse_user_details(sso_token)
    except Exception as exc:
        logger.warning("Token exchange: SSO validation failed: %s", exc)
        return jsonify({"error": "invalid_token", "message": "SSO token validation failed"}), 401

    if not user_details or not user_details.get("username"):
        return jsonify({"error": "invalid_token", "message": "Could not resolve user from SSO token"}), 401

    # ② Find the corresponding Superset user
    from superset import appbuilder
    sm = appbuilder.sm
    user = sm.find_user(username=user_details["username"])
    if not user:
        # Optionally: allow auto-registration during exchange (same as OAuth login)
        logger.info("Token exchange: user '%s' not found in Superset", user_details["username"])
        return jsonify({"error": "user_not_found", "message": "User not registered in Superset"}), 403
    if not getattr(user, "is_active", False):
        return jsonify({"error": "user_inactive", "message": "User account is inactive"}), 403

    # ③ Issue Superset JWT
    from flask_jwt_extended import create_access_token, create_refresh_token

    user_id_str = str(user.id)
    additional_claims = {
        "user": {
            "id": user.id,
            "username": user.username,
            "first_name": getattr(user, "first_name", "") or "",
            "last_name": getattr(user, "last_name", "") or "",
        }
    }
    access_token = create_access_token(
        identity=user_id_str, fresh=True, additional_claims=additional_claims,
    )
    refresh_token = create_refresh_token(
        identity=user_id_str, additional_claims=additional_claims,
    )

    logger.info("Token exchange: issued JWT for user '%s' (id=%s)", user.username, user.id)

    # ④ Return tokens
    return jsonify({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": 3600,
        "user": additional_claims["user"],
    })


# =============================================================================
# 导出配置（由 superset_config.py 导入）
# =============================================================================

OAUTH_CONFIG = {
    'AUTH_TYPE': AUTH_OAUTH,
    'AUTH_USER_REGISTRATION': True,
    'AUTH_USER_REGISTRATION_ROLE': "Public",
    'AUTH_OAUTH_ROLES_SYNC': True,
    'AUTH_OAUTH_ROLES_UPDATE': True,
    'CUSTOM_SECURITY_MANAGER': CustomSsoSecurityManager,
    'OAUTH_PROVIDERS': [
        {
            'name': '<YOUR_PROVIDER_NAME>',
            'token_key': 'access_token',
            'icon': 'fa-key',
            'remote_app': {
                'client_id': '<YOUR_CLIENT_ID>',
                'client_secret': '<YOUR_CLIENT_SECRET>',
                'server_metadata_url': '<YOUR_DISCOVERY_URL>',
                'client_kwargs': {
                    'scope': 'openid profile email',
                },
            },
        }
    ]
}
