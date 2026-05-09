import logging
import os
import secrets
import json
import requests
from urllib.parse import quote, urlparse

from flask_appbuilder.security.manager import AUTH_OAUTH
from flask_appbuilder import BaseView, expose
from flask import g, request, Response, redirect, session, render_template_string
from flask_login import current_user
from superset.security import SupersetSecurityManager
from superset import db

logger = logging.getLogger(__name__)


# =============================================================================
# 第一部分：SSO 用户信息解析
# =============================================================================

class ExampleSsoHandler:
    """
    处理某个 SSO Provider 的用户信息解析逻辑。
    请根据实际 SSO 系统修改 userinfo_url 和 role_mapping。
    """
    handler_name = '生产环境SSO'
    # TODO: 替换为您的 SSO 系统 userinfo 端点
    userinfo_url = '<YOUR_SSO_USERINFO_URL>'

    # SSO 角色 → Superset 角色映射
    # DF 通过 Chart Data API 拉取数据，仅需 datasource access 权限。
    # - Admin / Alpha：自动拥有所有数据集的访问权限
    # - Gamma：需要管理员在 Superset 中授予具体数据集的 datasource access
    # 不需要 SQL Lab 相关权限（can execute on SqlLab 等）。

    role_mapping = {
        'role_admin': 'Admin',
        'role_analyst': 'Alpha',
        'role_viewer': 'Gamma',
        'role_editor': 'Alpha',
    }

    @classmethod
    def parse_user_details(cls, access_token):
        resp = requests.get(
            cls.userinfo_url,
            headers={'Authorization': f'Bearer {access_token}'},
            verify=False,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info("%s-用户信息: %s", cls.handler_name, data)

        username = data.get('preferred_username') or data.get('sub')
        if not username:
            logger.error("用户名 username 为空！")
            return None

        full_name = data.get('name') or username
        email = data.get('email') or f"{username}@example.com"
        name_parts = full_name.split(' ', 1)

        return {
            'username': username,
            'email': email,
            'first_name': name_parts[0],
            'last_name': name_parts[1] if len(name_parts) > 1 else '',
            'sub': str(data.get('sub')) if data.get('sub') is not None else None,
            'sso_roles': data.get('sso_roles', []),
            'user_code': data.get('user_code', None),
        }


class StagingSsoHandler(ExampleSsoHandler):
    """处理测试/预发布环境的 SSO。继承生产配置，仅覆盖端点地址。"""
    handler_name = '测试环境SSO'
    # TODO: 替换为您的测试环境 SSO userinfo 端点
    userinfo_url = 'https://sso-staging.your-company.com/api/v1/oauth2/userinfo'


# ============================================================
# Provider 与 Handler 的映射关系
# ============================================================

PROVIDER_HANDLERS = {
    # TODO: key 必须与 OAUTH_PROVIDERS 中的 name 字段一致
    'my-sso': ExampleSsoHandler,
    'my-sso-staging': StagingSsoHandler,
}


# =============================================================================
# 第二部分：自定义 Security Manager
# =============================================================================

class CustomSsoSecurityManager(SupersetSecurityManager):

    def oauth_user_info(self, provider, response=None):
        """从 OAuth 响应中解析用户信息。"""
        access_token = response.get('access_token') if response else None
        handler = PROVIDER_HANDLERS.get(provider)

        if not handler or not access_token:
            logger.error("缺少 provider handler 或 token: %s", provider)
            return super().oauth_user_info(provider, response)

        try:
            logger.info("Using %s to parse user info", handler.__name__)
            user_details = handler.parse_user_details(access_token)
            user_details['active_provider'] = provider
            return user_details
        except Exception as e:
            logger.error("OAuth 用户信息同步失败: %s", e, exc_info=True)
            return None

    def auth_user_oauth(self, userinfo):
        """创建或更新用户，并同步角色。"""
        username = userinfo.get('username')
        provider = userinfo.get('active_provider')
        handler = PROVIDER_HANDLERS.get(provider)
        sso_roles = userinfo.get('sso_roles', [])
        user_code = userinfo.get('user_code', None)

        has_mapped_role = any(role in handler.role_mapping for role in sso_roles)
        if not has_mapped_role:
            from flask import flash
            flash("登录失败：您的账号尚未被分配 Superset 访问权限，请联系管理员。", "danger")
            return None

        user = self.find_user(username=username)
        if not user:
            if self.auth_user_registration:
                logger.info("正在创建新用户: %s", username)
                user = super().auth_user_oauth(userinfo)
            else:
                logger.warning("用户 %s 不存在且未开启自动注册", username)
                return None
        else:
            logger.info("找到现有用户: %s，正在同步个人资料", username)
            user.first_name = userinfo.get('first_name', user.first_name)
            user.last_name = userinfo.get('last_name', user.last_name)
            user.email = userinfo.get('email', user.email)

        if handler and sso_roles:
            self._sync_roles_by_handler(user, sso_roles, handler.role_mapping)

        self._sync_user_code(username, user.id, user_code)
        return user

    def _sync_user_code(self, username, user_id, user_code):
        """同步用户 user_code 到 user_attribute 表。"""
        if user_code is None or len(str(user_code).strip()) == 0:
            return
        logger.info("同步用户【%s】user_code: %s", username, user_code)
        try:
            from sqlalchemy import text
            check_sql = text("SELECT count(*) FROM user_attribute WHERE user_id = :u_id")
            count = db.session.execute(check_sql, {"u_id": user_id}).scalar()
            if count > 0:
                update_sql = text(
                    "UPDATE user_attribute SET user_code = :u_code WHERE user_id = :u_id"
                )
                db.session.execute(update_sql, {"u_code": user_code, "u_id": user_id})
            else:
                insert_sql = text(
                    "INSERT INTO user_attribute (user_id, user_code) VALUES (:u_id, :u_code)"
                )
                db.session.execute(insert_sql, {"u_id": user_id, "u_code": user_code})
            db.session.commit()
            logger.info("同步用户【%s】user_code: %s 完成", username, user_code)
        except Exception as e:
            db.session.rollback()
            logger.error("同步用户【%s】user_code 异常: %s", username, e)

    def get_user_code_native(self, user_id):
        """通过原生 SQL 获取指定用户的 user_code。"""
        try:
            from sqlalchemy import text
            sql = text("SELECT user_code FROM user_attribute WHERE user_id = :u_id")
            result = db.session.execute(sql, {"u_id": user_id}).fetchone()
            if result and result[0]:
                return result[0]
            return None
        except Exception as e:
            logger.warning("查询用户【%s】user_code 异常: %s", user_id, e)
            return None

    def _sync_roles_by_handler(self, user, sso_roles, mapping):
        """将 SSO 角色映射为 Superset 角色。本地 Admin 身份始终保留。"""
        target_role_names = set()

        for sr in sso_roles:
            if sr in mapping:
                target_role_names.add(mapping[sr])
            else:
                logger.info("SSO 角色 '%s' 未在映射表中定义，跳过", sr)

        if any(r.name == 'Admin' for r in user.roles):
            target_role_names.add('Admin')

        new_roles = []
        for role_name in target_role_names:
            role = self.find_role(role_name)
            if role:
                new_roles.append(role)
            else:
                logger.warning("Superset 数据库中找不到角色 '%s'", role_name)

        if not new_roles:
            logger.info("用户 %s 无有效角色可分配，跳过更新", user.username)
            return

        try:
            user.roles = new_roles
            db.session.merge(user)
            db.session.commit()
            logger.info("用户 %s 最终角色列表: %s", user.username, [r.name for r in new_roles])
        except Exception as e:
            db.session.rollback()
            logger.error("角色同步数据库事务失败: %s", e)


# =============================================================================
# 第三部分：Data Formulator SSO 桥接端点
#
# 流程：
#   1. DF 前端 window.open(/df-sso-bridge/?df_origin=http://df-host:5567)
#   2. 未登录 → 重定向到 /login/?next=... → SSO → 回到此端点
#   3. 已登录 → 签发 JWT → postMessage 传给 DF → 关闭弹窗
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

# 允许接收 JWT 的 DF 前端 origin 白名单。
# 可通过环境变量 DF_ALLOWED_ORIGINS 追加（逗号分隔）。
_DEFAULT_ALLOWED_ORIGINS = {
    "http://localhost:5567",
    "http://127.0.0.1:5567",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # TODO: 如有远程部署的 DF 前端，在此添加其 origin，或通过环境变量 DF_ALLOWED_ORIGINS 配置
    # "https://df.your-company.com",
}


def _normalise_origin(raw):
    """规范化浏览器 origin；非法或非 origin 格式返回空字符串。"""
    raw = (raw or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    if parsed.username or parsed.password:
        return ""
    if parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _get_allowed_origins():
    origins = {_normalise_origin(o) for o in _DEFAULT_ALLOWED_ORIGINS}
    env_origins = os.environ.get("DF_ALLOWED_ORIGINS", "")
    for raw in env_origins.split(","):
        origin = _normalise_origin(raw)
        if origin:
            origins.add(origin)
    origins.discard("")
    return origins


class SSOBridgeView(BaseView):
    route_base = "/df-sso-bridge"

    @staticmethod
    def _is_real_logged_in_user():
        """
        判断当前请求是否来自一个真正登录过的用户。
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
    def _validate_origin(raw_origin):
        """校验 df_origin 是否在白名单中。返回规范化的合法 origin 或空字符串。"""
        origin = _normalise_origin(raw_origin)
        return origin if origin in _get_allowed_origins() else ""

    @staticmethod
    def _safe_next_path(raw_path):
        """只允许站内相对路径进入 login next 参数，防止 open redirect。"""
        next_path = (raw_path or "/").rstrip("?").replace("\\", "/")
        parsed = urlparse(next_path)
        if (
            not next_path.startswith("/")
            or next_path.startswith("//")
            or parsed.scheme
            or parsed.netloc
        ):
            return "/df-sso-bridge/"
        return next_path

    @expose("/", methods=["GET"])
    def df_sso_bridge(self):
        logger.info(
            "进入 df-sso-bridge. is_anonymous=%s, session._user_id=%s, username=%s",
            getattr(current_user, "is_anonymous", "N/A"),
            session.get("_user_id"),
            getattr(current_user, "username", "N/A"),
        )

        # ── 未登录：重定向到 Superset 登录页 ──
        if not self._is_real_logged_in_user():
            next_url = self._safe_next_path(request.full_path)
            login_redirect = f"/login/?next={quote(next_url)}"
            logger.info("用户未真实登录，重定向到: %s", login_redirect)
            return redirect(login_redirect)

        logger.info("已验证真实用户: id=%s, username=%s", current_user.id, current_user.username)

        # ── 校验 df_origin ──
        df_origin = self._validate_origin(request.args.get("df_origin"))
        if not df_origin:
            logger.warning("df_origin 校验失败: %s", request.args.get("df_origin"))
            return Response(
                "Invalid df_origin. 请确认 DF 前端 origin 已加入白名单。",
                status=400,
                mimetype="text/plain",
            )

        # ── 签发 JWT ──
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

        logger.info("JWT 已为用户 %s (id=%s) 生成", current_user.username, current_user.id)

        # ── 使用 Jinja2 模板渲染 postMessage 页面 ──
        payload = {
            "type": "df-sso-auth",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": additional_claims["user"],
        }
        csp_nonce = getattr(g, "csp_nonce", "") or secrets.token_urlsafe(16)

        html = render_template_string(
            _SSO_BRIDGE_TEMPLATE,
            payload=payload,
            target_origin=df_origin,
            csp_nonce=csp_nonce,
        )
        return Response(html, mimetype="text/html")


# ============================================================
# 导出的配置字典
# ============================================================

OAUTH_CONFIG = {
    'AUTH_TYPE': AUTH_OAUTH,
    'AUTH_USER_REGISTRATION': True,
    'AUTH_USER_REGISTRATION_ROLE': "Public",
    'AUTH_OAUTH_ROLES_SYNC': True,
    'AUTH_OAUTH_ROLES_UPDATE': True,
    'CUSTOM_SECURITY_MANAGER': CustomSsoSecurityManager,
    'OAUTH_PROVIDERS': [
        {
            'name': 'my-sso',                    # 必须与 PROVIDER_HANDLERS 中的 key 一致
            'token_key': 'access_token',
            'icon': 'fa-key',
            'remote_app': {
                # TODO: 替换为您在 SSO 系统中注册的 OAuth 应用凭据
                'client_id': 'YOUR_CLIENT_ID_HERE',
                'client_secret': 'YOUR_CLIENT_SECRET_HERE',
                'server_metadata_url': 'https://sso.your-company.com/api/v1/oauth2/.well-known/openid-configuration',
                'client_kwargs': {'scope': 'openid profile email', 'verify': False},
            },
        },
        # 如需启用测试/预发布环境 SSO，取消以下注释并填入对应凭据：
        # {
        #     'name': 'my-sso-staging',
        #     'token_key': 'access_token',
        #     'icon': 'fa-lock',
        #     'remote_app': {
        #         'client_id': 'YOUR_STAGING_CLIENT_ID_HERE',
        #         'client_secret': 'YOUR_STAGING_CLIENT_SECRET_HERE',
        #         'server_metadata_url': 'https://sso-staging.your-company.com/api/v1/oauth2/.well-known/openid-configuration',
        #         'client_kwargs': {'scope': 'openid profile email', 'verify': False},
        #     },
        # },
    ]
}

# NOTE: FLASK_APP_MUTATOR 已统一在 superset_config.py 中定义，
# 包含 SSOBridgeView、TokenExchangeView 和 JWT→g.user 中间件的注册。
# 请勿在此文件中重复定义。
