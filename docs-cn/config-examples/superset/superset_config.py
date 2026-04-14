"""
Superset 配置参考（superset_config.py）

本文件为 Superset + SSO + DF 对接的配置参考。
将本文件放在 Superset 的 PYTHONPATH 下，命名为 superset_config.py。

重点关注：
  - Public 角色配置（允许未登录用户浏览指定数据）
  - OAuth 配置导入
  - FLASK_APP_MUTATOR（注册 SSO Bridge + JWT→g.user 中间件）
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
# Public 角色配置（允许未登录用户浏览数据）
#
# 启用后，未登录用户会获得 Public 角色的权限（继承自 Gamma）。
# 这允许你设置"公开仪表盘"供任何人查看，无需登录。
#
# 副作用：启用后 current_user.is_authenticated 对匿名用户也可能返回
# True，导致 DF 的 JWT 认证用户被误判为 Public 用户。
# 解决方案见下方 FLASK_APP_MUTATOR 中的 _ensure_user_from_jwt 中间件。
# =============================================================================

GUEST_ROLE_NAME = "Public"
PUBLIC_ROLE_LIKE = "Gamma"

# =============================================================================
# 功能开关
# =============================================================================

FEATURE_FLAGS = {
    "DASHBOARD_RBAC": True,                 # 仪表盘级别的角色权限控制
    "ENABLE_TEMPLATE_PROCESSING": True,     # Jinja 模板支持
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
RECAPTCHA_PUBLIC_KEY = ''
RECAPTCHA_PRIVATE_KEY = ''

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
# 解决两个问题：
#   1. 注册 /df-sso-bridge/ 视图，让 DF 能通过弹窗获取 Superset JWT
#   2. JWT→g.user 同步：当 DF 用 JWT Bearer Token 调用 Superset REST API 时，
#      flask_jwt_extended 能识别用户（/api/v1/me/ 正常），但 Flask-AppBuilder
#      的安全过滤器（DatasourceFilter、DashboardAccessFilter）依赖 g.user
#      做权限判断。如果 g.user 未从 JWT 同步，过滤器降级为 Public 角色，
#      导致登录用户只能看到 Public 权限的数据。
# =============================================================================

TALISMAN_ENABLED = False  # Bridge 端点需要内联 <script>

try:
    def FLASK_APP_MUTATOR(app):
        """Superset 启动时调用，注册 Bridge 视图和 JWT 中间件。"""

        # 1. 注册 SSO Bridge 视图
        from superset import appbuilder
        from oauth_config import SSOBridgeView
        appbuilder.add_view_no_menu(SSOBridgeView())

        # 2. JWT→g.user 同步中间件
        _jwt_logger = logging.getLogger("df_jwt_bridge")

        @app.before_request
        def _ensure_user_from_jwt():
            from flask import g, request as req
            from flask_login import current_user, login_user

            # 已有会话用户 → 同步到 g.user
            if getattr(current_user, "is_authenticated", False) \
               and not getattr(current_user, "is_anonymous", True):
                if not hasattr(g, "user") or g.user is None \
                   or getattr(g.user, "is_anonymous", True):
                    g.user = current_user._get_current_object()
                return

            # 无会话 → 尝试从 JWT 恢复
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
