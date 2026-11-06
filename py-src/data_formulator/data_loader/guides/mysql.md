**Example**

host: `localhost` · port: `3306` · user: `root` · database: `mydb`

**Credentials**

Use an account that can read the tables you need. A local server may have no password. For a remote server, get the details from your database administrator and make sure your IP is allowed to connect.

**Scope**

Leave `database` empty to browse every database, or enter one to open its tables directly.

**Check**

Test the same details with `mysql -u <user> -p -h <host> -P <port>`.
