import json
import logging
import re
import time
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from typing import Any

try:
    import boto3
    import botocore.exceptions
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

log = logging.getLogger(__name__)


# Valid patterns for Athena identifiers (database.table or just table)
ATHENA_TABLE_PATTERN = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$')
ATHENA_COLUMN_PATTERN = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
S3_URL_PATTERN = re.compile(r'^s3://[a-zA-Z0-9][a-zA-Z0-9.\-_]*[a-zA-Z0-9](/.*)?$')


def _validate_athena_table_name(table_name: str) -> None:
    """Validate that table_name is a safe Athena identifier (database.table format)."""
    if not table_name:
        raise ValueError("Table name cannot be empty")
    if not ATHENA_TABLE_PATTERN.match(table_name):
        raise ValueError(
            f"Invalid table name format: '{table_name}'. "
            "Expected format: 'database.table' or 'table' with alphanumeric characters and underscores only."
        )


def _validate_column_name(column_name: str) -> None:
    """Validate that column_name is a safe identifier."""
    if not column_name:
        raise ValueError("Column name cannot be empty")
    if not ATHENA_COLUMN_PATTERN.match(column_name):
        raise ValueError(
            f"Invalid column name: '{column_name}'. "
            "Only alphanumeric characters and underscores are allowed."
        )


def _validate_s3_url(url: str) -> None:
    """Validate that URL is a proper S3 URL."""
    if not url:
        raise ValueError("S3 URL cannot be empty")
    if not S3_URL_PATTERN.match(url):
        raise ValueError(f"Invalid S3 URL format: '{url}'. Expected format: 's3://bucket/path'")


def _escape_sql_string(value: str | None) -> str:
    """Escape single quotes in SQL string values."""
    if value is None:
        return ""
    return value.replace("'", "''")


