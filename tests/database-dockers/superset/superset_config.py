# Custom Superset config for Data Formulator test instance.
# Adds the SSO bridge endpoint so DF can test token-based login.

import logging
import os
from urllib.parse import quote, urlparse

from flask import Blueprint, Response, redirect, render_template_string, request
from flask_login import current_user

logger = logging.getLogger(__name__)

# -- SSO bridge as a plain Flask Blueprint (registered via BLUEPRINTS) --------

df_sso_bp = Blueprint("df_sso_bridge", __name__)

_DEFAULT_DF_ALLOWED_ORIGINS = frozenset({
    "http://localhost:5567",
    "http://127.0.0.1:5567",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
})

_SSO_BRIDGE_TEMPLATE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SSO Bridge</title></head>
<body>
<p>Completing login...</p>
<script>
(function() {
    var payload = {{ payload | tojson }};
    var targetOrigin = {{ target_origin | tojson }};
    if (window.opener) {
        window.opener.postMessage(payload, targetOrigin);
        setTimeout(function() { window.close(); }, 500);
    } else {
        document.body.textContent = 'Login successful. You can close this window and return to Data Formulator.';
    }
})();
</script>
</body></html>"""


def _normalise_origin(raw_origin):
    """Return a canonical browser origin, or empty string when invalid."""
    raw = (raw_origin or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    if parsed.username or parsed.password:
        return ""
    if parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _allowed_df_origins():
    origins = set(_DEFAULT_DF_ALLOWED_ORIGINS)
    for raw in os.environ.get("DF_ALLOWED_ORIGINS", "").split(","):
        origin = _normalise_origin(raw)
        if origin:
            origins.add(origin)
    return origins


def _validate_df_origin(raw_origin):
    origin = _normalise_origin(raw_origin)
    return origin if origin in _allowed_df_origins() else ""


@df_sso_bp.route("/df-sso-bridge/", methods=["GET"])
def df_sso_bridge():
    """Issue JWT tokens to an authenticated Superset user and post them
    back to the Data Formulator frontend via ``postMessage``.

    Query params:
        df_origin: The DF frontend origin (e.g. http://localhost:5567).
    """
    df_origin = _validate_df_origin(request.args.get("df_origin"))
    if not df_origin:
        return Response("Invalid df_origin", status=400, mimetype="text/plain")

    if not current_user.is_authenticated:
        # Only allow same-site relative redirects (prevent open redirect).
        next_path = request.full_path.rstrip("?")
        return redirect(f"/login/?next={quote(next_path)}")

    from flask_jwt_extended import create_access_token, create_refresh_token

    access_token = create_access_token(identity=current_user.id, fresh=True)
    refresh_token = create_refresh_token(identity=current_user.id)

    user_data = {
        "id": current_user.id,
        "username": current_user.username,
        "first_name": getattr(current_user, "first_name", "") or "",
        "last_name": getattr(current_user, "last_name", "") or "",
    }

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
    )
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
