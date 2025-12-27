# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# Set HTTP proxy environment variables only (Flask doesn't support SOCKS5)
# export http_proxy=http://127.0.0.1:7890
# export https_proxy=http://127.0.0.1:7890

#env FLASK_APP=py-src/data_formulator/app.py FLASK_RUN_PORT=5000 FLASK_RUN_HOST=0.0.0.0 flask run
# Cho phép đặt PORT từ biến môi trường, mặc định 5000 nếu không có
export FLASK_RUN_PORT=${PORT:-5000}
python -m py-src.data_formulator.app --port ${FLASK_RUN_PORT} --dev