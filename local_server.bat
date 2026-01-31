:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.

@echo off
:: Set HTTP proxy environment variables only (Flask doesn't support SOCKS5)
:: set http_proxy=http://127.0.0.1:7890
:: set https_proxy=http://127.0.0.1:7890

set FLASK_RUN_PORT=5000

:: Use uv if available, otherwise fall back to python
where uv >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    uv run data_formulator --port %FLASK_RUN_PORT% --dev
) else (
    python -m data_formulator.app --port %FLASK_RUN_PORT% --dev
)
