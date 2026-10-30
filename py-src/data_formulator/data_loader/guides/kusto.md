**Example**

kusto_cluster: `https://help.kusto.windows.net` · kusto_database: `Samples`

**Sign in**

- **Microsoft sign-in:** sign in as yourself. Shown when the server is set up for it.
- **Azure default identity:** uses your [`az login`](https://learn.microsoft.com/cli/azure/authenticate-azure-cli-interactively) session locally, or a [managed identity](https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview) in Azure. Once signed in, you can pick the subscription, cluster, and database from lists.
- **Service principal:** enter the app's `client_id`, `client_secret`, and `tenant_id`.

**Access**

The identity needs at least viewer access to the database; signing in alone doesn't grant it.

**Check**

`az account show` shows the active account and tenant.
