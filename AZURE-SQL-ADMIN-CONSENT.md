# Azure SQL Admin Consent Instructions

## Purpose

Data Formulator's Azure SQL connector is deployed and reaches Microsoft Entra
successfully. Microsoft Entra currently blocks user sign-in with **Need admin
approval** because tenant policy does not allow users to consent to this new
application.

An administrator must grant tenant-wide consent once. No source change or new
deployment is required after approval.

## Application Details

| Setting | Value |
| --- | --- |
| Application | Data Formulator GCX DEV |
| Application client ID | `7cced1c1-4eb6-4adb-a149-9874baab45b0` |
| Tenant ID | `72f988bf-86f1-41af-91ab-2d7cd011db47` |
| API | Azure SQL Database |
| Delegated permission | `user_impersonation` |
| Permission display name | Access Azure SQL DB and Data Warehouse |
| Production callback | `https://data.gcxteam.com/api/auth/azure-sql/callback` |

The application requests only delegated Azure SQL access. It does not request
Microsoft Graph permissions or application-level SQL access. Data access remains
limited to the permissions of the signed-in user inside the target database.

## Required Administrator Role

Use an account with one of these Microsoft Entra roles:

- Cloud Application Administrator
- Application Administrator

A Global Administrator can also approve the request, but that broader role is
not required.

## Option 1: Entra Admin Center

1. Sign in to [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Open **Entra ID**.
3. Go to **App registrations** > **All applications**.
4. Search for **Data Formulator GCX DEV**.
5. Open the application and select **API permissions**.
6. Confirm the only requested permission is:
   **Azure SQL Database > Delegated permissions > user_impersonation**.
7. Select **Grant admin consent for Microsoft**.
8. Review the prompt and approve it.
9. Confirm the permission row shows **Granted for Microsoft**.

## Option 2: Direct Admin-Consent Link

Open this link while signed in with an eligible administrator account:

[Grant Azure SQL admin consent](https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0/adminconsent?client_id=7cced1c1-4eb6-4adb-a149-9874baab45b0&scope=https%3A%2F%2Fdatabase.windows.net%2F.default&redirect_uri=https%3A%2F%2Fdata.gcxteam.com%2Fapi%2Fauth%2Fazure-sql%2Fcallback)

Review the requested Azure SQL permission and select **Accept**. The callback
page may close or show an authentication failure because this approval request
is not an ordinary connector login. That does not indicate consent failed; use
the verification steps below.

## Verify The Grant

### Entra Admin Center

Return to **App registrations** > **Data Formulator GCX DEV** >
**API permissions** and confirm that Azure SQL `user_impersonation` shows
**Granted for Microsoft**.

### Azure CLI

Run this PowerShell from an Azure CLI session signed into the Microsoft tenant:

```powershell
$appId = "7cced1c1-4eb6-4adb-a149-9874baab45b0"
$appSp = az ad sp list --filter "appId eq '$appId'" -o json | ConvertFrom-Json
$grants = az rest `
  --method GET `
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/$($appSp[0].id)/oauth2PermissionGrants" `
  -o json | ConvertFrom-Json

$azureSqlGrant = @($grants.value | Where-Object {
  $_.consentType -eq "AllPrincipals" -and
  $_.scope.Split(" ") -contains "user_impersonation"
})

[pscustomobject]@{
  AzureSqlAdminConsentGranted = $azureSqlGrant.Count -gt 0
  ConsentType = ($azureSqlGrant.consentType -join ",")
  Scope = ($azureSqlGrant.scope -join ",")
}
```

Expected result:

```text
AzureSqlAdminConsentGranted : True
ConsentType                 : AllPrincipals
Scope                       : user_impersonation
```

## Complete The Production Test

After consent is granted:

1. Open [Data Formulator](https://data.gcxteam.com/).
2. Select **Load Data** > **Connect databases**.
3. Select **Azure SQL (Microsoft Entra)**.
4. Enter server `cpestaging.database.windows.net`.
5. Enter database `CPE_Predictor`.
6. Select **Sign in with Microsoft Entra**.
7. Complete Microsoft sign-in and MFA when prompted.
8. Confirm the connector reaches the catalog and lists accessible tables.

## Expected Security Behavior

- MFA is enforced by Microsoft Entra Conditional Access, not by Data Formulator.
- Data Formulator never asks the user to enter or paste an access token.
- The browser receives only a success/failure message, not the SQL access token.
- The token remains server-side and is isolated by connector instance and Azure
  SQL audience.
- Production uses secretless managed-identity federation; the application has
  no client secret.
- SQL access is limited to the signed-in user's contained database user or group
  permissions.

## Troubleshooting

- **Need admin approval remains:** Confirm consent was granted for client ID
  `7cced1c1-4eb6-4adb-a149-9874baab45b0`, not another Data Formulator app.
- **AADSTS65001 / consent required:** The tenant-wide grant is missing or was
  granted for a different permission.
- **Login succeeds but SQL denies access:** Confirm the user or one of their
  Microsoft Entra groups exists in `CPE_Predictor` and has the required SQL
  permissions.
- **Redirect URI mismatch:** Confirm the registered callback is exactly
  `https://data.gcxteam.com/api/auth/azure-sql/callback`.
- **MFA is not requested:** Conditional Access determines whether MFA is needed;
  successful sign-in without a new prompt can be valid when an existing MFA
  claim or session satisfies policy.

## Completion Evidence

Record these items after approval and testing:

- Date and approving administrator role, without recording personal credentials
- Confirmation that `user_impersonation` shows **Granted for Microsoft**
- Successful Microsoft sign-in/MFA result
- Successful connection to `CPE_Predictor`
- Number of catalog entries returned
- Production revision tested: `ca-dataformulator--0000009`
- Production image tested: `azure-sql-20260710-1049`
