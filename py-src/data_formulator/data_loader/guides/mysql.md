**Example**

`root` at `localhost:3306`, database `mydb`

**Credentials**

Use a MySQL account that can read the tables you need. For a local server, the password may be blank. For a remote server, ask the database administrator for the host, port, username, and password, and confirm that your IP can connect.

**Scope**

Leave `database` empty to browse all accessible databases, or enter one to open its tables directly.

**Check**

Confirm that MySQL is running, then test the same details with:

```bash
mysql -u <user> -p -h <host> -P <port> <database>
```