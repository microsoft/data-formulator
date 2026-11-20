**Example**

account: `myorg-myaccount` · warehouse: `COMPUTE_WH` · user: `ANALYST`

**Connection**

In Snowsight, open your user menu and choose **Connect a tool to Snowflake** to copy the account identifier (`<org>-<account>`, without `.snowflakecomputing.com`). Use a warehouse your role can run queries on.

**Credentials**

Snowflake blocks single-factor password sign-ins, so enter a programmatic access token (PAT) in the password field. Create one under **Settings → Authentication → Programmatic access tokens**. Your administrator may need to allow your network before a PAT can sign in.

**Access**

The role needs `USAGE` on the warehouse, database, and schema, and `SELECT` on the tables or views you want to read. Set `role` to use a role other than your default.

**Scope**

Leave `database` and `schema` empty to browse every database, enter a database to open its schemas, or enter both to open one schema directly.
