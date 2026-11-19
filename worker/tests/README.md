# Tests for the order, booking and pickup features

None of these send real email: the "Apps Script" is a fake (`fake-apps-script.mjs`). Nothing here touches the live Worker.

| File | What it proves | Needs |
|---|---|---|
| `../../apps-script/selftest.mjs` | Code.gs logic: subjects, escaping, duplicate guard, quota, token, labels | Node only |
| `admin-policy.mjs` | Go-live rules: production refuses an admin password under 16 characters (preview and development don't), LIMITER_SALT and its fallback, plain-HTTP /api refused, preview noindex helper | Node only |
| `yoco-verify.mjs` | Webhook signature: correct vector, one changed byte, wrong secret, old signature with fresh timestamp, 180 s vs 181 s either side, two signatures with only the second right, junk and wrong-length entries, missing headers, bad `whsec_` secret | Node only |
| `yoco-checkout.mjs` | `createCheckout` and `modeOk`: request shape (cents, Idempotency-Key, +31 min `Z` expiry, no redirect following), failure reasons, `redirectUrl` must be https on yoco.com, key prefix must match `YOCO_MODE`, `YOCO_API_BASE` only for http://127.0.0.1 | Node only |
| `orders-core.mjs` | The order state machine with a fake clock: happy path, duplicate / parallel `markPaid` pays once, amount and currency mismatch, unknown checkout, ref fallback, 30-minute expiry and late payment, 48 h / 7 day retention, email retry schedule then `email_failed`, same-attempt idempotency, content hash | Node only |
| `payments-handler.mjs` | The whole payment path in Node (real order handler, webhook, status, attention, Yoco client, mailer, state machine; fake KV, Durable Objects, Yoco and script): server amount, no personal data to Yoco, double submit, rate-limit refunds, 503 switches, forged / stale / replayed webhooks, mode mismatch, email retries, no personal data in logs | Node only |
| `payments-api.mjs` | The same paths over HTTP against `wrangler dev` with the fake Yoco (`fake-yoco.mjs`) and fake script, including the real Durable Object alarm sending exactly one email request, and a grep of wrangler's output for personal data | wrangler dev + fake Yoco + fake script |
| `pickup-slots.mjs` | Collection hours to one-hour time chips: structured opens/closes, old free text ("13:00 to 18:00", "10am to 1pm", "1pm - 6pm"), unclear text gives none; Worker keeps old points and validates new hours | Node only |
| `webkit-form.mjs` | Order form in WebKit at 390 and 1280 (single-choice line, chips + keyboard, notes, mobile bar, axe). Strips the CSP header locally because WebKit upgrades http://localhost files to https | wrangler dev + fakes |
| `limiter-unit.mjs` | Counter logic: IPv6 /64 keys, email normalising, windows, refunds, daily cap, 12 parallel takes allow exactly 5 | Node only |
| `forms-limits.mjs` | Worker form rules with fake Durable Objects: token required before forwarding, /64 limit, per-mailbox cap of 3, shared cap of 40, fails closed | Node only |
| `admin-lockout.mjs` | M2: 12 parallel wrong passwords give 5 x 401 and 7 x 429, /64 rotation does not help, good logins are refunded | wrangler dev |
| `image-ratios.mjs` | No rendered image is stretched (box ratio vs real ratio, at 390 and 1280, home, privacy, admin) | wrangler dev + Chrome |
| `saturday-rules.mjs` | The real Worker order code with a fake clock: Wednesday 23:59 vs Thursday 00:00 SAST, Saturday-only, closed Saturday, the last-Saturday default list, opens on the 15th, added and removed Saturdays, owner-set cut-off, month/year/leap-year ends, pickup point checks | Node only |
| `forms-api.mjs` | Live HTTP path: validation, honeypot, closed dates, orders off, point switched off, rate limits | wrangler dev + fake script |
| `prices.mjs` | Totals come from content.ts on the server; unpriced toppings refused | wrangler dev + fake script |
| `pickups-api.mjs` | Admin pickup points: auth, validation, limits, edit, on/off, remove; cut-off and weeks-ahead settings | wrangler dev |
| `e2e-browser.mjs` | Browser checks at 390 and 1280 incl. axe: hidden ordering, form, Pay button hand-off to the fake Yoco (referrer check), `/order/result` success-confirming, success-confirmed, cancel, failure, still-confirming, expired, unknown and junk-query states, cart restore, Saturdays, cut-off note, admin screens | wrangler dev + fake Yoco + fake script + Chrome |

## Run
```
node apps-script/selftest.mjs
node worker/tests/saturday-rules.mjs
node worker/tests/limiter-unit.mjs
node worker/tests/forms-limits.mjs
node worker/tests/admin-policy.mjs
node worker/tests/yoco-verify.mjs
node worker/tests/yoco-checkout.mjs
node worker/tests/orders-core.mjs
node worker/tests/payments-handler.mjs
node worker/tests/pickup-slots.mjs

# in two terminals. TOKEN is any 32+ character value (the Worker will not forward without one).
# A fresh --persist-to folder per session keeps the shared daily counters (40 submissions) from carrying over.
FAKE_PORT=8899 node worker/tests/fake-apps-script.mjs /tmp/fake.log   # FAKE_PORT defaults to 8799; change it if that port is busy
FAKE_YOCO_PORT=8798 node worker/tests/fake-yoco.mjs
export WHSEC="whsec_$(openssl rand -base64 24)"   # made-up local value; never a real Yoco secret
export TOKEN=$(openssl rand -base64 36 | tr -d '/+=\n')
# --var APP_ENV:development is REQUIRED: the top level of wrangler.jsonc is production, which refuses the short test password
npx wrangler@4.148.0 dev --port 8787 --persist-to /tmp/stuffd-state --var APP_ENV:development --var APPS_SCRIPT_URL:http://127.0.0.1:8899/exec --var APPS_SCRIPT_TOKEN:$TOKEN \
  --var YOCO_API_BASE:http://127.0.0.1:8798 --var YOCO_SECRET_KEY:sk_test_localfake0123456789 --var YOCO_WEBHOOK_SECRET:$WHSEC --var YOCO_MODE:test --var SITE_ORIGIN:http://localhost:8787

# then
rm -f /tmp/fake.log
node worker/tests/admin-lockout.mjs
node worker/tests/pickups-api.mjs /tmp/fake.log
TOKEN=$TOKEN node worker/tests/forms-api.mjs /tmp/fake.log
node worker/tests/prices.mjs      /tmp/fake.log
WHSEC=$WHSEC node worker/tests/payments-api.mjs /tmp/fake.log /tmp/wrangler.out   # wrangler's output, started with > /tmp/wrangler.out 2>&1
```
The API tests read the admin password from the git-ignored `.dev.vars`, create their own pickup points and use a fresh pretend
client IP (the Worker reads CF-Connecting-IP, which wrangler dev lets a test set) for a clean rate-limit slate. They end with no pickup points saved: the site's "no pickup points yet" state.

Ports taken by another session? Set SB_BASE (the Worker URL), FAKE_YOCO (fake Yoco URL) and CDP (Chrome debug URL) for the browser tests.

Browser test: start Chrome with `--remote-debugging-port=9444` (on Apple silicon launch it with `arch -arm64`, a Rosetta Chrome is far
too slow), then `PW=<path to playwright-core> AXE=<path to axe.min.js> FAKELOG=/tmp/fake.log SHOTS=/tmp node worker/tests/e2e-browser.mjs`.
Build the site first (`PORT=5173 BASE_PATH=/ pnpm --filter @workspace/stuffd-bagels run build`).

The shared daily cap (40 submissions) is kept in the Durable Object under `--persist-to`: payments-api and the browser test each open several checkouts,
so use a FRESH `--persist-to` folder (restart wrangler dev) before the browser test, or it hits the cap (429). Real Yoco keys are never used here.
