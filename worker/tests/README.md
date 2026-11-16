# Tests for the order, booking and pickup features

None of these send real email: the "Apps Script" is a fake (`fake-apps-script.mjs`). Nothing here touches the live Worker.

| File | What it proves | Needs |
|---|---|---|
| `../../apps-script/selftest.mjs` | Code.gs logic: subjects, escaping, duplicate guard, quota, token, labels | Node only |
| `saturday-rules.mjs` | The real Worker order code with a fake clock: Wednesday 23:59 vs Thursday 00:00 SAST, Saturday-only, closed Saturday, weeks ahead, owner-set cut-off, month/year/leap-year ends, pickup point checks | Node only |
| `forms-api.mjs` | Live HTTP path: validation, honeypot, closed dates, orders off, point switched off, rate limits | wrangler dev + fake script |
| `prices.mjs` | Totals come from content.ts on the server; unpriced toppings refused | wrangler dev + fake script |
| `pickups-api.mjs` | Admin pickup points: auth, validation, limits, edit, on/off, remove; cut-off and weeks-ahead settings | wrangler dev |
| `e2e-browser.mjs` | Browser checks at 390 and 1280 incl. axe: hidden ordering, form, Saturdays, cut-off note, admin screens | wrangler dev + fake script + Chrome |

## Run
```
node apps-script/selftest.mjs
node worker/tests/saturday-rules.mjs

# in two terminals
node worker/tests/fake-apps-script.mjs /tmp/fake.log
npx wrangler@4.148.0 dev --port 8787 --var APPS_SCRIPT_URL:http://127.0.0.1:8799/exec --var APPS_SCRIPT_TOKEN:tok123

# then
rm -f /tmp/fake.log
node worker/tests/pickups-api.mjs /tmp/fake.log
node worker/tests/forms-api.mjs   /tmp/fake.log
node worker/tests/prices.mjs      /tmp/fake.log
```
The API tests read the admin password from the git-ignored `.dev.vars`, create their own pickup points and clear the
local rate-limit counters. They end with no pickup points saved: the site's "no pickup points yet" state.

Browser test: start Chrome with `--remote-debugging-port=9444` (on Apple silicon launch it with `arch -arm64`, a Rosetta Chrome is far
too slow), then `PW=<path to playwright-core> AXE=<path to axe.min.js> FAKELOG=/tmp/fake.log SHOTS=/tmp node worker/tests/e2e-browser.mjs`.
Build the site first (`PORT=5173 BASE_PATH=/ pnpm --filter @workspace/stuffd-bagels run build`).
