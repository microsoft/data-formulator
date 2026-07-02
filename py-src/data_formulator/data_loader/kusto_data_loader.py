import json
import logging
from typing import Any
import pandas as pd
import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS, sanitize_table_name
from data_formulator.datalake.parquet_utils import df_to_safe_records

from azure.kusto.data import KustoClient, KustoConnectionStringBuilder
from azure.kusto.data.helpers import dataframe_from_result_table

logger = logging.getLogger(__name__)

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
        return """**Option 1 — Sign in with Microsoft (recommended):** If the app is configured with Microsoft (Entra) sign-in, just sign in and connect — DF exchanges your login for cluster access automatically (no fields needed).

**Option 2 — Azure Default Identity:** Leave auth fields empty. DF will automatically use your Azure CLI login (`az login`), Managed Identity, VS Code credentials, or environment variables — whichever is available.

**Option 3 — Service Principal:** Provide `client_id`, `client_secret`, and `tenant_id` for a service principal with cluster access."""

    @staticmethod
    def auth_config() -> dict[str, Any]:
        """Declare that Kusto can use the app-level Microsoft SSO token.

        Mode ``sso_exchange`` (without an ``exchange_url``) signals the
        framework to inject the user's DF SSO access token as
        ``sso_access_token``. The loader then performs the Microsoft Entra
        On-Behalf-Of (OBO) exchange in-process (see :meth:`_build_kcsb`),
        because the target Kusto scope is cluster-specific and cannot be
        expressed by a generic exchange endpoint.

        Service-principal / Azure Default Identity remain available as
        fallbacks when no SSO token is present.
        """
        return {
            "mode": "sso_exchange",
            "display_name": "Kusto",
            "supports_refresh": True,
        }

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.kusto_cluster = params.get("kusto_cluster", None)
        self.kusto_database = params.get("kusto_database", None)

        self.client_id = params.get("client_id", None)
        self.client_secret = params.get("client_secret", None)
        self.tenant_id = params.get("tenant_id", None)

        # Delegated-token inputs (populated by the auth framework):
        #   access_token     — a Kusto-audience token (e.g. from a popup login)
        #   sso_access_token — the app-level DF SSO token, exchanged via OBO
        self.access_token = params.get("access_token", None)
        self.sso_access_token = params.get("sso_access_token", None)

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

    @staticmethod
    def _resolve_obo_tenant_id(explicit: str | None) -> str | None:
        """Resolve the tenant used for the OBO exchange.

        Priority: explicit param → ``AZURE_OBO_TENANT_ID`` env → tenant
        segment parsed from ``OIDC_ISSUER_URL``.
        """
        import os
        import re

        if explicit:
            return explicit
        env_tenant = os.environ.get("AZURE_OBO_TENANT_ID", "").strip()
        if env_tenant:
            return env_tenant
        issuer = os.environ.get("OIDC_ISSUER_URL", "").strip()
        # e.g. https://login.microsoftonline.com/<tenant>/v2.0
        match = re.search(
            r"login\.microsoftonline\.com/([^/]+)", issuer
        )
        if match:
            return match.group(1)
        return None

    @staticmethod
    def discover_clusters(sso_access_token: str) -> list[dict[str, Any]]:
        """Discover Kusto clusters visible to the signed-in user via Azure
        Resource Manager (ARM).

        Uses the On-Behalf-Of flow to obtain an ARM-scoped token, lists the
        user's subscriptions, then enumerates ``Microsoft.Kusto/clusters`` in
        each. Each returned entry includes the cluster query ``uri``.

        Note: ARM lists clusters the user can *see* (control-plane RBAC). It
        does NOT guarantee data-plane query access, and clusters granted only
        at the Kusto data plane will not appear here. Treat the result as a
        best-effort discovery aid, validated on connect.
        """
        import os
        import requests

        client_id = os.environ.get("OIDC_CLIENT_ID", "").strip()
        client_secret = os.environ.get("OIDC_CLIENT_SECRET", "").strip()
        tenant_id = KustoDataLoader._resolve_obo_tenant_id(None)
        if not (client_id and client_secret and tenant_id):
            raise RuntimeError(
                "Microsoft SSO is not configured for cluster discovery "
                "(OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / tenant missing).")

        from azure.identity import OnBehalfOfCredential
        credential = OnBehalfOfCredential(
            tenant_id=tenant_id,
            client_id=client_id,
            client_secret=client_secret,
            user_assertion=sso_access_token,
        )
        arm_token = credential.get_token(
            "https://management.azure.com/.default").token
        headers = {"Authorization": f"Bearer {arm_token}"}

        subs_resp = requests.get(
            "https://management.azure.com/subscriptions?api-version=2022-12-01",
            headers=headers, timeout=30)
        subs_resp.raise_for_status()
        subscriptions = subs_resp.json().get("value", [])

        clusters: list[dict[str, Any]] = []
        seen: set[str] = set()
        for sub in subscriptions:
            sub_id = sub.get("subscriptionId")
            if not sub_id:
                continue
            url = (
                f"https://management.azure.com/subscriptions/{sub_id}"
                "/providers/Microsoft.Kusto/clusters?api-version=2023-08-15")
            try:
                resp = requests.get(url, headers=headers, timeout=30)
                if resp.status_code != 200:
                    continue
                for c in resp.json().get("value", []):
                    uri = (c.get("properties") or {}).get("uri")
                    if not uri or uri in seen:
                        continue
                    seen.add(uri)
                    clusters.append({
                        "name": c.get("name"),
                        "uri": uri,
                        "location": c.get("location"),
                        "subscription_id": sub_id,
                        "subscription_name": sub.get("displayName"),
                    })
            except Exception as exc:
                logger.debug("Cluster listing failed for subscription %s: %s",
                             sub_id, exc)
                continue

        clusters.sort(key=lambda x: (x.get("name") or "").lower())
        return clusters

    def _build_kcsb(self) -> KustoConnectionStringBuilder:
        """Build the Kusto connection string builder using the best available
        credential, in priority order.

        1. Explicit Kusto-audience ``access_token`` (delegated user token)
        2. App-level SSO token → Microsoft Entra On-Behalf-Of exchange
        3. Service principal (``client_id`` / ``client_secret`` / ``tenant_id``)
        4. ``DefaultAzureCredential`` (``az login`` / Managed Identity / etc.)
        """
        import os

        # 1. Explicit Kusto user token (already scoped for the cluster).
        if self.access_token:
            logger.info("Using delegated user token for Kusto client.")
            return KustoConnectionStringBuilder.with_aad_user_token_authentication(
                self.kusto_cluster, self.access_token)

        # 2. App-level Microsoft SSO token → OBO exchange for a Kusto token.
        if self.sso_access_token:
            client_id = os.environ.get("OIDC_CLIENT_ID", "").strip()
            client_secret = os.environ.get("OIDC_CLIENT_SECRET", "").strip()
            tenant_id = self._resolve_obo_tenant_id(self.tenant_id)
            if client_id and client_secret and tenant_id:
                from azure.identity import OnBehalfOfCredential
                credential = OnBehalfOfCredential(
                    tenant_id=tenant_id,
                    client_id=client_id,
                    client_secret=client_secret,
                    user_assertion=self.sso_access_token,
                )
                logger.info(
                    "Using On-Behalf-Of Microsoft SSO exchange for Kusto client.")
                return KustoConnectionStringBuilder.with_azure_token_credential(
                    self.kusto_cluster, credential)
            logger.warning(
                "SSO token present but OBO not configured "
                "(OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / tenant missing); "
                "falling back to other credentials.")

        # 3. Service principal.
        if self.client_id and self.client_secret and self.tenant_id:
            logger.info("Using service principal authentication for Kusto client.")
            return KustoConnectionStringBuilder.with_aad_application_key_authentication(
                self.kusto_cluster, self.client_id, self.client_secret, self.tenant_id)

        # 4. DefaultAzureCredential: az login, Managed Identity, VS Code, env vars, etc.
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

    def query(self, kql: str) -> pd.DataFrame:
        logger.info(f"Executing KQL query: {kql} on database {self.kusto_database}")
        result = self.client.execute(self.kusto_database, kql)
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
        
        base_query = f"['{source_table}']"
        
        # Add sort if specified (KQL syntax)
        sort_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "desc" if sort_order == 'desc' else "asc"
            sort_cols_with_order = [f"{col} {order_direction}" for col in sort_columns]
            sort_clause = f" | sort by {', '.join(sort_cols_with_order)}"
        
        # Add take limit
        kql_query = f"{base_query}{sort_clause} | take {size}"
        
        logger.info(f"Executing Kusto query: {kql_query[:200]}...")
        
        # Execute query
        df = self.query(kql_query)
        
        # Convert to Arrow
        arrow_table = pa.Table.from_pandas(df, preserve_index=False)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from Kusto")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from Kusto database.

        Uses `.show tables details` for lightweight metadata (name, schema,
        DocString). Does NOT run per-table sample queries.
        """
        tables_df = self.query(".show tables details")

        tables = []
        for rec in tables_df.to_dict(orient="records"):
            table_name = rec['TableName']

            if table_filter and table_filter.lower() not in table_name.lower():
                continue

            try:
                schema_result = self.query(
                    f".show table ['{table_name}'] schema as json"
                ).to_dict(orient="records")
                columns = [
                    {"name": r["Name"], "type": r["Type"]}
                    for r in json.loads(schema_result[0]["Schema"])["OrderedColumns"]
                ]
            except Exception:
                columns = []

            metadata: dict[str, Any] = {"columns": columns}
            doc_string = rec.get("DocString")
            if doc_string and str(doc_string).strip():
                metadata["description"] = str(doc_string).strip()

            tables.append({
                "name": table_name,
                "path": [table_name],
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