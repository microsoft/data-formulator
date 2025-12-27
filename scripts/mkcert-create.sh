#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo ./scripts/mkcert-create.sh
# Creates mkcert certs for IP 172.19.16.22 and copies to /etc/ssl/mycerts

IP=172.19.16.22
OUT_DIR=/etc/ssl/mycerts

command -v mkcert >/dev/null 2>&1 || {
  echo "mkcert not found. Install mkcert: https://github.com/FiloSottile/mkcert" >&2
  exit 1
}

echo "Ensuring mkcert CA is installed (may prompt for password)..."
mkcert -install

echo "Creating cert for $IP..."
sudo mkdir -p "$OUT_DIR"
mkcert -cert-file "$IP.pem" -key-file "$IP-key.pem" "$IP"

echo "Moving certs to $OUT_DIR (sudo)..."
sudo mv "$IP.pem" "$OUT_DIR/$IP.pem"
sudo mv "$IP-key.pem" "$OUT_DIR/$IP-key.pem"

sudo chown root:root "$OUT_DIR/$IP.pem" "$OUT_DIR/$IP-key.pem"
sudo chmod 644 "$OUT_DIR/$IP.pem"
sudo chmod 600 "$OUT_DIR/$IP-key.pem"

echo "Done. Certificates written to $OUT_DIR."

echo "Note: Import mkcert root CA on client machines if necessary (mkcert -CAROOT shows path)."