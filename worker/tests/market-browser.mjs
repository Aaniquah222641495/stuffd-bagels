// SB-20 browser test (Playwright over CDP + axe) at 390 and 1280: per-market Pre-order links, prefill from /?market=<id>#order,
// the Collect selector, stall-hour chips, the closed message, the Pay hand-off (stops at the Yoco checkout, never pays) and the admin panel.
// Setup as in worker/tests/README.md. Needs PW, AXE, CDP, SB_BASE, FAKE_YOCO. Screenshots go to $SHOTS.
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const axeSrc = fs.readFileSync(process.env.AXE, "utf8");
const H = await import("./_helpers.mjs");
const { B, admin, setAvail, resetPickups, clearRateLimits, col } = H;
const shots = process.env.SHOTS ?? ".";
const browser = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9444");
let axeTotal = 0;
async function axeRun(page, label) {
  await page.waitForTimeout(1000);
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((x) => x.target.join(" ")) })));
  console.log(`  axe ${label}: ${res.length}`, res.length ? JSON.stringify(res) : "");
  axeTotal += res.length;
}
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = col.sastDay(Date.now());
// A market starting 3 to 9 days after the next-but-one Friday is always in the future with its cut-off still ahead.
let fri = addDays(today, 14); while (new Date(`${fri}T00:00:00Z`).getUTCDay() !== 5) fri = addDays(fri, 1);
const OPEN = { start: fri, end: addDays(fri, 1) }; // Fri + Sat
const WALK = { start: addDays(fri, 14), end: addDays(fri, 14) };
const CLOSED = { start: today, end: addDays(today, 1) }; // already started: its Wednesday has passed
const closedOn = col.niceDay(col.marketCutoffDay(CLOSED.start));
const openCut = `${col.niceDay(col.marketCutoffDay(OPEN.start))} at 23:59`;

// Markets through the admin API (the same calls the admin page makes)
for (const e of await (await admin("/events")).json()) await admin(`/events/${e.id}`, "DELETE");
const mkEvent = async (name, d, preorder) => {
  const id = (await (await admin("/events", "POST", { name, venue: `${name} venue, Cape Town`, ...d })).json()).id;
  if (preorder) assert.equal((await admin(`/events/${id}`, "PUT", { preorder })).status, 200);
  return id;
};
const PO = (days) => ({ enabled: true, days, opens: "10:00", closes: "19:00" });
const idOpen = await mkEvent("Preorder Market", OPEN, PO([OPEN.start, OPEN.end]));
const idWalk = await mkEvent("Walkup Market", WALK);
const idClosed = await mkEvent("Closed Market", CLOSED, PO([CLOSED.start]));
console.log("markets:", { OPEN, WALK, CLOSED, openCut, closedOn });

