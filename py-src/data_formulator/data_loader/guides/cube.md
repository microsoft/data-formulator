**Example**

API URL `http://localhost:4000` (the default `/cubejs-api` base path is added when the URL has no path)

**Credentials**

Enter a Cube API token: a JWT signed with the deployment's `CUBEJS_API_SECRET`. The token's security context controls which rows and members you can query, so use a token scoped to your own access. Leave it empty for a local server running with `CUBEJS_DEV_MODE=true`.

**Check**

Use the REST API URL, not the Playground page. Only public cubes and views are listed.
