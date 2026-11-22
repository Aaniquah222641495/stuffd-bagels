// The "Cancel my order" page in Chrome (Playwright over CDP + axe) at 390 and 1280: every state it can be in, a real end-to-end cancellation against
// the real Worker with the fake Yoco, and the rule that the token never travels in a URL. Setup: README.md (wrangler dev with CANCEL_LINK_SECRET, fake Yoco,
// fake Apps Script, arm64 Chrome). Needs PW, AXE, FAKELOG, WHSEC and CANCEL in the environment, and the internet (the Turnstile widget script).
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const axeSrc = fs.readFileSync(process.env.AXE, "utf8");
const H = await import("./_helpers.mjs");
const { B, setAvail, resetPickups, clearRateLimits, col, FAKE_YOCO } = H;
assert.ok(process.env.WHSEC && process.env.FAKELOG, "set WHSEC and FAKELOG");
const SHOTS = process.env.SHOTS ?? ".";
const browser = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9444");
let axeTotal = 0;
async function axeRun(page, label) {
  await page.waitForTimeout(900);
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((x) => x.target.join(" ")) })));
  console.log(`  axe ${label}: ${res.length}`, res.length ? JSON.stringify(res) : "");
  axeTotal += res.length;
}
const A43 = "A".repeat(43);
const FAKE_TOKEN = `SB-ABCDEF.1900000000.${A43}`; // right shape; the stubbed Worker answers decide the state
const SAT = col.availableSaturdays(Date.now(), { cutoffTime: "23:59", closedDates: [], ...H.testRules() })[1];
const ref = "SB-ABCDEF";
const fulfil = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const yoco = async () => (await (await fetch(FAKE_YOCO + "/_calls")).json());
const logged = () => (fs.existsSync(process.env.FAKELOG) ? fs.readFileSync(process.env.FAKELOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

for (const [w, h] of [[390, 844], [1280, 900]]) {
  console.log(`== ${w}px`);
  clearRateLimits(); await setAvail({}); await resetPickups([]);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, bypassCSP: true });
  await ctx.route("**/api/**", (route) => route.fallback({ headers: { ...route.request().headers(), "CF-Connecting-IP": H.ip } }));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const bad = []; page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/status of (4\d\d|5\d\d)/.test(m.text()) && !/Turnstile\] Error: 200100/.test(m.text())) bad.push(m.text()); });
  const urls = []; page.on("request", (r) => urls.push(r.url()));
  const card = () => page.getByTestId("result-card");
  const stateOf = async () => card().getAttribute("data-state");
  // The card's text with a space between blocks (textContent runs paragraphs together).
  const text = () => card().evaluate((el) => { const c = el.cloneNode(true); c.querySelectorAll("p,h2,div,button").forEach((n) => n.append(" ")); return (c.textContent ?? "").replace(/\s+/g, " ").trim(); });
  const shot = (name) => page.screenshot({ path: `${SHOTS}/cancel-${name}-${w}.png` });
  const stubCheck = (status, body) => page.route("**/api/order/cancel/check", (r) => fulfil(r, status, body));
  const go = async (hash, expect) => { await page.goto("about:blank"); await page.goto(`${B}/order/cancel${hash}`, { waitUntil: "networkidle" }); await card().waitFor(); if (expect) await page.waitForFunction((s) => document.querySelector("[data-testid=result-card]")?.getAttribute("data-state") === s, expect, { timeout: 15000 }); };
  const unstub = () => page.unroute("**/api/order/cancel/check").then(() => page.unroute(/\/api\/order\/cancel$/)).catch(() => {});

  // 1. Not a valid link: no hash, junk hash, a 400 from the Worker
  await go("", "invalid"); assert.match(await text(), /This link isn't valid/); await shot("invalid"); await axeRun(page, "invalid link");
  await go("#not-a-token", "invalid");
  await stubCheck(400, { error: "That link isn't valid." }); await go(`#${FAKE_TOKEN}`, "invalid"); await unstub();
  assert.equal(await page.locator("button[data-testid=cancel-confirm]").count(), 0, "no cancel button without a valid link");
  console.log("  invalid links ok");

  // 2. Open: amount, collection day, cut-off, the credit alternative, Turnstile box, the button, a way out
  await stubCheck(200, { state: "open", ref, total: 65, pickupDate: SAT, cancelBy: "Wednesday 25 Nov at 23:59", retry: false });
  await go(`#${FAKE_TOKEN}`, "open");
  let t = await text();
  assert.match(t, /Cancel your order\?/); assert.match(t, /You paid R65 for collection on /); assert.ok(t.includes(col.niceDay(SAT)));
  assert.match(t, /You can cancel until Wednesday 25 Nov at 23:59\. We'll refund the full R65 to the card you paid with, through Yoco\./);
  assert.match(t, /Would you rather have credit for another collection Saturday or one of our markets\? Don't cancel here\. Email stuffd\.bagels@gmail\.com/);
  assert.match(await page.getByTestId("cancel-confirm").textContent(), /^Yes, cancel and refund R65$/);
  assert.equal(await page.getByTestId("turnstile-box").count(), 1, "the Turnstile box is on the page");
  assert.equal(await page.getByTestId("cancel-keep").getAttribute("href"), "/");
  assert.ok(!/[—–]/.test(t), "no dash punctuation in the copy");
  await shot("open"); await axeRun(page, "open");
  // keyboard: the button is reachable and the page has one h1
  await page.getByTestId("cancel-confirm").focus(); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "cancel-confirm");
  assert.equal(await page.locator("h1").count(), 1);
  // the page only READ: no POST to the cancel route yet
  assert.ok(!urls.some((u) => /\/api\/order\/cancel$/.test(u)), "opening the page never posts a cancellation");
  console.log("  open ok");

  // 3. Pressing the button: a Turnstile token and the link go in a POST BODY, and each Worker answer reads right
  for (const [name, status, body, expectState, re] of [
    ["refunded", 200, { state: "refunded", ref, total: 65 }, "refunded", /Order cancelled Refund processed Your order is cancelled and your refund of R65 has been processed through Yoco, back to the card you paid with\. We've emailed you a confirmation\. Your reference is SB-ABCDEF\. It can take a few days to show on your statement, depending on your bank\./],
    ["pending", 200, { state: "pending", ref, total: 65 }, "pending", /Refund on its way Your order is cancelled\. Yoco is processing your refund of R65 to the card you paid with\./],
    ["busy", 200, { state: "busy", ref }, "busy", /Your refund is being processed Please don't press anything again/],
    ["closed", 200, { state: "closed", ref }, "closed", /We can't refund this one/],
    ["unknown", 200, { state: "unknown", ref }, "unknown", /We can't find that order/],
  ]) {
    await unstub();
    await stubCheck(200, { state: "open", ref, total: 65, pickupDate: SAT, cancelBy: "Wednesday 25 Nov at 23:59", retry: false });
    const sent = []; await page.route(/\/api\/order\/cancel$/, (r) => { sent.push(r.request().postDataJSON()); return fulfil(r, status, body); });
    await go(`#${FAKE_TOKEN}`, "open");
    await page.getByTestId("cancel-confirm").click();
    await page.waitForFunction((s) => document.querySelector("[data-testid=result-card]")?.getAttribute("data-state") === s, expectState, { timeout: 20000 });
    assert.equal(sent.length, 1, name + ": one POST");
    assert.equal(sent[0].token, FAKE_TOKEN); assert.equal(sent[0].turnstileToken, "XXXX.DUMMY.TOKEN.XXXX", "the Turnstile token goes with it");
    assert.deepEqual(Object.keys(sent[0]).sort(), ["token", "turnstileToken"], "no amount, no reference, nothing else is sent: the browser never names an amount");
    assert.match(await text(), re, name); await shot(name); await axeRun(page, name);
    if (name === "refunded") assert.equal(await page.getByTestId("cancel-confirm").count(), 0, "no button once cancelled");
  }
  console.log("  answers ok");

  // 4. Closed page: the policy text word for word (collection.ts is the one source), the reference, and how to use credit
  await unstub();
  await stubCheck(200, { state: "closed", ref });
  await go(`#${FAKE_TOKEN}`, "closed");
  assert.equal((await page.getByTestId("cancel-policy").textContent()).trim(), col.CANCELLATION_POLICY, "the closed page shows the policy exactly as collection.ts has it");
  t = await text(); assert.match(t, /Cut-off passed/); assert.match(t, /The Wednesday cut-off for your order has passed, so we can't refund it\. Your reference is SB-ABCDEF\./);
  assert.match(t, /To use your credit, email stuffd\.bagels@gmail\.com with your reference and tell us which Saturday or market you would like\./);
  assert.equal(await page.locator("a[href^='mailto:stuffd.bagels@gmail.com?subject=Order%20SB-ABCDEF']").count() >= 1, true);
  assert.equal(await page.getByTestId("cancel-confirm").count(), 0, "no refund button after the cut-off");
  await shot("closed-policy");

  // 5. Failed refund: told plainly, nothing says refunded, the button becomes Try again and presses again with the same link
  await unstub();
  await stubCheck(200, { state: "open", ref, total: 65, pickupDate: SAT, cancelBy: "Wednesday 25 Nov at 23:59", retry: false });
  let posts = 0; await page.route(/\/api\/order\/cancel$/, (r) => { posts++; return posts === 1 ? fulfil(r, 200, { state: "failed", ref, total: 65 }) : fulfil(r, 200, { state: "refunded", ref, total: 65 }); });
  await go(`#${FAKE_TOKEN}`, "open"); await page.getByTestId("cancel-confirm").click();
  await page.waitForFunction(() => document.querySelector("[data-testid=result-card]")?.getAttribute("data-state") === "failed", null, { timeout: 20000 });
  t = await text(); assert.match(t, /Refund not finished yet/); assert.match(t, /couldn't finish your refund automatically\. We've been told and we will sort it out, so you don't need to do anything\./);
  assert.ok(!/Refund processed|has been processed/.test(t), "never claims the refund happened");
  assert.match(await page.getByTestId("cancel-confirm").textContent(), /^Try again$/);
  await shot("failed"); await axeRun(page, "failed");
  await page.getByTestId("cancel-confirm").click();
  await page.waitForFunction(() => document.querySelector("[data-testid=result-card]")?.getAttribute("data-state") === "refunded", null, { timeout: 20000 });
  assert.equal(posts, 2);
  console.log("  failed then retry ok");

  // 6. Refusals on the press: too many tries, security check refused, server trouble: a plain message, the button stays usable, nothing says cancelled
  for (const [status, body, re] of [[429, { error: "x" }, /That's a few too many tries/], [403, { error: "x" }, /couldn't confirm the security check/], [503, { error: "We can't do that right now. Please try again in a minute." }, /We can't do that right now/]]) {
    await unstub(); await stubCheck(200, { state: "open", ref, total: 65, pickupDate: SAT, cancelBy: "Wednesday 25 Nov at 23:59", retry: false });
    await page.route(/\/api\/order\/cancel$/, (r) => fulfil(r, status, body));
    await go(`#${FAKE_TOKEN}`, "open"); await page.getByTestId("cancel-confirm").click();
    await page.getByTestId("cancel-problem").waitFor(); assert.match(await page.getByTestId("cancel-problem").textContent(), re);
    assert.equal(await stateOf(), "open"); assert.equal(await page.getByTestId("cancel-confirm").isDisabled(), false);
    if (status === 429) { await shot("refused"); await axeRun(page, "refused press"); }
  }
  // the check itself being limited or failing
  await unstub(); await stubCheck(429, { error: "x" }); await go(`#${FAKE_TOKEN}`, "limited"); assert.match(await text(), /too many tries/);
  await unstub(); await stubCheck(500, { error: "x" }); await go(`#${FAKE_TOKEN}`, "error"); assert.match(await text(), /couldn't check your order just now/); await axeRun(page, "check failed");
  await unstub();
  console.log("  refusals ok");

  // 7. THE REAL THING: a real order against the real Worker and the fake Yoco, opened from the link in its email, then cancelled in the browser
  clearRateLimits(); await H.resetYoco(); await setAvail({});
  const [P1] = await resetPickups([{ name: "Strandfontein collection", area: "Strandfontein", days: "Saturdays, 13:00 to 18:00" }]);
  const email = H.uniqueEmail("browser");
  const r1 = await H.post("/api/order", { name: "Browser Canceller", phone: "082 123 4567", email, pickupId: P1, pickupDate: SAT, items: { "Classic Bagel": 1 }, toppings: {}, note: "", website: "", attemptId: H.attemptId() });
  const j = await r1.json(); assert.equal(r1.status, 200, JSON.stringify(j));
  assert.equal((await H.webhook(H.paidPayload(H.checkoutIdOf(j.redirectUrl), { amount: j.total * 100 }))).status, 200);
  await H.until(() => logged().some((x) => x.body.type === "order" && x.body.ref === j.ref), "the confirmation email request");
  const url = logged().find((x) => x.body.type === "order" && x.body.ref === j.ref).body.cancelUrl;
  assert.ok(url && url.startsWith(`${B}/order/cancel#SB-`), "the email's link: " + url);
  const real = url.split("#")[1];
  urls.length = 0;
  await go(`#${real}`, "open");
  t = await text(); assert.ok(t.includes(`Order ${j.ref}`) && t.includes(`R${j.total}`), t); assert.match(t, /You can cancel until Wednesday \d{1,2} [A-Z][a-z]{2} at 23:59/);
  assert.equal((await yoco()).refunds.length, 0, "opening the real link refunds nothing");
  await shot("real-open"); await axeRun(page, "real link, open");
  await page.getByTestId("cancel-confirm").click();
  await page.waitForFunction(() => document.querySelector("[data-testid=result-card]")?.getAttribute("data-state") === "refunded", null, { timeout: 25000 });
  assert.match(await text(), /Refund processed/); assert.ok((await text()).includes(j.ref));
  const rf = (await yoco()).refunds; assert.equal(rf.length, 1); assert.equal(rf[0].body, "{}"); assert.equal(rf[0].headers["idempotency-key"], `refund-${j.ref}`);
  await shot("real-refunded"); await axeRun(page, "real link, refunded");
  await H.until(() => logged().some((x) => x.body.type === "cancel" && x.body.ref === j.ref && x.body.outcome === "refunded"), "the cancellation email request");
  // the Yoco result page now says cancelled, not confirmed
  await page.goto(`${B}/order/result?r=success&ref=${j.ref}`, { waitUntil: "networkidle" }); await card().waitFor();
  await page.waitForFunction(() => document.querySelector("[data-testid=result-card]")?.getAttribute("data-state") === "cancelled", null, { timeout: 15000 });
  assert.match(await text(), /This order was cancelled/); assert.ok(!/Order confirmed/.test(await text())); await axeRun(page, "result page: cancelled");
  // reload: the page remembers (idempotent), and a second look never refunds again
  await go(`#${real}`, "refunded"); assert.equal((await yoco()).refunds.length, 1);
  // the token never travelled in a URL
  assert.ok(!urls.some((u) => u.includes(real) || u.includes(real.split(".")[2])), "the token is in the # part and in POST bodies only, never in a request URL");
  assert.ok(urls.some((u) => /\/api\/order\/cancel\/check$/.test(u)) && urls.some((u) => /\/api\/order\/cancel$/.test(u)));
  // headers on the static page
  const hd = await fetch(`${B}/order/cancel`); const hh = Object.fromEntries(hd.headers);
  assert.equal(hd.status, 200); assert.match(hh["cache-control"] ?? "", /no-store/); assert.match(hh["x-robots-tag"] ?? "", /noindex/); assert.equal(hh["referrer-policy"], "no-referrer", "exactly no-referrer, not appended to the site-wide policy");
  const html = await hd.text(); assert.match(html, /<meta name="robots" content="noindex/); assert.ok(!/<script>[^<]/.test(html.replace(/<script type="module"[^>]*><\/script>/g, "")), "no inline script (CSP)");
  console.log("  real flow ok");

  console.log("  console problems:", JSON.stringify(bad)); assert.equal(bad.length, 0);
  await ctx.close();
}
await resetPickups([]); clearRateLimits(); await setAvail({});
console.log("axe violations total:", axeTotal); assert.equal(axeTotal, 0);
console.log("CANCEL-BROWSER PASSED");
await browser.close();
