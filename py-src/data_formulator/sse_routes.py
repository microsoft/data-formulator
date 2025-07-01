# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import queue
import time
import logging
from typing import Dict, Any, Generator
from flask import Blueprint, Response, session, request, jsonify, current_app
import threading
import uuid
from pprint import pprint

# Get logger for this module
logger = logging.getLogger(__name__)

# Create blueprint for SSE routes
sse_bp = Blueprint('sse', __name__, url_prefix='/api/sse')

# Add a lock for thread safety
sse_connections_lock = threading.RLock()
sse_connections: Dict[str, Dict[str, Any]] = {}

@sse_bp.route('/connect')
def sse_connect():
    """
    SSE endpoint for clients to establish a connection and receive real-time messages
    """
    session_id = session.get('session_id')
    connection_id = f"conn_{uuid.uuid4().hex[:8]}"
    
    if not session_id:
        return Response("No session ID found", status=401)
    
    logger.info(f"[SSE Connect] Thread {threading.current_thread().name} accessing sse_connections")
    logger.info(f"[SSE Connect] sse_connections id: {id(sse_connections)}")
    
    # Thread-safe connection creation
    with sse_connections_lock:
        if session_id not in sse_connections:
            sse_connections[session_id] = {
                'queue': queue.Queue(),
                'connected_clients': []
            }
        sse_connections[session_id]['connected_clients'].append(connection_id)
        logger.info(f"[SSE Connect] sse_connections after creation: {sse_connections}")
    

    def event_stream() -> Generator[str, None, None]:
        """Generator function that yields SSE formatted messages"""
        client_queue = sse_connections[session_id]['queue']
        
        # Send initial connection confirmation
        yield format_sse_message({
            "type": "heartbeat",
            "text": "agent connection ready",
            "timestamp": time.time()
        })
        
        try:
            logger.info(f"Starting event stream for connection {connection_id} for session {session_id}")
            last_heartbeat_time = time.time()
            while True:
                try:
                    message = client_queue.get(timeout=1)  # 1 second timeout
                    yield format_sse_message(message)
                except queue.Empty:
                    # Send heartbeat to keep connection alive
                    if time.time() - last_heartbeat_time > 30:
                        last_heartbeat_time = time.time()
                        yield format_sse_message({
                            "type": "heartbeat",
                            "text": "Heartbeat",
                            "timestamp": time.time()
                        })
                    else:
                       # lightweight heartbeat to keep connection alive (no data)
                       yield ": heartbeat\n\n"
                except Exception as e:
                    logger.error(f"Error in SSE stream for session {session_id}: {e}")
                    break
        finally:
            # Safe cleanup with reference counting
            with sse_connections_lock:
                logger.info(f"[SSE Connect] cleaning up connection {connection_id} for session {session_id}")
                logger.info(f"[SSE Connect] sse_connections before cleanup: {sse_connections}")
                if session_id in sse_connections:
                    sse_connections[session_id]['connected_clients'].remove(connection_id)
                    if len(sse_connections[session_id]['connected_clients']) == 0:
                        del sse_connections[session_id]
                        logger.info(f"Last SSE connection ({connection_id}) closed for session {session_id}")
                logger.info(f"[SSE Connect] sse_connections after cleanup: {sse_connections}")
                
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
        "text": "....",
        "data": {...} (optional)
    }
    """
    content = request.get_json()
    if not content:
        return jsonify({"error": "No JSON data provided"}), 400
    
    target_session_id = content.get('session_id')
    text = content.get('text')
    data = content.get('data', {})
    
    if not target_session_id:
        return jsonify({"error": "session_id is required"}), 400
    
    message = {
        "type": "action",
        "text": text,
        "data": data
    }
    
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
    
    connection_info = {}
    logger.info(f"[SSE Status] Thread {threading.current_thread().name} accessing sse_connections")
    logger.info(f"[SSE Status] sse_connections id: {id(sse_connections)}")
    logger.info(f"[SSE Status] sse_connections: {sse_connections}")
    
    with sse_connections_lock:
        for session_id, connection in sse_connections.items():
            connection_info[session_id] = {
                'connected_clients': connection['connected_clients'],
                'queue_size': connection['queue'].qsize()
            }
    
    return jsonify({
        "connected_sessions": connection_info
    })

@sse_bp.route('/sse-connection-check', methods=['POST'])
def sse_connection_check():
    session_id = request.json.get('session_id')
    if session_id in sse_connections:
        return jsonify({"status": "connected"})
    else:
        return jsonify({"status": "disconnected"}), 404

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
    with sse_connections_lock:
        if session_id not in sse_connections:
            logger.warning(f"Attempted to send message to non-existent session: {session_id}")
            return False
        
        try:
            sse_connections[session_id]['queue'].put(message)
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
    
    # Get a snapshot of session IDs to avoid iteration issues
    with sse_connections_lock:
        session_ids = list(sse_connections.keys())
    
    for session_id in session_ids:
        if send_sse_message(session_id, message):
            sent_count += 1
    
    logger.info(f"Broadcasted message to {sent_count} clients: {message.get('type', 'unknown')}")
    return sent_count