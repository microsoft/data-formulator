**Connection**

Use your Snowflake account identifier (for example `myorg-myaccount`) together with a warehouse that can run queries. Do not include the `snowflakecomputing.com` suffix in the account field.

**Credentials**

Enter a Snowflake username and password. The user must be allowed to use the selected warehouse and read the databases, schemas, tables, or views you want to import.

**Access**

A typical read-only role needs `USAGE` on the warehouse, database, and schema plus `SELECT` on the required tables or views. If your organization requires MFA or SSO-only authentication, use a Snowflake user that permits password-based connector access for this initial connector version.

**Scope**

Leave `database` and `schema` empty to browse accessible databases. Enter a database to start at its schemas, or enter both database and schema to open its tables directly. You can optionally specify a role.
