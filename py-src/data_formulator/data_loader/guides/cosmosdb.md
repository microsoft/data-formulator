**Example**

Endpoint `https://myaccount.documents.azure.com:443/`, database `mydb`

**Credentials**

In Azure Portal, open the Cosmos DB account's **Keys** page and copy the endpoint and a read-capable key.

For the local emulator, use `https://localhost:8081` and the emulator key.

**Scope**

Leave `container` empty to browse all containers in the database.

**Check**

If the connection is rejected, confirm that the account firewall allows your IP or connect from an allowed network.
