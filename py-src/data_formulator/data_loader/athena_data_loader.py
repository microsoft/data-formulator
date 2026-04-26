import logging
import re
import time
import pyarrow as pa
import pyarrow.csv as pa_csv
import boto3
import botocore.exceptions
from pyarrow import fs as pa_fs

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, sanitize_table_name
from typing import Any

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


class AthenaDataLoader(ExternalDataLoader):
    """AWS Athena data loader implementation.

    Executes SQL queries on Athena and reads results from S3 via PyArrow.
    Output location is taken from the workgroup configuration or the output_location param.
    Use ingest_to_workspace() to store results as parquet in the workspace.
    """

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "aws_profile", "type": "string", "required": False, "default": "", "tier": "auth", "description": "AWS profile name from ~/.aws/credentials (if set, access key and secret are not required)"},
            {"name": "aws_access_key_id", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "AWS access key ID (not required if using aws_profile)"},
            {"name": "aws_secret_access_key", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "AWS secret access key (not required if using aws_profile)"},
            {"name": "aws_session_token", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "AWS session token (required for temporary credentials)"},
            {"name": "region_name", "type": "string", "required": True, "default": "us-east-1", "tier": "connection", "description": "AWS region name"},
            {"name": "workgroup", "type": "string", "required": False, "default": "primary", "tier": "connection", "description": "Athena workgroup name (output location is fetched from workgroup configuration)"},
            {"name": "output_location", "type": "string", "required": False, "default": "", "tier": "connection", "description": "S3 output location for query results (e.g., s3://bucket/path/). If empty, uses workgroup configuration."},
            {"name": "database", "type": "string", "required": False, "default": "", "tier": "filter", "description": "Default database/catalog to use for queries"},
            {"name": "query_timeout", "type": "number", "required": False, "default": 300, "tier": "connection", "description": "Query execution timeout in seconds (default: 300 = 5 minutes)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """**Example (profile):** aws_profile: `default` · region_name: `us-east-1` · workgroup: `primary` · database: `my_database`

**Example (keys):** aws_access_key_id: `AKIA...` · aws_secret_access_key: `wJalr...` · region_name: `us-east-1`

**Option 1 — AWS Profile (recommended):**
Set `aws_profile` to a profile name from `~/.aws/credentials`. Set up with `aws configure --profile <name>`. No access key or secret needed.

**Option 2 — Explicit Credentials:**
Enter `aws_access_key_id` and `aws_secret_access_key` directly. Add `aws_session_token` for temporary credentials.

**Required IAM permissions:** `athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`, `athena:GetWorkGroup`, `athena:ListDatabases`, `athena:ListTableMetadata`, plus S3 and Glue permissions on your data/results buckets."""

    def __init__(self, params: dict[str, Any]):
        self.params = params

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

                # Get credentials from profile for PyArrow S3 access
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

        # Setup PyArrow S3 filesystem for reading results
        self.s3_fs = pa_fs.S3FileSystem(
            access_key=self.aws_access_key_id,
            secret_key=self.aws_secret_access_key,
            session_token=self.aws_session_token if self.aws_session_token else None,
            region=self.region_name
        )
        log.info("Initialized PyArrow S3 filesystem for Athena results")

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

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from Athena as a PyArrow Table.
        
        Executes the query on Athena and reads the CSV results from S3
        using PyArrow's S3 filesystem.
        """
        opts = import_options or {}
        size = opts.get("size", 1000000)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")

        if not source_table:
            raise ValueError("source_table must be provided")
        
        _validate_athena_table_name(source_table)
        base_query = f"SELECT * FROM {source_table}"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            for col in sort_columns:
                _validate_column_name(col)
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'"{col}" {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        query = f"{base_query}{order_by_clause} LIMIT {size}"
        
        log.info(f"Executing Athena query: {query[:200]}...")
        
        # Execute query and get result location
        result_location = self._execute_query(query)
        _validate_s3_url(result_location)
        
        log.info(f"Reading Athena results from: {result_location}")
        
        # Parse S3 URL: s3://bucket/key -> bucket/key
        s3_path = result_location[5:] if result_location.startswith("s3://") else result_location
        
        # Athena outputs CSV files
        with self.s3_fs.open_input_file(s3_path) as f:
            arrow_table = pa_csv.read_csv(f)
        
        log.info(f"Fetched {arrow_table.num_rows} rows from Athena [Arrow-native]")
        
        return arrow_table

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

                        if table_filter and table_filter.lower() not in full_table_name.lower():
                            continue

                        columns = []
                        for col in table.get('Columns', [])[:20]:
                            col_entry: dict[str, Any] = {
                                'name': col['Name'],
                                'type': col.get('Type', 'unknown'),
                            }
                            col_comment = (col.get('Comment') or '').strip()
                            if col_comment:
                                col_entry['description'] = col_comment
                            columns.append(col_entry)

                        for col in table.get('PartitionKeys', []):
                            col_entry = {
                                'name': col['Name'],
                                'type': col.get('Type', 'unknown') + ' (partition)',
                            }
                            col_comment = (col.get('Comment') or '').strip()
                            if col_comment:
                                col_entry['description'] = col_comment
                            columns.append(col_entry)

                        metadata: dict[str, Any] = {"columns": columns}
                        table_params = table.get('Parameters', {})
                        table_comment = (table_params.get('comment') or '').strip()
                        if table_comment:
                            metadata["description"] = table_comment

                        results.append({
                            "name": full_table_name,
                            "path": [db_name, table_name],
                            "metadata": metadata,
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

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "table", "label": "Table"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "database":
            try:
                resp = self.athena_client.list_databases(CatalogName="AwsDataCatalog")
                databases = resp.get("DatabaseList", [])
                if self.database:
                    databases = [d for d in databases if d["Name"] == self.database]
            except botocore.exceptions.ClientError:
                databases = []
            nodes = []
            for db in databases:
                name = db["Name"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="namespace", path=path + [name]))
            return nodes

        if level_key == "table":
            pinned = self.pinned_scope()
            db_name = pinned.get("database") or (path[0] if path else None)
            if not db_name:
                return []
            try:
                resp = self.athena_client.list_table_metadata(
                    CatalogName="AwsDataCatalog", DatabaseName=db_name, MaxResults=200,
                )
            except botocore.exceptions.ClientError:
                return []
            nodes = []
            for t in resp.get("TableMetadataList", []):
                name = t["Name"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="table", path=path + [name]))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        pinned = self.pinned_scope()
        remaining = list(path)
        db_name = pinned.get("database")
        if not db_name:
            if not remaining:
                return {}
            db_name = remaining.pop(0)
        if not remaining:
            return {}
        table_name = remaining[0]
        try:
            resp = self.athena_client.get_table_metadata(
                CatalogName="AwsDataCatalog", DatabaseName=db_name, TableName=table_name,
            )
            t = resp.get("TableMetadata", {})
            columns = []
            for c in t.get("Columns", []):
                entry: dict[str, Any] = {"name": c["Name"], "type": c.get("Type", "unknown")}
                col_comment = (c.get("Comment") or "").strip()
                if col_comment:
                    entry["description"] = col_comment
                columns.append(entry)
            for c in t.get("PartitionKeys", []):
                entry = {"name": c["Name"], "type": c.get("Type", "unknown") + " (partition)"}
                col_comment = (c.get("Comment") or "").strip()
                if col_comment:
                    entry["description"] = col_comment
                columns.append(entry)
            result: dict[str, Any] = {"row_count": 0, "columns": columns, "sample_rows": []}
            table_params = t.get("Parameters", {})
            table_comment = (table_params.get("comment") or "").strip()
            if table_comment:
                result["description"] = table_comment
            return result
        except Exception as e:
            log.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self.athena_client.list_databases(CatalogName="AwsDataCatalog", MaxResults=1)
            return True
        except Exception:
            return False
