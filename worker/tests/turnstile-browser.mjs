// Turnstile widget in a real browser WITH the site's real CSP (the other browser tests bypass it), at 390 and 1280, plus axe.
// Same setup as e2e-browser.mjs (wrangler dev with the fake Yoco/script and --var TURNSTILE_API_BASE, Chrome over CDP); needs internet for
// Cloudflare's widget script (it is loaded from challenges.cloudflare.com on purpose: self-hosting it is not supported).
//   PW=<playwright-core> AXE=<axe.min.js> CDP=http://127.0.0.1:9444 SB_BASE=... node worker/tests/turnstile-browser.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const axeSrc = fs.readFileSync(process.env.AXE, "utf8");
const H = await import("./_helpers.mjs");
const { B, setAvail, resetPickups, clearRateLimits } = H;
const browser = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9444");
const axeRun = async (page, label) => {
  await page.evaluate(axeSrc);
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((x) => ({ id: x.id, n: x.nodes.length })));
  console.log(`  axe ${label}: ${v.length}`, v.length ? JSON.stringify(v) : ""); assert.equal(v.length, 0, "axe " + label);
};
// The pretend client network is added to our own /api calls only: a custom header on requests to challenges.cloudflare.com would break its CORS calls.
const asClient = (ctx) => ctx.route("**/api/**", (route) => route.continue({ headers: { ...route.request().headers(), "CF-Connecting-IP": H.ip } }));
const FORCED = "3x00000000000000000000FF"; // Cloudflare's documented test site key that always shows an interactive challenge
let n = 0; const ok = (m) => console.log("PASS", ++n, m);

