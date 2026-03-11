# # Copyright (c) Microsoft Corporation.
# # Licensed under the MIT License.

# import logging
# import json
# import traceback
# import time
# from flask import request, jsonify, Blueprint
# from typing import Dict, Any, Tuple

# # Get logger for this module
# logger = logging.getLogger(__name__)

# charts_bp = Blueprint('charts', __name__, url_prefix='/api/charts')


# # =========================================================================
# # POST /api/charts/qc-trend-metadata
# # =========================================================================
# @charts_bp.route('/qc-trend-metadata', methods=['POST'])
# def get_qc_trend_metadata():
#     """
#     Compute metadata for QC Trend Line chart on server-side.
    
#     Handles heavy computations:
#     - Min/Max Y domain calculation (O(n) scan)
#     - QCDATE+QCSHIFT grouping → shift markers
#     - QC limit detection
    
#     Request body:
#     {
#         "data": [...100K rows...],
#         "valueField": "VALUE",
#         "qcLimitsMode": true
#     }
    
#     Response:
#     {
#         "success": true,
#         "metadata": {
#             "yDomain": [number, number],
#             "shiftMarkers": [{date, shift, index}, ...],
#             "detectedLimits": {TARGET?, UL?, LL?, ...},
#             "processingTimeMs": number,
#             "rowCount": number
#         }
#     }
#     """
#     try:
#         body = request.get_json()
        
#         if not body:
#             return jsonify({'error': 'Invalid request body'}), 400
        
#         data = body.get('data')
#         value_field = body.get('valueField', 'VALUE')
#         qc_limits_mode = body.get('qcLimitsMode', False)
        
#         # ===================================================================
#         # Validate input
#         # ===================================================================
#         if not data or not isinstance(data, list) or len(data) == 0:
#             return jsonify({'error': 'Invalid data - must be non-empty array'}), 400
        
#         logger.info(f'[QC Trend API] Processing {len(data)} rows...')
#         start_time = time.time()
        
#         # ===================================================================
#         # 🚀 SINGLE-PASS OPTIMIZATION: Process all data in ONE loop
#         # ===================================================================
#         y_min = float('inf')
#         y_max = float('-inf')
#         detected_limits = {}
#         group_map = {}
#         limit_field_names = ['TARGET', 'ARUL', 'ARLL', 'UL', 'LL']
        
#         # Pre-cache limit field columns (only inspect first row once)
#         columns = list(data[0].keys()) if data else []
#         limit_columns = {
#             name: next((c for c in columns if c.upper() == name), None)
#             for name in limit_field_names
#         }
        
#         # ===================================================================
#         # SINGLE PASS: Calculate min/max, detect limits, and group shifts
#         # ===================================================================
#         for row in data:
#             # 1️⃣ MIN/MAX Y DOMAIN
#             val = row.get(value_field)
#             if isinstance(val, (int, float)) and val == val:  # Check for NaN
#                 y_min = min(y_min, val)
#                 y_max = max(y_max, val)
            
#             # 2️⃣ DETECT QC LIMITS (only on first pass, no need to re-scan)
#             if qc_limits_mode:
#                 for name in limit_field_names:
#                     col = limit_columns.get(name)
#                     if col and name not in detected_limits:  # Only set once
#                         limit_val = row.get(col)
#                         if isinstance(limit_val, (int, float)) and limit_val == limit_val:
#                             detected_limits[name] = limit_val
            
#             # 3️⃣ GROUP BY QCDATE + QCSHIFT
#             qcdate = row.get('QCDATE')
#             qcshift = row.get('QCSHIFT')
#             index = row.get('INDEX')
            
#             if qcdate is not None and qcshift is not None and isinstance(index, (int, float)):
#                 key = f'{qcdate}_{qcshift}'
#                 if key not in group_map or index < group_map[key]['INDEX']:
#                     group_map[key] = {
#                         'QCDATE': qcdate,
#                         'QCSHIFT': qcshift,
#                         'INDEX': index,
#                     }
        
#         # Handle edge cases
#         if y_min == float('inf'):
#             y_min = 0
#         if y_max == float('-inf'):
#             y_max = 100
        
#         # ===================================================================
#         # POST-PROCESSING: Convert and sort results
#         # ===================================================================
#         shift_markers = []
#         for value in group_map.values():
#             shift_markers.append({
#                 'date': value['QCDATE'],
#                 'shift': value['QCSHIFT'],
#                 'index': int(value['INDEX']),
#             })
        
#         shift_markers.sort(key=lambda x: x['index'])
        
#         # Adjust Y domain based on detected limits
#         if qc_limits_mode:
#             ul = detected_limits.get('UL')
#             ll = detected_limits.get('LL')
            
#             if ul is not None or ll is not None:
#                 upper = ul if ul is not None else y_max
#                 lower = ll if ll is not None else y_min
#                 padding = (upper - lower) * 0.02
#                 y_min = lower - padding
#                 y_max = upper + padding
        
#         processing_time = (time.time() - start_time) * 1000  # Convert to ms
        
#         logger.info(f'[QC Trend API] ✅ Processed in {processing_time:.2f}ms')
#         logger.info(f'[QC Trend API] Detected limits: {detected_limits}')
#         logger.info(f'[QC Trend API] Shift markers: {len(shift_markers)} groups')
        
#         # ===================================================================
#         # Return response
#         # ===================================================================
#         return jsonify({
#             'success': True,
#             'metadata': {
#                 'yDomain': [y_min, y_max],
#                 'shiftMarkers': shift_markers,
#                 'detectedLimits': detected_limits,
#                 'processingTimeMs': round(processing_time, 2),
#                 'rowCount': len(data),
#             }
#         })
    
#     except json.JSONDecodeError as e:
#         logger.error(f'[QC Trend API] JSON decode error: {str(e)}')
#         return jsonify({'error': 'Invalid JSON in request body'}), 400
    
#     except Exception as e:
#         logger.error(f'[QC Trend API] Error: {str(e)}')
#         logger.error(f'[QC Trend API] Traceback: {traceback.format_exc()}')
#         return jsonify({'error': f'Server error: {str(e)}'}), 500


# # =========================================================================
# # POST /api/charts/histogram-metadata (Placeholder for future use)
# # =========================================================================
# @charts_bp.route('/histogram-metadata', methods=['POST'])
# def get_histogram_metadata():
#     """
#     Compute metadata for Histogram chart on server-side.
#     (To be implemented for "Giải pháp #2" optimization)
#     """
#     try:
#         return jsonify({
#             'error': 'Histogram metadata computation not yet implemented'
#         }), 501
    
#     except Exception as e:
#         logger.error(f'[Histogram API] Error: {str(e)}')
#         return jsonify({'error': f'Server error: {str(e)}'}), 500


# # =========================================================================
# # POST /api/charts/stacked-bar-metadata (Placeholder for future use)
# # =========================================================================
# @charts_bp.route('/stacked-bar-metadata', methods=['POST'])
# def get_stacked_bar_metadata():
#     """
#     Compute metadata for Stacked Bar chart on server-side.
#     (To be implemented for "Giải pháp #3" optimization)
#     """
#     try:
#         return jsonify({
#             'error': 'Stacked Bar metadata computation not yet implemented'
#         }), 501
    
#     except Exception as e:
#         logger.error(f'[Stacked Bar API] Error: {str(e)}')
#         return jsonify({'error': f'Server error: {str(e)}'}), 500

