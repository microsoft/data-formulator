"""
Superset OAuth + DF 桥接配置参考

本文件为 Superset 端 SSO 对接的参考实现，包含三部分：
  1. SsoHandler       — 从 SSO userinfo 端点解析用户信息
  2. SecurityManager  — 用户创建/更新 + 角色同步
  3. SSOBridgeView    — DF 通过弹窗获取 Superset JWT

使用方法：
  1. 复制本文件到 Superset 的 PYTHONPATH 下，命名为 oauth_config.py
  2. 将所有 <PLACEHOLDER> 替换为你的实际值
  3. 在 superset_config.py 中导入（见同目录下的 superset_config.py 示例）

关键设计：
  - SSOBridgeView 用独立的 BaseView 注册，不侵入 SecurityManager
  - 未登录用户访问 bridge 会被重定向到 Superset 登录页，登录后自动回到 bridge
  - JWT identity 使用 str(user.id)，与 Superset 默认行为一致
"""

import logging
import json
import secrets
import requests
from urllib.parse import quote, urlparse

from flask_appbuilder.security.manager import AUTH_OAUTH
from flask_appbuilder import BaseView, expose
from flask import g, request, Response, redirect, session
from flask_login import current_user
from superset.security import SupersetSecurityManager
from superset import db

logger = logging.getLogger(__name__)


# =============================================================================
# 第一部分：SSO 用户信息解析
# =============================================================================

class SsoHandler:
    """
    从 SSO 的 userinfo 端点解析用户信息。

    需要修改：
      - userinfo_url:  你的 SSO userinfo 端点地址
      - role_mapping:  SSO 角色代码 → Superset 角色名的映射表
    """
    userinfo_url = '<YOUR_SSO_USERINFO_URL>'  # 例: https://sso.example.com/api/v1/oauth2/userinfo

    role_mapping = {
        'admin': 'Admin',
        'analyst': 'Alpha',
        'viewer': 'Gamma',
        # 按需添加更多映射...
    }

    @classmethod
    def parse_user_details(cls, access_token):
        """用 access_token 调 userinfo 端点，返回标准化的用户信息字典。"""
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
    """
    扩展 Superset 默认的 Security Manager：
      - oauth_user_info: 从 SSO 获取用户信息
      - auth_user_oauth: 创建/更新用户 + 同步角色
    """

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
# 工作流程:
#   1. DF 前端 window.open(/df-sso-bridge/?df_origin=http://df-host:5567)
#   2. 未登录 → 重定向到 /login/?next=... → SSO → 回到此端点
#   3. 已登录 → 签发 JWT → postMessage 传给 DF → 关闭弹窗
#
# 关键：_is_real_logged_in_user() 区分真实登录用户和 Public 匿名用户。
# 当 Superset 启用了 PUBLIC_ROLE_LIKE（允许匿名浏览数据）时，
# current_user.is_authenticated 对匿名用户也可能返回 True，
# 必须额外检查 session._user_id 来判断用户是否真正通过登录流程认证。
# =============================================================================

class SSOBridgeView(BaseView):
    route_base = "/df-sso-bridge"

    @staticmethod
    def _is_real_logged_in_user():
        """
        判断当前用户是否通过真实登录流程认证（而非 Public 匿名访问）。

        背景：当 Superset 配置了 PUBLIC_ROLE_LIKE = "Gamma" 时，
        未登录用户也能访问部分数据，此时 current_user 不是 None 而是一个
        具有 Public 角色的伪用户。此方法通过检查 session 中的 _user_id
        来区分真实登录和匿名访问。
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
    def _validate_origin(raw: str) -> str:
        """Validate df_origin: only allow http(s) scheme with a real netloc."""
        if raw == "*":
            return "*"
        parsed = urlparse(raw)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
        return "*"

    @expose("/", methods=["GET"])
    def df_sso_bridge(self):
        if not self._is_real_logged_in_user():
            next_url = request.full_path.rstrip("?")
            if not next_url.startswith("/"):
                next_url = "/"
            return redirect(f"/login/?next={quote(next_url)}")

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

        df_origin = self._validate_origin(request.args.get("df_origin", "*"))
        user_data = additional_claims["user"]
        csp_nonce = getattr(g, "csp_nonce", "") or secrets.token_urlsafe(16)

        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SSO Bridge</title></head>
<body>
<p>正在同步登录状态...</p>
<script nonce="{csp_nonce}">
(function() {{
    var payload = {{
        type: 'df-sso-auth',
        access_token: {json.dumps(access_token)},
        refresh_token: {json.dumps(refresh_token)},
        user: {json.dumps(user_data)}
    }};
    var targetOrigin = {json.dumps(df_origin)};
    if (window.opener) {{
        window.opener.postMessage(payload, targetOrigin);
        setTimeout(function() {{ window.close(); }}, 500);
    }} else {{
        document.body.innerHTML = '<p>登录成功，请关闭此窗口并返回 Data Formulator。</p>';
    }}
}})();
</script>
</body></html>"""
        return Response(html, mimetype="text/html")


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
            'name': '<YOUR_PROVIDER_NAME>',     # 例: 'keycloak', 'okta'
            'token_key': 'access_token',
            'icon': 'fa-key',
            'remote_app': {
                'client_id': '<YOUR_CLIENT_ID>',
                'client_secret': '<YOUR_CLIENT_SECRET>',
                'server_metadata_url': '<YOUR_DISCOVERY_URL>',  # 例: https://sso.example.com/.well-known/openid-configuration
                'client_kwargs': {
                    'scope': 'openid profile email',
                },
            },
        }
    ]
}
