#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_name="lishogi-cloudflare-verify:local"
container_name="lishogi-cloudflare-verify-${RANDOM}"
control_token="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
password_key="$(node "$project_dir/cloudflare/generate-secret.mjs" --password)"
temporary_dir="$(mktemp -d)"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_dir"
}
trap cleanup EXIT
cd "$project_dir"
docker build -f cloudflare/Dockerfile -t "$image_name" .
docker run -d --name "$container_name" -p 127.0.0.1:18080:8080 \
  -e PUBLIC_ORIGIN=https://shogi.test \
  -e MAIL_FROM=noreply@shogi.test \
  -e CONTAINER_CONTROL_TOKEN="$control_token" \
  -e PLAY_SECRET="$control_token" \
  -e USER_PASSWORD_SECRET="$password_key" \
  -e SHOGINET_KEY="$control_token" "$image_name" >/dev/null
for attempt in $(seq 1 180); do
  if curl -fsS -H "X-Container-Control: $control_token" \
    http://127.0.0.1:18080/_cf/status >/dev/null; then break; fi
  sleep 1
done
curl -fsS -X POST -H "X-Container-Control: $control_token" \
  http://127.0.0.1:18080/_cf/initialize
curl -fsS -H 'Host: shogi.test' http://127.0.0.1:18080/ >/dev/null
curl -fsS -H 'Host: shogi.test' \
  http://127.0.0.1:18080/assets/_test/font/noto-sans-latin.woff2 >/dev/null
curl -fsS -X POST -H "X-Container-Control: $control_token" \
  http://127.0.0.1:18080/_cf/backup -o "$temporary_dir/backup.gz"
test -s "$temporary_dir/backup.gz"
docker exec "$container_name" sh -c 'cd /opt/shoginet && npm test'
echo 'Container startup, public assets, database backup and upstream engine tests passed.'
