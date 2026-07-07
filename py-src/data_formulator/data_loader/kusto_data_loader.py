import json
import logging
from typing import Any
import pandas as pd
import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS, sanitize_table_name
from data_formulator.datalake.parquet_utils import df_to_safe_records

from azure.kusto.data import KustoClient, KustoConnectionStringBuilder, ClientRequestProperties
from azure.kusto.data.helpers import dataframe_from_result_table

logger = logging.getLogger(__name__)


def _coerce_int(value: Any) -> int | None:
    """Best-effort conversion of a Kusto stat field to ``int``.

    ``.show tables details`` returns numeric stats that may arrive as ints,
    floats, strings, or ``None`` depending on the SDK/cluster. Returns
    ``None`` when the value is missing or not a number.
    """
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class KustoDataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Kusto"

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "kusto_cluster", "type": "string", "required": True, "tier": "connection", "description": "e.g., https://mycluster.region.kusto.windows.net"}, 
            {"name": "kusto_database", "type": "string", "required": False, "tier": "filter", "description": "Database name (leave empty to browse all databases)"}, 
            {"name": "client_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"}, 
            {"name": "client_secret", "type": "string", "required": False, "sensitive": True, "tier": "auth", "description": "Service principal only"}, 
            {"name": "tenant_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """**Option 1 — Azure Default Identity (recommended):** Leave the auth fields empty. DF connects using the host's ambient Azure credentials — your Azure CLI login (`az login`) when running locally, or a Managed Identity when deployed to Azure. That identity must be granted access to the cluster.

**Option 2 — Service Principal:** Provide `client_id`, `client_secret`, and `tenant_id` for a service principal with cluster access."""

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.kusto_cluster = params.get("kusto_cluster", None)
        self.kusto_database = params.get("kusto_database", None)

        self.client_id = params.get("client_id", None)
        self.client_secret = params.get("client_secret", None)
        self.tenant_id = params.get("tenant_id", None)

        # Optional delegated user token (Kusto-audience). Reserved for a future
        # user-impersonation sign-in; when absent the loader falls through to
        # ambient Azure credentials (az login / Managed Identity).
        self.access_token = params.get("access_token", None)

        try:
            self.client = KustoClient(self._build_kcsb())
        except Exception as e:
            logger.error(f"Error creating Kusto client: {e}")
            raise RuntimeError(
                f"Error creating Kusto client: {e}. "
                "Sign in with Microsoft, run 'az login', or provide service "
                "principal credentials. If running on Azure, ensure a Managed "
                "Identity is assigned to the host."
            ) from e

    def _build_kcsb(self) -> KustoConnectionStringBuilder:
        """Build the Kusto connection string builder using the best available
        credential, in priority order.

        1. Explicit Kusto-audience ``access_token`` (delegated user token)
        2. Service principal (``client_id`` / ``client_secret`` / ``tenant_id``)
        3. ``DefaultAzureCredential`` (``az login`` / Managed Identity / etc.)
        """
        # 1. Explicit Kusto user token (already scoped for the cluster).
        if self.access_token:
            logger.info("Using delegated user token for Kusto client.")
            return KustoConnectionStringBuilder.with_aad_user_token_authentication(
                self.kusto_cluster, self.access_token)

        # 2. Service principal.
        if self.client_id and self.client_secret and self.tenant_id:
            logger.info("Using service principal authentication for Kusto client.")
            return KustoConnectionStringBuilder.with_aad_application_key_authentication(
                self.kusto_cluster, self.client_id, self.client_secret, self.tenant_id)

        # 3. DefaultAzureCredential: az login, Managed Identity, VS Code, env vars, etc.
        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential()
        logger.info(
            "Using DefaultAzureCredential for Kusto client "
            "(az login / Managed Identity / etc.).")
        return KustoConnectionStringBuilder.with_azure_token_credential(
            self.kusto_cluster, credential)

    def _convert_kusto_datetime_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Convert Kusto datetime columns to proper pandas datetime format"""
        logger.info(f"Processing DataFrame with columns: {list(df.columns)}")
        logger.info(f"Column dtypes before conversion: {dict(df.dtypes)}")
        
        for col in df.columns:
            original_dtype = df[col].dtype
            
            if df[col].dtype == 'object':
                # Try to identify datetime columns by checking sample values
                sample_values = df[col].dropna().head(3)
                if len(sample_values) > 0:
                    # Check if values look like datetime strings or timestamp numbers
                    first_val = sample_values.iloc[0]
                    
                    # Handle Kusto datetime format (ISO 8601 strings)
                    if isinstance(first_val, str) and ('T' in first_val or '-' in first_val):
                        try:
                            # Try to parse as datetime
                            pd.to_datetime(sample_values.iloc[0])
                            logger.info(f"Converting column '{col}' from string to datetime")
                            df[col] = pd.to_datetime(df[col], errors='coerce', utc=True).dt.tz_localize(None)
                        except Exception as e:
                            logger.debug(f"Failed to convert column '{col}' as string datetime: {e}")
                    
                    # Handle numeric timestamps (Unix timestamps in various formats)
                    elif isinstance(first_val, (int, float)) and first_val > 1000000000:
                        try:
                            # Try different timestamp formats
                            if first_val > 1e15:  # Likely microseconds since epoch
                                logger.info(f"Converting column '{col}' from microseconds timestamp to datetime")
                                df[col] = pd.to_datetime(df[col], unit='us', errors='coerce', utc=True).dt.tz_localize(None)
                            elif first_val > 1e12:  # Likely milliseconds since epoch
                                logger.info(f"Converting column '{col}' from milliseconds timestamp to datetime")
                                df[col] = pd.to_datetime(df[col], unit='ms', errors='coerce', utc=True).dt.tz_localize(None)
                            else:  # Likely seconds since epoch
                                logger.info(f"Converting column '{col}' from seconds timestamp to datetime")
                                df[col] = pd.to_datetime(df[col], unit='s', errors='coerce', utc=True).dt.tz_localize(None)
                        except Exception as e:
                            logger.debug(f"Failed to convert column '{col}' as numeric timestamp: {e}")
                            
            # Handle datetime64 columns that might have timezone info
            elif pd.api.types.is_datetime64_any_dtype(df[col]):
                # Ensure timezone-aware datetimes are properly handled
                if hasattr(df[col].dt, 'tz') and df[col].dt.tz is not None:
                    logger.info(f"Converting timezone-aware datetime column '{col}' to UTC")
                    df[col] = df[col].dt.tz_convert('UTC').dt.tz_localize(None)
            
            # Log if conversion happened
            if original_dtype != df[col].dtype:
                logger.info(f"Column '{col}' converted from {original_dtype} to {df[col].dtype}")
        
        logger.info(f"Column dtypes after conversion: {dict(df.dtypes)}")
        return df

    def query(self, kql: str, no_truncation: bool = False) -> pd.DataFrame:
        logger.info(f"Executing KQL query: {kql} on database {self.kusto_database}")
        properties = None
        if no_truncation:
            # Kusto truncates query results at 64 MB / 500k rows by default and
            # fails the whole query if exceeded. Bulk imports already bound the
            # row count with `| take {size}`, so lift the truncation safety to
            # let that bounded result through instead of erroring out.
            properties = ClientRequestProperties()
            properties.set_option("notruncation", True)
        result = self.client.execute(self.kusto_database, kql, properties)
        logger.info(f"Query executed successfully, returning results.")
        df = dataframe_from_result_table(result.primary_results[0])
        
        # Convert datetime columns properly
        df = self._convert_kusto_datetime_columns(df)
        
        return df

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from Kusto/Azure Data Explorer as a PyArrow Table.
        
        Kusto SDK returns pandas, so we convert to Arrow format.
        
        Args:
            source_table: Kusto table name
            size: Maximum number of rows to fetch
            sort_columns: Columns to sort by
            sort_order: Sort direction
        """
        opts = import_options or {}
        size = min(opts.get("size", MAX_IMPORT_ROWS), MAX_IMPORT_ROWS)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")

        if not source_table:
            raise ValueError("source_table must be provided")

        # Cross-database catalog entries are "database.table"; resolve the
        # database so the query targets it rather than the (possibly unset)
        # connect-time default.
        db, table = self._resolve_source_table(source_table)
        base_query = f"['{table}']"

        # Add sort if specified (KQL syntax)
        sort_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "desc" if sort_order == 'desc' else "asc"
            sort_cols_with_order = [f"{col} {order_direction}" for col in sort_columns]
            sort_clause = f" | sort by {', '.join(sort_cols_with_order)}"

        # Add take limit
        kql_query = f"{base_query}{sort_clause} | take {size}"

        logger.info(f"Executing Kusto query: {kql_query[:200]}...")

        # Execute query in the resolved database context
        old_db = self.kusto_database
        if db:
            self.kusto_database = db
        try:
            # Bulk fetch: `take {size}` bounds the row count, so disable Kusto's
            # 64 MB result-truncation safety (which would otherwise fail the
            # whole query for wide tables) rather than returning nothing.
            df = self.query(kql_query, no_truncation=True)
        finally:
            self.kusto_database = old_db

        # Convert to Arrow
        arrow_table = pa.Table.from_pandas(df, preserve_index=False)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from Kusto")
        
        return arrow_table

    def _resolve_source_table(self, source_table: str) -> tuple[str | None, str]:
        """Parse a source_table identifier into ``(database, table)``.

        Cross-database catalog entries are ``"database.table"`` and must be
        split even when a database is pinned — otherwise the whole identifier
        gets bracket-quoted (``['db.table']``) and Kusto reads it as a single
        table literally named with a dot. A bare identifier uses the pinned
        database when available. Returns ``(database_or_None, table)``; when
        *database* is ``None`` the caller should use the connect-time database.
        """
        parts = source_table.split(".")
        if len(parts) >= 2:
            return parts[0], ".".join(parts[1:])
        if self.kusto_database:
            return self.kusto_database, source_table
        return None, source_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from the Kusto cluster.

        When a database is pinned (``kusto_database`` supplied at connect
        time), lists tables within that database and returns ``path =
        [table]``. Otherwise enumerates every database on the cluster and
        returns ``path = [database, table]`` so the catalog groups tables by
        database — matching ``catalog_hierarchy()``.

        Uses `.show tables details` for lightweight metadata (name, DocString).
        When a single database is pinned, a bulk `.show database schema as json`
        also fetches every table's columns in one control command. A
        full-cluster scan (no pinned database) skips columns — running a bulk
        schema query against *every* database is what caused connection
        timeouts on large clusters; columns load lazily per database instead.
        """
        if self.kusto_database:
            return self._list_tables_in_db(
                self.kusto_database, table_filter,
                path_prefix=[], fetch_columns=True)

        # No database pinned: enumerate all databases on the cluster. Columns
        # are intentionally NOT fetched here — a bulk schema query per database
        # across the whole cluster is expensive and times out. They load lazily
        # per database (see ``get_metadata`` / pinned-database browsing).
        tables: list[dict[str, Any]] = []
        self._report_progress("Listing databases on the cluster…")
        db_df = self.query(".show databases")
        db_names = [
            rec.get("DatabaseName")
            for rec in db_df.to_dict(orient="records")
            if rec.get("DatabaseName")
        ]
        total = len(db_names)
        self._report_progress(f"Found {total} databases; listing tables…")
        for idx, db_name in enumerate(db_names, start=1):
            self._report_progress(
                f"Querying database '{db_name}' ({idx}/{total})…")
            tables.extend(self._list_tables_in_db(
                db_name, table_filter,
                path_prefix=[db_name], fetch_columns=False))
        return tables

    def _fetch_db_columns_bulk(self, db_name: str) -> dict[str, list[dict[str, str]]]:
        """Fetch column schemas for *every* table in a database with a single
        control command (``.show database schema as json``).

        This replaces a per-table ``.show table schema`` (one round-trip per
        table) with one query for the whole database — cheap even for large
        databases with many tables. Returns ``{table_name: [{"name", "type"},
        ...]}``; empty on failure so callers degrade to "no columns".
        """
        old_db = self.kusto_database
        self.kusto_database = db_name
        try:
            rows = self.query(".show database schema as json").to_dict(orient="records")
        except Exception as e:
            logger.warning(f"Bulk schema fetch failed for database '{db_name}': {e}")
            return {}
        finally:
            self.kusto_database = old_db

        if not rows:
            return {}
        # Single row holding the schema JSON; the column name varies by cluster
        # version ("DatabaseSchema"), so just take the first value.
        raw = next(iter(rows[0].values()), None)
        if not raw:
            return {}
        try:
            schema = json.loads(raw)
        except Exception:
            return {}

        databases = schema.get("Databases", {}) or {}
        # Prefer the requested database; fall back to the sole entry present.
        db_entry = databases.get(db_name)
        if db_entry is None and len(databases) == 1:
            db_entry = next(iter(databases.values()))
        db_entry = db_entry or {}

        out: dict[str, list[dict[str, str]]] = {}
        for tname, tinfo in (db_entry.get("Tables", {}) or {}).items():
            out[tname] = [
                # Prefer the friendly Kusto type ("long", "string", "datetime")
                # over the verbose CLR type ("System.Int64") for display.
                {"name": c.get("Name"), "type": c.get("CslType") or c.get("Type") or ""}
                for c in (tinfo.get("OrderedColumns") or [])
                if c.get("Name")
            ]
        return out

    def _list_tables_in_db(
        self,
        db_name: str,
        table_filter: str | None,
        path_prefix: list[str],
        fetch_columns: bool,
    ) -> list[dict[str, Any]]:
        """List tables in a single database (control command runs in-context)."""
        old_db = self.kusto_database
        self.kusto_database = db_name
        try:
            tables_df = self.query(".show tables details")
        finally:
            self.kusto_database = old_db

        # One bulk schema query for the whole database, rather than a
        # `.show table schema` per table (which explodes into thousands of
        # control commands on large clusters).
        columns_by_table = self._fetch_db_columns_bulk(db_name) if fetch_columns else {}

        tables = []
        for rec in tables_df.to_dict(orient="records"):
            table_name = rec['TableName']

            if table_filter and table_filter.lower() not in table_name.lower():
                continue

            columns = columns_by_table.get(table_name, [])

            metadata: dict[str, Any] = {"columns": columns}
            # Qualify the identifier with the database when enumerating the
            # whole cluster (path_prefix holds the db) so the catalog key
            # carries the database and fetch/preview can target it.
            qualified = ".".join(path_prefix + [table_name])
            metadata["_source_name"] = qualified
            doc_string = rec.get("DocString")
            if doc_string and str(doc_string).strip():
                metadata["description"] = str(doc_string).strip()
            # `.show tables details` already carries size stats for every
            # table — surface them for free (no extra round-trip) so the UI
            # and load logic can decide up front whether a table is too big to
            # import directly.
            row_count = _coerce_int(rec.get("TotalRowCount"))
            if row_count is not None:
                metadata["row_count"] = row_count
            original_size = _coerce_int(rec.get("TotalOriginalSize"))
            if original_size is not None:
                metadata["original_size_bytes"] = original_size

            tables.append({
                "name": qualified,
                "path": path_prefix + [table_name],
                "metadata": metadata,
            })

        return tables

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "kusto_database", "label": "Database"},
            {"key": "table", "label": "Table"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "kusto_database":
            # List databases on the cluster
            db_df = self.query(".show databases")
            nodes = []
            for rec in db_df.to_dict(orient="records"):
                name = rec["DatabaseName"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="namespace", path=path + [name]))
            return nodes

        if level_key == "table":
            pinned = self.pinned_scope()
            db = pinned.get("kusto_database") or (path[0] if path else None)
            if not db:
                return []
            # Query tables in the specific database
            old_db = self.kusto_database
            self.kusto_database = db
            try:
                tables_df = self.query(".show tables")
            finally:
                self.kusto_database = old_db
            nodes = []
            for rec in tables_df.to_dict(orient="records"):
                name = rec["TableName"]
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
        db = pinned.get("kusto_database")
        if not db:
            if not remaining:
                return {}
            db = remaining.pop(0)
        if not remaining:
            return {}
        table_name = remaining[0]
        old_db = self.kusto_database
        self.kusto_database = db
        try:
            schema_result = self.query(f".show table ['{table_name}'] schema as json").to_dict(orient="records")
            columns = [
                {"name": r["Name"], "type": r["Type"]}
                for r in json.loads(schema_result[0]["Schema"])["OrderedColumns"]
            ]
            details = self.query(f".show table ['{table_name}'] details").to_dict(orient="records")
            row_count = int(details[0]["TotalRowCount"])
            sample_df = self.query(f"['{table_name}'] | take 5")
            sample_rows = df_to_safe_records(sample_df)
            result: dict[str, Any] = {"row_count": row_count, "columns": columns, "sample_rows": sample_rows}
            original_size = _coerce_int(details[0].get("TotalOriginalSize"))
            if original_size is not None:
                result["original_size_bytes"] = original_size
            doc_string = details[0].get("DocString")
            if doc_string and str(doc_string).strip():
                result["description"] = str(doc_string).strip()
            return result
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}
        finally:
            self.kusto_database = old_db

    def test_connection(self) -> bool:
        try:
            self.query(".show databases | take 1")
            return True
        except Exception:
            return False