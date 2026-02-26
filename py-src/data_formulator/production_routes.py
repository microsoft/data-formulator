# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import logging
import requests
import json
from flask import request, jsonify, Blueprint, session
from typing import List, Dict, Any

# Get logger for this module
logger = logging.getLogger(__name__)

production_bp = Blueprint('production', __name__, url_prefix='/api/production')

# External API configuration
EXTERNAL_API_BASE_URL = "http://172.19.16.22:8888"

# Cache for external data to reduce API calls
_data_cache: Dict[str, Any] = {}


def fetch_from_external_api(endpoint: str, jwt_token: str = None, payload: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Fetch data from external production API with caching using POST
    
    Args:
        endpoint: API endpoint path (e.g., '/pdinput/mfacode/all')
        jwt_token: JWT token for authorization (optional)
        payload: POST body payload (optional, defaults to empty dict)
    
    Returns:
        Dict with status and data, or error message
    """
    try:
        # For cache key, include payload in hash to differentiate requests
        cache_key = f"{EXTERNAL_API_BASE_URL}{endpoint}:{json.dumps(payload or {}, sort_keys=True)}"
        
        # Check cache first
        if cache_key in _data_cache:
            logger.info(f"Using cached data for {endpoint}")
            return _data_cache[cache_key]
        
        # Fetch from external API using POST
        url = f"{EXTERNAL_API_BASE_URL}{endpoint}"
        logger.info(f"Fetching data from external API (POST): {url}")
        logger.info(f"JWT token present: {jwt_token is not None}")
        if jwt_token:
            logger.info(f"JWT token length: {len(jwt_token)}")
        
        headers = {
            "Content-Type": "application/json"
        }
        if jwt_token:
            # Check if token already has "Bearer " prefix
            if jwt_token.startswith("Bearer "):
                headers['Authorization'] = jwt_token
            else:
                headers['Authorization'] = f'Bearer {jwt_token}'
            logger.info(f"Authorization header set: {headers['Authorization'][:50]}...")
        else:
            logger.warning("No JWT token provided - request may be unauthorized")
        
        # POST request with payload or empty body
        request_payload = payload if payload is not None else {}
        logger.info(f"Request payload: {json.dumps(request_payload)}")
        response = requests.post(url, headers=headers, json=request_payload, timeout=10)
        logger.info(f"Response status: {response.status_code}")
        
        if response.status_code == 401:
            error_msg = "Unauthorized: Invalid or missing JWT token"
            logger.error(error_msg)
            return {
                "status": "error",
                "message": error_msg,
                "details": "Please ensure you are logged in and token is valid"
            }
        
        response.raise_for_status()
        
        data = response.json()
        
        # Cache the result
        _data_cache[cache_key] = {
            "status": "success",
            "data": data
        }
        
        return _data_cache[cache_key]
        
    except requests.exceptions.RequestException as e:
        error_msg = f"Failed to fetch from external API: {str(e)}"
        logger.error(error_msg)
        return {
            "status": "error",
            "message": error_msg
        }
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        logger.error(error_msg)
        return {
            "status": "error",
            "message": error_msg
        }


def transform_item_group_data(raw_data: Any) -> List[Dict[str, str]]:
    """
    Transform raw Item Group data from API to ParamOption format
    
    Expected format: List of objects with various field name patterns
    """
    try:
        if isinstance(raw_data, list):
            result = []
            for item in raw_data:
                if isinstance(item, dict):
                    option = None
                    
                    # Check for exact value/text format
                    if 'value' in item and 'text' in item:
                        option = {
                            "value": str(item.get('value', '')),
                            "text": str(item.get('text', ''))
                        }
                    # Check for code/name format
                    elif 'code' in item and 'name' in item:
                        option = {
                            "value": str(item.get('code', '')),
                            "text": str(item.get('name', ''))
                        }
                    # Check for id with name/description
                    elif 'id' in item:
                        text = item.get('name', item.get('description', str(item.get('id', ''))))
                        option = {
                            "value": str(item['id']),
                            "text": str(text)
                        }
                    # Generic fallback - try to find any id-like and name-like fields
                    elif any(key in item for key in ['oid', 'itemGroupId', 'groupId']):
                        id_field = next((key for key in ['oid', 'itemGroupId', 'groupId', 'id'] if key in item), None)
                        name_field = next((key for key in ['name', 'itemGroupName', 'groupName', 'description'] if key in item), None)
                        if id_field and name_field:
                            option = {
                                "value": str(item.get(id_field, '')),
                                "text": str(item.get(name_field, ''))
                            }
                    
                    if option:
                        result.append(option)
            
            logger.info(f"Transformed {len(result)} items from item group data")
            return result
        return []
    except Exception as e:
        logger.error(f"Error transforming Item Group data: {str(e)}", exc_info=True)
        return []


def transform_item_data(raw_data: Any) -> List[Dict[str, str]]:
    """
    Transform raw Item data from API to ParamOption format
    
    Expected format: List of objects with various field name patterns
    """
    try:
        if isinstance(raw_data, list):
            result = []
            for item in raw_data:
                if isinstance(item, dict):
                    option = None
                    
                    # Check for exact value/text format
                    if 'value' in item and 'text' in item:
                        option = {
                            "value": str(item.get('value', '')),
                            "text": str(item.get('text', ''))
                        }
                    # Check for code/name format
                    elif 'code' in item and 'name' in item:
                        option = {
                            "value": str(item.get('code', '')),
                            "text": str(item.get('name', ''))
                        }
                    # Check for id with name/description
                    elif 'id' in item:
                        text = item.get('name', item.get('description', str(item.get('id', ''))))
                        option = {
                            "value": str(item['id']),
                            "text": str(text)
                        }
                    # Generic fallback - try to find any id-like and name-like fields
                    elif any(key in item for key in ['oid', 'itemId', 'shippingItemId']):
                        id_field = next((key for key in ['oid', 'itemId', 'shippingItemId', 'id'] if key in item), None)
                        name_field = next((key for key in ['name', 'itemName', 'description'] if key in item), None)
                        if id_field and name_field:
                            option = {
                                "value": str(item.get(id_field, '')),
                                "text": str(item.get(name_field, ''))
                            }
                    
                    if option:
                        result.append(option)
            
            logger.info(f"Transformed {len(result)} items from item data")
            return result
        return []
    except Exception as e:
        logger.error(f"Error transforming Item data: {str(e)}", exc_info=True)
        return []


def transform_operation_data(raw_data: Any) -> List[Dict[str, str]]:
    """
    Transform raw Operation data from API to ParamOption format
    
    Expected format: List of objects with text and value fields
    """
    try:
        if isinstance(raw_data, list):
            result = []
            for item in raw_data:
                if isinstance(item, dict):
                    option = None
                    
                    # Check for exact value/text format (primary format from API)
                    if 'value' in item and 'text' in item:
                        option = {
                            "value": str(item.get('value', '')),
                            "text": str(item.get('text', ''))
                        }
                    # Fallback: try code/name format
                    elif 'oid' in item and 'oname' in item:
                        option = {
                            "value": str(item.get('oid', '')),
                            "text": str(item.get('oname', ''))
                        }
                    # Fallback: try id with name/description
                    elif 'id' in item:
                        text = item.get('name', item.get('description', str(item.get('id', ''))))
                        option = {
                            "value": str(item['id']),
                            "text": str(text)
                        }
                    
                    if option:
                        result.append(option)
            
            logger.info(f"Transformed {len(result)} operations from operation data")
            return result
        return []
    except Exception as e:
        logger.error(f"Error transforming Operation data: {str(e)}", exc_info=True)
        return []


def transform_facode_data(raw_data: Any) -> List[Dict[str, str]]:
    """
    Transform raw FACODE data from API to ParamOption format
    
    Expected format: List of objects with field mappings
    Supports multiple field name patterns:
    - value/text
    - code/name
    - id with name/description
    - facodename/facodevalue (actual API format)
    """
    try:
        if isinstance(raw_data, list):
            result = []
            for item in raw_data:
                if isinstance(item, dict):
                    option = None                
                    # Check for oid with facodename (fallback)
                    if 'oid' in item and 'facodename' in item:
                        option = {
                            "value": str(item.get('oid', '')),
                            "text": str(item.get('facodename', ''))
                        }
                    
                    if option:
                        result.append(option)
            
            logger.info(f"Transformed {len(result)} items from raw data")
            return result
        return []
    except Exception as e:
        logger.error(f"Error transforming FACODE data: {str(e)}", exc_info=True)
        return []


@production_bp.route('/facode-options', methods=['GET'])
def get_facode_options():
    """
    Get FACODE options from external API
    Replaces: /facode_name.json
    Uses JWT token from session
    """
    # Get JWT token from session
    jwt_token = session.get('token')
    
    result = fetch_from_external_api('/pdinput/mfacode/all', jwt_token)
    
    if result.get("status") == "success":
        # Transform data to ParamOption format
        transformed_data = transform_facode_data(result.get("data", []))
        return jsonify({
            "status": "success",
            "data": transformed_data
        })
    else:
        return jsonify(result), 500


@production_bp.route('/item-group-options', methods=['GET'])
def get_item_group_options():
    """
    Get Item Group options from external API
    Replaces: /item_group_name.json
    Uses JWT token from session
    """
    # Get JWT token from session
    jwt_token = session.get('token')
    
    result = fetch_from_external_api('/pdinput/ShippingItemGroup/all-dtos', jwt_token)
    
    if result.get("status") == "success":
        # Transform data to ParamOption format
        transformed_data = transform_item_group_data(result.get("data", []))
        return jsonify({
            "status": "success",
            "data": transformed_data
        })
    else:
        return jsonify(result), 500


@production_bp.route('/operation-options', methods=['GET'])
def get_operation_options():
    """
    Get Operation options from external API
    API: POST /pdinput/operation/all
    Filters: statusflag = "1"
    Returns: text, value fields
    """
    # Get JWT token from session
    jwt_token = session.get('token')
    
    # POST request with filters for active operations
    endpoint = '/pdinput/operation/all'
    payload = {
        "filters": {
            "statusflag": "1"
        }
    }
    
    result = fetch_from_external_api(endpoint, jwt_token, payload)
    
    if result.get("status") == "success":
        # Transform data to ParamOption format - handle API response with text/value
        transformed_data = transform_operation_data(result.get("data", []))
        return jsonify({
            "status": "success",
            "data": transformed_data
        })
    else:
        return jsonify(result), 500


@production_bp.route('/item-options/<group_id>', methods=['GET'])
def get_item_options(group_id: str):
    """
    Get Item options for a specific Item Group from external API
    
    Args:
        group_id: The Item Group ID (e.g., item group's GRP_OID value)
    
    Returns:
        List of items in ParamOption format with fields: value, text
    """
    # Get JWT token from session
    jwt_token = session.get('token')
    
    # Call external API with the group_id in POST body
    endpoint = '/pdinput/shippingitem/all'
    payload = {
        "filters": {
            "GRP_OID": group_id
        }
    }
    
    logger.info(f"Fetching items for group_id: {group_id}")
    result = fetch_from_external_api(endpoint, jwt_token, payload)
    
    if result.get("status") == "success":
        # Transform data to ParamOption format
        transformed_data = transform_item_data(result.get("data", []))
        return jsonify({
            "status": "success",
            "data": transformed_data
        })
    else:
        return jsonify(result), 500


@production_bp.route('/std-param-options', methods=['GET'])
def get_std_param_options():
    """
    Get Standard Parameter options from external API
    Replaces: /std_param_options.json
    TODO: Implement when ready
    """
    return jsonify({
        "status": "error",
        "message": "Standard param options not yet implemented. Using JSON fallback."
    }), 501


@production_bp.route('/clear-cache', methods=['POST'])
def clear_cache():
    """
    Clear the data cache to force fresh API calls
    Useful for development and when data changes
    """
    try:
        global _data_cache
        _data_cache.clear()
        logger.info("Production data cache cleared")
        return jsonify({
            "status": "success",
            "message": "Cache cleared successfully"
        })
    except Exception as e:
        logger.error(f"Error clearing cache: {str(e)}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@production_bp.route('/test-api', methods=['GET'])
def test_api():
    """
    Test endpoint to verify external API connectivity using POST
    """
    endpoint = request.args.get('endpoint', '/pdinput/mfacode/all')
    jwt_token = session.get('token')
    
    logger.info(f"Testing endpoint: {endpoint}")
    logger.info(f"JWT token exists: {jwt_token is not None}")
    if jwt_token:
        logger.info(f"JWT token length: {len(jwt_token)}")
        logger.info(f"JWT token preview: {jwt_token[:50]}...")
    logger.info(f"Base URL: {EXTERNAL_API_BASE_URL}")
    
    try:
        url = f"{EXTERNAL_API_BASE_URL}{endpoint}"
        logger.info(f"Full URL (POST): {url}")
        
        headers = {
            "Content-Type": "application/json"
        }
        if jwt_token:
            if jwt_token.startswith("Bearer "):
                headers['Authorization'] = jwt_token
            else:
                headers['Authorization'] = f'Bearer {jwt_token}'
            logger.info("Authorization header added")
        else:
            logger.warning("NO JWT TOKEN FOUND IN SESSION")
        
        # POST request
        response = requests.post(url, headers=headers, json={}, timeout=10)
        logger.info(f"Response status: {response.status_code}")
        
        return jsonify({
            "status": "test",
            "url": url,
            "method": "POST",
            "http_status": response.status_code,
            "http_reason": response.reason,
            "headers_sent": {k: (v[:30] + "...") if len(v) > 30 else v for k, v in headers.items()},
            "response_preview": response.text[:500],
            "jwt_token_present": jwt_token is not None,
            "session_keys": list(session.keys()) if session else []
        })
    except Exception as e:
        logger.error(f"Test error: {str(e)}", exc_info=True)
        return jsonify({
            "status": "error",
            "message": str(e),
            "endpoint": endpoint,
            "jwt_token_present": jwt_token is not None
        }), 500
