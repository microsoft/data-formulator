**Example**

`postgres` at `localhost:5432`, database `mydb`

**Credentials**

Use a PostgreSQL account with `SELECT` access to the tables you need. For a local server, the password may be blank. For a remote server, ask the database administrator for the host, port, username, and password.

**Scope**

Leave `database` empty to browse all accessible databases, or enter one to open its schemas and tables directly.

**Check**

Confirm that PostgreSQL is running, then test the same details with:

```bash
psql -U <user> -h <host> -p <port> -d <database>
```
