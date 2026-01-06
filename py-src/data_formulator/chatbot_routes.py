# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import logging
from flask import Blueprint, request, jsonify, send_file
import os
import requests

logger = logging.getLogger(__name__)

chatbot_bp = Blueprint('chatbot', __name__, url_prefix='/api/chatbot')

# External API endpoint
EXTERNAL_CHAT_API = "http://172.19.16.23:8888/chat"

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
        
        # # Check if user is just greeting
        # greeting_keywords = ['xin chào', 'hello', 'hi', 'chào']
        # is_greeting = any(keyword.lower() in user_message.lower() for keyword in greeting_keywords)
        
        # if is_greeting:
        #     return jsonify({
        #         'status': 'success',
        #         'reply': 'Xin chào! Tôi là chatbot của bạn. Hãy hỏi tôi bất cứ điều gì.'
        #     })
        
        # Check if user is asking about YouTube specifically
        youtube_keywords = ['youtube', 'ytb']
        is_youtube_question = any(keyword.lower() in user_message.lower() for keyword in youtube_keywords)
        
        # Check if user is asking about videos (internal video, not YouTube)
        video_keywords = ['video', 'phim', 'video link']
        is_video_question = any(keyword.lower() in user_message.lower() for keyword in video_keywords) and not is_youtube_question
        
        # Check if user is asking about web addresses/URLs
        web_keywords = ['địa chỉ web', 'website', 'url', 'http', 'link', 'web', 'trang web']
        is_web_question = any(keyword.lower() in user_message.lower() for keyword in web_keywords)
        
        if is_youtube_question:
            reply = "đây là video youtube: https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        elif is_video_question:
            reply = "đây là video: \\\\172.19.16.19\\AutoUpdate\\TIVI_DISPLAY\\ThanhIT\\Location2_main_file.mp4"
        elif is_web_question:
            reply = "địa chỉ của bạn: https://www.google.com"
        else:
            # Call external chat API for general questions
            try:
                # Build request payload - match Postman exactly
                payload = {
                    "message": user_message,
                }
                
                # Optionally add session_id and username if provided in request
                session_id = data.get('session_id') or request.args.get('session_id', '')
                username = data.get('username') or request.args.get('username', '')
                
                if session_id:
                    payload["session_id"] = session_id
                if username:
                    payload["username"] = username
                
                logger.info(f"Calling external API: {EXTERNAL_CHAT_API}")
                logger.info(f"Payload: {payload}")
                
                # Add proper headers like Postman
                headers = {
                    "Content-Type": "application/json",
                }
                
                external_response = requests.post(
                    EXTERNAL_CHAT_API,
                    json=payload,
                    headers=headers,
                    timeout=60
                )
                
                logger.info(f"External API status code: {external_response.status_code}")
                
                if external_response.status_code == 200:
                    external_data = external_response.json()
                    reply = external_data.get('reply', 'xin chào')
                    context = external_data.get('context', {})
                    
                    logger.info(f"External API response received successfully")
                    
                    # If there's a chart result, include it in response
                    if context.get('trend_chart_result'):
                        logger.info(f"Chart result found in response")
                else:
                    logger.error(f"External API returned status {external_response.status_code}")
                    logger.error(f"Response text: {external_response.text}")
                    logger.error(f"Response headers: {external_response.headers}")
                    logger.error(f"Request payload was: {payload}")
                    reply = f"External API error: {external_response.status_code}"
            except requests.exceptions.Timeout as e:
                logger.error(f"External API timeout: {e}")
                reply = "Timeout khi kết nối với external API"
            except requests.exceptions.ConnectionError as e:
                logger.error(f"Connection error to external API: {e}")
                reply = "Không thể kết nối với external API"
            except requests.exceptions.RequestException as e:
                logger.error(f"Request exception: {e}")
                reply = f"Lỗi kết nối: {str(e)}"
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                reply = f"Lỗi không mong muốn: {str(e)}"
        
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

@chatbot_bp.route('/video', methods=['GET'])
def serve_video():
    """
    Serve video file from UNC path or local path
    
    Query params:
    - path: UNC path or local path to video file (encoded)
    """
    try:
        video_path = request.args.get('path', '').strip()
        
        if not video_path:
            return jsonify({
                'status': 'error',
                'message': 'Missing video path'
            }), 400
        
        # Check if file exists
        if not os.path.exists(video_path):
            logger.error(f"Video file not found: {video_path}")
            return jsonify({
                'status': 'error',
                'message': 'Video file not found'
            }), 404
        
        # Check if it's a video file
        valid_extensions = ('.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv')
        if not video_path.lower().endswith(valid_extensions):
            return jsonify({
                'status': 'error',
                'message': 'Invalid video format'
            }), 400
        
        logger.info(f"Serving video: {video_path}")
        
        # Return video file with streaming support
        return send_file(
            video_path,
            mimetype='video/mp4',
            as_attachment=False
        )
    
    except Exception as e:
        logger.error(f"Error serving video: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500
