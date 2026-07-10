import json
import logging
import re
from typing import Any
import pandas as pd
import pyarrow as pa

# ISO-8601 date / datetime literal (optional time, fractional seconds and
# timezone). Values matching this are emitted as KQL ``datetime(...)`` literals
# so comparisons against ``datetime`` columns type-check.
_ISO_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$"
)

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS, sanitize_table_name
from data_formulator.data_loader import probe_utils

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
            {"name": "kusto_database", "type": "string", "required": True, "tier": "connection", "description": "Database name (required)"}, 
            {"name": "client_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"}, 
            {"name": "client_secret", "type": "string", "required": False, "sensitive": True, "tier": "auth", "description": "Service principal only"}, 
            {"name": "tenant_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"}
        ]
        return params_list

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        return [
            {
                "id": "ambient",
                "label": "Azure default identity",
                "description": "Use Azure CLI, managed identity, VS Code, or environment credentials.",
                "fields": [],
                "required_fields": [],
                "kind": "ambient",
                "default": True,
            },
            {
                "id": "service_principal",
                "label": "Service principal",
                "description": "Use an Entra application client ID, secret, and tenant ID.",
                "fields": ["client_id", "client_secret", "tenant_id"],
                "required_fields": ["client_id", "client_secret", "tenant_id"],
                "kind": "credentials",
            },
        ]

    @classmethod
    def infer_auth_path(cls, params: dict[str, Any]) -> str:
        if all(params.get(name) for name in ("client_id", "client_secret", "tenant_id")):
            return "service_principal"
        return "ambient"

    @staticmethod
    def auth_instructions() -> str:
        return """**Option 1 — Azure Default Identity (recommended):** Leave the auth fields empty. DF connects using the host's ambient Azure credentials — your Azure CLI login (`az login`) when running locally, or a Managed Identity when deployed to Azure. That identity must be granted access to the cluster.

**Option 2 — Service Principal:** Provide `client_id`, `client_secret`, and `tenant_id` for a service principal with cluster access."""

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.auth_path = params.get("_auth_path") or self.infer_auth_path(params)
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
        if self.auth_path == "service_principal":
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

    @staticmethod
    def _stringify_dynamic_columns(df: pd.DataFrame) -> pd.DataFrame:
        """Serialize Kusto ``dynamic`` (nested JSON) column values to strings.

        Dynamic columns arrive as Python ``dict``/``list`` objects. Left as-is
        they render as ``[object Object]`` in the UI, break value hashing/
        summary code (``unhashable type: 'dict'``), and convert unpredictably
        to Arrow/parquet. Serializing each dict/list value to a JSON string
        keeps the content readable and safe for downstream processing; nested
        fields can still be extracted later by the agent.
        """
        def _encode(value: Any) -> Any:
            if isinstance(value, (dict, list)):
                try:
                    return json.dumps(value, ensure_ascii=False, default=str)
                except (TypeError, ValueError):
                    return str(value)
            return value

        for col in df.columns:
            if df[col].dtype != "object":
                continue
            series = df[col]
            # Only pay for the map when the column actually holds structured
            # values (dynamic columns); pure-string columns are left untouched.
            if series.map(lambda v: isinstance(v, (dict, list))).any():
                df[col] = series.map(_encode)
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
        # Flatten dynamic (nested JSON) columns to strings so they display and
        # process cleanly instead of surfacing as [object Object]/unhashable dicts.
        df = self._stringify_dynamic_columns(df)
        
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
        source_filters = opts.get("source_filters")

        if not source_table:
            raise ValueError("source_table must be provided")

        # Cross-database catalog entries are "database.table"; resolve the
        # database so the query targets it rather than the (possibly unset)
        # connect-time default.
        db, table = self._resolve_source_table(source_table)
        segments: list[str] = [f"['{table}']"]

        # Push agent/user filters down to the engine FIRST so we scan a slice,
        # not the whole table. Without this, a filtered load plan silently
        # degrades to a full-table scan (+ sort) and can trip Kusto's
        # low-memory guard (E_LOW_MEMORY_CONDITION / "top_n consume source").
        # ``source_filters`` use the source-agnostic ``operator`` field, while
        # ``_compile_kql_where`` (shared with probe) expects ``op``.
        if source_filters:
            normalized = [
                {"column": sf.get("column"), "op": sf.get("operator"), "value": sf.get("value")}
                for sf in source_filters
                if isinstance(sf, dict)
            ]
            where_parts = self._compile_kql_where(normalized)
            if where_parts:
                segments.append("where " + " and ".join(where_parts))

        # Prefer ``top N by`` over ``sort by | take``: top-N is the
        # memory-efficient operator, whereas a full ``sort`` materializes and
        # orders the entire (filtered) set — the operation that surfaces
        # low-memory failures on large tables.
        if sort_columns and len(sort_columns) > 0:
            order_direction = "desc" if sort_order == 'desc' else "asc"
            order_expr = ", ".join(
                f"{self._kql_ident(col)} {order_direction}" for col in sort_columns
            )
            segments.append(f"top {size} by {order_expr}")
        else:
            segments.append(f"take {size}")

        kql_query = "\n| ".join(segments)

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

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        """Compile the SPJQ to KQL and run ``summarize`` on the cluster.

        Native pushdown: the filter/group/aggregate runs over the *whole* table
        on the Kusto engine (not a local sample), so the result is exact — this
        is how Kusto is meant to be queried.
        """
        if not path:
            return {"error": "probe requires a non-empty table path"}
        q = query or {}
        out_limit = probe_utils.clamp_probe_limit(q.get("limit"))
        db, table = self._resolve_source_table(
            ".".join(str(p) for p in path if p not in (None, ""))
        )
        try:
            kql = self._compile_probe_kql(table, q, out_limit)
        except ValueError as exc:
            return {"error": f"invalid probe query: {exc}"}

        old_db = self.kusto_database
        try:
            if db:
                self.kusto_database = db
            df = self.query(kql)
        except Exception as exc:
            logger.debug("probe kql failed: %s", kql, exc_info=True)
            return {"error": f"probe failed: {exc}"}
        finally:
            self.kusto_database = old_db

        arrow = pa.Table.from_pandas(df, preserve_index=False)
        return probe_utils.shape_probe_payload(arrow, out_limit, exact=True)

    # -- KQL probe compiler ------------------------------------------------

    @staticmethod
    def _kql_ident(name: Any) -> str:
        """Quote a column as a KQL bracketed identifier ``['name']``."""
        s = str(name)
        if "\x00" in s:
            raise ValueError(f"invalid identifier: {name!r}")
        s = s.replace("\\", "\\\\").replace("'", "\\'")
        return f"['{s}']"

    @staticmethod
    def _kql_lit(value: Any) -> str:
        """Render a scalar as a KQL literal (string double-quoted, escaped)."""
        if value is None:
            return "''"
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return str(value)
        s = str(value).replace("\\", "\\\\").replace('"', '\\"')
        return f'"{s}"'

    @staticmethod
    def _kql_cmp_lit(value: Any) -> str:
        """Render a literal for a comparison/range/set predicate.

        ISO-8601 date/datetime strings are emitted as KQL ``datetime(...)``
        literals — KQL rejects comparing a ``datetime`` column with a string
        (``SEM0064: Cannot compare values of types datetime and string``).
        Everything else falls back to the plain string/number literal.
        """
        if isinstance(value, str) and _ISO_DATETIME_RE.match(value.strip()):
            return f'datetime("{value.strip()}")'
        return KustoDataLoader._kql_lit(value)

    def _compile_probe_kql(
        self, table: str, query: dict[str, Any], out_limit: int,
    ) -> str:
        """Compile a probe SPJQ object into a KQL query pipeline.

        ``T | where … | summarize <aggs> by <keys> | order by … | take N``.
        Only bare columns and the fixed aggregate vocabulary are emitted.
        """
        ident = self._kql_ident
        columns = query.get("columns") or []
        group_by = query.get("group_by") or []
        aggregates = query.get("aggregates") or []
        order_by = query.get("order_by") or []
        filters = query.get("filters") or []

        segments: list[str] = [ident(table)]

        where_parts = self._compile_kql_where(filters)
        if where_parts:
            segments.append("where " + " and ".join(where_parts))

        if aggregates or group_by:
            agg_parts: list[str] = []
            for agg in aggregates:
                if not isinstance(agg, dict):
                    continue
                op = (agg.get("op") or "").lower().strip()
                col = agg.get("column")
                alias = agg.get("as") or (f"{op}_{col}" if col else op)
                if op == "count" and not col:
                    expr = "count()"
                elif op == "count":
                    expr = f"count({ident(col)})"
                elif op == "count_distinct":
                    if not col:
                        raise ValueError("count_distinct requires a column")
                    expr = f"dcount({ident(col)})"
                elif op in ("sum", "avg", "min", "max"):
                    if not col:
                        raise ValueError(f"aggregate {op} requires a column")
                    expr = f"{op}({ident(col)})"
                else:
                    raise ValueError(f"unsupported aggregate op: {op!r}")
                agg_parts.append(f"{ident(alias)}={expr}")
            summarize = "summarize"
            if agg_parts:
                summarize += " " + ", ".join(agg_parts)
            if group_by:
                summarize += " by " + ", ".join(ident(g) for g in group_by)
            segments.append(summarize)
        elif columns:
            segments.append("project " + ", ".join(ident(c) for c in columns))

        order_parts: list[str] = []
        for o in order_by:
            if not isinstance(o, dict):
                continue
            col = o.get("column")
            if not col:
                continue
            direction = "desc" if str(o.get("dir", "")).lower() == "desc" else "asc"
            order_parts.append(f"{ident(col)} {direction}")
        if order_parts:
            segments.append("order by " + ", ".join(order_parts))

        segments.append(f"take {int(out_limit)}")
        return "\n| ".join(segments)

    def _compile_kql_where(self, filters: list[dict[str, Any]]) -> list[str]:
        """Compile probe ``filters`` into a list of KQL ``where`` predicates."""
        ident, lit, cmp = self._kql_ident, self._kql_lit, self._kql_cmp_lit
        parts: list[str] = []
        for f in filters or []:
            if not isinstance(f, dict):
                continue
            col = f.get("column")
            op = (f.get("op") or "").upper().strip()
            if not col:
                continue
            qcol = ident(col)
            val = f.get("value")
            if op == "EQ":
                parts.append(f"{qcol} == {cmp(val)}")
            elif op == "NEQ":
                parts.append(f"{qcol} != {cmp(val)}")
            elif op == "GT":
                parts.append(f"{qcol} > {cmp(val)}")
            elif op == "GTE":
                parts.append(f"{qcol} >= {cmp(val)}")
            elif op == "LT":
                parts.append(f"{qcol} < {cmp(val)}")
            elif op == "LTE":
                parts.append(f"{qcol} <= {cmp(val)}")
            elif op in ("LIKE", "ILIKE"):
                parts.append(f"{qcol} contains {lit(val)}")
            elif op == "IN":
                vals = val if isinstance(val, (list, tuple)) else [val]
                if vals:
                    parts.append(f"{qcol} in ({', '.join(cmp(v) for v in vals)})")
            elif op == "NOT_IN":
                vals = val if isinstance(val, (list, tuple)) else [val]
                if vals:
                    parts.append(f"{qcol} !in ({', '.join(cmp(v) for v in vals)})")
            elif op == "IS_NULL":
                parts.append(f"isnull({qcol})")
            elif op == "IS_NOT_NULL":
                parts.append(f"isnotnull({qcol})")
            elif op == "BETWEEN":
                if isinstance(val, (list, tuple)) and len(val) == 2:
                    parts.append(f"{qcol} between ({cmp(val[0])} .. {cmp(val[1])})")
        return parts

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

    @classmethod
    def discover_param_options(
        cls,
        param_name: str,
        params: dict[str, Any],
    ) -> list[str]:
        """List accessible databases only when explicitly requested."""
        if param_name != "kusto_database":
            return []
        if not str(params.get("kusto_cluster") or "").strip():
            raise ValueError("kusto_cluster is required to load databases")
        loader = cls(params)
        result = loader.client.execute(None, ".show databases")
        df = dataframe_from_result_table(result.primary_results[0])
        if "DatabaseName" not in df.columns:
            return []
        return sorted({
            str(name).strip()
            for name in df["DatabaseName"].dropna().tolist()
            if str(name).strip()
        }, key=str.casefold)

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from the configured Kusto database.

        Uses `.show tables details` for lightweight metadata (name, DocString).
        A bulk `.show database schema as json` also fetches every table's
        columns in one control command.
        """
        if not self.kusto_database:
            raise ValueError("kusto_database is required")
        return self._list_tables_in_db(
            self.kusto_database, table_filter,
            path_prefix=[], fetch_columns=True)

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
        """Live *structural* metadata for one table (columns only).

        Intentionally lean. Row counts and byte sizes are **not** fetched here:
        ``.show table ['T'] details`` runs an extent-stat aggregation that is
        slow on large tables, and those stats — along with the table
        description — are already collected in bulk at sync time
        (``list_tables`` → ``.show tables details``) and live in the catalog
        cache. Sample rows are likewise not fetched here; callers that need
        data use the preview/probe paths on demand.

        This method exists mainly as the *gap-filler* for cluster-wide browse,
        where per-database schema is skipped for performance, so a table node
        may reach the UI/agent without ``columns``. One cheap schema control
        command fills that gap.
        """
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
            return {"columns": columns}
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}
        finally:
            self.kusto_database = old_db

    def test_connection(self) -> bool:
        """Verify live cluster access without invoking result conversion.

        Connection testing must not use :meth:`query`: that method converts
        the response to pandas and normalizes its columns, so a local result
        conversion failure could incorrectly mark a successful Kusto request
        as a failed connection. Catalog information may also exist in the disk
        cache and is not evidence that this live probe succeeded.
        """
        try:
            self.client.execute(self.kusto_database, ".show tables")
            return True
        except Exception as exc:
            logger.warning(
                "Kusto connection probe failed for cluster %s (database %s): %s",
                self.kusto_cluster,
                self.kusto_database,
                exc,
                exc_info=True,
            )
            return False