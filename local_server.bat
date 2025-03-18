:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.

@echo off
:: Set HTTP proxy environment variables only (Flask doesn't support SOCKS5)
:: set http_proxy=http://127.0.0.1:7890
:: set https_proxy=http://127.0.0.1:7890

set FLASK_APP=py-src/data_formulator/app.py
set FLASK_RUN_PORT=5000
set FLASK_RUN_HOST=0.0.0.0
flask run
