**Example**

Workspace `Sales Analytics` (name or workspace ID from the Power BI URL `.../groups/<id>/...`)

**Credentials**

- **Azure default identity** (recommended): run `az login` with an account that
  can open the models. Your own permissions and row-level security apply.
- **Service principal**: client ID, secret, and tenant ID of an Entra app added
  to the workspace. Service principals cannot query models with row-level
  security or SSO.

**Check**

- The account needs **Read** and **Build** permission on each semantic model.
- A Power BI admin must enable the tenant setting *Dataset Execute Queries REST
  API* (and *Allow service principals to use Power BI APIs* for service principals).
- Models hosted in Azure Analysis Services are not supported.
- Limits: 120 queries per minute per user; results are capped at 10,000 rows.
