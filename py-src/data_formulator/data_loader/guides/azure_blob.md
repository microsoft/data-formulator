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

Supported formats: CSV, Parquet, JSON, and JSONL.
