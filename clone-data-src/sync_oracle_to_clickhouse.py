import oracledb
import pandas as pd
from typing import Optional, List, Dict
import logging
import os
import json
from datetime import datetime

# Configure logging with file output
log_dir = os.path.dirname(os.path.abspath(__file__))
log_file = os.path.join(log_dir, f"sync_oracle_to_clickhouse_{datetime.now().strftime('%Y%m%d')}.log")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Checkpoint file to store last sync timestamp
CHECKPOINT_FILE = os.path.join(log_dir, "sync_checkpoint.json")


class OracleClickhouseSync:
    """Sync data from Oracle to Clickhouse with incremental sync support"""
    
    def __init__(self):
        # Oracle connection string
        self.oracle_connection_string = (
            "User Id=weboutput;Password=weboutputpwd;"
            "Data Source=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)"
            "(HOST=172.25.9.40)(PORT=1521)))"
            "(CONNECT_DATA=(SERVICE_NAME=HOYAV3)));"
        )
        self.oracle_conn = None
        self.clickhouse_client = None
        
        # ClickHouse connection parameters from environment or defaults
        self.ch_host = os.environ.get("CH_HOST", "172.19.16.23")
        self.ch_port = int(os.environ.get("CH_PORT", "8123"))
        self.ch_user = os.environ.get("CH_USER", "admin")
        self.ch_password = os.environ.get("CH_PASSWORD", "1fEQlaBivOpYXzw#")
        self.ch_db = os.environ.get("CH_DB", "QC_DATA")
        
        # Checkpoint tracking
        self.checkpoint = self._load_checkpoint()
        self.table_name = "DPD_QC_INFO"
        
    def connect_to_oracle(self) -> bool:
        """
        Connect to Oracle database
        Returns: True if connection successful, False otherwise
        """
        try:
            logger.info("Attempting to connect to Oracle database...")
            # Parse connection string for oracledb
            # Format: User Id=username;Password=password;Data Source=...
            self.oracle_conn = oracledb.connect(
                user="weboutput",
                password="weboutputpwd",
                dsn="172.25.9.40:1521/HOYAV3"
            )
            logger.info("✓ Successfully connected to Oracle database")
            return True
        except Exception as e:
            logger.error(f"✗ Failed to connect to Oracle: {str(e)}")
            return False
    
    def _load_checkpoint(self) -> Dict:
        """Load last sync checkpoint from file
        Checkpoint tracks last_synced_date (YYYYMMDD format)
        """
        try:
            if os.path.exists(CHECKPOINT_FILE):
                with open(CHECKPOINT_FILE, 'r') as f:
                    checkpoint = json.load(f)
                    
                    # Check if checkpoint is from previous day - if so, reset for new full sync
                    last_sync_date = checkpoint.get('last_sync_datetime', '')
                    if last_sync_date:
                        last_sync_day = last_sync_date.split('T')[0]  # Extract YYYY-MM-DD
                        today = datetime.now().strftime('%Y-%m-%d')
                        
                        if last_sync_day != today:
                            logger.info(f"ℹ New day detected (last sync: {last_sync_day}, today: {today})")
                            logger.info(f"✓ Resetting checkpoint for daily full sync")
                            logger.info(f"  Will process all dates from MIN(PDDATE) to today")
                            return {"last_synced_date": None}
                    
                    logger.info(f"✓ Loaded checkpoint - Last synced date: {checkpoint.get('last_synced_date')}")
                    return checkpoint
        except Exception as e:
            logger.warning(f"Could not load checkpoint: {e}")
        
        # Default checkpoint - start from beginning
        return {"last_synced_date": None}
    
    def _save_checkpoint(self, pddate: str):
        """Save checkpoint with last synced date (YYYYMMDD format)
        pddate: The date that was just synced (e.g., '20250702')
        """
        try:
            checkpoint = {
                "last_synced_date": pddate,
                "last_sync_datetime": datetime.now().isoformat(),
                "table_name": self.table_name,
                "strategy": "Daily batch processing by PDDATE + ReplacingMergeTree dedup"
            }
            with open(CHECKPOINT_FILE, 'w') as f:
                json.dump(checkpoint, f, indent=2)
            logger.info(f"✓ Saved checkpoint - Last synced date: {pddate}")
        except Exception as e:
            logger.error(f"✗ Failed to save checkpoint: {e}")
    
    def get_min_pddate(self) -> Optional[str]:
        """Get minimum PDDATE from Oracle table
        Returns date in YYYYMMDD format, or None if query fails
        """
        if not self.oracle_conn:
            logger.error("No database connection. Please connect first.")
            return None
        
        try:
            query = f"SELECT MIN(PDDATE) as min_date FROM DPD_QC_INFO"
            result = pd.read_sql(query, self.oracle_conn)
            
            if result.empty or result.iloc[0]['min_date'] is None:
                logger.warning("No records found in table")
                return None
            
            min_date = str(result.iloc[0]['min_date']).strip()
            logger.info(f"✓ Got minimum PDDATE: {min_date}")
            return min_date
        except Exception as e:
            logger.error(f"✗ Error getting minimum PDDATE: {str(e)}")
            return None
    
    def fetch_data_from_table(
        self, 
        table_name: str = "DPD_QC_INFO", 
        pddate: str = None
    ) -> Optional[pd.DataFrame]:
        """
        Fetch all records for a specific date from Oracle table
        
        Args:
            table_name: Name of the table to fetch from
            pddate: Date in YYYYMMDD format (e.g., '20250702')
            
        Returns:
            Pandas DataFrame with all records for that date, or None if failed
        """
        if not self.oracle_conn:
            logger.error("No database connection. Please connect first.")
            return None
        
        if not pddate:
            logger.error("PDDATE is required")
            return None
        
        try:
            logger.info(f"Fetching all records for date: {pddate}")
            query = f"""
                SELECT * FROM {table_name}
                WHERE PDDATE = '{pddate}'
            """
            
            # Fetch data using pandas
            df = pd.read_sql(query, self.oracle_conn)
            logger.info(f"✓ Successfully fetched {len(df)} records for date {pddate}")
            return df
            
        except Exception as e:
            logger.error(f"✗ Error fetching data for date {pddate}: {str(e)}")
            return None
    
    def close_connection(self):
        """Close Oracle database connection"""
        if self.oracle_conn:
            try:
                self.oracle_conn.close()
                logger.info("✓ Oracle connection closed")
            except Exception as e:
                logger.error(f"✗ Error closing Oracle connection: {str(e)}")
    
    def display_data(self, df: pd.DataFrame, rows_to_display: int = 10):
        """
        Display data from DataFrame
        
        Args:
            df: DataFrame to display
            rows_to_display: Number of rows to display
        """
        if df is None or df.empty:
            logger.warning("No data to display")
            return
        
        print("\n" + "="*80)
        print(f"Data from DPD_QC_INFO table ({len(df)} records fetched)")
        print("="*80)
        print(f"\nColumns: {list(df.columns)}")
        print(f"Shape: {df.shape}")
        print(f"\nFirst {min(rows_to_display, len(df))} records:")
        print(df.head(rows_to_display).to_string())
        print("\n" + "="*80)

    def connect_to_clickhouse(self) -> bool:
        """
        Connect to ClickHouse database
        Returns: True if connection successful, False otherwise
        """
        try:
            logger.info(f"Attempting to connect to ClickHouse at {self.ch_host}:{self.ch_port}...")
            from clickhouse_connect import get_client
            
            self.clickhouse_client = get_client(
                host=self.ch_host,
                port=self.ch_port,
                username=self.ch_user,
                password=self.ch_password,
                database=self.ch_db
            )
            logger.info("✓ Successfully connected to ClickHouse database")
            return True
        except Exception as e:
            logger.error(f"✗ Failed to connect to ClickHouse: {str(e)}")
            return False

    def create_clickhouse_table_if_not_exists(self, df: pd.DataFrame, table_name: str = "DPD_QC_INFO") -> bool:
        """
        Create ClickHouse table if it doesn't exist
        
        Args:
            df: DataFrame with column names and types
            table_name: Name of the table to create
            
        Returns:
            True if successful, False otherwise
        """
        if not self.clickhouse_client:
            logger.error("No ClickHouse connection")
            return False
        
        try:
            # Check if table exists
            existing_tables = self.clickhouse_client.query(
                f"SELECT name FROM system.tables WHERE database = '{self.ch_db}' AND name = '{table_name}'"
            )
            
            if existing_tables.result_rows:
                logger.info(f"✓ Table {table_name} already exists in ClickHouse")
                return True
            
            # Create table based on DataFrame dtypes
            create_query = self._generate_create_table_query(df, table_name)
            logger.info(f"Creating table: {create_query}")
            
            self.clickhouse_client.command(create_query)
            logger.info(f"✓ Successfully created table {table_name} in ClickHouse")
            return True
            
        except Exception as e:
            logger.error(f"✗ Error creating ClickHouse table: {str(e)}")
            return False

    def _generate_create_table_query(self, df: pd.DataFrame, table_name: str) -> str:
        """
        Generate CREATE TABLE query based on DataFrame schema
        Using ReplacingMergeTree to handle duplicates with OID as primary key
        
        Args:
            df: DataFrame with columns
            table_name: Name of the table
            
        Returns:
            SQL CREATE TABLE query
        """
        column_defs = []
        has_oid = "OID" in df.columns
        
        for col_name, dtype in zip(df.columns, df.dtypes):
            # Map pandas dtypes to ClickHouse types
            if dtype == 'object':
                ch_type = "String"
            elif dtype == 'int64':
                ch_type = "Int64"
            elif dtype == 'float64':
                ch_type = "Float64"
            elif dtype == 'bool':
                ch_type = "UInt8"
            elif str(dtype).startswith('datetime'):
                ch_type = "DateTime"
            else:
                ch_type = "String"
            
            column_defs.append(f"`{col_name}` {ch_type}")
        
        columns_str = ',\n    '.join(column_defs)
        
        # Use ReplacingMergeTree with OID as ORDER BY (primary unique key)
        # and _version for handling updates
        if has_oid:
            create_query = f"""
            CREATE TABLE IF NOT EXISTS {self.ch_db}.{table_name} (
                {columns_str},
                _version UInt32 DEFAULT 0
            ) ENGINE = ReplacingMergeTree(_version)
            ORDER BY (`OID`)
            """
            logger.info(f"Using ReplacingMergeTree with OID as primary key for deduplication")
        else:
            # Fallback to MergeTree if no OID found
            create_query = f"""
            CREATE TABLE IF NOT EXISTS {self.ch_db}.{table_name} (
                {columns_str}
            ) ENGINE = MergeTree()
            ORDER BY tuple()
            """
            logger.warning("No OID column detected - using MergeTree without deduplication")
        
        return create_query

    def get_clickhouse_table_columns(self, table_name: str) -> Optional[List[str]]:
        """
        Get list of column names from existing ClickHouse table
        
        Args:
            table_name: Name of the ClickHouse table
            
        Returns:
            List of column names, or None if failed
        """
        if not self.clickhouse_client:
            logger.error("No ClickHouse connection")
            return None
        
        try:
            result = self.clickhouse_client.query(
                f"SELECT name FROM system.columns WHERE database = '{self.ch_db}' AND table = '{table_name}' ORDER BY position"
            )
            columns = [row[0] for row in result.result_rows]
            logger.info(f"✓ Retrieved {len(columns)} columns from ClickHouse table {table_name}")
            return columns
        except Exception as e:
            logger.error(f"✗ Error getting ClickHouse table columns: {str(e)}")
            return None

    def get_existing_oids(self, table_name: str = "DPD_QC_INFO") -> set:
        """
        Get all existing OID values from ClickHouse table (for deduplication check)
        Uses FINAL to get actual latest state
        
        Args:
            table_name: Name of the ClickHouse table
            
        Returns:
            Set of existing OIDs
        """
        if not self.clickhouse_client:
            logger.error("No ClickHouse connection")
            return set()
        
        try:
            # Query to get all unique OIDs using FINAL to ensure we get latest version
            result = self.clickhouse_client.query(
                f"SELECT DISTINCT OID FROM {self.ch_db}.{table_name} FINAL WHERE OID IS NOT NULL"
            )
            oids = {str(row[0]) for row in result.result_rows}
            logger.info(f"✓ Retrieved {len(oids)} existing OIDs from {table_name}")
            return oids
        except Exception as e:
            logger.warning(f"⚠ Could not retrieve existing OIDs (will proceed with insert): {str(e)}")
            return set()

    def insert_data_to_clickhouse(self, df: pd.DataFrame, table_name: str = "DPD_QC_INFO", check_duplicates: bool = True) -> bool:
        """
        Insert data from DataFrame to ClickHouse table with smart deduplication
        Only inserts columns that exist in the ClickHouse table
        Splits data into new records (INSERT) and updated records (already exist)
        
        Args:
            df: DataFrame with data to insert
            table_name: Name of the ClickHouse table
            check_duplicates: Whether to check for existing OIDs (faster if False on first sync)
            
        Returns:
            True if successful, False otherwise
        """
        if not self.clickhouse_client:
            logger.error("No ClickHouse connection")
            return False
        
        if df is None or df.empty:
            logger.warning("No data to insert")
            return False
        
        try:
            logger.info(f"Processing {len(df)} records for ClickHouse table {table_name}...")
            
            # Get existing columns in ClickHouse table
            ch_columns = self.get_clickhouse_table_columns(table_name)
            if ch_columns is None:
                logger.error(f"Could not retrieve columns from {table_name}")
                return False
            
            # Filter DataFrame to only include columns that exist in ClickHouse
            df_filtered = df[[col for col in df.columns if col in ch_columns]].copy()
            
            # Log columns that are not being inserted
            missing_cols = [col for col in df.columns if col not in ch_columns]
            if missing_cols:
                logger.info(f"⚠ Skipping columns not in ClickHouse: {missing_cols}")
            
            # Check for duplicates if needed (skip on first sync for performance)
            if check_duplicates and 'OID' in df_filtered.columns:
                existing_oids = self.get_existing_oids(table_name)
                
                if existing_oids:
                    df_oids = set(df_filtered['OID'].astype(str).values)
                    new_oids = df_oids - existing_oids
                    update_oids = df_oids & existing_oids
                    
                    logger.info(f"  New records: {len(new_oids)}, Update records: {len(update_oids)}, Total: {len(df_filtered)}")
                    
                    if update_oids:
                        logger.info(f"⚠ Detected {len(update_oids)} duplicate OIDs - version will be incremented for updates")
                else:
                    logger.info(f"✓ No existing records found in {table_name} - all {len(df_filtered)} records are new")
            
            logger.info(f"Inserting {len(df_filtered.columns)} columns: {list(df_filtered.columns)}")
            
            # Add version column for ReplacingMergeTree (incremented for updates)
            if '_version' in ch_columns:
                # Increment version for updates or set 1 for new records
                if check_duplicates and 'OID' in df_filtered.columns:
                    existing_oids = self.get_existing_oids(table_name)
                    df_filtered['_version'] = df_filtered['OID'].astype(str).apply(
                        lambda oid: 2 if str(oid) in existing_oids else 1
                    )
                else:
                    df_filtered['_version'] = 1
            
            # Convert datetime/Timestamp columns to string format for ClickHouse
            for col in df_filtered.columns:
                if pd.api.types.is_datetime64_any_dtype(df_filtered[col]):
                    df_filtered[col] = df_filtered[col].astype(str)
            
            # Convert DataFrame to list of lists for insertion
            data = df_filtered.values.tolist()
            column_names = df_filtered.columns.tolist()
            
            self.clickhouse_client.insert(
                table=f"{self.ch_db}.{table_name}",
                data=data,
                column_names=column_names
            )
            
            logger.info(f"✓ Successfully inserted {len(df_filtered)} records to {table_name}")
            return True
            
        except Exception as e:
            logger.error(f"✗ Error inserting data to ClickHouse: {str(e)}")
            return False

    def close_clickhouse_connection(self):
        """Close ClickHouse connection"""
        if self.clickhouse_client:
            try:
                logger.info("✓ ClickHouse connection closed")
                # ClickHouse client doesn't need explicit close, but we can clear it
                self.clickhouse_client = None
            except Exception as e:
                logger.error(f"✗ Error closing ClickHouse connection: {str(e)}")


