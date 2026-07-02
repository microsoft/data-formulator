#!/usr/bin/env bash
#
# setup_df_app_registration.sh
# -----------------------------------------------------------------------------
# Creates (or updates) the Microsoft Entra ID (Azure AD) app registration that
# Data Formulator uses for:
#
#   1. App-level "Sign in with Microsoft" (OIDC backend / confidential client).
#   2. On-Behalf-Of (OBO) access to Azure Data Explorer / Kusto, so a signed-in
#      user can connect to Kusto with no manually entered credentials.
#
# What this script configures on the app registration:
#   * Single-tenant sign-in audience (AzureADMyOrg).
#   * Web redirect URIs: <host>/auth/callback  (for each host you pass in).
#   * An exposed API scope  api://<app-id>/access_as_user  — REQUIRED so the
#     SSO access token DF receives is addressed to DF's own API (OBO needs an
#     audience == DF app; otherwise the OBO exchange for Kusto fails).
#   * A DELEGATED permission "user_impersonation" on the Azure Data Explorer
#     API — this is the permission that must be APPROVED by a tenant admin.
#   * A DELEGATED permission "user_impersonation" on the Azure Service
#     Management (ARM) API — lets a signed-in user DISCOVER which Kusto
#     clusters they can see across their subscriptions (control-plane only,
#     no data access). Optional; also requires admin approval.
#   * A client secret (printed once).
#
# Admin consent for the Azure Data Explorer "user_impersonation" permission
# typically requires a Global Admin / Privileged Role Admin. If this script is
# run without those rights, it will still create everything and then print the
# exact admin-consent URL you can forward to your administrator for APPROVAL.
#
# Prerequisites: Azure CLI (`az`) logged in (`az login`) to the target tenant.
#
# Usage:
#   ./scripts/setup_df_app_registration.sh \
#       --name "Data Formulator" \
#       --hosts "https://dataformulator.example.com,http://localhost:5000" \
#       [--tenant <tenant-id>]
#
# Environment variable equivalents: DF_APP_NAME, DF_HOSTS, DF_TENANT_ID.
# -----------------------------------------------------------------------------

set -euo pipefail

# --- Well-known Azure Data Explorer (Kusto) API application id ----------------
# Resolved dynamically below; this is only the default lookup key.
ADX_APP_ID_DEFAULT="2746ea77-4702-4b45-80ca-3c97e680e8b7"

APP_NAME="${DF_APP_NAME:-Data Formulator}"
HOSTS="${DF_HOSTS:-}"
TENANT_ID="${DF_TENANT_ID:-}"

# --- Parse args ---------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --name)   APP_NAME="$2"; shift 2 ;;
        --hosts)  HOSTS="$2"; shift 2 ;;
        --tenant) TENANT_ID="$2"; shift 2 ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

# --- Pre-flight ---------------------------------------------------------------
command -v az >/dev/null 2>&1 || { echo "ERROR: Azure CLI (az) not found. Install it and run 'az login'." >&2; exit 1; }
az account show >/dev/null 2>&1 || { echo "ERROR: Not logged in. Run 'az login' first." >&2; exit 1; }

if [[ -z "$HOSTS" ]]; then
    echo "ERROR: No hosts provided. Use --hosts \"https://your-df-host,http://localhost:5000\"." >&2
    exit 1
fi

if [[ -n "$TENANT_ID" ]]; then
    CURRENT_TENANT=$(az account show --query tenantId -o tsv)
    if [[ "$CURRENT_TENANT" != "$TENANT_ID" ]]; then
        echo "ERROR: Logged into tenant $CURRENT_TENANT but --tenant is $TENANT_ID." >&2
        echo "       Run: az login --tenant $TENANT_ID" >&2
        exit 1
    fi
fi
TENANT_ID=$(az account show --query tenantId -o tsv)

gen_uuid() {
    if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z';
    else python3 -c "import uuid;print(uuid.uuid4())"; fi
}