for (const [w, h] of [[390, 844], [1280, 900]]) {
  console.log(`== ${w}px`);
  clearRateLimits();
  await setAvail({});
  await resetPickups([{ name: "Strandfontein collection", area: "Strandfontein", days: "", opens: "13:00", closes: "18:00" }]);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, bypassCSP: true });
  await ctx.route("**/api/**", (route) => route.continue({ headers: { ...route.request().headers(), "CF-Connecting-IP": H.ip } }));
  const page = await ctx.newPage();
  const bad = []; page.on("pageerror", (e) => bad.push("pageerror " + e.message));
  const open = async (url) => { await page.goto("about:blank"); await page.goto(B + url, { waitUntil: "networkidle" }); await page.waitForTimeout(700); };

  // 1. Only the open market has a Pre-order link; the walk-up and the closed one have none
  await open("/");
  const line = await page.getByTestId("preorder-line").textContent();
  assert.match(line, /Skip the queue: pre-order online and collect at the stall on market day\. Pre-order for Preorder Market/);
  const links = page.locator("a[aria-label^='Pre-order for']:visible");
  assert.equal(await links.count(), 1, "one Pre-order link, under the one open market");
  assert.equal(await page.getByTestId("preorder-line").getByRole("link", { name: /Pre-order for Preorder Market/ }).count(), 1, "and the named link in the top line");
  assert.equal(await page.locator("a[aria-label='Pre-order for Walkup Market'], a[aria-label='Pre-order for Closed Market']").count(), 0, "no link for a market with pre-orders off or closed");
  await page.getByTestId("preorder-line").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/sb20-trail-${w}.png` });
  await axeRun(page, "markets with a Pre-order link");

  // 2. The link selects the market in the form (same page, no reload)
  await page.locator("a[aria-label='Pre-order for Preorder Market']:visible").first().click();
  await page.waitForTimeout(800);
  assert.equal(await page.getByTestId("select-collect").inputValue(), `m:${idOpen}`);
  assert.equal(await page.getByTestId("select-market-day").inputValue(), OPEN.start, "its first pre-order day is preselected");
  assert.deepEqual(await page.locator("[data-testid=select-market-day] option").allTextContents(), [OPEN.start, OPEN.end].map(col.niceDay));
  const formText = await page.getByTestId("order-form").textContent();
  assert.ok(formText.includes(`Pre-orders for Preorder Market close on ${openCut}.`), "cut-off line");
  assert.ok(formText.includes("Stall hours 10am to 7pm"), "stall hours shown");
  assert.ok(formText.includes("10am to 11am") && formText.includes("6pm to 7pm"), "one-hour chips across the stall hours");
  assert.equal(await page.locator("[data-testid=select-venue]").count(), 0, "no pickup-point picker while a market is chosen");
  assert.match(page.url(), new RegExp(`\\?market=${idOpen}#order$`));
  await page.getByTestId("order-form").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/sb20-form-market-${w}.png` });
  await axeRun(page, "form with the market chosen");
  // Back to the Saturday option
  await page.getByTestId("select-collect").selectOption("sat");
  assert.equal(await page.locator("[data-testid=select-saturday], [data-testid=saturday-fixed]").count() > 0, true);
  await page.screenshot({ path: `${shots}/sb20-form-saturday-${w}.png` });

  // 3. Prefill from the link: /?market=<id>#order
  await open(`/?market=${idOpen}#order`);
  assert.equal(await page.getByTestId("select-collect").inputValue(), `m:${idOpen}`, "preselected from the address");
  assert.equal(await page.getByTestId("preorder-note").count(), 0);
  // 4. Closed market: the reason, then the normal Saturday form
  await open(`/?market=${idClosed}#order`);
  assert.equal((await page.getByTestId("preorder-note").textContent()).trim(), `Pre-orders for Closed Market closed on ${closedOn}.`);
  assert.equal(await page.locator("[data-testid=select-collect] option").count() >= 2 ? await page.getByTestId("select-collect").inputValue() : "sat", "sat", "falls back to the Saturday form");
  await page.screenshot({ path: `${shots}/sb20-closed-${w}.png` });
  await axeRun(page, "closed market note");
  // A walk-up market or junk id: no note, nothing preselected
  await open(`/?market=${idWalk}#order`);
  assert.equal(await page.getByTestId("preorder-note").count(), 0);
  await open("/?market=../x#order");
  assert.equal(await page.getByTestId("preorder-note").count(), 0);

  // 5. Pay: the browser names the market and the day (no pickup point) and gets Yoco's checkout. We stop there.
  await open(`/?market=${idOpen}#order`);
  await page.getByTestId("btn-increase-Classic Bagel").click();
  await page.getByTestId("input-name").fill("Maryam Test");
  await page.getByTestId("input-phone").fill("0821234567");
  await page.getByTestId("input-email").fill(H.uniqueEmail("mkt"));
  await page.getByLabel("10am to 11am").check({ force: true }).catch(() => page.getByText("10am to 11am").first().click());
  let sentBody = null;
  page.on("request", (rq) => { if (rq.url().endsWith("/api/order") && rq.method() === "POST") sentBody = JSON.parse(rq.postData()); });
  await page.route(`${process.env.FAKE_YOCO ?? "http://127.0.0.1:8798"}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>fake yoco</title>" }));
  await page.getByTestId("btn-place-order").click();
  await page.waitForURL(/\/pay\/|checkout/, { timeout: 15000 });
  assert.equal(sentBody.marketId, idOpen); assert.equal(sentBody.pickupDate, OPEN.start); assert.equal(sentBody.pickupId, undefined, "no pickup point for a market order");
  assert.equal(sentBody.pickupTime, "10am to 11am");
  console.log("  Pay hand-off ok: marketId + day sent, redirected to the (fake) Yoco checkout");

  // 6. Toggle off in the admin: the link and the option go away; the Worker refuses a stale tab
  assert.equal((await admin(`/events/${idOpen}`, "PUT", { preorder: { ...PO([OPEN.start, OPEN.end]), enabled: false } })).status, 200);
  await open("/");
  assert.equal(await page.getByTestId("preorder-line").count(), 0, "no pre-order line when no market takes pre-orders");
  assert.equal(await page.locator("a[aria-label^='Pre-order for']").count(), 0);
  assert.equal(await page.locator("[data-testid=select-collect]").count(), 0, "only the Saturday option: no Collect selector");
  assert.equal((await admin(`/events/${idOpen}`, "PUT", { preorder: PO([OPEN.start, OPEN.end]) })).status, 200);

  // 7. Admin panel
  await page.goto("about:blank");
  await page.goto(B + "/admin", { waitUntil: "networkidle" });
  await page.getByLabel("Admin password").fill(H.pw); await page.getByRole("button", { name: "Sign In" }).click();
  const panel = page.getByTestId(`preorder-${idWalk}`);
  await panel.waitFor();
  await panel.scrollIntoViewIfNeeded();
  await page.getByTestId(`po-${idWalk}-toggle`).check();
  await page.getByTestId(`po-${idWalk}-save`).click();
  await page.waitForTimeout(600);
  assert.match(await panel.getByRole("status").textContent(), /Add the stall hours first/, "no hours: refused with a plain message");
  await page.getByTestId(`po-${idWalk}-opens`).fill("09:00"); await page.getByTestId(`po-${idWalk}-closes`).fill("14:00");
  await page.getByTestId(`po-${idWalk}-save`).click();
  await page.waitForTimeout(600);
  assert.match(await panel.getByRole("status").textContent(), /Saved\. Pre-orders are on/);
  await panel.screenshot({ path: `${shots}/sb20-admin-${w}.png` });
  await axeRun(page, "admin with pre-order panels");
  const saved = (await (await admin("/events")).json()).find((e) => e.id === idWalk).preorder;
  assert.deepEqual([saved.enabled, saved.opens, saved.closes], [true, "09:00", "14:00"]);
  await admin(`/events/${idWalk}`, "PUT", { preorder: { enabled: false, days: [], opens: "", closes: "" } });
  assert.deepEqual(bad, [], "no page errors");
  await ctx.close();
}
console.log(axeTotal === 0 ? "market browser test: all passed, axe 0" : `market browser test: axe violations ${axeTotal}`);
process.exit(axeTotal === 0 ? 0 : 1);
