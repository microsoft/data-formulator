# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import logging
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

chatbot_bp = Blueprint('chatbot', __name__, url_prefix='/api/chatbot')

@chatbot_bp.route('/message', methods=['POST'])
def send_message():
    """
    Simple chatbot endpoint that processes messages
    For now, always returns a greeting in Vietnamese
    
    Request body:
    {
        "message": "user message"
    }
    
    Response:
    {
        "status": "success",
        "reply": "response message"
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'message' not in data:
            return jsonify({
                'status': 'error',
                'message': 'Missing message in request'
            }), 400
        
        user_message = data.get('message', '').strip()
        
        if not user_message:
            return jsonify({
                'status': 'error',
                'message': 'Message cannot be empty'
            }), 400
        
        # TODO: Add actual chatbot logic here
        # For now, always return a greeting
        reply = "xin chào"
        
        logger.info(f"Chatbot received message: {user_message}")
        
        return jsonify({
            'status': 'success',
            'reply': reply
        })
    
    except Exception as e:
        logger.error(f"Error processing chatbot message: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500
