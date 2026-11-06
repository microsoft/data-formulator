**Example**

endpoint: `https://myaccount.documents.azure.com:443/` · database: `mydb`

**Credentials**

Copy the endpoint and a read-only key from the account's **Keys** page in the Azure portal. For the local emulator, use `https://localhost:8081` and the emulator key.

**Scope**

Leave `container` empty to browse every container in the database.

**Check**

If the connection is refused, make sure the account firewall allows your IP.
