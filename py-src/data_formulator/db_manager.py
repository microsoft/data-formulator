# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import duckdb
import pandas as pd
from typing import Dict
import tempfile
import os
from contextlib import contextmanager
from dotenv import load_dotenv
import logging

logger = logging.getLogger(__name__)

class DuckDBManager:
    def __init__(self, local_db_dir: str, disabled: bool = False):
        # Store session db file paths
        self._db_files: Dict[str, str] = {}
        self._local_db_dir: str = local_db_dir
        self._disabled: bool = disabled

    def is_disabled(self) -> bool:
        """Check if the database manager is disabled"""
        return self._disabled

    @contextmanager
    def connection(self, session_id: str):
        """Get a DuckDB connection as a context manager that will be closed when exiting the context"""
        conn = None
        try:
            conn = self.get_connection(session_id)
            yield conn
        finally:
            if conn:
                conn.close()
    
    def get_connection(self, session_id: str) -> duckdb.DuckDBPyConnection:
        """Internal method to get or create a DuckDB connection for a session"""
        if self._disabled:
            return duckdb.connect(database=":memory:")
            
        # Get or create the db file path for this session
        if session_id not in self._db_files or self._db_files[session_id] is None:
            db_dir = self._local_db_dir if self._local_db_dir else tempfile.gettempdir()
            if not os.path.exists(db_dir):
                db_dir = tempfile.gettempdir()
            db_file = os.path.join(db_dir, f"df_{session_id}.duckdb")
            logger.debug(f"=== Creating new db file: {db_file}")
            self._db_files[session_id] = db_file
        else:
            logger.debug(f"=== Using existing db file: {self._db_files[session_id]}")
            db_file = self._db_files[session_id]
            
        # Create a fresh connection to the database file
        conn = duckdb.connect(database=db_file)

        return conn

env = load_dotenv()

# Initialize the DB manager
db_manager = DuckDBManager(
    local_db_dir=os.getenv('LOCAL_DB_DIR'),
    disabled=os.getenv('DISABLE_DATABASE', 'false').lower() == 'true'
)