class AthenaDataLoader(ExternalDataLoader):
    """AWS Athena data loader implementation.

    Executes SQL queries on Athena and loads results from S3 into DuckDB.
    The output bucket is automatically fetched from the workgroup configuration.
    """

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "aws_profile", "type": "string", "required": False, "default": "", "description": "AWS profile name from ~/.aws/credentials (if set, access key and secret are not required)"},
            {"name": "aws_access_key_id", "type": "string", "required": False, "default": "", "description": "AWS access key ID (not required if using aws_profile)"},
            {"name": "aws_secret_access_key", "type": "string", "required": False, "default": "", "description": "AWS secret access key (not required if using aws_profile)"},
            {"name": "aws_session_token", "type": "string", "required": False, "default": "", "description": "AWS session token (required for temporary credentials)"},
            {"name": "region_name", "type": "string", "required": True, "default": "us-east-1", "description": "AWS region name"},
            {"name": "workgroup", "type": "string", "required": False, "default": "primary", "description": "Athena workgroup name (output location is fetched from workgroup configuration)"},
            {"name": "output_location", "type": "string", "required": False, "default": "", "description": "S3 output location for query results (e.g., s3://bucket/path/). If empty, uses workgroup configuration."},
            {"name": "database", "type": "string", "required": False, "default": "", "description": "Default database/catalog to use for queries"},
            {"name": "query_timeout", "type": "number", "required": False, "default": 300, "description": "Query execution timeout in seconds (default: 300 = 5 minutes)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
**Authentication Options (choose one):**

**Option 1 - AWS Profile (Recommended):**
- **AWS Profile**: Profile name from ~/.aws/credentials (e.g., 'default', 'myprofile')
- Configure profiles via `aws configure --profile myprofile`
- No need to enter access key or secret when using a profile

**Option 2 - Explicit Credentials:**
- **AWS Access Key ID**: Your AWS access key identifier
- **AWS Secret Access Key**: Your AWS secret access key
- **AWS Session Token**: Optional, for temporary credentials only

**Common Parameters:**
- **Region Name**: AWS region (e.g., 'us-east-1', 'ap-southeast-5')
- **Workgroup**: Athena workgroup name (default: 'primary')
- **Output Location**: S3 path for query results (e.g., 's3://my-bucket/athena-results/'). If empty, uses workgroup configuration.
- **Database**: Optional default database/catalog for queries
- **Query Timeout**: Query execution timeout in seconds (default: 300 = 5 minutes)

**Setting up AWS Profile:**
```bash
aws configure --profile myprofile
# Enter: Access Key ID, Secret Access Key, Region, Output format
```

**Required Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:GetWorkGroup",
        "athena:ListDatabases",
        "athena:ListTableMetadata"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-athena-results-bucket",
        "arn:aws:s3:::your-athena-results-bucket/*",
        "arn:aws:s3:::your-data-bucket",
        "arn:aws:s3:::your-data-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetTables"
      ],
      "Resource": "*"
    }
  ]
}
```

**Security:** Never share secret keys, rotate regularly, use least privilege permissions.
        """

    def __init__(self, params: dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        if not BOTO3_AVAILABLE:
            raise ImportError(
                "boto3 is required for Athena connections. "
                "Install with: pip install boto3"
            )

        self.params = params
        self.duck_db_conn = duck_db_conn

        # Extract parameters
        self.aws_profile = params.get("aws_profile", "")
        self.aws_access_key_id = params.get("aws_access_key_id", "")
        self.aws_secret_access_key = params.get("aws_secret_access_key", "")
        self.aws_session_token = params.get("aws_session_token", "")
        self.region_name = params.get("region_name", "us-east-1")
        self.workgroup = params.get("workgroup", "primary")
        self.output_location_param = params.get("output_location", "")
        self.database = params.get("database", "")

        # Normalize and validate query timeout
        raw_timeout = params.get("query_timeout", 300)
        default_timeout = 300

        if raw_timeout is None or (isinstance(raw_timeout, str) and not raw_timeout.strip()):
            timeout_value = default_timeout
        elif isinstance(raw_timeout, int):
            timeout_value = raw_timeout
        elif isinstance(raw_timeout, float):
            timeout_value = int(raw_timeout)
        elif isinstance(raw_timeout, str):
            try:
                # Allow values like "300" or "300.0"
                timeout_value = int(float(raw_timeout.strip()))
            except (ValueError, TypeError):
                raise ValueError(
                    f"Invalid query_timeout value: {raw_timeout!r}. "
                    "Expected a positive number (int or float-compatible string)."
                )
        else:
            raise ValueError(
                f"Invalid type for query_timeout: {type(raw_timeout).__name__}. "
                "Expected int, float, str, or empty."
            )

        if timeout_value <= 0:
            raise ValueError(
                f"query_timeout must be a positive integer number of seconds, got {timeout_value!r}."
            )

        self.query_timeout = timeout_value
        # Initialize boto3 session and Athena client
        if self.aws_profile:
            # Use AWS profile from ~/.aws/credentials or ~/.aws/config (including SSO)
            log.info(f"Using AWS profile: {self.aws_profile}")
            try:
                session = boto3.Session(profile_name=self.aws_profile, region_name=self.region_name)
                self.athena_client = session.client('athena')

                # Get credentials from profile for DuckDB S3 access
                credentials = session.get_credentials()
                if credentials is None:
                    raise ValueError(
                        f"No credentials found for profile '{self.aws_profile}'. "
                        f"If using SSO, run: aws sso login --profile {self.aws_profile}"
                    )

                # get_frozen_credentials() can trigger SSO token refresh/validation
                frozen_credentials = credentials.get_frozen_credentials()
                self.aws_access_key_id = frozen_credentials.access_key
                self.aws_secret_access_key = frozen_credentials.secret_key
                self.aws_session_token = frozen_credentials.token or ""

            except botocore.exceptions.SSOTokenLoadError as e:
                raise ValueError(
                    f"SSO session expired or not logged in for profile '{self.aws_profile}'. "
                    f"Please run: aws sso login --profile {self.aws_profile}"
                ) from e
            except botocore.exceptions.UnauthorizedSSOTokenError as e:
                raise ValueError(
                    f"SSO token is invalid or expired for profile '{self.aws_profile}'. "
                    f"Please run: aws sso login --profile {self.aws_profile}"
                ) from e
            except botocore.exceptions.TokenRetrievalError as e:
                raise ValueError(
                    f"Failed to retrieve SSO token for profile '{self.aws_profile}'. "
                    f"Please run: aws sso login --profile {self.aws_profile}"
                ) from e
            except botocore.exceptions.NoCredentialsError as e:
                raise ValueError(
                    f"No credentials found for profile '{self.aws_profile}'. "
                    f"Check your ~/.aws/credentials or ~/.aws/config file. "
                    f"If using SSO, run: aws sso login --profile {self.aws_profile}"
                ) from e
            except botocore.exceptions.ProfileNotFound as e:
                raise ValueError(
                    f"AWS profile '{self.aws_profile}' not found. "
                    f"Check your ~/.aws/credentials or ~/.aws/config file. "
                    f"Available profiles can be listed with: aws configure list-profiles"
                ) from e
            except Exception as e:
                # Catch any other credential-related errors
                error_msg = str(e).lower()
                if 'sso' in error_msg or 'token' in error_msg or 'expired' in error_msg:
                    raise ValueError(
                        f"AWS credential error for profile '{self.aws_profile}'. "
                        f"If using SSO, run: aws sso login --profile {self.aws_profile}\n"
                        f"Original error: {e}"
                    ) from e
                raise
        else:
            # Use explicit credentials
            if not self.aws_access_key_id or not self.aws_secret_access_key:
                raise ValueError(
                    "Either 'aws_profile' or both 'aws_access_key_id' and 'aws_secret_access_key' must be provided."
                )

            session_kwargs = {
                'aws_access_key_id': self.aws_access_key_id,
                'aws_secret_access_key': self.aws_secret_access_key,
                'region_name': self.region_name
            }
            if self.aws_session_token:
                session_kwargs['aws_session_token'] = self.aws_session_token

            self.athena_client = boto3.client('athena', **session_kwargs)

        # Get output location: prefer user-provided, then try workgroup
        self.output_location = self._get_output_location()

        # Install and load the httpfs extension for S3 access
        self.duck_db_conn.install_extension("httpfs")
        self.duck_db_conn.load_extension("httpfs")

        # Set AWS credentials for DuckDB
        self.duck_db_conn.execute(f"SET s3_region='{self.region_name}'")
        self.duck_db_conn.execute(f"SET s3_access_key_id='{self.aws_access_key_id}'")
        self.duck_db_conn.execute(f"SET s3_secret_access_key='{self.aws_secret_access_key}'")
        if self.aws_session_token:
            self.duck_db_conn.execute(f"SET s3_session_token='{self.aws_session_token}'")

    def _get_output_location(self) -> str:
        """Get the output location for query results.

        Priority: user-provided output_location > workgroup configuration.
        """
        # If user provided an output location, validate and use it
        if self.output_location_param:
            _validate_s3_url(self.output_location_param)
            # Normalize to ensure trailing slash for directory path
            output_location = self.output_location_param.rstrip('/') + '/'
            log.info(f"Using user-provided output location: {output_location}")
            return output_location

        # Try to get from workgroup configuration
        try:
            response = self.athena_client.get_work_group(WorkGroup=self.workgroup)
            workgroup = response.get('WorkGroup', {})
            workgroup_config = workgroup.get('Configuration', {})
            result_config = workgroup_config.get('ResultConfiguration', {})
            output_location = result_config.get('OutputLocation', '')

            if output_location:
                log.info(f"Using output location from workgroup '{self.workgroup}': {output_location}")
                return output_location
            else:
                log.warning(
                    f"Workgroup '{self.workgroup}' has no output location configured. "
                    "Note: Athena console 'Settings' are client-side only. "
                    "Configure output location in Workgroups → Edit → Query result configuration."
                )
        except botocore.exceptions.ClientError as e:
            log.error(f"Failed to get workgroup configuration: {e}")

        raise ValueError(
            f"No output location available. Either:\n"
            f"1. Provide 'output_location' parameter (e.g., 's3://your-bucket/athena-results/'), or\n"
            f"2. Configure an S3 output location in Athena workgroup '{self.workgroup}' settings."
        )

    def _execute_query(self, query: str) -> str:
        """Execute an Athena query and wait for completion.

        Returns the S3 path to the query results (CSV file).
        """
        # Start query execution
        start_params = {
            'QueryString': query,
            'WorkGroup': self.workgroup,
            'ResultConfiguration': {
                'OutputLocation': self.output_location
            }
        }

        if self.database:
            start_params['QueryExecutionContext'] = {'Database': self.database}

        response = self.athena_client.start_query_execution(**start_params)
        query_execution_id = response['QueryExecutionId']
        log.info(f"Started Athena query execution: {query_execution_id}")

        # Poll for query completion
        start_time = time.time()
        while True:
            elapsed = time.time() - start_time
            if elapsed > self.query_timeout:
                # Try to cancel the query. This is a best-effort operation: failures are logged
                # but do not prevent raising the timeout error for the caller.
                try:
                    self.athena_client.stop_query_execution(QueryExecutionId=query_execution_id)
                except Exception:
                    log.warning(
                        "Failed to cancel Athena query execution %s after timeout",
                        query_execution_id,
                        exc_info=True,
                    )
                raise TimeoutError(
                    f"Query execution timed out after {self.query_timeout} seconds. "
                    "Consider increasing the query_timeout parameter."
                )

            response = self.athena_client.get_query_execution(QueryExecutionId=query_execution_id)
            state = response['QueryExecution']['Status']['State']

            if state == 'SUCCEEDED':
                output_location = response['QueryExecution']['ResultConfiguration']['OutputLocation']
                log.info(f"Query completed successfully. Results at: {output_location}")
                return output_location
            elif state == 'FAILED':
                reason = response['QueryExecution']['Status'].get('StateChangeReason', 'Unknown error')
                raise RuntimeError(f"Athena query failed: {reason}")
            elif state == 'CANCELLED':
                raise RuntimeError("Athena query was cancelled")

            # Wait before polling again (exponential backoff with cap)
            wait_time = min(2 ** (elapsed // 10), 10)
            time.sleep(wait_time)

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from Athena catalog (Glue Data Catalog)."""
        results = []

        try:
            # List databases
            databases_response = self.athena_client.list_databases(CatalogName='AwsDataCatalog')
            databases = databases_response.get('DatabaseList', [])

            # If a specific database is configured, filter to just that one
            if self.database:
                databases = [db for db in databases if db['Name'] == self.database]

            for db in databases[:10]:  # Limit to 10 databases
                db_name = db['Name']

                try:
                    # List tables in this database
                    tables_response = self.athena_client.list_table_metadata(
                        CatalogName='AwsDataCatalog',
                        DatabaseName=db_name,
                        MaxResults=50
                    )

                    for table in tables_response.get('TableMetadataList', []):
                        table_name = table['Name']
                        full_table_name = f"{db_name}.{table_name}"

                        # Apply filter if provided
                        if table_filter and table_filter.lower() not in full_table_name.lower():
                            continue

                        # Get column information
                        columns = []
                        for col in table.get('Columns', [])[:20]:  # Limit columns
                            columns.append({
                                'name': col['Name'],
                                'type': col.get('Type', 'unknown')
                            })

                        # Add partition columns
                        for col in table.get('PartitionKeys', []):
                            columns.append({
                                'name': col['Name'],
                                'type': col.get('Type', 'unknown') + ' (partition)'
                            })

                        results.append({
                            "name": full_table_name,
                            "metadata": {
                                "row_count": 0,  # Athena doesn't provide row counts directly
                                "columns": columns,
                                "sample_rows": [],  # Would require query execution
                                "table_type": table.get('TableType', 'EXTERNAL_TABLE')
                            }
                        })

                        if len(results) >= 100:
                            log.info("Reached 100 table limit, stopping enumeration")
                            return results

                except botocore.exceptions.ClientError as e:
                    log.warning(f"Error listing tables in database {db_name}: {e}")
                    continue

        except botocore.exceptions.ClientError as e:
            log.error(f"Error listing Athena databases: {e}")

        log.info(f"Returning {len(results)} tables")
        return results

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000, sort_columns: list[str] | None = None, sort_order: str = 'asc'):
        """Ingest data from an Athena table by executing a SELECT query."""
        # Validate table name to prevent SQL injection
        _validate_athena_table_name(table_name)

        if name_as is None:
            # Extract table name from "database.table" format
            name_as = table_name.split('.')[-1]

        name_as = sanitize_table_name(name_as)

        # Validate and build ORDER BY clause if sort_columns are specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            # Validate each column name
            for col in sort_columns:
                _validate_column_name(col)
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'"{col}" {order_direction}' for col in sort_columns]
            order_by_clause = f"ORDER BY {', '.join(sanitized_cols)}"

        # Validate size is a positive integer
        if not isinstance(size, int) or size <= 0:
            raise ValueError(f"Size must be a positive integer, got: {size}")

        # Build and execute the query
        query = f"SELECT * FROM {table_name} {order_by_clause} LIMIT {size}"
        log.info(f"Executing Athena query for table '{name_as}': {query}")

        result_location = self._execute_query(query)

        # Validate the result location is a proper S3 URL
        _validate_s3_url(result_location)

        # Load results from S3 into DuckDB
        log.info(f"Loading query results from {result_location}")
        self.duck_db_conn.execute(f"""
            CREATE OR REPLACE TABLE main.{name_as} AS
            SELECT * FROM read_csv_auto('{_escape_sql_string(result_location)}')
        """)

        log.info(f"Successfully ingested data into table '{name_as}'")
