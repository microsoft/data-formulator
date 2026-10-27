**Example**

host: `localhost` · port: `5432` · user: `postgres` · database: `mydb`

**Credentials**

Use an account with `SELECT` access to the tables you need. A local server may have no password. For a remote server, get the details from your database administrator.

**Scope**

Leave `database` empty to browse every database, or enter one to open its schemas directly.

**Check**

Test the same details with `psql -U <user> -h <host> -p <port> -d <database>`.
