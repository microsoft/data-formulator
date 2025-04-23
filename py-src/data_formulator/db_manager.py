import duckdb
import pandas as pd
from typing import Optional, Dict, List, ContextManager, Any, Tuple
import time
from flask import session
import tempfile
import os
from contextlib import contextmanager
from dotenv import load_dotenv

class DuckDBManager:
    def __init__(self, external_db_connections: Dict[str, Dict[str, Any]], local_db_dir: str):
        # Store session db file paths
        self._db_files: Dict[str, str] = {}

        # External db connections and tracking of installed extensions
        self._external_db_connections: Dict[str, Dict[str, Any]] = external_db_connections
        self._installed_extensions: Dict[str, List[str]] = {}
        self._local_db_dir: str = local_db_dir

    @contextmanager
    def connection(self, session_id: str) -> ContextManager[duckdb.DuckDBPyConnection]:
        """Get a DuckDB connection as a context manager that will be closed when exiting the context"""
        conn = None
        try:
            conn = self.get_connection(session_id)
            yield conn
        finally:
            # Close the connection after use
            if conn:
                conn.close()
    
    def get_connection(self, session_id: str) -> duckdb.DuckDBPyConnection:
        """Internal method to get or create a DuckDB connection for a session"""
        # Get or create the db file path for this session
        if session_id not in self._db_files or self._db_files[session_id] is None:
            db_dir = self._local_db_dir if self._local_db_dir else tempfile.gettempdir()
            if not os.path.exists(db_dir):
                db_dir = tempfile.gettempdir()
            db_file = os.path.join(db_dir, f"df_{session_id}.duckdb")
            print(f"=== Creating new db file: {db_file}")
            self._db_files[session_id] = db_file
            # Initialize extension tracking for this file
            self._installed_extensions[db_file] = []
        else:
            print(f"=== Using existing db file: {self._db_files[session_id]}")
            db_file = self._db_files[session_id]
            
        # Create a fresh connection to the database file
        conn = duckdb.connect(database=db_file)

        if self._external_db_connections and self._external_db_connections['db_type'] in ['mysql', 'postgresql']:
            db_name = self._external_db_connections['db_name']
            db_type = self._external_db_connections['db_type']
            
            print(f"=== connecting to {db_type} extension")
            # Only install if not already installed for this db file
            if db_type not in self._installed_extensions.get(db_file, []):
                conn.execute(f"INSTALL {db_type};")
                self._installed_extensions[db_file].append(db_type)
                
            conn.execute(f"LOAD {db_type};")
            conn.execute(f"""CREATE SECRET (
                TYPE {db_type}, 
                HOST '{self._external_db_connections['host']}', 
                PORT '{self._external_db_connections['port']}', 
                DATABASE '{self._external_db_connections['database']}', 
                USER '{self._external_db_connections['user']}', 
                PASSWORD '{self._external_db_connections['password']}');
            """)
            conn.execute(f"ATTACH '' AS {db_name} (TYPE {db_type});")
            # result = conn.execute(f"SELECT * FROM {db_name}.information_schema.tables WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys');").fetch_df()
            # print(f"=== result: {result}")
                
        return conn

env = load_dotenv()

# Initialize the DB manager
db_manager = DuckDBManager(
    external_db_connections={
        "db_name": os.getenv('DB_NAME'),
        "db_type": os.getenv('DB_TYPE'),
        "host": os.getenv('DB_HOST'),
        "port": os.getenv('DB_PORT'),
        "database": os.getenv('DB_DATABASE'),
        "user": os.getenv('DB_USER'),
        "password": os.getenv('DB_PASSWORD')
    } if os.getenv('USE_EXTERNAL_DB') == 'true' else None,
    local_db_dir=os.getenv('LOCAL_DB_DIR')
)