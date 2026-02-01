# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import logging
import sys
import os
import mimetypes
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
import json
import traceback
from flask import request, send_from_directory, jsonify, Blueprint
import pandas as pd
import random
import string
from pathlib import Path
import uuid

from data_formulator.db_manager import db_manager
from data_formulator.data_loader import DATA_LOADERS
from data_formulator.auth import get_identity_id

import re

# Get logger for this module (logging config done in app.py)
logger = logging.getLogger(__name__)

import os
import tempfile

tables_bp = Blueprint('tables', __name__, url_prefix='/api/tables')

@tables_bp.route('/list-tables', methods=['GET'])
def list_tables():
    """List all tables in the current session"""
    try:
        result = []
        with db_manager.connection(get_identity_id()) as db:
            table_metadata_list = db.execute("""
                SELECT database_name, schema_name, table_name, schema_name==current_schema() as is_current_schema, 'table' as object_type 
                FROM duckdb_tables() 
                WHERE internal=False AND database_name == current_database()
                UNION ALL 
                SELECT database_name, schema_name, view_name as table_name, schema_name==current_schema() as is_current_schema, 'view' as object_type 
                FROM duckdb_views()
                WHERE view_name NOT LIKE 'duckdb_%' AND view_name NOT LIKE 'sqlite_%' AND view_name NOT LIKE 'pragma_%' AND database_name == current_database()
            """).fetchall()
        
            
            for table_metadata in table_metadata_list:
                [database_name, schema_name, table_name, is_current_schema, object_type] = table_metadata
                table_name = table_name if is_current_schema else '.'.join([database_name, schema_name, table_name])
                
                # Skip system databases and internal metadata tables
                if database_name in ['system', 'temp']:
                    continue
                if table_name.startswith('_df_'):  # Internal Data Formulator metadata tables
                    continue
                
                try:
                    # Get column information
                    columns = db.execute(f"DESCRIBE {table_name}").fetchall()
                    # Get row count
                    row_count = db.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                    sample_rows = db.execute(f"SELECT * FROM {table_name} LIMIT 1000").fetchdf() if row_count > 0 else pd.DataFrame()
                    
                    # Check if this is a view or a table
                    try:
                        # Get both view existence and source in one query
                        view_info = db.execute(f"SELECT view_name, sql FROM duckdb_views() WHERE view_name = '{table_name}'").fetchone()
                        view_source = view_info[1] if view_info else None
                    except Exception as e:
                        # If the query fails, assume it's a regular table
                        view_source = None
                    
                    # Get source metadata if available (for refreshable tables)
                    source_metadata = None
                    try:
                        source_metadata = get_table_metadata(db, table_name)
                    except Exception:
                        pass  # Metadata table may not exist yet
                    
                    result.append({
                        "name": table_name,
                        "columns": [{"name": col[0], "type": col[1]} for col in columns],
                        "row_count": row_count,
                        "sample_rows": json.loads(sample_rows.to_json(orient='records', date_format='iso')),
                        "view_source": view_source,
                        "source_metadata": source_metadata
                    })
                    
                except Exception as e:
                    logger.error(f"Error getting table metadata for {table_name}: {str(e)}")
                    continue
        
        return jsonify({
            "status": "success",
            "tables": result
        })
    except Exception as e:
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code
        

