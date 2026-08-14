**Connection**

Enter the Azure Data Explorer cluster URL and database. You can select the public help cluster for a no-setup example.

**Sign in**

- **Microsoft sign-in:** Recommended when available; sign in as yourself.
- **Azure default identity:** Uses [`az login`](https://learn.microsoft.com/cli/azure/authenticate-azure-cli-interactively) locally or a [managed identity](https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview) in Azure.
- **Service principal:** Enter the client ID, client secret, and tenant ID.

**Access**

The selected identity must already have viewer access to the database. Authentication alone does not grant data access.

**Check**

For Azure CLI authentication, run `az account show` to verify the active account and tenant. See [Azure Data Explorer authentication methods](https://learn.microsoft.com/kusto/api/get-started/app-authentication-methods) for other environments.
