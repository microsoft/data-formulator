**Example**

workspace: `Sales Analytics`

**Workspace**

Enter the workspace name, or the ID from its URL (`.../groups/<id>/...`).

**Sign in**

- **Azure default identity:** recommended. Run `az login` with an account that can open the models; your permissions and row-level security apply.
- **Service principal:** the client ID, secret, and tenant ID of an Entra app added to the workspace. It can't query models that use row-level security or SSO.

**Access**

You need **Read** and **Build** on each semantic model. A Power BI admin must enable *Dataset Execute Queries REST API*, plus *Allow service principals to use Power BI APIs* for service principals.

**Limits**

120 queries per minute per user, and up to 10,000 rows per result. Models in Azure Analysis Services aren't supported.
