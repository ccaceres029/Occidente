#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/Occidente}"
APP_DIR="${APP_DIR:-$APP_ROOT/app}"
SHARED_DIR="${SHARED_DIR:-$APP_ROOT/shared}"
DATA_DIR="$SHARED_DIR/server-data"
RDS_CA="$SHARED_DIR/rds-ca-global.pem"
SERVICE_FILE="/etc/systemd/system/occidente.service"
NGINX_FILE="/etc/nginx/sites-available/occidente.appsmacao.biz"
TLS_CERT="/etc/letsencrypt/live/occidente.appsmacao.biz/fullchain.pem"
TLS_KEY="/etc/letsencrypt/live/occidente.appsmacao.biz/privkey.pem"

cd "$APP_DIR"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

if ! command -v pdftoppm >/dev/null 2>&1 || ! command -v pdftotext >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends poppler-utils
fi

sudo mkdir -p "$APP_DIR" "$DATA_DIR/uploads" "$DATA_DIR/preview-cache"
sudo chown -R ubuntu:ubuntu "$APP_ROOT"
chmod 755 "$APP_ROOT" "$APP_DIR" "$APP_DIR/client" "$APP_DIR/client/dist"
find "$APP_DIR/client/dist" -type d -exec chmod 755 {} +
find "$APP_DIR/client/dist" -type f -exec chmod 644 {} +

rm -rf "$APP_DIR/server/data"
ln -sfn "$DATA_DIR" "$APP_DIR/server/data"

if [ ! -s "$RDS_CA" ]; then
  curl --fail --silent --show-error \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    --output "$RDS_CA"
  chmod 600 "$RDS_CA"
fi

sudo env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable
sudo env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare pnpm@11.16.0 --activate
pnpm install --prod --frozen-lockfile

sudo install -m 0644 "$APP_DIR/deploy/lightsail/occidente.service" "$SERVICE_FILE"
if sudo test -f "$TLS_CERT" && sudo test -f "$TLS_KEY"; then
  sudo install -m 0644 "$APP_DIR/deploy/lightsail/nginx-occidente-ssl.conf" "$NGINX_FILE"
else
  sudo install -m 0644 "$APP_DIR/deploy/lightsail/nginx-occidente.conf" "$NGINX_FILE"
fi
sudo ln -sfn "$NGINX_FILE" /etc/nginx/sites-enabled/occidente.appsmacao.biz

sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable occidente
sudo systemctl restart occidente
sudo systemctl reload nginx

for attempt in {1..20}; do
  if curl --fail --silent --show-error http://127.0.0.1:3001/api/health >/dev/null; then
    echo "Occidente deployed successfully"
    exit 0
  fi
  sleep 1
done

sudo systemctl status occidente --no-pager -l
sudo journalctl -u occidente --no-pager -n 80
exit 1