# --- Build redirect URIs ------------------------------------------------------
IFS=',' read -ra HOST_ARR <<< "$HOSTS"
REDIRECT_URIS=()
for h in "${HOST_ARR[@]}"; do
    h="$(echo "$h" | xargs)"          # trim whitespace
    h="${h%/}"                         # strip trailing slash
    [[ -z "$h" ]] && continue
    REDIRECT_URIS+=("$h/auth/callback")
done
echo "==> Redirect URIs:"
printf '      %s\n' "${REDIRECT_URIS[@]}"

# --- Create or reuse the app registration ------------------------------------
echo "==> Looking up existing app registration named '$APP_NAME'..."
APP_ID=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv 2>/dev/null || true)

if [[ -z "$APP_ID" || "$APP_ID" == "None" ]]; then
    echo "==> Creating app registration '$APP_NAME' (single tenant)..."
    APP_ID=$(az ad app create \
        --display-name "$APP_NAME" \
        --sign-in-audience AzureADMyOrg \
        --web-redirect-uris "${REDIRECT_URIS[@]}" \
        --query appId -o tsv)
else
    echo "==> Reusing existing app registration (appId=$APP_ID); updating redirect URIs..."
    az ad app update --id "$APP_ID" \
        --sign-in-audience AzureADMyOrg \
        --web-redirect-uris "${REDIRECT_URIS[@]}" >/dev/null
fi
OBJECT_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)
echo "    appId    = $APP_ID"
echo "    objectId = $OBJECT_ID"

# --- Ensure a service principal exists for the app ---------------------------
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" >/dev/null

# --- Expose the api://<app-id>/access_as_user scope (needed for OBO) ----------
echo "==> Exposing API scope 'access_as_user' (api://$APP_ID)..."
EXISTING_SCOPE_ID=$(az ad app show --id "$APP_ID" \
    --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv 2>/dev/null || true)
SCOPE_ID="${EXISTING_SCOPE_ID:-$(gen_uuid)}"

az ad app update --id "$APP_ID" --identifier-uris "api://$APP_ID" >/dev/null

# PATCH the api.oauth2PermissionScopes via Microsoft Graph (idempotent).
API_BODY=$(cat <<JSON
{
  "api": {
    "oauth2PermissionScopes": [
      {
        "id": "$SCOPE_ID",
        "adminConsentDescription": "Allow Data Formulator to access the API on behalf of the signed-in user.",
        "adminConsentDisplayName": "Access Data Formulator as the user",
        "userConsentDescription": "Allow Data Formulator to access resources on your behalf.",
        "userConsentDisplayName": "Access Data Formulator as you",
        "value": "access_as_user",
        "type": "User",
        "isEnabled": true
      }
    ]
  }
}
JSON
)
az rest --method PATCH \
    --uri "https://graph.microsoft.com/v1.0/applications/$OBJECT_ID" \
    --headers "Content-Type=application/json" \
    --body "$API_BODY" >/dev/null
echo "    scope    = api://$APP_ID/access_as_user"

# --- Resolve the Azure Data Explorer API + user_impersonation scope ----------
echo "==> Resolving Azure Data Explorer API..."
ADX_APP_ID="$ADX_APP_ID_DEFAULT"
if ! az ad sp show --id "$ADX_APP_ID" >/dev/null 2>&1; then
    # Fall back to display-name lookup, then ensure a tenant SP exists.
    ADX_APP_ID=$(az ad sp list --filter "displayName eq 'Azure Data Explorer'" \
        --query "[0].appId" -o tsv 2>/dev/null || true)
    if [[ -z "$ADX_APP_ID" || "$ADX_APP_ID" == "None" ]]; then
        ADX_APP_ID="$ADX_APP_ID_DEFAULT"
    fi
    az ad sp create --id "$ADX_APP_ID" >/dev/null 2>&1 || true
fi

ADX_SCOPE_ID=$(az ad sp show --id "$ADX_APP_ID" \
    --query "oauth2PermissionScopes[?value=='user_impersonation'].id | [0]" -o tsv 2>/dev/null || true)
