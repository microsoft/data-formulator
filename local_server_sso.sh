#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
#
# local_server_sso.sh
# -----------------------------------------------------------------------------
# Runs Data Formulator LOCALLY (port 5567) with Microsoft Entra ID (Azure AD)
# single sign-on turned ON, so you can test the "Sign in with Microsoft" flow
# and Kusto On-Behalf-Of (OBO) / cluster discovery without entering any
# credentials by hand.
#
# What it does (in order):
#   1. Verifies you are logged in with Azure CLI (`az login`).
#   2. Auto-detects the subscription that hosts the `data-formulator`
#      web app (the "grail" subscription) and switches to it, so the app
#      registration lands in the right tenant.
#   3. Runs scripts/setup_df_app_registration.sh to create/update the Entra
#      app registration with BOTH redirect URIs:
#            https://data-formulator.azurewebsites.net/auth/callback   (prod)
#            http://localhost:5567/auth/callback                       (local)
#   4. Captures the resulting client id / secret / tenant and writes them into
#      the repo-root .env (also generates a stable FLASK_SECRET_KEY so your
#      session survives restarts).
#   5. Launches the dev server on port 5567.
#
# ---------------------------------------------------------------------------
# HOW TO RUN
# ---------------------------------------------------------------------------
#   az login                       # log in to the tenant that owns data-formulator
#   ./local_server_sso.sh          # first run: registers the app + writes .env + serves
#   ./local_server_sso.sh          # later runs: reuses .env, just serves
#
#   Flags:
#     --force-setup   Re-run the app registration even if .env already has it
#                     (NOTE: this rotates the client secret).
#     --skip-setup    Never run registration; just launch the server from .env.
#     --setup-only    Do the registration + write .env, then exit (don't serve).
#
# ---------------------------------------------------------------------------
# HOW TO TEST SSO
# ---------------------------------------------------------------------------
#   1. Open http://localhost:5567 in your browser.
#   2. Click "Sign In" (top-right) -> sign in with your Microsoft account.
#   3. Open the data source / DB table manager and pick the Kusto connector.
#   4. Click the "Discover clusters" (globe) button next to the cluster field —
#      it should list Kusto clusters from your subscriptions. Pick one and
#      Connect. No manual token/credentials required.
#
#   If Sign In does nothing or discovery says "Sign in with Microsoft first",
#   the .env is missing OIDC_* values — re-run with --force-setup.
#
#   If discovery / connect fails with a consent error, a tenant admin must
#   approve the delegated permissions. The setup step prints the exact
#   admin-consent URL to forward.
# -----------------------------------------------------------------------------

set -euo pipefail

# --- Configuration -----------------------------------------------------------
PORT=5567
APP_NAME="Data Formulator"
WEBAPP_NAME="data-formulator"
APP_HOST="https://${WEBAPP_NAME}.azurewebsites.net"
LOCAL_HOST="http://localhost:${PORT}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
SETUP_SCRIPT="${SCRIPT_DIR}/scripts/setup_df_app_registration.sh"

MODE="auto"   # auto | force | skip | setup-only

# --- Parse args --------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force-setup) MODE="force"; shift ;;
        --skip-setup)  MODE="skip"; shift ;;
        --setup-only)  MODE="setup-only"; shift ;;
        -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

# --- Helpers -----------------------------------------------------------------
upsert_env() {
    # upsert_env KEY VALUE  — set KEY=VALUE in .env (replace if present, else append).
    local key="$1" val="$2" tmp
    touch "$ENV_FILE"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        tmp="$(mktemp)"
        grep -vE "^${key}=" "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
    fi
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
}

env_has() {
    # env_has KEY  — true if KEY has a non-empty value in .env.
    [[ -f "$ENV_FILE" ]] && grep -qE "^$1=.+" "$ENV_FILE"
}

gen_secret() {
    if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32;
    else python3 -c "import secrets;print(secrets.token_hex(32))"; fi
}

# --- Decide whether we need to run the registration --------------------------
NEED_SETUP=true
if [[ "$MODE" == "skip" ]]; then
    NEED_SETUP=false
elif [[ "$MODE" == "auto" ]] && env_has "OIDC_CLIENT_ID" && env_has "OIDC_CLIENT_SECRET"; then
    echo "==> .env already contains OIDC_CLIENT_ID/SECRET; reusing it."
    echo "    (Run with --force-setup to re-register and rotate the secret.)"
    NEED_SETUP=false
fi

