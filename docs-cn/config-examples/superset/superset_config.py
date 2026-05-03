"""
Superset 配置参考（superset_config.py）

本文件为 Superset + SSO + Data Formulator 对接的配置参考。
将本文件放在 Superset 的 PYTHONPATH 下，命名为 superset_config.py。

对接文档：docs-cn/5.1-superset-sso-oauth-config-guide.md
"""

import logging
import sys

# =============================================================================
# 基础配置
# =============================================================================

SECRET_KEY = '<YOUR_SECRET_KEY>'  # 必须修改为随机字符串

SQLALCHEMY_DATABASE_URI = 'postgresql://superset:password@localhost:5432/superset'

BABEL_DEFAULT_LOCALE = 'zh'
LANGUAGES = {
    'en': {'flag': 'us', 'name': 'English'},
    'zh': {'flag': 'cn', 'name': 'Chinese'},
}

# =============================================================================
# Public 角色（可选：允许未登录用户浏览数据）
#
# 启用后，未登录用户获得 Public 角色权限（继承自 Gamma），
# 可用于设置"公开仪表盘"。
# =============================================================================

GUEST_ROLE_NAME = "Public"
PUBLIC_ROLE_LIKE = "Gamma"

# =============================================================================
# 功能开关
# =============================================================================

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
# 其他
# =============================================================================

FAB_API_SWAGGER_UI = True
SQL_MAX_ROW = 500000
DISPLAY_MAX_ROW = 500000

DEBUG = False
SESSION_COOKIE_HTTPONLY = True

LOG_LEVEL = 'INFO'
logging.basicConfig(
    level=LOG_LEVEL,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)

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
# SSO Bridge + JWT→g.user 中间件
#
# 1. 注册 /df-sso-bridge/ 视图 → DF 通过弹窗获取 Superset JWT
# 2. JWT→g.user 同步 → 确保 DF 的 JWT API 调用拥有正确权限
#    （Flask-AppBuilder 过滤器依赖 g.user，不同步则降级为 Public 权限）
# =============================================================================

TALISMAN_ENABLED = False  # Bridge 端点需要内联 <script>

try:
    def FLASK_APP_MUTATOR(app):
        from superset import appbuilder
        from oauth_config import SSOBridgeView
        appbuilder.add_view_no_menu(SSOBridgeView())

        # 注册 SSO 换票 Blueprint（可选：当 DF 与 Superset 共用同一 IdP 时启用）
        try:
            from oauth_config import df_exchange_bp
            app.register_blueprint(df_exchange_bp)
            print("DF Token Exchange 端点已注册: /api/v1/df-token-exchange/")
        except ImportError:
            print("DF Token Exchange 端点未启用（oauth_config 中未定义 df_exchange_bp）")

        _jwt_logger = logging.getLogger("df_jwt_bridge")

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
            except Exception as exc:
                _jwt_logger.debug("JWT->g.user 同步跳过: %s", exc)

    print("DF SSO Bridge + JWT 中间件配置加载成功")

except ImportError as e:
    print(f"DF SSO Bridge 配置加载失败: {e}")