if [[ -z "$ADX_SCOPE_ID" || "$ADX_SCOPE_ID" == "None" ]]; then
    echo "ERROR: Could not resolve the 'user_impersonation' scope for Azure Data Explorer" >&2
    echo "       (app id $ADX_APP_ID). Add the permission manually in the portal." >&2
    exit 1
fi
echo "    ADX appId   = $ADX_APP_ID"
echo "    scope id    = $ADX_SCOPE_ID (user_impersonation, delegated)"

# --- Add the delegated permission (this is what needs admin approval) --------
echo "==> Adding delegated permission 'user_impersonation' on Azure Data Explorer..."
az ad app permission add --id "$APP_ID" \
    --api "$ADX_APP_ID" \
    --api-permissions "${ADX_SCOPE_ID}=Scope" >/dev/null 2>&1 || true

# --- Add Azure Service Management (ARM) permission for cluster discovery ------
# Lets a signed-in user discover which Kusto clusters they can see across
# their subscriptions. Control-plane only — does not grant data access.
ARM_APP_ID="797f4846-ba00-4fd7-ba43-dac1f8f63013"   # Azure Service Management API
echo "==> Adding delegated permission 'user_impersonation' on Azure Service Management (for cluster discovery)..."
az ad sp show --id "$ARM_APP_ID" >/dev/null 2>&1 || az ad sp create --id "$ARM_APP_ID" >/dev/null 2>&1 || true
ARM_SCOPE_ID=$(az ad sp show --id "$ARM_APP_ID" \
    --query "oauth2PermissionScopes[?value=='user_impersonation'].id | [0]" -o tsv 2>/dev/null || true)
if [[ -n "$ARM_SCOPE_ID" && "$ARM_SCOPE_ID" != "None" ]]; then
    az ad app permission add --id "$APP_ID" \
        --api "$ARM_APP_ID" \
        --api-permissions "${ARM_SCOPE_ID}=Scope" >/dev/null 2>&1 || true
else
    echo "    WARNING: could not resolve ARM 'user_impersonation' scope; add it manually if you want cluster discovery."
fi

# --- Create a client secret ---------------------------------------------------
echo "==> Creating client secret (valid 12 months)..."
CLIENT_SECRET=$(az ad app credential reset --id "$APP_ID" \
    --display-name "df-oidc-secret" --years 1 \
    --query password -o tsv)

# --- Attempt admin consent (may require elevated privileges) ------------------
echo "==> Attempting admin consent for the Azure Data Explorer permission..."
CONSENT_OK=false
if az ad app permission admin-consent --id "$APP_ID" >/dev/null 2>&1; then
    CONSENT_OK=true
fi

CONSENT_URL="https://login.microsoftonline.com/${TENANT_ID}/adminconsent?client_id=${APP_ID}"

# --- Summary ------------------------------------------------------------------
cat <<SUMMARY

============================================================================
 Data Formulator app registration is ready.
============================================================================
 Add the following to your .env (backend / confidential client mode):

   AUTH_PROVIDER=oidc
   OIDC_ISSUER_URL=https://login.microsoftonline.com/${TENANT_ID}/v2.0
   OIDC_CLIENT_ID=${APP_ID}
   OIDC_CLIENT_SECRET=${CLIENT_SECRET}
   OIDC_SCOPES=openid profile email api://${APP_ID}/access_as_user
   AZURE_OBO_TENANT_ID=${TENANT_ID}

 (The client secret is shown ONLY once — copy it now.)
----------------------------------------------------------------------------
SUMMARY

if [[ "$CONSENT_OK" == "true" ]]; then
    echo " Admin consent: GRANTED."
else
    cat <<CONSENT
 Admin consent: NOT granted (you may lack privileges).

 Forward this URL to a tenant administrator for APPROVAL:

     ${CONSENT_URL}

 The admin is approving these delegated permissions:
     Azure Data Explorer     -> user_impersonation (act as the signed-in user)
     Azure Service Management -> user_impersonation (discover clusters; optional)
CONSENT
fi
echo "============================================================================"
