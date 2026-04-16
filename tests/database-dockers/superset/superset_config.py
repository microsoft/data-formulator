# Custom Superset config for Data Formulator test instance.
# Adds the SSO bridge endpoint so DF can test token-based login.

import json
import logging
from urllib.parse import urlencode

from flask import Blueprint, Response, redirect, request, url_for
from flask_login import current_user

logger = logging.getLogger(__name__)

# -- SSO bridge as a plain Flask Blueprint (registered via BLUEPRINTS) --------

df_sso_bp = Blueprint("df_sso_bridge", __name__)


@df_sso_bp.route("/df-sso-bridge/", methods=["GET"])
def df_sso_bridge():
    """Issue JWT tokens to an authenticated Superset user and post them
    back to the Data Formulator frontend via ``postMessage``.

    Query params:
        df_origin: The DF frontend origin (e.g. http://localhost:5567).
    """
    df_origin = request.args.get("df_origin", "*")

    if not current_user.is_authenticated:
        # Redirect to Superset login, then back here after authentication.
        bridge_url = request.url  # preserves df_origin query param
        return redirect(f"/login/?next={bridge_url}")

    from flask_jwt_extended import create_access_token, create_refresh_token

    access_token = create_access_token(identity=current_user.id, fresh=True)
    refresh_token = create_refresh_token(identity=current_user.id)

    user_data = {
        "id": current_user.id,
        "username": current_user.username,
        "first_name": getattr(current_user, "first_name", "") or "",
        "last_name": getattr(current_user, "last_name", "") or "",
    }

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SSO Bridge</title></head>
<body>
<p>Completing login...</p>
<script>
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
        document.body.innerHTML = '<p>Login successful. You can close this window and return to Data Formulator.</p>';
    }}
}})();
</script>
</body></html>"""
    return Response(html, mimetype="text/html")


# -- Register the blueprint with Superset ------------------------------------
BLUEPRINTS = [df_sso_bp]

# Allow embedding in popups from DF dev server origins
TALISMAN_ENABLED = False

# CORS is configured via environment variables in docker-compose.yml
# (SUPERSET_CORS_ENABLED / SUPERSET_CORS_ORIGINS).
# Do NOT set ENABLE_CORS here — the official image lacks flask-cors.

# Feature flags — ensure native dashboard filters are enabled for filter testing.
FEATURE_FLAGS = {
    "DASHBOARD_NATIVE_FILTERS": True,
    "DASHBOARD_CROSS_FILTERS": True,
    "DASHBOARD_NATIVE_FILTERS_SET": True,
}
