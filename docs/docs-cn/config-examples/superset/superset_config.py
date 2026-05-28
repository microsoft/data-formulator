import logging
import os
import sys

import secrets
import requests
from flask_appbuilder import BaseView, expose
from flask import request, jsonify, current_app
from flask_jwt_extended import create_access_token, create_refresh_token

# =============================================================================
# 基础配置
# =============================================================================

SECRET_KEY = 'YAFO_OWN_RANDOM_GENERATED_SECRET_KEY'

SQLALCHEMY_DATABASE_URI = 'postgresql://superset:YOUR_DB_PASSWORD@localhost:5432/superset'

FAB_API_SWAGGER_UI = True
SQLALCHEMY_ECHO = False

SQL_MAX_ROW = 500000
DISPLAY_MAX_ROW = 500000

# =============================================================================
# 语言
# =============================================================================

BABEL_DEFAULT_LOCALE = 'zh'
LANGUAGES = {
    'en': {'flag': 'us', 'name': 'English'},
    'zh': {'flag': 'cn', 'name': 'Chinese'},
}

# =============================================================================
# Public 角色 + 功能开关
# =============================================================================

GUEST_ROLE_NAME = "Public"
PUBLIC_ROLE_LIKE = "Gamma"

FEATURE_FLAGS = {
    "DASHBOARD_RBAC": True,
    "ENABLE_TEMPLATE_PROCESSING": True,
}

# =============================================================================
# CORS（DF 跨域调用 Superset API 时需要）
# =============================================================================

ENABLE_CORS = True
CORS_OPTIONS = {
    'supports_credentials': True,
    'allow_headers': ['*'],
    'resources': ['*'],
    'origins': ['*'],  # 生产环境请限制为 DF 的实际域名
}

# =============================================================================
# Cookie 安全配置
# =============================================================================

SESSION_COOKIE_SAMESITE = "Lax"   # 弹窗模式必须为 Lax，不能为 Strict
SESSION_COOKIE_SECURE = False     # HTTP 环境设为 False，HTTPS 环境设为 True
SESSION_COOKIE_HTTPONLY = True

# =============================================================================
# 调试 / 日志
# =============================================================================

DEBUG = False

LOG_LEVEL = 'INFO'
logging.basicConfig(
    level=LOG_LEVEL,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)

# 验证码配置（解决 RECAPTCHA_PUBLIC_KEY 错误）
RECAPTCHA_PUBLIC_KEY = ''
RECAPTCHA_PRIVATE_KEY = ''

# =============================================================================
# 导入 OAuth 配置（从 oauth_config.py）
# =============================================================================

try:
    from oauth_config import OAUTH_CONFIG
    globals().update(OAUTH_CONFIG)
    print("OAuth 配置加载成功")
except ImportError as e:
    print(f"OAuth 配置加载失败: {e}")

# =============================================================================
# Token Exchange 视图（同 IdP 换票，可选）
#
# 当 DF 和 Superset 接入同一个 SSO IdP 时启用，实现后端静默换票。
# 如果不需要可删除此段。
#
# 安全：通过 DF_EXCHANGE_SHARED_SECRET 环境变量验证调用方。
# 开发环境未设置时允许所有请求，生产环境强烈建议设置。
# =============================================================================


def _verify_exchange_secret():
    """校验共享密钥。未配置 DF_EXCHANGE_SHARED_SECRET 时放行（开发模式）。"""
    expected = os.environ.get("DF_EXCHANGE_SHARED_SECRET", "").strip()
    if not expected:
        return True
    provided = (request.headers.get("X-DF-Exchange-Secret") or "").strip()
    return secrets.compare_digest(expected, provided)


class TokenExchangeView(BaseView):
    route_base = "/api/v1/df-token-exchange"

    @expose("/", methods=["POST"])
    def exchange(self):
        if not _verify_exchange_secret():
            return jsonify({"error": "unauthorized", "message": "Invalid exchange secret"}), 403

        data = request.get_json(force=True)
        sso_token = data.get("sso_access_token")
        if not sso_token:
            return jsonify({"error": "missing_token"}), 400

        try:
            from oauth_config import ExampleSsoHandler
            resp = requests.get(
                ExampleSsoHandler.userinfo_url,
                headers={"Authorization": f"Bearer {sso_token}"},
                verify=False,
                timeout=5,
            )
            resp.raise_for_status()
            user_info = resp.json()
        except Exception:
            return jsonify({"error": "sso_token_invalid"}), 401

        username = user_info.get("preferred_username") or user_info.get("username")
        if not username:
            return jsonify({"error": "no_username"}), 401

        sm = current_app.appbuilder.sm
        user = sm.find_user(username=username)
        if not user or not user.is_active:
            return jsonify({"error": "user_not_in_superset"}), 403

        user_id_str = str(user.id)
        additional_claims = {
            "user": {
                "id": user.id,
                "username": user.username,
                "first_name": getattr(user, "first_name", "") or "",
                "last_name": getattr(user, "last_name", "") or "",
            }
        }

        return jsonify({
            "access_token": create_access_token(
                identity=user_id_str, fresh=True, additional_claims=additional_claims,
            ),
            "refresh_token": create_refresh_token(
                identity=user_id_str, additional_claims=additional_claims,
            ),
            "expires_in": 3600,
            "user": additional_claims["user"],
        })


# =============================================================================
# 统一的 FLASK_APP_MUTATOR
#
# Superset 启动时自动调用，注册所有 Data Formulator 集成所需的视图和中间件：
#   1. SSOBridgeView      → /df-sso-bridge/           （SSO 弹窗桥接）
#   2. TokenExchangeView  → /api/v1/df-token-exchange/ （同 IdP 换票）
#   3. JWT→g.user 中间件                               （FAB 权限过滤器修复）
# =============================================================================

TALISMAN_ENABLED = False


def FLASK_APP_MUTATOR(app):
    _jwt_logger = logging.getLogger("df_jwt_bridge")

    # ──── 1. 注册 SSO Bridge 视图 ────
    try:
        from oauth_config import SSOBridgeView
        app.extensions["appbuilder"].add_view_no_menu(SSOBridgeView())
        print("SSO Bridge View registered successfully!")
    except Exception as e:
        print(f"SSO Bridge View registration failed: {e}")

    # ──── 2. 注册 Token Exchange 视图 ────
    try:
        app.extensions["appbuilder"].add_view_no_menu(TokenExchangeView())
        print("Token Exchange View registered successfully!")
    except Exception as e:
        print(f"Token Exchange View registration failed: {e}")

    # ──── 3. JWT → g.user 同步中间件 ────
    @app.before_request
    def _ensure_user_from_jwt():
        from flask import g, request as req
        from flask_login import current_user, login_user

        if getattr(current_user, "is_authenticated", False) \
           and not getattr(current_user, "is_anonymous", True):
            if not hasattr(g, "user") or g.user is None \
               or getattr(g.user, "is_anonymous", True):
                g.user = current_user._get_current_object()
            return

        auth_header = req.headers.get("Authorization", "")
        if not auth_header.lower().startswith("bearer "):
            return

        try:
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
            verify_jwt_in_request(optional=True)
            identity = get_jwt_identity()
            if not identity:
                return

            sm = app.appbuilder.sm
            user = sm.get_user_by_id(int(identity))
            if user and getattr(user, "is_active", False):
                login_user(user)
                g.user = user
                _jwt_logger.debug("JWT->g.user sync OK: user_id=%s, username=%s", user.id, user.username)
        except Exception as exc:
            _jwt_logger.debug("JWT->g.user sync skipped: %s", exc)

    print("JWT->g.user middleware registered successfully!")
