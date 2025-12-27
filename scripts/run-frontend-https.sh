#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo ./scripts/run-frontend-https.sh
# Rebuild frontend image with VITE_REDIRECT_URI=https://172.19.16.22:8001
# then run container mapping host port 8001 -> container 443 and mount certs

IMAGE_NAME=df-frontend:local
IP=172.19.16.22
HOST_PORT=8001
CERT_DIR=/etc/ssl/mycerts

if [ ! -f "$CERT_DIR/$IP.pem" ] || [ ! -f "$CERT_DIR/$IP-key.pem" ]; then
  echo "ERROR: certs not found in $CERT_DIR. Run scripts/mkcert-create.sh first." >&2
  exit 1
fi

echo "Building image $IMAGE_NAME..."
docker build -f Dockerfile.frontend -t "$IMAGE_NAME" \
  --build-arg VITE_REDIRECT_URI="https://$IP:$HOST_PORT" \
  --build-arg VITE_API_HOST="$IP" \
  --build-arg VITE_API_PORT="8000" .

echo "Stopping/removing existing container if present..."
docker rm -f df-frontend || true

echo "Starting container with certs mounted (host $HOST_PORT -> container 443)..."
docker run -d --name df-frontend -p $HOST_PORT:443 \
  -v "$CERT_DIR/$IP.pem:/etc/ssl/mycerts/$IP.pem:ro" \
  -v "$CERT_DIR/$IP-key.pem:/etc/ssl/mycerts/$IP-key.pem:ro" \
  --restart unless-stopped "$IMAGE_NAME"

echo "Container started. Access at https://$IP:$HOST_PORT"