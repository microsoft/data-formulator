# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import json
import logging
from flask import Blueprint, jsonify, current_app
from clickhouse_connect import get_client

logger = logging.getLogger(__name__)

dashboard_bp = Blueprint('dashboard', __name__, url_prefix='/api/dashboard')

def get_clickhouse_client():
    """Get ClickHouse client with credentials from environment"""
    ch_host = os.environ.get("CH_HOST", "172.19.16.23")
    ch_port = int(os.environ.get("CH_PORT", "8123"))
    ch_user = os.environ.get("CH_USER", "admin")
    ch_password = os.environ.get("CH_PASSWORD", "")
    ch_db = os.environ.get("CH_DB", "QC_DATA")
    if not ch_password:
        raise RuntimeError("CH_PASSWORD is not configured")
    
    return get_client(
        host=ch_host,
        port=ch_port,
        username=ch_user,
        password=ch_password,
        database=ch_db
    )

@dashboard_bp.route('/list', methods=['GET'])
def get_dashboards():
    """
    Get all dashboards grouped by department
    Returns: {
        "status": "success",
        "data": {
            "department1": [
                {"oid": "...", "name": "...", "url": "...", "lastupdate": "..."},
                ...
            ],
            "department2": [...],
            ...
        }
    }
    """
    try:
        client = get_clickhouse_client()
        
        # Query dashboard info from ClickHouse
        query = """
        SELECT 
            OID,
            NAME,
            URL,
            DEPARTMENT,
            LASTUPDATE
        FROM "QC_DATA"."DASHBOARD_INFO"
        ORDER BY DEPARTMENT, NAME
        """
        
        df = client.query_df(query)
        
        # Group by department
        dashboards_by_dept = {}
        for _, row in df.iterrows():
            dept = row['DEPARTMENT']
            if dept not in dashboards_by_dept:
                dashboards_by_dept[dept] = []
            
            dashboards_by_dept[dept].append({
                'oid': str(row['OID']),
                'name': row['NAME'],
                'url': row['URL'],
                'lastupdate': row['LASTUPDATE'].isoformat() if hasattr(row['LASTUPDATE'], 'isoformat') else str(row['LASTUPDATE'])
            })
        
        return jsonify({
            'status': 'success',
            'data': dashboards_by_dept
        })
    
    except Exception as e:
        logger.error(f"Error fetching dashboards: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@dashboard_bp.route('/department/<department>', methods=['GET'])
def get_dashboards_by_department(department):
    """
    Get dashboards for a specific department
    Returns: {
        "status": "success",
        "data": [
            {"oid": "...", "name": "...", "url": "...", "lastupdate": "..."},
            ...
        ]
    }
    """
    try:
        client = get_clickhouse_client()
        
        query = """
        SELECT 
            OID,
            NAME,
            URL,
            DEPARTMENT,
            LASTUPDATE
        FROM "QC_DATA"."DASHBOARD_INFO"
        WHERE DEPARTMENT = {department:String}
        ORDER BY NAME
        """

        df = client.query_df(query, parameters={'department': department})
        
        dashboards = []
        for _, row in df.iterrows():
            dashboards.append({
                'oid': str(row['OID']),
                'name': row['NAME'],
                'url': row['URL'],
                'lastupdate': row['LASTUPDATE'].isoformat() if hasattr(row['LASTUPDATE'], 'isoformat') else str(row['LASTUPDATE'])
            })
        
        return jsonify({
            'status': 'success',
            'data': dashboards
        })
    
    except Exception as e:
        logger.error(f"Error fetching dashboards for department {department}: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500
