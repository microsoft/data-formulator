# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# Set HTTP proxy environment variables only (Flask doesn't support SOCKS5)
# export http_proxy=http://127.0.0.1:7890
# export https_proxy=http://127.0.0.1:7890

export FLASK_RUN_PORT=5000

# Use uv if available, otherwise fall back to python
if command -v uv &> /dev/null; then
    uv run data_formulator --port ${FLASK_RUN_PORT} --dev
else
    python -m data_formulator.app --port ${FLASK_RUN_PORT} --dev
fi