:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.

@echo off
set FLASK_APP=app.py
set FLASK_RUN_PORT=5000
set FLASK_RUN_HOST=0.0.0.0
flask run
