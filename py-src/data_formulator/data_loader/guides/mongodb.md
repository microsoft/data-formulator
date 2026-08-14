**Example**

`localhost:27017`, database `mydb`, collection `users`

**Credentials**

Leave username and password empty when authentication is disabled. For a managed or remote MongoDB server, use credentials that can read the target database.

Set `authSource` only when the user is authenticated by a database other than the target database.

**Scope**

Leave `collection` empty to browse all collections in the database.

**Check**

Confirm that MongoDB is running, then test the server with:

```bash
mongosh --host <host> --port <port>
```