def assemble_query(aggregate_fields_and_functions, group_fields, columns, table_name):
    """
    Assembles a SELECT query string based on binning, aggregation, and grouping specifications.
    
    Args:
        bin_fields (list): Fields to be binned into ranges
        aggregate_fields_and_functions (list): List of tuples (field, function) for aggregation
        group_fields (list): Fields to group by
        columns (list): All available column names
    
    Returns:
        str: The assembled SELECT query projection part
    """
    select_parts = []
    output_column_names = []

    # Handle aggregate fields and functions
    for field, function in aggregate_fields_and_functions:
        if field is None:
            # Handle count(*) case
            if function.lower() == 'count':
                select_parts.append('COUNT(*) as _count')
                output_column_names.append('_count')
        elif field in columns:
            if function.lower() == 'count':
                alias = f'_count'
                select_parts.append(f'COUNT(*) as "{alias}"')
                output_column_names.append(alias)
            else:
                # Sanitize function name and create alias
                if function in ["avg", "average", "mean"]:
                    aggregate_function = "AVG"
                else:
                    aggregate_function = function.upper()
                
                alias = f'{field}_{function}'
                select_parts.append(f'{aggregate_function}("{field}") as "{alias}"')
                output_column_names.append(alias)

    # Handle group fields
    for field in group_fields:
        if field in columns:
            select_parts.append(f'"{field}"')
            output_column_names.append(field)
    # If no fields are specified, select all columns
    if not select_parts:
        select_parts = ["*"]
        output_column_names = columns

    from_clause = f"FROM {table_name}"
    group_by_clause = f"GROUP BY {', '.join(group_fields)}" if len(group_fields) > 0 and len(aggregate_fields_and_functions) > 0 else ""

    query = f"SELECT {', '.join(select_parts)} {from_clause} {group_by_clause}"
    return query, output_column_names

