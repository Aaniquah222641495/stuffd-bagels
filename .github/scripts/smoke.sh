#!/usr/bin/env bash
# Read-only post-deploy check. Usage: smoke.sh <base-url> <noindex-expected: yes|no>
# Only GETs. It never submits an order, a booking or a payment, so it creates no Yoco checkout and sends no email.
set -euo pipefail
base="${1:?base url}"; noindex="${2:-no}"
base="${base%/}"

# A new deploy can take a few seconds to reach every edge location, so retry the first request.
code=000
for i in 1 2 3 4 5 6; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$base/" || true)"
  [ "$code" = 200 ] && break
  echo "attempt $i: $base/ answered $code, retrying in 10s"; sleep 10
done
[ "$code" = 200 ] || { echo "FAIL: $base/ answered $code, expected 200"; exit 1; }
echo "ok: home page answers 200"

page="$(curl -sf --max-time 20 "$base/")" || { echo "FAIL: could not read the home page"; exit 1; }
grep -qi "bagel" <<< "$page" || { echo "FAIL: home page does not look like the Stuff'd site"; exit 1; }
echo "ok: home page has the site content"

body="$(curl -sf --max-time 20 "$base/api/pickups")" || { echo "FAIL: $base/api/pickups did not answer 200"; exit 1; }
printf '%s' "$body" | jq -e 'type == "array"' > /dev/null || { echo "FAIL: /api/pickups did not return a JSON list"; exit 1; }
echo "ok: /api/pickups returns a JSON list"

if [ "$noindex" = yes ]; then
  heads="$(curl -sI --max-time 20 "$base/")" || { echo "FAIL: could not read the headers"; exit 1; }
  grep -qi '^x-robots-tag:.*noindex' <<< "$heads" || { echo "FAIL: X-Robots-Tag noindex is missing"; exit 1; }
  echo "ok: noindex header present"
fi
echo "Smoke checks passed for $base"
