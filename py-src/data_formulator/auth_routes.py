# auth_routes.py

import os
import logging
from flask import Blueprint, request, session, jsonify
import jwt
import requests

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

AUTH_SERVICE_URL = "http://172.19.16.22:8888/auth/user/local"


def _decode_token(token: str) -> dict:
    """Decode JWT payload from auth service response.
    Signature verification is skipped because we trust our internal auth service
    (we only reach this after receiving HTTP 200 from it).
    Raises jwt.PyJWTError if token is malformed.
    """
    return jwt.decode(token, options={"verify_signature": False})
# ===== LOGIN BẰNG USERNAME PASSWORD =====
@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    # Gửi thông tin đăng nhập sang API nội bộ
    resp = requests.post(AUTH_SERVICE_URL, json=data)

    if resp.status_code != 200:
        logger.warning("Auth service returned %s for user '%s': %s", resp.status_code, username, resp.text[:200])
        return jsonify({"status": "error", "message": "Login failed"}), 401

    result = resp.json()
    token = result.get('token')
    try:
        decoded_token = _decode_token(token)
    except RuntimeError as e:
        logger.error("JWT config error: %s", e)
        return jsonify({"status": "error", "message": "Server configuration error"}), 500
    except jwt.PyJWTError as e:
        logger.warning("JWT decode failed for user '%s': %s", username, e)
        session.clear()
        return jsonify({"status": "error", "message": "Invalid auth token"}), 401
    # lấy claim 'agent' để lưu vào session (nếu có)
    agent_claim = decoded_token.get('agent')
    #nếu có claim  'agent' và nó  = "1" thì tiếp tục lưu session, ngược lại clear session và trả lỗi
    if agent_claim != "1":
        session.clear()
        return jsonify({"message": "Your account does not have permission to use this application. Please contact your administrator."}), 403
    else:
        session['agent'] = agent_claim
        session['download'] = decoded_token.get('download')
        # ✅ Lưu thông tin session
        session['username'] = username
        session['name'] = result.get('fullname', username)
        session['token'] = result.get('token')  # Nếu API của bạn trả token
    return jsonify({"status": "success", "message": "Login ok"})

# ===== LOGIN BẰNG MICROSOFT =====
@auth_bp.route('/microsoft', methods=['POST'])
def microsoft_login():
    data = request.get_json()
    if not data or "idToken" not in data:
        # ❌ Request sai, chắc chắn không cho login -> clear session luôn
        session.clear()
        return jsonify({"message": "Invalid request"}), 400
    id_token = data["idToken"]

    api_url = "http://172.19.16.22:8888/auth/user/microsoft"
    response = requests.post(api_url, json={"idToken": id_token})
    result = response.json()
    # ❌ Nếu API xác thực của anh trả về khác 200 -> không cho login + clear session
    if response.status_code != 200:
        session.clear()
        return jsonify({"message": result.get("message")}), 403

    # ✅ OK -> login thành công, lưu session
    token = result.get('token')
    try:
        decoded_token = _decode_token(token)
    except jwt.PyJWTError:
        session.clear()
        return jsonify({"message": "Invalid auth token"}), 401
    # lấy claim 'agent' để lưu vào session (nếu có)
    agent_claim = decoded_token.get('agent')
    #nếu có claim  'agent' và nó  = "1" thì tiếp tục lưu session, ngược lại clear session và trả lỗi
    if agent_claim != "1":
        session.clear()
        return jsonify({"message": "Your account does not have permission to use this application. Please contact your administrator."}), 403
    else:
        session['agent'] = agent_claim
        session['username'] = decoded_token.get('username')
        session['email'] = decoded_token.get('email')
        session['download'] = decoded_token.get('download')
        session['token'] = result.get('token')  # Nếu API của bạn trả token  
    return jsonify({"message": "Microsoft login success"}), 200
# ===== LẤY USER HIỆN TẠI =====
@auth_bp.route('/me', methods=['GET'])
def me():
    username = session.get('username')
    name = session.get('name')
    token = session.get('token')
    if not username:
        # Return empty array with 200 to avoid 401 showing in the browser console
        return jsonify([]), 200

    # Include download permission flag saved in session so frontend can
    # enable/disable download actions without attempting a protected request.
    download_flag = session.get('download')
    # Normalize to simple boolean/number/string as returned by auth service
    return jsonify([{
        "user_id": username,
        "token": token,
        "download": download_flag,
        "user_claims": [
            {"typ": "name", "val": name or username}  # ✅ Ưu tiên displayName
        ]
    }])

# ===== LOGOUT =====
@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "success", "message": "Logged out"})
