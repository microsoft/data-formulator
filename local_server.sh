# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# Set HTTP proxy environment variables only (Flask doesn't support SOCKS5)
# export http_proxy=http://127.0.0.1:7890
# export https_proxy=http://127.0.0.1:7890

export FLASK_RUN_PORT=5567

# Kusto delegated Microsoft sign-in (Authorization Code + PKCE).
# Local public-client login does not use a client secret.
export KUSTO_OAUTH_CLIENT_ID=f230606a-f17d-416c-93b8-8f2073d4b759
export KUSTO_OAUTH_TENANT_ID=72f988bf-86f1-41af-91ab-2d7cd011db47
export KUSTO_OAUTH_REDIRECT_URI=http://localhost:${FLASK_RUN_PORT}/api/auth/kusto/callback

# Use uv if available, otherwise fall back to python
if command -v uv &> /dev/null; then
    uv run data_formulator --port ${FLASK_RUN_PORT} --dev
else
    python -m data_formulator.app --port ${FLASK_RUN_PORT} --dev
fi