for (const [w, h] of [[390, 844], [1280, 900]]) {
  console.log(`== ${w}px`);
  clearRateLimits(); await setAvail({}); await resetPickups([{ name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm" }]);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, }); // NO bypassCSP
  await asClient(ctx);
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => problems.push("pageerror " + e.message));
  const open = async () => { await page.goto(B + "/", { waitUntil: "networkidle" }); await page.getByTestId("order-form").scrollIntoViewIfNeeded(); };
  const fillOrder = async () => {
    await page.getByTestId("btn-increase-Classic Bagel").click();
    await page.getByTestId("input-name").fill("Aisha Khan"); await page.getByTestId("input-phone").fill("082 123 4567"); await page.getByTestId("input-email").fill(H.uniqueEmail("tsb" + w));
  };
  let posted = [];
  await page.route("**/api/order", (route) => { posted.push(route.request().postDataJSON()); route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "We couldn't confirm the security check. Please try again." }) }); });

  // 1. The widget script loads under the real CSP, the box is there, and a token rides along with the order
  await open(); await fillOrder();
  await page.waitForFunction(() => !!window.turnstile, null, { timeout: 15000 });
  await page.getByTestId("btn-place-order").click(); await H.until(() => posted.length === 1, "the order request");
  assert.equal(posted[0].turnstileToken, H.TS_TOKEN, "token from the (always-pass test) widget");
  ok("script loads under the real CSP (script-src and frame-src challenges.cloudflare.com); the order carries the token");

  // 2. After a refused answer the widget is reset: the next press carries a token again, and the friendly message shows
  await page.getByText("We couldn't confirm the security check").waitFor();
  await page.getByTestId("btn-place-order").click(); await H.until(() => posted.length === 2, "the second order request");
  assert.equal(posted[1].turnstileToken, H.TS_TOKEN);
  assert.notEqual(posted[1].attemptId, posted[0].attemptId, "a refused press ends that attempt");
  ok("refused (403): friendly message, widget reset, second press carries a fresh token");

  // 3. Booking form: its own widget, action booking, token in the body
  let bposted = null;
  await page.route("**/api/booking", (route) => { bposted = route.request().postDataJSON(); route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "We couldn't confirm the security check. Please try again." }) }); });
  await page.getByTestId("booking-form").scrollIntoViewIfNeeded();
  await page.getByTestId("booking-name").fill("Sam"); await page.getByTestId("booking-phone").fill("+27 82 999 9999"); await page.getByTestId("booking-email").fill(H.uniqueEmail("bk"));
  await page.getByTestId("booking-date").fill("2027-02-14"); await page.getByTestId("booking-venue").fill("Kenilworth"); await page.getByTestId("booking-guests").fill("80");
  await page.getByTestId("booking-submit").click(); await H.until(() => bposted !== null, "the booking request");
  assert.equal(bposted.turnstileToken, H.TS_TOKEN); assert.equal(await page.getByTestId("turnstile-box").count(), 2);
  ok("booking posts its token; two widget boxes on the page");
  assert.deepEqual(problems, [], "no CSP violations or page errors: " + problems.join(" | "));
  ok("no CSP violation messages, no page errors");
  await ctx.close();

  // 4. Script blocked (offline, ad blocker): no hang, a plain message, and the form is not sent
  const c2 = await browser.newContext({ viewport: { width: w, height: h }, }); await asClient(c2);
  const p2 = await c2.newPage(); let sent = 0;
  await p2.route("https://challenges.cloudflare.com/**", (r) => r.abort());
  await p2.route("**/api/order", (route) => { sent++; route.abort(); });
  await p2.goto(B + "/", { waitUntil: "networkidle" }); await p2.getByTestId("order-form").scrollIntoViewIfNeeded();
  await p2.getByTestId("btn-increase-Classic Bagel").click();
  await p2.getByTestId("input-name").fill("Aisha Khan"); await p2.getByTestId("input-phone").fill("082 123 4567"); await p2.getByTestId("input-email").fill(H.uniqueEmail("blk"));
  const t0 = Date.now(); await p2.getByTestId("btn-place-order").click();
  await p2.getByText("We couldn't finish the security check").waitFor({ timeout: 8000 });
  assert.equal(sent, 0); assert.ok(Date.now() - t0 < 8000);
  assert.equal(await p2.getByTestId("btn-place-order").isDisabled(), false, "the button works again");
  ok("script blocked: plain message, order not sent, button usable again");
  await c2.close();

  // 5. A visible interactive challenge (documented forced-interactive test key) fits the card at this width, and axe stays at 0
  const c3 = await browser.newContext({ viewport: { width: w, height: h }, }); await asClient(c3);
  const p3 = await c3.newPage();
  await p3.route("**/api/config", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turnstileSiteKey: FORCED }) }));
  await p3.goto(B + "/", { waitUntil: "networkidle" }); await p3.getByTestId("order-form").scrollIntoViewIfNeeded();
  await p3.getByTestId("btn-increase-Classic Bagel").click();
  // The challenge frame sits in a closed shadow root, so measure the box it draws into: it must be tall enough to show the challenge and fit the card.
  await p3.waitForFunction(() => document.querySelector('[data-testid="turnstile-box"]').getBoundingClientRect().height >= 60, null, { timeout: 15000 });
  await p3.waitForTimeout(2500);
  const fits = await p3.evaluate(() => { const box = document.querySelector('[data-testid="turnstile-box"]'); const inner = box.firstElementChild.getBoundingClientRect(), b = box.getBoundingClientRect(), card = box.closest("form").getBoundingClientRect(); return { box: [Math.round(b.width), Math.round(b.height)], inner: [Math.round(inner.width), Math.round(inner.height)], card: Math.round(card.width), overflowX: document.documentElement.scrollWidth > window.innerWidth }; });
  console.log("  interactive widget:", JSON.stringify(fits));
  assert.ok(fits.inner[0] >= 300 && fits.inner[0] <= fits.box[0] + 1 && fits.box[0] <= fits.card + 1 && !fits.overflowX, "widget is at least 300 wide, fits its box and the card, no sideways scroll");
  await p3.getByTestId("btn-place-order").scrollIntoViewIfNeeded(); await p3.screenshot({ path: `${process.env.SHOTS ?? "."}/turnstile-interactive-${w}.png` });
  await axeRun(p3, "order form with a visible challenge");
  await c3.close();
  ok("visible challenge fits the card (no sideways scroll), axe 0");

  // 6. axe with the normal (interaction-only) widget present on the page
  const c4 = await browser.newContext({ viewport: { width: w, height: h }, }); await asClient(c4);
  const p4 = await c4.newPage(); await p4.goto(B + "/", { waitUntil: "networkidle" }); await p4.getByTestId("order-form").scrollIntoViewIfNeeded(); await p4.waitForTimeout(2500);
  await axeRun(p4, "home with the widget"); await c4.close();
  ok("axe 0 on the page with the managed widget in place");
}
console.log(`turnstile-browser: all ${n} checks passed`);
process.exit(0);
