# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import re
import logging
from typing import Tuple, Dict, Any

logger = logging.getLogger(__name__)


class QueryValidationError(Exception):
    """Custom exception for query validation failures"""
    pass


def normalize_query(query: str) -> str:
    """
    Normalize query for case-insensitive matching
    """
    query_normalized = re.sub(r'--.*$', '', query, flags=re.MULTILINE)  # Single line comments
    query_normalized = re.sub(r'/\*.*?\*/', '', query_normalized, flags=re.DOTALL)  # Multi-line comments
    return query_normalized.strip().lower()

def validate_sql_query(query: str) -> Tuple[bool, str]:
    """
    Simple regex-based SQL query validation for dangerous operations.
    
    Args:
        query: SQL query string to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        # Normalize query for case-insensitive matching
        query_normalized = normalize_query(query)
        
        # Remove SQL comments
        
        
        # Define dangerous patterns as regex patterns
        dangerous_patterns = {
            # File read operations
            'file_read_operations': [
                r'\bread_csv_auto\b', r'\bread_csv\b', r'\bread_json\b', r'\bread_parquet\b',
                r'\bread_ndjson\b', r'\bread_delim\b', r'\bread_fwf\b', r'\bread_excel\b',
                r'\bread_sql\b', r'\bread_table\b', r'\bread_html\b', r'\bread_xml\b',
                r'\bread_feather\b', r'\bread_hdf\b', r'\bread_stata\b', r'\bread_sas\b',
                r'\bread_spss\b', r'\bread_rdata\b', r'\bread_rds\b'
            ],
            
            # File write operations
            'file_write_operations': [
                r'\bwrite_csv\b', r'\bwrite_json\b', r'\bwrite_parquet\b', r'\bwrite_excel\b',
                r'\bwrite_sql\b', r'\bwrite_table\b', r'\bwrite_html\b', r'\bwrite_xml\b',
                r'\bwrite_feather\b', r'\bwrite_hdf\b', r'\bwrite_stata\b', r'\bwrite_sas\b',
                r'\bwrite_spss\b', r'\bwrite_rdata\b', r'\bwrite_rds\b'
            ],
            
            # File system operations
            'file_system_operations': [
                r'\bglob\b', r'\bcopy\b', r'\bmove\b', r'\brename\b', r'\bdelete\b',
                r'\bremove\b', r'\bunlink\b', r'\bmkdir\b', r'\bmakedirs\b', r'\brmdir\b',
                r'\bremovedirs\b', r'\bchmod\b', r'\bchown\b', r'\bsymlink\b', r'\blink\b',
                r'\btouch\b', r'\btruncate\b', r'\bwrite\b', r'\bappend\b'
            ],
            
            # System operations
            'system_operations': [
                r'\bsystem\b', r'\bexec\b', r'\beval\b', r'\bcompile\b', r'\bexecfile\b',
                r'\binput\b', r'\bos\.system\b', r'\bos\.popen\b', r'\bos\.spawn\b',
                r'\bos\.fork\b', r'\bos\.kill\b', r'\bsubprocess\b', r'\bsubprocess\.call\b',
                r'\bsubprocess\.run\b', r'\bsubprocess\.popen\b', r'\bsubprocess\.check_call\b',
                r'\bsubprocess\.check_output\b'
            ],
            
            # Network operations
            'network_operations': [
                r'\burllib\b', r'\brequests\b', r'\bhttp://\b', r'\bhttps://\b', r'\bftp://\b',
                r'\bsmtp\b', r'\bpop3\b', r'\bsocket\b', r'\btelnet\b', r'\bssh\b', r'\bscp\b',
                r'\bwget\b', r'\bcurl\b'
            ],
            
            # Shell operations
            'shell_operations': [
                r'\bshell\b', r'\bcmd\b', r'\bbash\b', r'\bsh\b', r'\bpowershell\b',
                r'\bcmd\.exe\b', r'\bcommand\b', r'\bexecute\b', r'\brun\b', r'\bcall\b',
                r'\binvoke\b'
            ],
            
            # DuckDB dangerous operations
            'duckdb_dangerous_operations': [
                r'\binstall\b', r'\bload\b', r'\bunload\b', r'\bexport\b', r'\bimport\b',
                r'\bcopy_to\b'
            ],
            
            # SQL injection patterns
            'sql_injection_patterns': [
                r';\s*--',  # Comment after semicolon
                r';\s*/\*',  # Block comment after semicolon
                r'\bunion\s+all\s+select\b',  # UNION ALL SELECT
                r'\bunion\s+select\b',  # UNION SELECT
                r'\bxp_cmdshell\b',  # SQL Server command shell
                r'\bsp_executesql\b',  # SQL Server dynamic SQL
            ],
            
            # Dangerous SQL keywords
            'dangerous_sql_keywords': [
                r'\binsert\b', r'\bupdate\b', r'\bdelete\b', r'\bdrop\b', r'\bcreate\b',
                r'\balter\b', r'\btruncate\b', r'\bgrant\b', r'\brevoke\b', r'\bexecute\b',
                r'\bexec\b', r'\bcall\b', r'\bbegin\b', r'\bcommit\b', r'\brollback\b'
            ],
            
            # File path patterns
            'file_path_patterns': [
                r'file://', r'file:///', r'c:\\', r'd:\\', r'e:\\', 
                r'/etc/', r'/var/', r'/tmp/', r'/home/', r'/root/', 
                r'/usr/', r'/bin/', r'/sbin/', r'http://', r'https://',
                r'ftp://', r'sftp://', r'ssh://'
            ]
        }
        
        # Check each category of dangerous patterns
        for category, patterns in dangerous_patterns.items():
            for pattern in patterns:
                if re.search(pattern, query_normalized, re.IGNORECASE):
                    return False, f"Dangerous {category.replace('_', ' ')} detected: {pattern}"
        
        # Check for file paths in string literals
        string_literals = re.findall(r"'([^']*)'", query_normalized) + re.findall(r'"([^"]*)"', query_normalized)
        for literal in string_literals:
            for pattern in dangerous_patterns['file_path_patterns']:
                if re.search(pattern, literal, re.IGNORECASE):
                    return False, f"Dangerous file path detected in string literal: {literal}"
        
        return True, "Query validation passed"
        
    except Exception as e:
        logger.error(f"Error during query validation: {e}")
        return False, f"Query validation error: {str(e)}"


def validate_sql_query_strict(query: str) -> Tuple[bool, str]:
    """
    Strict validation that only allows SELECT queries and basic operations.
    
    Args:
        query: SQL query string to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        # Normalize query
        query_normalized = normalize_query(query)
        
        # Check if it's a SELECT query
        if not query_normalized.startswith('select'):
            return False, "Only SELECT queries are allowed"
        
        # Perform regular validation
        return validate_sql_query(query)
        
    except Exception as e:
        return False, f"Strict validation error: {str(e)}"

