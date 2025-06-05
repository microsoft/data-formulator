# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import queue
import time
import logging
from typing import Dict, Any, Generator
from flask import Blueprint, Response, session, request, jsonify, current_app
import threading

# Get logger for this module
logger = logging.getLogger(__name__)

# Create blueprint for SSE routes
sse_bp = Blueprint('sse', __name__, url_prefix='/api/sse')

# Global dictionary to store SSE connections
sse_connections: Dict[str, queue.Queue] = {}

@sse_bp.route('/connect')
def sse_connect():
    """
    SSE endpoint for clients to establish a connection and receive real-time messages
    """
    session_id = session.get('session_id')
    if not session_id:
        return Response("No session ID found", status=401)
    
    logger.info(f"SSE connection established for session: {session_id}")
    
    # Create a queue for this session if it doesn't exist
    if session_id not in sse_connections:
        sse_connections[session_id] = queue.Queue()
    
    def event_stream() -> Generator[str, None, None]:
        """Generator function that yields SSE formatted messages"""
        client_queue = sse_connections[session_id]
        
        # Send initial connection confirmation
        yield format_sse_message({
            "type": "notification",
            "text": "SSE connection established successfully",
            "timestamp": time.time()
        })
        
        try:
            while True:
                try:
                    # Wait for messages with a timeout to allow periodic heartbeat
                    message = client_queue.get(timeout=30)  # 30 second timeout
                    yield format_sse_message(message)
                except queue.Empty:
                    # Send heartbeat to keep connection alive
                    yield format_sse_message({
                        "type": "notification",
                        "text": "Heartbeat",
                        "timestamp": time.time()
                    })
                except Exception as e:
                    logger.error(f"Error in SSE stream for session {session_id}: {e}")
                    break
        finally:
            # Clean up connection when client disconnects
            if session_id in sse_connections:
                del sse_connections[session_id]
                logger.info(f"SSE connection closed for session: {session_id}")
    
    return Response(
        event_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        }
    )

@sse_bp.route('/send-message', methods=['POST'])
def send_message_to_session():
    """
    Endpoint to send a message to a specific session via SSE
    Expected JSON payload: {
        "type": "action" | "notification" | "heartbeat",
        "message": {...},
        "data": {...}
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400
    
    target_session_id = data.get('session_id')
    message = data.get('message', {})
    
    if not target_session_id:
        return jsonify({"error": "session_id is required"}), 400
    
    success = send_sse_message(target_session_id, message)
    
    if success:
        return jsonify({"status": "Message sent successfully"})
    else:
        return jsonify({"error": "Session not found or not connected"}), 404

@sse_bp.route('/broadcast', methods=['POST'])
def broadcast_message():
    """
    Endpoint to broadcast a message to all connected SSE clients
    Expected JSON payload: {
        "message": {...}
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400
    
    message = data.get('message', {})
    sent_count = broadcast_sse_message(message)
    
    return jsonify({
        "status": f"Message broadcasted to {sent_count} connected clients"
    })

@sse_bp.route('/status')
def get_sse_status():
    """Get the current status of SSE connections"""
    
    return jsonify({
        "connected_sessions": list(sse_connections.keys()),
        "total_connections": len(sse_connections)
    })

@sse_bp.route('/trigger_notification', methods=['POST'])
def trigger_notification():
    """
    Endpoint to trigger a notification to a specific session
    Expected JSON payload: {
        "type": "notification",
        "text": "Notification message",
        "data": {...} (optional)
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400
    
    session_id = data.get('session_id')
    text = data.get('text')
    data = data.get('data', {})
    
    # Validate required fields
    if not session_id:
        return jsonify({"error": "session_id is required"}), 400
    if not text:
        return jsonify({"error": "text is required"}), 400
    
    # Extract any additional data
    additional_data = data.get('data', {})
    
    # Send the notification
    success = send_notification(
        session_id=session_id,
        text=text,
        data=data
    )
    
    if success:
        return jsonify({
            "status": "Notification sent successfully",
            "session_id": session_id,
        })
    else:
        return jsonify({"error": "Session not found or not connected"}), 404

# Utility functions

def format_sse_message(data: Dict[str, Any]) -> str:
    """Format a message for SSE transmission"""
    # Add timestamp if not present
    if 'timestamp' not in data:
        data['timestamp'] = time.time()
    
    json_data = json.dumps(data)
    return f"data: {json_data}\n\n"

def send_sse_message(session_id: str, message: Dict[str, Any]) -> bool:
    """
    Send a message to a specific session via SSE
    
    Args:
        session_id: Target session ID
        message: Message data to send
        
    Returns:
        bool: True if message was sent successfully, False otherwise
    """
    
    if session_id not in sse_connections:
        logger.warning(f"Attempted to send message to non-existent session: {session_id}")
        return False
    
    try:
        sse_connections[session_id].put(message)
        logger.info(f"Message sent to session {session_id}: {message.get('type', 'unknown')}")
        return True
    except Exception as e:
        logger.error(f"Failed to send message to session {session_id}: {e}")
        return False

def broadcast_sse_message(message: Dict[str, Any]) -> int:
    """
    Broadcast a message to all connected SSE clients
    
    Args:
        message: Message data to broadcast
        
    Returns:
        int: Number of clients the message was sent to
    """
    sent_count = 0
    
    for session_id in list(sse_connections.keys()):
        if send_sse_message(session_id, message):
            sent_count += 1
    
    logger.info(f"Broadcasted message to {sent_count} clients: {message.get('type', 'unknown')}")
    return sent_count

def send_notification(session_id: str, text: str, data: Dict[str, Any]):
    """
    Send a notification message to a specific session
    
    Args:
        session_id: Target session ID
        text: Notification text
        data: Additional data to include in the notification
    """
    message = {
        "type": "notification",
        "text": text,
        "data": data
    }
    
    return send_sse_message(session_id, message)

