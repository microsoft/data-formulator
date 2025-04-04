import duckdb
import pandas as pd
from typing import Optional, Dict, List, ContextManager
import time
from flask import session
import tempfile
import os
from contextlib import contextmanager

class DuckDBManager:
    def __init__(self):
        # Store session db file paths
        self._db_files: Dict[str, str] = {}
    
    @contextmanager
    def connection(self, session_id: str) -> ContextManager[duckdb.DuckDBPyConnection]:
        """Get a DuckDB connection as a context manager that will be closed when exiting the context"""
        conn = None
        try:
            conn = self._get_connection(session_id)
            yield conn
        finally:
            # Close the connection after use
            if conn:
                conn.close()
    
    def _get_connection(self, session_id: str) -> duckdb.DuckDBPyConnection:
        """Internal method to get or create a DuckDB connection for a session"""
        # Get or create the db file path for this session
        if session_id not in self._db_files:
            db_file = os.path.join(tempfile.gettempdir(), f"df_{session_id}.db")
            print(f"Creating new db file: {db_file}")
            self._db_files[session_id] = db_file
        else:
            print(f"Using existing db file: {self._db_files[session_id]}")
            db_file = self._db_files[session_id]
            
        # Create a fresh connection to the database file
        conn = duckdb.connect(database=db_file)
        return conn
    

# Initialize the DB manager
db_manager = DuckDBManager()
