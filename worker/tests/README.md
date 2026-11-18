# Tests for the order, booking and pickup features

None of these send real email: the "Apps Script" is a fake (`fake-apps-script.mjs`). Nothing here touches the live Worker.

| File | What it proves | Needs |
|---|---|---|
| `../../apps-script/selftest.mjs` | Code.gs logic: subjects, escaping, duplicate guard, quota, token, labels | Node only |
| `admin-policy.mjs` | Go-live rules: production refuses an admin password under 16 characters (preview and development don't), LIMITER_SALT and its fallback, plain-HTTP /api refused, preview noindex helper | Node only |
| `limiter-unit.mjs` | Counter logic: IPv6 /64 keys, email normalising, windows, refunds, daily cap, 12 parallel takes allow exactly 5 | Node only |
| `forms-limits.mjs` | Worker form rules with fake Durable Objects: token required before forwarding, /64 limit, per-mailbox cap of 3, shared cap of 40, fails closed | Node only |
| `admin-lockout.mjs` | M2: 12 parallel wrong passwords give 5 x 401 and 7 x 429, /64 rotation does not help, good logins are refunded | wrangler dev |
| `image-ratios.mjs` | No rendered image is stretched (box ratio vs real ratio, at 390 and 1280, home, privacy, admin) | wrangler dev + Chrome |
| `saturday-rules.mjs` | The real Worker order code with a fake clock: Wednesday 23:59 vs Thursday 00:00 SAST, Saturday-only, closed Saturday, the last-Saturday default list, opens on the 15th, added and removed Saturdays, owner-set cut-off, month/year/leap-year ends, pickup point checks | Node only |
| `forms-api.mjs` | Live HTTP path: validation, honeypot, closed dates, orders off, point switched off, rate limits | wrangler dev + fake script |
| `prices.mjs` | Totals come from content.ts on the server; unpriced toppings refused | wrangler dev + fake script |
| `pickups-api.mjs` | Admin pickup points: auth, validation, limits, edit, on/off, remove; cut-off and weeks-ahead settings | wrangler dev |
| `e2e-browser.mjs` | Browser checks at 390 and 1280 incl. axe: hidden ordering, form, Saturdays, cut-off note, admin screens | wrangler dev + fake script + Chrome |

## Run
```
node apps-script/selftest.mjs
node worker/tests/saturday-rules.mjs
node worker/tests/limiter-unit.mjs
node worker/tests/forms-limits.mjs
node worker/tests/admin-policy.mjs

# in two terminals. TOKEN is any 32+ character value (the Worker will not forward without one).
# A fresh --persist-to folder per session keeps the shared daily counters (40 submissions) from carrying over.
FAKE_PORT=8899 node worker/tests/fake-apps-script.mjs /tmp/fake.log   # FAKE_PORT defaults to 8799; change it if that port is busy
export TOKEN=$(openssl rand -base64 36 | tr -d '/+=\n')
# --var APP_ENV:development is REQUIRED: the top level of wrangler.jsonc is production, which refuses the short test password
npx wrangler@4.148.0 dev --port 8787 --persist-to /tmp/stuffd-state --var APP_ENV:development --var APPS_SCRIPT_URL:http://127.0.0.1:8899/exec --var APPS_SCRIPT_TOKEN:$TOKEN

# then
rm -f /tmp/fake.log
node worker/tests/admin-lockout.mjs
node worker/tests/pickups-api.mjs /tmp/fake.log
TOKEN=$TOKEN node worker/tests/forms-api.mjs /tmp/fake.log
node worker/tests/prices.mjs      /tmp/fake.log
```
The API tests read the admin password from the git-ignored `.dev.vars`, create their own pickup points and use a fresh pretend
client IP (the Worker reads CF-Connecting-IP, which wrangler dev lets a test set) for a clean rate-limit slate. They end with no pickup points saved: the site's "no pickup points yet" state.

Browser test: start Chrome with `--remote-debugging-port=9444` (on Apple silicon launch it with `arch -arm64`, a Rosetta Chrome is far
too slow), then `PW=<path to playwright-core> AXE=<path to axe.min.js> FAKELOG=/tmp/fake.log SHOTS=/tmp node worker/tests/e2e-browser.mjs`.
Build the site first (`PORT=5173 BASE_PATH=/ pnpm --filter @workspace/stuffd-bagels run build`).
