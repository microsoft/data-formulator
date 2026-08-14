**Connection**

- **ClickHouse Cloud:** Use the service hostname, port `8443`, and enable TLS.
- **Self-hosted:** The HTTP interface usually uses port `8123`. Enable TLS when the endpoint uses HTTPS.

**Credentials**

Use a ClickHouse account with read access to the required databases and tables. The `default` user may have a blank password on local installations.

**Scope**

Leave `database` empty to browse every accessible database, or enter one to open its tables directly.
