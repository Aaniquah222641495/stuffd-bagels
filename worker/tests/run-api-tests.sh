#!/usr/bin/env bash
# Runs the HTTP API suites (admin-lockout, pickups-api, forms-api, prices) against a local `wrangler dev` and the fake Apps Script.
# Used by CI (.github/workflows/ci.yml) and works the same on a laptop. Needs the site built first (the Worker serves the built folder):
#   PORT=5173 BASE_PATH=/ pnpm --filter @workspace/stuffd-bagels run build
# Nothing real is touched: no Cloudflare login, no real secrets, no email. It writes a throwaway .dev.vars ONLY if none exists.
set -euo pipefail
cd "$(dirname "$0")/../.."

if curl -s -o /dev/null --max-time 2 "http://localhost:${DEV_PORT:-8787}/"; then
  echo "Something is already listening on port ${DEV_PORT:-8787}. Stop it, or set DEV_PORT to a free port." >&2; exit 1
fi
WORK="$(mktemp -d)"
FAKE_PORT="${FAKE_PORT:-8899}"
DEV_PORT="${DEV_PORT:-8787}" # override when something else (another wrangler dev) already uses 8787
export API_BASE="http://localhost:$DEV_PORT"
MADE_VARS=0
cleanup() {
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null || true
  [ -n "${FAKE_PID:-}" ] && kill "$FAKE_PID" 2>/dev/null || true
  [ "$MADE_VARS" = 1 ] && rm -f .dev.vars
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ ! -f .dev.vars ]; then
  # A random per-run test password (16+ characters). It is not a secret: it only unlocks this throwaway local Worker.
  printf 'ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 16)" > .dev.vars
  MADE_VARS=1
fi
TOKEN="$(openssl rand -hex 24)" # 48 characters, the Worker will not forward to the script without 32+
export TOKEN

FAKE_PORT="$FAKE_PORT" node worker/tests/fake-apps-script.mjs "$WORK/fake.log" > "$WORK/fake.out" 2>&1 &
FAKE_PID=$!
npx --yes wrangler@4.148.0 dev --port "$DEV_PORT" --persist-to "$WORK/state" --var APP_ENV:development \
  --var "APPS_SCRIPT_URL:http://127.0.0.1:$FAKE_PORT/exec" --var "APPS_SCRIPT_TOKEN:$TOKEN" > "$WORK/dev.out" 2>&1 &
DEV_PID=$!

for _ in $(seq 1 90); do
  curl -sf "http://localhost:$DEV_PORT/api/pickups" > /dev/null 2>&1 && break
  kill -0 "$DEV_PID" 2>/dev/null || { echo "wrangler dev stopped early:"; tail -30 "$WORK/dev.out"; exit 1; }
  sleep 1
done
curl -sf "http://localhost:$DEV_PORT/api/pickups" > /dev/null || { echo "wrangler dev did not start in time:"; tail -30 "$WORK/dev.out"; exit 1; }

: > "$WORK/fake.log"
fail=0
run() { echo "== $*"; node "$@" || fail=1; }
run worker/tests/admin-lockout.mjs
run worker/tests/pickups-api.mjs "$WORK/fake.log"
run worker/tests/forms-api.mjs "$WORK/fake.log"
run worker/tests/prices.mjs "$WORK/fake.log"
[ "$fail" = 0 ] && echo "API suites: all passed" || { echo "API suites: FAILED"; tail -20 "$WORK/dev.out"; exit 1; }
