**Example**

host: `localhost` · port: `27017` · database: `mydb`

**Sign in**

Choose **No authentication** for a local server without access control. Otherwise, enter a user that can read the database, and set `authSource` only if that user is defined in another database (often `admin`).

**Scope**

Leave `collection` empty to browse every collection in the database.

**Check**

Test the server with `mongosh --host <host> --port <port>`.
