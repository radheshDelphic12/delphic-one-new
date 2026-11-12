#!/usr/bin/env bash
#
# One command to switch the database snapshot viewer on, on the production box (the steps of
# docs/features/DB-SNAPSHOT-VIEWER.md "Rollout on prod"). Run it as the deploy user from the repo folder:
#
#   bash scripts/enable-dbviewer.sh
#
# It is safe to run again; every step checks first:
#   1. refuses to go on when the disk has less than MIN_FREE_GB free (default 8)
#   2. creates / refreshes the read-only Postgres role dump_reader (scripts/create-dump-reader-role.sh)
#   3. starts the dbviewer container (loopback :8090)
#   4. adds the /dbviewer/ location to the live nginx config (a timestamped backup of the file is kept; a failing
#      `nginx -t` puts the old file back and nothing is reloaded)
#   5. checks the viewer answers on :8090 and through nginx
#
# It changes no table, drops nothing and never touches the app containers. The viewer itself is Super Admin only
# (the app's login is checked on every call), so adding the nginx location does not open anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MIN_FREE_GB="${MIN_FREE_GB:-8}"
PORT="${DBVIEWER_PORT:-8090}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

say() { printf '\n== %s\n' "$*"; }

say "1/5 disk space"
FREE_GB="$(df -BG --output=avail "$ROOT" | tail -n1 | tr -dc '0-9')"
echo "free on the repo disk: ${FREE_GB} GB (need at least ${MIN_FREE_GB} GB)"
if [[ "${FREE_GB:-0}" -lt "$MIN_FREE_GB" ]]; then
  echo "ERROR: not enough free disk. Free some space first (docker system df; docker builder prune), or run with MIN_FREE_GB=<n> to override." >&2
  exit 1
fi

say "2/5 read-only database role (dump_reader)"
bash scripts/create-dump-reader-role.sh

say "3/5 dbviewer container"
$DC up -d --build dbviewer
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/"; then echo "dbviewer answers on 127.0.0.1:${PORT}"; break; fi
  [[ "$i" -eq 30 ]] && { echo "ERROR: dbviewer did not answer on :${PORT}. See: $DC logs --tail=50 dbviewer" >&2; exit 1; }
  sleep 2
done

say "4/5 nginx /dbviewer/ location"
if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is not installed on this host - add the /dbviewer/ location from nginx.conf.example by hand."
else
  # The live files that proxy the app (127.0.0.1:8081); certbot copies the block into the 443 server too, so patch every one.
  mapfile -t FILES < <(sudo grep -lE 'proxy_pass[[:space:]]+http://127\.0\.0\.1:8081' /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null || true)
  if [[ "${#FILES[@]}" -eq 0 ]]; then
    echo "ERROR: no nginx config proxies the app on 127.0.0.1:8081; add the location from nginx.conf.example by hand." >&2
    exit 1
  fi
  STAMP="$(date +%Y%m%d-%H%M%S)"
  CHANGED=()
  for f in "${FILES[@]}"; do
    real="$(readlink -f "$f")"
    if sudo grep -q 'location /dbviewer/' "$real"; then echo "already present in $real"; continue; fi
    sudo cp -a "$real" "${real}.bak-dbviewer-${STAMP}"
    sudo python3 - "$real" "$PORT" <<'PY'
import re, sys
path, port = sys.argv[1], sys.argv[2]
src = open(path).read()
block = """    # Database snapshot viewer (Super Admin only; its own container on loopback). The trailing slash strips /dbviewer/.
    location /dbviewer/ {
        proxy_pass http://127.0.0.1:%s/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }

""" % port
# put it before the app's own "location / {" in every server block that has one
out, n = re.subn(r'(?m)^([ \t]*)location\s+/\s*\{', lambda m: block + m.group(0), src)
if n == 0:
    sys.exit('no "location / {" found in ' + path)
open(path, 'w').write(out)
print('added /dbviewer/ to %s (%d server block(s))' % (path, n))
PY
    CHANGED+=("$real")
  done
  if ! sudo nginx -t; then
    echo "ERROR: nginx -t failed; restoring the backups. Nothing was reloaded." >&2
    for real in "${CHANGED[@]}"; do sudo cp -a "${real}.bak-dbviewer-${STAMP}" "$real"; done
    exit 1
  fi
  sudo systemctl reload nginx
  echo "nginx reloaded."
fi

say "5/5 check"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: localhost' "http://127.0.0.1/dbviewer/" || true)"
echo "http://127.0.0.1/dbviewer/ -> ${CODE} (200 = served by the viewer; a redirect to https is fine too)"
echo
echo "Done. Sign in to Delphic as a Super Admin (not only a Group Super Admin), then open the menu item"
echo "'Database snapshots' or go to /dbviewer/. If the viewer says the token expired, open Delphic once and reload it."