if [[ "$NEED_SETUP" == "true" ]]; then
    # --- Pre-flight: Azure CLI ------------------------------------------------
    command -v az >/dev/null 2>&1 || { echo "ERROR: Azure CLI (az) not found. Install it and run 'az login'." >&2; exit 1; }
    az account show >/dev/null 2>&1 || { echo "ERROR: Not logged in. Run 'az login' first." >&2; exit 1; }
    [[ -x "$SETUP_SCRIPT" ]] || { echo "ERROR: $SETUP_SCRIPT not found or not executable." >&2; exit 1; }

    # --- Auto-detect the subscription hosting the data-formulator web app -----
    echo "==> Locating the subscription that hosts '${WEBAPP_NAME}' (grail)..."
    SUB_ID=""

    # Prefer Azure Resource Graph (searches across every subscription at once).
    if az graph query -q "resources | where type =~ 'microsoft.web/sites' and name =~ '${WEBAPP_NAME}' | project subscriptionId" \
            --query "data[0].subscriptionId" -o tsv >/dev/null 2>&1; then
        SUB_ID=$(az graph query -q "resources | where type =~ 'microsoft.web/sites' and name =~ '${WEBAPP_NAME}' | project subscriptionId" \
            --query "data[0].subscriptionId" -o tsv 2>/dev/null || true)
    fi

    # Fallback: a subscription whose name contains 'grail'.
    if [[ -z "$SUB_ID" || "$SUB_ID" == "None" ]]; then
        SUB_ID=$(az account list --all --query "[?contains(to_lower(name), 'grail')].id | [0]" -o tsv 2>/dev/null || true)
    fi

    if [[ -n "$SUB_ID" && "$SUB_ID" != "None" ]]; then
        az account set --subscription "$SUB_ID"
        SUB_NAME=$(az account show --query name -o tsv)
        echo "    Using subscription: ${SUB_NAME} (${SUB_ID})"
    else
        echo "    Could not auto-detect the subscription; using the current one:"
        az account show --query "{name:name, id:id}" -o tsv | sed 's/^/      /'
        echo "    (If this is wrong, run 'az account set --subscription <id>' and re-run.)"
    fi

    TENANT_ID=$(az account show --query tenantId -o tsv)
    echo "    Tenant: ${TENANT_ID}"

    # --- Run the app registration, capturing its output ----------------------
    echo "==> Registering / updating the Entra app with redirect URIs:"
    echo "      ${APP_HOST}/auth/callback"
    echo "      ${LOCAL_HOST}/auth/callback"
    SETUP_LOG="$(mktemp)"
    "$SETUP_SCRIPT" \
        --name "$APP_NAME" \
        --hosts "${APP_HOST},${LOCAL_HOST}" \
        --tenant "$TENANT_ID" 2>&1 | tee "$SETUP_LOG"

    # --- Extract the printed .env values -------------------------------------
    extract() { grep -E "^[[:space:]]*$1=" "$SETUP_LOG" | head -1 | sed -E "s/^[[:space:]]*$1=//"; }

    OIDC_CLIENT_ID_VAL=$(extract "OIDC_CLIENT_ID")
    OIDC_CLIENT_SECRET_VAL=$(extract "OIDC_CLIENT_SECRET")
    OIDC_ISSUER_URL_VAL=$(extract "OIDC_ISSUER_URL")
    OIDC_SCOPES_VAL=$(extract "OIDC_SCOPES")
    OBO_TENANT_VAL=$(extract "AZURE_OBO_TENANT_ID")
    rm -f "$SETUP_LOG"

    if [[ -z "$OIDC_CLIENT_ID_VAL" || -z "$OIDC_CLIENT_SECRET_VAL" ]]; then
        echo "ERROR: Could not read client id/secret from the setup output." >&2
        echo "       Check the messages above and re-run." >&2
        exit 1
    fi

    # --- Write everything into .env ------------------------------------------
    echo "==> Writing SSO configuration to ${ENV_FILE}"
    upsert_env "AUTH_PROVIDER"       "oidc"
    upsert_env "OIDC_ISSUER_URL"     "$OIDC_ISSUER_URL_VAL"
    upsert_env "OIDC_CLIENT_ID"      "$OIDC_CLIENT_ID_VAL"
    upsert_env "OIDC_CLIENT_SECRET"  "$OIDC_CLIENT_SECRET_VAL"
    upsert_env "OIDC_SCOPES"         "$OIDC_SCOPES_VAL"
    upsert_env "AZURE_OBO_TENANT_ID" "$OBO_TENANT_VAL"

    # Stable secret key so Flask sessions (and the stored SSO token) survive restarts.
    if ! env_has "FLASK_SECRET_KEY"; then
        upsert_env "FLASK_SECRET_KEY" "$(gen_secret)"
        echo "    Generated a FLASK_SECRET_KEY."
    fi
    echo "    Done. (.env is git-ignored — the client secret stays local.)"
fi

if [[ "$MODE" == "setup-only" ]]; then
    echo "==> Setup complete. Skipping server launch (--setup-only)."
    echo "    Start it later with: ./local_server_sso.sh --skip-setup"
    exit 0
fi

# --- Launch the dev server on 5567 ------------------------------------------
echo "==> Starting Data Formulator on ${LOCAL_HOST} (SSO enabled)."
echo "    Open ${LOCAL_HOST}, click 'Sign In', then test Kusto discovery."
export FLASK_RUN_PORT=$PORT
if command -v uv >/dev/null 2>&1; then
    exec uv run data_formulator --port "${FLASK_RUN_PORT}" --dev
else
    exec python -m data_formulator.app --port "${FLASK_RUN_PORT}" --dev
fi
