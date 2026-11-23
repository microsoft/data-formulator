**Example**

environment_url: `https://contoso.crm.dynamics.com`

**Environment URL**

In Power Apps, open **Settings** (gear) > **Session details** and copy the *Instance url*. The Web API endpoint from **Developer resources** works too.

**Sign in**

- **Sign in with Microsoft (browser):** when Data Formulator runs on your machine. It opens your browser once to sign in, so you can use a different account than the Azure CLI. Fill in *login_hint* to pick the account. Later connections reuse the sign-in without opening the browser.
- **Sign in with Microsoft:** shown when the server has a Dataverse sign-in app (`DATAVERSE_OAUTH_CLIENT_ID`). Your own security roles apply.
- **Azure default identity:** run `az login` with an account that is a user in the environment. If the environment is in another tenant (for example, you were added as a guest), run `az login --tenant <tenant-id> --allow-no-subscriptions`.
- **Service principal:** the client ID, secret, and tenant ID of an Entra app that was added to the environment as an application user with a security role.

**Access**

Your security role needs read access to the tables you load.

**Data**

Lookup and choice columns also load a `<column>name` column with the display label. Lookups hold the related row's id, so you can join, for example, `opportunity.parentaccountid` to `account.accountid`.