def main():
    """Main function: sync data by processing each day as a batch"""
    
    sync = OracleClickhouseSync()
    total_inserted = 0
    
    try:
        # Connect to Oracle
        if not sync.connect_to_oracle():
            logger.error("Failed to connect to Oracle")
            return False
        
        # Connect to ClickHouse
        if not sync.connect_to_clickhouse():
            logger.error("Failed to connect to ClickHouse")
            return False
        
        # Get minimum PDDATE from Oracle
        min_pddate = sync.get_min_pddate()
        if not min_pddate:
            logger.error("Could not get minimum PDDATE from Oracle")
            return False
        
        # Get last synced date from checkpoint
        last_synced_date = sync.checkpoint.get("last_synced_date")
        
        # Determine start date
        if last_synced_date:
            # Resume from next day after last sync
            from datetime import datetime, timedelta
            last_date = datetime.strptime(last_synced_date, "%Y%m%d")
            start_date = (last_date + timedelta(days=1)).strftime("%Y%m%d")
            logger.info(f"ℹ Resuming from date: {start_date} (last synced: {last_synced_date})")
        else:
            # Start from minimum date
            start_date = min_pddate
            logger.info(f"ℹ Starting from minimum date: {start_date}")
        
        # Get today's date
        today = datetime.now().strftime("%Y%m%d")
        logger.info(f"ℹ Processing until today: {today}")
        
        # Generate date range
        from datetime import datetime, timedelta
        current_date = datetime.strptime(start_date, "%Y%m%d")
        end_date = datetime.strptime(today, "%Y%m%d")
        
        first_batch = True
        
        # Loop through each day
        while current_date <= end_date:
            current_pddate = current_date.strftime("%Y%m%d")
            
            logger.info(f"\n{'='*80}")
            logger.info(f"Processing date: {current_pddate}")
            logger.info(f"{'='*80}")
            
            # Fetch all records for this date
            df = sync.fetch_data_from_table(
                table_name="DPD_QC_INFO",
                pddate=current_pddate
            )
            
            # If no records for this date, skip
            if df is None or df.empty:
                logger.info(f"⊘ No records for date {current_pddate}, skipping")
                current_date += timedelta(days=1)
                continue
            
            # Create table if not exists (only on first batch)
            if first_batch:
                if not sync.create_clickhouse_table_if_not_exists(df, "DPD_QC_INFO"):
                    logger.error("Failed to create ClickHouse table")
                    return False
                first_batch = False
                logger.info("ℹ First batch - skipping duplicate check (100% new records)")
                check_dups = False
            else:
                # Check duplicates on subsequent days
                check_dups = True
            
            # Insert batch to ClickHouse with smart deduplication
            if not sync.insert_data_to_clickhouse(df, "DPD_QC_INFO", check_duplicates=check_dups):
                logger.error(f"Failed to insert batch for date {current_pddate}")
                return False
            
            total_inserted += len(df)
            
            # Save checkpoint for this date
            sync._save_checkpoint(current_pddate)
            
            # Move to next date
            current_date += timedelta(days=1)
        
        # Display summary
        logger.info(f"\n{'='*80}")
        logger.info(f"✓ Sync completed successfully!")
        logger.info(f"  Total records processed: {total_inserted}")
        logger.info(f"  Date range: {start_date} to {today}")
        logger.info(f"  Strategy: Daily batch by PDDATE + ReplacingMergeTree dedup")
        logger.info(f"  Data integrity: ✓ (Full day batches ensure consistency)")
        logger.info(f"{'='*80}\n")
        
        return True
        
    except Exception as e:
        logger.error(f"✗ Unexpected error in main: {str(e)}")
        return False
    finally:
        sync.close_connection()
        sync.close_clickhouse_connection()


if __name__ == "__main__":
    main()
