**Example**

Storage account `mystorageacct`, container `mydata`

**Sign in**

Choose one method:

- **Azure identity:** Enter the account and container. Run [`az login`](https://learn.microsoft.com/cli/azure/authenticate-azure-cli-interactively) locally, or use a [managed identity](https://learn.microsoft.com/azure/storage/blobs/authorize-managed-identity) in Azure.
- **SAS token:** Enter the account, container, and a time-limited SAS token.
- **Connection string:** Paste the connection string from **Azure Portal → Storage account → Access keys**.
- **Account key:** Enter the account key from the same Access keys page.

**Access**

Azure identity requires the [Storage Blob Data Reader role](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles/storage#storage-blob-data-reader). A SAS token must allow listing and reading blobs in the container.

**Files**

Supported formats: CSV, TSV, Parquet, JSON, and JSONL.

Parquet queries use DuckDB's native Azure reader to select columns and skip
irrelevant row groups when the file statistics permit it. Results are returned
as Arrow tables for workspace import; unfiltered full imports still read all
requested data. CSV, TSV, JSON, and JSONL also use native DuckDB readers, with
filters, sorting, and column selection applied before the result limit.
Text schemas are inferred by DuckDB and can differ from previous Arrow types.
Schema detection and buffering can read well beyond the requested preview;
text files do not offer Parquet's row-group pruning. Aggregates may scan the
whole source. Preview totals remain unknown unless independently available.

Metadata inspection reads only the Parquet footer for schema and exact row
count. Text inspection reuses a bounded sample for inferred schema and examples,
without a count scan. UI previews return up to 50 rows and 20 columns; agent
inspection uses up to five rows with shorter values. Omitted columns, shortened
values, and inferred schemas are reported explicitly. Preview inference uses
2,048 CSV/TSV rows or 256 JSON records; this is not a byte or time budget.

DuckDB automatically installs its official `azure` extension on first use.
Offline deployments must preinstall the extension for their DuckDB version and
platform in the runtime user's extension directory (`INSTALL azure` from DuckDB).
Connector credentials remain in temporary, connection-local secrets, not
persistent DuckDB secrets.

For Azure identity, Python's Azure Identity SDK obtains one Storage access token
per query using the configured `credential_chain` order. Supported providers are
`cli`, `managed_identity`, `env`, `workload_identity`, and `default`. Unavailable
providers fall through to the next provider; authentication failures stop the
chain. CLI uses the cloud configured in Azure CLI; environment/workload credentials
use their Azure Identity SDK authority configuration, including `AZURE_AUTHORITY_HOST`.
The token is passed as a parameter to a container-scoped temporary DuckDB secret
and is not cached on the loader or shared across queries. Key, SAS, and connection
string authentication are unchanged.

Tokens must have more than five minutes of validity remaining when a query starts.
DuckDB cannot renew an injected token mid-query. A read that outlasts the token
can fail authentication and must be retried with a new query; it is not silently
restarted. This optimization does not change SDK catalog or PyArrow footer reads.
