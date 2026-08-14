**Example**

Azure SQL: `myserver.database.windows.net`, database `mydb`

Local SQL Server: `localhost:1433`, database `mydb`

**Sign in**

- **Microsoft Entra ID:** Recommended for Azure SQL. Run [`az login`](https://learn.microsoft.com/cli/azure/authenticate-azure-cli-interactively), choose Microsoft Entra ID, and leave username and password empty. See the [Azure SQL Microsoft Entra overview](https://learn.microsoft.com/azure/azure-sql/database/authentication-aad-overview) for server setup.
- **SQL Server authentication:** Enter a SQL Server username and password.
- **Windows authentication:** Available on Windows; leave username and password empty.

**Access**

Your database administrator must grant the selected identity permission to connect and read the required tables.

**Check**

For Entra ID, run `az account show`. For SQL authentication, test with:

```bash
sqlcmd -S <server> -d <database> -U <user> -P <password>
```

If a local server cannot connect, confirm that SQL Server is running and TCP/IP is enabled.
