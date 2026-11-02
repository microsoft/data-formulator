**Example**

api_url: `http://localhost:4000`

**Credentials**

Enter an API token: a JWT signed with the deployment's `CUBEJS_API_SECRET`. Its security context decides which data you can query. A local server in dev mode (`CUBEJS_DEV_MODE=true`) needs no token.

**Check**

Use the REST API URL, not the Playground page; `/cubejs-api` is added when the URL has no path. Only public cubes and views are listed.
