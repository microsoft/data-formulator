**Example**

server: `myserver.database.windows.net` · database: `mydb`

**Sign in**

- **Microsoft Entra ID:** recommended for Azure SQL. Run [`az login`](https://learn.microsoft.com/cli/azure/authenticate-azure-cli-interactively) and leave user and password empty.
- **SQL Server authentication:** enter a SQL login and password.
- **Windows authentication:** Windows only; uses your Windows account.

**Access**

An administrator must grant your identity access to the database. For Entra ID, for example: `CREATE USER [you@contoso.com] FROM EXTERNAL PROVIDER;`

**Check**

`az account show` shows the account Entra ID will use. For a local server, make sure SQL Server is running with TCP/IP enabled.