@tables_bp.route('/sample-table', methods=['POST'])
def sample_table():
    """Sample a table"""
    try:
        data = request.get_json()
        table_id = data.get('table')
        sample_size = data.get('size', 1000)
        aggregate_fields_and_functions = data.get('aggregate_fields_and_functions', []) # each element is a tuple (field, function)
        select_fields = data.get('select_fields', []) # if empty, we want to include all fields
        method = data.get('method', 'random') # one of 'random', 'head', 'bottom'
        order_by_fields = data.get('order_by_fields', [])

        
        total_row_count = 0
        # Validate field names against table columns to prevent SQL injection
        with db_manager.connection(get_identity_id()) as db:
            # Get valid column names
            columns = [col[0] for col in db.execute(f"DESCRIBE {table_id}").fetchall()]

            
            # Filter order_by_fields to only include valid column names
            valid_order_by_fields = [field for field in order_by_fields if field in columns]
            valid_aggregate_fields_and_functions = [
                field_and_function for field_and_function in aggregate_fields_and_functions 
                if field_and_function[0] is None or field_and_function[0] in columns
            ]
            valid_select_fields = [field for field in select_fields if field in columns]

            query, output_column_names = assemble_query(valid_aggregate_fields_and_functions, valid_select_fields, columns, table_id)


            # Modify the original query to include the count:
            count_query = f"SELECT *, COUNT(*) OVER () as total_count FROM ({query}) as subq LIMIT 1"
            result = db.execute(count_query).fetchone()
            total_row_count = result[-1] if result else 0


            # Add ordering and limit to the main query
            if method == 'random':
                query += f" ORDER BY RANDOM() LIMIT {sample_size}"
            elif method == 'head':
                if valid_order_by_fields:
                    # Build ORDER BY clause with validated fields
                    order_by_clause = ", ".join([f'"{field}"' for field in valid_order_by_fields])
                    query += f" ORDER BY {order_by_clause} LIMIT {sample_size}"
                else:
                    query += f" LIMIT {sample_size}"
            elif method == 'bottom':
                if valid_order_by_fields:
                    # Build ORDER BY clause with validated fields in descending order
                    order_by_clause = ", ".join([f'"{field}" DESC' for field in valid_order_by_fields])
                    query += f" ORDER BY {order_by_clause} LIMIT {sample_size}"
                else:
                    query += f" ORDER BY ROWID DESC LIMIT {sample_size}"


            result = db.execute(query).fetchdf()

        
        return jsonify({
            "status": "success",
            "rows": json.loads(result.to_json(orient='records', date_format='iso')),
            "total_row_count": total_row_count
        })
    except Exception as e:
        logger.error(f"Error sampling table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code

@tables_bp.route('/get-table', methods=['GET'])
def get_table_data():
    """Get data from a specific table"""
    try:
        with db_manager.connection(get_identity_id()) as db:

            table_name = request.args.get('table_name')
            # Get pagination parameters
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 100))
            offset = (page - 1) * page_size
            
            if not table_name:
                return jsonify({
                    "status": "error",
                    "message": "Table name is required"
                }), 400
            
            # Get total count
            total_rows = db.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
            
            # Get paginated data
            result = db.execute(
                f"SELECT * FROM {table_name} LIMIT {page_size} OFFSET {offset}"
            ).fetchall()
            
            # Get column names
            columns = [col[0] for col in db.execute(f"DESCRIBE {table_name}").fetchall()]
            
            # Convert to list of dictionaries
            rows = [dict(zip(columns, row)) for row in result]
        
            return jsonify({
                "status": "success",
                "table_name": table_name,
                "columns": columns,
                "rows": rows,
                "total_rows": total_rows,
                "page": page,
                "page_size": page_size
            })
    
    except Exception as e:
        logger.error(f"Error getting table data: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code

@tables_bp.route('/create-table', methods=['POST'])
def create_table():
    """Create a new table from uploaded data"""
    try:
        if 'file' not in request.files and 'raw_data' not in request.form:
            return jsonify({"status": "error", "message": "No file or raw data provided"}), 400
        
        table_name = request.form.get('table_name')
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400
        
        df = None
        if 'file' in request.files:
            file = request.files['file']
            # Read file based on extension
            if file.filename.endswith('.csv'):
                df = pd.read_csv(file)
            elif file.filename.endswith(('.xlsx', '.xls')):
                df = pd.read_excel(file)
            elif file.filename.endswith('.json'):
                df = pd.read_json(file)
            else:
                return jsonify({"status": "error", "message": "Unsupported file format"}), 400
        else:
            raw_data = request.form.get('raw_data')
            try:
                df = pd.DataFrame(json.loads(raw_data))
            except Exception as e:
                return jsonify({"status": "error", "message": f"Invalid JSON data: {str(e)}, it must be in the format of a list of dictionaries"}), 400

        if df is None:
            return jsonify({"status": "error", "message": "No data provided"}), 400

        sanitized_table_name = sanitize_table_name(table_name)
            
        with db_manager.connection(get_identity_id()) as db:
            # Check if table exists and generate unique name if needed
            base_name = sanitized_table_name
            counter = 1
            while True:
                # Check if table exists
                exists = db.execute(f"SELECT COUNT(*) FROM duckdb_tables() WHERE table_name = '{sanitized_table_name}'").fetchone()[0] > 0
                if not exists:
                    break
                # If exists, append counter to base name
                sanitized_table_name = f"{base_name}_{counter}"
                counter += 1

            # Create table
            db.register('df_temp', df)
            db.execute(f"CREATE TABLE {sanitized_table_name} AS SELECT * FROM df_temp")
            db.execute("DROP VIEW df_temp")  # Drop the temporary view after creating the table
            
            return jsonify({
                "status": "success",
                "table_name": sanitized_table_name,
                "row_count": len(df),
                "columns": list(df.columns),
                "original_name": base_name,  # Include the original name in response
                "is_renamed": base_name != sanitized_table_name  # Flag indicating if name was changed
            })
    
    except Exception as e:
        logger.error(f"Error creating table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code



@tables_bp.route('/delete-table', methods=['POST'])
def drop_table():
    """Drop a table or view"""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400
            
        with db_manager.connection(get_identity_id()) as db:
            # First check if it exists as a view
            view_exists = db.execute(f"SELECT view_name FROM duckdb_views() WHERE view_name = '{table_name}'").fetchone() is not None
            if view_exists:
                db.execute(f"DROP VIEW IF EXISTS {table_name}")
            
            # Then check if it exists as a table
            table_exists = db.execute(f"SELECT table_name FROM duckdb_tables() WHERE table_name = '{table_name}'").fetchone() is not None
            if table_exists:
                db.execute(f"DROP TABLE IF EXISTS {table_name}")

            if not view_exists and not table_exists:
                return jsonify({
                    "status": "error",
                    "message": f"Table/view '{table_name}' does not exist"
                }), 404
        
            return jsonify({
                "status": "success",
                "message": f"Table/view {table_name} dropped"
            })
    
    except Exception as e:
        logger.error(f"Error dropping table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code


@tables_bp.route('/upload-db-file', methods=['POST'])
def upload_db_file():
    """Upload a db file"""
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "No file provided"}), 400
        
        file = request.files['file']
        if not file.filename.endswith('.db'):
            return jsonify({"status": "error", "message": "Invalid file format. Only .db files are supported"}), 400

        identity_id = get_identity_id()
        
        # Create temp directory if it doesn't exist
        temp_dir = os.path.join(tempfile.gettempdir())
        os.makedirs(temp_dir, exist_ok=True)
        
        # Save the file temporarily to verify it
        temp_db_path = os.path.join(temp_dir, f"temp_{identity_id}.db")
        file.save(temp_db_path)
        
        # Verify if it's a valid DuckDB file
        try:
            import duckdb
            # Try to connect to the database
            conn = duckdb.connect(temp_db_path, read_only=True)
            # Try a simple query to verify it's a valid database
            conn.execute("SELECT 1").fetchall()
            conn.close()
            
            # If we get here, the file is valid - move it to final location
            db_file_path = os.path.join(temp_dir, f"df_{identity_id}.db")
            os.replace(temp_db_path, db_file_path)
            
            # Update the db_manager's file mapping
            db_manager._db_files[identity_id] = db_file_path
            
        except Exception as db_error:
            # Clean up temp file
            logger.error(f"Error uploading db file: {str(db_error)}")
            if os.path.exists(temp_db_path):
                os.remove(temp_db_path)
            return jsonify({
                "status": "error",
                "message": f"Invalid DuckDB database file."
            }), 400
        
        return jsonify({
            "status": "success",
            "message": "Database file uploaded successfully",
            "identity_id": identity_id
        })
        
    except Exception as e:
        logger.error(f"Error uploading db file: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code


@tables_bp.route('/download-db-file', methods=['GET'])
def download_db_file():
    """Download the db file for a session"""
    try:
        identity_id = get_identity_id()
        
        # Get the database file path from db_manager
        if identity_id not in db_manager._db_files:
            return jsonify({
                "status": "error",
                "message": "No database file found for this identity"
            }), 404
            
        db_file_path = db_manager._db_files[identity_id]
        
        # Check if file exists
        if not os.path.exists(db_file_path):
            return jsonify({
                "status": "error",
                "message": "Database file not found"
            }), 404
            
        # Generate a filename for download
        download_name = f"data_formulator_{identity_id}.db"
        
        # Return the file as an attachment
        return send_from_directory(
            os.path.dirname(db_file_path),
            os.path.basename(db_file_path),
            as_attachment=True,
            download_name=download_name,
            mimetype='application/x-sqlite3'
        )
        
    except Exception as e:
        logger.error(f"Error downloading db file: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code


@tables_bp.route('/reset-db-file', methods=['POST'])
def reset_db_file():
    """Reset the db file for a session"""
    try:
        identity_id = get_identity_id()

        logger.info(f"identity_id: {identity_id}")
        
        # First check if there's a reference in db_manager
        if identity_id in db_manager._db_files:
            db_file_path = db_manager._db_files[identity_id]
            
            # Remove the file if it exists
            if db_file_path and os.path.exists(db_file_path):
                os.remove(db_file_path)
            
            # Clear the reference
            db_manager._db_files[identity_id] = None
            
        # Also check for any temporary files
        temp_db_path = os.path.join(tempfile.gettempdir(), f"temp_{identity_id}.db")
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
            
        # Check for the main db file
        main_db_path = os.path.join(tempfile.gettempdir(), f"df_{identity_id}.db")
        if os.path.exists(main_db_path):
            os.remove(main_db_path)

        return jsonify({
            "status": "success",
            "message": "Database file reset successfully"
        })

    except Exception as e:
        logger.error(f"Error resetting db file: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code

# Example of a more complex query endpoint
@tables_bp.route('/analyze', methods=['POST'])
def analyze_table():
    """Get basic statistics about a table"""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400
        
        with db_manager.connection(get_identity_id()) as db:
        
            # Get column information
            columns = db.execute(f"DESCRIBE {table_name}").fetchall()
            
            stats = []
            for col in columns:
                col_name = col[0]
                col_type = col[1]
                
                # Properly quote column names to avoid SQL keywords issues
                quoted_col_name = f'"{col_name}"'
                
                # Basic stats query
                stats_query = f"""
                SELECT 
                    COUNT(*) as count,
                    COUNT(DISTINCT {quoted_col_name}) as unique_count,
                    COUNT(*) - COUNT({quoted_col_name}) as null_count
                FROM {table_name}
                """
                
                # Add numeric stats if applicable
                if col_type in ['INTEGER', 'DOUBLE', 'DECIMAL']:
                    stats_query = f"""
                    SELECT 
                        COUNT(*) as count,
                        COUNT(DISTINCT {quoted_col_name}) as unique_count,
                        COUNT(*) - COUNT({quoted_col_name}) as null_count,
                        MIN({quoted_col_name}) as min_value,
                        MAX({quoted_col_name}) as max_value,
                        AVG({quoted_col_name}) as avg_value
                    FROM {table_name}
                    """
                
                col_stats = db.execute(stats_query).fetchone()
                
                # Create a dictionary with appropriate keys based on column type
                if col_type in ['INTEGER', 'DOUBLE', 'DECIMAL']:
                    stats_dict = dict(zip(
                        ["count", "unique_count", "null_count", "min", "max", "avg"],
                        col_stats
                    ))
                else:
                    stats_dict = dict(zip(
                        ["count", "unique_count", "null_count"],
                        col_stats
                    ))
                
                stats.append({
                    "column": col_name,
                    "type": col_type,
                    "statistics": stats_dict
                })
        
        return jsonify({
            "status": "success",
            "table_name": table_name,
            "statistics": stats
        })
    
    except Exception as e:
        logger.error(f"Error analyzing table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error",
            "message": safe_msg
        }), status_code

def sanitize_table_name(table_name: str) -> str:
    """
    Sanitize a table name to be a valid DuckDB table name.
    """
    # Sanitize table name:
        # 1. Convert to lowercase
        # 2. Replace hyphens with underscores
        # 3. Replace spaces with underscores
        # 4. Remove any other special characters
    sanitized_table_name = table_name.lower()
    sanitized_table_name = sanitized_table_name.replace('-', '_')
    sanitized_table_name = sanitized_table_name.replace(' ', '_')
    sanitized_table_name = ''.join(c for c in sanitized_table_name if c.isalnum() or c == '_')
    
    # Ensure table name starts with a letter
    if not sanitized_table_name or not sanitized_table_name[0].isalpha():
        sanitized_table_name = 'table_' + sanitized_table_name
        
    # Verify we have a valid table name after sanitization
    if not sanitized_table_name:
        return f'table_{uuid.uuid4()}'
    return sanitized_table_name

def sanitize_db_error_message(error: Exception) -> tuple[str, int]:
    """
    Sanitize error messages before sending to client.
    Returns a tuple of (sanitized_message, status_code)
    """
    # Convert error to string
    error_msg = str(error)
    
    # Define patterns for known safe errors
    safe_error_patterns = {
        # Database table errors
        r"Table.*does not exist": (error_msg, 404),
        r"Table.*already exists": (error_msg, 409),
        # Query errors
        r"syntax error": (error_msg, 400),
        r"Catalog Error": (error_msg, 404), 
        r"Binder Error": (error_msg, 400),
        r"Invalid input syntax": (error_msg, 400),
        
        # File errors
        r"No such file": (error_msg, 404),
        r"Permission denied": ("Access denied", 403),

        # Data loader errors
        r"Entity ID": (error_msg, 500),
        r"identity": ("Identity not found, please refresh the page", 500),
    }
    
    # Check if error matches any safe pattern
    for pattern, (safe_msg, status_code) in safe_error_patterns.items():
        if re.search(pattern, error_msg, re.IGNORECASE):
            return safe_msg, status_code
            
    # Log the full error for debugging
    logger.error(f"Unexpected error occurred: {error_msg}")
    
    # Return a generic error message for unknown errors
    return f"An unexpected error occurred: {error_msg}", 500


@tables_bp.route('/data-loader/list-data-loaders', methods=['GET'])
def data_loader_list_data_loaders():
    """List all available data loaders"""

    try:
        return jsonify({
            "status": "success",
            "data_loaders": {
                name: {
                    "params": data_loader.list_params(),
                    "auth_instructions": data_loader.auth_instructions()
                }
                for name, data_loader in DATA_LOADERS.items()
            }
        })
    except Exception as e:
        logger.error(f"Error listing data loaders: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code

@tables_bp.route('/data-loader/list-tables', methods=['POST'])
def data_loader_list_tables():
    """List tables from a data loader"""

    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        table_filter = data.get('table_filter', None)  # New filter parameter

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400

        with db_manager.connection(get_identity_id()) as duck_db_conn:
            data_loader = DATA_LOADERS[data_loader_type](data_loader_params, duck_db_conn)
            
            # Pass table_filter to list_tables if the data loader supports it
            if hasattr(data_loader, 'list_tables') and 'table_filter' in data_loader.list_tables.__code__.co_varnames:
                tables = data_loader.list_tables(table_filter=table_filter)
            else:
                tables = data_loader.list_tables()

            return jsonify({
                "status": "success",
                "tables": tables
            })

    except Exception as e:
        logger.error(f"Error listing tables from data loader: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code


def ensure_table_metadata_table(db_conn):
    """
    Ensure the _df_table_source_metadata table exists for storing table source information.
    This stores connection info so backend can refresh tables - frontend manages timing/toggle.
    """
    db_conn.execute("""
        CREATE TABLE IF NOT EXISTS _df_table_source_metadata (
            table_name VARCHAR PRIMARY KEY,
            data_loader_type VARCHAR,
            data_loader_params JSON,
            source_table_name VARCHAR,
            source_query VARCHAR,
            last_refreshed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            content_hash VARCHAR
        )
    """)
    
    # Add content_hash column if it doesn't exist (for existing databases)
    try:
        db_conn.execute("""
            ALTER TABLE _df_table_source_metadata ADD COLUMN content_hash VARCHAR
        """)
    except Exception:
        # Column already exists
        pass


def compute_table_content_hash(db_conn, table_name: str) -> str:
    """
    Compute a content hash for a table using DuckDB's built-in hash function.
    Uses a sampling strategy for efficiency with large tables:
    - Row count
    - Column names
    - First 50 rows, last 50 rows, and 50 sampled rows from middle
    """
    import hashlib
    
    # Get row count
    row_count = db_conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    
    # Get column names
    columns = db_conn.execute(f"DESCRIBE {table_name}").fetchall()
    column_names = [col[0] for col in columns]
    
    # Build hash components
    hash_parts = [
        f"count:{row_count}",
        f"cols:{','.join(column_names)}"
    ]
    
    if row_count > 0:
        # Sample rows for hashing
        # First 50 rows
        first_rows = db_conn.execute(f"""
            SELECT * FROM {table_name} LIMIT 50
        """).fetchall()
        
        # Last 50 rows (using row number)
        last_rows = db_conn.execute(f"""
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER () as _rn FROM {table_name}
            ) WHERE _rn > {max(0, row_count - 50)}
        """).fetchall()
        
        # Middle sample (every Nth row to get ~50 rows)
        if row_count > 100:
            step = max(1, (row_count - 100) // 50)
            middle_rows = db_conn.execute(f"""
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER () as _rn FROM {table_name}
                ) WHERE _rn > 50 AND _rn <= {row_count - 50} AND (_rn - 50) % {step} = 0
                LIMIT 50
            """).fetchall()
        else:
            middle_rows = []
        
        # Convert rows to strings for hashing
        all_sample_rows = first_rows + middle_rows + last_rows
        row_strs = [str(row) for row in all_sample_rows]
        hash_parts.append(f"rows:{';'.join(row_strs)}")
    
    # Compute hash
    content_str = '|'.join(hash_parts)
    return hashlib.md5(content_str.encode()).hexdigest()


def save_table_metadata(db_conn, table_name: str, data_loader_type: str, data_loader_params: dict, 
                        source_table_name: str = None, source_query: str = None, content_hash: str = None):
    """Save or update table source metadata"""
    ensure_table_metadata_table(db_conn)
    
    # Remove sensitive fields from params before storing
    safe_params = {k: v for k, v in data_loader_params.items() if k not in ['password', 'api_key', 'secret']}
    
    # Compute content hash if not provided
    if content_hash is None:
        try:
            content_hash = compute_table_content_hash(db_conn, table_name)
        except Exception as e:
            logger.warning(f"Failed to compute content hash for {table_name}: {e}")
            content_hash = None
    
    db_conn.execute("""
        INSERT OR REPLACE INTO _df_table_source_metadata 
        (table_name, data_loader_type, data_loader_params, source_table_name, source_query, last_refreshed, content_hash)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    """, [table_name, data_loader_type, json.dumps(safe_params), source_table_name, source_query, content_hash])


def get_table_metadata(db_conn, table_name: str) -> dict:
    """Get metadata for a specific table (connection info for refresh)"""
    ensure_table_metadata_table(db_conn)
    
    result = db_conn.execute("""
        SELECT table_name, data_loader_type, data_loader_params, source_table_name, source_query, last_refreshed, content_hash
        FROM _df_table_source_metadata 
        WHERE table_name = ?
    """, [table_name]).fetchone()
    
    if result:
        return {
            "table_name": result[0],
            "data_loader_type": result[1],
            "data_loader_params": json.loads(result[2]) if result[2] else {},
            "source_table_name": result[3],
            "source_query": result[4],
            "last_refreshed": str(result[5]) if result[5] else None,
            "content_hash": result[6]
        }
    return None


def get_all_table_metadata(db_conn) -> list:
    """Get metadata for all tables"""
    ensure_table_metadata_table(db_conn)
    
    results = db_conn.execute("""
        SELECT table_name, data_loader_type, data_loader_params, source_table_name, source_query, last_refreshed, content_hash
        FROM _df_table_source_metadata
    """).fetchall()
    
    return [{
        "table_name": r[0],
        "data_loader_type": r[1],
        "data_loader_params": json.loads(r[2]) if r[2] else {},
        "source_table_name": r[3],
        "source_query": r[4],
        "last_refreshed": str(r[5]) if r[5] else None,
        "content_hash": r[6]
    } for r in results]


@tables_bp.route('/data-loader/ingest-data', methods=['POST'])
def data_loader_ingest_data():
    """Ingest data from a data loader"""

    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        table_name = data.get('table_name')
        import_options = data.get('import_options', {})
        
        # Extract import options
        row_limit = import_options.get('row_limit', 1000000) if import_options else 1000000
        sort_columns = import_options.get('sort_columns', None) if import_options else None
        sort_order = import_options.get('sort_order', 'asc') if import_options else 'asc'

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400

        with db_manager.connection(get_identity_id()) as duck_db_conn:
            data_loader = DATA_LOADERS[data_loader_type](data_loader_params, duck_db_conn)
            data_loader.ingest_data(table_name, size=row_limit, sort_columns=sort_columns, sort_order=sort_order)
            
            # Get the actual table name that was created (may be sanitized)
            sanitized_name = table_name.split('.')[-1]  # Base name
            
            # Store metadata for refresh capability (include import options for future refresh)
            save_table_metadata(
                duck_db_conn, 
                sanitized_name, 
                data_loader_type, 
                data_loader_params, 
                source_table_name=table_name
            )

            return jsonify({
                "status": "success",
                "message": "Successfully ingested data from data loader",
                "table_name": sanitized_name
            })

    except Exception as e:
        logger.error(f"Error ingesting data from data loader: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code
    

@tables_bp.route('/data-loader/view-query-sample', methods=['POST'])
def data_loader_view_query_sample():
    """View a sample of data from a query"""

    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        query = data.get('query')

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400
        
        with db_manager.connection(get_identity_id()) as duck_db_conn:
            data_loader = DATA_LOADERS[data_loader_type](data_loader_params, duck_db_conn)
            sample = data_loader.view_query_sample(query)

            return jsonify({
                "status": "success",
                "sample": sample,
                "message": "Successfully retrieved query sample"
            })
    except Exception as e:
        logger.error(f"Error viewing query sample: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "sample": [],
            "message": safe_msg
        }), status_code
    

@tables_bp.route('/data-loader/ingest-data-from-query', methods=['POST'])
def data_loader_ingest_data_from_query():
    """Ingest data from a data loader"""

    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        query = data.get('query')
        name_as = data.get('name_as')

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400

        with db_manager.connection(get_identity_id()) as duck_db_conn:
            data_loader = DATA_LOADERS[data_loader_type](data_loader_params, duck_db_conn)
            data_loader.ingest_data_from_query(query, name_as)
            
            # Store metadata for refresh capability
            save_table_metadata(
                duck_db_conn, 
                name_as, 
                data_loader_type, 
                data_loader_params, 
                source_query=query
            )

            return jsonify({
                "status": "success",
                "message": "Successfully ingested data from data loader",
                "table_name": name_as
            })

    except Exception as e:
        logger.error(f"Error ingesting data from data loader: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code


@tables_bp.route('/data-loader/refresh-table', methods=['POST'])
def data_loader_refresh_table():
    """
    Refresh a table by re-importing data from its original source.
    Requires the table to have been imported via a data loader with stored metadata.
    Returns content_hash and data_changed flag so frontend can skip resampling if data unchanged.
    """
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        # Allow passing updated connection params (e.g., for password that wasn't stored)
        updated_params = data.get('data_loader_params', {})

        if not table_name:
            return jsonify({"status": "error", "message": "table_name is required"}), 400

        with db_manager.connection(get_identity_id()) as duck_db_conn:
            # Get stored metadata
            metadata = get_table_metadata(duck_db_conn, table_name)
            
            if not metadata:
                return jsonify({
                    "status": "error", 
                    "message": f"No source metadata found for table '{table_name}'. Cannot refresh."
                }), 400
            
            # Get old content hash before refresh
            old_content_hash = metadata.get('content_hash')
            
            data_loader_type = metadata['data_loader_type']
            data_loader_params = {**metadata['data_loader_params'], **updated_params}
            
            if data_loader_type not in DATA_LOADERS:
                return jsonify({
                    "status": "error", 
                    "message": f"Unknown data loader type: {data_loader_type}"
                }), 400
            
            # Create data loader and refresh
            data_loader = DATA_LOADERS[data_loader_type](data_loader_params, duck_db_conn)
            
            if metadata['source_query']:
                # Refresh from query
                data_loader.ingest_data_from_query(metadata['source_query'], table_name)
            elif metadata['source_table_name']:
                # Refresh from table
                data_loader.ingest_data(metadata['source_table_name'], name_as=table_name)
            else:
                return jsonify({
                    "status": "error", 
                    "message": "No source table or query found in metadata"
                }), 400
            
            # Compute new content hash after refresh
            new_content_hash = compute_table_content_hash(duck_db_conn, table_name)
            data_changed = old_content_hash != new_content_hash
            
            # Update last_refreshed timestamp and content_hash
            duck_db_conn.execute("""
                UPDATE _df_table_source_metadata 
                SET last_refreshed = CURRENT_TIMESTAMP, content_hash = ?
                WHERE table_name = ?
            """, [new_content_hash, table_name])
            
            # Get updated row count
            row_count = duck_db_conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]

            return jsonify({
                "status": "success",
                "message": f"Successfully refreshed table '{table_name}'",
                "row_count": row_count,
                "content_hash": new_content_hash,
                "data_changed": data_changed
            })

    except Exception as e:
        logger.error(f"Error refreshing table: {str(e)}")
        logger.error(traceback.format_exc())
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code


@tables_bp.route('/data-loader/get-table-metadata', methods=['POST'])
def data_loader_get_table_metadata():
    """Get source metadata for a specific table"""
    try:
        data = request.get_json()
        table_name = data.get('table_name')

        if not table_name:
            return jsonify({"status": "error", "message": "table_name is required"}), 400

        with db_manager.connection(get_identity_id()) as duck_db_conn:
            metadata = get_table_metadata(duck_db_conn, table_name)
            
            if metadata:
                return jsonify({
                    "status": "success",
                    "metadata": metadata
                })
            else:
                return jsonify({
                    "status": "success",
                    "metadata": None,
                    "message": f"No metadata found for table '{table_name}'"
                })

    except Exception as e:
        logger.error(f"Error getting table metadata: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code


@tables_bp.route('/data-loader/list-table-metadata', methods=['GET'])
def data_loader_list_table_metadata():
    """Get source metadata for all tables"""
    try:
        with db_manager.connection(get_identity_id()) as duck_db_conn:
            metadata_list = get_all_table_metadata(duck_db_conn)
            
            return jsonify({
                "status": "success",
                "metadata": metadata_list
            })

    except Exception as e:
        logger.error(f"Error listing table metadata: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code